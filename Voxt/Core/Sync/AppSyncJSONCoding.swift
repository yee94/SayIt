// AppSyncJSONCoding.swift
// Shared JSON encode/decode helpers for folder and package sync payloads.
// Dates use ISO-8601 with fractional seconds on write; read accepts both with and without.

import Foundation

/// Shared JSON coding for sync envelopes (settings, usage, manual packages, baselines).
enum AppSyncJSONCoding {
    nonisolated static func makeEncoder(
        outputFormatting: JSONEncoder.OutputFormatting = []
    ) -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = outputFormatting
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }

    nonisolated static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = fractional.date(from: value) ?? plain.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return decoder
    }
}

/// Resolves the shared per-device sync identifier used by dictionary, usage, and settings sync.
enum AppSyncDeviceID {
    /// Prefer `syncDeviceId`, then legacy `dictionarySyncDeviceId`, then `usageSyncDeviceId`, else generate.
    /// Migrates a resolved legacy value into `syncDeviceId`; legacy keys remain as read-only fallbacks.
    nonisolated static func resolved(defaults: UserDefaults) -> String {
        if let existing = nonEmptyString(defaults.string(forKey: AppPreferenceKey.syncDeviceId)) {
            return existing
        }
        if let legacy = nonEmptyString(defaults.string(forKey: AppPreferenceKey.dictionarySyncDeviceId)) {
            defaults.set(legacy, forKey: AppPreferenceKey.syncDeviceId)
            return legacy
        }
        if let legacy = nonEmptyString(defaults.string(forKey: AppPreferenceKey.usageSyncDeviceId)) {
            defaults.set(legacy, forKey: AppPreferenceKey.syncDeviceId)
            return legacy
        }
        let generated = UUID().uuidString.lowercased()
        defaults.set(generated, forKey: AppPreferenceKey.syncDeviceId)
        return generated
    }

    /// Historical usage-only device id from UserDefaults when it differs from the unified id.
    /// Used only as a migration source for local `usage_daily` rows; never treats other imported devices as local.
    nonisolated static func legacyUsageMigrationSourceID(
        defaults: UserDefaults,
        currentDeviceID: String
    ) -> String? {
        guard let legacy = nonEmptyString(defaults.string(forKey: AppPreferenceKey.usageSyncDeviceId)),
              legacy != currentDeviceID else {
            return nil
        }
        return legacy
    }

    nonisolated private static func nonEmptyString(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}
