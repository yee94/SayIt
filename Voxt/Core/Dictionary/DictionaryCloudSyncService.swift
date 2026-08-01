// DictionaryCloudSyncService.swift
// CloudKit private-database sync for dictionary entries and categories.

import Foundation
import CloudKit
import Combine

/// Sync state machine for dictionary iCloud synchronization.
enum DictionaryCloudSyncState: Equatable {
    case syncDisabled
    case idle
    case syncing
    case synced
    case error(String)

    var statusText: String {
        switch self {
        case .syncDisabled:
            return AppLocalization.localizedString("iCloud unavailable")
        case .idle:
            return AppLocalization.localizedString("Ready to sync")
        case .syncing:
            return AppLocalization.localizedString("Syncing…")
        case .synced:
            return AppLocalization.localizedString("Synced")
        case .error(let message):
            return message
        }
    }
}

/// Bidirectional CloudKit sync for dictionary hotwords (private database).
/// Merge strategy: last-write-wins by `updatedAt` timestamp on each record.
@MainActor
final class DictionaryCloudSyncService: ObservableObject {
    /// Matches entitlements `iCloud.$(PRODUCT_BUNDLE_IDENTIFIER)` (e.g. iCloud.com.sayit.app).
    nonisolated static var containerIdentifier: String {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.sayit.app"
        return "iCloud.\(bundleID)"
    }
    static let entryRecordType = "DictionaryEntry"
    static let categoryRecordType = "DictionaryCategory"
    static let deletionRecordType = "DictionaryDeletion"

    private static let enabledKey = "dictionaryCloudSyncEnabled"
    private static let lastSyncKey = "dictionaryCloudSyncLastSyncAt"
    private static let changeTokenKey = "dictionaryCloudSyncServerChangeToken"
    private static let pushDebounceNanoseconds: UInt64 = 3_000_000_000

    @Published private(set) var state: DictionaryCloudSyncState = .syncDisabled
    @Published private(set) var lastSyncAt: Date?
    @Published private(set) var isEnabled: Bool = false

    private let dictionaryStore: DictionaryStore
    private let defaults: UserDefaults
    private let containerIdentifier: String

    private var container: CKContainer?
    private var database: CKDatabase?
    private var cancellables = Set<AnyCancellable>()
    private var pushTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var isSyncInFlight = false
    private var needsAnotherSync = false
    private var accountStatus: CKAccountStatus = .couldNotDetermine
    private var knownEntryIDs: Set<UUID> = []
    private var knownCategoryIDs: Set<UUID> = []
    private var pendingDeletedEntryIDs: Set<UUID> = []
    private var pendingDeletedCategoryIDs: Set<UUID> = []

    init(
        dictionaryStore: DictionaryStore,
        defaults: UserDefaults = .standard,
        containerIdentifier: String? = nil
    ) {
        self.dictionaryStore = dictionaryStore
        self.defaults = defaults
        self.containerIdentifier = containerIdentifier ?? DictionaryCloudSyncService.containerIdentifier
        self.isEnabled = defaults.bool(forKey: Self.enabledKey)
        if let interval = defaults.object(forKey: Self.lastSyncKey) as? Double {
            self.lastSyncAt = Date(timeIntervalSince1970: interval)
        }
        self.knownEntryIDs = Set(dictionaryStore.entries.map(\.id))
        self.knownCategoryIDs = Set(dictionaryStore.categories.map(\.id))
    }

    /// Call once after app launch (or when the settings dialog opens) to restore prior preference.
    func bootstrap() {
        guard !VoxtRuntimeEnvironment.isRunningUnitTests else {
            state = .syncDisabled
            return
        }
        if isEnabled {
            Task { await startSyncIfPossible(triggerImmediateSync: true) }
        } else {
            state = .syncDisabled
        }
    }

    func enableSync() {
        isEnabled = true
        defaults.set(true, forKey: Self.enabledKey)
        Task { await startSyncIfPossible(triggerImmediateSync: true) }
    }

    func disableSync() {
        isEnabled = false
        defaults.set(false, forKey: Self.enabledKey)
        pushTask?.cancel()
        pushTask = nil
        syncTask?.cancel()
        syncTask = nil
        isSyncInFlight = false
        needsAnotherSync = false
        cancellables.removeAll()
        container = nil
        database = nil
        state = .syncDisabled
        VoxtLog.dictionary("Dictionary CloudKit sync disabled.")
    }

    func syncNow() {
        guard isEnabled else { return }
        Task { await performSync(reason: "manual") }
    }

    // MARK: - Lifecycle

    private func startSyncIfPossible(triggerImmediateSync: Bool) async {
        let available = await refreshAccountAvailability()
        guard available else {
            state = .syncDisabled
            return
        }
        wireLocalChangeObservers()
        state = lastSyncAt == nil ? .idle : .synced
        if triggerImmediateSync {
            await performSync(reason: "enable")
        }
    }

    private func refreshAccountAvailability() async -> Bool {
        let ckContainer = CKContainer(identifier: containerIdentifier)
        container = ckContainer
        do {
            let status = try await ckContainer.accountStatus()
            accountStatus = status
            guard status == .available else {
                VoxtLog.dictionary("Dictionary CloudKit account unavailable. status=\(status.rawValue)")
                database = nil
                return false
            }
            database = ckContainer.privateCloudDatabase
            return true
        } catch {
            VoxtLog.dictionaryWarning("Dictionary CloudKit accountStatus failed: \(error.localizedDescription)")
            accountStatus = .couldNotDetermine
            database = nil
            return false
        }
    }

    private func wireLocalChangeObservers() {
        cancellables.removeAll()
        knownEntryIDs = Set(dictionaryStore.entries.map(\.id))
        knownCategoryIDs = Set(dictionaryStore.categories.map(\.id))
        dictionaryStore.$entries
            .dropFirst()
            .sink { [weak self] entries in
                guard let self else { return }
                self.noteLocalEntrySnapshot(entries)
                self.schedulePushAfterLocalChange()
            }
            .store(in: &cancellables)
        dictionaryStore.$categories
            .dropFirst()
            .sink { [weak self] categories in
                guard let self else { return }
                self.noteLocalCategorySnapshot(categories)
                self.schedulePushAfterLocalChange()
            }
            .store(in: &cancellables)
    }

    private func noteLocalEntrySnapshot(_ entries: [DictionaryEntry]) {
        let currentIDs = Set(entries.map(\.id))
        if !dictionaryStore.isApplyingRemoteSync {
            let removed = knownEntryIDs.subtracting(currentIDs)
            pendingDeletedEntryIDs.formUnion(removed)
        }
        knownEntryIDs = currentIDs
        pendingDeletedEntryIDs.subtract(currentIDs)
    }

    private func noteLocalCategorySnapshot(_ categories: [DictionaryCategory]) {
        let currentIDs = Set(categories.map(\.id))
        if !dictionaryStore.isApplyingRemoteSync {
            let removed = knownCategoryIDs.subtracting(currentIDs)
                .filter { $0 != DictionaryCategory.defaultID }
            pendingDeletedCategoryIDs.formUnion(removed)
        }
        knownCategoryIDs = currentIDs
        pendingDeletedCategoryIDs.subtract(currentIDs)
    }

    private func schedulePushAfterLocalChange() {
        guard isEnabled else { return }
        guard !dictionaryStore.isApplyingRemoteSync else { return }
        pushTask?.cancel()
        pushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.pushDebounceNanoseconds)
            guard let self, !Task.isCancelled else { return }
            await self.performSync(reason: "localChange")
        }
    }

    // MARK: - Sync pipeline

    private func performSync(reason: String) async {
        guard isEnabled else { return }
        if isSyncInFlight {
            needsAnotherSync = true
            return
        }
        isSyncInFlight = true
        state = .syncing
        defer {
            isSyncInFlight = false
            if needsAnotherSync {
                needsAnotherSync = false
                Task { await self.performSync(reason: "coalesced") }
            }
        }

        let available = await refreshAccountAvailability()
        guard available, let database else {
            state = .syncDisabled
            return
        }

        do {
            try await pullRemoteChanges(database: database)
            try await pushLocalSnapshot(database: database)
            let now = Date()
            lastSyncAt = now
            defaults.set(now.timeIntervalSince1970, forKey: Self.lastSyncKey)
            state = .synced
            VoxtLog.dictionary("Dictionary CloudKit sync finished. reason=\(reason)")
        } catch is CancellationError {
            state = lastSyncAt == nil ? .idle : .synced
        } catch {
            let message = error.localizedDescription
            state = .error(message)
            VoxtLog.dictionaryWarning("Dictionary CloudKit sync failed: \(message)")
        }
    }

    // MARK: - Pull

    private func pullRemoteChanges(database: CKDatabase) async throws {
        var entryRecords: [CKRecord] = []
        var categoryRecords: [CKRecord] = []
        var deletionRecords: [CKRecord] = []

        try await fetchAllRecords(
            database: database,
            recordType: Self.entryRecordType,
            into: &entryRecords
        )
        try await fetchAllRecords(
            database: database,
            recordType: Self.categoryRecordType,
            into: &categoryRecords
        )
        try await fetchAllRecords(
            database: database,
            recordType: Self.deletionRecordType,
            into: &deletionRecords
        )

        let remoteEntries = entryRecords.compactMap(Self.entry(from:))
        let remoteCategories = categoryRecords.compactMap(Self.category(from:))

        var deletedEntryIDs = Set<UUID>()
        var deletedCategoryIDs = Set<UUID>()
        for record in deletionRecords {
            guard let kind = record["kind"] as? String,
                  let idString = record["targetID"] as? String,
                  let id = UUID(uuidString: idString)
            else {
                continue
            }
            if kind == "entry" {
                deletedEntryIDs.insert(id)
            } else if kind == "category" {
                deletedCategoryIDs.insert(id)
            }
        }

        // Prefer live records over deletion markers when both exist (record recreated later).
        deletedEntryIDs.subtract(remoteEntries.map(\.id))
        deletedCategoryIDs.subtract(remoteCategories.map(\.id))

        guard !remoteEntries.isEmpty
            || !remoteCategories.isEmpty
            || !deletedEntryIDs.isEmpty
            || !deletedCategoryIDs.isEmpty
        else {
            return
        }

        dictionaryStore.applyRemoteSync(
            entries: remoteEntries,
            categories: remoteCategories,
            deletedEntryIDs: deletedEntryIDs,
            deletedCategoryIDs: deletedCategoryIDs
        )
    }

    private func fetchAllRecords(
        database: CKDatabase,
        recordType: String,
        into records: inout [CKRecord]
    ) async throws {
        // Avoid sortDescriptors so queries work before CloudKit indexes are configured.
        let query = CKQuery(recordType: recordType, predicate: NSPredicate(value: true))

        var cursor: CKQueryOperation.Cursor?
        do {
            let (matchResults, queryCursor) = try await database.records(
                matching: query,
                inZoneWith: nil,
                desiredKeys: nil,
                resultsLimit: CKQueryOperation.maximumResults
            )
            for (_, result) in matchResults {
                if case .success(let record) = result {
                    records.append(record)
                }
            }
            cursor = queryCursor
        } catch let error as CKError where error.code == .unknownItem {
            // Record type not yet created in the private database; treat as empty.
            return
        }

        while let currentCursor = cursor {
            let (pageResults, nextCursor) = try await database.records(
                continuingMatchFrom: currentCursor,
                desiredKeys: nil,
                resultsLimit: CKQueryOperation.maximumResults
            )
            for (_, result) in pageResults {
                if case .success(let record) = result {
                    records.append(record)
                }
            }
            cursor = nextCursor
        }
    }

    // MARK: - Push

    private func pushLocalSnapshot(database: CKDatabase) async throws {
        let localEntries = dictionaryStore.entries
        let localCategories = dictionaryStore.categories

        var recordsToSave: [CKRecord] = []
        recordsToSave.reserveCapacity(
            localEntries.count + localCategories.count
                + pendingDeletedEntryIDs.count + pendingDeletedCategoryIDs.count
        )

        for category in localCategories {
            recordsToSave.append(Self.record(from: category))
        }
        for entry in localEntries {
            recordsToSave.append(Self.record(from: entry))
        }

        let deletedEntryIDs = pendingDeletedEntryIDs
        let deletedCategoryIDs = pendingDeletedCategoryIDs
        let now = Date()
        for entryID in deletedEntryIDs {
            recordsToSave.append(Self.deletionRecord(kind: "entry", targetID: entryID, updatedAt: now))
        }
        for categoryID in deletedCategoryIDs {
            recordsToSave.append(Self.deletionRecord(kind: "category", targetID: categoryID, updatedAt: now))
        }

        var recordIDsToDelete: [CKRecord.ID] = []
        for entryID in deletedEntryIDs {
            recordIDsToDelete.append(CKRecord.ID(recordName: entryID.uuidString))
        }
        for categoryID in deletedCategoryIDs {
            recordIDsToDelete.append(CKRecord.ID(recordName: categoryID.uuidString))
        }

        if !recordsToSave.isEmpty {
            for chunk in recordsToSave.chunked(into: 200) {
                try await modifyRecords(saving: chunk, deleting: [], database: database)
            }
        }
        if !recordIDsToDelete.isEmpty {
            for chunk in recordIDsToDelete.chunked(into: 200) {
                try await modifyRecords(saving: [], deleting: chunk, database: database)
            }
        }

        pendingDeletedEntryIDs.subtract(deletedEntryIDs)
        pendingDeletedCategoryIDs.subtract(deletedCategoryIDs)
    }

    private func modifyRecords(
        saving records: [CKRecord],
        deleting recordIDs: [CKRecord.ID],
        database: CKDatabase
    ) async throws {
        guard !records.isEmpty || !recordIDs.isEmpty else { return }
        let result = try await database.modifyRecords(
            saving: records,
            deleting: recordIDs,
            savePolicy: .allKeys,
            atomically: false
        )
        for (_, saveResult) in result.saveResults {
            if case .failure(let error) = saveResult {
                // Server-record-changed is expected under concurrent edits; last-write-wins
                // on the next pull cycle. Other failures bubble up.
                if let ckError = error as? CKError, ckError.code == .serverRecordChanged {
                    continue
                }
                throw error
            }
        }
        for (_, deleteResult) in result.deleteResults {
            if case .failure(let error) = deleteResult {
                if let ckError = error as? CKError,
                   ckError.code == .unknownItem || ckError.code == .serverRecordChanged {
                    continue
                }
                throw error
            }
        }
    }

    // MARK: - Record mapping

    nonisolated static func record(from entry: DictionaryEntry) -> CKRecord {
        let recordID = CKRecord.ID(recordName: entry.id.uuidString)
        let record = CKRecord(recordType: entryRecordType, recordID: recordID)
        record["term"] = entry.term as CKRecordValue
        record["normalizedTerm"] = entry.normalizedTerm as CKRecordValue
        record["categoryID"] = entry.categoryID.uuidString as CKRecordValue
        if let snapshot = entry.categoryNameSnapshot {
            record["categoryNameSnapshot"] = snapshot as CKRecordValue
        }
        if let groupID = entry.groupID {
            record["groupID"] = groupID.uuidString as CKRecordValue
        }
        if let groupName = entry.groupNameSnapshot {
            record["groupNameSnapshot"] = groupName as CKRecordValue
        }
        record["source"] = entry.source.rawValue as CKRecordValue
        record["status"] = entry.status.rawValue as CKRecordValue
        record["matchCount"] = entry.matchCount as CKRecordValue
        record["createdAt"] = entry.createdAt as CKRecordValue
        record["updatedAt"] = entry.updatedAt as CKRecordValue
        if let lastMatchedAt = entry.lastMatchedAt {
            record["lastMatchedAt"] = lastMatchedAt as CKRecordValue
        }
        if let data = try? JSONEncoder().encode(entry.replacementTerms),
           let json = String(data: data, encoding: .utf8) {
            record["replacementTermsJSON"] = json as CKRecordValue
        }
        if let data = try? JSONEncoder().encode(entry.observedVariants),
           let json = String(data: data, encoding: .utf8) {
            record["observedVariantsJSON"] = json as CKRecordValue
        }
        return record
    }

    nonisolated static func record(from category: DictionaryCategory) -> CKRecord {
        let recordID = CKRecord.ID(recordName: category.id.uuidString)
        let record = CKRecord(recordType: categoryRecordType, recordID: recordID)
        record["name"] = category.name as CKRecordValue
        record["normalizedName"] = category.normalizedName as CKRecordValue
        record["isDefault"] = (category.isDefault ? 1 : 0) as CKRecordValue
        record["isExpanded"] = (category.isExpanded ? 1 : 0) as CKRecordValue
        record["sortOrder"] = category.sortOrder as CKRecordValue
        record["createdAt"] = category.createdAt as CKRecordValue
        record["updatedAt"] = category.updatedAt as CKRecordValue
        return record
    }

    nonisolated static func deletionRecord(kind: String, targetID: UUID, updatedAt: Date) -> CKRecord {
        let recordName = "del-\(kind)-\(targetID.uuidString)"
        let recordID = CKRecord.ID(recordName: recordName)
        let record = CKRecord(recordType: deletionRecordType, recordID: recordID)
        record["kind"] = kind as CKRecordValue
        record["targetID"] = targetID.uuidString as CKRecordValue
        record["updatedAt"] = updatedAt as CKRecordValue
        return record
    }

    nonisolated static func entry(from record: CKRecord) -> DictionaryEntry? {
        guard record.recordType == entryRecordType else { return nil }
        let id = UUID(uuidString: record.recordID.recordName) ?? UUID()
        guard let term = record["term"] as? String,
              let normalizedTerm = record["normalizedTerm"] as? String
        else {
            return nil
        }
        let categoryID = (record["categoryID"] as? String).flatMap(UUID.init(uuidString:))
            ?? DictionaryCategory.defaultID
        let sourceRaw = (record["source"] as? String) ?? DictionaryEntrySource.manual.rawValue
        let statusRaw = (record["status"] as? String) ?? DictionaryEntryStatus.active.rawValue
        let createdAt = (record["createdAt"] as? Date) ?? Date()
        let updatedAt = (record["updatedAt"] as? Date) ?? createdAt
        let matchCount = (record["matchCount"] as? Int) ?? 0

        var replacementTerms: [DictionaryReplacementTerm] = []
        if let json = record["replacementTermsJSON"] as? String,
           let data = json.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([DictionaryReplacementTerm].self, from: data) {
            replacementTerms = decoded
        }

        var observedVariants: [ObservedVariant] = []
        if let json = record["observedVariantsJSON"] as? String,
           let data = json.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([ObservedVariant].self, from: data) {
            observedVariants = decoded
        }

        return DictionaryEntry(
            id: id,
            term: term,
            normalizedTerm: normalizedTerm,
            categoryID: categoryID,
            categoryNameSnapshot: record["categoryNameSnapshot"] as? String,
            groupID: (record["groupID"] as? String).flatMap(UUID.init(uuidString:)),
            groupNameSnapshot: record["groupNameSnapshot"] as? String,
            source: DictionaryEntrySource(rawValue: sourceRaw) ?? .manual,
            createdAt: createdAt,
            updatedAt: updatedAt,
            lastMatchedAt: record["lastMatchedAt"] as? Date,
            matchCount: matchCount,
            status: DictionaryEntryStatus(rawValue: statusRaw) ?? .active,
            observedVariants: observedVariants,
            replacementTerms: replacementTerms
        )
    }

    nonisolated static func category(from record: CKRecord) -> DictionaryCategory? {
        guard record.recordType == categoryRecordType else { return nil }
        guard let id = UUID(uuidString: record.recordID.recordName) else { return nil }
        guard let name = record["name"] as? String else { return nil }
        let normalizedName = (record["normalizedName"] as? String)
            ?? DictionaryStore.normalizeTerm(name)
        let isDefault = ((record["isDefault"] as? Int) ?? 0) != 0
            || id == DictionaryCategory.defaultID
        let isExpanded = ((record["isExpanded"] as? Int) ?? 1) != 0
        let sortOrder = (record["sortOrder"] as? Int) ?? 0
        let createdAt = (record["createdAt"] as? Date) ?? Date()
        let updatedAt = (record["updatedAt"] as? Date) ?? createdAt
        return DictionaryCategory(
            id: id,
            name: name,
            normalizedName: normalizedName,
            isDefault: isDefault,
            isExpanded: isExpanded,
            sortOrder: sortOrder,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0, !isEmpty else { return isEmpty ? [] : [self] }
        var result: [[Element]] = []
        result.reserveCapacity((count + size - 1) / size)
        var index = startIndex
        while index < endIndex {
            let next = self.index(index, offsetBy: size, limitedBy: endIndex) ?? endIndex
            result.append(Array(self[index..<next]))
            index = next
        }
        return result
    }
}
