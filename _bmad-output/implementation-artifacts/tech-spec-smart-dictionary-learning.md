---
title: '智慧字典学习系统'
slug: 'smart-dictionary-learning'
created: '2026-03-09'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
tech_stack: ['Rust (AXUIElement / UI Automation)', 'Tauri Command', 'macOS Accessibility API', 'Windows UI Automation', 'Groq Chat API', 'SQLite']
files_to_modify: ['src-tauri/src/plugins/keyboard_monitor.rs', 'src-tauri/src/plugins/text_field_reader.rs', 'src-tauri/src/plugins/sound_feedback.rs', 'src-tauri/src/plugins/mod.rs', 'src-tauri/src/lib.rs', 'src/stores/useVocabularyStore.ts', 'src/stores/useVoiceFlowStore.ts', 'src/stores/useSettingsStore.ts', 'src/stores/useHistoryStore.ts', 'src/views/DictionaryView.vue', 'src/views/SettingsView.vue', 'src/views/DashboardView.vue', 'src/components/NotchHud.vue', 'src/lib/database.ts', 'src/lib/vocabularyAnalyzer.ts', 'src/types/vocabulary.ts', 'src/types/events.ts', 'src/composables/useTauriEvents.ts', 'CLAUDE.md']
code_patterns: ['cfg(target_os) 条件编译', 'Tauri Command 注册在 lib.rs invoke_handler', 'plugins/mod.rs 注册新模组', 'Pinia store 封装 DB 操作', 'useFeedbackMessage composable', 'shadcn-vue 元件系统']
test_patterns: ['Rust #[cfg(test)] mod tests 在同档案底部', 'Vitest + jsdom 前端测试']
---

# Tech-Spec: 智慧字典学习系统

**Created:** 2026-03-09

## Overview

### Problem Statement

SayIt 的字典功能目前完全依赖使用者手动输入。字典越丰富，Whisper 语音辨识和 AI 增强的品质就越好，但使用者往往懒得维护字典。同时，使用者每次修正转录错字的行为本身就是最有价值的训练信号，却被白白浪费了。

### Solution

建立一套三层机制的智慧字典学习系统：

1. **权重系统**：追踪每个字典词汇的使用频率，高频词优先喂给 Whisper/AI
2. **修正侦测**：贴上文字后监听使用者按键活动，侦测到修正时用 Accessibility API 读取修正后的文字
3. **AI 分析**：将原始转录与修正后文字送给 AI，严格筛选出字典级词汇，自动加入字典

### Scope

**In Scope:**
- vocabulary 表新增 `weight`、`source` 栏位（DB migration v3）
- 每次转录完成后扫描输出文字，命中的字典词 weight += 1
- Whisper prompt 取 weight 前 50 个词，AI enhancement 取前 50 个
- 扩展 keyboard_monitor.rs 侦测任意按键（不只 Backspace/Delete）
- 新增 text_field_reader.rs 透过 AXUIElement (macOS) / UI Automation (Windows) 读取 focused text field
- 新增 vocabularyAnalyzer.ts 呼叫 Groq Chat API 分析修正差异
- AI 推荐的词自动加入字典（source='ai'），已存在的词则 weight += 1
- DictionaryView 分为「AI 推荐」和「手动新增」两个区块，按 weight DESC 排序
- SettingsView 新增「智慧字典学习」开关（macOS 预设开启，Windows 预设关闭）
- DashboardView 显示 vocabulary_analysis API 成本
- HUD 短暂显示新学习的词汇
- macOS + Windows 双平台支援

**Out of Scope:**
- 批次历史分析（分析过去的 raw_text vs processed_text）
- 使用者在 app 内手动修正历史记录
- 字典词汇的自动删除/过期机制
- 字典词汇的汇出/汇入

## Context for Development

### Codebase Patterns

- 转录流程由 `useVoiceFlowStore.ts` 的 `handleStopRecording()` → `completePasteFlow()` 驱动
- 品质监控由 `keyboard_monitor.rs` 的持久 CGEventTap（macOS）/ Low-Level Hook（Windows）执行
- 字典管理在 `useVocabularyStore.ts`，资料存 SQLite `vocabulary` 表
- 字典词汇在两处使用：
  - Whisper API prompt（Rust `transcription.rs`，`format_whisper_prompt()`，上限 `MAX_WHISPER_PROMPT_TERMS`）
  - AI enhancement system prompt（`enhancer.ts`，`buildSystemPrompt()`，上限 `MAX_VOCABULARY_TERMS`）
- AI 增强使用 Groq Chat API（`enhancer.ts`），model 预设 `mixtral-8x7b-32768`
- 设定储存在 `tauri-plugin-store`（不用 SQLite）
- API 用量记录在 `api_usage` 表，由 `useHistoryStore.ts` 的 `addApiUsage()` 写入
- HUD 透过 Tauri event 跨视窗通讯
- 平台特定逻辑使用 `#[cfg(target_os = "...")]` + 各平台子模组

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/stores/useVoiceFlowStore.ts` | 转录流程主控 store（权重更新 + 修正侦测插入点） |
| `src/stores/useVocabularyStore.ts` | 字典 CRUD store（需扩展 weight/source 方法） |
| `src/stores/useHistoryStore.ts` | API 用量记录（addApiUsage 参考） |
| `src/stores/useSettingsStore.ts` | 设定读写模式参考 |
| `src/lib/enhancer.ts` | AI 增强呼叫模式参考（Groq Chat API 呼叫方式） |
| `src/lib/database.ts` | DB 初始化 + migration 机制 |
| `src-tauri/src/plugins/keyboard_monitor.rs` | 现有品质监控（扩展基础） |
| `src-tauri/src/plugins/transcription.rs` | Whisper prompt 组装（`format_whisper_prompt`） |
| `src/views/DictionaryView.vue` | 字典页面（需改版） |
| `src/views/SettingsView.vue` | 设定页面（新增开关） |
| `src/views/DashboardView.vue` | Dashboard（新增 API 成本项目） |
| `src/components/NotchHud.vue` | HUD 元件（新增学习通知） |

### Technical Decisions

- **侦测触发策略**：贴上后监听**任意** KeyDown（不只 Backspace/Delete）。一侦测到首次按键就立即进入 Phase 2（不等满 5 秒）。Phase 2 中每次按键都做一次 AX 预读（snapshot），侦测到 Enter 时用最新 snapshot 送 AI（解决 LINE 等通讯软体按 Enter 会清空栏位的问题），fallback 为 3 秒 idle（最后按键后 3 秒无新按键），硬上限 15 秒
- **AX 文字读取范围**：透过 `kAXSelectedTextRangeAttribute` 取得选取范围（`CFRange { location, length }`）。`length = 0` 时 `location` 即为游标位置；`length > 0` 时用 `location` 作定位点。从 `kAXValueAttribute` 全文中截取定位点前后 50 字。对 `AXWebArea`（Chromium 系浏览器）优先找其 focused child element 再读取，避免取到整页 DOM 文字
- **AI 分析不做程式 diff**：直接将 pastedText + fieldText 送 AI，让 AI 判断哪些修正值得加入字典
- **AI prompt 严格限缩**：只接受专有名词、技术术语、特定领域用语，排除一般中文词汇、标点修正、语序调整
- **重复词汇处理**：AI 回传的词若已存在字典，不重复插入，而是 weight += 1（相同信号不浪费）
- **权重统一 +1**：不管是被动命中（转录输出包含字典词）还是修正触发（AI 分析回传已存在的词），统一 weight += 1
- **权重命中匹配规则**：英文词使用 word boundary 匹配（正则 `\b`），避免「AI」匹配到「KAISER」等子字串误判；中文词使用 `includes()` 子字串匹配（中文无 word boundary 概念，「台北」匹配「台北市」是合理的）
- **功能预设状态**：智慧字典学习在 SettingsView 有独立开关，macOS 预设 ON（AX API 可用），Windows 预设 OFF（text_field_reader 尚为 no-op）。权重系统独立于此开关，始终启用
- **API 成本追踪**：每次 AI 分析记录为 `api_type = 'vocabulary_analysis'` 到 `api_usage` 表
- **HUD 通知**：新学习的词汇以短暂通知显示在 HUD，不干扰现有状态流
- **先做 macOS**：`text_field_reader.rs` 先实作 macOS AXUIElement，Windows UI Automation 作为后续 task
- **两个 monitor 的时序关系**：`start_quality_monitor`（现有 5 秒）和 `start_correction_monitor`（新增）同时启动，使用完全独立的 flag 集，CGEventTap callback 中两者逻辑互不干扰

## Implementation Plan

### Tasks

- [x] Task 1: DB migration v3 — vocabulary 表新增栏位 + api_usage 表重建
  - File: `src/lib/database.ts`
  - Action: 在 migration 机制中新增 v2 → v3 迁移
  - Notes:
    - vocabulary 表新增栏位：
      - `ALTER TABLE vocabulary ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;`
      - `ALTER TABLE vocabulary ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';`
      - source 值：`'manual'`（使用者手动新增）| `'ai'`（AI 推荐自动加入）
      - 新增索引：`CREATE INDEX idx_vocabulary_weight ON vocabulary(weight DESC);`
      - 现有的手动新增词汇全部 weight = 1, source = 'manual'
    - api_usage 表重建（更新 CHECK constraint 加入 `'vocabulary_analysis'`）：
      - SQLite 不支援 `ALTER TABLE ... MODIFY CONSTRAINT`，必须重建表
      - 步骤：
        1. `CREATE TABLE api_usage_new (... CHECK(api_type IN ('whisper', 'chat', 'vocabulary_analysis')) ...)`
        2. `INSERT INTO api_usage_new SELECT * FROM api_usage`
        3. `DROP TABLE api_usage`
        4. `ALTER TABLE api_usage_new RENAME TO api_usage`
        5. 重建索引 `idx_api_usage_transcription_id`
      - 必须在 transaction 中执行，确保原子性
    - 更新 `schema_version` 为 3

- [x] Task 2: 更新 VocabularyEntry 型别 + RawVocabularyRow + ApiType
  - Files: `src/types/vocabulary.ts`, `src/types/transcription.ts`
  - Action: 扩展 VocabularyEntry 介面和 ApiType 型别
  - Notes:
    - `src/types/vocabulary.ts`：
      - 新增 `weight: number`（使用权重，预设 1）
      - 新增 `source: 'manual' | 'ai'`（来源）
    - `src/types/transcription.ts`：
      - 更新 `ApiType = "whisper" | "chat" | "vocabulary_analysis"`（从 2 值扩展为 3 值）
    - 同步更新 `useVocabularyStore.ts` 的 `RawVocabularyRow` 和 `mapRowToEntry()`

- [x] Task 3: 扩展 useVocabularyStore — 权重 + AI 方法
  - File: `src/stores/useVocabularyStore.ts`
  - Action: 新增权重相关方法，修改查询排序
  - Notes:
    - 修改 `fetchTermList()` 查询：`ORDER BY weight DESC, created_at DESC`
    - 新增 `addAiSuggestedTerm(term: string)`：INSERT with `source = 'ai'`, `weight = 1`。新增后必须 emit `VOCABULARY_CHANGED` 事件（复用 `addTerm()` 的事件发送逻辑），确保跨视窗同步
    - 新增 `batchIncrementWeights(termIdList: string[])`：逐一执行 `UPDATE vocabulary SET weight = weight + 1 WHERE id = $1`（tauri-plugin-sql 不支援阵列参数展开，不能用 `WHERE id IN ($1)` 传阵列）
    - 新增 `getTopTermListByWeight(limit: number): string[]`：回传前 N 个高权重词的 term 字串
    - 新增 computed `manualTermList`：`source = 'manual'` 的词条
    - 新增 computed `aiSuggestedTermList`：`source = 'ai'` 的词条
    - 修改 `addTerm(term)` 确保 `source = 'manual'`

- [x] Task 4: voiceFlowStore — 权重更新逻辑
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在 `completePasteFlow()` 完成后新增权重更新
  - Notes:
    - 在成功贴上并储存 transcription 后执行
    - `finalText = processedText ?? rawText`
    - 扫描 `vocabularyStore.termList` 中每个 entry：
      - 英文词（`/^[a-zA-Z]/.test(term)`）：用正则 `new RegExp('\\b' + escapeRegex(term) + '\\b', 'i')` 做 word boundary 匹配，避免「AI」匹配到「KAISER」
      - 中文/混合词：用 `finalText.includes(entry.term)` 子字串匹配（中文无 word boundary 概念）
    - 收集所有命中的 `entry.id` → `vocabularyStore.batchIncrementWeights(matchedIdList)`
    - 权重更新失败时静默处理（`catch` + `writeErrorLog`），不影响主流程
    - 权重更新是 fire-and-forget，不阻塞后续流程

- [x] Task 5: 修改 Whisper / AI enhancement 字典注入 — 改用权重排序
  - Files: `src/stores/useVoiceFlowStore.ts`, `src-tauri/src/plugins/transcription.rs`, `src/lib/enhancer.ts`
  - Action: 改用 `getTopTermListByWeight()` 取代直接取全部 termList
  - Notes:
    - `useVoiceFlowStore.ts`：Whisper 呼叫时 `vocabularyStore.getTopTermListByWeight(50)` 取前 50 个
    - `useVoiceFlowStore.ts`：AI enhancement 呼叫时 `vocabularyStore.getTopTermListByWeight(50)` 取前 50 个
    - `transcription.rs`：`MAX_WHISPER_PROMPT_TERMS` 维持 50（与前端一致）
    - `enhancer.ts`：`MAX_VOCABULARY_TERMS` 改为 50（从 100 降）
    - 前端已做筛选，Rust 端的 limit 作为安全护栏

- [x] Task 6: DictionaryView 改版 — 权重显示 + 分区 + 排序
  - File: `src/views/DictionaryView.vue`
  - Action: 重构字典页面 UI
  - Notes:
    - 两个区块：「AI 推荐」（`aiSuggestedTermList`）和「手动新增」（`manualTermList`）
    - 两个区块内各自按 weight DESC 排序（store 查询已处理）
    - Table 新增「权重」栏位，显示方式：
      - weight ≥ 30 → `Badge variant="default"`（高频，醒目）
      - weight ≥ 10 → `Badge variant="secondary"`（中频）
      - weight < 10 → `Badge variant="outline"`（冷门）
    - 「AI 推荐」区块标题旁显示 Badge 计数（如「3 个词」）
    - AI 推荐区块的每个词旁显示 🤖 标示
    - 手动区块的每个词旁显示 ✋ 标示
    - 删除功能两个区块都有，操作方式不变
    - 新增按钮仍只在顶部（手动新增的入口不变）
    - 空状态分别处理：AI 区块为空时显示 `t('dictionary.noAiSuggestions')`
    - 页面顶部新增说明区块（Info icon + `t('dictionary.description')` + `t('dictionary.weightDescription', { limit: 50 })`），解释字典用途和权重机制
    - 所有新增 UI 文字必须走 i18n（`t('dictionary.aiRecommended')`、`t('dictionary.manualAdded')`、`t('dictionary.weight')` 等）

- [x] Task 7: 扩展 keyboard_monitor.rs — 任意按键 + Enter 侦测
  - File: `src-tauri/src/plugins/keyboard_monitor.rs`
  - Action: 新增 `start_correction_monitor` command，支援任意按键侦测 + Enter 优先 + idle fallback
  - Notes:
    - 新增 state 栏位（与现有 quality monitor 的 state 完全独立）：
      - `any_key_pressed: Arc<AtomicBool>` — 任意按键侦测
      - `enter_pressed: Arc<AtomicBool>` — Enter 侦测
      - `last_key_time: Arc<Mutex<Instant>>` — idle 侦测用
      - `correction_monitoring: Arc<AtomicBool>` — 修正监控模式 flag
      - `correction_cancel_token: Arc<AtomicBool>` — 取消 token
    - 扩展 CGEventTap callback（macOS）和 Hook callback（Windows）：
      - 当 `correction_monitoring = true` 时（与 `is_monitoring` 独立判断，两者可同时为 true）：
        - 任意 KeyDown → `any_key_pressed = true`，更新 `last_key_time`
        - Enter（macOS keycode 36 / Windows VK_RETURN 0x0D）→ `enter_pressed = true`
      - 原有的 `is_monitoring` 逻辑不变（Backspace/Delete → `was_modified`）
    - 新增 `#[tauri::command] pub fn start_correction_monitor(app: AppHandle)`：
      - 重置所有 correction state
      - 启动计时器执行绪：
        - **Phase 1**：100ms 间隔轮询 `any_key_pressed`，最长等 5 秒
          - 一侦测到首次按键 → **立即进入 Phase 2**（不等满 5 秒）
          - 5 秒内无按键 → emit `correction-monitor:result { anyKeyPressed: false }` → 结束
        - **Phase 2**：循环检查（100ms 间隔）
          - `enter_pressed = true` → emit result（`enterPressed: true`）→ 结束
          - `last_key_time` 距今 ≥ 3 秒 → idle timeout → emit result（`idleTimeout: true`）→ 结束
          - 总时间 ≥ 15 秒 → 硬上限 → emit result → 结束
      - emit event：`correction-monitor:result`
    - 新增 payload struct：
      ```rust
      struct CorrectionMonitorResultPayload {
          any_key_pressed: bool,
          enter_pressed: bool,
          idle_timeout: bool,
      }
      ```
    - 新增 macOS keycode：`ENTER: u16 = 36`
    - 新增 Windows VK code：`VK_RETURN: u32 = 0x0D`
    - IME Enter 去抖：Enter keyDown 后启动 500ms debounce timer，期间若有新 keyDown（使用者在 IME 候选字中按 Enter 选字后继续打字）则重置 timer。只有 500ms 无新按键才设定 `enter_pressed = true`，避免 IME 选字的 Enter 被误判为送出
    - 现有的 `start_quality_monitor` 和相关逻辑完全不变，两个 monitor 使用完全独立的 flag 集

- [x] Task 8: 新增 text_field_reader.rs — macOS AXUIElement 实作
  - File: `src-tauri/src/plugins/text_field_reader.rs`
  - Action: 建立新 plugin，透过 Accessibility API 读取 focused text field 的游标附近文字
  - Notes:
    - macOS 实作流程（`mod macos`）：
      1. `AXUIElementCreateSystemWide()` → systemWide element
      2. `AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplication)` → focused app
      3. `AXUIElementCopyAttributeValue(app, kAXFocusedUIElement)` → focused element
      4. 检查 `kAXRoleAttribute`：
         - `AXTextField` / `AXTextArea` / `AXComboBox` → 直接使用此 element
         - `AXWebArea`（Chromium 系浏览器）→ 尝试 `kAXFocusedUIElementAttribute` 取 child focused element，成功则用 child，失败则 fallback 用 WebArea 本身
         - 其他 role → 回传 `Ok(None)`
      5. `AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute)` → 回传 `AXValue` 包装的 `CFRange { location, length }`
         - `length = 0`：游标无选取，`location` 即为游标位置
         - `length > 0`：有选取范围，用 `location` 作为定位点
         - 读取失败：fallback 取全文末尾 100 字
      6. `AXUIElementCopyAttributeValue(element, kAXValueAttribute)` → 全文 CFString
      7. 截取 `location - 50 .. location + 50`（边界 clamp，处理 char boundary 对齐）
      8. 回传 `Ok(Some(excerpt))`
    - AX API 透过 `extern "C"` FFI 宣告（参考 `hotkey_listener.rs` 的 `AXIsProcessTrusted`）
    - 需要的 FFI 宣告：
      - `AXUIElementCreateSystemWide() -> AXUIElementRef`
      - `AXUIElementCopyAttributeValue(element, attribute, value_out) -> AXError`
      - `kAXFocusedApplicationAttribute`, `kAXFocusedUIElementAttribute`
      - `kAXValueAttribute`, `kAXSelectedTextRangeAttribute`, `kAXRoleAttribute`
    - `AXError != 0` 时回传 `Ok(None)`（不是 error，只是读不到）
    - 所有 CF 物件需正确 `CFRelease`（使用 `core_foundation` crate 的 wrapper 自动管理）
    - Tauri command：`#[command] pub fn read_focused_text_field() -> Result<Option<String>, String>`
    - Windows 实作先用 no-op placeholder：`Ok(None)`（后续 task 补上 UI Automation）

- [x] Task 9: 注册新 plugin + command
  - Files: `src-tauri/src/plugins/mod.rs`, `src-tauri/src/lib.rs`
  - Action: 注册 text_field_reader 模组和 commands
  - Notes:
    - `mod.rs`：`pub mod text_field_reader;`
    - `lib.rs` `generate_handler![]`：新增 `plugins::text_field_reader::read_focused_text_field`
    - `lib.rs` `generate_handler![]`：新增 `plugins::keyboard_monitor::start_correction_monitor`

- [x] Task 10: 新增 vocabularyAnalyzer.ts — AI 分析逻辑
  - File: `src/lib/vocabularyAnalyzer.ts`
  - Action: 建立字典分析模组，呼叫 Groq Chat API 比对原始与修正文字
  - Notes:
    - 使用 `@tauri-apps/plugin-http` 的 `fetch`（**不用浏览器原生 fetch**）
    - API 端点：`https://api.groq.com/openai/v1/chat/completions`
    - Model：使用 `settingsStore.selectedVocabularyAnalysisModelId`（独立于 enhancer，预设 `llama-3.3-70b-versatile`，可选 Kimi K2 Instruct）
    - Temperature：0.1（比 enhancer 的 0.3 更低，要求更确定性的回答）
    - max_tokens：256（回传 JSON array，不需要太多 token）
    - System prompt（严格版）：
      ```
      你是语音转录字典助手。
      比较以下「原始转录输出」和「使用者修正后的文字」，
      找出因为语音辨识错误而被修正的词汇。

      【只回传符合以下条件的修正后词汇】
      ✅ 专有名词（人名、地名、品牌、公司名、产品名）
      ✅ 技术术语（框架、程式语言、工具、协定）
      ✅ 特定领域用语（行业术语、学术用语）

      【严格排除】
      ❌ 一般常用中文词汇
      ❌ 标点符号修正
      ❌ 语序调整、赘词删除
      ❌ 大小写差异的英文常见词
      ❌ 使用者新增的补充内容（不在原文中的）
      ❌ 模糊不确定的推测

      回传格式：JSON array，例如 ["Vue.js", "泰呈"]
      没有符合条件的词就回传 []
      绝对不要回传空字串或解释文字，只要 JSON array。
      ```
    - User message：`<original>{pastedText}</original>\n<corrected>{fieldText}</corrected>`
    - 回传型别：`VocabularyAnalysisResult { suggestedTermList: string[], usage: ApiUsageInfo }`
    - 解析 AI 回传：尝试 `JSON.parse()`，失败则回传空阵列
    - 参考 `enhancer.ts` 的 API 呼叫模式（headers、error handling）
    - 汇出函式：`analyzeCorrections(pastedText: string, fieldText: string, apiKey: string, options?: { modelId?: string }): Promise<VocabularyAnalysisResult>`

- [x] Task 11: voiceFlowStore — 整合修正侦测流程
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在 `completePasteFlow()` 后新增修正侦测 + AI 分析流程
  - Notes:
    - 完整流程（在 `completePasteFlow` 之后，fire-and-forget）：
      1. 检查 `settingsStore.isSmartDictionaryEnabled` → false 则跳过
      2. 捕获必要变数到 closure：`const pastedText = params.text`、`const transcriptionId = params.record.id`、`const apiKey = ...`
      3. `invoke("start_correction_monitor")` — 启动修正监控
      4. **Snapshot 机制**：在 Phase 2 期间，前端启动一个 polling（每 500ms）呼叫 `invoke("read_focused_text_field")`，将结果存入 `latestSnapshot` 变数。这是为了解决 LINE 等通讯软体按 Enter 后文字栏位会清空的问题——Enter 触发时用的是「最后一次成功读到的 snapshot」
      5. 监听 `correction-monitor:result` 事件（一次性 listener），收到结果：
         - `anyKeyPressed = false` → 停止 polling、结束
         - `anyKeyPressed = true` →
           - 停止 snapshot polling
           - 如果 `enterPressed = true`：先尝试 fresh read（`invoke("read_focused_text_field")`），若结果非空则用 fresh read；若为空（LINE 等 app 已清空）则 fallback 使用 `latestSnapshot`
           - 如果 `idleTimeout = true`：做最后一次 `invoke("read_focused_text_field")` 取最新值
           - `fieldText === null` → 结束（所有读取都失败）
           - `fieldText.includes(pastedText)` → 结束（使用者没修改我们贴的文字）
           - 呼叫 `analyzeCorrections(pastedText, fieldText, apiKey)`
           - 回传空阵列 → 结束
           - 非空阵列 → 处理每个 suggestedTerm：
             - `vocabularyStore.isDuplicateTerm(term)` ?
               - true → 找到该 entry，`vocabularyStore.batchIncrementWeights([entry.id])`
               - false → `vocabularyStore.addAiSuggestedTerm(term)`
           - 记录 `historyStore.addApiUsage({ apiType: 'vocabulary_analysis', transcriptionId, ... })`
           - emit `VOCABULARY_LEARNED` 事件给 HUD（只包含新增的词，不包含已存在的）
      6. 所有错误静默处理 + `writeErrorLog` + `captureError`
    - 修正侦测流程包裹在 `void (async () => { ... })()` 中，不阻塞任何现有流程
    - 如果使用者在修正侦测期间触发了新的转录，`start_correction_monitor` 会覆盖前一次监控（利用现有的 cancel 机制），前端也需要停止旧的 snapshot polling

- [x] Task 12: useSettingsStore — 新增智慧字典开关
  - File: `src/stores/useSettingsStore.ts`
  - Action: 新增 `isSmartDictionaryEnabled` 设定
  - Notes:
    - 预设值：macOS `true`（开启），Windows `false`（关闭，text_field_reader 尚为 no-op）
    - 存储在 `tauri-plugin-store`（与其他设定一致）
    - key：`smartDictionaryEnabled`
    - 提供 getter 和 setter（与现有 `isEnhancementThresholdEnabled` 模式一致）

- [x] Task 13: SettingsView — 新增智慧字典设定区块
  - File: `src/views/SettingsView.vue`
  - Action: 在设定页面新增智慧字典学习的开关
  - Notes:
    - 新增一个 Card 区块（位置：在「短文字门槛」之后）
    - 标题：智慧字典学习
    - Switch 绑定：`:model-value="settingsStore.isSmartDictionaryEnabled"` + `@update:model-value`
    - 说明文字：`t('settings.smartDictionary.description')`
    - 补充说明（text-muted-foreground text-xs）：`t('settings.smartDictionary.privacyNote')`
    - 所有文字走 i18n，不硬编码
    - 使用与现有 Switch 一致的 layout 模式

- [x] Task 14: 新增 events — VOCABULARY_LEARNED + CORRECTION_MONITOR_RESULT
  - Files: `src/types/events.ts`, `src/composables/useTauriEvents.ts`
  - Action: 定义新事件常量和 payload 型别
  - Notes:
    - `VOCABULARY_LEARNED = 'vocabulary:learned'`
    - `VocabularyLearnedPayload { termList: string[] }`（新增的词列表）
    - `CORRECTION_MONITOR_RESULT = 'correction-monitor:result'`
    - `CorrectionMonitorResultPayload { anyKeyPressed: boolean, enterPressed: boolean, idleTimeout: boolean }`

- [x] Task 15: NotchHud — 学习通知
  - File: `src/components/NotchHud.vue`
  - Action: 新增学习通知的视觉回馈
  - Notes:
    - 监听 `VOCABULARY_LEARNED` 事件
    - 收到事件时进入 expanded mode（notch 高度 42→72px，与 error 模式相同）
    - 上排：左侧 book icon（lucide BookOpen SVG inline），右侧 label `t('voiceFlow.vocabularyLearnedLabel')`（如「新增字典」）
    - 下排：词汇文字 `t('voiceFlow.vocabularyLearned', { terms })`，居中显示
    - 如果词太多（> 3 个），截断显示 `t('voiceFlow.vocabularyLearnedTruncated', { terms, count })`
    - 播放音效：`invoke("play_learned_sound")`（macOS: Glass.aiff，Windows: 复用 start sound）
    - 音效实作：`sound_feedback.rs` 新增 `play_learned_sound` command
    - 所有文字走 i18n
    - 视觉风格：与 success 类似但用柔和蓝色光晕（`shadow-blue-500/30`）
    - 显示时长：2.8 秒后自动隐藏（由 voiceFlowStore 的 `LEARNED_NOTIFICATION_TOTAL_DURATION_MS` 控制）
    - HUD 视窗显示机制：voiceFlowStore 在 emit 事件后呼叫 `appWindow.show()` + `setIgnoreCursorEvents(true)`，设定 2.8 秒 auto-hide timer
    - 不干扰现有 HUD 状态：如果 HUD 正在显示其他状态（recording/transcribing/error），排队等候
    - 优先级低于所有现有状态

- [x] Task 16: DashboardView + useHistoryStore — 新增 vocabulary_analysis API 成本
  - Files: `src/views/DashboardView.vue`, `src/stores/useHistoryStore.ts`, `src/types/transcription.ts`
  - Action: 在 API 配额/成本区域新增 vocabulary_analysis 的统计
  - Notes:
    - `src/types/transcription.ts`：`DailyQuotaUsage` 介面新增 `vocabularyAnalysisRequestCount: number`、`vocabularyAnalysisTotalTokens: number`
    - `src/stores/useHistoryStore.ts`：
      - `DAILY_QUOTA_USAGE_SQL` 的 `GROUP BY api_type` 查询已涵盖新的 api_type，不需改 SQL
      - 在 `for (const row of rows)` 回圈中新增 `else if (row.api_type === "vocabulary_analysis")` 分支，映射到新的 state 栏位
      - `DailyQuotaUsage` 初始值新增 `vocabularyAnalysisRequestCount: 0`、`vocabularyAnalysisTotalTokens: 0`
    - `src/views/DashboardView.vue`：
      - 在配额 Tooltip 中新增一行显示「字典分析」的请求次数和 token 用量
      - 使用 `t('dashboard.vocabularyAnalysis')` i18n key
      - 若 `vocabularyAnalysisRequestCount === 0` 则不显示此行（避免功能关闭时占位）

- [x] Task 17: 更新前端测试
  - Files: `tests/unit/use-vocabulary-store.test.ts`, `tests/unit/use-voice-flow-store.test.ts`
  - Action: 为新增功能加入测试
  - Notes:
    - VocabularyStore 测试：
      - `addAiSuggestedTerm()` 正确插入 source='ai'
      - `batchIncrementWeights()` 正确更新 weight
      - `getTopTermListByWeight()` 回传正确排序和数量
      - `manualTermList` / `aiSuggestedTermList` computed 正确过滤
    - VoiceFlowStore 测试：
      - 权重更新在 completePasteFlow 后被呼叫
      - `isSmartDictionaryEnabled = false` 时不启动修正侦测
      - mock `start_correction_monitor` 和 `read_focused_text_field`

- [x] Task 18: 更新 CLAUDE.md IPC 契约表
  - File: `CLAUDE.md`
  - Action: 新增 commands 和 events 到契约表
  - Notes:
    - Tauri Commands 新增：
      - `read_focused_text_field` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>`
      - `start_correction_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()`
    - Rust → Frontend Events 新增：
      - `correction-monitor:result` | keyboard_monitor.rs | `CORRECTION_MONITOR_RESULT` | `CorrectionMonitorResultPayload`
    - Frontend-only Events 新增：
      - `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore | HUD

### Acceptance Criteria

- [ ] AC 1: Given 使用者完成转录且字典词出现在输出中，when 文字贴上后，then 对应字典词 weight 自动 +1
- [ ] AC 2: Given 字典有 60 个词，when Whisper 转录时，then 只有 weight 前 50 个词被送入 prompt
- [ ] AC 3: Given 字典有 60 个词，when AI 增强时，then 只有 weight 前 50 个词被送入 system prompt
- [ ] AC 4: Given 智慧字典学习已启用，when 转录贴上后使用者未按任何键（5 秒内），then 不触发 AX 读取和 AI 分析
- [ ] AC 5: Given 智慧字典学习已启用，when 转录贴上后使用者修正文字并按 Enter，then 立即触发 AX 读取 → AI 分析
- [ ] AC 6: Given 智慧字典学习已启用，when 转录贴上后使用者修正文字但未按 Enter，then 3 秒 idle 后触发 AX 读取 → AI 分析
- [ ] AC 7: Given AI 分析回传新词（字典中不存在），when 处理结果时，then 自动加入字典（source='ai', weight=1）且 HUD 以 expanded mode 显示「新增字典」label + 词汇列表，并播放 Glass 音效
- [ ] AC 8: Given AI 分析回传的词已存在字典中，when 处理结果时，then 不重复加入，但 weight += 1
- [ ] AC 9: Given AI 分析回传空阵列，when 处理结果时，then 不做任何字典操作，不显示 HUD
- [ ] AC 10: Given 智慧字典学习已关闭，when 转录贴上后，then 不启动修正侦测流程
- [ ] AC 11: Given DictionaryView 页面，when 字典有 AI 推荐和手动词条，then 分两个区块显示，各自按 weight DESC 排序
- [ ] AC 12: Given DictionaryView 页面，when 词条有不同 weight，then 用 Badge variant 区分高频/中频/冷门
- [ ] AC 13: Given AX 读取失败（不是文字栏位、使用者已切换 app），when 修正侦测流程中，then 静默放弃，不影响使用者
- [ ] AC 14: Given 修正侦测超过 15 秒硬上限，when Phase 2 进行中，then 强制触发 AX 读取结束监控
- [ ] AC 15: Given 有 vocabulary_analysis API 呼叫记录，when 开启 Dashboard，then 显示此项目的成本统计
- [ ] AC 16: Given 使用者在 LINE 修正文字后按 Enter（文字栏位被清空），when 修正侦测触发 AI 分析，then 使用 Enter 前的 snapshot 文字（非清空后的空字串）
- [ ] AC 17: Given 使用者修正文字但 AX 读到的 fieldText 仍完整包含 pastedText，when 修正侦测比对，then 判定为未修改，不触发 AI 分析
- [ ] AC 18: Given 字典有英文词「AI」，when 转录输出包含「KAISER」，then 不计为命中（word boundary 匹配）

## Additional Context

### Dependencies

- **macOS**: `core-foundation` crate 0.10（已存在）— 用于 CFString、CFRange 操作
- **macOS**: Accessibility framework — 透过 `extern "C"` FFI 宣告 AX API（与 hotkey_listener.rs 使用同一套权限）
- **Windows**: `windows` crate 0.61（已存在）— 需确认 `Win32_UI_Accessibility` feature 是否已启用，若无需新增
- **Groq Chat API** — 复用现有的 API key 和呼叫模式（同 enhancer.ts）
- 无新增外部 crate 依赖

### Testing Strategy

**Rust 端：**
- `keyboard_monitor.rs`：测试新增的 state 栏位初始值、Phase 1/2 计时逻辑（利用 mock Instant）
- `text_field_reader.rs`：测试 no-op fallback（非支援平台）、截取逻辑的边界情况（游标在开头/结尾/中间）
- AX API 实际呼叫无法在 CI 测试，需手动测试

**前端：**
- `useVocabularyStore`：新增方法的单元测试（mock SQLite）
- `useVoiceFlowStore`：修正侦测流程的整合测试（mock Tauri commands + events）
- `vocabularyAnalyzer.ts`：AI prompt 回传解析测试（正常 JSON、空阵列、非 JSON 回传）

**手动测试：**
- macOS：转录 → 修正 → 确认 HUD 显示学习通知
- 确认已存在的词不重复加入但 weight 增加
- 确认不是文字栏位（例如在桌面上）时静默放弃
- 确认 DictionaryView 正确分区和排序
- 确认 Dashboard 显示 vocabulary_analysis 成本
- 确认关闭开关后不触发修正侦测

### Notes

- **隐私保障**：AX 读取的文字只取游标前后 50 字（不是整份文件），且只送给 AI 做分析，不储存原文到 DB。correction_log 表不在 scope 内。
- **权限复用**：SayIt 已有 Accessibility 权限（CGEventTap 需要），AXUIElement 读取使用同一权限，使用者不会看到任何新的权限请求。
- **成本控制**：每次修正侦测最多触发一次 Groq Chat API 呼叫（token 很少，~100 prompt + ~50 completion）。只有在侦测到按键活动且 AX 读取成功时才呼叫。功能预设关闭。
- **Phase 2 硬上限 15 秒的理由**：15 秒内使用者能完成大部分修正。超过 15 秒的操作很可能已经是在做其他事，读取到的文字会包含不相关内容。30 秒太长容易引入杂讯。
- **Enter vs idle 的取舍 + Snapshot 机制**：Enter 在通讯软体（LINE、Slack、Teams）中是「送出讯息」的动作，按 Enter 后文字栏位会清空。因此 Phase 2 期间持续做 snapshot（每 500ms 预读一次）。Enter 触发时先尝试 fresh read，若成功且非空则用 fresh read（适用于笔记型 app），若为空则 fallback 用最后一个成功的 snapshot（适用于 LINE 等通讯 app）。笔记型 app 使用者不一定按 Enter，所以 idle 3 秒 + 最终读取作为 fallback。
- **IME Enter 去抖**：IME 输入法选字时也会产生 Enter keyDown 事件，为避免误判，Rust 端加入 500ms debounce timer。Enter keyDown 后等 500ms，期间若有新按键则重置 timer（代表使用者只是在选字），只有 500ms 无新按键才确认为真正的 Enter。
- **Windows UI Automation 延后实作**：Task 8 中 Windows 为 no-op placeholder。建议在 Phase 1（权重系统）完成并验证后，再补上 Windows 的 `IUIAutomation` 实作。
- **api_usage 表 CHECK constraint**：v3 migration 中透过 CREATE-SELECT-DROP-RENAME 重建 `api_usage` 表，将 CHECK 从 `('whisper', 'chat')` 扩展为 `('whisper', 'chat', 'vocabulary_analysis')`。

### Adversarial Review 修正摘要

| Finding | 严重度 | 修正方式 |
|---------|--------|---------|
| F1: api_usage CHECK constraint 挡 INSERT | Critical | Task 1: v3 migration 重建 api_usage 表 |
| F2: vocabulary_analysis 的 transcription_id 来源 | Critical | Task 11: closure 中明确 capture `record.id` |
| F3: quality monitor 和 correction monitor 竞争 | High | Technical Decisions: 明确两者 flag 完全独立 |
| F4: kAXSelectedTextRangeAttribute 是 CFRange | High | Task 8: 明确处理 location/length |
| F5: AXWebArea 回传整页 DOM 文字 | High | Task 8: 优先找 WebArea focused child |
| F6: batchIncrementWeights SQL 阵列参数 | High | Task 3: 改用逐一 UPDATE 回圈 |
| F7: includes() 英文子字串误判 | Medium | Task 4: 英文用 word boundary，中文用 includes |
| F8: fieldText === pastedText 检查不合理 | Medium | Task 11: 改为 fieldText.includes(pastedText) |
| F9: Phase 1 等满 5 秒才进 Phase 2 | Medium | Task 7: 首次按键立即进入 Phase 2 |
| F10: addAiSuggestedTerm 缺少事件 | Medium | Task 3: 明确要 emit VOCABULARY_CHANGED |
| F11: ApiType 型别未包含新值 | Medium | Task 2: 更新 ApiType union |
| F12: Dashboard quota 只处理 2 个分支 | Medium | Task 16: 补上具体 state/query/UI |
| F13: UI 文字未走 i18n | Low | Task 6/13/15: 全改用 t() |
| F14: Task 12 应在 Task 11 之前 | Low | Implementation Priority: 修正顺序 |
| F15: LINE 按 Enter 清空文字栏位 | Critical | Task 11: Snapshot 机制（Phase 2 持续预读） |

### Implementation Priority

```
Phase 1 — 权重系统（独立，不依赖 AX）
  Task 1 → 2 → 3 → 4 → 5 → 6

Phase 2 — 修正侦测 + AI 分析
  Task 12 → 14 → 7 → 8 → 9 → 10 → 11
  (Task 12 提前：Task 11 依赖 settingsStore.isSmartDictionaryEnabled)
  (Task 14 提前：Task 7/11 依赖 event 常量定义)

Phase 3 — UI 通知 + Dashboard + Settings
  Task 13 → 15 → 16

Phase 4 — 测试 + 文件
  Task 17 → 18
```

### Post-Implementation Review 修正摘要

| Finding | 严重度 | 处理方式 |
|---------|--------|---------|
| F1: v2→v3 migration 无 transaction 保护 | High | `database.ts`: 整个 migration 包进 BEGIN/COMMIT/ROLLBACK |
| F2: analyzeCorrections 送全文 excerpt 截断 | Low | 接受现状：短语音场景超过 100 字为少数 |
| F3: 全文送 API 成本 | Low | 同 F2，接受现状 |
| F4+F6: correction monitor listener 泄漏 | High | `useVoiceFlowStore.ts`: 新增模组级 unlisten 追踪 + 3 处清除点 |
| F9: Windows text_field_reader no-op | Medium | 接受现状：UIA 复杂度高，spec 明确延后 |
| F10: batchIncrementWeights 在 hot path 上阻塞 | Medium | `useVoiceFlowStore.ts`: 改为 fire-and-forget + .catch() |

### Manual Testing 修正摘要

| Finding | 严重度 | 处理方式 |
|---------|--------|---------|
| T1: HUD VOCABULARY_LEARNED 通知不显示（window 已 hide） | High | `useVoiceFlowStore.ts`: emit 后呼叫 `appWindow.show()` + 2.8 秒 auto-hide timer |
| T2: IME 选字 Enter 被误判为送出 Enter | High | `keyboard_monitor.rs`: Enter keyDown 加 500ms debounce timer |
| T3: Snapshot polling 2 秒太慢，抓到 IME 选字前的旧文字 | Medium | `useVoiceFlowStore.ts`: `SNAPSHOT_POLL_INTERVAL_MS` 从 2000 降至 500 |
| T4: Enter 触发只用 snapshot，笔记型 app 可直接 fresh read | Medium | `useVoiceFlowStore.ts`: Enter 触发时先尝试 fresh read，空值才 fallback snapshot |
| T5: HUD 通知无音效 | Enhancement | `sound_feedback.rs`: 新增 `play_learned_sound`（macOS: Glass.aiff） |
| T6: HUD 通知改为 expanded layout + label/terms 分行 | Enhancement | `NotchHud.vue`: expanded mode，上排 icon + label，下排 terms |
| T7: DictionaryView 缺少说明文字 | Enhancement | `DictionaryView.vue`: 新增 Info icon + description + weightDescription |
| T8: MAX_WHISPER_PROMPT_TERMS 应为 50 | Medium | `transcription.rs` + `useVoiceFlowStore.ts` + i18n: 统一为 50 |
