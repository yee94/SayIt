#!/bin/bash
set -euo pipefail

# SayIt 发版脚本
# 用法: ./scripts/release.sh 0.2.0

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
  echo "目前版本: $CURRENT"
  echo "用法: ./scripts/release.sh <新版本号>"
  echo "范例: ./scripts/release.sh 0.2.0"
  exit 1
fi

# 验证版本号格式
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "错误: 版本号格式不正确，需要 X.Y.Z 格式"
  exit 1
fi

CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
echo "版本更新: $CURRENT → $VERSION"

# 确认 CHANGELOG.md 已更新
if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
  echo "错误: CHANGELOG.md 缺少 v$VERSION 的纪录"
  echo "请先新增 '## [$VERSION]' 区块再执行发版"
  exit 1
fi
echo "✓ CHANGELOG.md 已包含 v$VERSION 纪录"

# 确认 working tree 干净
if [ -n "$(git status --porcelain)" ]; then
  echo "错误: 有未 commit 的变更，请先处理"
  git status --short
  exit 1
fi

# 确认 tag 不存在
if git tag -l "v$VERSION" | grep -q "v$VERSION"; then
  echo "错误: tag v$VERSION 已存在"
  exit 1
fi

# 确认目前在分支上，避免 detached HEAD 推送失败
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
  echo "错误: 目前不在 git branch 上，无法执行发版"
  exit 1
fi

# 更新版本号（四个档案需同步）
jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > tmp.json && mv tmp.json src-tauri/tauri.conf.json
jq --arg v "$VERSION" '.version = $v' package.json > tmp.json && mv tmp.json package.json
python3 - <<PY
from pathlib import Path
path = Path("src-tauri/Cargo.toml")
text = path.read_text()
old = 'version = "{}"'.format("${CURRENT}")
new = 'version = "{}"'.format("${VERSION}")
if old not in text:
    raise SystemExit("错误: Cargo.toml 找不到目前版本字串")
path.write_text(text.replace(old, new, 1))
PY
python3 - <<PY
from pathlib import Path
path = Path("src-tauri/Cargo.lock")
text = path.read_text()
old = 'name = "sayit"\nversion = "{}"'.format("${CURRENT}")
new = 'name = "sayit"\nversion = "{}"'.format("${VERSION}")
if old not in text:
    raise SystemExit("错误: Cargo.lock 找不到 sayit 版本字串")
path.write_text(text.replace(old, new, 1))
PY

PACKAGE_VERSION=$(jq -r .version package.json)
TAURI_VERSION=$(jq -r .version src-tauri/tauri.conf.json)
CARGO_VERSION=$(python3 - <<'PY'
from pathlib import Path
for line in Path("src-tauri/Cargo.toml").read_text().splitlines():
    if line.startswith("version = "):
        print(line.split('"')[1])
        break
PY
)

if [ "$PACKAGE_VERSION" != "$VERSION" ] || [ "$TAURI_VERSION" != "$VERSION" ] || [ "$CARGO_VERSION" != "$VERSION" ]; then
  echo "错误: 版本同步检查失败"
  exit 1
fi

echo "✓ 已更新 package.json、tauri.conf.json、Cargo.toml、Cargo.lock"

# Commit + Tag + Push（分开推送避免 GitHub Actions tag 事件遗失）
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push origin "$CURRENT_BRANCH"
git push origin "v$VERSION"

echo ""
echo "✓ 已推送 v$VERSION"
echo "→ Release workflow 已触发，完成后会自动公开 GitHub Release"
echo "  https://github.com/yee94/SayIt/releases"
