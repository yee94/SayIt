/**
 * 把非 UI 关键工作排到下一事件循环 / idle 时段，避免堵住 WebView 渲染与 CSS 动画。
 *
 * 约定：
 * - **学习关键路径**只用 `yieldToMain` / `runDeferred`：MessageChannel / setTimeout，
 *   在 HUD 隐藏时也一定会跑（不要用 rAF —— 隐藏窗口 rAF 会挂起，导致学习延迟到下次录音才完成）。
 * - `waitForNextPaint` 仅用于窗口可见时的纯 UI 分帧。
 * - `runWhenIdle` 仅用于诊断类非关键工作。
 */

/** 让出主线程（优先 MessageChannel，比 setTimeout(0) 更快回到事件循环） */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== "undefined") {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(undefined);
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * 等浏览器画完至少一帧（双 rAF）。
 * ⚠️ 窗口隐藏/后台时 rAF 可能长时间不回调，学习关键路径禁止使用。
 */
export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "undefined") {
      setTimeout(resolve, 16);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * 学习关键路径：只让出当前任务，再执行（不依赖 rAF / idle）。
 * HUD 隐藏时也能在下一个 macrotask 内跑完，避免与下一次录音叠在一起。
 */
export async function runDeferred(
  task: () => void | Promise<void>,
): Promise<void> {
  await yieldToMain();
  await task();
}

/** @deprecated 使用 runDeferred；保留别名以免旧调用断裂 */
export const runAfterPaint = runDeferred;

/**
 * 在 idle 时执行；timeout 内强制跑，避免一直饿死。
 * 仅用于诊断等非关键路径；学习落库请用 `runAfterPaint`。
 */
export function runWhenIdle(
  task: () => void | Promise<void>,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 1_500;
  return new Promise((resolve, reject) => {
    const run = () => {
      void Promise.resolve()
        .then(() => task())
        .then(() => resolve())
        .catch(reject);
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => run(), { timeout: timeoutMs });
      return;
    }
    setTimeout(run, 0);
  });
}
