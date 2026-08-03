// AppSyncZipSupport.swift
// Safe ZIP list/extract/create helpers for portable sync transfer.
// Uses system `/usr/bin/unzip` / `/usr/bin/zip` (or `ditto` for create fallback).

import Foundation

/// Errors from portable ZIP inspection, extraction, or creation.
enum AppSyncZipSupportError: LocalizedError, Equatable {
    case invalidZip
    case unsafeEntry(String)
    case extractFailed(String)
    case createFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidZip:
            return AppLocalization.localizedString("Invalid ZIP archive.")
        case .unsafeEntry(let path):
            return AppLocalization.format("Unsafe ZIP entry: %@", path)
        case .extractFailed(let detail):
            return AppLocalization.format("ZIP extract failed: %@", detail)
        case .createFailed(let detail):
            return AppLocalization.format("ZIP create failed: %@", detail)
        }
    }
}

/// System-tool ZIP helpers with path-traversal and symlink defenses.
enum AppSyncZipSupport {
    /// Maximum path depth (components) allowed inside a portable archive.
    nonisolated static let maxEntryDepth = 8

    /// Lists relative entry paths from a ZIP using `/usr/bin/unzip -Z -1`.
    nonisolated static func listEntries(in zipURL: URL) throws -> [String] {
        let result = try runProcess(
            executable: "/usr/bin/unzip",
            arguments: ["-Z", "-1", zipURL.path]
        )
        guard result.terminationStatus == 0 else {
            throw AppSyncZipSupportError.invalidZip
        }
        let lines = result.stdout
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        for line in lines {
            try validateEntryPath(line)
        }
        return lines
    }

    /// Validates a relative ZIP entry path (no absolute, `.`/`..`, or excessive depth).
    nonisolated static func validateEntryPath(_ path: String) throws {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw AppSyncZipSupportError.unsafeEntry(path)
        }
        if trimmed.hasPrefix("/") || trimmed.hasPrefix("\\") {
            throw AppSyncZipSupportError.unsafeEntry(path)
        }
        // Reject Windows drive-style absolute paths.
        if trimmed.count >= 2,
           trimmed[trimmed.startIndex].isLetter,
           trimmed[trimmed.index(after: trimmed.startIndex)] == ":" {
            throw AppSyncZipSupportError.unsafeEntry(path)
        }

        let components = trimmed
            .split(separator: "/")
            .map(String.init)
            .filter { !$0.isEmpty }
        if components.isEmpty {
            throw AppSyncZipSupportError.unsafeEntry(path)
        }
        if components.count > maxEntryDepth {
            throw AppSyncZipSupportError.unsafeEntry(path)
        }
        for component in components {
            if component == "." || component == ".." {
                throw AppSyncZipSupportError.unsafeEntry(path)
            }
        }
    }

    /// Extracts a ZIP into a fresh temporary directory after entry validation.
    /// Post-extract: rejects symlinks and any path that escapes the temp root.
    /// Caller owns cleanup of the returned directory (also cleaned if validation fails mid-way).
    nonisolated static func extractToTemporaryDirectory(zipURL: URL) throws -> URL {
        // Validate listing first (rejects absolute / .. / deep paths before extract).
        _ = try listEntries(in: zipURL)

        let fileManager = FileManager.default
        let tempRoot = fileManager.temporaryDirectory
            .appendingPathComponent("voxt-portable-zip-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: tempRoot, withIntermediateDirectories: true)

        do {
            let result = try runProcess(
                executable: "/usr/bin/unzip",
                arguments: ["-q", "-o", zipURL.path, "-d", tempRoot.path]
            )
            guard result.terminationStatus == 0 else {
                let detail = result.stderr.isEmpty ? "status \(result.terminationStatus)" : result.stderr
                throw AppSyncZipSupportError.extractFailed(detail)
            }
            try validateExtractedTree(at: tempRoot)
            return tempRoot
        } catch {
            try? fileManager.removeItem(at: tempRoot)
            throw error
        }
    }

    /// Creates a standard ZIP at `destinationURL` whose root contains only the given files
    /// (relative names must already be safe single-component names).
    nonisolated static func createZip(
        at destinationURL: URL,
        rootFiles: [(name: String, data: Data)]
    ) throws {
        guard !rootFiles.isEmpty else {
            throw AppSyncZipSupportError.createFailed("empty archive")
        }
        for file in rootFiles {
            try validateEntryPath(file.name)
            if file.name.contains("/") {
                throw AppSyncZipSupportError.createFailed("nested root files are not supported")
            }
        }

        let fileManager = FileManager.default
        let staging = fileManager.temporaryDirectory
            .appendingPathComponent("voxt-portable-zip-stage-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: staging) }

        for file in rootFiles {
            let fileURL = staging.appendingPathComponent(file.name, isDirectory: false)
            try file.data.write(to: fileURL, options: .atomic)
        }

        if fileManager.fileExists(atPath: destinationURL.path) {
            try fileManager.removeItem(at: destinationURL)
        }
        // Ensure parent directory exists.
        let parent = destinationURL.deletingLastPathComponent()
        if !fileManager.fileExists(atPath: parent.path) {
            try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        }

        // Prefer `/usr/bin/zip -j` for a flat standard ZIP at archive root.
        let zipResult = try runProcess(
            executable: "/usr/bin/zip",
            arguments: ["-q", "-j", destinationURL.path] + rootFiles.map(\.name),
            currentDirectory: staging
        )
        if zipResult.terminationStatus == 0,
           fileManager.fileExists(atPath: destinationURL.path) {
            return
        }

        // Fallback: `ditto -c -k` of staging contents (flat, no parent folder name).
        if fileManager.fileExists(atPath: destinationURL.path) {
            try? fileManager.removeItem(at: destinationURL)
        }
        let dittoResult = try runProcess(
            executable: "/usr/bin/ditto",
            arguments: ["-c", "-k", "--sequesterRsrc", ".", destinationURL.path],
            currentDirectory: staging
        )
        guard dittoResult.terminationStatus == 0,
              fileManager.fileExists(atPath: destinationURL.path) else {
            let detail = zipResult.stderr.isEmpty
                ? (dittoResult.stderr.isEmpty ? "zip/ditto failed" : dittoResult.stderr)
                : zipResult.stderr
            throw AppSyncZipSupportError.createFailed(detail)
        }
    }

    // MARK: - Post-extract validation

    nonisolated static func validateExtractedTree(at rootURL: URL) throws {
        let fileManager = FileManager.default
        let rootPath = rootURL.resolvingSymlinksInPath().standardizedFileURL.path
        guard let enumerator = fileManager.enumerator(
            at: rootURL,
            includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey],
            options: [.skipsPackageDescendants]
        ) else {
            throw AppSyncZipSupportError.extractFailed("unable to enumerate extract root")
        }

        while let item = enumerator.nextObject() as? URL {
            let values = try item.resourceValues(forKeys: [.isSymbolicLinkKey])
            if values.isSymbolicLink == true {
                throw AppSyncZipSupportError.unsafeEntry(item.path)
            }

            let standardized = item.resolvingSymlinksInPath().standardizedFileURL.path
            // Must stay under temp root (no escape via crafted links already rejected).
            let isInside = standardized == rootPath
                || standardized.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/")
            if !isInside {
                throw AppSyncZipSupportError.unsafeEntry(item.path)
            }

            let relative = String(standardized.dropFirst(rootPath.count))
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !relative.isEmpty {
                try validateEntryPath(relative)
            }
        }
    }

    // MARK: - Process

    private struct ProcessResult {
        var terminationStatus: Int32
        var stdout: String
        var stderr: String
    }

    nonisolated private static func runProcess(
        executable: String,
        arguments: [String],
        currentDirectory: URL? = nil
    ) throws -> ProcessResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let currentDirectory {
            process.currentDirectoryURL = currentDirectory
        }
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        process.standardInput = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            throw AppSyncZipSupportError.createFailed(error.localizedDescription)
        }
        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        return ProcessResult(
            terminationStatus: process.terminationStatus,
            stdout: String(data: stdoutData, encoding: .utf8) ?? "",
            stderr: String(data: stderrData, encoding: .utf8) ?? ""
        )
    }
}
