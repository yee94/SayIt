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
    private let changeSubject = PassthroughSubject<Void, Never>()
    private let localChangeSubject = PassthroughSubject<Void, Never>()

    /// Emits after local accumulate or remote import writes. Callers use this to refresh UI.
    var didChangePublisher: AnyPublisher<Void, Never> {
        changeSubject.eraseToAnyPublisher()
    }

    /// Emits only after local accumulate (not remote import). Folder sync uses this for debounced push.
    var didLocalChangePublisher: AnyPublisher<Void, Never> {
        localChangeSubject.eraseToAnyPublisher()
    }

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
        Self.migrateLegacyUsageDeviceRowsIfNeeded(
            database: database,
            defaults: defaults,
            currentDeviceID: self.deviceID
        )
    }

    static func resolvedSyncDeviceID(defaults: UserDefaults) -> String {
        AppSyncDeviceID.resolved(defaults: defaults)
    }

    /// When unified sync device id differs from historical `usageSyncDeviceId`, merge local rows
    /// written under the legacy id into the unified id so aggregation does not double-count.
    /// Only the UserDefaults-stored legacy usage id is a migration candidate (not imported peers).
    private static func migrateLegacyUsageDeviceRowsIfNeeded(
        database: VoxtDatabase,
        defaults: UserDefaults,
        currentDeviceID: String
    ) {
        guard let legacyDeviceID = AppSyncDeviceID.legacyUsageMigrationSourceID(
            defaults: defaults,
            currentDeviceID: currentDeviceID
        ) else {
            return
        }

        do {
            try database.dbQueue.write { db in
                let legacyRows = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        WHERE device_id = ?
                        """,
                    arguments: [legacyDeviceID]
                )
                guard !legacyRows.isEmpty else { return }

                for row in legacyRows {
                    let legacySnapshot = try snapshot(from: row)
                    let day = legacySnapshot.day
                    let currentRow = try Row.fetchOne(
                        db,
                        sql: """
                            SELECT day, device_id, dictation_seconds, characters, translation_characters,
                                   session_count, apps_json, updated_at
                            FROM usage_daily
                            WHERE day = ? AND device_id = ?
                            """,
                        arguments: [day, currentDeviceID]
                    )

                    let merged: UsageDailySnapshot
                    if let currentRow {
                        let currentSnapshot = try snapshot(from: currentRow)
                        merged = mergeDeviceRows(
                            current: currentSnapshot,
                            legacy: legacySnapshot,
                            deviceID: currentDeviceID
                        )
                    } else {
                        merged = UsageDailySnapshot(
                            day: day,
                            deviceID: currentDeviceID,
                            dictationSeconds: max(legacySnapshot.dictationSeconds, 0),
                            characters: max(legacySnapshot.characters, 0),
                            translationCharacters: max(legacySnapshot.translationCharacters, 0),
                            sessionCount: max(legacySnapshot.sessionCount, 0),
                            apps: legacySnapshot.apps,
                            updatedAt: legacySnapshot.updatedAt
                        )
                    }

                    let appsJSON = try VoxtPersistenceCoding.encodeJSONString(merged.apps)
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
                            merged.day,
                            merged.deviceID,
                            merged.dictationSeconds,
                            merged.characters,
                            merged.translationCharacters,
                            merged.sessionCount,
                            appsJSON,
                            merged.updatedAt.timeIntervalSince1970
                        ]
                    )
                    try db.execute(
                        sql: """
                            DELETE FROM usage_daily
                            WHERE day = ? AND device_id = ?
                            """,
                        arguments: [day, legacyDeviceID]
                    )
                }
            }
        } catch {
            VoxtLog.historyWarning(
                "Usage legacy device migration failed from=\(legacyDeviceID) to=\(currentDeviceID): \(error.localizedDescription)"
            )
        }
    }

    /// Sums numeric fields and apps; keeps the newer `updatedAt`.
    private static func mergeDeviceRows(
        current: UsageDailySnapshot,
        legacy: UsageDailySnapshot,
        deviceID: String
    ) -> UsageDailySnapshot {
        UsageDailySnapshot(
            day: current.day,
            deviceID: deviceID,
            dictationSeconds: max(current.dictationSeconds, 0) + max(legacy.dictationSeconds, 0),
            characters: max(current.characters, 0) + max(legacy.characters, 0),
            translationCharacters: max(current.translationCharacters, 0) + max(legacy.translationCharacters, 0),
            sessionCount: max(current.sessionCount, 0) + max(legacy.sessionCount, 0),
            apps: mergeApps(current.apps, legacy.apps),
            updatedAt: max(current.updatedAt, legacy.updatedAt)
        )
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

    /// Cross-device daily totals: SUM duration/characters/translation/sessionCount; apps merged by key.
    /// `deviceID` on the returned snapshot is empty. Newest-first limited window by distinct day.
    func aggregatedDailyTotals(lastDays: Int = 90) -> [String: UsageDailySnapshot] {
        let limit = max(lastDays, 1)
        do {
            return try database.dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        ORDER BY day DESC
                        """
                )
                var byDay: [String: [UsageDailySnapshot]] = [:]
                byDay.reserveCapacity(min(rows.count, limit))
                for row in rows {
                    let snapshot = try Self.snapshot(from: row)
                    byDay[snapshot.day, default: []].append(snapshot)
                }
                let orderedDays = byDay.keys.sorted(by: >).prefix(limit)
                var result: [String: UsageDailySnapshot] = [:]
                result.reserveCapacity(orderedDays.count)
                for day in orderedDays {
                    guard let snapshots = byDay[day],
                          let aggregated = Self.aggregate(snapshots: snapshots, day: day) else {
                        continue
                    }
                    result[day] = aggregated
                }
                return result
            }
        } catch {
            VoxtLog.historyWarning("Usage aggregated daily totals read failed: \(error.localizedDescription)")
            return [:]
        }
    }

    /// Cross-device SUM for a single day. Apps merged by app key (name kept when present; characters/seconds summed).
    func aggregatedSnapshot(day: String) -> UsageDailySnapshot? {
        do {
            return try database.dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        WHERE day = ?
                        """,
                    arguments: [day]
                )
                let snapshots = try rows.map { try Self.snapshot(from: $0) }
                return Self.aggregate(snapshots: snapshots, day: day)
            }
        } catch {
            VoxtLog.historyWarning("Usage aggregated snapshot read failed: \(error.localizedDescription)")
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

    /// All `(day, deviceID)` rows for backup package export (newest day first, stable deviceID order).
    /// Unlike `exportedSnapshots()`, includes imported peer devices so a full backup is not local-only.
    func exportedSnapshotsForAllDevices(limit: Int = 2000) -> [UsageDailySnapshot] {
        let capped = max(limit, 1)
        do {
            return try database.dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT day, device_id, dictation_seconds, characters, translation_characters,
                               session_count, apps_json, updated_at
                        FROM usage_daily
                        ORDER BY day DESC, device_id ASC
                        LIMIT ?
                        """,
                    arguments: [capped]
                )
                return try rows.map { try Self.snapshot(from: $0) }
            }
        } catch {
            VoxtLog.historyWarning("Usage all-device export failed: \(error.localizedDescription)")
            return []
        }
    }

    /// Merge remote per-device day summaries into `usage_daily`.
    /// Skips a remote row when local `(day, deviceID)` exists with `updatedAt >= remote.updatedAt`.
    /// Publishes `didChangePublisher` when at least one row is written.
    func importSnapshots(_ snapshots: [UsageDailySnapshot]) {
        guard !snapshots.isEmpty else { return }
        var didImport = false
        for snapshot in snapshots {
            do {
                let imported = try database.dbQueue.write { db -> Bool in
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
                            return false
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
                    return true
                }
                if imported {
                    didImport = true
                }
            } catch {
                VoxtLog.historyWarning(
                    "Usage daily import failed for day=\(snapshot.day) device=\(snapshot.deviceID): \(error.localizedDescription)"
                )
            }
        }
        if didImport {
            changeSubject.send()
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
            changeSubject.send()
            localChangeSubject.send()
        } catch {
            VoxtLog.historyWarning("Usage daily accumulate failed: \(error.localizedDescription)")
        }
    }

    private static func aggregate(snapshots: [UsageDailySnapshot], day: String) -> UsageDailySnapshot? {
        guard !snapshots.isEmpty else { return nil }
        var dictationSeconds: Double = 0
        var characters = 0
        var translationCharacters = 0
        var sessionCount = 0
        var apps: [String: UsageDailyAppValue] = [:]
        var updatedAt = Date(timeIntervalSince1970: 0)
        for snapshot in snapshots {
            dictationSeconds += max(snapshot.dictationSeconds, 0)
            characters += max(snapshot.characters, 0)
            translationCharacters += max(snapshot.translationCharacters, 0)
            sessionCount += max(snapshot.sessionCount, 0)
            apps = mergeApps(apps, snapshot.apps)
            if snapshot.updatedAt > updatedAt {
                updatedAt = snapshot.updatedAt
            }
        }
        return UsageDailySnapshot(
            day: day,
            deviceID: "",
            dictationSeconds: dictationSeconds,
            characters: characters,
            translationCharacters: translationCharacters,
            sessionCount: sessionCount,
            apps: apps,
            updatedAt: updatedAt
        )
    }

    private static func mergeApps(
        _ lhs: [String: UsageDailyAppValue],
        _ rhs: [String: UsageDailyAppValue]
    ) -> [String: UsageDailyAppValue] {
        var result = lhs
        for (key, value) in rhs {
            if var existing = result[key] {
                let existingName = existing.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let incomingName = value.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if existingName.isEmpty, !incomingName.isEmpty {
                    existing.name = value.name
                }
                existing.characters = max(existing.characters + value.characters, 0)
                existing.dictationSeconds = max(existing.dictationSeconds + value.dictationSeconds, 0)
                result[key] = existing
            } else {
                result[key] = value
            }
        }
        return result
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
