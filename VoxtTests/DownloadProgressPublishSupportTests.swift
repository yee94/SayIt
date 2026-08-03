// DownloadProgressPublishSupportTests.swift
// Provides Download Progress Publish Support Tests for Voxt test coverage.

import XCTest
@testable import Voxt

final class DownloadProgressPublishSupportTests: XCTestCase {
    func testPublishesWhenCurrentFileChanges() {
        XCTAssertTrue(
            DownloadProgressPublishSupport.shouldPublishDownloadingUpdate(
                previousProgress: 0.10,
                previousCompleted: 10,
                previousTotal: 100,
                previousCurrentFile: "a.bin",
                previousCompletedFiles: 0,
                previousTotalFiles: 2,
                nextProgress: 0.10,
                nextCompleted: 10,
                nextTotal: 100,
                nextCurrentFile: "b.bin",
                nextCompletedFiles: 0,
                nextTotalFiles: 2
            )
        )
    }

    func testPublishesWhenCompletedFilesChange() {
        XCTAssertTrue(
            DownloadProgressPublishSupport.shouldPublishDownloadingUpdate(
                previousProgress: 0.50,
                previousCompleted: 50,
                previousTotal: 100,
                previousCurrentFile: nil,
                previousCompletedFiles: 0,
                previousTotalFiles: 2,
                nextProgress: 0.50,
                nextCompleted: 50,
                nextTotal: 100,
                nextCurrentFile: nil,
                nextCompletedFiles: 1,
                nextTotalFiles: 2
            )
        )
    }

    func testSkipsTinyProgressNoise() {
        XCTAssertFalse(
            DownloadProgressPublishSupport.shouldPublishDownloadingUpdate(
                previousProgress: 0.200,
                previousCompleted: 200_000,
                previousTotal: 1_000_000,
                previousCurrentFile: "weights.safetensors",
                previousCompletedFiles: 1,
                previousTotalFiles: 3,
                nextProgress: 0.204,
                nextCompleted: 204_000,
                nextTotal: 1_000_000,
                nextCurrentFile: "weights.safetensors",
                nextCompletedFiles: 1,
                nextTotalFiles: 3
            )
        )
    }

    func testPublishesMeaningfulProgressDelta() {
        XCTAssertTrue(
            DownloadProgressPublishSupport.shouldPublishDownloadingUpdate(
                previousProgress: 0.20,
                previousCompleted: 200_000,
                previousTotal: 1_000_000,
                previousCurrentFile: "weights.safetensors",
                previousCompletedFiles: 1,
                previousTotalFiles: 3,
                nextProgress: 0.22,
                nextCompleted: 220_000,
                nextTotal: 1_000_000,
                nextCurrentFile: "weights.safetensors",
                nextCompletedFiles: 1,
                nextTotalFiles: 3
            )
        )
    }

    func testPublishesLargeCompletedByteDeltaEvenIfProgressLooksSmall() {
        XCTAssertTrue(
            DownloadProgressPublishSupport.shouldPublishDownloadingUpdate(
                previousProgress: 0.50,
                previousCompleted: 10_000_000,
                previousTotal: 100_000_000,
                previousCurrentFile: "weights.safetensors",
                previousCompletedFiles: 1,
                previousTotalFiles: 3,
                nextProgress: 0.505,
                nextCompleted: 10_500_000,
                nextTotal: 100_000_000,
                nextCurrentFile: "weights.safetensors",
                nextCompletedFiles: 1,
                nextTotalFiles: 3
            )
        )
    }

    func testAlwaysPublishesNearCompletion() {
        XCTAssertTrue(
            DownloadProgressPublishSupport.shouldPublishDownloadingUpdate(
                previousProgress: 0.998,
                previousCompleted: 998,
                previousTotal: 1000,
                previousCurrentFile: "weights.safetensors",
                previousCompletedFiles: 2,
                previousTotalFiles: 3,
                nextProgress: 0.999,
                nextCompleted: 999,
                nextTotal: 1000,
                nextCurrentFile: "weights.safetensors",
                nextCompletedFiles: 2,
                nextTotalFiles: 3
            )
        )
    }
}
