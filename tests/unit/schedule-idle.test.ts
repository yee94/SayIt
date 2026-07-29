import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDeferred,
  runWhenIdle,
  waitForNextPaint,
  yieldToMain,
} from "../../src/lib/scheduleIdle";
import { extractCorrections } from "../../src/lib/correctionLearner";

describe("scheduleIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("yieldToMain 后任务一定执行", async () => {
    let ran = false;
    await yieldToMain();
    ran = true;
    expect(ran).toBe(true);
  });

  it("runDeferred 保证 task 执行且不依赖 rAF", async () => {
    // 模拟 HUD 隐藏：rAF 永不回调 —— runDeferred 仍须完成
    vi.stubGlobal("requestAnimationFrame", () => 0);
    let value = 0;
    await runDeferred(() => {
      value = 42;
    });
    expect(value).toBe(42);
  });

  it("runDeferred 支持 async task", async () => {
    let value = "";
    await runDeferred(async () => {
      await Promise.resolve();
      value = "ok";
    });
    expect(value).toBe("ok");
  });

  it("runWhenIdle 在无 requestIdleCallback 时仍执行", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    let ran = false;
    await runWhenIdle(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("waitForNextPaint 在无 rAF 时也能 resolve", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    await expect(waitForNextPaint()).resolves.toBeUndefined();
  });

  it("学习关键路径：runDeferred 包裹 extractCorrections 结果与同步调用一致", async () => {
    const original = "如果用 Type less 的话怎么做";
    const corrected = "如果用 Typeless 的话怎么做";

    const syncResult = extractCorrections(original, corrected, []);
    let asyncResult: string[] = [];
    await runDeferred(() => {
      asyncResult = extractCorrections(original, corrected, []);
    });

    expect(asyncResult).toEqual(syncResult);
    expect(asyncResult).toContain("Typeless");
  });
});
