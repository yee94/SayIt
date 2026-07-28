# Architecture — Backend Part

> Tauri v2 Rust runtime · macOS Private API + Windows Win32
> 扫描日期：2026-05-08 · 版本：0.9.5 · part_id: `backend` · root: `src-tauri/`

---

## 一、Executive Summary

SayIt backend 是一个 **Tauri v2 Rust runtime**，扮演四个角色：

1. **WebView 容器与视窗管理** — 载入两个 webview（HUD + Dashboard），配置 macOS 浏海覆盖层级 / Windows TOPMOST
2. **System integration broker** — 全域热键、剪贴簿模拟贴上、系统音量控制、AX API 文字场读取
3. **音讯管线** — cpal 录音、WAV 写档、FFT 波形分析、档案管理（含自动清理）
4. **转录客户端** — Rust 直接呼叫 Groq Whisper API（绕过前端 fetch）

整个 binary 大小靠 release profile（`panic=abort`、`lto=true`、`opt-level=s`、`strip=true`、`codegen-units=1`）压到最小。

---

## 二、Technology Stack

| 类别               | 套件                  | 版本    | 用途                                                |
| ------------------ | --------------------- | ------- | --------------------------------------------------- |
| Framework          | tauri                 | 2       | features: tray-icon, macos-private-api, image-png, protocol-asset |
| Edition            | Rust                  | 2021    | stable toolchain                                    |
| Plugins            | shell, http, sql (sqlite), store, autostart, updater, process, single-instance | 2.x | 全部官方 plugin |
| Telemetry          | sentry                | 0.46    | guard 模式，environment / DSN 用 env 驱动           |
| 音讯               | cpal                  | 0.15    | 跨平台输入装置（macOS Arc cycle workaround）        |
| 音讯编码           | hound                 | 3.5     | WAV writer                                          |
| 音讯分析           | rustfft               | 6       | FFT 波形                                            |
| HTTP               | reqwest               | 0.12    | features: multipart, json（Whisper API）            |
| 剪贴簿             | arboard               | 3       | 跨平台读写剪贴簿                                    |
| 序列化             | serde + serde_json    | 1       | derive macro                                        |
| 错误               | thiserror             | 2       | 结构化错误型别                                      |
| **macOS only**     | core-graphics         | 0.24    | CGEventTap、CGEvent                                 |
|                    | core-foundation       | 0.10    | CFRelease                                           |
|                    | objc                  | 0.2     | NSWindow private API（setLevel:、collectionBehavior） |
|                    | （原生 FFI）          | —       | CoreAudio AudioObjectGet/SetPropertyData（系统音量） |
| **Windows only**   | windows               | 0.61    | Win32：foundation、WindowsAndMessaging、KeyboardAndMouse、Audio、Audio_Endpoints、Com、Threading |

---

## 三、Architecture Pattern：「lib.rs 中央注册 + plugins/ 平面模组」

```
┌──────────────────────────────────────────────────────────┐
│                       lib.rs (892 LOC)                   │
│                                                          │
│   pub fn run() {                                         │
│     sentry::init(...)                                    │
│     tauri::Builder::default()                            │
│       .plugin(single_instance, shell, http, sql, ...)    │
│       .plugin(plugins::hotkey_listener::init())          │
│       .invoke_handler(generate_handler![ 34 commands ])  │
│       .setup(|app| {                                     │
│           app.manage(KeyboardMonitorState::new());       │
│           app.manage(AudioControlState::new());          │
│           app.manage(FocusState::new());                 │
│           app.manage(AudioRecorderState::new());         │
│           app.manage(AudioPreviewState::new());          │
│           app.manage(TranscriptionState::new());         │
│           // tray + window config                        │
│       })                                                 │
│       .on_window_event(close → hide)                     │
│       .build().run(|_, RunEvent::Exit| {                 │
│           graceful_shutdown_in_order();                  │
│           _exit(0);                                      │
│       })                                                 │
│   }                                                      │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────┐
        │            plugins/ (8 个模组)          │
        │  hotkey_listener   audio_recorder       │
        │  keyboard_monitor  clipboard_paste      │
        │  audio_control     transcription        │
        │  text_field_reader sound_feedback       │
        └─────────────────────────────────────────┘
```

**模组组织逻辑**：

- `plugins/mod.rs` 只有 8 行 — 纯 `pub mod xxx;` 宣告，**不做 facade**
- 每个模组自包含：state struct + commands + helper functions + tests
- `hotkey_listener` 是唯一以 Tauri plugin 形式注册（透过 `init()`），其他都是 `invoke_handler!` 直接列出

---

## 四、Plugin Module 详细

### 4.1 `hotkey_listener.rs`（1571 LOC · 最大模组）

**职责**：跨平台全域热键监听 + 录制模式（让使用者按下键组合录成设定）

| 平台    | 实作                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| macOS   | `CGEventTap` 在 background thread + RunLoop                                         |
| Windows | `SetWindowsHookEx(WH_KEYBOARD_LL)` 全域低阶 hook                                    |

**对外契约**：
- 7 个 Command：`check_accessibility_permission_command`、`open_accessibility_settings`、`reinitialize_hotkey_listener`、`reset_hotkey_state`、`start_hotkey_recording`、`cancel_hotkey_recording`、（透过 `lib.rs` 的 `update_hotkey_config`）
- 8 个 Event：`hotkey:pressed`、`hotkey:released`、`hotkey:toggled`、`hotkey:error`、`hotkey:mode-toggle`、`escape:pressed`、`hotkey:recording-captured`、`hotkey:recording-rejected`

**关键型别**：`TriggerKey`、`TriggerMode`（"hold"/"toggle"）、`HotkeyEventPayload`

**Windows 怪行为**：Copilot 键会发送 `VK_F23 (0x86)`，hook 必须 early-return 否则干扰 Quick View（PR #29，v0.9.5+）

**State 管理**：`HotkeyListenerState` 由 `init()` 内部注册，含 `update_config()` 与 `shutdown()` 方法

### 4.2 `audio_recorder.rs`（1116 LOC）

**职责**：cpal 录音 + WAV 写档 + 波形 FFT + 档案管理

| 函式类别          | 范例                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| 录音生命周期      | `start_recording`、`stop_recording`                                                  |
| 预览（音量条）    | `start_audio_preview`、`stop_audio_preview` → emit `audio:preview-level`             |
| 档案管理          | `save_recording_file`、`read_recording_file`、`delete_all_recordings`、`cleanup_old_recordings` |
| 装置查询          | `get_default_input_device_name`、`list_audio_input_devices`                          |

**事件**：
- `audio:waveform` — 录音中每帧 FFT 后送 6 段振幅给 HUD 动画
- `audio:preview-level` — 设定页面音量条

**已知 macOS 怪事**：cpal 0.15.3 在非预设装置切换时会因 CoreAudio disconnect listener 的 Arc cycle 泄漏 ~1-2 KB/次。已加 workaround 但等 cpal 上游修复。

**State**：`AudioRecorderState`（共用 cpal Stream + buffer）、`AudioPreviewState`（独立 cpal Stream）

### 4.3 `keyboard_monitor.rs`（629 LOC）

**职责**：监测使用者后续键盘行为（用于 hallucination 侦测 + 智慧字典学习）

- `start_quality_monitor` — 贴上后监测使用者是否大幅修改 → emit `quality-monitor:result`（payload 含修改比例）
- `start_correction_monitor` — 监测修正动作 → emit `correction-monitor:result`（payload 含 corrected term）

两者都用 macOS `CGEventTap` 监听 keyDown 事件，结束条件是「N 秒无动作」或「使用者切视窗」。

### 4.4 `clipboard_paste.rs`（483 LOC）

| Command                  | 平台实作                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `paste_text`             | macOS：`simulate_paste_via_cgevent()`（Cmd+V）；Windows：`SendInput Ctrl+V`                  |
| `copy_to_clipboard`      | 跨平台 `arboard`                                                                               |
| `capture_target_window`  | 纪录录音前的焦点视窗（macOS NSWorkspace），用于贴上前恢复焦点                                  |

**ADR 参考**（`docs/adr-paste-mechanism.md`，2026-03-08）：
- 排除：AX Menu Press（LINE 无选单）、osascript（需 Automation 权限）
- 选定：CGEvent Cmd+V

**State**：`FocusState`（Windows 用，纪录焦点视窗 HWND）

### 4.5 `audio_control.rs`（447 LOC）

**职责**：静音 / 还原系统音讯（避免录音时 app 自身音效回授）

| 平台    | 实作                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| macOS   | 原生 CoreAudio FFI：`AudioObjectGetPropertyData` / `AudioObjectSetPropertyData` 控制 `kAudioDevicePropertyMute` |
| Windows | `IAudioEndpointVolume::SetMute`                                                     |

**State**：`AudioControlState` 纪录是否已 mute、原始 mute state（用于还原）

> ⚠️ `RunEvent::Exit` 必须**最先**呼叫 `shutdown()` 还原音量，不然 app 结束后系统永远静音。

### 4.6 `transcription.rs`（324 LOC）

**职责**：直接从 Rust 端打 Groq Whisper API（绕过前端 CORS / fetch）

| Command                  | 用途                                              |
| ------------------------ | ------------------------------------------------- |
| `transcribe_audio`       | 从 `AudioRecorderState` 拿 buffer 直接 multipart 送 Groq |
| `retranscribe_from_file` | HistoryView 对历史 .wav 重新转录                  |

**State**：`TranscriptionState` 持有共用的 `reqwest::Client`（避免每次 new TLS）

**参数**：`api_key`, `vocabulary_term_list?`, `model_id?`（预设 `whisper-large-v3`）, `language?`（`null` = auto）

### 4.7 `text_field_reader.rs`（325 LOC · macOS only）

**职责**：用 macOS Accessibility API 读取游标所在输入框内容（用于 Edit Mode）

- `read_focused_text_field` — 读取焦点输入框完整内容
- `read_selected_text` — 读取选取文字（v0.9.1 改用 Cmd+C clipboard approach 后相容更多 App）

**已知问题**：选取文字方案在 Fn 按住期间执行会因 hardware flag 穿透导致 "c" 字元输入（GitHub #25）

### 4.8 `sound_feedback.rs`（206 LOC）

播放 `resources/sounds/start.wav`、`stop.wav` 与内建 error / learned 音效。用 `cpal` 直接播放 buffer，不依赖系统音效。

---

## 五、Managed States（5 个）

Tauri v2 的 `app.manage()` 注册单例 state，每个 `#[command]` 透过 `State<T>` 注入：

| State                          | 模组                              | 包含                                                  |
| ------------------------------ | --------------------------------- | ----------------------------------------------------- |
| `KeyboardMonitorState`         | keyboard_monitor                  | quality / correction CGEventTap 控制                  |
| `AudioControlState`            | audio_control                     | mute 旗标、原始 state（还原用）                       |
| `FocusState`                   | clipboard_paste                   | Windows 焦点 HWND 纪录                                |
| `AudioRecorderState`           | audio_recorder                    | cpal Stream、WAV writer、buffer                       |
| `AudioPreviewState`            | audio_recorder                    | 独立 cpal Stream（音量预览用，不污染主录音）          |
| `TranscriptionState`           | transcription                     | 共用 `reqwest::Client`                                |
| `HotkeyListenerState`          | hotkey_listener                   | （由 plugin init 自行注册）TriggerKey / Mode、CGEventTap |

> 所有 State 都实作 `shutdown()`，用于 `RunEvent::Exit` 释放系统资源。

---

## 六、Window Configuration（macOS / Windows 差异）

### 6.1 macOS（`configure_macos_notch_window`）

```
NSWindow 属性透过 objc::msg_send 设定：
  setLevel: 27                       ← NSMainMenuWindowLevel(24) + 3
  setCollectionBehavior:             ← 1 | 16 | 64 | 256
    canJoinAllSpaces (1)
    stationary (16)                  ← 桌面切换不移动
    ignoresCycle (64)
    fullScreenAuxiliary (256)        ← 全萤幕时仍显示
  setMovable: false                  ← 防止拖动
```

> 此设定模仿 BoringNotch 的浏海覆盖层级。

### 6.2 Windows（`configure_windows_topmost_window`）

```
GetWindowLongPtrW(GWL_EXSTYLE) → 加入：
  WS_EX_TOOLWINDOW   ← 不出现 Alt+Tab / taskbar，跨虚拟桌面
  WS_EX_NOACTIVATE   ← 点击不抢焦点
SetWindowPos(HWND_TOPMOST, ...)
  SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED
```

---

## 七、Multi-Monitor HUD Tracking

`get_hud_target_position` Command 是 HUD 的**多萤幕定位核心**：

```
1. get_cursor_position()                   ← macOS logical points / Windows virtual screen
2. app.available_monitors()                ← 列举所有萤幕
3. find_monitor_for_cursor(cursor, monitors, is_macos)
                                           ← 纯函式，11 个单元测试
4. calculate_centered_window_x_logical(width, sf, HUD_WIDTH)
                                           ← logical 偏移（绕过 tao cross-DPI bug）
5. 回传 LogicalPosition + monitor_key
```

**为什么用 logical 而非 physical 座标？** tao 的 `set_outer_position` 在 cross-DPI 环境下会用「视窗当前萤幕的 sf」而非「目标萤幕的 sf」做转换 — 这个 bug 在外接显示器+Retina 场景下会把视窗放到错误位置。改用 `LogicalPosition` 跳过 tao 的转换逻辑。

`find_monitor_for_cursor` 的 fallback 行为：若游标不在任何萤幕内（rounding 间隙），找**距离游标最近的萤幕中心**而非固定 index 0。这是经过真实多萤幕场景测试过的设计。

---

## 八、Sentry Integration

```
fn run() {
  let _sentry_guard = if is_sentry_enabled() {
    Some(sentry::init((dsn, ClientOptions {
      release: Some(get_sentry_release().into()),  ← 预设 sayit@<CARGO_PKG_VERSION>
      environment: Some(get_sentry_environment().into()),
      send_default_pii: false,                     ← 不发送 PII
      ..Default::default()
    })))
  } else { None };
  // ... tauri::Builder ...
}
```

**Guard 模式**：`_sentry_guard` 绑在 `run()` 局部变数，app 结束时 drop 才 flush。`RunEvent::Exit` handler 额外呼叫 `client.flush(2s)` 确保事件送出。

**启用条件**：`SENTRY_ENVIRONMENT == "production"` 且 `SENTRY_DSN` 有值且非 `__` 开头。

> 「`__` 开头」这个筛选是为了防 GitHub Secret 没设时 fallback 变数被当成有效值。

---

## 九、Restart 机制（`request_app_restart` + `RunEvent::Exit`）

Tauri 内建 restart 逻辑与 `_exit(0)` 不相容（`_exit` 会 bypass cleanup），因此 SayIt 自制：

```
1. Frontend invoke('request_app_restart')
2. Rust set RESTART_REQUESTED = true
3. app.exit(0) → 触发 RunEvent::Exit
4. Exit handler 跑完所有 graceful shutdown
5. 检查 RESTART_REQUESTED：
   true → Command::new(current_exe).spawn() 启新 process
6. _exit(0) 结束旧 process
```

> 用 `_exit(0)` 而非 `std::process::exit(0)` 是为了确保 cleanup 后立刻结束、不执行 atexit handler / static destructor（避免 Tauri 内建 restart 逻辑介入）。

---

## 十、Build Profile（Release 最佳化）

```toml
[profile.release]
panic = "abort"        # 不展开 unwind stack（缩小 binary）
codegen-units = 1      # 全 crate 一起 codegen（最佳化更激进）
lto = true             # Link-Time Optimization
opt-level = "s"        # 大小优先（不是 "z"，留一点速度）
strip = true           # 剥离 debug symbols
```

**结果**：macOS arm64 dmg 约 8-12 MB，Windows .exe 约 10-15 MB。

---

## 十一、Testing

Rust 测试内嵌于各模组的 `#[cfg(test)] mod tests`：

| 模组                              | 测试焦点                                        |
| --------------------------------- | ----------------------------------------------- |
| `lib.rs`                          | `find_monitor_for_cursor`（11 测试）+ `calculate_centered_window_x*`（5 测试） |
| `hotkey_listener.rs`              | TriggerKey 解析、modifier 逻辑                  |
| `clipboard_paste.rs`              | （需测试实机因依赖系统 API）                    |

CI 只跑 `cargo check`（不跑 `cargo test`）— **这是个 CI tech debt**，后续应加 `cargo test --workspace`。

---

## 十二、Hard Rules / 不可违反

1. **❌ webview 直接 fetch Groq Whisper** → ✅ Rust `transcribe_audio` 直呼（multipart 在前端有限制）
2. **❌ `shutdown()` 顺序错乱** → ✅ 严守 §RunEvent::Exit 的顺序（音量 → 预览 → 录音 → keyboard monitor → hotkey）
3. **❌ 在 Rust 端硬编码 Sentry release** → ✅ 用 `option_env!("SENTRY_RELEASE")` 由 release.yml 注入
4. **❌ 修改 `Cargo.lock`** → ✅ `protect-config.sh` hook 阻挡；只能透过 `cargo` 自动更新
5. **❌ 动 `panic = "abort"`** → ✅ 影响 binary 大小与 fault tolerance，非必要不改
6. **❌ 在 plugin 内部呼叫 `app.exit(0)`** → ✅ 统一由 frontend 发起或 tray menu 触发

---

## 十三、Open Tech Debt

| 项目                                                           | 影响                                  |
| -------------------------------------------------------------- | ------------------------------------- |
| CI 只跑 `cargo check`，没跑 `cargo test`                        | 17+ 纯函式测试没有 CI 守门            |
| 没有 `cargo clippy` lint                                       | 风格 / lint 错误可能漏网              |
| cpal 0.15.3 非预设装置 Arc cycle workaround                     | 上游修复 cpal 0.16+ 后可移除          |
| `text_field_reader::read_selected_text` Fn-c 字元穿透           | issue #25 待修                        |
| Windows 贴上 / 焦点切换 P0 issue                                | 待修                                  |
| addApiUsage FK 失败 (787)                                       | DB 统计资料偶失                       |
