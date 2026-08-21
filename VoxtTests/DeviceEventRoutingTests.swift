// DeviceEventRoutingTests.swift
// Pure-logic coverage for audio input device event restart routing.

import XCTest
@testable import Voxt

final class DeviceEventRoutingTests: XCTestCase {
    func testResolvedUIDUnchangedDoesNotTriggerRestartPath() {
        let decision = AudioDeviceEventDebounce.routingDecision(
            for: AudioDeviceEventDebounce.RoutingInput(
                previousActiveUID: "builtin",
                newActiveUID: "builtin",
                isRecordingActive: false,
                lockedActiveUID: nil
            )
        )

        XCTAssertFalse(decision.shouldTriggerResolvedStateHandling)
    }

    func testResolvedUIDChangedTriggersRestartPath() {
        let decision = AudioDeviceEventDebounce.routingDecision(
            for: AudioDeviceEventDebounce.RoutingInput(
                previousActiveUID: "builtin",
                newActiveUID: "headset",
                isRecordingActive: false,
                lockedActiveUID: nil
            )
        )

        XCTAssertTrue(decision.shouldTriggerResolvedStateHandling)
    }

    func testRecordingLockPreservingUIDDoesNotTriggerRestartPath() {
        let decision = AudioDeviceEventDebounce.routingDecision(
            for: AudioDeviceEventDebounce.RoutingInput(
                previousActiveUID: "headset",
                newActiveUID: "headset",
                isRecordingActive: true,
                lockedActiveUID: "headset"
            )
        )

        XCTAssertFalse(decision.shouldTriggerResolvedStateHandling)
    }

    func testActiveDeviceDisappearedTriggersRestartPath() {
        let decision = AudioDeviceEventDebounce.routingDecision(
            for: AudioDeviceEventDebounce.RoutingInput(
                previousActiveUID: "headset",
                newActiveUID: "builtin",
                isRecordingActive: true,
                lockedActiveUID: nil
            )
        )

        XCTAssertTrue(decision.shouldTriggerResolvedStateHandling)
    }

    func testClearedActiveUIDTriggersRestartPath() {
        let decision = AudioDeviceEventDebounce.routingDecision(
            for: AudioDeviceEventDebounce.RoutingInput(
                previousActiveUID: "builtin",
                newActiveUID: nil,
                isRecordingActive: true,
                lockedActiveUID: nil
            )
        )

        XCTAssertTrue(decision.shouldTriggerResolvedStateHandling)
    }

    func testFirstSelectionFromEmptyTriggersRestartPath() {
        let decision = AudioDeviceEventDebounce.routingDecision(
            for: AudioDeviceEventDebounce.RoutingInput(
                previousActiveUID: nil,
                newActiveUID: "builtin",
                isRecordingActive: false,
                lockedActiveUID: nil
            )
        )

        XCTAssertTrue(decision.shouldTriggerResolvedStateHandling)
    }

    func testConvenienceHelperMatchesRoutingDecision() {
        XCTAssertFalse(
            AudioDeviceEventDebounce.shouldTriggerResolvedStateHandling(
                previousActiveUID: "a",
                newActiveUID: "a"
            )
        )
        XCTAssertTrue(
            AudioDeviceEventDebounce.shouldTriggerResolvedStateHandling(
                previousActiveUID: "a",
                newActiveUID: "b"
            )
        )
    }

    func testHardwareChangeDebounceIntervalIs250Milliseconds() {
        XCTAssertEqual(AudioDeviceEventDebounce.hardwareChangeDebounceInterval, 0.25, accuracy: 0.000_1)
    }
}
