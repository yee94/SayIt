import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import zhCN from "../../src/i18n/locales/zh-CN.json";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(() => {}),
  emitEvent: vi.fn(),
  HOTKEY_RECORDING_CAPTURED: "hotkey-recording-captured",
  HOTKEY_RECORDING_REJECTED: "hotkey-recording-rejected",
  SETTINGS_UPDATED: "settings-updated",
}));
vi.mock("../../src/composables/useAudioPreview", () => ({
  useAudioPreview: () => ({
    isPreviewActive: { value: false },
    previewLevel: { value: 0 },
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
  }),
}));
vi.mock("../../src/lib/connectionTest", () => ({
  testLlmConnection: vi.fn(),
  testAsrConnection: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  })),
}));

describe("SettingsView LLM card", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders LLM config fields", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "zh-CN",
      messages: { "zh-CN": zhCN },
    });
    const { default: SettingsView } = await import("../../src/views/SettingsView.vue");
    let err: unknown = null;
    let wrapper;
    try {
      wrapper = mount(SettingsView, {
        global: {
          plugins: [createPinia(), i18n],
        },
      });
      await flushPromises();
    } catch (e) {
      err = e;
      console.error("MOUNT ERROR", e);
    }
    expect(err).toBeNull();
    const html = wrapper!.html();
    console.log(html.includes('id="llm-base-url"') ? "HAS llm-base-url" : "MISSING llm-base-url");
    console.log(html.includes("自定义 Header") ? "HAS custom header" : "MISSING custom header");
    const idx = html.indexOf("LLM");
    console.log(html.slice(Math.max(0, idx - 50), idx + 1200));
    expect(html).toContain("llm-base-url");
  });
});
