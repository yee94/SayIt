import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import NotchHud from "../../src/components/NotchHud.vue";

const { mockListen } = vi.hoisted(() => ({
  mockListen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emit: vi.fn().mockResolvedValue(undefined),
}));

const i18n = createI18n({
  legacy: false,
  locale: "zh-TW",
  messages: {
    "zh-TW": {
      voiceFlow: {
        vocabularyLearned: "已学习：{terms}",
        vocabularyLearnedTruncated: "已学习：{terms} 等 {count} 个词",
      },
    },
  },
});

function mountNotchHud(props: Record<string, unknown>) {
  return mount(NotchHud, {
    props: { isEditMode: false, ...props },
    global: {
      plugins: [i18n],
    },
  });
}

describe("NotchHud", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockListen.mockReset();
    mockListen.mockResolvedValue(vi.fn());
  });

  it("[P0] recording 状态应显示波形元素和计时器", () => {
    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 3,
      message: "",
    });

    expect(wrapper.find(".waveform-container").exists()).toBe(true);
    expect(wrapper.findAll(".waveform-element").length).toBe(6);
    expect(wrapper.find(".elapsed-timer").text()).toBe("0:03");
  });

  it("[P0] transcribing 状态应显示脉冲 dots", async () => {
    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 0,
      message: "",
    });

    await wrapper.setProps({ status: "transcribing" });
    expect(wrapper.find(".waveform-container").exists()).toBe(true);
  });

  it("[P0] success 状态应显示 SVG checkmark 和 converge dots", async () => {
    const wrapper = mountNotchHud({
      status: "success",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".checkmark-svg").exists()).toBe(true);
    expect(wrapper.find(".checkmark-svg path").attributes("stroke")).toBe(
      "#22c55e",
    );
    expect(wrapper.findAll(".waveform-converge").length).toBe(6);
  });

  it("[P0] error 状态无 message 且 canRetry=true 应显示 scatter dots 和 retry icon", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
      canRetry: true,
    });

    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    expect(wrapper.find(".retry-icon").exists()).toBe(true);
    expect(wrapper.find(".error-message").exists()).toBe(false);
  });

  it("[P0] error 状态 canRetry=false 不应显示 retry icon", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
      canRetry: false,
    });

    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    expect(wrapper.find(".retry-icon").exists()).toBe(false);
  });

  it("[P0] error 状态有 message 应在浏海下方显示错误讯息", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "API Key 未设置",
    });

    // scatter dots 仍在上排顯示
    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    // 訊息在獨立的下排
    expect(wrapper.find(".error-message-row").exists()).toBe(true);
    expect(wrapper.find(".error-message").text()).toBe("API Key 未设置");
    // notch 應展開
    expect(wrapper.find(".notch-hud").classes()).toContain(
      "notch-hud-expanded",
    );
  });

  it("[P0] idle 状态应隐藏整个 HUD", () => {
    const wrapper = mountNotchHud({
      status: "idle",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] error 状态的 retry icon 应 emit retry 事件", async () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
      canRetry: true,
    });

    await wrapper.find(".retry-icon").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("[P1] success 状态不应带有 notch-green-flash class（底色 flash 已移除）", () => {
    const wrapper = mountNotchHud({
      status: "success",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-hud").classes()).not.toContain(
      "notch-green-flash",
    );
  });

  it("[P1] error 状态应带有 notch-shake class", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-hud").classes()).toContain("notch-shake");
  });

  it("[P1] error → idle 应先进入 collapsing 再隐藏", async () => {
    vi.useFakeTimers();
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);

    await wrapper.setProps({ status: "idle" });
    await wrapper.vm.$nextTick();

    // collapsing 狀態中仍可見
    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).toContain("notch-collapsing");

    // 動畫結束後隱藏
    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] success → idle 应先进入 collapsing 再隐藏", async () => {
    vi.useFakeTimers();
    const wrapper = mountNotchHud({
      status: "success",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);

    await wrapper.setProps({ status: "idle" });
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).toContain("notch-collapsing");

    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] collapsing 期间切换到 recording 应取消收缩", async () => {
    vi.useFakeTimers();
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
    });

    await wrapper.setProps({ status: "idle" });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-hud").classes()).toContain("notch-collapsing");

    // 收縮期間切換到 recording
    await wrapper.setProps({ status: "recording" });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).not.toContain(
      "notch-collapsing",
    );

    // 推進時間後不應隱藏
    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
  });

  it("[P1] 波形 listener 晚到时应立即解除，避免残留监听", async () => {
    let resolveListen!: (unlisten: () => void) => void;
    const deferredListen = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    const mockUnlisten = vi.fn();
    mockListen.mockImplementationOnce(async () => deferredListen);

    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 0,
      message: "",
    });

    await wrapper.setProps({ status: "idle" });
    resolveListen(mockUnlisten);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("[P0] transcribing 且有 liveTranscript 应在留海内扩展显示一行字幕", async () => {
    const wrapper = mountNotchHud({
      status: "transcribing",
      recordingElapsedSeconds: 0,
      message: "",
      liveTranscript: "你好世界这是即时字幕",
    });

    expect(wrapper.find(".live-transcript-row").exists()).toBe(true);
    expect(wrapper.find(".live-transcript-bdi").text()).toBe(
      "你好世界这是即时字幕",
    );
    // 與 error/learned 相同：黑底圓角向下擴展
    expect(wrapper.find(".notch-hud").classes()).toContain(
      "notch-hud-expanded",
    );
    expect(wrapper.find(".notch-hud").attributes("style") ?? "").toMatch(
      /height:\s*72px/,
    );
  });

  it("[P0] recording 状态有 liveTranscript 时应显示字幕", () => {
    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 1,
      message: "",
      liveTranscript: "即时字幕",
    });

    expect(wrapper.find(".live-transcript-row").exists()).toBe(true);
    expect(wrapper.find(".live-transcript-bdi").text()).toBe("即时字幕");
  });

  it("[P0] transcribing 无 liveTranscript 不显示字幕列、保持预设高度", () => {
    const wrapper = mountNotchHud({
      status: "transcribing",
      recordingElapsedSeconds: 0,
      message: "",
      liveTranscript: "",
    });

    expect(wrapper.find(".live-transcript-row").exists()).toBe(false);
    expect(wrapper.find(".notch-hud").classes()).not.toContain(
      "notch-hud-expanded",
    );
    expect(wrapper.find(".notch-hud").attributes("style") ?? "").toMatch(
      /height:\s*42px/,
    );
  });

  it("[P0] 有 liveTranscript 后才从 42 撑到 72", async () => {
    const wrapper = mountNotchHud({
      status: "transcribing",
      recordingElapsedSeconds: 0,
      message: "",
      liveTranscript: "",
    });

    expect(wrapper.find(".notch-hud").attributes("style") ?? "").toMatch(
      /height:\s*42px/,
    );

    await wrapper.setProps({ liveTranscript: "第一句 partial" });
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".live-transcript-row").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).toContain(
      "notch-hud-expanded",
    );
    expect(wrapper.find(".notch-hud").attributes("style") ?? "").toMatch(
      /height:\s*72px/,
    );
  });
});
