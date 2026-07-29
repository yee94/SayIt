---
project_name: 'sayit'
user_name: 'Jackle'
date: '2026-03-28'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules', 'sentry_telemetry', 'i18n', 'smart_dictionary', 'model_registry_v2', 'esc_global_abort', 'hallucination_v3', 'sound_feedback', 'enhancement_anomaly', 'audio_input_device', 'audio_preview', 'combo_hotkey', 'rust_driven_recording', 'edit_mode', 'feature_guide', 'gemini_provider']
status: 'complete'
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Core Technologies

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Desktop Framework | Tauri | v2.10.x | 双视窗、System Tray、macOS Private API |
| Frontend | Vue 3 | ^3.5 | Composition API only（禁止 Options API） |
| Language (Frontend) | TypeScript | ^5.7 | strict mode 启用 |
| Language (Backend) | Rust | 2021 edition | — |
| CSS | Tailwind CSS | ^4 | v4 使用 `@import "tailwindcss"` 语法 |
| UI 元件 | shadcn-vue | new-york style | 强制使用，详见 ux-ui-design-spec.md |
| State Management | Pinia | ^3.0.4 | — |
| Router | vue-router | 5.0.3 | webHashHistory |
| Build | Vite | ^6 | 多入口（HUD + Dashboard） |
| Package Manager | pnpm | — | 必须使用 pnpm，不可用 npm/yarn |
| Node | 24 | .nvmrc 锁定 | — |
| Test (Unit) | Vitest | ^4.0.18 | jsdom 环境 |
| Test (E2E) | Playwright | ^1.58.2 | — |
| Telemetry (Frontend) | @sentry/vue | ^10.42.0 | 仅生产环境启用，双视窗分别初始化 |
| Telemetry (Backend) | sentry (Rust) | 0.46 | 环境变数驱动，Guard 模式 |

### Frontend Dependencies

| 套件 | 版本 | 用途 |
|------|------|------|
| `reka-ui` | ^2.8.2 | shadcn-vue 底层无头 UI 库 |
| `lucide-vue-next` | ^0.576.0 | 唯一允许的图标库 |
| `@vueuse/core` | ^14.2.1 | Vue Composition 工具函式 |
| `@tanstack/vue-table` | ^8.21.3 | 表格逻辑（DataTable 元件） |
| `@unovis/ts` + `@unovis/vue` | ^1.6.4 | 图表库（shadcn-vue chart 底层） |
| `class-variance-authority` | ^0.7.1 | CSS 变体管理（shadcn-vue 依赖） |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^3.5.0 | `cn()` 工具函式底层（`src/lib/utils.ts`） |
| `vue-i18n` | ^11.3.0 | 多语言国际化（Composition API `useI18n()` + 全域 `i18n.global.t()`） |
| `@faker-js/faker` | ^10.3.0 | 开发用假资料（devDependency） |

### ⚠️ 已安装但不应使用

| 套件 | 原因 |
|------|------|
| `@tabler/icons-vue` | UI 设计规范强制只用 `lucide-vue-next`，此套件为 dashboard-01 block 附带安装，新程式码禁止使用 |

### Tauri Plugins（Rust + JS 双端）

| Plugin | Rust Version | JS Version | 用途 |
|--------|-------------|-----------|------|
| `tauri-plugin-shell` | 2 | ^2 | Shell 操作 |
| `tauri-plugin-http` | 2 | ^2.5.7 | HTTP 请求（绕过 CORS） |
| `tauri-plugin-sql` | 2.3.1 | ^2.3.2 | SQLite 资料库 |
| `tauri-plugin-autostart` | 2.5.1 | ^2.5.1 | 开机启动 |
| `tauri-plugin-updater` | ~2.10.0 | ^2.10.0 | 应用更新 |
| `tauri-plugin-store` | ~2.4 | ^2.4.2 | 键值存储（API Key） |
| `tauri-plugin-process` | 2 | ^2.3.1 | App 重启（自动更新后 relaunch） |

### Rust Platform Dependencies

| 套件 | 平台 | 用途 |
|------|------|------|
| `core-graphics` 0.24 + `core-foundation` 0.10 + `objc` 0.2 | macOS | 视窗控制、CGEventTap |
| 原生 CoreAudio FFI（`extern "C"`，无 crate wrapper） | macOS | 系统音量控制（AudioObjectGetPropertyData/SetPropertyData） |
| `windows` 0.61 | Windows | Win32 API、键盘 Hook、IAudioEndpointVolume（系统音量） |
| `arboard` 3 | 跨平台 | 剪贴簿存取 |
| `cpal` 0.15 + `hound` 3.5 + `rustfft` 6 | 跨平台 | 音讯录制、WAV 编码、FFT 波形分析 |
| `reqwest` 0.12 (multipart, json) | 跨平台 | Groq Whisper API（Rust 直接呼叫） |

### External APIs

- Groq Whisper API — `https://api.groq.com/openai/v1/audio/transcriptions`（预设模型：`whisper-large-v3`，语言：由 `getWhisperLanguageCode()` 回传 `string | null`（auto 模式回传 `null` 表示 Whisper 自动侦测），Rust fallback `"zh"`，可选 `whisper-large-v3-turbo`）
- **多 Provider LLM API** — 文字整理（enhancer）与字典分析（vocabularyAnalyzer）共用同一 provider/model/API key，透过 `src/lib/llmProvider.ts` 抽象层路由：
  - **Groq** — `https://api.groq.com/openai/v1/chat/completions`，Bearer auth，timeout 5s，模型：Llama 3.3 70B（预设）/ Qwen3 32B / Llama 4 Scout 17B
  - **OpenAI** — `https://api.openai.com/v1/chat/completions`，Bearer auth，使用 `max_completion_tokens`（非 `max_tokens`），timeout 30s，模型：GPT-5.4 Mini（预设）/ GPT-5.4 Nano
  - **Anthropic** — `https://api.anthropic.com/v1/messages`，`x-api-key` header + `anthropic-version: 2023-06-01`，system message 提取至顶层 `system` 栏位，timeout 30s，模型：Claude Haiku 4.5（预设）/ Claude 3.5 Haiku
  - **Gemini** — `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`，`x-goog-api-key` header，model 在 URL（非 body），system message 用 `system_instruction.parts[].text`，user/assistant 用 `contents[].parts[].text`（assistant role → `"model"`），`generationConfig.maxOutputTokens`，timeout 30s，模型：Gemini 2.5 Flash（预设，免费 250 RPD）/ Gemini 2.5 Flash-Lite（免费 1,000 RPD）
  - **Gemini finishReason 检查** — `parseGeminiResponse` 检查 `candidates[0].finishReason`，非 `STOP`/`MAX_TOKENS` 时抛出错误（如 `SAFETY`、`RECITATION`），避免安全过滤静默 fallback
  - **Provider 抽象层** — `llmProvider.ts` 提供 `buildFetchParams()` / `parseProviderResponse()` 统一处理各 provider 差异
- **模型注册** — `src/lib/modelRegistry.ts` 集中管理：
  - 两组型别：`LlmModelId`（含 `LlmProviderId = "groq" | "gemini" | "openai" | "anthropic"`）、`WhisperModelId`
  - 两个独立模型清单：`LLM_MODEL_LIST`、`WHISPER_MODEL_LIST`
  - 两个安全取得函式：`getEffectiveLlmModelId()`、`getEffectiveWhisperModelId()`
  - 新增 helper：`getModelListByProvider()`、`getDefaultModelIdForProvider()`、`getProviderIdForModel()`
  - 每个 `LlmModelConfig` 必须包含 `providerId` 栏位
  - 价格、免费配额、Badge 标签（`badgeKey`）
  - **下架迁移机制** — `DECOMMISSIONED_MODEL_MAP: Record<string, LlmModelId>`，旧 ID → 新 ID 映射，`getEffectiveLlmModelId()` 自动迁移（仅 LLM 模型，Whisper 直接 fallback 预设）
- CSP 白名单：`connect-src 'self' https://api.groq.com https://generativelanguage.googleapis.com https://api.openai.com https://api.anthropic.com`

### Sentry/Telemetry 整合

#### 架构概览

- **前端** — `@sentry/vue` ^10.42.0，集中在 `src/lib/sentry.ts`，两个视窗分别初始化
- **后端** — `sentry` 0.46（Rust crate），在 `lib.rs` 的 `run()` 中初始化
- **仅生产环境** — 两端都只在 production 环境且 DSN 存在时启用，开发模式不发送

#### 前端初始化（lib/sentry.ts）

- **`initSentryForHud(app)`** — HUD 视窗轻量初始化（无 tracing integration），`main.ts` 呼叫
- **`initSentryForDashboard(app, router)`** — Dashboard 视窗完整初始化（含 `browserTracingIntegration`），`main-window.ts` 呼叫
- **`captureError(error, context?)`** — 统一错误上报入口，带可选 context 物件
- **视窗标签** — `tags: { window: "hud" | "dashboard" }` 区分错误来源

#### Rust 初始化（lib.rs）

- **Guard 模式** — `let _sentry_guard = sentry::init(...)` 绑定在 `run()` 局部变数，app 结束才释放
- **`send_default_pii: false`** — 不发送个人识别资讯
- **DSN 过滤** — 忽略空字串和 `__` 开头的 CI 占位符

#### Sentry 规则

- **错误上报** — 关键流程失败（录音、转录、AI 整理、DB 初始化、bootstrap）必须呼叫 `captureError(error, { source, step })`
- **context 结构规范** — `captureError(err, { source: "模组名", step: "操作名" })`，`source` 对应模组（`settings`/`voice-flow`/`history`/`database-init`/`bootstrap`），`step` 对应操作（`load`/`save-locale`/`transcribe`）
- **上报层级** — 只从 store actions 或启动脚本（`main.ts`, `main-window.ts`）呼叫，`lib/` 层只抛错不上报
- **覆盖范围** — 56 个 `captureError` 呼叫点：`useVoiceFlowStore`（17）、`useSettingsStore`（11）、`useHistoryStore`（8）、`useVocabularyStore`（6）、`main-window.ts`（5）、`MainApp.vue`（3）、`AccessibilityGuide.vue`（3）、`main.ts`（2）、`lib/sentry.ts`（1）
- **全域错误处理** — 两个视窗各自设定 `app.config.errorHandler`（Vue 元件错误）+ `window.addEventListener("unhandledrejection")`（未捕获 Promise），确保逃逸的错误也能上报
- **Rust 端清理** — App 退出前呼叫 `sentry::end_session()` + `client.flush(Duration::from_secs(2))`，确保最后的 event 发送完成
- **Release 格式** — `sayit@<version>`，由 CI/CD 环境变数自动设定
- **Sourcemap 上传** — 仅 `release.yml` 的 macOS ARM64 job 执行（避免重复），使用 `@sentry/cli`

## Critical Implementation Rules

### Language-Specific Rules

#### TypeScript

- **strict mode 启用** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` 全部开启
- **target ES2021** — 可使用 `Promise.allSettled()`, `??`, `?.`，不可使用 ES2022+ 特性
- **`import type` 分离** — 纯型别汇入必须使用 `import type { Xxx }` 语法
- **模组系统** — ESNext modules（`"type": "module"`），汇入路径不带 `.ts` 副档名
- **路径别名** — `@/*` → `./src/*`（tsconfig.json + vite.config.ts 同步设定）
- **环境变数前缀** — 前端环境变数必须以 `VITE_` 或 `TAURI_` 开头
- **编译时常数** — `__APP_VERSION__`（Vite `define`，值来自 `package.json` version），用于 UI 显示版本号
- **错误讯息格式** — `err instanceof Error ? err.message : String(err)` 作为标准错误取值模式（使用 `extractErrorMessage()` from `errorUtils.ts`）
- **错误讯息本地化** — 使用 `src/lib/errorUtils.ts` 集中管理使用者可见的错误讯息，透过 `i18n.global.t('errors.xxx')` 动态翻译（支援 5 种语言），按功能分函式：`getMicrophoneErrorMessage()`, `getTranscriptionErrorMessage()`, `getEnhancementErrorMessage()`
- **结构化 Error class** — `EnhancerApiError extends Error` 带 `statusCode` 属性，`errorUtils.ts` 用 `instanceof EnhancerApiError` 检查取代字串解析。新增 lib 层错误 class 时必须带语意属性（如 `statusCode`、`code`），禁止将结构化资讯编码在 `message` 字串中

#### Rust

- **Tauri Command 签名** — 必须加泛型 `<R: Runtime>` 约束，返回 `Result<T, CustomError>`
- **错误型别** — 使用 `thiserror` crate 定义 enum，且必须手动 `impl serde::Serialize`
- **平台隔离** — `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` 隔离，不可在同一函式中混合
- **unsafe 标记** — macOS `objc::msg_send!` 呼叫必须在 `unsafe {}` 区块内
- **原子操作** — 跨执行绪共享状态使用 `AtomicBool` + `Ordering::SeqCst`
- **Plugin 模式** — 每个功能模组是独立的 `TauriPlugin<R>`，在 `plugins/mod.rs` 中 `pub mod` 汇出（目前：`clipboard_paste`, `hotkey_listener`, `keyboard_monitor`, `audio_control`, `audio_recorder`, `transcription`, `sound_feedback`, `text_field_reader`）。`hotkey_listener` 额外提供 `reset_hotkey_state` command（ESC 中断后重置 toggle 状态）。`sound_feedback` 提供 `play_start_sound`/`play_stop_sound`/`play_error_sound`/`play_learned_sound` commands，前端透过 `playSoundIfEnabled()` 依 `isSoundEffectsEnabled` 设定条件呼叫
- **audio_recorder 录音档管理 Commands（Story 4.4）** — `save_recording_file`（写入 WAV 至 `{APP_DATA}/recordings/`）、`read_recording_file`（接受 `id` 参数，Rust 端组合路径读取 WAV 位元组，回传 `Response`）、`delete_all_recordings`（清除所有录音档）、`cleanup_old_recordings`（按天数清理过期档案，回传被删除的 transcription ID list）
- **transcription 重送 Command（Story 4.5）** — `retranscribe_from_file`（从磁碟读取 WAV 重新转录），内部共用 `send_transcription_request()` 函式（与 `transcribe_audio` 共用 Groq API 逻辑，避免重复实作）
- **text_field_reader: `read_selected_text` command** — 透过模拟 Cmd+C（macOS）/ Ctrl+C（Windows）撷取剪贴簿内容侦测选取文字，不依赖 Accessibility API。流程：储存剪贴簿 → 清空 → 模拟复制 → 等 100ms → 读取 → 还原。实作位于 `clipboard_paste::capture_selected_text_via_clipboard()`。`read_focused_text_field` 仍使用 AX API（`FocusedElementContext` + role check）
- **Plugin State shutdown 惯例** — 每个 Plugin State struct 必须实作 `pub fn shutdown(&self)` 方法，用于 App 退出时清理资源（停止录音、恢复音量、取消 CGEventTap 等）。`shutdown()` 内部必须处理 `Mutex` poisoned 的情况（`match lock() { Err(_) => return }`）
- **Serde JSON 序列化** — Rust → 前端的 payload struct 使用 `#[serde(rename_all = "camelCase")]` 确保前端收到 camelCase JSON
- **Crate 命名** — `name = "sayit_lib"`，`crate-type = ["staticlib", "cdylib", "rlib"]`
- **Release profile** — `panic = "abort"`, `lto = true`, `opt-level = "s"`（档案大小最佳化）

### Framework-Specific Rules

#### Vue 3 (Composition API)

- **仅使用 `<script setup lang="ts">`** — 禁止 Options API（data/methods/computed 物件语法）
- **Composable 模式** — 可复用逻辑封装为 `useXxx()` 函式，放在 `src/composables/`
- **状态暴露** — Composable 内部用 `ref()` 管理，对外返回 `readonly()` 防止直接修改
- **计算属性** — 衍生状态一律用 `computed()` 而非手动 watch + 赋值
- **元件命名** — SFC 档案名 PascalCase，模板中使用 `<PascalCase />` 自闭合标签
- **条件 class** — 使用 `:class="{ 'class-name': condition }"` 绑定语法

#### Pinia Store

- **Store ID** — kebab-case，如 `defineStore('settings', ...)`
- **Store 档案** — `useXxxStore.ts` 放在 `src/stores/`
- **Store 是唯一的资料存取层** — views 不可直接呼叫 `lib/`，必须透过 store actions
- **Store 内部结构** — 使用 Setup Store 语法（`defineStore('id', () => { ... })`），搭配 `ref()`, `computed()`, 函式
- **跨 Store 引用** — Store actions 中可用 `useOtherStore()` 取得其他 store instance（如 `useVoiceFlowStore` 引用 `useSettingsStore`、`useVocabularyStore`、`useHistoryStore`）

#### Vue Router

- **History 模式** — `createWebHashHistory()`（Tauri WebView 不支援 HTML5 History）
- **路由定义** — `src/router.ts`，四个页面路由：`/dashboard`、`/history`、`/dictionary`、`/settings`
- **预设路由** — `/` redirect 到 `/dashboard`

#### Tauri v2 通讯

- **前端 → Rust** — `invoke('command_name', { args })`
- **Rust → 前端** — `emit()` / `emitTo(windowLabel, event, payload)`
- **前端监听** — `listen('event-name', callback)`，元件卸载时 `unlisten()`
- **Event 命名** — `{domain}:{action}` kebab-case（如 `voice-flow:state-changed`）
- **Event 封装** — `src/composables/useTauriEvents.ts` 统一汇出常量和函式：`emitEvent`, `emitToWindow`, `listenToEvent` + 所有 event name 常量
- **HTTP 请求** — 使用 `@tauri-apps/plugin-http` 的 `fetch`（非浏览器原生 fetch），绕过 CORS
- **视窗操作** — `getCurrentWindow()` 取得当前视窗实例
- **多入口架构** — HUD（`index.html` → `main.ts` → `App.vue`）和 Dashboard（`main-window.html` → `main-window.ts` → `MainApp.vue`）为独立入口

#### Graceful Shutdown（App 退出清理）

- **触发点** — `lib.rs` 的 `RunEvent::Exit` handler
- **执行顺序**（必须严格遵守，避免资源泄漏）：
  1. `audio_control.shutdown()` — 恢复系统音量（最高优先：避免永久静音）
  2. `audio_recorder.shutdown()` — 停止 cpal 录音 stream + join thread
  3. `keyboard_monitor.shutdown()` — 取消 CGEventTap / unhook Windows Hook
  4. `hotkey_listener.shutdown()` — 停止 hotkey CGEventTap
  5. `sleep(200ms)` — 等待背景 thread 完成清理
  6. `_exit(0)` — 强制退出（绕过 Tauri 预设行为）
- **新 Plugin 加入时** — 必须在对应位置加入 `shutdown()` 呼叫，并考虑顺序依赖
- **`try_state::<T>()`** — 使用 `try_state` 而非 `state`，因为 Exit 事件不保证所有 state 都已注册

#### CGEvent 贴上机制（clipboard_paste）

- **事件源** — 使用 `CGEventSourceStateID::Private`（隔离事件源），不继承物理键盘的 modifier 状态。禁止使用 `HIDSystemState` 或 `CombinedSessionState`，否则 Toggle 模式下 modifier trigger key（如右 Option）的残留 Alternate flag 会污染模拟的 Cmd+V，导致目标 app 收到 Opt+Cmd+V 触发重复贴上
- **投递位置** — 使用 `CGEventTapLocation::Session`（Session 层），不走 HID 管线。新版 macOS（15.x+）的 HID 层事件可能经由多重路径投递导致重复
- **事件序列** — Cmd↓ → V↓ → V↑ → Cmd↑（4 事件完整配对），V↓/V↑ 带 `CGEventFlagCommand`，Cmd↑ 带 `CGEventFlagNull`

#### Persistent Event Tap 模式（keyboard_monitor）

- **持久监听器** — `keyboard_monitor.rs` 在 `KeyboardMonitorState::new()` 时建立一次 CGEventTap（macOS）/ Windows Hook，App 生命周期内永不销毁
- **Flag 控制** — 靠 `is_monitoring: AtomicBool`（品质监控）和 `correction_monitoring: AtomicBool`（修正侦测）独立控制是否处理事件。两个 monitor 使用完全独立的 flag 集，可同时启用
- **设计动机** — 重复建立/销毁 CGEventTap 会产生幽灵按键（ghost Enter key），这是已确认的 bug 根因

#### ESC 全域中断（VoiceFlow Abort Pattern）

- **触发** — Rust `hotkey_listener.rs` 侦测 ESC KeyDown（macOS keycode 53 / Windows VK 0x1B），emit `escape:pressed` 事件（不经过 `handle_key_event()`，独立路径）
- **前端处理** — `useVoiceFlowStore` 的 `handleEscapeAbort()` 根据当前状态中断操作（idle/success/error/cancelled 时忽略）
- **abort 机制** — `isAborted: Ref<boolean>` + `AbortController`，recording 时停止录音、transcribing 时丢弃结果、enhancing 时 abort fetch（signal 传入 `enhanceText()`）
- **状态重置** — 无条件设 `isRecording = false`、清理所有 timer/polling/listener、呼叫 `reset_hotkey_state` command 重置 Rust 端 `is_pressed`/`is_toggled_on`
- **abort guard 惯例** — `handleStopRecording()` 和 `handleRetryTranscription()` 的所有 `await` 之后及外层 `catch` 必须检查 `if (isAborted.value) return;`
- **重置时机** — `handleStartRecording()` 和 `handleRetryTranscription()` 开头重置 `isAborted = false` + `abortController = new AbortController()`
- **HUD 回馈** — 转为 `"cancelled"` 状态（`NotchHud.vue` X 图示 + "已取消" label），显示 1 秒后 collapse
- **ESC 为保留键** — `keycodeMap.ts` 中 ESC 为 hard block（`getDangerousKeyWarning("Escape")` 回传 null，`getEscapeReservedMessage()` 提供错误讯息），设定页面拒绝设定 ESC 为 trigger key
- **已知限制** — Rust 端 `transcribe_audio` HTTP 请求无法真正取消，仅前端忽略结果（API 费用照算）

#### 组合键 + 模式切换（hotkey_listener）

- **TriggerKey 三种 variant** — `PresetTriggerKey`（字串如 `"fn"`）、`Custom { keycode }`、`Combo { modifiers: Vec<ModifierFlag>, keycode }`。Serde externally tagged（Rust 预设），JSON：`{ "combo": { "modifiers": ["command"], "keycode": 38 } }`
- **ModifierFlag enum** — `Command | Control | Option | Shift | Fn`（5 variants），`#[serde(rename_all = "camelCase")]`。macOS `Fn` 透过 `CGEventFlagSecondaryFn` 侦测；Windows 无 Fn（firmware 层）
- **HotkeySharedState 合并 Mutex** — `trigger_key + trigger_mode + active_modifiers + double_tap + recording + toggle_long_press_fired` 合并在单一 `Arc<Mutex<>>`，CGEventTap callback 只 lock 一次
- **组合键 exact modifier match** — `matches_combo_trigger` 检查 `modifiers.len() == active_mods.len()` + 所有 required modifier 存在。⌘+J 不会被 ⌘+⇧+J 触发。空 modifiers 直接 reject。ESC keycode 作为 combo 主键直接 reject
- **Hold 模式 Double-tap** — 快速按两下触发键（hold < 300ms, gap < 350ms）切换 promptMode（minimal ↔ active）。前端用 `waitForDoubleTapResolution()` Promise await mode-toggle event 或 400ms 超时
- **Toggle 模式 Long-press** — Toggle 改为 release-based。按下时 spawn thread sleep 1s，若 `is_pressed` 仍 true → emit `hotkey:mode-toggle`（HUD 立即出现）。放开时 `toggle_long_press_fired` = true 跳过 toggle。短按 < 1s → 正常 toggle
- **Mode-switch HUD 生命周期** — store 设 `modeSwitchLabel` + `showHud()`，3s 后清 label + `transitionTo("idle")`，与 success 流程一致（collapse 动画 400ms → hideHud）。NotchHud 的 `modeSwitchLabel` watcher 只设 `visualMode = "mode-switch"`，不自行计时
- **ESC 同时清除 DoubleTapState** — `handleEscapeAbort` 也 resolve pending `doubleTapResolve(false)` + 清除 `modeSwitchLabel`
- **Windows Copilot 键 (`VK_F23`, `0x86`) 必须 early-return（硬规则）** — `windows_hook` 取出 `kbd` 结构后第一件事就是 `if kbd.vkCode == VK_F23 { return CallNextHookEx(None, n_code, w_param, l_param); }` 把信号放行，否则 SayIt 开启期间 Copilot 实体键失效（干扰 Windows 11 Quick View）。**禁止把 F23 开放为 SayIt 自订热键**。详见 [`docs/adr-windows-vk-f23.md`](../docs/adr-windows-vk-f23.md)（PR #29，v0.9.5+）

#### Rust-Driven 录键（Recording Mode）

- **Recording State** — `HotkeySharedState.recording: RecordingState { is_active, accumulated_modifiers, last_modifier_keycode }`
- **Commands** — `start_hotkey_recording`（设 `recording.is_active = true`）、`cancel_hotkey_recording`（reset recording state）
- **CGEventTap recording mode** — callback 开头检查 `recording.is_active`，true 时委派 `handle_recording_event_macos()`，跳过所有 trigger 逻辑
- **FlagsChanged 处理** — 标准修饰键（Cmd/Ctrl/Opt/Shift）flag-based 累积；Fn 键 toggle-based（keycode 63 第一次 = press 累积，第二次 = release 捕获）；所有修饰键放开且无主键 → emit `recording-captured { keycode: last_modifier_keycode, modifiers: [] }` 单键
- **KeyDown 处理** — ESC → emit `recording-rejected { reason: "esc_reserved" }`；非修饰键 → emit `recording-captured { keycode, modifiers: accumulated }` combo 或单键
- **Windows hook** — `handle_recording_event_windows` 同理，`is_modifier_vk()` 判断修饰键，`get_active_modifiers_windows()` 追踪状态
- **前端接收** — SettingsView 的 `startRecording()` 呼叫 `invoke("start_hotkey_recording")` + `listenToEvent(HOTKEY_RECORDING_CAPTURED/REJECTED)`。10s 超时呼叫 `cancel_hotkey_recording`。不再使用 DOM `keydown` 事件
- **Display name** — `getKeyDisplayNameByKeycode()` 反向查表 keycode → domCode → 显示名称。Fn keycode 63 特别对应 `"Fn"`。`getDomCodeByKeycode()` 提供 keycode → domCode 反向查找

#### Tauri Events 完整清单

| Event Name | 常量名 | Direction | Payload |
|------------|--------|-----------|---------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | HUD ← VoiceFlow | `VoiceFlowStateChangedPayload` |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | → Main Window | `TranscriptionCompletedPayload` |
| `settings:updated` | `SETTINGS_UPDATED` | → All Windows | `SettingsUpdatedPayload` |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | → All Windows | `VocabularyChangedPayload` |
| `hotkey:pressed` | `HOTKEY_PRESSED` | Rust → HUD | — |
| `hotkey:released` | `HOTKEY_RELEASED` | Rust → HUD | — |
| `hotkey:toggled` | `HOTKEY_TOGGLED` | Rust → HUD | `HotkeyEventPayload` |
| `hotkey:error` | `HOTKEY_ERROR` | Rust → HUD | `HotkeyErrorPayload` |
| `quality-monitor:result` | `QUALITY_MONITOR_RESULT` | Rust → HUD | `QualityMonitorResultPayload` |
| `correction-monitor:result` | `CORRECTION_MONITOR_RESULT` | Rust → HUD | `CorrectionMonitorResultPayload` |
| `audio:waveform` | `AUDIO_WAVEFORM` | Rust → HUD | `WaveformPayload { levels: [f32; 6] }` |
| `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore → HUD | `VocabularyLearnedPayload` |
| `escape:pressed` | `ESCAPE_PRESSED` | Rust → HUD | — |
| `hotkey:mode-toggle` | `HOTKEY_MODE_TOGGLE` | Rust → HUD | `()` |
| `hotkey:recording-captured` | `HOTKEY_RECORDING_CAPTURED` | Rust → Dashboard | `RecordingCapturedPayload` |
| `hotkey:recording-rejected` | `HOTKEY_RECORDING_REJECTED` | Rust → Dashboard | `RecordingRejectedPayload` |
| `audio:preview-level` | `AUDIO_PREVIEW_LEVEL` | Rust → Dashboard | `AudioPreviewLevelPayload` |

#### SettingsKey 跨视窗同步

- **`SettingsKey` 型别** — 定义 `settings:updated` event 的 `key` 栏位（`events.ts`）：`hotkey` | `apiKey` | `aiPrompt` | `enhancementThreshold` | `llmModel` | `llmProvider` | `whisperModel` | `muteOnRecording` | `smartDictionaryEnabled` | `locale` | `transcriptionLocale` | `soundEffectsEnabled` | `promptMode` | `audioInputDevice`
- **智慧字典开关** — `isSmartDictionaryEnabled`（macOS 预设启用，Windows 预设关闭——因 Windows 尚未支援 `read_focused_text_field` AX API）
- **字典分析模型共用** — 字典分析与文字整理共用同一 provider + model + API key（`selectedLlmProviderId` + `selectedLlmModelId`），不再有独立的字典分析模型选择

#### i18n 多语言（vue-i18n）

- **支援语言** — zh-CN（简体中文，fallback）、en（英文，vue-i18n fallbackLocale）、ja、ko。**不再支援独立 zh-TW 界面**；历史 `zh-TW` 透过 `normalizeSupportedLocale()` / `normalizeTranscriptionLocale()` 一律迁移为 `zh-CN`
- **双视窗 instance** — HUD 和 Dashboard 各自建立独立的 `createI18n()` instance（不是 singleton），语言切换透过 `emitEvent(SETTINGS_UPDATED, { key: "locale" })` + `refreshCrossWindowSettings()` 同步
- **Vue 元件翻译** — `const { t } = useI18n()` + template 中 `$t('key')` / `{{ t('key') }}`
- **lib/store 层翻译** — `i18n.global.t('key', params)` — 因为不在 Vue 元件 setup 中，不能用 `useI18n()`
- **翻译档案** — `src/i18n/locales/{locale}.json`，key 结构按功能分组（`settings.*`, `dashboard.*`, `errors.*`, `voiceFlow.*` 等），**4 个档案**（zh-CN / en / ja / ko）的 key 集合必须完全一致
- **AI Prompt 多语言** — `src/i18n/prompts.ts` 管理三层 prompt map：`LEGACY_DEFAULT_PROMPTS`（迁移用）、`MINIMAL_PROMPTS`、`ACTIVE_PROMPTS`。函式：`getMinimalPromptForLocale()`、`getPromptForModeAndLocale(mode, locale)`、`isKnownDefaultPrompt()`。Active prompt 规则：合并重复表达时保留原语气（问句仍是问句、请求仍是请求）、禁止将问句改写为肯定句
- **语言侦测** — `detectSystemLocale()`：精确匹配 → script subtag（`zh-Hant` / `zh-TW` → `zh-CN`，`zh-Hans` → `zh-CN`）→ 语言前缀 → 裸 `zh` → fallback `zh-CN`
- **HTML lang 属性** — `document.documentElement.lang` 随 locale 更新（zh-CN → `zh-Hans`、en → `en`、ja → `ja`、ko → `ko`）
- **中文文案强制简体（硬规则）** — 所有新增中文（UI 文案、注解、文档、commit message、prompt 中文模板）**必须使用简体中文，禁止繁体中文**；日语 locale（`ja.json`、`prompts.ts` 的 `ja` 模板）保持日语，不得用 OpenCC 误转为中文

#### 幻觉侦测架构（v3 — 二层侦测，语速异常 + 无人声侦测）

- **侦测模组** — `src/lib/hallucinationDetector.ts`，纯函式（无 Vue/Pinia 依赖），`detectHallucination()` 回传 `HallucinationDetectionResult`
- **输入参数** — `HallucinationDetectionParams { rawText, recordingDurationMs, peakEnergyLevel, rmsEnergyLevel, noSpeechProbability }`
- **回传型别** — `{ reason: "speed-anomaly" | "no-speech-detected" | null }`
- **二层判定逻辑**（优先级由高到低）：
  - **Layer 1（语速异常）** — `recordingDurationMs < 1000 && charCount > 10` → reason: `speed-anomaly`
  - **Layer 2（无人声侦测）** — 两个子条件（OR 关系）：
    - **2a**：`peakEnergyLevel < 0.02`（SILENCE_PEAK_ENERGY_THRESHOLD）→ 峰值极低，几乎确定无声音
    - **2b**：`peakEnergyLevel < 0.03`（LAYER2B_PEAK_ENERGY_CEILING）且 `rmsEnergyLevel < 0.015`（SILENCE_RMS_THRESHOLD）且 `noSpeechProbability > 0.7`（SILENCE_NSP_THRESHOLD）→ peak 偏低 + 低 RMS + 高 NSP 联合判断。若 peak >= 0.03 表示有明确可听声音，跳过此检查避免小声说话因 RMS 被静音段稀释而误判
    - → reason: `no-speech-detected`
  - **其他** — 放行，正常流程
- **RMS 能量** — Rust `audio_recorder.rs` 的 `stop_recording()` 同时计算 `peak_energy_level`（峰值）和 `rms_energy_level`（均方根），单次遍历。RMS 是整段录音的平均值，会被录音前后的静音段稀释，因此不适合单独作为语音判断依据
- **NSP 使用策略** — `noSpeechProbability` 不单独使用（已知不可靠，Whisper 对中文软音常报高 NSP），仅作为 Layer 2b 的辅助信号搭配 peak + RMS 使用
- **无幻觉词库** — 已移除 `hallucination_terms` 表和 `useHallucinationStore`，侦测完全基于录音品质信号，不依赖词库比对
- **幻觉拦截行为** — 判定为幻觉 → 不贴上，HUD 显示「未侦测到语音」，写入 `transcriptions` 表 `status: 'failed'`，设定重送状态（`canRetry`）
- **整合位置** — `useVoiceFlowStore` 的 `handleStopRecording()` 和 `handleRetryTranscription()` 在转录结果回传后、`isEmptyTranscription` 检查之后执行幻觉侦测
- **`isEmptyTranscription()`** — 仍保留，只拦截完全空白文字（`!rawText.trim()`），与幻觉侦测互补

#### 增强后异常侦测（Enhancement Anomaly Detection）

- **侦测函式** — `detectEnhancementAnomaly()`（`src/lib/hallucinationDetector.ts`），纯函式，检查 LLM 增强是否产出异常结果
- **长度爆炸侦测** — `enhancedText.length >= rawText.length * 2`（`ENHANCEMENT_LENGTH_EXPLOSION_RATIO = 2`）→ LLM 在回答问题或产生幻觉
- **重试机制** — `useVoiceFlowStore` 侦测到异常后自动重试（最多 `MAX_ENHANCEMENT_RETRY_COUNT = 3` 次），重试仍异常则 fallback 到 rawText（`wasEnhanced: false`）
- **整合位置** — `handleStopRecording()` 在 `enhanceText()` 之后，`completePasteFlow()` 之前
- **⚠️ Edit Mode 不适用** — 编辑操作合法改变文字长度（翻译、摘要），禁止对 edit mode 结果做异常侦测

#### Edit Mode（编辑选取文字）

- **侦测逻辑** — `handleStartRecording` 中非阻塞呼叫 `read_selected_text`（`.then()` 设定 `editSourceText`）。底层透过模拟 Cmd+C 读剪贴簿（~100ms），不阻塞开始音效和录音
- **状态推导** — `isEditMode` 是 `computed(() => editSourceText.value !== null)`，不是独立 ref。只需设定 `editSourceText` 即可
- **流程分支** — transcription 成功后，`isEditMode && editSourceText` 为真时走 `handleEditModeFlow()`，否则走既有增强流程
- **Prompt 结构** — system prompt = `EDIT_MODE_PROMPTS[locale]` + `<instruction>语音指令</instruction>`，user message = 选取的文字。不传 `vocabularyTermList`
- **maxTokens** — edit mode 使用 `EDIT_MODE_MAX_TOKENS = 4096`（既有增强为 2048），因选取文字可能很长
- **失败不贴上** — 编辑模式 LLM 失败必须呼叫 `failRecordingFlow()` 而非 fallback 贴上。贴上语音指令（如「翻译成英文」）会覆盖使用者原本选取的文字
- **HudStatus** — 新增 `"editing"` 状态，HUD 视觉复用 `"transcribing"` 动画，录音时显示琥珀色「编辑」badge（`.hud-badge.edit-mode-badge`）
- **DB** — migration v7→v8：`is_edit_mode INTEGER NOT NULL DEFAULT 0`、`edit_source_text TEXT`
- **TranscriptionRecord** — 新增 `isEditMode: boolean`、`editSourceText: string | null`
- **SQL 栏位清单** — `useHistoryStore.ts` 使用 `TRANSCRIPTION_SELECT_COLUMNS` 共用常数，新增栏位时只改一处
- **ESC 中断** — `handleEscapeAbort()` 重置 `editSourceText = null`（`isEditMode` 自动推导为 false）

#### 音讯输入装置选择

- **Rust Commands** — `list_audio_input_devices` → `Vec<AudioInputDeviceInfo>`（列举 cpal 输入装置）；`get_default_input_device_name` → `Option<String>`（查询系统预设装置名称）
- **`start_recording` 参数** — `device_name: String`，空字串 = 系统预设，依名称查找失败时 fallback 到预设装置
- **共用装置选择** — `select_input_device(host, device_name, tag)` helper 封装 cpal Arc cycle workaround，recording/preview thread 共用
- **macOS cpal 0.15.3 workaround** — `input_devices()` 回传的 Device（`is_default=false`）会触发 disconnect listener 的 Arc 循环引用，导致 `drop(stream)` 无法释放 AudioUnit。因此 `select_input_device` 优先比对 `default_input_device()`（`is_default=true`），stream 结束时必须 `stream.pause()` before drop
- **前端型别** — `AudioInputDeviceInfo { name: string }`、`AudioPreviewLevelPayload { level: number }`（`src/types/audio.ts`）
- **设定储存** — `useSettingsStore.selectedAudioInputDeviceName`（预设空字串），持久化 key `audioInputDeviceName`
- **UI** — `SettingsView.vue` 的「输入装置」Card，Select 元件 + 重新整理按钮 + 音量预览条
- **预设装置名称显示** — 「系统预设」选项后方括号显示实际装置名称（`systemDefaultWithDevice` i18n key）
- **i18n key** — `settings.audioInput.{title, description, deviceLabel, systemDefault, systemDefaultWithDevice, volumePreview, refresh, refreshed, updated}`

#### 音量预览（Audio Preview）

- **独立 State** — `AudioPreviewState { handle: Mutex<Option<PreviewHandle>> }`，`PreviewHandle` 含 `should_stop: Arc<AtomicBool>` + `thread: Option<JoinHandle<()>>`，与 `AudioRecorderState` 完全隔离
- **Rust Commands** — `start_audio_preview(app, preview_state, device_name)` → `Result<(), String>`；`stop_audio_preview(preview_state)` → `()`
- **Event** — `audio:preview-level`（常量 `AUDIO_PREVIEW_LEVEL`），payload `AudioPreviewLevelPayload { level: f32 }`，30ms 间隔 emit
- **RMS → dB 映射** — `PREVIEW_DB_FLOOR = -60.0`、`PREVIEW_DB_CEILING = -20.0`（40 dB 动态范围），线性 RMS 转 dB 后正规化。AirPods Pro 等低增益麦克风语音 RMS 约 0.005~0.018（-46 ~ -35 dB）→ 35%~63% 显示
- **preview stream** — `build_preview_stream<T>` 泛型，callback 计算 mono mix + clamp + 累积 `(sum_squares, sample_count)` 到单一 `Mutex<(f64, usize)>`（原子一致性），不存 samples、不做 FFT
- **生命周期** — 设定页 `onMounted` 启动（先 `loadAudioInputDeviceList` 再 `startPreview`）、`onBeforeUnmount` 停止；切换装置时重启；录音开始时自动停止（`start_recording` 持有 recording lock 期间呼叫 `stop_audio_preview_inner`）；录音进行中不启动（AC 11 检查）
- **Thread 清理** — `stop_audio_preview_inner` 会 `take()` handle → set flag → `thread.join()`，确保装置完全释放。`RunEvent::Exit` 中 preview shutdown 必须在 recorder shutdown 之前
- **Composable** — `useAudioPreview.ts`：`useRafFn` + LERP(0.2) + `startRequestId` re-entrancy guard + `onUnmounted` cleanup
- **UI** — `role="meter"` + `aria-valuenow` + `Mic` icon + `bg-primary` bar + `transition-[width] duration-75`

#### 转录语言分离（TranscriptionLocale）

- **型别** — `TranscriptionLocale = SupportedLocale | "auto"`（定义于 `languageConfig.ts`）
- **UI locale vs 转录 locale** — `selectedLocale`（UI 语言）和 `selectedTranscriptionLocale`（Whisper 语言）独立储存，使用者可选不同语言组合（如 UI 英文 + Whisper 中文）
- **`selectedTranscriptionLocale` state** — 存在 `useSettingsStore`，持久化 key `selectedTranscriptionLocale`，首次迁移预设为 UI locale
- **`saveTranscriptionLocale(locale)`** — 储存转录语言 + `settings:updated` event
- **`getWhisperLanguageCode()`** — 回传 `string | null`，根据 `selectedTranscriptionLocale` 解析：`"auto"` → `null`（Whisper 自动侦测），具体语言 → 对应 Whisper code
- **`getWhisperCodeForTranscriptionLocale(locale)`** — 纯函式版本（`languageConfig.ts`），`"auto"` → `null`
- **`TRANSCRIPTION_LANGUAGE_OPTIONS`** — 含 `auto` + 4 语言（zh-CN / en / ja / ko）的下拉选单选项阵列（`TranscriptionLanguageOption[]`）
- **`getEffectivePromptLocale()`** — 内部 helper，解析 prompt 预设值应用哪个 locale：transcription 为 auto 时跟 UI locale，否则跟 transcription locale

#### Prompt Mode 机制（⚠️ 关键行为）

- **三种模式** — `PromptMode = "minimal" | "active" | "custom"`，持久化 key `promptMode`，预设 `"active"`
- **preset 模式（minimal/active）** — `getAiPrompt()` 即时计算，呼叫 `getPromptForModeAndLocale(mode, locale)` 自动跟随 locale 切换，无需手动同步
- **custom 模式** — 使用者自订 prompt，切语言不影响 prompt 内容
- **`refreshCrossWindowSettings()` 顺序** — 必须先载入 `selectedLocale` + `selectedTranscriptionLocale`，再载入 `promptMode`，最后计算 `aiPrompt` fallback（因为 `getEffectivePromptLocale()` 依赖这些值）
- **Kimi K2 退场迁移** — `loadSettings()` 检查 `llmMigratedFromKimiK2` flag（`tauri-plugin-store`），若 `llmModelId` 为 `moonshotai/kimi-k2-instruct` 则迁移为 `llama-3.3-70b-versatile` + provider `groq`。另有 model-provider 交叉验证，防止 model 与 provider 不匹配导致 API key 泄漏

#### Tailwind CSS v4

- **入口语法** — `@import "tailwindcss"`（非 v3 的 @tailwind 指令）
- **Vite 整合** — 透过 `@tailwindcss/vite` plugin，非 PostCSS 配置
- **色彩空间** — oklch（CSS 变数定义在 `src/style.css`）
- **自订变体** — `@custom-variant dark (&:is(.dark *))`

#### UI 设计规范（强制）

- **规范文件** — `_bmad-output/planning-artifacts/ux-ui-design-spec.md`，所有 UI 实作必须遵循
- **shadcn-vue 强制** — 所有 UI 元件使用 shadcn-vue（new-york style, neutral base），禁止手写替代品
- **语意色彩** — 禁止 Tailwind 原生色彩（`zinc-*`, `teal-*`），必须用语意变数（`bg-primary`, `text-foreground`）
- **品牌色** — Teal 主题（`pnpm dlx shadcn-vue@latest init --theme teal`）
- **图标** — 仅 `lucide-vue-next`，禁止 Emoji 和 `@tabler/icons-vue`
- **例外** — `NotchHud.vue` 和 `App.vue` 允许手写 CSS（Notch 动画引擎）
- **cn() 工具** — `src/lib/utils.ts` 提供 `cn()` 函式，用于合并 Tailwind class，不可移除或修改

#### SQLite（tauri-plugin-sql）

- **初始化** — `src/lib/database.ts` 定义 schema，`main-window.ts` 在 `app.mount()` **之前**呼叫 `initializeDatabase()`（避免 `onMounted` race condition）
- **Singleton 防御模式** — `initializeDatabase()` 使用 local `connection` 变数执行所有 schema DDL，**只有全部成功后**才赋值给 module-level `db`。避免「半初始化状态」——`getDatabase()` 返回无表的空连线
- **Tauri 权限** — `sql:default` 仅包含 `allow-load/select/close`（唯读），写入操作（`CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`）需要在 `capabilities/default.json` 额外加上 `sql:allow-execute`
- **WAL 模式** — `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`
- **栏位命名** — snake_case（`raw_text`, `was_enhanced`）
- **主键** — `TEXT PRIMARY KEY`（UUID，前端 `crypto.randomUUID()` 产生）
- **时间戳** — `created_at TEXT DEFAULT (datetime('now'))`
- **操作限制** — SQLite 操作只从 Pinia store actions 发起，元件不可直接执行 SQL
- **SQL 参数** — 使用 `$1`, `$2` 位置参数语法（tauri-plugin-sql 规范）
- **Schema Migration** — `schema_version` 表追踪版本号，migration 在 `database.ts` 中依序执行（`if (currentVersion < N)` → 建表/改表 → 更新版本号），当前版本：v7
  - v3：vocabulary.weight/source 栏位 + api_usage CHECK constraint 扩展
  - v4（Story 4.4）：`ALTER TABLE transcriptions ADD COLUMN audio_file_path TEXT`、`ADD COLUMN status TEXT NOT NULL DEFAULT 'success'`、`CREATE INDEX idx_transcriptions_status`
  - v5（Story 2.4）：`CREATE TABLE hallucination_terms`（已于 v7 移除）
  - v6：重新计算 `transcriptions.char_count`（从 `raw_text` 重算）
  - v7：`DROP TABLE IF EXISTS hallucination_terms`
- **TRANSACTION Migration 模式** — v4 起使用 `BEGIN TRANSACTION / COMMIT / ROLLBACK` 包裹每个 migration，确保 schema 变更原子性
- **外键关联** — `api_usage.transcription_id` → `transcriptions.id`，新增表时必须同步建立 index
- **表命名** — 复数 snake_case（`transcriptions`, `vocabulary`, `api_usage`）

#### 录音档案管理（Story 4.4）

- **储存位置** — `{APP_DATA}/recordings/{transcription_id}.wav`（Tauri `app_data_dir()`）
- **Rust Commands** — `save_recording_file`（写入 WAV）、`read_recording_file`（读取 WAV 位元组，接受 id 参数）、`delete_all_recordings`（清除所有）、`cleanup_old_recordings`（按天数清理，回传被删 ID list）
- **DB 关联** — `transcriptions.audio_file_path` 记录完整路径，`transcriptions.status` 记录 `'success' | 'failed'`
- **失败记录保存** — 空转录、录音太短、API 错误、幻觉拦截均写入 `status: 'failed'` 记录，保留录音档供重送
- **Blob URL 播放** — `invoke("read_recording_file", { id })` 透过 Rust IPC 读取 WAV 位元组（macOS 上 asset protocol URL 被 CSP 阻挡），前端转为 `new Uint8Array(raw)` → `Blob` → `URL.createObjectURL()` 播放，需 CSP `media-src 'self' blob:`
- **自动清理** — `main-window.ts` 启动时 `queueMicrotask` 非阻断清理，呼叫 `cleanup_old_recordings` 后用回传 ID list 批次 SQL UPDATE `audio_file_path = NULL`
- **设定** — `useSettingsStore` 的 `isRecordingAutoCleanupEnabled`（boolean）和 `recordingAutoCleanupDays`（number, default 7）

#### 转录重送机制（Story 4.5）

- **Rust Command** — `retranscribe_from_file`：从磁碟读取 WAV，共用 `send_transcription_request()` 内部函式（与 `transcribe_audio` 共用 Groq API 逻辑）
- **重送状态** — `useVoiceFlowStore` 的 `lastFailedTranscriptionId`、`lastFailedAudioFilePath`、`lastFailedRecordingDurationMs`（失败时设定，新录音时重置）
- **`canRetry` computed** — `status === 'error' && lastFailedAudioFilePath !== null && !isRetryAttempt`
- **重试感知 HUD 时长** — error HUD 预设 3 秒自动消失（`ERROR_DISPLAY_DURATION_MS`），有重试按钮时延长至 6 秒（`ERROR_WITH_RETRY_DISPLAY_DURATION_MS`），让使用者有足够时间点击重试
- **重送限制** — 限 1 次（`isRetryAttempt` flag），重送失败不再提供重送按钮
- **`skipRecordSaving` 模式** — 重送成功时 `completePasteFlow({ skipRecordSaving: true })`，跳过 INSERT（避免 PK 冲突），改由 `updateTranscriptionOnRetrySuccess()` UPDATE 现有 failed 记录
- **API usage 串接** — 重送路径的 `saveApiUsageRecordList` 必须在 `updateTranscriptionOnRetrySuccess` 完成后执行（FK 依赖）
- **幻觉侦测** — 重送结果也需通过幻觉侦测（`handleRetryTranscription` 内整合）
- **竞态处理** — 重送期间使用者触发新录音：`handleStartRecording` 重置 retry 状态，旧 invoke 回来后静默丢弃

#### API 用量追踪

- **费用计算** — `src/lib/apiPricing.ts` 提供 `calculateWhisperCostCeiling()` 和 `calculateChatCostCeiling()` 纯函式
- **费用上限原则** — 一律取较贵的费率计算（如 LLM 取 output token 价格 $0.79/M），确保是费用上限而非精确值
- **Whisper 最低计费** — 不足 10 秒一律按 10 秒算（Groq 计费规则）
- **api_usage 表** — 每次 API 呼叫存一笔记录（`whisper` / `chat` / `vocabulary_analysis`），由 `useVoiceFlowStore` 在转录/AI 整理/字典分析完成后透过 `useHistoryStore` 写入
- **型别** — `ApiUsageRecord`, `ChatUsageData`, `EnhanceResult`, `DailyUsageTrend`, `ApiType = "whisper" | "chat" | "vocabulary_analysis"`（定义在 `src/types/transcription.ts`）
- **Dashboard 统计排除 failed** — `DASHBOARD_STATS_SQL` 和 `DAILY_USAGE_TREND_SQL` 加 `WHERE status != 'failed'`，失败记录不计入总使用次数和趋势图

### Testing Rules

#### 测试框架

- **单元/元件测试** — Vitest ^4.0.18（jsdom 环境，`test.globals: true`）
- **E2E 测试** — Playwright ^1.58.2（baseURL `http://localhost:1420`）
- **覆盖率** — V8 provider（`@vitest/coverage-v8`）
- **Vue 测试工具** — `@vue/test-utils` ^2.4.6

#### 测试档案组织

- **单元测试** — `tests/unit/**/*.test.ts`
- **元件测试** — `tests/component/**/*.test.ts`
- **E2E 测试** — `tests/e2e/`
- **覆盖率排除** — `src/main.ts`、`src/main-window.ts`、`src/**/*.d.ts`

#### 现有测试清单

| 测试档案 | 测试对象 |
|----------|---------|
| `enhancer.test.ts` | Groq LLM AI 整理逻辑 |
| `error-utils.test.ts` | 错误讯息本地化 |
| `auto-updater.test.ts` | 自动更新流程（UpdateCheckResult） |
| `use-voice-flow-store.test.ts` | 录音→转录→AI 整理流程状态（mock Tauri invoke） |
| `use-history-store.test.ts` | 历史记录 CRUD + 统计查询 |
| `use-settings-store.test.ts` | 设定读写（hotkey, API Key, prompt, prompt mode 迁移） |
| `use-settings-store-autostart.test.ts` | 开机自启动逻辑 |
| `api-pricing.test.ts` | API 费用计算逻辑 |
| `format-utils.test.ts` | 时间/文字格式化工具 |
| `factories.test.ts` | 测试资料工厂 |
| `types.test.ts` | 型别定义验证 |
| `NotchHud.test.ts`（component） | HUD 元件 6 态显示 |
| `i18n-settings.test.ts` | 语言侦测、locale 储存/载入、Whisper code 映射、prompt 连动、翻译档 key 一致性 |
| `AccessibilityGuide.test.ts`（component） | 辅助使用权限引导 |
| `use-vocabulary-store.test.ts` | 字典 CRUD + 权重 + AI 推荐词 + getTopTermListByWeight |
| `i18n-smoke.test.ts`（component） | mount View + 切换 locale + 断言 UI 文字切换 |
| `hallucination-detector.test.ts` | 二层幻觉侦测逻辑（语速异常 + 无人声侦测） |
| `smoke.test.ts`（e2e） | 端对端冒烟测试 |

#### 测试规则

- **不主动新增测试** — 除非 Story 明确要求或使用者指示，AI agents 不应自行建立测试
- **i18n mock 模式** — 测试 store/lib 时需 mock `src/i18n`（回传 `{ global: { locale: { value: "zh-CN" }, t: (key) => key } }`）和 `src/i18n/prompts`、`src/i18n/languageConfig`
- **元件测试 i18n 挂载** — mount 元件时必须在 `global.plugins` 加入 i18n instance（`createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })`）
- **型别检查作为品质门槛** — `vue-tsc --noEmit` 是 build 前自动执行的品质检查
- **手动验证重点** — E2E 流程：热键触发 → 录音 → 转录 → (AI 整理) → 贴上，以及 HUD 状态转换
- **假资料** — 使用 `@faker-js/faker` 生成测试/开发用资料
- **Playwright 设定** — 完全并行、60s 测试 timeout、trace on-first-retry、screenshot only-on-failure

#### 测试执行指令

| 指令 | 用途 |
|------|------|
| `pnpm test` | Vitest 单次执行 |
| `pnpm test:watch` | Vitest 监看模式 |
| `pnpm test:coverage` | V8 覆盖率报告 |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm test:e2e:ui` | Playwright UI 模式 |

### Code Quality & Style Rules

#### 命名惯例

| 类型 | 惯例 | 范例 |
|------|------|------|
| Vue 元件档案 | PascalCase | `NotchHud.vue`, `DashboardView.vue` |
| Composable 档案 | camelCase + use 前缀 | `useTauriEvents.ts`, `useFeedbackMessage.ts` |
| Service/Lib 档案 | camelCase | `enhancer.ts`, `errorUtils.ts`, `formatUtils.ts`, `apiPricing.ts` |
| Pinia Store 档案 | camelCase + use 前缀 | `useSettingsStore.ts`, `useVoiceFlowStore.ts` |
| Rust 模组档案 | snake_case | `clipboard_paste.rs`, `hotkey_listener.rs`, `keyboard_monitor.rs`, `audio_recorder.rs`, `transcription.rs` |
| 资料夹 | kebab-case | `src-tauri/`, `components/` |
| TS 变数/函式 | camelCase | `startRecording()`, `enhancedText` |
| TS 型别/介面 | PascalCase + 后缀 | `TranscriptionRecord`, `HotkeyConfig`, `WaveformPayload`, `StopRecordingResult` |
| TS 布林变数 | is/has/can/should 前缀 | `isRecording`, `wasEnhanced`, `hasApiKey` |
| TS 常数 | UPPER_SNAKE_CASE | `FALLBACK_LOCALE`, `ENHANCEMENT_TIMEOUT_MS` |
| TS Error class | PascalCase + Error 后缀 | `EnhancerApiError` |
| Rust 函式/变数 | snake_case | `paste_text()`, `listen_hotkey()` |
| Rust 型别/Struct | PascalCase | `ClipboardError`, `HotkeyConfig` |
| SQLite table | 复数 snake_case | `transcriptions`, `vocabulary` |
| SQLite column | snake_case | `raw_text`, `was_enhanced` |
| Tauri Events | {domain}:{action} kebab-case | `voice-flow:state-changed` |
| Pinia Store ID | kebab-case | `defineStore('settings', ...)` |

#### 档案组织规则

```
src/
├── components/           # 共用 UI 元件
│   ├── NotchHud.vue     # HUD 7 态状态显示（含 cancelled，自订动画引擎）
│   ├── AccessibilityGuide.vue # macOS 辅助使用权限引导
│   ├── AppSidebar.vue   # Dashboard 侧边栏（shadcn Sidebar）
│   ├── DashboardUsageChart.vue # API 用量趋势图表（unovis）
│   ├── Nav*.vue / SiteHeader.vue # 导览元件群（shadcn blocks）
│   └── ui/              # shadcn-vue CLI 生成元件（不手动修改）
├── i18n/                    # 多语言国际化
│   ├── index.ts             # createI18n() instance（非 singleton，各 WebView 独立）
│   ├── languageConfig.ts    # SupportedLocale、TranscriptionLocale 型别、LANGUAGE_OPTIONS、TRANSCRIPTION_LANGUAGE_OPTIONS、detectSystemLocale()、getWhisperCodeForTranscriptionLocale()
│   ├── prompts.ts           # 三层 AI Prompt map（getMinimalPromptForLocale, getPromptForModeAndLocale, isKnownDefaultPrompt）
│   └── locales/             # 翻译 JSON 档（4 语言，key 结构必须一致）
│       ├── zh-CN.json       # 简体中文（基准语言 / fallback）
│       ├── en.json          # English（vue-i18n fallbackLocale）
│       ├── ja.json, ko.json
├── composables/          # Vue composables（跨元件逻辑）
│   ├── useTauriEvents.ts    # Tauri Event 常量 + 封装
│   ├── useFeedbackMessage.ts # 临时回馈讯息模式
│   └── useAudioWaveform.ts  # 音讯波形视觉化（Tauri Event push 模式）
├── lib/                  # Service 层（纯逻辑，无 Vue 依赖）
│   ├── enhancer.ts          # LLM AI 整理（多 Provider）
│   ├── vocabularyAnalyzer.ts # LLM 字典分析（多 Provider，修正侦测后 AI 差异比对）
│   ├── llmProvider.ts       # LLM Provider 抽象层（buildFetchParams / parseProviderResponse）
│   ├── database.ts          # SQLite 初始化 + migration
│   ├── autoUpdater.ts       # tauri-plugin-updater 封装（回传 UpdateCheckResult）
│   ├── sentry.ts            # Sentry 初始化 + captureError（双视窗策略）
│   ├── modelRegistry.ts     # LLM（含 ProviderId）/Whisper 模型注册、价格、Badge、下架迁移
│   ├── keycodeMap.ts        # DOM event.code → 平台原生 keycode 映射
│   ├── errorUtils.ts        # 错误讯息本地化（简体中文 i18n key）
│   ├── hallucinationDetector.ts   # 二层幻觉侦测纯函式（语速异常 + 无人声侦测）
│   ├── formatUtils.ts       # 时间/文字格式化工具
│   ├── apiPricing.ts        # API 费用上限计算（Whisper + LLM）
│   └── utils.ts             # cn() shadcn-vue 工具函式
├── stores/               # Pinia stores
│   ├── useSettingsStore.ts      # 快捷键 / API Key (Groq/Gemini/OpenAI/Anthropic) / LLM Provider / AI Prompt / Prompt Mode / 开机启动 / UI locale / 转录 locale / Whisper 语言
│   ├── useHistoryStore.ts       # 历史记录 CRUD + Dashboard 统计 + 分页
│   ├── useVocabularyStore.ts    # 词汇字典 CRUD + 权重系统 + AI 推荐词管理
│   └── useVoiceFlowStore.ts     # 录音/转录/AI 整理/贴上/修正侦测/字典学习完整流程
├── views/                # Main Window 页面
│   ├── DashboardView.vue      # 统计卡片 + 最近转录列表
│   ├── FeatureGuideView.vue   # 功能介绍页（8 张功能卡片）
│   ├── HistoryView.vue        # 历史记录搜寻与管理
│   ├── DictionaryView.vue   # 词汇字典 CRUD
│   └── SettingsView.vue     # 快捷键 / API Key / AI Prompt / Prompt Mode 切换 设定
├── types/                # TypeScript 型别定义
│   ├── index.ts             # HudStatus（含 cancelled）, TriggerMode, HudTargetPosition 等共用型别
│   ├── transcription.ts     # TranscriptionRecord, DashboardStats, ApiUsageRecord, DailyUsageTrend
│   ├── vocabulary.ts        # VocabularyEntry（含 weight, source）
│   ├── settings.ts          # TriggerKey (Preset | Custom | Combo), ModifierFlag, HotkeyConfig, PromptMode
│   ├── events.ts            # 所有 Tauri Event payload 型别
│   └── audio.ts             # WaveformPayload, StopRecordingResult（含 rmsEnergyLevel）, TranscriptionResult
├── App.vue              # HUD Window 入口
├── MainApp.vue          # Main Window 入口
├── router.ts            # Vue Router hash mode 设定
├── main.ts              # HUD Window 启动
├── main-window.ts       # Main Window 启动（DB 初始化、设定载入、自动更新）
└── style.css            # Tailwind 全域样式 + oklch 变数
```

- **依赖方向单向** — `views → components + stores + composables`，`stores → lib`，`lib → 外部 API`
- **禁止** `views/` 直接呼叫 `lib/`，必须透过 store

#### 日志格式

- **TypeScript** — `console.log("[ModuleName] message")`
- **Rust** — `println!("[module-name] message")` / `eprintln!("[module-name] ERROR: message")`
- **Store 日志** — `[useXxxStore]` 前缀（如 `[useSettingsStore]`）
- **Rust invoke 日志** — 使用 `invoke("debug_log", { level, message })` Tauri Command
- **所有日志必须带模组名前缀**

#### Linter/Formatter

- 目前无 ESLint / Prettier — 依赖 TypeScript strict mode + 手动一致性
- AI agents 应遵循现有程式码风格，不主动新增 linting 工具

### Development Workflow Rules

#### 开发指令

| 指令 | 用途 |
|------|------|
| `pnpm tauri dev` | 开发模式（Vite dev server + Rust 编译） |
| `pnpm build` | 型别检查（vue-tsc）+ Vite 打包 + Cargo 编译 + Tauri bundler |
| `pnpm preview` | 预览编译结果 |

#### 开发伺服器

- **前端** — `localhost:1420`（port strict mode）
- **HMR** — port 1421，当 `TAURI_DEV_HOST` 设定时使用 `ws://host:1421`
- **Vite watch 排除** — `**/src-tauri/**`，Rust 变更不触发 HMR

#### 多入口架构

| 入口 | HTML | TS 入口 | Vue App | 用途 |
|------|------|--------|---------|------|
| HUD | `index.html` | `main.ts` | `App.vue` | Notch 浮动通知视窗 |
| Dashboard | `main-window.html` | `main-window.ts` | `MainApp.vue` | 主仪表板（含路由、DB 初始化、自动更新） |

- **Dashboard 启动顺序** — `main-window.ts` 中必须依序：`createApp().use(pinia).use(router)` → `await initializeDatabase()` → `app.mount("#app")`。DB init 必须在 mount 之前，否则所有 View 的 `onMounted` 会因 `getDatabase()` 抛错而失败
- **HUD 启动顺序** — `App.vue` 的 `onMounted` 中 `await initializeDatabase()` → `voiceFlowStore.initialize()`，因为 HUD 入口 `main.ts` 是同步 mount

#### Git 惯例

- **Commit message** — Conventional Commits 格式（`feat:`, `fix:`, `refactor:` 等）
- **不主动 commit** — AI agents 完成修改后报告 git 状态，等使用者指示
- **单一主题** — 每个 commit 聚焦一个主题，大量变更（20+ 档案）分批 commit

#### 产出格式

- **macOS** — `.dmg`（含 `.app`），ad-hoc 签名，无 Apple Developer ID 与 Notarization
- **Windows** — NSIS `.exe` + `.msi`
- **自动更新** — `tauri-plugin-updater` + GitHub Releases endpoint（启动 5 秒后首次检查，每 4 小时 `setInterval` 定时检查 + Sidebar「检查更新」按钮显示 `UpdateCheckResult` 状态）

#### CI/CD

- **CI** — `.github/workflows/ci.yml`（push/PR to main → vue-tsc + Vitest）
- **Release** — `.github/workflows/release.yml`（tag `v*` 或 `workflow_dispatch` → 前端与跨平台 Rust 品质门禁 → 3 平台建构 + macOS ad-hoc 签名 + Sentry sourcemap upload + 自动公开 Release）
- **发版脚本** — `./scripts/release.sh X.Y.Z`（bump 版本 → commit → tag → 分开推送 branch/tag）
- **GitHub Secrets** — 7 个（`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`）
- **Stable-name Assets** — Release workflow 自动上传固定名称 DMG/EXE（`SayIt-mac-arm64.dmg`, `SayIt-mac-x64.dmg`, `SayIt-windows-x64.exe`），支援官网固定下载 URL
- **Release 公开流程** — `tauri-action` 先建立 Draft release，待 matrix build 全部成功后由 `publish-release` job 自动执行 `gh release edit --draft=false`
- **Tag 推送陷阱** — `git push origin main --tags` 可能不触发 tag 事件，必须分开推送（release.sh 已修正）
- **版本同步硬规则** — 发版时 `git tag`、`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 必须一致，Sentry release 一律绑定同一个版本号
- **Claude Code Review workflows** — `.github/workflows/claude.yml`（`@claude` comment 触发）+ `.github/workflows/claude-code-review.yml`（PR 自动 review）。前置条件：安装 [Claude Code GitHub App](https://github.com/apps/claude) 至 repo + 设定 `CLAUDE_CODE_OAUTH_TOKEN` secret（不是 `ANTHROPIC_API_KEY`）
- **Fork PR Claude review 跳过硬规则** — `claude-code-review.yml` 的 `claude-review` job 必须保留 `if: github.event.pull_request.head.repo.full_name == github.repository`，**禁止移除**。GitHub 不授予 fork PR `id-token: write` 权限（即使 workflow 写了也被忽略），`anthropics/claude-code-action@v1` 的 OIDC 兑换永远失败。`@claude` comment 不受此限制（`issue_comment` 事件由 base repo 触发）。详见 [`docs/adr-claude-code-review-fork-pr.md`](../docs/adr-claude-code-review-fork-pr.md)
- **Fork PR 第一次 workflow 需手动 approve** — GitHub 安全机制；可用 `gh api -X POST /repos/{owner}/{repo}/actions/runs/{id}/approve`

#### 环境变数

**建构/签署（CI/CD only）：**
- **`TAURI_SIGNING_PRIVATE_KEY`** / **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** — Updater 签署

**Sentry（CI/CD 注入，生产环境用）：**

| 端 | 变数名 | 用途 | Fallback |
|----|--------|------|----------|
| Frontend | `VITE_SENTRY_DSN` | Frontend DSN | 无（不启用） |
| Frontend | `VITE_SENTRY_ENVIRONMENT` | 环境标签 | `import.meta.env.MODE` |
| Frontend | `VITE_SENTRY_RELEASE` | Release 版本 | `sayit@${__APP_VERSION__}` |
| Frontend | `VITE_SENTRY_TRACES_SAMPLE_RATE` | 追踪采样率 | `0`（不开启） |
| Frontend | `VITE_SENTRY_SOURCEMAPS_ENABLED` | Sourcemap 生成 | `false` |
| Rust | `SENTRY_DSN` | Rust 端 DSN | 无（不启用） |
| Rust | `SENTRY_ENVIRONMENT` | 环境标签 | `production` / `development` |
| Rust | `SENTRY_RELEASE` | Release 版本 | `sayit@CARGO_PKG_VERSION` |
| CI/CD | `SENTRY_AUTH_TOKEN` | Sourcemap upload 认证 | — |
| CI/CD | `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry 组织/专案 | — |

- **`.env` 不进 git** — `.gitignore` 排除

### Critical Don't-Miss Rules

#### Anti-Patterns（绝对禁止）

- **❌ 浏览器原生 `fetch`** — 必须用 `@tauri-apps/plugin-http` 的 `fetch`，否则被 CSP 挡住或遇 CORS
- **❌ Options API** — 禁止 `data()`, `methods:`, `computed:` 物件语法
- **❌ views 直接呼叫 lib** — 页面元件不可直接 import `lib/` 下的模组，必须透过 Pinia store
- **❌ SQLite 存 API Key** — API Key 只存在 `tauri-plugin-store`（`$APP_DATA/settings.json`），绝不进 SQLite
- **❌ 跨平台程式码混合** — macOS 和 Windows 逻辑不可在同一函式中，必须用 `#[cfg]` 隔离
- **❌ 元件中直接执行 SQL** — SQLite 操作只从 Pinia store actions 发起
- **❌ 使用 `@tabler/icons-vue`** — 虽已安装（dashboard-01 block 附带），但 UI 规范强制只用 `lucide-vue-next`
- **❌ 手写 Button/Input/Card/Dialog** — 必须安装并使用 shadcn-vue 元件
- **❌ 使用 Tailwind 原生色彩** — `zinc-*`, `teal-*`, `red-*` 等全部禁止，用 `bg-primary`, `text-foreground` 等语意变数
- **❌ 手动修改 `src/components/ui/`** — shadcn CLI 生成的元件不手动修改，透过 `cn()` 在使用端覆盖
- **❌ 直接 import Tauri event API** — 使用 `useTauriEvents.ts` 汇出的封装函式和常量，不直接从 `@tauri-apps/api/event` import
- **❌ 录音时未静音系统喇叭** — 录音开始前必须呼叫 `mute_system_audio`，结束后呼叫 `restore_system_audio`，避免系统音效被录进去
- **❌ Singleton 提前赋值** — `database.ts` 的 `db` 变数绝不在 `Database.load()` 后立即赋值，必须等所有 `CREATE TABLE` 成功后才设定。否则 `getDatabase()` 返回无表空连线，所有 query 静默失败
- **❌ 假设 `sql:default` 包含写入权限** — Tauri v2 的 `sql:default` 只有 `load/select/close`，任何 DDL/DML 操作需要额外的 `sql:allow-execute`。新增 Tauri plugin 时务必用 `acl-manifests.json` 确认 default 权限组的实际内容
- **❌ mount 前未初始化 DB** — `main-window.ts` 中 `app.mount()` 会触发所有元件的 `onMounted`，若 DB 尚未初始化，Store 的 `getDatabase()` 会抛错且被 try-catch 静默吞掉
- **❌ 每次转录重建/销毁 CGEventTap** — `keyboard_monitor` 必须使用持久 CGEventTap/Hook 模式：App 启动时建立一次，靠 `is_monitoring: AtomicBool` flag 控制是否处理事件。重复建立/销毁 CGEventTap 会产生幽灵按键（ghost Enter key），这是已确认的 bug 根因
- **❌ CGEvent 贴上使用 HIDSystemState / CombinedSessionState 事件源** — `simulate_paste_via_cgevent()` 必须使用 `CGEventSourceStateID::Private`，否则 Toggle 模式 + modifier trigger key（如右 Option）会残留 Alternate flag 导致重复贴上。投递位置必须用 `CGEventTapLocation::Session`
- **❌ `RunEvent::Exit` 中用 `state()` 取 managed state** — 必须用 `try_state::<T>()` + `if let Some(state)` 模式，避免 state 未注册时 panic
- **❌ 硬编码使用者可见字串** — 所有使用者看得到的文字必须使用 i18n 翻译键（Vue 元件用 `$t()` / `t()`，lib/store 用 `i18n.global.t()`），禁止中文/英文硬编码。程式码注解和日志不需翻译
- **❌ 字串解析提取结构化资讯** — 禁止用 regex 从 `error.message` 提取 status code 等资讯（如 `match(/：(\d+)/)`），必须用 Error class 属性（如 `EnhancerApiError.statusCode`）
- **❌ 在 lib 层使用 `useI18n()`** — `useI18n()` 只能在 Vue 元件 `<script setup>` 中使用，lib/store 层必须用 `i18n.global.t()`
- **❌ 新增翻译键但不同步所有 locale 档案** — 4 个 locale JSON（zh-CN / en / ja / ko）的 key 结构必须完全一致，新增键时必须同时更新所有档案
- **❌ 新增繁体中文文案** — 所有新增中文必须使用简体中文；禁止繁体中文（UI、注解、文档、prompt 中文模板）。日语 locale 保持日语。CI 会跑 `scripts/check-simplified-chinese.mjs` 拦截
- **❌ preset 模式下手动持久化 prompt 文字** — `promptMode` 为 `minimal` 或 `active` 时，prompt 由 `getAiPrompt()` 即时计算，禁止额外呼叫 `store.set("aiPrompt")`
- **❌ `refreshCrossWindowSettings` 中先算 prompt 再载 locale/promptMode** — 必须先载入 `selectedLocale` + `selectedTranscriptionLocale` + `promptMode`，再计算 `aiPrompt` fallback，否则 `getEffectivePromptLocale()` 会用到旧值
- **❌ 硬编码模型 ID** — 模型 ID 必须从 `modelRegistry.ts` 的 type union（`LlmModelId` / `WhisperModelId`）取值，禁止字串硬编码。新增/移除模型时必须同时更新 type、清单、预设值。每个 `LlmModelConfig` 必须包含 `providerId`
- **❌ 忽略下架模型迁移** — 新模型取代旧模型时必须在 `DECOMMISSIONED_MODEL_MAP` 加入旧 ID → 新 ID 映射，否则旧版使用者升级后设定会 fallback 到预设而非指定替代
- **❌ 字典分析绕过 Provider 抽象层** — 字典分析（`vocabularyAnalyzer.ts`）和文字整理（`enhancer.ts`）共用同一 provider/model/API key，必须透过 `llmProvider.ts` 抽象层路由到正确的 API endpoint，不可直接硬编码 API URL 或 auth header
- **❌ abort 后未检查 `isAborted` 继续执行** — `handleStopRecording` / `handleRetryTranscription` 中每个 `await` 之后及外层 `catch` 必须加 `if (isAborted.value) return;`，否则 abort 引发的错误或旧结果会覆盖 cancelled 状态。`handleStartRecording` 的 `await invoke("start_recording")` 之后也需要检查
- **❌ 使用 ESC（keycode 53 / VK 0x1B）作为 Custom trigger key** — ESC 已保留为全域中断键，`keycodeMap.ts` 的 `getDangerousKeyWarning("Escape")` 回传 null（不走 warning 路径），由 `getEscapeReservedMessage()` 提供 hard block 错误讯息
- **❌ 重送成功时 INSERT 新 transcription 记录** — 重送路径必须使用 `completePasteFlow({ skipRecordSaving: true })` + `updateTranscriptionOnRetrySuccess()` UPDATE 现有 failed 记录，禁止 INSERT（PK 冲突 + FK 787 错误）
- **❌ 重送的 API usage 不等 transcription UPDATE 完成** — `saveApiUsageRecordList` 必须串接在 `updateTranscriptionOnRetrySuccess().then()` 之后，确保 FK 依赖正确
- **❌ 新增 LLM Provider 但未更新 Tauri scope** — `capabilities/default.json` 的 `http:default.allow` 和 `tauri.conf.json` 的 CSP `connect-src` 必须同时加入新 API domain，否则 `fetch` 会被 `url not allowed on the configured scope` 拒绝
- **❌ Gemini response finishReason 非 STOP 时静默处理** — `parseGeminiResponse` 必须检查 `finishReason`，SAFETY/RECITATION 等会回 200 OK 但内容为空，不检查会静默 fallback 到原始文字
- **❌ `read_selected_text` 用 await 阻塞 hot path** — 必须用 `.then()` 非阻塞呼叫，避免模拟 Cmd+C ~100ms 延迟影响开始音效。结果在 `handleStopRecording` 前早已就绪
- **❌ 编辑失败时贴上任何东西** — edit mode LLM 失败必须走 `failRecordingFlow()`，禁止 fallback 贴上语音指令（会覆盖使用者选取的原文）
- **❌ edit mode 使用 `detectEnhancementAnomaly`** — 翻译/摘要会合法改变长度，禁止对 edit mode 结果做长度爆炸侦测
- **❌ 在幻觉侦测中单独依赖 NSP** — `noSpeechProbability` 不可靠（Whisper 对中文软音常报高 NSP），只能搭配 peak + RMS 能量作为辅助信号（Layer 2b），不可单独用于判断
- **❌ 使用 peakEnergyLevel 判断「有没有人说话」** — peak 只反映瞬时最大振幅，背景噪音也能达到 0.15+。但 peak >= 0.03 可作为 Layer 2b 的 escape hatch，跳过 RMS+NSP 检查避免小声说话误判

#### 资料映射陷阱

- **SQLite → TypeScript 栏位映射** — SQLite `snake_case` → TS `camelCase`，在 store action 中手动转换（透过 `mapRowToRecord()` / `mapRowToEntry()` 函式）
- **SQLite 布林值** — SQLite 无布林型别，`was_enhanced INTEGER` → TS `wasEnhanced: row.was_enhanced === 1`
- **SQLite null 布林** — `was_modified INTEGER | null` → TS `wasModified: row.was_modified === null ? null : row.was_modified === 1`
- **Tauri Event payload** — 一律 camelCase JSON，不是 Rust 的 snake_case
- **Rust Command 回传** — `serde` 预设序列化为 snake_case JSON，前端需对应处理（建议 payload struct 加 `#[serde(rename_all = "camelCase")]`）

#### 错误处理链路

- **Service 层（lib/）** — 抛出有意义的 `Error`，带上下文讯息
- **Store 层** — `try/catch` 拦截 → 状态更新 → 降级策略
- **Whisper API 失败** → HUD 显示错误，使用者可重试
- **LLM API 超时（5 秒）** → 跳过 AI 整理，直接贴上原始文字（`PASTE_SUCCESS_UNENHANCED_MESSAGE`）
- **Enhancement 字元门槛** — 转录文字 < 10 字元跳过 AI 整理，直接贴上
- **Rust Command 失败** → `Result<T, E>` 自动转前端 Promise rejection
- **错误讯息本地化** — `src/lib/errorUtils.ts` 集中管理 i18n 错误讯息。`getMicrophoneErrorMessage()` 优先匹配 Rust `AudioRecorderError` 字串（`"No input device"` / `"Failed to build audio stream"` / `"Failed to get input config"`），fallback 到 `DOMException` 分支
- **自动更新失败** — 背景检查静默处理，手动检查回传 `{ status: 'error', error: message }` 供 UI 显示

#### 安全规则

- **CSP 硬限制** — `default-src 'self'; connect-src 'self' https://api.groq.com https://generativelanguage.googleapis.com; media-src 'self' blob: http://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'`
- **API Key 不出本地** — 只在 tauri-plugin-store 中，不上传、不写入日志、不透过 Events 传播
- **macOS 权限** — Accessibility 权限是全域热键监听的前提（CGEventTap）
- **macOS Entitlements** — 需 `Entitlements.plist`，`macOSPrivateApi: true`

#### 效能注意事项

- **HUD 动画不阻塞主流程** — 状态转换透过 Tauri Events 驱动，非轮询
- **E2E 延迟目标** — 含 AI < 3 秒、不含 AI < 1.5 秒
- **字数门槛** — 转录文字 < 10 字元跳过 AI 整理，直接贴上
- **idle 记忆体** — 目标 < 100MB
- **Release binary** — `lto = true`, `opt-level = "s"`, `strip = true`（最小化档案大小）
- **History 分页** — `PAGE_SIZE = 20`，避免一次载入全部记录

#### Tauri 视窗配置

| 视窗 | 标签 | 尺寸 | 特性 |
|------|------|------|------|
| HUD | `main` | 400×100 | transparent, alwaysOnTop, no decorations, skipTaskbar |
| Dashboard | `main-window` | 960×680（min 720×480） | decorations, resizable, 预设隐藏 |

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Reference `_bmad-output/planning-artifacts/architecture.md` for detailed architectural decisions
- Reference `_bmad-output/planning-artifacts/ux-ui-design-spec.md` for UI design rules, color system, component patterns, and page layouts

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review periodically for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-27 (v14 — 音量预览系统：AudioPreviewState + dB 映射 + select_input_device 共用 helper + thread join cleanup + useAudioPreview composable + 预设装置名称显示)
