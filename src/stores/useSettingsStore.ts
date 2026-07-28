import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { setDockVisibility } from "@tauri-apps/api/app";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import {
  type HotkeyConfig,
  type TriggerKey,
  type CustomTriggerKey,
  type ComboTriggerKey,
  type PromptMode,
  PROMPT_MODE_VALUES,
  isCustomTriggerKey,
  isComboTriggerKey,
  isPresetTriggerKey,
} from "../types/settings";
import {
  getKeyDisplayName,
  getComboTriggerKeyDisplayName,
  getPlatformKeycode,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
  getEscapeReservedMessage,
} from "../lib/keycodeMap";
import {
  extractErrorMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { getDefaultSystemPrompt } from "../lib/enhancer";
import {
  getMinimalPromptForLocale,
  getPromptForModeAndLocale,
  isKnownDefaultPrompt,
} from "../i18n/prompts";
import i18n from "../i18n";
import {
  type SupportedLocale,
  type TranscriptionLocale,
  FALLBACK_LOCALE,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForTranscriptionLocale,
  normalizeSupportedLocale,
  normalizeTranscriptionLocale,
} from "../i18n/languageConfig";
import { emitEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
  type LlmModelId,
  type LlmProviderId,
  type WhisperModelId,
  DOUBAO_ASR_MODEL_ID,
} from "../lib/modelRegistry";
import { DEFAULT_LLM_BASE_URL } from "../lib/llmProvider";

declare const __APP_VERSION__: string;

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;
const DEFAULT_SMART_DICTIONARY_ENABLED = navigator.userAgent.includes("Mac"); // macOS only — Windows 尚未支援 text field 读取
const DEFAULT_SOUND_EFFECTS_ENABLED = true;
const DEFAULT_PROMPT_MODE: PromptMode = "minimal";
const DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED = false;
const DEFAULT_RECORDING_AUTO_CLEANUP_DAYS = 7;
const DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD = true;
const DEFAULT_HIDE_DOCK_ICON = false;
const IS_MACOS = navigator.userAgent.includes("Mac");

function getDefaultTriggerKey(): TriggerKey {
  const isMac = navigator.userAgent.includes("Mac");
  return isMac ? "fn" : "rightAlt";
}

const PRESET_KEY_DISPLAY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option (⌥)",
  rightOption: "Right Option (⌥)",
  command: "Command (⌘)",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control (⌃)",
  rightControl: "Right Control",
  shift: "Shift (⇧)",
};

export const useSettingsStore = defineStore("settings", () => {
  const hotkeyConfig = ref<HotkeyConfig | null>(null);
  const triggerMode = computed<TriggerMode>(
    () => hotkeyConfig.value?.triggerMode ?? "hold",
  );
  // Doubao ASR credentials
  const doubaoAppId = ref<string>("");
  const doubaoAccessKey = ref<string>("");
  const hasApiKey = computed(
    () => doubaoAppId.value !== "" && doubaoAccessKey.value !== "",
  );

  // Custom OpenAI-compatible LLM
  const llmBaseUrl = ref<string>(DEFAULT_LLM_BASE_URL);
  const llmApiKey = ref<string>("");
  const selectedLlmModelId = ref<LlmModelId>(DEFAULT_LLM_MODEL_ID);
  const selectedLlmProviderId = ref<LlmProviderId>("custom");
  const selectedWhisperModelId = ref<WhisperModelId>(DEFAULT_WHISPER_MODEL_ID);
  const hasLlmApiKey = computed(() => llmApiKey.value !== "");

  const aiPrompt = ref<string>(getDefaultSystemPrompt());
  const promptMode = ref<PromptMode>(DEFAULT_PROMPT_MODE);
  const showPromptUpgradeNotice = ref(false);
  const isAutoStartEnabled = ref(false);
  const isEnhancementThresholdEnabled = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  );
  const enhancementThresholdCharCount = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
  );
  const customTriggerKey = ref<CustomTriggerKey | ComboTriggerKey | null>(null);
  const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);
  const isSmartDictionaryEnabled = ref<boolean>(
    DEFAULT_SMART_DICTIONARY_ENABLED,
  );
  const customTriggerKeyDomCode = ref<string>("");
  const selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE);
  const selectedTranscriptionLocale = ref<TranscriptionLocale>(FALLBACK_LOCALE);
  const isSoundEffectsEnabled = ref<boolean>(DEFAULT_SOUND_EFFECTS_ENABLED);
  const isHideDockIconEnabled = ref<boolean>(DEFAULT_HIDE_DOCK_ICON);
  const isRecordingAutoCleanupEnabled = ref<boolean>(
    DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
  );
  const recordingAutoCleanupDays = ref<number>(
    DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
  );
  const selectedAudioInputDeviceName = ref<string>("");
  const isCopyTranscriptionToClipboardEnabled = ref<boolean>(
    DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD,
  );
  let isLoaded = false;

  /** Resolve which SupportedLocale to use for prompt default (shared logic). */
  function getEffectivePromptLocale(): SupportedLocale {
    return selectedTranscriptionLocale.value === "auto"
      ? selectedLocale.value
      : selectedTranscriptionLocale.value;
  }

  function getDoubaoAppId(): string {
    return doubaoAppId.value;
  }

  function getDoubaoAccessKey(): string {
    return doubaoAccessKey.value;
  }

  /** @deprecated ASR no longer uses a single apiKey; kept for UI compatibility */
  function getApiKey(): string {
    return doubaoAccessKey.value;
  }

  function getLlmApiKey(): string {
    return llmApiKey.value;
  }

  function getLlmBaseUrl(): string {
    return llmBaseUrl.value || DEFAULT_LLM_BASE_URL;
  }

  async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
    try {
      await invoke("update_hotkey_config", {
        triggerKey: key,
        triggerMode: mode,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] Failed to sync hotkey config:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "sync-hotkey" });
    }
  }

  async function loadSettings() {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedDoubaoAppId = await store.get<string>("doubaoAppId");
      const savedDoubaoAccessKey = await store.get<string>("doubaoAccessKey");
      const savedLlmBaseUrl = await store.get<string>("llmBaseUrl");
      const savedLlmApiKey =
        (await store.get<string>("llmApiKey")) ??
        (await store.get<string>("openaiApiKey")) ??
        (await store.get<string>("groqApiKey"));

      // Backward-compatible key parsing: string → PresetTriggerKey, object → CustomTriggerKey
      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };
      doubaoAppId.value = savedDoubaoAppId?.trim() ?? "";
      doubaoAccessKey.value = savedDoubaoAccessKey?.trim() ?? "";
      llmBaseUrl.value = savedLlmBaseUrl?.trim() || DEFAULT_LLM_BASE_URL;
      llmApiKey.value = savedLlmApiKey?.trim() ?? "";

      // Load independently persisted custom/combo key
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      if (
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        (isCustomTriggerKey(savedCustomKey) ||
          isComboTriggerKey(savedCustomKey))
      ) {
        customTriggerKey.value = savedCustomKey;
        customTriggerKeyDomCode.value = savedCustomDomCode ?? "";
      }

      // Load locale（首次启动检测系统语言；历史 zh-TW / 非法值迁移为 zh-CN）
      const rawSavedLocale = await store.get<string>("selectedLocale");
      if (rawSavedLocale != null) {
        const normalizedLocale =
          normalizeSupportedLocale(rawSavedLocale) ?? FALLBACK_LOCALE;
        selectedLocale.value = normalizedLocale;
        if (normalizedLocale !== rawSavedLocale) {
          await store.set("selectedLocale", normalizedLocale);
          await store.save();
        }
      } else {
        const detected = detectSystemLocale();
        selectedLocale.value = detected;
        await store.set("selectedLocale", detected);
        await store.save();
      }
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      // Load transcription locale（历史 zh-TW / 非法值迁移；缺失则默认 UI 语言）
      const rawSavedTranscriptionLocale = await store.get<string>(
        "selectedTranscriptionLocale",
      );
      if (rawSavedTranscriptionLocale != null) {
        const normalizedTranscriptionLocale =
          normalizeTranscriptionLocale(rawSavedTranscriptionLocale) ??
          selectedLocale.value;
        selectedTranscriptionLocale.value = normalizedTranscriptionLocale;
        if (normalizedTranscriptionLocale !== rawSavedTranscriptionLocale) {
          await store.set(
            "selectedTranscriptionLocale",
            normalizedTranscriptionLocale,
          );
          await store.save();
        }
      } else {
        selectedTranscriptionLocale.value = selectedLocale.value;
        await store.set("selectedTranscriptionLocale", selectedLocale.value);
        await store.save();
      }

      // Load aiPrompt once (used by both migration and normal flow)
      const savedPrompt = await store.get<string>("aiPrompt");
      const trimmedSavedPrompt = savedPrompt?.trim() ?? "";

      // Prompt mode migration
      const savedPromptMode = await store.get<string>("promptMode");
      if (
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
      ) {
        promptMode.value = savedPromptMode as PromptMode;
      } else if (!savedPromptMode) {
        // 旧版升级迁移
        if (!trimmedSavedPrompt || isKnownDefaultPrompt(trimmedSavedPrompt)) {
          promptMode.value = "minimal";
        } else {
          promptMode.value = "custom";
        }
        await store.set("promptMode", promptMode.value);
        await store.save();
      }

      aiPrompt.value =
        trimmedSavedPrompt ||
        getMinimalPromptForLocale(getEffectivePromptLocale());

      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;

      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;

      // LLM (custom OpenAI-compatible)
      selectedLlmProviderId.value = "custom";
      const savedLlmModelId = await store.get<string>("llmModelId");
      selectedLlmModelId.value = getEffectiveLlmModelId(savedLlmModelId ?? null);

      selectedWhisperModelId.value = getEffectiveWhisperModelId(null);

      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;

      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;

      const savedHideDockIcon = await store.get<boolean>("hideDockIcon");
      isHideDockIconEnabled.value = savedHideDockIcon ?? DEFAULT_HIDE_DOCK_ICON;

      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedRecordingAutoCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecordingAutoCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;

      const savedRecordingAutoCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecordingAutoCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedAudioInputDeviceName = await store.get<string>(
        "audioInputDeviceName",
      );
      selectedAudioInputDeviceName.value = savedAudioInputDeviceName ?? "";

      const savedCopyTranscriptionToClipboard = await store.get<boolean>(
        "copyTranscriptionToClipboard",
      );
      isCopyTranscriptionToClipboardEnabled.value =
        savedCopyTranscriptionToClipboard ??
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "load" });

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      hotkeyConfig.value = { triggerKey: key, triggerMode: "hold" };
      isEnhancementThresholdEnabled.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      isMuteOnRecordingEnabled.value = DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value = DEFAULT_SOUND_EFFECTS_ENABLED;
      isHideDockIconEnabled.value = DEFAULT_HIDE_DOCK_ICON;
      isCopyTranscriptionToClipboardEnabled.value =
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;
    }
  }

  async function saveHotkeyConfig(key: TriggerKey, mode: TriggerMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hotkeyTriggerKey", key);
      await store.set("hotkeyTriggerMode", mode);
      await store.save();

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };

      // Sync to Rust immediately
      await syncHotkeyConfigToRust(key, mode);

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "hotkey",
        value: { triggerKey: key, triggerMode: mode },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hotkey" });
      throw err;
    }
  }

  async function saveCustomTriggerKey(
    keycode: number,
    domCode: string,
    mode: TriggerMode,
  ) {
    const customKey: CustomTriggerKey = { custom: { keycode } };
    try {
      // Persist custom key independently (survives mode switching)
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", customKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = customKey;
      customTriggerKeyDomCode.value = domCode;

      // Reuse shared logic for active key + Rust sync + event broadcast
      await saveHotkeyConfig(customKey, mode);

      console.log(
        `[useSettingsStore] Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCustomTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveComboTriggerKey(
    comboKey: ComboTriggerKey,
    domCode: string,
    mode: TriggerMode,
  ) {
    try {
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", comboKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = comboKey;
      customTriggerKeyDomCode.value = domCode;

      await saveHotkeyConfig(comboKey, mode);

      console.log(
        `[useSettingsStore] Combo trigger key saved: modifiers=${JSON.stringify(comboKey.combo.modifiers)}, keycode=${comboKey.combo.keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveComboTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode) {
    // Only update active key; keep customTriggerKey intact
    await saveHotkeyConfig(presetKey, mode);
  }

  async function switchToCustomMode(mode: TriggerMode) {
    if (!customTriggerKey.value) return;
    // Restore custom key as active key
    await saveHotkeyConfig(customTriggerKey.value, mode);
  }

  function getTriggerKeyDisplayName(key: TriggerKey): string {
    if (isPresetTriggerKey(key)) {
      return PRESET_KEY_DISPLAY_NAMES[key] ?? key;
    }
    if (isComboTriggerKey(key)) {
      return getComboTriggerKeyDisplayName(key);
    }
    if (isCustomTriggerKey(key)) {
      // For custom keys, use saved DOM code to look up display name
      if (customTriggerKeyDomCode.value) {
        return getKeyDisplayName(customTriggerKeyDomCode.value);
      }
      return i18n.global.t("settings.hotkey.customKeyDisplay", {
        keycode: key.custom.keycode,
      });
    }
    return String(key);
  }

  async function saveDoubaoCredentials(appId: string, accessKey: string) {
    const trimmedAppId = appId.trim();
    const trimmedAccessKey = accessKey.trim();
    if (trimmedAppId === "" || trimmedAccessKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("doubaoAppId", trimmedAppId);
      await store.set("doubaoAccessKey", trimmedAccessKey);
      await store.save();
      doubaoAppId.value = trimmedAppId;
      doubaoAccessKey.value = trimmedAccessKey;

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: "set",
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] Doubao ASR credentials saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveDoubaoCredentials failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-doubao-credentials" });
      throw err;
    }
  }

  /** @deprecated use saveDoubaoCredentials */
  async function saveApiKey(key: string) {
    await saveDoubaoCredentials(doubaoAppId.value || "unused", key);
  }

  async function refreshApiKey() {
    try {
      const store = await load(STORE_NAME);
      doubaoAppId.value = (await store.get<string>("doubaoAppId"))?.trim() ?? "";
      doubaoAccessKey.value =
        (await store.get<string>("doubaoAccessKey"))?.trim() ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function deleteApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("doubaoAppId");
      await store.delete("doubaoAccessKey");
      await store.save();
      doubaoAppId.value = "";
      doubaoAccessKey.value = "";

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] Doubao ASR credentials deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  function getAiPrompt(): string {
    if (promptMode.value === "custom") return aiPrompt.value;
    return getPromptForModeAndLocale(
      promptMode.value,
      getEffectivePromptLocale(),
    );
  }

  async function savePromptMode(mode: PromptMode) {
    const previousMode = promptMode.value;
    promptMode.value = mode;
    try {
      const store = await load(STORE_NAME);
      await store.set("promptMode", mode);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: mode,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Prompt mode saved: ${mode}`);
    } catch (err) {
      promptMode.value = previousMode;
      console.error(
        "[useSettingsStore] savePromptMode failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-prompt-mode" });
      throw err;
    }
  }

  /** 只由 Dashboard (main-window.ts) 呼叫，比对版本号决定是否显示升级提示 */
  async function consumeUpgradeNotice() {
    try {
      const store = await load(STORE_NAME);
      const lastSeenVersion = await store.get<string>("lastSeenVersion");

      if (lastSeenVersion === null || lastSeenVersion === undefined) {
        // 区分首次安装 vs 旧版升级：有任何凭证 = 老使用者
        const existingApiKey =
          (await store.get<string>("doubaoAccessKey")) ??
          (await store.get<string>("llmApiKey")) ??
          (await store.get<string>("groqApiKey"));
        if (existingApiKey) {
          showPromptUpgradeNotice.value = true;
        }
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
        return;
      }

      if (lastSeenVersion !== __APP_VERSION__) {
        showPromptUpgradeNotice.value = true;
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] consumeUpgradeNotice failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveAiPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      throw new Error(i18n.global.t("errors.promptEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("aiPrompt", trimmedPrompt);
      await store.save();
      aiPrompt.value = trimmedPrompt;

      const payload: SettingsUpdatedPayload = {
        key: "aiPrompt",
        value: trimmedPrompt,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function resetAiPrompt() {
    try {
      const store = await load(STORE_NAME);
      const defaultPrompt = getMinimalPromptForLocale(
        getEffectivePromptLocale(),
      );
      promptMode.value = "minimal";
      aiPrompt.value = defaultPrompt;
      await store.set("promptMode", "minimal");
      await store.set("aiPrompt", defaultPrompt);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: "minimal",
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt reset to minimal");
    } catch (err) {
      console.error(
        "[useSettingsStore] resetAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveEnhancementThreshold(enabled: boolean, charCount: number) {
    const validatedCharCount =
      !Number.isInteger(charCount) || charCount < 1
        ? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT
        : charCount;

    try {
      const store = await load(STORE_NAME);
      await store.set("enhancementThresholdEnabled", enabled);
      await store.set("enhancementThresholdCharCount", validatedCharCount);
      await store.save();

      isEnhancementThresholdEnabled.value = enabled;
      enhancementThresholdCharCount.value = validatedCharCount;

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "enhancementThreshold",
        value: { enabled, charCount: validatedCharCount },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveEnhancementThreshold failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmModel(id: LlmModelId) {
    const trimmed = id.trim();
    if (!trimmed) {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("llmModelId", trimmed);
      await store.save();
      selectedLlmModelId.value = trimmed;

      const payload: SettingsUpdatedPayload = {
        key: "llmModel",
        value: trimmed,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM model saved: ${trimmed}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmModel failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-llm-model" });
      throw err;
    }
  }

  async function saveLlmProvider(_providerId: LlmProviderId) {
    // only custom endpoint remains
    selectedLlmProviderId.value = "custom";
  }

  async function saveLlmBaseUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("llmBaseUrl", trimmed);
      await store.save();
      llmBaseUrl.value = trimmed;
      const payload: SettingsUpdatedPayload = {
        key: "llmProvider",
        value: trimmed,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM base URL saved: ${trimmed}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmBaseUrl failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-llm-base-url" });
      throw err;
    }
  }

  async function saveLlmApiKeyValue(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("llmApiKey", trimmedKey);
      await store.save();
      llmApiKey.value = trimmedKey;
      console.log("[useSettingsStore] LLM API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmApiKeyValue failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-llm-api-key" });
      throw err;
    }
  }

  async function deleteLlmApiKeyValue() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("llmApiKey");
      await store.save();
      llmApiKey.value = "";
      console.log("[useSettingsStore] LLM API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteLlmApiKeyValue failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  // Back-compat stubs (settings UI may still call these names)
  async function saveOpenaiApiKey(key: string) {
    await saveLlmApiKeyValue(key);
  }
  async function deleteOpenaiApiKey() {
    await deleteLlmApiKeyValue();
  }
  async function saveAnthropicApiKey(key: string) {
    await saveLlmApiKeyValue(key);
  }
  async function deleteAnthropicApiKey() {
    await deleteLlmApiKeyValue();
  }
  async function saveGeminiApiKey(key: string) {
    await saveLlmApiKeyValue(key);
  }
  async function deleteGeminiApiKey() {
    await deleteLlmApiKeyValue();
  }

  async function refreshLlmApiKey() {
    try {
      const store = await load(STORE_NAME);
      llmApiKey.value =
        (
          (await store.get<string>("llmApiKey")) ??
          (await store.get<string>("openaiApiKey")) ??
          (await store.get<string>("groqApiKey"))
        )?.trim() ?? "";
      llmBaseUrl.value =
        (await store.get<string>("llmBaseUrl"))?.trim() || DEFAULT_LLM_BASE_URL;
      selectedLlmModelId.value = getEffectiveLlmModelId(
        (await store.get<string>("llmModelId")) ?? null,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshLlmApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveWhisperModel(_id: WhisperModelId) {
    selectedWhisperModelId.value = DOUBAO_ASR_MODEL_ID;
  }

  async function loadAutoStartStatus() {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      isAutoStartEnabled.value = await isEnabled();
    } catch (err) {
      console.error(
        "[useSettingsStore] loadAutoStartStatus failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function toggleAutoStart() {
    try {
      if (isAutoStartEnabled.value) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable();
        isAutoStartEnabled.value = false;
      } else {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        isAutoStartEnabled.value = true;
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] toggleAutoStart failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLocale(locale: SupportedLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedLocale", locale);
      selectedLocale.value = locale;
      i18n.global.locale.value = locale;
      document.documentElement.lang = getHtmlLangForLocale(locale);

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "locale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-locale" });
      throw err;
    }
  }

  async function saveTranscriptionLocale(locale: TranscriptionLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedTranscriptionLocale", locale);
      selectedTranscriptionLocale.value = locale;

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "transcriptionLocale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Transcription locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveTranscriptionLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-transcription-locale",
      });
      throw err;
    }
  }

  function getWhisperLanguageCode(): string | null {
    return getWhisperCodeForTranscriptionLocale(
      selectedTranscriptionLocale.value,
    );
  }

  async function saveMuteOnRecording(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("muteOnRecording", enabled);
      await store.save();
      isMuteOnRecordingEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "muteOnRecording",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMuteOnRecording failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-mute" });
      throw err;
    }
  }

  async function saveSoundEffectsEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("soundEffectsEnabled", enabled);
      await store.save();
      isSoundEffectsEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "soundEffectsEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] soundEffectsEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSoundEffectsEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-sound-effects" });
      throw err;
    }
  }

  // 仅 macOS 生效；失败不影响已持久化的设定，重启后由 Rust 端套用
  async function applyDockVisibility(hidden: boolean) {
    if (!IS_MACOS) return;
    try {
      await setDockVisibility(!hidden);
    } catch (applyErr) {
      console.error(
        "[useSettingsStore] setDockVisibility failed:",
        extractErrorMessage(applyErr),
      );
    }
  }

  async function saveHideDockIcon(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hideDockIcon", enabled);
      await store.save();
      isHideDockIconEnabled.value = enabled;

      await applyDockVisibility(enabled);

      const payload: SettingsUpdatedPayload = {
        key: "hideDockIcon",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] hideDockIcon saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHideDockIcon failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hide-dock-icon" });
      throw err;
    }
  }

  async function saveSmartDictionaryEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("smartDictionaryEnabled", enabled);
      await store.save();
      isSmartDictionaryEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "smartDictionaryEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[useSettingsStore] smartDictionaryEnabled saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSmartDictionaryEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-smart-dictionary",
      });
      throw err;
    }
  }

  async function saveRecordingAutoCleanup(enabled: boolean, days: number) {
    const validatedDays =
      !Number.isInteger(days) || days < 1
        ? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS
        : days;

    try {
      const store = await load(STORE_NAME);
      await store.set("recordingAutoCleanupEnabled", enabled);
      await store.set("recordingAutoCleanupDays", validatedDays);
      await store.save();

      isRecordingAutoCleanupEnabled.value = enabled;
      recordingAutoCleanupDays.value = validatedDays;

      console.log(
        `[useSettingsStore] Recording auto cleanup saved: enabled=${enabled}, days=${validatedDays}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveRecordingAutoCleanup failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-recording-auto-cleanup",
      });
      throw err;
    }
  }

  async function saveAudioInputDevice(deviceName: string) {
    try {
      const store = await load(STORE_NAME);
      await store.set("audioInputDeviceName", deviceName);
      await store.save();

      selectedAudioInputDeviceName.value = deviceName;

      const payload: SettingsUpdatedPayload = {
        key: "audioInputDevice",
        value: deviceName,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Audio input device saved: "${deviceName || "(system default)"}"`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAudioInputDevice failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-audio-input-device",
      });
      throw err;
    }
  }

  async function saveCopyTranscriptionToClipboard(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("copyTranscriptionToClipboard", enabled);
      await store.save();
      isCopyTranscriptionToClipboardEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "copyTranscriptionToClipboard",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] copyTranscriptionToClipboard saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCopyTranscriptionToClipboard failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-copy-transcription-to-clipboard",
      });
      throw err;
    }
  }

  async function refreshCrossWindowSettings() {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      const savedDoubaoAppId = await store.get<string>("doubaoAppId");
      const savedDoubaoAccessKey = await store.get<string>("doubaoAccessKey");
      const savedLlmBaseUrl = await store.get<string>("llmBaseUrl");
      const savedLlmApiKey =
        (await store.get<string>("llmApiKey")) ??
        (await store.get<string>("openaiApiKey")) ??
        (await store.get<string>("groqApiKey"));
      const savedPrompt = await store.get<string>("aiPrompt");
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedHideDockIcon = await store.get<boolean>("hideDockIcon");
      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );

      hotkeyConfig.value = {
        triggerKey: savedKey ?? getDefaultTriggerKey(),
        triggerMode: savedMode ?? "hold",
      };
      const isValidCustomOrCombo =
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        (isCustomTriggerKey(savedCustomKey) ||
          isComboTriggerKey(savedCustomKey));
      customTriggerKey.value = isValidCustomOrCombo ? savedCustomKey : null;
      customTriggerKeyDomCode.value = isValidCustomOrCombo
        ? (savedCustomDomCode ?? "")
        : "";
      // Locale + transcription locale must be synced first — aiPrompt fallback depends on them
      const rawSavedLocale = await store.get<string>("selectedLocale");
      const normalizedLocale =
        normalizeSupportedLocale(rawSavedLocale) ?? FALLBACK_LOCALE;
      selectedLocale.value = normalizedLocale;
      if (rawSavedLocale != null && normalizedLocale !== rawSavedLocale) {
        await store.set("selectedLocale", normalizedLocale);
        await store.save();
      }
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      const rawSavedTranscriptionLocale = await store.get<string>(
        "selectedTranscriptionLocale",
      );
      const normalizedTranscriptionLocale =
        normalizeTranscriptionLocale(rawSavedTranscriptionLocale) ??
        selectedLocale.value;
      selectedTranscriptionLocale.value = normalizedTranscriptionLocale;
      if (
        rawSavedTranscriptionLocale != null &&
        normalizedTranscriptionLocale !== rawSavedTranscriptionLocale
      ) {
        await store.set(
          "selectedTranscriptionLocale",
          normalizedTranscriptionLocale,
        );
        await store.save();
      }

      // Prompt mode (with runtime validation)
      const savedPromptMode = await store.get<string>("promptMode");
      promptMode.value =
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
          ? (savedPromptMode as PromptMode)
          : DEFAULT_PROMPT_MODE;

      doubaoAppId.value = savedDoubaoAppId?.trim() ?? "";
      doubaoAccessKey.value = savedDoubaoAccessKey?.trim() ?? "";
      llmBaseUrl.value = savedLlmBaseUrl?.trim() || DEFAULT_LLM_BASE_URL;
      llmApiKey.value = savedLlmApiKey?.trim() ?? "";
      aiPrompt.value =
        savedPrompt?.trim() ||
        getMinimalPromptForLocale(getEffectivePromptLocale());
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      selectedLlmProviderId.value = "custom";
      selectedLlmModelId.value = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );
      selectedWhisperModelId.value = getEffectiveWhisperModelId(null);
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;
      const nextHideDockIcon = savedHideDockIcon ?? DEFAULT_HIDE_DOCK_ICON;
      if (nextHideDockIcon !== isHideDockIconEnabled.value) {
        void applyDockVisibility(nextHideDockIcon);
      }
      isHideDockIconEnabled.value = nextHideDockIcon;
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedRecCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;
      const savedRecCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedAudioDevice = await store.get<string>("audioInputDeviceName");
      selectedAudioInputDeviceName.value = savedAudioDevice ?? "";

      const savedCopyTranscriptionToClipboard = await store.get<boolean>(
        "copyTranscriptionToClipboard",
      );
      isCopyTranscriptionToClipboardEnabled.value =
        savedCopyTranscriptionToClipboard ??
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshCrossWindowSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "refresh-cross-window" });
    }
  }

  async function initializeAutoStart() {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        await store.set("hasInitAutoStart", true);
        await store.save();
        isAutoStartEnabled.value = true;
        console.log("[useSettingsStore] Auto-start enabled on first launch");
      } else {
        await loadAutoStartStatus();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] initializeAutoStart failed:",
        extractErrorMessage(err),
      );
    }
  }

  return {
    hotkeyConfig,
    triggerMode,
    hasApiKey,
    doubaoAppId: computed(() => doubaoAppId.value),
    doubaoAccessKey: computed(() => doubaoAccessKey.value),
    aiPrompt,
    promptMode,
    showPromptUpgradeNotice,
    isAutoStartEnabled,
    isEnhancementThresholdEnabled,
    enhancementThresholdCharCount,
    selectedLlmProviderId,
    selectedLlmModelId,
    selectedWhisperModelId,
    hasLlmApiKey,
    llmBaseUrl: computed(() => llmBaseUrl.value),
    llmApiKey: computed(() => llmApiKey.value),
    // legacy aliases
    openaiApiKey: computed(() => llmApiKey.value),
    anthropicApiKey: computed(() => llmApiKey.value),
    geminiApiKey: computed(() => llmApiKey.value),
    getApiKey,
    getDoubaoAppId,
    getDoubaoAccessKey,
    getLlmApiKey,
    getLlmBaseUrl,
    getAiPrompt,
    savePromptMode,
    consumeUpgradeNotice,
    saveAiPrompt,
    resetAiPrompt,
    refreshApiKey,
    loadSettings,
    saveHotkeyConfig,
    saveCustomTriggerKey,
    saveComboTriggerKey,
    switchToPresetMode,
    switchToCustomMode,
    getTriggerKeyDisplayName,
    customTriggerKey,
    customTriggerKeyDomCode,
    // Hotkey recording helpers (proxied from lib/ for views)
    getPlatformKeycode,
    getKeyDisplayName,
    isPresetEquivalentKey,
    getDangerousKeyWarning,
    getEscapeReservedMessage,
    getHotkeyRecordingTimeoutMessage,
    getHotkeyUnsupportedKeyMessage,
    getHotkeyPresetHint,
    saveApiKey,
    saveDoubaoCredentials,
    deleteApiKey,
    saveEnhancementThreshold,
    saveLlmModel,
    saveLlmProvider,
    saveLlmBaseUrl,
    saveLlmApiKeyValue,
    deleteLlmApiKeyValue,
    saveOpenaiApiKey,
    deleteOpenaiApiKey,
    saveAnthropicApiKey,
    deleteAnthropicApiKey,
    saveGeminiApiKey,
    deleteGeminiApiKey,
    refreshLlmApiKey,
    saveWhisperModel,
    isMuteOnRecordingEnabled,
    saveMuteOnRecording,
    isSoundEffectsEnabled,
    saveSoundEffectsEnabled,
    isHideDockIconEnabled,
    saveHideDockIcon,
    isSmartDictionaryEnabled,
    saveSmartDictionaryEnabled,
    isRecordingAutoCleanupEnabled,
    recordingAutoCleanupDays,
    saveRecordingAutoCleanup,
    selectedAudioInputDeviceName,
    saveAudioInputDevice,
    isCopyTranscriptionToClipboardEnabled,
    saveCopyTranscriptionToClipboard,
    selectedLocale,
    saveLocale,
    selectedTranscriptionLocale,
    saveTranscriptionLocale,
    getWhisperLanguageCode,
    refreshCrossWindowSettings,
    loadAutoStartStatus,
    toggleAutoStart,
    initializeAutoStart,
  };
});
