# Story 2.1: Groq LLM AI 文字整理核心流程

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 语音转录结果自动经 AI 整理为通顺的书面语,
So that 我的语音输出可以直接使用，不需手动编辑口语赘词和标点。

## Acceptance Criteria

1. **enhancer.ts 模组建立** — 建立 `src/lib/enhancer.ts` 模组，呼叫 Groq LLM API（`https://api.groq.com/openai/v1/chat/completions` endpoint）。使用预设 system prompt 进行口语→书面语整理（去赘词、重组句构、修正标点、适当分段、保持原意）。API Key 从 `useSettingsStore.getApiKey()` 取得。API 请求透过 HTTPS 传送。模组汇出 `enhanceText(rawText: string, apiKey: string): Promise<string>` 函式。

2. **字数门槛分支（>= 10 字走 AI 整理）** — 转录结果文字长度 >= 10 字时，`useVoiceFlowStore` 的 `handleStopRecording()` 在转录完成后进入 AI 整理流程。状态更新为 `'enhancing'`，发送 `voice-flow:state-changed` 事件 `{ status: 'enhancing' }`。AI 整理完成后将整理后的文字贴入游标位置。

3. **字数门槛分支（< 10 字跳过 AI）** — 转录结果文字长度 < 10 字时，跳过 AI 整理步骤。直接将原始转录文字贴入游标位置。`useVoiceFlowStore` 状态直接从 `'transcribing'` 跳至 `'success'`（维持现有行为）。

4. **5 秒 timeout fallback** — AI 整理 API 请求进行中，若请求超过 5 秒未回应，自动取消请求（AbortController timeout）。将原始转录文字贴入游标位置作为 fallback。`useVoiceFlowStore` 状态更新为 `'success'`。HUD 显示「已贴上（未整理）」。

5. **API 错误 fallback** — AI 整理 API 请求失败（非 timeout，如 HTTP 非 200、网路错误），将原始转录文字贴入游标位置作为 fallback。`useVoiceFlowStore` 状态更新为 `'success'`。HUD 显示「已贴上（未整理）」。

6. **HUD enhancing 状态显示** — `useVoiceFlowStore` 状态为 `'enhancing'` 时，`NotchHud.vue` 显示「整理中...」状态（loading spinner 动画，与 transcribing 相同视觉效果）。HUD 状态完整流程：idle → recording → transcribing → enhancing → success → idle。

7. **端到端延迟目标** — AI 整理完成后文字成功贴入，端到端延迟（含 AI 整理）< 3 秒。

## Tasks / Subtasks

- [x] Task 1: 建立 enhancer.ts 模组 (AC: #1)
  - [x]1.1 建立 `src/lib/enhancer.ts`，定义常数：
    - `GROQ_CHAT_API_URL = "https://api.groq.com/openai/v1/chat/completions"` — Groq LLM chat completions endpoint
    - `GROQ_LLM_MODEL = "llama-3.3-70b-versatile"` — Groq 可用的高品质模型
    - `ENHANCEMENT_TIMEOUT_MS = 5000` — 5 秒 timeout
    - `DEFAULT_SYSTEM_PROMPT` — 预设 system prompt（见 Dev Notes）
  - [x]1.2 实作 `enhanceText(rawText: string, apiKey: string): Promise<string>` 函式：
    - 使用 `@tauri-apps/plugin-http` 的 `fetch`（与 transcriber.ts 一致）
    - 组装 chat completions 请求 body：`{ model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: rawText }], temperature: 0.3, max_tokens: 2048 }`
    - 使用 `AbortController` + `setTimeout` 实作 5 秒 timeout
    - 请求 headers：`Authorization: Bearer ${apiKey}`, `Content-Type: application/json`
    - 回传 `response.choices[0].message.content.trim()`
    - 若回应为空或 choices 为空，回传原始 rawText
  - [x]1.3 错误处理：
    - `AbortError`（timeout）→ 抛出 `new Error("AI 整理逾时")` — 让呼叫端 catch 决定 fallback
    - HTTP 非 200 → 抛出 `new Error(\`AI 整理失败：${response.status}\`)`
    - 网路错误（TypeError）→ 自然抛出，呼叫端 catch 处理
  - [x]1.4 新增 `getEnhancementErrorMessage(error: unknown): string` 至 `src/lib/errorUtils.ts`：
    - `AbortError` 或包含 "逾时" → `"AI 整理逾时，已贴上原始文字"`
    - HTTP 401 → `"API Key 无效或已过期"`
    - HTTP 429 → `"请求过于频繁，请稍后再试"`
    - HTTP 5xx → `"AI 整理服务暂时无法使用"`
    - 其他 → `"AI 整理失败"`

- [x] Task 2: 扩展 useVoiceFlowStore 加入 AI 整理流程 (AC: #2, #3, #4, #5)
  - [x]2.1 在 `useVoiceFlowStore.ts` 新增常数：
    - `ENHANCEMENT_CHAR_THRESHOLD = 10` — 字数门槛
    - `ENHANCING_MESSAGE = "整理中..."` — enhancing 状态讯息
    - `PASTE_SUCCESS_UNENHANCED_MESSAGE = "已贴上（未整理）"` — fallback 成功讯息
  - [x]2.2 新增 `import { enhanceText } from "../lib/enhancer"`
  - [x]2.3 修改 `handleStopRecording()` 中转录成功后的流程（在取得 `result.rawText` 之后、`invoke("paste_text")` 之前）：
    - 判断 `result.rawText.length >= ENHANCEMENT_CHAR_THRESHOLD`
    - **>= 10 字**：进入 AI 整理分支
      - `transitionTo("enhancing", ENHANCING_MESSAGE)`
      - try：`const enhancedText = await enhanceText(result.rawText, apiKey)`
      - 记录 `enhancementDurationMs = performance.now() - enhancementStartTime`
      - `await hideHud()` → `await invoke("paste_text", { text: enhancedText })`
      - `isRecording.value = false`
      - `transitionTo("success", PASTE_SUCCESS_MESSAGE)`
      - catch（AI 整理失败/逾时）：
        - `writeErrorLog(...)` 记录错误
        - **fallback**：`await hideHud()` → `await invoke("paste_text", { text: result.rawText })`
        - `isRecording.value = false`
        - `transitionTo("success", PASTE_SUCCESS_UNENHANCED_MESSAGE)`
    - **< 10 字**：维持现有直接贴上流程（不变）
  - [x]2.4 确保 `isRecording` 在所有新增的 exit path（AI 成功、AI fallback）都设为 false
  - [x]2.5 日志记录扩展：成功时 log `enhancementDurationMs`，fallback 时 log 原因

- [x] Task 3: 确认 HUD enhancing 状态显示正确 (AC: #6)
  - [x]3.1 确认 `NotchHud.vue` 的 `watch` 已处理 `'enhancing'` 状态（line 139：`nextStatus === "transcribing" || nextStatus === "enhancing"` → 显示 transcribing 动画）— **预期不需修改**，因为现有程式码已包含 enhancing case
  - [x]3.2 确认 `useVoiceFlowStore.transitionTo()` 已处理 `'enhancing'` 状态（line 127-138：`nextStatus === "enhancing"` → `showHud()`）— **预期不需修改**，因为现有程式码已包含 enhancing case
  - [x]3.3 若上述确认通过，此 Task 为验证性质，不需程式码修改

- [x] Task 4: 建立 enhancer.ts 单元测试 (AC: #1, #4, #5)
  - [x]4.1 建立 `tests/unit/enhancer.test.ts`
  - [x]4.2 Mock `@tauri-apps/plugin-http` 的 `fetch`
  - [x]4.3 测试正常流程：回传整理后文字
  - [x]4.4 测试空 API Key：抛出错误
  - [x]4.5 测试 API 回应为空 choices：回传原始文字
  - [x]4.6 测试 HTTP 非 200：抛出包含状态码的错误
  - [x]4.7 测试 timeout（5 秒）：抛出 AbortError 或逾时错误
  - [x]4.8 测试请求 body 格式正确（model、messages、temperature）

- [x] Task 5: 扩展 useVoiceFlowStore 单元测试 (AC: #2, #3, #4, #5)
  - [x]5.1 在 `tests/unit/use-voice-flow-store.test.ts` 新增测试案例
  - [x]5.2 Mock `enhanceText` from `lib/enhancer`
  - [x]5.3 测试 AI 整理正常流程（>= 10 字）：recording → transcribing → enhancing → paste enhanced text → success
  - [x]5.4 测试跳过 AI 整理（< 10 字）：recording → transcribing → paste raw text → success（无 enhancing 状态）
  - [x]5.5 测试 AI timeout fallback：recording → transcribing → enhancing → catch → paste raw text → success（"已贴上（未整理）"）
  - [x]5.6 测试 AI API 错误 fallback：recording → transcribing → enhancing → catch → paste raw text → success（"已贴上（未整理）"）

- [x] Task 6: 整合验证 (AC: #1-7)
  - [x]6.1 `pnpm exec vue-tsc --noEmit` 通过
  - [x]6.2 `pnpm test` 所有测试通过
  - [x]6.3 手动测试：说一段 >= 10 字的话 → HUD 显示 recording → transcribing → enhancing（整理中...）→ success（已贴上 ✓）→ 文字出现在游标位置，且为书面语
  - [x]6.4 手动测试：说一段 < 10 字的短句 → HUD 显示 recording → transcribing → success → 原始转录直接贴上，无 enhancing 阶段
  - [x]6.5 手动测试：断网时触发 AI 整理 → enhancing 后自动 fallback，HUD 显示「已贴上（未整理）」，原始文字贴入
  - [x]6.6 手动测试：端到端延迟（含 AI 整理）感知 < 3 秒
  - [x]6.7 手动测试：HUD 状态转换动画流畅，enhancing 与 transcribing 视觉一致

## Dev Notes

### 架构模式与约束

**Brownfield 专案** — 基于 Story 1.1-1.5（V2 基础架构、热键系统、API Key 储存、语音流程、HUD 状态）继续扩展。**注意**：Story 1.4 和 1.5 目前 `in-progress`，手动测试项尚未全部完成，但程式码已可用。

**本 Story 的核心架构变更：** 新增 `enhancer.ts` 服务模组 + 扩展 `useVoiceFlowStore` 的 `handleStopRecording()` 加入 AI 整理分支。

**依赖方向规则（严格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**禁止：**
- ❌ views/ 直接呼叫 lib/（必须透过 store）
- ❌ API Key 存入 SQLite（只用 tauri-plugin-store）
- ❌ 在元件中直接执行 SQL
- ❌ Store 中引入 Vue lifecycle hooks（onMounted 等）

### enhancer.ts 设计

**HTTP Client：** 使用 `@tauri-apps/plugin-http` 的 `fetch`（与 `transcriber.ts` 一致）。不使用浏览器原生 fetch，因为 Tauri 的 CSP 限制下，需要透过 plugin 进行外部 API 呼叫。

**Groq LLM API 格式：**
```typescript
// POST https://api.groq.com/openai/v1/chat/completions
{
  model: "llama-3.3-70b-versatile",
  messages: [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: rawText }
  ],
  temperature: 0.3,
  max_tokens: 2048
}
```

**注意 model 选择：** Groq 支援的模型会更新。`llama-3.3-70b-versatile` 是目前 Groq 上可用的高品质模型。若此模型不可用，替代选项为 `llama-3.1-70b-versatile` 或 `mixtral-8x7b-32768`。Story 2.2 会将 model 做成可配置项，本 Story 先硬编码。

**预设 System Prompt：**
```typescript
const DEFAULT_SYSTEM_PROMPT = `你是一个繁体中文文字整理助手。请将以下口语转录文字整理为通顺的书面语。

规则：
- 去除口语赘词（嗯、那个、就是、然后、其实、基本上等）
- 修正标点符号
- 适当重组句构使文字通顺
- 必要时适当分段
- 保持原始语意不变
- 不要添加原文没有的资讯
- 直接输出整理后的文字，不要加任何前缀说明`;
```

**Timeout 实作（AbortController）：**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), ENHANCEMENT_TIMEOUT_MS);

try {
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  // process response
} catch (error) {
  clearTimeout(timeoutId);
  if (error instanceof DOMException && error.name === "AbortError") {
    throw new Error("AI 整理逾时");
  }
  throw error;
}
```

**注意：** `@tauri-apps/plugin-http` 的 `fetch` 是否支援 `AbortController.signal` 需要实作时验证。若不支援，替代方案是用 `Promise.race` 搭配 timeout Promise：

```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("AI 整理逾时")), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
```

### useVoiceFlowStore 修改策略

**现有 handleStopRecording() 流程（简化版）：**
```
transcribeAudio() → result.rawText
  → if (!rawText) → error
  → hideHud() → paste_text(rawText) → success
```

**修改后流程：**
```
transcribeAudio() → result.rawText
  → if (!rawText) → error
  → if (rawText.length >= 10):
      → transitionTo("enhancing")
      → try: enhanceText(rawText, apiKey) → enhancedText
        → hideHud() → paste_text(enhancedText) → success
      → catch: (AI 失败 fallback)
        → hideHud() → paste_text(rawText) → success("已贴上（未整理）")
  → else (< 10 字):
      → hideHud() → paste_text(rawText) → success (维持现有行为)
```

**关键：AI 整理失败永远 fallback 到原始文字。** AI 整理是增值功能，失败不应阻塞核心语音输入流程。这是架构文件的设计决策（NFR13：LLM API timeout 降级）。

**isRecording 锁定注意：** 新增的 AI 整理分支中，`isRecording` 必须在 AI 成功和 AI fallback 两个路径都设为 `false`。这延续 Story 1.4 的 race condition 防护模式。

### NotchHud.vue 已支援 enhancing

**现有程式码确认（不需修改）：**

`NotchHud.vue` line 139：
```typescript
if (nextStatus === "transcribing" || nextStatus === "enhancing") {
  // → 显示 transcribing 动画（dots sliding window）
}
```

`useVoiceFlowStore.ts` line 127-131：
```typescript
if (
  nextStatus === "recording" ||
  nextStatus === "transcribing" ||
  nextStatus === "enhancing"
) {
  showHud();
}
```

`HudStatus` type（`types/index.ts`）已包含 `'enhancing'`。

因此 **HUD 的 enhancing 显示已预先实作完成**。本 Story 只需在 store 中正确 `transitionTo("enhancing")`，HUD 会自动以 transcribing 相同的动画显示。

### Groq API 呼叫模式（与 transcriber.ts 对比）

| 项目 | transcriber.ts（Whisper） | enhancer.ts（LLM） |
|------|--------------------------|-------------------|
| Endpoint | `/audio/transcriptions` | `/chat/completions` |
| Method | POST multipart/form-data | POST JSON |
| Model | `whisper-large-v3` | `llama-3.3-70b-versatile` |
| Content-Type | auto（FormData） | `application/json` |
| Timeout | 无特殊限制 | 5 秒（AbortController） |
| 失败策略 | 显示错误，使用者重试 | fallback 至原始文字 |
| HTTP Client | `@tauri-apps/plugin-http` fetch | `@tauri-apps/plugin-http` fetch |

### 测试策略

**enhancer.test.ts：** 单独测试 enhancer.ts 模组，mock `@tauri-apps/plugin-http` 的 fetch。

**use-voice-flow-store.test.ts：** 扩展现有测试，mock enhancer.ts 的 `enhanceText`。测试字数门槛分支逻辑和 fallback 行为。

**Mock 模式（延续现有专案惯例）：**
```typescript
vi.mock("../lib/enhancer", () => ({
  enhanceText: vi.fn(),
}));
```

### 跨 Story 注意事项

- **Story 2.2** 会将 `DEFAULT_SYSTEM_PROMPT` 改为可透过 `useSettingsStore` 配置。本 Story 先硬编码预设 prompt，设计上预留 `systemPrompt` 参数：`enhanceText(rawText, apiKey, systemPrompt?)` — 但 Story 2.1 scope 不做 optional 参数，直接用预设值。
- **Story 2.2** 会加入剪贴簿内容和词汇清单的上下文注入。本 Story 的 enhancer.ts 只传 rawText，不做上下文注入。
- **Story 4.1** 会在 success 后写入历史记录。本 Story 的 store 修改需要记录 `enhancementDurationMs` 供后续使用，但不在本 Story 写入 DB。可在 log 中记录此值。
- **Story 1.4/1.5** 目前 in-progress，部分手动测试未完成。本 Story 基于 1.4 的程式码结构继续扩展。

### 前一个 Story (1.4) 关键学习

- `handleStopRecording()` 的时序：`transitionTo("idle")` 或 `hideHud()` 先执行，让目标应用获得焦点，然后 `paste_text` 贴上
- `isRecording` 作为非同步流程锁，只在每个 exit path 才释放
- 错误处理模式：Service 层抛出有意义的错误 → Store 层 catch + 降级 + 使用者提示
- `@tauri-apps/plugin-http` 的 fetch 用法与浏览器原生 fetch 类似，但透过 Tauri 发送
- `writeInfoLog` / `writeErrorLog` 用于关键节点的 debug 日志

### 现有档案改动点

**新增档案：**
```
src/lib/enhancer.ts              — Groq LLM AI 文字整理服务模组
tests/unit/enhancer.test.ts      — enhancer.ts 单元测试
```

**修改档案：**
```
src/stores/useVoiceFlowStore.ts  — handleStopRecording() 加入 AI 整理分支
src/lib/errorUtils.ts            — 新增 getEnhancementErrorMessage()
tests/unit/use-voice-flow-store.test.ts — 新增 AI 整理相关测试案例
```

**不修改的档案（明确排除）：**
- `src/components/NotchHud.vue` — 已支援 enhancing 状态，不需修改
- `src/types/index.ts` — `HudStatus` 已包含 `'enhancing'`
- `src/types/events.ts` — `VoiceFlowStateChangedPayload` 已支援所有状态
- `src/lib/transcriber.ts` — 转录逻辑不变
- `src/lib/recorder.ts` — 录音逻辑不变
- `src/composables/useTauriEvents.ts` — 事件常数不变
- `src/stores/useSettingsStore.ts` — 设定 store 不变
- `src/App.vue` — HUD 入口不变
- `Cargo.toml` / `package.json` — 不需新增依赖

### 不需要的 Cargo/NPM 依赖变更

本 Story **不需要安装任何新依赖**。`@tauri-apps/plugin-http` 已在 Story 1.1 安装。所有需要的技术已在 Story 1.1-1.3 安装完毕。

### 安全规则提醒

- API Key 从 `useSettingsStore().getApiKey()` 取得，不硬编码
- API Key 不写入任何日志（`console.log` / `writeInfoLog` 不印 Key 值）
- API Key 不透过 Tauri Event 传播
- CSP `connect-src 'self' https://api.groq.com` 限制 API Key 只能传到 Groq
- AI 整理的 user message 内容不写入日志（可能包含敏感口述内容）

### 效能注意事项

- **E2E 目标（含 AI 整理）** — < 3 秒（从放开按键到文字出现在游标位置）
- **AI 整理 timeout** — 5 秒硬限制，超时 fallback 至原始文字
- **Groq LLM 延迟** — 通常 500ms-1500ms（依文字长度和模型负载）
- **HUD 状态转换** — < 100ms（Tauri Events 驱动）
- **剪贴簿操作延迟** — paste_text 内部有 200ms + 50ms 等待（总计 250ms）

### Git 历史分析

**最近 commit 模式：**
- `feat:` 前缀用于功能实作
- `fix:` 前缀用于 code review 后修复
- `docs:` 前缀用于 BMAD artifacts 更新

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 — Story 2.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns — 前端直接呼叫 Groq API]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Process Patterns 错误处理]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries — lib/ enhancer.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points — 核心语音流程（enhancer.ts 位置）]
- [Source: _bmad-output/planning-artifacts/prd.md#AI 文字整理 FR8-FR9, FR29]
- [Source: _bmad-output/planning-artifacts/prd.md#Performance NFR1, NFR3]
- [Source: _bmad-output/implementation-artifacts/1-4-voice-record-transcribe-paste.md — useVoiceFlowStore 完整实作]
- [Source: Codebase — src/stores/useVoiceFlowStore.ts（扩展目标）]
- [Source: Codebase — src/lib/transcriber.ts（API 呼叫模式参考）]
- [Source: Codebase — src/lib/errorUtils.ts（错误处理模式参考）]
- [Source: Codebase — src/components/NotchHud.vue（enhancing 状态已支援确认）]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 94 tests passed

### Completion Notes List

- enhancer.ts 建立完成（enhanceText + buildSystemPrompt + withTimeout）
- useVoiceFlowStore AI 整理分支（10 字门槛、5 秒 timeout、fallback）
- HUD enhancing 状态显示确认正常
- errorUtils 新增 getEnhancementErrorMessage

### Change Log

- Story 2.1 完整实作 — Groq LLM AI 文字整理核心流程

### File List

- src/lib/enhancer.ts (new)
- src/lib/errorUtils.ts
- src/stores/useVoiceFlowStore.ts
- tests/unit/enhancer.test.ts (new)
- tests/unit/use-voice-flow-store.test.ts
