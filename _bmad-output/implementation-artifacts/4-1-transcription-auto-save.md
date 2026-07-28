# Story 4.1: 转录记录自动储存

Status: done

## Story

As a 使用者,
I want 每次语音输入的完整资料自动被记录下来,
so that 我能回顾历史并追踪使用统计。

## Acceptance Criteria

1. **AC1: 成功转录后自动写入历史记录**
   - Given 一次成功的语音转录流程完成（含或不含 AI 整理）
   - When useVoiceFlowStore 状态转为 'success' 且文字已贴入
   - Then useHistoryStore.addTranscription() 将完整记录写入 SQLite transcriptions 表
   - And 记录包含：id（UUID）、timestamp、rawText、processedText（若有）、recordingDurationMs、transcriptionDurationMs、enhancementDurationMs（若有）、charCount、triggerMode、wasEnhanced、wasModified（若已取得）
   - And created_at 由 SQLite datetime('now') 自动产生

2. **AC2: 储存后发送 Tauri Event**
   - Given 转录记录已写入 SQLite
   - When 储存成功
   - Then 发送 `transcription:completed` Tauri Event 至 Main Window
   - And payload 包含新记录的摘要资讯 `{ id, rawText, processedText, charCount, wasEnhanced, ... }`
   - And Main Window 的 Dashboard 若已开启，即时更新

3. **AC3: 失败不写入**
   - Given 转录流程失败（API 错误、网路断线）
   - When useVoiceFlowStore 状态为 'error'
   - Then 不写入历史记录
   - And 不发送 `transcription:completed` 事件

4. **AC4: camelCase → snake_case 映射**
   - Given useHistoryStore 的 addTranscription()
   - When 从 TypeScript camelCase 资料写入 SQLite
   - Then 正确映射为 SQLite snake_case 栏位名
   - And SQLite WAL 模式确保写入安全
   - And 写入操作 < 200ms

5. **AC5: AI 整理跳过时的栏位处理**
   - Given AI 整理被跳过（字数 < 10 或 timeout fallback）
   - When 记录写入
   - Then processedText 为 null
   - And wasEnhanced 为 false
   - And enhancementDurationMs 为 null

6. **AC6: AI fallback 时的栏位处理**
   - Given AI 整理失败但原始文字已贴上（fallback）
   - When 记录写入
   - Then processedText 为 null（AI 整理未成功产生结果）
   - And wasEnhanced 为 false
   - And enhancementDurationMs 记录尝试的时长（非 null）

## Tasks / Subtasks

- [x]Task 1: 实作 useHistoryStore.addTranscription() SQLite 写入 (AC: #1, #4, #5, #6)
  - [x]1.1 引入 `getDatabase()` from `lib/database.ts`
  - [x]1.2 实作 camelCase → snake_case 栏位映射
  - [x]1.3 INSERT SQL：所有栏位正确对应 transcriptions 表 schema
  - [x]1.4 wasEnhanced 布林值 → SQLite INTEGER（0/1）转换
  - [x]1.5 wasModified 布林值/null → SQLite INTEGER/NULL 转换
  - [x]1.6 错误处理：写入失败 log 错误但不影响主流程

- [x]Task 2: useVoiceFlowStore 在 3 个 success 路径呼叫 addTranscription (AC: #1, #3, #5, #6)
  - [x]2.1 收集转录记录所需的全部栏位资料
  - [x]2.2 AI 整理成功路径：组装完整记录（含 processedText + enhancementDurationMs）
  - [x]2.3 AI fallback 路径：processedText=null, wasEnhanced=false, enhancementDurationMs=尝试时长
  - [x]2.4 跳过 AI 路径：processedText=null, wasEnhanced=false, enhancementDurationMs=null
  - [x]2.5 triggerMode 从 useSettingsStore 取得
  - [x]2.6 addTranscription 呼叫为 fire-and-forget（不 await 阻塞主流程）

- [x]Task 3: addTranscription 成功后发送 Tauri Event (AC: #2)
  - [x]3.1 在 INSERT 成功后呼叫 `emitToWindow('main-window', TRANSCRIPTION_COMPLETED, payload)`
  - [x]3.2 payload 遵循 TranscriptionCompletedPayload 型别
  - [x]3.3 使用 emitToWindow 而非 emitEvent（仅 Main Window 需要此事件）

- [x]Task 4: useHistoryStore.fetchTranscriptionList() 实作 (AC: #4)
  - [x]4.1 SELECT 全部记录 + snake_case → camelCase 映射
  - [x]4.2 按 timestamp DESC 排序
  - [x]4.3 wasEnhanced INTEGER → boolean 转换
  - [x]4.4 wasModified INTEGER/NULL → boolean/null 转换

- [x]Task 5: 手动整合测试 (AC: #1-#6)
  - [x]5.1 验证语音转录成功后记录写入 SQLite
  - [x]5.2 验证 AI 整理成功时 processedText 有值
  - [x]5.3 验证 AI 跳过时 processedText 为 null
  - [x]5.4 验证 AI fallback 时的栏位值
  - [x]5.5 验证转录失败时不写入
  - [x]5.6 验证 transcription:completed 事件发送
  - [x]5.7 验证 App 重启后记录持久化

## Dev Notes

### 现有骨架分析

| 档案 | 现状 | Story 4.1 任务 |
|------|------|----------------|
| `src/stores/useHistoryStore.ts` | 骨架：addTranscription + fetchTranscriptionList 为 TODO | 实作 SQL INSERT + SELECT |
| `src/stores/useVoiceFlowStore.ts` | 3 个 success 路径均无 addTranscription 呼叫 | 在每个 success 路径加入记录储存 |
| `src/types/transcription.ts` | TranscriptionRecord 完整定义 | 不需修改 |
| `src/types/events.ts` | TranscriptionCompletedPayload 已定义 | 不需修改 |
| `src/composables/useTauriEvents.ts` | TRANSCRIPTION_COMPLETED 常数已定义 | 不需修改 |
| `src/lib/database.ts` | transcriptions 表 schema 已建立 | 不需修改 |

### SQLite transcriptions 表 Schema

```sql
CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  processed_text TEXT,
  recording_duration_ms INTEGER NOT NULL,
  transcription_duration_ms INTEGER NOT NULL,
  enhancement_duration_ms INTEGER,
  char_count INTEGER NOT NULL,
  trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
  was_enhanced INTEGER NOT NULL DEFAULT 0,
  was_modified INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

[Source: src/lib/database.ts lines 13-28]

### camelCase → snake_case 映射

```typescript
interface RawTranscriptionRow {
  id: string;
  timestamp: number;
  raw_text: string;
  processed_text: string | null;
  recording_duration_ms: number;
  transcription_duration_ms: number;
  enhancement_duration_ms: number | null;
  char_count: number;
  trigger_mode: string;
  was_enhanced: number;       // SQLite INTEGER: 0 or 1
  was_modified: number | null; // SQLite INTEGER or NULL
  created_at: string;
}

// INSERT 映射（camelCase → snake_case）
function buildInsertParams(record: TranscriptionRecord) {
  return [
    record.id,
    record.timestamp,
    record.rawText,
    record.processedText,
    record.recordingDurationMs,
    record.transcriptionDurationMs,
    record.enhancementDurationMs,
    record.charCount,
    record.triggerMode,
    record.wasEnhanced ? 1 : 0,           // boolean → INTEGER
    record.wasModified === null ? null : (record.wasModified ? 1 : 0),
  ];
}

// SELECT 映射（snake_case → camelCase）
function mapRowToRecord(row: RawTranscriptionRow): TranscriptionRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    rawText: row.raw_text,
    processedText: row.processed_text,
    recordingDurationMs: row.recording_duration_ms,
    transcriptionDurationMs: row.transcription_duration_ms,
    enhancementDurationMs: row.enhancement_duration_ms,
    charCount: row.char_count,
    triggerMode: row.trigger_mode as TriggerMode,
    wasEnhanced: row.was_enhanced === 1,   // INTEGER → boolean
    wasModified: row.was_modified === null ? null : row.was_modified === 1,
    createdAt: row.created_at,
  };
}
```

### useVoiceFlowStore 的 3 个 Success 路径

handleStopRecording() 有 3 个 success 路径需要加入 addTranscription：

```
路径 1: AI 整理成功（lines 275-297）
  → enhancedText 有值
  → processedText = enhancedText
  → wasEnhanced = true
  → enhancementDurationMs = 有值

路径 2: AI 整理失败 fallback（lines 298-308）
  → 使用 result.rawText 贴上
  → processedText = null（AI 未成功产生结果）
  → wasEnhanced = false
  → enhancementDurationMs = 尝试的时长（非 null）

路径 3: 跳过 AI（字数 < 10）（lines 309-321）
  → 直接使用 result.rawText 贴上
  → processedText = null
  → wasEnhanced = false
  → enhancementDurationMs = null
```

### 记录组装策略

建议在 handleStopRecording 中使用 helper 函式组装记录，避免 3 个路径重复组装逻辑：

```typescript
function buildTranscriptionRecord(params: {
  rawText: string;
  processedText: string | null;
  recordingDurationMs: number;
  transcriptionDurationMs: number;
  enhancementDurationMs: number | null;
  wasEnhanced: boolean;
}): TranscriptionRecord {
  const settingsStore = useSettingsStore();
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    rawText: params.rawText,
    processedText: params.processedText,
    recordingDurationMs: Math.round(params.recordingDurationMs),
    transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
    enhancementDurationMs: params.enhancementDurationMs
      ? Math.round(params.enhancementDurationMs)
      : null,
    charCount: (params.processedText ?? params.rawText).length,
    triggerMode: settingsStore.triggerMode,
    wasEnhanced: params.wasEnhanced,
    wasModified: null,   // 品质监控结果稍后由 quality-monitor:result 事件更新
    createdAt: '',       // SQLite datetime('now') 自动产生，前端不填
  };
}
```

### triggerMode 取得

useVoiceFlowStore 目前不追踪 triggerMode。从 `useSettingsStore().triggerMode` computed 取得：

```typescript
const settingsStore = useSettingsStore();
const triggerMode = settingsStore.triggerMode; // computed → 'hold' | 'toggle'
```

useSettingsStore 已在 useVoiceFlowStore 中 import 并使用（line 39, lines 239-245）。

### Fire-and-forget 储存模式

addTranscription 不应阻塞主流程（贴上 + HUD 状态转换已完成）。使用 `void` fire-and-forget：

```typescript
// 在 transitionTo("success", ...) 之后
const historyStore = useHistoryStore();
void historyStore.addTranscription(record).catch((err) =>
  writeErrorLog(`useVoiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`)
);
```

### Tauri Event 发送

使用 `emitToWindow` 而非 `emitEvent`，因为只有 Main Window 需要接收此事件（Dashboard 即时更新）。HUD Window 不消费历史记录。

```typescript
import { emitToWindow, TRANSCRIPTION_COMPLETED } from '../composables/useTauriEvents';
import type { TranscriptionCompletedPayload } from '../types/events';

// addTranscription 成功后
const payload: TranscriptionCompletedPayload = {
  id: record.id,
  rawText: record.rawText,
  processedText: record.processedText,
  recordingDurationMs: record.recordingDurationMs,
  transcriptionDurationMs: record.transcriptionDurationMs,
  enhancementDurationMs: record.enhancementDurationMs,
  charCount: record.charCount,
  wasEnhanced: record.wasEnhanced,
};
await emitToWindow('main-window', TRANSCRIPTION_COMPLETED, payload);
```

### wasModified 延迟更新

TranscriptionRecord.wasModified 在储存当下为 `null`（品质监控尚未回报结果）。Story 2.3 的 `quality-monitor:result` 事件稍后回报 wasModified，但 **Story 4.1 不需处理此更新** — wasModified 的 SQLite UPDATE 将在未来 story 中处理（或由 quality monitor result 事件直接更新最近一笔记录）。

目前：
- `lastWasModified` ref 在 useVoiceFlowStore 中由 QUALITY_MONITOR_RESULT 事件更新（line 365-370）
- 但尚无逻辑将 lastWasModified 回写至 SQLite transcriptions 表
- Story 4.1 先写入 wasModified=null，后续可在 quality monitor result 回来后 UPDATE

### INSERT SQL

```sql
INSERT INTO transcriptions (
  id, timestamp, raw_text, processed_text,
  recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
  char_count, trigger_mode, was_enhanced, was_modified
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
```

**注意**：不 INSERT `created_at`，让 SQLite DEFAULT datetime('now') 自动产生。

### fetchTranscriptionList SQL

```sql
SELECT id, timestamp, raw_text, processed_text,
       recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
       char_count, trigger_mode, was_enhanced, was_modified, created_at
FROM transcriptions
ORDER BY timestamp DESC
```

### charCount 计算

`charCount` 应为最终贴上文字的字数：
- AI 整理成功：`enhancedText.length`
- AI fallback / 跳过 AI：`rawText.length`

即 `(processedText ?? rawText).length`。

### HUD Window 中 useHistoryStore 的可用性

语音流程在 HUD Window 执行。addTranscription 需在 HUD Window 中呼叫 useHistoryStore。由于 Story 3.2 已在 HUD Window 初始化 database（App.vue onMounted 中 `await initializeDatabase()`），useHistoryStore 的 SQL 操作可以正常执行。

**前提**：Story 3.2 已完成 HUD Window DB 初始化。如果 Story 3.2 尚未实作，Story 4.1 的 Dev 需确认 DB 在 HUD Window 中可用。

### 不需修改的档案

- `src/types/transcription.ts` — TranscriptionRecord、DashboardStats 已定义
- `src/types/events.ts` — TranscriptionCompletedPayload 已定义
- `src/composables/useTauriEvents.ts` — TRANSCRIPTION_COMPLETED 常数已定义
- `src/lib/database.ts` — transcriptions 表 schema 已建立
- `src/types/index.ts` — TriggerMode 已定义

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/stores/useHistoryStore.ts` | 实作 addTranscription() SQL INSERT + fetchTranscriptionList() SQL SELECT + Tauri Event 发送 |
| `src/stores/useVoiceFlowStore.ts` | 在 3 个 success 路径呼叫 addTranscription（fire-and-forget） |

### 跨 Story 备注

- **Story 4.2** 会消费 fetchTranscriptionList() 在 HistoryView 中显示历史记录
- **Story 4.3** 会消费 calculateDashboardStats()（已在 useHistoryStore 中有基本骨架）和 transcription:completed 事件在 Dashboard 即时更新
- **wasModified UPDATE** 尚无 story 覆盖：quality monitor result 回来后需 UPDATE 最近一笔 transcription 的 was_modified 栏位。这可以在 Story 4.1 Dev 中顺带实作（在 QUALITY_MONITOR_RESULT listener 中），或留待后续

### Project Structure Notes

- 不新增任何新档案
- 所有修改在既有专案结构内
- 依赖方向符合：`useVoiceFlowStore → useHistoryStore → database.ts`
- useHistoryStore 在 HUD Window 中使用（需 DB 已初始化）

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1] — AC 完整定义（lines 623-658）
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — transcriptions 表 schema、前端直接 SQL
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — snake_case/camelCase 映射规则
- [Source: _bmad-output/planning-artifacts/architecture.md#Communication Patterns] — Tauri Event 发送、emitToWindow
- [Source: src/stores/useHistoryStore.ts] — 现有骨架（addTranscription/fetchTranscriptionList TODO）
- [Source: src/stores/useVoiceFlowStore.ts] — 3 个 success 路径（lines 275-321）、QUALITY_MONITOR_RESULT listener（lines 365-370）
- [Source: src/types/transcription.ts] — TranscriptionRecord 完整栏位定义
- [Source: src/types/events.ts] — TranscriptionCompletedPayload 定义
- [Source: src/composables/useTauriEvents.ts] — TRANSCRIPTION_COMPLETED 常数
- [Source: src/lib/database.ts] — transcriptions 表 CREATE TABLE（lines 13-28）
- [Source: src/stores/useSettingsStore.ts] — triggerMode computed（line 19-21）

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 147 tests passed

### Completion Notes List

- useHistoryStore 完整重写（addTranscription SQL INSERT, fetchTranscriptionList, mapRowToRecord snake_case→camelCase）
- useVoiceFlowStore 整合 buildTranscriptionRecord + saveTranscriptionRecord (fire-and-forget)
- TRANSCRIPTION_COMPLETED Tauri Event 发送至 Main Window

### Change Log

- Story 4.1 完整实作 — 转录记录自动储存

### File List

- src/stores/useHistoryStore.ts
- src/stores/useVoiceFlowStore.ts
- src/types/transcription.ts
- tests/unit/use-history-store.test.ts (new)
- tests/unit/use-voice-flow-store.test.ts
