#!/usr/bin/env bash
# eslint.sh — PostToolUse hook
# 在 .ts/.vue 档案编辑后自动执行 eslint --fix
#
# Exit codes:
#   0 = lint 通过或非目标档案（静默）
#   1 = lint 错误（非阻断，Claude 可看到错误并自行修正）

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# 无 file_path → 静默通过
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# 仅对 .ts / .vue 档案触发
case "$FILE_PATH" in
  *.ts|*.vue) ;;
  *) exit 0 ;;
esac

# 跳过 shadcn-vue 生成元件
case "$FILE_PATH" in
  */components/ui/*) exit 0 ;;
esac

# 确认档案存在
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# 执行 eslint --fix
OUTPUT=$(npx eslint --fix "$FILE_PATH" 2>&1) || true
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "⚠️ eslint 发现问题："
  echo "$OUTPUT" | head -20
  exit 1
fi

exit 0
