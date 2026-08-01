// DictionaryFolderSyncTests.swift
// Tests for folder-based dictionary snapshot merge and CSV codec.

import XCTest
@testable import Voxt

final class DictionaryFolderSyncTests: XCTestCase {
    func testSerializeAndParseCSVRoundTrip() {
        let entries = [
            DictionarySyncSnapshotEntry(
                id: "11111111-1111-1111-1111-111111111111",
                term: "SayIt",
                weight: 5,
                source: "manual",
                createdAt: "2026-01-01T00:00:00Z"
            ),
            DictionarySyncSnapshotEntry(
                id: "22222222-2222-2222-2222-222222222222",
                term: "Hello, \"world\"",
                weight: 2,
                source: "ai",
                createdAt: "2026-01-02T00:00:00Z"
            )
        ]

        let csv = DictionaryCloudSyncService.serializeCSV(entries)
        XCTAssertTrue(csv.contains(DictionaryCloudSyncService.csvHeader))
        let parsed = DictionaryCloudSyncService.parseCSV(csv)
        XCTAssertEqual(parsed.count, 2)
        XCTAssertEqual(parsed[0].term, "SayIt")
        XCTAssertEqual(parsed[1].term, "Hello, \"world\"")
        XCTAssertEqual(parsed[1].source, "ai")
    }

    func testMergeTakesMaxWeightAndPrefersManualSource() {
        let a = DictionarySyncSnapshotEntry(
            id: "a",
            term: "SayIt",
            weight: 2,
            source: "ai",
            createdAt: "2026-01-01T00:00:00Z"
        )
        let b = DictionarySyncSnapshotEntry(
            id: "b",
            term: "sayit",
            weight: 7,
            source: "manual",
            createdAt: "2026-01-02T00:00:00Z"
        )

        let merged = DictionaryCloudSyncService.mergeSnapshots([
            (deviceId: "device-a", entries: [a]),
            (deviceId: "device-b", entries: [b])
        ])

        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].weight, 7)
        XCTAssertEqual(merged[0].source, "manual")
        XCTAssertEqual(merged[0].id, "b")
    }

    func testMergeUsesCreatedAtThenDeviceIdAsTieBreakers() {
        let older = DictionarySyncSnapshotEntry(
            id: "old",
            term: "Term",
            weight: 1,
            source: "ai",
            createdAt: "2026-01-01T00:00:00Z"
        )
        let newer = DictionarySyncSnapshotEntry(
            id: "new",
            term: "Term",
            weight: 1,
            source: "ai",
            createdAt: "2026-01-03T00:00:00Z"
        )

        let merged = DictionaryCloudSyncService.mergeSnapshots([
            (deviceId: "aaa", entries: [older]),
            (deviceId: "zzz", entries: [newer])
        ])
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].id, "new")
    }

    func testWriteAndListSnapshots() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("voxt-dict-sync-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let content = DictionaryCloudSyncService.serializeCSV([
            DictionarySyncSnapshotEntry(
                id: "id-1",
                term: "Alpha",
                weight: 1,
                source: "manual",
                createdAt: "2026-01-01T00:00:00Z"
            )
        ])
        try DictionaryCloudSyncService.writeSnapshot(
            content: content,
            directoryURL: directory,
            deviceId: "device-1"
        )

        let snapshots = try DictionaryCloudSyncService.listSnapshots(in: directory)
        XCTAssertEqual(snapshots.count, 1)
        XCTAssertEqual(snapshots[0].deviceId, "device-1")
        XCTAssertTrue(snapshots[0].content.contains("Alpha"))
    }
}
