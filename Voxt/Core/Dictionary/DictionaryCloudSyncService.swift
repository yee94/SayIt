// DictionaryCloudSyncService.swift
// Folder-based dictionary sync (SayIt-compatible): pick a shared directory to enable.

import Foundation
import Combine
import AppKit

/// Sync state machine for folder-based dictionary synchronization.
enum DictionaryCloudSyncState: Equatable {
    case syncDisabled
    case idle
    case syncing
    case synced
    case error(String)

    var statusText: String {
        switch self {
        case .syncDisabled:
            return AppLocalization.localizedString("No sync folder set")
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

/// Lightweight snapshot entry used for cross-device folder merge (SayIt CSV shape).
struct DictionarySyncSnapshotEntry: Equatable, Hashable {
    var id: String
    var term: String
    var weight: Int
    var source: String
    var createdAt: String
}

/// Bidirectional dictionary sync via a user-selected shared folder.
/// Each device writes `sayit-vocabulary-{deviceId}.csv`; all snapshots are merged
/// with SayIt rules (term key union, max weight, manual > ai/auto, LWW by createdAt).
@MainActor
final class DictionaryCloudSyncService: ObservableObject {
    nonisolated static let snapshotFilePrefix = "sayit-vocabulary-"
    nonisolated static let snapshotFileSuffix = ".csv"
    nonisolated static let csvHeader = "id,term,weight,source,created_at"

    private static let pushDebounceNanoseconds: UInt64 = 30_000_000_000
    private static let pollIntervalNanoseconds: UInt64 = 300_000_000_000

    @Published private(set) var state: DictionaryCloudSyncState = .syncDisabled
    @Published private(set) var lastSyncAt: Date?
    @Published private(set) var directoryPath: String = ""
    @Published private(set) var isEnabled: Bool = false

    private let dictionaryStore: DictionaryStore
    private let usageSummaryStore: UsageDaySummaryStore?
    private let defaults: UserDefaults
    private var cancellables = Set<AnyCancellable>()
    private var pushTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var isSyncInFlight = false
    private var needsAnotherSync = false

    init(
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore? = nil,
        defaults: UserDefaults = .standard
    ) {
        self.dictionaryStore = dictionaryStore
        self.usageSummaryStore = usageSummaryStore
        self.defaults = defaults
        self.directoryPath = defaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath) ?? ""
        self.isEnabled = !directoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if let interval = defaults.object(forKey: AppPreferenceKey.dictionarySyncLastSyncedAt) as? Double {
            self.lastSyncAt = Date(timeIntervalSince1970: interval)
        }
        // Drop legacy CloudKit preference if present.
        defaults.removeObject(forKey: "dictionaryCloudSyncEnabled")
        defaults.removeObject(forKey: "dictionaryCloudSyncServerChangeToken")
        if defaults.object(forKey: "dictionaryCloudSyncLastSyncAt") != nil,
           defaults.object(forKey: AppPreferenceKey.dictionarySyncLastSyncedAt) == nil,
           let legacy = defaults.object(forKey: "dictionaryCloudSyncLastSyncAt") as? Double {
            defaults.set(legacy, forKey: AppPreferenceKey.dictionarySyncLastSyncedAt)
            lastSyncAt = Date(timeIntervalSince1970: legacy)
        }
        defaults.removeObject(forKey: "dictionaryCloudSyncLastSyncAt")
    }

    /// Call once after app launch to restore prior folder preference.
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

    var deviceId: String {
        if let existing = defaults.string(forKey: AppPreferenceKey.dictionarySyncDeviceId)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString.lowercased()
        defaults.set(created, forKey: AppPreferenceKey.dictionarySyncDeviceId)
        return created
    }

    // MARK: - Manual package transfer

    /// Exports a single JSON package (dictionary + usage + settings metadata; no API keys).
    func exportSyncPackage() throws -> Data {
        try AppSyncPackageTransfer.exportPackage(
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageSummaryStore,
            defaults: defaults,
            deviceID: deviceId
        )
    }

    /// Imports a package and merges into local stores.
    func importSyncPackage(from data: Data) throws -> AppSyncPackageImportResult {
        try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageSummaryStore,
            defaults: defaults
        )
    }

    @discardableResult
    func pickSyncDirectory() -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = AppLocalization.localizedString("Choose Sync Folder")
        panel.message = AppLocalization.localizedString(
            "Choose a shared folder for dictionary sync (for example under iCloud Drive)."
        )
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        return setSyncDirectory(url)
    }

    @discardableResult
    func setSyncDirectory(_ url: URL) -> Bool {
        do {
            let bookmark = try SecurityScopedBookmarkSupport.createBookmark(for: url)
            let path = url.standardizedFileURL.path
            defaults.set(bookmark, forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
            defaults.set(path, forKey: AppPreferenceKey.dictionarySyncDirectoryPath)
            _ = deviceId
            directoryPath = path
            isEnabled = true
            Task { await startSyncIfPossible(triggerImmediateSync: true) }
            return true
        } catch {
            state = .error(error.localizedDescription)
            VoxtLog.dictionaryWarning("Dictionary folder sync save failed: \(error.localizedDescription)")
            return false
        }
    }

    func clearSyncDirectory() {
        isEnabled = false
        directoryPath = ""
        defaults.removeObject(forKey: AppPreferenceKey.dictionarySyncDirectoryPath)
        defaults.removeObject(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
        defaults.removeObject(forKey: AppPreferenceKey.dictionarySyncLastSyncedAt)
        lastSyncAt = nil
        pushTask?.cancel()
        pushTask = nil
        syncTask?.cancel()
        syncTask = nil
        pollTask?.cancel()
        pollTask = nil
        isSyncInFlight = false
        needsAnotherSync = false
        cancellables.removeAll()
        state = .syncDisabled
        VoxtLog.dictionary("Dictionary folder sync disabled.")
    }

    func syncNow() {
        guard isEnabled else { return }
        Task { await performSync(reason: "manual") }
    }

    // MARK: - Lifecycle

    private func startSyncIfPossible(triggerImmediateSync: Bool) async {
        guard accessSyncDirectory() != nil else {
            state = .error(AppLocalization.localizedString("Sync folder is unavailable"))
            return
        }
        wireLocalChangeObservers()
        startPollingIfNeeded()
        state = lastSyncAt == nil ? .idle : .synced
        if triggerImmediateSync {
            await performSync(reason: "enable")
        }
    }

    private func accessSyncDirectory() -> SecurityScopedBookmarkSupport.Access? {
        SecurityScopedBookmarkSupport.accessDirectoryURL(
            bookmarkData: defaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark),
            fallbackPath: defaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath) ?? ""
        )
    }

    private func wireLocalChangeObservers() {
        cancellables.removeAll()
        dictionaryStore.$entries
            .dropFirst()
            .sink { [weak self] _ in
                guard let self else { return }
                guard !self.dictionaryStore.isApplyingRemoteSync else { return }
                self.schedulePushAfterLocalChange()
            }
            .store(in: &cancellables)
    }

    private func startPollingIfNeeded() {
        pollTask?.cancel()
        pollTask = Task { @MainActor [weak self] in
            while let self, !Task.isCancelled, self.isEnabled {
                try? await Task.sleep(nanoseconds: Self.pollIntervalNanoseconds)
                guard !Task.isCancelled, self.isEnabled else { return }
                await self.performSync(reason: "poll")
            }
        }
    }

    private func schedulePushAfterLocalChange() {
        pushTask?.cancel()
        pushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.pushDebounceNanoseconds)
            guard let self, !Task.isCancelled, self.isEnabled else { return }
            await self.performSync(reason: "local-change")
        }
    }

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
                Task { await performSync(reason: "coalesced") }
            }
        }

        do {
            guard let access = accessSyncDirectory() else {
                throw DictionaryFolderSyncError.folderUnavailable
            }
            let directoryURL = access.url
            let localEntries = dictionaryStore.entries
            let snapshotEntries = localEntries.map(Self.snapshotEntry(from:))
            let content = Self.serializeCSV(snapshotEntries)
            try Self.writeSnapshot(
                content: content,
                directoryURL: directoryURL,
                deviceId: deviceId
            )

            let snapshots = try Self.listSnapshots(in: directoryURL)
            let parsed = snapshots.compactMap { snapshot -> (deviceId: String, entries: [DictionarySyncSnapshotEntry])? in
                let entries = Self.parseCSV(snapshot.content)
                return (snapshot.deviceId, entries)
            }
            let withoutSelf = parsed.filter { $0.deviceId != deviceId }
            let mergedSnapshots = withoutSelf + [(deviceId, snapshotEntries)]
            let merged = Self.mergeSnapshots(mergedSnapshots)
            let localSorted = Self.sortSnapshotEntries(snapshotEntries)
            let mergedSorted = Self.sortSnapshotEntries(merged)
            let changed = localSorted != mergedSorted

            if changed {
                let remoteEntries = mergedSorted.map { Self.dictionaryEntry(from: $0) }
                dictionaryStore.applyRemoteSync(
                    entries: remoteEntries,
                    categories: [],
                    deletedEntryIDs: [],
                    deletedCategoryIDs: []
                )
                // Remove local terms that no longer exist after merge (term-key based union).
                let mergedIDs = Set(remoteEntries.map(\.id))
                let staleIDs = Set(localEntries.map(\.id)).subtracting(mergedIDs)
                if !staleIDs.isEmpty {
                    dictionaryStore.applyRemoteSync(
                        entries: [],
                        categories: [],
                        deletedEntryIDs: staleIDs,
                        deletedCategoryIDs: []
                    )
                }
            }

            // Usage day summary folder sync is best-effort and independent of dictionary success.
            syncUsageDaySummaries(directoryURL: directoryURL)
            // App settings folder sync is best-effort; failures must not fail dictionary sync.
            syncAppSettings(directoryURL: directoryURL)

            let now = Date()
            lastSyncAt = now
            defaults.set(now.timeIntervalSince1970, forKey: AppPreferenceKey.dictionarySyncLastSyncedAt)
            state = .synced
            VoxtLog.dictionary(
                "Dictionary folder sync finished. reason=\(reason) snapshots=\(max(snapshots.count, 1)) changed=\(changed)"
            )
        } catch {
            let message = error.localizedDescription
            state = .error(message)
            VoxtLog.dictionaryWarning("Dictionary folder sync failed: \(message)")
        }
    }

    /// Writes local usage snapshot and merges remote device files. Failures only log warnings.
    private func syncUsageDaySummaries(directoryURL: URL) {
        guard let usageSummaryStore else { return }
        do {
            let days = usageSummaryStore.exportedSnapshots()
            try UsageFolderSnapshotIO.writeSnapshot(
                days: days,
                directoryURL: directoryURL,
                deviceId: deviceId
            )
            let remoteSnapshots = try UsageFolderSnapshotIO.listSnapshots(in: directoryURL)
            for remote in remoteSnapshots where remote.deviceID != deviceId {
                usageSummaryStore.importSnapshots(remote.days)
            }
        } catch {
            VoxtLog.historyWarning("Usage folder sync failed: \(error.localizedDescription)")
        }
    }

    /// Writes local settings snapshot and merges remote device files. Failures only log warnings.
    private func syncAppSettings(directoryURL: URL) {
        do {
            try AppSettingsSyncSnapshotIO.syncAppSettings(
                directoryURL: directoryURL,
                deviceId: deviceId,
                defaults: defaults
            )
        } catch {
            VoxtLog.historyWarning("App settings folder sync failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Snapshot IO

    nonisolated static func snapshotFileName(deviceId: String) -> String {
        "\(snapshotFilePrefix)\(deviceId)\(snapshotFileSuffix)"
    }

    nonisolated static func writeSnapshot(content: String, directoryURL: URL, deviceId: String) throws {
        let fileURL = directoryURL.appendingPathComponent(snapshotFileName(deviceId: deviceId), isDirectory: false)
        let tempURL = directoryURL.appendingPathComponent(
            "\(snapshotFileName(deviceId: deviceId)).tmp",
            isDirectory: false
        )
        if FileManager.default.fileExists(atPath: tempURL.path) {
            try FileManager.default.removeItem(at: tempURL)
        }
        try content.write(to: tempURL, atomically: true, encoding: .utf8)
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
        try FileManager.default.moveItem(at: tempURL, to: fileURL)
    }

    nonisolated static func listSnapshots(in directoryURL: URL) throws -> [(deviceId: String, path: String, content: String)] {
        let contents = try FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        var snapshots: [(deviceId: String, path: String, content: String)] = []
        for fileURL in contents {
            let name = fileURL.lastPathComponent
            guard name.hasPrefix(snapshotFilePrefix),
                  name.hasSuffix(snapshotFileSuffix),
                  !name.hasSuffix(".tmp") else { continue }
            let devicePart = String(
                name.dropFirst(snapshotFilePrefix.count).dropLast(snapshotFileSuffix.count)
            )
            guard !devicePart.isEmpty else { continue }
            let content = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
            snapshots.append((devicePart, fileURL.path, content))
        }
        return snapshots
    }

    // MARK: - CSV

    nonisolated static func escapeCSVField(_ value: String) -> String {
        if value.rangeOfCharacter(from: CharacterSet(charactersIn: "\",\r\n")) != nil {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }

    nonisolated static func parseCSVLine(_ line: String) -> [String] {
        var fields: [String] = []
        var current = ""
        var inQuotes = false
        let chars = Array(line)
        var index = 0
        while index < chars.count {
            let ch = chars[index]
            if inQuotes {
                if ch == "\"" {
                    if index + 1 < chars.count, chars[index + 1] == "\"" {
                        current.append("\"")
                        index += 1
                    } else {
                        inQuotes = false
                    }
                } else {
                    current.append(ch)
                }
            } else if ch == "\"" {
                inQuotes = true
            } else if ch == "," {
                fields.append(current)
                current = ""
            } else {
                current.append(ch)
            }
            index += 1
        }
        fields.append(current)
        return fields
    }

    nonisolated static func serializeCSV(_ entries: [DictionarySyncSnapshotEntry]) -> String {
        var lines = [csvHeader]
        for entry in entries {
            lines.append(
                [
                    escapeCSVField(entry.id),
                    escapeCSVField(entry.term),
                    String(entry.weight),
                    escapeCSVField(entry.source),
                    escapeCSVField(entry.createdAt)
                ].joined(separator: ",")
            )
        }
        return lines.joined(separator: "\n") + "\n"
    }

    nonisolated static func parseCSV(_ content: String) -> [DictionarySyncSnapshotEntry] {
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\u{FEFF}", with: "")
        guard !normalized.isEmpty else { return [] }
        let lines = normalized.split(whereSeparator: \.isNewline).map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !lines.isEmpty else { return [] }

        let firstFields = parseCSVLine(lines[0]).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let startIndex = firstFields.joined(separator: ",") == csvHeader ? 1 : 0

        var entries: [DictionarySyncSnapshotEntry] = []
        for line in lines.dropFirst(startIndex) {
            let fields = parseCSVLine(line)
            guard fields.count >= 5 else { continue }
            let id = fields[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let term = fields[1].trimmingCharacters(in: .whitespacesAndNewlines)
            let weightRaw = fields[2].trimmingCharacters(in: .whitespacesAndNewlines)
            let source = fields[3].trimmingCharacters(in: .whitespacesAndNewlines)
            let createdAt = fields[4].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, !term.isEmpty, !createdAt.isEmpty else { continue }
            guard source == "manual" || source == "ai" || source == "auto" || source == "codex" || source == "claude" else {
                continue
            }
            let weight = Int(weightRaw) ?? 1
            entries.append(
                DictionarySyncSnapshotEntry(
                    id: id,
                    term: term,
                    weight: weight > 0 ? weight : 1,
                    source: source,
                    createdAt: createdAt
                )
            )
        }
        return entries
    }

    // MARK: - Merge (SayIt rules)

    nonisolated static func normalizeTermKey(_ term: String) -> String {
        term.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    nonisolated static func sourceRank(_ source: String) -> Int {
        source == "manual" ? 2 : 1
    }

    nonisolated static func mergeSnapshots(
        _ snapshotList: [(deviceId: String, entries: [DictionarySyncSnapshotEntry])]
    ) -> [DictionarySyncSnapshotEntry] {
        struct Candidate {
            var entry: DictionarySyncSnapshotEntry
            var deviceId: String
        }

        var byTerm: [String: Candidate] = [:]
        for snapshot in snapshotList {
            for entry in snapshot.entries {
                let key = normalizeTermKey(entry.term)
                guard !key.isEmpty else { continue }
                let incoming = Candidate(
                    entry: DictionarySyncSnapshotEntry(
                        id: entry.id,
                        term: entry.term.trimmingCharacters(in: .whitespacesAndNewlines),
                        weight: max(1, entry.weight),
                        source: entry.source,
                        createdAt: entry.createdAt
                    ),
                    deviceId: snapshot.deviceId
                )
                guard let existing = byTerm[key] else {
                    byTerm[key] = incoming
                    continue
                }

                let weight = max(existing.entry.weight, incoming.entry.weight)
                let source = sourceRank(existing.entry.source) >= sourceRank(incoming.entry.source)
                    ? existing.entry.source
                    : incoming.entry.source
                let createdCmp = incoming.entry.createdAt.compare(existing.entry.createdAt)
                let deviceCmp = incoming.deviceId.compare(existing.deviceId)
                let preferIncoming = createdCmp == .orderedDescending
                    || (createdCmp == .orderedSame && deviceCmp == .orderedDescending)
                let winner = preferIncoming ? incoming : existing
                byTerm[key] = Candidate(
                    entry: DictionarySyncSnapshotEntry(
                        id: winner.entry.id,
                        term: winner.entry.term,
                        weight: weight,
                        source: source,
                        createdAt: winner.entry.createdAt
                    ),
                    deviceId: winner.deviceId
                )
            }
        }
        return sortSnapshotEntries(Array(byTerm.values.map(\.entry)))
    }

    nonisolated static func sortSnapshotEntries(_ entries: [DictionarySyncSnapshotEntry]) -> [DictionarySyncSnapshotEntry] {
        entries.sorted { lhs, rhs in
            if lhs.weight != rhs.weight { return lhs.weight > rhs.weight }
            return lhs.createdAt > rhs.createdAt
        }
    }

    // MARK: - Mapping

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoFormatterFallback: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func snapshotEntry(from entry: DictionaryEntry) -> DictionarySyncSnapshotEntry {
        let source: String
        switch entry.source {
        case .manual:
            source = "manual"
        case .auto, .codex, .claude:
            // SayIt only has manual|ai; map non-manual to ai for interoperability.
            source = "ai"
        }
        return DictionarySyncSnapshotEntry(
            id: entry.id.uuidString.lowercased(),
            term: entry.term,
            weight: max(1, entry.matchCount),
            source: source,
            createdAt: isoFormatter.string(from: entry.createdAt)
        )
    }

    static func dictionaryEntry(from snapshot: DictionarySyncSnapshotEntry) -> DictionaryEntry {
        let id = UUID(uuidString: snapshot.id) ?? UUID()
        let source: DictionaryEntrySource = snapshot.source == "manual" ? .manual : .auto
        let createdAt = isoFormatter.date(from: snapshot.createdAt)
            ?? isoFormatterFallback.date(from: snapshot.createdAt)
            ?? Date()
        let term = snapshot.term.trimmingCharacters(in: .whitespacesAndNewlines)
        return DictionaryEntry(
            id: id,
            term: term,
            normalizedTerm: DictionaryStore.normalizeTerm(term),
            categoryID: DictionaryCategory.defaultID,
            categoryNameSnapshot: DictionaryCategory.defaultName,
            source: source,
            createdAt: createdAt,
            updatedAt: createdAt,
            matchCount: max(0, snapshot.weight)
        )
    }
}

private enum DictionaryFolderSyncError: LocalizedError {
    case folderUnavailable

    var errorDescription: String? {
        switch self {
        case .folderUnavailable:
            return AppLocalization.localizedString("Sync folder is unavailable")
        }
    }
}
