// RecordingSessionOwnedTaskGateTests.swift
// Pure-logic tests for session-owned VAD flush / silence monitor task gating.

import XCTest
@testable import Voxt

final class RecordingSessionOwnedTaskGateTests: XCTestCase {
    func testIsStillOwnerRequiresMatchingSessionAndNonCancelledTask() {
        let sessionID = UUID()

        XCTAssertTrue(
            RecordingSessionOwnedTaskGate.isStillOwner(
                isTaskCancelled: false,
                ownedSessionID: sessionID,
                activeSessionID: sessionID
            )
        )
        XCTAssertFalse(
            RecordingSessionOwnedTaskGate.isStillOwner(
                isTaskCancelled: true,
                ownedSessionID: sessionID,
                activeSessionID: sessionID
            )
        )
        XCTAssertFalse(
            RecordingSessionOwnedTaskGate.isStillOwner(
                isTaskCancelled: false,
                ownedSessionID: sessionID,
                activeSessionID: UUID()
            )
        )
    }

    func testShouldContinueSilenceMonitorRequiresActiveOwnedSession() {
        let sessionID = UUID()

        XCTAssertTrue(
            RecordingSessionOwnedTaskGate.shouldContinueSilenceMonitor(
                isTaskCancelled: false,
                isSessionActive: true,
                ownedSessionID: sessionID,
                activeSessionID: sessionID
            )
        )
        XCTAssertFalse(
            RecordingSessionOwnedTaskGate.shouldContinueSilenceMonitor(
                isTaskCancelled: false,
                isSessionActive: false,
                ownedSessionID: sessionID,
                activeSessionID: sessionID
            )
        )
        XCTAssertFalse(
            RecordingSessionOwnedTaskGate.shouldContinueSilenceMonitor(
                isTaskCancelled: false,
                isSessionActive: true,
                ownedSessionID: sessionID,
                activeSessionID: UUID()
            )
        )
        XCTAssertFalse(
            RecordingSessionOwnedTaskGate.shouldContinueSilenceMonitor(
                isTaskCancelled: true,
                isSessionActive: true,
                ownedSessionID: sessionID,
                activeSessionID: sessionID
            )
        )
    }

    func testStaleVADFlushTaskMustNotStopAfterSessionRollover() async {
        let oldSessionID = UUID()
        let newSessionID = UUID()
        var activeSessionID = oldSessionID
        var stopCount = 0

        let flushTask = Task {
            // Simulate await monitorTask?.value
            await Task.yield()
            guard RecordingSessionOwnedTaskGate.isStillOwner(
                isTaskCancelled: Task.isCancelled,
                ownedSessionID: oldSessionID,
                activeSessionID: activeSessionID
            ) else { return }

            // Simulate await flushPending...
            await Task.yield()
            guard RecordingSessionOwnedTaskGate.isStillOwner(
                isTaskCancelled: Task.isCancelled,
                ownedSessionID: oldSessionID,
                activeSessionID: activeSessionID
            ) else { return }

            stopCount += 1
        }

        // New session starts while the old flush task is suspended.
        activeSessionID = newSessionID
        await flushTask.value

        XCTAssertEqual(stopCount, 0)
    }

    func testCancelledVADFlushTaskDoesNotStopTranscriber() async {
        let sessionID = UUID()
        var stopCount = 0

        let flushTask = Task {
            await Task.yield()
            guard RecordingSessionOwnedTaskGate.isStillOwner(
                isTaskCancelled: Task.isCancelled,
                ownedSessionID: sessionID,
                activeSessionID: sessionID
            ) else { return }
            stopCount += 1
        }

        flushTask.cancel()
        await flushTask.value
        XCTAssertEqual(stopCount, 0)
    }

    func testSilenceMonitorStopsActingOnFramesAfterSessionChange() async {
        let ownedSessionID = UUID()
        var activeSessionID = ownedSessionID
        var isSessionActive = true
        var appendedFrames = 0

        let monitorTask = Task {
            while RecordingSessionOwnedTaskGate.shouldContinueSilenceMonitor(
                isTaskCancelled: Task.isCancelled,
                isSessionActive: isSessionActive,
                ownedSessionID: ownedSessionID,
                activeSessionID: activeSessionID
            ) {
                // Simulate async VAD decision.
                await Task.yield()
                guard RecordingSessionOwnedTaskGate.shouldContinueSilenceMonitor(
                    isTaskCancelled: Task.isCancelled,
                    isSessionActive: isSessionActive,
                    ownedSessionID: ownedSessionID,
                    activeSessionID: activeSessionID
                ) else { return }
                appendedFrames += 1
                return
            }
        }

        // Rollover before the suspended decision resumes.
        activeSessionID = UUID()
        isSessionActive = true
        await monitorTask.value

        XCTAssertEqual(appendedFrames, 0)
    }
}
