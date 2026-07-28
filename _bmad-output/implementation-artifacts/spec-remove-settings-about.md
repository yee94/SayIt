---
title: '移除設定頁關於區塊'
type: 'chore'
created: '2026-07-28'
status: 'done'
route: 'one-shot'
---

# 移除設定頁關於區塊

## Intent

**Problem:** 設定頁仍顯示「關於 SayIt」卡片及作者、社群與專案連結。

**Approach:** 完整移除該卡片，同步清理專屬圖示匯入、五語系翻譯鍵與設計稿節點。

## Suggested Review Order

**介面與設計同步**

- 設定頁直接從快捷鍵卡片開始，完整移除關於內容。
  [`SettingsView.vue:903`](../../../src/views/SettingsView.vue#L903)

- 設計稿同步以快捷鍵卡片作為首個設定卡片。
  [`design.pen:3279`](../../../design.pen#L3279)

**資源清理**

- 五語系設定結構同步移除已停用翻譯鍵。
  [`zh-TW.json:8`](../../../src/i18n/locales/zh-TW.json#L8)
