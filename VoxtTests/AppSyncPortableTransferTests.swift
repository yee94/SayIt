// AppSyncPortableTransferTests.swift
// Offline tests for portable import/export (JSON, legacy folder, ZIP).

import XCTest
@testable import Voxt

@MainActor
final class AppSyncPortableTransferTests: XCTestCase {
    private static var retainedObjects: [AnyObject] = []
    private var temporaryURLs: [URL] = []
    private var suiteNames: [String] = []

    override func tearDownWithError() throws {
        for name in suiteNames {
            UserDefaults(suiteName: name)?.removePersistentDomain(forName: name)
        }
        suiteNames = []
        // Keep temp dirs while retained DB connections may still be open (process exit cleans up).
        temporaryURLs = []
        try super.tearDownWithError()
    }

    // MARK: - JSON file

    func testImportPortableJSONPackageAppliesSettingsAndDictionary() throws {
        let sourceDefaults = makeEphemeralDefaults()
        sourceDefaults.set("ja", forKey: AppPreferenceKey.interfaceLanguage)
        let sourceDictionary = makeDictionaryStore(defaults: sourceDefaults)
        try sourceDictionary.createManualEntry(
            term: "PortableJSONTerm",
            groupID: nil,
            groupNameSnapshot: nil
        )

        let packageData = try AppSyncPackageTransfer.exportPackage(
            dictionaryStore: sourceDictionary,
            usageSummaryStore: nil,
            defaults: sourceDefaults,
            deviceID: "json-export-device",
            exportedAt: Date(timeIntervalSince1970: 1_710_000_000)
        )
        let jsonURL = try makeTemporaryDirectory()
            .appendingPathComponent("profile.json", isDirectory: false)
        try packageData.write(to: jsonURL)

        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)

        let result = try AppSyncPortableTransfer.importPortable(
            from: jsonURL,
            dictionaryStore: targetDictionary,
            usageSummaryStore: nil,
            defaults: targetDefaults
        )

        XCTAssertEqual(result.sourceKind, .jsonPackage)
        XCTAssertGreaterThan(result.settingsApplied, 0)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
        XCTAssertTrue(targetDictionary.entries.contains { $0.term == "PortableJSONTerm" })
        XCTAssertEqual(result.dictionaryAdded, 1)
    }

    // MARK: - Legacy folder

    func testImportPortableLegacyFolderMergesSettingsUsageAndVocabulary() throws {
        let folder = try makeTemporaryDirectory()

        // Settings snapshot (remote device wins over never-baselined local).
        let settingsAt = Date(timeIntervalSince1970: 1_710_100_000)
        let settingsFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                ),
                updatedAt: settingsAt,
                revision: 2
            ),
        ]
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: settingsFields,
            directoryURL: folder,
            deviceId: "legacy-settings-device",
            exportedAt: settingsAt
        )

        // Usage snapshot.
        let usageDay = UsageDailySnapshot(
            day: "2024-03-01",
            deviceID: "legacy-usage-device",
            dictationSeconds: 10,
            characters: 33,
            translationCharacters: 0,
            sessionCount: 1,
            apps: [:],
            updatedAt: settingsAt
        )
        try UsageFolderSnapshotIO.writeSnapshot(
            days: [usageDay],
            directoryURL: folder,
            deviceId: "legacy-usage-device"
        )

        // Vocabulary CSV with stable id/weight/source.
        let entryID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        let csv = DictionaryCloudSyncService.serializeCSV([
            DictionarySyncSnapshotEntry(
                id: entryID,
                term: "LegacyVocabTerm",
                weight: 9,
                source: "manual",
                createdAt: "2024-03-01T12:00:00.000Z"
            ),
        ])
        try DictionaryCloudSyncService.writeSnapshot(
            content: csv,
            directoryURL: folder,
            deviceId: "legacy-vocab-device"
        )

        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        // Pre-seed a bookmark that must remain untouched.
        let bookmarkSeed = Data("seed-bookmark".utf8)
        targetDefaults.set(bookmarkSeed, forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
        targetDefaults.set("/old/sync/path", forKey: AppPreferenceKey.dictionarySyncDirectoryPath)

        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)
        let sharedDatabase = try makeDatabase()
        let usageStore = retain(
            UsageDaySummaryStore(
                database: sharedDatabase,
                defaults: targetDefaults,
                deviceID: "target-device"
            )
        )

        let result = try AppSyncPortableTransfer.importPortable(
            from: folder,
            dictionaryStore: targetDictionary,
            usageSummaryStore: usageStore,
            defaults: targetDefaults
        )

        XCTAssertEqual(result.sourceKind, .directoryLegacy)
        XCTAssertEqual(result.settingsApplied, 1)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")
        XCTAssertEqual(result.usageDaysImported, 1)

        // Per-(day, deviceID) rows: open a store scoped to the imported device on the same DB.
        let remoteUsage = retain(
            UsageDaySummaryStore(
                database: sharedDatabase,
                defaults: targetDefaults,
                deviceID: "legacy-usage-device"
            )
        )
        let snap = try XCTUnwrap(remoteUsage.snapshot(day: "2024-03-01"))
        XCTAssertEqual(snap.characters, 33)
        XCTAssertEqual(snap.deviceID, "legacy-usage-device")

        // Dictionary fidelity: id, weight (matchCount), source preserved.
        let imported = try XCTUnwrap(targetDictionary.entries.first { $0.term == "LegacyVocabTerm" })
        XCTAssertEqual(imported.id.uuidString.lowercased(), entryID)
        XCTAssertEqual(imported.matchCount, 9)
        XCTAssertEqual(imported.source, .manual)
        XCTAssertEqual(result.dictionaryAdded, 1)

        // Folder import must not change sync bookmark/path.
        XCTAssertEqual(
            targetDefaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark),
            bookmarkSeed
        )
        XCTAssertEqual(
            targetDefaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath),
            "/old/sync/path"
        )
    }

    func testImportPortableLegacyFolderDoesNotSetBookmarkWhenAbsent() throws {
        let folder = try makeTemporaryDirectory()
        let settingsAt = Date(timeIntervalSince1970: 1_710_200_000)
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.launchAtLogin,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                    ),
                    updatedAt: settingsAt,
                    revision: 1
                ),
            ],
            directoryURL: folder,
            deviceId: "no-bookmark-device",
            exportedAt: settingsAt
        )

        let defaults = makeEphemeralDefaults()
        XCTAssertNil(defaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark))
        XCTAssertNil(defaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath))

        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        _ = try AppSyncPortableTransfer.importPortable(
            from: folder,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertNil(defaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark))
        XCTAssertNil(defaults.string(forKey: AppPreferenceKey.dictionarySyncDirectoryPath))
        XCTAssertEqual(defaults.bool(forKey: AppPreferenceKey.launchAtLogin), true)
    }

    func testImportPortableLegacyMultiDeviceSettingsLWW() throws {
        let folder = try makeTemporaryDirectory()

        let olderAt = Date(timeIntervalSince1970: 1_710_300_000)
        let newerAt = Date(timeIntervalSince1970: 1_710_400_000)

        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                    ),
                    updatedAt: olderAt,
                    revision: 1
                ),
            ],
            directoryURL: folder,
            deviceId: "device-older",
            exportedAt: olderAt
        )
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("ja"))
                    ),
                    updatedAt: newerAt,
                    revision: 5
                ),
            ],
            directoryURL: folder,
            deviceId: "device-newer",
            exportedAt: newerAt
        )

        let defaults = makeEphemeralDefaults()
        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        // Never baselined local → package/remote timestamps win.
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        let result = try AppSyncPortableTransfer.importPortable(
            from: folder,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertEqual(result.sourceKind, .directoryLegacy)
        XCTAssertEqual(result.settingsApplied, 1)
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
    }

    func testImportPortableDirectoryPrefersPackageJSONOverLegacy() throws {
        let folder = try makeTemporaryDirectory()

        // Legacy would set zh-Hans.
        let legacyAt = Date(timeIntervalSince1970: 1_710_500_000)
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                    ),
                    updatedAt: legacyAt,
                    revision: 9
                ),
            ],
            directoryURL: folder,
            deviceId: "legacy-device",
            exportedAt: legacyAt
        )

        // Package sets ja — should win as preferred source.
        let packageDefaults = makeEphemeralDefaults()
        packageDefaults.set("ja", forKey: AppPreferenceKey.interfaceLanguage)
        let packageDictionary = makeDictionaryStore(defaults: packageDefaults)
        let packageData = try AppSyncPackageTransfer.exportPackage(
            dictionaryStore: packageDictionary,
            usageSummaryStore: nil,
            defaults: packageDefaults,
            deviceID: "pkg-device",
            exportedAt: Date(timeIntervalSince1970: 1_710_500_100)
        )
        try packageData.write(
            to: folder.appendingPathComponent("SayIt-Profile.json", isDirectory: false)
        )

        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)

        let result = try AppSyncPortableTransfer.importPortable(
            from: folder,
            dictionaryStore: targetDictionary,
            usageSummaryStore: nil,
            defaults: targetDefaults
        )

        XCTAssertEqual(result.sourceKind, .directoryPackage)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
    }

    // MARK: - ZIP package

    func testImportPortableZipJSONPackage() throws {
        let sourceDefaults = makeEphemeralDefaults()
        sourceDefaults.set("ja", forKey: AppPreferenceKey.interfaceLanguage)
        let sourceDictionary = makeDictionaryStore(defaults: sourceDefaults)
        try sourceDictionary.createManualEntry(
            term: "ZipPackageTerm",
            groupID: nil,
            groupNameSnapshot: nil
        )

        let zipURL = try makeTemporaryDirectory()
            .appendingPathComponent("profile.zip", isDirectory: false)
        try AppSyncPortableTransfer.exportPortableZip(
            to: zipURL,
            dictionaryStore: sourceDictionary,
            usageSummaryStore: nil,
            defaults: sourceDefaults,
            deviceID: "zip-export-device",
            exportedAt: Date(timeIntervalSince1970: 1_710_600_000)
        )

        // ZIP root should list only the package JSON.
        let entries = try AppSyncZipSupport.listEntries(in: zipURL)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0], AppSyncPortableTransfer.packageFileName)

        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let bookmarkSeed = Data("zip-bookmark".utf8)
        targetDefaults.set(bookmarkSeed, forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark)
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)

        let result = try AppSyncPortableTransfer.importPortable(
            from: zipURL,
            dictionaryStore: targetDictionary,
            usageSummaryStore: nil,
            defaults: targetDefaults
        )

        XCTAssertEqual(result.sourceKind, .zipPackage)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
        XCTAssertTrue(targetDictionary.entries.contains { $0.term == "ZipPackageTerm" })
        XCTAssertEqual(
            targetDefaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark),
            bookmarkSeed
        )
    }

    func testImportPortableZipLegacySnapshots() throws {
        let staging = try makeTemporaryDirectory()
        let settingsAt = Date(timeIntervalSince1970: 1_710_700_000)
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                    ),
                    updatedAt: settingsAt,
                    revision: 3
                ),
            ],
            directoryURL: staging,
            deviceId: "zip-legacy-device",
            exportedAt: settingsAt
        )
        let csv = DictionaryCloudSyncService.serializeCSV([
            DictionarySyncSnapshotEntry(
                id: "11111111-2222-3333-4444-555555555555",
                term: "ZipLegacyTerm",
                weight: 4,
                source: "ai",
                createdAt: "2024-04-01T00:00:00.000Z"
            ),
        ])
        try DictionaryCloudSyncService.writeSnapshot(
            content: csv,
            directoryURL: staging,
            deviceId: "zip-legacy-vocab"
        )

        let zipURL = try makeTemporaryDirectory()
            .appendingPathComponent("legacy.zip", isDirectory: false)
        try createZipFromDirectoryContents(staging: staging, destination: zipURL)

        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)

        let result = try AppSyncPortableTransfer.importPortable(
            from: zipURL,
            dictionaryStore: targetDictionary,
            usageSummaryStore: nil,
            defaults: targetDefaults
        )

        XCTAssertEqual(result.sourceKind, .zipLegacy)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")
        let term = try XCTUnwrap(targetDictionary.entries.first { $0.term == "ZipLegacyTerm" })
        XCTAssertEqual(term.matchCount, 4)
        XCTAssertEqual(term.source, .auto) // ai maps to .auto
    }

    // MARK: - Malicious / invalid ZIP

    func testImportPortableRejectsZipWithPathTraversal() throws {
        let zipURL = try makeMaliciousZipWithEntry(name: "../escape.txt", content: "x")
        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        XCTAssertThrowsError(
            try AppSyncPortableTransfer.importPortable(
                from: zipURL,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: nil,
                defaults: defaults
            )
        ) { error in
            guard let portable = error as? AppSyncPortableTransferError,
                  case .zip(let zipError) = portable else {
                return XCTFail("Expected zip error, got \(error)")
            }
            if case .unsafeEntry = zipError {
                // expected
            } else if case .invalidZip = zipError {
                // listing may surface as invalid depending on zip tool
            } else {
                XCTFail("Expected unsafeEntry or invalidZip, got \(zipError)")
            }
        }
    }

    func testImportPortableRejectsZipWithAbsolutePathEntry() throws {
        let zipURL = try makeMaliciousZipWithEntry(name: "/tmp/evil.txt", content: "x")
        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        XCTAssertThrowsError(
            try AppSyncPortableTransfer.importPortable(
                from: zipURL,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: nil,
                defaults: defaults
            )
        ) { error in
            XCTAssertTrue(error is AppSyncPortableTransferError)
        }
    }

    func testImportPortableRejectsInvalidZipBytes() throws {
        let zipURL = try makeTemporaryDirectory()
            .appendingPathComponent("not-a-zip.zip", isDirectory: false)
        try Data("this is not a zip".utf8).write(to: zipURL)

        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        XCTAssertThrowsError(
            try AppSyncPortableTransfer.importPortable(
                from: zipURL,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: nil,
                defaults: defaults
            )
        ) { error in
            guard let portable = error as? AppSyncPortableTransferError,
                  case .zip(let zipError) = portable else {
                return XCTFail("Expected zip error, got \(error)")
            }
            XCTAssertEqual(zipError, .invalidZip)
        }
    }

    func testZipSupportValidateEntryPathRejectsDotDotAndDeepPaths() {
        XCTAssertThrowsError(try AppSyncZipSupport.validateEntryPath("../x"))
        XCTAssertThrowsError(try AppSyncZipSupport.validateEntryPath("/abs"))
        XCTAssertThrowsError(try AppSyncZipSupport.validateEntryPath("a/./b"))
        let deep = (0..<AppSyncZipSupport.maxEntryDepth + 2).map { "d\($0)" }.joined(separator: "/")
        XCTAssertThrowsError(try AppSyncZipSupport.validateEntryPath(deep))
        XCTAssertNoThrow(try AppSyncZipSupport.validateEntryPath("SayIt-Profile.json"))
        XCTAssertNoThrow(try AppSyncZipSupport.validateEntryPath("nested/ok.json"))
    }

    // MARK: - Export ZIP then import round-trip

    func testExportPortableZipThenImportRoundTripViaService() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("ja", forKey: AppPreferenceKey.interfaceLanguage)

        let database = try makeDatabase()
        let usageStore = retain(
            UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "svc-portable")
        )
        let day = Date(timeIntervalSince1970: 1_710_800_000)
        usageStore.recordSession(
            createdAt: day,
            text: "portable zip",
            isTranslation: false,
            kind: .normal,
            duration: 2,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )

        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        try dictionaryStore.createManualEntry(
            term: "ServicePortableRoundTrip",
            groupID: nil,
            groupNameSnapshot: nil
        )

        let service = DictionaryCloudSyncService(
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageStore,
            defaults: defaults
        )

        let zipURL = try makeTemporaryDirectory()
            .appendingPathComponent("roundtrip.zip", isDirectory: false)
        try service.exportPortableZip(to: zipURL)

        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)
        let targetUsage = retain(
            UsageDaySummaryStore(
                database: try makeDatabase(),
                defaults: targetDefaults,
                deviceID: "target-portable"
            )
        )
        let targetService = DictionaryCloudSyncService(
            dictionaryStore: targetDictionary,
            usageSummaryStore: targetUsage,
            defaults: targetDefaults
        )

        let importResult = try targetService.importPortable(from: zipURL)
        XCTAssertEqual(importResult.sourceKind, .zipPackage)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
        XCTAssertTrue(targetDictionary.entries.contains { $0.term == "ServicePortableRoundTrip" })
        XCTAssertGreaterThanOrEqual(importResult.usageDaysImported, 1)
        XCTAssertNil(targetDefaults.data(forKey: AppPreferenceKey.dictionarySyncDirectoryBookmark))
    }

    func testImportPortableEmptyDirectoryThrows() throws {
        let folder = try makeTemporaryDirectory()
        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        XCTAssertThrowsError(
            try AppSyncPortableTransfer.importPortable(
                from: folder,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: nil,
                defaults: defaults
            )
        ) { error in
            XCTAssertEqual(error as? AppSyncPortableTransferError, .noImportableContent)
        }
    }
}

// MARK: - Helpers

private extension AppSyncPortableTransferTests {
    func makeEphemeralDefaults() -> UserDefaults {
        let suiteName = "AppSyncPortableTransferTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            fatalError("Expected ephemeral UserDefaults suite")
        }
        defaults.removePersistentDomain(forName: suiteName)
        suiteNames.append(suiteName)
        return defaults
    }

    func makeDatabase() throws -> VoxtDatabase {
        let directory = try makeTemporaryDirectory()
        let database = VoxtDatabase(databaseURL: directory.appendingPathComponent("voxt.sqlite"))
        return retain(database)
    }

    func makeDictionaryStore(defaults: UserDefaults) -> DictionaryStore {
        DictionaryStore(
            defaults: defaults,
            fileManager: .default,
            initialEntries: [],
            persistenceEnabled: false
        )
    }

    func retain<Value: AnyObject>(_ value: Value) -> Value {
        Self.retainedObjects.append(value)
        return value
    }

    func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voxt-portable-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }

    /// Creates a flat ZIP of all files in `staging` using `/usr/bin/zip`.
    func createZipFromDirectoryContents(staging: URL, destination: URL) throws {
        let names = try FileManager.default.contentsOfDirectory(atPath: staging.path)
            .filter { !$0.hasPrefix(".") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
        process.arguments = ["-q", "-j", destination.path] + names
        process.currentDirectoryURL = staging
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0, "zip create failed")
    }

    /// Builds a ZIP that may contain unsafe entry names via Python zipfile (allows custom arcnames).
    func makeMaliciousZipWithEntry(name: String, content: String) throws -> URL {
        let dir = try makeTemporaryDirectory()
        let zipURL = dir.appendingPathComponent("malicious.zip", isDirectory: false)
        let payloadURL = dir.appendingPathComponent("payload.txt", isDirectory: false)
        try Data(content.utf8).write(to: payloadURL)

        // Use Python to force arcname (system zip may normalize paths).
        let script = """
        import zipfile, sys
        z = zipfile.ZipFile(sys.argv[1], 'w')
        z.write(sys.argv[2], arcname=sys.argv[3])
        z.close()
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-c", script, zipURL.path, payloadURL.path, name]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            // Fallback: try zip with the raw name if python unavailable.
            let fallback = Process()
            fallback.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
            // zip refuses .. sometimes; still produce an archive for invalid cases.
            fallback.arguments = ["-q", zipURL.path, payloadURL.lastPathComponent]
            fallback.currentDirectoryURL = dir
            fallback.standardOutput = Pipe()
            fallback.standardError = Pipe()
            try fallback.run()
            fallback.waitUntilExit()
        }
        return zipURL
    }
}

