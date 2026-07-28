# Story 1.1: V2 基础架构与双视窗设置

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发者,
I want V2 所需的基础架构（依赖、资料库、状态管理、双视窗、路由）全部就绪,
So that 后续所有功能开发都能在稳定的架构基础上进行。

## Acceptance Criteria

1. **Rust 依赖安装** — Cargo.toml 包含所有 V2 新增依赖（rdev 0.5.3, tauri-plugin-sql 2.3.1, tauri-plugin-autostart 2.5.1, tauri-plugin-updater ~2.2.0, tauri-plugin-store ~2.4）且 `cargo check` 通过。tauri.conf.json plugins 区块正确注册所有新 plugin。

2. **JS 依赖安装** — package.json 包含所有 V2 新增依赖（vue-router 5.0.3, pinia 3.x, @tauri-apps/plugin-sql, @tauri-apps/plugin-autostart, @tauri-apps/plugin-updater, @tauri-apps/plugin-store）且 `pnpm install` 无错误。

3. **SQLite 初始化** — App 启动时执行 database.ts 初始化逻辑，在 App Data 目录建立 SQLite 资料库，包含 transcriptions、vocabulary、schema_version 三张表，使用 WAL 模式，schema_version 记录版本号。

4. **Pinia Stores 骨架** — 四个 store 档案存在于 src/stores/（useSettingsStore, useHistoryStore, useVocabularyStore, useVoiceFlowStore），每个使用 defineStore 正确定义，Pinia 在 main.ts 和 main-window.ts 中正确初始化。

5. **双视窗配置** — tauri.conf.json 定义 HUD Window（维持现有配置）+ Main Window（标准视窗，从 main-window.html 载入）。Vite 配置新增 main-window.html 作为额外入口点。

6. **Main Window 档案建立** — MainApp.vue 包含左侧 Sidebar 导航（Dashboard / 历史 / 字典 / 设定）与右侧内容区域。Vue Router hash mode 配置四个路由（/dashboard, /history, /dictionary, /settings）。每个 View 元件存在作为空白占位。

7. **Tauri Events 封装** — useTauriEvents.ts 提供 emitToWindow / listenToEvent 封装方法，事件命名遵循 {domain}:{action} kebab-case。

## Tasks / Subtasks

- [x] Task 1: 安装 V2 Rust 依赖 (AC: #1)
  - [x] 1.1 在 Cargo.toml 新增 rdev = "0.5.3"
  - [x] 1.2 在 Cargo.toml 新增 tauri-plugin-sql = { version = "2.3.1", features = ["sqlite"] }
  - [x] 1.3 在 Cargo.toml 新增 tauri-plugin-autostart = "2.5.1"
  - [x] 1.4 在 Cargo.toml 新增 tauri-plugin-updater = "~2.2.0"
  - [x] 1.5 在 Cargo.toml 新增 tauri-plugin-store = "~2.4"
  - [x] 1.6 在 lib.rs 中注册所有新 plugin（.plugin(tauri_plugin_sql::Builder::default().build()) 等）
  - [x] 1.7 在 tauri.conf.json plugins 区块新增需要配置的 plugin（注意：sql 和 store 使用 programmatic API 不需 conf 配置，autostart 需要配置 macOS launcher type）
  - [x] 1.8 在 capabilities/default.json：(a) 将 `"windows"` 改为 `["main", "main-window"]` 让两个视窗都有权限；(b) 新增权限：`"sql:default"`, `"store:default"`, `"core:event:allow-emit-to"`
  - [x] 1.9 执行 `cargo check` 确认编译通过

- [x] Task 2: 安装 V2 JS 依赖 (AC: #2)
  - [x] 2.1 `pnpm add vue-router@5.0.3 pinia@3`
  - [x] 2.2 `pnpm add @tauri-apps/plugin-sql @tauri-apps/plugin-autostart @tauri-apps/plugin-updater @tauri-apps/plugin-store`
  - [x] 2.3 确认 `pnpm install` 无错误、无 peer dependency 警告

- [x] Task 3: SQLite 资料库初始化 (AC: #3)
  - [x] 3.1 建立 src/lib/database.ts
  - [x] 3.2 实作 initializeDatabase() — 使用 @tauri-apps/plugin-sql 的 Database.load('sqlite:app.db')，使用 singleton pattern export db instance（`let db: Database | null = null`，initializeDatabase 回传已初始化的 instance，后续 import 使用 `getDatabase()` 取得）
  - [x] 3.3 连线后执行 `PRAGMA journal_mode = WAL;` 和 `PRAGMA synchronous = NORMAL;`
  - [x] 3.4 建立 transcriptions 表（完整 schema 见 Dev Notes）
  - [x] 3.5 建立 vocabulary 表
  - [x] 3.6 建立 schema_version 表并插入初始版本 1
  - [x] 3.7 建立索引 idx_transcriptions_timestamp 和 idx_transcriptions_created_at

- [x] Task 4: Pinia Stores 骨架 (AC: #4)
  - [x] 4.1 建立 src/stores/ 目录
  - [x] 4.2 建立 useSettingsStore.ts — state: hotkeyConfig (null), triggerMode ('hold'), hasApiKey (false), aiPrompt (''); actions: loadSettings(), saveSettings()
  - [x] 4.3 建立 useHistoryStore.ts — state: transcriptionList ([]), isLoading (false); actions: fetchTranscriptionList(), addTranscription(), calculateDashboardStats()
  - [x] 4.4 建立 useVocabularyStore.ts — state: termList ([]), isLoading (false); actions: fetchTermList(), addTerm(), removeTerm()
  - [x] 4.5 建立 useVoiceFlowStore.ts — state: status ('idle' as HudStatus), message (''); actions: transitionTo()
  - [x] 4.6 在 main.ts 初始化 Pinia：createPinia() + app.use(pinia)
  - [x] 4.7 在 main-window.ts 初始化 Pinia（与 main.ts 独立 instance）

- [x] Task 5: 双视窗配置 (AC: #5)
  - [x] 5.1 建立 main-window.html（专案根目录，参考 index.html 结构，挂载点 #app，script src 指向 src/main-window.ts）
  - [x] 5.2 在 tauri.conf.json app.windows 新增第二个视窗定义 label: "main-window"
  - [x] 5.3 在 vite.config.ts 的 build.rollupOptions.input 新增 main-window.html 入口
  - [x] 5.4 HUD Window（label: "main"）维持现有配置不变
  - [x] 5.5 Main Window 配置：visible: false（预设隐藏，由 Tray 开启）、decorations: true、resizable: true、width: 960、height: 680、title: "SayIt - Dashboard"（与 HUD 区分）

- [x] Task 6: Main Window 入口与路由 (AC: #6)
  - [x] 6.1 建立 src/main-window.ts — `import './style.css'` + `await initializeDatabase()` + createApp(MainApp) + use(pinia) + use(router) + mount('#app')。注意：必须 import style.css 否则无 Tailwind 样式；必须在 mount 前呼叫 initializeDatabase() 确保 SQLite 就绪
  - [x] 6.2 建立 src/MainApp.vue — 左侧 Sidebar 导航 + 右侧 <router-view>
  - [x] 6.3 建立 src/router.ts — createRouter hash mode，四个路由定义 + `{ path: '/', redirect: '/dashboard' }` 作为预设路由
  - [x] 6.4 建立 src/views/DashboardView.vue（空白占位，标题 "Dashboard"）
  - [x] 6.5 建立 src/views/HistoryView.vue（空白占位）
  - [x] 6.6 建立 src/views/DictionaryView.vue（空白占位）
  - [x] 6.7 建立 src/views/SettingsView.vue（空白占位）
  - [x] 6.8 Sidebar 使用 Tailwind CSS，包含 App 名称/Logo + 四个导航项目 + active 状态高亮

- [x] Task 7: Tauri Events 跨视窗通讯封装 (AC: #7)
  - [x] 7.1 建立 src/composables/useTauriEvents.ts
  - [x] 7.2 Re-export Tauri `emitTo` 为 `emitToWindow`，保留原始 Tauri API 签名
  - [x] 7.3 Re-export Tauri `listen` 为 `listenToEvent`，保留原始 Tauri API 签名（handler 接收 `Event<T>`，消费者透过 `event.payload` 取值）
  - [x] 7.4 定义事件常数：VOICE_FLOW_STATE_CHANGED, TRANSCRIPTION_COMPLETED, SETTINGS_UPDATED, VOCABULARY_CHANGED

- [x] Task 8: 型别定义扩展 (AC: #4, #7)
  - [x] 8.1 扩展 src/types/index.ts — 新增 'enhancing' 到 HudStatus union type
  - [x] 8.2 建立 src/types/transcription.ts — TranscriptionRecord, DashboardStats 介面
  - [x] 8.3 建立 src/types/vocabulary.ts — VocabularyEntry 介面
  - [x] 8.4 建立 src/types/settings.ts — SettingsDto, HotkeyConfig 介面
  - [x] 8.5 建立 src/types/events.ts — Tauri Event payload 型别定义

- [x] Task 9: 整合验证 (AC: #1-7)
  - [x] 9.1 `cargo check` 通过
  - [x] 9.2 Vite build 通过，双入口打包成功（runtime 验证需 GUI 环境手动执行 `pnpm tauri dev`）
  - [x] 9.3 HUD Window 配置未被修改，行为不受影响
  - [x] 9.4 Main Window 配置完成，Sidebar + Router 就绪（runtime 验证需手动）
  - [x] 9.5 SQLite 初始化逻辑完整（runtime 验证需手动）
  - [x] 9.6 Pinia stores 在两个入口各自独立初始化

## Dev Notes

### 架构模式与约束

**这是 Brownfield 专案** — 基于已完成的 POC 扩展，不需要 `npm init` 或 `cargo init`。所有修改都是在现有结构上新增。

**依赖方向规则（严格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```
禁止 views/ 直接呼叫 lib/，必须透过 store。

**错误处理模式：**
- Service 层（lib/）抛出有意义错误
- Store 层 catch + 降级 + 使用者提示
- 不建立统一错误码系统

### SQLite Schema（必须完全按照此 schema 建立）

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
  was_modified INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp ON transcriptions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at);

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

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
```

### Pinia Store 定义规则

- Store ID 使用 kebab-case：`defineStore('settings', ...)`、`defineStore('history', ...)`
- 每个 store 各自管理 `isLoading: boolean`，不使用全域 loading
- CRUD action 命名：`addXxx()`, `removeXxx()`, `updateXxx()`, `fetchXxxList()`
- 查询命名：`getXxxById()`, `searchXxx()`
- 计算命名：`calculateDashboardStats()`
- SQLite snake_case → TypeScript camelCase 映射在 store action 中处理

### 双视窗架构细节

**HUD Window (label: "main")** — 维持现有配置：
- 置顶、透明、不可互动、400×100px、y=0
- 载入 index.html → main.ts → App.vue

**Main Window (label: "main-window")** — 新增：
- 标准视窗、960×680px、预设隐藏
- 载入 main-window.html → main-window.ts → MainApp.vue
- 配置：`{ visible: false, decorations: true, resizable: true, center: true, title: "SayIt - Dashboard" }`

**Vite 多入口配置：**
```typescript
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      'main-window': resolve(__dirname, 'main-window.html'),
    },
  },
}
```

**tauri.conf.json 第二视窗定义：**
```json
{
  "label": "main-window",
  "title": "SayIt - Dashboard",
  "url": "main-window.html",
  "width": 960,
  "height": 680,
  "visible": false,
  "decorations": true,
  "resizable": true,
  "center": true,
  "minWidth": 720,
  "minHeight": 480
}
```

### Tauri Events 命名规范

事件名必须遵循 `{domain}:{action}` kebab-case：

| Event Name | Direction | Payload |
|------------|-----------|---------|
| `voice-flow:state-changed` | HUD ← VoiceFlow | `{ status, message }` |
| `transcription:completed` | → Main Window | `{ id, rawText, processedText, ... }` |
| `settings:updated` | → All Windows | `{ key, value }` |
| `vocabulary:changed` | → All Windows | `{ action, term }` |

### tauri-plugin-sql WAL Mode 启用方式

tauri-plugin-sql **不内建 WAL mode 设定**。必须在连线后手动执行：

```typescript
import Database from '@tauri-apps/plugin-sql';

const db = await Database.load('sqlite:app.db');
await db.execute('PRAGMA journal_mode = WAL;');
await db.execute('PRAGMA synchronous = NORMAL;');
```

### Plugin 注册顺序（lib.rs）

在 `tauri::Builder::default()` 链中注册：

```rust
.plugin(tauri_plugin_sql::Builder::default().build())
.plugin(tauri_plugin_store::Builder::default().build())
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent, None
))
.plugin(tauri_plugin_updater::Builder::new().build())
```

### 命名规范速查

| 类型 | 惯例 | 范例 |
|------|------|------|
| Rust functions | snake_case | `paste_text()`, `listen_hotkey()` |
| Rust types | PascalCase | `TranscriptionRecord`, `HotkeyConfig` |
| TS variables/functions | camelCase | `addTranscription()`, `enhancedText` |
| TS types/interfaces | PascalCase + 后缀 | `SettingsDto`, `VoiceFlowState` |
| TS boolean | is/has/can/should | `isRecording`, `wasEnhanced`, `hasApiKey` |
| TS constants | UPPER_SNAKE_CASE | `DEFAULT_PROMPT`, `API_TIMEOUT_MS` |
| Vue components | PascalCase | `NotchHud.vue`, `DashboardView.vue` |
| Pinia store files | camelCase | `useSettingsStore.ts` |
| Pinia store ID | kebab-case | `defineStore('settings', ...)` |
| Tauri events | {domain}:{action} kebab | `voice-flow:state-changed` |
| SQLite columns | snake_case | `raw_text`, `recording_duration_ms` |
| Folders | kebab-case | `src/stores/`, `src/views/` |

### Project Structure Notes

**新增档案清单（本 Story 产出）：**
```
src/
├── stores/                    [新增目录]
│   ├── useSettingsStore.ts   [新增]
│   ├── useHistoryStore.ts    [新增]
│   ├── useVocabularyStore.ts [新增]
│   └── useVoiceFlowStore.ts  [新增]
├── views/                     [新增目录]
│   ├── DashboardView.vue     [新增 - 空白占位]
│   ├── HistoryView.vue       [新增 - 空白占位]
│   ├── DictionaryView.vue    [新增 - 空白占位]
│   └── SettingsView.vue      [新增 - 空白占位]
├── composables/
│   └── useTauriEvents.ts     [新增]
├── lib/
│   └── database.ts           [新增]
├── types/
│   ├── index.ts              [修改 - 新增 'enhancing' 状态]
│   ├── transcription.ts      [新增]
│   ├── vocabulary.ts         [新增]
│   ├── settings.ts           [新增]
│   └── events.ts             [新增]
├── MainApp.vue               [新增]
├── main-window.ts            [新增]
└── router.ts                 [新增]

根目录/
└── main-window.html          [新增]
```

**修改档案清单：**
```
src/main.ts                   [修改 - 新增 Pinia 初始化]
src/types/index.ts            [修改 - HudStatus 新增 'enhancing']
src-tauri/Cargo.toml          [修改 - 新增 5 个依赖]
src-tauri/tauri.conf.json     [修改 - 新增 Main Window + plugins]
src-tauri/src/lib.rs          [修改 - 注册新 plugins]
src-tauri/capabilities/default.json [修改 - 新增 plugin 权限]
vite.config.ts                [修改 - 多入口配置]
package.json                  [修改 - 自动由 pnpm add 更新]
```

### 已知冲突与现有程式码

- **useVoiceFlow.ts** 目前直接管理 HUD 状态，V2 计画将此逻辑迁移至 useVoiceFlowStore。本 Story 只建立 store 骨架，不迁移现有逻辑（迁移在 Story 1.4 进行）。
- **main.ts** 目前是 `createApp(App).mount('#app')` 三行。本 Story 需新增 Pinia 初始化但不应破坏现有 HUD 行为。
- **App.vue** 不修改 — HUD Window 的行为保持不变。
- **transcriber.ts** 目前使用 `import.meta.env.VITE_GROQ_API_KEY` 读取 API Key。本 Story 不修改此行为（API Key 储存方式迁移在 Story 1.3 进行）。

### 技术版本确认（2026-03-01 最新）

| 技术 | 目标版本 | 最新稳定版 | 备注 |
|------|---------|-----------|------|
| rdev | 0.5.3 | 0.5.3 | 最新版，但维护者声明长期未维护。macOS 需 Accessibility 权限 |
| tauri-plugin-sql | 2.3.1 | 2.3.1 | WAL mode 需手动 PRAGMA |
| tauri-plugin-store | ~2.x | 2.4.2 | 明文 JSON 储存（已确认可接受，内部工具） |
| tauri-plugin-autostart | 2.5.1 | 2.5.1 | — |
| tauri-plugin-updater | ~2.2.0 | ~2.2.0 | — |
| vue-router | 5.0.3 | 5.0.3 | 从 v4 无 breaking changes |
| pinia | 3.x | 3.0.4 | 从 v2 几乎零改动，需用 `defineStore('name', ...)` 语法 |

### 跨 Story 警告

- **tauri-plugin-store 明文储存（已决策）** — 架构文件中「tauri-plugin-store 加密储存 API Key」描述不准确，实际上 plugin-store 以明文 JSON 储存。经 Jackle 确认：内部工具风险可接受，Story 1.3 继续使用 tauri-plugin-store 明文储存 API Key。
- **rdev 维护风险** — rdev maintainer 承认长期未维护，有 45 个未解决 issue。若 macOS/Windows 行为不一致，Story 1.2 可能需要 fallback 方案。

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions — Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Naming Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Desktop App Specific Requirements]
- [Source: Web Research — tauri-plugin-store docs.rs, tauri-plugin-sql WAL issue #2328, Pinia migration guide v2→v3]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- `cargo check` 通过，仅有既存 warnings（objc macro cfg, dead_code）
- `vue-tsc --noEmit` 仅有既存 `import.meta.env` 型别错误（transcriber.ts:17），无新增错误
- `vite build` 成功，双入口（index.html + main-window.html）打包完成

### Completion Notes List

- ✅ Task 1: Cargo.toml 新增 5 个 Rust 依赖 + lib.rs 注册 4 个 plugin + capabilities 扩展权限
- ✅ Task 2: pnpm 安装 vue-router 5.0.3, pinia 3.0.4, 四个 @tauri-apps/plugin-* 套件
- ✅ Task 3: database.ts 实作 singleton pattern + WAL mode + 3 tables + 2 indexes
- ✅ Task 4: 四个 Pinia store 骨架建立，main.ts 加入 Pinia 初始化
- ✅ Task 5: main-window.html 建立，tauri.conf.json 双视窗配置，vite.config.ts 多入口
- ✅ Task 6: main-window.ts 入口、MainApp.vue Sidebar、router.ts hash mode、四个 View 占位
- ✅ Task 7: useTauriEvents.ts 封装 emitToWindow/listenToEvent + 四个事件常数
- ✅ Task 8: HudStatus 新增 'enhancing'，四个新型别档案（transcription/vocabulary/settings/events）
- ✅ Task 9: cargo check ✓、vite build ✓、vue-tsc 无新错误 ✓
- ⚠️ 既存问题：transcriber.ts 缺少 vite/client 型别宣告导致 import.meta.env 报错（非本 Story 范围）

### Change Log

- 2026-03-01: Story 1.1 完整实作 — V2 基础架构（依赖、SQLite、Pinia、双视窗、路由、事件系统、型别）

### File List

**新增档案：**
- main-window.html
- src/main-window.ts
- src/MainApp.vue
- src/router.ts
- src/lib/database.ts
- src/stores/useSettingsStore.ts
- src/stores/useHistoryStore.ts
- src/stores/useVocabularyStore.ts
- src/stores/useVoiceFlowStore.ts
- src/views/DashboardView.vue
- src/views/HistoryView.vue
- src/views/DictionaryView.vue
- src/views/SettingsView.vue
- src/composables/useTauriEvents.ts
- src/types/transcription.ts
- src/types/vocabulary.ts
- src/types/settings.ts
- src/types/events.ts

**修改档案：**
- src/main.ts — 新增 Pinia 初始化
- src/types/index.ts — HudStatus 新增 'enhancing'
- src-tauri/Cargo.toml — 新增 5 个 Rust 依赖
- src-tauri/src/lib.rs — 注册 4 个新 plugin
- src-tauri/tauri.conf.json — 新增 Main Window 定义
- src-tauri/capabilities/default.json — 扩展 windows 和新增 plugin 权限
- vite.config.ts — 新增多入口 rollup 配置
- package.json — 新增 JS 依赖（由 pnpm add 自动更新）
- pnpm-lock.yaml — 锁定档更新
