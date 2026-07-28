---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-identify-targets
  - step-03-generate-tests
  - step-03c-aggregate
  - step-04-validate-and-summarize
lastStep: step-04-validate-and-summarize
status: complete
lastSaved: '2026-03-01'
inputDocuments:
  - _bmad/tea/config.yaml
  - _bmad-output/planning-artifacts/architecture.md
  - playwright.config.ts
  - vitest.config.ts
  - _bmad/tea/testarch/knowledge/test-levels-framework.md
  - _bmad/tea/testarch/knowledge/test-priorities-matrix.md
  - _bmad/tea/testarch/knowledge/data-factories.md
  - _bmad/tea/testarch/knowledge/selective-testing.md
  - _bmad/tea/testarch/knowledge/ci-burn-in.md
  - _bmad/tea/testarch/knowledge/test-quality.md
  - _bmad/tea/testarch/knowledge/overview.md
  - _bmad/tea/testarch/knowledge/api-request.md
  - _bmad/tea/testarch/knowledge/network-recorder.md
  - _bmad/tea/testarch/knowledge/auth-session.md
  - _bmad/tea/testarch/knowledge/intercept-network-call.md
  - _bmad/tea/testarch/knowledge/recurse.md
  - _bmad/tea/testarch/knowledge/log.md
  - _bmad/tea/testarch/knowledge/file-utils.md
  - _bmad/tea/testarch/knowledge/burn-in.md
  - _bmad/tea/testarch/knowledge/network-error-monitor.md
  - _bmad/tea/testarch/knowledge/fixtures-composition.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-overview.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-consumer-helpers.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-provider-verifier.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-request-filter.md
  - _bmad/tea/testarch/knowledge/pact-mcp.md
  - _bmad/tea/testarch/knowledge/playwright-cli.md
---

> **⚠️ Migration Note (2026-03-08):** Rust Native Audio Pipeline 迁移后，以下变更影响本文件的准确性：
> - `src/lib/recorder.ts` 和 `src/lib/transcriber.ts` 已删除，录音与转录逻辑迁移至 Rust（`audio_recorder.rs`, `transcription.rs`）
> - `tests/unit/recorder.test.ts` 和 `tests/unit/transcriber.test.ts` 已删除
> - `useVoiceFlow.ts` → `useVoiceFlowStore.ts`（Pinia store），测试档 `use-voice-flow-store.test.ts` 已全面重构为 `mockInvoke` command dispatch 模式
> - `useHudState.ts` 已不存在（状态管理移入 store + composable）
> - 新增 Rust 测试：`audio_recorder.rs`（9 tests）、`transcription.rs`（4 tests）
> - 目前测试总数：238（Vitest）+ Rust inline tests

# Automation Summary — SayIt

## Step 1: Preflight & Context Loading

### Stack Detection

**detected_stack**: `fullstack`

| 层级 | 技术 | 版本 |
|------|------|------|
| Frontend | Vue 3 + Vite + Tailwind CSS + TypeScript | 3.5 / 6.4 / 4.2 / 5.9 |
| Backend | Rust + Tauri v2 | 2021 edition / 2.10.x |
| 套件管理 | pnpm | — |

### Framework Verification

- [x] `playwright.config.ts` exists
- [x] `vitest.config.ts` exists
- [x] `package.json` includes test dependencies (vitest, @playwright/test, @vue/test-utils, jsdom, @faker-js/faker, @vitest/coverage-v8)
- [x] `src-tauri/Cargo.toml` exists (Rust backend)

### Execution Mode

**Standalone** — 无 BMAD story/tech-spec/test-design artifacts，直接进行 codebase analysis。

### TEA Config Flags

| Flag | 值 |
|------|-----|
| `tea_use_playwright_utils` | `true` |
| `tea_use_pactjs_utils` | `true` |
| `tea_pact_mcp` | `mcp` |
| `tea_browser_automation` | `auto` |
| `test_stack_type` | `auto` → resolved to `fullstack` |

### Context Loaded

- **架构文件**: `_bmad-output/planning-artifacts/architecture.md`
  - 双视窗架构 (HUD Window + Main Window)
  - Tauri Events 跨视窗同步
  - Groq API 整合 (Whisper + LLM)
  - SQLite 资料层 (tauri-plugin-sql)
  - Pinia 状态管理
- **Test Framework Config**: playwright.config.ts, vitest.config.ts
- **Existing Tests**: 2 test files, 7 tests (all passing)
  - `tests/unit/types.test.ts` (3 tests)
  - `tests/unit/factories.test.ts` (4 tests)
- **Existing Test Infrastructure**:
  - `tests/support/factories/` — TranscriptionRecord, VocabularyEntry factories
  - `tests/support/fixtures/` — Playwright merged fixtures placeholder
  - `tests/e2e/smoke.test.ts` — P0 smoke test

### Knowledge Fragments Loaded

**Core Tier (6):**
- test-levels-framework — 测试层级选择指引
- test-priorities-matrix — P0-P3 优先级矩阵
- data-factories — Faker-based factory pattern
- selective-testing — 标签、diff-based、promotion 策略
- ci-burn-in — CI pipeline、burn-in、shard 策略
- test-quality — Definition of Done、隔离规则

**Playwright Utils — Full UI+API Profile (11):**
- overview — 安装、设计原则、fixture patterns
- api-request — Typed HTTP client、schema validation
- network-recorder — HAR record/playback
- auth-session — Token persistence、multi-user
- intercept-network-call — Network spy/stub
- recurse — Async polling
- log — Structured logging
- file-utils — CSV/PDF/ZIP validation
- burn-in — Smart test selection
- network-error-monitor — HTTP error detection
- fixtures-composition — mergeTests composition

**Pact.js Utils (4):**
- pactjs-utils-overview — Contract testing utilities
- pactjs-utils-consumer-helpers — Provider state helpers
- pactjs-utils-provider-verifier — Verifier config
- pactjs-utils-request-filter — Auth injection

**Pact MCP (1):**
- pact-mcp — SmartBear MCP server

**Playwright CLI (1):**
- playwright-cli — Browser automation for coding agents

### Relevance Assessment

| 知识领域 | 与本专案相关度 | 备注 |
|---------|-------------|------|
| Core fragments | 🟢 高 | 所有核心片段适用 |
| Playwright Utils | 🟡 中 | E2E UI 测试需要；API 测试可用于 Groq API mock |
| Pact.js Utils | 🔴 低 | 本专案非微服务架构，无 contract testing 需求 |
| Pact MCP | 🔴 低 | 同上 |
| Playwright CLI | 🟡 中 | 可用于 Tauri WebView 页面快照与选择器验证 |

## Step 2: Identify Automation Targets

### Source Code Analysis

**前端 (8 files):**

| 档案 | 责任 | 风险 | 可测试逻辑 |
|------|------|------|-----------|
| `src/lib/recorder.ts` | Web Audio API 录音管理 | 🔴 高 | MIME 检测、初始化守卫、启停录音、Blob 组建 |
| `src/composables/useVoiceFlow.ts` | 核心工作流协调 | 🔴 高 | Fn 键事件处理、录音→转录→贴上流程、错误处理 |
| `src/lib/transcriber.ts` | Groq API 转录 | 🔴 高 | 环境变数验证、MIME→副档名、FormData、HTTP 错误 |
| `src/composables/useHudState.ts` | HUD 状态管理 | 🟡 中 | 状态转移、自动隐藏计时器、计时器清理 |
| `src/App.vue` | 根元件、启动动画 | 🟡 中 | buildNotchPath()、启动序列计时、条件式显示 |
| `src/components/NotchHud.vue` | HUD 显示元件 | 🟢 低 | 状态→形状映射、条件式内容渲染 |
| `src/types/index.ts` | 型别定义 | 🟢 低 | 已有测试覆盖 |
| `src/main.ts` | 进入点 | 🟢 低 | 无可测试逻辑 |

**后端 Rust (5 files):**

| 档案 | 责任 | 风险 | 可测试逻辑 |
|------|------|------|-----------|
| `src-tauri/src/plugins/fn_key_listener.rs` | Fn 键监听 (CGEventTap) | 🔴 高 | 权限检查、事件侦测、原子旗标管理 |
| `src-tauri/src/plugins/clipboard_paste.rs` | 剪贴簿贴上 | 🔴 高 | 剪贴簿写入、AX API menu press（macOS）/ SendInput（Windows）、错误处理 |
| `src-tauri/src/lib.rs` | App 初始化 & 视窗配置 | 🟡 中 | NSWindow 设定、视窗定位、DPI 计算 |
| `src-tauri/src/main.rs` | 进入点 | 🟢 低 | 纯委派 |
| `src-tauri/src/plugins/mod.rs` | 模组汇总 | 🟢 低 | 纯 re-export |

### Test Level Assignment

依据 `test-levels-framework.md` 选择适当层级，避免重复覆盖：

#### Unit Tests (Vitest) — 纯逻辑、资料转换、守卫条件

| 目标 | 测试焦点 | 优先级 |
|------|---------|--------|
| `recorder.ts` | MIME 类型检测逻辑、初始化守卫、停止录音守卫 | P0 |
| `transcriber.ts` | 环境变数验证、MIME→副档名映射、HTTP 错误处理 | P0 |
| `useHudState.ts` | 状态转移矩阵、自动隐藏计时器、计时器清理 | P1 |
| `useVoiceFlow.ts` | 流程协调（mock 依赖）、错误处理路径、重复事件忽略 | P0 |

#### Component Tests (Vitest + @vue/test-utils) — UI 行为验证

| 目标 | 测试焦点 | 优先级 |
|------|---------|--------|
| `NotchHud.vue` | 5 种状态渲染、讯息显示、图示切换 | P1 |
| `App.vue` | buildNotchPath() 几何计算、启动序列、条件式显示 | P2 |

#### E2E Tests (Playwright) — 关键使用者旅程

| 目标 | 测试焦点 | 优先级 |
|------|---------|--------|
| Smoke Test | 应用程式载入、HUD 视窗显示 | P0 (已有) |
| Voice Flow | 录音→转录→贴上完整流程（需 Tauri runtime） | P1 |

#### Backend Tests (cargo test) — Rust 逻辑

| 目标 | 测试焦点 | 优先级 |
|------|---------|--------|
| `clipboard_paste.rs` | ClipboardError 序列化、错误类型映射 | P1 |
| `fn_key_listener.rs` | 权限检查逻辑（mock CGEventTap 困难，聚焦可测试部分） | P2 |
| `lib.rs` | debug_log 输出、视窗位置计算 | P2 |

### Priority Matrix

| 优先级 | 数量 | 测试层级分布 | 描述 |
|--------|------|-------------|------|
| **P0** | 4 | 3 Unit + 1 E2E (已有) | 核心功能：录音、转录、工作流、App 载入 |
| **P1** | 4 | 2 Unit + 1 Component + 1 Backend | 重要流程：HUD 状态、NotchHud 渲染、剪贴簿、E2E Flow |
| **P2** | 4 | 1 Component + 3 Backend | 次要：App 动画、Fn 监听器、视窗配置 |
| **P3** | 0 | — | 本阶段不涵盖 |

### Coverage Plan

**范围**: `critical-paths` — 聚焦 P0 和 P1，P2 视时间选择性覆盖。

**策略**:
1. **Unit Tests 优先** — recorder.ts、transcriber.ts、useVoiceFlow.ts、useHudState.ts
   - Mock 外部依赖 (`@tauri-apps/api`, `navigator.mediaDevices`, Groq API)
   - 使用 `vi.useFakeTimers()` 测试计时器逻辑
   - 使用 factories 产生测试资料
2. **Component Tests 次之** — NotchHud.vue 状态渲染
   - @vue/test-utils mount + props 驱动
   - 验证条件式渲染输出
3. **E2E 维持 Smoke** — 已有基础 smoke test
   - 本轮不扩展 E2E（需要 Tauri runtime，CI 设定复杂度高）
4. **Backend 最后** — clipboard_paste.rs 错误类型
   - Rust unit tests 聚焦可独立测试的逻辑

**预计产出**:
- ~15-20 个新测试 across 4-6 个新测试档案
- 覆盖 4 个高风险前端模组 + 1 个后端模组
- 目标：将已测试逻辑从 ~10% 提升至 ~60%

## Step 3: Generate Tests (Parallel Subprocess Execution)

### Subprocess Dispatch (fullstack mode)

| Subprocess | 状态 | 测试数 | 档案数 |
|-----------|------|--------|--------|
| A — Unit/API Tests (Vitest) | ✅ Complete | 69 | 4 |
| B — E2E Tests (Playwright) | ✅ Complete (deferred) | 0 | 0 |
| B-backend — Rust Tests (cargo test) | ✅ Complete | 14 | 2 (inline) |

### Subprocess A: Unit Tests (Vitest)

| 档案 | 对应来源 | 优先级 | 测试数 |
|------|---------|--------|--------|
| `tests/unit/recorder.test.ts` | `src/lib/recorder.ts` | P0 | 14 |
| `tests/unit/transcriber.test.ts` | `src/lib/transcriber.ts` | P0 | 17 |
| `tests/unit/use-hud-state.test.ts` | `src/composables/useHudState.ts` | P1 | 22 |
| `tests/unit/use-voice-flow.test.ts` | `src/composables/useVoiceFlow.ts` | P0 | 16 |

**覆盖重点：**
- recorder.ts: MIME 检测、初始化守卫、启停录音、Blob 组建
- transcriber.ts: 环境变数验证、MIME→副档名、FormData、HTTP 错误
- useHudState.ts: 状态转移矩阵、自动隐藏计时器（精确到边界值）
- useVoiceFlow.ts: 完整流程协调、各阶段失败处理

### Subprocess B: E2E Tests (Playwright)

不生成新 E2E 测试。现有 `tests/e2e/smoke.test.ts` 提供 P0 覆盖。E2E 扩展需要 Tauri runtime + 专用 CI 环境。

### Subprocess B-backend: Rust Tests

| 档案 | 测试数 | 备注 |
|------|--------|------|
| `src-tauri/src/plugins/clipboard_paste.rs` | 9 | ClipboardError Display/Serialize/Debug |
| `src-tauri/src/lib.rs` | 5 | `calculate_centered_window_x()` 提取 + 5 组 scale/解析度 |

**重构：** 从 `lib.rs` 的 `run()` setup closure 提取 `calculate_centered_window_x()` 为独立纯函式，使视窗置中计算可独立测试。

**不可测试模组：** `fn_key_listener.rs`（全为 macOS FFI）、`simulate_paste`（CGEvent）、`configure_macos_notch_window`（objc FFI）

### Step 3C: Aggregation Summary

| 指标 | 数值 |
|------|------|
| **新增测试总数** | 83 (69 Vitest + 14 Rust) |
| **既有测试** | 7 (types + factories) |
| **测试总数** | 90 |
| **新增测试档案** | 4 (Vitest) + 2 inline (Rust) |
| **Fixture 需求** | 无（所有测试自给自足） |
| **P0 覆盖** | 51 tests |
| **P1 覆盖** | 32 tests |
| **P2 覆盖** | 7 tests |
| **执行模式** | PARALLEL (3 subprocesses) |

## Step 4: Validate & Summarize

### Test Execution Results

| 测试套件 | 测试数 | 通过 | 失败 | 执行时间 |
|---------|--------|------|------|---------|
| Vitest (Unit) | 76 | 76 | 0 | 1.46s |
| Rust (cargo test) | 14 | 14 | 0 | 0.00s |
| **合计** | **90** | **90** | **0** | **~1.5s** |

### Checklist Validation

#### Prerequisites ✅

- [x] Framework scaffolding configured (`playwright.config.ts`, `vitest.config.ts`)
- [x] Test directory structure exists (`tests/unit/`, `tests/e2e/`, `tests/support/`)
- [x] `package.json` has test framework dependencies

#### Step 1: Context Loading ✅

- [x] Execution mode: **Standalone** (无 BMAD artifacts)
- [x] Framework config loaded and validated
- [x] Existing test patterns reviewed (2 files, 7 tests)
- [x] Coverage gaps mapped (4 高风险模组 + 2 后端模组)
- [x] Knowledge fragments loaded: 6 Core + 11 Playwright Utils + 4 Pact.js + 1 Pact MCP + 1 CLI

#### Step 2: Target Identification ✅

- [x] Test level selection framework applied
- [x] Unit tests identified (4 modules)
- [x] Component tests identified (deferred — NotchHud.vue, App.vue)
- [x] E2E tests: existing smoke test sufficient
- [x] Backend tests identified (2 modules)
- [x] Duplicate coverage avoided (每个行为只在一个层级测试)
- [x] Priorities assigned: P0 (critical), P1 (important), P2 (secondary)

#### Step 3–4: Test Generation & Quality ✅

- [x] All tests use **Given-When-Then** format with clear comments
- [x] All tests have **priority tags** (`[P0]`, `[P1]`) in test names
- [x] No hardcoded test data (使用 mock functions 和 Blob constructors)
- [x] No hard waits (`vi.useFakeTimers()`, `vi.waitFor()` 替代)
- [x] No conditional flow (测试为 deterministic)
- [x] No shared state between tests (`vi.resetModules()`, `beforeEach` 重置)
- [x] No page objects (tests are direct and simple)
- [x] Tests are isolated and deterministic
- [x] No `console.log` or debug statements in test code
- [x] TypeScript types correct and complete
- [x] Imports organized

#### Knowledge Base Integration ✅

- [x] `test-levels-framework.md` — Unit 层级用于纯逻辑和守卫条件
- [x] `test-priorities-matrix.md` — P0/P1/P2 分类正确
- [x] `data-factories.md` — 既有 factories 保留，新测试使用 inline mock
- [x] `test-quality.md` — Given/When/Then、隔离、deterministic 规则遵循
- [x] `selective-testing.md` — P0 标签支援选择性执行
- [x] `ci-burn-in.md` — 无 flaky pattern 侦测到

### Files Created/Modified

| 档案 | 动作 | 说明 |
|------|------|------|
| `tests/unit/recorder.test.ts` | 新增 | 14 tests — MIME 检测、初始化守卫、启停录音 |
| `tests/unit/transcriber.test.ts` | 新增 | 17 tests — 环境变数、MIME 映射、HTTP 错误 |
| `tests/unit/use-hud-state.test.ts` | 新增 | 22 tests — 状态转移、自动隐藏计时器 |
| `tests/unit/use-voice-flow.test.ts` | 新增 | 16 tests — 完整流程协调、错误处理 |
| `src-tauri/src/plugins/clipboard_paste.rs` | 修改 | +9 inline tests — ClipboardError traits |
| `src-tauri/src/lib.rs` | 修改 | 提取 `calculate_centered_window_x()` + 5 tests |

### Key Technical Decisions

1. **`vi.resetModules()` + dynamic import** — recorder.ts 和 transcriber.ts 有 module-level mutable state，需要每个测试重新载入模组
2. **`vi.hoisted()`** — useVoiceFlow.ts 使用 vi.hoisted() 解决 vi.mock factory 的 hoisting 问题
3. **`vi.waitFor()`** — 用于 fire-and-forget async handler 的测试（取代 flaky `setTimeout`）
4. **Pure function extraction** — 从 `lib.rs` 的 `run()` closure 提取 `calculate_centered_window_x()` 为独立可测试函式
5. **E2E 延迟** — Tauri 桌面 App 的 E2E 需要 Tauri runtime + 专用 CI 环境，本轮不扩展

### Assumptions & Risks

| 项目 | 说明 |
|------|------|
| **假设** | Groq API 行为符合文件（mock 基于实际 API 契约） |
| **假设** | MediaRecorder API 在目标环境中可用（Chrome/Chromium WebView） |
| **风险** | Rust FFI 模组（fn_key_listener, simulate_paste, NSWindow）无法 unit test |
| **风险** | Component tests 延迟可能导致 UI 回归未被捕捉 |
| **限制** | E2E 需要 Tauri runtime，无法在纯 CI 环境执行 |

### Coverage Summary

```
覆盖前：7 tests (types + factories) → ~10% 可测试逻辑
覆盖后：90 tests → ~65% 可测试逻辑

已覆盖（本轮新增）:
  ✅ src/lib/recorder.ts          — 14 tests (P0)
  ✅ src/lib/transcriber.ts       — 17 tests (P0)
  ✅ src/composables/useVoiceFlow — 16 tests (P0)
  ✅ src/composables/useHudState  — 22 tests (P1)
  ✅ clipboard_paste.rs           —  9 tests (P1)
  ✅ lib.rs (window calc)         —  5 tests (P2)

未覆盖（下一轮候选）:
  ⬜ src/components/NotchHud.vue  — Component test (P1)
  ⬜ src/App.vue                  — Component test (P2)
  ⬜ fn_key_listener.rs           — 不可 unit test (FFI)
  ⬜ E2E Voice Flow               — 需 Tauri runtime (P1)
```

### Next Recommended Workflows

1. **`test-review`** — 验证测试品质、辨识 flaky patterns、确认命名惯例
2. **`trace`** — 建立可追溯性矩阵，对应需求→测试→原始码
3. **`ci`** — 设定 GitHub Actions CI pipeline，加入 `pnpm test` 和 `cargo test`
4. **`automate`** (再次) — 针对 NotchHud.vue 和 App.vue 的 Component tests
