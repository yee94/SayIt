// AppSettingsSyncTests.swift
// Offline tests for app settings folder snapshot IO, LWW merge, and secret exclusion.

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
                updatedAt: exportedAt
            ),
            AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                key: AppPreferenceKey.launchAtLogin,
                value: try XCTUnwrap(
                    AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                ),
                updatedAt: exportedAt
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
                    updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
                ),
            ],
            directoryURL: directory,
            deviceId: "good",
            exportedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let badURL = directory.appendingPathComponent("sayit-settings-bad.json")
        try Data("not-json".utf8).write(to: badURL)

        let wrongVersionURL = directory.appendingPathComponent("sayit-settings-v2.json")
        let wrongVersionJSON = """
        {"version":99,"deviceID":"v2","exportedAt":"2023-11-01T00:00:00Z","fields":[]}
        """
        try Data(wrongVersionJSON.utf8).write(to: wrongVersionURL)

        let listed = try AppSettingsSyncSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed[0].deviceID, "good")
        XCTAssertEqual(listed[0].fields.count, 1)
    }

    // MARK: - Merge LWW

    func testMergeFieldsPrefersNewerExportedAt() throws {
        let olderAt = Date(timeIntervalSince1970: 1_700_000_000)
        let newerAt = Date(timeIntervalSince1970: 1_700_100_000)

        let older = AppSettingsSyncSnapshotIO.Envelope(
            version: 1,
            deviceID: "device-A",
            exportedAt: olderAt,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                    ),
                    updatedAt: olderAt
                ),
            ]
        )
        let newer = AppSettingsSyncSnapshotIO.Envelope(
            version: 1,
            deviceID: "device-B",
            exportedAt: newerAt,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("zh-Hans"))
                    ),
                    updatedAt: newerAt
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
            version: 1,
            deviceID: "A",
            exportedAt: atA,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.interfaceLanguage,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.string("en"))
                    ),
                    updatedAt: atA
                ),
            ]
        )
        let snapB = AppSettingsSyncSnapshotIO.Envelope(
            version: 1,
            deviceID: "B",
            exportedAt: atB,
            fields: [
                AppSettingsSyncSnapshotIO.AppSettingsSyncField(
                    key: AppPreferenceKey.launchAtLogin,
                    value: try XCTUnwrap(
                        AppSettingsSyncSnapshotIO.encodeStoredValue(.bool(true))
                    ),
                    updatedAt: atB
                ),
            ]
        )

        let merged = AppSettingsSyncSnapshotIO.mergeFields(snapshots: [snapA, snapB])
        XCTAssertEqual(merged.count, 2)
        XCTAssertNotNil(merged[AppPreferenceKey.interfaceLanguage])
        XCTAssertNotNil(merged[AppPreferenceKey.launchAtLogin])
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

    // MARK: - FeatureSettings local path preservation

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

        // Build a remote feature settings payload with different vault path/bookmark.
        var remoteSettings = localSettings
        remoteSettings.transcription.notes.obsidianSync.vaultPath = "/Users/remote/OtherVault"
        remoteSettings.transcription.notes.obsidianSync.vaultBookmarkData = Data("remote-bookmark".utf8)
        remoteSettings.transcription.notes.obsidianSync.relativeFolder = "RemoteFolder"
        remoteSettings.transcription.notes.remindersSync.selectedListIdentifier = "list-remote"
        remoteSettings.transcription.notes.remindersSync.selectedListTitle = "Remote List"
        // Strip for export as production does.
        remoteSettings = AppSettingsSyncSnapshotIO.strippingDeviceLocalNotePaths(from: remoteSettings)
        let remoteData = try JSONEncoder().encode(remoteSettings)
        let remoteRaw = try XCTUnwrap(String(data: remoteData, encoding: .utf8))

        let exportedAt = Date(timeIntervalSince1970: 1_700_300_000)
        let field = AppSettingsSyncSnapshotIO.AppSettingsSyncField(
            key: AppPreferenceKey.featureSettings,
            value: try XCTUnwrap(
                AppSettingsSyncSnapshotIO.encodeStoredValue(.string(remoteRaw))
            ),
            updatedAt: exportedAt
        )

        AppSettingsSyncSnapshotIO.applyMergedFields(
            [AppPreferenceKey.featureSettings: field],
            to: defaults
        )

        let applied = FeatureSettingsStore.load(defaults: defaults)
        XCTAssertEqual(applied.transcription.notes.obsidianSync.vaultPath, localPath)
        XCTAssertEqual(applied.transcription.notes.obsidianSync.vaultBookmarkData, localBookmark)
        XCTAssertEqual(applied.transcription.notes.remindersSync.selectedListIdentifier, localListID)
        // Non-local fields from remote should apply.
        XCTAssertEqual(applied.transcription.notes.obsidianSync.relativeFolder, "RemoteFolder")
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

        // Device B exports first (older).
        try AppSettingsSyncSnapshotIO.syncAppSettings(
            directoryURL: directory,
            deviceId: "device-B",
            defaults: defaultsB
        )

        // Device A exports later and should win on shared keys after re-merge.
        // Simulate A having different values; after sync with both snapshots, newer package wins.
        // Force a slightly later export by sleeping is flaky — write B with older date, A with newer via writeSnapshot.
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
            updatedAt: Date()
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
        XCTAssertTrue(keys.contains(AppPreferenceKey.featureSettings))
        XCTAssertTrue(keys.contains(AppPreferenceKey.remoteASRProviderConfigurations))
        XCTAssertTrue(keys.contains(AppPreferenceKey.hotkeyKeyCode))
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
