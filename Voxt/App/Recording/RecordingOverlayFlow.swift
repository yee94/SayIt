// RecordingOverlayFlow.swift
// Provides Recording Overlay Flow for recording session routing.

import AppKit
import Foundation

extension AppDelegate {
    var currentRecordingOverlayIconMode: OverlaySessionIconMode {
        RecordingSessionSupport.overlayIconMode(
            for: sessionOutputMode,
            isNoteSession: isCurrentTranscriptionNoteSessionActive
        )
    }

    func showOverlayStatus(
        _ message: String,
        presentation: OverlayStatusPresentation = .standard,
        clearAfter seconds: TimeInterval = 2.4
    ) {
        overlayStatusClearTask?.cancel()
        let presentsStandaloneOverlay = !overlayWindow.isVisible
        overlayState.presentStatus(
            message,
            presentation: presentation,
            iconMode: currentRecordingOverlayIconMode
        )
        if presentsStandaloneOverlay {
            overlayWindow.show(state: overlayState, position: overlayPosition)
        }
        VoxtLog.input(
            "Overlay status presented. standalone=\(presentsStandaloneOverlay), visible=\(overlayWindow.isVisible), chars=\(message.count)",
            verbose: true
        )
        overlayStatusClearTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            guard self.overlayState.clearStatus(matching: message, presentation: presentation) else { return }
            let dismissStandaloneOverlay = Self.shouldDismissStandaloneOverlayStatus(
                presentsStandaloneOverlay: presentsStandaloneOverlay,
                isSessionActive: self.isSessionActive
            )
            if dismissStandaloneOverlay {
                self.overlayWindow.hide(animated: true)
            }
            VoxtLog.input(
                "Overlay status cleared. dismissedStandalone=\(dismissStandaloneOverlay), sessionActive=\(self.isSessionActive)",
                verbose: true
            )
            self.overlayStatusClearTask = nil
        }
    }

    nonisolated static func shouldDismissStandaloneOverlayStatus(
        presentsStandaloneOverlay: Bool,
        isSessionActive: Bool
    ) -> Bool {
        presentsStandaloneOverlay && !isSessionActive
    }

    func showOverlayReminder(_ message: String, autoHideAfter seconds: TimeInterval = 2.4) {
        overlayReminderTask?.cancel()
        overlayStatusClearTask?.cancel()
        overlayState.reset()
        overlayState.statusMessage = message
        overlayState.presentRecording(iconMode: currentRecordingOverlayIconMode)
        overlayWindow.show(state: overlayState, position: overlayPosition)

        overlayReminderTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self.overlayWindow.hide()
            self.overlayState.reset()
            self.overlayReminderTask = nil
        }
    }

    func showFloatingToast(
        _ message: String,
        kind: FloatingToastKind = .success,
        clearAfter seconds: TimeInterval = 1.8
    ) {
        toastDismissTask?.cancel()
        toastWindow.show(message: message, kind: kind, position: overlayPosition)
        toastDismissTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self.toastWindow.hide()
            self.toastDismissTask = nil
        }
    }

    func setEnhancingState(_ isEnhancing: Bool) {
        overlayState.isEnhancing = isEnhancing
        if overlayState.displayMode != .answer {
            overlayState.displayMode = isEnhancing ? .processing : .recording
        }
        setActiveRecordingTranscriberEnhancingState(isEnhancing)
    }
}
