# Story 3.2: 词汇注入 Whisper 与 AI 上下文

Status: done

## Story

As a 使用者,
I want 我的自订词汇自动提升语音辨识和 AI 整理的准确度,
so that 专业术语不再被错误辨识或转换。

## Acceptance Criteria

1. **AC1: Whisper API 词汇注入**
   - Given 使用者已建立自订词汇清单
   - When transcriber.ts 呼叫 Groq Whisper API
   - Then 将词汇清单格式化为 `"Important Vocabulary: 词汇1, 词汇2, 词汇3"` 字串
   - And 作为 Whisper API 的 `prompt` 参数传入
   - And Whisper 辨识结果中的专有名词准确度提升

2. **AC2: AI 整理词汇上下文注入**
   - Given 使用者已建立自订词汇清单且 AI 整理启用
   - When enhancer.ts 呼叫 Groq LLM API
   - Then 将词汇清单作为 `<vocabulary>词汇1, 词汇2, 词汇3</vocabulary>` 注入 system prompt
   - And AI 整理结果中正确保留专有名词原文

3. **AC3: 空词汇清单处理**
   - Given 词汇清单为空
   - When 执行转录或 AI 整理
   - Then Whisper API 不带 prompt 参数（或带空字串）
   - And AI 整理的 system prompt 不包含 `<vocabulary>` 标签
   - And 流程正常运作不报错

4. **AC4: 即时生效**
   - Given 使用者在字典中新增或删除词汇
   - When 下一次触发语音输入
   - Then transcriber.ts 和 enhancer.ts 自动使用最新的词汇清单
   - And 不需重启 App 即时生效

5. **AC5: 大量词汇截取**
   - Given 词汇清单包含大量词汇（100+）
   - When 注入 Whisper prompt 或 AI 上下文
   - Then 系统正常运作不超出 API 限制
   - And 若词汇过多导致 prompt 超长，截取最近新增的词汇优先注入

6. **AC6: HUD Window 词汇可用性**
   - Given 语音流程在 HUD Window 的 useVoiceFlowStore 中执行
   - When handleStopRecording() 需要存取词汇清单
   - Then useVocabularyStore 在 HUD Window 中有可用的词汇资料
   - And 词汇资料与 Main Window 同步

## Tasks / Subtasks

- [x]Task 1: transcriber.ts 新增词汇 prompt 参数 (AC: #1, #3, #5)
  - [x]1.1 扩展 `transcribeAudio()` 函式签名，新增 `vocabularyTermList?: string[]` 参数
  - [x]1.2 实作 `formatWhisperPrompt(termList: string[]): string` 辅助函式
  - [x]1.3 将格式化后的 prompt 加入 FormData（`formData.append("prompt", whisperPrompt)`）
  - [x]1.4 空清单时不 append prompt 栏位（或传空字串）
  - [x]1.5 实作大量词汇截取：超过上限时取最近新增的词汇

- [x]Task 2: useVoiceFlowStore 整合 transcriber 词汇注入 (AC: #1, #4, #6)
  - [x]2.1 在 handleStopRecording() 的 transcribeAudio 呼叫处传入词汇清单
  - [x]2.2 确认 useVocabularyStore 在 HUD Window 中可用且有资料

- [x]Task 3: HUD Window 词汇资料初始化 (AC: #4, #6)
  - [x]3.1 在 HUD Window 初始化 database（main.ts bootstrap 或 App.vue onMounted）
  - [x]3.2 呼叫 vocabularyStore.fetchTermList() 载入词汇
  - [x]3.3 监听 vocabulary:changed 事件，收到后重新 fetchTermList() 保持同步

- [x]Task 4: 大量词汇截取策略 (AC: #5)
  - [x]4.1 定义 MAX_WHISPER_PROMPT_TERMS 常数（建议 50）和 MAX_VOCABULARY_TERMS 常数（建议 100）
  - [x]4.2 transcriber 端：截取最近新增的 N 个词汇（按 createdAt DESC 排序已在 fetchTermList 保证）
  - [x]4.3 enhancer 端：截取最近新增的 N 个词汇

- [x]Task 5: 手动整合测试 (AC: #1-#6)
  - [x]5.1 验证有词汇时 Whisper 辨识包含正确专有名词
  - [x]5.2 验证有词汇时 AI 整理保留专有名词原文
  - [x]5.3 验证空词汇清单时转录和 AI 整理正常运作
  - [x]5.4 验证在 Main Window 新增词汇后，下一次语音输入使用新词汇
  - [x]5.5 验证删除词汇后，下一次语音输入不再包含该词汇
  - [x]5.6 验证大量词汇（50+）时系统不崩溃

## Dev Notes

### 已实作 vs 待实作分析

Story 2.2 的 Dev 已提前完成部分 Story 3.2 的工作。以下是精确的已实作/待实作对照：

| 元件 | 已实作（Story 2.2） | 待实作（Story 3.2） |
|------|---------------------|---------------------|
| `enhancer.ts` | `buildSystemPrompt()` 已支援 `vocabularyTermList` 参数，正确注入 `<vocabulary>` 标签 | 不需修改 |
| `enhancer.ts` | `EnhanceOptions.vocabularyTermList?: string[]` 已定义 | 不需修改 |
| `useVoiceFlowStore.ts` | `handleStopRecording()` lines 270-281 已从 vocabularyStore 取得 termList 传入 enhanceText | 新增 transcribeAudio 词汇传入 |
| `transcriber.ts` | 无词汇相关程式码 | **核心任务：新增 prompt 参数** |
| HUD Window (`main.ts`) | 无 DB 初始化、无 vocabularyStore 初始化 | **核心任务：初始化 DB + 载入词汇** |

### transcriber.ts 修改策略

**目前 transcribeAudio 函式签名：**
```typescript
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
): Promise<Pick<TranscriptionRecord, "rawText" | "transcriptionDurationMs">>
```

**修改后：**
```typescript
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  vocabularyTermList?: string[],
): Promise<Pick<TranscriptionRecord, "rawText" | "transcriptionDurationMs">>
```

新增第三个可选参数，保持向后相容。

**Whisper prompt 格式化：**
```typescript
const MAX_WHISPER_PROMPT_TERMS = 50;

function formatWhisperPrompt(termList: string[]): string {
  const terms = termList.slice(0, MAX_WHISPER_PROMPT_TERMS);
  return `Important Vocabulary: ${terms.join(", ")}`;
}
```

**FormData 中新增 prompt 栏位：**
```typescript
// 在 formData.append("response_format", "text"); 之后
if (vocabularyTermList && vocabularyTermList.length > 0) {
  const whisperPrompt = formatWhisperPrompt(vocabularyTermList);
  formData.append("prompt", whisperPrompt);
}
```

**注意**：Groq Whisper API 的 `prompt` 参数用于引导模型辨识特定词汇。格式 `"Important Vocabulary: 词1, 词2"` 是 Whisper API 社群广泛使用的最佳实践，能有效提升专有名词辨识率。

### useVoiceFlowStore 修改策略

`handleStopRecording()` 中已有 AI enhancer 的词汇注入（lines 270-281）。需在更早的 `transcribeAudio()` 呼叫处也传入词汇：

**目前（line 255）：**
```typescript
const result = await transcribeAudio(audioBlob, apiKey);
```

**修改后：**
```typescript
const vocabularyStore = useVocabularyStore();
const vocabularyTermList = vocabularyStore.termList.map(
  (entry) => entry.term,
);

const result = await transcribeAudio(
  audioBlob,
  apiKey,
  vocabularyTermList.length > 0 ? vocabularyTermList : undefined,
);
```

**优化**：vocabularyStore 的取用可以提前到 transcribeAudio 呼叫前，让后续 enhancer 也重用同一个 `vocabularyTermList`，避免重复 `.map()`。

```typescript
// 提前取得词汇（transcriber + enhancer 共用）
const vocabularyStore = useVocabularyStore();
const vocabularyTermList = vocabularyStore.termList.map(
  (entry) => entry.term,
);
const hasVocabulary = vocabularyTermList.length > 0;

const result = await transcribeAudio(
  audioBlob,
  apiKey,
  hasVocabulary ? vocabularyTermList : undefined,
);

// ... 后续 enhancer 也使用同一个 vocabularyTermList
```

注意：lines 270-273 已有 `const vocabularyStore = useVocabularyStore()` 的呼叫（在 enhancer 分支中），需合并到共用位置避免重复。

### HUD Window 词汇资料初始化问题

**核心问题**：语音流程（录音→转录→AI 整理→贴上）在 HUD Window (App.vue) 中执行。`useVoiceFlowStore.handleStopRecording()` 呼叫 `useVocabularyStore()` 取得词汇，但 HUD Window 目前：

1. 未初始化 database（`initializeDatabase()` 仅在 `main-window.ts` 呼叫）
2. 未呼叫 `vocabularyStore.fetchTermList()`（termList 永远为空阵列）

**解决方案**：在 HUD Window 启动时初始化 DB 并载入词汇。

```
修改 src/App.vue onMounted:
  1. await initializeDatabase()
  2. const vocabularyStore = useVocabularyStore()
  3. await vocabularyStore.fetchTermList()
  4. 监听 vocabulary:changed 事件 → 重新 fetchTermList()
```

或者修改 `src/main.ts`：
```typescript
import { initializeDatabase } from "./lib/database";
// ... 在 createApp 之后
try {
  await initializeDatabase();
} catch (err) {
  console.error("[hud] Database init failed:", err);
}
```

**建议方案**：在 `App.vue` 的 `onMounted` 中、`voiceFlowStore.initialize()` 之前，先初始化 DB 和载入词汇。这样 initialize 中的 hotkey listener 触发 handleStopRecording 时就有词汇可用。

```typescript
// App.vue onMounted（修改后）
onMounted(async () => {
  // 1. 初始化 DB（供 vocabularyStore 使用）
  try {
    await initializeDatabase();
  } catch (err) {
    console.error("[App] Database init failed:", err);
  }

  // 2. 载入词汇（供 transcriber + enhancer 使用）
  const vocabularyStore = useVocabularyStore();
  await vocabularyStore.fetchTermList();

  // 3. 监联词汇变更（Main Window 新增/删除词汇时同步）
  unlistenVocabularyChanged = await listenToEvent(
    VOCABULARY_CHANGED,
    () => { void vocabularyStore.fetchTermList(); }
  );

  // 4. 初始化语音流程
  await voiceFlowStore.initialize();

  // ... 其余现有逻辑
});
```

### 即时生效机制

词汇新增/删除即时生效的完整资料流：

```
Main Window: 使用者新增词汇
  → DictionaryView → vocabularyStore.addTerm()
  → SQLite INSERT
  → emitEvent(VOCABULARY_CHANGED, { action: 'added', term })
  → 事件广播至所有视窗
  ↓
HUD Window: listenToEvent(VOCABULARY_CHANGED, ...)
  → vocabularyStore.fetchTermList()  // 重新从 SQLite 读取
  → termList 更新
  ↓
下一次按下热键:
  → handleStopRecording()
  → vocabularyStore.termList（已是最新）
  → transcribeAudio(blob, apiKey, latestTermList)
  → enhanceText(rawText, apiKey, { vocabularyTermList: latestTermList })
```

**关键**：HUD Window 必须监听 `vocabulary:changed` 事件并重新 `fetchTermList()`。直接从 SQLite 重新读取（而非从事件 payload 增量更新）是最安全的做法，确保资料一致性。

### 大量词汇截取策略

Groq Whisper API prompt 参数有长度限制（与模型 context 相关）。AI enhancer system prompt 也有 token 上限。

**建议常数：**
```typescript
// transcriber.ts
const MAX_WHISPER_PROMPT_TERMS = 50;

// enhancer.ts（可在 buildSystemPrompt 中截取）
const MAX_VOCABULARY_TERMS = 100;
```

**截取逻辑**：`fetchTermList()` 已按 `created_at DESC` 排序，所以 `termList[0]` 是最新的词汇。`slice(0, N)` 即可截取最近新增的 N 个。

### 不需修改的档案

- `src/types/vocabulary.ts` — VocabularyEntry 不变
- `src/types/events.ts` — VocabularyChangedPayload 不变
- `src/composables/useTauriEvents.ts` — 常数已存在
- `src/lib/database.ts` — DB schema 不变
- `src/views/DictionaryView.vue` — CRUD UI（Story 3.1 范围）
- `src/stores/useSettingsStore.ts` — 不涉及词汇

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/lib/transcriber.ts` | 新增 vocabularyTermList 参数 + formatWhisperPrompt + FormData append |
| `src/stores/useVoiceFlowStore.ts` | handleStopRecording 传入词汇至 transcribeAudio + 重构词汇取用位置 |
| `src/App.vue` | onMounted 新增 DB 初始化 + 词汇载入 + vocabulary:changed 事件监听 |
| `src/lib/enhancer.ts` | （可选）buildSystemPrompt 加入 MAX_VOCABULARY_TERMS 截取 |

### enhancer.ts 已实作的词汇注入程式码确认

`enhancer.ts` 的 `buildSystemPrompt()` (line 46-62) 已完整支援：

```typescript
export function buildSystemPrompt(
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

`useVoiceFlowStore.ts` lines 270-281 已呼叫：
```typescript
const vocabularyStore = useVocabularyStore();
const vocabularyTermList = vocabularyStore.termList.map(
  (entry) => entry.term,
);
// ... 传入 enhanceText
```

**结论**：enhancer 端已完整实作。Story 3.2 可以选择在 `buildSystemPrompt` 中加入截取逻辑（MAX_VOCABULARY_TERMS），但核心功能已在。

### main.ts 非同步 bootstrap 改造注意

目前 `src/main.ts` 是同步式：
```typescript
const pinia = createPinia();
createApp(App).use(pinia).mount("#app");
```

如果选择在 main.ts 中初始化 DB，需要改为 async bootstrap 模式（参考 main-window.ts）。但**建议不改 main.ts**，改在 App.vue onMounted 中处理，因为：
1. 保持 main.ts 简洁（App.vue 已有初始化逻辑）
2. DB 初始化失败不应阻止 App 挂载（HUD 仍需显示）
3. 与 main-window.ts 的模式差异是合理的（HUD 更轻量）

### Project Structure Notes

- 不新增任何新档案
- 所有修改在既有专案结构内
- 依赖方向符合：`App.vue → useVocabularyStore → database.ts`
- transcriber.ts 保持 lib/ 层纯逻辑（不依赖 Vue/Store），词汇资料由 store 传入

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — AC 完整定义
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns] — Groq API 呼叫模式
- [Source: _bmad-output/planning-artifacts/architecture.md#Communication Patterns] — Tauri Event 订阅模式
- [Source: _bmad-output/planning-artifacts/architecture.md#Component Boundaries] — HUD vs Main Window 职责
- [Source: _bmad-output/implementation-artifacts/3-1-vocabulary-crud-interface.md] — Story 3.1 词汇 CRUD 骨架、Tauri Event 发送模式
- [Source: src/lib/transcriber.ts] — 现有 Whisper API 呼叫（无 prompt 参数）
- [Source: src/lib/enhancer.ts] — 已实作 buildSystemPrompt + vocabularyTermList 支援
- [Source: src/stores/useVoiceFlowStore.ts] — 已实作 enhancer 词汇注入（lines 270-281），缺 transcriber 词汇注入
- [Source: src/stores/useVocabularyStore.ts] — 骨架（Story 3.1 实作后有 termList + fetchTermList）
- [Source: src/App.vue] — HUD Window 初始化流程（无 DB 初始化、无词汇载入）
- [Source: src/main.ts] — HUD Window 入口（同步式，无 bootstrap）
- [Source: src/main-window.ts] — Main Window 入口（async bootstrap + DB 初始化参考）

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 128 tests passed

### Completion Notes List

- transcriber.ts 扩展 formatWhisperPrompt + MAX_WHISPER_PROMPT_TERMS=50
- enhancer.ts vocabulary 标签注入 + MAX_VOCABULARY_TERMS=100
- useVoiceFlowStore 词汇同时注入 transcriber + enhancer
- App.vue HUD Window DB init + vocabularyStore.fetchTermList + vocabulary:changed 监听

### Change Log

- Story 3.2 完整实作 — 词汇注入 Whisper 与 AI 上下文

### File List

- src/lib/transcriber.ts
- src/lib/enhancer.ts
- src/stores/useVoiceFlowStore.ts
- src/App.vue
- tests/unit/transcriber.test.ts
- tests/unit/use-voice-flow-store.test.ts
