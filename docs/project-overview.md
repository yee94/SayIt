# Project Overview — SayIt

> 「按住说话，放开贴上」— 跨平台桌面语音转书面语工具
> 扫描日期：2026-05-08 · 版本：0.9.5

---

## 一、产品定位

SayIt 是一款 **macOS / Windows 跨平台桌面语音输入工具**，核心价值主张是「**口语到书面语**」：

1. 在任何 App 中按住热键（预设 Fn）说话
2. 放开后语音经 **Groq Whisper** 转录为文字
3. 再经 **LLM**（Groq / OpenAI / Anthropic / Gemini 任选）将口语自动整理为通顺的书面语
4. 整理后文字直接贴入游标位置

端到端延迟 < 3 秒，适合会议笔记、邮件起草、聊天讯息、技术文件等场景。

---

## 二、Tech Stack 总览

| 层级       | 主要技术                                                      |
| ---------- | ------------------------------------------------------------- |
| Desktop    | **Tauri v2.10+**（含 macOS Private API、System Tray）         |
| Frontend   | **Vue 3.5 + TypeScript 5.7** + shadcn-vue (new-york) + Tailwind 4 |
| Backend    | **Rust 2021 edition**（cpal、reqwest、arboard、rustfft）      |
| State      | Pinia 3                                                       |
| Storage    | SQLite（tauri-plugin-sql，WAL mode）+ tauri-plugin-store      |
| AI         | Groq Whisper + 4 家 LLM（Groq / OpenAI / Anthropic / Gemini）|
| Build      | Vite 6（多入口）+ Rust release LTO                            |
| Test       | Vitest + Playwright + 内嵌 Rust unit tests                    |
| Telemetry  | Sentry（Vue + Rust，仅 production）                           |

---

## 三、Repository 结构分类

**Type**：multi-part desktop monorepo

```
say-it/
├── src/         ← Frontend part（Vue 3 SPA · 双视窗）
└── src-tauri/   ← Backend part（Tauri Rust runtime · 8 plugins）
```

两个 part 透过 Tauri IPC（34 Commands + 15 Rust→FE Events + 5 FE-only Events）通讯，没有外部 message broker。

---

## 四、双视窗架构

| 视窗            | 大小（最小）         | 用途                                         | 显示策略                                  |
| --------------- | -------------------- | -------------------------------------------- | ----------------------------------------- |
| **HUD**         | 470×100              | 状态浮窗（录音/转录/整理/完成）              | 透明、无装饰、永远最上层、预设不显示       |
| **Dashboard**   | 960×680（720×480）   | 设定 / 历史 / 字典 / 统计 / 功能导览         | 标准视窗、预设隐藏、缺 API Key 才强制显示 |

两个视窗共用同一 SQLite 连线池，但独立 mount 两棵 Vue 树（Vite 多入口）。

---

## 五、文件导引

### 5.1 规范性文件（authoritative，必读）

| 文件                                                     | 用途                                         |
| -------------------------------------------------------- | -------------------------------------------- |
| `_bmad-output/project-context.md`                        | 全部 AI Agent 实作规则                        |
| `CLAUDE.md`                                              | Claude Code 专案记忆 + IPC 契约表 + Hook 设定 |
| `_bmad-output/planning-artifacts/architecture.md`        | 架构决策（ADR）                              |
| `_bmad-output/planning-artifacts/ux-ui-design-spec.md`   | UI 设计、色彩、元件规范                      |
| `design.pen`                                             | 可选的历史 UI 设计稿参考                      |

### 5.2 本次扫描产出（docs/）

| 文件                                                     | 用途                                          |
| -------------------------------------------------------- | --------------------------------------------- |
| [index.md](./index.md)                                   | 主索引（从这里开始）                          |
| [source-tree-analysis.md](./source-tree-analysis.md)     | 全专案注解过的目录树                          |
| [architecture-frontend.md](./architecture-frontend.md)   | Frontend part 架构                            |
| [architecture-backend.md](./architecture-backend.md)     | Backend part 架构                             |
| [integration-architecture.md](./integration-architecture.md) | IPC 整合契约 + 生命周期                   |
| [api-contracts-backend.md](./api-contracts-backend.md)   | Tauri Commands + Events 完整 API              |
| [data-models.md](./data-models.md)                       | SQLite Schema + Store 结构                    |
| [component-inventory-frontend.md](./component-inventory-frontend.md) | UI 元件清单                       |
| [development-guide.md](./development-guide.md)           | 开发环境、指令、常见任务                      |
| [deployment-guide.md](./deployment-guide.md)             | CI/CD、无开发者认证建构、发版流程             |

### 5.3 计划 / 故事 / 规格（_bmad-output/）

- `planning-artifacts/prd.md` — 产品需求文件
- `planning-artifacts/epics.md` — Epic 拆分
- `implementation-artifacts/{n}-{m}-{slug}.md` — 各 story 完成纪录（共 17 个 story）
- `implementation-artifacts/tech-spec-*.md` — 各功能 tech spec（共 14 份）

---

## 六、Quick Reference

| 我想…                              | 看哪个档案                                                        |
| ---------------------------------- | ----------------------------------------------------------------- |
| 改录音流程                         | `src/stores/useVoiceFlowStore.ts`（核心状态机）                   |
| 改设定栏位                         | `src/stores/useSettingsStore.ts` + `src/views/SettingsView.vue`   |
| 加 LLM Provider                    | `src/lib/llmProvider.ts` + `src/lib/modelRegistry.ts`             |
| 加 SQLite 栏位                     | `src/lib/database.ts`（追加 v9 migration，不改旧版）              |
| 加 Tauri Command                   | `src-tauri/src/plugins/*.rs` + `src-tauri/src/lib.rs` invoke_handler! |
| 加 cross-window event              | `src/composables/useTauriEvents.ts` 加常数                        |
| 改视窗大小 / CSP / 权限            | `src-tauri/tauri.conf.json` + `src-tauri/capabilities/default.json` |
| 改 hotkey 逻辑                     | `src-tauri/src/plugins/hotkey_listener.rs`                        |
| 改贴上机制                         | `src-tauri/src/plugins/clipboard_paste.rs`                        |

---

## 七、版本历程（CHANGELOG 摘要）

| 版本    | 重点                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------- |
| 0.9.5   | tauri-plugin-single-instance 跨平台、Windows VK_F23 修复、Sentry sourcemap upload                     |
| 0.9.x   | Multi-provider LLM、Smart Dictionary、Hallucination Detector v3、Edit Mode、i18n、Sound Feedback     |

完整纪录见 [`CHANGELOG.md`](../CHANGELOG.md)。

---

## 八、Getting Started（30 秒）

```bash
# 1. 环境准备
nvm use                                 # Node 24
corepack enable && corepack prepare     # pnpm 10.28.2
rustup default stable

# 2. 安装
pnpm install

# 3. 开发
pnpm tauri dev                           # 同时启动 Vite dev server + Tauri runtime

# 4. 测试
pnpm test                                # Vitest unit + component
npx vue-tsc --noEmit                     # TS 型别检查

# 5. 建构
pnpm build                               # vue-tsc + vite build（不打包成桌面 binary）
pnpm tauri build                         # 打包成 macOS .dmg / Windows .exe
```

更多细节见 [development-guide.md](./development-guide.md)。
