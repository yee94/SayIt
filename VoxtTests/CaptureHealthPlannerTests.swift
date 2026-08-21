// CaptureHealthPlannerTests.swift
// Deterministic unit tests for runtime zero-buffer capture-health decisions.

import XCTest
@testable import Voxt

final class CaptureHealthPlannerTests: XCTestCase {
    private let planner = CaptureHealthPlanner()

    func testReturnsNoneWhenNotRecording() {
        let action = planner.action(
            isRecording: false,
            callbacksReceived: true,
            secondsSinceLastBuffer: 10,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(action, .none)
    }

    func testReturnsNoneWhenNoCallbacksReceivedYet() {
        let action = planner.action(
            isRecording: true,
            callbacksReceived: false,
            secondsSinceLastBuffer: 10,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(action, .none)
    }

    func testReturnsNoneBelowStandardSilenceThreshold() {
        let action = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 2.99,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(action, .none)
    }

    func testStandardThresholdExactBoundaryTriggersRestart() {
        let action = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 3.0,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(action, .restartCurrentDevice)
    }

    func testBluetoothUsesLongerSilenceThreshold() {
        let belowBluetooth = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 4.99,
            activeDeviceIsBluetooth: true,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(belowBluetooth, .none)

        let atBluetooth = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 5.0,
            activeDeviceIsBluetooth: true,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(atBluetooth, .restartCurrentDevice)
    }

    func testFirstAttemptRestartsCurrentDevice() {
        let action = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 3.0,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 0
        )
        XCTAssertEqual(action, .restartCurrentDevice)
    }

    func testSecondAttemptFallsBackToDefaultDevice() {
        let action = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 3.0,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 1
        )
        XCTAssertEqual(action, .fallbackToDefaultDevice)
    }

    func testAttemptsAtOrAboveMaxReportFailure() {
        let atMax = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 3.0,
            activeDeviceIsBluetooth: false,
            recoveryAttemptsUsed: 2
        )
        XCTAssertEqual(atMax, .reportFailure)

        let aboveMax = planner.action(
            isRecording: true,
            callbacksReceived: true,
            secondsSinceLastBuffer: 10.0,
            activeDeviceIsBluetooth: true,
            recoveryAttemptsUsed: 3
        )
        XCTAssertEqual(aboveMax, .reportFailure)
    }

    func testCustomThresholdsAreHonored() {
        var custom = CaptureHealthPlanner()
        custom.standardSilenceThreshold = 1.5
        custom.bluetoothSilenceThreshold = 2.5
        custom.maxRecoveryAttemptsPerSession = 1

        XCTAssertEqual(
            custom.action(
                isRecording: true,
                callbacksReceived: true,
                secondsSinceLastBuffer: 1.49,
                activeDeviceIsBluetooth: false,
                recoveryAttemptsUsed: 0
            ),
            .none
        )
        XCTAssertEqual(
            custom.action(
                isRecording: true,
                callbacksReceived: true,
                secondsSinceLastBuffer: 1.5,
                activeDeviceIsBluetooth: false,
                recoveryAttemptsUsed: 0
            ),
            .restartCurrentDevice
        )
        // With maxRecoveryAttemptsPerSession = 1, attempt 1 already exhausts the budget.
        XCTAssertEqual(
            custom.action(
                isRecording: true,
                callbacksReceived: true,
                secondsSinceLastBuffer: 2.5,
                activeDeviceIsBluetooth: true,
                recoveryAttemptsUsed: 1
            ),
            .reportFailure
        )
    }
}
