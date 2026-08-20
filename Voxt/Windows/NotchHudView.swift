// NotchHudView.swift
// Provides a notch-style recording HUD for the floating overlay.

import AppKit
import SwiftUI

struct NotchHudShape: Shape {
    var topRadius: CGFloat = 14
    var bottomRadius: CGFloat = 22

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(topRadius, bottomRadius) }
        set {
            topRadius = newValue.first
            bottomRadius = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let top = min(topRadius, rect.width / 4, rect.height / 2)
        let bottom = min(bottomRadius, rect.width / 4, rect.height)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + top, y: rect.minY + top),
            control: CGPoint(x: rect.minX + top, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.minX + top, y: rect.maxY - bottom))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + top + bottom, y: rect.maxY),
            control: CGPoint(x: rect.minX + top, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.maxX - top - bottom, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - top, y: rect.maxY - bottom),
            control: CGPoint(x: rect.maxX - top, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.maxX - top, y: rect.minY + top))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.maxX - top, y: rect.minY)
        )
        path.closeSubpath()
        return path
    }
}

struct NotchHudView: View {
    @AppStorage(AppPreferenceKey.realtimeTextDisplayEnabled) private var realtimeTextDisplayEnabled = true
    // Notch keeps its own style set (defaults: solid black + designed notch radii).
    @AppStorage(AppPreferenceKey.notchOverlayCardOpacity) private var overlayCardOpacity = 100
    @AppStorage(AppPreferenceKey.notchOverlayCardCornerRadius) private var overlayCardCornerRadius = 24

    var displayMode: OverlayDisplayMode
    var sessionIconMode: OverlaySessionIconMode
    var isModelInitializing: Bool = false
    var isConnectingMicrophone: Bool = false
    var audioLevel: Float
    var isRecording: Bool
    var shouldAnimate: Bool
    var transcribedText: String
    var statusMessage: String = ""
    var statusPresentation: OverlayStatusPresentation = .standard
    var isEnhancing: Bool = false
    var isRequesting: Bool = false
    var isFinalizingTranscription: Bool = false
    var isCompleting: Bool = false
    var isPresented: Bool = true

    @State private var presentationScaleX: CGFloat = 0.6
    @State private var presentationScaleY: CGFloat = 0.3
    @State private var presentationOpacity: Double = 0
    @State private var previousText = ""
    @State private var stableText = ""
    @State private var unstableText = ""
    @State private var stabilizationToken = UUID()
    @State private var transcriptVisible = false
    @State private var transcriptHasAppeared = false
    /// Once "整理中..." has been shown, never fall back to the live underlined
    /// transcript for the rest of this presentation cycle.
    @State private var didEnterOrganizing = false
    @State private var checkmarkDrawn = false
    @State private var shakeOffset: CGFloat = 0
    @State private var errorScatterProgress: CGFloat = 0
    @State private var successGlowIntensity: Double = 0
    @State private var visualAnimationToken = UUID()

    private let hudWidth: CGFloat = 420
    private let compactWidth: CGFloat = 200
    private let collapsedHeight: CGFloat = 42
    private let expandedHeight: CGFloat = 72

    /// Shared enter/exit presentation (must stay symmetric).
    /// Enter: collapsed → full; Exit: full → same collapsed origin.
    private static let presentationDuration: TimeInterval = 0.25
    /// cubic-bezier(0.34, 1.56, 0.64, 1) — same curve both ways.
    private static let presentationAnimation = Animation.timingCurve(
        0.34, 1.56, 0.64, 1,
        duration: presentationDuration
    )
    /// Learning feedback only grows downward; keep X locked to the notch band.
    private static let learningPresentationAnimation = Animation.timingCurve(
        0.22, 1, 0.36, 1,
        duration: 0.28
    )
    private static let collapsedScaleX: CGFloat = 0.6
    private static let collapsedScaleY: CGFloat = 0.3
    private static let learningCollapsedScaleY: CGFloat = 0.35

    /// Maps notch corner-radius preference onto the notch silhouette.
    /// Default 24pt → top 14 / bottom 22 (the designed notch shape).
    private static let notchShapeReferenceCorner: CGFloat = 24
    private static let notchShapeReferenceTop: CGFloat = 14
    private static let notchShapeReferenceBottom: CGFloat = 22

    private var cardOpacity: Double {
        Double(min(max(overlayCardOpacity, 0), 100)) / 100.0
    }

    private var notchTopRadius: CGFloat {
        let corner = CGFloat(min(max(overlayCardCornerRadius, 0), 40))
        let scale = corner / Self.notchShapeReferenceCorner
        return max(4, Self.notchShapeReferenceTop * scale)
    }

    private var notchBottomRadius: CGFloat {
        let corner = CGFloat(min(max(overlayCardCornerRadius, 0), 40))
        let scale = corner / Self.notchShapeReferenceCorner
        return max(6, Self.notchShapeReferenceBottom * scale)
    }

    private var hudShape: NotchHudShape {
        NotchHudShape(topRadius: notchTopRadius, bottomRadius: notchBottomRadius)
    }

    private enum VisualMode: Equatable {
        case connecting
        case recording
        case processing
        case success
        case error
    }

    private var isOrganizing: Bool {
        isEnhancing || isRequesting || isFinalizingTranscription
    }

    private var trimmedTranscript: String {
        transcribedText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedStatus: String {
        statusMessage.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isError: Bool {
        let message = trimmedStatus.lowercased()
        return ["error", "failed", "failure", "错误", "失败", "异常"].contains { message.contains($0) }
    }

    private var visualMode: VisualMode {
        if isError { return .error }
        if isCompleting && !isRecording && !isOrganizing { return .success }
        if isConnectingMicrophone && !isRecording { return .connecting }
        if isRecording && displayMode == .recording { return .recording }
        return .processing
    }

    private var trimmedConnectingStatusText: String {
        AppLocalization.localizedString("Connecting to microphone…")
    }

    private var isDictionaryLearningFeedback: Bool {
        statusPresentation == .dictionaryLearning && !trimmedStatus.isEmpty
    }

    private var subtitleTextIsVisible: Bool {
        // Completing / success / exit must never re-surface the live transcript.
        // Otherwise "整理中..." flickers back into the previous underlined text
        // for one frame before the HUD collapses.
        if isCompleting || visualMode == .success || !isPresented {
            return false
        }
        // Learned terms sit below the camera/notch band, matching SayIt's
        // expanded learned row rather than centering text inside the notch.
        if isDictionaryLearningFeedback { return true }
        if isError { return !trimmedStatus.isEmpty }
        // Keep connecting mic inside the collapsed top row so the notch HUD
        // does not expand/contract for a temporary status line.
        if visualMode == .connecting { return false }
        if isOrganizing { return true }
        // After organizing ends, collapse subtitle immediately — do not revive
        // the previous streaming transcript with underlines.
        if didEnterOrganizing { return false }
        if !trimmedStatus.isEmpty { return true }
        // Live transcript only while actively recording.
        return visualMode == .recording && realtimeTextDisplayEnabled && !trimmedTranscript.isEmpty
    }

    private var targetHeight: CGFloat {
        subtitleTextIsVisible && !usesCompactWidth ? expandedHeight : collapsedHeight
    }

    private var targetWidth: CGFloat {
        // Learning feedback stays at the default notch width so only the
        // vertical drop below the camera band changes size.
        if isDictionaryLearningFeedback { return hudWidth }
        return usesCompactWidth ? compactWidth : hudWidth
    }

    private var usesCompactWidth: Bool {
        // Only success mode uses the narrow pill. Exit must not shrink width,
        // otherwise the top-center scale reads as collapsing toward the top-left.
        // Learning feedback also keeps full notch width (no left/right expand).
        visualMode == .success && !isDictionaryLearningFeedback
    }

    private var entranceScaleX: CGFloat {
        isDictionaryLearningFeedback ? 1 : Self.collapsedScaleX
    }

    private var entranceScaleY: CGFloat {
        isDictionaryLearningFeedback ? Self.learningCollapsedScaleY : Self.collapsedScaleY
    }

    private var activePresentationAnimation: Animation {
        isDictionaryLearningFeedback ? Self.learningPresentationAnimation : Self.presentationAnimation
    }

    /// Top-center anchor so enter/exit scale from the middle of the notch edge.
    private let presentationAnchor = UnitPoint(x: 0.5, y: 0)

    var body: some View {
        GeometryReader { proxy in
            let availableWidth = max(proxy.size.width, 1)
            let resolvedWidth = min(targetWidth, availableWidth)

            // Keep the scaled HUD centered in the panel; width/height morphs
            // happen on the inner chrome, presentation scale stays top-center.
            HStack(spacing: 0) {
                Spacer(minLength: 0)

                ZStack(alignment: .top) {
                    hudShape
                        .fill(.black.opacity(cardOpacity))
                        .overlay {
                            hudShape
                                .fill(Color.green.opacity(0.15 * successGlowIntensity))
                                .blur(radius: 18)
                        }
                        .shadow(
                            color: Color.black.opacity(0.30),
                            radius: 12,
                            y: 4
                        )

                    VStack(spacing: 0) {
                        Group {
                            if isDictionaryLearningFeedback {
                                // Leave the camera/notch band empty; content renders below.
                                Color.clear
                            } else {
                                topRow
                            }
                        }
                            .frame(height: collapsedHeight)

                        if subtitleTextIsVisible && !usesCompactWidth {
                            subtitleRow
                                .frame(height: expandedHeight - collapsedHeight, alignment: .top)
                                // Learning feedback must stay fully visible under the
                                // camera band; skip the transcript fade/slide entrance.
                                .opacity(isDictionaryLearningFeedback || transcriptVisible ? 1 : 0)
                                .offset(y: isDictionaryLearningFeedback || transcriptVisible ? 0 : -6)
                        }
                    }
                    .clipShape(hudShape)
                }
                .frame(width: resolvedWidth, height: targetHeight)
                .animation(.timingCurve(0.32, 0.72, 0, 1, duration: 0.35), value: resolvedWidth)
                .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.32), value: targetHeight)
                .scaleEffect(
                    x: presentationScaleX,
                    y: presentationScaleY,
                    anchor: presentationAnchor
                )
                .opacity(presentationOpacity)
                .offset(x: shakeOffset)

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .frame(height: expandedHeight)
        .onAppear {
            // Start collapsed so the first painted frame is already the enter origin.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                presentationScaleX = entranceScaleX
                presentationScaleY = entranceScaleY
                presentationOpacity = 0
                didEnterOrganizing = isOrganizing
                if isDictionaryLearningFeedback {
                    transcriptVisible = true
                }
            }
            updateTranscript(trimmedTranscript)
            updateVisualMode()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
                runEntrance()
                revealTranscript()
            }
        }
        .onChange(of: isPresented) { _, presented in
            if presented {
                didEnterOrganizing = isOrganizing
                runEntrance()
            } else {
                runExit()
            }
        }
        .onChange(of: isOrganizing) { _, organizing in
            if organizing {
                didEnterOrganizing = true
            }
        }
        .onChange(of: trimmedTranscript) { _, text in
            updateTranscript(text)
        }
        .onChange(of: subtitleTextIsVisible) { _, isVisible in
            if isVisible {
                revealTranscript()
            } else {
                transcriptVisible = false
            }
        }
        .onChange(of: visualMode) { _, _ in
            updateVisualMode()
        }
        .onChange(of: isDictionaryLearningFeedback) { _, isLearning in
            if isLearning {
                transcriptVisible = true
            }
        }
    }

    private var topRow: some View {
        HStack(spacing: 0) {
            statusVisual
                .frame(maxWidth: .infinity, alignment: .leading)
                .animation(.timingCurve(0.32, 0.72, 0, 1, duration: 0.3), value: visualMode)

            Color.clear
                .frame(width: 40)

            recordingMetadata
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 40)
    }

    @ViewBuilder
    private var statusVisual: some View {
        switch visualMode {
        case .connecting:
            Text(trimmedConnectingStatusText)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .transition(.opacity)
        case .recording:
            recordingWaveform
                .transition(.opacity.combined(with: .scale(scale: 0.72)))
        case .processing:
            ProcessingDotsView(isAnimating: shouldAnimate)
                .transition(.opacity.combined(with: .scale(scale: 0.72)))
        case .success:
            SuccessCheckmarkView(isDrawn: checkmarkDrawn)
                .transition(.opacity.combined(with: .scale(scale: 0.72)))
        case .error:
            HStack(spacing: 4) {
                ForEach(0..<6, id: \.self) { index in
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 6, height: 6)
                        .offset(x: errorScatterOffset(at: index) * errorScatterProgress)
                        .scaleEffect(CGFloat(1) - (0.2 * errorScatterProgress))
                        .opacity(1.0 - (0.3 * Double(errorScatterProgress)))
                }
            }
            .transition(.opacity.combined(with: .scale(scale: 0.72)))
        }
    }

    private var recordingWaveform: some View {
        NotchWaveformBars(audioLevel: audioLevel, isAnimating: shouldAnimate)
    }

    @ViewBuilder
    private var recordingMetadata: some View {
        if visualMode == .recording {
            CompactModeIconView(sessionIconMode: sessionIconMode)
        } else if visualMode == .error {
            Image(systemName: "exclamationmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color.orange)
        }
    }

    private var subtitleRow: some View {
        GeometryReader { proxy in
            let availableWidth = max(proxy.size.width - 48, 0)

            Group {
                if isDictionaryLearningFeedback {
                    Text(trimmedStatus)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.95))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .center)
                } else if isError {
                    Text(trimmedStatus)
                        .foregroundStyle(Color.orange)
                } else if isOrganizing || didEnterOrganizing {
                    // Keep "整理中..." locked; never swap back to underlined transcript.
                    ShimmeringTranscriptText(stableText: "整理中...", unstableText: "", shouldAnimate: shouldAnimate && isOrganizing)
                } else if !trimmedStatus.isEmpty {
                    ShimmeringTranscriptText(stableText: trimmedStatus, unstableText: "", shouldAnimate: shouldAnimate)
                } else if visualMode == .recording {
                    ShimmeringTranscriptText(
                        stableText: stableText,
                        unstableText: unstableText,
                        shouldAnimate: shouldAnimate
                    )
                }
            }
            .font(.system(size: 13, weight: .regular))
            .tracking(0.26)
            .lineLimit(1)
            .truncationMode(isDictionaryLearningFeedback ? .tail : .head)
            .frame(maxWidth: .infinity, alignment: subtitleAlignment(availableWidth: availableWidth))
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
    }

    private func subtitleAlignment(availableWidth: CGFloat) -> Alignment {
        if isDictionaryLearningFeedback { return .center }
        guard !isOrganizing, visualMode != .connecting, !isError, trimmedStatus.isEmpty else { return .center }
        let alignmentMargin: CGFloat = 4
        return measuredTranscriptWidth <= max(availableWidth - alignmentMargin, 0) ? .center : .trailing
    }

    private var measuredTranscriptWidth: CGFloat {
        let text = stableText + unstableText
        guard !text.isEmpty else { return 0 }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .regular)
        ]
        let glyphWidth = (text as NSString).size(withAttributes: attributes).width
        let trackingWidth = CGFloat(max(text.count - 1, 0)) * 0.26
        return ceil(glyphWidth + trackingWidth)
    }

    private func errorScatterOffset(at index: Int) -> CGFloat {
        let offsets: [CGFloat] = [-6, -3, 0, 3, 6, 9]
        return offsets[index % offsets.count]
    }

    private func runEntrance() {
        // Snap to the shared collapsed origin, then open with the shared curve.
        // Exit uses the exact reverse values + same curve/duration.
        // Learning feedback keeps X locked at 1 and only grows downward.
        let startScaleX = entranceScaleX
        let startScaleY = entranceScaleY
        let animation = activePresentationAnimation
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            presentationScaleX = startScaleX
            presentationScaleY = startScaleY
            presentationOpacity = 0
        }

        DispatchQueue.main.async {
            withAnimation(animation) {
                presentationScaleX = 1
                presentationScaleY = 1
                presentationOpacity = 1
            }
        }
    }

    private func runExit() {
        // Exact reverse of runEntrance: same duration, same cubic-bezier,
        // back to the same collapsed scale/opacity origin at top-center.
        // Learning feedback collapses downward only (no horizontal pinch).
        withAnimation(activePresentationAnimation) {
            presentationScaleX = entranceScaleX
            presentationScaleY = entranceScaleY
            presentationOpacity = 0
        }
    }

    private func updateTranscript(_ text: String) {
        let token = UUID()
        stabilizationToken = token
        guard !text.isEmpty else {
            previousText = ""
            stableText = ""
            unstableText = ""
            return
        }

        if previousText.isEmpty {
            stableText = ""
            unstableText = text
        } else {
            let prefix = longestCommonPrefix(previousText, text)
            stableText = prefix
            unstableText = String(text.dropFirst(prefix.count))
        }
        previousText = text

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(420))
            guard stabilizationToken == token, previousText == text else { return }
            stableText = text
            unstableText = ""
        }
    }

    private func longestCommonPrefix(_ lhs: String, _ rhs: String) -> String {
        String(zip(lhs, rhs).prefix { $0 == $1 }.map(\.0))
    }

    private func revealTranscript() {
        guard subtitleTextIsVisible else { return }
        // Learning feedback is already visible in the expanded lower row; avoid
        // a second fade that can look like left/right content expansion.
        if isDictionaryLearningFeedback {
            transcriptHasAppeared = true
            transcriptVisible = true
            return
        }
        guard !transcriptHasAppeared else {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                transcriptVisible = true
            }
            return
        }
        transcriptHasAppeared = true
        transcriptVisible = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            guard subtitleTextIsVisible else { return }
            withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.28)) {
                transcriptVisible = true
            }
        }
    }

    private func updateVisualMode() {
        let token = UUID()
        visualAnimationToken = token

        if visualMode == .success {
            checkmarkDrawn = false
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                successGlowIntensity = 1
            }
            DispatchQueue.main.async {
                guard visualAnimationToken == token else { return }
                withAnimation(.easeOut(duration: 0.8)) {
                    successGlowIntensity = 0
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                guard visualAnimationToken == token else { return }
                withAnimation(.easeOut(duration: 0.35)) {
                    checkmarkDrawn = true
                }
            }
        } else {
            checkmarkDrawn = false
            successGlowIntensity = 0
        }

        if visualMode == .error {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                errorScatterProgress = 0
            }
            DispatchQueue.main.async {
                guard visualAnimationToken == token else { return }
                withAnimation(.easeOut(duration: 0.4)) {
                    errorScatterProgress = 1
                }
            }
            runErrorShake(token: token)
        } else {
            errorScatterProgress = 0
            shakeOffset = 0
        }
    }

    private func runErrorShake(token: UUID) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            guard visualAnimationToken == token else { return }
            for offset in [CGFloat(-4), 4, -3, 2, 0] {
                withAnimation(.easeOut(duration: 0.08)) {
                    shakeOffset = offset
                }
                try? await Task.sleep(for: .milliseconds(80))
                guard visualAnimationToken == token else { return }
            }
        }
    }
}

private struct NotchWaveformBars: View {
    let audioLevel: Float
    let isAnimating: Bool
    let barCount: Int = 6

    @StateObject private var waveformState = RecentAudioWaveformState(
        barCount: 6,
        historyDuration: 0.9,
        framesPerSecond: 18,
        silenceFloor: 0,
        peakHoldFrames: 1,
        peakDecayFactor: 0.8,
        riseSmoothing: 0.9,
        fallSmoothing: 0.11
    )

    private let barWidth: CGFloat = 4
    private let barSpacing: CGFloat = 3
    private let barAreaHeight: CGFloat = 28

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 18, paused: !isAnimating)) { _ in
            Canvas { context, size in
                let totalWidth = CGFloat(barCount) * barWidth + CGFloat(max(barCount - 1, 0)) * barSpacing
                let startX = (size.width - totalWidth) / 2

                for index in 0..<barCount {
                    let level = waveformState.barLevels.indices.contains(index)
                        ? waveformState.barLevels[index]
                        : audioLevel
                    let height = WaveformBarVisuals.barHeight(level: level, minHeight: 3.2, maxHeight: 24)
                    let rect = CGRect(
                        x: startX + CGFloat(index) * (barWidth + barSpacing),
                        y: (size.height - height) / 2,
                        width: barWidth,
                        height: height
                    )
                    var path = Path()
                    path.addRoundedRect(in: rect, cornerSize: CGSize(width: 2, height: 2))

                    let glowOpacity = WaveformBarVisuals.glowOpacity(
                        level: level,
                        base: 0.04,
                        gain: 0.26,
                        cap: 0.24
                    )
                    var barContext = context
                    barContext.addFilter(.shadow(color: .white.opacity(glowOpacity), radius: 2))
                    barContext.fill(
                        path,
                        with: .linearGradient(
                            Gradient(colors: [Color.white.opacity(0.98), Color.white.opacity(0.80)]),
                            startPoint: CGPoint(x: rect.midX, y: rect.minY),
                            endPoint: CGPoint(x: rect.midX, y: rect.maxY)
                        )
                    )
                }
            }
            .frame(
                width: CGFloat(barCount) * barWidth + CGFloat(max(barCount - 1, 0)) * barSpacing,
                height: barAreaHeight
            )
        }
        .onAppear {
            waveformState.setActive(isAnimating)
            waveformState.ingest(level: emphasizedWaveformInputLevel(audioLevel))
        }
        .onChange(of: isAnimating) { _, active in
            waveformState.setActive(active)
        }
        .onChange(of: audioLevel) { _, level in
            waveformState.ingest(level: emphasizedWaveformInputLevel(level))
        }
        .onDisappear {
            waveformState.setActive(false)
        }
    }

    private func emphasizedWaveformInputLevel(_ level: Float) -> Float {
        let clamped = max(0, min(level, 1))
        let expanded = min(1.0, pow(Double(clamped), 0.72) * 1.24)
        return Float(expanded)
    }
}

private struct ProcessingDotsView: View {
    let isAnimating: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15, paused: !isAnimating)) { context in
            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.5) / 1.5
            HStack(spacing: 5) {
                ForEach(0..<5, id: \.self) { index in
                    let localPhase = (phase - Double(index) * 0.2 + 1).truncatingRemainder(dividingBy: 1)
                    Circle()
                        .fill(localPhase < 0.5 ? Color.white : Color.clear)
                        .frame(width: 6, height: 6)
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(localPhase < 0.5 ? 1 : 0.40), lineWidth: 1.5)
                        )
                }
            }
            .frame(height: 28)
        }
    }
}

private struct SuccessCheckmarkView: View {
    let isDrawn: Bool

    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 2, y: 9))
            path.addLine(to: CGPoint(x: 7, y: 14))
            path.addLine(to: CGPoint(x: 16, y: 3))
        }
        .trim(from: 0, to: isDrawn ? 1 : 0)
        .stroke(Color.green, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
        .frame(width: 18, height: 18)
        .shadow(color: Color.green.opacity(0.65), radius: 5)
    }
}

/// Shared live-transcript renderer: stable prefix + underlined unstable tail.
struct ShimmeringTranscriptText: View {
    let stableText: String
    let unstableText: String
    let shouldAnimate: Bool

    private static let shimmerStops: [Gradient.Stop] = [
        .init(color: Color(red: 230 / 255, green: 242 / 255, blue: 1).opacity(0.88), location: 0),
        .init(color: Color(red: 230 / 255, green: 242 / 255, blue: 1).opacity(0.88), location: 0.28),
        .init(color: Color(red: 120 / 255, green: 220 / 255, blue: 1), location: 0.42),
        .init(color: .white, location: 0.50),
        .init(color: Color(red: 120 / 255, green: 220 / 255, blue: 1), location: 0.58),
        .init(color: Color(red: 230 / 255, green: 242 / 255, blue: 1).opacity(0.88), location: 0.72),
        .init(color: Color(red: 230 / 255, green: 242 / 255, blue: 1).opacity(0.88), location: 1)
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15, paused: !shouldAnimate)) { context in
            let phase = shouldAnimate
                ? context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
                : 0.5
            let center = -0.4 + (1.8 * phase)
            transcriptText
                .foregroundStyle(
                    LinearGradient(
                        stops: Self.shimmerStops,
                        startPoint: UnitPoint(x: center - 1.2, y: 0.5),
                        endPoint: UnitPoint(x: center + 1.2, y: 0.5)
                    )
                )
        }
    }

    private var transcriptText: Text {
        Text(stableText) + Text(unstableText).underline(
            true,
            color: Color(red: 125 / 255, green: 211 / 255, blue: 252 / 255).opacity(0.72)
        )
    }
}
