import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SupportedLocale } from "../../src/i18n/languageConfig";

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

describe("i18n 设定功能", () => {
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
  // saveLocale
  // ==========================================================================

  describe("saveLocale", () => {
    it("[P0] saveLocale('en') 应正确存入 store 并更新 i18n.global.locale", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveLocale("en");

      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "en");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveLocale('ja') 应更新 document.documentElement.lang 为 'ja'", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveLocale("ja");

      expect(document.documentElement.lang).toBe("ja");
    });
  });

  // ==========================================================================
  // getWhisperLanguageCode
  // ==========================================================================

  describe("getWhisperLanguageCode", () => {
    const testCaseList: [SupportedLocale, string][] = [
      ["zh-CN", "zh"],
      ["en", "en"],
      ["ja", "ja"],
      ["ko", "ko"],
    ];

    it.each(testCaseList)(
      "[P0] locale '%s' → whisperCode '%s'",
      async (locale, expectedCode) => {
        mockStoreData.set("selectedLocale", locale);

        const { useSettingsStore } = await import(
          "../../src/stores/useSettingsStore"
        );
        const store = useSettingsStore();
        await store.loadSettings();

        expect(store.getWhisperLanguageCode()).toBe(expectedCode);
      },
    );
  });

  // ==========================================================================
  // TranscriptionLocale 类型与 auto 选项
  // ==========================================================================

  describe("TranscriptionLocale", () => {
    it("[P0] getWhisperCodeForTranscriptionLocale('auto') 应回传 null", async () => {
      const { getWhisperCodeForTranscriptionLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(getWhisperCodeForTranscriptionLocale("auto")).toBeNull();
    });

    it("[P0] getWhisperCodeForTranscriptionLocale 各语言应回传正确的 whisperCode", async () => {
      const { getWhisperCodeForTranscriptionLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(getWhisperCodeForTranscriptionLocale("zh-CN")).toBe("zh");
      expect(getWhisperCodeForTranscriptionLocale("en")).toBe("en");
      expect(getWhisperCodeForTranscriptionLocale("ja")).toBe("ja");
      expect(getWhisperCodeForTranscriptionLocale("ko")).toBe("ko");
    });

    it("[P0] TRANSCRIPTION_LANGUAGE_OPTIONS 应包含 auto + 4 个语言选项", async () => {
      const { TRANSCRIPTION_LANGUAGE_OPTIONS } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(TRANSCRIPTION_LANGUAGE_OPTIONS).toHaveLength(5);
      expect(TRANSCRIPTION_LANGUAGE_OPTIONS[0].locale).toBe("auto");
      expect(TRANSCRIPTION_LANGUAGE_OPTIONS[0].whisperCode).toBeNull();

      const localeList = TRANSCRIPTION_LANGUAGE_OPTIONS.map(
        (opt: { locale: string }) => opt.locale,
      );
      expect(localeList).toContain("auto");
      expect(localeList).toContain("zh-CN");
      expect(localeList).toContain("en");
      expect(localeList).toContain("ja");
      expect(localeList).toContain("ko");
      expect(localeList).not.toContain("zh-TW");
    });
  });

  // ==========================================================================
  // saveTranscriptionLocale
  // ==========================================================================

  describe("saveTranscriptionLocale", () => {
    it("[P0] saveTranscriptionLocale('ja') 应正确存入 store", async () => {
      mockStoreData.set("selectedLocale", "zh-CN");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveTranscriptionLocale("ja");

      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "ja",
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveTranscriptionLocale 应发送 SETTINGS_UPDATED event", async () => {
      mockStoreData.set("selectedLocale", "zh-CN");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveTranscriptionLocale("en");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "transcriptionLocale",
        value: "en",
      });
    });

    it("[P0] saveTranscriptionLocale('auto') 后 getWhisperLanguageCode 应回传 null", async () => {
      mockStoreData.set("selectedLocale", "zh-CN");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveTranscriptionLocale("auto");

      expect(store.getWhisperLanguageCode()).toBeNull();
    });
  });

  // ==========================================================================
  // detectSystemLocale
  // ==========================================================================

  describe("detectSystemLocale", () => {
    it("[P0] 系统繁体精确匹配：navigator.languages=['zh-Hant-TW'] → 'zh-CN'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hant-TW"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });

    it("[P0] 系统繁体 script subtag：navigator.languages=['zh-Hant'] → 'zh-CN'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hant"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });

    it("[P0] 系统 zh-TW 精确匹配：navigator.languages=['zh-TW'] → 'zh-CN'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-TW"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });

    it("[P0] script subtag 匹配：navigator.languages=['zh-Hans'] → 'zh-CN'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hans"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });

    it("[P0] 前缀匹配：navigator.languages=['ja-JP'] → 'ja'", async () => {
      vi.stubGlobal("navigator", { languages: ["ja-JP"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("ja");

      vi.unstubAllGlobals();
    });

    it("[P0] 无匹配时 fallback 为 'zh-CN'：navigator.languages=['th']", async () => {
      vi.stubGlobal("navigator", { languages: ["th"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });
  });

  // ==========================================================================
  // 历史 locale 迁移
  // ==========================================================================

  describe("历史 locale 迁移", () => {
    it("[P0] selectedLocale='zh-TW' 应迁移为 zh-CN 并持久化", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedLocale).toBe("zh-CN");
      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "zh-CN");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] selectedTranscriptionLocale='zh-TW' 应迁移为 zh-CN 并持久化", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("zh-CN");
      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "zh-CN",
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 非法 selectedLocale 应规范为 FALLBACK zh-CN 并持久化", async () => {
      mockStoreData.set("selectedLocale", "fr-FR");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedLocale).toBe("zh-CN");
      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "zh-CN");
    });

    it("[P0] 非法 selectedTranscriptionLocale 应回退到 UI locale 并持久化", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "not-a-locale");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("en");
      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "en",
      );
    });

    it("[P0] normalizeSupportedLocale / normalizeTranscriptionLocale 单元行为", async () => {
      const {
        normalizeSupportedLocale,
        normalizeTranscriptionLocale,
      } = await import("../../src/i18n/languageConfig");

      expect(normalizeSupportedLocale("zh-TW")).toBe("zh-CN");
      expect(normalizeSupportedLocale("zh-CN")).toBe("zh-CN");
      expect(normalizeSupportedLocale("en")).toBe("en");
      expect(normalizeSupportedLocale("invalid")).toBeNull();
      expect(normalizeTranscriptionLocale("auto")).toBe("auto");
      expect(normalizeTranscriptionLocale("zh-TW")).toBe("zh-CN");
      expect(normalizeTranscriptionLocale("bad")).toBeNull();
    });
  });

  // ==========================================================================
  // Prompt auto-switch
  // ==========================================================================

  describe("转录语言切换 prompt 连动", () => {
    it("[P0] 未自订 prompt 时，切换转录语言应自动更新为新语言预设", async () => {
      // 明确设定起始 locale 为 zh-CN（避免 jsdom 环境 detectSystemLocale 不稳定）
      mockStoreData.set("selectedLocale", "zh-CN");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getMinimalPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getMinimalPromptForLocale("zh-CN");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 切换转录语言为 English（prompt 应跟着切换，但不存档）
      mockStoreSet.mockClear();
      await store.saveTranscriptionLocale("en");

      const enDefault = getMinimalPromptForLocale("en");
      expect(store.getAiPrompt()).toBe(enDefault);

      // prompt 不应被自动写入 store（使用者需手动储存）
      const aiPromptSetCallList = mockStoreSet.mock.calls.filter(
        ([key]: [string, unknown]) => key === "aiPrompt",
      );
      expect(aiPromptSetCallList).toHaveLength(0);
    });

    it("[P0] 已自订 prompt 时，切换转录语言不应改变 prompt", async () => {
      const customPrompt = "我的自订 prompt 内容";
      mockStoreData.set("selectedLocale", "zh-CN");
      mockStoreData.set("aiPrompt", customPrompt);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.getAiPrompt()).toBe(customPrompt);

      await store.saveTranscriptionLocale("en");

      expect(store.getAiPrompt()).toBe(customPrompt);
    });

    it("[P0] 转录语言为特定语言时，切换 UI 语言不应改变 prompt", async () => {
      mockStoreData.set("selectedLocale", "zh-CN");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getMinimalPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getMinimalPromptForLocale("zh-CN");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 转录语言为 zh-CN（非 auto），切换 UI 语言不影响 prompt
      await store.saveLocale("en");

      expect(store.getAiPrompt()).toBe(zhDefault);
    });

    it("[P0] 转录语言为 auto 时，切换 UI 语言应更新 prompt（仅记忆体）", async () => {
      mockStoreData.set("selectedLocale", "zh-CN");
      mockStoreData.set("selectedTranscriptionLocale", "auto");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getMinimalPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getMinimalPromptForLocale("zh-CN");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 转录语言为 auto，切换 UI 语言 → prompt 跟着切换
      mockStoreSet.mockClear();
      await store.saveLocale("en");

      const enDefault = getMinimalPromptForLocale("en");
      expect(store.getAiPrompt()).toBe(enDefault);

      // prompt 不应被自动写入 store
      const aiPromptSetCallList = mockStoreSet.mock.calls.filter(
        ([key]: [string, unknown]) => key === "aiPrompt",
      );
      expect(aiPromptSetCallList).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 翻译档 key 一致性验证
  // ==========================================================================

  describe("翻译档 key 一致性", () => {
    it("[P0] 所有 4 个 locale JSON 档的 key 集合应完全一致", async () => {
      const en = await import("../../src/i18n/locales/en.json");
      const ja = await import("../../src/i18n/locales/ja.json");
      const zhCN = await import("../../src/i18n/locales/zh-CN.json");
      const ko = await import("../../src/i18n/locales/ko.json");

      function getKeyList(obj: Record<string, unknown>, prefix = ""): string[] {
        const keyList: string[] = [];
        for (const k of Object.keys(obj).sort()) {
          const full = prefix ? `${prefix}.${k}` : k;
          if (typeof obj[k] === "object" && obj[k] !== null) {
            keyList.push(
              ...getKeyList(obj[k] as Record<string, unknown>, full),
            );
          } else {
            keyList.push(full);
          }
        }
        return keyList;
      }

      const baseKeyList = getKeyList(zhCN.default);
      const localeMap: Record<string, string[]> = {
        en: getKeyList(en.default),
        ja: getKeyList(ja.default),
        ko: getKeyList(ko.default),
      };

      for (const [locale, keyList] of Object.entries(localeMap)) {
        const missingKeyList = baseKeyList.filter((k) => !keyList.includes(k));
        const extraKeyList = keyList.filter((k) => !baseKeyList.includes(k));

        expect(
          missingKeyList,
          `${locale} 缺少以下 key: ${missingKeyList.join(", ")}`,
        ).toHaveLength(0);
        expect(
          extraKeyList,
          `${locale} 多出以下 key: ${extraKeyList.join(", ")}`,
        ).toHaveLength(0);
      }
    });
  });
});
