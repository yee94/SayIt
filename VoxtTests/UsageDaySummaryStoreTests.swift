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

    func testResolvedSyncDeviceIDPrefersDictionaryThenUsageThenGenerates() {
        let suite = UserDefaults(suiteName: "usage-device-\(UUID().uuidString)")!

        suite.set("dict-device", forKey: AppPreferenceKey.dictionarySyncDeviceId)
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), "dict-device")

        suite.removeObject(forKey: AppPreferenceKey.dictionarySyncDeviceId)
        suite.set("usage-device", forKey: AppPreferenceKey.usageSyncDeviceId)
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), "usage-device")

        suite.removeObject(forKey: AppPreferenceKey.usageSyncDeviceId)
        let generated = UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite)
        XCTAssertFalse(generated.isEmpty)
        XCTAssertEqual(suite.string(forKey: AppPreferenceKey.usageSyncDeviceId), generated)
        XCTAssertEqual(UsageDaySummaryStore.resolvedSyncDeviceID(defaults: suite), generated)
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
