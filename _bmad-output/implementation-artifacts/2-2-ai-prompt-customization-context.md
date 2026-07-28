# Story 2.2: AI Prompt 自订与上下文注入

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 自订 AI 整理的 prompt 并注入上下文资讯,
So that 我能控制 AI 的整理风格，且 AI 能根据当前情境做更好的整理。

## Acceptance Criteria

1. **SettingsView AI Prompt 编辑区域** — SettingsView.vue 新增「AI 整理 Prompt」区块（位于 API Key 区块下方）。显示多行文字编辑区域（`<textarea>`），预设填入预设 prompt 内容。使用者可自由编辑 prompt 内容。区块包含「储存」按钮和「重置为预设」按钮。

2. **Prompt 持久化与读取** — 使用者修改 prompt 后点击「储存」，新 prompt 透过 `useSettingsStore` 持久化至 tauri-plugin-store（key: `"aiPrompt"`）。App 启动时 `loadSettings()` 从 store 读取已储存的 prompt。若无储存的 prompt，使用 `DEFAULT_SYSTEM_PROMPT`。后续的 AI 整理请求使用使用者自订的 prompt。

3. **重置为预设** — 使用者点击「重置为预设」按钮时，prompt 编辑区域恢复为 `DEFAULT_SYSTEM_PROMPT` 内容。自动储存至 tauri-plugin-store。显示成功回馈讯息。

4. **enhancer.ts 接受自订 prompt** — `enhanceText()` 函式签名扩展为接受 system prompt 参数：`enhanceText(rawText: string, apiKey: string, systemPrompt: string): Promise<string>`。`useVoiceFlowStore` 呼叫 `enhanceText()` 时从 `useSettingsStore` 取得当前 prompt 传入。`enhancer.ts` 内部不再使用硬编码的 `DEFAULT_SYSTEM_PROMPT`（改由呼叫端传入）。

5. **剪贴簿上下文注入** — AI 整理请求发送前，`enhancer.ts`（或呼叫端）读取使用者当前系统剪贴簿内容。若剪贴簿非空，将内容作为 `<clipboard>...</clipboard>` 标签附加至 system prompt 末尾。若剪贴簿为空，不注入 `<clipboard>` 标签。

6. **词汇上下文注入** — AI 整理请求发送前，从 `useVocabularyStore.termList` 取得当前词汇清单。若词汇清单非空，将词汇以逗号分隔格式作为 `<vocabulary>...</vocabulary>` 标签附加至 system prompt 末尾。若词汇清单为空，不注入 `<vocabulary>` 标签。

7. **空上下文不注入空标签** — 剪贴簿为空时不传空 `<clipboard></clipboard>` 标签。词汇清单为空时不传空 `<vocabulary></vocabulary>` 标签。两者皆空时 system prompt 仅包含使用者自订的 prompt 本体。AI 整理仍正常运作。

## Tasks / Subtasks

- [x]Task 1: 扩展 useSettingsStore 支援 AI Prompt 管理 (AC: #2, #3)
  - [x]1.1 在 `useSettingsStore.ts` 新增：
    - `import { DEFAULT_SYSTEM_PROMPT } from "../lib/enhancer"` — 从 enhancer.ts 汇出预设 prompt
    - `const aiPrompt = ref<string>(DEFAULT_SYSTEM_PROMPT)` — AI Prompt 状态
  - [x]1.2 扩展 `loadSettings()` 加载 AI Prompt：
    - `const savedPrompt = await store.get<string>("aiPrompt")`
    - `aiPrompt.value = savedPrompt?.trim() || DEFAULT_SYSTEM_PROMPT`
  - [x]1.3 新增 `saveAiPrompt(prompt: string): Promise<void>` action：
    - 验证 prompt 不为空白（空白时 throw Error）
    - `await store.set("aiPrompt", prompt.trim())`
    - `await store.save()`
    - `aiPrompt.value = prompt.trim()`
    - console.log 确认储存成功
  - [x]1.4 新增 `resetAiPrompt(): Promise<void>` action：
    - `aiPrompt.value = DEFAULT_SYSTEM_PROMPT`
    - `await store.set("aiPrompt", DEFAULT_SYSTEM_PROMPT)`
    - `await store.save()`
  - [x]1.5 新增 `getAiPrompt(): string` getter：
    - `return aiPrompt.value`
  - [x]1.6 汇出新增的 state 和 actions：`aiPrompt`, `saveAiPrompt`, `resetAiPrompt`, `getAiPrompt`

- [x]Task 2: 扩展 enhancer.ts 支援自订 prompt 和上下文注入 (AC: #4, #5, #6, #7)
  - [x]2.1 将 `DEFAULT_SYSTEM_PROMPT` 改为 `export const` 汇出（供 settingsStore 和测试使用）
  - [x]2.2 修改 `enhanceText()` 函式签名：
    - 从 `enhanceText(rawText: string, apiKey: string)`
    - 改为 `enhanceText(rawText: string, apiKey: string, options?: EnhanceOptions)`
    - 定义 `interface EnhanceOptions { systemPrompt?: string; clipboardContent?: string; vocabularyTermList?: string[]; }`
  - [x]2.3 新增内部函式 `buildSystemPrompt(basePrompt: string, clipboardContent?: string, vocabularyTermList?: string[]): string`：
    - 以 `basePrompt` 为基础
    - 若 `clipboardContent` 非空非空白，附加 `\n\n<clipboard>\n${clipboardContent}\n</clipboard>`
    - 若 `vocabularyTermList` 非空（length > 0），附加 `\n\n<vocabulary>\n${vocabularyTermList.join(", ")}\n</vocabulary>`
    - 回传组装后的完整 system prompt
  - [x]2.4 修改 `enhanceText()` 内部逻辑：
    - `const systemPrompt = options?.systemPrompt || DEFAULT_SYSTEM_PROMPT`
    - `const fullPrompt = buildSystemPrompt(systemPrompt, options?.clipboardContent, options?.vocabularyTermList)`
    - 使用 `fullPrompt` 作为 messages 中 system role 的 content

- [x]Task 3: 扩展 useVoiceFlowStore 传递 prompt 和上下文 (AC: #4, #5, #6)
  - [x]3.1 在 `handleStopRecording()` 的 AI 整理分支中：
    - 从 `useSettingsStore().getAiPrompt()` 取得当前 prompt
    - 读取系统剪贴簿内容：`const clipboardContent = await readClipboardText()`
    - 从 `useVocabularyStore().termList` 取得词汇清单
    - 呼叫 `enhanceText(result.rawText, apiKey, { systemPrompt, clipboardContent, vocabularyTermList })`
  - [x]3.2 新增剪贴簿读取逻辑：
    - 使用 Tauri 的 `readText()` from `@tauri-apps/plugin-clipboard-manager`，或使用 `navigator.clipboard.readText()`
    - **注意**：需确认 Tauri v2 下可用的剪贴簿读取 API（见 Dev Notes）
    - try/catch 包裹：读取失败时（如无权限）静默忽略，clipboardContent 为 undefined
  - [x]3.3 词汇清单格式化：
    - `const vocabularyTermList = vocabularyStore.termList.map(entry => entry.term)`
    - 若 termList 为空阵列，不传 vocabularyTermList（或传空阵列，由 enhancer.ts 判断）

- [x]Task 4: SettingsView.vue 新增 AI Prompt 编辑 UI (AC: #1, #3)
  - [x]4.1 在 API Key 区块下方新增「AI 整理 Prompt」`<section>`，样式与 API Key 区块一致（`rounded-xl border border-zinc-700 bg-zinc-900 p-5`）
  - [x]4.2 区块包含：
    - 标题「AI 整理 Prompt」
    - 说明文字：「自订 AI 整理文字时使用的系统提示词。修改后点击储存。」
    - `<textarea>` 多行编辑器：
      - `v-model="promptInput"` 绑定本地 ref
      - 初始值从 `settingsStore.getAiPrompt()` 取得
      - `rows="10"` 提供足够编辑空间
      - 样式与 API Key input 一致（`rounded-lg border border-zinc-600 bg-zinc-800`）
      - `font-family: monospace` 方便阅读 prompt
    - 按钮列：
      - 「储存」按钮：呼叫 `settingsStore.saveAiPrompt(promptInput)`
      - 「重置为预设」按钮：呼叫 `settingsStore.resetAiPrompt()` 后更新 `promptInput`
    - 回馈讯息（成功/错误），沿用现有 `showFeedbackMessage` 模式
  - [x]4.3 重置逻辑：
    - 重置前弹出确认对话框（`window.confirm("确定要重置为预设 Prompt 吗？")`）
    - 确认后呼叫 `settingsStore.resetAiPrompt()`
    - 更新 `promptInput.value = settingsStore.getAiPrompt()`
    - 显示「已重置为预设」回馈
  - [x]4.4 储存逻辑：
    - 呼叫 `settingsStore.saveAiPrompt(promptInput.value)`
    - 成功显示「Prompt 已储存」
    - 失败显示错误讯息
  - [x]4.5 页面进入时初始化：
    - `onMounted` 或 `watchEffect` 中 `promptInput.value = settingsStore.getAiPrompt()`

- [x]Task 5: 单元测试 (AC: #2, #4, #5, #6, #7)
  - [x]5.1 扩展 `tests/unit/enhancer.test.ts`：
    - 测试传入自订 systemPrompt：确认 API 请求使用自订 prompt
    - 测试不传 systemPrompt 时使用 DEFAULT_SYSTEM_PROMPT
    - 测试 clipboardContent 注入：确认 `<clipboard>` 标签出现在 system prompt 中
    - 测试 vocabularyTermList 注入：确认 `<vocabulary>` 标签出现在 system prompt 中
    - 测试空 clipboardContent 不注入标签
    - 测试空 vocabularyTermList 不注入标签
    - 测试 buildSystemPrompt 组装逻辑（clipboard + vocabulary 组合）
  - [x]5.2 扩展 `tests/unit/use-settings-store.test.ts`（若存在）或建立：
    - 测试 `saveAiPrompt()`：持久化至 store
    - 测试 `resetAiPrompt()`：恢复预设值并持久化
    - 测试 `loadSettings()` 读取已储存的 prompt
    - 测试 `loadSettings()` 无储存值时使用预设
  - [x]5.3 扩展 `tests/unit/use-voice-flow-store.test.ts`：
    - 测试 AI 整理时传递 systemPrompt 参数
    - 测试剪贴簿内容被注入（mock clipboard API）
    - 测试词汇清单被注入

- [x]Task 6: 整合验证 (AC: #1-7)
  - [x]6.1 `pnpm exec vue-tsc --noEmit` 通过
  - [x]6.2 `pnpm test` 所有测试通过
  - [x]6.3 手动测试：开启设定页面 → 看到 AI Prompt 编辑区域，预设填入预设 prompt
  - [x]6.4 手动测试：修改 prompt 内容 → 点击储存 → 显示「Prompt 已储存」→ 重启 App 后 prompt 保持自订值
  - [x]6.5 手动测试：点击「重置为预设」→ 确认对话框 → 确认 → prompt 恢复为预设内容
  - [x]6.6 手动测试：剪贴簿有内容时触发语音输入（>= 10 字）→ AI 整理结果考量剪贴簿上下文
  - [x]6.7 手动测试：剪贴簿为空时触发语音输入 → AI 整理正常运作，不受影响
  - [x]6.8 手动测试：有自订词汇时触发语音输入 → AI 整理结果正确保留专有名词（需 Story 3.1 先有资料，若 3.1 未完成则以空词汇测试）

## Dev Notes

### 架构模式与约束

**Brownfield 专案** — 基于 Story 2.1（enhancer.ts + useVoiceFlowStore AI 整理流程）继续扩展。

**本 Story 的核心变更：**
1. `useSettingsStore` 新增 AI Prompt 管理（CRUD + 持久化）
2. `enhancer.ts` 扩展接受自订 prompt + 上下文注入
3. `useVoiceFlowStore` 呼叫 enhanceText 时传递 prompt + 上下文
4. `SettingsView.vue` 新增 prompt 编辑 UI

**依赖方向规则（严格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

### Story 2.1 实作结果（当前程式码状态）

**enhancer.ts 现状（Story 2.1 已完成）：**
- `DEFAULT_SYSTEM_PROMPT` 是 module-level 常数（非 export）
- `enhanceText(rawText: string, apiKey: string): Promise<string>` — 两参数签名
- 内部硬编码使用 `DEFAULT_SYSTEM_PROMPT`
- 使用 `withTimeout()` 包裹 fetch 实作 5 秒 timeout
- HTTP Client：`@tauri-apps/plugin-http` 的 `fetch`

**useVoiceFlowStore 现状（Story 2.1 已完成）：**
- `handleStopRecording()` 中 AI 整理分支：`await enhanceText(result.rawText, apiKey)` — 两参数呼叫
- 字数门槛 `ENHANCEMENT_CHAR_THRESHOLD = 10`
- fallback 行为已完整实作

**useSettingsStore 现状：**
- 管理 `hotkeyConfig`、`apiKey`
- `SettingsDto` type 已预定义 `aiPrompt: string`（types/settings.ts line 21）
- 但 store 尚未实作 aiPrompt 相关逻辑

### enhancer.ts 修改策略

**函式签名变更：**
```typescript
// Story 2.1 版本（现有）
export async function enhanceText(
  rawText: string,
  apiKey: string,
): Promise<string>

// Story 2.2 版本（修改后）
export interface EnhanceOptions {
  systemPrompt?: string;
  clipboardContent?: string;
  vocabularyTermList?: string[];
}

export async function enhanceText(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
): Promise<string>
```

使用 optional 参数 `options?` 确保向后相容。不传 options 时行为与 2.1 完全相同。

**System Prompt 组装逻辑（buildSystemPrompt）：**
```typescript
function buildSystemPrompt(
  basePrompt: string,
  clipboardContent?: string,
  vocabularyTermList?: string[],
): string {
  let prompt = basePrompt;

  if (clipboardContent && clipboardContent.trim()) {
    prompt += `\n\n<clipboard>\n${clipboardContent}\n</clipboard>`;
  }

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    prompt += `\n\n<vocabulary>\n${vocabularyTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}
```

**`DEFAULT_SYSTEM_PROMPT` 汇出：**
```typescript
// 从 module-level const 改为 export const
export const DEFAULT_SYSTEM_PROMPT = `...`;
```

settingsStore 需要 import 这个常数作为预设值。

### 剪贴簿读取方案

**方案选择：** 使用 Rust Tauri Command 读取剪贴簿，因为 `clipboard_paste.rs` 已使用 `arboard` 操作剪贴簿。

**可用选项（依优先顺序）：**

1. **`navigator.clipboard.readText()`（Web API）** — 最简单，但在 Tauri WebView 中可能需要焦点窗口才能读取，且 HUD Window 是 `setIgnoreCursorEvents(true)` 的透明视窗，可能无法使用此 API。

2. **新增 Rust Tauri Command `read_clipboard_text()`** — 在 `clipboard_paste.rs` 新增一个 read command，使用 `arboard::Clipboard::new()?.get_text()`。这是最可靠的方案，因为 Rust 端不受 WebView 焦点限制。

3. **`@tauri-apps/plugin-clipboard-manager`** — Tauri 官方剪贴簿 plugin，但专案目前未安装此 plugin。

**建议方案：** 先尝试 `navigator.clipboard.readText()`。若在 HUD Window 环境下无法使用（权限问题），退回方案 2（新增 Rust command）。

**重要：** 剪贴簿读取在 `handleStopRecording()` 中执行，此时 HUD 可能已隐藏或正在显示 enhancing 状态。需要在呼叫 `enhanceText()` 之前读取剪贴簿，因为 `paste_text` 会覆写剪贴簿内容。

**剪贴簿读取时机：**
```
transcribeAudio() → result.rawText
  → 读取剪贴簿（此时剪贴簿还是使用者原本的内容）
  → enhanceText(rawText, apiKey, { clipboardContent })
  → paste_text(enhancedText)  ← 这步会覆写剪贴簿
```

### useSettingsStore 扩展

**tauri-plugin-store key 命名：**
- 现有：`"hotkeyTriggerKey"`, `"hotkeyTriggerMode"`, `"groqApiKey"`
- 新增：`"aiPrompt"`

**loadSettings() 扩展：**
```typescript
// 现有逻辑之后新增：
const savedPrompt = await store.get<string>("aiPrompt");
aiPrompt.value = savedPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
```

### SettingsView.vue UI 设计

**布局结构：**
```
设定
├── [Groq API Key 区块]      ← 现有
│   ├── 标题 + 状态标签
│   ├── 说明文字
│   ├── Input + 按钮列
│   └── 回馈讯息 + 删除按钮
│
└── [AI 整理 Prompt 区块]    ← 新增
    ├── 标题
    ├── 说明文字
    ├── Textarea（多行编辑）
    ├── 按钮列（储存 + 重置为预设）
    └── 回馈讯息
```

**回馈讯息处理：** 新增独立的 prompt 回馈 ref（`promptFeedbackMessage` / `promptFeedbackType`），避免与 API Key 区块的回馈冲突。或者共用现有的 `showFeedbackMessage` 逻辑但分区域显示。建议使用独立 ref，更清晰。

**Textarea 样式：** 与现有 input 风格一致，使用 monospace 字型方便阅读 prompt 结构：
```html
<textarea
  v-model="promptInput"
  rows="10"
  class="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-3
         font-mono text-sm text-white outline-none transition
         focus:border-blue-500 resize-y"
/>
```

### 词汇清单注入注意事项

**useVocabularyStore 现状：** Store 骨架已建立，但所有 CRUD 方法都是 TODO（Story 3.1）。`termList` 是空的 ref。

**本 Story 的处理方式：** 即使 Story 3.1 尚未完成，本 Story 仍应：
1. 在 `handleStopRecording()` 中读取 `vocabularyStore.termList`
2. 格式化为 `string[]` 传递给 enhancer.ts
3. 当 termList 为空时，不注入 `<vocabulary>` 标签

这样 Story 3.1 完成后，词汇注入会自动生效，无需额外修改。

### 跨 Story 注意事项

- **Story 2.1** 已完成 enhancer.ts 基础和 useVoiceFlowStore AI 整理流程。本 Story 在此基础上扩展。
- **Story 3.1** 会实作 `useVocabularyStore` 的 CRUD。本 Story 只读取 `termList`，不依赖 CRUD 功能。
- **Story 3.2** 会实作词汇注入 Whisper + AI 上下文（更完整的词汇整合）。本 Story 的 `<vocabulary>` 注入是其前置工作。

### 现有档案改动点

**修改档案：**
```
src/lib/enhancer.ts              — export DEFAULT_SYSTEM_PROMPT、扩展 enhanceText 签名、buildSystemPrompt
src/stores/useSettingsStore.ts   — 新增 aiPrompt 管理（state + actions）
src/stores/useVoiceFlowStore.ts  — enhanceText 呼叫加入 options 参数（prompt + clipboard + vocabulary）
src/views/SettingsView.vue       — 新增 AI Prompt 编辑区块
tests/unit/enhancer.test.ts      — 新增自订 prompt + 上下文注入测试
tests/unit/use-voice-flow-store.test.ts — 新增 prompt/上下文传递测试
```

**可能新增档案：**
```
tests/unit/use-settings-store.test.ts — settings store prompt 管理测试（若不存在）
```

**不修改的档案（明确排除）：**
- `src/components/NotchHud.vue` — 不涉及 HUD 显示
- `src/lib/recorder.ts` — 录音逻辑不变
- `src/lib/transcriber.ts` — 转录逻辑不变
- `src/types/index.ts` — HudStatus 不变
- `src/App.vue` — HUD 入口不变
- `Cargo.toml` / `package.json` — 不需新增依赖（若使用 navigator.clipboard）
- `src-tauri/src/plugins/clipboard_paste.rs` — 除非需要新增 read command（见剪贴簿方案）

**可能需要修改的 Rust 档案（视剪贴簿方案而定）：**
- `src-tauri/src/plugins/clipboard_paste.rs` — 若需新增 `read_clipboard_text` command
- `src-tauri/src/lib.rs` — 若需注册新 command
- `src-tauri/capabilities/default.json` — 若需新增权限

### 不需要的 Cargo/NPM 依赖变更

本 Story **不需要安装任何新依赖**（假设使用 `navigator.clipboard.readText()` 或已有的 arboard）。若改用 `@tauri-apps/plugin-clipboard-manager`，则需要安装此 plugin（Rust + JS）。建议先尝试不安装新依赖的方案。

### 安全规则提醒

- API Key 从 `useSettingsStore().getApiKey()` 取得，不硬编码
- API Key 不写入任何日志
- **剪贴簿内容可能包含敏感资讯** — 不写入日志，仅传送至 Groq API
- CSP `connect-src 'self' https://api.groq.com` 限制资料只传到 Groq
- AI Prompt 以明文存于 tauri-plugin-store（与 API Key 同一 settings.json）

### 效能注意事项

- 剪贴簿读取是同步/快速操作，不影响 E2E 延迟
- 词汇清单从 Pinia store 直接读取，无 DB 查询
- System prompt 组装是纯字串操作，无效能影响
- **注意 prompt 长度**：若使用者自订 prompt 过长 + 大量词汇 + 长剪贴簿内容，可能超出 LLM context window。目前不做截断（Phase 1），但在 Dev Notes 记录此风险。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 — Story 2.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Security — tauri-plugin-store 本地储存]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture — Pinia Stores 结构]
- [Source: _bmad-output/planning-artifacts/prd.md#AI 文字整理 FR10-FR12]
- [Source: _bmad-output/implementation-artifacts/2-1-groq-llm-text-enhancement.md — enhancer.ts 设计]
- [Source: Codebase — src/lib/enhancer.ts（扩展目标）]
- [Source: Codebase — src/stores/useSettingsStore.ts（扩展目标）]
- [Source: Codebase — src/stores/useVoiceFlowStore.ts（修改呼叫方式）]
- [Source: Codebase — src/views/SettingsView.vue（新增 UI 区块）]
- [Source: Codebase — src/types/settings.ts — SettingsDto 已预定义 aiPrompt field]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 109 tests passed

### Completion Notes List

- SettingsView 新增 AI Prompt textarea + 储存/重置按钮
- useSettingsStore 新增 saveAiPrompt/resetAiPrompt/getAiPrompt
- enhancer.ts 扩展 EnhanceOptions（systemPrompt, clipboardContent, vocabularyTermList）
- buildSystemPrompt 支援 clipboard/vocabulary 标签注入

### Change Log

- Story 2.2 完整实作 — AI Prompt 自订与上下文注入

### File List

- src/views/SettingsView.vue
- src/stores/useSettingsStore.ts
- src/lib/enhancer.ts
- src/stores/useVoiceFlowStore.ts
- tests/unit/enhancer.test.ts
- tests/unit/use-voice-flow-store.test.ts
