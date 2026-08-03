// DownloadProgressPublishSupport.swift
// Throttles high-frequency download progress publishes so SwiftUI catalog layout
// does not thrash the main thread during large local model downloads.

import Foundation

enum DownloadProgressPublishSupport {
    /// Progress sampler interval used by download managers.
    static let samplerIntervalMilliseconds: UInt64 = 500

    /// Minimum absolute progress change (0...1) before publishing again.
    static let minimumProgressDelta: Double = 0.01

    /// Minimum completed-byte change before publishing again.
    static let minimumCompletedBytesDelta: Int64 = 256 * 1024

    static func shouldPublishDownloadingUpdate(
        previousProgress: Double,
        previousCompleted: Int64,
        previousTotal: Int64,
        previousCurrentFile: String?,
        previousCompletedFiles: Int,
        previousTotalFiles: Int,
        nextProgress: Double,
        nextCompleted: Int64,
        nextTotal: Int64,
        nextCurrentFile: String?,
        nextCompletedFiles: Int,
        nextTotalFiles: Int
    ) -> Bool {
        if previousCurrentFile != nextCurrentFile {
            return true
        }
        if previousCompletedFiles != nextCompletedFiles {
            return true
        }
        if previousTotalFiles != nextTotalFiles {
            return true
        }
        if previousTotal != nextTotal {
            return true
        }

        let clampedNextProgress = min(max(nextProgress, 0), 1)
        if clampedNextProgress >= 0.999 {
            return true
        }
        if nextTotal > 0, nextCompleted >= nextTotal {
            return true
        }

        if abs(clampedNextProgress - previousProgress) >= minimumProgressDelta {
            return true
        }
        if abs(nextCompleted - previousCompleted) >= minimumCompletedBytesDelta {
            return true
        }

        return false
    }
}
