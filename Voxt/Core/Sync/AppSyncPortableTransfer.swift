// AppSyncPortableTransfer.swift
// Portable import/export for unified JSON package, legacy folder snapshots, and ZIP archives.
// Directory/ZIP import never writes the sync-folder bookmark.

import Foundation

/// How a portable import source was resolved.
enum AppSyncPortableImportSourceKind: String, Equatable, Sendable {
    case jsonPackage
    case directoryPackage
    case directoryLegacy
    case zipPackage
    case zipLegacy
}

/// Result of a portable URL-based import (extends package counts with source kind).
struct AppSyncPortableImportResult: Equatable, Sendable {
    var sourceKind: AppSyncPortableImportSourceKind
    var settingsApplied: Int
    var usageDaysImported: Int
    var dictionaryAdded: Int
    var dictionarySkipped: Int

    var packageResult: AppSyncPackageImportResult {
        AppSyncPackageImportResult(
            settingsApplied: settingsApplied,
            usageDaysImported: usageDaysImported,
            dictionaryAdded: dictionaryAdded,
            dictionarySkipped: dictionarySkipped
        )
    }

    init(
        sourceKind: AppSyncPortableImportSourceKind,
        settingsApplied: Int,
        usageDaysImported: Int,
        dictionaryAdded: Int,
        dictionarySkipped: Int
    ) {
        self.sourceKind = sourceKind
        self.settingsApplied = settingsApplied
        self.usageDaysImported = usageDaysImported
        self.dictionaryAdded = dictionaryAdded
        self.dictionarySkipped = dictionarySkipped
    }

    init(sourceKind: AppSyncPortableImportSourceKind, package: AppSyncPackageImportResult) {
        self.sourceKind = sourceKind
        self.settingsApplied = package.settingsApplied
        self.usageDaysImported = package.usageDaysImported
        self.dictionaryAdded = package.dictionaryAdded
        self.dictionarySkipped = package.dictionarySkipped
    }
}

/// Errors from portable transfer (JSON / directory / ZIP).
enum AppSyncPortableTransferError: LocalizedError, Equatable {
    case pathNotFound
    case invalidPackage
    case unsupportedVersion(Int)
    case noImportableContent
    case zip(AppSyncZipSupportError)
    case package(AppSyncPackageTransferError)

    var errorDescription: String? {
        switch self {
        case .pathNotFound:
            return AppLocalization.localizedString("Import path not found.")
        case .invalidPackage:
            return AppLocalization.localizedString("Invalid sync package.")
        case .unsupportedVersion(let version):
            return AppLocalization.format(
                "Unsupported sync package version: %d",
                version
            )
        case .noImportableContent:
            return AppLocalization.localizedString("No importable SayIt profile content found.")
        case .zip(let error):
            return error.errorDescription
        case .package(let error):
            return error.errorDescription
        }
    }
}

/// Builds portable ZIP exports and imports from JSON, folders, or ZIP archives.
enum AppSyncPortableTransfer {
    /// Default file name for the unified package inside a portable ZIP.
    nonisolated static let packageFileName = "SayIt-Profile.json"

    // MARK: - Export ZIP

    /// Writes a standard ZIP whose root contains only the unified JSON package.
    @MainActor
    static func exportPortableZip(
        to destinationURL: URL,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults = .standard,
        deviceID: String,
        exportedAt: Date = Date()
    ) throws {
        let packageData = try AppSyncPackageTransfer.exportPackage(
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageSummaryStore,
            defaults: defaults,
            deviceID: deviceID,
            exportedAt: exportedAt
        )
        do {
            try AppSyncZipSupport.createZip(
                at: destinationURL,
                rootFiles: [(name: packageFileName, data: packageData)]
            )
        } catch let error as AppSyncZipSupportError {
            throw AppSyncPortableTransferError.zip(error)
        }
    }

    // MARK: - Import

    /// Imports from a single JSON package file, a directory, or a ZIP archive.
    /// Directory import never sets the dictionary sync folder bookmark.
    @MainActor
    static func importPortable(
        from url: URL,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults = .standard
    ) throws -> AppSyncPortableImportResult {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            throw AppSyncPortableTransferError.pathNotFound
        }

        if isDirectory.boolValue {
            return try importFromDirectory(
                url,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: usageSummaryStore,
                defaults: defaults,
                sourceKindPackage: .directoryPackage,
                sourceKindLegacy: .directoryLegacy
            )
        }

        let ext = url.pathExtension.lowercased()
        if ext == "zip" {
            return try importFromZip(
                url,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: usageSummaryStore,
                defaults: defaults
            )
        }

        // Single-file JSON package (or any non-zip file treated as package bytes).
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw AppSyncPortableTransferError.pathNotFound
        }
        do {
            let package = try AppSyncPackageTransfer.importPackage(
                data: data,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: usageSummaryStore,
                defaults: defaults
            )
            return AppSyncPortableImportResult(sourceKind: .jsonPackage, package: package)
        } catch let error as AppSyncPackageTransferError {
            throw mapPackageError(error)
        }
    }

    // MARK: - ZIP import

    @MainActor
    private static func importFromZip(
        _ zipURL: URL,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults
    ) throws -> AppSyncPortableImportResult {
        let extractRoot: URL
        do {
            extractRoot = try AppSyncZipSupport.extractToTemporaryDirectory(zipURL: zipURL)
        } catch let error as AppSyncZipSupportError {
            throw AppSyncPortableTransferError.zip(error)
        } catch {
            throw AppSyncPortableTransferError.zip(.extractFailed(error.localizedDescription))
        }
        defer { try? FileManager.default.removeItem(at: extractRoot) }

        return try importFromDirectory(
            extractRoot,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageSummaryStore,
            defaults: defaults,
            sourceKindPackage: .zipPackage,
            sourceKindLegacy: .zipLegacy
        )
    }

    // MARK: - Directory import

    /// Prefer a single valid `AppSyncPackageEnvelope` JSON in the directory (or one level deep).
    /// Otherwise merge legacy `sayit-settings-*` / `sayit-usage-*` / `sayit-vocabulary-*` snapshots.
    /// Never writes `dictionarySyncDirectoryBookmark` / path.
    @MainActor
    private static func importFromDirectory(
        _ directoryURL: URL,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults,
        sourceKindPackage: AppSyncPortableImportSourceKind,
        sourceKindLegacy: AppSyncPortableImportSourceKind
    ) throws -> AppSyncPortableImportResult {
        // Snapshot bookmark keys so we can assert we never mutate them (and restore if something did).
        let bookmarkBefore = defaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
        let pathBefore = defaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath)

        defer {
            // Hard guarantee: portable directory/ZIP import never sets sync folder bookmark.
            let bookmarkAfter = defaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
            let pathAfter = defaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath)
            if bookmarkAfter != bookmarkBefore {
                if let bookmarkBefore {
                    defaults.set(bookmarkBefore, forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
                } else {
                    defaults.removeObject(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
                }
            }
            if pathAfter != pathBefore {
                if let pathBefore {
                    defaults.set(pathBefore, forKey: AppPreferenceKey.dictionarySyncDirectoryPath)
                } else {
                    defaults.removeObject(forKey: AppPreferenceKey.dictionarySyncDirectoryPath)
                }
            }
        }

        if let packageData = try findPackageJSONData(in: directoryURL) {
            do {
                let package = try AppSyncPackageTransfer.importPackage(
                    data: packageData,
                    dictionaryStore: dictionaryStore,
                    usageSummaryStore: usageSummaryStore,
                    defaults: defaults
                )
                return AppSyncPortableImportResult(sourceKind: sourceKindPackage, package: package)
            } catch let error as AppSyncPackageTransferError {
                throw mapPackageError(error)
            }
        }

        let legacy = try importLegacySnapshots(
            from: directoryURL,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageSummaryStore,
            defaults: defaults
        )
        guard legacy.settingsApplied > 0
                || legacy.usageDaysImported > 0
                || legacy.dictionaryAdded > 0
                || legacy.dictionarySkipped > 0
                || legacy.hadAnySnapshot else {
            throw AppSyncPortableTransferError.noImportableContent
        }
        return AppSyncPortableImportResult(
            sourceKind: sourceKindLegacy,
            settingsApplied: legacy.settingsApplied,
            usageDaysImported: legacy.usageDaysImported,
            dictionaryAdded: legacy.dictionaryAdded,
            dictionarySkipped: legacy.dictionarySkipped
        )
    }

    // MARK: - Package discovery

    /// Finds the first valid package envelope JSON in the directory (shallow, then one level deep).
    nonisolated private static func findPackageJSONData(in directoryURL: URL) throws -> Data? {
        let fileManager = FileManager.default
        let decoder = AppSyncJSONCoding.makeDecoder()

        func isValidPackage(_ data: Data) -> Bool {
            guard let envelope = try? decoder.decode(AppSyncPackageEnvelope.self, from: data) else {
                return false
            }
            return envelope.version == AppSyncPackageTransfer.packageVersion
        }

        func candidateJSONFiles(in dir: URL) -> [URL] {
            let contents = (try? fileManager.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey],
                options: [.skipsHiddenFiles]
            )) ?? []
            return contents.filter { url in
                var isDir: ObjCBool = false
                guard fileManager.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else {
                    return false
                }
                let name = url.lastPathComponent.lowercased()
                // Skip known legacy snapshot names.
                if name.hasPrefix(AppSettingsSyncSnapshotIO.filePrefix.lowercased()) { return false }
                if name.hasPrefix(UsageFolderSnapshotIO.filePrefix.lowercased()) { return false }
                if name.hasPrefix(DictionaryCloudSyncService.snapshotFilePrefix.lowercased()) { return false }
                return name.hasSuffix(".json")
            }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        }

        // Prefer root-level JSON package files.
        for fileURL in candidateJSONFiles(in: directoryURL) {
            guard let data = try? Data(contentsOf: fileURL), isValidPackage(data) else { continue }
            return data
        }

        // One level of subdirectories (ZIP may nest a single folder).
        let children = (try? fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        for child in children.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            var isDir: ObjCBool = false
            guard fileManager.fileExists(atPath: child.path, isDirectory: &isDir), isDir.boolValue else {
                continue
            }
            for fileURL in candidateJSONFiles(in: child) {
                guard let data = try? Data(contentsOf: fileURL), isValidPackage(data) else { continue }
                return data
            }
            // Also accept legacy snapshots nested one level down by treating that dir as root later.
        }
        return nil
    }

    // MARK: - Legacy folder snapshots

    private struct LegacyImportCounts {
        var settingsApplied: Int
        var usageDaysImported: Int
        var dictionaryAdded: Int
        var dictionarySkipped: Int
        var hadAnySnapshot: Bool
    }

    /// Merges legacy multi-device snapshots from a directory using existing list/normalize/merge APIs.
    @MainActor
    private static func importLegacySnapshots(
        from directoryURL: URL,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults
    ) throws -> LegacyImportCounts {
        // Prefer scanning the directory itself; if empty of legacy files, try a single nested folder.
        let scanURL = try resolveLegacyScanDirectory(directoryURL)

        var hadAny = false

        // Settings: list → normalize (inside list) → LWW merge with local collect → apply package winners only.
        let settingsApplied = try importLegacySettings(from: scanURL, defaults: defaults, hadAny: &hadAny)

        // Usage: list all device files; importSnapshots preserves (day, deviceID) LWW.
        let usageDaysImported = try importLegacyUsage(
            from: scanURL,
            usageSummaryStore: usageSummaryStore,
            hadAny: &hadAny
        )

        // Dictionary: list CSVs → mergeSnapshots → applyRemoteSync (preserves id/weight/source).
        let dictionaryResult = try importLegacyDictionary(
            from: scanURL,
            dictionaryStore: dictionaryStore,
            hadAny: &hadAny
        )

        return LegacyImportCounts(
            settingsApplied: settingsApplied,
            usageDaysImported: usageDaysImported,
            dictionaryAdded: dictionaryResult.added,
            dictionarySkipped: dictionaryResult.skipped,
            hadAnySnapshot: hadAny
        )
    }

    nonisolated private static func resolveLegacyScanDirectory(_ directoryURL: URL) throws -> URL {
        if directoryContainsLegacySnapshots(directoryURL) {
            return directoryURL
        }
        let children = (try? FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        let subdirs = children.filter { url in
            var isDir: ObjCBool = false
            return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
        }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        if subdirs.count == 1, directoryContainsLegacySnapshots(subdirs[0]) {
            return subdirs[0]
        }
        return directoryURL
    }

    nonisolated private static func directoryContainsLegacySnapshots(_ directoryURL: URL) -> Bool {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? []
        for url in contents {
            let name = url.lastPathComponent
            if name.hasPrefix(AppSettingsSyncSnapshotIO.filePrefix),
               name.hasSuffix(AppSettingsSyncSnapshotIO.fileSuffix),
               !name.hasSuffix(".tmp") {
                return true
            }
            if name.hasPrefix(UsageFolderSnapshotIO.filePrefix),
               name.hasSuffix(UsageFolderSnapshotIO.fileSuffix),
               !name.hasSuffix(".tmp") {
                return true
            }
            if name.hasPrefix(DictionaryCloudSyncService.snapshotFilePrefix),
               name.hasSuffix(DictionaryCloudSyncService.snapshotFileSuffix),
               !name.hasSuffix(".tmp") {
                return true
            }
        }
        return false
    }

    @MainActor
    private static func importLegacySettings(
        from directoryURL: URL,
        defaults: UserDefaults,
        hadAny: inout Bool
    ) throws -> Int {
        let remoteSnapshots = try AppSettingsSyncSnapshotIO.listSnapshots(in: directoryURL)
        guard !remoteSnapshots.isEmpty else { return 0 }
        hadAny = true

        // Same LWW path as AppSyncPackageTransfer: local collect-for-merge + remotes.
        let localFields = AppSettingsSyncSnapshotIO.collectFieldsForMerge(defaults: defaults)
        let localEnvelope = AppSettingsSyncSnapshotIO.Envelope(
            version: AppSettingsSyncSnapshotIO.envelopeVersion,
            deviceID: "local",
            exportedAt: Date(timeIntervalSince1970: 0),
            fields: localFields
        )
        let merged = AppSettingsSyncSnapshotIO.mergeFields(
            snapshots: [localEnvelope] + remoteSnapshots
        )

        // Only apply remote winners (fields that match some remote snapshot field).
        var remoteByKey: [String: AppSettingsSyncSnapshotIO.AppSettingsSyncField] = [:]
        for snapshot in remoteSnapshots {
            for field in snapshot.fields {
                // Keep the field as listed after normalize; if multiple remotes, prefer merge winner source later.
                if remoteByKey[field.key] == nil {
                    remoteByKey[field.key] = field
                } else if let existing = remoteByKey[field.key] {
                    // Prefer newer remote field metadata when collecting candidates.
                    if field.updatedAt > existing.updatedAt {
                        remoteByKey[field.key] = field
                    }
                }
            }
        }

        var remoteWinners: [String: AppSettingsSyncSnapshotIO.AppSettingsSyncField] = [:]
        for (key, remoteField) in remoteByKey {
            guard let winner = merged[key] else { continue }
            // Accept winner if it matches any remote snapshot field for this key.
            let isRemoteWinner = remoteSnapshots.contains { snapshot in
                snapshot.fields.contains { field in
                    field.key == key
                        && field.value == winner.value
                        && field.revision == winner.revision
                        && abs(
                            field.updatedAt.timeIntervalSince1970
                                - winner.updatedAt.timeIntervalSince1970
                        ) < 0.001
                }
            }
            // Fallback: compare against aggregated remote field if exact match on value/revision/time.
            let matchesAggregated = winner.value == remoteField.value
                && winner.revision == remoteField.revision
                && abs(
                    winner.updatedAt.timeIntervalSince1970
                        - remoteField.updatedAt.timeIntervalSince1970
                ) < 0.001
            if isRemoteWinner || matchesAggregated {
                remoteWinners[key] = winner
            }
        }

        if !remoteWinners.isEmpty {
            AppSettingsSyncSnapshotIO.applyMergedFields(remoteWinners, to: defaults)
        }
        return remoteWinners.count
    }

    @MainActor
    private static func importLegacyUsage(
        from directoryURL: URL,
        usageSummaryStore: UsageDaySummaryStore?,
        hadAny: inout Bool
    ) throws -> Int {
        let remoteSnapshots = try UsageFolderSnapshotIO.listSnapshots(in: directoryURL)
        guard !remoteSnapshots.isEmpty else { return 0 }
        hadAny = true
        guard let usageSummaryStore else {
            return remoteSnapshots.reduce(0) { $0 + $1.days.count }
        }
        var imported = 0
        for remote in remoteSnapshots {
            // importSnapshots keeps per-(day, deviceID) LWW rows.
            usageSummaryStore.importSnapshots(remote.days)
            imported += remote.days.count
        }
        return imported
    }

    @MainActor
    private static func importLegacyDictionary(
        from directoryURL: URL,
        dictionaryStore: DictionaryStore,
        hadAny: inout Bool
    ) throws -> (added: Int, skipped: Int) {
        let snapshots = try DictionaryCloudSyncService.listSnapshots(in: directoryURL)
        guard !snapshots.isEmpty else { return (0, 0) }
        hadAny = true

        let parsed: [(deviceId: String, entries: [DictionarySyncSnapshotEntry])] = snapshots.map {
            ($0.deviceId, DictionaryCloudSyncService.parseCSV($0.content))
        }
        // Include local as a merge peer so existing terms keep max weight / source rules.
        let localSnapshotEntries = dictionaryStore.entries.map(DictionaryCloudSyncService.snapshotEntry(from:))
        let localDeviceID = "local"
        let merged = DictionaryCloudSyncService.mergeSnapshots(
            parsed + [(localDeviceID, localSnapshotEntries)]
        )

        let beforeIDs = Set(dictionaryStore.entries.map(\.id))
        let beforeByTerm = Dictionary(
            uniqueKeysWithValues: dictionaryStore.entries.map {
                (DictionaryCloudSyncService.normalizeTermKey($0.term), $0)
            }
        )

        let remoteEntries = merged.map { DictionaryCloudSyncService.dictionaryEntry(from: $0) }
        dictionaryStore.applyRemoteSync(
            entries: remoteEntries,
            categories: [],
            deletedEntryIDs: [],
            deletedCategoryIDs: []
        )

        let afterIDs = Set(dictionaryStore.entries.map(\.id))
        let added = afterIDs.subtracting(beforeIDs).count
        // Terms that already existed by normalized term are "skipped" (merged, not newly added).
        var skipped = 0
        for entry in merged {
            let key = DictionaryCloudSyncService.normalizeTermKey(entry.term)
            if beforeByTerm[key] != nil {
                skipped += 1
            }
        }
        return (added, skipped)
    }

    // MARK: - Error mapping

    nonisolated private static func mapPackageError(
        _ error: AppSyncPackageTransferError
    ) -> AppSyncPortableTransferError {
        switch error {
        case .invalidPackage:
            return .invalidPackage
        case .unsupportedVersion(let version):
            return .unsupportedVersion(version)
        }
    }
}
