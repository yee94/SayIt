// AppSyncPackageTransfer.swift
// Unified manual export/import package for dictionary + usage day summaries + settings metadata.
// Shares serialization/merge rules with folder-based sync; never includes API keys.

import Foundation

/// Single-file JSON envelope for manual sync package transfer.
struct AppSyncPackageEnvelope: Codable, Sendable {
    var version: Int
    var exportedAt: Date
    var deviceID: String
    var settingsFields: [AppSettingsSyncSnapshotIO.AppSettingsSyncField]?
    var usageDays: [UsageDailySnapshot]?
    var dictionaryTransferJSON: String?
}

/// Result counts from a merge-style package import.
struct AppSyncPackageImportResult: Equatable, Sendable {
    var settingsApplied: Int
    var usageDaysImported: Int
    var dictionaryAdded: Int
    var dictionarySkipped: Int
}

enum AppSyncPackageTransferError: LocalizedError, Equatable {
    case unsupportedVersion(Int)
    case invalidPackage

    var errorDescription: String? {
        switch self {
        case .unsupportedVersion(let version):
            return AppLocalization.format(
                "Unsupported sync package version: %d",
                version
            )
        case .invalidPackage:
            return AppLocalization.localizedString("Invalid sync package.")
        }
    }
}

/// Builds and applies unified manual export/import packages.
enum AppSyncPackageTransfer {
    nonisolated static let packageVersion = 1
    nonisolated static let fileExtensionHint = "json"

    /// Builds a JSON package containing settings fields, usage days, and dictionary transfer JSON.
    @MainActor
    static func exportPackage(
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults = .standard,
        deviceID: String,
        exportedAt: Date = Date()
    ) throws -> Data {
        let settingsFields = AppSettingsSyncSnapshotIO.collectFields(
            defaults: defaults,
            exportedAt: exportedAt
        )
        let usageDays = usageSummaryStore?.exportedSnapshots() ?? []
        let dictionaryTransferJSON = try dictionaryStore.exportTransferJSONString()

        let envelope = AppSyncPackageEnvelope(
            version: packageVersion,
            exportedAt: exportedAt,
            deviceID: deviceID,
            settingsFields: settingsFields,
            usageDays: usageDays,
            dictionaryTransferJSON: dictionaryTransferJSON
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(envelope)
    }

    /// Imports a package and merges into local stores (settings LWW, usage LWW, dictionary skip-duplicates).
    @MainActor
    static func importPackage(
        data: Data,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults = .standard
    ) throws -> AppSyncPackageImportResult {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope: AppSyncPackageEnvelope
        do {
            envelope = try decoder.decode(AppSyncPackageEnvelope.self, from: data)
        } catch {
            throw AppSyncPackageTransferError.invalidPackage
        }

        guard envelope.version == packageVersion else {
            throw AppSyncPackageTransferError.unsupportedVersion(envelope.version)
        }

        var settingsApplied = 0
        if let importFields = envelope.settingsFields, !importFields.isEmpty {
            // Manual import applies package settings for included keys (package wins on overlap).
            // Local-only keys remain untouched. Field-level LWW with a fresh local collect would
            // always stamp local fields as "now" and defeat package values for shared keys.
            var fieldMap: [String: AppSettingsSyncSnapshotIO.AppSettingsSyncField] = [:]
            fieldMap.reserveCapacity(importFields.count)
            for field in importFields {
                if let existing = fieldMap[field.key], existing.updatedAt > field.updatedAt {
                    continue
                }
                fieldMap[field.key] = field
            }
            AppSettingsSyncSnapshotIO.applyMergedFields(fieldMap, to: defaults)
            settingsApplied = fieldMap.count
        }

        var usageDaysImported = 0
        if let days = envelope.usageDays, !days.isEmpty {
            usageSummaryStore?.importSnapshots(days)
            usageDaysImported = days.count
        }

        var dictionaryAdded = 0
        var dictionarySkipped = 0
        if let dictionaryJSON = envelope.dictionaryTransferJSON?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !dictionaryJSON.isEmpty {
            let result = try dictionaryStore.importTransferJSONString(dictionaryJSON)
            dictionaryAdded = result.addedCount
            dictionarySkipped = result.skippedCount
        }

        return AppSyncPackageImportResult(
            settingsApplied: settingsApplied,
            usageDaysImported: usageDaysImported,
            dictionaryAdded: dictionaryAdded,
            dictionarySkipped: dictionarySkipped
        )
    }
}
