# Integration Architecture — Frontend ↔ Backend

> Tauri v2 multi-part desktop app · Vue 3 frontend ↔ Rust backend
> 同步来源：`CLAUDE.md` 的 IPC 契约表（authoritative） + `lib.rs:416` 的 `invoke_handler!` macro
> 扫描日期：2026-05-08 · 版本：0.9.5

本文件描述 SayIt 两个 part 之间如何协作 — 是 PRD / 新功能设计时必读的「边界契约」。

---

## 一、整合形式总览

SayIt 采典型 **Tauri 双向 IPC 模式**，没有外部 message broker，所有跨端通讯走两条轨道：

```
 ┌─────────────────────────────────────────────────────────────┐
 │            Frontend Bundle（两个独立 entry）                │
 │                                                             │
 │   ┌──────────────────┐         ┌──────────────────────┐     │
 │   │   HUD WebView    │         │  Dashboard WebView   │     │
 │   │ index.html       │         │ main-window.html     │     │
 │   │ main.ts → App    │         │ main-window.ts → MainApp │ │
 │   │ label="main"     │         │ label="main-window"  │     │
 │   └────┬──────┬──────┘         └────┬──────┬──────────┘     │
 │        │      ▲                     │      ▲                │
 │        │ invoke()           emit/listen    │                │
 │        ▼      │                     ▼      │                │
 │  ─────────────────────  Tauri IPC Bus  ───────────────────  │
 │        │      ▲                     │      ▲                │
 │        ▼      │                     ▼      │                │
 │   ┌─────────────────────────────────────────────────────┐   │
 │   │                Tauri Backend (Rust)                 │   │
 │   │  lib.rs::run() invoke_handler! + plugin macros      │   │
 │   │  ┌──────────────┐  ┌──────────────────┐             │   │
 │   │  │ 8 plugins    │  │ 5 managed states │             │   │
 │   │  │ (.rs)        │  │ (Arc<Mutex>)     │             │   │
 │   │  └──────────────┘  └──────────────────┘             │   │
 │   └─────────────────────────────────────────────────────┘   │
 └─────────────────────────────────────────────────────────────┘
```

**整合点分类**：

| 轨道                             | 方向              | 用途                                                                                |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| **Tauri Commands（invoke）**     | Frontend → Rust   | RPC 式同步呼叫，回传 `Result<T, E>`。共 **34 个** command                          |
| **Tauri Events（emit/listen）**  | Rust → Frontend   | 系统推送（热键、波形、品质监测）。共 **15 个** Rust→FE event                        |
| **Frontend-only Events**         | FE Window ↔ FE Window | HUD 与 Dashboard 跨视窗广播（不经 Rust）。共 **5 个** FE-only event              |

---

## 二、Frontend 双视窗的责任切分

| 视窗            | label          | HTML 入口             | TS 入口               | 大小      | 显示策略                                            |
| --------------- | -------------- | --------------------- | --------------------- | --------- | --------------------------------------------------- |
| **HUD**         | `main`         | `index.html`          | `src/main.ts`         | 470×100   | 透明、无装饰、永远最上层、预设不显示                |
| **Dashboard**   | `main-window`  | `main-window.html`    | `src/main-window.ts`  | 960×680（最小 720×480） | 标准视窗、预设隐藏，启动后若无 API Key 才显示 |

**状态责任分割**：

- HUD 是「状态浮窗」— 只负责显示「目前在录音 / 转录 / 整理 / 完成 / 失败」，**没有 DB 写权**
- Dashboard 是「设定与历史中心」— 拥有 DB migration 权、所有 CRUD 操作、autostart 控制

**DB 连线共享**（很重要）：

```
┌────────────────────────────────┐
│ Dashboard 启动 (main-window.ts)│
│  ↓                             │
│  initializeDatabase()          │
│  → Database.load(...)          │
│  → 跑 migration v1→v8          │
│  → 设定 singleton db           │
└────────────┬───────────────────┘
             │
             ▼ tauri-plugin-sql 共用 connection pool
┌────────────────────────────────┐
│ HUD 启动 (main.ts)             │
│  ↓                             │
│  connectToDatabase()           │
│  → Database.get(...)           │ ← 不重新 load！避免覆盖 transaction context
│  → 用既有 pool                 │
└────────────────────────────────┘
```

> **为什么 HUD 不能呼叫 `Database.load()`？** 因为 `tauri-plugin-sql` 的 Rust 端用 `HashMap.insert()` 覆盖既有 Pool — 若 Dashboard 正在跑 migration，旧 pool 的 transaction context 会遗失，破坏性 DDL 失去 rollback 保护。

---

## 三、Tauri Commands（Frontend → Rust）

> 完整列表见 `CLAUDE.md` 「IPC 契约表」。本节按「业务语意」分组，并标出 frontend 主要呼叫点。

### 3.1 系统与生命周期

| Command                        | 模组          | 主要呼叫点                                            | 用途                              |
| ------------------------------ | ------------- | ----------------------------------------------------- | --------------------------------- |
| `debug_log`                    | `lib.rs`      | stores、`main-window.ts`                              | webview 统一 log channel          |
| `request_app_restart`          | `lib.rs`      | `main-window.ts`（自动更新后）                        | 自行 spawn 新 process（见 §6.1） |
| `get_hud_target_position`      | `lib.rs`      | NotchHud（多萤幕追踪）                                | 取得 HUD 应定位的 logical 座标    |

### 3.2 热键（10 个）

| Command                                  | 来源                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `update_hotkey_config`                   | `useSettingsStore`                                    |
| `check_accessibility_permission_command` | `AccessibilityGuide.vue`                              |
| `open_accessibility_settings`            | `AccessibilityGuide.vue`                              |
| `reinitialize_hotkey_listener`           | `AccessibilityGuide.vue`                              |
| `reset_hotkey_state`                     | `useVoiceFlowStore`                                   |
| `start_hotkey_recording`                 | `SettingsView`                                        |
| `cancel_hotkey_recording`                | `SettingsView`                                        |

### 3.3 音讯（11 个）

| Command                          | 场景                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `start_recording` / `stop_recording`           | 触发 / 停止录音（核心 voice flow）                   |
| `save_recording_file`            | 完成转录后另存录音档（给 retranscribe 用）            |
| `read_recording_file`            | HistoryView 播放历史录音（IPC binary response）       |
| `delete_all_recordings` / `cleanup_old_recordings` | SettingsView 与启动自动清理                       |
| `start_audio_preview` / `stop_audio_preview`   | SettingsView 音量条                                  |
| `get_default_input_device_name`  | SettingsView 显示当前装置                             |
| `list_audio_input_devices`       | SettingsView 切换麦克风                               |

### 3.4 系统音量

| Command                | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `mute_system_audio`    | 录音前静音系统音讯（避免回授）             |
| `restore_system_audio` | 结束录音后还原                             |

> ⚠️ **Graceful shutdown 顺序敏感**：`lib.rs:529 RunEvent::Exit` 必须先呼叫 `audio_control.shutdown()` 还原音量，否则 app 结束后系统会永远静音。

### 3.5 剪贴簿与贴上

| Command                  | 平台实作                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `paste_text`             | macOS：`simulate_paste_via_cgevent()`；Windows：`SendInput Ctrl+V` |
| `copy_to_clipboard`      | 跨平台 `arboard`                                                    |
| `capture_target_window`  | 纪录录音前焦点视窗（macOS）                                         |

### 3.6 文字场读取（macOS only）

| Command                  | 用途                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `read_focused_text_field`| 取游标所在输入框内容（给 Edit Mode）                            |
| `read_selected_text`     | 取选取文字（给 Edit Mode）— 已知问题：Fn 按住期间可能输入 "c"  |

### 3.7 键盘监测

| Command                     | 触发时机                                              |
| --------------------------- | ----------------------------------------------------- |
| `start_quality_monitor`     | 贴上后监测使用者是否大幅修改（驱动 hallucination 侦测） |
| `start_correction_monitor`  | 监测使用者修正动作（驱动智慧字典学习）                |

### 3.8 LLM 与转录

| Command                  | 用途                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `transcribe_audio`       | Rust 直接呼叫 Groq Whisper（绕过前端 fetch）                              |
| `retranscribe_from_file` | HistoryView 对历史录音重新转录                                            |

### 3.9 音效回馈

`play_start_sound` / `play_stop_sound` / `play_error_sound` / `play_learned_sound` — `cpal` 播放 `resources/sounds/*.wav`。

---

## 四、Rust → Frontend Events（15 个）

### 4.1 热键类

| Event                          | Payload                       | 订阅者                         |
| ------------------------------ | ----------------------------- | ------------------------------ |
| `hotkey:pressed`               | —                             | useVoiceFlowStore              |
| `hotkey:released`              | —                             | useVoiceFlowStore              |
| `hotkey:toggled`               | `HotkeyEventPayload`          | useVoiceFlowStore              |
| `hotkey:error`                 | `HotkeyErrorPayload`          | useVoiceFlowStore              |
| `hotkey:mode-toggle`           | `()`                          | useVoiceFlowStore              |
| `escape:pressed`               | `()`                          | useVoiceFlowStore（全域中止）   |
| `hotkey:recording-captured`    | `RecordingCapturedPayload`    | SettingsView 热键设定          |
| `hotkey:recording-rejected`    | `RecordingRejectedPayload`    | SettingsView 热键设定          |

### 4.2 键盘监测类

| Event                       | Payload                          | 订阅者              |
| --------------------------- | -------------------------------- | ------------------- |
| `quality-monitor:result`    | `QualityMonitorResultPayload`    | useVoiceFlowStore   |
| `correction-monitor:result` | `CorrectionMonitorResultPayload` | useVoiceFlowStore   |

### 4.3 音讯类

| Event                  | Payload                                  | 订阅者                |
| ---------------------- | ---------------------------------------- | --------------------- |
| `audio:waveform`       | `WaveformPayload { levels: [f32; 6] }`   | useAudioWaveform → HUD |
| `audio:preview-level`  | `AudioPreviewLevelPayload { level: f32 }`| useAudioPreview → SettingsView |

### 4.4 设计准则

- 所有 event 名称常数**集中在 `src/composables/useTauriEvents.ts`**（27 行）— 禁止散落到各档案
- Rust 端发送点以 const 字串集中于 `hotkey_listener.rs` / `keyboard_monitor.rs` / `audio_recorder.rs` 的 mod 顶部
- Payload 型别后缀一律 `*Payload`（型别命名规范）

---

## 五、Frontend-only Events（5 个）

> 不经 Rust，纯 webview 内 / 跨 webview 广播。常数定义同样集中在 `useTauriEvents.ts`。

| Event                          | 发送方             | 接收方                |
| ------------------------------ | ------------------ | --------------------- |
| `voice-flow:state-changed`     | HUD VoiceFlow      | Dashboard             |
| `transcription:completed`      | VoiceFlow          | Main Window           |
| `settings:updated`             | useSettingsStore   | All Windows           |
| `vocabulary:changed`           | useVocabularyStore | All Windows           |
| `vocabulary:learned`           | useVoiceFlowStore  | HUD NotchHud          |

> 跨视窗广播使用 `emitTo("main-window", ...)` 或 `emitTo("main", ...)`；自视窗用 `emit(...)`。

---

## 六、生命周期与资源管理

### 6.1 启动顺序

```
1. Rust: tauri::Builder::default()
   ├── plugin: tauri_plugin_single_instance.init(callback)
   │   └── 第二次启动时触发 callback → show_main_window(app)
   ├── plugin: shell, http, sql, store, autostart, updater, process
   ├── plugin: hotkey_listener (custom)
   ├── invoke_handler! 注册 34 个 command
   ├── setup(|app|) 初始化 5 个 managed state
   └── 载入 tray icon + 配置视窗 level（macOS=27 / Windows=TOPMOST）

2. Frontend HUD：main.ts → initSentryForHud → mount
3. Frontend Dashboard：main-window.ts → initSentryForDashboard
   → initializeDatabase（migration v1→v8）
   → settingsStore.loadSettings + initializeAutoStart
   → 若缺 API Key：强制显示视窗并导向 /settings
   → 背景：cleanup_old_recordings（不阻断启动）
```

### 6.2 结束顺序（`RunEvent::Exit`，`lib.rs:529`）

顺序敏感，必须这样排：

```
1. audio_control.shutdown()      ← 还原系统音量（避免永久静音）
2. audio_preview.shutdown()      ← 在 cpal 之前（避免两者同时释放装置）
3. audio_recorder.shutdown()     ← join thread, drop AudioUnit
4. keyboard_monitor.shutdown()   ← 取消 CGEventTap
5. hotkey_listener.shutdown()    ← 取消 CGEventTap
6. sleep 200ms                    ← 等待背景 thread 清理
7. sentry.client.flush(2s)        ← Flush 事件伫列
8. 若 RESTART_REQUESTED：spawn 新 process
9. _exit(0)                       ← 截杀 Tauri 内建逻辑
```

### 6.3 Single-instance（v0.9.5 跨平台统一）

`tauri-plugin-single-instance`：第二次启动 .exe / .app 时，原 process 接到 callback 把 Dashboard 拉到前景，新 process 直接退出。**Windows 特别需要**（macOS 有 Launch Services 守门但 dev mode 仍需此保险）。

---

## 七、外部 API 整合

```
┌──────────────────────────────┐
│   Rust Backend               │     reqwest (multipart, json)
│   transcription.rs           │ ───────────────────────────────► Groq Whisper API
│                              │                                  /v1/audio/transcriptions
└──────────────────────────────┘                                  whisper-large-v3 / -turbo

┌──────────────────────────────┐
│   Frontend (Dashboard)       │     @tauri-apps/plugin-http
│   src/lib/llmProvider.ts     │ ───────────────────────────────► Groq / Gemini / OpenAI / Anthropic
│   buildFetchParams()         │                                  /chat/completions（或对应端点）
│   parseProviderResponse()    │
└──────────────────────────────┘
```

**Provider 抽象层的职责**：

- `buildFetchParams()` — 把通用 messages 转成各 provider 的 body / header（OpenAI `max_completion_tokens`、Anthropic `system` 顶层栏位、Gemini `system_instruction` + URL 内 model 名称）
- `parseProviderResponse()` — Gemini 额外检查 `finishReason`，非 `STOP`/`MAX_TOKENS` 时抛错（避免 SAFETY 过滤静默 fallback）

**CSP 与 capabilities 的差异**（⚠️ **见验证报告**）：

- `capabilities/default.json` 已开放四家 (Groq / OpenAI / Anthropic / Gemini)
- 但 `tauri.conf.json` 的 `connect-src` CSP 只列 Groq / Gemini

---

## 八、整合风险与已知一致性问题

| 问题                                                          | 影响                                                       | 建议                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| ⚠️ CSP 缺少 `https://api.openai.com` / `https://api.anthropic.com`（`tauri.conf.json:51`） | 切到 OpenAI / Anthropic provider 在 production build 可能被 CSP 阻挡（dev mode 不受影响） | 用 `pnpm tauri build --debug` 实测 OpenAI / Anthropic 端对端 |
| `text_field_reader::read_selected_text` 在 Fn 按住时触发会输入 "c" | Edit Mode 偶发误输入                                       | 已记录于 GitHub #25                                 |
| `addApiUsage(whisper/chat)` 偶发 `FOREIGN KEY constraint failed` (787) | 统计资料写入失败，不影响核心转录                           | 待调查（可能是 transcription 与 api_usage 的 race） |
| 非预设音讯装置切换时 cpal 0.15.3 macOS Arc cycle               | 每次切换泄漏 ~1-2 KB                                       | 上游修复待 cpal 0.16+                               |

---

## 九、为新功能设计时的决策树

```
新功能要新增什么？
│
├── 纯 UI / 设定 / 显示
│   └─ 改 src/views/ + src/stores/ + src/components/ → 不需动 Rust
│
├── 需要存取系统资源（OS API、档案、视窗操作）
│   └─ 1. 在 src-tauri/src/plugins/ 新增模组或扩充现有 plugin
│      2. 在 lib.rs invoke_handler! 注册
│      3. 在 useTauriEvents.ts 新增 event 常数（若有事件）
│      4. 用 tauri-reviewer subagent 审查两端对齐
│
├── 需要新 LLM Provider
│   └─ 改 src/lib/llmProvider.ts 与 modelRegistry.ts → 不需动业务层
│
├── 需要新 DB 栏位
│   └─ database.ts 追加 migration v9（不要改旧 migration）
│
└── 需要跨视窗同步状态
    └─ 在 useTauriEvents.ts 新增 frontend-only event 常数
       发送方 emit；接收方 listen
```
