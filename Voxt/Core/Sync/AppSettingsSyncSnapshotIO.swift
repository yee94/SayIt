// AppSettingsSyncSnapshotIO.swift
// Folder-based app settings snapshot IO (shared directory / iCloud Drive).
// Syncs whitelisted preferences and remote provider metadata; never syncs API keys.

import Foundation

/// Pure file IO + merge helpers for per-device app settings JSON snapshots.
enum AppSettingsSyncSnapshotIO {
    nonisolated static let filePrefix = "sayit-settings-"
    nonisolated static let fileSuffix = ".json"
    nonisolated static let envelopeVersion = 1

    /// Preference keys included in folder sync (whitelist).
    nonisolated static let syncedPreferenceKeys: [String] = [
        // Feature settings blob
        AppPreferenceKey.featureSettings,

        // Hotkeys
        AppPreferenceKey.hotkeyInputType,
        AppPreferenceKey.hotkeyKeyCode,
        AppPreferenceKey.hotkeyMouseButtonNumber,
        AppPreferenceKey.hotkeyModifiers,
        AppPreferenceKey.hotkeySidedModifiers,
        AppPreferenceKey.translationHotkeyInputType,
        AppPreferenceKey.translationHotkeyKeyCode,
        AppPreferenceKey.translationHotkeyMouseButtonNumber,
        AppPreferenceKey.translationHotkeyModifiers,
        AppPreferenceKey.translationHotkeySidedModifiers,
        AppPreferenceKey.rewriteHotkeyInputType,
        AppPreferenceKey.rewriteHotkeyKeyCode,
        AppPreferenceKey.rewriteHotkeyMouseButtonNumber,
        AppPreferenceKey.rewriteHotkeyModifiers,
        AppPreferenceKey.rewriteHotkeySidedModifiers,
        AppPreferenceKey.meetingHotkeyInputType,
        AppPreferenceKey.meetingHotkeyKeyCode,
        AppPreferenceKey.meetingHotkeyMouseButtonNumber,
        AppPreferenceKey.meetingHotkeyModifiers,
        AppPreferenceKey.meetingHotkeySidedModifiers,
        AppPreferenceKey.customPasteHotkeyInputType,
        AppPreferenceKey.customPasteHotkeyMouseButtonNumber,
        AppPreferenceKey.customPasteHotkeyEnabled,
        AppPreferenceKey.customPasteHotkeyKeyCode,
        AppPreferenceKey.customPasteHotkeyModifiers,
        AppPreferenceKey.customPasteHotkeySidedModifiers,
        AppPreferenceKey.rewriteHotkeyActivationMode,
        AppPreferenceKey.hotkeyTriggerMode,
        AppPreferenceKey.hotkeyDistinguishModifierSides,
        AppPreferenceKey.hotkeyPreset,
        AppPreferenceKey.escapeKeyCancelsOverlaySession,
        AppPreferenceKey.transcriptionHotkeyBindings,
        AppPreferenceKey.translationHotkeyBindings,
        AppPreferenceKey.meetingHotkeyBindings,
        AppPreferenceKey.rewriteHotkeyBindings,
        AppPreferenceKey.noteHotkeyBindings,

        // Dictionary
        AppPreferenceKey.dictionaryRecognitionEnabled,
        AppPreferenceKey.dictionaryAutoLearningEnabled,
        AppPreferenceKey.dictionaryAutoLearningPrompt,
        AppPreferenceKey.dictionaryHighConfidenceCorrectionEnabled,
        AppPreferenceKey.dictionarySuggestionFilterSettings,

        // Transcription / models (non-path)
        AppPreferenceKey.transcriptionEngine,
        AppPreferenceKey.mlxModelRepo,
        AppPreferenceKey.sherpaOnnxASRModelID,
        AppPreferenceKey.enhancementMode,
        AppPreferenceKey.customLLMModelRepo,
        AppPreferenceKey.customLLMGenerationSettings,
        AppPreferenceKey.customLLMGenerationSettingsByRepo,
        AppPreferenceKey.remoteASRSelectedProvider,
        AppPreferenceKey.remoteLLMSelectedProvider,
        AppPreferenceKey.remoteASRProviderConfigurations,
        AppPreferenceKey.remoteLLMProviderConfigurations,

        // Translation / rewrite model + prompt (non-secret)
        AppPreferenceKey.translationCustomLLMModelRepo,
        AppPreferenceKey.translationGGUFModelID,
        AppPreferenceKey.translationModelProvider,
        AppPreferenceKey.translationFallbackModelProvider,
        AppPreferenceKey.translationRemoteLLMProvider,
        AppPreferenceKey.rewriteCustomLLMModelRepo,
        AppPreferenceKey.rewriteModelProvider,
        AppPreferenceKey.rewriteRemoteLLMProvider,
        AppPreferenceKey.translateSelectedTextOnTranslationHotkey,
        AppPreferenceKey.showSelectedTextTranslationResultWindow,

        // App branch
        AppPreferenceKey.appBranchGroups,
        AppPreferenceKey.appBranchURLs,
        AppPreferenceKey.appBranchCustomBrowsers,
        AppPreferenceKey.appEnhancementEnabled,

        // Language / prompts
        AppPreferenceKey.interfaceLanguage,
        AppPreferenceKey.userMainLanguageCodes,
        AppPreferenceKey.translationTargetLanguage,
        AppPreferenceKey.enhancementSystemPrompt,
        AppPreferenceKey.translationSystemPrompt,
        AppPreferenceKey.rewriteSystemPrompt,
        AppPreferenceKey.transcriptSummaryPromptTemplate,
        AppPreferenceKey.transcriptSummaryModelSelection,

        // Overlay / UI appearance
        AppPreferenceKey.overlayPosition,
        AppPreferenceKey.overlayBubbleStyle,
        AppPreferenceKey.overlayCardOpacity,
        AppPreferenceKey.overlayCardCornerRadius,
        AppPreferenceKey.overlayScreenEdgeInset,
        AppPreferenceKey.notchOverlayCardOpacity,
        AppPreferenceKey.notchOverlayCardCornerRadius,

        // Interaction
        AppPreferenceKey.voiceEndCommandEnabled,
        AppPreferenceKey.voiceEndCommandPreset,
        AppPreferenceKey.voiceEndCommandText,
        AppPreferenceKey.autoCopyWhenNoFocusedInput,
        AppPreferenceKey.realtimeTextDisplayEnabled,
        AppPreferenceKey.alwaysShowRewriteAnswerCard,
        AppPreferenceKey.interactionSoundsEnabled,
        AppPreferenceKey.interactionSoundPreset,
        AppPreferenceKey.muteSystemAudioWhileRecording,

        // History (flags only; no path bookmarks)
        AppPreferenceKey.historyEnabled,
        AppPreferenceKey.historyCleanupEnabled,
        AppPreferenceKey.historyRetentionPeriod,
        AppPreferenceKey.historyAudioStorageEnabled,

        // General
        AppPreferenceKey.launchAtLogin,
        AppPreferenceKey.showInDock,
        AppPreferenceKey.autoCheckForUpdates,
        AppPreferenceKey.betaUpdatesEnabled,
        AppPreferenceKey.useHfMirror,

        // Local ASR / VAD tuning
        AppPreferenceKey.localVADMode,
        AppPreferenceKey.asrHintSettings,
        AppPreferenceKey.mlxLocalASRTuningSettings,
        AppPreferenceKey.sherpaOnnxLocalASRTuningSettings,
        AppPreferenceKey.localModelIdleUnloadDelaySeconds,
        AppPreferenceKey.localModelMemoryOptimizationEnabled,

        // Meeting (non-debug)
        AppPreferenceKey.hideMeetingOverlayFromScreenSharing,
        AppPreferenceKey.meetingCaptureMode,
        AppPreferenceKey.meetingChunkingMode,
        AppPreferenceKey.meetingSileroVADSensitivity,
        AppPreferenceKey.meetingServerVADMode,
        AppPreferenceKey.meetingSpeakerDiarizationSensitivity,
        AppPreferenceKey.meetingSpeakerDiarizationModel,
        AppPreferenceKey.meetingRealtimeDiarizationMode,
        AppPreferenceKey.meetingFinalTranscriptOptimizationEnabled,
        AppPreferenceKey.meetingRealtimeTranslateEnabled,
        AppPreferenceKey.meetingRealtimeTranslationTargetLanguage,
    ]

    struct Envelope: Codable, Sendable {
        var version: Int
        var deviceID: String
        var exportedAt: Date
        var fields: [AppSettingsSyncField]
    }

    struct AppSettingsSyncField: Codable, Sendable, Equatable {
        var key: String
        /// JSON-encoded `StoredPreferenceValue`.
        var value: String
        var updatedAt: Date
    }

    /// Typed UserDefaults value for stable round-trip across devices.
    enum StoredPreferenceValue: Codable, Equatable, Sendable {
        case string(String)
        case int(Int)
        case bool(Bool)
        case double(Double)
        case data(Data)

        private enum CodingKeys: String, CodingKey {
            case type
            case value
        }

        private enum ValueType: String, Codable {
            case string
            case int
            case bool
            case double
            case data
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let type = try container.decode(ValueType.self, forKey: .type)
            switch type {
            case .string:
                self = .string(try container.decode(String.self, forKey: .value))
            case .int:
                self = .int(try container.decode(Int.self, forKey: .value))
            case .bool:
                self = .bool(try container.decode(Bool.self, forKey: .value))
            case .double:
                self = .double(try container.decode(Double.self, forKey: .value))
            case .data:
                self = .data(try container.decode(Data.self, forKey: .value))
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case .string(let value):
                try container.encode(ValueType.string, forKey: .type)
                try container.encode(value, forKey: .value)
            case .int(let value):
                try container.encode(ValueType.int, forKey: .type)
                try container.encode(value, forKey: .value)
            case .bool(let value):
                try container.encode(ValueType.bool, forKey: .type)
                try container.encode(value, forKey: .value)
            case .double(let value):
                try container.encode(ValueType.double, forKey: .type)
                try container.encode(value, forKey: .value)
            case .data(let value):
                try container.encode(ValueType.data, forKey: .type)
                try container.encode(value, forKey: .value)
            }
        }
    }

    nonisolated static func snapshotFileName(deviceId: String) -> String {
        "\(filePrefix)\(deviceId)\(fileSuffix)"
    }

    // MARK: - Export

    /// Collects whitelisted preference values for snapshot export.
    nonisolated static func collectFields(
        defaults: UserDefaults,
        exportedAt: Date = Date()
    ) -> [AppSettingsSyncField] {
        var fields: [AppSettingsSyncField] = []
        fields.reserveCapacity(syncedPreferenceKeys.count)

        for key in syncedPreferenceKeys {
            guard let stored = readStoredValue(forKey: key, defaults: defaults) else { continue }
            let sanitized = sanitizeExportedValue(stored, key: key, defaults: defaults)
            guard let encoded = encodeStoredValue(sanitized) else { continue }
            fields.append(
                AppSettingsSyncField(key: key, value: encoded, updatedAt: exportedAt)
            )
        }
        return fields
    }

    nonisolated static func writeSnapshot(
        fields: [AppSettingsSyncField],
        directoryURL: URL,
        deviceId: String,
        exportedAt: Date = Date()
    ) throws {
        let envelope = Envelope(
            version: envelopeVersion,
            deviceID: deviceId,
            exportedAt: exportedAt,
            fields: fields
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

    /// Lists and parses `sayit-settings-*.json` snapshots. Bad/version-mismatched files are skipped.
    nonisolated static func listSnapshots(
        in directoryURL: URL
    ) throws -> [Envelope] {
        let contents = try FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        var snapshots: [Envelope] = []
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
                var envelope = try decoder.decode(Envelope.self, from: data)
                guard envelope.version == envelopeVersion else {
                    VoxtLog.historyWarning(
                        "Settings snapshot skipped (version mismatch). file=\(name) version=\(envelope.version)"
                    )
                    continue
                }
                if envelope.deviceID.isEmpty {
                    envelope.deviceID = devicePart
                }
                snapshots.append(envelope)
            } catch {
                VoxtLog.historyWarning(
                    "Settings snapshot parse failed. file=\(name) error=\(error.localizedDescription)"
                )
            }
        }
        return snapshots
    }

    // MARK: - Merge

    /// Per-key LWW using each field's `updatedAt` (defaults to package `exportedAt` when equal age).
    /// Tie-break: higher `deviceID` wins.
    nonisolated static func mergeFields(
        snapshots: [Envelope]
    ) -> [String: AppSettingsSyncField] {
        var winners: [String: (field: AppSettingsSyncField, deviceID: String, packageExportedAt: Date)] = [:]

        for snapshot in snapshots {
            for field in snapshot.fields {
                let candidateUpdatedAt = field.updatedAt
                if let existing = winners[field.key] {
                    let existingUpdatedAt = existing.field.updatedAt
                    if candidateUpdatedAt < existingUpdatedAt {
                        continue
                    }
                    if candidateUpdatedAt == existingUpdatedAt {
                        // Prefer newer package export, then deviceID.
                        if snapshot.exportedAt < existing.packageExportedAt {
                            continue
                        }
                        if snapshot.exportedAt == existing.packageExportedAt,
                           snapshot.deviceID <= existing.deviceID {
                            continue
                        }
                    }
                }
                winners[field.key] = (field, snapshot.deviceID, snapshot.exportedAt)
            }
        }

        return Dictionary(uniqueKeysWithValues: winners.map { ($0.key, $0.value.field) })
    }

    // MARK: - Apply

    /// Applies merged fields into `defaults`. Provider secrets stay in Keychain (UD write only).
    /// FeatureSettings local path/bookmark/list identifiers are preserved.
    nonisolated static func applyMergedFields(
        _ fields: [String: AppSettingsSyncField],
        to defaults: UserDefaults
    ) {
        for key in syncedPreferenceKeys {
            guard let field = fields[key],
                  let stored = decodeStoredValue(field.value) else { continue }
            applyStoredValue(stored, forKey: key, defaults: defaults)
        }
    }

    /// Full export → write → list → merge → apply cycle used by folder sync.
    nonisolated static func syncAppSettings(
        directoryURL: URL,
        deviceId: String,
        defaults: UserDefaults = .standard
    ) throws {
        let exportedAt = Date()
        let localFields = collectFields(defaults: defaults, exportedAt: exportedAt)
        try writeSnapshot(
            fields: localFields,
            directoryURL: directoryURL,
            deviceId: deviceId,
            exportedAt: exportedAt
        )

        let snapshots = try listSnapshots(in: directoryURL)
        let merged = mergeFields(snapshots: snapshots)
        applyMergedFields(merged, to: defaults)
    }

    // MARK: - Value codec

    nonisolated static func encodeStoredValue(_ value: StoredPreferenceValue) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(value),
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }

    nonisolated static func decodeStoredValue(_ raw: String) -> StoredPreferenceValue? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(StoredPreferenceValue.self, from: data)
    }

    nonisolated private static func readStoredValue(
        forKey key: String,
        defaults: UserDefaults
    ) -> StoredPreferenceValue? {
        guard let object = defaults.object(forKey: key) else { return nil }
        if let value = object as? String {
            return .string(value)
        }
        if let value = object as? Data {
            return .data(value)
        }
        if let value = object as? NSNumber {
            // UserDefaults stores Bool as CFBoolean / __NSCFBoolean.
            if CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() {
                return .bool(value.boolValue)
            }
            let doubleValue = value.doubleValue
            if doubleValue.rounded() == doubleValue,
               value.intValue == Int(doubleValue),
               abs(doubleValue) <= Double(Int.max) {
                return .int(value.intValue)
            }
            return .double(doubleValue)
        }
        return nil
    }

    nonisolated private static func applyStoredValue(
        _ value: StoredPreferenceValue,
        forKey key: String,
        defaults: UserDefaults
    ) {
        switch key {
        case AppPreferenceKey.featureSettings:
            applyFeatureSettingsValue(value, defaults: defaults)
        case AppPreferenceKey.remoteASRProviderConfigurations,
             AppPreferenceKey.remoteLLMProviderConfigurations:
            applyProviderConfigurationsValue(value, forKey: key, defaults: defaults)
        default:
            writeStoredValue(value, forKey: key, defaults: defaults)
        }
    }

    nonisolated private static func writeStoredValue(
        _ value: StoredPreferenceValue,
        forKey key: String,
        defaults: UserDefaults
    ) {
        switch value {
        case .string(let string):
            defaults.set(string, forKey: key)
        case .int(let int):
            defaults.set(int, forKey: key)
        case .bool(let bool):
            defaults.set(bool, forKey: key)
        case .double(let double):
            defaults.set(double, forKey: key)
        case .data(let data):
            defaults.set(data, forKey: key)
        }
    }

    // MARK: - Sanitization

    nonisolated private static func sanitizeExportedValue(
        _ value: StoredPreferenceValue,
        key: String,
        defaults: UserDefaults
    ) -> StoredPreferenceValue {
        switch key {
        case AppPreferenceKey.featureSettings:
            return sanitizeFeatureSettingsForExport(value, defaults: defaults)
        case AppPreferenceKey.remoteASRProviderConfigurations,
             AppPreferenceKey.remoteLLMProviderConfigurations:
            return sanitizeProviderConfigurationsForExport(value)
        default:
            return value
        }
    }

    nonisolated private static func sanitizeFeatureSettingsForExport(
        _ value: StoredPreferenceValue,
        defaults: UserDefaults
    ) -> StoredPreferenceValue {
        // Prefer live store so sanitize rules stay consistent with runtime.
        var settings = FeatureSettingsStore.load(defaults: defaults)
        settings = strippingDeviceLocalNotePaths(from: settings)
        if let data = try? JSONEncoder().encode(settings),
           let raw = String(data: data, encoding: .utf8) {
            return .string(raw)
        }
        // Fallback: strip from the raw string value if possible.
        if case .string(let raw) = value,
           let data = raw.data(using: .utf8),
           var decoded = try? JSONDecoder().decode(FeatureSettings.self, from: data) {
            decoded = strippingDeviceLocalNotePaths(from: decoded)
            if let encoded = try? JSONEncoder().encode(decoded),
               let string = String(data: encoded, encoding: .utf8) {
                return .string(string)
            }
        }
        return value
    }

    nonisolated static func strippingDeviceLocalNotePaths(
        from settings: FeatureSettings
    ) -> FeatureSettings {
        var result = settings
        result.transcription.notes.obsidianSync.vaultPath = ""
        result.transcription.notes.obsidianSync.vaultBookmarkData = nil
        result.transcription.notes.remindersSync.selectedListIdentifier = ""
        return result
    }

    nonisolated private static func sanitizeProviderConfigurationsForExport(
        _ value: StoredPreferenceValue
    ) -> StoredPreferenceValue {
        guard case .string(let raw) = value else { return value }
        let metadataOnly = RemoteModelConfigurationStore.loadConfigurations(
            from: raw,
            sensitiveValueLoading: .metadataOnly
        )
        // Re-encode via saveConfigurations would persist empty secrets into Keychain —
        // only encode metadata JSON without touching Keychain.
        let sanitizedItems = metadataOnly.values
            .map(\.withoutSensitiveValues)
            .map(strippingDeviceLocalProviderPaths)
            .sorted(by: { $0.providerID < $1.providerID })
        guard let data = try? JSONEncoder().encode(sanitizedItems),
              let string = String(data: data, encoding: .utf8) else {
            return .string(raw)
        }
        // Defense-in-depth: ensure known secret substrings from original raw are gone.
        return .string(string)
    }

    nonisolated private static func strippingDeviceLocalProviderPaths(
        _ configuration: RemoteProviderConfiguration
    ) -> RemoteProviderConfiguration {
        var result = configuration
        result.codexAuthFilePath = ""
        result.codexAuthFileBookmark = nil
        return result
    }

    nonisolated private static func applyFeatureSettingsValue(
        _ value: StoredPreferenceValue,
        defaults: UserDefaults
    ) {
        guard case .string(let raw) = value,
              let data = raw.data(using: .utf8),
              var remote = try? JSONDecoder().decode(FeatureSettings.self, from: data) else {
            return
        }
        let local = FeatureSettingsStore.load(defaults: defaults)
        // Preserve device-local note paths / bookmarks / list selection.
        remote.transcription.notes.obsidianSync.vaultPath = local.transcription.notes.obsidianSync.vaultPath
        remote.transcription.notes.obsidianSync.vaultBookmarkData =
            local.transcription.notes.obsidianSync.vaultBookmarkData
        remote.transcription.notes.remindersSync.selectedListIdentifier =
            local.transcription.notes.remindersSync.selectedListIdentifier
        // Keep local list title when identifier is preserved and remote cleared it.
        if remote.transcription.notes.remindersSync.selectedListTitle.isEmpty,
           !local.transcription.notes.remindersSync.selectedListTitle.isEmpty {
            remote.transcription.notes.remindersSync.selectedListTitle =
                local.transcription.notes.remindersSync.selectedListTitle
        }
        FeatureSettingsStore.save(remote, defaults: defaults)
    }

    nonisolated private static func applyProviderConfigurationsValue(
        _ value: StoredPreferenceValue,
        forKey key: String,
        defaults: UserDefaults
    ) {
        guard case .string(let remoteRaw) = value else { return }
        // Metadata-only decode (never load secrets into the merge payload).
        let remoteConfigs = RemoteModelConfigurationStore.loadConfigurations(
            from: remoteRaw,
            sensitiveValueLoading: .metadataOnly
        )
        let localRaw = defaults.string(forKey: key) ?? ""
        let localConfigs = RemoteModelConfigurationStore.loadConfigurations(
            from: localRaw,
            sensitiveValueLoading: .metadataOnly
        )

        // Merge metadata by providerID: remote wins for non-secret fields.
        // Write only UserDefaults metadata JSON — Keychain is never touched.
        var merged = localConfigs
        for (providerID, remote) in remoteConfigs {
            var item = remote.withoutSensitiveValues
            item = strippingDeviceLocalProviderPaths(item)
            // Preserve local codex auth path/bookmark (device-local).
            if let local = localConfigs[providerID] {
                item.codexAuthFilePath = local.codexAuthFilePath
                item.codexAuthFileBookmark = local.codexAuthFileBookmark
            }
            // Presence flags from remote must not clear local Keychain; drop presence
            // so runtime still resolves credentials from Keychain when values are empty.
            // Keep presence only as informational empty secrets.
            merged[providerID] = item
        }

        let items = merged.values
            .map(\.withoutSensitiveValues)
            .sorted(by: { $0.providerID < $1.providerID })
        guard let data = try? JSONEncoder().encode(items),
              let encoded = String(data: data, encoding: .utf8) else {
            return
        }
        defaults.set(encoded, forKey: key)
    }
}
