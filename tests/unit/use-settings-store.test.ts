import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreDelete = vi.fn(async (key: string) => {
  mockStoreData.delete(key);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    delete: mockStoreDelete,
    save: mockStoreSave,
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
}));

describe("useSettingsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreDelete.mockClear();
    mockStoreSave.mockClear();
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockEmit.mockClear().mockResolvedValue(undefined);
    vi.resetModules();
  });

  // ==========================================================================
  // loadSettings
  // ==========================================================================

  describe("loadSettings", () => {
    it("[P0] 应从 store 载入已储存的 hotkey config", async () => {
      mockStoreData.set("hotkeyTriggerKey", "option");
      mockStoreData.set("hotkeyTriggerMode", "toggle");
      mockStoreData.set("doubaoAppId", "app123");
      mockStoreData.set("doubaoAccessKey", "ak_test123");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "option",
        triggerMode: "toggle",
      });
      expect(store.triggerMode).toBe("toggle");
      expect(store.hasApiKey).toBe(true);
    });

    it("[P0] 无储存值时应使用平台预设值", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      // 在 Node.js 环境中 navigator.userAgent 不含 "Mac"，预设为 rightAlt
      expect(store.hotkeyConfig?.triggerKey).toBeDefined();
      expect(store.hotkeyConfig?.triggerMode).toBe("hold");
    });

    it("[P1] 载入后应同步 hotkey config 到 Rust", async () => {
      mockStoreData.set("hotkeyTriggerKey", "control");
      mockStoreData.set("hotkeyTriggerMode", "hold");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(mockInvoke).toHaveBeenCalledWith("update_hotkey_config", {
        triggerKey: "control",
        triggerMode: "hold",
      });
    });

    it("[P1] store 载入失败时应 fallback 到预设值", async () => {
      mockStoreGet.mockRejectedValueOnce(new Error("store corrupted"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(store.hotkeyConfig).not.toBeNull();
      expect(store.hotkeyConfig?.triggerMode).toBe("hold");
    });

    it("[P2] 重复呼叫 loadSettings 应只执行一次", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();
      await store.loadSettings();

      // store.get 在第一次 loadSettings 中被呼叫多次（key, mode, apiKey, prompt）
      // 第二次不应再呼叫
      const callCountAfterFirst = mockStoreGet.mock.calls.length;
      await store.loadSettings();
      expect(mockStoreGet.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  // ==========================================================================
  // saveHotkeyConfig
  // ==========================================================================

  describe("saveHotkeyConfig", () => {
    it("[P0] 应持久化 triggerKey 和 triggerMode 到 store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("command", "toggle");

      expect(mockStoreSet).toHaveBeenCalledWith("hotkeyTriggerKey", "command");
      expect(mockStoreSet).toHaveBeenCalledWith("hotkeyTriggerMode", "toggle");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 应更新 hotkeyConfig ref", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("shift", "hold");

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "shift",
        triggerMode: "hold",
      });
      expect(store.triggerMode).toBe("hold");
    });

    it("[P0] 应透过 invoke 同步 config 到 Rust", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("fn", "toggle");

      expect(mockInvoke).toHaveBeenCalledWith("update_hotkey_config", {
        triggerKey: "fn",
        triggerMode: "toggle",
      });
    });

    it("[P0] 应发送 SETTINGS_UPDATED 事件广播", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("option", "hold");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "hotkey",
        value: { triggerKey: "option", triggerMode: "hold" },
      });
    });

    it("[P1] SETTINGS_UPDATED payload 应包含正确的 key 和 value", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("control", "toggle");

      const emitCall = mockEmit.mock.calls[0];
      expect(emitCall[0]).toBe("settings:updated");
      expect(emitCall[1]).toEqual({
        key: "hotkey",
        value: { triggerKey: "control", triggerMode: "toggle" },
      });
    });
  });

  // ==========================================================================
  // saveDoubaoCredentials
  // ==========================================================================

  describe("saveDoubaoCredentials", () => {
    it("[P0] 应储存 trimmed App ID / Access Key", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveDoubaoCredentials("  app123  ", "  ak_abc123  ");

      expect(mockStoreSet).toHaveBeenCalledWith("doubaoAppId", "app123");
      expect(mockStoreSet).toHaveBeenCalledWith("doubaoAccessKey", "ak_abc123");
      expect(store.hasApiKey).toBe(true);
    });

    it("[P0] 空白凭据应抛出错误", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveDoubaoCredentials("   ", "ak")).rejects.toThrow(
        "API Key 不可为空",
      );
    });
  });

  // ==========================================================================
  // deleteApiKey
  // ==========================================================================

  describe("deleteApiKey", () => {
    it("[P0] 应从 store 删除 Doubao 凭据并清空状态", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveDoubaoCredentials("app", "ak_test");
      expect(store.hasApiKey).toBe(true);

      await store.deleteApiKey();

      expect(mockStoreDelete).toHaveBeenCalledWith("doubaoAppId");
      expect(mockStoreDelete).toHaveBeenCalledWith("doubaoAccessKey");
      expect(mockStoreSave).toHaveBeenCalled();
      expect(store.hasApiKey).toBe(false);
    });
  });

  // ==========================================================================
  // saveAiPrompt / resetAiPrompt
  // ==========================================================================

  describe("saveAiPrompt", () => {
    it("[P0] 应储存自订 prompt", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      // 先切到 custom 模式，getAiPrompt() 才回传 aiPrompt ref 值
      await store.savePromptMode("custom");
      await store.saveAiPrompt("自订 prompt 内容");

      expect(mockStoreSet).toHaveBeenCalledWith("aiPrompt", "自订 prompt 内容");
      expect(store.getAiPrompt()).toBe("自订 prompt 内容");
    });

    it("[P0] 空白 prompt 应抛出错误", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveAiPrompt("  ")).rejects.toThrow(
        "Prompt 不可为空",
      );
    });
  });

  describe("resetAiPrompt", () => {
    it("[P0] 应重置为预设 prompt", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveAiPrompt("自订内容");
      await store.resetAiPrompt();

      // 应恢复为当前语言的预设 prompt（非空）
      expect(store.getAiPrompt()).not.toBe("自订内容");
      expect(store.getAiPrompt().length).toBeGreaterThan(0);
      expect(mockStoreSet).toHaveBeenCalledWith(
        "aiPrompt",
        expect.stringContaining("简体中文"),
      );
    });
  });

  // ==========================================================================
  // saveEnhancementThreshold
  // ==========================================================================

  describe("saveEnhancementThreshold", () => {
    it("[P0] 应持久化 enabled 和 charCount 到 store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(false, 20);

      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdEnabled",
        false,
      );
      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdCharCount",
        20,
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 应更新 reactive refs", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(false, 25);

      expect(store.isEnhancementThresholdEnabled).toBe(false);
      expect(store.enhancementThresholdCharCount).toBe(25);
    });

    it("[P0] 应发送 SETTINGS_UPDATED 事件广播", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 15);

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "enhancementThreshold",
        value: { enabled: true, charCount: 15 },
      });
    });

    it("[P1] charCount < 1 应 fallback 到预设值", async () => {
      const { useSettingsStore, DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT } =
        await import("../../src/stores/useSettingsStore");
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 0);

      expect(store.enhancementThresholdCharCount).toBe(
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdCharCount",
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
    });

    it("[P1] 非整数 charCount 应 fallback 到预设值", async () => {
      const { useSettingsStore, DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT } =
        await import("../../src/stores/useSettingsStore");
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 3.5);

      expect(store.enhancementThresholdCharCount).toBe(
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
    });

    it("[P1] store 储存失败时应抛出错误", async () => {
      mockStoreSave.mockRejectedValueOnce(new Error("disk full"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveEnhancementThreshold(true, 10)).rejects.toThrow(
        "disk full",
      );
    });
  });

  // ==========================================================================
  // LLM custom headers
  // ==========================================================================

  describe("llmCustomHeaders", () => {
    it("[P0] 有效 JSON 对象应保存并可读回", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLlmCustomHeadersFromJson(
        '{"HTTP-Referer":"https://example.com","X-Title":"SayIt"}',
      );

      expect(mockStoreSet).toHaveBeenCalledWith("llmCustomHeaders", {
        "HTTP-Referer": "https://example.com",
        "X-Title": "SayIt",
      });
      expect(store.getLlmCustomHeaders()).toEqual({
        "HTTP-Referer": "https://example.com",
        "X-Title": "SayIt",
      });
    });

    it("[P0] 非法 JSON 应保留旧设置并抛本地化错误", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.saveLlmCustomHeaders({
        "HTTP-Referer": "https://keep.example",
      });
      mockStoreSet.mockClear();

      await expect(
        store.saveLlmCustomHeadersFromJson("{not-json"),
      ).rejects.toThrow();
      expect(store.getLlmCustomHeaders()).toEqual({
        "HTTP-Referer": "https://keep.example",
      });
      // 无效输入不得写入 store
      expect(
        mockStoreSet.mock.calls.some(
          (call) => (call as [string, unknown])[0] === "llmCustomHeaders",
        ),
      ).toBe(false);
    });

    it("[P0] 数组 / 空键 / 空值 / 非字符串值应拒绝", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.saveLlmCustomHeaders({ Keep: "yes" });

      await expect(store.saveLlmCustomHeadersFromJson("[]")).rejects.toThrow();
      await expect(
        store.saveLlmCustomHeadersFromJson('{"":"x"}'),
      ).rejects.toThrow();
      await expect(
        store.saveLlmCustomHeadersFromJson('{"A":""}'),
      ).rejects.toThrow();
      await expect(
        store.saveLlmCustomHeadersFromJson('{"A":1}'),
      ).rejects.toThrow();
      expect(store.getLlmCustomHeaders()).toEqual({ Keep: "yes" });
    });

    it("[P0] 空字串应保存为空对象", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.saveLlmCustomHeaders({ Old: "v" });
      await store.saveLlmCustomHeadersFromJson("   ");
      expect(store.getLlmCustomHeaders()).toEqual({});
    });

    it("[P0] loadSettings 与 refreshCrossWindowSettings 应读取 headers", async () => {
      mockStoreData.set("llmCustomHeaders", {
        "X-Title": "SayIt",
      });

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      expect(store.getLlmCustomHeaders()).toEqual({ "X-Title": "SayIt" });

      mockStoreData.set("llmCustomHeaders", {
        "HTTP-Referer": "https://sync.example",
      });
      await store.refreshCrossWindowSettings();
      expect(store.getLlmCustomHeaders()).toEqual({
        "HTTP-Referer": "https://sync.example",
      });
    });

    it("[P1] parseLlmCustomHeadersJson 不应在错误中包含 header 值", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      const result = store.parseLlmCustomHeadersJson(
        '{"secret":"should-not-appear"}',
      );
      // 合法输入
      expect(result.ok).toBe(true);
      const bad = store.parseLlmCustomHeadersJson('{"x":123}');
      expect(bad.ok).toBe(false);
      if (!bad.ok) {
        expect(bad.errorKey).not.toContain("123");
        expect(bad.errorKey).toMatch(/customHeaders/);
      }
    });
  });

  // ==========================================================================
  // refreshCrossWindowSettings
  // ==========================================================================

  describe("refreshCrossWindowSettings", () => {
    it("[P0] 应整包重新读取跨视窗会用到的设定", async () => {
      mockStoreData.set("hotkeyTriggerKey", "command");
      mockStoreData.set("hotkeyTriggerMode", "toggle");
      mockStoreData.set("customTriggerKey", { custom: { keycode: 321 } });
      mockStoreData.set("customTriggerKeyDomCode", "F13");
      mockStoreData.set("doubaoAppId", "app_sync");
      mockStoreData.set("doubaoAccessKey", "  ak_sync  ");
      mockStoreData.set("llmApiKey", "sk_sync");
      mockStoreData.set("llmBaseUrl", "https://example.com/v1");
      mockStoreData.set("llmCustomHeaders", {
        "HTTP-Referer": "https://sync.example",
      });
      mockStoreData.set("aiPrompt", "  同步后 prompt  ");
      mockStoreData.set("promptMode", "custom");
      mockStoreData.set("enhancementThresholdEnabled", true);
      mockStoreData.set("enhancementThresholdCharCount", 42);
      mockStoreData.set("llmModelId", "gpt-4o-mini");
      mockStoreData.set("muteOnRecording", false);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.refreshCrossWindowSettings();

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "command",
        triggerMode: "toggle",
      });
      expect(store.customTriggerKey).toEqual({ custom: { keycode: 321 } });
      expect(store.customTriggerKeyDomCode).toBe("F13");
      expect(store.getDoubaoAccessKey()).toBe("ak_sync");
      expect(store.getLlmApiKey()).toBe("sk_sync");
      expect(store.getLlmCustomHeaders()).toEqual({
        "HTTP-Referer": "https://sync.example",
      });
      expect(store.getAiPrompt()).toBe("同步后 prompt");
      expect(store.isEnhancementThresholdEnabled).toBe(true);
      expect(store.enhancementThresholdCharCount).toBe(42);
      expect(store.selectedLlmModelId).toBe("gpt-4o-mini");
      expect(store.selectedWhisperModelId).toBe("doubao-seedasr");
      expect(store.isMuteOnRecordingEnabled).toBe(false);
    });
  });

  // ==========================================================================
  // selectedTranscriptionLocale
  // ==========================================================================

  describe("selectedTranscriptionLocale", () => {
    it("[P0] loadSettings 应从 store 载入已储存的 transcriptionLocale", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("ja");
    });

    it("[P0] store 无 selectedTranscriptionLocale 时应预设为 selectedLocale（迁移）", async () => {
      mockStoreData.set("selectedLocale", "ko");
      // 不设定 selectedTranscriptionLocale 以触发迁移逻辑

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("ko");
      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "ko",
      );
    });

    it("[P0] getWhisperLanguageCode 应读取 selectedTranscriptionLocale（非 selectedLocale）", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      // transcriptionLocale 是 ja，不是 UI locale en
      expect(store.getWhisperLanguageCode()).toBe("ja");
    });

    it("[P0] getWhisperLanguageCode 在 auto 模式下应回传 null", async () => {
      mockStoreData.set("selectedLocale", "zh-CN");
      mockStoreData.set("selectedTranscriptionLocale", "auto");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.getWhisperLanguageCode()).toBeNull();
    });

    it("[P0] refreshCrossWindowSettings 应同步 selectedTranscriptionLocale", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.refreshCrossWindowSettings();

      expect(store.selectedTranscriptionLocale).toBe("ja");
    });
  });

  // ==========================================================================
  // saveLocale
  // ==========================================================================

  describe("saveLocale", () => {
    it("[P0] saveLocale('en') should persist to store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLocale("en");

      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "en");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveLocale should emit SETTINGS_UPDATED event", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLocale("ja");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "locale",
        value: "ja",
      });
    });
  });

  // ==========================================================================
  // loadSettings locale
  // ==========================================================================

  describe("loadSettings locale", () => {
    it("[P0] should load saved locale from store", async () => {
      mockStoreData.set("selectedLocale", "en");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      // When a saved locale exists, loadSettings should NOT re-set it
      // (the "first launch" path calls store.set("selectedLocale", detected))
      const selectedLocaleSetCallList = mockStoreSet.mock.calls.filter(
        (call) => call[0] === "selectedLocale",
      );
      expect(selectedLocaleSetCallList).toHaveLength(0);
    });
  });
});
