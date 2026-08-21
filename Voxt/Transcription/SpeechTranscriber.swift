// SpeechTranscriber.swift
// Provides Speech Transcriber for transcription engines.

import Foundation
import Speech
import AVFoundation
import Combine
import AudioToolbox

@MainActor
class SpeechTranscriber: ObservableObject, TranscriberProtocol {
    private final class AudioSampleStore {
        private let lock = NSLock()
        private var samples: [Float] = []

        func append(_ newSamples: [Float]) {
            lock.lock()
            defer { lock.unlock() }
            samples.append(contentsOf: newSamples)
        }

        func snapshot() -> [Float] {
            lock.lock()
            defer { lock.unlock() }
            return samples
        }

        func clear() {
            lock.lock()
            defer { lock.unlock() }
            samples.removeAll(keepingCapacity: false)
        }
    }

    @Published var isRecording = false
    @Published var audioLevel: Float = 0.0
    @Published var transcribedText = ""
    @Published var isEnhancing = false
    @Published var isFinalizingTranscription = false

    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private let sampleStore = AudioSampleStore()
    private let firstPCMReadyGate = FirstPCMReadyGate()
    private var preferredInputDeviceID: AudioDeviceID?
    private var inputSampleRate: Double = 16000
    private var completedAudioArchiveURL: URL?

    private var finalizeTimeoutTask: Task<Void, Never>?
    private var hasDeliveredFinalResult = false
    private var isAwaitingFirstPCM = false
    var sessionReportsPartialResultsOverride: Bool?

    var onTranscriptionFinished: ((String) -> Void)?
    private(set) var lastStartFailureMessage: String?
    private var pendingRuntimeFailureMessage: String?

    /// Bumped on every capture-graph rebuild so in-flight tap callbacks from an
    /// old graph are discarded after Bluetooth reconnect / health recovery.
    private var captureGraphGeneration = 0
    private var lastPCMArrivalAt: Date?
    private var didReceiveCapturePCMCallback = false
    private var captureHealthWatchdogTask: Task<Void, Never>?
    private var captureConfigurationChangeObserver: NSObjectProtocol?
    private var captureRecoveryAttemptsUsed = 0
    private var isCaptureRecoveryInFlight = false
    private var activeCaptureDeviceID: AudioDeviceID?
    private var activeCaptureUsesPreferredInputDevice = false
    private let captureHealthPlanner = CaptureHealthPlanner()

    init() {
        refreshSpeechRecognizer(localeIdentifier: nil)
    }

    func setPreferredInputDevice(_ deviceID: AudioDeviceID?) {
        preferredInputDeviceID = deviceID
    }

    func requestPermissions() async -> Bool {
        guard await RecordingPermissionRequest.speechRecognitionAccess() else { return false }
        return await RecordingPermissionRequest.microphoneAccess()
    }

    func consumeCompletedAudioArchiveURL() -> URL? {
        let url = completedAudioArchiveURL
        completedAudioArchiveURL = nil
        return url
    }

    func discardCompletedAudioArchive() {
        removeCompletedAudioArchiveIfNeeded()
    }

    func consumePendingRuntimeFailureMessage() -> String? {
        let message = pendingRuntimeFailureMessage
        pendingRuntimeFailureMessage = nil
        return message
    }

    func startRecording() {
        guard !isRecording, !isAwaitingFirstPCM else { return }
        lastStartFailureMessage = nil
        removeCompletedAudioArchiveIfNeeded()

        let settings = resolvedDictationSettings()
        refreshSpeechRecognizer(localeIdentifier: settings.localeIdentifier)

        guard let recognizer = speechRecognizer else {
            let message = AppLocalization.localizedString("Direct Dictation is unavailable for the current language.")
            lastStartFailureMessage = message
            VoxtLog.asrWarning("Speech transcriber start blocked: recognizer is unavailable for current locale.")
            return
        }
        if settings.prefersOnDeviceRecognition && !recognizer.supportsOnDeviceRecognition {
            let message = AppLocalization.localizedString("Direct Dictation on-device recognition is unavailable for the selected language.")
            lastStartFailureMessage = message
            VoxtLog.asrWarning(
                "Speech transcriber start blocked: on-device recognition is unavailable. locale=\(recognizer.locale.identifier)"
            )
            return
        }
        guard recognizer.isAvailable else {
            let message = AppLocalization.localizedString("Direct Dictation is temporarily unavailable. Try again in a moment.")
            lastStartFailureMessage = message
            VoxtLog.asrWarning("Speech transcriber start blocked: recognizer is not currently available.")
            return
        }

        cleanupSessionState()
        resetCaptureHealthState()
        pendingRuntimeFailureMessage = nil
        sampleStore.clear()
        firstPCMReadyGate.reset()
        transcribedText = ""
        audioLevel = 0
        hasDeliveredFinalResult = false
        isAwaitingFirstPCM = true

        do {
            try startSpeechRecognition(recognizer: recognizer, settings: settings)
            Task { @MainActor [weak self] in
                await self?.completeSpeechCaptureStartupAfterFirstPCM()
            }
        } catch {
            isAwaitingFirstPCM = false
            firstPCMReadyGate.cancel()
            lastStartFailureMessage = AppLocalization.localizedString("Direct Dictation failed to start recording.")
            VoxtLog.asrError("Speech transcriber start recording failed: \(error)")
            cleanupSessionState()
        }
    }

    /// Starts capture and waits for the first retained PCM batch before reporting ready.
    /// Returns a user-facing failure message, or `nil` on success / cancel.
    @discardableResult
    func startRecordingSession() async -> String? {
        guard !isRecording, !isAwaitingFirstPCM else { return nil }
        lastStartFailureMessage = nil
        removeCompletedAudioArchiveIfNeeded()

        let settings = resolvedDictationSettings()
        refreshSpeechRecognizer(localeIdentifier: settings.localeIdentifier)

        guard let recognizer = speechRecognizer else {
            let message = AppLocalization.localizedString("Direct Dictation is unavailable for the current language.")
            lastStartFailureMessage = message
            VoxtLog.asrWarning("Speech transcriber start blocked: recognizer is unavailable for current locale.")
            return message
        }
        if settings.prefersOnDeviceRecognition && !recognizer.supportsOnDeviceRecognition {
            let message = AppLocalization.localizedString("Direct Dictation on-device recognition is unavailable for the selected language.")
            lastStartFailureMessage = message
            VoxtLog.asrWarning(
                "Speech transcriber start blocked: on-device recognition is unavailable. locale=\(recognizer.locale.identifier)"
            )
            return message
        }
        guard recognizer.isAvailable else {
            let message = AppLocalization.localizedString("Direct Dictation is temporarily unavailable. Try again in a moment.")
            lastStartFailureMessage = message
            VoxtLog.asrWarning("Speech transcriber start blocked: recognizer is not currently available.")
            return message
        }

        cleanupSessionState()
        resetCaptureHealthState()
        pendingRuntimeFailureMessage = nil
        sampleStore.clear()
        firstPCMReadyGate.reset()
        transcribedText = ""
        audioLevel = 0
        hasDeliveredFinalResult = false
        isAwaitingFirstPCM = true

        do {
            try startSpeechRecognition(recognizer: recognizer, settings: settings)
        } catch {
            isAwaitingFirstPCM = false
            firstPCMReadyGate.cancel()
            let message = AppLocalization.localizedString("Direct Dictation failed to start recording.")
            lastStartFailureMessage = message
            VoxtLog.asrError("Speech transcriber start recording failed: \(error)")
            cleanupSessionState()
            return message
        }

        return await completeSpeechCaptureStartupAfterFirstPCM()
    }

    func stopRecording() {
        firstPCMReadyGate.cancel()
        if isAwaitingFirstPCM {
            isAwaitingFirstPCM = false
            stopAudioCapture()
            cleanupSessionState()
            return
        }
        guard isRecording else { return }

        stopAudioCapture()
        isRecording = false

        finalizeTimeoutTask?.cancel()
        finalizeTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(900))
            await MainActor.run {
                self?.forceFinalizeIfNeeded()
            }
        }
    }

    func shutdownForApplicationTermination() {
        firstPCMReadyGate.cancel()
        isAwaitingFirstPCM = false
        stopAudioCapture()
        cleanupSessionState()
        removeCompletedAudioArchiveIfNeeded()
        audioLevel = 0
        isEnhancing = false
        isFinalizingTranscription = false
        onTranscriptionFinished = nil
    }

    func restartCaptureForPreferredInputDevice() throws {
        guard isRecording else { return }
        let settings = resolvedDictationSettings()
        refreshSpeechRecognizer(localeIdentifier: settings.localeIdentifier)
        guard let recognizer = speechRecognizer else {
            throw NSError(
                domain: "SayIt.SpeechTranscriber",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Speech recognizer is unavailable."]
            )
        }
        if settings.prefersOnDeviceRecognition && !recognizer.supportsOnDeviceRecognition {
            throw NSError(
                domain: "SayIt.SpeechTranscriber",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "On-device recognition is unavailable for the selected language."]
            )
        }
        stopAudioCapture(endHealthMonitoring: false)
        firstPCMReadyGate.reset()
        try startSpeechRecognition(
            recognizer: recognizer,
            settings: settings,
            forceSystemDefaultInput: false,
            resetArrivalTracking: true
        )
        // Mid-session device switch already reported ready; keep capturing without re-gating UI.
        firstPCMReadyGate.noteValidPCM()
    }

    @discardableResult
    private func completeSpeechCaptureStartupAfterFirstPCM() async -> String? {
        let outcome = await firstPCMReadyGate.wait()
        guard isAwaitingFirstPCM else { return nil }
        switch outcome {
        case .ready:
            isAwaitingFirstPCM = false
            isRecording = true
            lastStartFailureMessage = nil
            VoxtLog.asr("Speech first PCM ready; recording reported as ready.", verbose: true)
            return nil
        case .timedOut:
            isAwaitingFirstPCM = false
            stopAudioCapture()
            cleanupSessionState()
            let message = FirstPCMReadyGate.timeoutUserMessage
            lastStartFailureMessage = message
            VoxtLog.asrWarning("Speech first PCM wait timed out.")
            return message
        case .cancelled:
            isAwaitingFirstPCM = false
            stopAudioCapture()
            cleanupSessionState()
            VoxtLog.asr("Speech first PCM wait cancelled during capture startup.", verbose: true)
            return nil
        case .failed(let message):
            isAwaitingFirstPCM = false
            stopAudioCapture()
            cleanupSessionState()
            lastStartFailureMessage = message
            VoxtLog.asrWarning("Speech first PCM wait failed: \(message)")
            return message
        }
    }

    private func cleanupSessionState() {
        finalizeTimeoutTask?.cancel()
        finalizeTimeoutTask = nil
        isRecording = false
        isAwaitingFirstPCM = false
        endCaptureHealthMonitoring()
        clearRecognitionPipeline(cancelTask: true)
        sampleStore.clear()
    }

    private func stopAudioCapture(endHealthMonitoring: Bool = true) {
        if endHealthMonitoring {
            endCaptureHealthMonitoring()
        }
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
    }

    private func forceFinalizeIfNeeded() {
        guard !hasDeliveredFinalResult else { return }
        finishRecognition(with: transcribedText)
    }

    private func finishRecognition(with text: String) {
        guard !hasDeliveredFinalResult else { return }
        hasDeliveredFinalResult = true

        finalizeTimeoutTask?.cancel()
        finalizeTimeoutTask = nil
        clearRecognitionPipeline(cancelTask: true)
        stageCompletedAudioArchive()

        onTranscriptionFinished?(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func startSpeechRecognition(
        recognizer: SFSpeechRecognizer,
        settings: ResolvedDictationSettings,
        forceSystemDefaultInput: Bool = false,
        resetArrivalTracking: Bool = true,
        recreateRecognitionPipeline: Bool = true
    ) throws {
        if recreateRecognitionPipeline {
            clearRecognitionPipeline(cancelTask: true)
        }

        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        audioEngine.reset()

        let request: SFSpeechAudioBufferRecognitionRequest
        if recreateRecognitionPipeline || recognitionRequest == nil {
            let newRequest = SFSpeechAudioBufferRecognitionRequest()
            newRequest.shouldReportPartialResults = settings.reportsPartialResults
            newRequest.taskHint = .dictation
            newRequest.contextualStrings = settings.contextualPhrases
            newRequest.requiresOnDeviceRecognition = settings.prefersOnDeviceRecognition
            if #available(macOS 13.0, *) {
                newRequest.addsPunctuation = settings.addsPunctuation
            }
            recognitionRequest = newRequest
            request = newRequest
        } else {
            request = recognitionRequest!
        }

        let inputNode = audioEngine.inputNode
        let didApplyPreferredInputDevice = forceSystemDefaultInput
            ? false
            : applyPreferredInputDeviceIfNeeded(inputNode: inputNode)
        activeCaptureUsesPreferredInputDevice = didApplyPreferredInputDevice
        let activeInputDeviceID = didApplyPreferredInputDevice ? preferredInputDeviceID : AudioInputDeviceManager.defaultInputDeviceID()
        let nodeOutputFormat = inputNode.outputFormat(forBus: 0)
        let hardwareSampleRate = AudioInputDeviceManager.nominalSampleRate(for: activeInputDeviceID)
        let tapFormat = AudioInputDeviceManager.captureTapFormat(
            nodeOutputFormat: nodeOutputFormat,
            hardwareSampleRate: hardwareSampleRate
        )
        inputSampleRate = tapFormat.sampleRate

        if abs(tapFormat.sampleRate - nodeOutputFormat.sampleRate) > 1 {
            VoxtLog.warning(
                "Speech transcriber adjusted input tap format. deviceID=\(activeInputDeviceID.map(String.init(describing:)) ?? "default"), hardwareSampleRate=\(hardwareSampleRate.map { String(Int($0.rounded())) } ?? "unknown"), nodeSampleRate=\(Int(nodeOutputFormat.sampleRate.rounded())), tapSampleRate=\(Int(tapFormat.sampleRate.rounded()))"
            )
        }

        let graphGeneration = beginCaptureHealthMonitoring(
            activeDeviceID: activeInputDeviceID,
            resetArrivalTracking: resetArrivalTracking
        )
        let firstPCMReadyGate = self.firstPCMReadyGate
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: tapFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.recognitionRequest?.append(buffer)

            if let samples = AudioLevelMeter.monoSamples(from: buffer), !samples.isEmpty {
                // Retain every valid PCM batch from the first frame onward; then open the ready gate.
                self.sampleStore.append(samples)
                firstPCMReadyGate.noteValidPCM()
            }

            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameLength = Int(buffer.frameLength)
            if frameLength == 0 { return }

            var rms: Float = 0
            for i in 0..<frameLength {
                rms += channelData[i] * channelData[i]
            }
            rms = sqrt(rms / Float(frameLength))
            let normalized = min(rms * 20, 1.0)

            Task { @MainActor [weak self] in
                guard let self else { return }
                self.noteCapturePCMArrival(graphGeneration: graphGeneration)
                self.audioLevel = normalized
            }
        }

        audioEngine.prepare()
        try audioEngine.start()

        guard recreateRecognitionPipeline || recognitionTask == nil else { return }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            if let result {
                let text = result.bestTranscription.formattedString
                Task { @MainActor in
                    let allowsPartial = self.sessionReportsPartialResultsOverride ?? true
                    if allowsPartial || result.isFinal {
                        self.transcribedText = text
                    }
                    if result.isFinal {
                        self.finishRecognition(with: text)
                    }
                }
            }

            if let error {
                let nsError = error as NSError
                if nsError.domain != "kAFAssistantErrorDomain" || (nsError.code != 216 && nsError.code != 1110) {
                    VoxtLog.asrError("Speech recognition error: \(error)")
                }

                Task { @MainActor in
                    if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110 {
                        self.finishRecognition(with: "")
                        return
                    }

                    self.finishRecognition(with: self.transcribedText)
                }
            }
        }
    }

    // MARK: - Capture health (configuration-change rebuild + zero-buffer watchdog)

    private func noteCapturePCMArrival(graphGeneration: Int) {
        guard graphGeneration == captureGraphGeneration else { return }
        lastPCMArrivalAt = Date()
        if !didReceiveCapturePCMCallback {
            didReceiveCapturePCMCallback = true
            startCaptureHealthWatchdogIfNeeded()
        }
    }

    @discardableResult
    private func beginCaptureHealthMonitoring(
        activeDeviceID: AudioDeviceID?,
        resetArrivalTracking: Bool
    ) -> Int {
        activeCaptureDeviceID = activeDeviceID
        captureGraphGeneration += 1
        registerCaptureConfigurationChangeObserverIfNeeded()
        if resetArrivalTracking {
            lastPCMArrivalAt = nil
            didReceiveCapturePCMCallback = false
            cancelCaptureHealthWatchdog()
        } else {
            lastPCMArrivalAt = Date()
            if didReceiveCapturePCMCallback {
                startCaptureHealthWatchdogIfNeeded()
            }
        }
        return captureGraphGeneration
    }

    private func endCaptureHealthMonitoring() {
        cancelCaptureHealthWatchdog()
        unregisterCaptureConfigurationChangeObserver()
        isCaptureRecoveryInFlight = false
        lastPCMArrivalAt = nil
        didReceiveCapturePCMCallback = false
        activeCaptureDeviceID = nil
    }

    private func resetCaptureHealthState() {
        endCaptureHealthMonitoring()
        captureGraphGeneration = 0
        captureRecoveryAttemptsUsed = 0
    }

    private func registerCaptureConfigurationChangeObserverIfNeeded() {
        guard captureConfigurationChangeObserver == nil else { return }
        let engine = audioEngine
        captureConfigurationChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleCaptureConfigurationChange()
            }
        }
    }

    private func unregisterCaptureConfigurationChangeObserver() {
        if let captureConfigurationChangeObserver {
            NotificationCenter.default.removeObserver(captureConfigurationChangeObserver)
            self.captureConfigurationChangeObserver = nil
        }
    }

    private func cancelCaptureHealthWatchdog() {
        captureHealthWatchdogTask?.cancel()
        captureHealthWatchdogTask = nil
    }

    private func startCaptureHealthWatchdogIfNeeded() {
        guard captureHealthWatchdogTask == nil else { return }
        guard isRecording || isAwaitingFirstPCM else { return }
        captureHealthWatchdogTask = Task { @MainActor [weak self] in
            while let self, !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                self.evaluateCaptureHealthWatchdogTick()
            }
        }
    }

    private func handleCaptureConfigurationChange() {
        guard isRecording || isAwaitingFirstPCM else { return }
        guard !isCaptureRecoveryInFlight else { return }
        VoxtLog.asrWarning(
            "Speech audio engine configuration changed during capture; rebuilding graph in place."
        )
        performCaptureGraphRecovery(fallbackToDefaultDevice: false, reason: "configuration-change")
    }

    private func evaluateCaptureHealthWatchdogTick() {
        guard isRecording || isAwaitingFirstPCM else { return }
        guard !isCaptureRecoveryInFlight else { return }
        guard didReceiveCapturePCMCallback, let lastPCMArrivalAt else { return }

        let secondsSinceLastBuffer = Date().timeIntervalSince(lastPCMArrivalAt)
        let activeDeviceIsBluetooth = activeCaptureDeviceID.map(CaptureHealthSupport.isBluetoothInputDevice) ?? false
        let action = captureHealthPlanner.action(
            isRecording: isRecording || isAwaitingFirstPCM,
            callbacksReceived: didReceiveCapturePCMCallback,
            secondsSinceLastBuffer: secondsSinceLastBuffer,
            activeDeviceIsBluetooth: activeDeviceIsBluetooth,
            recoveryAttemptsUsed: captureRecoveryAttemptsUsed
        )
        switch action {
        case .none:
            return
        case .restartCurrentDevice:
            VoxtLog.asrWarning(
                "Speech capture went silent for \(String(format: "%.2f", secondsSinceLastBuffer))s; restarting current-device graph. attemptsUsed=\(captureRecoveryAttemptsUsed)"
            )
            performCaptureGraphRecovery(fallbackToDefaultDevice: false, reason: "health-restart-current")
        case .fallbackToDefaultDevice:
            VoxtLog.asrWarning(
                "Speech capture still silent after restart; falling back to system default input. attemptsUsed=\(captureRecoveryAttemptsUsed)"
            )
            performCaptureGraphRecovery(fallbackToDefaultDevice: true, reason: "health-fallback-default")
        case .reportFailure:
            VoxtLog.asrError(
                "Speech capture health recovery budget exhausted. silenceSec=\(String(format: "%.2f", secondsSinceLastBuffer)), attemptsUsed=\(captureRecoveryAttemptsUsed)"
            )
            cancelCaptureHealthWatchdog()
            let message = "Microphone capture stalled. Check your input device and try again."
            pendingRuntimeFailureMessage = message
            lastStartFailureMessage = message
            stopAudioCapture()
            isRecording = false
            finishRecognition(with: transcribedText)
        }
    }

    private func performCaptureGraphRecovery(fallbackToDefaultDevice: Bool, reason: String) {
        guard !isCaptureRecoveryInFlight else { return }
        isCaptureRecoveryInFlight = true
        defer { isCaptureRecoveryInFlight = false }

        if reason != "configuration-change" {
            captureRecoveryAttemptsUsed += 1
        }

        let settings = resolvedDictationSettings()
        refreshSpeechRecognizer(localeIdentifier: settings.localeIdentifier)
        guard let recognizer = speechRecognizer else {
            VoxtLog.asrError("Speech capture graph rebuild failed: recognizer unavailable. reason=\(reason)")
            return
        }

        do {
            // Keep the SFSpeech recognition task/request; only rebuild the AVAudioEngine tap.
            if audioEngine.isRunning {
                audioEngine.stop()
            }
            audioEngine.inputNode.removeTap(onBus: 0)
            try startSpeechRecognition(
                recognizer: recognizer,
                settings: settings,
                forceSystemDefaultInput: fallbackToDefaultDevice,
                resetArrivalTracking: false,
                recreateRecognitionPipeline: false
            )
            lastPCMArrivalAt = Date()
            VoxtLog.asrWarning(
                "Speech capture graph rebuilt. reason=\(reason), fallback=\(fallbackToDefaultDevice), attemptsUsed=\(captureRecoveryAttemptsUsed), graphGeneration=\(captureGraphGeneration)"
            )
        } catch {
            VoxtLog.asrError(
                "Speech capture graph rebuild failed. reason=\(reason), error=\(error.localizedDescription)"
            )
            pendingRuntimeFailureMessage = error.localizedDescription
            lastStartFailureMessage = error.localizedDescription
            stopAudioCapture()
            isRecording = false
            finishRecognition(with: transcribedText)
        }
    }

    private func clearRecognitionPipeline(cancelTask: Bool) {
        if cancelTask {
            recognitionTask?.cancel()
        }
        recognitionTask = nil
        recognitionRequest = nil
    }

    @discardableResult
    private func applyPreferredInputDeviceIfNeeded(inputNode: AVAudioInputNode) -> Bool {
        guard let preferredInputDeviceID,
              preferredInputDeviceID != AudioDeviceID(kAudioObjectUnknown)
        else {
            return false
        }
        guard let audioUnit = inputNode.audioUnit else { return false }
        var deviceID = preferredInputDeviceID
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        if status != noErr {
            VoxtLog.asrWarning("Unable to switch input device. status=\(status)")
            return false
        }
        return true
    }

    private func resolvedDictationSettings() -> ResolvedDictationSettings {
        let defaults = UserDefaults.standard
        let settings = ASRHintSettingsStore.resolvedSettings(
            for: .dictation,
            rawValue: defaults.string(forKey: AppPreferenceKey.asrHintSettings)
        )
        let userLanguageCodes = UserMainLanguageOption.storedSelection(
            from: defaults.string(forKey: AppPreferenceKey.userMainLanguageCodes)
        )
        let resolved = ASRHintResolver.resolveDictationSettings(
            settings: settings,
            userLanguageCodes: userLanguageCodes
        )
        if let override = sessionReportsPartialResultsOverride {
            return ResolvedDictationSettings(
                localeIdentifier: resolved.localeIdentifier,
                contextualPhrases: resolved.contextualPhrases,
                prefersOnDeviceRecognition: resolved.prefersOnDeviceRecognition,
                addsPunctuation: resolved.addsPunctuation,
                reportsPartialResults: override
            )
        }
        return resolved
    }

    private func refreshSpeechRecognizer(localeIdentifier: String?) {
        let locale = localeIdentifier.map(Locale.init(identifier:)) ?? Locale.current
        speechRecognizer = SFSpeechRecognizer(locale: locale)
        if speechRecognizer == nil {
            lastStartFailureMessage = AppLocalization.localizedString("Direct Dictation is unavailable for the current language.")
            VoxtLog.asrWarning("Speech recognizer initialization failed for locale=\(locale.identifier).")
        }
    }

    private func stageCompletedAudioArchive() {
        removeCompletedAudioArchiveIfNeeded()
        let samples = sampleStore.snapshot()
        guard !samples.isEmpty else { return }
        let tempURL = HistoryAudioArchiveSupport.temporaryArchiveURL(prefix: "voxt-speech-history")
        do {
            if try HistoryAudioArchiveSupport.exportWAV(samples: samples, sampleRate: inputSampleRate, to: tempURL) {
                completedAudioArchiveURL = tempURL
            }
        } catch {
            try? FileManager.default.removeItem(at: tempURL)
            VoxtLog.asrWarning("Speech completed audio archive export failed: \(error.localizedDescription)")
        }
    }

    private func removeCompletedAudioArchiveIfNeeded() {
        guard let completedAudioArchiveURL else { return }
        try? FileManager.default.removeItem(at: completedAudioArchiveURL)
        self.completedAudioArchiveURL = nil
    }
}
