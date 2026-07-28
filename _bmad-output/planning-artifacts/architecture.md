---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - prd.md
  - product-brief-sayit-2026-02-28.md
  - voice-transcription-poc-spec.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-03-01'
project_name: 'sayit'
user_name: 'Jackle'
date: '2026-02-28'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements：**

36 条 FR 涵盖 8 个能力领域。架构面最关键的需求群组：

| 能力领域 | FR 数量 | 架构意涵 |
|----------|---------|---------|
| 语音触发与录音 | 5 | 需跨平台全域热键（OS-native API），Hold/Toggle 双模式状态机 |
| AI 文字整理 | 5 | Groq LLM 整合层，prompt 管理，上下文注入（剪贴簿+词汇），字数门槛分支逻辑 |
| 文字输出 | 3 | 剪贴簿操作 + 键盘模拟跨平台封装，贴上后键盘监控（品质衡量） |
| 历史记录与统计 | 6 | SQLite 资料层，聚合查询（Dashboard 统计），全文搜寻 |
| 状态回馈 HUD | 4 | 6 态状态机（idle → recording → transcribing → enhancing → success/error → idle） |
| 应用程式管理 | 7 | System Tray、自动更新、开机自启动、权限引导 |

**Non-Functional Requirements：**

| 类别 | 关键指标 | 架构影响 |
|------|---------|---------|
| 效能 | E2E < 3s（含 AI）、< 1.5s（跳过 AI）、idle < 100MB | API 呼叫需非同步、HUD 动画不能阻塞主流程 |
| 效能 | HUD 状态转换 < 100ms、SQLite 查询 < 200ms | 前端状态管理需高效、SQLite 需适当索引 |
| 安全 | API Key 本地储存，不外泄 | tauri-plugin-store 明文 JSON，安全依赖 OS 档案系统权限 |
| 整合 | Groq API timeout 5 秒，超时 fallback 原始文字 | 需 timeout + 降级策略的服务层 |
| 可靠 | 系统可用率 > 99%、SQLite WAL 模式 | 错误隔离，API 失败不影响 App 稳定性 |

**Scale & Complexity：**

- Primary domain：Desktop Full-Stack（Rust + Vue + SQLite）
- Complexity level：Low-Medium
- 估计架构元件数：~12（Rust plugins × 4 + Frontend services × 5 + Stores × 3）

### Technical Constraints & Dependencies

**Brownfield 约束（现有 POC 程式码）：**

| 元件 | 现状 | V2 动作 |
|------|------|---------|
| `fn_key_listener.rs` | CGEventTap（仅 macOS） | 扩展重写 → OS-native 双平台（macOS CGEventTap + Windows SetWindowsHookExW） |
| `clipboard_paste.rs` | arboard + CGEvent Cmd+V（macOS, Private source + Session posting）+ SendInput（Windows） | 保留，扩展贴上后监控 |
| `lib.rs` | 单视窗设定 + System Tray | 扩展支援双视窗 |
| `recorder.ts` | MediaRecorder 录音 | **DELETED** — 迁移至 `audio_recorder.rs`（Rust cpal） |
| `transcriber.ts` | Groq Whisper API | **DELETED** — 迁移至 `transcription.rs`（Rust reqwest） |
| `useVoiceFlow.ts` | 录音→转录流程 | 扩展 AI 整理步骤 |
| `NotchHud.vue` | 3 态 HUD | 扩展为 6 态 |
| `App.vue` | 单视窗（HUD only） | HUD 视窗保留，Main Window 新增 |

**框架约束：**
- Tauri v2：双视窗需在 tauri.conf.json 定义，前后端通讯走 Tauri Commands + Events
- Vue 3 Composition API：现有模式已采用，V2 延续
- pnpm：套件管理已确立

**外部依赖：**
- Groq Whisper API（语音转文字，无替代方案）
- Groq LLM API（AI 文字整理，5 秒 timeout 降级为原始文字）
- 无其他云端服务依赖

### Cross-Cutting Concerns Identified

1. **跨平台行为抽象** — OS 原生键盘 API（macOS CGEventTap / Windows SetWindowsHookExW）的事件模型差异（键码对应、权限需求、事件触发频率）需要统一的抽象层
   - **组合键支援**：`CustomTriggerKey` 扩展为 `{ modifiers: Vec<Modifier>, keycode: u16 }`
   - `Modifier` enum: `Ctrl`, `Shift`, `Cmd`(macOS), `Alt`
   - macOS 判定：CGEventFlags 检查 modifier 状态 + keycode 匹配
   - Windows 判定：GetKeyState() 检查 modifier 状态 + VK code 匹配
   - 向后相容：旧 `{ keycode }` 解析为 `{ modifiers: [], keycode }`
2. **双视窗状态同步** — HUD Window 和 Main Window 需共享应用程式状态（录音状态、设定变更、历史更新），Tauri Events 或 Pinia 跨视窗同步是关键决策点
3. **API 错误降级** — Groq API 的 timeout/失败需要一致的降级策略：Whisper 失败 → 显示错误；LLM 超时 → 跳过 AI 直接贴上原始文字
4. **安全金钥储存** — API Key 使用 tauri-plugin-store 储存于 App Data 目录（明文 JSON），安全依赖 OS 档案系统权限，不暴露于日志或网路
5. **资料持久化层** — SQLite 需统一的存取模式（Tauri Commands 封装），历史记录和词汇字典共用同一资料库但各自的 table

## Starter Template Evaluation

### Primary Technology Domain

**Desktop Full-Stack（Brownfield）** — 现有 Tauri v2 + Vue 3 专案，技术栈已确立。本节记录现有基础并规划 V2 所需的新依赖。

### Existing Stack Confirmation

**现有技术栈（POC 已验证）：**

| 层级 | 技术 | 版本 | 状态 |
|------|------|------|------|
| 桌面框架 | Tauri | v2.10.x | ✅ 已采用 |
| 前端框架 | Vue 3 | 3.5.29 | ✅ 已采用 |
| 语言（前端） | TypeScript | 5.9.3 | ✅ 已采用 |
| 语言（后端） | Rust | 2021 edition | ✅ 已采用 |
| CSS 框架 | Tailwind CSS | 4.2.1 | ✅ 已采用 |
| 建构工具 | Vite | 6.4.1 | ✅ 已采用 |
| 套件管理 | pnpm | — | ✅ 已采用 |
| 剪贴簿 | arboard | 3.6.1 | ✅ 已采用 |
| ~~键盘模拟~~ | ~~enigo~~ | ~~0.2~~ | ❌ 已移除（零使用死依赖） |
| HTTP 请求 | tauri-plugin-http | 2.x | ✅ 已采用 |
| macOS 视窗 | objc + core-graphics | 0.2 / 0.24 | ✅ 已采用 |
| Windows 视窗 | windows crate | 0.61 | ✅ 已采用 |

### V2 New Dependencies Required

**Rust (Cargo) — 新增：**

| 依赖 | 版本 | 用途 | Cargo feature |
|------|------|------|-------------|
| `tauri-plugin-sql` | 2.3.1 | SQLite 资料库（历史记录 + 词汇字典） | `sqlite` |
| `tauri-plugin-autostart` | 2.5.1 | 开机自启动 | — |
| `tauri-plugin-updater` | ~2.2.0 | 自动更新 | — |
| `tauri-plugin-store` | ~2.x | API Key 本地储存（明文 JSON） | — |
| `cpal` | 0.15 | 跨平台音讯录制 | — |
| `hound` | 3.5 | WAV 编码 | — |
| `rustfft` | 6 | FFT 波形分析 | — |
| `reqwest` | 0.12 | Groq Whisper API | `multipart`, `json` |

**JavaScript (pnpm) — 新增：**

| 依赖 | 版本 | 用途 |
|------|------|------|
| `vue-router` | 5.0.3 | Main Window 页面路由 |
| `pinia` | 3.x | 跨视窗状态管理 |
| `@tauri-apps/plugin-sql` | ~2.3.1 | SQLite 前端 bindings |
| `@tauri-apps/plugin-autostart` | ~2.5.1 | 开机自启动前端 bindings |
| `@tauri-apps/plugin-updater` | ~2.2.0 | 自动更新前端 bindings |
| `@tauri-apps/plugin-store` | ~2.x | 本地储存前端 bindings |

### Architectural Decisions Provided by Existing Stack

**Language & Runtime：**
- Rust 2021 edition（后端系统操作）
- TypeScript strict mode（前端逻辑）
- 双语言架构透过 Tauri Commands + Events 桥接

**Styling Solution：**
- Tailwind CSS 4.x（utility-first，已在 HUD 使用）

**Build Tooling：**
- Vite 6.x（前端 dev server + 打包）
- `cargo tauri dev/build`（整合建构）
- `vue-tsc --noEmit`（型别检查）

**Code Organization（现有模式，V2 延续）：**
- Rust plugins 在 `src-tauri/src/plugins/`
- Vue composables 在 `src/composables/`
- Service 层在 `src/lib/`
- 元件在 `src/components/`
- 型别定义在 `src/types/`

**Note：** V2 不需要专案初始化 — 基于现有 POC 结构扩展。第一个实作 Story 应是新增 SQLite 基础架构 + 扩展 OS-native 热键监听。

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions（阻塞实作）：**
- API Key 储存方式
- Groq API 呼叫位置
- 双视窗状态同步机制
- SQLite Schema 设计策略

**Important Decisions（影响架构品质）：**
- 错误处理模式
- 自动更新机制

**Deferred Decisions（Phase 2+）：**
- 无 — 所有架构决策已在本轮完成

### Data Architecture

**决策：前端直接 SQL（tauri-plugin-sql）**

- tauri-plugin-sql 前端直接执行 SQL，资料存取逻辑集中在 Pinia stores 的 actions 中
- 不建立额外的 Rust Command 资料存取层，避免过度抽象
- SQLite WAL 模式确保写入安全
- Schema migration：App 启动时版本检查 + `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`

**Schema 设计：**

```sql
-- 历史记录
CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  processed_text TEXT,
  recording_duration_ms INTEGER NOT NULL,
  transcription_duration_ms INTEGER NOT NULL,
  enhancement_duration_ms INTEGER,
  char_count INTEGER NOT NULL,
  trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
  was_enhanced INTEGER NOT NULL DEFAULT 0,
  was_modified INTEGER,          -- 贴上后是否被使用者修改
  audio_file_path TEXT,             -- 指向 recordings/ 目录下的 WAV 档案
  status TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'failed'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transcriptions_timestamp ON transcriptions(timestamp DESC);
CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at);

-- 幻觉词汇拦截
CREATE TABLE IF NOT EXISTS hallucination_terms (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'（'builtin' 已弃用，App 启动时清除）
  language TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 自订词汇
CREATE TABLE IF NOT EXISTS vocabulary (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema 版本追踪
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
```

### 录音档管理

- **储存位置**：`{APP_DATA}/recordings/` 目录
- **档案格式**：WAV（16-bit mono 16kHz，由 audio_recorder.rs 编码）
- **命名规则**：`{transcription_id}.wav`（UUID 对应 transcriptions 表）
- **储存时机**：`stop_recording()` 完成 WAV 编码后，同时存入 Rust State 和磁碟
- **失败记录**：转录失败（Whisper 回传空字串或幻觉拦截）时仍储存录音档，transcriptions 表 status 为 'failed'
- **清理策略**：使用者可设定自动清理天数（预设 7 天）+ 手动删除所有录音档
- **前端播放**：`convertFileSrc()` 转换本地路径 → HTML5 `<audio>` 串流播放
- **大小估算**：~32KB/秒，10 秒录音 ≈ 320KB

### Security

**决策：tauri-plugin-store 本地储存 API Key**

- 使用 tauri-plugin-store 将 API Key 储存于本地 App Data 目录（明文 JSON）
- 不整合 OS 原生 Keychain/Credential Manager — 内部效率工具，安全依赖 OS 档案系统权限已足够
- API Key 不进入 SQLite，独立于 store 档案中
- API Key 不暴露于日志、网路传输或 Tauri Events

### API & Communication Patterns

**决策：Groq API 呼叫分层 — Whisper 走 Rust、LLM 走前端**

- Groq Whisper API 已迁移至 Rust 侧（`transcription.rs` via `reqwest`），音讯录制到转录全程在 Rust 完成，避免跨语言传递音讯 blob
- Groq LLM API 维持前端呼叫（`enhancer.ts` via `@tauri-apps/plugin-http`），因文字处理逻辑与前端状态紧耦合
- CSP 仍限制 `connect-src` 至 `self` + `https://api.groq.com`（LLM 呼叫仍从前端发出）
- API Key 在本地 App 环境中，不存在浏览器公开暴露风险

**错误处理模式：**

- Rust → TypeScript：Tauri Command 的 `Result<T, E>` 自动转为前端 Promise rejection，前端 `try/catch` 处理
- Groq API 错误：人类可读讯息传给 HUD 显示
- Whisper API 失败 → HUD 显示错误讯息，使用者可重试
- LLM API 超时（5 秒）→ 跳过 AI 整理，直接贴上原始转录文字
- 不建立统一错误码系统，保持简单

### Frontend Architecture

**决策：Tauri Events 跨视窗同步 + Pinia 各视窗本地状态**

- 每个视窗（HUD / Main Window）各自持有 Pinia store instance
- 关键状态变更透过 Tauri v2 `emitTo(windowLabel, event, payload)` 跨视窗广播
- 需同步的事件：录音状态变化、新转录记录产生、设定更新、词汇变更
- HUD Window 订阅录音/转录/AI 整理状态事件
- Main Window 订阅新记录事件以更新 Dashboard

**路由：** Vue Router 5.x，hash mode（桌面 App 无需 history mode）

**Pinia Stores 结构：**
- `useSettingsStore` — 快捷键、API Key、AI Prompt
- `useHistoryStore` — 历史记录 CRUD + Dashboard 统计查询
- `useVocabularyStore` — 词汇字典 CRUD
- `useVoiceFlowStore` — 录音/转录/AI 整理流程状态（扩展现有 useVoiceFlow）

### Infrastructure & Deployment

**决策：GitHub Releases 自动更新**

- 使用 tauri-plugin-updater + GitHub Releases endpoint
- Updater endpoint: `https://github.com/yee94/SayIt/releases/latest/download/latest.json`
- Public repo: `yee94/SayIt`
- 使用者体验：
  - **定时检查** — 启动 5 秒后首次检查，之后每 4 小时背景检查
  - **手动检查** — Sidebar Footer 的「检查更新」按钮，结果以 inline feedback 显示（2.5 秒自动消失）
  - **更新流程** — 自动下载 → 提示重启 → 一键完成
- `checkForAppUpdate()` 回传 `UpdateCheckResult`（`up-to-date` | `update-available` | `error`），供 UI 显示结果

**CI/CD Pipeline（已实作）：**
- **CI**（`.github/workflows/ci.yml`）— push/PR to main 触发 vue-tsc + Vitest
- **Release**（`.github/workflows/release.yml`）— push tag `v*` 触发 3 平台建构
  - macOS ARM + Intel：ad-hoc 签名，无 Apple Developer ID 与 Notarization
  - Windows x64：未签名 NSIS installer

**发版流程：**
1. `./scripts/release.sh X.Y.Z`（自动更新版本号、commit、tag、push）
2. 等 GitHub Actions 完成（约 10-15 分钟）
3. 到 GitHub Releases 手动 Publish draft release
4. 使用者的 App 自动侦测并提示更新

**安装包签名策略：**
- macOS：ad-hoc 签名，使用者首次开启时手动信任
- Windows：无 Authenticode 凭证，使用者依 SmartScreen 提示手动信任
- Updater：保留 minisign 更新包签名与验证

**安装包格式：**
- macOS：`.dmg`（含 `.app`）+ `.app.tar.gz`（updater 用）
- Windows：NSIS `.exe` + `.msi`

### Decision Impact Analysis

**Implementation Sequence：**

```
1. SQLite 初始化（schema + migration）
2. Pinia stores 建立（settings / history / vocabulary）
3. 双视窗架构（tauri.conf.json + Vue Router）
4. Tauri Events 跨视窗同步机制
5. API Key 储存（tauri-plugin-store）
6. Groq LLM 整合（enhancer.ts）
7. 自动更新（tauri-plugin-updater + endpoint）
```

**Cross-Component Dependencies：**

```
SQLite ──→ historyStore / vocabularyStore
     │
tauri-plugin-store ──→ settingsStore（API Key）
     │
Tauri Events ──→ HUD Window ←──→ Main Window
     │
enhancer.ts ──→ useVoiceFlowStore（AI 整理步骤）
     │
tauri-plugin-updater ──→ 独立模组，App 启动时初始化
```

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**识别出 5 大冲突领域，18 个潜在冲突点**

### Naming Patterns

**Database Naming（SQLite）：**
- Table：复数 snake_case → `transcriptions`, `vocabulary`, `schema_version`
- Column：snake_case → `raw_text`, `recording_duration_ms`, `was_enhanced`
- Index：`idx_{table}_{column}` → `idx_transcriptions_timestamp`
- Primary Key：`id`（TEXT UUID）

**Rust Naming：**
- Functions/variables：snake_case → `paste_text()`, `listen_hotkey()`
- Types/Structs：PascalCase → `TranscriptionRecord`, `HotkeyConfig`
- Tauri Commands：snake_case → `#[command] fn paste_text()`
- Plugin modules：snake_case → `hotkey_listener.rs`, `clipboard_paste.rs`

**TypeScript Naming：**
- Variables/functions：camelCase → `addTranscription()`, `enhancedText`
- Types/Interfaces：PascalCase + 后缀 → `TranscriptionRecord`, `SettingsDto`, `VoiceFlowState`
- Boolean 变数：`is/has/can/should` 前缀 → `isRecording`, `wasEnhanced`, `hasApiKey`
- Constants：UPPER_SNAKE_CASE → `DEFAULT_PROMPT`, `API_TIMEOUT_MS`

**Vue Components：**
- 档案名：PascalCase → `NotchHud.vue`, `DashboardStats.vue`, `HistoryList.vue`
- 元件名：PascalCase → `<NotchHud />`, `<DashboardStats />`

**Pinia Stores：**
- 档案名：camelCase → `useSettingsStore.ts`, `useHistoryStore.ts`
- Store ID：kebab-case → `defineStore('settings', ...)`, `defineStore('history', ...)`

**Tauri Events：**
- 命名空间：`{domain}:{action}` kebab-case → `voice-flow:state-changed`, `transcription:completed`, `settings:updated`, `vocabulary:changed`

**资料夹：**
- 一律 kebab-case → `src/stores/`, `src/views/`, `src/components/`

### Structure Patterns

**V2 完整专案结构：**

```
src/
├── components/           # 共用 UI 元件
│   ├── NotchHud.vue     # HUD 状态显示（现有，扩展）
│   └── ui/              # 通用 UI 元件（按钮、输入框等）
├── composables/          # Vue composables（跨元件逻辑）
│   ├── useHudState.ts   # HUD 状态管理（现有）
│   └── useVoiceFlow.ts  # 录音/转录流程（现有，扩展）
├── lib/                  # Service 层（纯逻辑，不依赖 Vue）
│   ├── enhancer.ts      # Groq LLM AI 整理（新增）
│   └── database.ts      # SQLite 初始化 + migration（新增）
│   # recorder.ts — DELETED，迁移至 audio_recorder.rs（Rust cpal）
│   # transcriber.ts — DELETED，迁移至 transcription.rs（Rust reqwest）
├── stores/               # Pinia stores（新增目录）
│   ├── useSettingsStore.ts
│   ├── useHistoryStore.ts
│   ├── useVocabularyStore.ts
│   └── useVoiceFlowStore.ts
├── views/                # Main Window 页面（新增目录）
│   ├── DashboardView.vue
│   ├── HistoryView.vue
│   ├── DictionaryView.vue
│   └── SettingsView.vue
├── types/                # TypeScript 型别定义
│   └── index.ts         # 现有，扩展
├── App.vue              # HUD Window 入口（现有）
├── MainApp.vue          # Main Window 入口（新增）
├── router.ts            # Vue Router 设定（新增）
├── main.ts              # HUD Window 启动（现有）
├── main-window.ts       # Main Window 启动（新增）
└── style.css

src-tauri/src/
├── plugins/
│   ├── mod.rs
│   ├── hotkey_listener.rs   # OS-native 跨平台热键（扩展重写）
│   ├── clipboard_paste.rs   # 剪贴簿操作（现有，扩展）
│   ├── keyboard_monitor.rs  # 贴上后键盘监控（新增）
│   ├── audio_recorder.rs    # cpal 音讯录制 + WAV 编码 + FFT 波形 [新增]
│   └── transcription.rs     # Groq Whisper API via reqwest [新增]
├── lib.rs                   # App 设定（现有，扩展双视窗）
└── main.rs
```

**规则：**
- 元件放 `components/`，页面放 `views/`
- 纯逻辑（无 Vue 依赖）放 `lib/`，Vue 相关逻辑放 `composables/` 或 `stores/`
- 每个 Pinia store 一个档案，档案名 = store composable 名
- Rust plugin 一个档案一个模组，统一在 `mod.rs` export

### Format Patterns

**SQLite ↔ TypeScript 资料映射：**
- SQLite column snake_case → TypeScript interface camelCase
- 映射在 Pinia store 的 actions 中处理（query 出来做 field mapping）
- 范例：`raw_text` → `rawText`, `was_enhanced` → `wasEnhanced`

**Tauri Event Payload：**
- 一律 camelCase JSON
- 范例：`{ status: 'recording', message: '录音中...' }`

**日期格式：**
- SQLite：`datetime('now')` 产生的 ISO 字串用于 `created_at`
- 数值时长：`INTEGER` 毫秒 → `recordingDurationMs`
- 前端显示：`Intl.DateTimeFormat` 格式化

### Communication Patterns

**Tauri Events 完整清单：**

| Event Name | Direction | Payload | 用途 |
|------------|-----------|---------|------|
| `voice-flow:state-changed` | HUD ← VoiceFlow | `{ status, message }` | HUD 状态更新 |
| `transcription:completed` | → Main Window | `{ id, rawText, processedText, ... }` | 新记录通知 |
| `settings:updated` | → All Windows | `{ key, value }` | 设定变更同步 |
| `vocabulary:changed` | → All Windows | `{ action, term }` | 词汇变更同步 |
| `audio:waveform` | Rust → HUD | `{ levels: [f32; 6] }` | 波形频率资料推送 |

**Pinia Store Action 命名：**
- CRUD：`addXxx()`, `removeXxx()`, `updateXxx()`, `fetchXxxList()`
- 查询：`getXxxById()`, `searchXxx()`
- 计算：`calculateDashboardStats()`

### Process Patterns

**错误处理标准流程：**

```typescript
// Service 层（lib/）— 抛出有意义的错误
async function enhanceText(text: string): Promise<string> {
  const response = await fetch(...);
  if (!response.ok) {
    throw new Error(`AI 整理失败：${response.status}`);
  }
  return result;
}

// Store 层 — catch + 状态更新 + 使用者提示
async function processTranscription() {
  try {
    const enhanced = await enhanceText(rawText);
  } catch (error) {
    // 降级：直接使用原始文字
    emit('voice-flow:state-changed', { status: 'success', message: '已贴上（未整理）' });
  }
}
```

**Loading 状态：**
- 每个 store 各自管理 `isLoading: boolean`
- 不使用全域 loading 状态
- HUD 的 loading 由 `voice-flow:state-changed` 事件驱动

### Enforcement Guidelines

**All AI Agents MUST：**

1. 严格遵循 CLAUDE.md 的命名规范（camelCase / PascalCase / UPPER_SNAKE_CASE / kebab-case）
2. 新增档案前确认目录归属（components/ vs views/ vs lib/ vs stores/）
3. SQLite 栏位使用 snake_case，TypeScript 介面使用 camelCase，在 store action 中做映射
4. Tauri Events 使用 `{domain}:{action}` kebab-case 命名
5. 错误处理遵循「Service 层抛出 → Store 层 catch + 降级」模式

## Project Structure & Boundaries

### FR Category → Architecture Mapping

| FR Category | FR 范围 | 架构元件 | 目录位置 |
|-------------|---------|---------|---------|
| 语音触发与录音 | FR1-5 | hotkey_listener.rs, audio_recorder.rs, useVoiceFlow.ts, useVoiceFlowStore.ts | plugins/, composables/, stores/ |
| 语音转文字 | FR6-7 | transcription.rs, useVoiceFlow.ts | plugins/, composables/ |
| AI 文字整理 | FR8-12 | enhancer.ts, useVoiceFlowStore.ts, useSettingsStore.ts | lib/, stores/ |
| 文字输出 | FR13-15 | clipboard_paste.rs, keyboard_monitor.rs | plugins/ |
| 自订词汇字典 | FR16-19 | useVocabularyStore.ts, DictionaryView.vue | stores/, views/ |
| 历史记录与统计 | FR20-25 | database.ts, useHistoryStore.ts, DashboardView.vue, HistoryView.vue | lib/, stores/, views/ |
| 状态回馈 HUD | FR26-29 | NotchHud.vue, useHudState.ts, App.vue | components/, composables/, src/ |
| 应用程式管理 | FR30-36 | lib.rs, useSettingsStore.ts, SettingsView.vue, updater.ts | src-tauri/src/, stores/, views/, lib/ |

**跨 FR 共用元件：**
- `useSettingsStore.ts` — 被 AI 整理、应用程式管理、词汇字典共用（API Key + Prompt + 快捷键）
- `database.ts` — 被历史记录、词汇字典共用（统一初始化 + migration）
- `useVoiceFlowStore.ts` — 串连语音触发、转文字、AI 整理、文字输出的完整流程
- Tauri Events — 跨 HUD / Main Window 同步所有状态变更

### Complete Project Directory Structure

```
sayit/
├── .github/
│   └── workflows/
│       └── build.yml                  # CI: 型别检查 + 建构测试
│
├── src/                                # ── Frontend (Vue 3 + TypeScript) ──
│   ├── components/                     # 共用 UI 元件
│   │   ├── NotchHud.vue               # HUD 6 态状态显示 [现有，扩展]
│   │   └── ui/                         # 通用 UI 原子元件
│   │       ├── AppButton.vue
│   │       ├── AppInput.vue
│   │       ├── AppModal.vue
│   │       └── AppToast.vue
│   │
│   ├── composables/                    # Vue composables
│   │   ├── useHudState.ts             # HUD 动画状态管理 [现有]
│   │   ├── useVoiceFlow.ts            # 录音→转录→AI整理流程 [现有，扩展]
│   │   └── useTauriEvents.ts          # Tauri Event 订阅/发送封装 [新增]
│   │
│   ├── lib/                            # Service 层（纯逻辑，无 Vue 依赖）
│   │   ├── enhancer.ts                # Groq LLM AI 文字整理 [新增]
│   │   ├── database.ts                # SQLite 初始化 + schema migration [新增]
│   │   └── updater.ts                 # tauri-plugin-updater 封装 [新增]
│   │   # recorder.ts — DELETED，迁移至 audio_recorder.rs（Rust cpal）
│   │   # transcriber.ts — DELETED，迁移至 transcription.rs（Rust reqwest）
│   │
│   ├── stores/                         # Pinia stores [新增目录]
│   │   ├── useSettingsStore.ts        # 快捷键 / API Key / AI Prompt
│   │   ├── useHistoryStore.ts         # 历史记录 CRUD + Dashboard 统计
│   │   ├── useVocabularyStore.ts      # 词汇字典 CRUD
│   │   └── useVoiceFlowStore.ts       # 录音/转录/AI 整理流程状态
│   │
│   ├── views/                          # Main Window 页面 [新增目录]
│   │   ├── DashboardView.vue          # 统计卡片 + 最近转录列表
│   │   ├── HistoryView.vue            # 历史记录搜寻与管理
│   │   ├── DictionaryView.vue         # 词汇字典 CRUD
│   │   └── SettingsView.vue           # 快捷键 / API Key / AI Prompt 设定
│   │
│   ├── types/                          # TypeScript 型别定义
│   │   ├── index.ts                   # 共用型别 [现有，扩展]
│   │   ├── transcription.ts           # TranscriptionRecord, DashboardStats
│   │   ├── vocabulary.ts              # VocabularyEntry
│   │   ├── settings.ts                # SettingsDto, HotkeyConfig
│   │   └── events.ts                  # Tauri Event payload 型别
│   │
│   ├── App.vue                         # HUD Window 入口 [现有]
│   ├── MainApp.vue                     # Main Window 入口 [新增]
│   ├── router.ts                       # Vue Router hash mode 设定 [新增]
│   ├── main.ts                         # HUD Window 启动脚本 [现有]
│   ├── main-window.ts                  # Main Window 启动脚本 [新增]
│   └── style.css                       # Tailwind 全域样式 [现有]
│
├── src-tauri/                          # ── Backend (Rust + Tauri v2) ──
│   ├── src/
│   │   ├── plugins/
│   │   │   ├── mod.rs                 # Plugin 统一汇出 [现有，扩展]
│   │   │   ├── hotkey_listener.rs     # OS-native 跨平台全域热键 [扩展重写]
│   │   │   ├── clipboard_paste.rs     # arboard + CGEvent Cmd+V（macOS）+ SendInput（Windows） [现有，扩展]
│   │   │   ├── keyboard_monitor.rs    # 贴上后键盘监控 [新增]
│   │   │   ├── audio_recorder.rs      # cpal 音讯录制 + WAV 编码 + FFT 波形 [新增]
│   │   │   └── transcription.rs       # Groq Whisper API via reqwest [新增]
│   │   ├── lib.rs                     # App 配置 + 双视窗 + Tray [现有，扩展]
│   │   └── main.rs                    # Rust 入口 [现有]
│   │
│   ├── Cargo.toml                     # Rust 依赖 [现有，扩展]
│   ├── tauri.conf.json                # Tauri 配置：双视窗 + CSP + 权限 [现有，扩展]
│   ├── capabilities/
│   │   └── default.json               # Tauri v2 capability 定义 [现有，扩展]
│   ├── icons/                          # App 图示 [现有]
│   └── build.rs                        # 建构脚本 [现有]
│
├── update-server/                      # ── 自动更新静态档案 ──（不进 App 建构）
│   ├── latest.json                    # 更新 endpoint JSON
│   └── README.md                      # 部署说明
│
├── package.json                        # pnpm 依赖 + scripts [现有，扩展]
├── pnpm-lock.yaml                     # 锁定档 [现有]
├── tsconfig.json                      # TypeScript 设定 [现有]
├── tsconfig.node.json                 # Node 型别设定 [现有]
├── vite.config.ts                     # Vite 建构设定 [现有]
├── tailwind.config.ts                 # Tailwind CSS 设定 [现有]
├── .gitignore                         # [现有]
├── .env.example                       # 环境变数范例（TAURI_SIGNING_PRIVATE_KEY）[新增]
└── README.md                          # [现有]
```

### Architectural Boundaries

**API Boundaries：**

- 外部 API 边界：仅 `api.groq.com`，CSP `connect-src 'self' https://api.groq.com` 硬限制
- 无后端 API server — App 是纯本地桌面应用
- 自动更新 endpoint：唯读 GET（latest.json + 安装包下载 URL）
- API Key 从 tauri-plugin-store 读取，不离开本地环境
- Timeout：Whisper 无特殊限制 / LLM 5 秒超时降级

**Component Boundaries：**

| 元件 | 职责 | 拥有的 Store | 不可触碰 |
|------|------|-------------|---------|
| HUD Window (App.vue) | 状态显示、录音触发 | useVoiceFlowStore, useHudState | database.ts（不直接操作 DB） |
| Main Window (MainApp.vue) | 使用者互动、资料管理 | useHistoryStore, useVocabularyStore, useSettingsStore, useVoiceFlowStore | — |
| lib/ Services | 纯逻辑执行（API 呼叫、DB 操作） | 无（被 store 呼叫） | Vue reactive API |
| Rust Plugins | 系统层操作（热键、剪贴簿、键盘） | 无 | 前端 UI 逻辑 |

- HUD Window：仅负责状态显示与录音触发，不做资料管理
- Main Window：负责所有使用者互动（设定、历史、词汇）
- lib/ 层：纯逻辑，两个视窗都可呼叫，但 database.ts 主要由 Main Window stores 使用
- composables/：Vue 生命周期相关逻辑，各视窗独立实例

**Rust ↔ WebView Boundaries：**

| 方向 | 机制 | 范例 |
|------|------|------|
| WebView → Rust | `invoke()` Tauri Command | `invoke('paste_text', { text })` |
| Rust → WebView | `emit()` / `emitTo()` | 热键按下事件、键盘监控结果 |
| Rust → Groq | Rust reqwest（Whisper API） | `transcription.rs`（音讯录制到转录全程 Rust） |
| WebView → Groq | 直接 HTTPS（LLM API，不经 Rust） | `enhancer.ts` |

**Tauri Commands（补充）：**

| Command | Rust 位置 | 参数 | 回传 | 用途 |
|---------|-----------|------|------|------|
| `save_recording_file` | `audio_recorder.rs` | `id: String` | `Result<String, String>`（档案路径） | 将 WAV 资料写入 `{APP_DATA}/recordings/{id}.wav` |
| `delete_all_recordings` | `audio_recorder.rs` | — | `Result<u32, String>`（删除数量） | 删除 recordings/ 目录下所有 WAV 档案 |
| `cleanup_old_recordings` | `audio_recorder.rs` | `days: u32` | `Result<u32, String>`（删除数量） | 删除超过指定天数的录音档 |

- `stop_recording` 回传型别 `StopRecordingResult` 包含 `peak_energy_level: f32`（峰值振幅）和 `rms_energy_level: f32`（均方根能量），两者合并为单次遍历计算。RMS 用于四层幻觉侦测的 Layer 3（背景噪音侦测）

**Data Boundaries：**

| 储存 | 内容 | 存取方式 | 存取者 |
|------|------|---------|--------|
| SQLite (app.db) | transcriptions, vocabulary, schema_version | tauri-plugin-sql 前端直接 SQL | Pinia store actions only |
| tauri-plugin-store (plaintext JSON) | groqApiKey, hotkeyConfig, aiPrompt, triggerMode | plugin-store API | useSettingsStore only |

- SQLite 与 Store 是独立的资料边界 — API Key 不进 SQLite
- SQLite 存取：只从 Pinia store actions 发起，不在 Vue components 直接操作
- Store 存取：只从 `useSettingsStore` 读写，其他 store 不直接碰 plugin-store

### Integration Points

**Internal Communication — 核心语音流程：**

```
User presses hotkey (Fn/右Alt)
    │
    ↓ OS-native event (CGEventTap / WH_KEYBOARD_LL)
hotkey_listener.rs ──→ Tauri Event: hotkey:pressed
    │
    ↓
useVoiceFlow.ts ──→ invoke('start_recording') → audio_recorder.rs (cpal)
    │                     │
    │                     ↓ (WAV 保存于 Rust state，不跨语言传递)
    │               invoke('transcribe_audio') → transcription.rs (Rust reqwest → Groq Whisper)
    │                     │
    │                     ↓ raw text
    │               enhancer.ts (Groq LLM, skip if < 10 chars)
    │                     │
    │                     ↓ processed text
    │               invoke('paste_text') ──→ clipboard_paste.rs
    │                     │
    │                     ↓
    │               Text appears at cursor position
    │
    ↓ voice-flow:state-changed events (每步)
NotchHud.vue (6-state display: idle→recording→transcribing→enhancing→success/error)
    │
    ↓ transcription:completed event
useHistoryStore (save to SQLite) ──→ Main Window Dashboard refresh
```

**External Integrations：**

| 外部服务 | 整合模组 | 协定 | 失败策略 |
|----------|----------|------|----------|
| Groq Whisper API | `transcription.rs` | Rust reqwest multipart | HUD 显示错误讯息，使用者可重试 |
| Groq LLM API | `enhancer.ts` | HTTPS POST JSON | 5 秒 timeout → 跳过 AI，贴上原始文字 |
| 自动更新 Endpoint | `updater.ts` | HTTPS GET JSON | 静默失败，下次启动再试 |

### File Organization Patterns

**Configuration Files：**
- 根目录：前端建构配置（`package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`）
- `src-tauri/`：Rust + Tauri 配置（`Cargo.toml`, `tauri.conf.json`, `capabilities/`）
- `.env.example`：记录需要的环境变数（`TAURI_SIGNING_PRIVATE_KEY`），不含实际值
- `.gitignore`：排除 `target/`, `dist/`, `node_modules/`, `.env`

**Source Organization：**
- 严格按「职责」分资料夹：`lib/`（纯逻辑）→ `stores/`（状态管理）→ `composables/`（Vue 逻辑）→ `views/`（页面）→ `components/`（元件）
- 依赖方向单向：`views → components + stores + composables`，`stores → lib`，`lib → 外部 API`
- 禁止 `views/` 直接呼叫 `lib/`，必须透过 store

**Test Organization：**
- MVP 阶段以手动测试为主，不在 Phase 1 建立测试框架
- 目录结构预留供 Phase 2 加入

**Asset Organization：**
- App 图示 + Tray 图示：`src-tauri/icons/`
- 前端静态资源（如有）：`public/`

### Development Workflow Integration

**Development Server：**
```bash
pnpm tauri dev    # 同时启动 Vite dev server + Rust 编译
                   # HUD Window: localhost:1420
                   # Main Window: localhost:1420/main.html
```

**Build Process：**
```bash
pnpm tauri build  # 1. Vite 打包前端 → dist/
                   # 2. Cargo 编译 Rust → target/release/
                   # 3. Tauri bundler 产出安装包
                   # 环境变数: TAURI_SIGNING_PRIVATE_KEY（自动更新签署）
```

**Deployment：**
- macOS 产出：`target/release/bundle/dmg/*.dmg`
- Windows 产出：`target/release/bundle/msi/*.msi`
- Signatures：`*.sig`（配对签署档）
- 部署步骤：`cargo tauri build` → 上传安装包 + .sig → 更新 `update-server/latest.json`

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility：**
- Tauri v2.10.x 与所有 Tauri plugins（sql 2.3.1, autostart 2.5.1, updater ~2.2.0, store ~2.x）版本相容
- Vue 3.5.29 + Pinia 3.x + Vue Router 5.0.3 生态相容
- arboard 3.6.1 为独立 Rust crate，无冲突（enigo 已移除，rdev 改用 OS-native API 取代）
- Groq API 分层呼叫：Whisper 走 Rust（reqwest）、LLM 走前端（plugin-http），CSP 白名单仍需保留 `https://api.groq.com`
- cpal 0.15 + hound 3.5 + rustfft 6 + reqwest 0.12 为独立 Rust crate，与现有依赖无冲突
- tauri-plugin-store 本地储存与 SQLite 资料层分离，职责清晰

**Pattern Consistency：**
- 命名惯例在所有层级一致：Rust snake_case → TS camelCase → Vue PascalCase
- SQLite snake_case → TS camelCase 映射规则统一在 store actions 处理
- Tauri Events `{domain}:{action}` kebab-case 命名一致
- 错误处理模式「Service 抛出 → Store catch + 降级」全架构统一

**Structure Alignment：**
- 专案目录结构完整支援所有架构决策
- 双视窗架构有清楚的 boundary 定义
- 依赖方向单向：views → stores → lib → 外部 API

### Requirements Coverage Validation ✅

**Functional Requirements（36/36 covered）：**

| FR | 需求 | 架构支援 |
|----|------|---------|
| FR1-5 | 语音触发与录音 | hotkey_listener.rs (OS-native) + audio_recorder.rs (cpal) + useVoiceFlow.ts |
| FR6-7 | 语音转文字 | transcription.rs (Rust reqwest → Groq Whisper API + 词汇 prompt 注入) |
| FR8-12 | AI 文字整理 | enhancer.ts (Groq LLM) + useSettingsStore (prompt) + 词汇/剪贴簿上下文注入 |
| FR13-15 | 文字输出 | clipboard_paste.rs (arboard + CGEvent Cmd+V / SendInput) + keyboard_monitor.rs |
| FR16-19 | 自订词汇字典 | useVocabularyStore + DictionaryView.vue + SQLite vocabulary table |
| FR20-25 | 历史记录与统计 | useHistoryStore + DashboardView.vue + HistoryView.vue + SQLite transcriptions table |
| FR26-29 | 状态回馈 HUD | NotchHud.vue (6-state) + useHudState.ts + voice-flow:state-changed events |
| FR30-36 | 应用程式管理 | SettingsView.vue + useSettingsStore + lib.rs + updater.ts + tauri-plugin-autostart |

**Non-Functional Requirements（全部 covered）：**

| NFR | 目标 | 架构支援 |
|-----|------|---------|
| E2E < 3s | 含 AI 整理 | 非同步 API 呼叫，HUD 动画不阻塞 |
| E2E < 1.5s | 跳过 AI | 字数 < 10 门槛分支 |
| LLM timeout 5s | fallback 原始文字 | enhancer.ts timeout + 降级策略 |
| Memory < 100MB | idle 状态 | 轻量 Tauri + WebView 架构 |
| HUD < 100ms | 状态转换 | Tauri Events 驱动，非轮询 |
| SQLite < 200ms | 查询回应 | 索引 idx_transcriptions_timestamp, idx_transcriptions_created_at |
| API Key 安全 | 不外泄至日志或网路 | tauri-plugin-store 本地储存（明文 JSON，OS 档案权限保护） |
| 资料本地 | 不上传第三方 | SQLite 本地 + HTTPS 仅至 Groq |
| 可用率 > 99% | 排除网路问题 | 错误隔离，API 失败不影响 App |
| WAL 模式 | 写入安全 | SQLite WAL mode |

### Implementation Readiness Validation ✅

**Decision Completeness：** 6 个架构决策全部附带版本号、理由、具体实作方式
**Structure Completeness：** 完整档案树，每个档案标注 [现有] / [新增] / [重写]
**Pattern Completeness：** 5 大 pattern 类别、18 个冲突点全部定义

### Gap Analysis Results

| 优先级 | Gap | 状态 |
|--------|-----|------|
| Critical | tauri-plugin-store 漏列 V2 新依赖 | ✅ 已修正 — 新增至 Rust + JS 依赖列表 |
| Important | Step 6 FR 编号范围与 PRD 不符 | ✅ 已修正 — 对齐 PRD FR1-36 编号 |
| Nice-to-have | FR12 剪贴簿上下文注入的具体流程 | 延至实作阶段 Story 中处理 |

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] 专案上下文彻底分析
- [x] 规模与复杂度评估
- [x] 技术约束识别
- [x] 跨切面关注点映射

**✅ Architectural Decisions**
- [x] 6 个关键决策附版本号
- [x] 技术栈完整指定
- [x] 整合模式定义
- [x] 效能考量处理

**✅ Implementation Patterns**
- [x] 命名惯例建立
- [x] 结构模式定义
- [x] 通讯模式指定
- [x] 流程模式文件化

**✅ Project Structure**
- [x] 完整目录结构定义
- [x] 元件边界建立
- [x] 整合点映射
- [x] 需求到结构映射完成

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths：**
1. Brownfield 优势 — POC 已验证核心技术可行性，V2 是扩展而非推翻
2. 极简架构 — 单一外部 API 提供商（Groq），无微服务，无后端 server
3. 清晰的边界定义 — 双视窗职责分明，依赖方向单向
4. 完整的降级策略 — LLM 超时自动 fallback，不影响核心体验

**Areas for Future Enhancement：**
- Phase 2 的测试框架选型（目前 MVP 手动测试）
- CI/CD pipeline 的具体设定（目前只有 build.yml 占位）
- FR12 剪贴簿上下文注入的实作细节

### Implementation Handoff

**AI Agent Guidelines：**
- 遵循架构文件中所有决策
- 一致使用命名惯例和实作模式
- 尊重专案结构和边界
- 所有架构相关问题参照本文件

**First Implementation Priority：**
1. 新增 SQLite 基础架构 + 扩展 OS-native 热键（Layer 0）
2. 建立 Pinia stores + 双视窗架构
3. 依 PRD 建议开发顺序推进
