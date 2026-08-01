// RecordingOverlayContent.swift
// Provides Recording Overlay Content for window and overlay UI.

import SwiftUI

// MARK: - SwiftUI content hosted inside the panel

struct OverlayContent: View {
    @AppStorage(AppPreferenceKey.overlayBubbleStyle) private var overlayBubbleStyleRaw = OverlayBubbleStyle.defaultStyle.rawValue
    @ObservedObject var state: OverlayState
    let onInject: () -> Void
    let onContinue: () -> Void
    let onToggleConversationRecording: () -> Void
    let onShowDetail: () -> Void
    let onClose: () -> Void
    let onToggleSessionTranslationTargetPicker: () -> Void
    let onSelectSessionTranslationTargetLanguage: (TranslationTargetLanguage) -> Void
    let onDismissSessionTranslationTargetPicker: () -> Void

    var body: some View {
        Group {
            if overlayBubbleStyleRaw == OverlayBubbleStyle.notch.rawValue && state.displayMode != .answer {
                NotchHudView(
                    displayMode: state.displayMode,
                    sessionIconMode: state.sessionIconMode,
                    isModelInitializing: state.isModelInitializing,
                    isConnectingMicrophone: state.isConnectingMicrophone,
                    audioLevel: state.audioLevel,
                    isRecording: state.isRecording,
                    shouldAnimate: state.shouldAnimateVisuals,
                    transcribedText: state.transcribedText,
                    statusMessage: state.statusMessage,
                    isEnhancing: state.isEnhancing,
                    isRequesting: state.isRequesting,
                    isFinalizingTranscription: state.isFinalizingTranscription,
                    isCompleting: state.isCompleting,
                    isPresented: state.isPresented
                )
            } else {
                classicOverlay
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, usesNotchLayout ? 0 : 8)
        .onChange(of: overlayBubbleStyleRaw) { _, _ in
            NotificationCenter.default.post(name: .voxtOverlayAppearanceDidChange, object: nil)
        }
    }

    private var usesNotchLayout: Bool {
        overlayBubbleStyleRaw == OverlayBubbleStyle.notch.rawValue && state.displayMode != .answer
    }

    private var classicOverlay: some View {
        WaveformView(
            displayMode: state.displayMode,
            sessionIconMode: state.sessionIconMode,
            isModelInitializing: state.isModelInitializing,
            isConnectingMicrophone: state.isConnectingMicrophone,
            initializingEngine: state.initializingEngine,
            audioLevel: state.audioLevel,
            isRecording: state.isRecording,
            shouldAnimate: state.shouldAnimateVisuals,
            transcribedText: state.transcribedText,
            statusMessage: state.statusMessage,
            isEnhancing: state.isEnhancing,
            isRequesting: state.isRequesting,
            isFinalizingTranscription: state.isFinalizingTranscription,
            isCompleting: state.isCompleting,
            answerTitle: state.answerTitle,
            answerContent: state.answerContent,
            isStreamingAnswer: state.isStreamingAnswer,
            answerInteractionMode: state.answerInteractionMode,
            rewriteConversationTurns: state.rewriteConversationTurns,
            latestRewriteResult: state.latestRewriteResult,
            canInjectAnswer: state.canInjectAnswer,
            canCopyAnswer: state.canCopyLatestAnswer,
            canContinueAnswer: state.showsRewriteContinueButton,
            canShowHistoryDetail: state.canShowLatestHistoryDetail,
            compactLeadingIconImage: state.compactLeadingIconImage,
            sessionTranslationTargetLanguage: state.sessionTranslationTargetLanguage,
            sessionTranslationDraftLanguage: state.sessionTranslationDraftLanguage,
            isSessionTranslationTargetPickerPresented: state.isSessionTranslationTargetPickerPresented,
            isSessionTranslationLanguageHovering: state.isSessionTranslationLanguageHovering,
            allowsSessionTranslationLanguageSwitching: state.allowsSessionTranslationLanguageSwitching,
            onInject: onInject,
            onContinue: onContinue,
            onToggleConversationRecording: onToggleConversationRecording,
            onShowHistoryDetail: onShowDetail,
            onClose: onClose,
            onSessionTranslationLanguageHoverChanged: state.setSessionTranslationLanguageHovering,
            onToggleSessionTranslationTargetPicker: onToggleSessionTranslationTargetPicker,
            onSelectSessionTranslationTargetLanguage: onSelectSessionTranslationTargetLanguage,
            onDismissSessionTranslationTargetPicker: onDismissSessionTranslationTargetPicker
        )
    }
}
