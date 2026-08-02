// UsageFolderSnapshotIO.swift
// Folder-based usage day summary snapshot IO (shared directory / iCloud Drive).

import Foundation

/// Pure file IO helpers for per-device usage day JSON snapshots.
enum UsageFolderSnapshotIO {
    nonisolated static let filePrefix = "sayit-usage-"
    nonisolated static let fileSuffix = ".json"
    nonisolated static let envelopeVersion = 1

    struct Envelope: Codable, Sendable {
        var version: Int
        var deviceID: String
        var exportedAt: Date
        var days: [UsageDailySnapshot]
    }

    nonisolated static func snapshotFileName(deviceId: String) -> String {
        "\(filePrefix)\(deviceId)\(fileSuffix)"
    }

    nonisolated static func writeSnapshot(
        days: [UsageDailySnapshot],
        directoryURL: URL,
        deviceId: String
    ) throws {
        let envelope = Envelope(
            version: envelopeVersion,
            deviceID: deviceId,
            exportedAt: Date(),
            days: days
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(envelope)

        let fileName = snapshotFileName(deviceId: deviceId)
        let fileURL = directoryURL.appendingPathComponent(fileName, isDirectory: false)
        let tempURL = directoryURL.appendingPathComponent("\(fileName).tmp", isDirectory: false)
        if FileManager.default.fileExists(atPath: tempURL.path) {
            try FileManager.default.removeItem(at: tempURL)
        }
        try data.write(to: tempURL, options: .atomic)
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
        try FileManager.default.moveItem(at: tempURL, to: fileURL)
    }

    /// Lists and parses `sayit-usage-*.json` snapshots. Bad/version-mismatched files are skipped.
    nonisolated static func listSnapshots(
        in directoryURL: URL
    ) throws -> [(deviceID: String, days: [UsageDailySnapshot])] {
        let contents = try FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        var snapshots: [(deviceID: String, days: [UsageDailySnapshot])] = []
        for fileURL in contents {
            let name = fileURL.lastPathComponent
            guard name.hasPrefix(filePrefix),
                  name.hasSuffix(fileSuffix),
                  !name.hasSuffix(".tmp") else { continue }
            let devicePart = String(
                name.dropFirst(filePrefix.count).dropLast(fileSuffix.count)
            )
            guard !devicePart.isEmpty else { continue }

            do {
                let data = try Data(contentsOf: fileURL)
                let envelope = try decoder.decode(Envelope.self, from: data)
                guard envelope.version == envelopeVersion else {
                    VoxtLog.historyWarning(
                        "Usage snapshot skipped (version mismatch). file=\(name) version=\(envelope.version)"
                    )
                    continue
                }
                let deviceID = envelope.deviceID.isEmpty ? devicePart : envelope.deviceID
                snapshots.append((deviceID, envelope.days))
            } catch {
                VoxtLog.historyWarning(
                    "Usage snapshot parse failed. file=\(name) error=\(error.localizedDescription)"
                )
            }
        }
        return snapshots
    }
}
