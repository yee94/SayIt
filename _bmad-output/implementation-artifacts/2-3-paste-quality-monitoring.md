# Story 2.3: 贴上后品质监控

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 系统追踪我是否修改了贴上的文字,
So that 我能透过统计数据了解 AI 整理的输出品质趋势。

## Acceptance Criteria

1. **keyboard_monitor.rs 模组建立** — 新增 `src-tauri/src/plugins/keyboard_monitor.rs` 模组，使用 OS-native API（macOS: CGEventTap / Windows: SetWindowsHookExW）监听键盘事件。模组在收到启动指令后开始监听全域键盘事件，监听时间窗口为 5 秒。

2. **Backspace/Delete 侦测** — 贴上后监听期间（5 秒），若使用者按下 Backspace 或 Delete 键至少一次，判定此次输出「被修改」（`wasModified = true`）。结果透过 Tauri Event `quality-monitor:result` 回传前端，payload 为 `{ wasModified: boolean }`。

3. **5 秒无侦测自动结束** — 贴上后 5 秒内未侦测到 Backspace 或 Delete 键，判定此次输出「未修改」（`wasModified = false`）。自动结束监听并透过 Tauri Event 回传结果。

4. **前端触发与接收** — `useVoiceFlowStore` 在成功贴上文字后（`transitionTo("success")` 之后），透过 `invoke("start_quality_monitor")` 启动 Rust 端的键盘监控。`useVoiceFlowStore` 监听 `quality-monitor:result` 事件，收到 `wasModified` 结果后暂存于 store state，供后续历史记录储存使用（Epic 4）。

5. **简单版不做焦点判断** — 监听期间侦测到的 Backspace/Delete 不区分来源焦点窗口。使用者在其他应用程式按下的 Backspace/Delete 也会被记录为 `wasModified = true`。此为简单版设计，接受误判，以避免增加焦点追踪的复杂度。

6. **监听不阻塞主流程** — 键盘监控在独立执行绪/背景执行，不阻塞 App 主流程。使用者触发下一次录音时，若上一次的品质监控尚在进行，自动取消上一次监控并回传当前已收集的结果。

7. **跨平台支援** — macOS 使用 CGEventTap（与 hotkey_listener.rs 相同的 OS-native API）。Windows 使用 SetWindowsHookExW（WH_KEYBOARD_LL hook，与 hotkey_listener.rs 相同模式）。两个平台使用相同的 Tauri Command 介面和相同的 Tauri Event payload 格式。

## Tasks / Subtasks

- [x]Task 1: 建立 keyboard_monitor.rs 模组（macOS 实作）(AC: #1, #2, #3, #7)
  - [x]1.1 建立 `src-tauri/src/plugins/keyboard_monitor.rs`，定义模组结构：
    - `MONITOR_DURATION_MS: u64 = 5000` — 监听时间窗口常数
    - `const BACKSPACE_KEYCODE: u16 = 51` — macOS Backspace keycode
    - `const DELETE_KEYCODE: u16 = 117` — macOS Delete (Forward Delete) keycode
  - [x]1.2 定义共享状态结构 `KeyboardMonitorState`：
    - `is_monitoring: Arc<AtomicBool>` — 是否正在监听
    - `was_modified: Arc<AtomicBool>` — 是否侦测到修改按键
    - `cancel_token: Arc<AtomicBool>` — 用于取消当前监控
  - [x]1.3 实作 macOS CGEventTap 监听：
    - 建立新的 CGEventTap（ListenOnly mode）专门监听 KeyDown 事件
    - 在 callback 中检查 keycode 是否为 Backspace(51) 或 Delete(117)
    - 侦测到时设定 `was_modified = true`
    - 使用独立执行绪的 CFRunLoop 运行 event tap
  - [x]1.4 实作 5 秒计时器逻辑：
    - 启动监听时同步启动 5 秒倒数计时器（`std::thread::sleep` 或 timer）
    - 5 秒到期后停止 CGEventTap（`CFRunLoop::stop`）
    - 透过 `app_handle.emit("quality-monitor:result", payload)` 发送结果
  - [x]1.5 实作提前中断逻辑：
    - 若 `cancel_token` 被设为 true，立即停止监听
    - 回传当前已收集的 `was_modified` 结果

- [x]Task 2: 建立 keyboard_monitor.rs 模组（Windows 实作）(AC: #1, #2, #3, #7)
  - [x]2.1 定义 Windows 键码常数：
    - `const VK_BACK: u32 = 0x08` — Windows Backspace VK code
    - `const VK_DELETE: u32 = 0x2E` — Windows Delete VK code
  - [x]2.2 实作 Windows WH_KEYBOARD_LL hook 监听：
    - 使用 `SetWindowsHookExW(WH_KEYBOARD_LL, ...)` 安装全域键盘 hook
    - 在 hook callback 中检查 `vkCode` 是否为 VK_BACK 或 VK_DELETE
    - 侦测到时设定 `was_modified = true`
    - 使用 `GetMessageW` loop 驱动 hook 回呼
  - [x]2.3 实作 5 秒计时器 + 提前中断（与 macOS 同逻辑）：
    - 5 秒到期后 `UnhookWindowsHookEx` + `PostThreadMessageW(WM_QUIT)` 结束 message loop
    - 发送 Tauri Event 回传结果

- [x]Task 3: 建立 Tauri Command 介面 (AC: #4, #6)
  - [x]3.1 实作 `#[tauri::command] fn start_quality_monitor(app: AppHandle)` command：
    - 若已有监控进行中（`is_monitoring == true`），先取消：设定 `cancel_token = true`，等待短暂时间确保上一轮结束
    - 重置状态：`was_modified = false`, `is_monitoring = true`, `cancel_token = false`
    - 启动新的监控执行绪（平台分支：macOS/Windows）
    - 立即回传 `Ok(())`（非同步，不等待结果）
  - [x]3.2 在 `mod.rs` 中加入 `pub mod keyboard_monitor;`
  - [x]3.3 在 `lib.rs` 的 `invoke_handler` 中注册 `start_quality_monitor` command
  - [x]3.4 在 `lib.rs` 的 `setup` 中初始化 `KeyboardMonitorState` 并 `app.manage(state)` 管理

- [x]Task 4: 前端整合 — useVoiceFlowStore 触发与接收 (AC: #4, #6)
  - [x]4.1 在 `useTauriEvents.ts` 新增事件常数：
    - `export const QUALITY_MONITOR_RESULT = "quality-monitor:result" as const;`
  - [x]4.2 在 `types/events.ts` 新增 payload 型别：
    - `export interface QualityMonitorResultPayload { wasModified: boolean; }`
  - [x]4.3 在 `useVoiceFlowStore.ts` 新增状态：
    - `const lastWasModified = ref<boolean | null>(null)` — 最近一次品质监控结果
  - [x]4.4 修改 `handleStopRecording()` 成功贴上后的逻辑：
    - 在 `transitionTo("success", ...)` 之后，呼叫 `void invoke("start_quality_monitor")`
    - 注意：使用 `void` 前缀（fire-and-forget），不 await，不阻塞成功状态显示
  - [x]4.5 在 `initialize()` 中新增监听 `quality-monitor:result` 事件：
    - `listen<QualityMonitorResultPayload>(QUALITY_MONITOR_RESULT, (event) => { lastWasModified.value = event.payload.wasModified; })`
    - 将 unlisten 加入 `unlistenFunctions`
  - [x]4.6 汇出 `lastWasModified` 供后续 Story 4.1 使用
  - [x]4.7 在下一次录音开始（`handleStartRecording`）时，重置 `lastWasModified.value = null`

- [x]Task 5: 测试验证 (AC: #1-7)
  - [x]5.1 Rust 单元测试（`keyboard_monitor.rs` 内 `#[cfg(test)] mod tests`）：
    - 测试 `KeyboardMonitorState` 初始值（`is_monitoring = false`, `was_modified = false`）
    - 测试状态重置逻辑
    - 测试 `cancel_token` 设定后 `is_monitoring` 转为 false
    - 注意：CGEventTap / Windows Hook 的实际键盘监听不易在 CI 中测试，改以手动验证
  - [x]5.2 前端测试扩展（`tests/unit/use-voice-flow-store.test.ts`）：
    - Mock `invoke("start_quality_monitor")` 确认贴上成功后被呼叫
    - Mock `listen("quality-monitor:result")` 确认 `lastWasModified` 正确更新
    - 测试下一次录音开始时 `lastWasModified` 被重置为 null
  - [x]5.3 `pnpm exec vue-tsc --noEmit` 通过
  - [x]5.4 `cargo test` 通过（Rust 端）
  - [x]5.5 手动测试：语音输入 → 成功贴上 → 5 秒内按 Backspace → console log 显示 `wasModified: true`
  - [x]5.6 手动测试：语音输入 → 成功贴上 → 5 秒内不按任何键 → console log 显示 `wasModified: false`
  - [x]5.7 手动测试：连续两次语音输入，第二次启动时第一次监控被正确取消
  - [x]5.8 手动测试：语音输入贴上失败（error 状态）时不启动品质监控

## Dev Notes

### 架构模式与约束

**Brownfield 专案** — 基于 Story 2.1-2.2（AI 文字整理 + prompt 自订）继续扩展。本 Story 是 Epic 2 的最后一个 Story，新增纯 Rust 端模组 + 前端事件接收整合。

**本 Story 的核心架构变更：**
1. 新增 `keyboard_monitor.rs` Rust plugin 模组（OS-native 键盘监听）
2. 新增 Tauri Command `start_quality_monitor`
3. 新增 Tauri Event `quality-monitor:result`
4. `useVoiceFlowStore` 扩展触发/接收品质监控

**依赖方向规则（严格遵守）：**
```
Rust keyboard_monitor.rs → Tauri Event → 前端 store 接收
前端 store → invoke("start_quality_monitor") → Rust command
```

**禁止：**
- 前端不做键盘监听（Web API 无法监听全域键盘）
- 不做焦点判断（简单版设计决策，接受误判）
- 不阻塞语音输入主流程

### keyboard_monitor.rs 设计

**与 hotkey_listener.rs 的关系：**

keyboard_monitor.rs 和 hotkey_listener.rs 都使用 OS-native 键盘 API，但职责完全不同：

| 项目 | hotkey_listener.rs | keyboard_monitor.rs |
|------|-------------------|-------------------|
| 用途 | 监听触发键（modifier keys） | 监听 Backspace/Delete |
| 生命周期 | App 生命周期常驻 | 按需启动，5 秒后结束 |
| 事件类型 | FlagsChanged（modifier） | KeyDown（一般键） |
| 执行模式 | Plugin setup 时启动 | Tauri Command 触发 |
| 结果通知 | 即时 emit 事件 | 5 秒后 emit 汇总结果 |

**不共用 event tap/hook 的原因：** hotkey_listener 的 event tap 在 App 启动时建立且永远执行。keyboard_monitor 需要按需启动/停止的短期监听。两者混用会增加状态管理复杂度。独立模组更清晰。

**macOS CGEventTap 实作策略：**

```rust
// keyboard_monitor.rs — macOS 实作概要

use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType,
};

const BACKSPACE_KEYCODE: u16 = 51;
const DELETE_KEYCODE: u16 = 117;
const MONITOR_DURATION_SECS: u64 = 5;

fn start_monitoring_macos(
    app_handle: AppHandle<impl Runtime>,
    state: KeyboardMonitorState,
) {
    std::thread::spawn(move || {
        let was_modified = state.was_modified.clone();
        let cancel_token = state.cancel_token.clone();
        let is_monitoring = state.is_monitoring.clone();

        // 建立专用 CGEventTap（仅监听 KeyDown）
        let tap = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown],
            move |_proxy, _event_type, event| {
                let keycode = event.get_integer_value_field(
                    core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                ) as u16;

                if keycode == BACKSPACE_KEYCODE || keycode == DELETE_KEYCODE {
                    was_modified.store(true, Ordering::SeqCst);
                }
                None
            },
        );

        // 启动 RunLoop + 5 秒计时器
        // 使用另一个执行绪做计时，到期后停止 RunLoop
        // ...

        // 发送结果
        let result = state.was_modified.load(Ordering::SeqCst);
        is_monitoring.store(false, Ordering::SeqCst);
        let _ = app_handle.emit("quality-monitor:result", serde_json::json!({
            "wasModified": result
        }));
    });
}
```

**macOS 权限注意：** CGEventTap 需要 Accessibility 权限。hotkey_listener.rs 已在 App 启动时检查并引导授权。keyboard_monitor.rs 可以重用相同的权限（一旦 App 获得 Accessibility 权限，所有 CGEventTap 都可用）。若权限未授予，CGEventTap 建立会失败，应静默处理（不阻塞主流程，直接回传 wasModified = null/false）。

**Windows WH_KEYBOARD_LL 实作策略：**

```rust
// keyboard_monitor.rs — Windows 实作概要

const VK_BACK: u32 = 0x08;
const VK_DELETE: u32 = 0x2E;

fn start_monitoring_windows(
    app_handle: AppHandle<impl Runtime>,
    state: KeyboardMonitorState,
) {
    std::thread::spawn(move || {
        // 安装 WH_KEYBOARD_LL hook
        // hook callback 中检查 vkCode == VK_BACK || VK_DELETE
        // 侦测到时设定 was_modified = true

        // 5 秒计时器（另一个执行绪 sleep 5 秒后 PostThreadMessageW(WM_QUIT)）
        // message loop 结束后 UnhookWindowsHookEx

        // 发送结果
    });
}
```

**Windows hook 注意：** `SetWindowsHookExW` 的 hook 会在一个新执行绪的 message loop 中运行。与 hotkey_listener 的 hook 是独立的（不同执行绪、不同 hook handle）。hook callback 使用 `OnceLock` 或 thread-local 共享状态。

### 5 秒计时器 + 提前中断设计

```
start_quality_monitor() 被呼叫
    │
    ├── 若已有监控进行中：
    │   ├── 设定 cancel_token = true
    │   ├── 短暂等待（50ms）确保上一轮清理
    │   └── 继续新一轮
    │
    ├── 重置状态
    │   ├── was_modified = false
    │   ├── is_monitoring = true
    │   └── cancel_token = false
    │
    ├── 启动监听执行绪（macOS/Windows 分支）
    │   ├── CGEventTap / WH_KEYBOARD_LL hook 安装
    │   └── RunLoop / Message Loop 开始
    │
    └── 启动计时器执行绪
        ├── sleep(5 秒) 或 定期检查 cancel_token
        ├── 到期 → 停止监听
        │   ├── macOS: CFRunLoop::stop()
        │   └── Windows: PostThreadMessageW(WM_QUIT)
        └── 发送 Tauri Event 回传结果
```

**cancel_token 检查频率：** 计时器不使用 `thread::sleep(5000ms)` 一次性等待（无法中断）。改用 loop + `sleep(100ms)` 分段等待，每 100ms 检查一次 `cancel_token`。50 次迭代 = 5 秒。

```rust
fn wait_with_cancellation(
    cancel_token: &Arc<AtomicBool>,
    duration_ms: u64,
    check_interval_ms: u64,
) -> bool {
    let iterations = duration_ms / check_interval_ms;
    for _ in 0..iterations {
        if cancel_token.load(Ordering::SeqCst) {
            return true; // 被取消
        }
        std::thread::sleep(Duration::from_millis(check_interval_ms));
    }
    false // 正常到期
}
```

### Tauri Event Payload 格式

**Event name:** `quality-monitor:result`（遵循 `{domain}:{action}` kebab-case 规范）

**Payload：**
```json
{ "wasModified": true }
```

或

```json
{ "wasModified": false }
```

**前端接收：**
```typescript
listen<QualityMonitorResultPayload>(
  QUALITY_MONITOR_RESULT,
  (event) => {
    lastWasModified.value = event.payload.wasModified;
    writeInfoLog(
      `useVoiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`
    );
  }
);
```

### useVoiceFlowStore 修改策略

**现有 handleStopRecording() 成功路径（AI 整理分支）：**
```
enhanceText() → enhancedText
  → hideHud()
  → invoke("paste_text", { text: enhancedText })
  → isRecording = false
  → transitionTo("success", PASTE_SUCCESS_MESSAGE)
```

**修改后：**
```
enhanceText() → enhancedText
  → hideHud()
  → invoke("paste_text", { text: enhancedText })
  → isRecording = false
  → transitionTo("success", PASTE_SUCCESS_MESSAGE)
  → void invoke("start_quality_monitor")  ← 新增（fire-and-forget）
```

**同样适用于所有成功贴上路径：**
1. AI 整理成功 → 贴上 enhancedText → start_quality_monitor
2. AI fallback → 贴上 rawText → start_quality_monitor
3. 跳过 AI（< 10 字）→ 贴上 rawText → start_quality_monitor

**不启动品质监控的情况：**
- 转录失败（error 状态）
- 空转录结果
- API Key 缺失

**建议抽取辅助函式：**
```typescript
function startQualityMonitorAfterPaste() {
  void invoke("start_quality_monitor").catch((err) =>
    writeErrorLog(
      `useVoiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`
    )
  );
}
```

在每个成功贴上路径末尾呼叫此函式。

### macOS Keycode 参考

| 按键 | Keycode (decimal) | 用途 |
|------|-------------------|------|
| Backspace (⌫) | 51 | 侦测修改 |
| Delete (⌦, Forward Delete) | 117 | 侦测修改 |
| Fn | 63 | hotkey_listener 使用 |
| Option (L) | 58 | hotkey_listener 使用 |

### Windows VK Code 参考

| 按键 | VK Code | 用途 |
|------|---------|------|
| Backspace | 0x08 (VK_BACK) | 侦测修改 |
| Delete | 0x2E (VK_DELETE) | 侦测修改 |
| Right Alt | 0xA5 (VK_RMENU) | hotkey_listener 使用 |

### Cargo.toml 依赖分析

**不需要新增 Rust 依赖。** keyboard_monitor.rs 使用的所有 crate 已在 Cargo.toml 中：
- macOS: `core-graphics 0.24`, `core-foundation 0.10` — 已存在
- Windows: `windows 0.61` with `Win32_UI_WindowsAndMessaging`, `Win32_UI_Input_KeyboardAndMouse` features — 已存在
- `serde`, `serde_json` — 已存在
- `tauri` — 已存在

**不需要新增 JS 依赖。** 前端仅使用 Tauri 核心 API（`invoke`, `listen`）。

### 档案层级 Capabilities 注意

`capabilities/default.json` 目前已包含 `core:event:default` 和 `core:event:allow-emit`，Rust 端 `emit` 事件到前端不需额外权限。`invoke` command 需要确认 invoke handler 已注册（Task 3.3）。

### 跨 Story 注意事项

- **Story 4.1** 会在 success 后写入历史记录，包含 `wasModified` 栏位。本 Story 的 `lastWasModified` 供 4.1 读取：`useVoiceFlowStore().lastWasModified`。
- **Story 2.1/2.2** 的 `handleStopRecording()` 有多个成功贴上路径（AI 成功、AI fallback、跳过 AI），每个都需要触发品质监控。
- **TranscriptionRecord** type（`types/transcription.ts`）已预定义 `wasModified: boolean | null` 栏位（line 14）。
- **SQLite schema**（architecture.md）的 `transcriptions` table 已预定义 `was_modified INTEGER` 栏位。
- `hotkey_listener.rs` 的 CGEventTap 使用 `CGEventTapOptions::ListenOnly`，keyboard_monitor 也必须使用 `ListenOnly`（不拦截、不修改事件）。

### 前一个 Story (2.2) 关键学习

- `enhanceText()` 的 options 参数使用 optional interface，向后相容
- `useSettingsStore` 的 tauri-plugin-store 操作模式：`store.get()` / `store.set()` / `store.save()`
- `handleStopRecording()` 的 AI 整理流程有 3 个成功 exit path（AI 成功 / AI fallback / 跳过 AI），每个都需要新增品质监控触发
- `writeInfoLog` / `writeErrorLog` 用于所有关键节点
- Tauri Event 命名遵循 `{domain}:{action}` kebab-case 规范

### 现有档案改动点

**新增档案：**
```
src-tauri/src/plugins/keyboard_monitor.rs — OS-native 键盘监控模组
```

**修改档案：**
```
src-tauri/src/plugins/mod.rs              — 新增 pub mod keyboard_monitor
src-tauri/src/lib.rs                       — 注册 start_quality_monitor command + 初始化 state
src/composables/useTauriEvents.ts          — 新增 QUALITY_MONITOR_RESULT 事件常数
src/types/events.ts                        — 新增 QualityMonitorResultPayload 型别
src/stores/useVoiceFlowStore.ts            — 触发品质监控 + 接收结果 + lastWasModified state
tests/unit/use-voice-flow-store.test.ts    — 新增品质监控相关测试案例
```

**不修改的档案（明确排除）：**
- `src/lib/enhancer.ts` — AI 整理逻辑不变
- `src/lib/transcriber.ts` — 转录逻辑不变
- `src/lib/recorder.ts` — 录音逻辑不变
- `src/components/NotchHud.vue` — HUD 不显示品质监控状态
- `src/views/SettingsView.vue` — 设定页面不涉及品质监控
- `src/stores/useSettingsStore.ts` — 设定 store 不涉及
- `src/types/index.ts` — HudStatus 不新增状态
- `src/types/transcription.ts` — wasModified 栏位已预定义
- `Cargo.toml` / `package.json` — 不需新增依赖
- `src-tauri/capabilities/default.json` — 现有权限已足够
- `src-tauri/src/plugins/hotkey_listener.rs` — 不修改，独立模组
- `src-tauri/src/plugins/clipboard_paste.rs` — 不修改

### 安全规则提醒

- 键盘监控使用 `ListenOnly` mode，不拦截或修改系统键盘事件
- 不记录按键内容到日志（仅记录是否侦测到 Backspace/Delete 的布林结果）
- 监控结果不包含任何个人资讯（仅 `wasModified: boolean`）
- macOS Accessibility 权限是 hotkey_listener 已处理的前提条件

### 效能注意事项

- CGEventTap / Windows Hook 是 OS-native API，overhead 极低（< 1ms per event）
- 5 秒监听期间的 CPU 使用几乎为零（event-driven，非 polling）
- 监听执行绪在 5 秒后自动清理，不造成资源泄漏
- cancel_token 检查间隔 100ms，取消响应延迟最多 100ms
- 品质监控不影响 E2E 延迟（fire-and-forget，在成功贴上后才启动）

### Git 历史分析

**最近 commit 模式：**
- `feat:` 前缀用于功能实作
- `fix:` 前缀用于 code review 后修复
- `docs:` 前缀用于 BMAD artifacts 更新

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 — Story 2.3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure — plugins/keyboard_monitor.rs]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points — clipboard_paste.rs 扩展贴上后监控]
- [Source: _bmad-output/planning-artifacts/prd.md#文字输出 FR15 — 贴上后键盘监控品质衡量]
- [Source: _bmad-output/planning-artifacts/prd.md#Risk Mitigation — 贴上后键盘监控的准确度]
- [Source: _bmad-output/implementation-artifacts/2-1-groq-llm-text-enhancement.md — useVoiceFlowStore handleStopRecording 流程]
- [Source: _bmad-output/implementation-artifacts/2-2-ai-prompt-customization-context.md — handleStopRecording 多个成功路径]
- [Source: Codebase — src-tauri/src/plugins/hotkey_listener.rs（CGEventTap + Windows Hook 模式参考）]
- [Source: Codebase — src-tauri/src/plugins/clipboard_paste.rs（Rust command 模式参考）]
- [Source: Codebase — src-tauri/src/lib.rs（command 注册 + state 管理模式）]
- [Source: Codebase — src/stores/useVoiceFlowStore.ts（扩展目标 — 3 个成功贴上路径）]
- [Source: Codebase — src/types/transcription.ts — TranscriptionRecord.wasModified 已预定义]
- [Source: Codebase — src/types/events.ts（事件 payload 型别模式参考）]
- [Source: Codebase — src/composables/useTauriEvents.ts（事件常数命名模式参考）]
- [Source: Codebase — src-tauri/Cargo.toml — 确认现有依赖已足够]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 116 JS + 19 Rust tests passed

### Completion Notes List

- keyboard_monitor.rs 建立（macOS CGEventTap + Windows WH_KEYBOARD_LL）
- 5 秒监控视窗 + cancel_token 提前中断机制
- useVoiceFlowStore 整合 startQualityMonitorAfterPaste + lastWasModified
- useTauriEvents 新增 QUALITY_MONITOR_RESULT 事件常数

### Change Log

- Story 2.3 完整实作 — 贴上后品质监控

### File List

- src-tauri/src/plugins/keyboard_monitor.rs (new)
- src-tauri/src/plugins/mod.rs
- src-tauri/src/lib.rs
- src/composables/useTauriEvents.ts
- src/types/events.ts
- src/stores/useVoiceFlowStore.ts
- tests/unit/use-voice-flow-store.test.ts
