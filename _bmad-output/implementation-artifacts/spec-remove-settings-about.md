---
title: '移除设定页关于区块'
type: 'chore'
created: '2026-07-28'
status: 'done'
route: 'one-shot'
---

# 移除设定页关于区块

## Intent

**Problem:** 设定页仍显示「关于 SayIt」卡片及作者、社群与专案连结。

**Approach:** 完整移除该卡片，同步清理专属图示汇入、五语系翻译键与设计稿节点。

## Suggested Review Order

**介面与设计同步**

- 设定页直接从快捷键卡片开始，完整移除关于内容。
  [`SettingsView.vue:903`](../../../src/views/SettingsView.vue#L903)

- 设计稿同步以快捷键卡片作为首个设定卡片。
  [`design.pen:3279`](../../../design.pen#L3279)

**资源清理**

- 五语系设定结构同步移除已停用翻译键。
  [`zh-TW.json:8`](../../../src/i18n/locales/zh-TW.json#L8)
