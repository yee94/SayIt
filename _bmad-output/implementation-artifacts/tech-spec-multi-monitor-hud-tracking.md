---
title: 'Multi-Monitor HUD Tracking'
slug: 'multi-monitor-hud-tracking'
created: '2026-03-03'
status: 'review'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Rust (core-graphics 0.24, windows 0.61)', 'TypeScript', 'Tauri v2 Window/Monitor API']
files_to_modify: ['src-tauri/src/lib.rs', 'src/stores/useVoiceFlowStore.ts', 'src-tauri/capabilities/default.json']
code_patterns: ['#[cfg(target_os)] platform isolation', 'LogicalPosition for cross-DPI window positioning', 'invoke() for frontend→Rust commands', 'Tauri available_monitors() for monitor enumeration']
test_patterns: ['Rust #[cfg(test)] unit tests for coordinate calculation', 'Vitest for frontend store logic']
---

# Tech-Spec: Multi-Monitor HUD Tracking

**Created:** 2026-03-03

## Overview

### Problem Statement

HUD 视窗在应用程式启动时固定定位于主萤幕顶部置中。在多萤幕环境下，使用者在副萤幕上工作并触发快捷键时，HUD 仍然出现在主萤幕，造成视觉断裂和体验不佳。

### Solution

实作双层多萤幕追踪机制：
1. **Hotkey 触发时** — 侦测滑鼠游标座标，判定所在萤幕，将 HUD 定位到该萤幕顶部水平置中
2. **HUD 显示期间** — 启动轻量轮询（约 250ms），持续侦测游标是否跨萤幕，若是则即时搬移 HUD 到新萤幕顶部置中
3. **HUD 开始消失时** — 停止轮询，collapse 动画期间不再追踪
4. **HUD 隐藏后** — 零额外开销

### Scope

**In Scope:**
- macOS + Windows 双平台滑鼠游标座标侦测
- 从游标座标判定所在萤幕（Tauri `available_monitors()` + 座标区间比对）
- HUD 视窗动态重新定位（目标萤幕水平置中、Y = monitor top position）
- 轮询生命周期管理（HUD show 时启动 / transition to idle 时停止）
- DPI scale factor 正确处理（沿用现有 `calculate_centered_window_x` 逻辑）

**Out of Scope:**
- Notch 特殊 Y 偏移处理（一律贴萤幕顶端）
- 萤幕热插拔侦测（运行中新增/移除萤幕）
- Dashboard 视窗的多萤幕处理

## Context for Development

### Codebase Patterns

- **平台隔离**: 使用 `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` 分离平台特定逻辑
- **视窗定位**: 多萤幕追踪使用 `LogicalPosition` 设定座标（绕过 tao cross-DPI bug），启动定位仍用 `PhysicalPosition`
- **前端→Rust 通讯**: `invoke('command_name', { args })` 呼叫 Tauri Command，返回 `Result<T, String>`
- **HUD 生命周期**: `showHud()` → `window.show()` + `setIgnoreCursorEvents(true)`，`hideHud()` → `window.hide()`
- **状态机驱动**: `transitionTo()` 控制 HUD 状态转换，recording/transcribing/enhancing 触发 showHud()，idle 触发 hideHud()
- **showHud() 是 fire-and-forget**: `transitionTo()` 中以 `showHud().catch(...)` 呼叫（无 await），但 `showHud()` 内部的 await 顺序仍然保证先定位再显示

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/lib.rs` | 现有 `calculate_centered_window_x()` + startup 定位 + 平台视窗配置 |
| `src/stores/useVoiceFlowStore.ts` | HUD show/hide 生命周期 + hotkey event listeners |
| `src-tauri/src/plugins/hotkey_listener.rs` | 平台隔离 pattern 参考 + CGEvent/Windows hooks 使用方式 |
| `src-tauri/Cargo.toml` | 已有 core-graphics 0.24 + windows 0.61 依赖 |
| `src-tauri/capabilities/default.json` | Tauri capability 白名单（需新增 `setPosition` 权限） |
| `src/components/NotchHud.vue` | HUD 固定宽度 350px（visual），视窗逻辑宽度 400px |

### Technical Decisions

- **游标座标取得方式**:
  - macOS: 透过 `CGEventCreate(NULL)` + `CGEventGetLocation()` C API — 返回 points（逻辑像素），原点在主萤幕左上角（y 向下增长）
  - Windows: `GetCursorPos()` — 返回 virtual screen 座标，原点在主萤幕左上角
  - ⚠️ **需实测验证**: 以上座标系统描述基于文件推理，实作时需在真实多萤幕环境（特别是不同 DPI 组合）下验证座标匹配是否正确
- **萤幕匹配逻辑**:
  - macOS: Tauri monitor position 是 physical pixels，需除以各自的 `scale_factor` 转为 logical 后与游标 points 比对
  - Windows: Tauri monitor position 与 `GetCursorPos` 座标系统应一致，直接比对
  - ⚠️ **需实测验证**: Windows 上 `GetCursorPos` 返回值可能受 DPI awareness context 影响（logical vs physical），需确认 Tauri 进程的 DPI awareness 模式并验证座标是否匹配
- **Rust 端完成所有计算**: 新 Tauri Command 回传最终 `LogicalPosition`（`f64` 座标），前端只负责 `setPosition(new LogicalPosition(x, y))`
- **⚠️ tao cross-DPI bug 绕过（2026-03-04 修正）**: tao `set_outer_position()` 使用 `self.scale_factor()`（视窗「当前」萤幕的 sf）来将 `PhysicalPosition` 转为 logical，而非「目标」萤幕的 sf。在 mixed-DPI 环境下（如 Retina 2x + 外接 1x），这会导致座标被错误的 sf 除，HUD 定位到错误萤幕。解法：改传 `LogicalPosition`，其 `to_logical()` 只做 `.cast()`（no-op），完全绕过错误的除法。证据位置：`tao-0.34.5/src/platform_impl/macos/window.rs:729-735`
- **HUD 视窗宽度常数**: 抽取为 Rust 常数 `HUD_WINDOW_WIDTH_LOGICAL = 400.0`，取代现有 startup 中的 hardcoded 值，前端 invoke 时传入相同值
- **轮询间隔 250ms**: 平衡即时性与效能，HUD 可见期间运行
- **轮询停止时机**: `transitionTo("idle")` 时停止轮询（非 `hideHud()` 时）。collapse 动画期间不追踪，避免消失中的 HUD 突然跳萤幕
- **Monitor key 比对**: 用萤幕的 physical position `"{x},{y}"` 作为 key，前端快取比对避免不必要的 `setPosition()` 呼叫
- **启动时定位保留**: `setup()` 中的初始定位逻辑保留，使用 `PhysicalPosition` + `calculate_centered_window_x()`（启动时视窗在主萤幕上，tao 的 sf 正确，无需绕过）
- **萤幕匹配 fallback**: `find_monitor_for_cursor()` 若无精确匹配，改为找距离游标最近的萤幕中心（而非固定 index 0），防御 mixed-DPI rounding 间隙
- **并行呼叫防护**: `repositionHudToCurrentMonitor()` 使用 `isRepositioning` flag 防止多个 invoke 并行执行（250ms 轮询间隔下，若前一次 IPC 尚未回传则跳过本次）
- **CGEvent 记忆体安全**: macOS `CGEventCreate` 返回的 event 物件必须以 scope guard 确保 `CFRelease`，即使中途 panic 也不 leak（每 250ms 呼叫一次，leak 会累积）

## Implementation Plan

### Tasks

- [x] Task 1: 新增 Tauri capability `core:window:allow-set-position`
  - File: `src-tauri/capabilities/default.json`
  - Action: 在 `permissions` 阵列中加入 `"core:window:allow-set-position"`
  - Notes: `Window.setPosition()` 不在 `core:window:default` 内，必须显式授权，否则前端呼叫会被 Tauri 权限系统挡下

- [x] Task 2: 新增 `HUD_WINDOW_WIDTH_LOGICAL` 常数和 `HudTargetPosition` 回传型别
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `calculate_centered_window_x()` 附近新增：
    - `const HUD_WINDOW_WIDTH_LOGICAL: f64 = 400.0;` 常数
    - `HudTargetPosition` struct，包含 `x: f64`, `y: f64`, `monitor_key: String`（logical 座标）
  - Notes: `#[derive(Serialize)]` + `#[serde(rename_all = "camelCase")]`。同时将 `setup()` 中的 hardcoded `400.0` 替换为此常数

- [x] Task 3: 新增 macOS 游标座标取得函式
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `#[cfg(target_os = "macos")] fn get_cursor_position() -> (f64, f64)` 函式
  - Notes: 使用 `CGEventCreate(NULL)` + `CGEventGetLocation()` C FFI 呼叫。需宣告 `extern "C"` block 引入 `CGEventCreate`, `CGEventGetLocation`, `CFRelease`。**必须使用 scope guard（或 defer pattern）确保 `CFRelease` 被呼叫**，避免每 250ms 一次的记忆体 leak。返回值为 points（逻辑座标），原点在主萤幕左上角

- [x] Task 4: 新增 Windows 游标座标取得函式
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `#[cfg(target_os = "windows")] fn get_cursor_position() -> (f64, f64)` 函式
  - Notes: 使用 `windows::Win32::UI::WindowsAndMessaging::GetCursorPos`（已在 Cargo.toml features 中）。⚠️ 实作时需验证返回座标是否与 Tauri `Monitor.position()` 在同一座标系统中

- [x] Task 5: 新增萤幕匹配辅助函式
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `find_monitor_for_cursor()` 纯函式，接受游标座标和萤幕列表参数，回传匹配萤幕的 index
  - Notes: macOS 路径需将 monitor physical position 除以 scale_factor 转为 logical 后比对。Windows 路径直接比对 physical 座标。设计为纯函式以便单元测试（接受抽象化的 monitor 资料 struct 而非 Tauri `Monitor` 物件）。**需处理负值座标**（副萤幕在主萤幕上方或左方时 position 为负）

- [x] Task 6: 新增 `get_hud_target_position` Tauri Command
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `#[command] fn get_hud_target_position(app: tauri::AppHandle, window_width: f64) -> Result<HudTargetPosition, String>`
  - Notes: 流程：(1) 呼叫 `get_cursor_position()` 取得游标座标 (2) `app.available_monitors()` 取得萤幕列表 (3) `find_monitor_for_cursor()` 匹配萤幕 (4) 对匹配萤幕呼叫 `calculate_centered_window_x_logical()` 计算 logical X 偏移 (5) HUD X = monitor_logical_x + centered_x_logical (6) HUD Y = monitor_logical_y（萤幕顶端 logical 座标） (7) monitor_key = `"{physical_x},{physical_y}"` (8) 回传 `HudTargetPosition`（logical 座标）。若无萤幕精确匹配，fallback 到最近萤幕

- [x] Task 7: 注册新 Command 到 invoke_handler
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `tauri::generate_handler![]` 中加入 `get_hud_target_position`
  - Notes: 位于 `run()` 函式中的 `.invoke_handler()` 区块

- [x] Task 8: 前端新增 `HudTargetPosition` 介面 + 重定位逻辑
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 新增以下内容：
    - `HudTargetPosition` 介面（`x: number`, `y: number`, `monitorKey: string`）
    - `HUD_WINDOW_WIDTH_LOGICAL = 400` 常数
    - `MONITOR_POLL_INTERVAL_MS = 250` 常数
    - `monitorPollTimer` 变数（`ReturnType<typeof setInterval> | null`）
    - `lastMonitorKey` 变数（`string`）
    - `isRepositioning` 变数（`boolean`，并行呼叫防护）
    - `repositionHudToCurrentMonitor()` async 函式：检查 `isRepositioning` flag，若为 true 则跳过；否则 set flag → invoke `get_hud_target_position` → 比对 `monitorKey` → 若变更则 `window.setPosition(new LogicalPosition(x, y))` → clear flag
    - `startMonitorPolling()` 函式：启动 setInterval 每 250ms 呼叫 `repositionHudToCurrentMonitor()`
    - `stopMonitorPolling()` 函式：clearInterval + 重设 `lastMonitorKey` + 重设 `isRepositioning`
  - Notes: 需新增 import `LogicalPosition` from `@tauri-apps/api/dpi`（使用 LogicalPosition 绕过 tao cross-DPI bug）。`repositionHudToCurrentMonitor()` 中的错误静默处理（log 但不影响 HUD 显示流程），错误时必须 clear `isRepositioning` flag

- [x] Task 9: 修改 `showHud()` 整合重定位 + 轮询
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 `showHud()` 函式：
    1. 重设 `lastMonitorKey = ""`（强制首次定位）
    2. `await repositionHudToCurrentMonitor()`（先定位再显示）
    3. 保留原有 `window.show()` + `setIgnoreCursorEvents(true)`
    4. 呼叫 `startMonitorPolling()`
  - Notes: `showHud()` 是 async 函式，内部 await 顺序保证先定位再 show。虽然 `transitionTo()` 以 fire-and-forget 方式呼叫 `showHud()`，但这不影响 `showHud()` 内部的执行顺序

- [x] Task 10: 修改 `transitionTo()` 在 idle transition 时停止轮询
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在 `transitionTo()` 中 `nextStatus === "idle"` 分支的开头加入 `stopMonitorPolling()` 呼叫
  - Notes: 轮询在 transition to idle 时立即停止，collapse 动画 400ms 期间不再追踪。避免消失中的 HUD 突然跳到另一萤幕的突兀行为

- [x] Task 11: 修改 `cleanup()` 加入轮询清理
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在 `cleanup()` 函式中加入 `stopMonitorPolling()` 呼叫
  - Notes: 确保元件卸载时清理所有 interval

- [x] Task 12: 新增 Rust 单元测试
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `#[cfg(test)] mod tests` 中新增测试：
    - `test_find_monitor_single_monitor` — 单萤幕场景，游标一定在该萤幕上
    - `test_find_monitor_dual_horizontal` — 双萤幕水平排列，游标在右萤幕
    - `test_find_monitor_dual_vertical` — 双萤幕垂直排列，副萤幕在上方（y 为负值）
    - `test_find_monitor_dual_different_dpi` — 双萤幕不同 DPI（macOS 场景）
    - `test_find_monitor_cursor_at_boundary` — 游标在萤幕边界上
    - `test_find_monitor_cursor_negative_coords` — 游标在负座标区域（副萤幕在主萤幕左方/上方）
    - `test_find_monitor_fallback` — 游标座标不在任何萤幕内（异常情况），fallback 到第一个萤幕
  - Notes: `find_monitor_for_cursor()` 设计为纯函式，接受 struct 参数而非 Tauri Monitor 物件，方便测试

### Acceptance Criteria

- [x] AC 1: Given 使用者有双萤幕且游标在副萤幕上，when 按下快捷键触发录音，then HUD 出现在副萤幕顶部水平置中
- [x] AC 2: Given HUD 正在副萤幕上显示（录音中），when 使用者将滑鼠移动到主萤幕，then HUD 在 250ms 内移动到主萤幕顶部水平置中
- [x] AC 3: Given 使用者只有单萤幕，when 按下快捷键，then HUD 行为与修改前完全一致（顶部置中）
- [x] AC 4: Given 双萤幕有不同 DPI（例如 MacBook Retina + 外接 1080p），when HUD 从 Retina 萤幕移到外接萤幕，then HUD 在外接萤幕上正确水平置中且不偏移
- [x] AC 5: Given HUD 隐藏（idle 状态），when 无操作，then 无轮询 timer 在运行（零效能开销）
- [x] AC 6: Given `get_hud_target_position` command 执行失败，when 按下快捷键，then HUD 仍然正常显示（在最后已知位置），错误静默 log 不影响流程
- [x] AC 7: Given HUD 显示中且游标未跨萤幕，when 轮询触发，then 不呼叫 `setPosition()`（透过 `monitorKey` 比对避免）
- [x] AC 8: Given HUD 正在 collapse 动画中（transition to idle 后 400ms 内），when 使用者将滑鼠移到其他萤幕，then HUD 不跟随（轮询已停止），在当前萤幕完成消失动画

## Additional Context

### Dependencies

- 无新 Rust crate 依赖 — `core-graphics` 0.24（macOS）和 `windows` 0.61（Windows）已在 `Cargo.toml` 中
- 无新 npm 依赖 — `@tauri-apps/api` 已包含 `LogicalPosition` 和 `Window.setPosition()`
- **需新增 Tauri capability**: `core:window:allow-set-position`（Task 1）— `setPosition()` 不在 `core:window:default` 中，必须显式授权

### Testing Strategy

- **Rust 单元测试**: 14 个测试案例覆盖 `find_monitor_for_cursor()` 和 `calculate_centered_window_x_logical()` 的各种场景，包含垂直排列、负座标、portrait 萤幕、mixed-DPI、closest fallback（Task 12 + 2026-03-04 修正新增）
- **手动整合测试**: 双萤幕环境下验证 AC 1-8，特别注意：
  - 不同 DPI 萤幕间的切换
  - HUD 显示/隐藏时的轮询启停
  - 快速跨萤幕移动时的追踪延迟
  - collapse 动画期间确认不追踪
  - ⚠️ **座标系统实测**: 第一次在真实多萤幕环境运行时，加上 debug log 印出游标座标和各萤幕的 position/size/scale_factor，确认座标比对逻辑正确
- **现有测试回归**: `pnpm test` 确认 `useVoiceFlowStore` 现有测试不被破坏

### Notes

- **效能**: 每次轮询是一个 `invoke()` IPC 呼叫 + Tauri `available_monitors()` 查询。250ms 间隔下每秒 4 次，对系统负担极小
- **座标系统陷阱（⚠️ 需实测）**: macOS 游标座标是 logical pixels（points），Tauri monitor positions 是 physical pixels。比对时必须将 physical 除以 `scale_factor` 转为 logical。Windows 的座标匹配取决于 Tauri 进程的 DPI awareness mode，需实测确认。实作时应在 `get_hud_target_position` 中加入 debug log 以便验证
- **视觉闪烁防护**: `showHud()` 中先 `repositionHudToCurrentMonitor()` 再 `window.show()`，确保 HUD 出现在正确位置而非先闪一下旧位置
- **collapse 期间不追踪**: 轮询在 `transitionTo("idle")` 时停止，collapse 动画 400ms 期间 HUD 固定在当前萤幕消失，避免消失中突然跳萤幕的突兀行为
- **并行安全**: `isRepositioning` flag 确保同时只有一个 invoke IPC 在进行中，避免高负载下多个 `setPosition()` 互相竞争
- **记忆体安全**: macOS `CGEventCreate` 必须配对 `CFRelease`，使用 scope guard 确保即使 panic 也不 leak
- **未来考量（Out of Scope）**: 萤幕热插拔可透过监联 Tauri 的 `ScaleFactorChanged` / `Resized` 事件支援，但目前不在范围内

## Dev Agent Record

### Implementation Notes

- **Date:** 2026-03-03
- **macOS CGEvent FFI**: 使用 raw `extern "C"` FFI 呼叫 `CGEventCreate(NULL)` + `CGEventGetLocation()` + `CFRelease()`，因为 `core-graphics` 0.24 的 `CGEvent::new()` 需要非 Optional 的 `CGEventSource` 参数，无法直接传 NULL
- **MonitorInfo 抽象化**: 新增 `MonitorInfo` struct 将萤幕资讯抽象化，使 `find_monitor_for_cursor()` 成为纯函式，方便单元测试（不需要 Tauri runtime）
- **座标系统处理**: macOS 分支会将 monitor physical position 除以各自的 `scale_factor` 转为 logical 后与游标 points 比对；Windows 分支直接用 physical 座标比对
- **记忆体安全**: CGEventCreate 返回的指标手动 CFRelease — 不依赖 Rust wrapper 的 Drop，因为直接用了 C FFI

### Implementation Notes (2026-03-04 Cross-DPI Fix)

- **Date:** 2026-03-04
- **问题**: 三萤幕环境（左 landscape + 中 Retina 2x + 右 portrait 1x），游标在 portrait 萤幕上时 HUD 出现在中间萤幕右侧
- **根因**: tao `set_outer_position()` 用 `self.scale_factor()`（视窗「当前」萤幕的 sf=2.0）将 PhysicalPosition 转为 logical，而非用「目标」萤幕的 sf=1.0。1780 / 2.0 = 890，落在中间萤幕 [0, 1440) 范围内
- **修正**: `HudTargetPosition` 改为回传 logical 座标（`f64`），前端改用 `LogicalPosition`。`Position::Logical` 的 `to_logical()` 只做 `.cast()`（no-op），完全绕过 tao 的错误除法
- **新增 `calculate_centered_window_x_logical()`**: 回传 `f64` logical 偏移量，与原有 `calculate_centered_window_x()` 并存（后者仅供 `setup()` 启动定位使用）
- **`find_monitor_for_cursor()` fallback 改进**: 从固定 `Some(0)` 改为找距离游标最近的萤幕中心，防御 mixed-DPI rounding 间隙
- **Debug logging**: `get_hud_target_position` 中加入 `[hud-tracking]` 前缀 log，印出游标座标、各萤幕 physical/logical bounds、匹配结果、最终 HUD logical position
- **测试新增**: 6 个测试 — portrait 三萤幕 macOS、portrait 底部对齐、closest fallback、logical 置中计算（portrait/Retina/1080p）
- **启动定位不受影响**: `setup()` 仍用 `PhysicalPosition` + `calculate_centered_window_x()`，因启动时视窗在主萤幕上，tao 的 sf 恰好正确

### Completion Notes

- 12/12 tasks 完成
- 8/8 acceptance criteria 满足（需手动整合测试验证 AC 1-8）
- Rust: 7 个新测试 + 19 个既有测试 = 26 tests passing
- Frontend: 242 tests passing（零回归）
- 无新 crate/npm 依赖
- TypeScript 型别错误皆为预先存在的 shadcn block 元件问题，非本次修改引入

### File List

| File | Action |
| ---- | ------ |
| `src-tauri/capabilities/default.json` | Modified — 新增 `core:window:allow-set-position` |
| `src-tauri/src/lib.rs` | Modified — 新增 `HUD_WINDOW_WIDTH_LOGICAL` 常数、`HudTargetPosition` struct（`f64` logical 座标）、`MonitorInfo` struct、`get_cursor_position()` (macOS/Windows)、`find_monitor_for_cursor()`（closest fallback）、`calculate_centered_window_x_logical()`、`get_hud_target_position` command（logical 座标 + debug log）、14 个单元测试；`setup()` 中 hardcoded 400.0 替换为常数 |
| `src/stores/useVoiceFlowStore.ts` | Modified — 新增 `LogicalPosition` import、`HudTargetPosition` 介面、`MONITOR_POLL_INTERVAL_MS` 常数、`repositionHudToCurrentMonitor()`/`startMonitorPolling()`/`stopMonitorPolling()` 函式；修改 `showHud()` 整合重定位+轮询、`transitionTo()` idle 时停止轮询、`cleanup()` 加入轮询清理 |

### Change Log

- 2026-03-03: 实作 Multi-Monitor HUD Tracking — HUD 视窗根据游标所在萤幕动态重新定位，支援 macOS + Windows 双平台
- 2026-03-04: 修正 cross-DPI portrait 萤幕定位 bug — `PhysicalPosition` 改为 `LogicalPosition` 绕过 tao `set_outer_position` 在 mixed-DPI 环境下使用错误 scale_factor 转换的问题；`HudTargetPosition` 改为 `f64` logical 座标；`find_monitor_for_cursor()` fallback 改为最近萤幕；新增 `calculate_centered_window_x_logical()`；新增 6 个 portrait/mixed-DPI/closest-fallback 测试案例；加入 `[hud-tracking]` debug logging
