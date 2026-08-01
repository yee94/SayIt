// HistoryCorrectionPresentationTests.swift
// Provides History Correction Presentation Tests for Voxt test coverage.

import XCTest
@testable import Voxt

final class HistoryCorrectionPresentationTests: XCTestCase {
    func testCorrectedTextReturnsFinalVisibleText() {
        let text = "我们创建了新的APP，名字叫SayIt，支持语音转文本。"
        let corrected = HistoryCorrectionPresentation.correctedText(
            for: text,
            snapshots: [
                DictionaryCorrectionSnapshot(
                    originalText: "Waxed",
                    correctedText: "SayIt",
                    finalLocation: (text as NSString).range(of: "SayIt").location,
                    finalLength: 5
                )
            ]
        )

        XCTAssertEqual(corrected, text)
    }

    func testSegmentsInlineSingleCorrection() {
        let text = "我们创建了新的APP，名字叫SayIt，支持语音转文本。"
        let segments = HistoryCorrectionPresentation.segments(
            for: text,
            snapshots: [
                DictionaryCorrectionSnapshot(
                    originalText: "Waxed",
                    correctedText: "SayIt",
                    finalLocation: (text as NSString).range(of: "SayIt").location,
                    finalLength: 5
                )
            ]
        )

        XCTAssertEqual(
            segments,
            [
                .plain("我们创建了新的APP，名字叫"),
                .original("Waxed"),
                .corrected("SayIt"),
                .plain("，支持语音转文本。")
            ]
        )
    }

    func testSegmentsPreserveMultipleCorrectionsInOrder() {
        let text = "OpenAI 和 SayIt 都支持语音。"
        let nsText = text as NSString
        let segments = HistoryCorrectionPresentation.segments(
            for: text,
            snapshots: [
                DictionaryCorrectionSnapshot(
                    originalText: "Open Ai",
                    correctedText: "OpenAI",
                    finalLocation: nsText.range(of: "OpenAI").location,
                    finalLength: 6
                ),
                DictionaryCorrectionSnapshot(
                    originalText: "Waxed",
                    correctedText: "SayIt",
                    finalLocation: nsText.range(of: "SayIt").location,
                    finalLength: 5
                )
            ]
        )

        XCTAssertEqual(
            segments,
            [
                .original("Open Ai"),
                .corrected("OpenAI"),
                .plain(" 和 "),
                .original("Waxed"),
                .corrected("SayIt"),
                .plain(" 都支持语音。")
            ]
        )
    }

    func testSegmentsIgnoreInvalidSnapshots() {
        let segments = HistoryCorrectionPresentation.segments(
            for: "SayIt",
            snapshots: [
                DictionaryCorrectionSnapshot(
                    originalText: "Waxed",
                    correctedText: "SayIt",
                    finalLocation: 99,
                    finalLength: 5
                )
            ]
        )

        XCTAssertEqual(segments, [.plain("SayIt")])
    }
}
