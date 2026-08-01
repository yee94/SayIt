// DictionaryLearningObservationFlow.swift
// Provides Dictionary Learning Observation Flow for app lifecycle and routing.

import Foundation
import AppKit

extension AppDelegate {
    func scheduleAutomaticDictionaryLearningIfNeeded(
        insertedText rawInsertedText: String,
        outputMode: SessionOutputMode,
        didInject: Bool,
        didTriggerAutoKeyPress: Bool,
        historyEntryID: UUID?
    ) {
        let insertedText = rawInsertedText.trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduleDecision = AutomaticDictionaryLearningMonitor.observationScheduleDecision(
            didInject: didInject,
            isTranscriptionOutput: outputMode == .transcription,
            isFeatureEnabled: dictionaryAutoLearningEnabled,
            insertedText: insertedText,
            didTriggerAutoKeyPress: didTriggerAutoKeyPress
        )

        switch scheduleDecision {
        case .schedule:
            break
        case .skipTextNotInjected:
            VoxtLog.dictionary("Automatic dictionary learning skipped: text was not injected.", verbose: true)
            return
        case .skipNonTranscriptionOutput:
            VoxtLog.dictionary(
                "Automatic dictionary learning skipped: output mode is \(RecordingSessionSupport.outputLabel(for: outputMode)).",
                verbose: true
            )
            return
        case .skipFeatureDisabled:
            VoxtLog.dictionary("Automatic dictionary learning skipped: feature disabled.", verbose: true)
            return
        case .skipEmptyText:
            VoxtLog.dictionary("Automatic dictionary learning skipped: inserted text is empty.", verbose: true)
            return
        case .skipAutoKeyPress:
            VoxtLog.dictionary(
                "Automatic dictionary learning skipped: app enhancement auto key press was triggered.",
                verbose: true
            )
            return
        }

        let scope = currentDictionaryScope()
        let expectedBundleID = sessionTargetApplicationBundleID
            ?? NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let expectedProcessIdentifier = sessionTargetApplicationPID
            ?? NSWorkspace.shared.frontmostApplication?.processIdentifier

        VoxtLog.dictionary(
            "Automatic dictionary learning scheduled. chars=\(insertedText.count), expectedBundleID=\(expectedBundleID ?? "nil"), expectedPID=\(expectedProcessIdentifier.map(String.init) ?? "nil"), historyEntryID=\(historyEntryID?.uuidString ?? "nil"), windowSec=\(Int(AutomaticDictionaryLearningMonitor.observationWindowSeconds)), idleSec=\(Int(AutomaticDictionaryLearningMonitor.idleSettleSeconds))"
        )

        pendingAutomaticDictionaryLearningTask?.cancel()
        pendingAutomaticDictionaryLearningTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.pendingAutomaticDictionaryLearningTask = nil }
            await self.runAutomaticDictionaryLearningObservation(
                insertedText: insertedText,
                expectedBundleID: expectedBundleID,
                expectedProcessIdentifier: expectedProcessIdentifier,
                groupID: scope.groupID,
                groupNameSnapshot: scope.groupName,
                historyEntryID: historyEntryID
            )
        }
    }

    private func runAutomaticDictionaryLearningObservation(
        insertedText: String,
        expectedBundleID: String?,
        expectedProcessIdentifier: pid_t?,
        groupID: UUID?,
        groupNameSnapshot: String?,
        historyEntryID: UUID?
    ) async {
        do {
            VoxtLog.dictionary(
                "Automatic dictionary learning observation started. expectedBundleID=\(expectedBundleID ?? "nil"), expectedPID=\(expectedProcessIdentifier.map(String.init) ?? "nil"), historyEntryID=\(historyEntryID?.uuidString ?? "nil")"
            )

            try await Task.sleep(
                nanoseconds: AutomaticDictionaryLearningMonitor.startupDelayNanoseconds
            )
            try Task.checkCancellation()

            // Use injected text as baseline so observation can start even when early AX reads fail.
            let baselineScopedText = AutomaticDictionaryLearningMonitor.observationScopedText(
                insertedText: insertedText,
                baselineText: insertedText,
                currentText: insertedText
            )
            VoxtLog.dictionary(
                "Automatic dictionary learning baseline using injected text. chars=\(insertedText.count), scopedChars=\(baselineScopedText.count). Empty snapshots will keep polling for the full observation window."
            )

            let observation = try await automaticDictionaryLearningObservationResult(
                insertedText: insertedText,
                baselineScopedText: baselineScopedText,
                expectedBundleID: expectedBundleID,
                expectedProcessIdentifier: expectedProcessIdentifier
            )
            guard observation.didObserveChange else {
                VoxtLog.dictionary("Automatic dictionary learning finished without detected user edits in observation window.")
                return
            }

            let requestOutcome = AutomaticDictionaryLearningMonitor.makeLearningRequest(
                insertedText: insertedText,
                baselineText: baselineScopedText,
                finalText: observation.finalText
            )
            guard case .ready(let request) = requestOutcome else {
                if case .skipped(let reason) = requestOutcome {
                    VoxtLog.dictionary("Automatic dictionary learning skipped after diff analysis: \(reason)")
                }
                return
            }
            VoxtLog.dictionary(
                "Automatic dictionary learning request ready. editRatio=\(String(format: "%.3f", request.editRatio)), changedBeforeChars=\(request.baselineChangedFragment.count), changedAfterChars=\(request.finalChangedFragment.count)"
            )

            try await analyzeAutomaticDictionaryLearningRequest(
                request,
                groupID: groupID,
                groupNameSnapshot: groupNameSnapshot,
                historyEntryID: historyEntryID
            )
        } catch is CancellationError {
            VoxtLog.dictionary("Automatic dictionary learning cancelled.")
        } catch {
            VoxtLog.dictionaryWarning("Automatic dictionary learning failed: \(error)")
        }
    }

    private func automaticDictionaryLearningObservationResult(
        insertedText: String,
        baselineScopedText: String,
        expectedBundleID: String?,
        expectedProcessIdentifier: pid_t?
    ) async throws -> AutomaticDictionaryLearningObservation {
        var state = AutomaticDictionaryLearningObservationState(
            baselineText: baselineScopedText
        )
        var lastChangeAt: Date?
        var didLogDeferredAnalysis = false
        var didLogEmptySnapshotWait = false
        let deadline = Date().addingTimeInterval(
            AutomaticDictionaryLearningMonitor.observationWindowSeconds
        )

        while Date() < deadline {
            try Task.checkCancellation()
            try await Task.sleep(
                nanoseconds: AutomaticDictionaryLearningMonitor.pollIntervalNanoseconds
            )

            let elapsedSinceLastChange = lastChangeAt.map { Date().timeIntervalSince($0) }
            state.lastChangeElapsedSeconds = elapsedSinceLastChange
            var shouldTerminateObservation = false

            if let snapshot = await currentFocusedInputTextSnapshotForAutomaticDictionaryLearning(
                expectedBundleID: expectedBundleID,
                expectedProcessIdentifier: expectedProcessIdentifier
            ) {
                didLogEmptySnapshotWait = false
                let scopedText = AutomaticDictionaryLearningMonitor.observationScopedText(
                    insertedText: insertedText,
                    baselineText: insertedText,
                    currentText: snapshot.text
                )
                let previousText = state.latestText
                switch AutomaticDictionaryLearningMonitor.observeSnapshot(
                    text: scopedText,
                    elapsedSinceLastChange: elapsedSinceLastChange,
                    state: &state
                ) {
                case .continueObserving:
                    if scopedText == state.latestText, state.didObserveChange,
                       let elapsedSinceLastChange,
                       elapsedSinceLastChange >= AutomaticDictionaryLearningMonitor.idleSettleSeconds,
                       AutomaticDictionaryLearningMonitor.shouldContinueObservingForPotentialReplacement(
                            baselineText: baselineScopedText,
                            currentFinalText: state.latestText
                       ) {
                        if !didLogDeferredAnalysis {
                            VoxtLog.dictionary(
                                "Automatic dictionary learning deferred analysis: latest observed edit still looks like an incomplete deletion/replacement."
                            )
                            didLogDeferredAnalysis = true
                        }
                        continue
                    }

                    if scopedText == previousText {
                        continue
                    }

                    VoxtLog.dictionary(
                        "Automatic dictionary learning observed input change. previousChars=\(previousText.count), currentChars=\(scopedText.count), role=\(snapshot.role ?? "unknown"), editable=\(snapshot.isEditable), focused=\(snapshot.isFocusedTarget), textSource=\(snapshot.textSource ?? "nil")"
                    )
                    didLogDeferredAnalysis = false
                    lastChangeAt = Date()
                case .stopWithoutAnalysis:
                    shouldTerminateObservation = true
                case .settleForAnalysis:
                    shouldTerminateObservation = AutomaticDictionaryLearningMonitor.shouldFinalizeWhileFocused(
                        decision: .settleForAnalysis(finalText: state.latestText)
                    )
                }
            } else {
                switch AutomaticDictionaryLearningMonitor.observeMissingSnapshot(state: &state) {
                case .continueObserving:
                    if !state.didObserveChange, !didLogEmptySnapshotWait {
                        VoxtLog.dictionary(
                            "Automatic dictionary learning empty snapshot; continuing to poll until observation deadline. consecutiveMissing=\(state.consecutiveMissingSnapshots)"
                        )
                        didLogEmptySnapshotWait = true
                    }
                    continue
                case .stopWithoutAnalysis:
                    VoxtLog.dictionary(
                        "Automatic dictionary learning stopped early: focused input missing for \(state.consecutiveMissingSnapshots) consecutive polls."
                    )
                    shouldTerminateObservation = true
                case .settleForAnalysis:
                    VoxtLog.dictionary(
                        "Automatic dictionary learning settled after observed edit while focus was missing for \(state.consecutiveMissingSnapshots) consecutive polls."
                    )
                    shouldTerminateObservation = true
                }
            }

            if shouldTerminateObservation {
                break
            }
        }

        if state.didObserveChange,
           AutomaticDictionaryLearningMonitor.shouldContinueObservingForPotentialReplacement(
                baselineText: state.baselineText,
                currentFinalText: state.latestText
           ) {
            VoxtLog.dictionary(
                "Automatic dictionary learning finished without completed replacement inside observed text scope."
            )
            return AutomaticDictionaryLearningObservation(
                finalText: state.latestText,
                didObserveChange: false
            )
        }

        return AutomaticDictionaryLearningObservation(
            finalText: state.latestText,
            didObserveChange: state.didObserveChange
        )
    }
}

private struct AutomaticDictionaryLearningObservation {
    let finalText: String
    let didObserveChange: Bool
}
