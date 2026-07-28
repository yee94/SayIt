---
title: '统一凭证操作按钮样式'
type: 'bugfix'
created: '2026-07-28'
status: 'done'
route: 'one-shot'
---

# 统一凭证操作按钮样式

## Intent

**Problem:** ASR 与 LLM 凭证区域的「显示」和「保存」按钮尺寸、变体及排列方式不一致。

**Approach:** 两个凭证区域共用等宽按钮规格；LLM 的显示与保存操作移至 API Key 输入列，次要操作保留在下方。

## Suggested Review Order

**介面实作**

- 先检查 ASR 显示与保存按钮的等宽规格。
  [`SettingsView.vue:1034`](../../src/views/SettingsView.vue#L1034)

- 再检查 LLM 凭证列的条件渲染与一致排列。
  [`SettingsView.vue:1116`](../../src/views/SettingsView.vue#L1116)

**设计对齐**

- 检查 ASR、LLM 共用的凭证操作模式与尺寸标注。
  [`design.pen:3677`](../../design.pen#L3677)
