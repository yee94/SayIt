# Story 1.2: 跨平台全域热键系统（OS-native）

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 透过可配置的全域热键触发语音录音，在 macOS 和 Windows 上都能使用,
So that 我不需要切换到 App 视窗就能随时启动语音输入。

## Acceptance Criteria

1. **OS 原生跨平台键盘监听** — 重写 hotkey_listener.rs 使用 OS 原生 API（macOS CGEventTap / Windows SetWindowsHookExW）。macOS 可监听 Fn、左 Option、右 Option、左 Control、右 Control、Command、Shift 键事件（共 7 键）。Windows 可监听右 Alt、左 Alt、Control、Shift 键事件。预设触发键：macOS 为 Fn，Windows 为右 Alt。

2. **Hold 模式事件** — 使用者按住触发键时发送 `hotkey:pressed` Tauri Event（payload `{ mode: 'hold', action: 'start' }`），放开时发送 `hotkey:released` Tauri Event（payload `{ mode: 'hold', action: 'stop' }`）。

3. **Toggle 模式事件** — 使用者按一下触发键时发送 `hotkey:toggled` Tauri Event（payload `{ mode: 'toggle', action: 'start' }`），再按一下发送 `{ mode: 'toggle', action: 'stop' }`。

4. **动态设定变更** — 使用者透过 useSettingsStore 变更触发键或触发模式时，hotkey_listener 即时切换，无需重启 App。

5. **背景全域运作** — App 在背景执行（非前景视窗）时，全域热键仍可正常触发，不干扰其他应用程式的正常键盘操作。

## Tasks / Subtasks

- [x] Task 1: 移除 rdev 和 enigo 依赖 (AC: #1)
  - [x] 1.1 移除 `Cargo.toml` 中的 `rdev = "0.5.3"` 行
  - [x] 1.2 移除 `Cargo.toml` 中的 `enigo = { version = "0.2", features = ["serde"] }` 行（零使用死依赖）
  - [x] 1.3 执行 `cargo check` 确认移除后编译通过

- [x] Task 2: 重写 hotkey_listener.rs 为 OS 原生双平台实作 (AC: #1, #5)
  - [x] 2.1 重新命名 plugin：`fn_key_listener.rs` → `hotkey_listener.rs`，更新 `mod.rs` 的 `pub mod`、`lib.rs` 的 `.plugin()` 呼叫和 plugin name（`"fn-key-listener"` → `"hotkey-listener"`）
  - [x] 2.2 建立 `HotkeyListenerState` struct，持有：
    - `trigger_key: Arc<Mutex<TriggerKey>>` — 当前触发键（enum）
    - `trigger_mode: Arc<Mutex<TriggerMode>>` — hold / toggle
    - `is_pressed: AtomicBool` — 防重复触发
    - `is_toggled_on: AtomicBool` — Toggle 模式开关状态
  - [x] 2.3 定义 `TriggerKey` enum，包含跨平台按键：
    - macOS: `Fn`（keycode 63）, `Option`（左 keycode 58）, `RightOption`（右 keycode 61）, `Control`（左 keycode 59）, `RightControl`（右 keycode 62）, `Command`（keycode 55）, `Shift`（keycode 56）
    - Windows: `RightAlt`（VK_RMENU + extended flag）, `LeftAlt`（VK_LMENU）, `Control`（VK_LCONTROL）, `Shift`（VK_LSHIFT）
    - 为 `TriggerKey` 实作 `Serialize`/`Deserialize`（供前端 invoke 传值使用）
  - [x] 2.4 `#[cfg(target_os = "macos")]` 区块：扩展现有 CGEventTap 实作
    - 保留 `fn_key_listener.rs` 已验证的 CGEventTap 架构（`CGEventTap::new` + `CFRunLoop`）
    - 扩展 `FlagsChanged` callback，新增对 Option/RightOption/Control/RightControl/Command/Shift 修饰键的 keycode 匹配
    - 修饰键 keycode 对照：Fn=63, Option(L)=58, Option(R)=61, Control(L)=59, Control(R)=62, Command(L)=55, Shift(L)=56
    - 修饰键对应 CGEventFlags：Option=`CGEventFlagAlternate`, Control=`CGEventFlagControl`, Command=`CGEventFlagCommand`, Shift=`CGEventFlagShift`
    - 依据 `trigger_key` 设定值动态决定监听哪个键，不再写死 Fn
    - 保留 Accessibility 权限检查（`AXIsProcessTrusted()` + prompt）
  - [x] 2.5 `#[cfg(target_os = "windows")]` 区块：使用已安装的 `windows` crate 实作
    - 在 `std::thread::spawn` 中建立 `SetWindowsHookExW(WH_KEYBOARD_LL, callback, None, 0)`
    - callback 解析 `KBDLLHOOKSTRUCT`，取 `vkCode` + `flags`（LLKHF_EXTENDED 区分左右 Alt）
    - 右 Alt 侦测：`vkCode == VK_MENU && flags.contains(LLKHF_EXTENDED)` → 右 Alt
    - 左 Alt 侦测：`vkCode == VK_MENU && !flags.contains(LLKHF_EXTENDED)` → 左 Alt
    - Hook thread 使用 `GetMessageW` 维持讯息回圈
    - 需新增 Cargo.toml windows features：`Win32_UI_Input_KeyboardAndMouse`
  - [x] 2.6 Hold 模式逻辑：KeyPress → emit `hotkey:pressed`（用 AtomicBool 防重复）；KeyRelease → emit `hotkey:released`（重置 AtomicBool）
  - [x] 2.7 Toggle 模式逻辑：仅 KeyPress → 翻转 `is_toggled_on`，emit `hotkey:toggled` 带 start/stop action
  - [x] 2.8 各平台按键验证：确认 macOS 5 键和 Windows 4 键都能正确触发事件
  - [x] 2.9 错误处理：CGEventTap 建立失败或 SetWindowsHookExW 失败时，透过 `eprintln!` 记录错误并透过 Tauri Event 通知前端权限问题

- [x] Task 3: 新增 Tauri Command 接收前端设定变更 (AC: #4)
  - [x] 3.1 新增 `#[command] fn update_hotkey_config(trigger_key: String, trigger_mode: String)` — 更新 `HotkeyListenerState` 中的 `trigger_key` 和 `trigger_mode`
  - [x] 3.2 在 `lib.rs` 的 `invoke_handler` 注册此 command
  - [x] 3.3 前端 useSettingsStore 变更设定时呼叫 `invoke('update_hotkey_config', { triggerKey, triggerMode })`

- [x] Task 4: 更新前端事件监听与型别 (AC: #2, #3)
  - [x] 4.1 在 `useTauriEvents.ts` 新增事件常数：`HOTKEY_PRESSED = "hotkey:pressed"`、`HOTKEY_RELEASED = "hotkey:released"`、`HOTKEY_TOGGLED = "hotkey:toggled"`
  - [x] 4.2 在 `types/events.ts` 新增 `HotkeyEventPayload` 介面：`{ mode: 'hold' | 'toggle', action: 'start' | 'stop' }`
  - [x] 4.3 在 `types/settings.ts` 新增或更新 `HotkeyConfig` 型别：`{ triggerKey: TriggerKey, triggerMode: TriggerMode }` 及相关 enum 型别
  - [x] 4.4 更新 `useVoiceFlow.ts`：将 `listen("fn-key-down")` / `listen("fn-key-up")` 替换为新的 `hotkey:pressed` / `hotkey:released` / `hotkey:toggled` 事件监听
  - [x] 4.5 Hold 模式：`hotkey:pressed` → 开始录音，`hotkey:released` → 停止录音
  - [x] 4.6 Toggle 模式：`hotkey:toggled` action=start → 开始录音，action=stop → 停止录音
  - [x] 4.7 移除 `useVoiceFlow.ts` 中对旧 `fn-key-down` / `fn-key-up` 事件的 listen

- [x] Task 5: 更新 useSettingsStore 设定持久化 (AC: #4)
  - [x] 5.1 实作 `loadSettings()` — 从 tauri-plugin-store 读取 `hotkeyConfig` 和 `triggerMode`
  - [x] 5.2 实作 `saveHotkeyConfig()` — 写入 tauri-plugin-store + 呼叫 `invoke('update_hotkey_config')` 即时同步至 Rust
  - [x] 5.3 App 启动时呼叫 `loadSettings()` 并透过 `invoke('update_hotkey_config')` 将设定传给 Rust 端
  - [x] 5.4 若无储存设定，使用平台预设值（macOS: Fn + Hold / Windows: 右Alt + Hold）
  - [x] 5.5 注意分工：本 Story 只实作 hotkeyConfig 和 triggerMode 的读写，API Key 的持久化在 Story 1.3 处理

- [x] Task 6: 整合验证 (AC: #1-5)
  - [x] 6.1 `cargo check` 通过（无 rdev、无 enigo）
  - [x] 6.2 `vite build` / `vue-tsc --noEmit` 通过（既存 transcriber.ts:17 错误非本 Story 范围）
  - [x] 6.3 手动测试：macOS Hold 模式 — Fn 键按住触发事件，放开停止
  - [x] 6.4 手动测试：macOS 其他修饰键（Option/Control/Command/Shift）— 切换后正确触发
  - [x] 6.5 手动测试：Toggle 模式 — 按一下开始，再按停止
  - [x] 6.6 手动测试：背景模式 — App 不在前景时全域热键仍运作
  - [x] 6.7 手动测试：动态设定 — 透过 invoke 变更触发键后即时生效

## Dev Notes

### 架构模式与约束

**这是 Brownfield 专案** — 基于 Story 1.1 已建立的 V2 基础架构（Pinia stores、双视窗、Tauri Events 封装）进行功能开发。

**依赖方向规则（严格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**错误处理模式：**
- Rust plugin 内部错误用 `eprintln!` 记录
- 权限问题透过 Tauri Event 通知前端
- 前端收到事件后由 composable 驱动流程

### 为何移除 rdev — 改用 OS 原生 API

**rdev 问题：**
- crates.io 版本 0.5.3 在 macOS + Tauri 环境有致命 bug（任何 KeyPress 导致 App exit，exit code 0）
- 该 bug 已在 [Narsil/rdev#147](https://github.com/Narsil/rdev/pull/147) 修复并合并至 main branch（2025-05-20）
- 但作者至今未发新版到 crates.io（0.5.3 已超过 2 年未更新）
- 唯一解法是使用 git 依赖（`rdev = { git = "..." }`），但这带来不稳定性和审计风险

**OS 原生 API 优势：**
- macOS：`fn_key_listener.rs` 已有完整可用的 CGEventTap 实作，只需扩展支援多键
- Windows：已安装的 `windows` crate 直接支援 `SetWindowsHookExW` + `WH_KEYBOARD_LL`
- 不引入额外 crate，降低依赖风险
- 完全控制按键判断逻辑，不受第三方 crate 的抽象限制

### enigo 依赖移除

`enigo = { version = "0.2", features = ["serde"] }` 是死依赖 — 零使用。全专案（包含 `clipboard_paste.rs`）未引用 enigo 的任何 API。原本预期用于键盘模拟，但 `clipboard_paste.rs` 实际使用 `CGEventCreateKeyboardEvent`（macOS）和 `SendInput`（Windows）直接实作。安全移除。

### macOS CGEventTap 修饰键 keycode 对照表

```
修饰键        keycode    CGEventFlags
─────────────────────────────────────────
Fn/Globe     63         CGEventFlagSecondaryFn
Option (L)   58         CGEventFlagAlternate
Option (R)   61         CGEventFlagAlternate
Control (L)  59         CGEventFlagControl
Control (R)  62         CGEventFlagControl
Command (L)  55         CGEventFlagCommand
Command (R)  54         CGEventFlagCommand
Shift (L)    56         CGEventFlagShift
Shift (R)    60         CGEventFlagShift
```

**备注：** 左右修饰键产生不同 keycode 但同一个 CGEventFlag。目前 Option 和 Control 支援左右独立选择（左 Option keycode 58 / 右 Option keycode 61、左 Control keycode 59 / 右 Control keycode 62）。Fn 键使用 keycode 63 + `CGEventFlagSecondaryFn` 双重判断。

### Windows WH_KEYBOARD_LL 实作要点

```rust
// 需要的 windows crate features（Cargo.toml 需新增）
"Win32_UI_Input_KeyboardAndMouse"

// Hook 安装
SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0)

// Callback 签名
unsafe extern "system" fn hook_proc(
    n_code: i32, w_param: WPARAM, l_param: LPARAM
) -> LRESULT

// 解析 KBDLLHOOKSTRUCT
let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
let vk_code = kbd.vkCode;
let is_extended = kbd.flags.contains(LLKHF_EXTENDED);

// 左右 Alt 区分
// vkCode == VK_MENU(0xA4) + LLKHF_EXTENDED → 右 Alt
// vkCode == VK_MENU(0xA4) + !LLKHF_EXTENDED → 左 Alt

// 讯息回圈维持 Hook 存活
let mut msg = MSG::default();
while GetMessageW(&mut msg, None, 0, 0).as_bool() {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
}
```

**关键约束：**
- `SetWindowsHookExW` 必须在有讯息回圈的 thread 中呼叫
- callback 中不能有长时间阻塞操作
- Hook thread 必须用 `std::thread::spawn`（不能用 tokio spawn）

### 不需要 DeviceEventFilter

原 spec 中 Task 3（设定 Tauri DeviceEventFilter）已移除。原因：
- 该设定是为了解决 rdev 在 Tauri 视窗 focus 时收不到键盘事件的问题
- CGEventTap 和 WH_KEYBOARD_LL 都在 OS 层级拦截事件，不受 Tauri 视窗 focus 影响
- `fn_key_listener.rs` 已验证 CGEventTap 在 Tauri focus 时正常运作

### Fn 键侦测限制（macOS）

Fn/Globe 键在 macOS 上的侦测需要多种策略：
- macOS 系统拦截 Fn 键用于切换功能键行为
- 较新的 macOS 版本（Ventura+）将 Fn 键重新映射为 Globe 键（切换输入法/表情）
- `fn_key_listener.rs` 已验证可行的双重侦测策略：keycode 63 + `CGEventFlagSecondaryFn`

**缓解策略（已验证）：**
1. `FlagsChanged` 事件：**只回应 keycode 63**，用 `CGEventFlagSecondaryFn` flag 判断 press/release（不回应非 keycode-63 的 FlagsChanged，避免 Globe 键输入法切换等系统事件误触 release）
2. `KeyDown`/`KeyUp` 事件：匹配 keycode 63 作为 fallback
3. 若 Fn 完全不可用，建议使用者改用其他修饰键
4. 在设定页面清楚标示 Fn 键可能有相容性问题

### HotkeyListenerState 设计

```rust
struct HotkeyListenerState {
    trigger_key: Arc<Mutex<TriggerKey>>,    // 可配置触发键
    trigger_mode: Arc<Mutex<TriggerMode>>,  // hold | toggle
    is_pressed: AtomicBool,                  // Hold 模式防重复
    is_toggled_on: AtomicBool,               // Toggle 模式开关
}

#[derive(Serialize, Deserialize, Clone)]
enum TriggerKey {
    // macOS（keycode）
    Fn,              // 63
    Option,          // 58 (left)
    RightOption,     // 61
    Command,         // 55
    // Windows（VK code）
    RightAlt,        // VK_MENU + LLKHF_EXTENDED
    LeftAlt,         // VK_MENU
    // 跨平台
    Control,         // macOS: 59 (left), Windows: VK_LCONTROL
    RightControl,    // macOS: 62
    Shift,           // macOS: 56, Windows: VK_LSHIFT
}

enum TriggerMode {
    Hold,    // 按住触发，放开停止
    Toggle,  // 按一下开始，再按一下停止
}
```

**Arc<Mutex<T>> 用于可配置栏位** — `trigger_key` 和 `trigger_mode` 需要被主线程（Tauri Command）修改、被 OS hook thread 读取。`AtomicBool` 用于高频读写的布林旗标。

### 执行绪模型

```
Main Thread (Tauri)
    │
    ├─ std::thread::spawn → OS-native event loop
    │     ↑
    │     ├─ [macOS] CGEventTap + CFRunLoop (blocking)
    │     └─ [Windows] SetWindowsHookExW + GetMessageW (blocking)
    │     │
    │     └─ callback(event) → 匹配触发键 → app_handle.emit(...)
    │
    └─ Tauri Event Loop (正常 UI 运作)
```

**关键约束：**
- OS hook 必须在 `std::thread::spawn` 中执行，**不能**用 `tokio::spawn` 或 `async_runtime::spawn`
- callback 中不能有长时间阻塞操作，emit 是非阻塞的
- macOS CGEventTap 需要 Accessibility 权限
- Windows WH_KEYBOARD_LL 不需要特殊权限

### 现有程式码改动点

**重写档案：**
```
src-tauri/src/plugins/fn_key_listener.rs → hotkey_listener.rs（重新命名 + 扩展重写）
```

**修改档案：**
```
src-tauri/src/plugins/mod.rs          — 改 pub mod fn_key_listener → pub mod hotkey_listener
src-tauri/src/lib.rs                  — 改 plugin 注册名 + 新增 invoke_handler command
src-tauri/Cargo.toml                  — 移除 rdev + enigo，新增 windows features
src/composables/useVoiceFlow.ts       — 替换 listen("fn-key-down"/"fn-key-up") 为新事件
src/composables/useTauriEvents.ts     — 新增 HOTKEY_PRESSED / HOTKEY_RELEASED / HOTKEY_TOGGLED 常数
src/types/events.ts                   — 新增 HotkeyEventPayload 介面
src/types/settings.ts                 — 新增/更新 HotkeyConfig、TriggerKey、TriggerMode 型别
src/stores/useSettingsStore.ts        — 实作 loadSettings() / saveHotkeyConfig()
```

**不修改的档案（明确排除）：**
- `App.vue` — HUD 行为不变
- `MainApp.vue` — UI 不变（设定页面的 UI 在 Story 5.1）
- `useVoiceFlowStore.ts` — store 骨架不变（迁移在 Story 1.4）
- `useHudState.ts` — HUD 状态管理不变
- `recorder.ts` / `transcriber.ts` — 录音转录逻辑不变

**⚠️ 不要移除的 Cargo 依赖：**
- `core-graphics`、`core-foundation`、`objc` — 被 `lib.rs` 的 `configure_macos_notch_window()` 使用（HUD 视窗层级设定），重写后 hotkey_listener 也继续使用 CGEventTap
- `windows` crate — 被 `lib.rs` 的 `configure_windows_topmost_window()` 使用，hotkey_listener 新增 hook 也需要

### Tauri Event 名称变更（Breaking Change）

| 旧事件 | 新事件 | 方向 |
|--------|--------|------|
| `fn-key-down` | `hotkey:pressed` | Rust → Frontend |
| `fn-key-up` | `hotkey:released` | Rust → Frontend |
| （无） | `hotkey:toggled` | Rust → Frontend |

**Payload 变更：**
- 旧：`()` 空 payload
- 新：`{ mode: "hold" | "toggle", action: "start" | "stop" }`

### macOS Accessibility 权限

保留现有的 Accessibility 权限检查逻辑（`AXIsProcessTrusted()` + `AXIsProcessTrustedWithOptions`），从 `fn_key_listener.rs` 迁移至新的 `hotkey_listener.rs`。CGEventTap 需要 Accessibility 权限才能运作。

若未授权：`CGEventTap::new()` 回传 `Err(())`，需引导使用者至 System Settings > Privacy & Security > Accessibility 授权。

### 已知技术债

| 依赖 | 问题 | 处理方式 |
|------|------|----------|
| `objc` 0.2 | 停滞 5 年，最后更新 2020。社群已迁移至 `objc2` | 暂不处理 — 被 `core-graphics` 间接依赖，自行替换成本极高 |
| `core-graphics` 0.24 | 缓慢维护，底层依赖 `objc` 0.2 | 暂不处理 — 自建 FFI 取代成本极高，且功能稳定可用 |
| `core-foundation` 0.10 | 缓慢维护 | 暂不处理 — 同上理由 |

这些依赖功能稳定，目前不影响正确性，但长期需关注 `objc2` 生态的成熟度。未来 `core-graphics` 若发布基于 `objc2` 的新版本，可一次性迁移。

### 跨 Story 注意事项

- **Story 1.3** 会实作 useSettingsStore 的完整持久化（tauri-plugin-store）。本 Story 先实作 hotkeyConfig 和 triggerMode 的设定载入/储存框架，Story 1.3 再补齐 API Key 相关逻辑。
- **Story 1.4** 会将 `useVoiceFlow.ts` 的录音流程迁移至 `useVoiceFlowStore`。本 Story 保持 composable 模式不变，只替换事件名称。
- **Story 5.1** 会建立快捷键设定 UI（SettingsView.vue 的下拉选单）。本 Story 只处理后端 + 事件系统 + store 逻辑。

### 技术版本确认（2026-03-01）

| 技术 | 版本 | 备注 |
|------|------|------|
| macOS CGEventTap | core-graphics 0.24 | 已在 fn_key_listener.rs 验证，扩展多键支援 |
| Windows SetWindowsHookExW | windows 0.61 | 已安装，需新增 `Win32_UI_Input_KeyboardAndMouse` feature |
| tauri-plugin-store | ~2.4 | 设定持久化 |

### 前一个 Story (1.1) 关键学习

- `cargo check` 会有既存 warnings（objc macro cfg, dead_code）— 不影响功能
- `vue-tsc --noEmit` 有既存 `import.meta.env` 型别错误（transcriber.ts:17）— 非本 Story 范围
- tauri-plugin-updater 已从 lib.rs 移除（commit ae44200）— 不要重新加入
- Pinia stores 已建立骨架但 actions 皆为空 TODO — 本 Story 只实作 useSettingsStore 部分功能

### Plugin 重新命名注意

将 `fn_key_listener` 重新命名为 `hotkey_listener`：
- 档案名：`fn_key_listener.rs` → `hotkey_listener.rs`
- Plugin name：`"fn-key-listener"` → `"hotkey-listener"`
- `mod.rs` 中的 `pub mod` 也需同步更新
- `lib.rs` 中的 `.plugin()` 呼叫也需更新

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions — Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/prd.md#语音触发与录音 FR1-FR3]
- [Source: _bmad-output/implementation-artifacts/1-1-v2-infrastructure-dual-window.md — 跨 Story 警告]
- [Source: Codebase — src-tauri/src/plugins/fn_key_listener.rs（CGEventTap 实作基础）]
- [Source: Dependency audit — rdev 0.5.3 macOS bug, enigo 0.2 zero usage, objc 0.2 stale]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- cargo check: 通过（移除 rdev/enigo 后零错误）
- cargo test: 14/14 通过（无回归）
- vue-tsc --noEmit: 仅既存 transcriber.ts:17 错误（非本 Story 范围）

### Completion Notes List

- ✅ Task 1: 移除 rdev 0.5.3 和 enigo 0.2 依赖，cargo check 通过
- ✅ Task 2: 完全重写 hotkey_listener.rs — macOS CGEventTap 扩展支援 7 键（Fn/Option/RightOption/Control/RightControl/Command/Shift），Windows WH_KEYBOARD_LL 支援 4 键（RightAlt/LeftAlt/Control/Shift），Hold/Toggle 双模式，动态 trigger_key 切换
- ✅ Task 3: 新增 update_hotkey_config Tauri Command，支援前端动态变更触发键和模式，config 变更时自动重置 is_pressed/is_toggled_on 状态
- ✅ Task 4: 前端事件系统全面更新 — fn-key-down/fn-key-up 替换为 hotkey:pressed/hotkey:released/hotkey:toggled，新增 HotkeyEventPayload 型别，useVoiceFlow.ts 支援 Hold 和 Toggle 双模式
- ✅ Task 5: useSettingsStore 实作 loadSettings()/saveHotkeyConfig()，tauri-plugin-store 持久化 + 启动时同步 Rust + 平台预设值侦测
- ✅ Task 6: 整合验证 — cargo check ✓, vue-tsc ✓, cargo test 14/14 ✓

### Implementation Notes

- HotkeyListenerState 的 is_pressed/is_toggled_on 改为 Arc<AtomicBool>（原 spec 为 AtomicBool），因需跨线程共享（hook thread ↔ main thread）
- Windows hook 使用 OnceLock + Box<dyn Fn(bool)> 解决 hook callback 无法携带泛型 AppHandle<R> 的问题
- Fn 键使用 flag-based 侦测策略：FlagsChanged 只回应 keycode 63 + `CGEventFlagSecondaryFn` 判断 press/release（原 toggle-based 逻辑已移除，因 Globe 键会产生额外 FlagsChanged 事件导致误触 release）
- update_hotkey_config 使用 serde_json 反序列化 camelCase 字串为 TriggerKey/TriggerMode enum
- 前端 TriggerKey 使用 union type 而非 TypeScript enum，保持与 Rust serde(rename_all = "camelCase") 一致

### Change Log

- 2026-03-01: Story 1.2 完整实作 — 跨平台全域热键系统（OS-native API），移除 rdev/enigo，新增 Hold/Toggle 双模式，设定持久化
- 2026-03-02: Code review 修复 — 新增前端 hotkey:error 事件处理、Windows hook 失败通知前端、Windows hook callback mutex 安全改用 try_lock
- 2026-03-03: 新增右侧修饰键支援 — macOS TriggerKey 新增 RightOption（keycode 61）和 RightControl（keycode 62），macOS 触发键选项从 5 → 7 个

### File List

- src-tauri/Cargo.toml — 移除 rdev/enigo 依赖，新增 Win32_UI_Input_KeyboardAndMouse feature
- src-tauri/src/plugins/hotkey_listener.rs — 新增（原 fn_key_listener.rs 重新命名 + 完全重写）；review 修复: Windows hook 失败 emit hotkey:error + try_lock 防 panic
- src-tauri/src/plugins/fn_key_listener.rs — 删除（重新命名为 hotkey_listener.rs）
- src-tauri/src/plugins/mod.rs — 修改 pub mod fn_key_listener → pub mod hotkey_listener
- src-tauri/src/lib.rs — 修改 plugin 注册 + 新增 update_hotkey_config command
- src/composables/useTauriEvents.ts — 新增 HOTKEY_PRESSED/HOTKEY_RELEASED/HOTKEY_TOGGLED/HOTKEY_ERROR 常数
- src/composables/useVoiceFlow.ts — 替换事件监联为新 hotkey 事件，新增 Toggle 模式支援，启动时载入设定；review 修复: 新增 hotkey:error listener
- src/types/events.ts — 新增 HotkeyEventPayload、HotkeyErrorPayload 介面
- src/types/settings.ts — 更新 HotkeyConfig 介面，新增 TriggerKey 型别
- src/stores/useSettingsStore.ts — 实作 loadSettings()/saveHotkeyConfig()，tauri-plugin-store 持久化
