// CaptureHealthSupport.swift
// Shared runtime capture-health planning for transcription engines.

import CoreAudio

/// Recovery action recommended by the runtime capture watchdog.
enum CaptureRecoveryAction: Equatable {
    /// Nothing to do; capture looks healthy or the watchdog is inactive.
    case none
    /// Rebuild the capture graph on the currently selected input device.
    case restartCurrentDevice
    /// Rebuild the capture graph on the system default input device.
    case fallbackToDefaultDevice
    /// Recovery budget exhausted; surface a runtime failure to the user.
    case reportFailure
}

/// Pure decision logic for the runtime zero-buffer watchdog.
///
/// The existing startup watchdog only covers sessions that never produced a
/// single buffer. This planner covers the opposite case: the engine looks
/// alive but went silent mid-recording (e.g. a Bluetooth headset disconnects
/// while the tap stays installed and no buffers arrive anymore).
struct CaptureHealthPlanner {
    /// Silence window before recovery starts for wired/built-in devices.
    var standardSilenceThreshold: TimeInterval = 3.0
    /// Bluetooth devices get a longer window: the SCO link can take 1-2
    /// seconds to re-activate after the headset reconnects.
    var bluetoothSilenceThreshold: TimeInterval = 5.0
    /// Total recovery attempts allowed per recording session.
    var maxRecoveryAttemptsPerSession: Int = 2

    func action(
        isRecording: Bool,
        callbacksReceived: Bool,
        secondsSinceLastBuffer: TimeInterval,
        activeDeviceIsBluetooth: Bool,
        recoveryAttemptsUsed: Int
    ) -> CaptureRecoveryAction {
        guard isRecording, callbacksReceived else { return .none }
        let threshold = activeDeviceIsBluetooth ? bluetoothSilenceThreshold : standardSilenceThreshold
        guard secondsSinceLastBuffer >= threshold else { return .none }
        if recoveryAttemptsUsed <= 0 {
            return .restartCurrentDevice
        }
        if recoveryAttemptsUsed < maxRecoveryAttemptsPerSession {
            return .fallbackToDefaultDevice
        }
        return .reportFailure
    }
}

enum CaptureHealthSupport {
    /// Returns true when the device transports audio over Bluetooth
    /// (classic or LE), in which case reconnect grace windows should be
    /// extended before the watchdog attempts recovery.
    static func isBluetoothInputDevice(_ deviceID: AudioDeviceID) -> Bool {
        guard deviceID != 0 else { return false }
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(deviceID, &propertyAddress) else { return false }
        var transport: UInt32 = 0
        var dataSize = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &transport
        )
        guard status == noErr else {
            VoxtLog.audioWarning("Failed to read transport type for device \(deviceID). status=\(status)")
            return false
        }
        return transport == kAudioDeviceTransportTypeBluetooth
            || transport == kAudioDeviceTransportTypeBluetoothLE
    }
}
