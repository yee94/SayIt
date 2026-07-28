import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { enhanceText, buildSystemPrompt } from "../lib/enhancer";
import { getEditModePromptForLocale } from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import { analyzeCorrections } from "../lib/vocabularyAnalyzer";
import i18n from "../i18n";
import { useVocabularyStore } from "./useVocabularyStore";
import { useHistoryStore } from "./useHistoryStore";
import type {
  TranscriptionRecord,
  ChatUsageData,
  ApiUsageRecord,
} from "../types/transcription";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../lib/apiPricing";
import type { StopRecordingResult, TranscriptionResult } from "../types/audio";
import {
  HOTKEY_ERROR,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  HOTKEY_MODE_TOGGLE,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
  CORRECTION_MONITOR_RESULT,
  VOCABULARY_LEARNED,
  ESCAPE_PRESSED,
  TRANSCRIPTION_PARTIAL,
  emitEvent,
  listenToEvent,
} from "../composables/useTauriEvents";
import {
  HOTKEY_ERROR_CODES,
  type HotkeyErrorPayload,
  type HotkeyEventPayload,
  type QualityMonitorResultPayload,
  type CorrectionMonitorResultPayload,
  type VocabularyLearnedPayload,
  type TranscriptionPartialPayload,
} from "../types/events";
import {
  detectHallucination,
  detectEnhancementAnomaly,
  detectSemanticDrift,
} from "../lib/hallucinationDetector";
import type { HudStatus, HudTargetPosition } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const MAX_ENHANCEMENT_RETRY_COUNT = 3;
const ERROR_WITH_RETRY_DISPLAY_DURATION_MS = 6000;
const START_SOUND_DURATION_MS = 400;
const CANCELLED_DISPLAY_DURATION_MS = 1000;
const EDIT_MODE_MAX_TOKENS = 4096;

/**
 * 判断转录结果是否为空（无内容可粘贴）。
 *
 * 设计决策：只拦截「完全没有文字」的情况。
 * Whisper 幻听（如「谢谢大家」、重复片语）不拦截，直接粘贴让使用者自行判断。
 * 理由：拦截 + 显示「未检测到语音」会让使用者以为麦克风或系统有问题；
 * 直接粘贴则让使用者看到是模型的输出品质问题，可自行 Cmd+Z 重来。
 */
function isEmptyTranscription(rawText: string): boolean {
  return !rawText || !rawText.trim();
}
function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

const MONITOR_POLL_INTERVAL_MS = 250;

export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");
  /** ASR 串流中间文本（HUD 留海下方即时字幕） */
  const liveTranscript = ref("");
  const isRecording = ref<boolean>(false);
  let pendingRecordingStart: Promise<void> | null = null;
  let isRecorderStopPending = false;
  let isStopRequested = false;
  const recordingElapsedSeconds = ref<number>(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
  const unlistenFunctions: UnlistenFn[] = [];
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let collapseHideTimer: ReturnType<typeof setTimeout> | null = null;
  const COLLAPSE_HIDE_DELAY_MS = 400;
  const lastWasModified = ref<boolean | null>(null);
  let monitorPollTimer: ReturnType<typeof setInterval> | null = null;
  let delayedMuteTimer: ReturnType<typeof setTimeout> | null = null;
  let learnedHideTimer: ReturnType<typeof setTimeout> | null = null;
  const LEARNED_NOTIFICATION_TOTAL_DURATION_MS = 2800; // 2000 display + 400 collapse + 400 buffer
  const lastFailedTranscriptionId = ref<string | null>(null);
  const lastFailedAudioFilePath = ref<string | null>(null);
  const lastFailedRecordingDurationMs = ref<number>(0);
  const lastFailedPeakEnergyLevel = ref<number>(0);
  const lastFailedRmsEnergyLevel = ref<number>(0);
  const isAborted = ref<boolean>(false);
  let abortController: AbortController | null = null;
  const editSourceText = ref<string | null>(null);
  const isEditMode = computed<boolean>(() => editSourceText.value !== null);
  // AX 不可见 App（read_selection_state 回 unavailable）的剪贴簿后备旗标：
  // 录音停止、按键放开后才执行 read_selected_text
  let pendingClipboardSelectionCheck = false;
  let pendingSelectionCapture: Promise<void> | null = null;
  // 录音世代编号：AX 判定（最长 600ms）与剪贴簿后备（250ms 计时器）都是
  // 非同步回呼，可能在「下一轮录音已开始」后才落地——写入前必须比对世代，
  // 过期回呼直接失效（含 ESC 取消 / 双击切换后立刻重录的情境）
  let recordingEpoch = 0;
  // 本世代的 AX 判定是否已有结论：停止录音时若 AX 还没回覆，
  // 保守走剪贴簿后备（等同旧行为），避免慢速 AX 让编辑模式静默消失
  let selectionProbeSettledEpoch = -1;
  // 等按键完全放开的缓冲：toggle 模式的「停止」由第二次按下触发，
  // 该瞬间按键仍压着，立刻模拟 Cmd+C 会重演 #25 的字元污染
  const CLIPBOARD_FALLBACK_KEY_RELEASE_DELAY_MS = 250;
  const isRetryAttempt = ref<boolean>(false);
  const canRetry = computed<boolean>(
    () =>
      status.value === "error" &&
      lastFailedAudioFilePath.value !== null &&
      !isRetryAttempt.value,
  );

  // Double-tap mode toggle state
  let recordingStartTimestamp = 0;
  let doubleTapResolve: ((isDoubleTap: boolean) => void) | null = null;
  let doubleTapDelayTimer: ReturnType<typeof setTimeout> | null = null;
  const modeSwitchLabel = ref<string>("");
  let modeSwitchLabelTimer: ReturnType<typeof setTimeout> | null = null;
  const MODE_SWITCH_LABEL_DURATION_MS = 3000;

  let lastMonitorKey = "";
  let isRepositioning = false;
  let hudPresentationEpoch = 0;

  function getAppWindow() {
    if (!cachedAppWindow) cachedAppWindow = getCurrentWindow();
    return cachedAppWindow;
  }

  function writeInfoLog(logMessage: string) {
    void invoke("debug_log", { level: "info", message: logMessage });
  }

  function writeErrorLog(logMessage: string) {
    void invoke("debug_log", { level: "error", message: logMessage });
  }

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function clearCollapseHideTimer() {
    if (collapseHideTimer) {
      clearTimeout(collapseHideTimer);
      collapseHideTimer = null;
    }
  }

  function startElapsedTimer() {
    recordingElapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => {
      recordingElapsedSeconds.value += 1;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    recordingElapsedSeconds.value = 0;
  }

  function emitVoiceFlowStateChanged(
    nextStatus: HudStatus,
    nextMessage = "",
  ): void {
    const payload: VoiceFlowStateChangedPayload = {
      status: nextStatus,
      message: nextMessage,
    };
    void emitEvent(VOICE_FLOW_STATE_CHANGED, payload);
  }

  async function repositionHudToCurrentMonitor(
    presentationEpoch = hudPresentationEpoch,
  ) {
    if (isRepositioning) return;
    isRepositioning = true;
    try {
      const position = await invoke<HudTargetPosition>(
        "get_hud_target_position",
      );
      if (presentationEpoch !== hudPresentationEpoch) return;
      if (position.monitorKey !== lastMonitorKey) {
        lastMonitorKey = position.monitorKey;
        await getAppWindow().setPosition(
          new LogicalPosition(position.x, position.y),
        );
      }
    } catch {
      // 萤幕监控重定位失败为低优先级，不 log 避免洗版
    } finally {
      isRepositioning = false;
    }
  }

  function startMonitorPolling() {
    if (monitorPollTimer) {
      clearInterval(monitorPollTimer);
    }
    monitorPollTimer = setInterval(() => {
      void repositionHudToCurrentMonitor();
    }, MONITOR_POLL_INTERVAL_MS);
  }

  function stopMonitorPolling() {
    if (monitorPollTimer) {
      clearInterval(monitorPollTimer);
      monitorPollTimer = null;
    }
    lastMonitorKey = "";
    isRepositioning = false;
  }

  async function showHud(shouldIgnoreCursorEvents = true) {
    clearLearnedHideTimer();
    const window = getAppWindow();
    const presentationEpoch = ++hudPresentationEpoch;
    lastMonitorKey = "";
    await window.show();
    if (presentationEpoch !== hudPresentationEpoch) return;
    if (shouldIgnoreCursorEvents) {
      void window.setIgnoreCursorEvents(true).catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: enable HUD cursor passthrough failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "enable-hud-cursor-passthrough",
        });
      });
    }
    void repositionHudToCurrentMonitor(presentationEpoch);
    startMonitorPolling();
  }

  async function hideHud() {
    await getAppWindow().hide();
  }

  function clearDelayedMuteTimer() {
    if (delayedMuteTimer) {
      clearTimeout(delayedMuteTimer);
      delayedMuteTimer = null;
    }
  }

  function clearLearnedHideTimer() {
    if (learnedHideTimer) {
      clearTimeout(learnedHideTimer);
      learnedHideTimer = null;
    }
  }

  async function muteSystemAudioIfEnabled() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isMuteOnRecordingEnabled) return;
    try {
      await invoke("mute_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "mute-audio" });
    }
  }

  async function restoreSystemAudio() {
    try {
      await invoke("restore_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "restore-audio" });
    }
  }

  function startQualityMonitorAfterPaste() {
    void invoke("start_quality_monitor").catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "quality-monitor" });
    });
  }

  async function saveTranscriptionRecord(
    record: TranscriptionRecord,
  ): Promise<void> {
    const historyStore = useHistoryStore();
    try {
      await historyStore.addTranscription(record);
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "save-transcription" });
    }
  }

  function buildTranscriptionRecord(params: {
    id: string;
    rawText: string;
    processedText: string | null;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
    audioFilePath: string | null;
    status: "success" | "failed";
    isEditMode?: boolean;
    editSourceText?: string | null;
  }): TranscriptionRecord {
    const settingsStore = useSettingsStore();
    return {
      id: params.id,
      timestamp: Date.now(),
      rawText: params.rawText,
      processedText: params.processedText,
      recordingDurationMs: Math.round(params.recordingDurationMs),
      transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
      enhancementDurationMs:
        params.enhancementDurationMs !== null
          ? Math.round(params.enhancementDurationMs)
          : null,
      charCount: params.rawText.length,
      triggerMode: settingsStore.triggerMode,
      wasEnhanced: params.wasEnhanced,
      wasModified: null,
      createdAt: "",
      audioFilePath: params.audioFilePath,
      status: params.status,
      isEditMode: params.isEditMode ?? false,
      editSourceText: params.editSourceText ?? null,
    };
  }

  function clearLiveTranscript() {
    liveTranscript.value = "";
  }

  function setLiveTranscript(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // 录音 / 转写 / 重送期间才更新，避免过期 partial 污染其他状态
    if (
      status.value !== "recording" &&
      status.value !== "transcribing" &&
      status.value !== "enhancing" &&
      status.value !== "editing"
    ) {
      return;
    }
    liveTranscript.value = trimmed;
  }

  function transitionTo(nextStatus: HudStatus, nextMessage = "") {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    status.value = nextStatus;
    message.value = nextMessage;
    // 结束流程时清空字幕；录音 / 转写 / 润饰 / 编辑期间保留（录音中边说边出）
    if (
      nextStatus === "idle" ||
      nextStatus === "error" ||
      nextStatus === "cancelled" ||
      nextStatus === "success"
    ) {
      clearLiveTranscript();
    }
    emitVoiceFlowStateChanged(nextStatus, nextMessage);

    if (nextStatus === "idle") {
      hudPresentationEpoch += 1;
      stopMonitorPolling();
      collapseHideTimer = setTimeout(() => {
        hideHud().catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, { source: "voice-flow", step: "hideHud" });
        });
      }, COLLAPSE_HIDE_DELAY_MS);
      return;
    }

    if (
      nextStatus === "recording" ||
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      return;
    }

    if (nextStatus === "success") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, SUCCESS_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "cancelled") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, CANCELLED_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "error") {
      showHud(false)
        .then(async () => {
          await getAppWindow().setIgnoreCursorEvents(false);
        })
        .catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, {
            source: "voice-flow",
            step: "showHud-enableCursor",
          });
        });
      const errorDuration = canRetry.value
        ? ERROR_WITH_RETRY_DISPLAY_DURATION_MS
        : ERROR_DISPLAY_DURATION_MS;
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, errorDuration);
    }
  }

  function failRecordingFlow(
    errorMessage: string,
    logMessage: string,
    error?: unknown,
  ) {
    clearDelayedMuteTimer();
    isStopRequested = true;
    restoreSystemAudio();
    isRecording.value = false;
    transitionTo("error", errorMessage);
    playSoundIfEnabled("play_error_sound");
    writeErrorLog(logMessage);
    if (error) {
      captureError(error, { userMessage: errorMessage, source: "voice-flow" });
    }
  }

  function playSoundIfEnabled(command: string) {
    if (useSettingsStore().isSoundEffectsEnabled) {
      void invoke(command).catch(() => {});
    }
  }

  function stopRecorderAfterStart(
    recordingStartPromise: Promise<void> | null,
  ) {
    if (isRecorderStopPending) return;
    isRecorderStopPending = true;
    void (async () => {
      try {
        await recordingStartPromise;
        await invoke("stop_recording");
      } catch {
        // 录音启动失败时，启动流程会负责呈现错误状态。
      } finally {
        isRecorderStopPending = false;
      }
    })();
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function updateVocabularyWeightsAfterPaste(finalText: string) {
    void (async () => {
      try {
        const vocabularyStore = useVocabularyStore();
        const matchedIdList: string[] = [];

        for (const entry of vocabularyStore.termList) {
          const isEnglish = /^[a-zA-Z]/.test(entry.term);
          if (isEnglish) {
            const regex = new RegExp(
              "\\b" + escapeRegex(entry.term) + "\\b",
              "i",
            );
            if (regex.test(finalText)) {
              matchedIdList.push(entry.id);
            }
          } else {
            if (finalText.includes(entry.term)) {
              matchedIdList.push(entry.id);
            }
          }
        }

        if (matchedIdList.length > 0) {
          await vocabularyStore.batchIncrementWeights(matchedIdList);
          writeInfoLog(
            `useVoiceFlowStore: vocabulary weights updated for ${matchedIdList.length} terms`,
          );
        }
      } catch (err) {
        writeErrorLog(
          `useVoiceFlowStore: vocabulary weight update failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "vocabulary-weight-update",
        });
      }
    })();
  }

  const SNAPSHOT_POLL_INTERVAL_MS = 500;
  let correctionSnapshotTimer: ReturnType<typeof setInterval> | null = null;
  let correctionMonitorUnlisten: UnlistenFn | null = null;

  function stopCorrectionSnapshotPolling() {
    if (correctionSnapshotTimer) {
      clearInterval(correctionSnapshotTimer);
      correctionSnapshotTimer = null;
    }
  }

  function cleanupCorrectionMonitorListener() {
    if (correctionMonitorUnlisten) {
      correctionMonitorUnlisten();
      correctionMonitorUnlisten = null;
    }
  }

  function startCorrectionDetectionFlow(
    pastedText: string,
    transcriptionId: string,
    apiKey: string,
  ) {
    void (async () => {
      try {
        const settingsStore = useSettingsStore();
        if (!settingsStore.isSmartDictionaryEnabled) return;

        // 清除前一次的 listener，避免重复累积
        cleanupCorrectionMonitorListener();

        // 启动修正监控
        await invoke("start_correction_monitor");

        // Phase 2 snapshot polling
        let latestSnapshot: string | null = null;
        stopCorrectionSnapshotPolling();

        correctionSnapshotTimer = setInterval(() => {
          void (async () => {
            try {
              const text = await invoke<string | null>(
                "read_focused_text_field",
              );
              if (text) {
                latestSnapshot = text;
              }
            } catch {
              // AX 读取失败静默处理
            }
          })();
        }, SNAPSHOT_POLL_INTERVAL_MS);

        // 一次性监听 correction-monitor:result
        correctionMonitorUnlisten =
          await listenToEvent<CorrectionMonitorResultPayload>(
            CORRECTION_MONITOR_RESULT,
            (event) => {
              cleanupCorrectionMonitorListener();
              stopCorrectionSnapshotPolling();

              void (async () => {
                try {
                  const result = event.payload;

                  if (!result.anyKeyPressed) {
                    writeInfoLog(
                      "[correction] no key pressed — skipping analysis",
                    );
                    return;
                  }

                  writeInfoLog(
                    `[correction] keys detected (enter=${result.enterPressed}) — reading field text`,
                  );

                  let fieldText: string | null = null;

                  if (result.enterPressed) {
                    // Enter 触发：先尝试即时读取（IME 确认后文字可能已更新）
                    // 读不到（如 LINE 按 Enter 送出后已清空）才 fallback 到 snapshot
                    try {
                      const freshText = await invoke<string | null>(
                        "read_focused_text_field",
                      );
                      if (freshText && freshText.trim()) {
                        fieldText = freshText;
                      } else {
                        fieldText = latestSnapshot;
                      }
                    } catch {
                      fieldText = latestSnapshot;
                    }
                  } else {
                    // Idle timeout 或硬上限：做最后一次读取
                    try {
                      fieldText = await invoke<string | null>(
                        "read_focused_text_field",
                      );
                    } catch {
                      // fallback to snapshot
                      fieldText = latestSnapshot;
                    }
                  }

                  if (!fieldText || !fieldText.trim()) {
                    writeInfoLog(
                      "[correction] field text is null or empty — skipping analysis",
                    );
                    return;
                  }
                  // fieldText 为游标附近的「excerpt」（非整栏文字），故需双向比对：
                  // 整栏仍含 pasted（短输入）→ includes；或 excerpt 是 pasted 的子字串（长输入未改）→ 反向 includes。
                  const trimmedField = fieldText.trim();
                  if (
                    fieldText.includes(pastedText) ||
                    pastedText.includes(trimmedField)
                  ) {
                    writeInfoLog(
                      "[correction] text unchanged — skipping analysis",
                    );
                    return;
                  }

                  // 相似度检查：以 excerpt 为基准（excerpt 多数字元应来自 pasted 区域）。
                  // 若 excerpt 与 pasted 几乎无关（AX/UIA 读到错的栏位），跳过。
                  const overlapCharCount = [...trimmedField].filter((ch) =>
                    pastedText.includes(ch),
                  ).length;
                  const overlapRatio =
                    trimmedField.length > 0
                      ? overlapCharCount / trimmedField.length
                      : 0;
                  if (overlapRatio < 0.3) {
                    writeInfoLog(
                      `[correction] field text unrelated to original (overlap=${Math.round(overlapRatio * 100)}%) — skipping analysis`,
                    );
                    return;
                  }

                  writeInfoLog(
                    `[correction] text modified (overlap=${Math.round(overlapRatio * 100)}%) — sending to AI analysis\n  original:  ${pastedText.slice(0, 80)}\n  corrected: ${fieldText.slice(0, 80)}`,
                  );

                  const analysisResult = await analyzeCorrections(
                    pastedText,
                    fieldText,
                    apiKey,
                    {
                      modelId: settingsStore.selectedLlmModelId,
                      baseUrl: settingsStore.getLlmBaseUrl(),
                    },
                  );

                  writeInfoLog(
                    `[correction] AI raw: ${analysisResult.rawResponse}`,
                  );
                  writeInfoLog(
                    `[correction] AI result: ${JSON.stringify(analysisResult.suggestedTermList)} (tokens: ${analysisResult.usage?.totalTokens ?? "??"})`,
                  );

                  if (analysisResult.suggestedTermList.length === 0) return;

                  const vocabularyStore = useVocabularyStore();
                  const newTermList: string[] = [];

                  for (const term of analysisResult.suggestedTermList) {
                    if (vocabularyStore.isDuplicateTerm(term)) {
                      // 已存在的词 weight +1
                      const existingEntry = vocabularyStore.termList.find(
                        (e) =>
                          e.term.trim().toLowerCase() ===
                          term.trim().toLowerCase(),
                      );
                      if (existingEntry) {
                        void vocabularyStore
                          .batchIncrementWeights([existingEntry.id])
                          .catch((err) =>
                            writeErrorLog(
                              `useVoiceFlowStore: batchIncrementWeights failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                      }
                    } else {
                      await vocabularyStore.addAiSuggestedTerm(term);
                      newTermList.push(term);
                    }
                  }

                  // 记录 API 用量
                  if (analysisResult.usage) {
                    const historyStore = useHistoryStore();
                    void historyStore
                      .addApiUsage({
                        id: crypto.randomUUID(),
                        transcriptionId,
                        apiType: "vocabulary_analysis",
                        model: settingsStore.selectedLlmModelId,
                        promptTokens: analysisResult.usage.promptTokens,
                        completionTokens: analysisResult.usage.completionTokens,
                        totalTokens: analysisResult.usage.totalTokens,
                        promptTimeMs: analysisResult.usage.promptTimeMs ?? null,
                        completionTimeMs: analysisResult.usage.completionTimeMs ?? null,
                        totalTimeMs: analysisResult.usage.totalTimeMs ?? null,
                        audioDurationMs: null,
                        estimatedCostCeiling: calculateChatCostCeiling(
                          analysisResult.usage.totalTokens,
                          settingsStore.selectedLlmModelId,
                        ),
                      })
                      .catch((err) =>
                        writeErrorLog(
                          `useVoiceFlowStore: addApiUsage(vocabulary_analysis) failed: ${extractErrorMessage(err)}`,
                        ),
                      );
                  }

                  // 通知 HUD 新学习的词（只包含新增的，不包含已存在的）
                  if (newTermList.length > 0) {
                    writeInfoLog(
                      `useVoiceFlowStore: emitting VOCABULARY_LEARNED: ${newTermList.join(", ")}`,
                    );
                    try {
                      await emitEvent(VOCABULARY_LEARNED, {
                        termList: newTermList,
                      } satisfies VocabularyLearnedPayload);
                      writeInfoLog(
                        "useVoiceFlowStore: VOCABULARY_LEARNED emitted successfully",
                      );

                      // HUD 视窗在 idle 后已被 hideHud() 隐藏，需重新显示才看得到通知
                      clearLearnedHideTimer();
                      const appWindow = getAppWindow();
                      await appWindow.show();
                      await appWindow.setIgnoreCursorEvents(true);
                      learnedHideTimer = setTimeout(() => {
                        learnedHideTimer = null;
                        if (status.value === "idle") {
                          hideHud().catch((err) =>
                            writeErrorLog(
                              `useVoiceFlowStore: learned hideHud failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                        }
                      }, LEARNED_NOTIFICATION_TOTAL_DURATION_MS);
                    } catch (emitErr) {
                      writeErrorLog(
                        `useVoiceFlowStore: VOCABULARY_LEARNED emit failed: ${extractErrorMessage(emitErr)}`,
                      );
                    }
                  }
                } catch (err) {
                  writeErrorLog(
                    `useVoiceFlowStore: correction analysis failed: ${extractErrorMessage(err)}`,
                  );
                  captureError(err, {
                    source: "voice-flow",
                    step: "correction-analysis",
                  });
                }
              })();
            },
          );
      } catch (err) {
        stopCorrectionSnapshotPolling();
        cleanupCorrectionMonitorListener();
        writeErrorLog(
          `useVoiceFlowStore: correction detection failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "correction-detection",
        });
      }
    })();
  }

  async function completePasteFlow(params: {
    text: string;
    successMessage: string;
    record: TranscriptionRecord;
    chatUsage: ChatUsageData | null;
    skipRecordSaving?: boolean;
  }) {
    try {
      const settingsStore = useSettingsStore();
      await invoke("paste_text", {
        text: params.text,
        restoreClipboard: !settingsStore.isCopyTranscriptionToClipboardEnabled,
      });
      isRecording.value = false;
      transitionTo("success", params.successMessage);
      startQualityMonitorAfterPaste();
      // api_usage FK 依赖 transcriptions — 必须等 transcription 写入后才存 usage
      // retry 路径使用 updateTranscriptionOnRetrySuccess，不走 INSERT
      if (!params.skipRecordSaving) {
        void saveTranscriptionRecord(params.record).then(() => {
          saveApiUsageRecordList(params.record, params.chatUsage);
        });
      }

      // 权重更新（fire-and-forget）
      const finalText = params.record.processedText ?? params.record.rawText;
      updateVocabularyWeightsAfterPaste(finalText);

      // 修正侦测（fire-and-forget，需 LLM API key）
      const llmApiKey = settingsStore.getLlmApiKey();
      if (llmApiKey) {
        startCorrectionDetectionFlow(params.text, params.record.id, llmApiKey);
      }
    } catch (pasteError) {
      isRecording.value = false;
      failRecordingFlow(
        t("voiceFlow.pasteFailed"),
        `useVoiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
        pasteError,
      );
    }
  }

  function saveApiUsageRecordList(
    record: TranscriptionRecord,
    chatUsage: ChatUsageData | null,
  ) {
    const historyStore = useHistoryStore();
    const settingsStore = useSettingsStore();
    const roundedAudioMs = record.recordingDurationMs;

    function fireAndForget(usageRecord: ApiUsageRecord) {
      historyStore
        .addApiUsage(usageRecord)
        .catch((err) =>
          writeErrorLog(
            `useVoiceFlowStore: addApiUsage(${usageRecord.apiType}) failed: ${extractErrorMessage(err)}`,
          ),
        );
    }

    fireAndForget({
      id: crypto.randomUUID(),
      transcriptionId: record.id,
      apiType: "whisper",
      model: "doubao-seedasr",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(
        roundedAudioMs,
        settingsStore.selectedWhisperModelId,
      ),
    });

    if (chatUsage) {
      fireAndForget({
        id: crypto.randomUUID(),
        transcriptionId: record.id,
        apiType: "chat",
        model: settingsStore.selectedLlmModelId,
        promptTokens: chatUsage.promptTokens,
        completionTokens: chatUsage.completionTokens,
        totalTokens: chatUsage.totalTokens,
        promptTimeMs: chatUsage.promptTimeMs ?? null,
        completionTimeMs: chatUsage.completionTimeMs ?? null,
        totalTimeMs: chatUsage.totalTimeMs ?? null,
        audioDurationMs: null,
        estimatedCostCeiling: calculateChatCostCeiling(
          chatUsage.totalTokens,
          settingsStore.selectedLlmModelId,
        ),
      });
    }
  }

  function clearDoubleTapTimer() {
    if (doubleTapDelayTimer) {
      clearTimeout(doubleTapDelayTimer);
      doubleTapDelayTimer = null;
    }
  }

  function clearModeSwitchLabelTimer() {
    if (modeSwitchLabelTimer) {
      clearTimeout(modeSwitchLabelTimer);
      modeSwitchLabelTimer = null;
    }
  }

  /**
   * Wait for double-tap resolution: returns true if mode-toggle event arrives
   * within 400ms, false if timer expires (not a double-tap).
   */
  function waitForDoubleTapResolution(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      doubleTapResolve = resolve;
      clearDoubleTapTimer();
      doubleTapDelayTimer = setTimeout(() => {
        doubleTapDelayTimer = null;
        doubleTapResolve = null;
        resolve(false);
      }, 400);
    });
  }

  function handleDoubleTapModeToggle() {
    if (doubleTapResolve) {
      // Hold mode double-tap: resolve the waiting promise
      clearDoubleTapTimer();
      const resolve = doubleTapResolve;
      doubleTapResolve = null;
      resolve(true);
    } else {
      // Toggle mode long-press: directly apply mode switch
      applyDoubleTapModeSwitch();
    }
  }

  function applyDoubleTapModeSwitch() {
    if (isRecording.value) {
      isStopRequested = true;
      clearDelayedMuteTimer();
      stopElapsedTimer();
      void restoreSystemAudio();
      void invoke("cancel_live_asr").catch(() => {});
      stopRecorderAfterStart(pendingRecordingStart);
    }
    isRecording.value = false;
    // 世代 +1：这轮录音被双击静默取消，途中的选取侦测回呼全部失效
    recordingEpoch += 1;
    pendingClipboardSelectionCheck = false;
    pendingSelectionCapture = null;

    // Toggle prompt mode: minimal ↔ active
    const settingsStore = useSettingsStore();
    const currentMode = settingsStore.promptMode;
    const nextMode = currentMode === "minimal" ? "active" : "minimal";
    settingsStore.promptMode = nextMode;
    void settingsStore.savePromptMode(nextMode).catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: savePromptMode failed: ${extractErrorMessage(err)}`,
      );
    });

    // Flash mode label on HUD — follow the same pattern as transitionTo("success"):
    // show for N seconds, then transitionTo("idle") which triggers collapse animation.
    const modeLabel =
      nextMode === "minimal"
        ? t("settings.prompt.modeMinimal")
        : t("settings.prompt.modeActive");
    modeSwitchLabel.value = modeLabel;
    clearModeSwitchLabelTimer();

    // Show HUD with mode-switch visual
    showHud().catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
      );
    });

    // After display duration, clear label and transition to idle (triggers collapse + hide)
    modeSwitchLabelTimer = setTimeout(() => {
      modeSwitchLabel.value = "";
      modeSwitchLabelTimer = null;
      transitionTo("idle");
    }, MODE_SWITCH_LABEL_DURATION_MS);

    writeInfoLog(
      `useVoiceFlowStore: double-tap mode toggle → ${nextMode}`,
    );
  }

  function handleEscapeAbort() {
    const currentStatus = status.value;
    if (
      currentStatus === "idle" ||
      currentStatus === "success" ||
      currentStatus === "error" ||
      currentStatus === "cancelled"
    )
      return;

    writeInfoLog(`useVoiceFlowStore: ESC abort from ${currentStatus}`);
    isAborted.value = true;
    isStopRequested = true;
    abortController?.abort();
    editSourceText.value = null;

    // 无条件重置 isRecording，避免永久锁死
    isRecording.value = false;

    const recordingStartPromise = pendingRecordingStart;
    pendingRecordingStart = null;

    if (currentStatus === "recording") {
      void invoke("cancel_live_asr").catch(() => {});
      stopRecorderAfterStart(recordingStartPromise);
      stopElapsedTimer();
    } else {
      // 转写中途 ESC：也关掉 live session
      void invoke("cancel_live_asr").catch(() => {});
    }

    // Resolve pending double-tap Promise (prevents handleStopRecording from hanging)
    if (doubleTapResolve) {
      clearDoubleTapTimer();
      const resolve = doubleTapResolve;
      doubleTapResolve = null;
      resolve(false);
    }
    clearModeSwitchLabelTimer();
    modeSwitchLabel.value = "";

    // 完整清理所有进行中的资源
    clearDelayedMuteTimer();
    stopMonitorPolling();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();
    void restoreSystemAudio();
    // 世代 +1：让仍在途的 AX 判定 / 剪贴簿后备回呼全部过期失效
    recordingEpoch += 1;
    pendingClipboardSelectionCheck = false;
    pendingSelectionCapture = null;

    // 重置 toggle 模式状态
    void invoke("reset_hotkey_state").catch(() => {});

    transitionTo("cancelled", t("voiceFlow.cancelled"));
  }

  async function handleStartRecording() {
    if (isRecording.value || isRecorderStopPending) return;
    isRecording.value = true;
    isStopRequested = false;
    clearModeSwitchLabelTimer();
    modeSwitchLabel.value = "";
    recordingStartTimestamp = performance.now();
    isAborted.value = false;
    abortController = new AbortController();
    lastWasModified.value = null;
    clearLiveTranscript();

    // 重置重送状态（新录音开始时清除上次失败的重送资讯）
    lastFailedTranscriptionId.value = null;
    lastFailedAudioFilePath.value = null;
    lastFailedRecordingDurationMs.value = 0;
    lastFailedPeakEnergyLevel.value = 0;
    lastFailedRmsEnergyLevel.value = 0;
    isRetryAttempt.value = false;

    // 捕获当前前景视窗（Windows: HUD show 前记住目标，贴上前恢复焦点）
    void invoke("capture_target_window").catch(() => {});

    transitionTo("recording", t("voiceFlow.recording"));
    playSoundIfEnabled("play_start_sound");
    delayedMuteTimer = setTimeout(() => {
      delayedMuteTimer = null;
      void muteSystemAudioIfEnabled();
    }, START_SOUND_DURATION_MS);

    // 侦测选取文字（非阻塞）：AX 被动查询，零按键模拟（#24/#25）。
    // AX 不可见的 App 标记剪贴簿后备，延后到录音停止、按键放开后执行
    editSourceText.value = null;
    pendingClipboardSelectionCheck = false;
    pendingSelectionCapture = null;
    recordingEpoch += 1;
    const probeEpoch = recordingEpoch;
    const currentRecordingEpoch = recordingEpoch;
    invoke<{ kind: string; text: string | null }>("read_selection_state")
      .then((state) => {
        // 过期回呼（下一轮录音已开始）直接失效，防止跨录音状态污染
        if (probeEpoch !== recordingEpoch || !state) return;
        selectionProbeSettledEpoch = probeEpoch;
        if (state.kind === "selection" && state.text && state.text.trim().length > 0) {
          editSourceText.value = state.text;
          writeInfoLog(
            `useVoiceFlowStore: edit mode activated (ax), selectedText length=${state.text.length}`,
          );
        } else if (state.kind === "noSelection") {
          // AX 的明确否定是权威答案：若慢速后备已误写（整行复制），以此为准清掉
          editSourceText.value = null;
        } else if (state.kind === "unavailable") {
          pendingClipboardSelectionCheck = true;
        }
      })
      .catch(() => {});

    const recordingStartPromise = invoke<void>("start_recording", {
        deviceName: useSettingsStore().selectedAudioInputDeviceName,
      });
    pendingRecordingStart = recordingStartPromise;

    try {
      await recordingStartPromise;
      if (
        currentRecordingEpoch !== recordingEpoch ||
        isAborted.value ||
        !isRecording.value
      ) {
        return;
      }
      if (isStopRequested) return;
      startElapsedTimer();
      writeInfoLog("useVoiceFlowStore: recording started");

      // 边说边出：录音开始后立刻挂上 live ASR（失败不阻断录音）
      void startLiveAsrIfPossible();
    } catch (error) {
      const errorMessage = getMicrophoneErrorMessage(error);
      const technicalErrorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: start recording failed: ${technicalErrorMessage}`,
        error,
      );
    } finally {
      if (pendingRecordingStart === recordingStartPromise) {
        pendingRecordingStart = null;
      }
    }
  }

  /** 非阻塞启动 live ASR；缺凭证 / 挂载失败只 log，录音继续 */
  async function startLiveAsrIfPossible() {
    try {
      const settingsStore = useSettingsStore();
      let appId = settingsStore.getDoubaoAppId();
      let accessKey = settingsStore.getDoubaoAccessKey();
      if (!appId || !accessKey) {
        await settingsStore.refreshApiKey();
        appId = settingsStore.getDoubaoAppId();
        accessKey = settingsStore.getDoubaoAccessKey();
      }
      if (!appId || !accessKey) {
        writeInfoLog(
          "useVoiceFlowStore: skip live ASR (missing Doubao credentials)",
        );
        return;
      }
      if (isAborted.value || !isRecording.value || isStopRequested) return;

      const vocabularyStore = useVocabularyStore();
      const termList = await vocabularyStore.getTopTermListByWeight(50);
      if (isAborted.value || !isRecording.value || isStopRequested) return;
      await invoke("start_live_asr", {
        appId,
        accessKey,
        vocabularyTermList: termList.length > 0 ? termList : null,
        language: settingsStore.getWhisperLanguageCode(),
      });
      writeInfoLog("useVoiceFlowStore: live ASR started");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: start_live_asr failed (non-blocking): ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "start-live-asr" });
    }
  }

  async function handleStopRecording() {
    if (!isRecording.value) return;
    if (isAborted.value) return;
    isStopRequested = true;
    const recordingStartPromise = pendingRecordingStart;

    // Pre-estimate duration for double-tap detection (before any async work).
    // Use precise timestamp — recordingElapsedSeconds has 1s resolution, too coarse for 300ms threshold.
    // Rust double-tap max hold is 300ms; 350ms here adds 50ms buffer for IPC latency.
    const estimatedDurationMs = performance.now() - recordingStartTimestamp;
    if (estimatedDurationMs < 350) {
      const isDoubleTap = await waitForDoubleTapResolution();
      if (isAborted.value) return;
      if (isDoubleTap) {
        // Double-tap confirmed: silently cancel, apply mode switch
        stopElapsedTimer();
        clearDelayedMuteTimer();
        void restoreSystemAudio();
        void invoke("cancel_live_asr").catch(() => {});
        stopRecorderAfterStart(recordingStartPromise);
        applyDoubleTapModeSwitch();
        return;
      }
      // Not a double-tap — fall through to normal stop flow
    }

    clearDelayedMuteTimer();
    await restoreSystemAudio();
    playSoundIfEnabled("play_stop_sound");
    stopElapsedTimer();

    // AX 不可见 App 的剪贴簿后备：延迟等按键完全放开后才模拟 Cmd+C。
    // 包成 Promise：转录若比后备先完成，编辑模式判定前要能 await 它。
    // AX 到停止时还没回覆（慢速 App）也保守走后备——等同旧行为，
    // 避免编辑模式在这种时序下静默消失
    if (
      pendingClipboardSelectionCheck ||
      selectionProbeSettledEpoch !== recordingEpoch
    ) {
      pendingClipboardSelectionCheck = false;
      const fallbackEpoch = recordingEpoch;
      pendingSelectionCapture = new Promise<void>((resolve) => {
        setTimeout(() => {
          if (fallbackEpoch !== recordingEpoch) {
            resolve();
            return;
          }
          invoke<string | null>("read_selected_text")
            .then((selectedText) => {
              if (fallbackEpoch !== recordingEpoch) return;
              if (selectedText && selectedText.trim().length > 0 && !editSourceText.value) {
                editSourceText.value = selectedText;
                writeInfoLog(
                  `useVoiceFlowStore: edit mode activated (clipboard fallback), selectedText length=${selectedText.length}`,
                );
              }
            })
            .catch(() => {})
            .finally(resolve);
        }, CLIPBOARD_FALLBACK_KEY_RELEASE_DELAY_MS);
      });
    }

    // 生成 transcriptionId 贯穿整个流程
    const transcriptionId = crypto.randomUUID();
    // 提升到 try 外层，让 catch 也能存取（AC2: API 错误时仍写入 failed 记录）
    let audioFilePath: string | null = null;
    let recordingDurationMs = 0;
    let peakEnergyLevel = 0;
    let rmsEnergyLevel = 0;

    try {
      try {
        await recordingStartPromise;
      } catch {
        return;
      }
      if (isAborted.value || !isRecording.value) return;
      const stopResult = await invoke<StopRecordingResult>("stop_recording");
      if (isAborted.value) return;
      recordingDurationMs = stopResult.recordingDurationMs;
      peakEnergyLevel = stopResult.peakEnergyLevel;
      rmsEnergyLevel = stopResult.rmsEnergyLevel;

      // 录音档储存（不阻断主流程）
      try {
        audioFilePath = await invoke<string>("save_recording_file", {
          id: transcriptionId,
        });
        writeInfoLog(`useVoiceFlowStore: recording saved: ${audioFilePath}`);
      } catch (saveErr) {
        writeErrorLog(
          `useVoiceFlowStore: save_recording_file failed (non-blocking): ${extractErrorMessage(saveErr)}`,
        );
        captureError(saveErr, {
          source: "voice-flow",
          step: "save-recording-file",
        });
      }

      const MINIMUM_RECORDING_DURATION_MS = 300;
      if (recordingDurationMs < MINIMUM_RECORDING_DURATION_MS) {
        void invoke("cancel_live_asr").catch(() => {});
        // 录音太短 → 写入 failed 记录，保留录音档
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: 0,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        failRecordingFlow(
          t("voiceFlow.recordingTooShort"),
          `useVoiceFlowStore: recording too short (${Math.round(recordingDurationMs)}ms)`,
        );
        return;
      }

      transitionTo("transcribing", t("voiceFlow.transcribing"));
      const settingsStore = useSettingsStore();
      let appId = settingsStore.getDoubaoAppId();
      let accessKey = settingsStore.getDoubaoAccessKey();

      if (!appId || !accessKey) {
        await settingsStore.refreshApiKey();
        appId = settingsStore.getDoubaoAppId();
        accessKey = settingsStore.getDoubaoAccessKey();
      }

      if (!appId || !accessKey) {
        void invoke("cancel_live_asr").catch(() => {});
        failRecordingFlow(
          t("errors.apiKeyMissing"),
          "useVoiceFlowStore: missing Doubao ASR credentials while transcribing",
        );
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
      const hasVocabulary = whisperTermList.length > 0;

      // 优先收敛 live ASR（录音中已流式推送）；失败再 fallback 整段 WAV
      let result: TranscriptionResult;
      try {
        result = await invoke<TranscriptionResult>("finish_live_asr");
        writeInfoLog(
          `useVoiceFlowStore: finish_live_asr ok (len=${result.rawText?.length ?? 0})`,
        );
      } catch (liveErr) {
        writeInfoLog(
          `useVoiceFlowStore: finish_live_asr fallback to transcribe_audio: ${extractErrorMessage(liveErr)}`,
        );
        result = await invoke<TranscriptionResult>("transcribe_audio", {
          appId,
          accessKey,
          vocabularyTermList: hasVocabulary ? whisperTermList : null,
          language: settingsStore.getWhisperLanguageCode(),
        });
      }
      if (isAborted.value) return;

      // 最终结果写入字幕（partial 可能略短，再刷一次）
      setLiveTranscript(result.rawText);

      writeInfoLog(`转录原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        // 空转录 → 写入 failed 记录，保留录音档
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText || "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 设定重送状态（空转录：主要重送目标）
        if (audioFilePath) {
          lastFailedTranscriptionId.value = transcriptionId;
          lastFailedAudioFilePath.value = audioFilePath;
          lastFailedRecordingDurationMs.value = recordingDurationMs;
          lastFailedPeakEnergyLevel.value = peakEnergyLevel;
          lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
        }

        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: empty transcription (noSpeechProb=${result.noSpeechProbability.toFixed(3)})`,
        );
        return;
      }

      // ── 幻觉侦测（纯物理信号：语速异常 + 无人声）──
      writeInfoLog(
        `useVoiceFlowStore: hallucination detection input: peakEnergy=${peakEnergyLevel.toFixed(4)}, rmsEnergy=${rmsEnergyLevel.toFixed(4)}, nsp=${result.noSpeechProbability.toFixed(3)}, rawText="${result.rawText}", durationMs=${Math.round(recordingDurationMs)}`,
      );

      const hallucinationDetectionResult = detectHallucination({
        rawText: result.rawText,
        recordingDurationMs,
        peakEnergyLevel,
        rmsEnergyLevel,
        noSpeechProbability: result.noSpeechProbability,
      });

      writeInfoLog(
        `useVoiceFlowStore: hallucination detection result: isHallucination=${hallucinationDetectionResult.isHallucination}, reason=${hallucinationDetectionResult.reason}`,
      );

      if (hallucinationDetectionResult.isHallucination) {
        // 写入 failed 记录
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 设定重送状态
        if (audioFilePath) {
          lastFailedTranscriptionId.value = transcriptionId;
          lastFailedAudioFilePath.value = audioFilePath;
          lastFailedRecordingDurationMs.value = recordingDurationMs;
          lastFailedPeakEnergyLevel.value = peakEnergyLevel;
          lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
        }

        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: hallucination intercepted (reason=${hallucinationDetectionResult.reason})`,
        );
        return;
      }

      // 剪贴簿后备可能还在等按键放开（转录比后备快时）：判定模式前先等它完成
      if (pendingSelectionCapture) {
        await pendingSelectionCapture;
        pendingSelectionCapture = null;
      }

      // 编辑模式：语音是指令，选取文字是待处理内容
      if (isEditMode.value && editSourceText.value) {
        await handleEditModeFlow({
          voiceInstruction: result.rawText,
          selectedText: editSourceText.value,
          transcriptionId,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          audioFilePath,
        });
        return;
      }

      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          await settingsStore.refreshLlmApiKey();
          const llmApiKey = settingsStore.getLlmApiKey();
          if (!llmApiKey) {
            throw new Error(t("errors.apiKeyMissing"));
          }

          const enhancementTermList =
            await vocabularyStore.getTopTermListByWeight(50);
          const enhanceOptions = {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
            baseUrl: settingsStore.getLlmBaseUrl(),
            signal: abortController?.signal,
          };

          let enhanceResult = await enhanceText(
            result.rawText,
            llmApiKey,
            enhanceOptions,
          );
          if (isAborted.value) return;

          // 增强后长度爆炸侦测（含重试机制）
          let retryCount = 0;
          while (
            retryCount < MAX_ENHANCEMENT_RETRY_COUNT &&
            detectEnhancementAnomaly({
              rawText: result.rawText,
              enhancedText: enhanceResult.text,
            }).isAnomaly
          ) {
            retryCount++;
            writeInfoLog(
              `useVoiceFlowStore: enhancement anomaly detected (attempt ${retryCount}/${MAX_ENHANCEMENT_RETRY_COUNT}), retrying`,
            );
            enhanceResult = await enhanceText(
              result.rawText,
              llmApiKey,
              enhanceOptions,
            );
            if (isAborted.value) return;
          }

          // 重试后仍异常（长度爆炸）或语意飘走（#43）→ fallback 到 rawText
          const finalAnomaly = detectEnhancementAnomaly({
            rawText: result.rawText,
            enhancedText: enhanceResult.text,
          });
          const drift = detectSemanticDrift(
            result.rawText,
            enhanceResult.text,
          );
          const shouldFallbackToRaw = finalAnomaly.isAnomaly || drift.isDrift;
          if (shouldFallbackToRaw) {
            writeErrorLog(
              `useVoiceFlowStore: enhancement rejected (anomaly=${finalAnomaly.reason ?? "none"}, drift=${drift.isDrift}, overlap=${drift.overlapRatio.toFixed(2)}), falling back to raw text`,
            );
            enhanceResult = { ...enhanceResult, text: result.rawText };
          }

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: !shouldFallbackToRaw,
            audioFilePath,
            status: "success",
          });

          writeInfoLog(`AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
          });

          writeInfoLog(
            `useVoiceFlowStore: pasted enhanced text, recordingDurationMs=${Math.round(
              recordingDurationMs,
            )}, transcriptionDurationMs=${Math.round(
              result.transcriptionDurationMs,
            )}, enhancementDurationMs=${Math.round(enhancementDurationMs)}${retryCount > 0 ? `, enhancementRetryCount=${retryCount}` : ""}`,
          );
        } catch (enhanceError) {
          if (isAborted.value) return;
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          const enhanceErrorDetail = getEnhancementErrorMessage(enhanceError);
          writeErrorLog(
            `useVoiceFlowStore: AI enhancement failed: ${enhanceErrorDetail}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
            audioFilePath,
            status: "success",
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
          });
        }
      } else {
        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: null,
        });

        writeInfoLog(
          `useVoiceFlowStore: pasted text (skipped enhancement, length=${result.rawText.length}), recordingDurationMs=${Math.round(
            recordingDurationMs,
          )}, transcriptionDurationMs=${Math.round(result.transcriptionDurationMs)}`,
        );
      }
    } catch (error) {
      if (isAborted.value) return;
      // AC2: API 错误时仍写入 failed 记录（如果有 audioFilePath）
      if (audioFilePath) {
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: 0,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 设定重送状态（API 错误：暂时性问题，重送有意义）
        lastFailedTranscriptionId.value = transcriptionId;
        lastFailedAudioFilePath.value = audioFilePath;
        lastFailedRecordingDurationMs.value = recordingDurationMs;
        lastFailedPeakEnergyLevel.value = peakEnergyLevel;
        lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
      }

      const userMessage = getTranscriptionErrorMessage(error);
      const technicalMessage = extractErrorMessage(error);
      failRecordingFlow(
        userMessage,
        `useVoiceFlowStore: stop recording failed: ${technicalMessage}`,
        error,
      );
    }
  }

  async function handleEditModeFlow(params: {
    voiceInstruction: string;
    selectedText: string;
    transcriptionId: string;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    audioFilePath: string | null;
  }) {
    transitionTo("editing", t("voiceFlow.editing"));
    const editStartTime = performance.now();

    try {
      const settingsStore = useSettingsStore();
      await settingsStore.refreshLlmApiKey();
      const llmApiKey = settingsStore.getLlmApiKey();
      if (!llmApiKey) {
        throw new Error(t("errors.apiKeyMissing"));
      }

      const locale = i18n.global.locale.value as SupportedLocale;
      const basePrompt = getEditModePromptForLocale(locale);
      const systemPrompt = buildSystemPrompt(
        `${basePrompt}\n\n<instruction>\n${params.voiceInstruction}\n</instruction>`,
      );

      const editResult = await enhanceText(params.selectedText, llmApiKey, {
        systemPrompt,
        modelId: settingsStore.selectedLlmModelId,
        baseUrl: settingsStore.getLlmBaseUrl(),
        signal: abortController?.signal,
        maxTokens: EDIT_MODE_MAX_TOKENS,
      });
      if (isAborted.value) return;

      const editDurationMs = performance.now() - editStartTime;

      const record = buildTranscriptionRecord({
        id: params.transcriptionId,
        rawText: params.voiceInstruction,
        processedText: editResult.text,
        recordingDurationMs: params.recordingDurationMs,
        transcriptionDurationMs: params.transcriptionDurationMs,
        enhancementDurationMs: editDurationMs,
        wasEnhanced: true,
        audioFilePath: params.audioFilePath,
        status: "success",
        isEditMode: true,
        editSourceText: params.selectedText,
      });

      writeInfoLog(`Edit mode result: "${editResult.text}"`);

      await completePasteFlow({
        text: editResult.text,
        successMessage: t("voiceFlow.editSuccess"),
        record,
        chatUsage: editResult.usage,
      });

      writeInfoLog(
        `useVoiceFlowStore: edit mode completed, instruction="${params.voiceInstruction}", editDurationMs=${Math.round(editDurationMs)}`,
      );
    } catch (editError) {
      if (isAborted.value) return;
      writeErrorLog(
        `useVoiceFlowStore: edit mode failed: ${extractErrorMessage(editError)}`,
      );
      captureError(editError, { source: "voice-flow", step: "edit-mode" });

      // 编辑失败不贴上任何东西（避免语音指令覆盖选取文字）
      failRecordingFlow(
        t("voiceFlow.editFailed"),
        `useVoiceFlowStore: edit mode LLM call failed`,
        editError,
      );
    } finally {
      editSourceText.value = null;
    }
  }

  async function handleRetryTranscription() {
    if (!lastFailedAudioFilePath.value || !lastFailedTranscriptionId.value) {
      return;
    }

    isAborted.value = false;
    abortController = new AbortController();
    isRetryAttempt.value = true;
    clearAutoHideTimer();
    transitionTo("transcribing", t("voiceFlow.transcribing"));

    const filePath = lastFailedAudioFilePath.value;
    const transcriptionId = lastFailedTranscriptionId.value;
    const recordingDurationMs = lastFailedRecordingDurationMs.value;

    try {
      const settingsStore = useSettingsStore();
      let appId = settingsStore.getDoubaoAppId();
      let accessKey = settingsStore.getDoubaoAccessKey();

      if (!appId || !accessKey) {
        await settingsStore.refreshApiKey();
        appId = settingsStore.getDoubaoAppId();
        accessKey = settingsStore.getDoubaoAccessKey();
      }

      if (!appId || !accessKey) {
        transitionTo("error", t("errors.apiKeyMissing"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
      const hasVocabulary = whisperTermList.length > 0;

      const result = await invoke<TranscriptionResult>(
        "retranscribe_from_file",
        {
          filePath,
          appId,
          accessKey,
          vocabularyTermList: hasVocabulary ? whisperTermList : null,
          language: settingsStore.getWhisperLanguageCode(),
        },
      );
      if (isAborted.value) return;

      setLiveTranscript(result.rawText);

      writeInfoLog(`重送转录原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        // 重送也失败 → 不再提供重送
        transitionTo("error", t("voiceFlow.retryFailed"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      // ── 重送也需幻觉侦测（使用原始录音的 energy levels）──
      const retryHallucinationResult = detectHallucination({
        rawText: result.rawText,
        recordingDurationMs,
        peakEnergyLevel: lastFailedPeakEnergyLevel.value,
        rmsEnergyLevel: lastFailedRmsEnergyLevel.value,
        noSpeechProbability: result.noSpeechProbability,
      });

      if (retryHallucinationResult.isHallucination) {
        writeInfoLog(
          `useVoiceFlowStore: retry hallucination detected (reason=${retryHallucinationResult.reason})`,
        );
        transitionTo("error", t("voiceFlow.retryFailed"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      // 重送成功 → 进入 AI 整理 → 贴上流程
      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          await settingsStore.refreshLlmApiKey();
          const llmApiKey = settingsStore.getLlmApiKey();
          if (!llmApiKey) {
            throw new Error(t("errors.apiKeyMissing"));
          }

          const enhancementTermList =
            await vocabularyStore.getTopTermListByWeight(50);
          let enhanceResult = await enhanceText(result.rawText, llmApiKey, {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
            baseUrl: settingsStore.getLlmBaseUrl(),
            signal: abortController?.signal,
          });
          if (isAborted.value) return;

          // 重送路径同样套用守卫（长度爆炸 / 语意飘走 #43）→ fallback 到 rawText
          const resendAnomaly = detectEnhancementAnomaly({
            rawText: result.rawText,
            enhancedText: enhanceResult.text,
          });
          const resendDrift = detectSemanticDrift(
            result.rawText,
            enhanceResult.text,
          );
          const shouldFallbackToRaw =
            resendAnomaly.isAnomaly || resendDrift.isDrift;
          if (shouldFallbackToRaw) {
            writeErrorLog(
              `useVoiceFlowStore: resend enhancement rejected (anomaly=${resendAnomaly.reason ?? "none"}, drift=${resendDrift.isDrift}, overlap=${resendDrift.overlapRatio.toFixed(2)}), falling back to raw text`,
            );
            enhanceResult = { ...enhanceResult, text: result.rawText };
          }

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: !shouldFallbackToRaw,
            audioFilePath: filePath,
            status: "success",
          });

          writeInfoLog(`重送 AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
            skipRecordSaving: true,
          });

          // 更新 DB status（UPDATE 而非 INSERT）→ 完成后记录 API 用量（FK 依赖）
          const historyStore = useHistoryStore();
          void historyStore
            .updateTranscriptionOnRetrySuccess({
              id: transcriptionId,
              rawText: result.rawText,
              processedText: enhanceResult.text,
              transcriptionDurationMs: Math.round(
                result.transcriptionDurationMs,
              ),
              enhancementDurationMs: Math.round(enhancementDurationMs),
              wasEnhanced: !shouldFallbackToRaw,
              charCount: result.rawText.length,
            })
            .then(() => {
              saveApiUsageRecordList(record, enhanceResult.usage);
            })
            .catch((err) =>
              writeErrorLog(
                `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
              ),
            );
        } catch (enhanceError) {
          if (isAborted.value) return;
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          writeErrorLog(
            `useVoiceFlowStore: retry AI enhancement failed: ${getEnhancementErrorMessage(enhanceError)}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "retry-enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
            audioFilePath: filePath,
            status: "success",
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
            skipRecordSaving: true,
          });

          const historyStore = useHistoryStore();
          void historyStore
            .updateTranscriptionOnRetrySuccess({
              id: transcriptionId,
              rawText: result.rawText,
              processedText: null,
              transcriptionDurationMs: Math.round(
                result.transcriptionDurationMs,
              ),
              enhancementDurationMs: Math.round(fallbackEnhancementDurationMs),
              wasEnhanced: false,
              charCount: result.rawText.length,
            })
            .then(() => {
              saveApiUsageRecordList(fallbackRecord, null);
            })
            .catch((err) =>
              writeErrorLog(
                `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
              ),
            );
        }
      } else {
        // 不需要 AI 整理
        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath: filePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: null,
          skipRecordSaving: true,
        });

        const historyStore = useHistoryStore();
        void historyStore
          .updateTranscriptionOnRetrySuccess({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
            enhancementDurationMs: null,
            wasEnhanced: false,
            charCount: result.rawText.length,
          })
          .then(() => {
            saveApiUsageRecordList(record, null);
          })
          .catch((err) =>
            writeErrorLog(
              `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            ),
          );
      }

      // 重送成功 → 重置所有重送状态
      lastFailedTranscriptionId.value = null;
      lastFailedAudioFilePath.value = null;
      lastFailedRecordingDurationMs.value = 0;
      isRetryAttempt.value = false;
    } catch (error) {
      if (isAborted.value) return;
      // 重送也失败（API 错误等）→ 不再提供重送
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("play_error_sound");
      lastFailedAudioFilePath.value = null;
      isRetryAttempt.value = false;
      writeErrorLog(
        `useVoiceFlowStore: retry transcription failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, {
        source: "voice-flow",
        step: "retry-transcription",
      });
    }
  }

  async function initialize() {
    const settingsStore = useSettingsStore();
    writeInfoLog("useVoiceFlowStore: initializing");

    await settingsStore.loadSettings();

    const listeners = await Promise.all([
      listenToEvent(ESCAPE_PRESSED, () => {
        handleEscapeAbort();
      }),
      listenToEvent(HOTKEY_PRESSED, () => {
        void handleStartRecording();
      }),
      listenToEvent(HOTKEY_RELEASED, () => {
        void handleStopRecording();
      }),
      listenToEvent<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        if (event.payload.action === "start") {
          void handleStartRecording();
          return;
        }

        if (event.payload.action === "stop") {
          void handleStopRecording();
        }
      }),
      listenToEvent<QualityMonitorResultPayload>(
        QUALITY_MONITOR_RESULT,
        (event) => {
          lastWasModified.value = event.payload.wasModified;
          writeInfoLog(
            `useVoiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`,
          );
        },
      ),
      listenToEvent(HOTKEY_MODE_TOGGLE, () => {
        handleDoubleTapModeToggle();
      }),
      listenToEvent<TranscriptionPartialPayload>(
        TRANSCRIPTION_PARTIAL,
        (event) => {
          setLiveTranscript(event.payload.text);
        },
      ),
      listenToEvent<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const hudMessage = getHotkeyErrorMessage(event.payload.error);
        if (
          event.payload.error === HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION
        ) {
          void (async () => {
            try {
              const mainWindow = await Window.getByLabel("main-window");
              if (!mainWindow) return;
              await mainWindow.show();
              await mainWindow.setFocus();
            } catch (err) {
              writeErrorLog(
                `useVoiceFlowStore: show/focus main-window failed: ${extractErrorMessage(err)}`,
              );
            }
          })();
        }
        transitionTo("error", hudMessage);
        playSoundIfEnabled("play_error_sound");
        writeErrorLog(
          `useVoiceFlowStore: hotkey error: ${event.payload.message}`,
        );
      }),
    ]);
    unlistenFunctions.push(...listeners);
  }

  function cleanup() {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    clearDelayedMuteTimer();
    clearLearnedHideTimer();
    clearDoubleTapTimer();
    clearModeSwitchLabelTimer();
    stopMonitorPolling();
    stopElapsedTimer();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  return {
    status,
    message,
    liveTranscript,
    recordingElapsedSeconds,
    lastWasModified,
    canRetry,
    modeSwitchLabel,
    isEditMode,
    initialize,
    cleanup,
    handleRetryTranscription,
    transitionTo,
  };
});
