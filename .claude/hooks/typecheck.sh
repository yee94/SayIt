#!/usr/bin/env bash
# typecheck.sh — PostToolUse hook
# 在 .ts/.vue 档案编辑后自动执行 vue-tsc 型别检查
#
# Exit codes:
#   0 = 型别检查通过（静默）
#   1 = 型别错误（非阻断，Claude 可看到错误并自行修正）

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

# 排除测试档案和型别定义档（避免不必要的检查）
case "$FILE_PATH" in
  *.test.ts|*.spec.ts|*.d.ts) exit 0 ;;
esac

# 执行 vue-tsc 型别检查
OUTPUT=$(npx vue-tsc --noEmit 2>&1 | head -30) || true
EXIT_CODE=${PIPESTATUS[0]}

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "❌ vue-tsc 型别检查失败："
  echo "$OUTPUT"
  exit 1
fi

# 型别检查通过 → 静默
exit 0
