#!/usr/bin/env bash
# protect-config.sh — PreToolUse hook
# 保护设定档和 lock 档不被 Claude 意外修改
#
# Exit codes:
#   0 = 通过（可选 stdout 警告）
#   2 = hard block（stderr JSON 格式 block reason）

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# 无 file_path → 静默通过
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

# Lock 档：hard block
case "$BASENAME" in
  Cargo.lock|pnpm-lock.yaml|package-lock.json|yarn.lock)
    echo '{"error":"Lock 档由套件管理工具自动产生，禁止手动修改。请用 pnpm install 或 cargo build 更新。"}' >&2
    exit 2
    ;;
esac

# 设定档：警告但不阻断
case "$BASENAME" in
  tauri.conf.json)
    echo "⚠️ 你正在修改 tauri.conf.json — 这是 Tauri 核心设定档，请确认变更必要性（视窗配置、CSP、capabilities）。"
    exit 0
    ;;
  Cargo.toml)
    echo "⚠️ 你正在修改 Cargo.toml — 新增/移除 crate 可能影响编译和 binary size，请确认必要性。"
    exit 0
    ;;
esac

# 其他档案：静默通过
exit 0
