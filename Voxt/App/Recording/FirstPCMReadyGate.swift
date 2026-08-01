// FirstPCMReadyGate.swift
// Pure first-PCM readiness latch for recording capture startup.

import Foundation

/// Thread-safe latch that becomes ready only after the first non-empty PCM batch is retained.
///
/// Modeled after SayIt's first-frame gate: `AVAudioEngine.start()` / stream play only means the
/// driver accepted the start request. Recording is not truly ready until a real PCM callback
/// has buffered audio. Call `noteValidPCM()` from the audio tap after retaining samples;
/// await `wait(timeout:)` on the start path before reporting readiness to AppDelegate.
nonisolated final class FirstPCMReadyGate: @unchecked Sendable {
    enum Outcome: Equatable, Sendable {
        case ready
        case timedOut
        case cancelled
        case failed(String)
    }

    /// Matches SayIt's `FIRST_FRAME_READY_TIMEOUT` (10s) for Bluetooth mic connection stalls.
    static let defaultTimeout: Duration = .seconds(10)

    static var timeoutUserMessage: String {
        AppLocalization.localizedString(
            "Bluetooth microphone connection timed out. Check the device and try again."
        )
    }

    private let lock = NSLock()
    private var outcome: Outcome?
    private var waiters: [CheckedContinuation<Outcome, Never>] = []

    /// Clears any prior outcome so the gate can be reused for a new capture attempt.
    func reset() {
        lock.lock()
        outcome = nil
        let pending = waiters
        waiters.removeAll(keepingCapacity: false)
        lock.unlock()
        for waiter in pending {
            waiter.resume(returning: .cancelled)
        }
    }

    /// Call from the audio callback after a non-empty PCM batch has been retained.
    /// Returns `true` when this call transitions the gate to ready.
    @discardableResult
    func noteValidPCM() -> Bool {
        resolve(.ready)
    }

    /// Surfaces a capture-side failure that occurs before the first PCM batch.
    @discardableResult
    func noteFailure(_ message: String) -> Bool {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return resolve(.failed(Self.timeoutUserMessage))
        }
        return resolve(.failed(trimmed))
    }

    /// Cancels an in-flight wait (user stop/cancel during startup).
    @discardableResult
    func cancel() -> Bool {
        resolve(.cancelled)
    }

    /// Waits until ready, failure, cancel, or timeout.
    func wait(timeout: Duration = defaultTimeout) async -> Outcome {
        if let existing = snapshotOutcome() {
            return existing
        }

        return await withTaskGroup(of: Outcome.self) { group in
            group.addTask {
                await self.awaitResolution()
            }
            group.addTask {
                do {
                    try await Task.sleep(for: timeout)
                    _ = self.resolve(.timedOut)
                    return self.snapshotOutcome() ?? .timedOut
                } catch {
                    return self.snapshotOutcome() ?? .cancelled
                }
            }

            let first = await group.next() ?? .cancelled
            group.cancelAll()
            return first
        }
    }

    private func awaitResolution() async -> Outcome {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let outcome {
                lock.unlock()
                continuation.resume(returning: outcome)
                return
            }
            waiters.append(continuation)
            lock.unlock()
        }
    }

    private func snapshotOutcome() -> Outcome? {
        lock.lock()
        defer { lock.unlock() }
        return outcome
    }

    @discardableResult
    private func resolve(_ value: Outcome) -> Bool {
        lock.lock()
        if outcome != nil {
            lock.unlock()
            return false
        }
        outcome = value
        let pending = waiters
        waiters.removeAll(keepingCapacity: false)
        lock.unlock()
        for waiter in pending {
            waiter.resume(returning: value)
        }
        return true
    }
}
