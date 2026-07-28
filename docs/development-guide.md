# Development Guide

> 本机开发、测试、除错、常见任务
> 扫描日期：2026-05-08 · 版本：0.9.5

---

## 一、Prerequisites

| 项目        | 版本 / 说明                                          |
| ----------- | ---------------------------------------------------- |
| **Node.js** | **24**（锁定于 `.nvmrc`）— 用 `nvm use` 自动切换     |
| **pnpm**    | **10.28.2**（锁定于 `package.json#packageManager`）— 启用方式：`corepack enable && corepack prepare` |
| **Rust**    | **stable** — `rustup default stable`                 |
| **Xcode CLT** | macOS only — `xcode-select --install`              |
| **MSVC** + Build Tools | Windows only — Visual Studio Installer 安装 C++ build tools |

> 不可用 `npm` / `yarn` 安装；CI 严格使用 pnpm `--frozen-lockfile`。

---

## 二、初次设置

```bash
# 1. clone repo
git clone https://github.com/yee94/SayIt.git
cd SayIt

# 2. 切到正确 Node 版本
nvm use            # → Node 24

# 3. 启用 pnpm（如果还没）
corepack enable
corepack prepare

# 4. 安装依赖（严格依照 lockfile）
pnpm install --frozen-lockfile

# 5. 确认 Rust toolchain
rustup default stable
```

---

## 三、开发指令

### 3.1 启动开发环境

```bash
# 同时启动 Vite dev server (1420) + Tauri runtime
pnpm tauri dev
```

启动流程：
1. Vite dev server 在 `http://localhost:1420` 跑两个 entry（HUD + Dashboard）
2. Tauri 编译 Rust runtime（首次约 1-2 分钟）
3. 开启两个视窗（HUD 预设不可见、Dashboard 可见）

### 3.2 纯 frontend 开发（不启动 Tauri runtime）

```bash
pnpm dev
# 只启 Vite dev server 在 1420，Tauri Command 都会 timeout
```

> 适合单纯改 UI / 纯前端逻辑。但任何 Tauri Command 呼叫会卡住，最好还是用 `pnpm tauri dev`。

### 3.3 型别检查

```bash
npx vue-tsc --noEmit          # 一次性
```

> hook 设定：`.claude/settings.json` 的 `typecheck.sh` 会在每次编辑 `.ts` / `.vue` 后自动跑（**非阻断**，仅报告）。

### 3.4 测试

```bash
pnpm test                     # Vitest unit + component
pnpm test:watch               # watch mode
pnpm test:coverage            # 覆盖率报告（@vitest/coverage-v8）
pnpm test:e2e                 # Playwright E2E
pnpm test:e2e:ui              # Playwright UI mode
```

Rust 测试：
```bash
cd src-tauri
cargo test --workspace        # 全部 Rust tests
cargo test find_monitor       # 跑特定函式测试
```

### 3.5 Lint / Format

```bash
pnpm exec eslint src --fix    # ESLint（hook 自动跑于编辑后，跳过 components/ui/）
cd src-tauri && cargo fmt     # rustfmt（hook 自动跑）
```

> 目前 Rust 没设 `cargo clippy` 在 CI / hook，建议手动 `cargo clippy --workspace -- -D warnings`。

### 3.6 Build（不打 binary）

```bash
pnpm build                    # vue-tsc --noEmit && vite build → dist/
```

### 3.7 Build 桌面 binary

```bash
pnpm tauri build              # release 模式，产出 macOS .dmg / Windows .exe
pnpm tauri build --debug      # debug 模式（保留 symbols，产出较大但可 debug）
```

> ⚠️ 安全相关功能（CSP、AX 权限、自动更新）必须用 `--debug` 模式测，因为 dev mode 不受 CSP 影响。

---

## 四、常见开发任务

### 4.1 加一个设定栏位

```
1. src/types/settings.ts          ── 加栏位型别
2. src/stores/useSettingsStore.ts ── 加 state、loadSettings、saveSettings 路径
3. src/views/SettingsView.vue     ── 加 UI（用 shadcn-vue 元件）
4. （若需通知）emit 'settings:updated'
```

### 4.2 加一个 Tauri Command

详见 `api-contracts-backend.md` §七的 checklist。摘要：

```
1. src-tauri/src/plugins/<module>.rs ── 写 #[command] fn
2. src-tauri/src/lib.rs               ── 在 invoke_handler! 注册
3. （若有 event）模组顶部加 pub const NAME = "..."
4. src/types/events.ts                ── 加 *Payload 介面
5. src/composables/useTauriEvents.ts  ── 加 event 常数
6. 用 tauri-reviewer subagent 审查
```

### 4.3 加一个 SQLite 栏位

```
1. src/lib/database.ts ── 在 v8 之后追加 v9 migration block
   - DDL（ADD COLUMN）放 transaction 外
   - 用 addColumnIfNotExists() 确保幂等
   - 包 BEGIN/COMMIT 跑 INSERT OR REPLACE schema_version
2. src/types/transcription.ts（或对应档）── 加栏位型别
3. mapRowToRecord 加映射（snake → camel + boolean conversion）
4. 对应 store 写入 / 读取逻辑加上新栏位
```

> ❌ **绝对不要**改旧 migration（v1～v8）— 已部署的使用者那边已经跑过。

### 4.4 加一个 LLM Provider

```
1. src/lib/llmProvider.ts:
   - 在 LlmProviderId 型别加新值
   - 实作 buildFetchParams 对应 case
   - 实作 parseProviderResponse 对应 case
2. src/lib/modelRegistry.ts:
   - 在 LLM_MODEL_LIST 加新模型
   - 设定 providerId 栏位
   - 确认 getDefaultModelIdForProvider 有对应
3. src-tauri/capabilities/default.json ── http:default 加新 URL
4. src-tauri/tauri.conf.json ── connect-src CSP 加新 host（很容易漏！）
```

### 4.5 加一个自订 i18n 字串

```
1. src/i18n/locales/{zh-CN,en,ja,ko}.json ── 四个语系都要加
2. 元件内：const { t } = useI18n(); t('your.key')
3. 全域场景（如 prompt）：i18n.global.t('your.key')
```

---

## 五、Debugging

### 5.1 Webview DevTools

- macOS：右键点 webview → Inspect Element（dev mode 预设启用）
- Windows：相同操作
- Production：DevTools 预设关闭

### 5.2 Rust Console

`pnpm tauri dev` 终端会显示 Rust 端 `println!` / `eprintln!` 输出。

Webview 端可用 `invoke('debug_log', { level: 'info', message: '...' })` 把 log 导向 Rust 终端（适合 production 用 Console.app 抓）。

### 5.3 Sentry

production / staging 环境自动上报；dev 模式不上报（`get_sentry_environment()` 检查）。

### 5.4 Database 查看

```bash
# macOS
sqlite3 ~/Library/Application\ Support/com.sayit.app/app.db

# Windows
sqlite3 %APPDATA%\com.sayit.app\app.db

# 范例查询
> .tables
> SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT 10;
> SELECT version FROM schema_version;
```

⚠️ 开发 dev 模式时 SQLite 仍会用同一个 OS 路径，**dev 与 production data 共用** — 测试破坏性 migration 前先备份 `app.db`。

### 5.5 Tauri Log

`tauri-plugin-log` 没装，所以没有结构化日志；目前靠 `println!` + `eprintln!` + `debug_log` command。

---

## 六、Hooks（自动化）

`.claude/settings.json` 设定四个 PostToolUse / PreToolUse hooks（触发 Edit/Write 工具）：

| Hook                    | 行为                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `protect-config.sh`     | 🔴 阻挡 `Cargo.lock` / `pnpm-lock.yaml` 修改；🟡 警告 `tauri.conf.json` / `Cargo.toml` |
| `typecheck.sh`          | `.ts` / `.vue` 编辑后跑 `vue-tsc --noEmit`（非阻断）                       |
| `rustfmt.sh`            | `.rs` 编辑后跑 `rustfmt`                                                   |
| `eslint.sh`             | `.ts` / `.vue` 编辑后 `eslint --fix`（跳过 `components/ui/`）              |

---

## 七、Code Style

### 7.1 命名

| 类型              | 惯例                       |
| ----------------- | -------------------------- |
| 变数 / 函式       | `camelCase`                |
| Vue 元件 / class  | `PascalCase`               |
| 不可变常数        | `UPPER_SNAKE_CASE`         |
| 资料夹            | `kebab-case`               |
| 型别介面后缀      | `*Props` / `*Dto` / `*Model` / `*Record` / `*Payload` / `*Config` / `*Entry` / `*Handle` |

### 7.2 函式语意

- 4-6 字、动词 + 受词（`generateMonthlySalesReport()` 而非 `genReport()`）
- Boolean 用 `is/has/can/should` 前缀
- 责任后缀：`*Service` / `*Repository` / `*Adapter` / `*Util` / `*Helper`

### 7.3 注解

- 预设不写 — 只在「为什么非显而易见」时加（隐性限制、边界 case、特殊解法）
- 不写「做什么」（识别字已说明）
- 不写「current task / fix / callers」（属于 PR description）

### 7.4 Vue 规范

- `<script setup lang="ts">` only
- 不用 Options API
- 不用 `defineComponent`（改用 setup syntax）

### 7.5 Rust 规范

- 沿用 `rustfmt` 预设 + `cargo clippy` 建议
- macOS / Windows 平台特化用 `#[cfg(target_os = "...")]`
- 不要 panic — 用 `Result<T, E>` 或 `Result<T, String>`

---

## 八、Pre-commit Checklist

```
□ pnpm test                  全部单元测试通过
□ npx vue-tsc --noEmit       无型别错误
□ cargo check (src-tauri)    Rust 编译通过
□ pnpm exec eslint src       ESLint 无错（hook 已自动跑）
□ 若改 IPC：用 tauri-reviewer subagent 双端对齐审查
□ 若改 UI：先在 design.pen 完成设计稿
□ 若改 SQL schema：写 v(N+1) migration 不改旧 migration
```

---

## 九、Subagents（Claude Code）

| Subagent           | 用途                                                            |
| ------------------ | --------------------------------------------------------------- |
| `tauri-reviewer`   | 审查 Rust↔Vue IPC 一致性（Command 注册、Event 名称、Payload 型别） |

---

## 十、Common Pitfalls

| 陷阱                                                                  | 解法                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 用 `fetch()` 直接呼叫 API → CORS 错误                                 | 改用 `import { fetch } from "@tauri-apps/plugin-http"`                              |
| `views/` 直接 `import` lib → 违反依赖规则                              | 改用 Pinia store 包装                                                               |
| dev 模式测 CSP 没问题、prod build 出错                                 | 用 `pnpm tauri build --debug` 测                                                    |
| 改了 `tauri.conf.json` CSP 但忘了改 `capabilities/default.json`        | 两处要同步                                                                          |
| 改了 SQLite migration 写到 v9，但漏了 schema_version INSERT           | 下次启动会重跑（无害但日志会抱怨）                                                  |
| 加 Rust Command 忘记在 `invoke_handler!` 注册                          | Rust 编译通过但前端 `invoke()` 会 timeout 或回 "command not found"                  |
| Cmd+V 在 Fn 按住期间执行 → 输入 "c" 字元                                | 已知 issue #25，避开即可                                                            |
| 开两个 dev session（两个 .app） → 全域热键广播                          | v0.9.5 已导入 `tauri-plugin-single-instance` 防止                                   |
