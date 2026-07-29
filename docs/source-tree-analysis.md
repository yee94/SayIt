# Source Tree Analysis

> 由 BMad Document Project 工作流自动产生
> 扫描层级：**Exhaustive** · 扫描日期：2026-05-08 · 专案版本：0.9.5

本文件以「两个 part」为视角注解 SayIt 的原始码结构：

- **frontend** — `src/`（Vue 3 + Tauri JS API）
- **backend** — `src-tauri/`（Tauri v2 Rust runtime）

---

## 一、顶层结构（Repository Root）

```
say-it/
├── src/                    # Frontend part — Vue 3 + TS（双视窗）
├── src-tauri/              # Backend part — Tauri v2 Rust runtime
├── tests/                  # 跨端测试（unit / component / e2e）
├── scripts/                # 发版脚本
│   └── release.sh          #   版本同步 + commit + tag + push
├── assets/                 # 共用静态资源
├── _bmad/                  # BMad framework（不入版本记录）
├── _bmad-output/           # BMad 规划 / 实作 / 测试产出物
│   ├── project-context.md  #   AI Agent 必读规则
│   ├── planning-artifacts/ #   PRD / Architecture / UX-UI Spec
│   ├── implementation-artifacts/  # Story / Tech Spec
│   └── test-artifacts/     #   测试框架文件
├── docs/                   # ← 本次扫描产出
├── .github/workflows/      # CI/CD
│   ├── ci.yml              #   PR/push 检查
│   ├── release.yml         #   tag → 品质门禁 + 无开发者认证的多平台建构
│   ├── claude.yml          #   Claude Code GitHub Actions
│   └── claude-code-review.yml
├── .claude/                # Claude Code skills + hooks 设定
├── design.pen              # 可选的历史 UI 设计稿参考
├── CLAUDE.md               # Claude Code 专案记忆档
├── CHANGELOG.md
├── README.md
├── package.json            # pnpm@10.28.2 / type=module
├── pnpm-lock.yaml          # 🔴 受 protect-config.sh hook 保护
├── pnpm-workspace.yaml
├── vite.config.ts          # 多入口（HUD + Dashboard）
├── vitest.config.ts        # jsdom 环境
├── playwright.config.ts
├── eslint.config.js
├── tsconfig.json           # strict mode
├── components.json         # shadcn-vue 配置（new-york style）
├── index.html              # HUD 入口
├── main-window.html        # Dashboard 入口
└── .nvmrc                  # 锁定 Node 24
```

> **入口点关键**：HUD 与 Dashboard 是两个独立 HTML 入口，各自有独立 Vite entry，编译成两个 bundle 由 Tauri 载入到不同 `WebviewWindow`。

---

## 二、Frontend 结构（`src/`）

### 2.1 双入口档案

| 路径                          | LOC | 职责                                                                                                |
| ----------------------------- | --: | --------------------------------------------------------------------------------------------------- |
| `src/main.ts`                 |  22 | **HUD 入口** — 载入 `App.vue`，初始化 Sentry HUD（无 tracing）、Pinia、i18n                         |
| `src/main-window.ts`          | 103 | **Dashboard 入口** — 载入 `MainApp.vue`，初始化 DB（migration v1→v8）、Sentry Dashboard、router、autostart、自动清理录音档 |
| `src/App.vue`                 |   – | HUD root component（浏海状态浮窗）                                                                  |
| `src/MainApp.vue`             |   – | Dashboard root component（含 Sidebar、Sidebar Footer 的「检查更新」按钮）                           |
| `src/router.ts`               |  20 | 5 routes：`/dashboard` `/history` `/dictionary` `/settings` `/guide`，使用 `createWebHashHistory()` |

### 2.2 Stores（Pinia · `src/stores/`）

| 档案                          | LOC  | 范畴                                                                                                              |
| ----------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------- |
| `useVoiceFlowStore.ts`        | 1871 | **核心状态机** — 录音→转录→AI 整理→贴上的完整 voice flow，协调所有 Tauri Command + Event |
| `useSettingsStore.ts`         | 1395 | API Key / 热键 / 模型 / 音讯装置 / 自动更新等所有设定（单一来源），含 `settings:updated` 广播 |
| `useHistoryStore.ts`          |  580 | 转录历史 CRUD（SQLite `transcriptions` 表）                                                                       |
| `useVocabularyStore.ts`       |  200 | 字典 CRUD + 广播 `vocabulary:changed` / `vocabulary:learned`                                                      |

### 2.3 Composables（`src/composables/`）

| 档案                       | LOC | 职责                                                       |
| -------------------------- | --: | ---------------------------------------------------------- |
| `useTauriEvents.ts`        |  27 | **唯一 Event API 入口** — 所有事件常数集中于此（避免散落） |
| `useAudioPreview.ts`       |  82 | 设定页面音量条（订阅 `audio:preview-level`）              |
| `useAudioWaveform.ts`      |  84 | HUD 波形动画（订阅 `audio:waveform`）                     |
| `useFeedbackMessage.ts`    |  29 | UI 讯息提示                                                |

### 2.4 Lib（无框架逻辑 · `src/lib/`）

| 档案                          | LOC | 职责                                                                                                |
| ----------------------------- | --: | --------------------------------------------------------------------------------------------------- |
| `database.ts`                 | 492 | SQLite 连线池（HUD 与 Dashboard 共用）+ migration v1→v8                                             |
| `enhancer.ts`                 | 168 | LLM 文字整理（口语→书面语）                                                                         |
| `vocabularyAnalyzer.ts`       | 160 | LLM 智慧字典学习                                                                                    |
| `hallucinationDetector.ts`    | 139 | Whisper 幻觉侦测 v3                                                                                 |
| `errorUtils.ts`               | 139 | 错误讯息正规化                                                                                      |
| `keycodeMap.ts`               | 568 | 跨平台键码对应（macOS / Windows）                                                                  |
| `llmProvider.ts`              | 368 | **多 Provider 抽象层** — Groq / Gemini / OpenAI / Anthropic 统一 fetch / parse                     |
| `modelRegistry.ts`            | 254 | LLM + Whisper 模型清单、预设值、下架迁移（`DECOMMISSIONED_MODEL_MAP`）                              |
| `sentry.ts`                   |  83 | 双视窗各自初始化（`initSentryForHud` / `initSentryForDashboard`）+ `captureError` 统一入口          |
| `autoUpdater.ts`              |  76 | 自动更新检查（5 秒首次 + 4 小时间隔）                                                               |
| `formatUtils.ts`              |  68 | 时间 / 字数 / 大小格式化                                                                            |
| `apiPricing.ts`               |  39 | API 成本估算                                                                                        |
| `utils.ts`                    |   7 | shadcn-vue `cn()` helper                                                                            |

### 2.5 Views（`src/views/`）

| 档案                       | LOC  | 路由         | 职责                                                |
| -------------------------- | ---: | ------------ | --------------------------------------------------- |
| `SettingsView.vue`         | 1907 | `/settings`  | API Key / 模型 / 热键 / 音讯装置 / 进阶设定         |
| `HistoryView.vue`          |  379 | `/history`   | 转录历史浏览 / 搜寻 / 复制 / 重新转录 / 音讯播放    |
| `DashboardView.vue`        |  309 | `/dashboard` | 统计卡片 + 使用量图表 + 近期转录                    |
| `DictionaryView.vue`       |  281 | `/dictionary`| 字典 CRUD（手动 + AI 学习）                         |
| `FeatureGuideView.vue`     |   56 | `/guide`     | 功能导览                                            |

### 2.6 Components（`src/components/`）

| 档案                       | LOC | 类别                                              |
| -------------------------- | --: | ------------------------------------------------- |
| `NotchHud.vue`             | 861 | **HUD 主元件** — 状态切换、波形、字典学到提示 |
| `AccessibilityGuide.vue`   | 191 | macOS 辅助使用权限引导                            |
| `AppSidebar.vue`           | 177 | Dashboard 侧边栏（shadcn-vue Sidebar）            |
| `NavUser.vue`              | 114 | 侧边栏底部使用者区块                              |
| `SectionCards.vue`         | 106 | Dashboard 统计卡片                                |
| `NavDocuments.vue`         |  91 | 侧边栏文件区                                      |
| `DashboardUsageChart.vue`  |  89 | unovis 统计图表                                   |
| `NavMain.vue`              |  57 | 侧边栏主导航                                      |
| `NavSecondary.vue`         |  41 | 侧边栏次要导航                                    |
| `SiteHeader.vue`           |  15 | Dashboard 顶部                                    |
| `ui/`                      |   – | shadcn-vue 元件库（21 种，禁止改动样式）          |

### 2.7 i18n（`src/i18n/`）

```
src/i18n/
├── index.ts            # i18n 初始化
├── languageConfig.ts   # 语系列表、预设语系（zh-CN / en / ja / ko）
├── prompts.ts          # 各 LLM 提示词（依语系切换）
└── locales/
    ├── en.json
    ├── zh-CN.json     # 预设（简体中文）
    ├── ja.json
    └── ko.json
```

### 2.8 Types（`src/types/`）

| 档案                  | 命名后缀               | 范畴                                  |
| --------------------- | ---------------------- | ------------------------------------- |
| `index.ts`            | `*Status`, `*State`    | HUD 状态列举                          |
| `events.ts`           | `*Payload`             | Tauri Event payload 介面              |
| `transcription.ts`    | `*Record`              | SQLite `transcriptions` 表型别        |
| `vocabulary.ts`       | `*Record`, `*Entry`    | 字典型别                              |
| `audio.ts`            | `*Handle`, `*Config`   | 音讯处理型别                          |
| `settings.ts`         | `*Config`              | 设定物件型别                          |

---

## 三、Backend 结构（`src-tauri/`）

```
src-tauri/
├── Cargo.toml                    # 🟡 受 protect-config.sh 警告
├── Cargo.lock                    # 🔴 受 protect-config.sh 阻挡
├── tauri.conf.json               # 🟡 视窗设定 / CSP / Bundle / Updater
├── Entitlements.plist            # macOS 权限（accessibility, audio-input）
├── Info.plist                    # macOS Bundle metadata
├── build.rs                      # tauri-build
├── capabilities/
│   └── default.json              # Tauri v2 permission system（HTTP allowlist）
├── icons/                        # 跨平台图示（macOS .icns / Windows .ico / iOS / Android）
├── resources/sounds/             # start.wav / stop.wav（录音回馈音）
└── src/
    ├── main.rs                   # 5 行 — 直接呼叫 sayit_lib::run()
    ├── lib.rs                    # 892 行 — 主 entry + invoke handler 注册 + tray + graceful shutdown
    └── plugins/
        ├── mod.rs                # 8 行 — 模组宣告
        ├── hotkey_listener.rs    # 1571 行 — 全域热键（CGEventTap / Win32 Hook）
        ├── audio_recorder.rs     # 1116 行 — cpal 录音 + WAV 写档 + 波形 FFT
        ├── keyboard_monitor.rs   #  629 行 — 品质监测 + 矫正监测
        ├── clipboard_paste.rs    #  483 行 — Cmd+V / Ctrl+V 模拟贴上
        ├── audio_control.rs      #  447 行 — 系统音量 mute / restore
        ├── transcription.rs      #  324 行 — Groq Whisper API（Rust 直呼）
        ├── text_field_reader.rs  #  325 行 — AX API 读取游标文字
        └── sound_feedback.rs     #  206 行 — start/stop/error/learned 音效
```

### 3.1 Backend 模组责任分布

| 模组                  | 平台特化                                          | 对外契约                                                      |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `hotkey_listener`     | macOS：CGEventTap；Windows：SetWindowsHookEx      | 8 个 Command + 8 个 Event（pressed/released/toggled/error...） |
| `audio_recorder`      | cpal 跨平台 + macOS Arc cycle workaround          | 11 个 Command + 2 个 Event（waveform / preview-level）        |
| `keyboard_monitor`    | macOS：CGEventTap                                 | 2 个 Command + 2 个 Event（quality / correction）             |
| `clipboard_paste`     | macOS：CGEvent；Windows：SendInput                | 3 个 Command                                                  |
| `audio_control`       | macOS：CoreAudio FFI；Windows：IAudioEndpointVolume | 2 个 Command                                                  |
| `transcription`       | 跨平台 reqwest                                    | 2 个 Command（含 retranscribe_from_file）                     |
| `text_field_reader`   | macOS：AX API                                     | 2 个 Command                                                  |
| `sound_feedback`      | 跨平台 cpal                                       | 4 个 Command                                                  |

### 3.2 lib.rs 的关键函式

| 函式                                | 用途                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `run()`                             | Tauri Builder 主入口（含 plugin 注册、tray、setup、shutdown）                                  |
| `configure_macos_notch_window()`    | macOS：用 `objc::msg_send` 设定 NSWindow level=27 + collectionBehavior（浏海覆盖层）           |
| `configure_windows_topmost_window()`| Windows：HWND_TOPMOST + WS_EX_TOOLWINDOW + WS_EX_NOACTIVATE                                    |
| `find_monitor_for_cursor()`         | 纯函式，11 个单元测试（含 Retina + portrait + dual-DPI fallback）                              |
| `calculate_centered_window_x_logical()` | logical 座标置中（绕过 tao cross-DPI bug）                                                  |
| `request_app_restart()` + `RunEvent::Exit` | 用 `_exit(0)` 截杀 Tauri 内建 restart 后自行 spawn — 确保 graceful shutdown 顺序          |

---

## 四、Tests 结构（`tests/`）

```
tests/
├── README.md         # 测试总览
├── unit/             # Vitest unit
├── component/        # @vue/test-utils
├── e2e/              # Playwright
└── support/          # 共用 fixture / helper
```

> Rust 单元测试内嵌于 `src-tauri/src/**/*.rs` 的 `#[cfg(test)] mod tests`，例如 `lib.rs` 末段有 17 个 `find_monitor_for_cursor` / `calculate_centered_window_x*` 测试。

---

## 五、Hooks 与保护档案

`.claude/settings.json` 设定四个 PostToolUse / PreToolUse hooks：

| Hook                  | 触发             | 行为                                                          |
| --------------------- | ---------------- | ------------------------------------------------------------- |
| `protect-config.sh`   | PreToolUse Edit  | 🔴 `Cargo.lock` / `pnpm-lock.yaml` 禁改；🟡 `tauri.conf.json` / `Cargo.toml` 警告 |
| `typecheck.sh`        | PostToolUse Edit | `.ts/.vue` 改动后跑 `vue-tsc --noEmit`（非阻断）              |
| `rustfmt.sh`          | PostToolUse Edit | `.rs` 改动后跑 `rustfmt`                                      |
| `eslint.sh`           | PostToolUse Edit | `.ts/.vue` 改动后 `eslint --fix`（跳过 `components/ui/`）     |

---

## 六、关键交互点（为 PRD 提供导引）

1. **「录音 → 转录 → 整理 → 贴上」流程的中枢** = `useVoiceFlowStore.ts`（1871 行）— 修改录音流程必先读此档。
2. **「设定」全部入口** = `useSettingsStore.ts`（1395 行）+ `SettingsView.vue`（1907 行）— 新增任何设定栏位需同步两处。
3. **「IPC 契约」唯一定义处** = `lib.rs` 的 `invoke_handler!` macro + `useTauriEvents.ts` 常数 — 新增 Command / Event 必须两端对齐（用 `tauri-reviewer` subagent 审查）。
4. **「DB Schema」单一来源** = `src/lib/database.ts` 的 migration 链（v1→v8）— 加栏位请追加 v9，不要直接改旧 migration。
5. **「LLM Provider」抽象边界** = `src/lib/llmProvider.ts` — 新增 provider 在此扩展即可，业务层（`enhancer.ts` / `vocabularyAnalyzer.ts`）不需改。
