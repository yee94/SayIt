---
title: 'Multi-Provider LLM 支援 + Kimi K2 退场迁移'
slug: 'multi-provider-llm'
created: '2026-03-27 17:34:59'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Vue 3 (Composition API, <script setup>)', 'TypeScript', 'Tauri v2', 'Pinia', 'shadcn-vue', 'tauri-plugin-http (fetch)', 'tauri-plugin-store', 'Vitest']
files_to_modify: ['src/lib/modelRegistry.ts', 'src/lib/llmProvider.ts', 'src/lib/enhancer.ts', 'src/lib/vocabularyAnalyzer.ts', 'src/lib/apiPricing.ts', 'src/types/transcription.ts', 'src/stores/useSettingsStore.ts', 'src/stores/useVoiceFlowStore.ts', 'src/stores/useHistoryStore.ts', 'src/views/SettingsView.vue', 'src/views/DashboardView.vue', 'src/i18n/locales/*.json', 'tests/unit/enhancer.test.ts', 'tests/unit/api-pricing.test.ts', 'tests/unit/llmProvider.test.ts']
code_patterns: ['raw fetch via @tauri-apps/plugin-http', 'API key in tauri-plugin-store (not SQLite)', 'model registry as single source of truth', 'DECOMMISSIONED_MODEL_MAP for auto-migration', 'one-time migration flags in store', 'views → stores → lib dependency chain', 'OpenAI-compatible request/response format']
test_patterns: ['Vitest with vi.mock for @tauri-apps/plugin-http', 'dynamic import per test for module isolation', 'mockFetch pattern for API call testing', 'P0/P1 priority labels in test names']
---

# Tech-Spec: Multi-Provider LLM 支援 + Kimi K2 退场迁移

**Created:** 2026-03-27

## Overview

### Problem Statement

Kimi K2（`moonshotai/kimi-k2-instruct`）将于 2026-04-15 被 Groq 下架，目前为专案预设 LLM 模型。此外，应用程式仅支援 Groq 免费模型，使用者无法选用更高品质的付费模型（如 OpenAI GPT-4o、Anthropic Claude）来取得更好的文字整理与字典分析结果。

### Solution

1. **移除 Kimi K2**：从模型清单移除、更新 `DECOMMISSIONED_MODEL_MAP` 迁移映射、变更预设模型
2. **新增 LLM Provider 选择**：支援 Groq / OpenAI / Anthropic 三个 provider
3. **独立 API Key 管理**：每个 provider 各自的 API key 栏位，存于 tauri-plugin-store
4. **统一呼叫介面**：新增 `llmProvider.ts` 抽象层 — OpenAI + Groq 共用 OpenAI-compatible 格式，Anthropic 透过 adapter 转换
5. **Provider-aware 模型清单**：每个 provider 提供各自可用的模型选项

### Scope

**In Scope:**
- 移除 Kimi K2，更新 `DECOMMISSIONED_MODEL_MAP` 和预设模型
- 新增 Provider 选择（Groq / OpenAI / Anthropic）
- 每个 provider 独立 API key 栏位（tauri-plugin-store）
- 每个 provider 各自的模型清单
- `enhancer.ts` + `vocabularyAnalyzer.ts` 改为 provider-aware
- Anthropic Messages API adapter
- 移除独立的「字典分析模型」选择器（字典分析与 LLM 共用同一模型）
- i18n 更新（5 语系）

**Out of Scope:**
- Whisper 语音转录（维持 Groq，不受 provider 选择影响）
- Streaming 回应
- 自订 base URL / self-hosted LLM
- 费用追踪跨 provider 整合

## Context for Development

### Codebase Patterns

- API 呼叫使用 `@tauri-apps/plugin-http` 的 `fetch`（非浏览器原生），禁止使用原生 `fetch`
- API key 存于 `tauri-plugin-store`（非 SQLite），目前只有一个 key：`groqApiKey`
- 模型设定集中在 `src/lib/modelRegistry.ts`，为 single source of truth
- `enhancer.ts` 和 `vocabularyAnalyzer.ts` 各自 hardcode `GROQ_CHAT_API_URL`，使用相同的 OpenAI-compatible request pattern
- 两个档案各自定义了重复的 `GroqChatResponse` / `GroqChatUsage` 和 `parseUsage`，应统一
- 已有模型下架自动迁移机制（`DECOMMISSIONED_MODEL_MAP` + `getEffectiveLlmModelId()`）
- v0.8.7 有一次性迁移 pattern（`llmMigratedToKimiK2` flag in store）
- API key 透过参数传递（`settingsStore.getApiKey()` → voiceFlowStore → `enhanceText(rawText, apiKey, options)`），lib 层不读 store
- `VocabularyAnalysisModelId` 独立于 `LlmModelId`，有自己的清单和选择器 — 移除 Kimi K2 后仅剩 Llama 3.3 一个选项，本次简化为共用 LLM 模型
- Settings UI 用 shadcn-vue `Card` + `Select` + `Input` + `RadioGroup` 元件
- 依赖方向：views → stores → lib，views 不可直接 import lib
- i18n：5 个语系档案（`zh-TW.json`, `en.json`, `ja.json`, `zh-CN.json`, `ko.json`），key 结构如 `settings.apiKey.title`

### Files to Reference

| File | Purpose | 修改类型 |
| ---- | ------- | ------- |
| `src/lib/modelRegistry.ts` | 模型 ID 型别、清单、预设值、迁移映射 | 重构 |
| `src/lib/llmProvider.ts` | **新增** — Provider 抽象层、Anthropic adapter | 新增 |
| `src/lib/enhancer.ts` | 文字整理 LLM 呼叫 | 重构 |
| `src/lib/vocabularyAnalyzer.ts` | 字典分析 LLM 呼叫 | 重构 |
| `src/lib/apiPricing.ts` | 费用计算 | 小修 |
| `src/stores/useSettingsStore.ts` | API key 存取、模型选择、迁移逻辑 | 重构 |
| `src/views/SettingsView.vue` | 设定 UI | 重构 |
| `src/i18n/locales/*.json` | i18n 翻译 | 新增 keys |
| `tests/unit/enhancer.test.ts` | enhancer 测试 | 更新 |
| `tests/unit/api-pricing.test.ts` | 费用计算测试 | 更新 |
| `src/types/transcription.ts` | `ChatUsageData` 型别定义 | 小修（时间栏位改 optional） |
| `src/stores/useVoiceFlowStore.ts` | LLM 呼叫端（apiKey + modelId 传递） | 更新呼叫 |
| `src/stores/useHistoryStore.ts` | api_usage SQL 写入（usage 时间栏位） | 小修 |
| `src/views/DashboardView.vue` | 免费额度显示（freeQuotaRpd/Tpd） | 修正 div-by-zero |
| `tests/unit/llmProvider.test.ts` | **新增** — provider 测试 | 新增 |

### Technical Decisions

1. **Groq + OpenAI 共用 OpenAI-compatible 格式**
   - 两者都用 `/v1/chat/completions`，差异只在 base URL 和 API key
   - Groq: `https://api.groq.com/openai/v1/chat/completions`
   - OpenAI: `https://api.openai.com/v1/chat/completions`
   - 两者都用 `Authorization: Bearer <key>` header

2. **Anthropic Messages API adapter**
   - URL: `https://api.anthropic.com/v1/messages`
   - Auth: `x-api-key: <key>`（非 Bearer token）
   - 额外 header: `anthropic-version`（实作时查官方文件确认当前稳定版本，`2023-06-01` 已过旧，不支援新模型）
   - Request: `{ model, max_tokens, messages }` — `max_tokens` 为必填；`temperature: 0` 需验证是否可用（如不行则用 `0.01`）
   - Response: `{ content: [{ type: "text", text }], usage: { input_tokens, output_tokens } }`
   - 无 `prompt_time` / `completion_time` 等 Groq-specific 栏位

3. **API key 储存方案**
   - `groqApiKey`（沿用，Whisper + Groq LLM 共用）
   - `openaiApiKey`（新增）
   - `anthropicApiKey`（新增）

4. **Provider → Model 两阶段选择**
   - 使用者先选 provider，再选该 provider 的模型
   - 切换 provider 时自动重设为该 provider 的预设模型
   - OpenAI / Anthropic 选后需输入对应 API key

5. **字典分析模型简化**
   - 移除独立的 `VocabularyAnalysisModelId` 和 `VOCABULARY_ANALYSIS_MODEL_LIST`
   - 字典分析改用选定的 LLM 模型（共用 provider 和 model）
   - 原因：移除 Kimi K2 后仅剩一个选项；付费模型皆具备 JSON 能力

6. **Kimi K2 迁移策略**
   - 加入 `DECOMMISSIONED_MODEL_MAP`: `"moonshotai/kimi-k2-instruct" → "llama-3.3-70b-versatile"`
   - 更新原本映射到 Kimi K2 的旧模型（GPT OSS 等）→ 新预设
   - 新预设 LLM: `llama-3.3-70b-versatile`
   - 一次性迁移 flag: `llmMigratedFromKimiK2`

7. **`parseUsage` 统一化**
   - `enhancer.ts` 和 `vocabularyAnalyzer.ts` 有重复的 `GroqChatResponse`/`parseUsage`
   - 统一到 `llmProvider.ts` 的 `parseProviderResponse()` — 各 provider usage 格式个别适配
   - `LlmUsageData` 型别：`promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改为 optional（Groq only）

## Implementation Plan

### Tasks

- [x] **Task 1: 更新 `src/lib/modelRegistry.ts` — 型别与资料结构**
  - File: `src/lib/modelRegistry.ts`
  - Action:
    1. 新增 `LlmProviderId` type: `"groq" | "openai" | "anthropic"`
    2. 在 `LlmModelConfig` interface 新增 `providerId: LlmProviderId` 栏位
    3. 更新 `LlmModelId` union type：移除 `"moonshotai/kimi-k2-instruct"`，新增 `"gpt-4o"`, `"gpt-4o-mini"`, `"claude-sonnet-4-20250514"`, `"claude-haiku-4-5-20251001"`
    4. 移除 `VocabularyAnalysisModelId` type、`VocabularyAnalysisModelConfig` interface、`VOCABULARY_ANALYSIS_MODEL_LIST`、`findVocabularyAnalysisModelConfig()`、`getEffectiveVocabularyAnalysisModelId()`、`DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID`
    5. 更新 `DEFAULT_LLM_MODEL_ID` 为 `"llama-3.3-70b-versatile"`
    6. 新增 `DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq"`
    7. 为每个既有 Groq 模型加上 `providerId: "groq"`
    8. 新增 OpenAI 模型到 `LLM_MODEL_LIST`：
       - `{ id: "gpt-4o", providerId: "openai", displayName: "GPT-4o", badgeKey: "settings.modelBadge.premium", speedTps: 0, inputCostPerMillion: TBD, outputCostPerMillion: TBD, freeQuotaRpd: 0, freeQuotaTpd: 0, isDefault: true }`
       - `{ id: "gpt-4o-mini", providerId: "openai", displayName: "GPT-4o Mini", badgeKey: "settings.modelBadge.fastCheap", ... isDefault: false }`
    9. 新增 Anthropic 模型到 `LLM_MODEL_LIST`：
       - `{ id: "claude-sonnet-4-20250514", providerId: "anthropic", displayName: "Claude Sonnet 4", badgeKey: "settings.modelBadge.premium", ... isDefault: true }`
       - `{ id: "claude-haiku-4-5-20251001", providerId: "anthropic", displayName: "Claude Haiku 4.5", badgeKey: "settings.modelBadge.fastCheap", ... isDefault: false }`
    10. 移除 Kimi K2 从 `LLM_MODEL_LIST`
    11. 更新 `DECOMMISSIONED_MODEL_MAP`：
        - 新增 `"moonshotai/kimi-k2-instruct": "llama-3.3-70b-versatile"`
        - 修改原本映射到 Kimi K2 的 entries（`"qwen-qwq-32b"`, `"gpt-oss-120b"`, `"openai/gpt-oss-120b"`, `"openai/gpt-oss-20b"`）→ `"llama-3.3-70b-versatile"`
    12. 新增 helper: `getModelListByProvider(providerId: LlmProviderId): LlmModelConfig[]`
    13. 新增 helper: `getDefaultModelIdForProvider(providerId: LlmProviderId): LlmModelId`
  - Notes:
    - OpenAI/Anthropic 定价与模型 ID 需从官方文件确认，spec 中标为 TBD
    - `freeQuotaRpd` / `freeQuotaTpd` 对付费 provider 设为 0
    - `speedTps` 对付费 provider 设为 0（官方不公开此数据）
    - `isDefault` 语意改为「此 provider 的预设模型」— 既有 Groq 模型的 `isDefault` 需更新：`qwen/qwen3-32b` 改为 `false`，`llama-3.3-70b-versatile` 改为 `true`（因 Qwen3 在 Groq 为 Preview 状态，不适合作为预设）
    - 新增 `settings.modelBadge.premium` i18n key

- [x] **Task 2: 新增 `src/lib/llmProvider.ts` — Provider 抽象层**
  - File: `src/lib/llmProvider.ts`（新增）
  - Action:
    1. Import `LlmProviderId` 和 `findLlmModelConfig` from `./modelRegistry`
    2. 定义 `LlmProviderConfig` interface：
       ```
       id: LlmProviderId
       displayName: string
       baseUrl: string
       consoleUrl: string         // 取得 API key 的网址
       apiKeyPrefix: string       // API key 前缀提示（如 "sk-"、"gsk_"），用于 input placeholder
       ```
    3. 定义 `LLM_PROVIDER_LIST: LlmProviderConfig[]`：
       - Groq: baseUrl `https://api.groq.com/openai/v1/chat/completions`, storeKeyName `groqApiKey`, consoleUrl `https://console.groq.com/keys`
       - OpenAI: baseUrl `https://api.openai.com/v1/chat/completions`, storeKeyName `openaiApiKey`, consoleUrl `https://platform.openai.com/api-keys`
       - Anthropic: baseUrl `https://api.anthropic.com/v1/messages`, storeKeyName `anthropicApiKey`, consoleUrl `https://console.anthropic.com/settings/keys`
    4. 定义统一型别：
       - `LlmChatMessage { role: "system" | "user" | "assistant"; content: string }`
       - `LlmChatRequest { model: string; messages: LlmChatMessage[]; temperature?: number; maxTokens?: number }`
       - `LlmUsageData { promptTokens: number; completionTokens: number; totalTokens: number; promptTimeMs?: number; completionTimeMs?: number; totalTimeMs?: number }` — 时间栏位 optional（Groq only）
       - `LlmChatResult { text: string; usage: LlmUsageData | null }`
    5. 实作 `buildFetchParams(providerId: LlmProviderId, request: LlmChatRequest, apiKey: string): { url: string; init: RequestInit }`：
       - Groq / OpenAI：标准 OpenAI body（`{ model, messages, temperature, max_tokens }`）、`Authorization: Bearer` header
       - Anthropic：转换 messages 格式（提取 system message 到顶层 `system` 栏位）、`x-api-key` header、`anthropic-version` header（实作时查官方文件确认版本）、`temperature` 验证（如 Anthropic 不接受 `0` 则用 `0.01`）、`max_tokens` 必填（若呼叫端未传则预设 `2048`）
    6. 实作 `parseProviderResponse(providerId: LlmProviderId, json: unknown): LlmChatResult`：
       - Groq / OpenAI：`choices[0].message.content`、usage 含时间栏位（Groq）或不含（OpenAI）
       - Anthropic：`content[0].text`、`usage.input_tokens` / `usage.output_tokens`
    7. Export helper: `findProviderConfig(providerId: LlmProviderId): LlmProviderConfig | undefined`
  - Notes:
    - 使用 `@tauri-apps/plugin-http` 的 `fetch`
    - Anthropic system message 处理：如果 messages 阵列第一个是 `role: "system"`，提取为 Anthropic request 的顶层 `system` 栏位，剩余 messages 只含 `user` / `assistant`
    - Anthropic `max_tokens` 为必填栏位 — `buildFetchParams` 在 provider 为 Anthropic 时，若 `request.maxTokens` 未提供则强制带 `2048`
    - 新增 `PROVIDER_TIMEOUT_MS` 常数映射：Groq `5000`、OpenAI `30000`、Anthropic `30000`
    - Export `getProviderTimeout(providerId: LlmProviderId): number` helper

- [x] **Task 3: 重构 `src/lib/enhancer.ts` — 使用 provider 抽象层**
  - File: `src/lib/enhancer.ts`
  - Action:
    1. 移除 `GROQ_CHAT_API_URL` 常数
    2. 移除 `GroqChatChoice`、`GroqChatUsage`、`GroqChatResponse` interface
    3. 移除 `parseUsage()` 函式
    4. Import `buildFetchParams`, `parseProviderResponse`, `LlmChatRequest`, `LlmUsageData` from `./llmProvider`
    5. Import `findLlmModelConfig` from `./modelRegistry`
    6. 更新 `EnhanceOptions`：移除 `modelId?: string`，新增 `modelId: string`（呼叫端必须提供，由 store 传入）
    7. 更新 `enhanceText()` 实作：
       - 从 `findLlmModelConfig(modelId)` 取得 `providerId`，**null-check**：`findLlmModelConfig(modelId)?.providerId ?? "groq"`（防止 store 残留无效 modelId）
       - 使用 `buildFetchParams()` 组装 request
       - 使用 `parseProviderResponse()` 解析 response
       - 保留 `stripReasoningTags()` 处理（对 OpenAI/Anthropic 无害）
       - 更新 `withTimeout()`：改用 `getProviderTimeout(providerId)` 取代 hardcoded `ENHANCEMENT_TIMEOUT_MS`
       - 保留 `EnhancerApiError` 错误处理
    8. 更新 `ChatUsageData` type（`src/types/transcription.ts`）：`promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改为 optional
  - Notes:
    - `enhanceText()` 的 signature 变更最小化：`(rawText, apiKey, options)` 维持不变
    - `options.modelId` 改为必填，但给 fallback `DEFAULT_LLM_MODEL_ID`
    - 呼叫端（voiceFlowStore）已经传 `modelId: settingsStore.selectedLlmModelId`

- [x] **Task 4: 重构 `src/lib/vocabularyAnalyzer.ts` — 使用 provider 抽象层**
  - File: `src/lib/vocabularyAnalyzer.ts`
  - Action:
    1. 移除 `GROQ_CHAT_API_URL` 常数
    2. 移除 `GroqChatUsage`、`GroqChatResponse` interface
    3. 移除 `parseUsage()` 函式
    4. Import `buildFetchParams`, `parseProviderResponse`, `LlmChatRequest` from `./llmProvider`
    5. Import `findLlmModelConfig` from `./modelRegistry`
    6. 更新 `analyzeCorrections()` 实作：
       - 从 `findLlmModelConfig(modelId)` 取得 `providerId`，**null-check**：`?.providerId ?? "groq"`
       - 使用 `buildFetchParams()` / `parseProviderResponse()`
    7. 更新 `ApiUsageInfo` type：`promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改为 optional
  - Notes:
    - `SYSTEM_PROMPT` 不变，但需确认 Anthropic 对 JSON-only 回应的表现
    - 如果 Anthropic 回应带有额外文字，`parseSuggestedTermList()` 的 fallback regex 已能处理

- [x] **Task 5: 更新 `src/lib/apiPricing.ts`**
  - File: `src/lib/apiPricing.ts`
  - Action:
    1. 移除 `findVocabularyAnalysisModelConfig` import
    2. 更新 `calculateChatCostCeiling()` fallback：只用 `findLlmModelConfig(modelId)`
    3. 更新 fallback cost 常数（原本是 Llama 3.3 70B 的 `$0.79/M`，保持不变）
  - Notes: 小修，主要是移除 vocab model 查找的 fallback

- [x] **Task 6: 重构 `src/stores/useSettingsStore.ts` — Multi-provider 支援**
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    1. 新增 imports: `LlmProviderId`, `DEFAULT_LLM_PROVIDER_ID`, `getModelListByProvider`, `getDefaultModelIdForProvider` from modelRegistry; `findProviderConfig` from llmProvider
    2. 新增 state:
       - `selectedLlmProviderId = ref<LlmProviderId>(DEFAULT_LLM_PROVIDER_ID)`
       - `openaiApiKey = ref<string>("")`
       - `anthropicApiKey = ref<string>("")`
    3. 移除 state: `selectedVocabularyAnalysisModelId`
    4. 新增 computed:
       - `hasLlmApiKey`: 根据 `selectedLlmProviderId` 回传对应 key 是否已设定
    5. 新增函式:
       - `getLlmApiKey(): string` — 根据 provider 回传正确的 API key
       - `saveLlmProvider(providerId: LlmProviderId)` — 切换 provider 时重设模型为该 provider 预设
       - `saveOpenaiApiKey(key: string)` / `deleteOpenaiApiKey()`
       - `saveAnthropicApiKey(key: string)` / `deleteAnthropicApiKey()`
       - `refreshLlmApiKey()` — 从 store 重新载入对应 provider 的 key
    6. 更新 `loadSettings()`:
       - 读取 `llmProviderId` from store（预设 `"groq"`）
       - 读取 `openaiApiKey` / `anthropicApiKey` from store
       - 移除 `vocabularyAnalysisModelId` 的读取逻辑
    7. 更新迁移逻辑:
       - Kimi K2 一次性迁移：如果 `llmModelId` 是 `"moonshotai/kimi-k2-instruct"`，强制改为 `"llama-3.3-70b-versatile"`，设 flag `llmMigratedFromKimiK2`
       - 如果没有 `llmProviderId`（旧版升级），自动设为 `"groq"`
    8. 更新 `getApiKey()` → 保留（回传 Groq key，供 Whisper 使用）
    9. 移除: `selectedVocabularyAnalysisModelId` 相关函式（`saveVocabularyAnalysisModel` 等）
    10. 更新 return object: 新增 expose 的 state 和函式
  - Notes:
    - `getApiKey()` 继续回传 Groq key（供 Whisper transcription 用）
    - `getLlmApiKey()` 回传 provider-specific key（供 enhancement / vocab analysis 用）
    - 切换 provider 时 model 自动重设，避免 model ID 跨 provider 错位

- [x] **Task 7: 更新 voiceFlowStore 呼叫端**
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    1. 搜寻所有 `settingsStore.getApiKey()` 用于 LLM 的地方，改为 `settingsStore.getLlmApiKey()`
    2. 保留 `settingsStore.getApiKey()` 用于 Whisper（传给 Rust `transcribe_audio`）的地方
    3. 搜寻 `settingsStore.selectedVocabularyAnalysisModelId`，替换为 `settingsStore.selectedLlmModelId`
    4. 搜寻 `settingsStore.refreshApiKey()` 用于 LLM 前的地方，改为 `settingsStore.refreshLlmApiKey()`
  - Notes:
    - voiceFlowStore 中有 3 处取 apiKey：2 处 for LLM（enhancement + retranscribe），1 处 for correction detection
    - correction detection 也用 LLM，应改用 `getLlmApiKey()`
    - Whisper transcription apiKey 保持 `getApiKey()`（Groq key）
    - **新增 pre-flight check**：在 enhancement path（`executeMainFlow` / `executeRetranscribeFlow`）中，呼叫 `enhanceText()` 前加入 `if (!settingsStore.hasLlmApiKey)` 检查，显示 provider-specific 错误讯息（如「OpenAI API Key 未设定」）

- [x] **Task 8: 新增 i18n keys**
  - Files: `src/i18n/locales/zh-TW.json`, `en.json`, `ja.json`, `zh-CN.json`, `ko.json`
  - Action:
    1. 新增 `settings.provider` 区块：
       - `title`: "LLM 模型服务" / "LLM Provider"
       - `description`: 说明文字
       - `groq`: "Groq（免费）" / "Groq (Free)"
       - `openai`: "OpenAI"
       - `anthropic`: "Anthropic"
       - `groqNote`: "使用上方 Groq API Key" / "Uses Groq API Key above"
    2. 新增 `settings.providerApiKey` 区块：
       - `openaiTitle`: "OpenAI API Key"
       - `anthropicTitle`: "Anthropic API Key"
       - `openaiInstruction`: "前往 OpenAI Platform 取得 API Key"
       - `anthropicInstruction`: "前往 Anthropic Console 取得 API Key"
       - `goToOpenai`: "前往 OpenAI Platform"
       - `goToAnthropic`: "前往 Anthropic Console"
       - 复用既有的 `settings.apiKey.saved` / `deleted` / `show` / `hide` / `confirmDelete` / `delete`
    3. 新增 provider-specific 错误 i18n keys：
       - `errors.openaiApiKeyNotSet`: "OpenAI API Key 未设定" / "OpenAI API Key not set"
       - `errors.anthropicApiKeyNotSet`: "Anthropic API Key 未设定" / "Anthropic API Key not set"
       - `errors.providerAuthFailed`: "API Key 验证失败（{provider}）" / "API Key authentication failed ({provider})"
    4. 新增 `settings.modelBadge.premium`: "高品质" / "Premium"
    4. 更新 `settings.apiKey.title`: "Groq API Key" → "Groq API Key（语音转录）"
    5. 更新 `settings.apiKey.instruction`: 说明此 key 主要用于语音转录
    6. 移除 `settings.model.llmLabel` 相关描述中的字典分析提及
    7. 移除 `settings.smartDictionary.analysisModelDescription` 等不再需要的 key
  - Notes: 5 个语系都要更新，确保一致

- [x] **Task 9: 重构 `src/views/SettingsView.vue` — Provider 选择 UI**
  - File: `src/views/SettingsView.vue`
  - Action:
    1. **Import 更新**：新增 `LLM_PROVIDER_LIST` / `findProviderConfig` / `getModelListByProvider` import；移除 `VOCABULARY_ANALYSIS_MODEL_LIST` / `findVocabularyAnalysisModelConfig` import
    2. **新增 Provider 选择 UI**（在「模型选择」Card 中，LLM 模型 selector 之前）：
       - `RadioGroup` 三选一：Groq / OpenAI / Anthropic
       - 每个 radio 显示 provider name + 简短说明
       - Groq radio 旁显示「（免费）」badge
       - 切换 provider 呼叫 `settingsStore.saveLlmProvider()`
    3. **新增条件式 API Key 区块**（Provider 选择下方，模型选择上方）：
       - `v-if="selectedProvider === 'openai'"` 显示 OpenAI API Key 输入
       - `v-if="selectedProvider === 'anthropic'"` 显示 Anthropic API Key 输入
       - `v-if="selectedProvider === 'groq'"` 显示「使用上方 Groq API Key」提示
       - API Key 输入复用既有的 Input + show/hide toggle + save/delete pattern
       - 含各 provider 的 console 连结
    4. **更新 LLM 模型 selector**：
       - `v-for="model in providerModelList"` — 用 computed 依 provider 过滤
       - 切换 provider 时 model selector 自动重设
    5. **移除 Vocabulary Analysis Model selector**（在「智慧字典学习」Card 中）：
       - 移除 `vocabularyAnalysisModelDescription` computed
       - 移除对应的 `<Select>` 和描述文字
       - 移除 `handleVocabularyAnalysisModelChange` 函式
    6. **更新既有 Groq API Key Card**：
       - 标题补充说明主要用于语音转录
       - instruction 文字更新
    7. **新增 computed/ref**：
       - `selectedProvider = computed(() => settingsStore.selectedLlmProviderId)`
       - `providerModelList = computed(() => getModelListByProvider(selectedProvider.value))`
       - `openaiApiKeyInput = ref("")`, `anthropicApiKeyInput = ref("")`
       - `isOpenaiApiKeyVisible`, `isAnthropicApiKeyVisible` 等 UI state
    8. **新增 handler 函式**：
       - `handleProviderChange(providerId)`
       - `handleSaveOpenaiApiKey()` / `handleDeleteOpenaiApiKey()`
       - `handleSaveAnthropicApiKey()` / `handleDeleteAnthropicApiKey()`
  - Notes:
    - 维持 shadcn-vue 元件规范（RadioGroup, Input, Button, Badge, Select）
    - 维持语意色彩（不用 hardcoded colors）
    - RadioGroup `@update:model-value` payload 型别为 `AcceptableValue`，需 runtime narrowing

- [x] **Task 10: 更新测试**
  - Files: `tests/unit/enhancer.test.ts`, `tests/unit/api-pricing.test.ts`, `tests/unit/llmProvider.test.ts`（新增）
  - Action:
    1. **`enhancer.test.ts`**：
       - 更新 modelRegistry mock：移除 Kimi K2，新增 provider fields
       - 更新 URL 验证：不再 hardcode Groq URL，改验呼叫了 `buildFetchParams`（或 mock llmProvider）
       - 更新 `body.model` 验证：改为新预设 `"llama-3.3-70b-versatile"`
       - 测试 Anthropic provider 时的 header 和 body 格式
    2. **`api-pricing.test.ts`**：
       - 更新预设模型相关测试的期望值（Kimi K2 → Llama 3.3 70B）
       - 移除 `findVocabularyAnalysisModelConfig` mock
    3. **`llmProvider.test.ts`**（新增）：
       - `[P0] buildFetchParams — Groq：正确 URL、Bearer auth、OpenAI body`
       - `[P0] buildFetchParams — OpenAI：正确 URL、Bearer auth、OpenAI body`
       - `[P0] buildFetchParams — Anthropic：正确 URL、x-api-key header、anthropic-version header、system message 提取、temperature >= 0.01`
       - `[P0] parseProviderResponse — Groq：choices[0].message.content、usage 含时间`
       - `[P0] parseProviderResponse — OpenAI：choices[0].message.content、usage 不含时间`
       - `[P0] parseProviderResponse — Anthropic：content[0].text、input_tokens/output_tokens`
       - `[P1] parseProviderResponse — 空 choices/content 回传空字串`
       - `[P1] buildFetchParams — Anthropic temperature 0 修正为 0.01`
  - Notes: 沿用既有 `vi.mock` + dynamic import pattern

- [x] **Task 11: 更新 `src/types/transcription.ts` 及下游 usage 消费端**
  - Files: `src/types/transcription.ts`, `src/stores/useHistoryStore.ts`
  - Action:
    1. `src/types/transcription.ts`：`ChatUsageData` 的 `promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改为 `number | undefined`
    2. `src/stores/useHistoryStore.ts`：`INSERT_API_USAGE_SQL` 写入时，对 optional 时间栏位用 `?? null`（SQL NULL）
    3. `src/stores/useVoiceFlowStore.ts`：`addApiUsage()` 呼叫处，确认 `chatUsage.promptTimeMs` 存取加 optional chaining
  - Notes: F3 修正 — ChatUsageData type change 的下游影响必须全部追踪

- [x] **Task 12: 修正 `src/views/DashboardView.vue` — 付费 provider 免费额度 div-by-zero**
  - File: `src/views/DashboardView.vue`
  - Action:
    1. 读取 Dashboard 中计算 LLM 免费额度进度条的 computed
    2. 当 `freeQuotaRpd === 0` 或 `freeQuotaTpd === 0` 时（付费 provider），隐藏免费额度进度条或显示「付费方案 — 无免费额度限制」提示
    3. 避免 `usage / 0` 产生 `NaN` / `Infinity`
  - Notes: F4 修正 — OpenAI/Anthropic 模型的 `freeQuotaRpd`/`freeQuotaTpd` 为 0，直接除会爆

### Acceptance Criteria

- [x] **AC 1**: Given Kimi K2 已从模型清单移除, when 旧版使用者升级（store 中 `llmModelId` 为 `"moonshotai/kimi-k2-instruct"`）, then 自动迁移为 `"llama-3.3-70b-versatile"` 且 provider 设为 `"groq"`
- [x] **AC 2**: Given 使用者在设定页选择 provider 为 "OpenAI", when 尚未输入 OpenAI API Key, then LLM 模型下拉显示 OpenAI 模型清单，且 API Key 输入栏位显示
- [x] **AC 3**: Given 使用者已输入 OpenAI API Key 并选择 `gpt-4o`, when 执行语音转文字 + 文字整理, then 语音转录仍使用 Groq Whisper API，文字整理使用 OpenAI `gpt-4o` API，回传整理后文字
- [x] **AC 4**: Given 使用者选择 Anthropic provider 并输入 API Key 选择 Claude Sonnet 4, when 执行文字整理, then request 使用 `https://api.anthropic.com/v1/messages`、`x-api-key` header、正确的 Messages API body 格式
- [x] **AC 5**: Given 使用者选择 Anthropic provider, when 文字整理回应返回, then 正确解析 Anthropic 格式（`content[0].text`）并显示整理后文字
- [x] **AC 6**: Given 使用者切换 provider 从 OpenAI 到 Groq, when 切换完成, then LLM 模型重设为 Groq 预设模型（`llama-3.3-70b-versatile`），不显示额外 API Key 输入
- [x] **AC 7**: Given 使用者使用 OpenAI provider, when 字典分析侦测到修正, then 字典分析也使用 OpenAI API（与 LLM 相同 provider + model + key）
- [x] **AC 8**: Given Groq API Key 已设定但 OpenAI API Key 未设定, when 使用者选择 OpenAI provider 并尝试整理文字, then 显示「OpenAI API Key 未设定」错误
- [x] **AC 9**: Given 使用者删除 Anthropic API Key, when 回到 Groq provider, then 原有 Groq 功能正常运作，Anthropic key 栏位已清空
- [x] **AC 10**: Given 各 provider API 回传错误（401/429/500）, when 发生错误, then 正确抛出 `EnhancerApiError` 并显示错误讯息
- [x] **AC 11**: Given 使用者选择 OpenAI provider 且 `gpt-4o` 回应耗时 8 秒, when 文字整理进行中, then 不触发 timeout（OpenAI/Anthropic timeout 为 30s），正常回传结果
- [x] **AC 12**: Given 使用者选择付费 provider（OpenAI/Anthropic）, when 开启 Dashboard, then 免费额度进度条不显示（或显示「付费方案」提示），不出现 NaN/Infinity
- [x] **AC 13**: Given OpenAI/Anthropic 模型已加入 registry, when 查询模型定价, then `inputCostPerMillion` 和 `outputCostPerMillion` 为非零正数

## Additional Context

### Dependencies

- 无新增 npm 套件 — 使用 raw `fetch`（`@tauri-apps/plugin-http`）直接呼叫各 provider API
- Anthropic API 版本: 实作时查官方文件确认当前稳定版本（`2023-06-01` 过旧，不支援新模型 ID）
- OpenAI model IDs 与定价需从官方文件确认（实作时验证）
- Anthropic model IDs 与定价需从官方文件确认（实作时验证）

### Testing Strategy

**单元测试：**
- `llmProvider.test.ts`（新增）— buildFetchParams / parseProviderResponse 各 provider 覆盖
- `enhancer.test.ts`（更新）— 验证新 provider 抽象层整合
- `api-pricing.test.ts`（更新）— 预设模型变更后的数值验证

**手动测试：**
- Groq provider → 文字整理 → 确认使用 Groq API
- OpenAI provider → 输入 key → 文字整理 → 确认使用 OpenAI API
- Anthropic provider → 输入 key → 文字整理 → 确认使用 Anthropic API
- 切换 provider → 确认模型列表更新
- 删除 API Key → 确认错误提示
- 升级模拟：将 store 中 llmModelId 设为 `"moonshotai/kimi-k2-instruct"` → 确认自动迁移

### Notes

**High-Risk Items：**
- Anthropic Messages API 的 system message 处理方式不同（顶层 `system` 栏位 vs messages 阵列中的 `role: "system"`），adapter 需仔细测试
- Anthropic API version 必须使用支援目标模型的版本（`2023-06-01` 不支援 Claude 4.x），实作时查官方文件
- Anthropic `temperature: 0` — 需实测确认是否可用，如不行则 adapter 中转为 `0.01`
- Anthropic `max_tokens` 为必填，`buildFetchParams` 在 Anthropic 未传时强制带 `2048`
- `DashboardView.vue` 免费额度计算会因 `freeQuotaRpd = 0` 而 div-by-zero，必须处理

**Known Limitations：**
- OpenAI/Anthropic 不提供 Groq 式的 `prompt_time` / `completion_time`，usage 显示会少这些资讯
- 费用追踪目前只显示 Groq 格式，跨 provider 费用追踪为 out of scope

**Future Considerations（Out of Scope）：**
- 自订 base URL 支援（self-hosted LLM）
- Streaming 回应以提升使用者感受
- 付费 API 429 rate-limit retry with backoff
- 付费 API 较慢时的 UI 进度回馈（目前 HUD 只有简单的 "enhancing" 状态）
- Anthropic model ID 版本策略（日期戳模型会定期被替换，需加入 DECOMMISSIONED_MODEL_MAP）
