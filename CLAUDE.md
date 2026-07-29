# SayIt — Claude Code 专案记忆档

> Tauri v2 + Vue 3 + Rust 语音转文字桌面应用
> 完整规则请读：`_bmad-output/project-context.md`

## 中文文案硬规则（强制）

1. **所有新增中文必须使用简体中文，禁止繁体中文**（UI 文案、注解、文档、prompt 中文模板、commit message 中的中文说明）。
2. **日语 locale 保持日语**：`src/i18n/locales/ja.json` 与 `src/i18n/prompts.ts` 的 `ja` 模板不得改成中文，也不得用 OpenCC 误转。
3. **界面语系为四语**：`zh-CN` / `en` / `ja` / `ko`。历史 `zh-TW` 一律迁移/映射为 `zh-CN`，不再提供独立繁体界面。
4. CI 会执行 `node scripts/check-simplified-chinese.mjs` 拦截繁体字形；本地可同样重跑。

## Quick Reference

| 文件 | 路径 | 用途 |
|------|------|------|
| 完整规则 | `_bmad-output/project-context.md` | 所有 AI Agent 实作规则（必读） |
| UX/UI 规范 | `_bmad-output/planning-artifacts/ux-ui-design-spec.md` | UI 设计、色彩、元件规范 |
| 架构设计 | `_bmad-output/planning-artifacts/architecture.md` | 架构决策文件 |

## 双视窗架构

```
 ┌─────────────────────────────────────────────────┐
 │                  Tauri Backend (Rust)            │
 │  lib.rs ─ plugins/ ─ clipboard_paste.rs         │
 │                      hotkey_listener.rs          │
 │                      keyboard_monitor.rs         │
 │                                                  │
 │  ┌─── invoke() ──┐     ┌─── emit() ────┐        │
 │  │               │     │               │        │
 │  ▼               ▼     ▼               ▼        │
 │ ┌──────────┐  ┌──────────────────────────┐      │
 │ │   HUD    │  │      Dashboard           │      │
 │ │ index.   │  │   main-window.html       │      │
 │ │ html     │  │   MainApp.vue + Router   │      │
 │ │ App.vue  │  │   4 views + DB + Store   │      │
 │ │ NotchHud │  │   shadcn-vue UI          │      │
 │ └──────────┘  └──────────────────────────┘      │
 │  label:main    label:main-window                │
 │  400x100       960x680 (min 720x480)            │
 │  transparent   decorations, resizable           │
 │  alwaysOnTop   预设隐藏                          │
 └─────────────────────────────────────────────────┘
```

## IPC 契约表

### Tauri Commands（Frontend → Rust）

| Command | Rust 位置 | 前端呼叫点 | 参数 | 回传 |
|---------|-----------|-----------|------|------|
| `debug_log` | `lib.rs` | stores, main-window.ts | `level: String, message: String` | `()` |
| `request_app_restart` | `lib.rs` | main-window.ts | — | `()` |
| `update_hotkey_config` | `lib.rs` | useSettingsStore | `trigger_key: TriggerKey, trigger_mode: TriggerMode` | `Result<(), String>` |
| `get_hud_target_position` | `lib.rs` | — | `app: AppHandle` | `Result<HudTargetPosition, String>` |
| `paste_text` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | `text: String` | `Result<(), ClipboardError>` |
| `copy_to_clipboard` | `plugins/clipboard_paste.rs` | HistoryView | `text: String` | `Result<(), ClipboardError>` |
| `capture_target_window` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | — | `()` |
| `check_accessibility_permission_command` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `bool` |
| `open_accessibility_settings` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `Result<(), String>` |
| `reinitialize_hotkey_listener` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | `app: AppHandle` | `Result<(), String>` |
| `reset_hotkey_state` | `plugins/hotkey_listener.rs` | useVoiceFlowStore | `state: State<HotkeyListenerState>` | `()` |
| `start_quality_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `start_correction_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `read_focused_text_field` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `read_selected_text` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `read_selection_state` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `SelectionState { kind, text }` |
| `mute_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `restore_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `get_default_input_device_name` | `plugins/audio_recorder.rs` | SettingsView | — | `Option<String>` |
| `list_audio_input_devices` | `plugins/audio_recorder.rs` | SettingsView | — | `Vec<AudioInputDeviceInfo>` |
| `start_audio_preview` | `plugins/audio_recorder.rs` | SettingsView | `app: AppHandle, preview_state: State<AudioPreviewState>, device_name: String` | `Result<(), String>` |
| `stop_audio_preview` | `plugins/audio_recorder.rs` | SettingsView | `preview_state: State<AudioPreviewState>` | `()` |
| `start_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `app: AppHandle, state: State<AudioRecorderState>, device_name: String` | `Result<(), AudioRecorderError>` |
| `stop_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `state: State<AudioRecorderState>` | `Result<StopRecordingResult, AudioRecorderError>` |
| `save_recording_file` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `id: String, app: AppHandle, state: State<AudioRecorderState>` | `Result<String, String>` |
| `read_recording_file` | `plugins/audio_recorder.rs` | HistoryView | `id: String, app: AppHandle` | `Result<Response, String>` |
| `delete_all_recordings` | `plugins/audio_recorder.rs` | SettingsView | `app: AppHandle` | `Result<u32, String>` |
| `cleanup_old_recordings` | `plugins/audio_recorder.rs` | main-window.ts | `days: u32, app: AppHandle` | `Result<Vec<String>, String>` |
| `transcribe_audio` | `plugins/transcription.rs` | useVoiceFlowStore | `state: State<AudioRecorderState>, transcription_state: State<TranscriptionState>, api_key: String, vocabulary_term_list: Option<Vec<String>>, model_id: Option<String>, language: Option<String>` | `Result<TranscriptionResult, TranscriptionError>` |
| `retranscribe_from_file` | `plugins/transcription.rs` | useVoiceFlowStore | `path: String, api_key: String, vocabulary_term_list: Option<Vec<String>>, model_id: Option<String>, language: Option<String>` | `Result<TranscriptionResult, TranscriptionError>` |
| `test_asr_connection` | `plugins/transcription.rs` | connectionTest.ts | `transcription_state: State<TranscriptionState>, app_id: String, access_key: String` | `Result<(), TranscriptionError>` |
| `start_live_asr` | `plugins/transcription.rs` | useVoiceFlowStore | `app: AppHandle, audio_state: State<AudioRecorderState>, transcription_state: State<TranscriptionState>, app_id: String, access_key: String, vocabulary_term_list: Option<Vec<String>>, language: Option<String>` | `Result<(), TranscriptionError>` |
| `finish_live_asr` | `plugins/transcription.rs` | useVoiceFlowStore | `audio_state: State<AudioRecorderState>, transcription_state: State<TranscriptionState>` | `Result<TranscriptionResult, TranscriptionError>` |
| `cancel_live_asr` | `plugins/transcription.rs` | useVoiceFlowStore | `audio_state: State<AudioRecorderState>, transcription_state: State<TranscriptionState>` | `Result<(), TranscriptionError>` |
| `fetch_typeless_dictionary_terms` | `plugins/typeless_import.rs` | useVocabularyStore | — | `Result<Vec<String>, String>` |
| `play_start_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_stop_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_error_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_learned_sound` | `plugins/sound_feedback.rs` | NotchHud.vue | — | `()` |
| `start_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |
| `cancel_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |

### Rust → Frontend Events

| Event | Rust 发送点 | 常量 | Payload |
|-------|------------|------|---------|
| `hotkey:pressed` | hotkey_listener.rs | `HOTKEY_PRESSED` | — |
| `hotkey:released` | hotkey_listener.rs | `HOTKEY_RELEASED` | — |
| `hotkey:toggled` | hotkey_listener.rs | `HOTKEY_TOGGLED` | `HotkeyEventPayload` |
| `hotkey:error` | hotkey_listener.rs | `HOTKEY_ERROR` | `HotkeyErrorPayload` |
| `hotkey:mode-toggle` | hotkey_listener.rs | `HOTKEY_MODE_TOGGLE` | `()` |
| `escape:pressed` | hotkey_listener.rs | `ESCAPE_PRESSED` | `()` |
| `hotkey:recording-captured` | hotkey_listener.rs | `HOTKEY_RECORDING_CAPTURED` | `RecordingCapturedPayload` |
| `hotkey:recording-rejected` | hotkey_listener.rs | `HOTKEY_RECORDING_REJECTED` | `RecordingRejectedPayload` |
| `quality-monitor:result` | keyboard_monitor.rs | `QUALITY_MONITOR_RESULT` | `QualityMonitorResultPayload` |
| `correction-monitor:result` | keyboard_monitor.rs | `CORRECTION_MONITOR_RESULT` | `CorrectionMonitorResultPayload` |
| `audio:waveform` | audio_recorder.rs | `AUDIO_WAVEFORM` | `WaveformPayload { levels: [f32; 6] }` |
| `audio:preview-level` | audio_recorder.rs | `AUDIO_PREVIEW_LEVEL` | `AudioPreviewLevelPayload { level: f32 }` |

### Frontend-only Events（不经 Rust）

| Event | 常量 | 发送方 | 接收方 |
|-------|------|--------|--------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | HUD VoiceFlow | Dashboard |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | VoiceFlow | Main Window |
| `settings:updated` | `SETTINGS_UPDATED` | SettingsStore | All Windows |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | VocabularyStore | All Windows |
| `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore | HUD NotchHud |

## 自动更新机制

- **定时检查** — `main-window.ts`：启动 5 秒后首次检查，之后每 4 小时（`setInterval`）
- **手动检查** — `MainApp.vue` Sidebar Footer「检查更新」按钮，结果用 `useFeedbackMessage` 显示
- **回传型别** — `checkForAppUpdate()` → `Promise<UpdateCheckResult>`（`up-to-date` | `update-available` | `error`）
- **已知限制** — `autoUpdater.ts` 中 `window.confirm` 在 Tauri WKWebView 会被静默忽略，未来需改用 in-app UI

## 依赖方向规则

```
  views/ ──→ components/ + stores/ + composables/
  stores/ ──→ lib/
  lib/ ──→ External APIs (Groq / OpenAI / Anthropic)

  ❌ views/ 不可直接 import lib/
  ❌ 元件不可直接执行 SQL
```

## 关键禁忌（最常违反）

1. **❌ 浏览器原生 `fetch`** → 用 `@tauri-apps/plugin-http` 的 `fetch`
2. **❌ Options API** → 仅 `<script setup lang="ts">`
3. **❌ views 直接呼叫 lib** → 必须透过 Pinia store
4. **❌ SQLite 存 API Key** → 只存 `tauri-plugin-store`
5. **❌ Tailwind 原生色彩** → 用语意变数（`bg-primary`, `text-foreground`）
6. **❌ `@tabler/icons-vue`** → 只用 `lucide-vue-next`
7. **❌ 手写 UI 元件** → 用 shadcn-vue（new-york style），详见下方「shadcn-vue 元件使用规则」
8. **❌ 直接 import Tauri event API** → 用 `useTauriEvents.ts` 封装
9. **❌ 新增繁体中文** → 中文一律简体；日语 locale 保持日语（见上方「中文文案硬规则」）

## shadcn-vue 元件使用规则

### 禁止手写替代品

| 需求 | ❌ 禁止 | ✅ 必须使用 |
|------|--------|-----------|
| 侧边栏 | 手写 `<nav>` | `SidebarProvider` + `Sidebar` + `SidebarMenu` 等 |
| 侧边栏切换 | 自订 emit + ref | `SidebarTrigger`（内建 `toggleSidebar()`） |
| 可点击元素 | 原生 `<button>` + 手写样式 | `<Button>` + variant prop |
| 表单输入 | 原生 `<input>` / `<select>` / `<textarea>` | `Input` / `Select` / `Textarea` |
| 表格 | 原生 `<table>` | `Table` + `TableHeader` + `TableBody` 等 |
| 开关 | 原生 checkbox | `Switch` |
| 选项组 | 原生 `<input type="radio">` | `RadioGroup` + `RadioGroupItem` |

### 元件 API 规范

- **variant 优先**：用 `variant="destructive"` 而非 `class="text-destructive border-destructive"`
- **Switch 绑定**：`:model-value` + `@update:model-value`（不是 `:checked`）
- **Select 绑定**：`:model-value` + `@update:model-value`
- **Label 无障碍**：Label 必须加 `for` 属性，对应控制项加 `id`
- **Badge variant**：用 `variant="secondary"` 等 prop，不用 class 覆盖整套样式
- **RadioGroup 绑定**：`:model-value` + `@update:model-value`，payload 型别为 `AcceptableValue`（需 runtime narrowing）
- **RouterLink 在 Menu 中**：`<SidebarMenuButton as-child>` 包裹 `<RouterLink>`

### 样式规则

- 语意色彩优先：`bg-card` / `text-foreground` / `border-border`
- 禁止硬编码：`bg-zinc-900` / `text-white` / `border-zinc-700`
- 覆盖元件样式时只微调（如 padding、size），不覆盖核心色彩

## 型别命名惯例

| 后缀 | 用途 | 范例 |
|------|------|------|
| `*Payload` | Tauri Event payload | `VoiceFlowStateChangedPayload` |
| `*Record` | SQLite 资料行 | `TranscriptionRecord` |
| `*Config` | 设定物件 | `HotkeyConfig` |
| `*Entry` | 字典/列表项目 | `VocabularyEntry` |
| `*Dto` | Store 间传递 | — |
| `*Handle` | 资源控制 | `AudioAnalyserHandle` |

## SQLite 映射规则

- 表名：复数 snake_case（`transcriptions`）
- 栏位：snake_case（`raw_text`）→ TS camelCase（`rawText`）via `mapRowToRecord()`
- 布林：`INTEGER` → `row.was_enhanced === 1`
- null 布林：`INTEGER | null` → `row.was_modified === null ? null : row.was_modified === 1`
- 主键：`TEXT`（UUID，前端 `crypto.randomUUID()`）
- 参数语法：`$1, $2`（tauri-plugin-sql）

## 自动化 Hooks（`.claude/settings.json`）

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `protect-config.sh` | PreToolUse（Edit\|Write） | 🔴 拦截 lock 档修改、🟡 警告 config 档修改 |
| `typecheck.sh` | PostToolUse（Edit\|Write） | 编辑 .ts/.vue 后自动跑 `vue-tsc --noEmit`（非阻断，仅报告错误） |
| `rustfmt.sh` | PostToolUse（Edit\|Write） | 编辑 .rs 后自动执行 `rustfmt`（非阻断） |
| `eslint.sh` | PostToolUse（Edit\|Write） | 编辑 .ts/.vue 后自动 `eslint --fix`（跳过 `components/ui/`） |

### 保护档案

| 档案 | 保护等级 |
|------|---------|
| `Cargo.lock`, `pnpm-lock.yaml` | 🔴 Hard block（禁止修改） |
| `tauri.conf.json`, `Cargo.toml` | 🟡 警告（需确认必要性） |

## 开发环境需求

- **Node.js 24**（见 `.nvmrc`）
- **pnpm 10.28.2**（`corepack enable && corepack prepare`）
- **Rust stable**（`rustup default stable`）

## 常用指令

| 指令 | 用途 |
|------|------|
| `pnpm tauri dev` | 开发模式 |
| `pnpm build` | 完整建构（含 vue-tsc） |
| `pnpm test` | 跑 Vitest |
| `pnpm test:coverage` | 覆盖率报告 |
| `npx vue-tsc --noEmit` | 型别检查 |
| `node scripts/check-simplified-chinese.mjs` | 繁体中文检查（CI 同款） |
| `./scripts/release.sh X.Y.Z` | 发版（更新版本号 + tag + push） |

## CI/CD Pipeline

```
 push/PR to main           push tag v*
       │                        │
       ▼                        ▼
 ┌──────────┐         ┌─────────────────┐
 │  ci.yml  │         │  release.yml    │
 │ vue-tsc  │         │ 3 matrix jobs:  │
 │ vitest   │         │  macOS ARM      │
 │ 简体检查 │         │  macOS Intel    │
 └──────────┘         │                 │
                      │  Windows x64    │
                      │                 │
                      │ + ad-hoc signing│
                      │ + Updater .sig  │
                      │ + Sentry upload │
                      └────────┬────────┘
                               │
                          Draft Release
                               │
                               ▼
                       publish-release job
                               │
                               ▼
                          Public Release
```

### 发版硬规则

- 发版版本号必须在 `git tag`、`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 四处保持一致
- 正式版 Sentry release 一律由 `.github/workflows/release.yml` 产生，格式固定为 `sayit@<version>`
- 前端与 Rust 不可各自手动指定不同的 Sentry release 名称
- 正式版 telemetry 与 sourcemap upload 只能走 `release.yml`，不得绕过 workflow 手动上传
- 发版前必须确认 GitHub Secrets 与 Sentry Secrets 齐全

### GitHub Secrets（7 个）

| Secret | 用途 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater 签署私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |
| `SENTRY_DSN` | Rust 正式版 Sentry DSN |
| `VITE_SENTRY_DSN` | Frontend 正式版 Sentry DSN |
| `SENTRY_AUTH_TOKEN` | Sentry sourcemap upload token |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_PROJECT` | Sentry project slug |

### 固定下载连结（官网用）

| 平台 | URL |
|------|-----|
| macOS ARM | `https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-arm64.dmg` |
| macOS Intel | `https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-x64.dmg` |
| Windows | `https://github.com/yee94/SayIt/releases/latest/download/SayIt-windows-x64.exe` |

### Claude Code Review Workflow

- **Workflows** — `.github/workflows/claude.yml`（`@claude` comment 触发）+ `.github/workflows/claude-code-review.yml`（PR 自动 review）
- **必要设定** — 安装 [Claude Code GitHub App](https://github.com/apps/claude) 到 repo + 设定 `CLAUDE_CODE_OAUTH_TOKEN` secret（不是 `ANTHROPIC_API_KEY`）
- **Fork PR 限制（硬规则）** — `claude-code-review.yml` 的 job 必须保留 `if: github.event.pull_request.head.repo.full_name == github.repository` guard，**禁止移除**。理由：GitHub 不会授予 fork PR `id-token: write`，OIDC token 兑换永远失败，此 guard 让 fork PR 显示「skipped」（灰色）而非红色 ❌。详见 [`docs/adr-claude-code-review-fork-pr.md`](docs/adr-claude-code-review-fork-pr.md)
- **`@claude` comment 不受 fork 限制** — `claude.yml` 由 issue_comment 事件触发，可正常用于任何 PR / issue
- **Fork PR 第一次跑需手动 approve** — GitHub 安全机制；可用 `gh api -X POST /repos/{owner}/{repo}/actions/runs/{id}/approve`

## Tauri v2 macOS 注意事项

- **IPC binary response**：`tauri::ipc::Response` raw bytes 在 macOS 走 JSON 序列化（`number[]`），非 `ArrayBuffer`。前端必须用 `new Uint8Array(raw)` 转换
- **CSP 与 asset protocol**：`convertFileSrc` 在 macOS 产生 `asset://localhost/` URL，但 CSP `media-src` 需要 `http://asset.localhost`。Dev mode 不受 CSP 影响，production build 会被阻挡。偏好使用 Rust IPC + Blob URL 绕过
- **Dev vs Production 差异**：`pnpm tauri dev` 从 Vite dev server 载入，CSP 行为不同。安全性相关功能必须用 `pnpm tauri build --debug` 测试

## Windows 键盘 Hook 注意事项

- **Copilot 键 = `VK_F23` (`0x86`)（硬规则）**：低阶键盘 hook（`mod windows_hook` 在 `src-tauri/src/plugins/hotkey_listener.rs`）必须在取出 `kbd` 后立刻判断 `if kbd.vkCode == VK_F23 { return CallNextHookEx(...); }` 把信号放行，否则会干扰 Windows 11 Copilot Quick View。**禁止把 F23 开放成 SayIt 自订热键**。详见 [`docs/adr-windows-vk-f23.md`](docs/adr-windows-vk-f23.md)
- **macOS 本地 `cargo check` 无法验证 Windows 键盘 hook**：`#[cfg(target_os = "windows")]` 区块在 macOS 不编译，必须靠 CI 的 windows runner 或实机测试
- **`windows` crate 0.61 breaking change**：`AttachThreadInput` 从 `Win32::UI::Input::KeyboardAndMouse` 搬到 `Win32::System::Threading`，Cargo.toml features 需含 `Win32_System_Threading`

## Subagent

- **tauri-reviewer** — 审查 Rust↔Vue IPC 一致性（Command 注册、Event 名称、Payload 型别）
