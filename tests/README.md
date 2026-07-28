# Test Suite — SayIt

## Setup

```bash
# 安装 dependencies
pnpm install

# 安装 Playwright browsers
npx playwright install chromium
```

## 执行测试

### Unit / Component Tests (Vitest)

```bash
pnpm test              # 执行所有 unit/component tests
pnpm test:watch        # Watch mode（开发时用）
pnpm test:coverage     # 含覆盖率报告
```

### E2E Tests (Playwright)

```bash
pnpm test:e2e          # Headless 执行
pnpm test:e2e:ui       # Playwright UI mode（Debug 用）
```

### Rust Tests

```bash
cd src-tauri && cargo test   # 执行 Rust 测试
```

## 架构

```
tests/
├── e2e/                 # Playwright E2E 测试
├── unit/                # Vitest unit 测试（纯逻辑、types、services）
├── component/           # Vitest component 测试（Vue 元件）
└── support/
    ├── fixtures/        # Playwright fixtures（mergeTests 组合）
    ├── helpers/         # 共用 helper utilities
    └── factories/       # Data factories（faker-based）
```

### Data Factories

使用 `@faker-js/faker` 产生随机测试资料，避免 parallel 执行冲突：

```typescript
import { createTranscriptionRecord, createVocabularyEntry } from '../support/factories';

// 使用预设值
const record = createTranscriptionRecord();

// 使用自订覆写
const enhanced = createTranscriptionRecord({
  wasEnhanced: true,
  triggerMode: 'hold',
});
```

### Fixtures (Playwright)

从 `tests/support/fixtures/index.ts` import：

```typescript
import { test, expect } from '../support/fixtures';

test('example', async ({ page }) => {
  await page.goto('/');
});
```

## Best Practices

### Selectors

- E2E 测试使用 `data-testid` selectors
- 避免 CSS class selectors（容易因 Tailwind 更动而坏掉）

### 测试隔离

- 每个测试独立，不依赖其他测试的状态
- 使用 factories 产生唯一测试资料
- Fixtures 负责 auto-cleanup

### 命名惯例

- 测试名称加入 priority tag：`[P0]`, `[P1]`, `[P2]`, `[P3]`
- 使用 Given/When/Then 结构的注解
- 档案名：`feature-name.test.ts`

### 禁止事项

- `page.waitForTimeout()` — 使用 event-based waits
- `if (await element.isVisible())` — 测试应是 deterministic
- hardcoded 测试资料 — 使用 factories
- 跨测试共用状态

## CI 整合

```yaml
# GitHub Actions
- name: Run unit tests
  run: pnpm test

- name: Run E2E tests
  run: pnpm test:e2e

- name: Upload artifacts
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: |
      test-results/
      playwright-report/
```

## Config 档案

| 档案 | 用途 |
|------|------|
| `playwright.config.ts` | E2E 测试设定（base URL、timeouts、reporters） |
| `vitest.config.ts` | Unit/Component 测试设定（jsdom、Vue plugin） |
| `.nvmrc` | Node.js 版本 |
