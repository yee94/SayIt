import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import DashboardView from "../../src/views/DashboardView.vue";
import zhTW from "../../src/i18n/locales/zh-TW.json";

const i18n = createI18n({
  legacy: false,
  locale: "zh-TW",
  messages: { "zh-TW": zhTW },
});

let historyState: ReturnType<typeof makeHistory>;
let settingsState: ReturnType<typeof makeSettings>;

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => historyState,
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(() => {}),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));

function makeHistory(usage: Record<string, number> = {}) {
  return {
    dashboardStats: {
      totalTranscriptions: 0,
      totalCharacters: 0,
      totalRecordingDurationMs: 0,
      estimatedTimeSavedMs: 0,
      dailyQuotaUsage: {
        whisperRequestCount: 0,
        whisperBilledAudioMs: 0,
        llmRequestCount: 0,
        llmTotalTokens: 0,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
        ...usage,
      },
    },
    dailyUsageTrendList: [],
    recentTranscriptionList: [],
    refreshDashboard: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    selectedLlmProviderId: "custom",
    selectedWhisperModelId: "doubao-seedasr",
    selectedLlmModelId: "gpt-4o-mini",
    ...overrides,
  };
}

const passThroughStub = { template: "<div><slot /></div>" };

function mountDashboard(renderTooltip = false) {
  return mount(DashboardView, {
    global: {
      plugins: [i18n],
      stubs: {
        DashboardUsageChart: true,
        TooltipProvider: passThroughStub,
        Tooltip: passThroughStub,
        TooltipTrigger: passThroughStub,
        TooltipContent: renderTooltip
          ? passThroughStub
          : { template: "<div />" },
      },
    },
  });
}

describe("DashboardView 額度卡片", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh-TW";
    historyState = makeHistory({ whisperRequestCount: 10, llmRequestCount: 5 });
    settingsState = makeSettings();
  });

  it("[P0] 自訂 endpoint：主體顯示今日用量（無免費額度）", () => {
    const text = mountDashboard().text();
    expect(text).toContain("今日用量");
    expect(text).toContain("計費");
  });

  it("[P0] 用量數字應反映 history store", () => {
    historyState = makeHistory({
      whisperRequestCount: 10,
      llmRequestCount: 8,
      llmTotalTokens: 4500,
    });
    const text = mountDashboard().text();
    expect(text).toContain("LLM");
    expect(text).toContain("8");
  });

  it("[P0] tooltip 保留付費方案提示", () => {
    const text = mountDashboard(true).text();
    expect(text).toContain("付費方案 — 無免費額度限制");
  });
});
