<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  useSettingsStore,
  DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
} from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  HOTKEY_RECORDING_CAPTURED,
  HOTKEY_RECORDING_REJECTED,
} from "../composables/useTauriEvents";
import {
  type PresetTriggerKey,
  type ComboTriggerKey,
  isCustomTriggerKey,
  isComboTriggerKey,
} from "../types/settings";
import type {
  RecordingCapturedPayload,
  RecordingRejectedPayload,
} from "../types/events";
import type { TriggerMode } from "../types";
import {
  getDomCodeByKeycode,
  getKeyDisplayNameByKeycode,
} from "../lib/keycodeMap";
import { DEFAULT_LLM_BASE_URL } from "../lib/llmProvider";
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "../i18n/languageConfig";

import { PROMPT_MODE_VALUES, type PromptMode } from "../types/settings";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Mic,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";
import type { AudioInputDeviceInfo } from "../types/audio";
import { useAudioPreview } from "../composables/useAudioPreview";
import ConnectionTestButton from "../components/ConnectionTestButton.vue";
import {
  testLlmConnection,
  testAsrConnection,
} from "../lib/connectionTest";

const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();
const { t } = useI18n();

// ── 快捷键设定 ──────────────────────────────────────────────
const isMac = navigator.userAgent.includes("Mac");

const triggerKeyOptions = computed<{ value: PresetTriggerKey; label: string }[]>(() =>
  isMac
    ? [
        { value: "fn", label: t("settings.hotkey.keys.fn") },
        { value: "option", label: t("settings.hotkey.keys.leftOption") },
        { value: "rightOption", label: t("settings.hotkey.keys.rightOption") },
        { value: "control", label: t("settings.hotkey.keys.leftControl") },
        { value: "rightControl", label: t("settings.hotkey.keys.rightControl") },
        { value: "command", label: t("settings.hotkey.keys.command") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
    : [
        { value: "rightAlt", label: t("settings.hotkey.keys.rightAlt") },
        { value: "leftAlt", label: t("settings.hotkey.keys.leftAlt") },
        { value: "control", label: t("settings.hotkey.keys.control") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
);

const hotkeyFeedback = useFeedbackMessage();

// ── 两层模式切换 ──────────────────────────────────────────
const isCustomMode = ref(false);
const isRecording = ref(false);
const recordingWarning = ref("");
const recordingHint = ref("");
let recordingTimeoutId: ReturnType<typeof setTimeout> | undefined;

const RECORDING_TIMEOUT_MS = 10_000;

const currentCustomKeyDisplay = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (key && isComboTriggerKey(key)) {
    return settingsStore.getTriggerKeyDisplayName(key);
  }
  if (!settingsStore.customTriggerKeyDomCode) return "";
  return settingsStore.getKeyDisplayName(settingsStore.customTriggerKeyDomCode);
});

const hasCustomKey = computed(() => settingsStore.customTriggerKey !== null);

const currentPresetKey = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (!key || isCustomTriggerKey(key) || isComboTriggerKey(key)) return isMac ? "fn" : "rightAlt";
  return key;
});

let recordingUnlisteners: UnlistenFn[] = [];

async function handleRecordingCaptured(payload: RecordingCapturedPayload) {
  const { keycode, modifiers } = payload;
  recordingWarning.value = "";
  recordingHint.value = "";

  const currentMode = settingsStore.triggerMode;
  stopKeyRecording();

  const domCode = getDomCodeByKeycode(keycode);

  if (modifiers.length > 0) {
    // Combo key: modifier(s) + primary key
    if (domCode) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    const comboKey: ComboTriggerKey = {
      combo: { modifiers, keycode },
    };
    try {
      await settingsStore.saveComboTriggerKey(comboKey, domCode ?? "", currentMode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: settingsStore.getTriggerKeyDisplayName(comboKey) }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  } else {
    // Single key
    const isPresetEquivalent = domCode ? settingsStore.isPresetEquivalentKey(domCode) : false;

    if (domCode && !isPresetEquivalent) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    if (isPresetEquivalent) {
      recordingHint.value = settingsStore.getHotkeyPresetHint();
    }

    try {
      await settingsStore.saveCustomTriggerKey(keycode, domCode ?? "", currentMode);
      const displayName = domCode
        ? settingsStore.getKeyDisplayName(domCode)
        : getKeyDisplayNameByKeycode(keycode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: displayName }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  }
}

function handleRecordingRejected(payload: RecordingRejectedPayload) {
  stopKeyRecording();
  if (payload.reason === "esc_reserved") {
    hotkeyFeedback.show("error", settingsStore.getEscapeReservedMessage());
  }
}

async function startRecording() {
  isRecording.value = true;
  recordingWarning.value = "";
  recordingHint.value = "";

  // Tell Rust to enter recording mode
  try {
    await invoke("start_hotkey_recording");
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
    isRecording.value = false;
    return;
  }

  // Listen for Rust recording events
  const [unlistenCaptured, unlistenRejected] = await Promise.all([
    listenToEvent<RecordingCapturedPayload>(
      HOTKEY_RECORDING_CAPTURED,
      (event) => void handleRecordingCaptured(event.payload),
    ),
    listenToEvent<RecordingRejectedPayload>(
      HOTKEY_RECORDING_REJECTED,
      (event) => handleRecordingRejected(event.payload),
    ),
  ]);
  recordingUnlisteners = [unlistenCaptured, unlistenRejected];

  // 10s timeout
  recordingTimeoutId = setTimeout(() => {
    if (isRecording.value) {
      hotkeyFeedback.show("error", settingsStore.getHotkeyRecordingTimeoutMessage());
      stopKeyRecording();
    }
  }, RECORDING_TIMEOUT_MS);
}

function stopKeyRecording() {
  if (!isRecording.value) return;
  isRecording.value = false;
  clearTimeout(recordingTimeoutId);
  // Cancel Rust recording mode
  void invoke("cancel_hotkey_recording").catch(() => {});
  // Clean up event listeners
  for (const unlisten of recordingUnlisteners) {
    unlisten();
  }
  recordingUnlisteners = [];
}

function switchToCustom() {
  isCustomMode.value = true;
  if (hasCustomKey.value) {
    // Restore saved custom key as active
    settingsStore
      .switchToCustomMode(settingsStore.triggerMode)
      .catch((err: unknown) => {
        hotkeyFeedback.show("error", extractErrorMessage(err));
      });
  }
}

function switchToPreset() {
  isCustomMode.value = false;
  stopKeyRecording();
  recordingWarning.value = "";
  recordingHint.value = "";
  settingsStore
    .switchToPresetMode(currentPresetKey.value, settingsStore.triggerMode)
    .catch((err: unknown) => {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    });
}

async function handleTriggerKeyChange(newKey: PresetTriggerKey) {
  const currentMode = settingsStore.triggerMode;
  try {
    await settingsStore.saveHotkeyConfig(newKey, currentMode);
    hotkeyFeedback.show("success", t("settings.hotkey.updated"));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey =
    settingsStore.hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    hotkeyFeedback.show("success", t("settings.hotkey.modeUpdated"));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

// ── Doubao ASR Credentials ─────────────────────────────────
const doubaoAppIdInput = ref("");
const doubaoAccessKeyInput = ref("");
const isApiKeyVisible = ref(false);
const isSubmittingApiKey = ref(false);
const apiKeyFeedback = useFeedbackMessage();

const isConfirmingDeleteApiKey = ref(false);
let deleteConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const apiKeyStatusLabel = computed(() =>
  settingsStore.hasApiKey ? t("settings.apiKey.set") : t("settings.apiKey.notSet"),
);
const apiKeyStatusClass = computed(() =>
  settingsStore.hasApiKey
    ? "bg-green-500/20 text-green-400"
    : "bg-red-500/20 text-red-400",
);
const shouldShowOnboardingHint = computed(() => !settingsStore.hasApiKey);

function toggleApiKeyVisibility() {
  isApiKeyVisible.value = !isApiKeyVisible.value;
}

async function handleSaveApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.saveDoubaoCredentials(
      doubaoAppIdInput.value,
      doubaoAccessKeyInput.value,
    );
    isApiKeyVisible.value = false;
    doubaoAppIdInput.value = "";
    doubaoAccessKeyInput.value = "";
    apiKeyFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

function requestDeleteApiKey() {
  if (!isConfirmingDeleteApiKey.value) {
    isConfirmingDeleteApiKey.value = true;
    deleteConfirmTimeoutId = setTimeout(() => {
      isConfirmingDeleteApiKey.value = false;
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimeoutId);
  isConfirmingDeleteApiKey.value = false;
  handleDeleteApiKey();
}

async function handleDeleteApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.deleteApiKey();
    doubaoAppIdInput.value = "";
    doubaoAccessKeyInput.value = "";
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

const promptInput = ref("");
const isSubmittingPrompt = ref(false);
const promptFeedback = useFeedbackMessage();
const selectedPromptMode = ref<PromptMode>("minimal");
const isPresetDirty = ref(false);

const isConfirmingResetPrompt = ref(false);

// Preset 模式下切语言时即时更新 textarea
watch(
  [() => settingsStore.selectedLocale, () => settingsStore.selectedTranscriptionLocale],
  () => {
    if (selectedPromptMode.value !== "custom" && !isPresetDirty.value) {
      promptInput.value = settingsStore.getAiPrompt();
    }
  },
);
let resetPromptConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;




async function handleSavePrompt() {
  const wasModeSwitch = selectedPromptMode.value !== "custom" && isPresetDirty.value;
  const previousMode = selectedPromptMode.value;
  try {
    isSubmittingPrompt.value = true;
    // preset 模式下编辑 → 切到 custom
    if (wasModeSwitch) {
      await settingsStore.savePromptMode("custom");
      selectedPromptMode.value = "custom";
      isPresetDirty.value = false;
    }
    await settingsStore.saveAiPrompt(promptInput.value);
    promptFeedback.show("success", t("settings.prompt.saved"));
  } catch (err) {
    if (wasModeSwitch) {
      await settingsStore.savePromptMode(previousMode).catch(() => {});
      selectedPromptMode.value = previousMode;
    }
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

async function handlePromptModeChange(mode: unknown) {
  if (typeof mode !== "string" || !(PROMPT_MODE_VALUES as readonly string[]).includes(mode)) return;
  const newMode = mode as PromptMode;
  const previousMode = selectedPromptMode.value;
  selectedPromptMode.value = newMode;
  try {
    await settingsStore.savePromptMode(newMode);
    promptInput.value = settingsStore.getAiPrompt();
    isPresetDirty.value = false;
  } catch (err) {
    selectedPromptMode.value = previousMode;
    promptFeedback.show("error", extractErrorMessage(err));
  }
}

function handlePromptInput() {
  if (selectedPromptMode.value !== "custom" && !isPresetDirty.value) {
    isPresetDirty.value = true;
  }
}

function requestResetPrompt() {
  if (!isConfirmingResetPrompt.value) {
    isConfirmingResetPrompt.value = true;
    resetPromptConfirmTimeoutId = setTimeout(() => {
      isConfirmingResetPrompt.value = false;
    }, 3000);
    return;
  }
  clearTimeout(resetPromptConfirmTimeoutId);
  isConfirmingResetPrompt.value = false;
  handleResetPrompt();
}

async function handleResetPrompt() {
  try {
    isSubmittingPrompt.value = true;
    await settingsStore.resetAiPrompt();
    selectedPromptMode.value = "minimal";
    promptInput.value = settingsStore.getAiPrompt();
    isPresetDirty.value = false;
    promptFeedback.show("success", t("settings.prompt.resetDone"));
  } catch (err) {
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

// ── AI 整理门槛 ──────────────────────────────────────────────
const thresholdEnabled = ref(DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED);
const thresholdCharCount = ref(DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT);
const enhancementThresholdFeedback = useFeedbackMessage();

async function handleToggleEnhancementThreshold() {
  thresholdEnabled.value = !thresholdEnabled.value;
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    enhancementThresholdFeedback.show(
      "success",
      thresholdEnabled.value ? t("settings.threshold.enabledFeedback") : t("settings.threshold.disabledFeedback"),
    );
  } catch (err) {
    thresholdEnabled.value = !thresholdEnabled.value;
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveThresholdCharCount() {
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
    enhancementThresholdFeedback.show("success", t("settings.threshold.charCountSaved"));
  } catch (err) {
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

// ── LLM (OpenAI-compatible) ──────────────────────────────
const modelFeedback = useFeedbackMessage();
const providerFeedback = useFeedbackMessage();
const llmBaseUrlInput = ref("");
const llmApiKeyInput = ref("");
const llmModelInput = ref("");
const isLlmApiKeyVisible = ref(false);

async function handleSaveLlmConfig() {
  try {
    if (llmBaseUrlInput.value.trim()) {
      await settingsStore.saveLlmBaseUrl(llmBaseUrlInput.value);
    }
    if (llmModelInput.value.trim()) {
      await settingsStore.saveLlmModel(llmModelInput.value.trim());
    }
    if (llmApiKeyInput.value.trim()) {
      await settingsStore.saveLlmApiKeyValue(llmApiKeyInput.value);
      llmApiKeyInput.value = "";
    }
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteLlmApiKey() {
  try {
    await settingsStore.deleteLlmApiKeyValue();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}


// ── 录音自动静音 ──────────────────────────────────────────────
const muteOnRecordingFeedback = useFeedbackMessage();

async function handleToggleMuteOnRecording(newValue: boolean) {
  try {
    await settingsStore.saveMuteOnRecording(newValue);
    muteOnRecordingFeedback.show(
      "success",
      newValue ? t("settings.app.muteEnabled") : t("settings.app.muteDisabled"),
    );
  } catch (err) {
    muteOnRecordingFeedback.show("error", extractErrorMessage(err));
  }
}

const soundFeedbackFeedback = useFeedbackMessage();

async function handleToggleSoundFeedback(newValue: boolean) {
  try {
    await settingsStore.saveSoundEffectsEnabled(newValue);
    soundFeedbackFeedback.show(
      "success",
      newValue
        ? t("settings.app.soundFeedbackEnabled")
        : t("settings.app.soundFeedbackDisabled"),
    );
  } catch (err) {
    soundFeedbackFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 隐藏 Dock 图示 (gh-56，仅 macOS) ──────────────────────────
const hideDockIconFeedback = useFeedbackMessage();
// macOS 对「Dock 显示后 1 秒内的隐藏请求」会静默忽略（Tao 防重复图示守卫），
// 切换后短暂锁住开关，避免快速连按造成 UI 与实际 Dock 状态脱节
const isHideDockIconPending = ref(false);
let hideDockIconPendingTimeoutId: ReturnType<typeof setTimeout> | undefined;

async function handleToggleHideDockIcon(newValue: boolean) {
  isHideDockIconPending.value = true;
  try {
    await settingsStore.saveHideDockIcon(newValue);
    hideDockIconFeedback.show(
      "success",
      newValue
        ? t("settings.app.hideDockIconEnabled")
        : t("settings.app.hideDockIconDisabled"),
    );
  } catch (err) {
    hideDockIconFeedback.show("error", extractErrorMessage(err));
  } finally {
    hideDockIconPendingTimeoutId = setTimeout(() => {
      isHideDockIconPending.value = false;
    }, 1200);
  }
}

// ── 转录文字是否复制到剪贴簿 (gh-35) ──────────────────────────
const copyTranscriptionToClipboardFeedback = useFeedbackMessage();

async function handleToggleCopyTranscriptionToClipboard(newValue: boolean) {
  try {
    await settingsStore.saveCopyTranscriptionToClipboard(newValue);
    copyTranscriptionToClipboardFeedback.show(
      "success",
      newValue
        ? t("settings.app.copyTranscriptionToClipboard.enabled")
        : t("settings.app.copyTranscriptionToClipboard.disabled"),
    );
  } catch (err) {
    copyTranscriptionToClipboardFeedback.show(
      "error",
      extractErrorMessage(err),
    );
  }
}

// ── 介面语言 ──────────────────────────────────────────────
const localeFeedback = useFeedbackMessage();

async function handleLocaleChange(newLocale: SupportedLocale) {
  try {
    await settingsStore.saveLocale(newLocale);
    localeFeedback.show("success", t("settings.app.languageUpdated"));
  } catch (err) {
    localeFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 转录语言 ──────────────────────────────────────────────
const transcriptionLocaleFeedback = useFeedbackMessage();

async function handleTranscriptionLocaleChange(newLocale: TranscriptionLocale) {
  try {
    await settingsStore.saveTranscriptionLocale(newLocale);
    transcriptionLocaleFeedback.show("success", t("settings.app.transcriptionLanguageUpdated"));
  } catch (err) {
    transcriptionLocaleFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 智慧字典学习 ────────────────────────────────────────────
const smartDictionaryFeedback = useFeedbackMessage();

async function handleToggleSmartDictionary(newValue: boolean) {
  try {
    await settingsStore.saveSmartDictionaryEnabled(newValue);
    smartDictionaryFeedback.show("success", t("common.save"));
  } catch (err) {
    smartDictionaryFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 录音储存管理 ──────────────────────────────────────────
const recordingCleanupFeedback = useFeedbackMessage();
const recordingAutoCleanupEnabled = ref(false);
const recordingAutoCleanupDays = ref(7);
const isDeletingRecordings = ref(false);

async function handleToggleRecordingAutoCleanup() {
  recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingCleanupFeedback.show(
      "success",
      recordingAutoCleanupEnabled.value
        ? t("settings.recording.autoCleanupEnabled")
        : t("settings.recording.autoCleanupDisabled"),
    );
  } catch (err) {
    recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveCleanupDays() {
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
    recordingCleanupFeedback.show("success", t("settings.recording.daysSaved"));
  } catch (err) {
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAllRecordings() {
  try {
    isDeletingRecordings.value = true;
    const deletedCount = await historyStore.deleteAllRecordingFiles();

    recordingCleanupFeedback.show(
      "success",
      t("settings.recording.deleteSuccess", { count: deletedCount }),
    );
  } catch (err) {
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  } finally {
    isDeletingRecordings.value = false;
  }
}

// ── 应用程式 ────────────────────────────────────────────────
const autoStartFeedback = useFeedbackMessage();
const isTogglingAutoStart = ref(false);

async function handleToggleAutoStart() {
  try {
    isTogglingAutoStart.value = true;
    await settingsStore.toggleAutoStart();
    autoStartFeedback.show(
      "success",
      settingsStore.isAutoStartEnabled ? t("settings.app.autoStartEnabled") : t("settings.app.autoStartDisabled"),
    );
  } catch (err) {
    autoStartFeedback.show("error", extractErrorMessage(err));
  } finally {
    isTogglingAutoStart.value = false;
  }
}

// ── 输入装置 ──────────────────────────────────────────────
const audioInputDeviceList = ref<AudioInputDeviceInfo[]>([]);
const defaultInputDeviceName = ref<string | null>(null);
const isRefreshingDeviceList = ref(false);
const audioInputFeedback = useFeedbackMessage();
const { previewLevel, isPreviewActive, startPreview, stopPreview } =
  useAudioPreview();

async function loadAudioInputDeviceList() {
  try {
    audioInputDeviceList.value =
      await invoke<AudioInputDeviceInfo[]>("list_audio_input_devices");
    defaultInputDeviceName.value =
      await invoke<string | null>("get_default_input_device_name");
  } catch (err) {
    console.error(
      "[SettingsView] Failed to list audio input devices:",
      extractErrorMessage(err),
    );
  }
}

async function handleRefreshAudioInputDeviceList() {
  isRefreshingDeviceList.value = true;
  try {
    await loadAudioInputDeviceList();
    audioInputFeedback.show(
      "success",
      t("settings.audioInput.refreshed", {
        count: audioInputDeviceList.value.length,
      }),
    );
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  } finally {
    isRefreshingDeviceList.value = false;
  }
}

async function handleAudioInputDeviceChange(deviceName: string) {
  try {
    await settingsStore.saveAudioInputDevice(deviceName);
    audioInputFeedback.show("success", t("settings.audioInput.updated"));
    void startPreview(deviceName);
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  }
}

onMounted(async () => {
  // F5 fix: 先载入装置列表，完成后再启动预览（避免 cpal 并行 host 查询）
  void loadAudioInputDeviceList().then(() => {
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  });
  selectedPromptMode.value = settingsStore.promptMode;
  promptInput.value = settingsStore.getAiPrompt();
  isPresetDirty.value = false;

  if (settingsStore.hasApiKey) {
    doubaoAppIdInput.value = settingsStore.getDoubaoAppId();
    doubaoAccessKeyInput.value = settingsStore.getDoubaoAccessKey();
  }
  llmBaseUrlInput.value = settingsStore.getLlmBaseUrl() || DEFAULT_LLM_BASE_URL;
  llmModelInput.value = settingsStore.selectedLlmModelId;
  thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;
  thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
  recordingAutoCleanupEnabled.value =
    settingsStore.isRecordingAutoCleanupEnabled;
  recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
  await settingsStore.loadAutoStartStatus();

  // Detect if current key is custom or combo
  const currentKey = settingsStore.hotkeyConfig?.triggerKey;
  if (currentKey && (isCustomTriggerKey(currentKey) || isComboTriggerKey(currentKey))) {
    isCustomMode.value = true;
  }
});

onBeforeUnmount(() => {
  void stopPreview();
  stopKeyRecording();
  hotkeyFeedback.clearTimer();
  apiKeyFeedback.clearTimer();
  promptFeedback.clearTimer();
  enhancementThresholdFeedback.clearTimer();
  modelFeedback.clearTimer();
  muteOnRecordingFeedback.clearTimer();
  soundFeedbackFeedback.clearTimer();
  hideDockIconFeedback.clearTimer();
  copyTranscriptionToClipboardFeedback.clearTimer();
  localeFeedback.clearTimer();
  transcriptionLocaleFeedback.clearTimer();
  autoStartFeedback.clearTimer();
  smartDictionaryFeedback.clearTimer();
  recordingCleanupFeedback.clearTimer();
  providerFeedback.clearTimer();
  clearTimeout(deleteConfirmTimeoutId);
  clearTimeout(resetPromptConfirmTimeoutId);
  clearTimeout(hideDockIconPendingTimeoutId);
});
</script>

<template>
  <div class="settings-page space-y-5 text-foreground">
    <!-- 快捷键设定 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.hotkey.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 简易 / 自订 模式切换 -->
        <div class="flex items-center justify-between">
          <Label>{{ $t("settings.hotkey.triggerKeyMode") }}</Label>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                !isCustomMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="switchToPreset"
            >
              {{ $t("settings.hotkey.preset") }}
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                isCustomMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="switchToCustom"
            >
              {{ $t("settings.hotkey.custom") }}
            </button>
          </div>
        </div>

        <!-- 简易模式：Select 下拉 -->
        <div v-if="!isCustomMode" class="flex items-center justify-between">
          <Label for="trigger-key">{{ $t("settings.hotkey.triggerKey") }}</Label>
          <Select
            :model-value="currentPresetKey"
            @update:model-value="handleTriggerKeyChange($event as PresetTriggerKey)"
          >
            <SelectTrigger id="trigger-key" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in triggerKeyOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 自订模式：录制按键 -->
        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <Label>{{ $t("settings.hotkey.customTriggerKey") }}</Label>
            <div class="flex items-center gap-3">
              <span v-if="hasCustomKey" class="text-sm font-medium text-foreground">
                {{ currentCustomKeyDisplay }}
              </span>
              <span v-else class="text-sm text-muted-foreground">{{ $t("settings.hotkey.notSet") }}</span>
              <Button
                :variant="isRecording ? 'destructive' : 'outline'"
                size="sm"
                :class="{ 'animate-pulse': isRecording }"
                @click="isRecording ? stopKeyRecording() : startRecording()"
              >
                {{ isRecording ? $t('settings.hotkey.pressKey') : $t('settings.hotkey.record') }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.hotkey.systemKeyHint") }}
          </p>

          <!-- 警告讯息（黄色） -->
          <p v-if="recordingWarning" class="text-sm text-destructive">
            {{ recordingWarning }}
          </p>

          <!-- 提示讯息（蓝色） -->
          <p v-if="recordingHint" class="text-sm text-muted-foreground">
            {{ recordingHint }}
          </p>
        </div>

        <!-- 触发模式 -->
        <div class="flex items-center justify-between">
          <Label for="trigger-mode">{{ $t("settings.hotkey.triggerMode") }}</Label>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                settingsStore.triggerMode === 'hold'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="handleTriggerModeChange('hold')"
            >
              Hold
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                settingsStore.triggerMode === 'toggle'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="handleTriggerModeChange('toggle')"
            >
              Toggle
            </button>
          </div>
        </div>

        <p class="text-sm text-muted-foreground leading-relaxed">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.holdDescription")
              : $t("settings.hotkey.toggleDescription")
          }}
        </p>

        <p class="text-xs text-muted-foreground">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.doubleTapHint")
              : $t("settings.hotkey.longPressHint")
          }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="hotkeyFeedback.message.value !== ''"
            class="text-sm"
            :class="
              hotkeyFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ hotkeyFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- Doubao ASR Credentials -->
    <Card>
      <CardHeader class="flex-row items-center justify-between border-b border-border">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base">{{ $t("settings.apiKey.title") }}</CardTitle>
          <Badge
            :class="apiKeyStatusClass"
            class="border-0"
          >
            {{ apiKeyStatusLabel }}
          </Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.apiKey.instruction") }}
        </p>

        <p
          v-if="shouldShowOnboardingHint"
          class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200"
        >
          {{ $t("settings.apiKey.onboarding") }}
        </p>

        <div class="space-y-2">
          <Label for="doubao-app-id">App ID</Label>
          <Input
            id="doubao-app-id"
            v-model="doubaoAppIdInput"
            :type="isApiKeyVisible ? 'text' : 'password'"
            placeholder="App ID"
            autocomplete="off"
          />
        </div>
        <div class="space-y-2">
          <Label for="doubao-access-key">Access Key (AK)</Label>
          <div class="flex gap-2">
            <Input
              id="doubao-access-key"
              v-model="doubaoAccessKeyInput"
              :type="isApiKeyVisible ? 'text' : 'password'"
              placeholder="Access Key"
              autocomplete="off"
              class="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="toggleApiKeyVisibility"
            >
              {{ isApiKeyVisible ? $t("settings.apiKey.hide") : $t("settings.apiKey.show") }}
            </Button>
            <Button
              :disabled="isSubmittingApiKey"
              @click="handleSaveApiKey"
            >
              {{ $t("common.save") }}
            </Button>
          </div>
        </div>

        <div class="flex flex-wrap items-start gap-2">
          <Button
            v-if="settingsStore.hasApiKey"
            variant="destructive"
            size="sm"
            :disabled="isSubmittingApiKey"
            @click="requestDeleteApiKey"
          >
            {{ isConfirmingDeleteApiKey ? $t('settings.apiKey.confirmDelete') : $t('settings.apiKey.delete') }}
          </Button>
          <ConnectionTestButton
            :on-test="() => testAsrConnection(settingsStore.getDoubaoAppId() || doubaoAppIdInput, settingsStore.getDoubaoAccessKey() || doubaoAccessKeyInput)"
            :disabled="!(settingsStore.hasApiKey || (doubaoAppIdInput.trim() && doubaoAccessKeyInput.trim()))"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="apiKeyFeedback.message.value !== ''"
            class="text-sm"
            :class="
              apiKeyFeedback.type.value === 'success' ? 'text-green-400' : 'text-red-400'
            "
          >
            {{ apiKeyFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- LLM (OpenAI-compatible) -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.model.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-5">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.model.description") }}
        </p>

        <div class="space-y-2">
          <Label for="llm-base-url">{{ $t("settings.provider.baseUrl") }}</Label>
          <Input
            id="llm-base-url"
            v-model="llmBaseUrlInput"
            type="text"
            :placeholder="DEFAULT_LLM_BASE_URL"
            autocomplete="off"
            class="font-mono text-xs"
          />
          <p class="text-xs text-muted-foreground">{{ $t("settings.provider.baseUrlHint") }}</p>
        </div>

        <div class="space-y-2">
          <Label for="llm-model-id">{{ $t("settings.model.llmLabel") }}</Label>
          <Input
            id="llm-model-id"
            v-model="llmModelInput"
            type="text"
            placeholder="gpt-4o-mini"
            autocomplete="off"
            class="font-mono text-xs"
          />
        </div>

        <div class="space-y-2">
          <Label for="llm-api-key">{{ $t("settings.provider.apiKey") }}</Label>
          <div v-if="settingsStore.hasLlmApiKey" class="flex items-center gap-2">
            <Input
              id="llm-api-key"
              :model-value="isLlmApiKeyVisible ? settingsStore.llmApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isLlmApiKeyVisible = !isLlmApiKeyVisible">
              {{ isLlmApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="llm-api-key"
              v-model="llmApiKeyInput"
              type="password"
              placeholder="sk-..."
              class="flex-1 font-mono text-xs"
            />
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Button
            v-if="settingsStore.hasLlmApiKey"
            variant="destructive"
            size="sm"
            @click="handleDeleteLlmApiKey"
          >
            {{ $t('settings.apiKey.delete') }}
          </Button>
          <ConnectionTestButton
            :on-test="() => testLlmConnection(settingsStore.getLlmApiKey() || llmApiKeyInput, { modelId: llmModelInput || settingsStore.selectedLlmModelId, baseUrl: llmBaseUrlInput || settingsStore.getLlmBaseUrl() })"
            :disabled="!(settingsStore.hasLlmApiKey || llmApiKeyInput.trim())"
          />
          <Button class="ml-auto" size="sm" @click="handleSaveLlmConfig">
            {{ $t('common.save') }}
          </Button>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="providerFeedback.message.value !== '' || modelFeedback.message.value !== ''"
            class="text-sm"
            :class="
              (providerFeedback.type.value === 'success' || modelFeedback.type.value === 'success')
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ providerFeedback.message.value || modelFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>


    <!-- AI 整理 Prompt -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.prompt.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ $t("settings.prompt.description") }}
        </p>

        <!-- 模式选择器 -->
        <div class="space-y-2">
          <Label>{{ $t("settings.prompt.modeTitle") }}</Label>
          <RadioGroup
            :model-value="selectedPromptMode"
            class="grid grid-cols-3 gap-2"
            @update:model-value="handlePromptModeChange"
          >
            <Label
              for="mode-minimal"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'minimal' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-minimal" value="minimal" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeMinimal") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeMinimalDescription") }}</p>
              </div>
            </Label>
            <Label
              for="mode-active"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'active' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-active" value="active" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeActive") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeActiveDescription") }}</p>
              </div>
            </Label>
            <Label
              for="mode-custom"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'custom' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-custom" value="custom" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeCustom") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeCustomDescription") }}</p>
              </div>
            </Label>
          </RadioGroup>
        </div>

        <Textarea
          v-model="promptInput"
          class="font-mono min-h-[120px]"
          @input="handlePromptInput"
        />

        <div class="flex justify-start gap-2">
          <Button
            variant="destructive"
            :disabled="isSubmittingPrompt"
            @click="requestResetPrompt"
          >
            {{ isConfirmingResetPrompt ? $t('settings.prompt.confirmReset') : $t('settings.prompt.reset') }}
          </Button>
          <Button
            class="ml-auto"
            :disabled="isSubmittingPrompt || (selectedPromptMode !== 'custom' && !isPresetDirty)"
            @click="handleSavePrompt"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="promptFeedback.message.value !== ''"
            class="text-sm"
            :class="
              promptFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ promptFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 短文字门槛 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.threshold.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.threshold.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="threshold-toggle">{{ thresholdEnabled ? $t('settings.threshold.enabled') : $t('settings.threshold.disabled') }}</Label>
          <Switch
            id="threshold-toggle"
            :model-value="thresholdEnabled"
            @update:model-value="handleToggleEnhancementThreshold"
          />
        </div>

        <div v-if="thresholdEnabled" class="flex items-center gap-3">
          <Label for="threshold-char-count">{{ $t("settings.threshold.charCount") }}</Label>
          <Input
            id="threshold-char-count"
            v-model.number="thresholdCharCount"
            type="number"
            min="1"
            class="w-24"
          />
          <Button
            class="ml-auto"
            size="sm"
            @click="handleSaveThresholdCharCount"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="enhancementThresholdFeedback.message.value !== ''"
            class="text-sm"
            :class="
              enhancementThresholdFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ enhancementThresholdFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 智慧字典学习（macOS: AXUIElement；Windows: UI Automation） -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.smartDictionary.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.smartDictionary.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="smart-dictionary-toggle">{{ $t("settings.smartDictionary.title") }}</Label>
          <Switch
            id="smart-dictionary-toggle"
            :model-value="settingsStore.isSmartDictionaryEnabled"
            @update:model-value="handleToggleSmartDictionary"
          />
        </div>

        <p class="text-xs text-muted-foreground">
          {{ $t("settings.smartDictionary.privacyNote") }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="smartDictionaryFeedback.message.value !== ''"
            class="text-sm"
            :class="
              smartDictionaryFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ smartDictionaryFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 输入装置 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.audioInput.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.audioInput.description") }}
        </p>
        <div class="space-y-2">
          <Label for="audio-input-device">{{ $t("settings.audioInput.deviceLabel") }}</Label>
          <div class="flex items-center gap-2">
            <Select
              :model-value="settingsStore.selectedAudioInputDeviceName || '_default'"
              @update:model-value="handleAudioInputDeviceChange($event === '_default' ? '' : ($event as string))"
            >
              <SelectTrigger id="audio-input-device" class="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">
                  {{
                    defaultInputDeviceName
                      ? $t("settings.audioInput.systemDefaultWithDevice", {
                        device: defaultInputDeviceName,
                      })
                      : $t("settings.audioInput.systemDefault")
                  }}
                </SelectItem>
                <SelectItem
                  v-for="device in audioInputDeviceList"
                  :key="device.name"
                  :value="device.name"
                >
                  {{ device.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              :disabled="isRefreshingDeviceList"
              @click="handleRefreshAudioInputDeviceList"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshingDeviceList }" />
            </Button>
          </div>
        </div>
        <div
          v-if="isPreviewActive"
          role="meter"
          :aria-valuenow="Math.round(previewLevel * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="$t('settings.audioInput.volumePreview')"
          class="flex items-center gap-2 h-5"
        >
          <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div class="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-75"
              :style="{ width: `${Math.round(previewLevel * 100)}%` }"
            />
          </div>
        </div>
        <transition name="feedback-fade">
          <p
            v-if="audioInputFeedback.message.value !== ''"
            class="text-sm"
            :class="audioInputFeedback.type.value === 'success' ? 'text-green-400' : 'text-destructive'"
          >
            {{ audioInputFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 录音储存管理 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.recording.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.recording.description") }}
        </p>

        <div class="flex items-center justify-between">
          <div>
            <Label for="recording-auto-cleanup">{{ $t("settings.recording.autoCleanup") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.recording.autoCleanupDescription") }}</p>
          </div>
          <Switch
            id="recording-auto-cleanup"
            :model-value="recordingAutoCleanupEnabled"
            @update:model-value="handleToggleRecordingAutoCleanup"
          />
        </div>

        <div v-if="recordingAutoCleanupEnabled" class="flex items-center gap-3">
          <Label for="cleanup-days">{{ $t("settings.recording.retentionDays") }}</Label>
          <Input
            id="cleanup-days"
            v-model.number="recordingAutoCleanupDays"
            type="number"
            min="1"
            class="w-24"
          />
          <span class="text-sm text-muted-foreground">{{ $t("settings.recording.daysUnit") }}</span>
          <Button
            class="ml-auto"
            size="sm"
            @click="handleSaveCleanupDays"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <div class="border-t border-border" />

        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button
              variant="destructive"
              :disabled="isDeletingRecordings"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              {{ $t("settings.recording.deleteAll") }}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ $t("settings.recording.deleteConfirmTitle") }}</AlertDialogTitle>
              <AlertDialogDescription>
                {{ $t("settings.recording.deleteConfirmDescription") }}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter class="sm:justify-start">
              <AlertDialogAction variant="destructive" @click="handleDeleteAllRecordings">
                {{ $t("common.delete") }}
              </AlertDialogAction>
              <AlertDialogCancel>{{ $t("common.cancel") }}</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <transition name="feedback-fade">
          <p
            v-if="recordingCleanupFeedback.message.value !== ''"
            class="text-sm"
            :class="
              recordingCleanupFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ recordingCleanupFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 应用程式 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.app.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 介面语言 -->
        <div class="flex items-center justify-between">
          <Label for="locale-select">{{ $t("settings.app.language") }}</Label>
          <Select
            :model-value="settingsStore.selectedLocale"
            @update:model-value="handleLocaleChange($event as SupportedLocale)"
          >
            <SelectTrigger id="locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="localeFeedback.message.value !== ''"
            class="text-sm"
            :class="
              localeFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ localeFeedback.message.value }}
          </p>
        </transition>

        <!-- 转录语言 -->
        <div class="flex items-center justify-between">
          <div>
            <Label for="transcription-locale-select">{{ $t("settings.app.transcriptionLanguage") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.transcriptionLanguageDescription") }}</p>
          </div>
          <Select
            :model-value="settingsStore.selectedTranscriptionLocale"
            @update:model-value="handleTranscriptionLocaleChange($event as TranscriptionLocale)"
          >
            <SelectTrigger id="transcription-locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in TRANSCRIPTION_LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.locale === 'auto' ? $t('settings.app.autoDetect') : opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="transcriptionLocaleFeedback.message.value !== ''"
            class="text-sm"
            :class="
              transcriptionLocaleFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ transcriptionLocaleFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="mute-on-recording">{{ $t("settings.app.muteOnRecording") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.muteDescription") }}</p>
          </div>
          <Switch
            id="mute-on-recording"
            :model-value="settingsStore.isMuteOnRecordingEnabled"
            @update:model-value="handleToggleMuteOnRecording"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="muteOnRecordingFeedback.message.value !== ''"
            class="text-sm"
            :class="
              muteOnRecordingFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ muteOnRecordingFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div class="pr-4">
            <Label for="copy-transcription-to-clipboard">{{
              $t("settings.app.copyTranscriptionToClipboard.label")
            }}</Label>
            <p class="text-sm text-muted-foreground">
              {{
                settingsStore.isCopyTranscriptionToClipboardEnabled
                  ? $t(
                    "settings.app.copyTranscriptionToClipboard.descriptionOn",
                  )
                  : $t(
                    "settings.app.copyTranscriptionToClipboard.descriptionOff",
                  )
              }}
            </p>
          </div>
          <Switch
            id="copy-transcription-to-clipboard"
            :model-value="settingsStore.isCopyTranscriptionToClipboardEnabled"
            @update:model-value="handleToggleCopyTranscriptionToClipboard"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="copyTranscriptionToClipboardFeedback.message.value !== ''"
            class="text-sm"
            :class="
              copyTranscriptionToClipboardFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ copyTranscriptionToClipboardFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="sound-feedback">{{ $t("settings.app.soundFeedback") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.soundFeedbackDescription") }}</p>
          </div>
          <Switch
            id="sound-feedback"
            :model-value="settingsStore.isSoundEffectsEnabled"
            @update:model-value="handleToggleSoundFeedback"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="soundFeedbackFeedback.message.value !== ''"
            class="text-sm"
            :class="
              soundFeedbackFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ soundFeedbackFeedback.message.value }}
          </p>
        </transition>

        <template v-if="isMac">
          <div class="border-t border-border" />

          <div class="flex items-center justify-between">
            <div>
              <Label for="hide-dock-icon">{{ $t("settings.app.hideDockIcon") }}</Label>
              <p class="text-sm text-muted-foreground">{{ $t("settings.app.hideDockIconDescription") }}</p>
            </div>
            <Switch
              id="hide-dock-icon"
              :model-value="settingsStore.isHideDockIconEnabled"
              :disabled="isHideDockIconPending"
              @update:model-value="handleToggleHideDockIcon"
            />
          </div>

          <transition name="feedback-fade">
            <p
              v-if="hideDockIconFeedback.message.value !== ''"
              class="text-sm"
              :class="
                hideDockIconFeedback.type.value === 'success'
                  ? 'text-green-400'
                  : 'text-red-400'
              "
            >
              {{ hideDockIconFeedback.message.value }}
            </p>
          </transition>
        </template>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="auto-start">{{ $t("settings.app.autoStart") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.autoStartDescription") }}</p>
          </div>
          <Switch
            id="auto-start"
            :model-value="settingsStore.isAutoStartEnabled"
            :disabled="isTogglingAutoStart"
            @update:model-value="handleToggleAutoStart"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="autoStartFeedback.message.value !== ''"
            class="text-sm"
            :class="
              autoStartFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ autoStartFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
