/**
 * 把非 UI 关键工作排到下一帧 / idle 时段，避免堵住 WebView 渲染与 CSS 动画。
 *
 * 约定：
 * - **学习关键路径**（差分 / 落库 / 发通知）只用 `yieldToMain` / `runAfterPaint`，
 *   保证下一事件循环一定执行，不会因动画忙而饿死。
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

/** 等浏览器画完至少一帧（双 rAF，覆盖 layout/paint） */
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
 * 学习关键路径：先让出一帧，再执行任务。
 * 不依赖 requestIdleCallback，避免连续动画时任务被拖到 timeout 才跑。
 */
export async function runAfterPaint(
  task: () => void | Promise<void>,
): Promise<void> {
  await yieldToMain();
  await waitForNextPaint();
  await task();
}

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
