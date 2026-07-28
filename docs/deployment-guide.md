# Deployment Guide

> CI/CD pipeline、无开发者认证建构、自动更新签名、发版流程
> 扫描日期：2026-05-08 · 版本：0.9.5

---

## 一、CI/CD 概览

```
push/PR to main           push tag v*
       │                        │
       ▼                        ▼
 ┌──────────┐         ┌─────────────────────────────────┐
 │  ci.yml  │         │       release.yml               │
 │  ──────  │         │  ────────────────────────────   │
 │ vue-tsc  │         │  frontend-check + rust-check    │
 │ vitest   │         │              │                  │
 │ clippy   │         │              ▼                  │
 │ rust test│         │  Job: build (matrix · 3)        │
 └──────────┘         │   ├── macOS arm64（ad-hoc）     │
                      │   ├── macOS x64（ad-hoc）       │
                      │   └── Windows x64（未签名）     │
                      │  + tauri-action                 │
                      │   - Updater .sig                │
                      │  + Sentry sourcemap upload      │
                      │     (mac arm64 only)            │
                      │  + 上传稳定档名（gh release）   │
                      │                                 │
                      │  Job: publish-release           │
                      │   gh release edit --draft=false │
                      └─────────────────────────────────┘
```

---

## 二、ci.yml（每次 push / PR）

### 2.1 Frontend job (`check`, ubuntu-latest)
```
1. checkout
2. setup-node (从 .nvmrc → 24)
3. pnpm setup
4. pnpm install --frozen-lockfile
5. npx vue-tsc --noEmit       ← 型别检查
6. pnpm test                  ← Vitest unit + component
```

### 2.2 Rust job (`rust-check`, matrix)
```
matrix:
  - macos-latest
  - windows-latest

steps:
  1. checkout
  2. dtolnay/rust-toolchain@stable
  3. swatinem/rust-cache@v2 (workspaces: src-tauri)
  4. cargo check (working-directory: src-tauri)
```

### 2.3 Release 品质门禁

`release.yml` 会重跑 vue-tsc、ESLint、Vitest，以及 macOS/Windows 的 Cargo clippy 与 Cargo test。三平台安装包只有在全部检查通过后才开始建构。

---

## 三、release.yml（tag push v*）

### 3.1 触发

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag: { description: 'Tag to build (e.g. v0.2.0)', required: true }
```

### 3.2 Build matrix（3 个平台）

| Platform        | Args                              | Stable Name                  | Sourcemaps |
| --------------- | --------------------------------- | ---------------------------- | ---------- |
| macos-latest    | `--target aarch64-apple-darwin`   | `SayIt-mac-arm64.dmg`        | **true**（唯一上传） |
| macos-latest    | `--target x86_64-apple-darwin`    | `SayIt-mac-x64.dmg`          | false      |
| windows-latest  | （空）                             | `SayIt-windows-x64.exe`      | false      |

### 3.3 Release metadata 解析

```bash
# 从 tag 或 workflow_dispatch input 取
RAW_TAG="${tag#refs/tags/}"
RELEASE_VERSION="${RAW_TAG#v}"

# 推到 GITHUB_ENV：
RELEASE_TAG=v0.9.5
RELEASE_VERSION=0.9.5
SENTRY_RELEASE=sayit@0.9.5
VITE_SENTRY_RELEASE=sayit@0.9.5
```

### 3.4 主要 step：`tauri-apps/tauri-action@v0`

注入下列 env：

```
TAURI_SIGNING_PRIVATE_KEY              ← Updater 签署私钥
TAURI_SIGNING_PRIVATE_KEY_PASSWORD     ← 私钥密码

# Sentry
SENTRY_DSN, VITE_SENTRY_DSN
SENTRY_ENVIRONMENT=production
VITE_SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=sayit@<version>
VITE_SENTRY_RELEASE=sayit@<version>
VITE_SENTRY_SOURCEMAPS_ENABLED=<matrix.upload_sourcemaps>
```

with：

```yaml
tagName: ${{ env.RELEASE_TAG }}
releaseName: "SayIt v${{ env.RELEASE_VERSION }}"
releaseBody: "See the assets to download and install this version."
releaseDraft: true              ← 先建 Draft，最后一个 job 才 publish
prerelease: false
args: ${{ matrix.args }}
```

### 3.5 Sourcemap upload（mac arm64 only）

```bash
npx @sentry/cli releases new "$SENTRY_RELEASE" || true
npx @sentry/cli sourcemaps upload dist/assets \
  --release "$SENTRY_RELEASE" \
  --url-prefix "~/assets" \
  --validate \
  --wait
npx @sentry/cli releases finalize "$SENTRY_RELEASE" || true
```

> 为什么只在 mac arm64 跑？避免重复上传同份 sourcemap（两个 mac build 与 Windows build 共用同一份前端 bundle）。

### 3.6 上传稳定档名

GitHub Release 的 default asset 命名为 `SayIt_0.9.5_aarch64.dmg` 等版本号内嵌格式 — 这对「永远最新版」连结（`releases/latest/download/...`）不友善。

额外步骤把 dmg / exe 重新命名后上传：

```bash
# macOS
DMG=$(find src-tauri/target -path "*/bundle/dmg/*.dmg" | head -1)
cp "$DMG" "${{ matrix.stable_name }}"
gh release upload "$RELEASE_TAG" "${{ matrix.stable_name }}" --clobber

# Windows (PowerShell)
$exe = Get-ChildItem ... -Filter "*-setup.exe" | Select -First 1
Copy-Item $exe.FullName "${{ matrix.stable_name }}"
gh release upload "$env:RELEASE_TAG" "${{ matrix.stable_name }}" --clobber
```

### 3.7 Job 2：`publish-release`

```bash
gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false
```

> 等 build job 全跑完再 publish — 确保不会出现「半完成」release。

---

## 四、发版流程（人工 + 自动）

### 4.1 前置作业

```
1. 确认 main 上的所有 PR 都已合并
2. 更新 CHANGELOG.md：
   ## [0.9.5] - 2026-05-01
   ### Added
   ### Fixed
   ### Changed
3. git add CHANGELOG.md && git commit -m "docs: changelog v0.9.5"
4. git push
```

### 4.2 执行 release 脚本

```bash
./scripts/release.sh 0.9.5
```

脚本会：
1. 验证版本号格式 `^[0-9]+\.[0-9]+\.[0-9]+$`
2. 确认 CHANGELOG.md 包含 `## [0.9.5]` 区块
3. 确认 working tree 干净
4. 确认 tag `v0.9.5` 不存在
5. 确认在 git branch 上（非 detached HEAD）
6. **同步更新四个档案**的版本号：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`（搜 `name = "sayit"\nversion = "..."`）
7. `git commit -m "chore: bump version to 0.9.5"`
8. `git tag v0.9.5`
9. `git push origin <branch>` + `git push origin v0.9.5`（**分开 push**，避免 GitHub Actions tag 事件遗失）

### 4.3 自动建构（GitHub Actions）

tag push 后自动触发 `release.yml`：
- 三个 build job 平行跑（mac arm64 / mac x64 / windows）
- 完成后 `publish-release` job 把 Draft Release 改为 Published

时间：依 GitHub Actions runner 与跨平台测试、建构速度而定。

### 4.4 验证 Release

```
1. GitHub Releases 页面确认 v0.9.5 已 Published
2. 检查附件：
   - SayIt-mac-arm64.dmg（稳定档名）
   - SayIt-mac-x64.dmg
   - SayIt-windows-x64.exe
   - 自动命名版（SayIt_0.9.5_*.dmg / .exe）
   - latest.json（updater）
   - 对应的 .sig 档（updater 签名）
3. 下载 .dmg → 开启 → 用 Finder 右键「打开」完成首次授权
4. 检查 Sentry：
   - Releases 页面看到 sayit@0.9.5
   - Sourcemaps 已上传（前端 stack trace 应该有原始档名）
5. 启动 app → 设定页面确认版本号显示 0.9.5
```

---

## 五、无开发者认证的安装包

### 5.1 macOS ad-hoc 签名

- `src-tauri/tauri.conf.json` 固定使用 `"signingIdentity": "-"`。
- 建构流程不使用 Apple Developer ID，也不提交 notarization。
- 从网路下载后，macOS 会显示未认证开发者警告；使用者需透过 Finder 右键「打开」，或在「隐私权与安全性」中允许。

### 5.2 Windows 未签名安装包

- Windows 安装器不使用 Authenticode 凭证。
- SmartScreen 可能显示未知发行者警告，使用者可选择继续安装。

### 5.3 必要 entitlements（`src-tauri/Entitlements.plist`）

要的权限（节录）：
- `com.apple.security.device.audio-input`（麦克风）
- `com.apple.security.automation.apple-events`（Apple Events）

### 5.4 自动更新签名

`tauri-plugin-updater` 用 minisign 签名：

- 私钥只存放在 GitHub Secrets，本机路径与密码不得写入版本库
- 公钥：嵌入 `tauri.conf.json` 的 `plugins.updater.pubkey`
- Updater endpoint：`https://github.com/yee94/SayIt/releases/latest/download/latest.json`

每次 release.yml 跑时：
- tauri-action 用 `TAURI_SIGNING_PRIVATE_KEY` + 密码产 `latest.json` + 各平台 `.sig` 档
- 上传到 GitHub Release

---

## 六、GitHub Secrets（7 个）

| Secret                                  | 用途                                            |
| --------------------------------------- | ----------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`             | Updater 签署私钥                                |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`    | 私钥密码                                        |
| `SENTRY_DSN`                            | Rust 正式版 Sentry DSN                          |
| `VITE_SENTRY_DSN`                       | Frontend 正式版 Sentry DSN                      |
| `SENTRY_AUTH_TOKEN`                     | Sentry sourcemap upload token                   |
| `SENTRY_ORG`                            | Sentry organization slug                        |
| `SENTRY_PROJECT`                        | Sentry project slug                             |

> dev / staging 环境用本机 `.env`（不入版本）；secrets 只在 release.yml 注入。

---

## 七、Sentry Release 规则（硬规则）

1. **Release 名称固定**：`sayit@<version>`（前端 + 后端必须相同）
2. **正式版 Sentry release 一律由 release.yml 产生**，前端与 Rust **不可** 各自手动指定不同名称
3. **Sourcemap upload 只能走 release.yml 的 mac arm64 job**，不可绕过 workflow 手动上传
4. **dev / staging 不上报**：Rust 端 `is_sentry_enabled()` 检查 `production`；前端 `initSentryFor*()` 检查 DSN

---

## 八、固定下载 URL（官网连结）

```
macOS ARM:
  https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-arm64.dmg

macOS Intel:
  https://github.com/yee94/SayIt/releases/latest/download/SayIt-mac-x64.dmg

Windows:
  https://github.com/yee94/SayIt/releases/latest/download/SayIt-windows-x64.exe

Updater latest.json:
  https://github.com/yee94/SayIt/releases/latest/download/latest.json
```

---

## 九、回滚 / 撤回 release

```bash
# 1. 标记为 prerelease（不在 latest 连结）
gh release edit v0.9.5 --prerelease

# 2. 完全删除（极端情况，会破坏 updater）
gh release delete v0.9.5
git push --delete origin v0.9.5
```

> ⚠️ 不要直接删除 release — `tauri-plugin-updater` 已下载这个版本的使用者下次检查更新会 404，而非降级。优先做法是发 v0.9.6 修复后通知使用者更新。

---

## 十、发版前的硬性检查

```
□ git tag v<version> 不存在
□ package.json / tauri.conf.json / Cargo.toml / Cargo.lock 版本号一致
□ CHANGELOG.md 有 [<version>] 区块
□ working tree 干净
□ CI 全绿（main 分支）
□ GitHub Secrets 7 个齐全
□ ./scripts/release.sh 执行成功
□ release.yml 三个 build job 全跑完
□ publish-release job 完成（Draft → Published）
□ 下载 .dmg / .exe 实机测试
□ Sentry sourcemap 已上传（mac arm64）
```
