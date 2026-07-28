---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
workflowStatus: complete
completedAt: 2026-02-28
inputDocuments:
  - product-brief-sayit-2026-02-28.md
  - voice-transcription-poc-spec.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 1
classification:
  projectType: desktop_app
  domain: general
  complexity: low
  projectContext: brownfield
workflowType: 'prd'
---

# Product Requirements Document - SayIt

**Author:** Jackle
**Date:** 2026-02-28

## Executive Summary

SayIt 是一款跨平台桌面语音输入工具，解决知识工作者「思考速度远超打字速度」的核心瓶颈。使用者在任何应用程式中按住快捷键说话，放开后语音经 Groq Whisper API 转录，再由 Groq LLM 自动将口语转为通顺的简体中文书面语（去除赘词、重组句构、修正标点），直接贴入游标位置。

现有方案要么输出品质不足以直接使用（macOS 内建听写无 AI 后处理），要么设定繁复（VoiceInk 需管理 12+ AI 提供商与本地模型），要么需付费订阅（Typeless）。SayIt 的目标是提供一个安装后只需设定 API Key 即可使用的工具，让语音输入成为文字输入的自然延伸。

本专案基于已完成的 POC（Fn 键监听 → 录音 → Whisper 转录 → 剪贴簿贴上）进行功能扩展，新增 AI 文字整理、跨平台热键系统、自订词汇字典、历史记录与 Dashboard UI。主要使用者为开发者与知识工作者，中期目标推广至公司内部非技术角色。

### What Makes This Special

1. **口语到书面语的无感桥接** — 过去语音输入的瓶颈不在辨识准确度，而在输出无法直接作为书面文字使用。Groq LLM 的低延迟让 AI 后处理能在使用者无感的情况下完成口语→书面语转换，首次实现「说完即可用」的体验。

2. **刻意的极简** — 设定只有三项（快捷键、API Key、AI Prompt），刻意排除多提供商、多语言、Per-App 设定等功能。一段 prompt 控制所有文字处理行为，降低认知负担至零。

3. **即时感依赖低延迟基础设施** — 选择 Groq 作为唯一提供商不是偷懒，而是产品决策：端到端延迟 < 3 秒（含 AI 整理）是体验的底线，Groq 的推论速度是让这个体验成立的技术前提。

## Project Classification

| 项目 | 值 |
|------|-----|
| **专案类型** | Desktop App（Tauri v2 跨平台桌面应用） |
| **领域** | General（生产力 / 效率工具） |
| **复杂度** | Low — 标准软体需求，无法规限制 |
| **专案脉络** | Brownfield — 基于已完成 POC 扩展功能 |

## Success Criteria

### User Success

| 指标 | 目标 | 衡量方式 |
|------|------|---------|
| **输出可用率** | > 90% 转录结果不需手动修改 | 贴上后监控使用者键盘输入行为（删除、修改），若无修改视为可用 |
| **端到端延迟** | < 3 秒（放开按键到文字出现，含 AI 整理） | 历史记录中 `transcriptionDurationMs + enhancementDurationMs` |
| **首次使用时间** | 安装到第一次成功语音输入 < 2 分钟 | Onboarding 流程观察 |
| **日均使用次数** | >= 10 次/人 | Dashboard 历史记录统计 |

### Business Success

| 指标 | 目标 | 时间框架 |
|------|------|---------|
| **团队采用率** | > 80% 日活 | 部署后 2 周 |
| **持续使用** | 部署后使用者未主动停用 | 持续追踪 |
| **累计效率增益** | Dashboard 可见节省时间统计 | 持续累计 |

核心商业目标：内部效率工具，不涉及营收。成功 = 团队成员自然地用语音取代大部分文字输入场景。

### Technical Success

| 指标 | 目标 |
|------|------|
| **跨平台运作** | macOS 和 Windows 双平台功能一致且稳定 |
| **系统可用率** | > 99%（排除网路问题） |
| **AI 整理使用率** | `count(wasEnhanced=true) / count(total)` 可追踪 |
| **品质回馈机制** | 贴上后键盘监控能正确侦测使用者修改行为 |

### Measurable Outcomes

- 使用者每日文字输入效率体感提升，「想到但懒得打」的情况减少
- AI 整理输出品质随 prompt 调校持续改善，可用率趋势向上
- 非技术角色能零学习成本上手，无需 IT 支援

## Product Scope & Development Roadmap

### MVP — 已完成

POC 已实作的核心流程：Fn 键监听 → 麦克风录音 → Groq Whisper API 转录 → 剪贴簿贴上 → Notch-style HUD 状态显示。已验证技术可行性与基础体验。

### V2 Phase 1 — 完整功能版（本次开发范围）

**策略：** 体验完整化 — 在已验证的技术基础上，补齐让产品「可日常使用」和「可推广给他人」所需的全部能力。

| # | 功能 | 说明 |
|---|------|------|
| 1 | 跨平台热键系统 | `rdev` crate 统一监听，macOS 预设 Fn、Windows 预设右 Alt，可自选修饰键，Hold + Toggle 双模式 |
| 2 | AI 文字整理 | Groq LLM + 可编辑 prompt，一次完成去口语、重组句构、标点修正。字数 < 10 字跳过 AI |
| 3 | 自订词汇字典 | CRUD 管理，注入 Whisper API prompt + AI 上下文 |
| 4 | 历史记录 | SQLite 持久化，供 Dashboard 统计与回顾 |
| 5 | App UI — Dashboard | 统计卡片 + 最近转录列表 |
| 6 | App UI — 历史 / 字典 / 设定 | 历史搜寻复制、词汇 CRUD、快捷键 / API Key / Prompt 设定 |
| 7 | HUD 状态扩展 | 新增 `enhancing` 状态，完整状态机 |

#### 依赖分析与建议开发顺序

```
Layer 0 — 基础架构（无依赖，其他功能的前提）
├── [1] 跨平台热键系统（rdev 取代 CGEventTap）
└── [4] 历史记录（SQLite schema + tauri-plugin-sql 初始化）

Layer 1 — 核心功能（依赖 Layer 0）
├── [2] AI 文字整理（依赖 [1] 热键触发流程重构）
├── [3] 自订词汇字典（依赖 [4] SQLite 资料库）
└── [7] HUD 状态扩展（依赖 [2] 新增 enhancing 状态）

Layer 2 — UI 层（依赖 Layer 0 + 1）
├── [5] Dashboard（依赖 [4] 历史记录有资料）
└── [6] 历史/字典/设定页面（依赖 [3][4] 资料层）
```

| 顺序 | 功能 | 原因 |
|------|------|------|
| 1st | 跨平台热键系统 | 基础设施，rdev 替换影响整个触发流程 |
| 2nd | 历史记录（SQLite） | 资料层基础，Dashboard 和统计都依赖它 |
| 3rd | AI 文字整理 | 核心体验升级，产品最大差异化来源 |
| 4th | HUD 状态扩展 | 跟随 AI 整理，新增 enhancing 状态 |
| 5th | 自订词汇字典 | 依赖 SQLite，提升辨识品质 |
| 6th | App UI（设定/历史/字典） | 资料层就绪后建构 UI |
| 7th | Dashboard | 最后做，需要足够历史资料才有意义 |

### Phase 2 — 体验优化

| 功能 | 说明 |
|------|------|
| VAD 静音侦测 | Web Audio API，搭配 Toggle 模式自动停止 |
| 串流转录 | WebSocket 即时字幕 |
| Mini HUD | 适配无浏海外接萤幕 |
| 剪贴簿还原 | 贴上后延迟还原原始剪贴簿 |

### Vision — 长期方向

| 功能 | 说明 |
|------|------|
| Per-App 设定 | 依前景 App 自动切换 prompt |
| 多语言支援 | 英文、日文等 |
| IT 集中管理 | API Key 统一配置、使用量监控 |

## User Journeys

### Journey 1：Jackle — 全端工程师的日常（Success Path）

**Opening Scene：** 周三下午，Jackle 刚完成一个功能的 code review，需要在 GitHub PR 上留下一段详细的 review comment。脑中有很多想法要表达，但一想到要把这些组织成书面文字就觉得烦。

**Rising Action：** 他把游标放在 GitHub comment 输入框，按住 Fn 键开始说话：「这边的 error handling 我觉得可以改一下，目前是直接 throw，但其实 caller 那边没有 catch，所以会变成 unhandled rejection，建议改成 return Result type 让 caller 决定怎么处理。」放开 Fn，HUD 显示「转录中...」→「整理中...」→「已贴上 ✓」。

**Climax：** 文字出现在 comment 框中：已去除「我觉得」「其实」等口语赘词，标点修正，句构重组为清晰的书面语。Jackle 扫一眼，不需修改，直接送出。

**Resolution：** 整个过程不到 5 秒。Jackle 继续下一个 PR，这已经是今天第 15 次使用语音输入。他甚至不再意识到自己在「用工具」— 按 Fn 说话已经跟按键打字一样自然。

**揭示的需求：** 全域贴上（任何 App）、AI 整理品质、低延迟、Hold 模式触发

---

### Journey 2：Mia — 产品经理的会议笔记（Success Path）

**Opening Scene：** 周一早上 standup 刚结束，Mia 需要在 Slack 上同步几个决定给没参加的同事。会议中讨论了三个议题，她记得大致内容但懒得一个一个打。

**Rising Action：** 她打开 Slack 对话框，按住 Fn：「刚才 standup 有三个决定，第一是 API 的 deadline 延到下周五，因为后端还在等第三方的文件。第二是 UX 的 prototype 已经确认，可以开始切版。第三是下周三要做一次 demo 给老板看，需要准备投影片。」

**Climax：** AI 整理后的输出自动分成三个清晰的要点，去除了「刚才」「因为」等口语连接词，每点精简到一句话。Mia 看了觉得比自己打的还好。

**Resolution：** 原本需要 5 分钟打字整理的讯息，20 秒就完成了。Mia 开始养成「会议结束立刻语音同步」的习惯，团队资讯同步效率明显提升。

**揭示的需求：** AI 整理的分段能力、长文处理品质、使用统计（Dashboard 看到累计节省时间的成就感）

---

### Journey 3：David — 业务的第一次使用（Onboarding Journey）

**Opening Scene：** David 收到同事分享的安装包，对「对电脑说话」这件事半信半疑。他用的是 Windows 笔电。

**Rising Action：** 安装完成后，App 开启设定页面，只有一个输入框要他填 Groq API Key。同事已经把 Key 传给他了，贴上，完成。App 提示他试试按住右 Alt 说话。他有点别扭地按住右 Alt，小声说了一句：「嗯，测试一下，这个东西真的能用吗？」

**Climax：** HUD 显示状态转换，两秒后文字出现在游标位置：「测试一下，这个东西真的能用吗？」— 「嗯」被去掉了，标点正确。David 愣了一下，然后笑了。

**Resolution：** 他开始在 Email 回复中使用，发现回复客户的速度变快了。一周后他已经不再觉得对电脑说话奇怪，反而觉得打字太慢。

**揭示的需求：** Windows 平台支援（右 Alt 预设）、极简 Onboarding（只需 API Key）、短文也能处理、首次体验的「Aha moment」

---

### Journey 4：Jackle — 错误恢复场景（Edge Case）

**Opening Scene：** Jackle 正在写一份技术文件，按住 Fn 说了一长段话。放开后 HUD 显示「转录中...」但卡了超过 5 秒。

**Rising Action：** HUD 显示错误：「API 请求失败 — 网路连线中断」。Jackle 检查网路，发现 Wi-Fi 断了。他重新连上网路，再次按住 Fn 重新说一次。

**Climax：** 这次正常完成，文字贴入。但他想到刚才那段话其实说得更好，可惜没有留下来。

**Resolution：** 他打开 Dashboard 的历史记录，发现失败的那次没有记录（因为 API 没回应）。他心想：如果录音档能暂存就好了，至少可以重新送出。但目前这不在功能范围内，他接受了这个限制。

**揭示的需求：** 错误状态 HUD 显示、错误讯息清晰、网路断线优雅处理、历史记录仅记录成功项（目前设计）、未来可考虑录音暂存重送

---

### Journey 5：Mia — AI 整理品质不佳时（Edge Case）

**Opening Scene：** Mia 在描述一个涉及专有名词的需求，按住 Fn 说：「我们的 CRM 系统 Fortuna 需要跟 NoWayLM 的 API 做整合，用 OAuth 2.0 做认证。」

**Rising Action：** AI 整理后输出把「Fortuna」辨识成「福图纳」，把「OAuth」变成「欧奥斯」。Mia 需要手动修改这几个词。

**Climax：** 她打开字典页面，把「Fortuna」「NoWayLM」「OAuth」加入自订词汇。下次再说同样的内容，这些专有名词都正确辨识了。

**Resolution：** 随着词汇字典的累积，Mia 的辨识准确率越来越高，修改频率持续下降。

**揭示的需求：** 自订词汇字典的 CRUD、词汇注入 Whisper prompt、词汇注入 AI 上下文、品质随使用时间改善的正向循环

---

### Journey Requirements Summary

| Journey | 揭示的核心能力需求 |
|---------|-------------------|
| Jackle Success | 全域贴上、AI 整理、低延迟、Hold 模式 |
| Mia Success | AI 分段能力、长文处理、Dashboard 统计 |
| David Onboarding | Windows 支援、极简设定、首次体验品质 |
| Jackle Error | 错误 HUD、网路断线处理、历史记录 |
| Mia Quality | 自订词汇 CRUD、Whisper/AI prompt 注入 |

**能力交叉覆盖：**
- **跨平台热键**：Journey 1, 3, 4
- **AI 文字整理**：Journey 1, 2, 5
- **自订词汇字典**：Journey 5
- **历史记录 + Dashboard**：Journey 2, 4
- **HUD 状态机**：Journey 1, 2, 3, 4
- **设定页面**：Journey 3

## Desktop App Specific Requirements

### Project-Type Overview

SayIt 是一款常驻 System Tray 的跨平台桌面应用，使用 Tauri v2 框架。应用程式需要深度整合作业系统层功能（全域热键、剪贴簿、键盘模拟），同时维持轻量的资源占用。双视窗架构：HUD Overlay（状态显示）+ Main Window（Dashboard / 设定）。

### Technical Architecture Considerations

**跨平台策略：**

| 项目 | macOS | Windows |
|------|-------|---------|
| 框架 | Tauri v2 | Tauri v2 |
| 前端 | Vue 3 + TypeScript + Tailwind | 同左 |
| 全域热键 | `rdev` crate（预设 Fn） | `rdev` crate（预设右 Alt） |
| 剪贴簿 | `arboard` crate | `arboard` crate |
| 自动贴上 | AX API menu press（Cmd+V） | SendInput（Ctrl+V） |
| 资料库 | `tauri-plugin-sql`（SQLite） | 同左 |
| 状态管理 | Pinia | 同左 |

**双视窗架构：**

| 视窗 | 用途 | 特性 |
|------|------|------|
| HUD Overlay | Notch-style 状态显示 | 始终置顶、不可互动、透明背景 |
| Main Window | Dashboard / 历史 / 字典 / 设定 | 标准视窗，从 System Tray 开启 |

### Platform Support

| 平台 | 支援等级 | 备注 |
|------|---------|------|
| macOS（Apple Silicon + Intel） | 完整支援 | 需 Accessibility 权限 |
| Windows 10/11 | 完整支援 | 无特殊权限需求 |
| Linux | 不支援 | 不在范围内 |

### System Integration

| 整合项目 | 技术方案 | 备注 |
|----------|---------|------|
| 全域热键监听 | `rdev` crate | 跨平台统一，支援多种修饰键 |
| 剪贴簿操作 | `arboard` crate | 备份→写入→模拟贴上 |
| 自动贴上 | AX API menu press / SendInput | macOS: AXPress Paste menu / Windows: Ctrl+V |
| System Tray | Tauri 内建 | 常驻、右键选单、开启 Main Window |
| Accessibility 权限 | macOS CGEventTap | 首次启动引导授权 |
| 麦克风权限 | WebView `getUserMedia` | 首次录音时系统提示 |
| 开机自启动 | `tauri-plugin-autostart` | 预设启用，设定可关闭 |
| 贴上后键盘监控 | `rdev` crate | 侦测使用者是否修改贴上内容，用于品质衡量 |

### Update Strategy

| 项目 | 方案 |
|------|------|
| 更新机制 | `tauri-plugin-updater`（自动更新） |
| 更新频率 | 手动触发检查 + 启动时自动检查 |
| 更新来源 | GitHub Releases 或自建更新伺服器 |
| 使用者体验 | 背景下载，提示重启安装 |

### Offline Capabilities

本产品依赖 Groq Cloud API（Whisper + LLM），**无离线能力**。网路断线时：
- 录音可正常进行
- 转录/AI 整理会失败，HUD 显示错误讯息
- 不提供离线 fallback（如本地模型），这是刻意的产品决策以维持极简架构

### Implementation Considerations

- **资源占用**：常驻应用应维持低记忆体占用（< 100MB），CPU 仅在录音/API 呼叫时有负载
- **安装包格式**：macOS `.dmg` / Windows `.msi` 或 `.exe`
- **程式码签署**：macOS 需 Apple Developer 签署避免 Gatekeeper 拦截；Windows 需考虑 SmartScreen 信任
- **资料储存位置**：SQLite 资料库存放于各平台标准 App Data 目录

## Risk Mitigation Strategy

**Technical Risks：**

| 风险 | 严重度 | 缓解策略 |
|------|--------|---------|
| `rdev` crate 跨平台一致性 | 高 | 最先开发，及早验证 macOS/Windows 行为差异。若 rdev 不稳定，macOS 可退回 CGEventTap，Windows 用 rdev |
| 贴上后键盘监控的准确度 | 中 | 需定义「修改」的判定逻辑（多久内、哪些按键算修改）。先做简单版（贴上后 5 秒内有 Backspace/Delete 视为修改），再迭代 |
| Groq API 稳定性与延迟波动 | 中 | 加入 timeout 机制（5 秒），超时直接贴上原始转录文字跳过 AI 整理 |
| 双视窗架构（HUD + Main Window）的 Tauri 行为 | 低 | POC 已验证 HUD 视窗，Main Window 是标准 Tauri 视窗，风险低 |

**Market Risks：**

| 风险 | 缓解策略 |
|------|---------|
| 同事不愿对电脑说话 | 首次体验设计要让 Aha moment 来得快（David Journey），用输出品质说服而非功能说服 |
| AI 整理品质不符预期 | Prompt 可编辑 + 词汇字典双重调校机制，使用者有控制权 |

**Resource Risks：** 无。时间充足，单人全端开发，无外部依赖。

## Functional Requirements

### 语音触发与录音

- FR1: 使用者可透过全域快捷键触发录音，不需切换至 App 视窗
- FR2: 使用者可自选触发用的修饰键（macOS: Fn/Option/Ctrl/Cmd/Shift；Windows: 右Alt/左Alt/Ctrl/Shift）
- FR3: 使用者可选择 Hold 模式（按住录音，放开停止）或 Toggle 模式（按一下开始，再按一下停止）
- FR4: 系统在使用者触发录音时透过麦克风撷取音讯
- FR5: 系统在录音结束后将音讯封装为 API 可接受的格式

### 语音转文字

- FR6: 系统可将录音音讯送至 Groq Whisper API 取得转录结果；转录失败时可从暂存录音重送一次
- FR7: 系统可将自订词汇清单注入 Whisper API prompt 参数以提升专有名词辨识率

### AI 文字整理

- FR8: 系统可将转录结果送至 Groq LLM 进行口语→书面语整理（去赘词、重组句构、修正标点、适当分段）
- FR9: 系统在转录字数低于门槛（约 10 字）时跳过 AI 整理，直接输出原始转录
- FR10: 使用者可编辑 AI 整理使用的 prompt
- FR11: 使用者可将 prompt 重置为预设值
- FR12: 系统可将剪贴簿内容与自订词汇清单作为上下文注入 AI 整理请求

### 文字输出

- FR13: 系统可将最终文字（转录或 AI 整理后）自动贴入当前游标所在的任何应用程式
- FR14: 系统透过剪贴簿写入 + 模拟键盘贴上实现全域文字输出
- FR15: 系统可在贴上后监控使用者键盘输入行为，判断输出是否被修改以衡量品质

### 自订词汇字典

- FR16: 使用者可新增自订词汇（专案名、人名、技术术语）
- FR17: 使用者可删除已建立的自订词汇
- FR18: 使用者可浏览完整的自订词汇清单
- FR19: 系统可将词汇清单同时注入 Whisper API 与 AI 整理上下文

### 历史记录与统计

- FR20: 系统在每次成功转录后自动记录完整资料（原始文字、整理后文字、录音时长、API 回应时长、字数、触发模式、是否经 AI 整理）
- FR21: 使用者可浏览历史转录记录列表
- FR22: 使用者可搜寻历史记录（全文搜寻）
- FR23: 使用者可复制历史记录中的文字
- FR24: 使用者可在 Dashboard 查看统计指标（总口述时间、口述字数、平均口述速度、节省时间、使用次数、AI 整理使用率）
- FR25: 使用者可在 Dashboard 查看最近转录摘要列表

### 状态回馈（HUD）

- FR26: 系统在各阶段透过 Notch-style HUD 显示目前状态（idle → recording → transcribing → enhancing → success/error → idle），error 状态提供一键重送按钮
- FR27: 系统在 success 状态短暂显示后自动收起 HUD
- FR28: 系统在 API 请求失败时透过 HUD 显示清晰的错误讯息，并提供重送按钮（限一次）供使用者重新送出同一段录音
- FR29: 系统在 Groq API 逾时时直接贴上原始转录文字跳过 AI 整理

### 应用程式管理

- FR30: 使用者可在设定页面配置快捷键（预设触发键选择、自订组合键（0~N 个 modifier + 1 个普通键）、触发模式）
- FR31: 使用者可在设定页面输入/修改 Groq API Key
- FR32: 系统常驻 System Tray，使用者可从 Tray 开启主视窗
- FR33: 系统支援开机自启动，使用者可在设定中关闭
- FR34: 系统支援自动更新，启动时检查并背景下载更新
- FR35: 系统在 macOS 首次启动时引导使用者授权 Accessibility 权限
- FR36: 系统在首次录音时触发麦克风权限请求

### 录音档管理

- FR37: 系统在每次录音结束后将 WAV 档案永久储存至本地磁碟（{APP_DATA}/recordings/），使用者可在历史记录中播放录音
- FR38: 系统自动侦测 Whisper 幻觉文字（四层侦测：语速异常、静音侦测、背景噪音侦测（RMS 能量 + NSP 联合判断）、已知幻觉词精确比对），判定为幻觉时不贴上并自动学习至幻觉词库
- FR39: 使用者可在独立的幻觉词库页面管理幻觉词（浏览、新增、删除），侧边栏提供导航入口；设定页面提供录音档自动清理策略（手动删除全部 + 自动清理天数）

## Non-Functional Requirements

### Performance

| 指标 | 目标值 | 备注 |
|------|--------|------|
| 端到端延迟（含 AI 整理） | < 3 秒 | 从放开按键到文字出现在游标位置 |
| 端到端延迟（跳过 AI） | < 1.5 秒 | 短文直接贴上场景 |
| Groq API timeout | 5 秒 | 超时 fallback 至原始转录文字 |
| 常驻记忆体占用 | < 100 MB | idle 状态下 |
| HUD 状态转换 | < 100 ms | 动画流畅，无视觉延迟 |
| App 启动时间 | < 3 秒 | 从开机自启动到 System Tray 就绪 |
| SQLite 查询回应 | < 200 ms | 历史搜寻、Dashboard 统计计算 |

### Security

| 需求 | 说明 |
|------|------|
| API Key 储存 | 使用作业系统原生安全储存（macOS Keychain / Windows Credential Manager）或加密存放，不得明文储存 |
| 转录资料 | 历史记录仅存于本地 SQLite，不上传至任何第三方服务 |
| API 通讯 | 所有 Groq API 请求透过 HTTPS |
| 敏感资料传输 | 剪贴簿内容作为 AI 上下文注入时，仅传送至使用者自行配置的 Groq API |

### Integration

| 整合对象 | 可靠性需求 | 降级策略 |
|----------|----------|---------|
| Groq Whisper API | 依赖网路，无离线替代 | 失败时 HUD 显示错误并提供一键重送按钮（从暂存录音重送，限一次） |
| Groq LLM API | 依赖网路，有 timeout 降级 | 5 秒逾时则跳过 AI 整理，直接贴上原始转录 |
| 作业系统剪贴簿 | 系统层级，高可靠 | 无降级，失败视为系统错误 |
| 作业系统键盘模拟 | 系统层级，需权限 | macOS 需 Accessibility 授权，未授权时引导 |

### Reliability

| 指标 | 目标值 | 备注 |
|------|--------|------|
| 系统可用率 | > 99%（排除网路问题） | App 本身不 crash、不冻结 |
| 资料持久性 | 历史记录零遗失 | SQLite WAL 模式确保写入安全 |
| 错误恢复 | API 失败不影响 App 稳定性 | 回到 idle 状态，可立即重试 |
| 自动更新 | 更新失败不影响现有功能 | 背景下载，使用者确认后安装 |
