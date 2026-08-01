// VoxtLogFileStoreTests.swift
// Provides Voxt Log File Store Tests for Voxt test coverage.

import XCTest
@testable import Voxt

final class VoxtLogFileStoreTests: XCTestCase {
    // XCTest app-host crashes while checking deallocation of short-lived stores on macOS 26.
    private nonisolated(unsafe) static var retainedStores: [VoxtLogFileStore] = []

    func testMigratesLegacyLogWithoutImportingItIntoCurrentLog() throws {
        let directory = try makeTemporaryLogDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let legacyLogURL = directory.appendingPathComponent("voxt.log")
        try "legacy secret apiKey=old-secret\n".write(to: legacyLogURL, atomically: true, encoding: .utf8)

        let store = VoxtLogFileStore(baseDirectoryURL: directory)
        Self.retainedStores.append(store)
        store.append("[SayIt] new line")
        store.flush()

        let legacyExists = FileManager.default.fileExists(atPath: legacyLogURL.path)
        XCTAssertFalse(legacyExists)
        let legacyDirectory = directory.appendingPathComponent("legacy", isDirectory: true)
        let legacyFiles = try FileManager.default.contentsOfDirectory(atPath: legacyDirectory.path)
        XCTAssertEqual(legacyFiles.count, 1)
        XCTAssertEqual(store.latestLines(limit: 10), ["[SayIt] new line"])
    }

    func testRotatesCurrentLogIntoArchive() throws {
        let directory = try makeTemporaryLogDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = VoxtLogFileStore(maxFileBytes: 70, retainedArchiveCount: 2, baseDirectoryURL: directory)
        Self.retainedStores.append(store)

        store.append("[SayIt] first line with enough bytes to approach the limit")
        store.append("[SayIt] second line that should rotate the current file")
        store.flush()

        let archiveURL = directory
            .appendingPathComponent("archive", isDirectory: true)
            .appendingPathComponent("voxt-1.log")

        XCTAssertTrue(FileManager.default.fileExists(atPath: store.currentLogURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: archiveURL.path))
        XCTAssertEqual(store.latestLines(limit: 1), ["[SayIt] second line that should rotate the current file"])
    }

    func testRemovesPersistedUnitTestLaunchLinesWithoutDroppingRealLaunches() {
        let lines = [
            "[SayIt] 2026-06-16T12:02:43.717Z [INFO] [app] SayIt launching.",
            "[SayIt] 2026-06-16T12:02:43.719Z [INFO] [app] Runtime system version: macOS 26.2.0",
            "[SayIt] 2026-06-16T12:02:43.719Z [INFO] [app] SayIt launch running under XCTest; skipping app startup services.",
            "[SayIt] 2026-06-16T13:23:56.235Z [INFO] [app] SayIt launching.",
            "[SayIt] 2026-06-16T13:23:56.266Z [INFO] [update] Sparkle disabled for development or test bundle.",
            "[SayIt] 2026-06-16T13:23:56.904Z [INFO] [app] SayIt launch completed."
        ]

        XCTAssertEqual(
            VoxtLogFileStore.removingUnitTestLaunchLines(from: lines),
            Array(lines[3...])
        )
    }

    private func makeTemporaryLogDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("VoxtLogTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
