// UsageDaySummaryStoreTests.swift
// Provides UsageDaySummaryStore coverage for local per-day usage accumulation.

import XCTest
@testable import Voxt

@MainActor
final class UsageDaySummaryStoreTests: XCTestCase {
    private static var retainedObjects: [AnyObject] = []
    private var temporaryURLs: [URL] = []

    override func tearDownWithError() throws {
        temporaryURLs = []
        try super.tearDownWithError()
    }

    func testRecordSessionAccumulatesSameDayTotalsAndApps() throws {
        let database = try makeDatabase()
        let defaults = UserDefaults(suiteName: "usage-day-\(UUID().uuidString)")!
        defaults.set("device-A", forKey: AppPreferenceKey.usageSyncDeviceId)
        let store = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "device-A"))

        let day = Date(timeIntervalSince1970: 1_700_000_000) // fixed day
        store.recordSession(
            createdAt: day,
            text: "hello",
            isTranslation: false,
            kind: .normal,
            duration: 10,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        store.recordSession(
            createdAt: day.addingTimeInterval(60),
            text: "world!",
            isTranslation: true,
            kind: .translation,
            duration: 5,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        store.recordSession(
            createdAt: day.addingTimeInterval(120),
            text: "browser",
            isTranslation: false,
            kind: .normal,
            duration: 3,
            appName: "Safari",
            appBundleID: nil,
            browserURLHost: "example.com"
        )

        let dayKey = UsageDaySummaryStore.dayString(for: day)
        let snapshot = try XCTUnwrap(store.snapshot(day: dayKey))
        XCTAssertEqual(snapshot.deviceID, "device-A")
        XCTAssertEqual(snapshot.sessionCount, 3)
        XCTAssertEqual(snapshot.characters, "hello".count + "world!".count + "browser".count)
        XCTAssertEqual(snapshot.translationCharacters, "world!".count)
        XCTAssertEqual(snapshot.dictationSeconds, 18, accuracy: 0.001)

        let notesApp = try XCTUnwrap(snapshot.apps["com.apple.Notes"])
        XCTAssertEqual(notesApp.name, "Notes")
        XCTAssertEqual(notesApp.characters, "hello".count + "world!".count)
        XCTAssertEqual(notesApp.dictationSeconds, 15, accuracy: 0.001)

        let webApp = try XCTUnwrap(snapshot.apps["web:example.com"])
        XCTAssertEqual(webApp.characters, "browser".count)
        XCTAssertEqual(webApp.dictationSeconds, 3, accuracy: 0.001)
    }

    func testTranscriptKindCountsTotalsButSkipsApps() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-T"))
        let day = Date(timeIntervalSince1970: 1_700_100_000)

        store.recordSession(
            createdAt: day,
            text: "meeting notes",
            isTranslation: false,
            kind: .transcript,
            duration: 42,
            appName: "Zoom",
            appBundleID: "us.zoom.xos",
            browserURLHost: nil
        )

        let snapshot = try XCTUnwrap(store.snapshot(day: UsageDaySummaryStore.dayString(for: day)))
        XCTAssertEqual(snapshot.sessionCount, 1)
        XCTAssertEqual(snapshot.characters, "meeting notes".count)
        XCTAssertEqual(snapshot.dictationSeconds, 42, accuracy: 0.001)
        XCTAssertTrue(snapshot.apps.isEmpty)
    }

    func testDailyTotalsSplitsAcrossDays() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-B"))

        let day1 = Date(timeIntervalSince1970: 1_700_000_000)
        let day2 = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: day1))!

        store.recordSession(
            createdAt: day1,
            text: "day1",
            isTranslation: false,
            kind: .normal,
            duration: 1,
            appName: nil,
            appBundleID: "com.a",
            browserURLHost: nil
        )
        store.recordSession(
            createdAt: day2,
            text: "daytwo",
            isTranslation: false,
            kind: .normal,
            duration: 2,
            appName: nil,
            appBundleID: "com.b",
            browserURLHost: nil
        )

        let totals = store.dailyTotals(lastDays: 30)
        let key1 = UsageDaySummaryStore.dayString(for: day1)
        let key2 = UsageDaySummaryStore.dayString(for: day2)
        XCTAssertEqual(totals.count, 2)
        XCTAssertEqual(totals[key1]?.characters, "day1".count)
        XCTAssertEqual(totals[key1]?.sessionCount, 1)
        XCTAssertEqual(totals[key2]?.characters, "daytwo".count)
        XCTAssertEqual(totals[key2]?.sessionCount, 1)
    }

    func testRecordRewriteDeltaAdjustsCharactersWithoutSessionCount() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-C"))
        let day = Date(timeIntervalSince1970: 1_700_200_000)

        store.recordSession(
            createdAt: day,
            text: "abcd",
            isTranslation: false,
            kind: .normal,
            duration: 10,
            appName: "X",
            appBundleID: "com.x",
            browserURLHost: nil
        )
        store.recordRewriteDelta(
            updatedAt: day,
            oldText: "abcd",
            newText: "abcdefgh",
            oldDuration: 10,
            newDuration: 15,
            appName: "X",
            appBundleID: "com.x",
            browserURLHost: nil
        )

        let snapshot = try XCTUnwrap(store.snapshot(day: UsageDaySummaryStore.dayString(for: day)))
        XCTAssertEqual(snapshot.sessionCount, 1)
        XCTAssertEqual(snapshot.characters, 8)
        XCTAssertEqual(snapshot.dictationSeconds, 15, accuracy: 0.001)
        XCTAssertEqual(snapshot.apps["com.x"]?.characters, 8)
        XCTAssertEqual(snapshot.apps["com.x"]?.dictationSeconds ?? 0, 15, accuracy: 0.001)
    }

    func testRecordRewriteDeltaClampsNegativeValuesToZero() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-D"))
        let day = Date(timeIntervalSince1970: 1_700_300_000)

        store.recordSession(
            createdAt: day,
            text: "hi",
            isTranslation: false,
            kind: .normal,
            duration: 2,
            appName: nil,
            appBundleID: "com.y",
            browserURLHost: nil
        )
        store.recordRewriteDelta(
            updatedAt: day,
            oldText: "hello world",
            newText: "",
            oldDuration: 100,
            newDuration: 0,
            appName: nil,
            appBundleID: "com.y",
            browserURLHost: nil
        )

        let snapshot = try XCTUnwrap(store.snapshot(day: UsageDaySummaryStore.dayString(for: day)))
        XCTAssertEqual(snapshot.sessionCount, 1)
        XCTAssertEqual(snapshot.characters, 0)
        XCTAssertEqual(snapshot.dictationSeconds, 0, accuracy: 0.001)
        XCTAssertEqual(snapshot.apps["com.y"]?.characters, 0)
        XCTAssertEqual(snapshot.apps["com.y"]?.dictationSeconds ?? 0, 0, accuracy: 0.001)
    }

    func testResolvedSyncDeviceIDPrefersUnifiedThenDictionaryThenUsageThenGenerates() {
        let suite = UserDefaults(suiteName: "usage-device-\(UUID().uuidString)")!

        suite.set("unified-device", forKey: AppPreferenceKey.syncDeviceId)
        suite.set("dict-device", forKey: AppPreferenceKey.dictionarySyncDeviceId)
        suite.set("usage-device", forKey: AppPreferenceKey.usageSyncDeviceId)
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), "unified-device")

        suite.removeObject(forKey: AppPreferenceKey.syncDeviceId)
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), "dict-device")
        // Legacy dictionary id is migrated into the unified key; legacy key remains.
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.syncDeviceId), "dict-device")
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.dictionarySyncDeviceId), "dict-device")

        suite.removeObject(forKey: AppPreferenceKey.syncDeviceId)
        suite.removeObject(forKey: AppPreferenceKey.dictionarySyncDeviceId)
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), "usage-device")
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.syncDeviceId), "usage-device")
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.usageSyncDeviceId), "usage-device")

        suite.removeObject(forKey: AppPreferenceKey.syncDeviceId)
        suite.removeObject(forKey: AppPreferenceKey.usageSyncDeviceId)
        let generated = UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite)
        XCTAssertFalse(generated.isEmpty)
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.syncDeviceId), generated)
        XCTAssertNil(suite.string(forKey: AppPreferenceKey.usageSyncDeviceId))
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), generated)
    }

    func testDictionaryAndUsageShareResolvedSyncDeviceID() {
        let suite = UserDefaults(suiteName: "usage-shared-device-\(UUID().uuidString)")!
        suite.set("shared-device", forKey: AppPreferenceKey.dictionarySyncDeviceId)
        let usageID = UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite)
        let dictionaryService = DictionaryCloudSyncService(
            dictionaryStore: DictionaryStore(
                defaults: suite,
                fileManager: .default,
                initialEntries: [],
                persistenceEnabled: false
            ),
            defaults: suite
        )
        XCTAssertEqual(usageID, "shared-device")
        XCTAssertEqual(dictionaryService.deviceId, usageID)
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.syncDeviceId), "shared-device")
    }

    func testHistoryAppendInvokesUsageRecorder() throws {
        let spy = retain(UsageDaySummaryRecordingSpy())
        let database = try makeDatabase()
        let repository = retain(HistoryRepository(database: database, legacyJSONURL: nil, migrateLegacyJSON: false))
        let store = retain(
            TranscriptionHistoryStore(
                repository: repository,
                usageRecorder: spy
            )
        )

        let entryID = store.append(
            text: "recorded",
            transcriptionEngine: "engine",
            transcriptionModel: "model",
            enhancementMode: "mode",
            enhancementModel: "enhanced",
            kind: .normal,
            isTranslation: false,
            audioDurationSeconds: 7,
            transcriptionProcessingDurationSeconds: nil,
            llmDurationSeconds: nil,
            focusedAppName: "Notes",
            focusedAppBundleID: "com.apple.Notes",
            matchedGroupID: nil,
            matchedGroupName: nil,
            matchedAppGroupName: nil,
            matchedURLGroupName: nil,
            remoteASRProvider: nil,
            remoteASRModel: nil,
            remoteASREndpoint: nil,
            remoteLLMProvider: nil,
            remoteLLMModel: nil,
            remoteLLMEndpoint: nil,
            whisperWordTimings: nil,
            dictionaryHitTerms: [],
            dictionaryCorrectedTerms: [],
            dictionarySuggestedTerms: []
        )

        XCTAssertNotNil(entryID)
        XCTAssertEqual(spy.sessionCalls.count, 1)
        let call = try XCTUnwrap(spy.sessionCalls.first)
        XCTAssertEqual(call.text, "recorded")
        XCTAssertEqual(call.duration, 7)
        XCTAssertEqual(call.kind, .normal)
        XCTAssertEqual(call.appBundleID, "com.apple.Notes")
        XCTAssertEqual(spy.rewriteCalls.count, 0)
    }

    func testAggregatedSnapshotSumsTwoDevicesSameDayAndMergesSameApp() throws {
        let database = try makeDatabase()
        let storeA = retain(UsageDaySummaryStore(database: database, deviceID: "device-A"))
        let storeB = retain(UsageDaySummaryStore(database: database, deviceID: "device-B"))
        let day = Date(timeIntervalSince1970: 1_700_400_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)

        storeA.recordSession(
            createdAt: day,
            text: "hello",
            isTranslation: false,
            kind: .normal,
            duration: 10,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        storeB.recordSession(
            createdAt: day,
            text: "world!",
            isTranslation: true,
            kind: .translation,
            duration: 5,
            appName: "备忘录",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        storeB.recordSession(
            createdAt: day.addingTimeInterval(30),
            text: "web",
            isTranslation: false,
            kind: .normal,
            duration: 3,
            appName: "Safari",
            appBundleID: nil,
            browserURLHost: "example.com"
        )

        // Current-device APIs remain device-scoped.
        let localA = try XCTUnwrap(storeA.snapshot(day: dayKey))
        XCTAssertEqual(localA.deviceID, "device-A")
        XCTAssertEqual(localA.sessionCount, 1)
        XCTAssertEqual(localA.characters, "hello".count)
        XCTAssertEqual(localA.dictationSeconds, 10, accuracy: 0.001)

        let aggregated = try XCTUnwrap(storeA.aggregatedSnapshot(day: dayKey))
        XCTAssertEqual(aggregated.day, dayKey)
        XCTAssertEqual(aggregated.deviceID, "")
        XCTAssertEqual(aggregated.sessionCount, 3)
        XCTAssertEqual(aggregated.characters, "hello".count + "world!".count + "web".count)
        XCTAssertEqual(aggregated.translationCharacters, "world!".count)
        XCTAssertEqual(aggregated.dictationSeconds, 18, accuracy: 0.001)

        let notesApp = try XCTUnwrap(aggregated.apps["com.apple.Notes"])
        XCTAssertEqual(notesApp.name, "Notes")
        XCTAssertEqual(notesApp.characters, "hello".count + "world!".count)
        XCTAssertEqual(notesApp.dictationSeconds, 15, accuracy: 0.001)

        let webApp = try XCTUnwrap(aggregated.apps["web:example.com"])
        XCTAssertEqual(webApp.name, "Safari")
        XCTAssertEqual(webApp.characters, "web".count)
        XCTAssertEqual(webApp.dictationSeconds, 3, accuracy: 0.001)

        let totals = storeA.aggregatedDailyTotals(lastDays: 30)
        XCTAssertEqual(totals.count, 1)
        XCTAssertEqual(totals[dayKey]?.sessionCount, 3)
        XCTAssertEqual(totals[dayKey]?.characters, aggregated.characters)
    }

    func testExportedSnapshotsForAllDevicesIncludesPeersInStableOrder() throws {
        let database = try makeDatabase()
        let storeA = retain(UsageDaySummaryStore(database: database, deviceID: "device-A"))
        let storeB = retain(UsageDaySummaryStore(database: database, deviceID: "device-B"))
        let day = Date(timeIntervalSince1970: 1_700_400_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)
        let olderDay = day.addingTimeInterval(-86_400)
        let olderDayKey = UsageDaySummaryStore.dayString(for: olderDay)

        storeA.recordSession(
            createdAt: day,
            text: "local-a",
            isTranslation: false,
            kind: .normal,
            duration: 4,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        storeB.recordSession(
            createdAt: day,
            text: "peer-b",
            isTranslation: false,
            kind: .normal,
            duration: 6,
            appName: "Safari",
            appBundleID: "com.apple.Safari",
            browserURLHost: nil
        )
        storeA.recordSession(
            createdAt: olderDay,
            text: "older-a",
            isTranslation: false,
            kind: .normal,
            duration: 2,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )

        // Local-only export stays device-scoped (folder sync).
        let localOnly = storeA.exportedSnapshots()
        XCTAssertEqual(localOnly.count, 2)
        XCTAssertTrue(localOnly.allSatisfy { $0.deviceID == "device-A" })

        // Package export includes every (day, deviceID) with stable day DESC, deviceID ASC.
        let allDevices = storeA.exportedSnapshotsForAllDevices()
        XCTAssertEqual(allDevices.count, 3)
        XCTAssertEqual(allDevices.map(\.day), [dayKey, dayKey, olderDayKey])
        XCTAssertEqual(allDevices.map(\.deviceID), ["device-A", "device-B", "device-A"])
        XCTAssertEqual(allDevices[0].characters, "local-a".count)
        XCTAssertEqual(allDevices[1].characters, "peer-b".count)
        XCTAssertEqual(allDevices[2].characters, "older-a".count)
    }

    func testLocalRecordAndImportPublishDidChange() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-E"))
        let day = Date(timeIntervalSince1970: 1_700_500_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)

        var changeCount = 0
        var localChangeCount = 0
        let cancellable = store.didChangePublisher.sink { changeCount += 1 }
        let localCancellable = store.didLocalChangePublisher.sink { localChangeCount += 1 }
        defer {
            _ = cancellable
            _ = localCancellable
        }

        store.recordSession(
            createdAt: day,
            text: "local",
            isTranslation: false,
            kind: .normal,
            duration: 2,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )
        XCTAssertEqual(changeCount, 1)
        XCTAssertEqual(localChangeCount, 1)

        let remote = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-remote",
            dictationSeconds: 7,
            characters: 11,
            translationCharacters: 4,
            sessionCount: 1,
            apps: [
                "com.apple.Notes": UsageDailyAppValue(
                    name: "Notes",
                    characters: 11,
                    dictationSeconds: 7
                )
            ],
            updatedAt: Date(timeIntervalSince1970: 1_700_500_100)
        )
        store.importSnapshots([remote])
        XCTAssertEqual(changeCount, 2)
        // Remote import must not schedule local-change push.
        XCTAssertEqual(localChangeCount, 1)

        // Idempotent import (same or older updatedAt) must not publish.
        store.importSnapshots([remote])
        XCTAssertEqual(changeCount, 2)
        XCTAssertEqual(localChangeCount, 1)

        let aggregated = try XCTUnwrap(store.aggregatedSnapshot(day: dayKey))
        XCTAssertEqual(aggregated.sessionCount, 2)
        XCTAssertEqual(aggregated.characters, "local".count + 11)
        XCTAssertEqual(aggregated.dictationSeconds, 9, accuracy: 0.001)
        XCTAssertEqual(aggregated.apps["com.apple.Notes"]?.characters, "local".count + 11)
    }

    func testLegacyUsageDeviceRowsMergeIntoUnifiedIDWithoutDoubleCounting() throws {
        let database = try makeDatabase()
        // Seed without a mismatched legacy key so init migration does not run early.
        let seedDefaults = UserDefaults(suiteName: "usage-migrate-seed-\(UUID().uuidString)")!
        let day = Date(timeIntervalSince1970: 1_700_600_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)
        let older = Date(timeIntervalSince1970: 1_700_600_010)
        let newer = Date(timeIntervalSince1970: 1_700_600_050)

        let seeder = retain(UsageDaySummaryStore(database: database, defaults: seedDefaults, deviceID: "seeder"))
        seeder.importSnapshots([
            UsageDailySnapshot(
                day: dayKey,
                deviceID: "legacy-usage-device",
                dictationSeconds: 10,
                characters: 20,
                translationCharacters: 5,
                sessionCount: 2,
                apps: [
                    "com.apple.Notes": UsageDailyAppValue(
                        name: "Notes",
                        characters: 20,
                        dictationSeconds: 10
                    )
                ],
                updatedAt: older
            ),
            UsageDailySnapshot(
                day: dayKey,
                deviceID: "unified-device",
                dictationSeconds: 4,
                characters: 8,
                translationCharacters: 3,
                sessionCount: 1,
                apps: [
                    "com.apple.Notes": UsageDailyAppValue(
                        name: nil,
                        characters: 5,
                        dictationSeconds: 2
                    ),
                    "web:example.com": UsageDailyAppValue(
                        name: "Safari",
                        characters: 3,
                        dictationSeconds: 2
                    )
                ],
                updatedAt: newer
            ),
            // Imported peer must not be treated as local legacy history.
            UsageDailySnapshot(
                day: dayKey,
                deviceID: "other-physical-device",
                dictationSeconds: 100,
                characters: 200,
                translationCharacters: 0,
                sessionCount: 9,
                apps: [
                    "com.other.App": UsageDailyAppValue(
                        name: "Other",
                        characters: 200,
                        dictationSeconds: 100
                    )
                ],
                updatedAt: newer
            )
        ])

        // Now expose the mismatch: unified sync id + historical usage id → migrate on init.
        let defaults = UserDefaults(suiteName: "usage-migrate-\(UUID().uuidString)")!
        defaults.set("unified-device", forKey: AppPreferenceKey.syncDeviceId)
        defaults.set("legacy-usage-device", forKey: AppPreferenceKey.usageSyncDeviceId)
        let store = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "unified-device"))

        let legacyProbe = retain(UsageDaySummaryStore(database: database, deviceID: "legacy-usage-device"))
        XCTAssertNil(legacyProbe.snapshot(day: dayKey))

        let local = try XCTUnwrap(store.snapshot(day: dayKey))
        XCTAssertEqual(local.deviceID, "unified-device")
        XCTAssertEqual(local.sessionCount, 3)
        XCTAssertEqual(local.characters, 28)
        XCTAssertEqual(local.translationCharacters, 8)
        XCTAssertEqual(local.dictationSeconds, 14, accuracy: 0.001)
        XCTAssertEqual(local.updatedAt, newer)

        let notes = try XCTUnwrap(local.apps["com.apple.Notes"])
        XCTAssertEqual(notes.name, "Notes")
        XCTAssertEqual(notes.characters, 25)
        XCTAssertEqual(notes.dictationSeconds, 12, accuracy: 0.001)
        XCTAssertEqual(local.apps["web:example.com"]?.characters, 3)

        // Aggregation: unified local (merged once) + peer; no double-count of legacy.
        let aggregated = try XCTUnwrap(store.aggregatedSnapshot(day: dayKey))
        XCTAssertEqual(aggregated.sessionCount, 3 + 9)
        XCTAssertEqual(aggregated.characters, 28 + 200)
        XCTAssertEqual(aggregated.dictationSeconds, 14 + 100, accuracy: 0.001)
        XCTAssertEqual(aggregated.apps["com.other.App"]?.characters, 200)

        // Peer row must remain under its own device id.
        let peerProbe = retain(UsageDaySummaryStore(database: database, deviceID: "other-physical-device"))
        let peer = try XCTUnwrap(peerProbe.snapshot(day: dayKey))
        XCTAssertEqual(peer.sessionCount, 9)
        XCTAssertEqual(peer.characters, 200)
    }

    func testLegacyUsageMigrationNoopsWhenLegacyKeyMatchesCurrent() throws {
        let database = try makeDatabase()
        let defaults = UserDefaults(suiteName: "usage-migrate-same-\(UUID().uuidString)")!
        defaults.set("same-device", forKey: AppPreferenceKey.syncDeviceId)
        defaults.set("same-device", forKey: AppPreferenceKey.usageSyncDeviceId)

        let day = Date(timeIntervalSince1970: 1_700_700_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)
        let seed = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "same-device"))
        seed.importSnapshots([
            UsageDailySnapshot(
                day: dayKey,
                deviceID: "same-device",
                dictationSeconds: 3,
                characters: 6,
                translationCharacters: 0,
                sessionCount: 1,
                apps: [:],
                updatedAt: Date(timeIntervalSince1970: 1_700_700_010)
            )
        ])

        let store = retain(UsageDaySummaryStore(database: database, defaults: defaults, deviceID: "same-device"))
        let snapshot = try XCTUnwrap(store.snapshot(day: dayKey))
        XCTAssertEqual(snapshot.sessionCount, 1)
        XCTAssertEqual(snapshot.characters, 6)
        XCTAssertEqual(store.aggregatedSnapshot(day: dayKey)?.sessionCount, 1)
    }
}

// MARK: - Helpers

@MainActor
private final class UsageDaySummaryRecordingSpy: UsageDaySummaryRecording {
    struct SessionCall {
        let createdAt: Date
        let text: String
        let isTranslation: Bool
        let kind: TranscriptionHistoryKind
        let duration: TimeInterval?
        let appName: String?
        let appBundleID: String?
        let browserURLHost: String?
    }

    struct RewriteCall {
        let updatedAt: Date
        let oldText: String
        let newText: String
        let oldDuration: TimeInterval?
        let newDuration: TimeInterval?
    }

    private(set) var sessionCalls: [SessionCall] = []
    private(set) var rewriteCalls: [RewriteCall] = []

    func recordSession(
        createdAt: Date,
        text: String,
        isTranslation: Bool,
        kind: TranscriptionHistoryKind,
        duration: TimeInterval?,
        appName: String?,
        appBundleID: String?,
        browserURLHost: String?
    ) {
        sessionCalls.append(
            SessionCall(
                createdAt: createdAt,
                text: text,
                isTranslation: isTranslation,
                kind: kind,
                duration: duration,
                appName: appName,
                appBundleID: appBundleID,
                browserURLHost: browserURLHost
            )
        )
    }

    func recordRewriteDelta(
        updatedAt: Date,
        oldText: String,
        newText: String,
        oldDuration: TimeInterval?,
        newDuration: TimeInterval?,
        appName: String?,
        appBundleID: String?,
        browserURLHost: String?
    ) {
        rewriteCalls.append(
            RewriteCall(
                updatedAt: updatedAt,
                oldText: oldText,
                newText: newText,
                oldDuration: oldDuration,
                newDuration: newDuration
            )
        )
    }
}

private extension UsageDaySummaryStoreTests {
    func makeDatabase() throws -> VoxtDatabase {
        let directory = try makeTemporaryDirectory()
        let database = VoxtDatabase(databaseURL: directory.appendingPathComponent("voxt.sqlite"))
        return retain(database)
    }

    func retain<Value: AnyObject>(_ value: Value) -> Value {
        Self.retainedObjects.append(value)
        return value
    }

    func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voxt-usage-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }
}
