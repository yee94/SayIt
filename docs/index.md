# SayIt — Documentation Index

> 专案文件总入口 · 由 BMad Document Project 工作流自动产生
> 扫描层级：**Exhaustive** · 扫描日期：**2026-05-08** · 专案版本：**0.9.5**

> 👋 这个 index 是 **AI 助手与新成员的主要检索入口**。如果你不确定该看哪个档，从这里开始。

---

## 一、Project Overview

| 项目              | 内容                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| **产品定位**      | 跨平台桌面语音转书面语工具（macOS / Windows）                                       |
| **核心流程**      | 按住热键 → 录音 → Groq Whisper 转录 → LLM 整理 → 自动贴上                          |
| **Repository**    | multi-part desktop monorepo（2 parts）                                              |
| **Primary Tech**  | Tauri v2.10 + Vue 3.5 + Rust 2021                                                   |
| **架构模式**      | 双视窗 SPA（HUD + Dashboard）+ Rust Plugin Bus + 共用 SQLite Pool                   |

完整介绍见 [`project-overview.md`](./project-overview.md)

---

## 二、Quick Reference by Part

### Part 1：Frontend（`src/`）

```
类型：    web project (Vue 3 SPA)
入口：    src/main.ts (HUD) + src/main-window.ts (Dashboard)
规模：    11,503 LOC · 4 stores · 5 views · 11 components · 21 shadcn-vue UI
框架：    Vue 3.5 + TypeScript 5.7 + Pinia 3 + vue-router 5 + shadcn-vue + Tailwind 4
测试：    Vitest + Playwright + @vitest/coverage-v8
入口点配对：
  - HUD：index.html → main.ts → App.vue → NotchHud.vue
  - Dashboard：main-window.html → main-window.ts → MainApp.vue → router(5 views)
```

详细：[`architecture-frontend.md`](./architecture-frontend.md)

### Part 2：Backend（`src-tauri/`）

```
类型：    desktop project (Tauri v2 Rust runtime)
入口：    src-tauri/src/main.rs → sayit_lib::run()
规模：    6,006 LOC Rust · 8 plugin modules · 7 managed states
框架：    Tauri v2 + sentry 0.46 + cpal 0.15 + reqwest 0.12 + arboard 3
平台特化：
  - macOS：core-graphics, core-foundation, objc, CoreAudio FFI
  - Windows：windows 0.61（KeyboardAndMouse, Audio_Endpoints, ...）
测试：    内嵌 #[cfg(test)] mod tests（17+ 纯函式测试于 lib.rs）
```

详细：[`architecture-backend.md`](./architecture-backend.md)

---

## 三、Generated Documentation（本次扫描产出）

### 3.1 结构与导引

- [Project Overview](./project-overview.md) — 产品定位、技术栈、文件导引、Quick Start
- [Source Tree Analysis](./source-tree-analysis.md) — 全专案注解过的目录树
- [project-parts.json](./project-parts.json) — Multi-part metadata（给工具读取）

### 3.2 各 Part 架构

- [Architecture — Frontend](./architecture-frontend.md) — Vue 3 SPA 架构、依赖规则、Hard Rules
- [Architecture — Backend](./architecture-backend.md) — Tauri Rust runtime、plugin module、生命周期

### 3.3 整合与契约

- [Integration Architecture](./integration-architecture.md) — 两 part 间的 IPC 整合 + 启动 / 结束顺序 + 新功能决策树
- [API Contracts — Backend](./api-contracts-backend.md) — 34 Tauri Commands + 15 Rust→FE Events + 5 FE-only Events
- [Data Models](./data-models.md) — SQLite Schema + 8 个 Migration + Store 结构 + 型别命名

### 3.4 元件与开发

- [Component Inventory — Frontend](./component-inventory-frontend.md) — 11 自制元件 + 21 shadcn-vue 元件
- [Development Guide](./development-guide.md) — 环境、指令、常见任务、Hooks、Pitfalls
- [Deployment Guide](./deployment-guide.md) — CI/CD、Apple Notarize、发版流程、回滚

### 3.5 Scan State

- [project-scan-report.json](./project-scan-report.json) — 扫描状态档（resume / re-scan 用）

---

## 四、Existing Documentation（既有文件，本次未取代）

### 4.1 规范性文件（authoritative · 必读）

- [`_bmad-output/project-context.md`](../_bmad-output/project-context.md) — **AI Agent 必读规则 · 323 条**（最高优先）
- [`CLAUDE.md`](../CLAUDE.md) — Claude Code 专案记忆、IPC 契约表、Hooks 设定
- [`_bmad-output/planning-artifacts/architecture.md`](../_bmad-output/planning-artifacts/architecture.md) — 架构决策（ADR）
- [`_bmad-output/planning-artifacts/ux-ui-design-spec.md`](../_bmad-output/planning-artifacts/ux-ui-design-spec.md) — UI 设计规范
- [`design.pen`](../design.pen) — Pencil MCP 设计稿（UI 实作前必读）

### 4.2 规划 / 故事文件（`_bmad-output/`）

- `planning-artifacts/prd.md` — 产品需求文件
- `planning-artifacts/epics.md` — Epic 拆分
- `planning-artifacts/product-brief-sayit-2026-02-28.md` — 产品 brief
- `planning-artifacts/sprint-change-proposal-2026-03-15.md` — 变更提案
- `planning-artifacts/implementation-readiness-report-2026-03-01.md` — Implementation readiness
- `implementation-artifacts/{n}-{m}-{slug}.md` — 17 个 story 完成纪录
- `implementation-artifacts/tech-spec-*.md` — 14 份功能 tech spec
- `implementation-artifacts/sprint-status.yaml` — Sprint 状态
- `test-artifacts/automation-summary.md` — 自动化测试摘要
- `test-artifacts/framework-setup-progress.md` — 测试框架设置进度

### 4.3 README / 变更纪录

- [`README.md`](../README.md) — 对外用使用者文件
- [`CHANGELOG.md`](../CHANGELOG.md) — 版本变更纪录
- [`tests/README.md`](../tests/README.md) — 测试结构说明

### 4.4 有赞语音输入参考与实施设计

- [`youzanvoice-reference/README.md`](./youzanvoice-reference/README.md) — 自定义词学习、截图上下文助手、ASR/LLM 上下文与实施路线
- [`youzanvoice-reference/reference/README.md`](./youzanvoice-reference/reference/README.md) — 有赞语音输入 3.2.3 静态参考源码说明与安全约束

---

## 五、I want to… (Decision Tree)

| 情境                              | 看哪个档                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| 第一次接触这专案                  | `project-overview.md` → `index.md`（这个）→ `source-tree-analysis.md` |
| 写 brownfield PRD                 | `project-overview.md` + `integration-architecture.md` + `architecture-{frontend,backend}.md` |
| 加 IPC 契约                       | `api-contracts-backend.md` §七 checklist + `integration-architecture.md` §九 |
| 改 UI                             | `_bmad-output/planning-artifacts/ux-ui-design-spec.md` + `design.pen`（先设计）+ `component-inventory-frontend.md` |
| 改 SQLite                         | `data-models.md` §三 Migration                                        |
| 加 LLM Provider                   | `architecture-frontend.md` §4.4 + `development-guide.md` §4.4         |
| 改 hotkey / paste 机制            | `architecture-backend.md` §4.1 / §4.4 + `_bmad-output/project-context.md` |
| 发版                              | `deployment-guide.md` §四 + `scripts/release.sh`                      |
| 看实作规则（323 条）              | `_bmad-output/project-context.md`                                     |
| 看 IPC 契约表                     | `CLAUDE.md` §IPC 契约表（authoritative）                              |

---

## 六、Hard Rules（最常违反的，必看）

> 完整列表见 `_bmad-output/project-context.md`。本节只列「最容易踩」。

1. **❌ 浏览器原生 `fetch`** → ✅ `@tauri-apps/plugin-http`
2. **❌ Options API** → ✅ `<script setup lang="ts">`
3. **❌ views/ 直接 import lib/** → ✅ 透过 Pinia store
4. **❌ SQLite 存 API Key** → ✅ 只能用 `tauri-plugin-store`
5. **❌ Tailwind 原生色彩**（`bg-zinc-900`） → ✅ 语意变数（`bg-primary`）
6. **❌ `@tabler/icons-vue`** → ✅ 只用 `lucide-vue-next`
7. **❌ 手写 UI 元件** → ✅ shadcn-vue（new-york style）
8. **❌ 直接 import Tauri event API** → ✅ 透过 `composables/useTauriEvents.ts`
9. **❌ 未经 Pencil 设计直接写 UI** → ✅ 先在 `design.pen` 完成设计
10. **❌ 改旧 SQL migration**（v1～v8） → ✅ 追加 v9 等新版本
11. **❌ 改 `Cargo.lock` / `pnpm-lock.yaml`** → ✅ 受 `protect-config.sh` 阻挡

---

## 七、已知一致性问题（需 follow-up）

| 问题                                                                | 建议                                              |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `tauri.conf.json` CSP `connect-src` 缺 OpenAI / Anthropic           | 加入 `https://api.openai.com` + `https://api.anthropic.com` |
| CI 没跑 `cargo test`、`cargo clippy`、`eslint`                       | 加进 `ci.yml`                                     |
| `CLAUDE.md` 开头声称「261 条」，但 `project-context.md` 实为 323 条   | 同步数字                                          |
| `addApiUsage` FK 失败（787）偶发                                     | 调查 `transcriptions` 与 `api_usage` 写入 race    |
| autoUpdater 用 `window.confirm` 在 Tauri WKWebView 静默忽略           | 改 in-app UI                                      |
| `text_field_reader::read_selected_text` Fn-c 字元穿透（issue #25）   | 待修                                              |

---

## 八、Getting Started（30 秒）

```bash
nvm use && corepack enable && corepack prepare
pnpm install --frozen-lockfile
pnpm tauri dev
```

完整环境设置：[`development-guide.md`](./development-guide.md) §一 + §二

---

## 九、Repository Stats

| 项目                    | 数值                |
| ----------------------- | ------------------- |
| Frontend LOC            | 11,503              |
| Backend LOC (Rust)      | 6,006               |
| **Total LOC**           | **~17.5 K**         |
| Pinia stores            | 4                   |
| Vue views               | 5                   |
| 自制元件                | 11                  |
| shadcn-vue 元件         | 21                  |
| Composables             | 4                   |
| Lib utility 模组        | 13                  |
| i18n 语系               | 4（zh-CN, en, ja, ko；历史 zh-TW→zh-CN） |
| Rust plugins            | 8                   |
| Managed states          | 7                   |
| Tauri Commands          | 34                  |
| Tauri Events (Rust→FE)  | 15                  |
| Frontend-only Events    | 5                   |
| SQLite tables           | 4（v8）             |
| LLM Providers           | 4（Groq / OpenAI / Anthropic / Gemini） |
| External APIs           | 5（含 Whisper）     |
| GitHub Workflows        | 4（ci, release, claude, claude-code-review） |
| GitHub Secrets          | 13                  |

---

## 十、Documentation Workflow Metadata

| 栏位             | 值                                              |
| ---------------- | ----------------------------------------------- |
| 工作流           | `bmad-document-project`（v1.2.0）               |
| 模式             | `initial_scan`                                  |
| Scan level       | `exhaustive`                                    |
| 开始时间         | 2026-05-08 14:14:11 +08:00                      |
| 完成时间         | 2026-05-08（见 `project-scan-report.json`）     |
| 输出语言         | 简体中文                                        |
| 文件总数         | 11 个（含此 index）                              |
| State file       | [`project-scan-report.json`](./project-scan-report.json) |
