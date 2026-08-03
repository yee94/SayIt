// AppSettingsSyncTests.swift
// Offline tests for app settings folder snapshot IO, LWW merge, and secret exclusion.
// v2: per-field revision/baseline stability, featureSettings group split, echo suppression.

import XCTest
@testable import Voxt

@MainActor
final class AppSettingsSyncTests: XCTestCase {
    private var temporaryURLs: [URL] = []
    private var suiteNames: [String] = []

    override func tearDownWithError() throws {
        for name in suiteNames {
            UserDefaults(suiteName: name)?.removePersistentDomain(forName: name)
        }
        suiteNames = []
        for url in temporaryURLs {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryURLs = []
        try super.tearDownWithError()
    }

    // MARK: - Snapshot IO

    func testWriteAndListSnapshotsRoundTrip() throws {
        let directory = try makeTemporaryDirectory()
        let exportedAt = Date(timeIntervalSince1970: 1_700_000_100)
        let fields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                ),
                updatedAt: exportedAt,
                revision: 1
            ),
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.launchAtLogin,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                ),
                updatedAt: exportedAt,
                revision: 1
            ),
        ]

        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: fields,
            directoryURL: directory,
            deviceId: "device-1",
            exportedAt: exportedAt
        )

        let listed = try AppSettingsSyncSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed[0].deviceID, "device-1")
        XCTAssertEqual(listed[0].version, AppSettingsSyncSnapshotIO.envelopeVersion)
        XCTAssertEqual(listed[0].fields.count, 2)

        let language = try XCTUnwrap(listed[0].fields.first { $0.key == AppPreferenceKey.interfaceLanguage })
        let decoded = try XCTUnwrap(AppSettingsSyncSnapshotIO.decodeStoredValue(language.value))
        XCTAssertEqual(decoded, .string("zh-Hans"))
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            exportedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
        XCTAssertEqual(language.revision, 1)
    }

    func testListSnapshotsSkipsCorruptAndVersionMismatchFiles() throws {
        let directory = try makeTemporaryDirectory()

        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.showInDock,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(false))
                    ),
                    updatedAt: Date(timeIntervalSince1970: 1_700_000_000),
                    revision: 1
                ),
            ],
            directoryURL: directory,
            deviceId: "good",
            exportedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let badURL = directory.appendingPathComponent("sayit-settings-bad.json")
        try Data("not-json".utf8).write(to: badURL)

        let wrongVersionURL = directory.appendingPathComponent("sayit-settings-v99.json")
        let wrongVersionJSON = """
        {"version":99,"deviceID":"v99","exportedAt":"2023-11-01T00:00:00Z","fields":[]}
        """
        try Data(wrongVersionJSON.utf8).write(to: wrongVersionURL)

        let listed = try AppSettingsSyncSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed[0].deviceID, "good")
        XCTAssertEqual(listed[0].fields.count, 1)
    }

    func testListSnapshotsAcceptsLegacyV1Envelope() throws {
        let directory = try makeTemporaryDirectory()
        let v1URL = directory.appendingPathComponent("sayit-settings-legacy.json")
        // v1 field without revision; ISO8601 date.
        let v1JSON = """
        {
          "version": 1,
          "deviceID": "legacy",
          "exportedAt": "2023-11-14T22:13:20Z",
          "fields": [
            {
              "key": "interfaceLanguage",
              "value": "{\\"type\\":\\"string\\",\\"value\\":\\"en\\"}",
              "updatedAt": "2023-11-14T22:13:20Z"
            }
          ]
        }
        """
        try Data(v1JSON.utf8).write(to: v1URL)

        let listed = try AppSettingsSyncSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed[0].deviceID, "legacy")
        XCTAssertEqual(listed[0].version, 1)
        let field = try XCTUnwrap(listed[0].fields.first)
        XCTAssertEqual(field.key, AppPreferenceKey.interfaceLanguage)
        XCTAssertEqual(field.revision, 0)
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(field.value),
            .string("en")
        )
    }

    // MARK: - Merge LWW

    func testMergeFieldsPrefersNewerExportedAt() throws {
        let olderAt = Date(timeIntervalSince1970: 1_700_000_000)
        let newerAt = Date(timeIntervalSince1970: 1_700_100_000)

        let older = AppSettingsSyncSnapshotIO.Envelope(
            version: 2,
            deviceID: "device-A",
            exportedAt: olderAt,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                    ),
                    updatedAt: olderAt,
                    revision: 1
                ),
            ]
        )
        let newer = AppSettingsSyncSnapshotIO.Envelope(
            version: 2,
            deviceID: "device-B",
            exportedAt: newerAt,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                    ),
                    updatedAt: newerAt,
                    revision: 2
                ),
            ]
        )

        let merged = AppSettingsSyncSnapshotIO.mergeFields(snapshots: [older, newer])
        let field = try XCTUnwrap(merged[AppPreferenceKey.interfaceLanguage])
        let value = try XCTUnwrap(AppSettingsSyncSnapshotIO.decodeStoredValue(field.value))
        XCTAssertEqual(value, .string("zh-Hans"))
    }

    func testMergeFieldsKeepsDistinctKeysFromDifferentDevices() throws {
        let atA = Date(timeIntervalSince1970: 1_700_000_000)
        let atB = Date(timeIntervalSince1970: 1_700_050_000)

        let snapA = AppSettingsSyncSnapshotIO.Envelope(
            version: 2,
            deviceID: "A",
            exportedAt: atA,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                    ),
                    updatedAt: atA,
                    revision: 1
                ),
            ]
        )
        let snapB = AppSettingsSyncSnapshotIO.Envelope(
            version: 2,
            deviceID: "B",
            exportedAt: atB,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.launchAtLogin,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                    ),
                    updatedAt: atB,
                    revision: 1
                ),
            ]
        )

        let merged = AppSettingsSyncSnapshotIO.mergeFields(snapshots: [snapA, snapB])
        XCTAssertEqual(merged.count, 2)
        XCTAssertNotNil(merged[AppPreferenceKey.interfaceLanguage])
        XCTAssertNotNil(merged[AppPreferenceKey.launchAtLogin])
    }

    func testMergeFieldsTieBreakUsesHigherDeviceID() throws {
        let at = Date(timeIntervalSince1970: 1_700_000_000)
        let snapA = AppSettingsSyncSnapshotIO.Envelope(
            version: 2,
            deviceID: "device-A",
            exportedAt: at,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                    ),
                    updatedAt: at,
                    revision: 1
                ),
            ]
        )
        let snapB = AppSettingsSyncSnapshotIO.Envelope(
            version: 2,
            deviceID: "device-B",
            exportedAt: at,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                    ),
                    updatedAt: at,
                    revision: 1
                ),
            ]
        )

        let merged = AppSettingsSyncSnapshotIO.mergeFields(snapshots: [snapA, snapB])
        let field = try XCTUnwrap(merged[AppPreferenceKey.interfaceLanguage])
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(field.value),
            .string("zh-Hans")
        )
    }

    // MARK: - Baseline / revision stability

    func testCollectFieldsKeepsRevisionAndUpdatedAtWhenUnchanged() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)

        let firstAt = Date(timeIntervalSince1970: 1_700_600_000)
        let secondAt = Date(timeIntervalSince1970: 1_700_700_000)

        let first = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: firstAt
        )
        let firstLanguage = try XCTUnwrap(
            first.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(firstLanguage.revision, 1)
        XCTAssertEqual(
            firstLanguage.updatedAt.timeIntervalSince1970,
            firstAt.timeIntervalSince1970,
            accuracy: 0.001
        )

        let second = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: secondAt
        )
        let secondLanguage = try XCTUnwrap(
            second.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(secondLanguage.revision, firstLanguage.revision)
        XCTAssertEqual(
            secondLanguage.updatedAt.timeIntervalSince1970,
            firstLanguage.updatedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
        XCTAssertEqual(secondLanguage.value, firstLanguage.value)
    }

    func testCollectFieldsBumpsRevisionAndUpdatedAtOnLocalChange() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)

        let firstAt = Date(timeIntervalSince1970: 1_700_800_000)
        let first = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: firstAt
        )
        let firstLanguage = try XCTUnwrap(
            first.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(firstLanguage.revision, 1)

        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        let secondAt = Date(timeIntervalSince1970: 1_700_900_000)
        let second = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: secondAt
        )
        let secondLanguage = try XCTUnwrap(
            second.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(secondLanguage.revision, 2)
        XCTAssertEqual(
            secondLanguage.updatedAt.timeIntervalSince1970,
            secondAt.timeIntervalSince1970,
            accuracy: 0.001
        )
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(secondLanguage.value),
            .string("zh-Hans")
        )
    }

    func testApplyRemoteWinnerUpdatesBaselineWithoutEcho() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)

        let localAt = Date(timeIntervalSince1970: 1_701_000_000)
        _ = AppSettingsSyncSnapshotIO.collectFields(defaults: defaults, exportedAt: localAt)

        let remoteAt = Date(timeIntervalSince1970: 1_701_100_000)
        let remoteField = AppSettingsSyncSnapshotIO.AppSettingsSyncField(
            key: AppPreferenceKey.interfaceLanguage,
            value: try XCTUnwrap(
                AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
            ),
            updatedAt: remoteAt,
            revision: 5
        )
        AppSettingsSyncSnapshotIO.applyMergedFields(
            [AppPreferenceKey.interfaceLanguage: remoteField],
            to: defaults
        )
        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")

        // Collect after apply must not bump revision/updatedAt (echo suppression).
        let postAt = Date(timeIntervalSince1970: 1_701_200_000)
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
        XCTAssertEqual(language.revision, 5)
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            remoteAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    // MARK: - Secrets excluded

    func testExportDoesNotIncludeAPIKeyPlaintext() throws {
        let defaults = makeEphemeralDefaults()
        let secretKey = "sk-test-secret-key-SHOULD-NOT-EXPORT-\(UUID().uuidString)"
        let secretAppID = "appid-SECRET-\(UUID().uuidString)"
        let secretToken = "token-SECRET-\(UUID().uuidString)"

        // Persist metadata-only shape (as UserDefaults does after saveConfigurations).
        let configuration = RemoteProviderConfiguration(
            providerID: "openai",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKey: secretKey,
            appID: secretAppID,
            accessToken: secretToken
        )
        // Encode with secrets first (simulating pre-migration / raw inject), then also
        // write the sanitized form that production uses.
        let withSecretsJSON = try JSONEncoder().encode([configuration])
        let withSecretsString = try XCTUnwrap(String(data: withSecretsJSON, encoding: .utf8))
        defaults.set(withSecretsString, forKey: AppPreferenceKey.remoteLLMProviderConfigurations)

        // Also plant secret as a normal string preference that is NOT in whitelist
        // to ensure we don't export excluded keys either.
        defaults.set(secretKey, forKey: AppPreferenceKey.customProxyPassword)
        defaults.set(secretKey, forKey: AppPreferenceKey.selectedInputDeviceID)

        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)

        let fields = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: Date(timeIntervalSince1970: 1_700_200_000)
        )

        let payloadJSON = try JSONEncoder().encode(fields)
        let payloadString = try XCTUnwrap(String(data: payloadJSON, encoding: .utf8))

        XCTAssertFalse(payloadString.contains(secretKey), "Exported payload must not contain apiKey")
        XCTAssertFalse(payloadString.contains(secretAppID), "Exported payload must not contain appID")
        XCTAssertFalse(payloadString.contains(secretToken), "Exported payload must not contain accessToken")
        XCTAssertFalse(
            fields.contains { $0.key == AppPreferenceKey.customProxyPassword },
            "Proxy password must not be in whitelist export"
        )
        XCTAssertFalse(
            fields.contains { $0.key == AppPreferenceKey.selectedInputDeviceID },
            "Microphone device id must not be exported"
        )
        XCTAssertTrue(fields.contains { $0.key == AppPreferenceKey.interfaceLanguage })

        // Provider configurations field should exist and decode without secrets.
        if let providerField = fields.first(where: {
            $0.key == AppPreferenceKey.remoteLLMProviderConfigurations
        }) {
            let stored = try XCTUnwrap(AppSettingsSyncSnapshotIO.decodeStoredValue(providerField.value))
            guard case .string(let raw) = stored else {
                return XCTFail("Expected string provider configs")
            }
            XCTAssertFalse(raw.contains(secretKey))
            let configs = RemoteModelConfigurationStore.loadConfigurations(
                from: raw,
                sensitiveValueLoading: .metadataOnly
            )
            let openai = try XCTUnwrap(configs["openai"])
            XCTAssertEqual(openai.model, "gpt-4o-mini")
            XCTAssertEqual(openai.endpoint, "https://api.openai.com/v1")
            XCTAssertTrue(openai.apiKey.isEmpty)
            XCTAssertTrue(openai.appID.isEmpty)
            XCTAssertTrue(openai.accessToken.isEmpty)
        } else {
            // If raw had secrets but sanitize failed to produce field, that's also a fail.
            XCTFail("Expected remoteLLMProviderConfigurations in export")
        }
    }

    // MARK: - FeatureSettings groups + local path preservation

    func testCollectSplitsFeatureSettingsIntoFiveGroups() throws {
        let defaults = makeEphemeralDefaults()
        // Ensure feature settings blob exists via store.
        var settings = FeatureSettingsStore.load(defaults: defaults)
        settings.transcription.notes.obsidianSync.relativeFolder = "NotesFolder"
        FeatureSettingsStore.save(settings, defaults: defaults)

        let fields = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: Date(timeIntervalSince1970: 1_701_300_000)
        )
        let keys = Set(fields.map(\.key))
        XCTAssertFalse(keys.contains(AppPreferenceKey.featureSettings))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranscription))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranslation))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsRewrite))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsMeeting))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsAvailability))
    }

    func testFeatureSettingsImportPreservesLocalVaultBookmark() throws {
        let defaults = makeEphemeralDefaults()
        let localBookmark = Data("local-vault-bookmark-\(UUID().uuidString)".utf8)
        let localPath = "/Users/local/ObsidianVault"
        let localListID = "list-local-\(UUID().uuidString)"

        var localSettings = FeatureSettingsStore.load(defaults: defaults)
        localSettings.transcription.notes.obsidianSync.enabled = true
        localSettings.transcription.notes.obsidianSync.vaultPath = localPath
        localSettings.transcription.notes.obsidianSync.vaultBookmarkData = localBookmark
        localSettings.transcription.notes.obsidianSync.relativeFolder = "LocalFolder"
        localSettings.transcription.notes.remindersSync.selectedListIdentifier = localListID
        localSettings.transcription.notes.remindersSync.selectedListTitle = "Local List"
        FeatureSettingsStore.save(localSettings, defaults: defaults)

        // Build a remote transcription group payload with different vault path/bookmark.
        var remoteSettings = localSettings
        remoteSettings.transcription.notes.obsidianSync.vaultPath = "/Users/remote/OtherVault"
        remoteSettings.transcription.notes.obsidianSync.vaultBookmarkData = Data("remote-bookmark".utf8)
        remoteSettings.transcription.notes.obsidianSync.relativeFolder = "RemoteFolder"
        remoteSettings.transcription.notes.remindersSync.selectedListIdentifier = "list-remote"
        remoteSettings.transcription.notes.remindersSync.selectedListTitle = "Remote List"
        // Strip for export as production does.
        remoteSettings = AppSettingsSyncSnapshotIO.strippingDeviceLocalNotePaths(from: remoteSettings)
        let remoteData = try JSONEncoder().encode(remoteSettings.transcription)
        let remoteRaw = try XCTUnwrap(String(data: remoteData, encoding: .utf8))

        let exportedAt = Date(timeIntervalSince1970: 1_700_300_000)
        let field = AppSettingsSyncSnapshotIO.AppSettingsSyncField(
            key: AppPreferenceKey.featureSettingsTranscription,
            value: try XCTUnwrap(
                AppSettingsSyncSnapshotIO.encodeStoredValue(.string(remoteRaw))
            ),
            updatedAt: exportedAt,
            revision: 2
        )

        AppSettingsSyncSnapshotIO.applyMergedFields(
            [AppPreferenceKey.featureSettingsTranscription: field],
            to: defaults
        )

        let applied = FeatureSettingsStore.load(defaults: defaults)
        XCTAssertEqual(applied.transcription.notes.obsidianSync.vaultPath, localPath)
        XCTAssertEqual(applied.transcription.notes.obsidianSync.vaultBookmarkData, localBookmark)
        XCTAssertEqual(applied.transcription.notes.remindersSync.selectedListIdentifier, localListID)
        // Non-local fields from remote should apply.
        XCTAssertEqual(applied.transcription.notes.obsidianSync.relativeFolder, "RemoteFolder")
    }

    func testLegacyMonolithicFeatureSettingsNormalizesToGroups() throws {
        let defaults = makeEphemeralDefaults()
        var settings = FeatureSettingsStore.load(defaults: defaults)
        settings.transcription.notes.obsidianSync.relativeFolder = "FromLegacy"
        settings = AppSettingsSyncSnapshotIO.strippingDeviceLocalNotePaths(from: settings)
        let monoData = try JSONEncoder().encode(settings)
        let monoRaw = try XCTUnwrap(String(data: monoData, encoding: .utf8))
        let at = Date(timeIntervalSince1970: 1_701_400_000)
        let monoField = AppSettingsSyncSnapshotIO.AppSettingsSyncField(
            key: AppPreferenceKey.featureSettings,
            value: try XCTUnwrap(
                AppSettingsSyncSnapshotIO.encodeStoredValue(.string(monoRaw))
            ),
            updatedAt: at,
            revision: 3
        )

        let normalized = AppSettingsSyncSnapshotIO.normalizeFieldsFromLegacyIfNeeded([monoField])
        let keys = Set(normalized.map(\.key))
        XCTAssertFalse(keys.contains(AppPreferenceKey.featureSettings))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranscription))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranslation))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsRewrite))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsMeeting))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsAvailability))

        let transcription = try XCTUnwrap(
            normalized.first { $0.key == AppPreferenceKey.featureSettingsTranscription }
        )
        XCTAssertEqual(transcription.revision, 3)
        XCTAssertEqual(
            transcription.updatedAt.timeIntervalSince1970,
            at.timeIntervalSince1970,
            accuracy: 0.001
        )

        // Apply via merged map (as listSnapshots would after normalize).
        let merged = Dictionary(uniqueKeysWithValues: normalized.map { ($0.key, $0) })
        AppSettingsSyncSnapshotIO.applyMergedFields(merged, to: defaults)
        let applied = FeatureSettingsStore.load(defaults: defaults)
        XCTAssertEqual(applied.transcription.notes.obsidianSync.relativeFolder, "FromLegacy")
    }

    func testListSnapshotsNormalizesV1MonolithicFeatureSettings() throws {
        let directory = try makeTemporaryDirectory()
        var settings = FeatureSettings(
            transcription: FeatureSettingsStore.load().transcription,
            translation: FeatureSettingsStore.load().translation,
            rewrite: FeatureSettingsStore.load().rewrite
        )
        settings.transcription.notes.obsidianSync.relativeFolder = "V1Folder"
        settings = AppSettingsSyncSnapshotIO.strippingDeviceLocalNotePaths(from: settings)
        let monoData = try JSONEncoder().encode(settings)
        let monoRaw = try XCTUnwrap(String(data: monoData, encoding: .utf8))
        // Nested JSON string for StoredPreferenceValue.
        let valueObject = try XCTUnwrap(
            AppSettingsSyncSnapshotIO.encodeStoredValue(.string(monoRaw))
        )
        // Escape for embedding in outer JSON.
        let escapedValue = valueObject
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let v1JSON = """
        {
          "version": 1,
          "deviceID": "v1-device",
          "exportedAt": "2023-11-14T22:13:20Z",
          "fields": [
            {
              "key": "featureSettings",
              "value": "\(escapedValue)",
              "updatedAt": "2023-11-14T22:13:20Z"
            }
          ]
        }
        """
        let url = directory.appendingPathComponent("sayit-settings-v1-device.json")
        try Data(v1JSON.utf8).write(to: url)

        let listed = try AppSettingsSyncSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        let keys = Set(listed[0].fields.map(\.key))
        XCTAssertFalse(keys.contains(AppPreferenceKey.featureSettings))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranscription))
    }

    // MARK: - Empty baseline first migration

    /// Empty local baseline + older local value must not stamp "now" over newer remote v2 fields.
    func testEmptyBaselineFirstSyncAdoptsNewerRemoteV2Fields() throws {
        let directory = try makeTemporaryDirectory()
        let defaults = makeEphemeralDefaults()

        // Local is older / different; baseline intentionally empty (fresh upgrade).
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        XCTAssertTrue(AppSettingsSyncBaselineStore.load(defaults: defaults).entries.isEmpty)

        let remoteAt = Date(timeIntervalSince1970: 1_702_000_000)
        let remoteRevision = 7
        let remoteFields = [
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.interfaceLanguage,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                ),
                updatedAt: remoteAt,
                revision: remoteRevision
            ),
        ]
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: remoteFields,
            directoryURL: directory,
            deviceId: "remote-device",
            exportedAt: remoteAt
        )

        try AppSettingsSyncSnapshotIO.syncAppSettings(
            directoryURL: directory,
            deviceId: "local-device",
            defaults: defaults
        )

        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")

        let localSnapshotURL = directory.appendingPathComponent(
            AppSettingsSyncSnapshotIO.snapshotFileName(deviceId: "local-device")
        )
        let data = try Data(contentsOf: localSnapshotURL)
        let envelope = try AppSyncJSONCoding.makeDecoder().decode(
            AppSettingsSyncSnapshotIO.Envelope.self,
            from: data
        )
        let language = try XCTUnwrap(
            envelope.fields.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(language.value),
            .string("zh-Hans")
        )
        XCTAssertEqual(language.revision, remoteRevision)
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            remoteAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    /// Empty local baseline + older local value must adopt newer remote v1 fields (no revision).
    func testEmptyBaselineFirstSyncAdoptsNewerRemoteV1Fields() throws {
        let directory = try makeTemporaryDirectory()
        let defaults = makeEphemeralDefaults()

        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        XCTAssertTrue(AppSettingsSyncBaselineStore.load(defaults: defaults).entries.isEmpty)

        // v1 envelope: no revision field; newer updatedAt than any local stamp would claim after seed.
        let v1JSON = """
        {
          "version": 1,
          "deviceID": "remote-v1",
          "exportedAt": "2024-01-15T12:00:00Z",
          "fields": [
            {
              "key": "interfaceLanguage",
              "value": "{\\"type\\":\\"string\\",\\"value\\":\\"zh-Hans\\"}",
              "updatedAt": "2024-01-15T12:00:00Z"
            }
          ]
        }
        """
        let v1URL = directory.appendingPathComponent("sayit-settings-remote-v1.json")
        try Data(v1JSON.utf8).write(to: v1URL)

        try AppSettingsSyncSnapshotIO.syncAppSettings(
            directoryURL: directory,
            deviceId: "local-device",
            defaults: defaults
        )

        XCTAssertEqual(defaults.string(forKey: AppPreferenceKey.interfaceLanguage), "zh-Hans")

        let localSnapshotURL = directory.appendingPathComponent(
            AppSettingsSyncSnapshotIO.snapshotFileName(deviceId: "local-device")
        )
        let data = try Data(contentsOf: localSnapshotURL)
        let envelope = try AppSyncJSONCoding.makeDecoder().decode(
            AppSettingsSyncSnapshotIO.Envelope.self,
            from: data
        )
        let language = try XCTUnwrap(
            envelope.fields.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(language.value),
            .string("zh-Hans")
        )
        // v1 defaults revision to 0; seed apply records that metadata so re-export does not bump.
        XCTAssertEqual(language.revision, 0)
        let expectedRemoteAt = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2024-01-15T12:00:00Z")
        )
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            expectedRemoteAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    // MARK: - Full sync cycle

    func testSyncAppSettingsRoundTripAppliesRemoteWinner() throws {
        let directory = try makeTemporaryDirectory()
        let defaultsA = makeEphemeralDefaults()
        let defaultsB = makeEphemeralDefaults()

        defaultsA.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        defaultsA.set(false, forKey: AppPreferenceKey.launchAtLogin)

        defaultsB.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        defaultsB.set(true, forKey: AppPreferenceKey.launchAtLogin)

        // Controlled field-level updatedAt (not wall-clock) so LWW is deterministic under v2 baselines.
        let older = Date(timeIntervalSince1970: 1_700_400_000)
        let newer = Date(timeIntervalSince1970: 1_700_500_000)

        let fieldsB = AppSettingsSyncSnapshotIO.collectFields(defaults: defaultsB, exportedAt: older)
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: fieldsB,
            directoryURL: directory,
            deviceId: "device-B",
            exportedAt: older
        )

        let fieldsA = AppSettingsSyncSnapshotIO.collectFields(defaults: defaultsA, exportedAt: newer)
        try AppSettingsSyncSnapshotIO.writeSnapshot(
            fields: fieldsA,
            directoryURL: directory,
            deviceId: "device-A",
            exportedAt: newer
        )

        let snapshots = try AppSettingsSyncSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(snapshots.count, 2)
        let merged = AppSettingsSyncSnapshotIO.mergeFields(snapshots: snapshots)

        let language = try XCTUnwrap(merged[AppPreferenceKey.interfaceLanguage])
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(language.value),
            .string("en")
        )

        // Apply onto a fresh defaults suite that only had B's values.
        let defaultsTarget = makeEphemeralDefaults()
        defaultsTarget.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        AppSettingsSyncSnapshotIO.applyMergedFields(merged, to: defaultsTarget)
        XCTAssertEqual(defaultsTarget.string(forKey: AppPreferenceKey.interfaceLanguage), "en")
        XCTAssertEqual(defaultsTarget.bool(forKey: AppPreferenceKey.launchAtLogin), false)
    }

    func testProviderMetadataMergeDoesNotClearLocalUserDefaultsKeyShape() throws {
        let defaults = makeEphemeralDefaults()
        // Local metadata (no secrets in UD).
        let localConfig = RemoteProviderConfiguration(
            providerID: "openai",
            model: "gpt-4o",
            endpoint: "https://api.openai.com/v1",
            apiKey: ""
        )
        let localJSON = try JSONEncoder().encode([localConfig.withoutSensitiveValues])
        defaults.set(
            try XCTUnwrap(String(data: localJSON, encoding: .utf8)),
            forKey: AppPreferenceKey.remoteLLMProviderConfigurations
        )

        let remoteConfig = RemoteProviderConfiguration(
            providerID: "openai",
            model: "gpt-4o-mini",
            endpoint: "https://proxy.example.com/v1",
            apiKey: "sk-SHOULD-NOT-LAND"
        )
        let remoteSanitized = remoteConfig.withoutSensitiveValues
        let remoteJSON = try JSONEncoder().encode([remoteSanitized])
        let remoteRaw = try XCTUnwrap(String(data: remoteJSON, encoding: .utf8))
        let field = AppSettingsSyncSnapshotIO.AppSettingsSyncField(
            key: AppPreferenceKey.remoteLLMProviderConfigurations,
            value: try XCTUnwrap(
                AppSettingsSyncSnapshotIO.encodeStoredValue(.string(remoteRaw))
            ),
            updatedAt: Date(),
            revision: 1
        )

        AppSettingsSyncSnapshotIO.applyMergedFields(
            [AppPreferenceKey.remoteLLMProviderConfigurations: field],
            to: defaults
        )

        let appliedRaw = try XCTUnwrap(
            defaults.string(forKey: AppPreferenceKey.remoteLLMProviderConfigurations)
        )
        XCTAssertFalse(appliedRaw.contains("sk-SHOULD-NOT-LAND"))
        let applied = RemoteModelConfigurationStore.loadConfigurations(
            from: appliedRaw,
            sensitiveValueLoading: .metadataOnly
        )
        let openai = try XCTUnwrap(applied["openai"])
        XCTAssertEqual(openai.model, "gpt-4o-mini")
        XCTAssertEqual(openai.endpoint, "https://proxy.example.com/v1")
        XCTAssertTrue(openai.apiKey.isEmpty)
    }

    func testWhitelistExcludesSyncDirectoryAndMicrophoneKeys() {
        let keys = Set(AppSettingsSyncSnapshotIO.syncedPreferenceKeys)
        XCTAssertFalse(keys.contains(AppPreferenceKey.dictionarySyncDirectoryPath))
        XCTAssertFalse(keys.contains(AppPreferenceKey.dictionarySyncDirectoryBookmark))
        XCTAssertFalse(keys.contains(AppPreferenceKey.syncDeviceId))
        XCTAssertFalse(keys.contains(AppPreferenceKey.dictionarySyncDeviceId))
        XCTAssertFalse(keys.contains(AppPreferenceKey.usageSyncDeviceId))
        XCTAssertFalse(keys.contains(AppPreferenceKey.selectedInputDeviceID))
        XCTAssertFalse(keys.contains(AppPreferenceKey.modelStorageRootPath))
        XCTAssertFalse(keys.contains(AppPreferenceKey.modelStorageRootBookmark))
        XCTAssertFalse(keys.contains(AppPreferenceKey.historyAudioStorageRootPath))
        XCTAssertFalse(keys.contains(AppPreferenceKey.networkProxyMode))
        XCTAssertFalse(keys.contains(AppPreferenceKey.customProxyPassword))
        XCTAssertFalse(keys.contains(AppPreferenceKey.hotkeyDebugLoggingEnabled))
        XCTAssertFalse(keys.contains(AppPreferenceKey.meetingSpeakerDiarizationDebugEnabled))
        XCTAssertFalse(keys.contains(AppPreferenceKey.meetingOverlayCollapsed))
        XCTAssertFalse(keys.contains(AppPreferenceKey.featureSettings))
        XCTAssertFalse(keys.contains(AppPreferenceKey.appSettingsSyncBaseline))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranscription))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsTranslation))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsRewrite))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsMeeting))
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettingsAvailability))
        XCTAssertTrue(keys.contains(AppPreferenceKey.remoteASRProviderConfigurations))
        XCTAssertTrue(keys.contains(AppPreferenceKey.hotkeyKeyCode))
    }

    // MARK: - collectFieldsForMerge (package LWW input)

    func testCollectFieldsForMergeDivergedLocalUsesNowAndDoesNotMutateBaseline() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)

        let baselinedAt = Date(timeIntervalSince1970: 1_702_000_000)
        _ = AppSettingsSyncSnapshotIO.collectFields(defaults: defaults, exportedAt: baselinedAt)
        let baselineBefore = AppSettingsSyncBaselineStore.load(defaults: defaults)
        let languageBaseline = try XCTUnwrap(
            baselineBefore.baseline(forKey: AppPreferenceKey.interfaceLanguage)
        )
        XCTAssertEqual(languageBaseline.revision, 1)

        // Unexported local edit after baselining.
        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        let mergeNow = Date(timeIntervalSince1970: 1_702_100_000)
        let mergeFields = AppSettingsSyncSnapshotIO.collectFieldsForMerge(
            defaults: defaults,
            now: mergeNow
        )
        let language = try XCTUnwrap(
            mergeFields.first { $0.key == AppPreferenceKey.interfaceLanguage }
        )
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(language.value),
            .string("zh-Hans")
        )
        XCTAssertEqual(language.revision, 2)
        XCTAssertEqual(
            language.updatedAt.timeIntervalSince1970,
            mergeNow.timeIntervalSince1970,
            accuracy: 0.001
        )

        // Baseline must remain the pre-edit snapshot (no side write).
        let baselineAfter = AppSettingsSyncBaselineStore.load(defaults: defaults)
        let languageBaselineAfter = try XCTUnwrap(
            baselineAfter.baseline(forKey: AppPreferenceKey.interfaceLanguage)
        )
        XCTAssertEqual(languageBaselineAfter.revision, languageBaseline.revision)
        XCTAssertEqual(languageBaselineAfter.value, languageBaseline.value)
        XCTAssertEqual(
            languageBaselineAfter.updatedAt.timeIntervalSince1970,
            languageBaseline.updatedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testCollectFieldsForMergeUnexportedLocalBeatsOlderPackageField() throws {
        let defaults = makeEphemeralDefaults()
        defaults.set("en", forKey: AppPreferenceKey.interfaceLanguage)
        let baselinedAt = Date(timeIntervalSince1970: 1_702_200_000)
        _ = AppSettingsSyncSnapshotIO.collectFields(defaults: defaults, exportedAt: baselinedAt)

        defaults.set("zh-Hans", forKey: AppPreferenceKey.interfaceLanguage)
        let mergeNow = Date(timeIntervalSince1970: 1_702_300_000)
        let localFields = AppSettingsSyncSnapshotIO.collectFieldsForMerge(
            defaults: defaults,
            now: mergeNow
        )
        let olderPackageAt = Date(timeIntervalSince1970: 1_702_250_000)
        let packageField = AppSettingsSyncSnapshotIO.AppSettingsSyncField(
            key: AppPreferenceKey.interfaceLanguage,
            value: try XCTUnwrap(
                AppSettingsSyncSnapshotIO.encodeStoredValue(.string("ja"))
            ),
            updatedAt: olderPackageAt,
            revision: 99
        )
        let localEnvelope = AppSettingsSyncSnapshotIO.Envelope(
            version: AppSettingsSyncSnapshotIO.envelopeVersion,
            deviceID: "local",
            exportedAt: Date(timeIntervalSince1970: 0),
            fields: localFields
        )
        let packageEnvelope = AppSettingsSyncSnapshotIO.Envelope(
            version: AppSettingsSyncSnapshotIO.envelopeVersion,
            deviceID: "package",
            exportedAt: olderPackageAt,
            fields: [packageField]
        )
        let merged = AppSettingsSyncSnapshotIO.mergeFields(
            snapshots: [localEnvelope, packageEnvelope]
        )
        let winner = try XCTUnwrap(merged[AppPreferenceKey.interfaceLanguage])
        XCTAssertEqual(
            AppSettingsSyncSnapshotIO.decodeStoredValue(winner.value),
            .string("zh-Hans")
        )
        XCTAssertEqual(winner.revision, 2)
    }
}

// MARK: - Helpers

private extension AppSettingsSyncTests {
    func makeEphemeralDefaults() -> UserDefaults {
        let suiteName = "AppSettingsSyncTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            fatalError("Expected ephemeral UserDefaults suite")
        }
        defaults.removePersistentDomain(forName: suiteName)
        suiteNames.append(suiteName)
        return defaults
    }

    func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voxt-app-settings-sync-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }
}
