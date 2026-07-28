# Architecture — Frontend Part

> Vue 3 + TypeScript + Tauri JS API · 双视窗 SPA
> 扫描日期：2026-05-08 · 版本：0.9.5 · part_id: `frontend` · root: `src/`

---

## 一、Executive Summary

SayIt frontend 是一个 **Tauri WebView 中执行的双入口 Vue 3 SPA**：

- **HUD（`label="main"`）** — 470×100 透明永远最上层浏海状态浮窗，订阅事件显示录音状态
- **Dashboard（`label="main-window"`）** — 960×680 可拖拉视窗，提供设定、历史、字典、统计

两个视窗共用同一 SQLite 连线池（`tauri-plugin-sql` HashMap pool），共用同一份 i18n / Pinia store 模组码，但**独立 mount 两棵 Vue 树**并走不同的 Vite entry chunk。

---

## 二、Technology Stack

| 层级           | 技术                  | 版本       | 备注                                              |
| -------------- | --------------------- | ---------- | ------------------------------------------------- |
| 框架           | Vue                   | ^3.5       | **Composition API only**（禁止 Options API）      |
| 语言           | TypeScript            | ^5.7       | strict mode                                       |
| State          | Pinia                 | ^3.0.4     | setup syntax                                      |
| Router         | vue-router            | 5.0.3      | `createWebHashHistory()`（Tauri 必要）            |
| UI 元件        | shadcn-vue            | new-york   | 强制使用，禁止手写替代品                          |
| UI 底层        | reka-ui               | ^2.8.2     | shadcn-vue 的无头 UI 库                           |
| CSS            | Tailwind CSS          | ^4         | `@import "tailwindcss"` 语法（v4）                |
| 图示           | lucide-vue-next       | ^0.576.0   | **唯一允许的图示库**                              |
| 表格           | @tanstack/vue-table   | ^8.21.3    | DataTable 逻辑                                    |
| 图表           | @unovis/vue + ts      | ^1.6.4     | shadcn-vue chart 底层                             |
| 工具           | @vueuse/core          | ^14.2.1    | composable 工具                                   |
| i18n           | vue-i18n              | ^11.3.0    | 4 语系（zh-CN / en / ja / ko；历史 zh-TW → zh-CN） |
| Telemetry      | @sentry/vue           | ^10.42.0   | 两个视窗各自初始化                                |
| Build          | Vite                  | ^6         | 多入口（`index.html` + `main-window.html`）       |
| Test (unit)    | Vitest                | ^4.0.18    | jsdom 环境                                        |
| Test (E2E)     | Playwright            | ^1.58.2    | —                                                 |

---

## 三、Architecture Pattern：「Pinia-中心 + Composable-辅助」

```
┌──────────────────────────────────────────────────────┐
│                Views（路由元件）                      │
│  Dashboard / History / Dictionary / Settings / Guide │
└──────────────┬───────────────────────────────────────┘
               │ 不可直接呼叫 lib/，必须透过 store
┌──────────────▼───────────────────────────────────────┐
│              Stores（Pinia · 业务状态）              │
│  useVoiceFlowStore      ── 核心 voice flow 状态机    │
│  useSettingsStore       ── 全部设定 + autostart      │
│  useHistoryStore        ── 转录历史 CRUD              │
│  useVocabularyStore     ── 字典 CRUD + 广播           │
└──────┬─────────────────────────┬─────────────────────┘
       │                         │
       │ 业务逻辑/外部 IO          │ 跨元件逻辑
       ▼                         ▼
┌──────────────────────┐    ┌────────────────────────┐
│      lib/            │    │   composables/         │
│ database.ts          │    │ useTauriEvents（常数） │
│ enhancer.ts          │    │ useAudioWaveform       │
│ vocabularyAnalyzer   │    │ useAudioPreview        │
│ llmProvider          │    │ useFeedbackMessage     │
│ modelRegistry        │    └────────────────────────┘
│ database / sentry    │
│ autoUpdater          │
└──────┬───────────────┘
       │
       ▼
   外部 IO：Tauri Command / Event / SQLite / fetch (HTTP plugin)
```

**依赖方向硬规则**：

```
views/   ──→ components/ + stores/ + composables/   （不可 import lib/）
stores/  ──→ lib/                                    （业务逻辑下沉）
lib/     ──→ External APIs (Groq / OpenAI / Anthropic / Gemini)
```

> 这条规则由 `protect-config.sh` 与 PR review 共同把关。违反例子：`SettingsView.vue` 直接 `import { fetch }` 呼叫 Groq → 应改为 `useSettingsStore().validateApiKey()`。

---

## 四、Module Inventory

### 4.1 Entry Points

| 档案                       | mount target | 视窗 label    | 职责                                          |
| -------------------------- | ------------ | ------------- | --------------------------------------------- |
| `src/main.ts` (22 行)      | `#app` (HUD) | `main`        | initSentryForHud → mount App.vue              |
| `src/main-window.ts` (103) | `#app` (Dashboard) | `main-window` | DB init → router → settings → autostart |

### 4.2 Stores（4 个 · ~4 KLOC）

| Store              | LOC  | 内部状态（精选）                                                                                            |
| ------------------ | ---: | ----------------------------------------------------------------------------------------------------------- |
| useVoiceFlowStore  | 1871 | hud state、recording session、transcription、enhancement、quality monitor、edit mode、smart dict、模式切换 |
| useSettingsStore   | 1395 | apiKey（store plugin）、provider/model、hotkey config、audio device、auto-update、autostart、所有偏好设定 |
| useHistoryStore    |  580 | transcriptions list、search、cursor pagination、retranscribe                                                |
| useVocabularyStore |  200 | vocabulary list、CRUD、AI 学习提交                                                                          |

### 4.3 Lib Modules（13 个 · ~2.6 KLOC）

详见 `source-tree-analysis.md` 第 2.4 节，重点：

- **`database.ts`** — singleton + double-init 防护（HUD 用 `connectToDatabase()`、Dashboard 用 `initializeDatabase()`）；支援 v1→v8 migration；含恢复逻辑（issue #27 vocabulary column 修复）
- **`llmProvider.ts`** — 四 provider 抽象，差异点封装在 `buildFetchParams` / `parseProviderResponse`
- **`modelRegistry.ts`** — 集中管理模型清单；`DECOMMISSIONED_MODEL_MAP` 支援旧 ID 自动迁移到新 ID
- **`hallucinationDetector.ts`** — Whisper 幻觉侦测 v3（语速异常 + 无人声侦测；已移除词库）
- **`sentry.ts`** — 两个 init function（HUD 轻量 / Dashboard 完整含 router tracing），统一 `captureError` 入口

### 4.4 Composables（4 个 · ~220 LOC）

| Composable             | 用途                                          | 订阅事件                |
| ---------------------- | --------------------------------------------- | ----------------------- |
| useTauriEvents.ts      | 唯一允许的 event API import 点                | （re-export）           |
| useAudioWaveform.ts    | HUD 波形动画                                  | `audio:waveform`        |
| useAudioPreview.ts     | SettingsView 音量条                           | `audio:preview-level`   |
| useFeedbackMessage.ts  | UI 讯息提示                                   | —                       |

### 4.5 Views（5 个 · ~3 KLOC）

| View                  | LOC  | 路径          | 主要互动                                    |
| --------------------- | ---: | ------------- | ------------------------------------------- |
| SettingsView.vue      | 1907 | /settings     | 全部设定（API Key、模型、热键、音讯、进阶）  |
| HistoryView.vue       |  379 | /history      | 历史浏览 + 搜寻 + 重新转录 + 音讯播放        |
| DashboardView.vue     |  309 | /dashboard    | 统计卡片 + 使用量图表 + 近期清单             |
| DictionaryView.vue    |  281 | /dictionary   | 字典 CRUD + 智慧学习                         |
| FeatureGuideView.vue  |   56 | /guide        | 功能导览                                     |

### 4.6 Components（11 个 · ~1.9 KLOC）+ shadcn-vue UI（21 个）

详见 `source-tree-analysis.md` 第 2.6 节。

---

## 五、Data Flow — 核心录音流程

```
[使用者按住热键]
       │
       ▼  Rust 端 hotkey_listener emit("hotkey:pressed")
       │
[useVoiceFlowStore 收到 event]
       │
       ├─ play_start_sound()         ── 音效
       ├─ capture_target_window()    ── 纪录焦点视窗
       ├─ mute_system_audio()        ── 静音系统
       ├─ start_recording()          ── cpal 录音
       └─ HUD 切到 "recording" 状态
       
[使用者放开热键]
       │
       ▼  Rust emit("hotkey:released")
       │
[useVoiceFlowStore]
       │
       ├─ stop_recording() → 取得 audio buffer
       ├─ play_stop_sound()
       ├─ restore_system_audio()
       ├─ HUD 切到 "transcribing"
       │
       ├─ transcribe_audio(api_key, vocabulary, model, language)
       │  └── Rust 直接打 Groq Whisper API（绕过前端 fetch）
       │
       ├─ HUD 切到 "enhancing"
       │
       ├─ enhancer.enhance(rawText, vocabulary, prompt)
       │  └── llmProvider.fetch → Groq/OpenAI/Anthropic/Gemini
       │
       ├─ paste_text(processedText)  ── CGEvent / SendInput
       ├─ save_recording_file(id)
       ├─ DB insert transcription + api_usage
       ├─ start_quality_monitor()    ── 后续监测修正
       └─ HUD 切到 "success" → 1.5s 后 idle
```

**ESC 全域中止**：任何阶段 Rust 端 emit `escape:pressed` → store 立即 cleanup → HUD 回 idle。

---

## 六、Sentry / 错误上报边界

| 点位                                  | 行为                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `main.ts` `unhandledrejection`        | `captureError(reason, { source: "hud-unhandled-rejection" })` |
| `main.ts` `app.config.errorHandler`   | `captureError(err, { source: "hud-vue-error", info })`    |
| `main-window.ts` `unhandledrejection` | `captureError(reason, { source: "dashboard-unhandled-rejection" })` |
| `main-window.ts` `errorHandler`       | `captureError(err, { source: "dashboard-vue-error", info })` |
| 业务点位                              | `captureError(err, { source: "..." })`，视窗用 `tags: { window: "hud"|"dashboard" }` 区分 |

> **Production-only**：`initSentryForHud` / `initSentryForDashboard` 内部检查 DSN 与环境变数，dev 模式不发送。

---

## 七、Internationalization (i18n)

```
src/i18n/
├── index.ts            # createI18n({ legacy: false, locale, ... })
├── languageConfig.ts   # 语系列表 + Whisper 语言代码映射 + zh-TW→zh-CN 规范化
├── prompts.ts          # 各语系的 LLM enhancement prompt
└── locales/{en,zh-CN,ja,ko}.json
```

**支援语系**：`zh-CN`（简体中文，fallback）、`en`、`ja`、`ko`。历史 `zh-TW` 透过 `normalizeSupportedLocale()` 映射为 `zh-CN`，不再提供独立繁体界面。

**Whisper 语言代码映射特例**：`languageConfig.ts` 的 `getWhisperLanguageCode()` 对 "auto" 模式回传 `null`（让 Whisper 自动侦测），其余语言回传对应 ISO code。Rust fallback 为 `"zh"`。

---

## 八、Build 配置与多入口

`vite.config.ts` 设定两个 entry：

```
input:
  - index.html         → src/main.ts        → HUD bundle
  - main-window.html   → src/main-window.ts → Dashboard bundle
```

两个 bundle 共用 chunk（如 stores、lib），但各自有独立 entry chunk。Tauri 运行时用 `WebviewWindow` 的 `url` 属性指定载入哪个 HTML。

---

## 九、Testing Strategy

| 类别     | 工具                | 位置                | 范围                                    |
| -------- | ------------------- | ------------------- | --------------------------------------- |
| Unit     | Vitest + jsdom      | `tests/unit/`       | stores、lib（纯逻辑）                   |
| Component| @vue/test-utils     | `tests/component/`  | components（rendering + interaction）   |
| E2E      | Playwright          | `tests/e2e/`        | 跨视窗使用者旅程                         |
| Coverage | @vitest/coverage-v8 | —                   | `pnpm test:coverage`                    |

CI 只跑 `pnpm test`（unit + component），E2E 目前未在 CI 执行（仍在本机跑）。

---

## 十、不可违反的硬规则（最常踩）

1. **❌ 浏览器原生 `fetch`** → ✅ 用 `@tauri-apps/plugin-http` 的 `fetch`（避开 CORS）
2. **❌ Options API** → ✅ `<script setup lang="ts">`
3. **❌ views 直接 import lib/** → ✅ 透过 Pinia store
4. **❌ SQLite 存 API Key** → ✅ 只能用 `tauri-plugin-store`
5. **❌ Tailwind 原生色彩** → ✅ 语意变数（`bg-primary`、`text-foreground`、`border-border`）
6. **❌ `@tabler/icons-vue`** → ✅ 只用 `lucide-vue-next`
7. **❌ 手写 UI 元件** → ✅ 用 shadcn-vue（new-york style）
8. **❌ 直接 import Tauri event API** → ✅ 透过 `composables/useTauriEvents.ts`
9. **❌ 未经 Pencil 设计直接写 UI** → ✅ 先在 `design.pen` 完成设计

---

## 十一、Open Issues / Tech Debt

| Issue              | 描述                                                         |
| ------------------ | ------------------------------------------------------------ |
| `@tabler/icons-vue` 残留 | dashboard-01 block 附带安装，新程式码不应使用                |
| `addApiUsage` FK 失败 (787) | `transcriptions` 与 `api_usage` 写入 race，待调查           |
| autoUpdater 的 `window.confirm` | Tauri WKWebView 会静默忽略，需改 in-app UI                |
| FeatureGuideView 内容不足 | 56 行，多数静态文案                                          |
