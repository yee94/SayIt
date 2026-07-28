#!/bin/bash
set -euo pipefail

# SayIt 發版腳本
# 用法: ./scripts/release.sh 0.2.0

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
  echo "目前版本: $CURRENT"
  echo "用法: ./scripts/release.sh <新版本號>"
  echo "範例: ./scripts/release.sh 0.2.0"
  exit 1
fi

# 驗證版本號格式
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "錯誤: 版本號格式不正確，需要 X.Y.Z 格式"
  exit 1
fi

CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
echo "版本更新: $CURRENT → $VERSION"

# 確認 CHANGELOG.md 已更新
if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
  echo "錯誤: CHANGELOG.md 缺少 v$VERSION 的紀錄"
  echo "請先新增 '## [$VERSION]' 區塊再執行發版"
  exit 1
fi
echo "✓ CHANGELOG.md 已包含 v$VERSION 紀錄"

# 確認 working tree 乾淨
if [ -n "$(git status --porcelain)" ]; then
  echo "錯誤: 有未 commit 的變更，請先處理"
  git status --short
  exit 1
fi

# 確認 tag 不存在
if git tag -l "v$VERSION" | grep -q "v$VERSION"; then
  echo "錯誤: tag v$VERSION 已存在"
  exit 1
fi

# 確認目前在分支上，避免 detached HEAD 推送失敗
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
  echo "錯誤: 目前不在 git branch 上，無法執行發版"
  exit 1
fi

# 更新版本號（四個檔案需同步）
jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > tmp.json && mv tmp.json src-tauri/tauri.conf.json
jq --arg v "$VERSION" '.version = $v' package.json > tmp.json && mv tmp.json package.json
python3 - <<PY
from pathlib import Path
path = Path("src-tauri/Cargo.toml")
text = path.read_text()
old = 'version = "{}"'.format("${CURRENT}")
new = 'version = "{}"'.format("${VERSION}")
if old not in text:
    raise SystemExit("錯誤: Cargo.toml 找不到目前版本字串")
path.write_text(text.replace(old, new, 1))
PY
python3 - <<PY
from pathlib import Path
path = Path("src-tauri/Cargo.lock")
text = path.read_text()
old = 'name = "sayit"\nversion = "{}"'.format("${CURRENT}")
new = 'name = "sayit"\nversion = "{}"'.format("${VERSION}")
if old not in text:
    raise SystemExit("錯誤: Cargo.lock 找不到 sayit 版本字串")
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
  echo "錯誤: 版本同步檢查失敗"
  exit 1
fi

echo "✓ 已更新 package.json、tauri.conf.json、Cargo.toml、Cargo.lock"

# Commit + Tag + Push（分開推送避免 GitHub Actions tag 事件遺失）
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push origin "$CURRENT_BRANCH"
git push origin "v$VERSION"

echo ""
echo "✓ 已推送 v$VERSION"
echo "→ Release workflow 已觸發，完成後會自動公開 GitHub Release"
echo "  https://github.com/yee94/SayIt/releases"
