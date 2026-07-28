---
title: 'ESC 全域中断操作'
slug: 'esc-global-abort'
created: '2026-03-15'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Rust (CGEventTap / WH_KEYBOARD_LL)', 'Vue 3 + Pinia', 'TypeScript']
files_to_modify: ['src-tauri/src/plugins/hotkey_listener.rs', 'src-tauri/src/lib.rs', 'src/stores/useVoiceFlowStore.ts', 'src/components/NotchHud.vue', 'src/types/index.ts', 'src/types/events.ts', 'src/composables/useTauriEvents.ts', 'src/stores/useSettingsStore.ts', 'src/i18n/locales/zh-TW.json', 'src/i18n/locales/en.json', 'src/i18n/locales/ja.json', 'src/i18n/locales/zh-CN.json', 'src/i18n/locales/ko.json']
code_patterns: ['Tauri event emit/listen pattern', 'CGEventTap KeyDown/KeyUp event handling', 'WH_KEYBOARD_LL hook_proc callback', 'VoiceFlow state machine (transitionTo)', 'AbortController/AbortSignal for HTTP cancellation', 'fire-and-forget async with void']
test_patterns: ['Rust inline #[cfg(test)] mod tests in hotkey_listener.rs', 'No frontend test files']
---

# Tech-Spec: ESC 全域中断操作

**Created:** 2026-03-15

## Overview

### Problem Statement

使用者在 recording / transcribing / enhancing 任何阶段都无法中途取消操作，必须等待操作完成或超时才能回到 idle 状态，体验不佳。特别是 transcribing 和 enhancing 阶段的 Groq API 呼叫可能长达 5-30 秒，使用者被迫等待。

### Solution

在现有 hotkey listener（CGEventTap / WH_KEYBOARD_LL）中加入 ESC keycode 监听，按下时发送 `escape:pressed` event。前端 VoiceFlow store 收到事件后根据当前状态执行对应的中断逻辑：停止录音、放弃 API 回应、丢弃结果。HUD 显示「已取消」视觉回馈后收起。

### Scope

**In Scope:**
- ESC 键监听（macOS CGEventTap + Windows WH_KEYBOARD_LL）
- recording 阶段中断：停止录音、丢弃录音资料
- transcribing 阶段中断：放弃等待 Groq Whisper API 回应
- enhancing 阶段中断：放弃等待 Groq LLM API 回应
- HUD「已取消」视觉回馈（短暂显示后收起）
- 还原系统音量（如果录音时有静音）

**Out of Scope:**
- ESC 键的自订设定（固定为 ESC）
- 保留已取消的录音档供后续重试
- 中断 quality monitor / correction monitor
- idle 或 success/error 状态下的 ESC 行为

## Context for Development

### Codebase Patterns

- **Hotkey listener 架构**：`hotkey_listener.rs` 使用 CGEventTap（macOS）和 WH_KEYBOARD_LL（Windows）全域键盘监听。事件回调中比对 keycode，符合时呼叫 `handle_key_event()` 并透过 `app_handle.emit()` 发送事件到前端。
- **VoiceFlow 状态机**：`useVoiceFlowStore.ts` 透过 `transitionTo()` 管理状态转换（idle → recording → transcribing → enhancing → success/error → idle），每次转换都 emit `voice-flow:state-changed` 事件。
- **Event 通讯**：所有 Rust → Frontend 事件常量定义在 `useTauriEvents.ts`，payload 型别定义在 `types/events.ts`。
- **非同步操作模式**：`handleStartRecording()` 和 `handleStopRecording()` 以 `void` fire-and-forget 启动，无 await 阻断。`handleStopRecording()` 是单一 async 函式，依序执行 stop_recording → transcribe_audio → enhanceText → paste_text。
- **AbortSignal 已就绪**：`enhancer.ts` 的 `enhanceText()` 已支援 `signal?: AbortSignal` 参数，`withTimeout()` 函式完整支援 abort 逻辑。AbortError 会被抛出并由呼叫方 catch。
- **Cancel token 模式**：`keyboard_monitor.rs` 使用 `Arc<AtomicBool>` 作为 cancel token 控制监测生命周期。

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/plugins/hotkey_listener.rs` | 全域键盘监听（ESC keycode 侦测插入点）|
| `src-tauri/src/lib.rs` | Tauri command 注册（invoke_handler 列表）|
| `src/stores/useVoiceFlowStore.ts` | VoiceFlow 状态机（abort 逻辑核心）|
| `src/components/NotchHud.vue` | HUD 视觉模式（新增 cancelled 视觉）|
| `src/types/index.ts` | `HudStatus` 型别定义 |
| `src/types/events.ts` | Event payload 型别定义 |
| `src/composables/useTauriEvents.ts` | Event 常量定义 |
| `src/lib/enhancer.ts` | `enhanceText()` — 已有 AbortSignal 支援（不需修改）|
| `src-tauri/src/plugins/keyboard_monitor.rs` | cancel_token 模式参考（不需修改）|

### Technical Decisions

1. **ESC 监听方式**：扩充现有 `hotkey_listener.rs` 的 event tap/hook callback，在 `KeyDown` 事件中加入 ESC keycode 判断（macOS: 53, Windows: VK_ESCAPE 0x1B）。共用同一个 listener，不新增 event tap。emit 独立事件 `escape:pressed`，不经过 `handle_key_event()`（ESC 不是 trigger key，不影响 press/release 状态）。注意：CGEventTap 为 `ListenOnly` 模式，callback return value 不影响事件传递；ESC 判断为 true 时提前 `return None` 跳过后续 trigger key matching 逻辑，而非「消费」该事件。

2. **前端中断策略（分阶段）**：
   - **recording**：呼叫 `stop_recording` 停止录音硬体 → 设 `isRecording = false` → 不进行后续转录
   - **transcribing**：设 `isAborted` flag + `isRecording = false` → 当 `transcribe_audio` invoke 回传时检查 flag → 丢弃结果（Rust 端 HTTP 请求无法取消，但结果被忽略）
   - **enhancing**：呼叫 `abortController.abort()` 中断 `enhanceText()` 的 fetch 请求 + 设 `isRecording = false` → `withTimeout()` 抛出 AbortError → 由 `handleStopRecording` 的 catch 处理（但因 `isAborted` 为 true，不走 fallback 流程）
   - **关键**：`handleEscapeAbort()` 必须在所有状态下无条件设定 `isRecording.value = false`，否则 `handleStartRecording()` 的 `if (isRecording.value) return;` guard 会永久阻止后续录音。

3. **Hold 模式竞态保护**：ESC 在 recording 状态触发 `handleEscapeAbort()`，但使用者松开 trigger key 时 `handleStopRecording()` 仍可能被触发。解法：在 `handleStopRecording()` 开头加入 `if (isAborted.value) return;` guard，确保已中断的流程不会重复执行。

4. **Toggle 模式同步**：ESC 中断后呼叫新增的 `reset_hotkey_state` command 重置 `is_toggled_on` / `is_pressed`，避免 toggle 模式下状态不同步（需要多按一次才能重新开始）。

5. **HUD 视觉回馈**：新增 `"cancelled"` 到 `HudStatus` 型别。NotchHud 收到此状态时显示 X 图示 + "已取消" 文字，使用淡灰色调，使用预设 notch shape（与其他模式一致）。显示 1 秒后 collapse 收起（与 success 同时长）。

6. **Retry 流程保护**：`handleRetryTranscription()` 也需加入 `isAborted` 检查，中断逻辑与主流程一致。

7. **ESC 作为 Custom key 的冲突防护**：在设定介面禁止使用者选择 ESC (macOS keycode 53 / Windows VK 0x1B) 作为 Custom trigger key，避免 ESC 中断逻辑覆盖 trigger key 功能。

8. **资源清理**：`handleEscapeAbort()` 必须清理所有进行中的资源：`stopMonitorPolling()`、`stopCorrectionSnapshotPolling()`、`cleanupCorrectionMonitorListener()`、`clearDelayedMuteTimer()`、`stopElapsedTimer()`、`restoreSystemAudio()`。

## Implementation Plan

### Tasks

- [x] **Task 1**：Rust — 新增 ESC keycode 常量
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `macos_keycodes` module 新增 `pub const ESCAPE: u16 = 53;`
  - Action: 在 `windows_hook` module 新增 `const VK_ESCAPE: u32 = 0x1B;`

- [x] **Task 2**：Rust — macOS CGEventTap 侦测 ESC
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `start_event_tap` closure 的 `CGEventType::KeyDown` arm 中，于现有 trigger key 判断之前，加入 ESC keycode 检查。若 keycode == `macos_keycodes::ESCAPE`（53），直接 emit `"escape:pressed"` 事件（空 payload），然后提前 `return None` 跳过后续 trigger key matching 逻辑。
  - Notes: ESC 只需侦测 KeyDown（按下即触发），不需处理 KeyUp。不经过 `handle_key_event()`。CGEventTap 为 `ListenOnly` 模式，`return None` 不会消费事件，仅用于跳过后续程式码。

- [x] **Task 3**：Rust — Windows hook_proc 侦测 ESC
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `hook_proc` 函式中，`is_key_down || is_key_up` 判断区块内，于 trigger key matching 之前，加入 ESC 判断：若 `kbd.vkCode == VK_ESCAPE && is_key_down`，emit `"escape:pressed"` 事件。
  - Notes: 需要让 `hook_proc` 能存取 `AppHandle`。目前 `HookContext` 只有 `trigger_key` 和 `key_handler`，需加入 `escape_handler: Box<dyn Fn() + Send + Sync>`（或直接存一个 Arc 的 AppHandle 到 static context）。

- [x] **Task 4**：Rust — 新增 `reset_hotkey_state` Tauri command
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 新增公开函式（使用 `State` extractor，与 codebase 现有惯例一致）：
    ```rust
    #[tauri::command]
    pub fn reset_hotkey_state(state: tauri::State<'_, HotkeyListenerState>) {
        state.reset_key_states();
    }
    ```
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `invoke_handler` 的 `generate_handler![]` 阵列中加入 `plugins::hotkey_listener::reset_hotkey_state`

- [x] **Task 5**：Frontend types — 新增 `"cancelled"` 到 HudStatus
  - File: `src/types/index.ts`
  - Action: 在 `HudStatus` union type 加入 `| "cancelled"`：
    ```typescript
    export type HudStatus =
      | "idle"
      | "recording"
      | "transcribing"
      | "enhancing"
      | "success"
      | "error"
      | "cancelled";
    ```

- [x] **Task 6**：Frontend events — 新增 ESCAPE_PRESSED 常量
  - File: `src/composables/useTauriEvents.ts`
  - Action: 新增 `export const ESCAPE_PRESSED = "escape:pressed" as const;`

- [x] **Task 7**：Frontend store — 实作 abort 逻辑（核心任务）
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action 7a: 新增状态变数
    ```typescript
    const isAborted = ref(false);
    let abortController: AbortController | null = null;
    ```
  - Action 7b: 新增 `handleEscapeAbort()` 函式
    ```typescript
    async function handleEscapeAbort() {
      const currentStatus = status.value;
      if (currentStatus === "idle" || currentStatus === "success" || currentStatus === "error" || currentStatus === "cancelled") return;

      writeInfoLog(`useVoiceFlowStore: ESC abort from ${currentStatus}`);
      isAborted.value = true;
      abortController?.abort();

      // 【F1 修正】无条件重置 isRecording，避免永久锁死
      isRecording.value = false;

      if (currentStatus === "recording") {
        void invoke("stop_recording").catch(() => {});
        stopElapsedTimer();
      }

      // 【F7/F10 修正】完整清理所有进行中的资源
      clearDelayedMuteTimer();
      stopMonitorPolling();
      stopCorrectionSnapshotPolling();
      cleanupCorrectionMonitorListener();
      void restoreSystemAudio();

      // 重置 toggle 模式状态
      void invoke("reset_hotkey_state").catch(() => {});

      transitionTo("cancelled", t("voiceFlow.cancelled"));
    }
    ```
  - Action 7c: 修改 `handleStartRecording()` — 在函式开头（`isRecording.value = true` 之后）加入 abort 重置
    ```typescript
    isAborted.value = false;
    abortController = new AbortController();
    ```
  - Action 7d: 修改 `handleStopRecording()` — 加入 abort 保护
    - 【F2 修正】在函式开头 `if (!isRecording.value) return;` 之后，加入第二道 guard：`if (isAborted.value) return;`（防止 Hold 模式 key release 在 ESC 中断后重复触发）
    - 在 `await invoke("stop_recording")` 之后：`if (isAborted.value) return;`
    - 在 `await invoke("transcribe_audio", ...)` 之后：`if (isAborted.value) return;`
    - 在 `enhanceText()` 呼叫中传入 signal：`signal: abortController?.signal`
    - 在 enhancement 的 catch 区块中：若 `isAborted.value` 为 true，直接 return 不走 fallback
  - Action 7e: 修改 `handleRetryTranscription()` — 同样模式
    - 在函式开头加入 abort 重置：`isAborted.value = false; abortController = new AbortController();`
    - 在 `await invoke("retranscribe_from_file", ...)` 之后：`if (isAborted.value) return;`
    - 在 retry 的 `enhanceText()` 呼叫中传入 signal
    - 在 retry enhancement catch 中加入 abort 检查
  - Action 7f: 修改 `transitionTo()` — 加入 `"cancelled"` 状态处理
    ```typescript
    if (nextStatus === "cancelled") {
      showHud().catch(/* ... */);
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, CANCELLED_DISPLAY_DURATION_MS); // 1000ms
      return;
    }
    ```
    新增常量：`const CANCELLED_DISPLAY_DURATION_MS = 1000;`
  - Action 7g: 修改 `initialize()` — 注册 ESCAPE_PRESSED 事件监听
    ```typescript
    listenToEvent(ESCAPE_PRESSED, () => {
      void handleEscapeAbort();
    }),
    ```
    加入 `Promise.all([...])` 阵列中。
  - Action 7h: 在 `return` 物件中不需要 export `handleEscapeAbort`（由事件驱动，不需外部呼叫）

- [x] **Task 8**：HUD — 新增 cancelled 视觉模式
  - File: `src/components/NotchHud.vue`
  - Action 8a: 在 `VisualMode` type 加入 `"cancelled"`
  - Action 8b: 在 status watcher 中新增 `"cancelled"` 分支。现有 watcher 使用 `if/return` 串联结构，最后一个分支 (`"error"`) 没有 `return`。在 error 分支的 `}` 之后加入 cancelled 分支（由于 error 的 if 条件不匹配 cancelled，会正确 fall through 到此）：
    ```typescript
    if (nextStatus === "cancelled") {
      stopWaveformAnimation();
      visualMode.value = "cancelled";
      return;
    }
    ```
  - Action 8c: 在 template 新增 cancelled 视觉元素（notch-left 区域）：
    - SVG X 图示（18x18, stroke 色 `rgba(255, 255, 255, 0.6)`）
    - 右侧显示 "已取消" label（同色调）
  - Action 8d: 新增 CSS 样式
    - `.cancelled-icon-svg`：fadeIn 动画
    - `.cancelled-label`：`color: rgba(255, 255, 255, 0.6)`, `font-size: 14px`
  - Action 8e: 在 `isHighPriorityMode` computed 中加入 `mode === "cancelled"`
  - Action 8f: 在 `waveformElementClass` 的 switch 中不需新增 case（cancelled 不显示 waveform）

- [x] **Task 9**：i18n — 新增取消讯息翻译
  - File: `src/i18n/locales/zh-TW.json` → `"voiceFlow.cancelled": "已取消"`
  - File: `src/i18n/locales/en.json` → `"voiceFlow.cancelled": "Cancelled"`
  - File: `src/i18n/locales/ja.json` → `"voiceFlow.cancelled": "キャンセル"`
  - File: `src/i18n/locales/zh-CN.json` → `"voiceFlow.cancelled": "已取消"`
  - File: `src/i18n/locales/ko.json` → `"voiceFlow.cancelled": "취소됨"`

- [x] **Task 10**：Settings — 禁止 ESC 作为 Custom trigger key
  - File: `src/stores/useSettingsStore.ts`（或 Custom key 设定的验证逻辑所在处）
  - Action: 在 Custom key 设定的验证逻辑中，加入 ESC keycode 的黑名单检查。若使用者尝试设定 ESC（macOS keycode 53 / Windows VK 0x1B），显示错误讯息并拒绝储存。
  - Notes: ESC 已被保留为全域中断键，不可用作 trigger key。需在对应的 i18n locale 档案中加入错误讯息。

### Acceptance Criteria

- [x] **AC1**: Given 使用者正在 recording 状态，when 按下 ESC 键，then 录音立即停止，HUD 显示「已取消」约 1 秒后收起，不执行转录。
- [x] **AC2**: Given 使用者正在 transcribing 状态（Whisper API 呼叫中），when 按下 ESC 键，then HUD 立即切换为「已取消」，API 回传结果被丢弃。
- [x] **AC3**: Given 使用者正在 enhancing 状态（LLM API 呼叫中），when 按下 ESC 键，then fetch 请求被 abort，HUD 立即切换为「已取消」。
- [x] **AC4**: Given 使用者录音时有启用系统音量静音功能，when 按下 ESC 中断，then 系统音量在中断后立即还原。
- [x] **AC5**: Given 使用者使用 Toggle 触发模式，when 在 recording 状态按下 ESC 中断，then 下次按 trigger key 应直接开始新录音（toggle 状态已重置），不需要多按一次。
- [x] **AC6**: Given 使用者正在 idle / success / error 状态，when 按下 ESC 键，then 不发生任何反应。
- [x] **AC7**: Given ESC 中断后使用者再次按 trigger key，when 开始新的录音流程，then 所有状态（isAborted, abortController, isRecording）已正确重置，新流程正常运作。
- [x] **AC8**: Given 使用者在 retry transcription 流程中，when 按下 ESC 键，then 中断行为与主流程一致（丢弃结果、显示取消、重置状态）。
- [x] **AC9**: Given macOS 和 Windows 平台，when 按下 ESC 键，then 两平台行为一致。
- [x] **AC10**: Given 使用者在设定页面选择 Custom trigger key，when 尝试设定 ESC（keycode 53 / 0x1B）作为 trigger key，then 显示错误讯息并拒绝储存。

## Additional Context

### Dependencies

- 无外部依赖变动。不需修改 `Cargo.toml` 或 `package.json`。
- ESC keycode 为固定值（macOS: 53, Windows: 0x1B），无平台版本依赖。
- `enhancer.ts` 的 `enhanceText()` 已定义 `signal?: AbortSignal` 参数但目前呼叫端尚未传入。本 spec 在 Task 7d/7e 中将 signal 传入，enhancer.ts 本身不需修改。

### Testing Strategy

**Rust 单元测试（inline in `hotkey_listener.rs`）：**
- 验证 ESC keycode 常量值正确（macOS 53, Windows 0x1B）
- 验证 `reset_key_states()` 呼叫后 `is_pressed` 和 `is_toggled_on` 均为 false

**Frontend 单元测试（Vitest，建议新增 `src/stores/__tests__/useVoiceFlowStore.abort.test.ts`）：**
- `handleEscapeAbort()` 在 recording 状态下：验证 `isRecording` 被重置、`isAborted` 被设置、status 转为 cancelled
- `handleEscapeAbort()` 在 transcribing 状态下：验证 `isRecording` 被重置（即使之前为 true）
- `handleEscapeAbort()` 在 idle/success/error 状态下：验证不执行任何动作
- `handleStopRecording()` 在 `isAborted` 为 true 时：验证提前 return，不执行 transcribe_audio
- `handleStartRecording()` 在 ESC 中断后再次呼叫：验证 `isAborted` 被重置为 false

**手动测试（必要）：**
1. macOS + Windows 双平台验证 ESC 侦测
2. Hold mode + Toggle mode 分别测试
3. 在 recording / transcribing / enhancing 三个状态各按一次 ESC
4. 验证 Toggle 模式 ESC 后可正常重新开始（不需多按一次）
5. 验证系统音量还原
6. 验证 HUD cancelled 视觉正确显示并收起
7. 验证 retry 流程中 ESC 正常运作
8. 验证 idle/success/error 状态按 ESC 无反应
9. **关键**：在 transcribing/enhancing 状态按 ESC 后，立即按 trigger key 开始新录音 → 验证流程正常（F1 回归）
10. 尝试在设定页面设定 ESC 为 Custom trigger key → 验证被拒绝

### Notes

**高风险项目：**
- **Windows `hook_proc` 中 emit event**：目前 `HookContext` 的 `key_handler` 是 closure，ESC 处理需要一个独立的 escape handler 或将 emit 逻辑嵌入现有架构。建议在 `HookContext` 新增 `escape_handler` 栏位，保持关注点分离。
- **Transcribing 中断的资源浪费**：ESC 中断不会取消 Rust 端的 HTTP 请求，Groq API 呼叫仍会完成。这是可接受的 trade-off（避免需要在 Rust 端加 cancellation token 的复杂度）。API 费用仍会产生。
- **快速连按 ESC + trigger key 的竞态条件**：`isAborted` flag 在 `handleStartRecording()` 中被重置，但若 ESC 和 trigger key 几乎同时按下，可能出现竞态。由于事件是序列化处理（JavaScript 单执行绪），此风险极低。

**已知限制：**
- Rust 端 `transcribe_audio` 的 HTTP 请求无法真正取消，只能在前端忽略结果
- ESC 键固定不可自订（符合 Scope 定义）
- Rust 端在任何状态（包括 idle）都会对 ESC KeyDown emit 事件，前端在非活动状态会忽略。对于 Vim 等频繁使用 ESC 的使用者，每次按键会产生一次轻量 IPC 事件传递，效能影响可忽略（已决定接受此设计简化）
