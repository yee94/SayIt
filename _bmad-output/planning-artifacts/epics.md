---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
workflowStatus: complete
completedAt: 2026-03-01
inputDocuments:
  - prd.md
  - architecture.md
  - product-brief-SayIt-2026-02-28.md
  - voice-transcription-poc-spec.md
---

# SayIt - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for SayIt, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**语音触发与录音**
- FR1: 使用者可透过全域快捷键触发录音，不需切换至 App 视窗
- FR2: 使用者可自选触发用的修饰键（macOS: Fn/Option/Ctrl/Cmd/Shift；Windows: 右Alt/左Alt/Ctrl/Shift）
- FR3: 使用者可选择 Hold 模式（按住录音，放开停止）或 Toggle 模式（按一下开始，再按一下停止）
- FR4: 系统在使用者触发录音时透过麦克风撷取音讯
- FR5: 系统在录音结束后将音讯封装为 API 可接受的格式

**语音转文字**
- FR6: 系统可将录音音讯送至 Groq Whisper API 取得简体中文转录结果
- FR7: 系统可将自订词汇清单注入 Whisper API prompt 参数以提升专有名词辨识率

**AI 文字整理**
- FR8: 系统可将转录结果送至 Groq LLM 进行口语→书面语整理（去赘词、重组句构、修正标点、适当分段）
- FR9: 系统在转录字数低于门槛（约 10 字）时跳过 AI 整理，直接输出原始转录
- FR10: 使用者可编辑 AI 整理使用的 prompt
- FR11: 使用者可将 prompt 重置为预设值
- FR12: 系统可将剪贴簿内容与自订词汇清单作为上下文注入 AI 整理请求

**文字输出**
- FR13: 系统可将最终文字（转录或 AI 整理后）自动贴入当前游标所在的任何应用程式
- FR14: 系统透过剪贴簿写入 + 模拟键盘贴上实现全域文字输出
- FR15: 系统可在贴上后监控使用者键盘输入行为，判断输出是否被修改以衡量品质

**自订词汇字典**
- FR16: 使用者可新增自订词汇（专案名、人名、技术术语）
- FR17: 使用者可删除已建立的自订词汇
- FR18: 使用者可浏览完整的自订词汇清单
- FR19: 系统可将词汇清单同时注入 Whisper API 与 AI 整理上下文

**历史记录与统计**
- FR20: 系统在每次成功转录后自动记录完整资料（原始文字、整理后文字、录音时长、API 回应时长、字数、触发模式、是否经 AI 整理）
- FR21: 使用者可浏览历史转录记录列表
- FR22: 使用者可搜寻历史记录（全文搜寻）
- FR23: 使用者可复制历史记录中的文字
- FR24: 使用者可在 Dashboard 查看统计指标（总口述时间、口述字数、平均口述速度、节省时间、使用次数、AI 整理使用率）
- FR25: 使用者可在 Dashboard 查看最近转录摘要列表

**状态回馈（HUD）**
- FR26: 系统在各阶段透过 Notch-style HUD 显示目前状态（idle → recording → transcribing → enhancing → success/error → idle）
- FR27: 系统在 success 状态短暂显示后自动收起 HUD
- FR28: 系统在 API 请求失败时透过 HUD 显示清晰的错误讯息
- FR29: 系统在 Groq API 逾时时直接贴上原始转录文字跳过 AI 整理

**应用程式管理**
- FR30: 使用者可在设定页面配置快捷键（触发键选择 + 触发模式）
- FR31: 使用者可在设定页面输入/修改 Groq API Key
- FR32: 系统常驻 System Tray，使用者可从 Tray 开启主视窗
- FR33: 系统支援开机自启动，使用者可在设定中关闭
- FR34: 系统支援自动更新，启动时检查并背景下载更新
- FR35: 系统在 macOS 首次启动时引导使用者授权 Accessibility 权限
- FR36: 系统在首次录音时触发麦克风权限请求

### NonFunctional Requirements

**效能**
- NFR1: 端到端延迟（含 AI 整理）< 3 秒（从放开按键到文字出现在游标位置）
- NFR2: 端到端延迟（跳过 AI）< 1.5 秒（短文直接贴上场景）
- NFR3: Groq API timeout 5 秒，超时 fallback 至原始转录文字
- NFR4: 常驻记忆体占用 < 100 MB（idle 状态下）
- NFR5: HUD 状态转换 < 100 ms（动画流畅，无视觉延迟）
- NFR6: App 启动时间 < 3 秒（从开机自启动到 System Tray 就绪）
- NFR7: SQLite 查询回应 < 200 ms（历史搜寻、Dashboard 统计计算）

**安全**
- NFR8: API Key 使用 tauri-plugin-store 储存于 App Data 目录（明文 JSON），不暴露于日志或网路，安全依赖 OS 档案系统权限
- NFR9: 转录资料仅存于本地 SQLite，不上传至任何第三方服务
- NFR10: 所有 Groq API 请求透过 HTTPS
- NFR11: 剪贴簿内容作为 AI 上下文注入时，仅传送至使用者自行配置的 Groq API

**整合**
- NFR12: Groq Whisper API 依赖网路，无离线替代，失败时 HUD 显示错误，使用者可重试
- NFR13: Groq LLM API 依赖网路，有 timeout 降级，5 秒逾时则跳过 AI 整理，直接贴上原始转录
- NFR14: 作业系统剪贴簿系统层级高可靠，失败视为系统错误
- NFR15: 作业系统键盘模拟需权限，macOS 需 Accessibility 授权，未授权时引导

**可靠性**
- NFR16: 系统可用率 > 99%（排除网路问题），App 本身不 crash、不冻结
- NFR17: 历史记录零遗失，SQLite WAL 模式确保写入安全
- NFR18: API 失败不影响 App 稳定性，回到 idle 状态，可立即重试
- NFR19: 自动更新失败不影响现有功能，背景下载，使用者确认后安装

### Additional Requirements

**来自架构文件：**
- Brownfield 专案：基于已完成 POC 扩展，不需专案初始化。第一个实作 Story 应新增 SQLite 基础架构 + 扩展 OS-native 热键监听
- 双视窗架构：HUD Window（App.vue）+ Main Window（MainApp.vue），需在 tauri.conf.json 定义
- Tauri Events 跨视窗同步：使用 `emitTo(windowLabel, event, payload)` 跨视窗广播关键状态变更
- 前端直接 SQL：tauri-plugin-sql 前端直接执行 SQL，资料存取逻辑集中在 Pinia stores 的 actions 中
- API Key 储存：tauri-plugin-store 本地储存（明文 JSON），不整合 OS 原生 Keychain，安全依赖 OS 档案系统权限
- 前端直接呼叫 Groq API：transcriber.ts + enhancer.ts 直接呼叫，CSP 限制 connect-src 至 self + https://api.groq.com
- 错误处理模式：Service 层抛出有意义错误 → Store 层 catch + 降级 + 使用者提示
- SQLite Schema：transcriptions / vocabulary / schema_version 三张表，WAL 模式
- 自动更新：tauri-plugin-updater + 自订 endpoint（静态 JSON + 档案托管）
- V2 新依赖（Rust）：tauri-plugin-sql 2.3.1, tauri-plugin-autostart 2.5.1, tauri-plugin-updater ~2.2.0, tauri-plugin-store ~2.x（rdev 已取消，改用 OS-native API；enigo 已移除）
- V2 新依赖（JS）：vue-router 5.0.3, pinia 3.x, @tauri-apps/plugin-sql, @tauri-apps/plugin-autostart, @tauri-apps/plugin-updater, @tauri-apps/plugin-store
- 命名规范：Rust snake_case / TS camelCase / Vue PascalCase / SQLite snake_case / Tauri Events {domain}:{action} kebab-case
- 专案结构：lib/（纯逻辑）→ stores/（状态管理）→ composables/（Vue 逻辑）→ views/（页面）→ components/（元件），依赖方向单向
- 实作顺序建议：SQLite 初始化 → Pinia stores → 双视窗架构 → Tauri Events → API Key 储存 → Groq LLM → 自动更新

**来自 POC 规格书：**
- 现有 POC 元件可沿用：recorder.ts、transcriber.ts、clipboard_paste.rs、NotchHud.vue、useHudState.ts、useVoiceFlow.ts
- 现有 POC 元件需扩展重写：fn_key_listener.rs → hotkey_listener.rs（CGEventTap 扩展多键 + Windows SetWindowsHookExW）
- 现有 POC 元件需扩展：NotchHud.vue（3态→6态）、useVoiceFlow.ts（新增 AI 整理步骤）、transcriber.ts（词汇注入）

### FR Coverage Map

- FR1: Epic 1 — 全域快捷键触发录音
- FR2: Epic 1 — 自选修饰键（macOS/Windows）
- FR3: Epic 1 — Hold/Toggle 双触发模式
- FR4: Epic 1 — 麦克风音讯撷取
- FR5: Epic 1 — 音讯封装为 API 格式
- FR6: Epic 1 — Groq Whisper API 转录
- FR7: Epic 3 — 词汇注入 Whisper prompt
- FR8: Epic 2 — Groq LLM 口语→书面语整理
- FR9: Epic 2 — 字数门槛跳过 AI 整理
- FR10: Epic 2 — 编辑 AI 整理 prompt
- FR11: Epic 2 — 重置 prompt 为预设值
- FR12: Epic 2 — 剪贴簿+词汇上下文注入 AI
- FR13: Epic 1 — 文字自动贴入任何应用程式
- FR14: Epic 1 — 剪贴簿写入+模拟贴上
- FR15: Epic 2 — 贴上后键盘监控（品质衡量）
- FR16: Epic 3 — 新增自订词汇
- FR17: Epic 3 — 删除自订词汇
- FR18: Epic 3 — 浏览词汇清单
- FR19: Epic 3 — 词汇注入 Whisper+AI 上下文
- FR20: Epic 4 — 自动记录转录完整资料
- FR21: Epic 4 — 浏览历史记录列表
- FR22: Epic 4 — 搜寻历史记录
- FR23: Epic 4 — 复制历史记录文字
- FR24: Epic 4 — Dashboard 统计指标
- FR25: Epic 4 — Dashboard 最近转录摘要
- FR26: Epic 1 — HUD 状态显示（基本 4 态：recording/transcribing/success/error）
- FR27: Epic 1 — success 状态自动收起 HUD
- FR28: Epic 1 — API 失败 HUD 错误讯息
- FR29: Epic 2 — Groq API 逾时 fallback 原始文字
- FR30: Epic 5 — 设定页面配置快捷键
- FR31: Epic 1 — 设定页面输入/修改 API Key
- FR32: Epic 1 — System Tray 常驻 + 开启主视窗
- FR33: Epic 5 — 开机自启动
- FR34: Epic 5 — 自动更新
- FR35: Epic 1 — macOS Accessibility 权限引导
- FR36: Epic 1 — 首次录音麦克风权限
- FR37: Epic 4 — 录音永久储存与播放
- FR38: Epic 2 — Whisper 幻觉侦测与自动学习
- FR39: Epic 5 — 幻觉词库管理 UI + 录音清理设定

## Epic List

### Epic 1: 跨平台语音输入基础
使用者在 macOS 和 Windows 上按住可配置的热键，说话后文字自动贴入游标位置，HUD 显示即时状态回馈。包含 V2 基础架构建设（OS-native 热键、SQLite、Pinia、双视窗、tauri-plugin-store）及 Onboarding 体验（API Key 输入、权限引导）。
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR13, FR14, FR26, FR27, FR28, FR31, FR32, FR35, FR36

### Epic 2: AI 文字智慧整理
转录结果自动经 Groq LLM 从口语转为通顺的书面语，短文智慧跳过，逾时优雅降级至原始文字。使用者可自订 prompt 控制整理行为，系统注入剪贴簿与词汇作为上下文。HUD 新增 enhancing 状态。贴上后键盘监控衡量输出品质。系统自动侦测并拦截 Whisper 幻觉文字，透过语速异常侦测、noSpeechProbability 门槛与幻觉词库三层架构判定，支援自动学习。Whisper prompt 加入双语提示以改善中英混讲辨识品质，AI 整理 prompt 增加语言混淆修正指令。
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR15, FR29, FR38

### Epic 3: 自订词汇字典
使用者维护个人词汇库（专案名、人名、技术术语），词汇同时注入 Whisper API prompt 提升辨识率，以及 AI 整理上下文确保正确用词。提供 CRUD UI 管理词汇。
**FRs covered:** FR7, FR16, FR17, FR18, FR19

### Epic 4: 历史记录与 Dashboard
系统自动记录每次成功转录的完整资料，使用者可浏览、搜寻、复制历史记录。Dashboard 显示使用统计（总口述时间、字数、速度、节省时间、使用次数、AI 使用率）与最近转录摘要。每次录音 WAV 档案永久储存至本地磁碟，使用者可在历史记录中播放录音。转录失败时可一键重送录音给 Whisper（限一次）。失败的转录也记录至历史。
**FRs covered:** FR20, FR21, FR22, FR23, FR24, FR25, FR37

### Epic 5: 应用程式设定与生命周期管理
使用者可在完整设定页面配置快捷键（触发键选择+触发模式），应用程式支援开机自启动（可关闭）和自动更新（背景下载+提示安装）。设定页面新增幻觉词库管理区块与录音档清理设定。
**FRs covered:** FR30, FR33, FR34, FR39

**Infrastructure Notes (from Story 1.1 code review):**

- **必须加入 `autostart:default` 和 `updater:default` 权限至 capabilities** — Story 1.1 已在 lib.rs 注册 plugin，但 capabilities/default.json 尚未包含前端权限，需在对应 Story 中补上
- **考虑拆分 capability 档案** — 目前 HUD Window 和 Main Window 共用同一份 capabilities（包含 sql:default、store:default），但 HUD 不应有 DB 权限。建议建立 `hud.json` 和 `dashboard.json` 分别授权，符合最小权限原则

---

## Epic 1: 跨平台语音输入基础

使用者在 macOS 和 Windows 上按住可配置的热键，说话后文字自动贴入游标位置，HUD 显示即时状态回馈。包含 V2 基础架构建设（OS-native 热键、SQLite、Pinia、双视窗、tauri-plugin-store）及 Onboarding 体验（API Key 输入、权限引导）。

### Story 1.1: V2 基础架构与双视窗设置

As a 开发者,
I want V2 所需的基础架构（依赖、资料库、状态管理、双视窗、路由）全部就绪,
So that 后续所有功能开发都能在稳定的架构基础上进行。

**Acceptance Criteria:**

**Given** 现有 POC 专案结构
**When** 安装所有 V2 新增的 Rust 依赖（tauri-plugin-sql 2.3.1, tauri-plugin-autostart 2.5.1, tauri-plugin-updater ~2.2.0, tauri-plugin-store ~2.x）
**Then** Cargo.toml 包含所有新依赖且 `cargo check` 通过
**And** tauri.conf.json 中的 plugins 区块正确注册所有新 plugin

**Given** 现有 POC 专案结构
**When** 安装所有 V2 新增的 JS 依赖（vue-router 5.0.3, pinia 3.x, @tauri-apps/plugin-sql, @tauri-apps/plugin-autostart, @tauri-apps/plugin-updater, @tauri-apps/plugin-store）
**Then** package.json 包含所有新依赖且 `pnpm install` 无错误

**Given** V2 依赖已安装
**When** App 启动时执行 database.ts 的初始化逻辑
**Then** SQLite 资料库在 App Data 目录建立，包含 transcriptions、vocabulary、schema_version 三张表
**And** SQLite 使用 WAL 模式
**And** schema_version 表记录当前版本号

**Given** V2 依赖已安装
**When** 建立 Pinia stores 骨架（useSettingsStore, useHistoryStore, useVocabularyStore, useVoiceFlowStore）
**Then** 每个 store 档案存在于 src/stores/ 目录
**And** 每个 store 使用 defineStore 正确定义
**And** Pinia 在 main.ts 和 main-window.ts 中正确初始化

**Given** V2 依赖已安装
**When** 配置 tauri.conf.json 支援双视窗（HUD Window + Main Window）
**Then** HUD Window 维持现有配置（置顶、透明、不可互动）
**And** Main Window 配置为标准视窗，从 main-window.html 载入
**And** Vite 配置新增 main-window.html 作为额外入口点

**Given** 双视窗配置完成
**When** 建立 Main Window 相关档案（MainApp.vue, main-window.ts, router.ts）
**Then** MainApp.vue 包含左侧 Sidebar 导航（Dashboard / 历史 / 字典 / 设定）与右侧内容区域
**And** Vue Router 使用 hash mode 配置四个路由（/dashboard, /history, /dictionary, /settings）
**And** 每个路由对应的 View 元件存在（DashboardView, HistoryView, DictionaryView, SettingsView）作为空白占位

**Given** 双视窗配置完成
**When** 建立 Tauri Events 跨视窗通讯封装（useTauriEvents.ts）
**Then** Re-export Tauri `emitTo` 为 `emitToWindow`，保留原始 Tauri API 签名
**And** Re-export Tauri `listen` 为 `listenToEvent`，保留原始 Tauri API 签名
**And** 定义事件常数，命名遵循 {domain}:{action} kebab-case 规范

### Story 1.2: 跨平台全域热键系统（OS-native）

As a 使用者,
I want 透过可配置的全域热键触发语音录音，在 macOS 和 Windows 上都能使用,
So that 我不需要切换到 App 视窗就能随时启动语音输入。

**Acceptance Criteria:**

**Given** OS 原生 API 可用（macOS CGEventTap / Windows SetWindowsHookExW）
**When** 重写 hotkey_listener.rs 使用 OS 原生 API（扩展现有 CGEventTap + 新增 Windows WH_KEYBOARD_LL）
**Then** 在 macOS 上可监听 Fn、Option、Control、Command、Shift 键事件
**And** 在 Windows 上可监听右 Alt、左 Alt、Control、Shift 键事件
**And** 预设触发键：macOS 为 Fn，Windows 为右 Alt

**Given** hotkey_listener.rs 使用 OS 原生 API 实作
**When** 使用者在 Hold 模式下按住触发键
**Then** 系统发送 `hotkey:pressed` Tauri Event 至 WebView
**And** 使用者放开触发键时发送 `hotkey:released` Tauri Event
**And** 事件 payload 包含 `{ mode: 'hold', action: 'start' | 'stop' }`

**Given** hotkey_listener.rs 使用 OS 原生 API 实作
**When** 使用者在 Toggle 模式下按一下触发键
**Then** 系统发送 `hotkey:toggled` Tauri Event，payload 为 `{ mode: 'toggle', action: 'start' }`
**And** 再次按一下触发键时发送 `{ mode: 'toggle', action: 'stop' }`

**Given** 热键系统运作中
**When** 使用者透过 useSettingsStore 变更触发键或触发模式
**Then** hotkey_listener 即时切换为新的触发键和模式
**And** 无需重启 App

**Given** 热键系统运作中
**When** App 在背景执行（非前景视窗）
**Then** 全域热键仍可正常触发
**And** 不干扰其他应用程式的正常键盘操作

**Given** 自订模式的按键录制
**When** 使用者按住 modifier(s) + 按一个普通键
**Then** 系统记录 `{ modifiers: [...], keycode }` 组合
**And** 设定 UI 显示组合键名称（如「Ctrl + Space」）

**Given** 组合键已设定
**When** 使用者在任何应用程式按下相同组合
**Then** macOS 透过 CGEventFlags 验证 modifier 状态 + keycode 匹配
**And** Windows 透过 GetKeyState() 验证 modifier 状态 + VK code 匹配
**And** Hold/Toggle 模式正常运作

**Given** 旧版本使用者升级
**When** 载入旧的 `Custom { keycode }` 设定
**Then** 自动解析为 `{ modifiers: [], keycode }`（向后相容）

### Story 1.3: API Key 安全储存与 System Tray 整合

As a 使用者,
I want 安全地储存我的 Groq API Key 并从 System Tray 开启主视窗,
So that 我的 API Key 不会外泄，且能方便地存取 App 设定。

**Acceptance Criteria:**

**Given** tauri-plugin-store 已安装
**When** 使用者在 SettingsView 的 API Key 输入框中输入 API Key 并储存
**Then** API Key 透过 tauri-plugin-store 储存于本地 App Data 目录
**And** API Key 不存入 SQLite 资料库
**And** 输入框以密码模式显示（遮罩）
**And** useSettingsStore 更新 hasApiKey 状态

**Given** API Key 已储存
**When** App 启动或其他模组需要 API Key
**Then** 可从 tauri-plugin-store 读取已储存的 API Key
**And** API Key 仅在记忆体中供 transcriber.ts 和 enhancer.ts 使用

**Given** App 正在执行
**When** 使用者透过 System Tray 右键选单选择「开启 Dashboard」
**Then** Main Window 开启并显示 Dashboard 页面
**And** 若 Main Window 已开启，则将其带至前景

**Given** App 首次启动且无 API Key
**When** App 启动完成
**Then** 自动开启 Main Window 并导向 Settings 页面的 API Key 区块
**And** 显示提示讯息引导使用者输入 API Key

**Given** System Tray 选单
**When** 使用者右键点击 System Tray 图示
**Then** 显示选单项目：「开启 Dashboard」、「结束」
**And** 选择「开启 Dashboard」开启 Main Window
**And** 选择「结束」关闭 App

### Story 1.4: 语音录音→转录→贴上完整流程

As a 使用者,
I want 按住热键说话后，语音自动转为文字并贴入游标位置,
So that 我能在任何应用程式中用语音取代打字。

**Acceptance Criteria:**

**Given** API Key 已设定且热键系统运作中
**When** 使用者按住触发键（Hold 模式）
**Then** 系统透过 `navigator.mediaDevices.getUserMedia()` 开始麦克风录音
**And** useVoiceFlowStore 状态更新为 'recording'
**And** 发送 `voice-flow:state-changed` 事件 `{ status: 'recording' }`

**Given** 录音进行中
**When** 使用者放开触发键
**Then** MediaRecorder 停止录音并产生音讯 blob
**And** 音讯封装为 Groq Whisper API 可接受的格式（multipart/form-data）
**And** useVoiceFlowStore 状态更新为 'transcribing'
**And** 发送 `voice-flow:state-changed` 事件 `{ status: 'transcribing' }`

**Given** 音讯已录制完成
**When** 系统将音讯送至 Groq Whisper API（model: whisper-large-v3, language: zh）
**Then** 取得简体中文转录结果
**And** API 请求透过 HTTPS 传送
**And** API Key 从 useSettingsStore 取得

**Given** 转录结果已取得
**When** 系统呼叫 `invoke('paste_text', { text })` 将文字贴入
**Then** clipboard_paste.rs 将文字写入系统剪贴簿
**And** 模拟 Cmd+V（macOS）或 Ctrl+V（Windows）执行贴上
**And** 文字出现在当前游标所在的应用程式中
**And** useVoiceFlowStore 状态更新为 'success'

**Given** Toggle 模式启用
**When** 使用者按一下触发键开始录音，再按一下停止
**Then** 录音→转录→贴上流程与 Hold 模式相同
**And** 流程正确完成

**Given** Groq Whisper API 请求失败（网路断线、API 错误等）
**When** API 回应非 200 或网路超时
**Then** useVoiceFlowStore 状态更新为 'error'
**And** 发送 `voice-flow:state-changed` 事件 `{ status: 'error', message: '人类可读错误讯息' }`
**And** 不执行贴上动作
**And** App 回到 idle 状态，可立即重试

**Migration Notes (from Story 1.1 implementation):**

- **必须迁移 `useVoiceFlow.ts` → `useVoiceFlowStore`** — 现有 composable 直接管理 HUD 状态，1.4 需将录音/转录/贴上流程改为透过 Pinia store 驱动
- **必须迁移 `useHudState.ts` auto-hide timer 逻辑至 store 或保留为 HUD-only composable** — `useHudState.transitionTo` 含 success/error 自动收起计时器和 showHud/hideHud 副作用，需决定这些逻辑归 store 还是留在 HUD Window 的 composable
- **必须统一 `TranscriptionResult` → `TranscriptionRecord`** — POC 的 `TranscriptionResult`（text + duration）应被 V2 的 `TranscriptionRecord` 取代，`transcriber.ts` 回传型别需同步更新
- **清理旧 composables** — 迁移完成后移除或重构 `useVoiceFlow.ts`、`useHudState.ts` 中被 store 取代的逻辑

### Story 1.5: HUD 状态显示与权限引导

As a 使用者,
I want 在语音输入过程中看到清晰的状态回馈，并在首次使用时顺利完成权限设定,
So that 我随时知道系统在做什么，且不会因权限问题卡住。

**Acceptance Criteria:**

**Given** 使用者触发录音
**When** useVoiceFlowStore 状态为 'recording'
**Then** NotchHud.vue 显示录音状态（红点脉冲动画 + 「录音中...」文字）
**And** HUD 从 idle 展开至录音状态的动画 < 100ms

**Given** 录音结束，开始转录
**When** useVoiceFlowStore 状态为 'transcribing'
**Then** NotchHud.vue 显示转录状态（loading spinner + 「转录中...」文字）
**And** 状态转换动画流畅

**Given** 转录（或未来 AI 整理）完成
**When** useVoiceFlowStore 状态为 'success'
**Then** NotchHud.vue 显示成功状态（「已贴上 ✓」）
**And** 约 0.8~1.2 秒后自动收起回 idle
**And** 收起动画流畅

**Given** API 请求失败
**When** useVoiceFlowStore 状态为 'error'
**Then** NotchHud.vue 显示错误状态（错误讯息文字）
**And** 错误讯息为人类可读格式（如「网路连线中断」「API 请求失败」）
**And** 约 2~3 秒后自动收起回 idle

**Given** macOS 平台首次启动 App
**When** App 侦测到尚未取得 Accessibility 权限
**Then** 显示引导画面说明为何需要此权限
**And** 提供按钮开启系统偏好设定的 Accessibility 面板
**And** 使用者授权后可正常使用热键

**Given** 任何平台首次触发录音
**When** 系统呼叫 `getUserMedia()` 请求麦克风权限
**Then** 作业系统显示麦克风权限请求对话框
**And** 使用者允许后开始录音
**And** 使用者拒绝后 HUD 显示错误讯息提示需要麦克风权限

---

## Epic 2: AI 文字智慧整理

转录结果自动经 Groq LLM 从口语转为通顺的书面语，短文智慧跳过，逾时优雅降级至原始文字。使用者可自订 prompt 控制整理行为，系统注入剪贴簿与词汇作为上下文。HUD 新增 enhancing 状态。贴上后键盘监控衡量输出品质。系统自动侦测并拦截 Whisper 幻觉文字，透过语速异常侦测、noSpeechProbability 门槛与幻觉词库三层架构判定，支援自动学习。Whisper prompt 加入双语提示以改善中英混讲辨识品质，AI 整理 prompt 增加语言混淆修正指令。

### Story 2.1: Groq LLM AI 文字整理核心流程

As a 使用者,
I want 语音转录结果自动经 AI 整理为通顺的书面语,
So that 我的语音输出可以直接使用，不需手动编辑口语赘词和标点。

**Acceptance Criteria:**

**Given** Epic 1 的语音转录流程已就绪
**When** 建立 enhancer.ts 模组
**Then** 模组可呼叫 Groq LLM API（chat/completions endpoint）
**And** 使用预设 system prompt 进行口语→书面语整理
**And** API Key 从 useSettingsStore 取得
**And** API 请求透过 HTTPS 传送

**Given** 转录结果文字长度 >= 10 字
**When** 转录完成后进入 AI 整理流程
**Then** useVoiceFlowStore 状态更新为 'enhancing'
**And** 发送 `voice-flow:state-changed` 事件 `{ status: 'enhancing' }`
**And** NotchHud.vue 显示「整理中...」状态（loading spinner）
**And** AI 整理完成后将整理后的文字贴入游标位置

**Given** 转录结果文字长度 < 10 字
**When** 转录完成
**Then** 跳过 AI 整理步骤
**And** 直接将原始转录文字贴入游标位置
**And** useVoiceFlowStore 状态直接从 'transcribing' 跳至 'success'

**Given** AI 整理 API 请求进行中
**When** 请求超过 5 秒未回应
**Then** 自动取消请求（timeout）
**And** 将原始转录文字贴入游标位置作为 fallback
**And** useVoiceFlowStore 状态更新为 'success'
**And** HUD 显示「已贴上（未整理）」

**Given** AI 整理 API 请求失败（非 timeout）
**When** API 回应非 200
**Then** 将原始转录文字贴入游标位置作为 fallback
**And** useVoiceFlowStore 状态更新为 'success'
**And** HUD 显示「已贴上（未整理）」

**Given** AI 整理完成
**When** 文字成功贴入
**Then** 端到端延迟（含 AI 整理）< 3 秒
**And** HUD 状态完整流程：idle → recording → transcribing → enhancing → success → idle

### Story 2.2: AI Prompt 自订与上下文注入

As a 使用者,
I want 自订 AI 整理的 prompt 并注入上下文资讯,
So that 我能控制 AI 的整理风格，且 AI 能根据当前情境做更好的整理。

**Acceptance Criteria:**

**Given** SettingsView 的 AI 区块
**When** 使用者开启设定页面
**Then** 显示 AI 整理 Prompt 多行文字编辑区域
**And** 预设填入预设 prompt（去口语、修标点、适当分段、保持原意）
**And** 使用者可自由编辑 prompt 内容

**Given** 使用者修改了 prompt
**When** 使用者储存变更
**Then** 新 prompt 透过 useSettingsStore 持久化至 tauri-plugin-store
**And** 后续的 AI 整理请求使用新 prompt

**Given** 使用者想恢复预设
**When** 点击「重置为预设」按钮
**Then** prompt 编辑区域恢复为预设 prompt 内容
**And** 自动储存至 tauri-plugin-store

**Given** AI 整理请求即将发送
**When** enhancer.ts 组装 API 请求
**Then** 将使用者当前剪贴簿内容作为 `<clipboard>` 标签注入 system prompt
**And** 若有自订词汇，将词汇清单作为 `<vocabulary>` 标签注入 system prompt
**And** 使用者自订的 prompt 作为主要 system prompt

**Given** 剪贴簿为空或词汇清单为空
**When** AI 整理请求发送
**Then** 对应的上下文标签不注入（不传空标签）
**And** AI 整理仍正常运作

**Given** Whisper API 请求即将发送
**When** `format_whisper_prompt()` 组装 prompt
**Then** 除字典词外，根据 `selectedTranscriptionLocale` 加入语言混合范例
**And** `zh` → 注入中英混合范例（如「部署 deploy, 测试 test, main.py」）
**And** `en` → 注入英中混合范例（如「deploy 部署, API endpoint」）
**And** `auto` → 注入最广泛的多语混合范例

**Given** AI 整理请求即将发送
**When** enhancer 组装 system prompt
**Then** 包含「修正语音辨识中明显的语言混淆，例如英文术语被转为中文谐音」指令

### Story 2.3: 贴上后品质监控

As a 使用者,
I want 系统追踪我是否修改了贴上的文字,
So that 我能透过统计数据了解 AI 整理的输出品质趋势。

**Acceptance Criteria:**

**Given** 文字已成功贴入游标位置
**When** 新增 keyboard_monitor.rs 模组（使用 OS-native API）
**Then** 模组在贴上完成后开始监听键盘事件
**And** 监听时间窗口为 5 秒

**Given** 贴上后监听期间
**When** 使用者在 5 秒内按下 Backspace 或 Delete 键
**Then** 判定此次输出「被修改」（wasModified = true）
**And** 透过 Tauri Event 将结果回传前端

**Given** 贴上后监听期间
**When** 5 秒内未侦测到 Backspace 或 Delete 键
**Then** 判定此次输出「未修改」（wasModified = false）
**And** 透过 Tauri Event 将结果回传前端

**Given** 品质监控结果回传
**When** useVoiceFlowStore 收到 wasModified 结果
**Then** 将结果附加至当前转录记录
**And** 供后续历史记录储存使用（Epic 4）

**Given** 使用者在其他应用程式中操作（非修改贴上的文字）
**When** 按下的 Backspace/Delete 与贴上目标不在同一焦点窗口
**Then** 仍记录为 wasModified = true（简单版不做焦点判断，接受误判）

### Story 2.4: Whisper 幻觉侦测与自动学习

> **注意**：此 Story 的验收条件已于 v0.8.7 大幅简化。幻觉字典（AC#2）和自动学习（AC#3）已移除，改为纯物理信号二层侦测。

As a 使用者,
I want 系统自动侦测并拦截 Whisper 幻觉文字,
So that 没讲话或很短停顿时不会有乱码被贴入编辑器。

**Acceptance Criteria:**

**Given** 转录结果回传
**When** 录音时长 < 1 秒且文字 > 10 字（语速异常）
**Then** 判定为幻觉，不贴上，HUD 显示「未侦测到语音」
**And** 该文字自动加入 `hallucination_terms` 表
**And** HUD 短暂通知「已学习幻觉词：{text}」

**Given** 转录结果回传
**When** noSpeechProbability > 0.9 且文字命中幻觉词库
**Then** 判定为幻觉，不贴上

**Given** 转录结果回传
**When** 两层弱可疑指标同时成立（noSpeechProb > 0.7 且语速偏高）
**Then** 判定为幻觉，不贴上

**Given** 转录结果回传
**When** 只有一层弱可疑
**Then** 放行，正常贴上

**Given** 转录语言设定为不同语言
**When** 幻觉侦测 Layer 3 载入内建词库
**Then** 根据 `selectedTranscriptionLocale` 载入对应语言的幻觉词库
**And** `zh` 载入中文幻觉词（「谢谢收看」「字幕组」等）
**And** `en` 载入英文幻觉词（「Thank you for watching」「Subscribe」等）
**And** `auto` 载入所有语言的幻觉词库

**Given** 幻觉词库页面（HallucinationView.vue）
**When** 使用者从侧边栏开启幻觉词库页面
**Then** 显示所有幻觉词（自动学习 + 手动新增）
**And** 使用者可手动新增/删除幻觉词

> **⚠️ 实作更新（2026-03-16）：** 幻觉侦测已升级为四层架构（v2）。主要变更：
> - 移除内建幻觉词库（`builtinHallucinationTerms.ts` 已删除），改为纯自动学习 + 手动新增
> - 新增 Layer 3 背景噪音侦测：Rust 端新增 `rms_energy_level` 计算，前端用 `rmsEnergyLevel`（极低 RMS < 0.008 直接拦截）和 `noSpeechProbability`（中低 RMS < 0.015 + NSP > 0.7 联合拦截）
> - 原 Layer 3 精确比对改为 Layer 4
> - 详见 `project-context.md` 的「幻觉侦测架构（v2）」段落

---

## Epic 3: 自订词汇字典

使用者维护个人词汇库（专案名、人名、技术术语），词汇同时注入 Whisper API prompt 提升辨识率，以及 AI 整理上下文确保正确用词。提供 CRUD UI 管理词汇。

### Story 3.1: 词汇字典 CRUD 介面

As a 使用者,
I want 管理我的个人词汇字典（新增、删除、浏览）,
So that 我能将常用的专有名词加入系统以提升辨识准确度。

**Acceptance Criteria:**

**Given** Main Window 的字典页面（DictionaryView.vue）
**When** 使用者开启字典页面
**Then** 显示完整的自订词汇清单（表格形式）
**And** 页面顶部显示词汇总数统计
**And** 清单为空时显示空状态提示（如「尚无自订词汇，新增常用术语以提升辨识率」）

**Given** 字典页面已开启
**When** 使用者在新增输入框中输入词汇并按下新增按钮（或 Enter）
**Then** useVocabularyStore 呼叫 addTerm() 将词汇写入 SQLite vocabulary 表
**And** 词汇清单即时更新显示新词汇
**And** 输入框清空，准备下一次输入
**And** 发送 `vocabulary:changed` Tauri Event `{ action: 'add', term: '词汇' }`

**Given** 使用者尝试新增词汇
**When** 输入的词汇已存在于字典中
**Then** 显示提示「此词汇已存在」
**And** 不重复新增

**Given** 使用者尝试新增词汇
**When** 输入框为空白
**Then** 新增按钮为 disabled 状态
**And** 不执行新增操作

**Given** 词汇清单中有既有词汇
**When** 使用者点击某词汇旁的删除按钮
**Then** useVocabularyStore 呼叫 removeTerm() 从 SQLite 删除该词汇
**And** 词汇清单即时更新
**And** 发送 `vocabulary:changed` Tauri Event `{ action: 'remove', term: '词汇' }`

**Given** useVocabularyStore 已实作
**When** App 启动或字典页面载入
**Then** fetchTermList() 从 SQLite 读取所有词汇
**And** SQLite column snake_case 正确映射为 TypeScript camelCase

### Story 3.2: 词汇注入 Whisper 与 AI 上下文

As a 使用者,
I want 我的自订词汇自动提升语音辨识和 AI 整理的准确度,
So that 专业术语不再被错误辨识或转换。

**Acceptance Criteria:**

**Given** 使用者已建立自订词汇清单
**When** transcriber.ts 呼叫 Groq Whisper API
**Then** 将词汇清单格式化为 `"Important Vocabulary: 词汇1, 词汇2, 词汇3"` 字串
**And** 作为 Whisper API 的 `prompt` 参数传入
**And** Whisper 辨识结果中的专有名词准确度提升

**Given** 使用者已建立自订词汇清单且 AI 整理启用
**When** enhancer.ts 呼叫 Groq LLM API
**Then** 将词汇清单作为 `<vocabulary>词汇1, 词汇2, 词汇3</vocabulary>` 注入 system prompt
**And** AI 整理结果中正确保留专有名词原文

**Given** 词汇清单为空
**When** 执行转录或 AI 整理
**Then** Whisper API 不带 prompt 参数（或带空字串）
**And** AI 整理的 system prompt 不包含 `<vocabulary>` 标签
**And** 流程正常运作不报错

**Given** 使用者在字典中新增或删除词汇
**When** 下一次触发语音输入
**Then** transcriber.ts 和 enhancer.ts 自动使用最新的词汇清单
**And** 不需重启 App 即时生效

**Given** 词汇清单包含大量词汇（100+）
**When** 注入 Whisper prompt 或 AI 上下文
**Then** 系统正常运作不超出 API 限制
**And** 若词汇过多导致 prompt 超长，截取最近新增的词汇优先注入

---

## Epic 4: 历史记录与 Dashboard

系统自动记录每次成功转录的完整资料，使用者可浏览、搜寻、复制历史记录。Dashboard 显示使用统计（总口述时间、字数、速度、节省时间、使用次数、AI 使用率）与最近转录摘要。每次录音 WAV 档案永久储存至本地磁碟，使用者可在历史记录中播放录音。转录失败时可一键重送录音给 Whisper（限一次）。失败的转录也记录至历史。

### Story 4.1: 转录记录自动储存

As a 使用者,
I want 每次语音输入的完整资料自动被记录下来,
So that 我能回顾历史并追踪使用统计。

**Acceptance Criteria:**

**Given** 一次成功的语音转录流程完成（含或不含 AI 整理）
**When** useVoiceFlowStore 状态转为 'success' 且文字已贴入
**Then** useHistoryStore.addTranscription() 将完整记录写入 SQLite transcriptions 表
**And** 记录包含：id（UUID）、timestamp、rawText、processedText（若有）、recordingDurationMs、transcriptionDurationMs、enhancementDurationMs（若有）、charCount、triggerMode、wasEnhanced、wasModified（若已取得）
**And** created_at 由 SQLite datetime('now') 自动产生

**Given** 转录记录已写入 SQLite
**When** 储存成功
**Then** 发送 `transcription:completed` Tauri Event 至 Main Window
**And** payload 包含新记录的摘要资讯 `{ id, rawText, processedText, charCount, wasEnhanced }`
**And** Main Window 的 Dashboard 若已开启，即时更新

**Given** 转录流程失败（API 错误、网路断线）
**When** useVoiceFlowStore 状态为 'error'
**Then** 不写入历史记录
**And** 不发送 `transcription:completed` 事件

**Given** useHistoryStore 的 addTranscription()
**When** 从 TypeScript camelCase 资料写入 SQLite
**Then** 正确映射为 SQLite snake_case 栏位名
**And** SQLite WAL 模式确保写入安全
**And** 写入操作 < 200ms

**Given** AI 整理被跳过（字数 < 10 或 timeout fallback）
**When** 记录写入
**Then** processedText 为 null
**And** wasEnhanced 为 false
**And** enhancementDurationMs 为 null

### Story 4.2: 历史记录浏览、搜寻与复制

As a 使用者,
I want 浏览、搜寻和复制我的历史转录记录,
So that 我能找回之前说过的内容并重新使用。

**Acceptance Criteria:**

**Given** Main Window 的历史页面（HistoryView.vue）
**When** 使用者开启历史页面
**Then** 显示转录记录列表，按时间倒序排列（最新在上）
**And** 每笔记录显示：时间戳、文字预览（前 50 字截断）、录音时长、是否经 AI 整理标记
**And** 记录列表支援无限卷动或分页载入

**Given** 历史记录列表
**When** 使用者点击某笔记录
**Then** 展开显示完整文字内容
**And** 若有 AI 整理，同时显示原始文字和整理后文字
**And** 显示详细资讯（录音时长、转录耗时、AI 整理耗时、字数、触发模式）

**Given** 历史页面顶部搜寻框
**When** 使用者输入搜寻关键字
**Then** 对 rawText 和 processedText 栏位执行全文搜寻
**And** 即时过滤显示符合的记录
**And** 搜寻回应 < 200ms
**And** 搜寻框为空时显示全部记录

**Given** 历史记录展开状态
**When** 使用者点击复制按钮
**Then** 将整理后文字（processedText）复制到剪贴簿
**And** 若无整理后文字，复制原始文字（rawText）
**And** 显示短暂的「已复制」回馈提示

**Given** 历史记录为空
**When** 使用者开启历史页面
**Then** 显示空状态提示（如「尚无转录记录，开始使用语音输入吧！」）

### Story 4.3: Dashboard 统计与最近转录摘要

As a 使用者,
I want 在 Dashboard 看到使用统计和最近的转录摘要,
So that 我能量化语音输入带来的效率增益并快速回顾最近的使用。

**Acceptance Criteria:**

**Given** Main Window 的 Dashboard 页面（DashboardView.vue）
**When** 使用者开启 Dashboard
**Then** 显示 6 张统计卡片，资料从 useHistoryStore.calculateDashboardStats() 计算
**And** 所有统计查询回应 < 200ms

**Given** Dashboard 统计卡片
**When** 计算统计数据
**Then** 「总口述时间」= sum(recordingDurationMs) 转为小时/分钟显示
**And** 「口述字数」= sum(charCount)
**And** 「平均口述速度」= total_chars / total_recording_duration（字/分钟）
**And** 「节省时间」= total_chars / 40（假设平均打字速度 40 字/分钟）转为小时/分钟
**And** 「总使用次数」= count(records)
**And** 「AI 整理使用率」= count(wasEnhanced=true) / count(total) 显示为百分比

**Given** Dashboard 页面
**When** 统计卡片下方
**Then** 显示最近 10 笔转录摘要列表
**And** 每笔显示：时间戳、文字前 50 字截断、是否经 AI 整理
**And** 点击可跳转至历史页面对应记录

**Given** 无任何历史记录
**When** Dashboard 页面载入
**Then** 统计卡片显示初始值（0 小时、0 字、0 次等）
**And** 最近转录列表显示空状态提示

**Given** 新的转录记录完成
**When** Main Window 收到 `transcription:completed` Tauri Event
**Then** Dashboard 统计数据自动重新计算并更新
**And** 最近转录列表自动新增该笔记录至顶部
**And** 无需手动重新整理页面

### Story 4.4: 录音永久储存与历史播放

As a 使用者,
I want 每次录音档案永久储存，并可在历史记录中播放,
So that 我能回听自己说了什么，也能在辨识失败时重送。

**Acceptance Criteria:**

**Given** 录音结束
**When** `stop_recording()` 完成 WAV 编码
**Then** WAV 档案写入 `{APP_DATA}/recordings/{transcription_id}.wav`
**And** `transcriptions` 表的 `audio_file_path` 栏位记录档案路径

**Given** 转录失败（Whisper 回传空字串或幻觉拦截）
**When** 失败流程触发
**Then** 仍然写入 `transcriptions` 表，`status` 为 `failed`
**And** 录音档案仍然保存

**Given** HistoryView 显示历史记录
**When** 该记录有对应的录音档案
**Then** 显示播放按钮（▶）
**And** 点击后透过 `convertFileSrc()` + HTML5 `<audio>` 播放

**Given** HistoryView 显示历史记录
**When** 录音档案已被清理不存在
**Then** 播放按钮灰显 disabled

**Given** 设定页面
**When** 使用者查看录音储存设定
**Then** 显示「删除所有录音档」按钮
**And** 显示「自动清理」开关 + 天数设定（预设 7 天）

### Story 4.5: 转录失败一键重送

As a 使用者,
I want 转录失败时可以一键重送录音给 Whisper,
So that 我不需要崩溃重讲。

**Acceptance Criteria:**

**Given** HUD 显示 error 状态
**When** 使用者点击重送按钮
**Then** 从磁碟读取上一次录音的 WAV 档案
**And** HUD 切换为「转录中...」（复用 transcribing 状态）
**And** 重新呼叫 `transcribe_audio()`

**Given** 重送成功
**When** Whisper 回传有效文字
**Then** 进入正常的 AI 整理 → 贴上流程
**And** 更新 `transcriptions` 表的 `status` 为 `success`

**Given** 重送也失败
**When** Whisper 再次回传空字串
**Then** HUD 显示「辨识失败，请重新录音」
**And** 不再提供重送按钮

**Given** HUD error 状态
**When** 重送按钮显示条件
**Then** 一律显示（不区分是否确定有说话）

---

## Epic 5: 应用程式设定与生命周期管理

使用者可在完整设定页面配置快捷键（触发键选择+触发模式），应用程式支援开机自启动（可关闭）和自动更新（背景下载+提示安装）。设定页面新增幻觉词库管理区块与录音档清理设定。

### Story 5.1: 快捷键设定介面

As a 使用者,
I want 在设定页面自订触发键和触发模式,
So that 我能选择最顺手的按键组合来触发语音输入。

**Acceptance Criteria:**

**Given** SettingsView.vue 的快捷键设定区块
**When** 使用者开启设定页面
**Then** 显示「触发键」下拉选单，依当前平台显示可选项
**And** macOS 可选：Fn、Option、Control、Command、Shift
**And** Windows 可选：右 Alt（预设）、左 Alt、Control、Shift
**And** 当前已选的触发键为预设选中状态

**Given** 快捷键设定区块
**When** 使用者开启设定页面
**Then** 显示「触发模式」切换控制项（Hold / Toggle）
**And** 当前模式为预设选中状态
**And** 附带简短说明：Hold =「按住录音，放开停止」/ Toggle =「按一下开始，再按停止」

**Given** 使用者变更触发键
**When** 从下拉选单选择新的触发键
**Then** useSettingsStore 更新 hotkeyConfig 并持久化至 tauri-plugin-store
**And** 发送 `settings:updated` Tauri Event `{ key: 'hotkey', value: newConfig }`
**And** hotkey_listener.rs 接收事件后即时切换为新触发键
**And** 无需重启 App

**Given** 使用者变更触发模式
**When** 切换 Hold / Toggle
**Then** useSettingsStore 更新 triggerMode 并持久化至 tauri-plugin-store
**And** 发送 `settings:updated` Tauri Event `{ key: 'triggerMode', value: 'hold' | 'toggle' }`
**And** hotkey_listener.rs 即时切换模式
**And** 无需重启 App

**Given** App 重新启动
**When** hotkey_listener.rs 初始化
**Then** 从 tauri-plugin-store 读取已储存的触发键和触发模式
**And** 使用使用者上次设定的配置启动
**And** 若无储存设定，使用平台预设值（macOS: Fn + Hold / Windows: 右Alt + Hold）

### Story 5.2: 开机自启动与自动更新

As a 使用者,
I want App 开机自动启动并自动保持最新版本,
So that 我不需要每天手动开启 App，也不需要担心错过更新。

**Acceptance Criteria:**

**Given** tauri-plugin-autostart 已整合
**When** App 首次安装完成
**Then** 预设启用开机自启动
**And** macOS 和 Windows 各自使用原生开机启动机制

**Given** SettingsView.vue 的设定区块
**When** 使用者查看设定页面
**Then** 显示「开机自启动」开关
**And** 开关状态反映当前自启动设定

**Given** 使用者切换开机自启动开关
**When** 开关从启用切为关闭（或反之）
**Then** tauri-plugin-autostart 更新系统层级的自启动设定
**And** 变更立即生效
**And** useSettingsStore 同步更新状态

**Given** tauri-plugin-updater 已整合
**When** App 启动完成
**Then** 背景呼叫自订更新 endpoint（GET latest.json）检查是否有新版本
**And** 检查过程不阻塞 App 正常使用
**And** 若 endpoint 无法存取，静默失败不影响 App

**Given** 侦测到新版本可用
**When** 更新档案背景下载完成
**Then** 显示非阻塞式通知提示使用者「有新版本可用，重启以安装更新」
**And** 使用者可选择立即重启或稍后
**And** 选择立即重启后自动安装更新并重新启动 App

**Given** 自动更新过程中发生错误
**When** 下载失败或签名验证失败
**Then** 静默失败，不影响 App 现有功能
**And** 下次启动时重新尝试检查更新
**And** 不向使用者显示错误讯息（避免困扰）
