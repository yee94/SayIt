---
title: '可设定 AI 整理字元门槛'
slug: 'configurable-enhancement-threshold'
created: '2026-03-03'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Vue 3 Composition API', 'Pinia Setup Store', 'tauri-plugin-store', 'TypeScript strict', 'Tailwind CSS v4']
files_to_modify: ['src/types/settings.ts', 'src/stores/useSettingsStore.ts', 'src/stores/useVoiceFlowStore.ts', 'src/views/SettingsView.vue', 'tests/unit/use-voice-flow-store.test.ts']
code_patterns: ['Setup Store ref+computed+function', 'tauri-plugin-store load/get/set/save', 'useFeedbackMessage composable', 'toggle switch button+span pattern']
test_patterns: ['tests/unit/use-voice-flow-store.test.ts (must update threshold test)']
---

# Tech-Spec: 可设定 AI 整理字元门槛

**Created:** 2026-03-03

## Overview

### Problem Statement

目前 AI 整理的字元门槛（转录文字 < 10 字元时跳过 AI 整理）硬编码在 `useVoiceFlowStore.ts` 中的 `ENHANCEMENT_CHAR_THRESHOLD = 10`。使用者无法自订此行为——有些人希望每次都跑 AI 整理（不论长短），有些人希望调整门槛字数。

### Solution

在设定页「AI 整理 Prompt」section 内新增两个控制项：
1. **启用/停用开关** — 是否启用字元门槛（停用 = 任何长度都跑 AI 整理）
2. **门槛字数输入** — 启用时，低于此字数的转录文字跳过二次处理，直接贴上原文

### Scope

**In Scope:**
- `useSettingsStore` 新增两个设定值：`isEnhancementThresholdEnabled`、`enhancementThresholdCharCount`
- `SettingsView.vue`「AI 整理 Prompt」section 加入开关 + 数字输入 UI
- `useVoiceFlowStore` 从 settings store 读取设定，取代硬编码常数
- `tauri-plugin-store` 持久化设定
- `settings.ts` 型别更新

**Out of Scope:**
- Rust 端不需改动
- AI Prompt 逻辑本身不变
- 不涉及 HUD 显示变更
- 不做跨视窗即时同步（设定变更需重启 App 才在 HUD 生效）

## Context for Development

### Codebase Patterns

- **Settings Store 结构** — Pinia Setup Store 语法（`defineStore('settings', () => { ... })`），每个设定项为独立 `ref()`，搭配 `loadSettings()` 统一载入 + 专属 `saveXxx()` action
- **持久化模式** — `tauri-plugin-store`：`const store = await load(STORE_NAME)` → `store.get<T>(key)` 读取 → `store.set(key, value)` + `store.save()` 写入
- **载入 fallback** — `loadSettings()` 中使用 `savedValue ?? defaultValue` 模式，确保首次启动有合理预设
- **跨视窗同步** — 此功能不做跨视窗同步。HUD 视窗的 `loadSettings()` 有 `isLoaded` guard 只跑一次，Dashboard 改门槛后 HUD 不会即时感知，需重启 App。这是已确认的限制。不需呼叫 `emitEvent(SETTINGS_UPDATED)`
- **UI Feedback** — `useFeedbackMessage()` composable 提供 `show(type, message)` + `clearTimer()` 模式
- **Toggle Switch UI** — SettingsView「开机自启动」toggle（「应用程式」section 内的 `<button>` + `<span>` 圆球滑动模式）：`:class` 绑定 boolean state，可直接复用此 HTML 结构
- **VoiceFlowStore 取用 settings** — 在 store 内部 `const settingsStore = useSettingsStore()` 直接引用

### Files to Reference

| File | Purpose | 定位方式 |
| ---- | ------- | ------- |
| `src/types/settings.ts` | 设定型别，在 `SettingsDto` 介面中新增两个栏位 | 搜寻 `interface SettingsDto` |
| `src/stores/useSettingsStore.ts` | 新增门槛 state（ref）、在 `loadSettings()` 中载入、新增 `saveEnhancementThreshold()` action | 搜寻 `async function loadSettings()` 和 `return {` |
| `src/stores/useVoiceFlowStore.ts` | 移除 `ENHANCEMENT_CHAR_THRESHOLD` 常数，改从 settings store 读取 | 搜寻 `ENHANCEMENT_CHAR_THRESHOLD` |
| `src/views/SettingsView.vue` | 在「AI 整理 Prompt」section 的 `</section>` 结束标签前加入门槛 UI | 搜寻 `AI 整理 Prompt` 所在的 `<section>`，在其 prompt feedback `</transition>` 之后、`</section>` 之前插入 |
| `tests/unit/use-voice-flow-store.test.ts` | 更新门槛相关测试，mock settings store 的新栏位 | 搜寻 `< 10 字应跳过` 或 `ENHANCEMENT_CHAR_THRESHOLD` |

### Technical Decisions

- **Store keys** — `enhancementThresholdEnabled`（boolean）、`enhancementThresholdCharCount`（number），存在 `tauri-plugin-store`（`settings.json`）
- **预设常数** — 在 `useSettingsStore.ts` 顶部提取为具名常数：`DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = true`、`DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10`，向后相容现有行为
- **停用门槛** — 任何长度都跑 AI 整理，不设最低安全值
- **门槛字数输入验证** — `<input type="number">`，save 时验证：若值不是正整数（NaN、小数、负数、0）则 fallback 到 `DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT`（10）。避免 NaN 导致 `length >= NaN` 恒为 `false` 的功能性 bug
- **判断逻辑（`>=` 语意）** — `useVoiceFlowStore` 移除 `ENHANCEMENT_CHAR_THRESHOLD` 常数，改为：`if (!settingsStore.isEnhancementThresholdEnabled || rawText.length >= settingsStore.enhancementThresholdCharCount)` → 走 AI 整理。亦即：门槛停用 → 永远走 AI 整理；门槛启用 → 字数 >= 门槛才走 AI 整理（字数严格小于门槛才跳过）
- **不做跨视窗同步** — 门槛设定变更需重启 App 才在 HUD 生效（`loadSettings()` 有 `isLoaded` guard 只执行一次）。这是已确认的限制，不呼叫 `emitEvent`
- **储存时机** — toggle 和字数作为一组，透过 `saveEnhancementThreshold(enabled, charCount)` 一次储存两个值。UI 操作：toggle 切换时带上当前 charCount 呼叫；数字输入按储存时带上当前 enabled 呼叫
- **成功讯息** — 跳过 AI 整理时统一显示「已贴上 ✓」（`PASTE_SUCCESS_MESSAGE`），与整理成功的讯息一致，不做区分
- **型别方案** — 直接在 `SettingsDto` 介面中新增两个栏位，不另建介面

## Implementation Plan

### Tasks

- [ ] Task 1: 扩充设定型别定义
  - File: `src/types/settings.ts`
  - Action: 在 `SettingsDto` 介面中新增 `isEnhancementThresholdEnabled: boolean` 和 `enhancementThresholdCharCount: number` 两个栏位
  - Notes: 这是其他档案的型别基础，必须先完成

- [ ] Task 2: Settings Store 新增门槛设定的 state 和 actions
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    1. 在档案顶部（store 定义外）新增具名常数：`const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = true;` 和 `const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;` 并 export
    2. 在 store 内新增两个 `ref()`：`isEnhancementThresholdEnabled`（预设 `DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED`）、`enhancementThresholdCharCount`（预设 `DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT`）
    3. 在 `loadSettings()` 中新增读取逻辑：`store.get<boolean>('enhancementThresholdEnabled')` 和 `store.get<number>('enhancementThresholdCharCount')`，用 `?? DEFAULT_xxx` 提供预设值
    4. 新增 `saveEnhancementThreshold(enabled: boolean, charCount: number)` action：
       - 输入验证：`charCount` 若不是正整数（`!Number.isInteger(charCount) || charCount < 1`）则 fallback 到 `DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT`
       - `store.set('enhancementThresholdEnabled', enabled)` + `store.set('enhancementThresholdCharCount', validatedCharCount)` + `store.save()`
       - 更新两个 ref
       - 不呼叫 `emitEvent`（不做跨视窗同步）
    5. 在 return 物件中暴露新的 ref 和 action
  - Notes: 遵循现有 `loadSettings()` 中 `savedValue ?? defaultValue` 的 fallback 模式

- [ ] Task 3: VoiceFlowStore 移除硬编码，改读 settings store
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    1. 移除 `const ENHANCEMENT_CHAR_THRESHOLD = 10;`（搜寻此常数名称定位）
    2. 修改判断逻辑，从 `if (result.rawText.length >= ENHANCEMENT_CHAR_THRESHOLD)` 改为 `if (!settingsStore.isEnhancementThresholdEnabled || result.rawText.length >= settingsStore.enhancementThresholdCharCount)`
  - Notes: `settingsStore` 已在此 store 内部引用（现有程式码），无需新增 import。逻辑：门槛停用 → 永远走 AI 整理；门槛启用 → 字数 >= 门槛才走 AI 整理

- [ ] Task 4: SettingsView 新增门槛设定 UI
  - File: `src/views/SettingsView.vue`
  - Action:
    1. 在 `<script setup>` 中新增：
       - `const thresholdEnabled = ref(false);` 和 `const thresholdCharCount = ref(10);`（local ref，`onMounted` 中从 store 初始化）
       - `const enhancementThresholdFeedback = useFeedbackMessage();`
       - `async function handleToggleEnhancementThreshold()`：翻转 `thresholdEnabled`，呼叫 `settingsStore.saveEnhancementThreshold(thresholdEnabled.value, thresholdCharCount.value)`，显示 feedback
       - `async function handleSaveThresholdCharCount()`：呼叫 `settingsStore.saveEnhancementThreshold(thresholdEnabled.value, thresholdCharCount.value)`，显示 feedback
    2. 在 `onMounted` 中：`thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;` 和 `thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;`
    3. 在 `onBeforeUnmount` 中加入 `enhancementThresholdFeedback.clearTimer()`
    4. 在「AI 整理 Prompt」section 的 prompt feedback `</transition>` 之后、`</section>` 结束标签之前，加入：
       - 分隔线 `<div class="mt-6 border-t border-zinc-700 pt-4">`
       - 小标题「短文字门槛」+ 说明文字：「启用后，低于指定字数的转录文字将跳过 AI 整理，直接贴上原文。停用则每次都做 AI 整理。设定变更需重启 App 生效。」
       - Toggle switch（复用「开机自启动」的 `<button>` + `<span>` 圆球模式），`@click="handleToggleEnhancementThreshold"`
       - `v-if="thresholdEnabled"` 区块：`<input type="number" v-model.number="thresholdCharCount">` + 储存按钮 `@click="handleSaveThresholdCharCount"`
       - Feedback 讯息区（复用 `feedback-fade` transition 模式）
  - Notes: 两个 handler 都呼叫同一个 `saveEnhancementThreshold(enabled, charCount)`，确保两个值永远一起存。toggle 切换立即 save；数字输入需按储存按钮

- [ ] Task 5: 更新现有门槛相关测试
  - File: `tests/unit/use-voice-flow-store.test.ts`
  - Action:
    1. 找到 `< 10 字应跳过 AI 整理` 相关测试
    2. 更新 mock：settings store 的 mock 需提供 `isEnhancementThresholdEnabled`（`true`）和 `enhancementThresholdCharCount`（`10`）
    3. 确保测试仍验证相同行为：门槛启用 + 10 字 → < 10 字跳过整理
    4. 考虑补充一条：门槛停用时短文字仍走 AI 整理
  - Notes: 搜寻 `< 10 字应跳过` 或 `ENHANCEMENT_CHAR_THRESHOLD` 定位测试。移除 `ENHANCEMENT_CHAR_THRESHOLD` 常数后，测试若有 import 该常数也需更新

### Acceptance Criteria

**Happy Path:**
- [ ] AC 1: Given 使用者首次升级（`settings.json` 无门槛设定），when 开启设定页，then 门槛开关为「启用」、字数显示 10（向后相容现有行为）
- [ ] AC 2: Given 门槛开关为「启用」且字数设为 10，when 录音转录结果为 5 个字，then 跳过 AI 整理直接贴上原文，显示「已贴上 ✓」
- [ ] AC 3: Given 门槛开关为「启用」且字数设为 10，when 录音转录结果为 15 个字，then 正常执行 AI 整理
- [ ] AC 4: Given 门槛开关为「停用」，when 录音转录结果为 3 个字，then 仍然执行 AI 整理
- [ ] AC 5: Given 使用者切换门槛开关，when toggle 被点击，then 设定立即储存到 `settings.json` 并显示 feedback 讯息
- [ ] AC 6: Given 使用者修改门槛字数并点击储存，when 储存成功，then 新值写入 `settings.json` 并显示 feedback 讯息
- [ ] AC 7: Given 门槛开关为「停用」，when 检视设定页 UI，then 门槛字数输入框隐藏不显示
- [ ] AC 8: Given 设定页修改门槛后重启 App，when 重新开启设定页，then 显示上次储存的门槛值（持久化正确）

**边界与错误场景:**
- [ ] AC 9: Given 门槛字数设为 10，when 录音转录结果刚好 10 个字，then 走 AI 整理（`>=` 语意）
- [ ] AC 10: Given 使用者清空门槛字数输入框并点击储存，when save 执行，then 自动 fallback 到预设值 10 并显示 feedback
- [ ] AC 11: Given 使用者输入小数（如 3.7）或负数（如 -5）并点击储存，when save 执行，then 自动 fallback 到预设值 10 并显示 feedback
- [ ] AC 12: Given 现有测试 `use-voice-flow-store.test.ts` 的门槛测试，when 执行 `pnpm test`，then 所有测试通过（不 break CI）

## Additional Context

### Dependencies

- 无新增外部依赖
- 无 Rust 端改动
- 无资料库 schema 变更

### Testing Strategy

- 更新现有 `tests/unit/use-voice-flow-store.test.ts` 中的门槛测试，确保 CI 通过
- 手动验证步骤：
  1. 开启设定页，确认门槛设定 UI 出现在 AI Prompt section 内
  2. 切换 toggle，确认 feedback 显示且重启后设定保留
  3. 门槛启用 + 字数 10：录一段短话（< 10 字）→ 确认直接贴上未整理
  4. 门槛停用：录一段短话 → 确认仍走 AI 整理
  5. 修改门槛字数为 5 → 录 7 个字 → 确认走 AI 整理
  6. 清空字数输入并储存 → 确认 fallback 到 10
  7. 执行 `pnpm test` 确认所有测试通过

### Notes

- 现有行为（< 10 字跳过 AI 整理）为预设值，首次升级使用者不会感受到差异
- 门槛设定变更需重启 App 才在 HUD 生效（已确认的限制）
- `>=` 语意：门槛值 10 代表「10 字以上走 AI 整理，严格小于 10 字才跳过」
- 非法输入（NaN、小数、负数、0）由 `saveEnhancementThreshold` 统一 fallback 到预设值 10
