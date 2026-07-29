<p align="center">
  <img src="docs/Banner.png" alt="SayIt — 按住说话，松开粘贴" width="100%" />
</p>

<h1 align="center">🎙️ SayIt</h1>

<p align="center">
  <strong>按住说话 · 松开粘贴 · 说完即用</strong><br/>
  在任意 App 里开口，AI 把口语整理成书面语，自动贴到光标位置。
</p>

<p align="center">
  <a href="https://github.com/yee94/SayIt/releases/latest"><img src="https://img.shields.io/github/v/release/yee94/SayIt?style=for-the-badge&label=release&color=f97316" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6?style=for-the-badge" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111827?style=for-the-badge" alt="Platform" />
</p>

<p align="center">
  <a href="https://github.com/yee94/SayIt/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yee94/SayIt/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/github/last-commit/yee94/SayIt?style=flat-square&color=6366f1" alt="Last Commit" />
  <img src="https://img.shields.io/github/stars/yee94/SayIt?style=flat-square&color=eab308" alt="Stars" />
  <img src="https://img.shields.io/badge/downloads-GitHub%20Releases-0ea5e9?style=flat-square" alt="Downloads" />
  <img src="https://img.shields.io/badge/i18n-zh--CN%20%7C%20en%20%7C%20ja%20%7C%20ko-10b981?style=flat-square" alt="i18n" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/Rust-stable-dea584?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p align="center">
  <a href="#-为什么选-sayit">为什么选它</a> ·
  <a href="#-核心能力">功能</a> ·
  <a href="#-下载安装">下载</a> ·
  <a href="#-三步上手">上手</a> ·
  <a href="#-工作原理">原理</a> ·
  <a href="#-本地开发">开发</a>
</p>

---

## 💡 为什么选 SayIt

打字跟不上脑子？消息回得慢、笔记懒得记、PR 描述总是拖到最后？

现有方案往往各有缺口：

| 方案 | 常见问题 |
|------|----------|
| 系统听写 | 口语赘词全留着，事后还要大改 |
| 复杂本地工具 | 模型管理、一堆 Provider，上手成本高 |
| 订阅制产品 | 额度 / 价格门槛 |

**SayIt 只做一件事，并做到极致：**

```
按住快捷键 → 说话 → 松开 → 书面语出现在光标处
```

不切窗口、不手动复制、不事后清口语。  
写邮件、回 Slack、记会议、填文档、改代码注释——想到就说。

---

## ✨ 核心能力

### 🎤 语音输入：说完就能用

| | 能力 | 说明 |
|:-:|------|------|
| 🗣️ | **口语 → 书面语** | 去赘词、修错字、补标点；「精简 / 积极 / 自定义」三种整理强度 |
| 📡 | **实时字幕** | 录音中 HUD 持续显示识别文字（豆包 SeedASR 流式） |
| 📋 | **自动粘贴** | 整理完成直接贴入当前光标，端到端「说完即用」 |
| 🛡️ | **语意守卫** | AI 若与原文脱钩，自动回退原始逐字稿，拒绝胡写 |

### ✏️ 编辑选取：选中 → 说指令 → 改好贴回

选中一段文字，按快捷键，直接说你想怎么改：

- 「翻成中文」
- 「改正式一点」
- 「缩短成一句话」
- 「改成 commit message」

适合翻译、改写、摘要、润色，不用打开任何聊天窗口。

### ⌨️ 全局快捷键：随手触发

| 能力 | 你能做什么 |
|------|------------|
| **Hold / Toggle** | 按住说话像对讲机，或按一下开始、再按一下结束 |
| **单键 / 组合键** | `Fn`、右 `Option`，或 `⌘+J` 等组合，降低误触 |
| **双击切模式** | 连按两下，在「精简 ↔ 积极」间切换，不用进设置 |
| **ESC 中止** | 说错了？ESC 立刻取消本轮 |
| **Notch 风格 HUD** | 顶部浮层：波形、模式、计时、实时字幕一目了然 |

### 📚 自定义字典：越用越准

- 手动添加专有名词、品牌名、团队黑话
- **智能学习**：从你的修正里自动收录新词
- **Typeless 一键导入**（macOS）：本机 Typeless 词典批量迁入，重复项自动跳过

### 📊 Dashboard：历史 · 统计 · 设置

| 模块 | 亮点 |
|------|------|
| 🕒 **历史** | 搜索、复制、回放录音、从磁盘重新转录 |
| 📈 **统计** | 用量趋势、今日消耗，心里有数 |
| ⚙️ **设置** | 热键、麦克风、Prompt、凭据、开机启动 |
| 🧭 **功能导览** | 内置介绍页，新用户两分钟摸清全部玩法 |

### 🎯 细节体验（真·用过才懂）

| | 特性 |
|:-:|------|
| 🔇 | 录音时**自动静音系统扬声器**，减少回声 |
| 🔊 | 开始 / 结束 / 错误 / 学到新词的**音效反馈** |
| 🎚️ | **麦克风选择** + 实时音量预览 |
| 📎 | 粘贴后可选**还原剪贴板**，不冲掉你原来复制的内容 |
| 🚀 | 开机自启、菜单栏常驻、自动检查更新 |
| 🌍 | 界面四语：**简体中文 / English / 日本語 / 한국어** |
| 🍎 | macOS Dock 智能显示：开 Dashboard 才出现，关完只留菜单栏 |

---

## 📥 下载安装

| 平台 | 安装包 | 架构 |
|------|--------|------|
| 🍎 macOS | [**SayIt-mac-arm64.dmg**](https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-arm64.dmg) | Apple Silicon |
| 🍎 macOS | [**SayIt-mac-x64.dmg**](https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-x64.dmg) | Intel |
| 🪟 Windows | [**SayIt-windows-x64.exe**](https://github.com/yee94/SayIt/releases/latest/download/SayIt-windows-x64.exe) | x64 |

👉 全部版本与更新日志：[Releases](https://github.com/yee94/SayIt/releases) · [CHANGELOG](CHANGELOG.md)

> **签名说明**  
> macOS 使用 ad-hoc 签名；Windows 安装包暂未代码签名。  
> 首次打开若被系统拦截：macOS 请到「系统设置 → 隐私与安全性」允许打开；Windows 选「仍要运行」。

---

## ⚡ 三步上手

```
① 安装打开  →  ② 填凭据  →  ③ 按住说话
```

### 1. 安装并打开 SayIt

macOS 首次使用需授予 **「辅助使用」** 权限（全局热键 + 自动粘贴依赖它）。  
App 内有权限引导页，跟着点就行。

### 2. 配置凭据

| 用途 | 去哪拿 | 填什么 |
|------|--------|--------|
| 🎙️ **语音转写** | [火山引擎控制台](https://console.volcengine.com/) | 豆包 ASR 的 **App ID** + **Access Key** |
| 🧠 **文字整理** | 任意 OpenAI 兼容服务 | **Base URL** + **API Key** + **Model ID** |

设置页有 **「测试连接」**，ASR / LLM 是否通一目了然。

> LLM 支持任意 OpenAI 兼容接口——OpenAI、Groq、Gemini 兼容端点、本地 Ollama、公司内网网关……只要长得像 `/v1/chat/completions` 就能接。

### 3. 按住快捷键说话

松开后：转写 → AI 整理 → 自动粘贴。  
第一次看到口语变成干净书面语，就是 aha moment 🎉

---

## 🔄 工作原理

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌────────────┐
│  全局热键   │ →  │  豆包 SeedASR    │ →  │  OpenAI 兼容    │ →  │  自动粘贴  │
│  Hold/Toggle│    │  流式实时识别    │    │  LLM 书面语整理 │    │  到光标处  │
└─────────────┘    └──────────────────┘    └─────────────────┘    └────────────┘
        │                    │                       │                    │
        ▼                    ▼                       ▼                    ▼
   Notch HUD            实时字幕               精简/积极/自定义      可选还原剪贴板
   波形 · 计时          + 字典注入              + 语意守卫回退
```

**双窗口架构**

| 窗口 | 角色 |
|------|------|
| 🎯 **HUD** | 透明、置顶、无边框的状态浮层（录音 / 转写 / 整理 / 完成） |
| 🖥️ **Dashboard** | 设置、历史、字典、统计、功能导览（默认隐藏，需要时打开） |

后端是 **Tauri v2 + Rust** 原生能力（热键、音频、剪贴板、辅助功能）；前端是 **Vue 3** 负责体验与配置。数据本地落在 **SQLite**，API Key 走加密 store——不进数据库。

---

## 🏗️ 技术栈

<p>
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/Vue-3.5-42b883?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TS" />
  <img src="https://img.shields.io/badge/Rust-2021-dea584?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Tailwind-4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Vite-6-646cff?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
</p>

| 层级 | 选型 |
|------|------|
| 🖥️ 桌面壳 | Tauri v2（轻量、原生能力强） |
| 🎨 前端 | Vue 3 · TypeScript · Pinia · Vue Router · shadcn-vue · Tailwind 4 |
| ⚙️ 后端 | Rust（音频采集、热键、剪贴板粘贴、系统音频控制） |
| 🎙️ 语音转写 | 豆包 SeedASR（流式实时） |
| 🧠 文字整理 | OpenAI 兼容 Chat Completions |
| 💾 存储 | SQLite（历史 / 字典）+ tauri-plugin-store（凭据） |
| 🧪 测试 | Vitest · Playwright · Rust unit tests |
| 📡 观测 | Sentry（正式版前端 + Rust） |
| 🚀 发布 | GitHub Actions 三平台矩阵 · ad-hoc macOS · 自动 Release |

---

## 🛠️ 本地开发

**环境**

| 工具 | 版本 |
|------|------|
| Node.js | **24**（见 `.nvmrc`） |
| pnpm | **10.28.2**（`corepack enable`） |
| Rust | **stable** |

```bash
# 安装依赖
pnpm install

# 开发（独立开发版标识，可与正式版共存）
pnpm tauri:dev

# 质量检查
pnpm build              # vue-tsc + Vite 构建
pnpm test               # Vitest 单元 / 组件测试
pnpm test:e2e           # Playwright
npx vue-tsc --noEmit    # 仅类型检查

# 打包桌面应用
pnpm tauri build
```

**发版**

```bash
./scripts/release.sh 0.12.3
# 同步 package.json / tauri.conf / Cargo.toml 版本号
# → git tag → push → CI 质量门禁 → 三平台安装包 → GitHub Release
```

更细的架构、IPC 契约与目录说明：

| 文档 | 内容 |
|------|------|
| [`docs/`](docs/) | 项目总览、前后端架构、开发与部署指南 |
| [`CLAUDE.md`](CLAUDE.md) | Agent 用项目记忆 + IPC 契约表 |
| [`_bmad-output/project-context.md`](_bmad-output/project-context.md) | 完整实现规则 |

---

## 🗺️ 路线与版本

当前版本 **v0.12.x** 已覆盖主线能力：流式 ASR、编辑选取、智能字典、四语界面、OpenAI 兼容 LLM、跨平台热键等。

近期亮点（摘要）：

- 📡 录音中实时字幕（SeedASR 流式）
- 📥 Typeless 词典一键导入（macOS）
- 🛡️ 语意守卫 / 幻觉回退
- 🍎 Dock 智能显示与简化设置

完整变更见 [**CHANGELOG.md**](CHANGELOG.md)。

---

## 🤝 贡献

欢迎 Issue / PR！

1. Fork 本仓库  
2. 开 feature 分支：`git checkout -b feat/your-idea`  
3. 本地跑通 `pnpm test` 与类型检查  
4. 开 PR，简单说明动机与验证方式  

提交前建议：

- 中文文案一律使用 **简体中文**（日语 locale 保持日语）  
- 前端走 `<script setup lang="ts">`，UI 优先 shadcn-vue  
- 涉及 IPC 时同步检查 Command / Event 前后端对齐  

---

## 📄 License

[MIT](LICENSE) © 2026 Tai-Cheng Chen

---

<p align="center">
  <strong>想到就说 · 说完即用</strong><br/>
  <sub>Made for people who type slower than they think ✨</sub>
</p>
```
