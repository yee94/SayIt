// UsageFolderSyncTests.swift
// Offline tests for usage day summary folder snapshot IO and import merge.

import XCTest
@testable import Voxt

@MainActor
final class UsageFolderSyncTests: XCTestCase {
    private static var retainedObjects: [AnyObject] = []
    private var temporaryURLs: [URL] = []

    override func tearDownWithError() throws {
        // Keep temp dirs while retained DB connections may still be open (process exit cleans up).
        temporaryURLs = []
        try super.tearDownWithError()
    }

    func testWriteAndListSnapshotsRoundTrip() throws {
        let directory = try makeTemporaryDirectory()
        let updatedAt = Date(timeIntervalSince1970: 1_700_000_100)
        let days = [
            UsageDailySnapshot(
                day: "2023-11-14",
                deviceID: "device-1",
                dictationSeconds: 12.5,
                characters: 40,
                translationCharacters: 8,
                sessionCount: 2,
                apps: [
                    "com.apple.Notes": UsageDailyAppValue(
                        name: "Notes",
                        characters: 40,
                        dictationSeconds: 12.5
                    )
                ],
                updatedAt: updatedAt
            ),
            UsageDailySnapshot(
                day: "2023-11-15",
                deviceID: "device-1",
                dictationSeconds: 3,
                characters: 5,
                translationCharacters: 0,
                sessionCount: 1,
                apps: [:],
                updatedAt: updatedAt.addingTimeInterval(86_400)
            )
        ]

        try UsageFolderSnapshotIO.writeSnapshot(
            days: days,
            directoryURL: directory,
            deviceId: "device-1"
        )

        let listed = try UsageFolderSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed[0].deviceID, "device-1")
        XCTAssertEqual(listed[0].days.count, 2)

        let first = listed[0].days[0]
        XCTAssertEqual(first.day, "2023-11-14")
        XCTAssertEqual(first.deviceID, "device-1")
        XCTAssertEqual(first.dictationSeconds, 12.5, accuracy: 0.001)
        XCTAssertEqual(first.characters, 40)
        XCTAssertEqual(first.translationCharacters, 8)
        XCTAssertEqual(first.sessionCount, 2)
        XCTAssertEqual(first.apps["com.apple.Notes"]?.name, "Notes")
        XCTAssertEqual(first.apps["com.apple.Notes"]?.characters, 40)
        XCTAssertEqual(first.updatedAt.timeIntervalSince1970, updatedAt.timeIntervalSince1970, accuracy: 0.001)

        let second = listed[0].days[1]
        XCTAssertEqual(second.day, "2023-11-15")
        XCTAssertEqual(second.sessionCount, 1)
        XCTAssertEqual(second.characters, 5)
    }

    func testImportSnapshotsKeepsPerDeviceRowsAndIdempotentOnSameUpdatedAt() throws {
        let database = try makeDatabase()
        let storeA = retain(UsageDaySummaryStore(database: database, deviceID: "device-A"))
        let storeB = retain(UsageDaySummaryStore(database: database, deviceID: "device-B"))

        let day = Date(timeIntervalSince1970: 1_700_000_000)
        let dayKey = UsageDaySummaryStore.dayString(for: day)

        storeA.recordSession(
            createdAt: day,
            text: "local",
            isTranslation: false,
            kind: .normal,
            duration: 4,
            appName: "Notes",
            appBundleID: "com.apple.Notes",
            browserURLHost: nil
        )

        let remoteUpdatedAt = Date(timeIntervalSince1970: 1_700_000_050)
        let remote = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-B",
            dictationSeconds: 9,
            characters: 20,
            translationCharacters: 3,
            sessionCount: 2,
            apps: [
                "com.b": UsageDailyAppValue(name: "B", characters: 20, dictationSeconds: 9)
            ],
            updatedAt: remoteUpdatedAt
        )

        storeA.importSnapshots([remote])

        let localSnapshot = try XCTUnwrap(storeA.snapshot(day: dayKey))
        XCTAssertEqual(localSnapshot.deviceID, "device-A")
        XCTAssertEqual(localSnapshot.characters, "local".count)
        XCTAssertEqual(localSnapshot.sessionCount, 1)

        let remoteSnapshot = try XCTUnwrap(storeB.snapshot(day: dayKey))
        XCTAssertEqual(remoteSnapshot.deviceID, "device-B")
        XCTAssertEqual(remoteSnapshot.characters, 20)
        XCTAssertEqual(remoteSnapshot.sessionCount, 2)
        XCTAssertEqual(remoteSnapshot.dictationSeconds, 9, accuracy: 0.001)
        XCTAssertEqual(remoteSnapshot.apps["com.b"]?.name, "B")

        // Re-import same updatedAt must not regress / duplicate.
        storeA.importSnapshots([remote])
        let remoteAgain = try XCTUnwrap(storeB.snapshot(day: dayKey))
        XCTAssertEqual(remoteAgain.characters, 20)
        XCTAssertEqual(remoteAgain.sessionCount, 2)
        XCTAssertEqual(
            remoteAgain.updatedAt.timeIntervalSince1970,
            remoteUpdatedAt.timeIntervalSince1970,
            accuracy: 0.001
        )

        // Export from A only includes local device rows.
        let exported = storeA.exportedSnapshots()
        XCTAssertEqual(exported.count, 1)
        XCTAssertEqual(exported[0].deviceID, "device-A")
        XCTAssertEqual(exported[0].day, dayKey)
    }

    func testImportSnapshotsSkipsStaleRemoteUpdatedAt() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-R"))
        let dayKey = "2023-11-20"

        let newer = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-R",
            dictationSeconds: 30,
            characters: 100,
            translationCharacters: 10,
            sessionCount: 5,
            apps: [:],
            updatedAt: Date(timeIntervalSince1970: 1_700_500_000)
        )
        store.importSnapshots([newer])

        let stale = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-R",
            dictationSeconds: 1,
            characters: 1,
            translationCharacters: 0,
            sessionCount: 1,
            apps: [:],
            updatedAt: Date(timeIntervalSince1970: 1_700_400_000)
        )
        store.importSnapshots([stale])

        let snapshot = try XCTUnwrap(store.snapshot(day: dayKey))
        XCTAssertEqual(snapshot.characters, 100)
        XCTAssertEqual(snapshot.sessionCount, 5)
        XCTAssertEqual(snapshot.dictationSeconds, 30, accuracy: 0.001)
        XCTAssertEqual(
            snapshot.updatedAt.timeIntervalSince1970,
            newer.updatedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testImportSnapshotsAppliesNewerRemoteUpdatedAt() throws {
        let database = try makeDatabase()
        let store = retain(UsageDaySummaryStore(database: database, deviceID: "device-N"))
        let dayKey = "2023-11-21"

        let older = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-N",
            dictationSeconds: 1,
            characters: 2,
            translationCharacters: 0,
            sessionCount: 1,
            apps: [:],
            updatedAt: Date(timeIntervalSince1970: 1_700_600_000)
        )
        store.importSnapshots([older])

        let newer = UsageDailySnapshot(
            day: dayKey,
            deviceID: "device-N",
            dictationSeconds: 15,
            characters: 50,
            translationCharacters: 4,
            sessionCount: 3,
            apps: [
                "com.n": UsageDailyAppValue(name: "N", characters: 50, dictationSeconds: 15)
            ],
            updatedAt: Date(timeIntervalSince1970: 1_700_700_000)
        )
        store.importSnapshots([newer])

        let snapshot = try XCTUnwrap(store.snapshot(day: dayKey))
        XCTAssertEqual(snapshot.characters, 50)
        XCTAssertEqual(snapshot.sessionCount, 3)
        XCTAssertEqual(snapshot.apps["com.n"]?.name, "N")
        XCTAssertEqual(
            snapshot.updatedAt.timeIntervalSince1970,
            newer.updatedAt.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testListSnapshotsSkipsCorruptAndVersionMismatchFiles() throws {
        let directory = try makeTemporaryDirectory()

        try UsageFolderSnapshotIO.writeSnapshot(
            days: [
                UsageDailySnapshot(
                    day: "2023-11-01",
                    deviceID: "good",
                    dictationSeconds: 1,
                    characters: 1,
                    translationCharacters: 0,
                    sessionCount: 1,
                    apps: [:],
                    updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
                )
            ],
            directoryURL: directory,
            deviceId: "good"
        )

        let badURL = directory.appendingPathComponent("sayit-usage-bad.json")
        try Data("not-json".utf8).write(to: badURL)

        let wrongVersionURL = directory.appendingPathComponent("sayit-usage-v2.json")
        let wrongVersionJSON = """
        {"version":99,"deviceID":"v2","exportedAt":"2023-11-01T00:00:00Z","days":[]}
        """
        try Data(wrongVersionJSON.utf8).write(to: wrongVersionURL)

        let listed = try UsageFolderSnapshotIO.listSnapshots(in: directory)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed[0].deviceID, "good")
        XCTAssertEqual(listed[0].days.count, 1)
    }
}

// MARK: - Helpers

private extension UsageFolderSyncTests {
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
            .appendingPathComponent("voxt-usage-folder-sync-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }
}
