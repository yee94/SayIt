---
name: verify
description: 完整验证 — ESLint + 型别检查 + 单元测试 + Rust clippy + 编译检查。在提交前或完成功能开发后使用。
---

# 完整验证流程

依序执行以下五个检查，任何一步失败就停下来修正：

## 1. ESLint 检查
```bash
npx eslint .
```

## 2. TypeScript 型别检查
```bash
npx vue-tsc --noEmit
```

## 3. Vitest 单元测试
```bash
pnpm test
```

## 4. Rust clippy 静态分析
```bash
cd src-tauri && cargo clippy -- -D warnings
```

## 5. Rust 编译检查
```bash
cd src-tauri && cargo check
```

## 行为规则

- 五步全过才算验证通过
- 任何一步失败时，报告完整错误讯息并尝试修正
- 修正后重新跑失败的步骤（不需要从头跑）
- 全部通过后回报简洁摘要
