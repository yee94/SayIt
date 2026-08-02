// MicrophoneLevelPreviewController.swift
// Provides microphone input level previews for settings screens.

import Foundation
import AVFoundation
import Combine

@MainActor
final class MicrophoneLevelPreviewController: ObservableObject {
    @Published private(set) var levelsByUID: [String: Float] = [:]
    @Published private(set) var unavailableDeviceUIDs: Set<String> = []
    @Published private(set) var hasMicrophonePermission = false

    private var capturesByUID: [String: MeetingMicrophoneCapture] = [:]
    private var configuredDeviceIDsByUID: [String: AudioDeviceID] = [:]
    private let levelDelivery = MicrophonePreviewLevelDelivery()
    private var previewGeneration = UUID()

    func startPreview(for devices: [AudioInputDevice]) {
        stopCaptureSessions()

        configuredDeviceIDsByUID = Dictionary(
            uniqueKeysWithValues: devices.map { ($0.uid, $0.id) }
        )
        hasMicrophonePermission = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        guard hasMicrophonePermission else { return }

        levelsByUID = Dictionary(
            uniqueKeysWithValues: devices.map { ($0.uid, Float.zero) }
        )
        let generation = previewGeneration

        for device in devices {
            let uid = device.uid
            let capture = MeetingMicrophoneCapture()
            capture.setPreferredInputDevice(device.id)

            do {
                try capture.start(preferredInputDevicePolicy: .requirePreferredDevice) { [weak levelDelivery] _, level in
                    levelDelivery?.submit(uid: uid, level: level) { [weak self] levels in
                        self?.apply(levels: levels, generation: generation)
                    }
                }
                capturesByUID[uid] = capture
            } catch {
                unavailableDeviceUIDs.insert(uid)
                VoxtLog.settingsWarning(
                    "Microphone preview could not start. uid=\(uid), deviceID=\(device.id), error=\(error.localizedDescription)"
                )
            }
        }
    }

    func updatePreview(for devices: [AudioInputDevice]) {
        let desiredDeviceIDsByUID = Dictionary(
            uniqueKeysWithValues: devices.map { ($0.uid, $0.id) }
        )
        let currentlyHasPermission = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        guard desiredDeviceIDsByUID != configuredDeviceIDsByUID
                || currentlyHasPermission != hasMicrophonePermission
        else {
            return
        }
        startPreview(for: devices)
    }

    func stopPreview() {
        stopCaptureSessions()
        configuredDeviceIDsByUID = [:]
        levelsByUID = [:]
        unavailableDeviceUIDs = []
    }

    func level(for uid: String) -> Float {
        levelsByUID[uid] ?? 0
    }

    func isPreviewUnavailable(for uid: String) -> Bool {
        unavailableDeviceUIDs.contains(uid)
    }

    private func stopCaptureSessions() {
        previewGeneration = UUID()
        for capture in capturesByUID.values {
            capture.stop()
        }
        capturesByUID = [:]
        levelDelivery.clear()
        levelsByUID = [:]
        unavailableDeviceUIDs = []
    }

    private func apply(levels: [String: Float], generation: UUID) {
        guard previewGeneration == generation else { return }
        for (uid, level) in levels where levelsByUID[uid] != nil {
            levelsByUID[uid] = min(max(level, 0), 1)
        }
    }
}

private nonisolated final class MicrophonePreviewLevelDelivery: @unchecked Sendable {
    private let lock = NSLock()
    private var latestLevelsByUID: [String: Float] = [:]
    private var isDeliveryScheduled = false

    func submit(
        uid: String,
        level: Float,
        deliver: @escaping @MainActor @Sendable ([String: Float]) -> Void
    ) {
        lock.lock()
        latestLevelsByUID[uid] = level
        let shouldScheduleDelivery = !isDeliveryScheduled
        if shouldScheduleDelivery {
            isDeliveryScheduled = true
        }
        lock.unlock()

        guard shouldScheduleDelivery else { return }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(50))
            guard let levels = self?.takeLatestLevels(), !levels.isEmpty else { return }
            deliver(levels)
        }
    }

    func clear() {
        lock.lock()
        latestLevelsByUID = [:]
        lock.unlock()
    }

    private func takeLatestLevels() -> [String: Float]? {
        lock.lock()
        defer { lock.unlock() }
        let levels = latestLevelsByUID
        latestLevelsByUID = [:]
        isDeliveryScheduled = false
        return levels
    }
}
