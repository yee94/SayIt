---
name: ipc-review
description: 审查 Rust↔Vue IPC 一致性 — 使用 tauri-reviewer agent 检查 Command 注册、Event 名称、Payload 型别是否前后端对齐。在修改 IPC 相关程式码后使用。
---

# IPC 一致性审查

使用 `tauri-reviewer` subagent 对 Rust 后端与 Vue 前端进行 IPC 契约审查。

## 审查范围

1. **Tauri Commands** — Rust `#[tauri::command]` 是否都在 `invoke_handler` 中注册，前端呼叫的 command 名称是否匹配
2. **Event 名称** — Rust `emit()` 的 event 名称是否与前端 `listen()` 的常量一致
3. **Payload 型别** — Rust `#[derive(Serialize)]` struct 的栏位是否与 TypeScript interface 对齐
4. **CLAUDE.md IPC 契约表** — 检查契约表是否反映最新的程式码状态

## 执行方式

使用 Agent tool 启动 `tauri-reviewer` subagent，指定要审查的具体变更范围（如果有的话）。

## 输出格式

- 列出所有发现的不一致
- 对每项不一致标注严重等级（🔴 断裂、🟡 可能问题、🟢 建议）
- 提供修正建议
