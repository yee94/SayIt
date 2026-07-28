import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
// "errors.apiKeyMissing" removed — now uses i18n key
import { HOTKEY_ERROR_CODES } from "@/types/events";

const {
  mockListen,
  mockEmit,
  mockInvoke,
  mockEnhanceText,
  mockGetCurrentWindow,
  mockWebviewWindowGetByLabel,
  mockMainWindowShow,
  mockMainWindowSetFocus,
  mockLoadSettings,
  mockSettingsState,
  mockVocabularyState,
  mockAddTranscription,
  mockUpdateTranscriptionOnRetrySuccess,
  mockAddApiUsage,
  listenerCallbackMap,
  unlistenFunctionList,
} = vi.hoisted(() => {
  type EventCallback = (event: { payload: unknown }) => void;
  const listenerCallbackMap = new Map<string, EventCallback>();
  const unlistenFunctionList: Array<ReturnType<typeof vi.fn>> = [];

  const mockListen = vi.fn(
    async (eventName: string, callback: EventCallback) => {
      listenerCallbackMap.set(eventName, callback);
      const unlisten = vi.fn();
      unlistenFunctionList.push(unlisten);
      return unlisten;
    },
  );
  const mockMainWindowShow = vi.fn().mockResolvedValue(undefined);
  const mockMainWindowSetFocus = vi.fn().mockResolvedValue(undefined);
  const mockWebviewWindowGetByLabel = vi.fn(async (label: string) => {
    if (label !== "main-window") return null;
    return {
      show: mockMainWindowShow,
      setFocus: mockMainWindowSetFocus,
    };
  });

  return {
    mockListen,
    mockEmit: vi.fn().mockResolvedValue(undefined),
    mockInvoke: vi.fn(async (cmd: string) => {
      switch (cmd) {
        case "start_recording":
          return undefined;
        case "stop_recording":
          return {
            recordingDurationMs: 2500,
            peakEnergyLevel: 0.3,
            rmsEnergyLevel: 0.1,
          };
        case "transcribe_audio":
          return {
            rawText: "测试转录",
            transcriptionDurationMs: 320,
            noSpeechProbability: 0.01,
          };
        case "get_hud_target_position":
          return { monitorKey: "test", x: 100, y: 0 };
        default:
          return undefined;
      }
    }),
    mockEnhanceText: vi
      .fn()
      .mockResolvedValue({ text: "AI 整理后的书面语文字", usage: null }),
    mockGetCurrentWindow: vi.fn(() => ({
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
    })),
    mockMainWindowShow,
    mockMainWindowSetFocus,
    mockWebviewWindowGetByLabel,
    mockLoadSettings: vi.fn().mockResolvedValue(undefined),
    mockSettingsState: {
      doubaoAppId: "test-app-id",
      doubaoAccessKey: "test-access-key",
      llmApiKey: "test-llm-key-123",
      llmBaseUrl: "https://api.openai.com/v1/chat/completions",
      aiPrompt: "自订 prompt 内容",
      triggerMode: "hold" as string,
      isEnhancementThresholdEnabled: true,
      enhancementThresholdCharCount: 10,
      selectedLlmModelId: "gpt-4o-mini",
      selectedWhisperModelId: "doubao-seedasr",
      isMuteOnRecordingEnabled: false,
      isSoundEffectsEnabled: true,
      isSmartDictionaryEnabled: false,
      isCopyTranscriptionToClipboardEnabled: true,
      whisperLanguageCode: "zh" as string | null,
    },
    mockVocabularyState: {
      termList: [] as Array<{
        id: string;
        term: string;
        weight: number;
        source: string;
        createdAt: string;
      }>,
      getTopTermListByWeight: vi.fn().mockResolvedValue([]),
      batchIncrementWeights: vi.fn().mockResolvedValue(undefined),
    },
    mockAddTranscription: vi.fn().mockResolvedValue(undefined),
    mockUpdateTranscriptionOnRetrySuccess: vi.fn().mockResolvedValue(undefined),
    mockAddApiUsage: vi.fn().mockResolvedValue(undefined),
    listenerCallbackMap,
    unlistenFunctionList,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emit: mockEmit,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
  Window: {
    getByLabel: mockWebviewWindowGetByLabel,
  },
}));

vi.mock("../../src/lib/enhancer", () => {
  class EnhancerApiError extends Error {
    constructor(
      public statusCode: number,
      statusText: string,
      public body: string,
    ) {
      super(`Enhancement API error: ${statusCode} ${statusText}`);
      this.name = "EnhancerApiError";
    }
  }
  return {
    enhanceText: mockEnhanceText,
    buildSystemPrompt: (basePrompt: string) => basePrompt,
    EnhancerApiError,
  };
});

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-CN" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/lib/apiPricing", () => ({
  calculateWhisperCostCeiling: vi.fn(() => 0.000308),
  calculateChatCostCeiling: vi.fn(() => 0.000118),
}));

vi.mock("../../src/lib/vocabularyAnalyzer", () => ({
  analyzeCorrections: vi.fn().mockResolvedValue({
    suggestedTermList: [],
    usage: null,
  }),
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    loadSettings: mockLoadSettings,
    getApiKey: () => mockSettingsState.doubaoAccessKey,
    getDoubaoAppId: () => mockSettingsState.doubaoAppId,
    getDoubaoAccessKey: () => mockSettingsState.doubaoAccessKey,
    getLlmApiKey: () => mockSettingsState.llmApiKey,
    getLlmBaseUrl: () => mockSettingsState.llmBaseUrl,
    getAiPrompt: () => mockSettingsState.aiPrompt,
    refreshApiKey: vi.fn().mockResolvedValue(undefined),
    refreshLlmApiKey: vi.fn().mockResolvedValue(undefined),
    hasLlmApiKey: true,
    refreshEnhancementThreshold: vi.fn().mockResolvedValue(undefined),
    triggerMode: mockSettingsState.triggerMode,
    get isEnhancementThresholdEnabled() {
      return mockSettingsState.isEnhancementThresholdEnabled;
    },
    get enhancementThresholdCharCount() {
      return mockSettingsState.enhancementThresholdCharCount;
    },
    get selectedLlmModelId() {
      return mockSettingsState.selectedLlmModelId;
    },
    get selectedWhisperModelId() {
      return mockSettingsState.selectedWhisperModelId;
    },
    get isMuteOnRecordingEnabled() {
      return mockSettingsState.isMuteOnRecordingEnabled;
    },
    get isSoundEffectsEnabled() {
      return mockSettingsState.isSoundEffectsEnabled;
    },
    get isSmartDictionaryEnabled() {
      return mockSettingsState.isSmartDictionaryEnabled;
    },
    get isCopyTranscriptionToClipboardEnabled() {
      return mockSettingsState.isCopyTranscriptionToClipboardEnabled;
    },
    getWhisperLanguageCode: () => mockSettingsState.whisperLanguageCode,
    selectedAudioInputDeviceName: "",
  }),
}));

vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => ({
    termList: mockVocabularyState.termList,
    getTopTermListByWeight: mockVocabularyState.getTopTermListByWeight,
    batchIncrementWeights: mockVocabularyState.batchIncrementWeights,
  }),
}));

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => ({
    addTranscription: mockAddTranscription,
    updateTranscriptionOnRetrySuccess: mockUpdateTranscriptionOnRetrySuccess,
    addApiUsage: mockAddApiUsage,
  }),
}));

import { useVoiceFlowStore } from "../../src/stores/useVoiceFlowStore";

function triggerHotkeyEvent(eventName: string, payload: unknown = undefined) {
  const callback = listenerCallbackMap.get(eventName);
  if (!callback) {
    throw new Error(`找不到事件监听器: ${eventName}`);
  }
  callback({ payload });
}

function createDeferredPromise<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolvePromise, rejectPromise };
}

const DEFAULT_TRANSCRIBE_RESULT = {
  rawText: "测试转录",
  transcriptionDurationMs: 320,
  noSpeechProbability: 0.01,
};

function createMockInvokeHandler(options?: {
  transcribeResult?: unknown;
  transcribeError?: Error;
  retranscribeResult?: unknown;
  retranscribeError?: Error;
  stopRecordingResult?: {
    recordingDurationMs: number;
  };
}): any {
  return async (cmd: string) => {
    switch (cmd) {
      case "start_recording":
        return undefined;
      case "stop_recording":
        return (
          options?.stopRecordingResult ?? {
            recordingDurationMs: 2500,
            peakEnergyLevel: 0.3,
            rmsEnergyLevel: 0.1,
          }
        );
      case "save_recording_file":
        return "/mock/recordings/test.wav";
      case "start_live_asr":
      case "cancel_live_asr":
        return undefined;
      // 单元测试默认不走 live ASR 成功路径，强制 fallback 到 batch transcribe_audio
      case "finish_live_asr":
        throw new Error("Live ASR not active in test");
      case "transcribe_audio":
        if (options?.transcribeError) throw options.transcribeError;
        if (options?.transcribeResult !== undefined) {
          return options.transcribeResult instanceof Promise
            ? await options.transcribeResult
            : options.transcribeResult;
        }
        return DEFAULT_TRANSCRIBE_RESULT;
      case "retranscribe_from_file":
        if (options?.retranscribeError) throw options.retranscribeError;
        if (options?.retranscribeResult !== undefined) {
          return options.retranscribeResult instanceof Promise
            ? await options.retranscribeResult
            : options.retranscribeResult;
        }
        return DEFAULT_TRANSCRIBE_RESULT;
      case "get_hud_target_position":
        return { monitorKey: "test", x: 100, y: 0 };
      default:
        return undefined;
    }
  };
}

describe("useVoiceFlowStore", () => {
  let performanceNowCounter = 0;

  beforeEach(() => {
    performanceNowCounter = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      performanceNowCounter += 500;
      return performanceNowCounter;
    });
    setActivePinia(createPinia());
    listenerCallbackMap.clear();
    unlistenFunctionList.length = 0;
    mockListen.mockClear();
    mockEmit.mockClear().mockResolvedValue(undefined);
    mockInvoke.mockClear().mockImplementation(createMockInvokeHandler());
    mockEnhanceText
      .mockClear()
      .mockResolvedValue({ text: "AI 整理后的书面语文字", usage: null });
    mockLoadSettings.mockClear().mockResolvedValue(undefined);
    mockSettingsState.doubaoAppId = "test-app-id";
    mockSettingsState.doubaoAccessKey = "test-access-key";
    mockSettingsState.llmApiKey = "test-llm-key-123";
    mockSettingsState.llmBaseUrl =
      "https://api.openai.com/v1/chat/completions";
    mockSettingsState.aiPrompt = "自订 prompt 内容";
    mockSettingsState.triggerMode = "hold";
    mockSettingsState.isEnhancementThresholdEnabled = true;
    mockSettingsState.enhancementThresholdCharCount = 10;
    mockSettingsState.selectedLlmModelId = "gpt-4o-mini";
    mockSettingsState.selectedWhisperModelId = "doubao-seedasr";
    mockSettingsState.isMuteOnRecordingEnabled = false;
    mockSettingsState.isSoundEffectsEnabled = true;
    mockSettingsState.isSmartDictionaryEnabled = false;
    mockSettingsState.whisperLanguageCode = "zh";
    mockVocabularyState.termList = [];
    mockVocabularyState.getTopTermListByWeight
      .mockClear()
      .mockResolvedValue([]);
    mockVocabularyState.batchIncrementWeights
      .mockClear()
      .mockResolvedValue(undefined);
    mockAddTranscription.mockClear().mockResolvedValue(undefined);
    mockUpdateTranscriptionOnRetrySuccess
      .mockClear()
      .mockResolvedValue(undefined);
    mockAddApiUsage.mockClear().mockResolvedValue(undefined);
    mockGetCurrentWindow.mockClear();
    mockWebviewWindowGetByLabel.mockClear();
    mockMainWindowShow.mockClear().mockResolvedValue(undefined);
    mockMainWindowSetFocus.mockClear().mockResolvedValue(undefined);
  });

  it("[P0] initialize 应载入设定并注册所有热键事件", async () => {
    const store = useVoiceFlowStore();

    await store.initialize();

    expect(mockLoadSettings).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:pressed",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:released",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:toggled",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:error",
      expect.any(Function),
    );
    expect(mockListen).not.toHaveBeenCalledWith(
      "cancel:requested",
      expect.any(Function),
    );
  });

  it("[P0] transitionTo 应处理 HUD 显示与 success/error 自动收合", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();

    store.transitionTo("recording", "voiceFlow.recording");
    expect(store.status).toBe("recording");
    expect(store.message).toBe("voiceFlow.recording");

    store.transitionTo("success", "voiceFlow.pasteSuccess");
    expect(store.status).toBe("success");
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(store.status).toBe("idle");

    store.transitionTo("error", "网路异常");
    expect(store.status).toBe("error");
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(store.status).toBe("idle");

    vi.useRealTimers();
  });

  it("[P0] HOTKEY_PRESSED 只会在未录音时启动录音并广播 recording", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:pressed");
    await Promise.resolve();

    const startRecordingCallCount = mockInvoke.mock.calls.filter(
      (call) => call[0] === "start_recording",
    ).length;
    expect(startRecordingCallCount).toBe(1);
    expect(store.status).toBe("recording");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "recording",
      message: "voiceFlow.recording",
    });
  });

  it("[P0] HOTKEY_RELEASED 应完成 录音→转录→贴上→success 并广播事件", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
        text: "测试转录",
        restoreClipboard: false,
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith("stop_recording");
    expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
      appId: "test-app-id",
      accessKey: "test-access-key",
      vocabularyTermList: null,
      language: "zh",
    });
    expect(store.status).toBe("success");
    expect(store.message).toBe("voiceFlow.pasteSuccess");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "success",
      message: "voiceFlow.pasteSuccess",
    });
  });

  describe("选取侦测三态（#24/#25 编辑模式判定）", () => {
    function withSelectionState(
      state: { kind: string; text: string | null },
      clipboardText: string | null = null,
    ) {
      const base = createMockInvokeHandler();
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "read_selection_state") return state;
        if (cmd === "read_selected_text") return clipboardText;
        return base(cmd, args);
      });
    }

    it("[P0] AX 回报 selection 应直接进编辑模式、不呼叫剪贴簿撷取", async () => {
      withSelectionState({ kind: "selection", text: "选取的文字" });
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(store.isEditMode).toBe(true);
      });

      expect(mockInvoke).not.toHaveBeenCalledWith("read_selected_text");
    });

    it("[P0] AX 回报 noSelection 应走一般听写、全程不模拟 Cmd+C", async () => {
      withSelectionState({ kind: "noSelection", text: null });
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "测试转录",
          restoreClipboard: false,
        });
      });

      expect(store.isEditMode).toBe(false);
      expect(mockInvoke).not.toHaveBeenCalledWith("read_selected_text");
    });

    it("[P0] AX 回报 unavailable 应在停止录音后走剪贴簿后备并进编辑模式", async () => {
      withSelectionState({ kind: "unavailable", text: null }, "后备选取的文字");
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });
      // 录音开始阶段不可有任何按键模拟（#25：按键还压着）
      expect(mockInvoke).not.toHaveBeenCalledWith("read_selected_text");

      triggerHotkeyEvent("hotkey:released");
      // 后备有 250ms 等按键放开的延迟；转录先完成时模式判定必须等它
      await vi.waitFor(
        () => {
          expect(mockEnhanceText).toHaveBeenCalledWith(
            "后备选取的文字",
            expect.anything(),
            expect.anything(),
          );
        },
        { timeout: 3000 },
      );
      expect(mockInvoke).toHaveBeenCalledWith("read_selected_text");
    });
  });

  it("[P0] stop_recording 回报短时长时应显示「录音时间太短」并跳过转录", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        stopRecordingResult: { recordingDurationMs: 150 },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("voiceFlow.recordingTooShort");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "transcribe_audio",
      expect.anything(),
    );
  });

  it("[P0] API Key 缺失时应进入 error 且不执行转录", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    mockSettingsState.doubaoAppId = "";
    mockSettingsState.doubaoAccessKey = "";
    triggerHotkeyEvent("hotkey:released");

    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("errors.apiKeyMissing");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "transcribe_audio",
      expect.anything(),
    );
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "errors.apiKeyMissing",
    });
  });

  it("[P0] 空白转录结果时应回报「未侦测到语音」", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "",
          transcriptionDurationMs: 280,
          noSpeechProbability: 1.0,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("voiceFlow.noSpeechDetected");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 高 noSpeechProbability 但有文字时应正常贴上（不拦截幻听）", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "谢谢大家",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.95,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", expect.anything());
    });

    expect(store.status).toBe("success");
  });

  it("[P0] 已知幻觉短语有文字时应正常贴上（让使用者自行判断）", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "谢谢大家",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.5,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", expect.anything());
    });

    expect(store.status).toBe("success");
  });

  it("[P0] 正常语音应正常贴上", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "你好",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.05,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
        text: "你好",
        restoreClipboard: false,
      });
    });

    expect(store.status).toBe("success");
  });

  it("[P1] 纯空白字串应视为空转录，触发「未侦测到语音」", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "   ",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.8,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("voiceFlow.noSpeechDetected");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 转录失败时应回报中文错误讯息", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeError: new Error("Groq API error (500)"),
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("errors.transcription.serviceUnavailable");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "errors.transcription.serviceUnavailable",
    });
  });

  it("[P0] 转录中再次触发 HOTKEY_PRESSED 应被忽略（race condition 防护）", async () => {
    const deferredTranscription = createDeferredPromise<{
      rawText: string;
      transcriptionDurationMs: number;
      noSpeechProbability: number;
    }>();
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: deferredTranscription.promise,
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:released");
    triggerHotkeyEvent("hotkey:pressed");
    await Promise.resolve();

    const startRecordingCallCount = mockInvoke.mock.calls.filter(
      (call) => call[0] === "start_recording",
    ).length;
    expect(startRecordingCallCount).toBe(1);

    deferredTranscription.resolvePromise({
      rawText: "完成转录",
      transcriptionDurationMs: 100,
      noSpeechProbability: 0.01,
    });

    await vi.waitFor(() => {
      expect(store.status).toBe("success");
    });
  });

  it("[P1] HOTKEY_TOGGLED 应依 action 分别触发 start 与 stop", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:toggled", { mode: "toggle", action: "start" });
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    triggerHotkeyEvent("hotkey:toggled", { mode: "toggle", action: "stop" });
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("stop_recording");
    });
  });

  it("[P0] HOTKEY_ERROR 应转为 error 状态并显示中文 HUD 讯息", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:error", {
      error: "ACCESSIBILITY_DENIED",
      message: "CGEventTap creation failed",
    });

    expect(store.status).toBe("error");
    expect(store.message).toBe("errors.hotkey.default");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "errors.hotkey.default",
    });
  });

  it("[P0] HOTKEY_ERROR 为 accessibility_permission 时应开启 main-window 并显示权限讯息", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:error", {
      error: HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION,
      message: "CGEventTap creation failed. Grant Accessibility permission.",
    });
    await vi.waitFor(() => {
      expect(mockMainWindowSetFocus).toHaveBeenCalledTimes(1);
    });

    expect(mockWebviewWindowGetByLabel).toHaveBeenCalledWith("main-window");
    expect(mockMainWindowShow).toHaveBeenCalledTimes(1);
    expect(store.status).toBe("error");
    expect(store.message).toBe("errors.hotkey.accessibilityPermission");
  });

  it("[P1] success auto-hide 应广播 idle 事件", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();

    store.transitionTo("success", "voiceFlow.pasteSuccess");
    mockEmit.mockClear();

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(store.status).toBe("idle");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "idle",
      message: "",
    });

    vi.useRealTimers();
  });

  it("[P0] cleanup 应清除 timer 并解除所有事件监听", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();
    await store.initialize();

    store.transitionTo("success", "voiceFlow.pasteSuccess");
    store.cleanup();
    vi.advanceTimersByTime(1000);

    expect(store.status).toBe("success");
    unlistenFunctionList.forEach((unlisten) => {
      expect(unlisten).toHaveBeenCalledTimes(1);
    });
    vi.useRealTimers();
  });

  // ==========================================================================
  // AI 文字整理 (Story 2.1)
  // ==========================================================================

  describe("AI 文字整理", () => {
    it("[P0] >= 10 字应走 AI 整理流程：recording → transcribing → enhancing → success", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "这是一段超过十个字的测试转录文字内容。",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "这是一段超过十个字的测试转录文字内容。",
          restoreClipboard: false,
        });
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-llm-key-123",
        expect.objectContaining({
          systemPrompt: "自订 prompt 内容",
        }),
      );
      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccess");

      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "enhancing",
        message: "voiceFlow.enhancing",
      });
      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "success",
        message: "voiceFlow.pasteSuccess",
      });
    });

    it("[P0] < 10 字应跳过 AI 整理，直接贴上原始文字", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
          restoreClipboard: false,
        });
      });

      expect(mockEnhanceText).not.toHaveBeenCalled();
      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccess");

      const enhancingCalls = mockEmit.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === "voice-flow:state-changed" &&
          (call[1] as { status: string }).status === "enhancing",
      );
      expect(enhancingCalls).toHaveLength(0);
    });

    it("[P0] AI 整理 timeout 应 fallback 贴原始文字并显示「已贴上（未整理）」", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾时"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
          restoreClipboard: false,
        });
      });

      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccessUnenhanced");
    });

    it("[P0] AI 整理 API 错误应 fallback 贴原始文字并显示「已贴上（未整理）」", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理失败：500"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
          restoreClipboard: false,
        });
      });

      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccessUnenhanced");
      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "success",
        message: "voiceFlow.pasteSuccessUnenhanced",
      });
    });

    it("[P0] 恰好 10 字应走 AI 整理流程", async () => {
      const exactTenChars = "一二三四五六七八九十";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: exactTenChars,
            transcriptionDurationMs: 300,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "一二三四五六七八九十。",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "一二三四五六七八九十。",
          restoreClipboard: false,
        });
      });

      expect(mockEnhanceText).toHaveBeenCalledTimes(1);
    });

    it("[P0] 9 字应跳过 AI 整理", async () => {
      const nineChars = "一二三四五六七八九";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: nineChars,
            transcriptionDurationMs: 300,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: nineChars,
          restoreClipboard: false,
        });
      });

      expect(mockEnhanceText).not.toHaveBeenCalled();
    });

    it("[P0] 门槛停用时，短文字仍走 AI 整理", async () => {
      mockSettingsState.isEnhancementThresholdEnabled = false;
      const shortText = "这是短文字测试";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: shortText,
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "这是 AI 整理过的短文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "这是 AI 整理过的短文字",
          restoreClipboard: false,
        });
      });

      expect(mockEnhanceText).toHaveBeenCalledTimes(1);
    });

    // ========================================================================
    // Story 2.2: Prompt 自订与上下文注入
    // ========================================================================

    it("[P0] AI 整理应传递 systemPrompt 参数", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理后文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-llm-key-123",
        expect.objectContaining({
          systemPrompt: "自订 prompt 内容",
        }),
      );
    });

    it("[P0] AI 整理应注入词汇清单", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理后文字",
        usage: null,
      });

      mockVocabularyState.termList = [
        {
          id: "1",
          term: "TypeScript",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          term: "Vue.js",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
      ];
      mockVocabularyState.getTopTermListByWeight.mockResolvedValue([
        "TypeScript",
        "Vue.js",
      ]);

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-llm-key-123",
        expect.objectContaining({
          vocabularyTermList: ["TypeScript", "Vue.js"],
        }),
      );
    });

    it("[P0] 空词汇清单不应传递 vocabularyTermList (Story 2.2)", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理后文字",
        usage: null,
      });

      mockVocabularyState.termList = [];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-llm-key-123",
        expect.objectContaining({
          vocabularyTermList: undefined,
        }),
      );
    });
  });

  // ==========================================================================
  // 词汇注入 Whisper (Story 3.2)
  // ==========================================================================

  describe("词汇注入 Whisper", () => {
    it("[P0] 有词汇时应将词汇清单传入 transcribe_audio", async () => {
      mockVocabularyState.termList = [
        {
          id: "1",
          term: "TypeScript",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          term: "Tauri",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
      ];
      mockVocabularyState.getTopTermListByWeight.mockResolvedValue([
        "TypeScript",
        "Tauri",
      ]);

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "transcribe_audio",
          expect.anything(),
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
        appId: "test-app-id",
        accessKey: "test-access-key",
        vocabularyTermList: ["TypeScript", "Tauri"],
        language: "zh",
      });
    });

    it("[P0] 空词汇时应传 null 给 transcribe_audio", async () => {
      mockVocabularyState.termList = [];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "transcribe_audio",
          expect.anything(),
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
        appId: "test-app-id",
        accessKey: "test-access-key",
        vocabularyTermList: null,
        language: "zh",
      });
    });

    it("[P0] 词汇清单应同时传给 transcriber 和 enhancer", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理后文字",
        usage: null,
      });

      mockVocabularyState.termList = [
        {
          id: "1",
          term: "Pinia",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          term: "Vitest",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
      ];
      mockVocabularyState.getTopTermListByWeight.mockResolvedValue([
        "Pinia",
        "Vitest",
      ]);

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      // transcriber 收到词汇
      expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
        appId: "test-app-id",
        accessKey: "test-access-key",
        vocabularyTermList: ["Pinia", "Vitest"],
        language: "zh",
      });

      // enhancer 也收到词汇
      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-llm-key-123",
        expect.objectContaining({
          vocabularyTermList: ["Pinia", "Vitest"],
          modelId: "gpt-4o-mini",
          baseUrl: "https://api.openai.com/v1/chat/completions",
        }),
      );
    });
  });

  // ==========================================================================
  // 贴上后品质监控 (Story 2.3)
  // ==========================================================================

  describe("贴上后品质监控", () => {
    it("[P0] AI 整理成功贴上后应呼叫 start_quality_monitor", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "这是一段超过十个字的测试转录文字内容。",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "这是一段超过十个字的测试转录文字内容。",
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_quality_monitor");
      });
    });

    it("[P0] AI 整理失败 fallback 后仍应启动品质监控", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾时"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_quality_monitor");
      });
    });

    it("[P0] 跳过 AI 直接贴上后应呼叫 start_quality_monitor", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_quality_monitor");
      });
    });

    it("[P0] 收到 quality-monitor:result 事件应更新 lastWasModified", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      expect(store.lastWasModified).toBeNull();

      triggerHotkeyEvent("quality-monitor:result", { wasModified: true });
      expect(store.lastWasModified).toBe(true);

      triggerHotkeyEvent("quality-monitor:result", { wasModified: false });
      expect(store.lastWasModified).toBe(false);
    });

    it("[P0] 开始录音时应重置 lastWasModified 为 null", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      // 先模拟收到品质监控结果
      triggerHotkeyEvent("quality-monitor:result", { wasModified: true });
      expect(store.lastWasModified).toBe(true);

      // 开始新一轮录音
      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      expect(store.lastWasModified).toBeNull();
    });

    it("[P0] initialize 应注册 quality-monitor:result 事件监听", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      expect(mockListen).toHaveBeenCalledWith(
        "quality-monitor:result",
        expect.any(Function),
      );
    });

    it("[P0] 转录失败时不应呼叫 start_quality_monitor", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeError: new Error("Groq API error (500)"),
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(mockInvoke).not.toHaveBeenCalledWith("start_quality_monitor");
    });
  });

  // ==========================================================================
  // 转录记录自动储存 (Story 4.1)
  // ==========================================================================

  describe("转录记录自动储存", () => {
    it("[P0] AI 整理成功路径应呼叫 addTranscription（wasEnhanced=true, processedText 有值）", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "这是一段超过十个字的测试转录文字内容。",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "这是一段超过十个字的测试转录文字内容。",
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      });

      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.rawText).toBe(longText);
      expect(record.processedText).toBe("这是一段超过十个字的测试转录文字内容。");
      expect(record.wasEnhanced).toBe(true);
      expect(record.enhancementDurationMs).toBeGreaterThanOrEqual(0);
      expect(record.charCount).toBe(longText.length);
      expect(record.triggerMode).toBe("hold");
      expect(record.wasModified).toBeNull();
      expect(record.id).toBeTruthy();
      expect(record.timestamp).toBeGreaterThan(0);
    });

    it("[P0] AI 整理失败路径应呼叫 addTranscription（wasEnhanced=false, processedText=null, enhancementDurationMs 有值）", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾时"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      });

      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.rawText).toBe(longText);
      expect(record.processedText).toBeNull();
      expect(record.wasEnhanced).toBe(false);
      expect(record.enhancementDurationMs).toBeGreaterThanOrEqual(0);
      expect(record.charCount).toBe(longText.length);
      expect(record.wasModified).toBeNull();
    });

    it("[P0] 跳过 AI 路径应呼叫 addTranscription（wasEnhanced=false, processedText=null, enhancementDurationMs=null）", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      });

      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.rawText).toBe("短文字");
      expect(record.processedText).toBeNull();
      expect(record.wasEnhanced).toBe(false);
      expect(record.enhancementDurationMs).toBeNull();
      expect(record.charCount).toBe("短文字".length);
      expect(record.wasModified).toBeNull();
    });

    it("[P0] AC2: 转录 API 失败时应写入 failed 记录（有 audioFilePath）", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeError: new Error("Groq API error (500)"),
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      // AC2: API 错误时仍写入 failed 记录（audioFilePath 非 null）
      expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.status).toBe("failed");
      expect(record.audioFilePath).toBe("/mock/recordings/test.wav");
      expect(record.rawText).toBe("");
    });

    it("[P0] 空白转录结果应写入 failed 记录", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "",
            transcriptionDurationMs: 280,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      // AC2: 空转录仍写入 failed 记录
      expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.status).toBe("failed");
      expect(record.rawText).toBe("");
    });

    it("[P0] addTranscription 失败不应影响主流程（fire-and-forget）", async () => {
      mockAddTranscription.mockRejectedValueOnce(
        new Error("SQLite write failed"),
      );
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
          restoreClipboard: false,
        });
      });

      // 主流程仍然成功
      expect(store.status).toBe("success");
      expect(mockAddTranscription).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // API Usage 记录 (saveApiUsageRecordList)
  // ==========================================================================

  describe("API Usage 记录", () => {
    it("[P0] 跳过 AI 路径应只呼叫 addApiUsage 一次（Whisper）", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddApiUsage).toHaveBeenCalledTimes(1);
      });

      const whisperRecord = mockAddApiUsage.mock.calls[0][0];
      expect(whisperRecord.apiType).toBe("whisper");
      expect(whisperRecord.model).toBe("doubao-seedasr");
      expect(whisperRecord.audioDurationMs).toBeGreaterThanOrEqual(0);
      expect(whisperRecord.estimatedCostCeiling).toBe(0.000308); // mocked
    });

    it("[P0] AI 整理成功应呼叫 addApiUsage 两次（Whisper + Chat）", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "这是一段超过十个字的测试转录文字内容。",
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          promptTimeMs: 200,
          completionTimeMs: 300,
          totalTimeMs: 500,
        },
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "这是一段超过十个字的测试转录文字内容。",
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddApiUsage).toHaveBeenCalledTimes(2);
      });

      const whisperRecord = mockAddApiUsage.mock.calls[0][0];
      expect(whisperRecord.apiType).toBe("whisper");

      const chatRecord = mockAddApiUsage.mock.calls[1][0];
      expect(chatRecord.apiType).toBe("chat");
      expect(chatRecord.model).toBe("gpt-4o-mini");
      expect(chatRecord.promptTokens).toBe(100);
      expect(chatRecord.completionTokens).toBe(50);
      expect(chatRecord.totalTokens).toBe(150);
      expect(chatRecord.estimatedCostCeiling).toBe(0.000118);
    });

    it("[P0] AI 整理失败 fallback 应只呼叫 addApiUsage 一次（Whisper）", async () => {
      const longText = "这是一段超过十个字的测试转录文字内容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾时"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
          restoreClipboard: false,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddApiUsage).toHaveBeenCalledTimes(1);
      });

      const whisperRecord = mockAddApiUsage.mock.calls[0][0];
      expect(whisperRecord.apiType).toBe("whisper");
    });
  });

  // ==========================================================================
  // 重送转录 (Story 4.5)
  // ==========================================================================

  describe("重送转录", () => {
    async function setupFailedTranscription(
      store: ReturnType<typeof useVoiceFlowStore>,
    ) {
      // 模拟空转录结果触发失败
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "",
            transcriptionDurationMs: 280,
            noSpeechProbability: 0.95,
          },
        }),
      );

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });
    }

    it("[P0] 空转录失败后 canRetry 应为 true", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      await setupFailedTranscription(store);

      expect(store.canRetry).toBe(true);
    });

    it("[P0] 重送成功应呼叫 retranscribe_from_file、paste_text，并更新 DB", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      await setupFailedTranscription(store);
      expect(store.canRetry).toBe(true);

      // 重新设定 mock 让重送成功
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          retranscribeResult: {
            rawText: "重送成功的文字",
            transcriptionDurationMs: 350,
            noSpeechProbability: 0.02,
          },
        }),
      );

      await store.handleRetryTranscription();

      expect(mockInvoke).toHaveBeenCalledWith(
        "retranscribe_from_file",
        expect.objectContaining({
          filePath: "/mock/recordings/test.wav",
          appId: "test-app-id",
          accessKey: "test-access-key",
        }),
      );

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "重送成功的文字",
          restoreClipboard: false,
        });
      });

      expect(store.status).toBe("success");
      expect(store.canRetry).toBe(false);

      // DB 应被 UPDATE
      await vi.waitFor(() => {
        expect(mockUpdateTranscriptionOnRetrySuccess).toHaveBeenCalledTimes(1);
      });
      const updateParams =
        mockUpdateTranscriptionOnRetrySuccess.mock.calls[0][0];
      expect(updateParams.rawText).toBe("重送成功的文字");
      expect(updateParams.processedText).toBeNull();
    });

    it("[P0] 重送失败（空转录）不再提供重送按钮", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      await setupFailedTranscription(store);
      expect(store.canRetry).toBe(true);

      // 重送也回传空白
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          retranscribeResult: {
            rawText: "",
            transcriptionDurationMs: 300,
            noSpeechProbability: 0.98,
          },
        }),
      );

      await store.handleRetryTranscription();

      expect(store.status).toBe("error");
      expect(store.message).toBe("voiceFlow.retryFailed");
      expect(store.canRetry).toBe(false);
    });

    it("[P0] 录音太短不启用重送", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          stopRecordingResult: { recordingDurationMs: 100 },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(store.canRetry).toBe(false);
    });

    it("[P0] canRetry 在非 error 状态下应为 false", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      // idle 状态
      expect(store.canRetry).toBe(false);

      // recording 状态
      store.transitionTo("recording");
      expect(store.canRetry).toBe(false);
    });

    it("[P0] 新录音开始时应重置重送状态", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      await setupFailedTranscription(store);
      expect(store.canRetry).toBe(true);

      // 重新设定 mock 让新录音正常
      mockInvoke.mockImplementation(createMockInvokeHandler());

      // 开始新录音
      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(store.status).toBe("recording");
      });

      // canRetry 应被重置
      expect(store.canRetry).toBe(false);
    });

    it("[P0] API 错误失败后 canRetry 应为 true", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeError: new Error("Groq API error (500)"),
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(store.canRetry).toBe(true);
    });

    it("[P0] 重送 API 错误不再提供重送按钮", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      await setupFailedTranscription(store);
      expect(store.canRetry).toBe(true);

      // 重送也抛出错误
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          retranscribeError: new Error("Groq API error (503)"),
        }),
      );

      await store.handleRetryTranscription();

      expect(store.status).toBe("error");
      expect(store.message).toBe("voiceFlow.retryFailed");
      expect(store.canRetry).toBe(false);
    });
  });

  describe("音效回馈", () => {
    it("开始录音时应呼叫 play_start_sound", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });
      expect(mockInvoke).toHaveBeenCalledWith("play_start_sound");
    });

    it("结束录音时应呼叫 play_stop_sound", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("play_stop_sound");
      });
    });

    it("play_start_sound 失败不应影响录音流程", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "play_start_sound")
          throw new Error("sound playback failed");
        return createMockInvokeHandler()(cmd);
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(store.status).toBe("recording");
      });

      expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
        deviceName: "",
      });
    });

    it("play_stop_sound 失败不应影响转录流程", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "play_stop_sound") throw new Error("sound playback failed");
        return createMockInvokeHandler()(cmd);
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "测试转录",
          restoreClipboard: false,
        });
      });

      // 选取侦测后备（250ms）拉长了贴上→success 的时序，改用 waitFor 断言终态
      await vi.waitFor(() => {
        expect(store.status).toBe("success");
      });
    });

    it("音效停用时不应呼叫 play_start_sound", async () => {
      mockSettingsState.isSoundEffectsEnabled = false;
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });
      expect(mockInvoke).not.toHaveBeenCalledWith("play_start_sound");
    });

    it("音效停用时不应呼叫 play_stop_sound", async () => {
      mockSettingsState.isSoundEffectsEnabled = false;
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", {
          deviceName: "",
        });
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "测试转录",
          restoreClipboard: false,
        });
      });
      expect(mockInvoke).not.toHaveBeenCalledWith("play_stop_sound");
    });
  });
});
