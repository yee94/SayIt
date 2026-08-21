// AudioDeviceEventDebounce.swift
// Pure routing helpers for CoreAudio input-device event bursts.

import Foundation

/// Debounce interval and idempotent restart routing for audio input hardware events.
///
/// CoreAudio often delivers device bursts over 1–2s (devices-changed, default-input-changed,
/// and more). Trailing debounce collapses the burst; restart routing skips capture restarts
/// when the resolved active UID did not actually move after sync/lock.
enum AudioDeviceEventDebounce {
    /// Trailing silence window before a hardware-change snapshot refresh runs.
    /// Named to mirror `transcriptionStartDebounceInterval` style elsewhere.
    static let hardwareChangeDebounceInterval: TimeInterval = 0.25

    /// Inputs observed after `syncState` (session lock already applied upstream when relevant).
    struct RoutingInput: Equatable, Sendable {
        var previousActiveUID: String?
        var newActiveUID: String?
        /// True while a recording session is actively capturing (`isSessionActive` and not stopped).
        var isRecordingActive: Bool
        /// UID returned by the session lock helper, if any; nil when lock did not apply.
        var lockedActiveUID: String?
    }

    /// Whether `applyInputDevicesSnapshot` should invoke the resolved-state / restart path.
    struct RoutingDecision: Equatable, Sendable {
        var shouldTriggerResolvedStateHandling: Bool
    }

    /// Decides whether hardware snapshot apply should call `handleResolvedMicrophoneStateChange`.
    ///
    /// Device-list UI refresh stays independent: callers still post notifications and rebuild
    /// menus when the snapshot changed. Restart only runs when the resolved active UID moved
    /// (device disappeared, auto-switch promoted another mic, etc.).
    ///
    /// `isRecordingActive` / `lockedActiveUID` describe the upstream lock scenario: when
    /// recording lock keeps the current device, sync leaves `newActiveUID == previousActiveUID`
    /// and burst follow-ups become no-ops here without poking the restart chain.
    static func routingDecision(for input: RoutingInput) -> RoutingDecision {
        if input.previousActiveUID != input.newActiveUID {
            return RoutingDecision(shouldTriggerResolvedStateHandling: true)
        }
        // UID unchanged — including recording lock preserving the active device.
        return RoutingDecision(shouldTriggerResolvedStateHandling: false)
    }

    /// Convenience for call sites that only have the two resolved UIDs.
    static func shouldTriggerResolvedStateHandling(
        previousActiveUID: String?,
        newActiveUID: String?
    ) -> Bool {
        routingDecision(
            for: RoutingInput(
                previousActiveUID: previousActiveUID,
                newActiveUID: newActiveUID,
                isRecordingActive: false,
                lockedActiveUID: nil
            )
        ).shouldTriggerResolvedStateHandling
    }
}
