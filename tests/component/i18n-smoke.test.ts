import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import en from "../../src/i18n/locales/en.json";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import AccessibilityGuide from "../../src/components/AccessibilityGuide.vue";

describe("i18n smoke test", () => {
  it("[P0] 切换 locale 后 UI 文字应更新为对应语言", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "zh-CN",
      messages: { "zh-CN": zhCN, en },
    });

    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });

    // 验证 zh-CN 文字已正确渲染
    expect(wrapper.text()).toContain("需要辅助使用权限");
    const buttonListZh = wrapper.findAll("button");
    expect(buttonListZh[0].text()).toBe("打开系统设置");
    expect(buttonListZh[1].text()).toBe("稍后设置");

    // 切换到 English
    i18n.global.locale.value = "en";
    await wrapper.vm.$nextTick();

    // 验证 English 文字已正确渲染
    expect(wrapper.text()).toContain("Accessibility Permission Required");
    const buttonListEn = wrapper.findAll("button");
    expect(buttonListEn[0].text()).toBe("Open System Settings");
    expect(buttonListEn[1].text()).toBe("Later");
  });
});
