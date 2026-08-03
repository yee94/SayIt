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
    /// Current package envelope version (settings fields may be v2 shape with revision).
    nonisolated static let packageVersion = 1
    nonisolated static let fileExtensionHint = "json"

    /// Builds a JSON package containing settings fields, usage days, and dictionary transfer JSON.
    /// Settings collect is baseline-aware so unchanged values keep stable revision/updatedAt.
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
        // Backup package must include imported peer-device usage, not only this device.
        let usageDays = usageSummaryStore?.exportedSnapshotsForAllDevices() ?? []
        let dictionaryTransferJSON = try dictionaryStore.exportTransferJSONString()

        let envelope = AppSyncPackageEnvelope(
            version: packageVersion,
            exportedAt: exportedAt,
            deviceID: deviceID,
            settingsFields: settingsFields,
            usageDays: usageDays,
            dictionaryTransferJSON: dictionaryTransferJSON
        )

        let encoder = AppSyncJSONCoding.makeEncoder(
            outputFormatting: [.prettyPrinted, .sortedKeys]
        )
        return try encoder.encode(envelope)
    }

    /// Imports a package and merges into local stores (settings field LWW, usage LWW, dictionary skip-duplicates).
    /// Settings: package fields are LWW-merged against a baseline-aware local collect; winning
    /// fields are applied and their baselines updated so the next export keeps winner revision.
    @MainActor
    static func importPackage(
        data: Data,
        dictionaryStore: DictionaryStore,
        usageSummaryStore: UsageDaySummaryStore?,
        defaults: UserDefaults = .standard
    ) throws -> AppSyncPackageImportResult {
        let decoder = AppSyncJSONCoding.makeDecoder()
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
            // Read-only local snapshot for LWW (does not mutate baseline).
            // Diverged local values use now + revision+1 so unexported edits beat older packages.
            let localFields = AppSettingsSyncSnapshotIO.collectFieldsForMerge(defaults: defaults)
            let localEnvelope = AppSettingsSyncSnapshotIO.Envelope(
                version: AppSettingsSyncSnapshotIO.envelopeVersion,
                deviceID: "local",
                exportedAt: Date(timeIntervalSince1970: 0),
                fields: localFields
            )
            // Normalize package fields so v1 monolithic featureSettings become groups.
            let normalizedImport = AppSettingsSyncSnapshotIO.normalizeFieldsFromLegacyIfNeeded(
                importFields
            )
            let packageEnvelope = AppSettingsSyncSnapshotIO.Envelope(
                version: AppSettingsSyncSnapshotIO.envelopeVersion,
                deviceID: envelope.deviceID.isEmpty ? "package" : envelope.deviceID,
                exportedAt: envelope.exportedAt,
                fields: normalizedImport
            )
            let merged = AppSettingsSyncSnapshotIO.mergeFields(
                snapshots: [localEnvelope, packageEnvelope]
            )
            let packageByKey = Dictionary(
                uniqueKeysWithValues: normalizedImport.map { ($0.key, $0) }
            )
            // Only apply package winners. Local winners keep their values and baselines untouched
            // so never-baselined local keys are not polluted with epoch revision metadata.
            var packageWinners: [String: AppSettingsSyncSnapshotIO.AppSettingsSyncField] = [:]
            packageWinners.reserveCapacity(packageByKey.count)
            for (key, packageField) in packageByKey {
                guard let winner = merged[key] else { continue }
                let isPackageWinner = winner.value == packageField.value
                    && winner.revision == packageField.revision
                    && abs(
                        winner.updatedAt.timeIntervalSince1970
                            - packageField.updatedAt.timeIntervalSince1970
                    ) < 0.001
                if isPackageWinner {
                    packageWinners[key] = packageField
                }
            }
            if !packageWinners.isEmpty {
                AppSettingsSyncSnapshotIO.applyMergedFields(packageWinners, to: defaults)
            }
            settingsApplied = packageWinners.count
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
