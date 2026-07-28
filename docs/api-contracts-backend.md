# API Contracts — Backend (Tauri)

> Frontend → Rust 的 Tauri Commands · Rust → Frontend 的 Tauri Events
> 扫描日期：2026-05-08 · 版本：0.9.5
> Authoritative source：`src-tauri/src/lib.rs:416-452` 的 `invoke_handler!` macro + `CLAUDE.md` IPC 契约表

---

## 一、契约总览

| 轨道                       | 数量    | 来源                                                                        |
| -------------------------- | ------- | --------------------------------------------------------------------------- |
| Tauri Commands             | **34**  | `lib.rs::run()` 的 `invoke_handler!` macro                                  |
| Rust → Frontend Events     | **15**  | 各 plugin 模组顶部的 `pub const` 字串                                        |
| Frontend-only Events       | **5**   | `src/composables/useTauriEvents.ts`                                         |

> 所有 event 名称常数在前端**只能**从 `useTauriEvents.ts` import；Rust 端定义在各 plugin 模组顶部。新增时两端必须对齐（用 `tauri-reviewer` subagent 审查）。

---

## 二、Tauri Commands

格式：`fn(params) -> ReturnType`，所有 command 由 frontend `invoke('name', { params })` 呼叫。

### 2.1 系统与生命周期（3 个）

#### `debug_log`
```ts
invoke('debug_log', { level: 'info'|'warn'|'error', message: string }) → void
```
- **Rust 位置**：`lib.rs:91`
- **用途**：webview console.log 统一导向 Rust stdout/stderr（方便 production 用 `Console.app` / Windows ETW 追问题）

#### `request_app_restart`
```ts
invoke('request_app_restart') → void
```
- **Rust 位置**：`lib.rs:84`
- **用途**：自动更新后重启 app（内部设 RESTART_REQUESTED 旗标 + `app.exit(0)`）

#### `get_hud_target_position`
```ts
invoke('get_hud_target_position') → { x: number, y: number, monitorKey: string }
```
- **Rust 位置**：`lib.rs:296`
- **用途**：HUD 多萤幕追踪（取得游标所在萤幕的 logical 中心位置）
- **错误**：若 `app.available_monitors()` 失败或无萤幕 → `Result::Err(String)`

### 2.2 热键（7 个 · `plugins/hotkey_listener.rs`）

| Command                                  | 签名                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `update_hotkey_config`                   | `(trigger_key, trigger_mode) → Result<(), String>`                     |
| `check_accessibility_permission_command` | `() → bool`（macOS only，Windows 永远回 true）                         |
| `open_accessibility_settings`            | `() → Result<(), String>`                                              |
| `reinitialize_hotkey_listener`           | `(app: AppHandle) → Result<(), String>`                                |
| `reset_hotkey_state`                     | `(state: State<HotkeyListenerState>) → ()`                             |
| `start_hotkey_recording`                 | `(state) → ()`                                                         |
| `cancel_hotkey_recording`                | `(state) → ()`                                                         |

**型别**：
- `TriggerKey` = `'fn' | 'control' | 'option' | 'command' | { combo: string[] }`
- `TriggerMode` = `'hold' | 'toggle'`

### 2.3 音讯（11 个 · `plugins/audio_recorder.rs`）

| Command                              | 签名                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `get_default_input_device_name`      | `() → Option<String>`                                                                                              |
| `list_audio_input_devices`           | `() → Vec<AudioInputDeviceInfo>`                                                                                   |
| `start_audio_preview`                | `(app, preview_state, device_name) → Result<(), String>`                                                          |
| `stop_audio_preview`                 | `(preview_state) → ()`                                                                                             |
| `start_recording`                    | `(app, state, device_name) → Result<(), AudioRecorderError>`                                                      |
| `stop_recording`                     | `(state) → Result<StopRecordingResult, AudioRecorderError>`                                                       |
| `save_recording_file`                | `(id, app, state) → Result<String, String>` （回传档案路径）                                                      |
| `read_recording_file`                | `(id, app) → Result<Response, String>` （**IPC binary response**，macOS 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 转换） |
| `delete_all_recordings`              | `(app) → Result<u32, String>`                                                                                      |
| `cleanup_old_recordings`             | `(days, app) → Result<Vec<String>, String>` （回传已删档的 id list）                                              |

**型别**：
- `AudioInputDeviceInfo = { name: string, isDefault: boolean }`
- `StopRecordingResult = { audioBufferId: string, durationMs: number, sampleRate: number }`
- `AudioRecorderError`（thiserror enum，serialize 为 string）

### 2.4 系统音量（2 个 · `plugins/audio_control.rs`）

```ts
invoke('mute_system_audio')    → Result<(), String>
invoke('restore_system_audio') → Result<(), String>
```

**顺序敏感**：必须在录音前 mute、录音后立刻 restore；shutdown 时也必须最先还原（见 `architecture-backend.md` §RunEvent::Exit）

### 2.5 剪贴簿与贴上（3 个 · `plugins/clipboard_paste.rs`）

| Command                  | 签名                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `paste_text`             | `(text: string) → Result<(), ClipboardError>`              |
| `copy_to_clipboard`      | `(text: string) → Result<(), ClipboardError>`              |
| `capture_target_window`  | `() → ()`                                                  |

### 2.6 键盘监测（2 个 · `plugins/keyboard_monitor.rs`）

```ts
invoke('start_quality_monitor', { app: AppHandle })    → void
invoke('start_correction_monitor', { app: AppHandle }) → void
```

### 2.7 文字场读取（2 个 · `plugins/text_field_reader.rs`，macOS only）

```ts
invoke('read_focused_text_field') → Result<string | null, string>
invoke('read_selected_text')      → Result<string | null, string>
```

### 2.8 LLM / 转录（2 个 · `plugins/transcription.rs`）

#### `transcribe_audio`
```ts
invoke('transcribe_audio', {
  api_key: string,
  vocabulary_term_list?: string[],
  model_id?: string,        // 预设 'whisper-large-v3'
  language?: string | null, // null = Whisper 自动侦测；undefined → Rust fallback 'zh'
}) → Result<TranscriptionResult, TranscriptionError>
```

#### `retranscribe_from_file`
```ts
invoke('retranscribe_from_file', {
  path: string,
  api_key: string,
  vocabulary_term_list?: string[],
  model_id?: string,
  language?: string | null,
}) → Result<TranscriptionResult, TranscriptionError>
```

**型别**：
- `TranscriptionResult = { text: string, durationMs: number, ... }`
- `TranscriptionError`（thiserror enum）

### 2.9 音效回馈（4 个 · `plugins/sound_feedback.rs`）

```ts
invoke('play_start_sound')    → void
invoke('play_stop_sound')     → void
invoke('play_error_sound')    → void
invoke('play_learned_sound')  → void
```

---

## 三、Rust → Frontend Events（15 个）

> 所有 payload 介面定义于 `src/types/events.ts`（后缀 `*Payload`）。

### 3.1 热键类（8 个 · `plugins/hotkey_listener.rs`）

| Event                          | 常量名                          | Payload                          |
| ------------------------------ | ------------------------------- | -------------------------------- |
| `hotkey:pressed`               | `HOTKEY_PRESSED`                | —                                |
| `hotkey:released`              | `HOTKEY_RELEASED`               | —                                |
| `hotkey:toggled`               | `HOTKEY_TOGGLED`                | `HotkeyEventPayload`             |
| `hotkey:error`                 | `HOTKEY_ERROR`                  | `HotkeyErrorPayload`             |
| `hotkey:mode-toggle`           | `HOTKEY_MODE_TOGGLE`            | `()`                             |
| `escape:pressed`               | `ESCAPE_PRESSED`                | `()`                             |
| `hotkey:recording-captured`    | `HOTKEY_RECORDING_CAPTURED`     | `RecordingCapturedPayload`       |
| `hotkey:recording-rejected`    | `HOTKEY_RECORDING_REJECTED`     | `RecordingRejectedPayload`       |

### 3.2 键盘监测类（2 个 · `plugins/keyboard_monitor.rs`）

| Event                       | 常量名                              | Payload                            |
| --------------------------- | ----------------------------------- | ---------------------------------- |
| `quality-monitor:result`    | `QUALITY_MONITOR_RESULT`            | `QualityMonitorResultPayload`      |
| `correction-monitor:result` | `CORRECTION_MONITOR_RESULT`         | `CorrectionMonitorResultPayload`   |

### 3.3 音讯类（2 个 · `plugins/audio_recorder.rs`）

| Event                  | 常量名                       | Payload                                           |
| ---------------------- | ---------------------------- | ------------------------------------------------- |
| `audio:waveform`       | `AUDIO_WAVEFORM`             | `WaveformPayload { levels: [f32; 6] }`            |
| `audio:preview-level`  | `AUDIO_PREVIEW_LEVEL`        | `AudioPreviewLevelPayload { level: f32 }`         |

---

## 四、Frontend-only Events（5 个 · 不经 Rust）

| Event                          | 常量名                          | 发送方             | 接收方             |
| ------------------------------ | ------------------------------- | ------------------ | ------------------ |
| `voice-flow:state-changed`     | `VOICE_FLOW_STATE_CHANGED`      | HUD VoiceFlow      | Dashboard          |
| `transcription:completed`      | `TRANSCRIPTION_COMPLETED`       | VoiceFlow          | Main Window        |
| `settings:updated`             | `SETTINGS_UPDATED`              | useSettingsStore   | All Windows        |
| `vocabulary:changed`           | `VOCABULARY_CHANGED`            | useVocabularyStore | All Windows        |
| `vocabulary:learned`           | `VOCABULARY_LEARNED`            | useVoiceFlowStore  | HUD NotchHud       |

---

## 五、Permissions Mapping（`capabilities/default.json`）

Tauri v2 采 capability-based permission 系统，Frontend 只能呼叫已授权的 command：

| 来源        | 必要 permissions（节录）                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 视窗操作    | `core:window:allow-show`、`allow-hide`、`allow-set-position`、`allow-set-focus`、`allow-set-ignore-cursor-events`、`allow-start-dragging`、`allow-center` |
| 事件        | `core:event:allow-listen`、`allow-emit`、`allow-emit-to`                                                 |
| Shell       | `shell:allow-open`（用于开系统设定）                                                                    |
| SQL         | `sql:default`、`sql:allow-execute`                                                                       |
| Store       | `store:default`                                                                                          |
| HTTP        | `http:default` 开放：`api.groq.com/*`、`api.openai.com/*`、`api.anthropic.com/*`、`generativelanguage.googleapis.com/*` |
| Autostart   | `autostart:default`                                                                                      |
| Updater     | `updater:default`                                                                                        |
| Process     | `process:default`                                                                                        |

> **⚠️ 一致性差异**：`http:default` 已开放四家 LLM API，但 `tauri.conf.json` CSP `connect-src` 只列 Groq + Gemini，**缺 OpenAI / Anthropic**。使用者切到这两家在 production build 可能被 CSP 拦截（dev mode 不受影响）。

---

## 六、外部 API 契约（节选）

### 6.1 Groq Whisper（Rust 直呼）

```
POST https://api.groq.com/openai/v1/audio/transcriptions
  multipart/form-data:
    file: <wav binary>
    model: whisper-large-v3 | whisper-large-v3-turbo
    language: zh | en | ja | ko | ...（或省略 = auto）
    prompt: <vocabulary terms joined>
  Authorization: Bearer <api_key>
```

### 6.2 LLM Provider（Frontend 透过 `@tauri-apps/plugin-http`）

| Provider   | Endpoint                                                                                | Auth Header                       | Body 特例                                                |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| Groq       | `https://api.groq.com/openai/v1/chat/completions`                                       | `Authorization: Bearer ...`       | OpenAI 风格                                              |
| OpenAI     | `https://api.openai.com/v1/chat/completions`                                            | `Authorization: Bearer ...`       | 用 `max_completion_tokens`，**非** `max_tokens`          |
| Anthropic  | `https://api.anthropic.com/v1/messages`                                                 | `x-api-key: ...` + `anthropic-version: 2023-06-01` | system message 提取至顶层 `system` 栏位       |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`       | `x-goog-api-key: ...`             | model 在 URL；user/assistant 在 `contents[].parts[].text`；assistant role → `"model"`；config 用 `generationConfig.maxOutputTokens` |

**Gemini finishReason 检查**：`parseGeminiResponse` 会检查 `candidates[0].finishReason`，非 `STOP`/`MAX_TOKENS`（如 `SAFETY`、`RECITATION`）抛错，避免安全过滤静默 fallback。

---

## 七、新增 Command / Event 的 Checklist

```
□ Rust 端
  ├─ 写 #[command] 函式（确认回传 Result 而非 panic）
  ├─ 在 plugins/<module>.rs（或 lib.rs）内定义
  ├─ 在 lib.rs::run() 的 invoke_handler! 注册（lib.rs:416）
  └─ 若是 event，在 plugin 模组顶部加 pub const NAME = "..."

□ Frontend 端
  ├─ 在 src/types/events.ts 新增 *Payload 介面
  ├─ 在 src/composables/useTauriEvents.ts 加 export const
  ├─ 在 store / view 内 import 常数使用（不可直接 import @tauri-apps/api/event）
  └─ 若 command 用到，可加型别别名于 src/types/

□ 文件
  ├─ 更新 CLAUDE.md IPC 契约表
  ├─ 更新 docs/api-contracts-backend.md
  └─ 用 tauri-reviewer subagent 审查两端对齐
```
