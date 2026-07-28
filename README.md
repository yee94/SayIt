# SayIt

> 按住说话，松开粘贴 — 跨平台语音输入桌面工具

在任意应用中按快捷键说话，松开后自动转写、AI 整理，并粘贴到光标位置。

## 功能

- **口语 → 书面语** — 修错字、去赘词、补标点，可选精简 / 积极整理
- **全局快捷键** — Hold / Toggle，支持组合键
- **自定义字典** — 专有名词、术语优先识别，可智能学习
- **历史与统计** — 自动保存转录，Dashboard 查看用量
- **多语言界面** — 简体中文、English、日本語、한국어

## 下载

| 平台 | 链接 |
|------|------|
| macOS ARM | [SayIt-mac-arm64.dmg](https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-arm64.dmg) |
| macOS Intel | [SayIt-mac-x64.dmg](https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-x64.dmg) |
| Windows | [SayIt-windows-x64.exe](https://github.com/yee94/SayIt/releases/latest/download/SayIt-windows-x64.exe) |

## 快速开始

1. 安装并打开 SayIt  
2. 设置 → 填写 [豆包 ASR](https://console.volcengine.com/) 凭据（语音转写）  
3. 设置 → 配置 LLM 服务（文字整理，OpenAI 兼容接口）  
4. 按住快捷键说话，松开后文字自动粘贴  

macOS 首次使用需授予「辅助使用」权限。

## 技术栈

```
Tauri v2 (Rust) + Vue 3 + TypeScript + shadcn-vue
  · 语音转写：豆包 SeedASR
  · 文字整理：OpenAI 兼容 LLM
  · 存储：SQLite + tauri-plugin-store
```

双窗口：HUD（状态浮层）+ Dashboard（设置 / 历史 / 字典 / 统计）。

## 开发

```bash
# 环境：Node.js 24、pnpm 10、Rust stable

pnpm install
pnpm tauri:dev      # 使用独立开发版标识启动
pnpm build          # 前端构建（含类型检查）
pnpm test           # 单元 / 组件测试
pnpm tauri build    # 打包
```

发版：

```bash
./scripts/release.sh 0.12.0
# 更新版本号 → tag → push → GitHub Actions 测试与构建 → 自动发布 Release
```

## License

[MIT](LICENSE)
