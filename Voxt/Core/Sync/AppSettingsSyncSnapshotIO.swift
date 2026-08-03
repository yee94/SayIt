// AppSettingsSyncSnapshotIO.swift
// Folder-based app settings snapshot IO (shared directory / iCloud Drive).
// Syncs whitelisted preferences and remote provider metadata; never syncs API keys.
// v2: per-logical-field revision + updatedAt baselines; featureSettings split into five groups.

import Foundation

/// Pure file IO + merge helpers for per-device app settings JSON snapshots.
enum AppSettingsSyncSnapshotIO {
    nonisolated static let filePrefix = "sayit-settings-"
    nonisolated static let fileSuffix = ".json"
    /// Current on-disk envelope version (v2 adds per-field revision + split feature groups).
    nonisolated static let envelopeVersion = 2
    /// Legacy envelope version still accepted for read/merge.
    nonisolated static let legacyEnvelopeVersion = 1

    /// Preference / logical keys included in folder sync (whitelist).
    /// Monolithic `featureSettings` is replaced by five group keys; v1 snapshots still decode.
    nonisolated static let syncedPreferenceKeys: [String] = {
        var keys = baseSyncedPreferenceKeys
        keys.append(contentsOf: featureSettingsGroupKeys)
        return keys
    }()

    /// Keys written into new snapshots (excludes legacy monolithic featureSettings).
    nonisolated static let featureSettingsGroupKeys: [String] = [
        AppPreferenceKey.featureSettingsTranscription,
        AppPreferenceKey.featureSettingsTranslation,
        AppPreferenceKey.featureSettingsRewrite,
        AppPreferenceKey.featureSettingsMeeting,
        AppPreferenceKey.featureSettingsAvailability,
    ]

    /// Whitelist without feature settings (monolithic or split).
    nonisolated private static let baseSyncedPreferenceKeys: [String] = [
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

    /// Keys accepted when applying merged snapshots (includes legacy monolithic blob).
    nonisolated static let applyablePreferenceKeys: [String] = {
        var keys = baseSyncedPreferenceKeys
        keys.append(AppPreferenceKey.featureSettings)
        keys.append(contentsOf: featureSettingsGroupKeys)
        return keys
    }()

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
        /// Monotonic revision for this logical field on the exporting device.
        /// Defaults to 0 when decoding legacy v1 snapshots that omit the field.
        var revision: Int

        init(key: String, value: String, updatedAt: Date, revision: Int = 0) {
            self.key = key
            self.value = value
            self.updatedAt = updatedAt
            self.revision = revision
        }

        private enum CodingKeys: String, CodingKey {
            case key
            case value
            case updatedAt
            case revision
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            key = try container.decode(String.self, forKey: .key)
            value = try container.decode(String.self, forKey: .value)
            updatedAt = try container.decode(Date.self, forKey: .updatedAt)
            revision = try container.decodeIfPresent(Int.self, forKey: .revision) ?? 0
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(key, forKey: .key)
            try container.encode(value, forKey: .value)
            try container.encode(updatedAt, forKey: .updatedAt)
            try container.encode(revision, forKey: .revision)
        }
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
    /// Uses local baseline so unchanged values keep the same revision and updatedAt.
    /// Persists an updated baseline after collect so consecutive no-change collects are stable.
    nonisolated static func collectFields(
        defaults: UserDefaults,
        exportedAt: Date = Date(),
        baselineStore: AppSettingsSyncBaselineStore? = nil
    ) -> [AppSettingsSyncField] {
        var baseline = baselineStore ?? AppSettingsSyncBaselineStore.load(defaults: defaults)
        var fields: [AppSettingsSyncField] = []
        fields.reserveCapacity(syncedPreferenceKeys.count)

        for key in syncedPreferenceKeys {
            guard let stored = readLogicalStoredValue(forKey: key, defaults: defaults) else { continue }
            let sanitized = sanitizeExportedValue(stored, key: key, defaults: defaults)
            guard let encoded = encodeStoredValue(sanitized) else { continue }

            let field: AppSettingsSyncField
            if let previous = baseline.baseline(forKey: key), previous.value == encoded {
                // Unchanged: keep revision and updatedAt (no local mutation).
                field = AppSettingsSyncField(
                    key: key,
                    value: encoded,
                    updatedAt: previous.updatedAt,
                    revision: previous.revision
                )
            } else {
                let nextRevision = (baseline.baseline(forKey: key)?.revision ?? 0) + 1
                field = AppSettingsSyncField(
                    key: key,
                    value: encoded,
                    updatedAt: exportedAt,
                    revision: nextRevision
                )
            }
            fields.append(field)
            baseline.setBaseline(
                AppSettingsSyncFieldBaseline(
                    value: field.value,
                    revision: field.revision,
                    updatedAt: field.updatedAt
                ),
                forKey: key
            )
        }

        // Drop legacy monolithic baseline entry once split groups are used.
        baseline.entries.removeValue(forKey: AppPreferenceKey.featureSettings)
        baseline.save(to: defaults)
        return fields
    }

    /// Collects local fields for LWW merge without mutating baseline.
    /// - Unchanged vs baseline: keep baseline revision/updatedAt.
    /// - Diverged from baseline (unexported local edit): in-memory only, revision+1 and `now`
    ///   so LWW can prefer the local change over older package fields; baseline stays intact.
    /// - Never baselined: epoch + revision 0 so package fields with real timestamps win.
    nonisolated static func collectFieldsForMerge(
        defaults: UserDefaults,
        baselineStore: AppSettingsSyncBaselineStore? = nil,
        now: Date = Date()
    ) -> [AppSettingsSyncField] {
        let baseline = baselineStore ?? AppSettingsSyncBaselineStore.load(defaults: defaults)
        var fields: [AppSettingsSyncField] = []
        fields.reserveCapacity(syncedPreferenceKeys.count)

        for key in syncedPreferenceKeys {
            guard let stored = readLogicalStoredValue(forKey: key, defaults: defaults) else { continue }
            let sanitized = sanitizeExportedValue(stored, key: key, defaults: defaults)
            guard let encoded = encodeStoredValue(sanitized) else { continue }

            if let previous = baseline.baseline(forKey: key), previous.value == encoded {
                fields.append(
                    AppSettingsSyncField(
                        key: key,
                        value: encoded,
                        updatedAt: previous.updatedAt,
                        revision: previous.revision
                    )
                )
            } else if let previous = baseline.baseline(forKey: key) {
                // Local value diverged from baseline; claim current time for LWW only (no baseline write).
                fields.append(
                    AppSettingsSyncField(
                        key: key,
                        value: encoded,
                        updatedAt: now,
                        revision: previous.revision + 1
                    )
                )
            } else {
                // Never baselined: do not claim "now" or package fields always lose.
                fields.append(
                    AppSettingsSyncField(
                        key: key,
                        value: encoded,
                        updatedAt: Date(timeIntervalSince1970: 0),
                        revision: 0
                    )
                )
            }
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
        let encoder = AppSyncJSONCoding.makeEncoder(outputFormatting: [.sortedKeys])
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
    /// Accepts both v1 (legacy) and v2 envelopes; normalizes v1 monolithic featureSettings into groups.
    nonisolated static func listSnapshots(
        in directoryURL: URL
    ) throws -> [Envelope] {
        let contents = try FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        let decoder = AppSyncJSONCoding.makeDecoder()

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
                guard envelope.version == envelopeVersion
                        || envelope.version == legacyEnvelopeVersion else {
                    VoxtLog.historyWarning(
                        "Settings snapshot skipped (version mismatch). file=\(name) version=\(envelope.version)"
                    )
                    continue
                }
                if envelope.deviceID.isEmpty {
                    envelope.deviceID = devicePart
                }
                envelope.fields = normalizeFieldsFromLegacyIfNeeded(envelope.fields)
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
    /// After apply, baselines for applied keys are updated to the current defaults encoding
    /// (using the winner field's revision/updatedAt) so the next collect does not echo.
    nonisolated static func applyMergedFields(
        _ fields: [String: AppSettingsSyncField],
        to defaults: UserDefaults,
        updateBaseline: Bool = true
    ) {
        for key in applyablePreferenceKeys {
            guard let field = fields[key],
                  let stored = decodeStoredValue(field.value) else { continue }
            applyStoredValue(stored, forKey: key, defaults: defaults)
        }

        guard updateBaseline else { return }

        // Record baselines from post-apply defaults so local re-export matches applied values
        // without bumping revision/updatedAt (echo suppression).
        var baseline = AppSettingsSyncBaselineStore.load(defaults: defaults)
        var currentEncoded: [String: String] = [:]
        currentEncoded.reserveCapacity(featureSettingsGroupKeys.count + fields.count)

        for key in Set(fields.keys).union(Set(featureSettingsGroupKeys)) {
            // Only baseline keys we actually care about for export.
            guard syncedPreferenceKeys.contains(key) || featureSettingsGroupKeys.contains(key) else {
                continue
            }
            guard let stored = readLogicalStoredValue(forKey: key, defaults: defaults) else { continue }
            let sanitized = sanitizeExportedValue(stored, key: key, defaults: defaults)
            guard let encoded = encodeStoredValue(sanitized) else { continue }
            currentEncoded[key] = encoded
        }

        // For applied keys that have a winner field, use that field's revision/updatedAt.
        var appliedForBaseline: [String: AppSettingsSyncField] = [:]
        for (key, field) in fields {
            guard let encoded = currentEncoded[key] else { continue }
            // Prefer split group keys; skip legacy monolithic after normalize.
            if key == AppPreferenceKey.featureSettings { continue }
            appliedForBaseline[key] = field
            // Ensure encoded map entry exists (already set).
            _ = encoded
        }

        // When only legacy monolithic was applied, baselines for the five groups must update.
        if fields[AppPreferenceKey.featureSettings] != nil {
            let mono = fields[AppPreferenceKey.featureSettings]!
            for groupKey in featureSettingsGroupKeys {
                if appliedForBaseline[groupKey] == nil, currentEncoded[groupKey] != nil {
                    appliedForBaseline[groupKey] = AppSettingsSyncField(
                        key: groupKey,
                        value: currentEncoded[groupKey]!,
                        updatedAt: mono.updatedAt,
                        revision: mono.revision
                    )
                }
            }
        }

        baseline.recordAppliedFields(appliedForBaseline, currentEncodedValues: currentEncoded)
        baseline.entries.removeValue(forKey: AppPreferenceKey.featureSettings)
        baseline.save(to: defaults)
    }

    /// Full export → write → list → merge → apply cycle used by folder sync.
    ///
    /// When the local baseline store is empty (first sync after upgrade / new device),
    /// seed from existing directory snapshots first so stale local values are not stamped
    /// with "now" and overwrite newer remote v1/v2 fields. If the directory has no
    /// snapshots yet, fall through and initialize from local settings as before.
    nonisolated static func syncAppSettings(
        directoryURL: URL,
        deviceId: String,
        defaults: UserDefaults = .standard
    ) throws {
        let baseline = AppSettingsSyncBaselineStore.load(defaults: defaults)
        if baseline.entries.isEmpty {
            let existingSnapshots = try listSnapshots(in: directoryURL)
            if !existingSnapshots.isEmpty {
                let seeded = mergeFields(snapshots: existingSnapshots)
                applyMergedFields(seeded, to: defaults)
            }
        }

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

    // MARK: - Logical field reads

    /// Reads a logical sync field (preference key or feature group).
    nonisolated static func readLogicalStoredValue(
        forKey key: String,
        defaults: UserDefaults
    ) -> StoredPreferenceValue? {
        switch key {
        case AppPreferenceKey.featureSettingsTranscription,
             AppPreferenceKey.featureSettingsTranslation,
             AppPreferenceKey.featureSettingsRewrite,
             AppPreferenceKey.featureSettingsMeeting,
             AppPreferenceKey.featureSettingsAvailability:
            return readFeatureSettingsGroupValue(forKey: key, defaults: defaults)
        case AppPreferenceKey.featureSettings:
            // Legacy monolithic path still used when applying v1 remote fields.
            return readStoredValue(forKey: key, defaults: defaults)
        default:
            return readStoredValue(forKey: key, defaults: defaults)
        }
    }

    nonisolated private static func readFeatureSettingsGroupValue(
        forKey key: String,
        defaults: UserDefaults
    ) -> StoredPreferenceValue? {
        let settings = FeatureSettingsStore.load(defaults: defaults)
        let sanitized = strippingDeviceLocalNotePaths(from: settings)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data: Data?
        switch key {
        case AppPreferenceKey.featureSettingsTranscription:
            data = try? encoder.encode(sanitized.transcription)
        case AppPreferenceKey.featureSettingsTranslation:
            data = try? encoder.encode(sanitized.translation)
        case AppPreferenceKey.featureSettingsRewrite:
            data = try? encoder.encode(sanitized.rewrite)
        case AppPreferenceKey.featureSettingsMeeting:
            data = try? encoder.encode(sanitized.meeting)
        case AppPreferenceKey.featureSettingsAvailability:
            data = try? encoder.encode(sanitized.availability)
        default:
            return nil
        }
        guard let data, let raw = String(data: data, encoding: .utf8) else { return nil }
        return .string(raw)
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
        case AppPreferenceKey.featureSettingsTranscription,
             AppPreferenceKey.featureSettingsTranslation,
             AppPreferenceKey.featureSettingsRewrite,
             AppPreferenceKey.featureSettingsMeeting,
             AppPreferenceKey.featureSettingsAvailability:
            applyFeatureSettingsGroupValue(value, forKey: key, defaults: defaults)
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
        case AppPreferenceKey.featureSettingsTranscription:
            // Group read already strips device-local note paths.
            return value
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

    // MARK: - Feature settings apply

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
        remote = preservingDeviceLocalNotePaths(remote: remote, local: local)
        FeatureSettingsStore.save(remote, defaults: defaults)
    }

    nonisolated private static func applyFeatureSettingsGroupValue(
        _ value: StoredPreferenceValue,
        forKey key: String,
        defaults: UserDefaults
    ) {
        guard case .string(let raw) = value,
              let data = raw.data(using: .utf8) else {
            return
        }
        var local = FeatureSettingsStore.load(defaults: defaults)
        switch key {
        case AppPreferenceKey.featureSettingsTranscription:
            guard var remote = try? JSONDecoder().decode(
                TranscriptionFeatureSettings.self,
                from: data
            ) else { return }
            // Preserve device-local note paths / bookmarks / list selection.
            remote.notes.obsidianSync.vaultPath = local.transcription.notes.obsidianSync.vaultPath
            remote.notes.obsidianSync.vaultBookmarkData =
                local.transcription.notes.obsidianSync.vaultBookmarkData
            remote.notes.remindersSync.selectedListIdentifier =
                local.transcription.notes.remindersSync.selectedListIdentifier
            if remote.notes.remindersSync.selectedListTitle.isEmpty,
               !local.transcription.notes.remindersSync.selectedListTitle.isEmpty {
                remote.notes.remindersSync.selectedListTitle =
                    local.transcription.notes.remindersSync.selectedListTitle
            }
            local.transcription = remote
        case AppPreferenceKey.featureSettingsTranslation:
            guard let remote = try? JSONDecoder().decode(
                TranslationFeatureSettings.self,
                from: data
            ) else { return }
            local.translation = remote
        case AppPreferenceKey.featureSettingsRewrite:
            guard let remote = try? JSONDecoder().decode(
                RewriteFeatureSettings.self,
                from: data
            ) else { return }
            local.rewrite = remote
        case AppPreferenceKey.featureSettingsMeeting:
            guard let remote = try? JSONDecoder().decode(
                MeetingFeatureSettings.self,
                from: data
            ) else { return }
            local.meeting = remote
        case AppPreferenceKey.featureSettingsAvailability:
            guard let remote = try? JSONDecoder().decode(
                FeatureAvailabilitySettings.self,
                from: data
            ) else { return }
            local.availability = remote
        default:
            return
        }
        FeatureSettingsStore.save(local, defaults: defaults)
    }

    nonisolated private static func preservingDeviceLocalNotePaths(
        remote: FeatureSettings,
        local: FeatureSettings
    ) -> FeatureSettings {
        var result = remote
        result.transcription.notes.obsidianSync.vaultPath =
            local.transcription.notes.obsidianSync.vaultPath
        result.transcription.notes.obsidianSync.vaultBookmarkData =
            local.transcription.notes.obsidianSync.vaultBookmarkData
        result.transcription.notes.remindersSync.selectedListIdentifier =
            local.transcription.notes.remindersSync.selectedListIdentifier
        // Keep local list title when identifier is preserved and remote cleared it.
        if result.transcription.notes.remindersSync.selectedListTitle.isEmpty,
           !local.transcription.notes.remindersSync.selectedListTitle.isEmpty {
            result.transcription.notes.remindersSync.selectedListTitle =
                local.transcription.notes.remindersSync.selectedListTitle
        }
        return result
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

    // MARK: - Legacy v1 normalization

    /// Expands a monolithic `featureSettings` field into five group fields when present.
    /// Existing group fields take precedence over the split result for the same key.
    nonisolated static func normalizeFieldsFromLegacyIfNeeded(
        _ fields: [AppSettingsSyncField]
    ) -> [AppSettingsSyncField] {
        var byKey: [String: AppSettingsSyncField] = [:]
        byKey.reserveCapacity(fields.count + featureSettingsGroupKeys.count)
        for field in fields {
            byKey[field.key] = field
        }

        guard let mono = byKey[AppPreferenceKey.featureSettings],
              let stored = decodeStoredValue(mono.value),
              case .string(let raw) = stored,
              let data = raw.data(using: .utf8),
              let settings = try? JSONDecoder().decode(FeatureSettings.self, from: data) else {
            // Still drop monolithic key from export map when groups already exist.
            if byKey.keys.contains(where: { featureSettingsGroupKeys.contains($0) }) {
                byKey.removeValue(forKey: AppPreferenceKey.featureSettings)
            }
            return Array(byKey.values)
        }

        let sanitized = strippingDeviceLocalNotePaths(from: settings)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        func encodeGroup<T: Encodable>(_ value: T, key: String) {
            guard byKey[key] == nil,
                  let data = try? encoder.encode(value),
                  let string = String(data: data, encoding: .utf8),
                  let encoded = encodeStoredValue(.string(string)) else {
                return
            }
            byKey[key] = AppSettingsSyncField(
                key: key,
                value: encoded,
                updatedAt: mono.updatedAt,
                revision: mono.revision
            )
        }

        encodeGroup(sanitized.transcription, key: AppPreferenceKey.featureSettingsTranscription)
        encodeGroup(sanitized.translation, key: AppPreferenceKey.featureSettingsTranslation)
        encodeGroup(sanitized.rewrite, key: AppPreferenceKey.featureSettingsRewrite)
        encodeGroup(sanitized.meeting, key: AppPreferenceKey.featureSettingsMeeting)
        encodeGroup(sanitized.availability, key: AppPreferenceKey.featureSettingsAvailability)

        byKey.removeValue(forKey: AppPreferenceKey.featureSettings)
        return Array(byKey.values)
    }
}
