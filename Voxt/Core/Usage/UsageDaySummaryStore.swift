// UsageDaySummaryStore.swift
// Provides local per-day usage summary accumulation for report and future multi-device sync.

import Foundation
import Combine
import GRDB

struct UsageDailyAppValue: Codable, Hashable, Sendable {
    var name: String?
    var characters: Int
    var dictationSeconds: Double
}

struct UsageDailySnapshot: Codable, Hashable, Sendable {
    var day: String
    var deviceID: String
    var dictationSeconds: Double
    var characters: Int
    var translationCharacters: Int
    var sessionCount: Int
    var apps: [String: UsageDailyAppValue]
    var updatedAt: Date
}

protocol UsageDaySummaryRecording: AnyObject {
    func recordSession(
        createdAt: Date,
        text: String,
        isTranslation: Bool,
        kind: TranscriptionHistoryKind,
        duration: TimeInterval?,
        appName: String?,
        appBundleID: String?,
        browserURLHost: String?
    )

    func recordRewriteDelta(
        updatedAt: Date,
        oldText: String,
        newText: String,
        oldDuration: TimeInterval?,
        newDuration: TimeInterval?,
        appName: String?,
        appBundleID: String?,
        browserURLHost: String?
    )
}

@MainActor
final class UsageDaySummaryStore: UsageDaySummaryRecording, ObservableObject {
    private let database: VoxtDatabase
    private let defaults: UserDefaults
    private let deviceID: String

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = Calendar.current.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    init(
        database: VoxtDatabase = .shared,
        defaults: UserDefaults = .standard,
        deviceID: String? = nil
    ) {
        self.database = database
        self.defaults = defaults
        self.deviceID = deviceID ?? Self.resolvedSyncDeviceID(defaults: defaults)
    }

    static func resolvedSyncDeviceID(defaults: UserDefaults) -> String {
        if let existing = defaults.string(forKey: AppPreferenceKey.dictionarySyncDeviceId)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !existing.isEmpty {
            return existing
        }
        if let existing = defaults.string(forKey: AppPreferenceKey.usageSyncDeviceId)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !existing.isEmpty {
            return existing
        }
        let generated = UUID().uuidString
        defaults.set(generated, forKey: AppPreferenceKey.usageSyncDeviceId)
        return generated
    }

    static func dayString(for date: Date) -> String {
        let start = Calendar.current.startOfDay(for: date)
        return dayFormatter.string(from: start)
    }

    static func appKey(
        kind: TranscriptionHistoryKind?,
        appBundleID: String?,
        browserURLHost: String?,
        includeApps: Bool
    ) -> String? {
        guard includeApps else { return nil }
        if let bundleID = appBundleID?.trimmingCharacters(in: .whitespacesAndNewlines), !bundleID.isEmpty {
            return bundleID
        }
        if let host = browserURLHost?.trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty {
            return "web:\(host)"
        }
        return "unknown"
    }

    func recordSession(
        createdAt: Date,
        text: String,
        isTranslation: Bool,
        kind: TranscriptionHistoryKind,
        duration: TimeInterval?,
        appName: String?,
        appBundleID: String?,
        browserURLHost: String?
    ) {
        let characters = text.count
        let seconds = max(duration ?? 0, 0)
        let translationCharacters = (isTranslation || kind == .translation) ? characters : 0
        let includeApps = kind != .transcript
        let appKey = Self.appKey(
            kind: kind,
            appBundleID: appBundleID,
            browserURLHost: browserURLHost,
            includeApps: includeApps
        )
        applyDelta(
            day: Self.dayString(for: createdAt),
            dictationSecondsDelta: seconds,
            charactersDelta: characters,
            translationCharactersDelta: translationCharacters,
            sessionCountDelta: 1,
            appKey: appKey,
            appName: appName,
            appCharactersDelta: includeApps ? characters : 0,
            appSecondsDelta: includeApps ? seconds : 0
        )
    }

    func recordRewriteDelta(
        updatedAt: Date,
        oldText: String,
        newText: String,
        oldDuration: TimeInterval?,
        newDuration: TimeInterval?,
        appName: String?,
        appBundleID: String?,
        browserURLHost: String?
    ) {
        let charactersDelta = newText.count - oldText.count
        let secondsDelta = (newDuration ?? 0) - (oldDuration ?? 0)
        let appKey = Self.appKey(
            kind: nil,
            appBundleID: appBundleID,
            browserURLHost: browserURLHost,
            includeApps: true
        )
        applyDelta(
            day: Self.dayString(for: updatedAt),
            dictationSecondsDelta: secondsDelta,
            charactersDelta: charactersDelta,
            translationCharactersDelta: 0,
            sessionCountDelta: 0,
            appKey: appKey,
            appName: appName,
            appCharactersDelta: charactersDelta,
            appSecondsDelta: secondsDelta
        )
    }

    /// Returns daily snapshots keyed by `yyyy-MM-dd` for the current device, newest-first limited window.
    func dailyTotals(lastDays: Int = 90) -> [String: UsageDailySnapshot] {
        let limit = max(lastDays, 1)
        do {
            return try database.dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        WHERE device_id = ?
                        ORDER BY day DESC
                        LIMIT ?
                        """,
                    arguments: [deviceID, limit]
                )
                var result: [String: UsageDailySnapshot] = [:]
                result.reserveCapacity(rows.count)
                for row in rows {
                    let snapshot = try Self.snapshot(from: row)
                    result[snapshot.day] = snapshot
                }
                return result
            }
        } catch {
            VoxtLog.historyWarning("Usage daily totals read failed: \(error.localizedDescription)")
            return [:]
        }
    }

    func snapshot(day: String) -> UsageDailySnapshot? {
        do {
            return try database.dbQueue.read { db in
                guard let row = try Row.fetchOne(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        WHERE day = ? AND device_id = ?
                        """,
                    arguments: [day, deviceID]
                ) else {
                    return nil
                }
                return try Self.snapshot(from: row)
            }
        } catch {
            VoxtLog.historyWarning("Usage daily snapshot read failed: \(error.localizedDescription)")
            return nil
        }
    }

    /// Local-device day summaries for folder sync export (newest-first, limited window).
    func exportedSnapshots(limit: Int = 400) -> [UsageDailySnapshot] {
        let capped = max(limit, 1)
        do {
            return try database.dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        WHERE device_id = ?
                        ORDER BY day DESC
                        LIMIT ?
                        """,
                    arguments: [deviceID, capped]
                )
                return try rows.map { try Self.snapshot(from: $0) }
            }
        } catch {
            VoxtLog.historyWarning("Usage daily export failed: \(error.localizedDescription)")
            return []
        }
    }

    /// Merge remote per-device day summaries into `usage_daily`.
    /// Skips a remote row when local `(day, deviceID)` exists with `updatedAt >= remote.updatedAt`.
    func importSnapshots(_ snapshots: [UsageDailySnapshot]) {
        guard !snapshots.isEmpty else { return }
        for snapshot in snapshots {
            do {
                try database.dbQueue.write { db in
                    if let existing = try Row.fetchOne(
                        db,
                        sql: """
                            SELECT updated_at
                            FROM usage_daily
                            WHERE day = ? AND device_id = ?
                            """,
                        arguments: [snapshot.day, snapshot.deviceID]
                    ) {
                        let existingInterval: Double = existing["updated_at"] ?? 0
                        let existingUpdatedAt = Date(timeIntervalSince1970: existingInterval)
                        if existingUpdatedAt >= snapshot.updatedAt {
                            return
                        }
                    }

                    let appsJSON = try VoxtPersistenceCoding.encodeJSONString(snapshot.apps)
                    try db.execute(
                        sql: """
                            INSERT INTO usage_daily (
                                day, device_id, dictation_seconds, characters, translation_characters,
                                session_count, apps_json, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(day, device_id) DO UPDATE SET
                                dictation_seconds = excluded.dictation_seconds,
                                characters = excluded.characters,
                                translation_characters = excluded.translation_characters,
                                session_count = excluded.session_count,
                                apps_json = excluded.apps_json,
                                updated_at = excluded.updated_at
                            """,
                        arguments: [
                            snapshot.day,
                            snapshot.deviceID,
                            max(snapshot.dictationSeconds, 0),
                            max(snapshot.characters, 0),
                            max(snapshot.translationCharacters, 0),
                            max(snapshot.sessionCount, 0),
                            appsJSON,
                            snapshot.updatedAt.timeIntervalSince1970
                        ]
                    )
                }
            } catch {
                VoxtLog.historyWarning(
                    "Usage daily import failed for day=\(snapshot.day) device=\(snapshot.deviceID): \(error.localizedDescription)"
                )
            }
        }
    }

    private func applyDelta(
        day: String,
        dictationSecondsDelta: Double,
        charactersDelta: Int,
        translationCharactersDelta: Int,
        sessionCountDelta: Int,
        appKey: String?,
        appName: String?,
        appCharactersDelta: Int,
        appSecondsDelta: Double
    ) {
        let now = Date()
        do {
            try database.dbQueue.write { db in
                let existing = try Row.fetchOne(
                    db,
                    sql: """
                        SELECT dictation_seconds, characters, translation_characters,
                               session_count, apps_json
                        FROM usage_daily
                        WHERE day = ? AND device_id = ?
                        """,
                    arguments: [day, deviceID]
                )

                let existingSeconds: Double = existing?["dictation_seconds"] ?? 0
                let existingCharacters: Int = existing?["characters"] ?? 0
                let existingTranslationCharacters: Int = existing?["translation_characters"] ?? 0
                let existingSessionCount: Int = existing?["session_count"] ?? 0
                let dictationSeconds = max(existingSeconds + dictationSecondsDelta, 0)
                let characters = max(existingCharacters + charactersDelta, 0)
                let translationCharacters = max(existingTranslationCharacters + translationCharactersDelta, 0)
                let sessionCount = max(existingSessionCount + sessionCountDelta, 0)

                var apps: [String: UsageDailyAppValue] = [:]
                if let appsJSON: String = existing?["apps_json"],
                   let decoded = try? VoxtPersistenceCoding.decodeJSON([String: UsageDailyAppValue].self, from: appsJSON) {
                    apps = decoded
                }

                if let appKey {
                    var appValue = apps[appKey] ?? UsageDailyAppValue(name: nil, characters: 0, dictationSeconds: 0)
                    if let appName, !appName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        appValue.name = appName
                    }
                    appValue.characters = max(appValue.characters + appCharactersDelta, 0)
                    appValue.dictationSeconds = max(appValue.dictationSeconds + appSecondsDelta, 0)
                    apps[appKey] = appValue
                }

                let appsJSON = try VoxtPersistenceCoding.encodeJSONString(apps)
                try db.execute(
                    sql: """
                        INSERT INTO usage_daily (
                            day, device_id, dictation_seconds, characters, translation_characters,
                            session_count, apps_json, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(day, device_id) DO UPDATE SET
                            dictation_seconds = excluded.dictation_seconds,
                            characters = excluded.characters,
                            translation_characters = excluded.translation_characters,
                            session_count = excluded.session_count,
                            apps_json = excluded.apps_json,
                            updated_at = excluded.updated_at
                        """,
                    arguments: [
                        day,
                        deviceID,
                        dictationSeconds,
                        characters,
                        translationCharacters,
                        sessionCount,
                        appsJSON,
                        now.timeIntervalSince1970
                    ]
                )
            }
        } catch {
            VoxtLog.historyWarning("Usage daily accumulate failed: \(error.localizedDescription)")
        }
    }

    private static func snapshot(from row: Row) throws -> UsageDailySnapshot {
        let appsJSON: String = row["apps_json"] ?? "{}"
        let apps = (try? VoxtPersistenceCoding.decodeJSON([String: UsageDailyAppValue].self, from: appsJSON)) ?? [:]
        let updatedAtInterval: Double = row["updated_at"] ?? 0
        return UsageDailySnapshot(
            day: row["day"] ?? "",
            deviceID: row["device_id"] ?? "",
            dictationSeconds: row["dictation_seconds"] ?? 0,
            characters: row["characters"] ?? 0,
            translationCharacters: row["translation_characters"] ?? 0,
            sessionCount: row["session_count"] ?? 0,
            apps: apps,
            updatedAt: Date(timeIntervalSince1970: updatedAtInterval)
        )
    }
}
