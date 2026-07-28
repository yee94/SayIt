import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock tauri-plugin-store
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreDelete = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
    delete: mockStoreDelete,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-CN" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/i18n/prompts", async () => {
  const LEGACY_PROMPT = "你是文字校对工具，不是对话助理。";
  const MINIMAL_PROMPT = "你是语音逐字稿的文字校对工具。";
  const ACTIVE_PROMPT = "你是语音逐字稿整理工具。";

  return {
    getMinimalPromptForLocale: () => MINIMAL_PROMPT,
    getPromptForModeAndLocale: (mode: string) =>
      mode === "active" ? ACTIVE_PROMPT : MINIMAL_PROMPT,
    isKnownDefaultPrompt: (prompt: string) => {
      const trimmed = prompt.trim();
      return trimmed === LEGACY_PROMPT || trimmed === MINIMAL_PROMPT;
    },
    MINIMAL_PROMPTS: { "zh-CN": MINIMAL_PROMPT },
    ACTIVE_PROMPTS: { "zh-CN": ACTIVE_PROMPT },
  };
});

vi.mock("../../src/i18n/languageConfig", () => ({
  FALLBACK_LOCALE: "zh-CN",
  detectSystemLocale: () => "zh-CN",
  getHtmlLangForLocale: () => "zh-Hans",
  getWhisperCodeForTranscriptionLocale: () => null,
  normalizeSupportedLocale: (value: unknown) =>
    value === "zh-CN" || value === "en" || value === "ja" || value === "ko"
      ? value
      : value === "zh-TW"
        ? "zh-CN"
        : null,
  normalizeTranscriptionLocale: (value: unknown) =>
    value === "auto"
      ? "auto"
      : value === "zh-CN" || value === "en" || value === "ja" || value === "ko"
        ? value
        : value === "zh-TW"
          ? "zh-CN"
          : null,
}));

vi.mock("../../src/lib/enhancer", () => ({
  getDefaultSystemPrompt: () => "你是语音逐字稿的文字校对工具。",
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn(),
  SETTINGS_UPDATED: "settings:updated",
}));

vi.mock("../../src/lib/errorUtils", () => ({
  extractErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getHotkeyRecordingTimeoutMessage: () => "",
  getHotkeyUnsupportedKeyMessage: () => "",
  getHotkeyPresetHint: () => "",
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../../src/lib/keycodeMap", () => ({
  getKeyDisplayName: () => "",
  getPlatformKeycode: () => 0,
  isPresetEquivalentKey: () => false,
  getDangerousKeyWarning: () => null,
  getEscapeReservedMessage: () => null,
}));

vi.mock("../../src/lib/modelRegistry", () => ({
  DEFAULT_LLM_MODEL_ID: "test-llm",
  DEFAULT_LLM_PROVIDER_ID: "custom",
  DEFAULT_WHISPER_MODEL_ID: "doubao-seedasr",
  DOUBAO_ASR_MODEL_ID: "doubao-seedasr",
  getEffectiveLlmModelId: (id: string | null) => id ?? "test-llm",
  getEffectiveWhisperModelId: () => "doubao-seedasr",
  getModelListByProvider: () => [],
  getDefaultModelIdForProvider: () => "test-llm",
  findLlmModelConfig: () => undefined,
}));

vi.mock("../../src/lib/llmProvider", () => ({
  DEFAULT_LLM_BASE_URL: "https://api.openai.com/v1/chat/completions",
}));

describe("useSettingsStore — prompt mode 迁移", () => {
  beforeEach(() => {
    vi.resetModules();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    mockStoreSave.mockReset();
    mockStoreDelete.mockReset();

    // Default: return null for all keys
    mockStoreGet.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupStoreGetMock(overrides: Record<string, unknown>) {
    mockStoreGet.mockImplementation((key: string) => {
      if (key in overrides) return Promise.resolve(overrides[key]);
      return Promise.resolve(null);
    });
  }

  async function createStore() {
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    return useSettingsStore();
  }

  it("[P0] 新安装（store 无 promptMode 且无 aiPrompt）→ 设为 minimal", async () => {
    setupStoreGetMock({});
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("minimal");
  });

  it("[P0] 旧版默认 prompt（匹配 LEGACY）→ 迁移为 minimal", async () => {
    setupStoreGetMock({
      aiPrompt: "你是文字校对工具，不是对话助理。",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("minimal");
  });

  it("[P0] 旧版自定义 prompt（不匹配任何默认）→ 迁移为 custom，保留原文", async () => {
    const customPrompt = "我的自定义 prompt 完全不一样";
    setupStoreGetMock({
      aiPrompt: customPrompt,
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("custom");
    expect(store.getAiPrompt()).toBe(customPrompt);
  });

  it("[P0] 已有 promptMode（非迁移）→ 直接使用存的值", async () => {
    setupStoreGetMock({
      promptMode: "active",
      aiPrompt: "some prompt",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("active");
  });

  it("[P0] getAiPrompt() minimal 模式 → 返回 minimal preset", async () => {
    setupStoreGetMock({
      promptMode: "minimal",
    });
    const store = await createStore();
    await store.loadSettings();

    const prompt = store.getAiPrompt();
    expect(prompt).toBe("你是语音逐字稿的文字校对工具。");
  });

  it("[P0] getAiPrompt() active 模式 → 返回 active preset", async () => {
    setupStoreGetMock({
      promptMode: "active",
    });
    const store = await createStore();
    await store.loadSettings();

    const prompt = store.getAiPrompt();
    expect(prompt).toBe("你是语音逐字稿整理工具。");
  });

  it("[P0] getAiPrompt() custom 模式 → 返回 aiPrompt ref 值", async () => {
    const customPrompt = "完全自定义的 prompt";
    setupStoreGetMock({
      promptMode: "custom",
      aiPrompt: customPrompt,
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe(customPrompt);
  });
});
