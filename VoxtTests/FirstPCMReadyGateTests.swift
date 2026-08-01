// FirstPCMReadyGateTests.swift
// Deterministic unit tests for first-PCM readiness latch.

import XCTest
@testable import Voxt

final class FirstPCMReadyGateTests: XCTestCase {
    func testNoteValidPCMResolvesReadyOnceAndKeepsSubsequentNotesNoOp() async {
        let gate = FirstPCMReadyGate()

        let waitTask = Task {
            await gate.wait(timeout: .seconds(2))
        }

        // Yield so the wait installs its continuation before we signal.
        await Task.yield()
        XCTAssertTrue(gate.noteValidPCM())
        XCTAssertFalse(gate.noteValidPCM())

        let outcome = await waitTask.value
        XCTAssertEqual(outcome, .ready)
    }

    func testWaitTimesOutWhenNoPCMArrives() async {
        let gate = FirstPCMReadyGate()
        let outcome = await gate.wait(timeout: .milliseconds(20))
        XCTAssertEqual(outcome, .timedOut)
        // Late PCM after timeout must not flip a settled gate.
        XCTAssertFalse(gate.noteValidPCM())
        let lateWait = await gate.wait(timeout: .milliseconds(5))
        XCTAssertEqual(lateWait, .timedOut)
    }

    func testCancelResolvesCancelledAndBeatsTimeout() async {
        let gate = FirstPCMReadyGate()

        let waitTask = Task {
            await gate.wait(timeout: .seconds(2))
        }
        await Task.yield()
        XCTAssertTrue(gate.cancel())
        XCTAssertFalse(gate.cancel())

        let outcome = await waitTask.value
        XCTAssertEqual(outcome, .cancelled)
    }

    func testNoteFailureResolvesFailedBeforeReady() async {
        let gate = FirstPCMReadyGate()
        XCTAssertTrue(gate.noteFailure("stream disconnected"))
        XCTAssertFalse(gate.noteValidPCM())
        let outcome = await gate.wait(timeout: .milliseconds(5))
        XCTAssertEqual(outcome, .failed("stream disconnected"))
    }

    func testReadyAfterResetAllowsReuse() async {
        let gate = FirstPCMReadyGate()
        XCTAssertTrue(gate.noteValidPCM())
        let first = await gate.wait(timeout: .milliseconds(5))
        XCTAssertEqual(first, .ready)

        gate.reset()
        let waitTask = Task {
            await gate.wait(timeout: .seconds(2))
        }
        await Task.yield()
        XCTAssertTrue(gate.noteValidPCM())
        let second = await waitTask.value
        XCTAssertEqual(second, .ready)
    }

    func testTimeoutUserMessageIsLocalizedKey() {
        let message = FirstPCMReadyGate.timeoutUserMessage
        XCTAssertFalse(message.isEmpty)
        let lower = message.lowercased()
        XCTAssertTrue(
            lower.contains("bluetooth")
                || message.contains("蓝牙")
                || message.contains("マイク")
                || lower.contains("microphone")
                || message.contains("麦克风")
        )
    }
}
