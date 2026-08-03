// AppSettingsSyncBaselineStore.swift
// Per-logical-field baseline for settings sync v2 (value encoding, revision, updatedAt).
// Used to keep revision/updatedAt stable across collects when local values are unchanged,
// and to suppress re-export echo after applying remote winners.

import Foundation

/// Last-exported baseline for a single logical settings field.
struct AppSettingsSyncFieldBaseline: Codable, Equatable, Sendable {
    /// JSON-encoded `StoredPreferenceValue` string (same shape as snapshot field `value`).
    var value: String
    var revision: Int
    var updatedAt: Date
}

/// Local baseline map keyed by logical field key (preference key or feature group key).
struct AppSettingsSyncBaselineStore: Codable, Equatable, Sendable {
    var entries: [String: AppSettingsSyncFieldBaseline]

    init(entries: [String: AppSettingsSyncFieldBaseline] = [:]) {
        self.entries = entries
    }

    nonisolated static func load(defaults: UserDefaults) -> AppSettingsSyncBaselineStore {
        guard let raw = defaults.string(forKey: AppPreferenceKey.appSettingsSyncBaseline),
              let data = raw.data(using: .utf8) else {
            return AppSettingsSyncBaselineStore()
        }
        let decoder = AppSyncJSONCoding.makeDecoder()
        guard let decoded = try? decoder.decode(AppSettingsSyncBaselineStore.self, from: data) else {
            return AppSettingsSyncBaselineStore()
        }
        return decoded
    }

    nonisolated func save(to defaults: UserDefaults) {
        let encoder = AppSyncJSONCoding.makeEncoder(outputFormatting: [.sortedKeys])
        guard let data = try? encoder.encode(self),
              let raw = String(data: data, encoding: .utf8) else {
            return
        }
        defaults.set(raw, forKey: AppPreferenceKey.appSettingsSyncBaseline)
    }

    nonisolated func baseline(forKey key: String) -> AppSettingsSyncFieldBaseline? {
        entries[key]
    }

    nonisolated mutating func setBaseline(
        _ baseline: AppSettingsSyncFieldBaseline,
        forKey key: String
    ) {
        entries[key] = baseline
    }

    /// Replaces baselines for the given fields (value + revision + updatedAt).
    nonisolated mutating func updateFromFields(
        _ fields: [AppSettingsSyncSnapshotIO.AppSettingsSyncField]
    ) {
        for field in fields {
            entries[field.key] = AppSettingsSyncFieldBaseline(
                value: field.value,
                revision: field.revision,
                updatedAt: field.updatedAt
            )
        }
    }

    /// Updates baselines for applied remote winners using the field metadata and
    /// the current (post-apply) encoded values so the next collect does not echo.
    nonisolated mutating func recordAppliedFields(
        _ fields: [String: AppSettingsSyncSnapshotIO.AppSettingsSyncField],
        currentEncodedValues: [String: String]
    ) {
        for (key, field) in fields {
            guard let encoded = currentEncodedValues[key] else { continue }
            entries[key] = AppSettingsSyncFieldBaseline(
                value: encoded,
                revision: field.revision,
                updatedAt: field.updatedAt
            )
        }
    }
}
