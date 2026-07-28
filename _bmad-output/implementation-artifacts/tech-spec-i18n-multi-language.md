---
title: '多国语言切换功能（i18n）'
slug: 'i18n-multi-language'
created: '2026-03-08'
status: 'done'
stepsCompleted: [1, 2, 3, 4]
adversarial_review: 'completed — 16 findings addressed'
tech_stack: ['vue-i18n ^11', 'vue ^3.5', 'tauri-plugin-store ^2.4.2', 'Rust transcription.rs']
files_to_modify:
  - 'src/main.ts'
  - 'src/main-window.ts'
  - 'src/MainApp.vue'
  - 'src/stores/useSettingsStore.ts'
  - 'src/stores/useVoiceFlowStore.ts'
  - 'src/stores/useVocabularyStore.ts'
  - 'src/lib/enhancer.ts'
  - 'src/lib/errorUtils.ts'
  - 'src/lib/formatUtils.ts'
  - 'src/lib/keycodeMap.ts'
  - 'src/views/SettingsView.vue'
  - 'src/views/DashboardView.vue'
  - 'src/views/HistoryView.vue'
  - 'src/views/DictionaryView.vue'
  - 'src/components/AccessibilityGuide.vue'
  - 'src/components/DashboardUsageChart.vue'
  - 'src-tauri/src/plugins/transcription.rs'
  - 'src/types/events.ts'
  - 'tests/component/AccessibilityGuide.test.ts'
  - 'tests/unit/use-voice-flow-store.test.ts'
files_to_create:
  - 'src/i18n/index.ts'
  - 'src/i18n/locales/zh-TW.json'
  - 'src/i18n/locales/en.json'
  - 'src/i18n/locales/ja.json'
  - 'src/i18n/locales/zh-CN.json'
  - 'src/i18n/locales/ko.json'
  - 'src/i18n/prompts.ts'
  - 'src/i18n/languageConfig.ts'
  - 'tests/unit/i18n-settings.test.ts'
  - 'tests/component/i18n-smoke.test.ts'
code_patterns:
  - 'Settings Store: load() -> get() -> set() -> save() -> emitEvent()'
  - 'Cross-window sync: refreshCrossWindowSettings() reads store and updates ref'
  - 'Rust command: #[command] pub async fn + State<> + Option<> params'
  - 'enhanceText: already supports options.systemPrompt dynamic injection'
  - 'VoiceFlow invoke: invoke("transcribe_audio", { apiKey, vocabularyTermList, modelId })'
  - 'Dual WebView: HUD and Dashboard are separate JS runtimes, NOT shared singleton'
test_patterns:
  - 'Vitest + jsdom, vi.mock @tauri-apps series'
  - 'Store test: import -> useStore() -> call method -> expect mockStoreSet'
  - 'Component test: mount + props -> trigger -> assert'
  - '14 test files in tests/unit/ and tests/component/'
---

# Tech-Spec: 多国语言切换功能（i18n）

**Created:** 2026-03-08
**Adversarial Review:** Completed — 16 findings addressed (2 Critical, 4 High, 7 Medium, 3 Low)

## Overview

### Problem Statement

目前所有 UI 文字、AI Prompt 预设值、Whisper 识别语言都硬编码为繁体中文，国际使用者无法使用母语介面操作应用程式。此外，现有的幻觉检测逻辑隐含「使用者语言 = 中文」的假设，多语言后会导致非中文转录被误杀。

### Solution

导入 `vue-i18n`，建立 5 种语言翻译档（zh-TW、en、ja、zh-CN、ko），在设定页面新增语言切换器，同时连动 Whisper 识别语言与 AI Prompt 预设值。首次启动自动侦测系统语言，侦测不到时 fallback 为 `zh-TW`（保护既有中文使用者的升级体验）。同时修复幻觉检测的语言假设问题和错误处理中的字串耦合。

### Scope

**In Scope:**

1. **vue-i18n 基础建设** — 安装套件、建立 locale JSON 档（zh-TW、en、ja、zh-CN、ko）
2. **UI 翻译** — Dashboard 所有 views + MainApp sidebar + HUD 视窗 + 元件 + lib 层
3. **设定页面新增语言选择器** — 在「应用程式」Card 中新增语言下拉选单
4. **系统语言自动侦测** — 首次启动侦测系统语言，侦测不到时 fallback 为 `zh-TW`
5. **语言偏好持久化** — 存入 `tauri-plugin-store`
6. **Whisper 语言连动** — UI 语言切换时，Rust 端 `TRANSCRIPTION_LANGUAGE` 改为动态参数
7. **AI Prompt 多语言预设** — `DEFAULT_SYSTEM_PROMPT` 改为每种语言一份预设 prompt
8. **HTML lang 属性** — 动态切换
9. **幻觉检测修复** — `isSilenceOrHallucination` 的 CJK 检查改为仅在 Whisper language = `"zh"` 时启用
10. **错误处理重构** — `enhancer.ts` 的错误改用结构化 Error（带 `statusCode` 属性），消除 `errorUtils.ts` 对全形冒号的字串耦合

**Out of Scope:**

- Rust 后端 log 讯息翻译
- 使用者自订 prompt 的自动翻译（只改预设值，使用者已自订的不动）
- RTL 排版支援
- `SiteHeader.vue` — 只接收 prop 显示，无硬编码字串，不需修改

## Context for Development

### Codebase Patterns

**Settings Store Pattern（新增设定项标准流程）：**

```
1. 定义常数 DEFAULT_XXX + 型别
2. 宣告 ref<Type>(DEFAULT_XXX)
3. loadSettings() 中 store.get<Type>("key") ?? DEFAULT_XXX
4. saveXxx() 中 store.set("key", value) -> store.save() -> 更新 ref -> emitEvent(SETTINGS_UPDATED)
5. refreshCrossWindowSettings() 中重新 get 并更新 ref
6. return { ref, saveXxx }
```

**双视窗架构（重要）：**

HUD（`index.html` / `main.ts`）和 Dashboard（`main-window.html` / `main-window.ts`）是**两个独立的 Tauri WebView**，各自有独立的 JS runtime。import 同一个 `src/i18n/index.ts` 会在各自的 runtime 中各建立一个 `createI18n()` instance。它们**不是** singleton。语言切换时透过 `emitEvent(SETTINGS_UPDATED)` + `refreshCrossWindowSettings()` 做跨视窗同步，在 refresh 中必须同步更新 `i18n.global.locale.value` 和 `document.documentElement.lang`。

**Rust Command Pattern（transcribe_audio 现有签名）：**

```rust
#[command]
pub async fn transcribe_audio(
    state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError>
```

语言硬编码为常数：`const TRANSCRIPTION_LANGUAGE: &str = "zh";`
使用于 multipart form：`.text("language", TRANSCRIPTION_LANGUAGE)`

**VoiceFlow 呼叫点（用 code pattern 定位，非行号）：**

- `invoke("transcribe_audio", { apiKey, vocabularyTermList, modelId })` — 在 `handleStopRecording()` 中
- `enhanceText(result.rawText, apiKey, { systemPrompt, vocabularyTermList, modelId })` — 在 `handleStopRecording()` 的 enhance 阶段

**错误处理字串耦合（Critical — F2）：**

`enhancer.ts` 的 `enhanceText()` 抛出含全形冒号的 Error：`"AI 整理失败：${status} ${statusText}..."`。`errorUtils.ts` 的 `getEnhancementErrorMessage()` 用 `error.message.match(/：(\d+)/)` 提取 status code。翻译后全形冒号会消失，导致 status code 解析坏掉。必须改用结构化 Error。

### 硬编码字串盘点

| 区域 | 档案数 | 估计字串数 | 备注 |
| ---- | ------ | ---------- | ---- |
| SettingsView.vue | 1 | ~55 | Card 标题 + Label + 描述 + 按钮 + feedback + trigger key labels |
| MainApp.vue | 1 | ~24 | sidebar nav labels(4) + 更新相关讯息(15+) + AlertDialog(5+) |
| DashboardView.vue | 1 | ~19 | 统计卡片、配额标签 |
| HistoryView.vue | 1 | ~16 | 搜寻、表头、空状态、操作按钮 |
| DictionaryView.vue | 1 | ~11 | 标题、placeholder、Badge、feedback |
| errorUtils.ts | 1 | ~24 | 所有使用者可见错误讯息 |
| useVoiceFlowStore.ts | 1 | ~12 | HUD 状态(5) + 空转录(1) + 贴上失败(1) + 录音太短(1) + 其他 |
| useSettingsStore.ts | 1 | ~3 | throw Error 中文字串（API Key/Prompt 空白、自订键显示） |
| AccessibilityGuide.vue | 1 | 9 | 权限对话框完整流程 |
| enhancer.ts | 1 | 3 + prompt | 错误讯息 + DEFAULT_SYSTEM_PROMPT 搬移 |
| formatUtils.ts | 1 | 4 + locale | 时间格式 + `toLocaleString("zh-TW")` 需动态化 |
| DashboardUsageChart.vue | 1 | 2 | 图表图例 + 空状态 |
| useVocabularyStore.ts | 1 | 2 | 重复词汇错误 |
| keycodeMap.ts | 1 | 1 | 按键碰撞警告 |
| **总计** | **14** | **~185** | 不含 prompt（独立计算） |

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/views/SettingsView.vue` | 新增语言选择器 + ~55 个字串翻译 |
| `src/MainApp.vue` | sidebar nav + 更新对话框，~24 个字串翻译 |
| `src/views/DashboardView.vue` | 仪表板，~19 个字串翻译 |
| `src/views/HistoryView.vue` | 历史记录，~16 个字串翻译 |
| `src/views/DictionaryView.vue` | 词汇管理，~11 个字串翻译 |
| `src/stores/useSettingsStore.ts` | 新增 locale 设定 + prompt 连动 + 既有 throw 字串翻译 |
| `src/stores/useVoiceFlowStore.ts` | invoke 加 language + HUD 状态 + 贴上失败 + 录音太短翻译 + 幻觉检测修复 |
| `src/stores/useVocabularyStore.ts` | 2 个错误字串翻译 |
| `src/lib/enhancer.ts` | prompt 多语言 + 错误改用结构化 Error |
| `src/lib/errorUtils.ts` | ~24 个错误讯息翻译 + 移除全形冒号 regex 依赖 |
| `src/lib/formatUtils.ts` | 4 个时间格式翻译 + `toLocaleString` locale 动态化 |
| `src/lib/keycodeMap.ts` | 1 个按键碰撞警告翻译 |
| `src/components/AccessibilityGuide.vue` | 9 个权限对话框字串翻译 |
| `src/components/DashboardUsageChart.vue` | 2 个图表字串翻译 |
| `src-tauri/src/plugins/transcription.rs` | 硬编码 `"zh"` 改为动态 `language` 参数 |
| `src/main.ts` | HUD 入口，初始化 vue-i18n |
| `src/main-window.ts` | Dashboard 入口，初始化 vue-i18n |

### Technical Decisions

- **vue-i18n** — Vue 生态最成熟的 i18n 方案，支援 Composition API `useI18n()`
- 语言偏好存入 `tauri-plugin-store`，与其他设定一致
- Whisper 语言从前端传入 Rust（新增 `language: Option<String>` 参数）
- AI Prompt 以 `src/i18n/prompts.ts` 集中管理 5 语言版本（prompt 过长不适合 JSON）
- 语言设定切换时，若使用者 prompt 等于当前语言预设值，自动换为新语言预设；已自订则保留
- `errorUtils.ts`、`formatUtils.ts` 等 lib 层透过全域 i18n instance（`i18n.global.t`）翻译
- **双视窗不是 singleton** — 两个独立的 vue-i18n instance，透过 Tauri event + `refreshCrossWindowSettings()` 同步
- **升级路径保护** — 首次启动侦测不到支援语言时 fallback 为 `zh-TW`（而非 `en`），避免既有中文使用者更新后 Whisper 被切为英文
- **`navigator.languages` 已验证可靠** — macOS WKWebView 和 Windows WebView2 皆回传系统语言。已知 Apple 可能截断地区码（如 `"zh-Hant"` 而非 `"zh-Hant-TW"`），侦测逻辑需支援 script subtag 前缀匹配
- **结构化 Error** — `enhancer.ts` 错误改用带 `statusCode` 属性的 Error，消除 `errorUtils.ts` 对字串内容的依赖

### 语言对应表

| 语言 | locale key | Whisper code | HTML lang | 显示名称 | navigator.languages 匹配 |
| ---- | ---------- | ------------ | --------- | --------- | ----------------------- |
| 繁体中文 | `zh-TW` | `zh` | `zh-Hant` | 繁体中文 | `zh-Hant-TW`, `zh-Hant`, `zh-TW` |
| English | `en` | `en` | `en` | English | `en-*`, `en` |
| 日本語 | `ja` | `ja` | `ja` | 日本語 | `ja-*`, `ja` |
| 简体中文 | `zh-CN` | `zh` | `zh-Hans` | 简体中文 | `zh-Hans-*`, `zh-Hans`, `zh-CN`, `zh` |
| 한국어 | `ko` | `ko` | `ko` | 한국어 | `ko-*`, `ko` |

匹配优先顺序：精确匹配 → script subtag 匹配（`zh-Hant` → `zh-TW`、`zh-Hans` → `zh-CN`）→ 语言前缀匹配（`ja-JP` → `ja`）→ fallback `zh-TW`

## Implementation Plan

### Tasks

#### Phase 1：i18n 基础建设 + 初始化（无现有功能依赖）

- [ ] Task 1: 安装 vue-i18n
  - File: `package.json`
  - Action: `pnpm add vue-i18n`
  - Notes: vue-i18n ^10 for Vue 3

- [ ] Task 2: 建立语言设定型别和对应表
  - File: `src/i18n/languageConfig.ts`（新建）
  - Action: 定义 `SupportedLocale` 型别（`'zh-TW' | 'en' | 'ja' | 'zh-CN' | 'ko'`）、`LANGUAGE_OPTIONS` 阵列（含 locale key、显示名称、Whisper code、HTML lang、navigator 匹配 pattern）、`FALLBACK_LOCALE: SupportedLocale = 'zh-TW'` 常数、`detectSystemLocale()` 函式
  - Notes: 侦测逻辑必须支援 Apple 截断的 script subtag：
    1. 精确匹配（`zh-Hant-TW` → `zh-TW`）
    2. Script subtag 匹配（`zh-Hant` → `zh-TW`、`zh-Hans` → `zh-CN`）
    3. 语言前缀匹配（`ja-JP` → `ja`、`ko-KR` → `ko`、`en-US` → `en`）
    4. 裸 `zh` 匹配 → `zh-TW`（保护繁中使用者）
    5. Fallback `zh-TW`（而非 `en`，保护既有使用者升级路径）

- [ ] Task 3: 建立繁体中文翻译档（基准语言）
  - File: `src/i18n/locales/zh-TW.json`（新建）
  - Action: 从现有硬编码字串提取所有 ~185 个翻译键。键名结构按功能分组：
    ```
    {
      "settings": { "title": "...", "hotkey": { ... }, "apiKey": { ... }, "app": { ... }, ... },
      "dashboard": { ... },
      "history": { ... },
      "dictionary": { ... },
      "accessibility": { ... },
      "voiceFlow": { "recording": "录音中...", "transcribing": "转录中...", "pasteFailed": "贴上失败", "recordingTooShort": "录音时间太短", ... },
      "errors": { "micInitFailed": "麦克风初始化失败", "apiKeyEmpty": "API Key 不可为空白", "promptEmpty": "Prompt 不可为空白", ... },
      "format": { "minutes": "{totalMinutes} 分钟", ... },
      "mainApp": { "nav": { ... }, "update": { ... } },
      "common": { "save": "储存", "delete": "删除", "cancel": "取消", ... }
    }
    ```
  - Notes: 使用 vue-i18n 的 named interpolation `{variable}` 语法处理动态值

- [ ] Task 4: 建立其他 4 种语言翻译档
  - Files: `src/i18n/locales/en.json`, `ja.json`, `zh-CN.json`, `ko.json`（新建）
  - Action: 以 `zh-TW.json` 为基准翻译所有键。每个档案结构完全一致，值为对应语言。
  - Notes: en.json 为 vue-i18n fallback 语言，必须 100% 完整。其他语言缺失键会 fallback 到 en。

- [ ] Task 5: 建立多语言 AI Prompt
  - File: `src/i18n/prompts.ts`（新建）
  - Action: 汇出 `DEFAULT_PROMPTS: Record<SupportedLocale, string>`，每种语言一份完整校对指令 prompt。汇出 `getDefaultPromptForLocale(locale: SupportedLocale): string` 函式。
  - Notes: zh-TW prompt 直接从现有 `enhancer.ts` 的 `DEFAULT_SYSTEM_PROMPT` 搬移。每份 prompt 最后一句指定输出语言。

- [ ] Task 6: 建立 vue-i18n instance
  - File: `src/i18n/index.ts`（新建）
  - Action: 建立并汇出 `i18n` instance（`createI18n({ legacy: false, locale: FALLBACK_LOCALE, fallbackLocale: 'en', messages })`）
  - Notes: `legacy: false` 启用 Composition API。locale 初始为 `FALLBACK_LOCALE`，启动时由 Settings Store 覆盖。注意：两个 WebView 各自建立自己的 instance，不是 singleton。

- [ ] Task 7: HUD 入口初始化
  - File: `src/main.ts`
  - Action: 在 `app.use(pinia)` 后加入 `app.use(i18n)`（import from `@/i18n`）
  - Notes: 必须在 Pinia 之后、mount 之前。Phase 1 就完成初始化，让后续 Phase 可独立验证。

- [ ] Task 8: Dashboard 入口初始化
  - File: `src/main-window.ts`
  - Action: 同 Task 7，在 `app.use(pinia)` 后加入 `app.use(i18n)`

- [ ] Task 9: HTML lang 初始值
  - Files: `index.html`, `main-window.html`
  - Action: 将 `lang="zh-Hant"` 改为 `lang="zh-Hant"`（保持不变，启动后由 JS 覆盖为使用者偏好）
  - Notes: 启动时 Settings Store `loadSettings()` 会设定正确的 `document.documentElement.lang`。保持 `zh-Hant` 而非改为 `en`，因为 fallback 是 `zh-TW`。

#### Phase 2：设定层整合

- [ ] Task 10: Settings Store 新增语言设定
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    1. import `SupportedLocale`, `detectSystemLocale`, `LANGUAGE_OPTIONS`, `FALLBACK_LOCALE` from `@/i18n/languageConfig`
    2. import `getDefaultPromptForLocale` from `@/i18n/prompts`
    3. import `i18n` from `@/i18n`
    4. 新增 `selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE)`
    5. 在 `loadSettings()` 中：读取 `store.get<SupportedLocale>('selectedLocale')`，若无值（首次启动 / 升级）则呼叫 `detectSystemLocale()` 并存入 store
    6. `loadSettings()` 中载入 locale 后**必须立即同步** `i18n.global.locale.value` 和 `document.documentElement.lang`（查表取 HTML lang）
    7. 新增 `saveLocale(locale: SupportedLocale)` — set store + update ref + 更新 `i18n.global.locale.value` + 更新 `document.documentElement.lang` + emitEvent
    8. 新增 `getWhisperLanguageCode(): string` — 从 `LANGUAGE_OPTIONS` 查找当前 locale 对应的 Whisper code
    9. **`refreshCrossWindowSettings()` 修改顺序（Critical）**：必须先读取并更新 `selectedLocale` + 同步 `i18n.global.locale.value` + `document.documentElement.lang`，**然后**再处理 `aiPrompt` fallback（因为 aiPrompt fallback 依赖 `selectedLocale` 的值来决定用哪个语言的预设 prompt）
    10. `refreshCrossWindowSettings()` 中的 `aiPrompt` fallback：从 `savedPrompt?.trim() || DEFAULT_SYSTEM_PROMPT` 改为 `savedPrompt?.trim() || getDefaultPromptForLocale(selectedLocale.value)`
    11. return 中加入 `selectedLocale`, `saveLocale`, `getWhisperLanguageCode`
  - Notes: 遵循现有 pattern。`SETTINGS_UPDATED` event payload key 用 `"locale"`。

- [ ] Task 11: Settings Store prompt 切换连动
  - File: `src/stores/useSettingsStore.ts`
  - Action: 在 `saveLocale()` 中加入 prompt 连动逻辑：
    1. 取得切换前的语言预设 prompt：`getDefaultPromptForLocale(oldLocale)`
    2. 比较当前 `aiPrompt.value` 是否等于旧语言预设 prompt
    3. 若相等（使用者未自订），自动更新为新语言预设 prompt 并储存
    4. 若不相等（使用者已自订），保持不动
    5. 修改 `resetAiPrompt()` 以使用 `getDefaultPromptForLocale(selectedLocale.value)` 取代固定的 `DEFAULT_SYSTEM_PROMPT`
  - Notes: 同时翻译 Store 中的既有 throw Error 字串：`"API Key 不可为空白"`、`"Prompt 不可为空白"`、自订键显示格式，改用 `i18n.global.t()`。

- [ ] Task 12: 修改 enhancer.ts — prompt 多语言 + 结构化 Error
  - File: `src/lib/enhancer.ts`
  - Action:
    1. 移除 `DEFAULT_SYSTEM_PROMPT` 常数（搬到 `src/i18n/prompts.ts`）
    2. 改为 import `getDefaultPromptForLocale` 和 `i18n`
    3. 新增 `getDefaultSystemPrompt(): string`，回传 `getDefaultPromptForLocale(i18n.global.locale.value as SupportedLocale)`
    4. `enhanceText()` 中的 fallback：`options?.systemPrompt || getDefaultSystemPrompt()`
    5. **结构化 Error（Critical — F2）**：`enhanceText()` 的 HTTP 错误改用自订 Error class：
       ```typescript
       class EnhancerApiError extends Error {
         constructor(public statusCode: number, statusText: string, body: string) {
           super(`Enhancement API error: ${statusCode}`);
         }
       }
       ```
       抛出 `new EnhancerApiError(response.status, response.statusText, errorBody)` 取代含全形冒号的字串拼接
    6. timeout 错误也改为自订 class 或带 `code` 属性
  - Notes: `DEFAULT_SYSTEM_PROMPT` 被测试引用，需同步更新 import。汇出 `EnhancerApiError` 给 `errorUtils.ts` 使用。

#### Phase 3：Rust 后端 + VoiceFlow 整合

- [ ] Task 13: 修改 transcribe_audio 支援动态语言
  - File: `src-tauri/src/plugins/transcription.rs`
  - Action:
    1. 在 `transcribe_audio` 函式签名加入 `language: Option<String>` 参数
    2. 修改 multipart form 构建：`.text("language", language.as_deref().unwrap_or(TRANSCRIPTION_LANGUAGE))`
    3. `TRANSCRIPTION_LANGUAGE` 保留为 fallback 预设值 `"zh"`
  - Notes: `Option<String>` 确保向后相容。

- [ ] Task 14: VoiceFlow Store 传递语言参数 + 翻译 + 幻觉检测修复
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    1. import `i18n` from `@/i18n`
    2. 在 `invoke("transcribe_audio", ...)` 加入 `language: settingsStore.getWhisperLanguageCode()`
    3. HUD 状态讯息改用 `i18n.global.t('voiceFlow.recording')` 等翻译键
    4. 空转录讯息改用 `i18n.global.t('voiceFlow.noSpeechDetected')`
    5. `"贴上失败"` 改用 `i18n.global.t('voiceFlow.pasteFailed')`
    6. `"录音时间太短"` 改用 `i18n.global.t('voiceFlow.recordingTooShort')`
    7. **幻觉检测修复（Critical — F1）**：`isSilenceOrHallucination()` 函式中的 CJK 检查（`!CJK_REGEX.test(rawText) && hasRepeatedTokens(rawText)`）加入语言条件，只在 `settingsStore.getWhisperLanguageCode() === 'zh'` 时启用 CJK 检查。非中文 locale 下跳过此分支，避免英文/韩文正常转录被误杀。
  - Notes: 幻觉检测短语列表（`HALLUCINATION_PHRASES`）本身不翻译，那些是 Whisper 的固定输出。

#### Phase 4：UI 翻译替换

- [ ] Task 15: 翻译 errorUtils.ts + 移除字串耦合
  - File: `src/lib/errorUtils.ts`
  - Action:
    1. import `i18n` from `@/i18n`，所有硬编码中文字串改为 `i18n.global.t('errors.xxx')`。约 24 个字串
    2. **移除全形冒号 regex（Critical — F2）**：`getEnhancementErrorMessage()` 中的 `error.message.match(/：(\d+)/)` 改为 `error instanceof EnhancerApiError ? error.statusCode : null`，用 instanceof 检查取代字串解析
  - Notes: import `EnhancerApiError` from `@/lib/enhancer`。

- [ ] Task 16: 翻译 formatUtils.ts + locale 动态化
  - File: `src/lib/formatUtils.ts`
  - Action:
    1. import `i18n`，时间格式字串改为翻译键。约 4 个字串
    2. **locale 动态化（F9）**：所有 `toLocaleString("zh-TW")` 改为 `toLocaleString(i18n.global.locale.value)`。包含日期格式化和数字格式化
  - Notes: 不同语言的时间表达和数字分隔符会自动适配。

- [ ] Task 17: 翻译 keycodeMap.ts
  - File: `src/lib/keycodeMap.ts`
  - Action: import `i18n`，按键碰撞警告字串改为翻译键。1 个字串。

- [ ] Task 18: 翻译 useVocabularyStore.ts
  - File: `src/stores/useVocabularyStore.ts`
  - Action: import `i18n`，`"此词汇已存在"` 改为 `i18n.global.t('dictionary.duplicateEntry')`。2 个字串。

- [ ] Task 19: 翻译 SettingsView.vue
  - File: `src/views/SettingsView.vue`
  - Action: `const { t } = useI18n()`。template + script 中所有硬编码中文改为 `t('settings.xxx')`。约 55 个字串。包含：所有 Card 标题、Label、描述文字、按钮文字、feedback 讯息、placeholder、trigger key option labels、「关于 SayIt」Card 的描述和连结文字。
  - Notes: trigger key labels（如 `"左 Option (⌥)"`）也需翻译。feedback show 字串（如 `"触发键已更新"`）改为 `t('settings.hotkey.updated')`。

- [ ] Task 20: SettingsView 新增语言选择器
  - File: `src/views/SettingsView.vue`
  - Action: 在「应用程式」Card 中，在「录音时自动静音」Switch 上方新增语言选择区块：
    1. import `LANGUAGE_OPTIONS`, `SupportedLocale` from `@/i18n/languageConfig`
    2. 新增 `languageFeedback = useFeedbackMessage()`
    3. 新增 `handleLocaleChange(newLocale: SupportedLocale)` — 呼叫 `settingsStore.saveLocale(newLocale)` + feedback
    4. template：Label + Select 下拉（options 从 `LANGUAGE_OPTIONS` 渲染，显示各语言原名）+ feedback transition
  - Notes: 语言名称用原文显示（繁体中文、English、日本語...）。在 `onBeforeUnmount` 加入 `languageFeedback.clearTimer()`。

- [ ] Task 21: 翻译 DashboardView.vue
  - File: `src/views/DashboardView.vue`
  - Action: `const { t } = useI18n()`，~19 个字串替换。
  - Notes: 配额标签使用 interpolation：`t('dashboard.whisperQuota', { count, limit })`

- [ ] Task 22: 翻译 HistoryView.vue
  - File: `src/views/HistoryView.vue`
  - Action: `const { t } = useI18n()`，~16 个字串替换。

- [ ] Task 23: 翻译 DictionaryView.vue
  - File: `src/views/DictionaryView.vue`
  - Action: `const { t } = useI18n()`，~11 个字串替换。
  - Notes: feedback 中的动态词汇名用 interpolation：`t('dictionary.added', { term })`

- [ ] Task 24: 翻译 AccessibilityGuide.vue
  - File: `src/components/AccessibilityGuide.vue`
  - Action: `const { t } = useI18n()`，9 个字串替换。

- [ ] Task 25: 翻译 DashboardUsageChart.vue
  - File: `src/components/DashboardUsageChart.vue`
  - Action: `const { t } = useI18n()`，2 个字串替换。

#### Phase 5：MainApp 翻译

- [ ] Task 26: 翻译 MainApp.vue
  - File: `src/MainApp.vue`
  - Action: `const { t } = useI18n()`，翻译所有 ~24 个硬编码字串：
    - sidebar nav labels（4 个）：仪表板、历史记录、自订字典、设定
    - 更新相关讯息（~15 个）：安装失败、检查更新时发生错误、已是最新版本、检查失败、更新失败、检查中...、下载中...、安装中...、检查更新、已就绪、立即安装
    - AlertDialog（~5 个）：更新已就绪、发现新版本、描述文字、稍后、安装并重启、取消、开始更新
  - Notes: `SiteHeader.vue` 只接收 title prop 显示，不需修改。`currentPageTitle` 的 fallback `"SayIt"` 是品牌名不翻译。

#### Phase 6：测试

- [ ] Task 27: 新增 i18n 设定测试
  - File: `tests/unit/i18n-settings.test.ts`（新建）
  - Action: 测试案例：
    1. `saveLocale('en')` 应正确存入 store 并更新 i18n.global.locale
    2. `saveLocale('ja')` 应更新 document.documentElement.lang 为 `'ja'`
    3. `getWhisperLanguageCode()` 应回传正确的 Whisper code（zh-TW→zh, en→en, ja→ja, zh-CN→zh, ko→ko）
    4. `detectSystemLocale()` 精确匹配（mock `['zh-Hant-TW']` → `'zh-TW'`）
    5. `detectSystemLocale()` script subtag 匹配（mock `['zh-Hant']` → `'zh-TW'`、`['zh-Hans']` → `'zh-CN'`）
    6. `detectSystemLocale()` 前缀匹配（mock `['ja-JP']` → `'ja'`）
    7. `detectSystemLocale()` 无匹配时 fallback 为 `'zh-TW'`（mock `['th']`）
    8. 语言切换时，未自订 prompt 自动更新为新语言预设
    9. 语言切换时，已自订 prompt 保持不动
    10. **翻译档 key 一致性验证**：所有 5 个 locale JSON 档的 key 集合必须完全一致（递回比较）

- [ ] Task 28: 更新现有 enhancer 测试
  - File: `tests/unit/enhancer.test.ts`
  - Action:
    1. 更新 import（`DEFAULT_SYSTEM_PROMPT` 已移除，改用 `getDefaultPromptForLocale`）
    2. 新增测试：不同 locale 下 `getDefaultSystemPrompt()` 回传对应语言 prompt
    3. 新增测试：HTTP 错误抛出 `EnhancerApiError` 且带正确 `statusCode`

- [ ] Task 29: 更新现有 settings store 测试
  - File: `tests/unit/use-settings-store.test.ts`
  - Action: 新增 `saveLocale` / `loadSettings` 中 locale 载入的测试。确保现有测试不因 import 变动而坏掉。

- [ ] Task 30: 新增 component smoke test
  - File: `tests/component/i18n-smoke.test.ts`（新建）
  - Action: mount 一个主要 View（如 SettingsView），切换 i18n locale，断言关键 UI 文字已从中文切换为英文。
  - Notes: 此测试验证 template 中的 `{{ t('key') }}` 绑定是否正确，unit test 无法覆盖此面向。

### Acceptance Criteria

#### 基础建设

- [ ] AC 1: Given 使用者首次安装 app，when app 启动且系统语言为日文（`navigator.languages = ['ja']`），then 介面自动显示日文 UI
- [ ] AC 2: Given 使用者首次安装 app，when 系统语言为不支援的语言（如 `th`），then 介面 fallback 显示繁体中文（`zh-TW`）
- [ ] AC 3: Given vue-i18n 已初始化，when 翻译键在当前语言缺失，then fallback 显示英文（`fallbackLocale: 'en'`）
- [ ] AC 4: Given 所有 5 个 locale JSON 档案，when 比较其 key 结构，then 完全一致（无遗漏或多余的 key）

#### 语言切换

- [ ] AC 5: Given 使用者在设定页面，when 从语言下拉选单选择 English，then 整个 Dashboard 介面（含 sidebar、所有 views）立即切换为英文
- [ ] AC 6: Given 使用者切换语言为日文，when 开启 HUD 视窗，then HUD 状态讯息（录音中、转录中、已贴上）显示日文
- [ ] AC 7: Given 使用者切换语言为韩文，when 关闭 app 并重新开启，then 介面仍显示韩文（语言偏好已持久化）
- [ ] AC 8: Given 双视窗同时开启，when 在 Dashboard 切换语言，then HUD 视窗也同步更新语言（透过 event + refreshCrossWindowSettings）

#### Whisper 语言连动

- [ ] AC 9: Given 使用者将介面语言切为 English，when 按住快捷键录音并放开，then Whisper API 请求的 `language` 栏位为 `"en"`
- [ ] AC 10: Given 介面语言为繁体中文或简体中文，when 执行语音转录，then Whisper `language` 栏位均为 `"zh"`

#### AI Prompt 连动

- [ ] AC 11: Given 使用者从未自订过 AI prompt，when 语言从繁体中文切换为 English，then AI prompt 自动更新为英文版预设 prompt
- [ ] AC 12: Given 使用者已自订 AI prompt，when 语言切换，then AI prompt 保持使用者自订内容不变
- [ ] AC 13: Given 介面语言为日文且使用预设 prompt，when 使用者点击「重置为预设」，then prompt 重置为日文版预设

#### 幻觉检测（Critical — F1）

- [ ] AC 14: Given 介面语言为 English（Whisper language = `"en"`），when 使用者说 "yeah yeah okay" 并完成转录，then 文字正常显示（不被 CJK 幻觉检测误杀）
- [ ] AC 15: Given 介面语言为繁体中文（Whisper language = `"zh"`），when Whisper 回传纯英文无 CJK 的重复文字，then 仍被正确判定为幻觉并丢弃

#### 错误讯息

- [ ] AC 16: Given 介面语言为 English，when AI 整理 API 回传 401 错误，then 错误讯息显示英文（透过 `EnhancerApiError.statusCode` 判断，非字串解析）
- [ ] AC 17: Given 介面语言为韩文，when API Key 无效，then 错误讯息显示韩文

#### HTML lang

- [ ] AC 18: Given 使用者将语言设为日文，when 检查 DOM，then `<html lang="ja">` 且两个视窗均更新

#### Edge Cases

- [ ] AC 19: Given 使用者在 A 语言下自订 prompt，when 切到 B 语言再切回 A 语言，then 自订 prompt 仍完整保留
- [ ] AC 20: Given 前端传 `language: null` 给 Rust transcribe_audio，then Rust fallback 使用 `"zh"`
- [ ] AC 21: Given 既有中文使用者从 pre-i18n 版本升级，when 系统语言侦测到 `zh-Hant`（Apple 截断格式），then 正确匹配为 `zh-TW`，Whisper 维持 `"zh"`

## Additional Context

### Dependencies

- `vue-i18n` ^10 — Vue 3 国际化套件（`pnpm add vue-i18n`）
- 无其他新依赖

### Testing Strategy

**单元测试（Vitest）：**

- `tests/unit/i18n-settings.test.ts`（新建）— 10 个测试案例覆盖语言储存/载入/侦测/prompt 连动/key 一致性
- `tests/unit/enhancer.test.ts`（修改）— 更新 import + 多语言 prompt + EnhancerApiError 测试
- `tests/unit/use-settings-store.test.ts`（修改）— locale 相关测试

**元件测试（Vitest + Vue Test Utils）：**

- `tests/component/i18n-smoke.test.ts`（新建）— mount View + 切换 locale + 断言文字切换

**手动测试：**

1. 首次安装：确认自动侦测系统语言
2. 语言切换：逐一切换 5 种语言，验证 UI + HUD + 错误讯息
3. 语音转录：切英文后录英文语音，确认 Whisper 正确识别且不被幻觉检测误杀
4. Prompt 连动：切语言验证预设 prompt 切换 + 自订 prompt 保留
5. 持久化：切语言后重启 app 验证
6. 跨视窗：Dashboard 切语言验证 HUD 同步
7. 升级路径：模拟无 `selectedLocale` 的 settings.json，确认 fallback 行为

### Notes

**高风险项目：**

- 多语言 AI Prompt 品质 — 每种语言的 prompt 都需要实际测试，确保 LLM 正确理解「校对而非对话」指令。特别是日文和韩文的 prompt 可能需要 native speaker 审查。
- 幻觉检测短语（`HALLUCINATION_PHRASES`）— 目前主要是中英文。切换到日文/韩文后 Whisper 可能产生其他语言的幻觉字串，可后续按需扩充幻觉短语列表。

**已知限制：**

- zh-TW 和 zh-CN 共用 Whisper code `zh`，Whisper 不区分繁简
- 翻译档初期可能不够完美，但架构支援后续迭代
- Apple 的 `navigator.languages` 可能截断地区码，匹配逻辑已处理此情况

**CLAUDE.md 更新提醒：**

实作完成后需更新 CLAUDE.md：
- IPC 契约表：`transcribe_audio` 参数新增 `language: Option<String>`
- 新增 `selectedLocale` 相关设定说明
- 新增 `src/i18n/` 目录结构说明
