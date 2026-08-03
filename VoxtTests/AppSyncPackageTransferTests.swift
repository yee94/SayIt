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
        // Fractional-second ISO-8601 on write.
        XCTAssertTrue(
            payloadString.contains("."),
            "Expected fractional seconds in exported ISO8601 dates"
        )

        let decoder = AppSyncJSONCoding.makeDecoder()
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
                updatedAt: importExportedAt,
                revision: 3
            ),
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.launchAtLogin,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                ),
                updatedAt: importExportedAt,
                revision: 3
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
        let encoder = AppSyncJSONCoding.makeEncoder()
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

        // Winner baseline: re-export keeps package revision/updatedAt (no echo).
        let postAt = Date(timeIntervalSince1970: 1_700_800_000)
        let collected = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: postAt
        )
        let language = try XCTUnwrap(
            collected.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(language.revision, 3)
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            importExportedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testImportSettingsLWWKeepsNewerLocalField() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)

        let newerLocalAt = Date(timeIntervalSince1970: 1_701_000_000)
        _ = AppSettingsSyncSnapshotIO.collectFields(defaults: defaults, exportedAt: newerLocalAt)

        let olderPackageAt = Date(timeIntervalSince1970: 1_700_000_000)
        let importFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                ),
                updatedAt: olderPackageAt,
                revision: 9
            ),
        ]
        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: olderPackageAt,
            deviceID: "older-package",
            settingsFields: importFields,
            usageDays: [],
            dictionaryTransferJSON: nil
        )
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)
        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertEqual(result.settingsApplied, 0)
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")
    }

    func testImportUnexportedLocalEditBeatsOlderPackageField() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let baselinedAt = Date(timeIntervalSince1970: 1_703_000_000)
        _ = AppSettingsSyncSnapshotIO.collectFields(defaults: defaults, exportedAt: baselinedAt)

        // Local edit after last collect/export (no second collect to bump baseline).
        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)

        let olderPackageAt = Date(timeIntervalSince1970: 1_703_050_000)
        let importFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("ja"))
                ),
                updatedAt: olderPackageAt,
                revision: 50
            ),
        ]
        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: olderPackageAt,
            deviceID: "stale-package",
            settingsFields: importFields,
            usageDays: [],
            dictionaryTransferJSON: nil
        )
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)
        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertEqual(result.settingsApplied, 0)
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")

        // Baseline still reflects pre-edit export (revision 1 / baselinedAt), not package.
        let baseline = AppSettingsSyncBaselineStore.load(defaults: defaults)
        let languageBaseline = try XCTUnwrap(
            baseline.baseline(forKey: AppPreferenceKey.interfaceLanguage)
        )
        XCTAssertEqual(languageBaseline.revision, 1)
        XCTAssertEqual(
            languageBaseline.updatedAt.timeIntervalSince1970,
            baselinedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testImportDoesNotWriteEpochBaselineForLocalOnlyWinnerKeys() throws {
        let defaults = makeEphemeralDefaults()
        // Local key present but never baselined / not in package.
        defaults.set(true, forKey: AppPreferenceKey.showInDock)
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)

        let packageAt = Date(timeIntervalSince1970: 1_703_100_000)
        let importFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                ),
                updatedAt: packageAt,
                revision: 4
            ),
        ]
        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: packageAt,
            deviceID: "pkg-partial",
            settingsFields: importFields,
            usageDays: [],
            dictionaryTransferJSON: nil
        )
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)
        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        XCTAssertEqual(result.settingsApplied, 1)
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")
        XCTAssertEqual(defaults.bool(forKey: AppPreferenceKey.showInDock), true)

        let baseline = AppSettingsSyncBaselineStore.load(defaults: defaults)
        // Package winner baselined for echo suppression.
        let languageBaseline = try XCTUnwrap(
            baseline.baseline(forKey: AppPreferenceKey.interfaceLanguage)
        )
        XCTAssertEqual(languageBaseline.revision, 4)
        XCTAssertEqual(
            languageBaseline.updatedAt.timeIntervalSince1970,
            packageAt.timeIntervalSince1970,
            accuracy: 0.001
        )
        // Local-only key must not get epoch baseline pollution.
        XCTAssertNil(baseline.baseline(forKey: AppPreferenceKey.showInDock))
    }

    func testImportPackageWinnerStillSuppressesEcho() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)

        let packageAt = Date(timeIntervalSince1970: 1_703_200_000)
        let importFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                ),
                updatedAt: packageAt,
                revision: 7
            ),
        ]
        let envelope = AppSyncPackageEnvelope(
            version: AppSyncPackageTransfer.packageVersion,
            exportedAt: packageAt,
            deviceID: "pkg-echo",
            settingsFields: importFields,
            usageDays: [],
            dictionaryTransferJSON: nil
        )
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)
        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        _ = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )

        let postAt = Date(timeIntervalSince1970: 1_703_300_000)
        let collected = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: postAt
        )
        let language = try XCTUnwrap(
            collected.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(language.value),
            .string("zh-Hans")
        )
        XCTAssertEqual(language.revision, 7)
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            packageAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testImportAcceptsV1SettingsFieldsWithoutRevision() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)

        let dictionaryStore = makeDictionaryStore(defaults: defaults)
        // Hand-built v1-style package field JSON (no revision key).
        let packageJSON = """
        {
          "version": 1,
          "exportedAt": "2023-11-20T12:00:00.000Z",
          "deviceID": "v1-pkg",
          "settingsFields": [
            {
              "key": "interfaceLanguage",
              "value": "{\\"type\\":\\"string\\",\\"value\\":\\"ja\\"}",
              "updatedAt": "2023-11-20T12:00:00.000Z"
            }
          ],
          "usageDays": [],
          "dictionaryTransferJSON": null
        }
        """
        let data = Data(packageJSON.utf8)
        let result = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: dictionaryStore,
            usageSummaryStore: nil,
            defaults: defaults
        )
        XCTAssertEqual(result.settingsApplied, 1)
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "ja")
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
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)

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

    // MARK: - Export usage (all devices)

    func testExportPackageIncludesUsageFromAllDevicesAndImportKeepsLWW() throws {
        let defaults = makeEphemeralDefaults()
        let database = try makeDatabase()
        let storeA = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "device-A"))
        let storeB = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "device-B"))
        let dictionaryStore = makeDictionaryStore(defaults: defaults)

        let day = Date(timeIntervalSince1970: 1_700_900_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)

        storeA.recordSession(
            createdAt: day,
            text: "from-A",
            isTranslation: false,
            kind: .normal,
            duration: 5,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        storeB.recordSession(
            createdAt: day,
            text: "from-B-device",
            isTranslation: false,
            kind: .normal,
            duration: 8,
            appName: "Safari",
            appBundleID: "com.apple.Safari",
            browserURLHost: nil
        )

        let exportedAt = Date(timeIntervalSince1970: 1_700_900_100)
        let data = try AppSyncPackageTransfer.exportPackage(
            dictionaryStore: dictionaryStore,
            usageSummaryStore: storeA,
            defaults: defaults,
            deviceID: "device-A",
            exportedAt: exportedAt
        )

        let envelope = try AppSyncJSONCoding.makeDecoder().decode(AppSyncPackageEnvelope.self, from: data)
        let usageDays = try XCTUnwrap(envelope.usageDays)
        XCTAssertEqual(usageDays.count, 2)
        let deviceIDs = Set(usageDays.map(\.deviceID))
        XCTAssertEqual(deviceIDs, Set(["device-A", "device-B"]))
        XCTAssertTrue(usageDays.allSatisfy { $0.day == dayKey })

        // Manual import into a fresh store: both device rows land; later re-import keeps LWW.
        let targetDefaults = makeEphemeralDefaults()
        let targetDatabase = try makeDatabase()
        let targetStore = retain(
            UsageDaySummaryStore(database: targetDatabase, defaults: targetDefaults, deviceID: "target-device")
        )
        let targetDictionary = makeDictionaryStore(defaults: targetDefaults)

        let importResult = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: targetDictionary,
            usageSummaryStore: targetStore,
            defaults: targetDefaults
        )
        XCTAssertEqual(importResult.usageDaysImported, 2)

        let importedA = retain(
            UsageDaySummaryStore(database: targetDatabase, defaults: targetDefaults, deviceID: "device-A")
        )
        let importedB = retain(
            UsageDaySummaryStore(database: targetDatabase, defaults: targetDefaults, deviceID: "device-B")
        )
        let snapA = try XCTUnwrap(importedA.snapshot(day: dayKey))
        let snapB = try XCTUnwrap(importedB.snapshot(day: dayKey))
        XCTAssertEqual(snapA.characters, "from-A".count)
        XCTAssertEqual(snapB.characters, "from-B-device".count)

        // Newer local for device-A must win LWW over re-import of the same package.
        // recordSession stamps updatedAt with wall-clock Date(), so local must be strictly later.
        let packageAUpdatedAt = try XCTUnwrap(usageDays.first { $0.deviceID == "device-A" }?.updatedAt)
        let newerLocal = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-A",
            dictationSeconds: 99,
            characters: 999,
            translationCharacters: 0,
            sessionCount: 9,
            apps: [:],
            updatedAt: packageAUpdatedAt.addingTimeInterval(60)
        )
        targetStore.importSnapshots([newerLocal])
        // Re-import original package (older updatedAt for device-A).
        _ = try AppSyncPackageTransfer.importPackage(
            data: data,
            dictionaryStore: targetDictionary,
            usageSummaryStore: targetStore,
            defaults: targetDefaults
        )
        let afterLWW = try XCTUnwrap(importedA.snapshot(day: dayKey))
        XCTAssertEqual(afterLWW.characters, 999)
        XCTAssertEqual(afterLWW.sessionCount, 9)
        XCTAssertEqual(
            afterLWW.updatedAt.timeIntervalSince1970,
            newerLocal.updatedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
        // Peer device-B from package remains intact.
        let afterB = try XCTUnwrap(importedB.snapshot(day: dayKey))
        XCTAssertEqual(afterB.characters, "from-B-device".count)
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
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)

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
        let data = try AppSyncJSONCoding.makeEncoder().encode(envelope)

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
        let decoder = AppSyncJSONCoding.makeDecoder()
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
