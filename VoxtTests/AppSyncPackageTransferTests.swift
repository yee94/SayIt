// AppSyncPackageTransferTests.swift
// Offline tests for unified manual sync package export/import.

import XCTest
@testable import Voxt

@MainActor
final class AppSyncPackageTransferTests: XCTestCase {
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

    // MARK: - Export

    func testExportPackageDecodesWithVersionAndSettingsWithoutAPIKey() throws {
        let defaults = makeEphemeralDefaults()
        let secretKey = "sk-test-secret-SHOULD-NOT-EXPORT-\(UUID().uuidString)"
        let configuration = RemoteProviderConfiguration(
            providerID: "openai",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKey: secretKey
        )
        let withSecretsJSON = try JSONEncoder().encode([configuration])
        let withSecretsString = try XCTUnwrap(String(data: withSecretsJSON, encoding: .utf8))
        defaults.set(withSecretsString, forKey: AppPreferenceKey.remoteLLMProviderConfigurations)
        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        defaults.set(true, forKey: AppPreferenceKey.launchAtLogin)

        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        try dictionaryStore.createManualEntry(
            term: "SayItPackage",
            groupID: nil,
            groupNameSnapshot: nil
        )

        let exportedAt = Date(timeIntervalSince1970: 1_700_600_000)
        let data = try AppSyncPackageTransfer.exportPackage(
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults,
            deviceID: "device-export-1",
            exportedAt: exportedAt
        )

        let payloadString = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertFalse(payloadString.contains(secretKey), "Package must not contain apiKey plaintext")

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope = try decoder.decode(AppSyncPackageEnvelope.self, from: data)

        XCTAssertEqual(envelope.version, AppSyncPackageTransfer.packageVersion)
        XCTAssertEqual(envelope.deviceID, "device-export-1")
        XCTAssertEqual(
            envelope.exportedAt.timeIntervalSince1970,
            exportedAt.timeIntervalSince1970,
            accuracy: 0.001
        )

        let fields = try XCTUnwrap(envelope.settingsFields)
        XCTAssertTrue(fields.contains { $0.key == AppPreferenceKey.interfaceLanguage })
        XCTAssertTrue(fields.contains { $0.key == AppPreferenceKey.launchAtLogin })
        if let providerField = fields.first(where: {
            $0.key == AppPreferenceKey.remoteLLMProviderConfigurations
        }) {
            let stored = try XCTUnwrap(AppSettingsSyncSnapshotIO.decodeStoredValue(providerField.value))
            guard case .string(let raw) = stored else {
                return XCTFail("Expected string provider configs")
            }
            XCTAssertFalse(raw.contains(secretKey))
        }

        let dictionaryJSON = try XCTUnwrap(envelope.dictionaryTransferJSON)
        XCTAssertTrue(dictionaryJSON.contains("SayItPackage"))
        XCTAssertNotNil(envelope.usageDays)
        XCTAssertEqual(envelope.usageDays?.count, 0)
    }

    // MARK: - Import settings

    func testImportAppliesWhitelistedSettingsFromPackage() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        defaults.set(false, forKey: AppPreferenceKey.launchAtLogin)
        defaults.set(true, forKey: AppPreferenceKey.showInDock)

        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        let importExportedAt = Date(timeIntervalSince1970: 1_700_700_100)
        let importFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                ),
                updatedAt: importExportedAt
            ),
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.launchAtLogin,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                ),
                updatedAt: importExportedAt
            ),
        ]

        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: importExportedAt,
            deviceID: "device-import",
            settingsFields: importFields,
            usageDays: [],
            dictionaryTransferJSON: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(envelope)

        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertEqual(result.settingsApplied, 2)
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")
        XCTAssertEqual(defaults.bool(forKey: AppPreferenceKey.launchAtLogin), true)
        // Local-only key not in package remains.
        XCTAssertEqual(defaults.bool(forKey: AppPreferenceKey.showInDock), true)
    }

    // MARK: - Import dictionary

    func testImportAddsDictionaryTerms() throws {
        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        try dictionaryStore.createManualEntry(
            term: "ExistingTerm",
            groupID: nil,
            groupNameSnapshot: nil
        )

        let transferJSON = try DictionaryTransferManager.exportJSONString(
            entries: [
                TestFactories.makeEntry(term: "NewPackageTerm"),
            ],
            categories: [DictionaryCategory.defaultCategory]
        )

        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: Date(timeIntervalSince1970: 1_700_800_000),
            deviceID: "device-dict",
            settingsFields: nil,
            usageDays: nil,
            dictionaryTransferJSON: transferJSON
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(envelope)

        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertEqual(result.dictionaryAdded, 1)
        XCTAssertEqual(result.dictionarySkipped, 0)
        XCTAssertTrue(dictionaryStore.entries.contains { $0.term == "NewPackageTerm" })
        XCTAssertTrue(dictionaryStore.entries.contains { $0.term == "ExistingTerm" })
    }

    // MARK: - Import usage

    func testImportWritesUsageDailySnapshots() throws {
        let defaults = makeEphemeralDefaults()
        let database = try makeDatabase()
        let usageStore = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "local-device"))
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        let updatedAt = Date(timeIntervalSince1970: 1_700_900_000)
        let remoteDay = UsageDailySnapshot(
            day: "2023-11-20",
            deviceID: "remote-device",
            dictationSeconds: 15,
            characters: 42,
            translationCharacters: 4,
            sessionCount: 2,
            apps: [
                "com.apple.Notes": UsageDailyAppValue(
                    name: "Notes",
                    characters: 42,
                    dictationSeconds: 15
                )
            ],
            updatedAt: updatedAt
        )

        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: updatedAt,
            deviceID: "remote-device",
            settingsFields: nil,
            usageDays: [remoteDay],
            dictionaryTransferJSON: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(envelope)

        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageStore,
            defaults: defaults
        )

        XCTAssertEqual(result.usageDaysImported, 1)
        let remoteStore = retain(
            UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "remote-device")
        )
        let snapshot = try XCTUnwrap(remoteStore.snapshot(day: "2023-11-20"))
        XCTAssertEqual(snapshot.deviceID, "remote-device")
        XCTAssertEqual(snapshot.characters, 42)
        XCTAssertEqual(snapshot.sessionCount, 2)
        XCTAssertEqual(snapshot.dictationSeconds, 15, accuracy: 0.001)
    }

    // MARK: - Errors

    func testImportRejectsUnsupportedVersion() throws {
        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        let envelope = AppSyncPackageEnvelope(
            version: 99,
            exportedAt: Date(),
            deviceID: "v99",
            settingsFields: [],
            usageDays: [],
            dictionaryTransferJSON: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(envelope)

        XCTAssertThrowsError(
            try AppSyncPackageTransfer.importPackage(
                data: data,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: nil,
                defaults: defaults
            )
        ) { error in
            guard let packageError = error as? AppSyncPackageTransferError,
                  case .unsupportedVersion(let version) = packageError else {
                return XCTFail("Expected unsupportedVersion, got \(error)")
            }
            XCTAssertEqual(version, 99)
        }
    }

    func testImportRejectsInvalidJSON() throws {
        let defaults = makeEphemeralDefaults()
        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        let data = Data("not-a-package".utf8)

        XCTAssertThrowsError(
            try AppSyncPackageTransfer.importPackage(
                data: data,
                dictionaryStore: dictionaryStore,
                usageSummaryStore: nil,
                defaults: defaults
            )
        ) { error in
            XCTAssertEqual(error as? AppSyncPackageTransferError, .invalidPackage)
        }
    }

    func testExportThenImportRoundTripViaService() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("ja", forKey: AppPreferenceKey.interfaceLanguage)

        let database = try makeDatabase()
        let usageStore = retain(
            UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "svc-device")
        )
        let day = Date(timeIntervalSince1970: 1_701_000_000)
        usageStore.recordSession(
            createdAt: day,
            text: "hello package",
            isTranslation: false,
            kind: .normal,
            duration: 3,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )

        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        try dictionaryStore.createManualEntry(
            term: "ServiceRoundTrip",
            groupID: nil,
            groupNameSnapshot: nil
        )

        let service = DictionaryCloudSyncService(
            dictionaryStore: dictionaryStore,
            usageSummaryStore: usageStore,
            defaults: defaults
        )

        let exported = try service.exportSyncPackage()
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope = try decoder.decode(AppSyncPackageEnvelope.self, from: exported)
        XCTAssertEqual(envelope.version, 1)
        XCTAssertFalse(try XCTUnwrap(String(data: exported, encoding: .utf8)).contains("sk-"))

        // Fresh target stores for import merge.
        let targetDefaults = makeEphemeralDefaults()
        targetDefaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)
        let targetUsage = retain(
            UsageDaySummaryStore(database: try makeDatabase(), defaults: targetDefaults, deviceID: "target-device")
        )

        let importResult = try AppSyncPackageTransfer.importPackage(
            data: exported,
            dictionaryStore: targetDictionary,
            usageSummaryStore: targetUsage,
            defaults: targetDefaults
        )

        XCTAssertGreaterThan(importResult.settingsApplied, 0)
        XCTAssertEqual(targetDefaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
        XCTAssertTrue(targetDictionary.entries.contains { $0.term == "ServiceRoundTrip" })
        XCTAssertGreaterThanOrEqual(importResult.usageDaysImported, 1)
    }
}

// MARK: - Helpers

private extension AppSyncPackageTransferTests {
    func makeEphemeralDefaults() -> UserDefaults {
        let suiteName = "AppSyncPackageTransferTests.\(UUID().uuidString)"
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
            .appendingPathComponent("voxt-app-sync-package-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }
}
