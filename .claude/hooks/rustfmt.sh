#!/usr/bin/env bash
# rustfmt.sh — PostToolUse hook
# 在 .rs 档案编辑后自动执行 rustfmt 格式化
#
# Exit codes:
#   0 = 格式化成功或非 .rs 档案（静默）
#   1 = 格式化失败（非阻断，Claude 可看到错误）

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# 无 file_path → 静默通过
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# 仅对 .rs 档案触发
case "$FILE_PATH" in
  *.rs) ;;
  *) exit 0 ;;
esac

# 确认档案存在
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# 执行 rustfmt
OUTPUT=$(rustfmt "$FILE_PATH" 2>&1) || true
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "❌ rustfmt 格式化失败："
  echo "$OUTPUT"
  exit 1
fi

exit 0
