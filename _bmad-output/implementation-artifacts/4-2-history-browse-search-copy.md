# Story 4.2: 历史记录浏览、搜寻与复制

Status: done

## Story

As a 使用者,
I want 浏览、搜寻和复制我的历史转录记录,
so that 我能找回之前说过的内容并重新使用。

## Acceptance Criteria

1. **AC1: 历史记录列表显示**
   - Given Main Window 的历史页面（HistoryView.vue）
   - When 使用者开启历史页面
   - Then 显示转录记录列表，按时间倒序排列（最新在上）
   - And 每笔记录显示：时间戳、文字预览（前 50 字截断）、录音时长、是否经 AI 整理标记
   - And 记录列表支援无限卷动或分页载入

2. **AC2: 记录展开与详细资讯**
   - Given 历史记录列表
   - When 使用者点击某笔记录
   - Then 展开显示完整文字内容
   - And 若有 AI 整理，同时显示原始文字和整理后文字
   - And 显示详细资讯（录音时长、转录耗时、AI 整理耗时、字数、触发模式）

3. **AC3: 全文搜寻**
   - Given 历史页面顶部搜寻框
   - When 使用者输入搜寻关键字
   - Then 对 rawText 和 processedText 栏位执行全文搜寻
   - And 即时过滤显示符合的记录
   - And 搜寻回应 < 200ms
   - And 搜寻框为空时显示全部记录

4. **AC4: 复制功能**
   - Given 历史记录展开状态
   - When 使用者点击复制按钮
   - Then 将整理后文字（processedText）复制到剪贴簿
   - And 若无整理后文字，复制原始文字（rawText）
   - And 显示短暂的「已复制」回馈提示

5. **AC5: 空状态**
   - Given 历史记录为空
   - When 使用者开启历史页面
   - Then 显示空状态提示（如「尚无转录记录，开始使用语音输入吧！」）

6. **AC6: 即时更新**
   - Given 历史页面已开启
   - When HUD Window 完成一次新的转录
   - Then Main Window 收到 `transcription:completed` 事件
   - And 历史列表自动在顶部插入新记录（无需手动重新整理）

## Tasks / Subtasks

- [x]Task 1: 扩展 useHistoryStore 搜寻与分页功能 (AC: #1, #3)
  - [x]1.1 新增 searchQuery ref 和 searchTranscriptionList(query, limit, offset) 方法
  - [x]1.2 SQL 搜寻查询：WHERE raw_text LIKE '%keyword%' OR processed_text LIKE '%keyword%'
  - [x]1.3 分页参数：LIMIT + OFFSET，预设每页 20 笔
  - [x]1.4 新增 hasMore ref 追踪是否有更多记录
  - [x]1.5 新增 loadMore() 方法载入下一页
  - [x]1.6 新增 resetAndFetch() 重置分页并重新载入

- [x]Task 2: 实作 HistoryView.vue 列表与搜寻 UI (AC: #1, #3, #5)
  - [x]2.1 搜寻框：顶部 input，v-model 绑定搜寻关键字，debounce 300ms
  - [x]2.2 记录列表：v-for 渲染 transcriptionList，卡片式布局
  - [x]2.3 每笔摘要显示：formatTimestamp、truncateText(50)、formatDuration、AI 整理标记
  - [x]2.4 空状态：搜寻无结果 vs 完全无记录，两种不同提示
  - [x]2.5 载入状态：isLoading 时显示 loading 提示
  - [x]2.6 无限卷动：IntersectionObserver 侦测列表底部 sentinel 元素

- [x]Task 3: 实作记录展开与详细资讯 (AC: #2)
  - [x]3.1 expandedRecordId ref 追踪目前展开的记录 ID
  - [x]3.2 点击记录 toggle 展开/收起
  - [x]3.3 展开区域显示完整原始文字
  - [x]3.4 若 wasEnhanced 且 processedText 有值，同时显示整理后文字
  - [x]3.5 详细资讯区：录音时长、转录耗时、AI 整理耗时、字数、触发模式

- [x]Task 4: 实作复制功能 (AC: #4)
  - [x]4.1 复制按钮放在展开区域
  - [x]4.2 复制逻辑：processedText ?? rawText
  - [x]4.3 navigator.clipboard.writeText() 写入剪贴簿
  - [x]4.4 「已复制」回馈提示（2.5 秒后自动消失）
  - [x]4.5 copiedRecordId ref 追踪刚复制的记录 ID（用于按钮视觉回馈）

- [x]Task 5: 实作即时更新与手动测试 (AC: #6, #1-#5)
  - [x]5.1 onMounted 监听 TRANSCRIPTION_COMPLETED 事件
  - [x]5.2 收到事件后在列表顶部插入新记录（或 resetAndFetch 重新载入）
  - [x]5.3 onBeforeUnmount 清理事件监听
  - [x]5.4 手动测试：验证列表显示、搜寻过滤、展开详细、复制功能、空状态、即时更新

## Dev Notes

### 现有骨架分析

| 档案 | 现状 | Story 4.2 任务 |
|------|------|----------------|
| `src/views/HistoryView.vue` | 空 placeholder（仅 title + subtitle） | 实作完整历史记录页面 |
| `src/stores/useHistoryStore.ts` | fetchTranscriptionList() 为 TODO（Story 4.1 实作基本版） | 扩展搜寻 + 分页功能 |
| `src/types/transcription.ts` | TranscriptionRecord 完整定义 | 不需修改 |
| `src/types/events.ts` | TranscriptionCompletedPayload 已定义 | 不需修改 |
| `src/composables/useTauriEvents.ts` | TRANSCRIPTION_COMPLETED 常数已定义 | 不需修改 |
| `src/lib/database.ts` | idx_transcriptions_timestamp 索引已建立 | 不需修改 |
| `src/router.ts` | /history 路由已注册 | 不需修改 |

### 依赖 Story 4.1 的前提

Story 4.2 假设 Story 4.1 已完成以下实作：
- `useHistoryStore.addTranscription()` — SQL INSERT 完成
- `useHistoryStore.fetchTranscriptionList()` — 基本 SQL SELECT + snake_case→camelCase 映射
- `RawTranscriptionRow` interface 和 `mapRowToRecord()` helper（已在 Story 4.1 Dev Notes 中定义）
- HUD Window 中 DB 初始化（Story 3.2 前提）

如果 Story 4.1 的 fetchTranscriptionList() 已含分页/搜寻，则 Task 1 范围缩小。如果 Story 4.1 只实作了基本 SELECT ALL，则 Task 1 需要扩展。

### useHistoryStore 搜寻与分页扩展

Story 4.1 建立的 fetchTranscriptionList() 预计为基本版（SELECT ALL + ORDER BY）。Story 4.2 需要扩展为支援搜寻和分页：

```typescript
const PAGE_SIZE = 20;
const searchQuery = ref("");
const hasMore = ref(true);
const currentOffset = ref(0);

async function searchTranscriptionList(query: string, limit = PAGE_SIZE, offset = 0): Promise<TranscriptionRecord[]> {
  const db = getDatabase();
  let rows: RawTranscriptionRow[];

  if (query.trim()) {
    const pattern = `%${query.trim()}%`;
    rows = await db.select<RawTranscriptionRow[]>(
      `SELECT id, timestamp, raw_text, processed_text,
              recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
              char_count, trigger_mode, was_enhanced, was_modified, created_at
       FROM transcriptions
       WHERE raw_text LIKE $1 OR processed_text LIKE $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset]
    );
  } else {
    rows = await db.select<RawTranscriptionRow[]>(
      `SELECT id, timestamp, raw_text, processed_text,
              recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
              char_count, trigger_mode, was_enhanced, was_modified, created_at
       FROM transcriptions
       ORDER BY timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  return rows.map(mapRowToRecord);
}

async function resetAndFetch() {
  currentOffset.value = 0;
  hasMore.value = true;
  const results = await searchTranscriptionList(searchQuery.value, PAGE_SIZE, 0);
  transcriptionList.value = results;
  currentOffset.value = results.length;
  hasMore.value = results.length >= PAGE_SIZE;
}

async function loadMore() {
  if (!hasMore.value || isLoading.value) return;
  isLoading.value = true;
  try {
    const results = await searchTranscriptionList(searchQuery.value, PAGE_SIZE, currentOffset.value);
    transcriptionList.value.push(...results);
    currentOffset.value += results.length;
    hasMore.value = results.length >= PAGE_SIZE;
  } finally {
    isLoading.value = false;
  }
}
```

**注意**：`mapRowToRecord` 函式已在 Story 4.1 中定义（snake_case → camelCase + boolean 转换）。直接使用即可。

### SQLite 搜寻效能

- LIKE '%keyword%' 无法使用索引（前置 wildcard），但 transcriptions 表为个人使用（预期 < 10,000 笔），LIKE 效能足够
- idx_transcriptions_timestamp 索引仍可协助 ORDER BY timestamp DESC 排序
- 如果未来需要真正的全文搜寻，可考虑 SQLite FTS5 extension，但 POC 阶段不需要
- NFR 要求：搜寻回应 < 200ms，LIKE 查询在万笔量级下可达成

### 无限卷动实作模式

使用 IntersectionObserver 侦测 sentinel 元素进入视口：

```typescript
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && historyStore.hasMore && !historyStore.isLoading) {
        historyStore.loadMore();
      }
    },
    { threshold: 0.1 }
  );
  if (sentinelRef.value) {
    observer.observe(sentinelRef.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
```

Template 中在列表底部放置 sentinel：

```html
<div ref="sentinelRef" class="h-4" />
```

### 搜寻 Debounce 模式

使用手动 setTimeout debounce（不引入新依赖）：

```typescript
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const SEARCH_DEBOUNCE_MS = 300;

function handleSearchInput(query: string) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    historyStore.searchQuery = query;
    historyStore.resetAndFetch();
  }, SEARCH_DEBOUNCE_MS);
}
```

### 记录展开/收起模式

使用单一 expandedRecordId ref 追踪展开的记录（一次只展开一笔）：

```typescript
const expandedRecordId = ref<string | null>(null);

function toggleExpand(recordId: string) {
  expandedRecordId.value = expandedRecordId.value === recordId ? null : recordId;
}
```

### 复制功能

```typescript
const copiedRecordId = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function handleCopyText(record: TranscriptionRecord) {
  const textToCopy = record.processedText ?? record.rawText;
  await navigator.clipboard.writeText(textToCopy);

  if (copiedTimer) clearTimeout(copiedTimer);
  copiedRecordId.value = record.id;
  copiedTimer = setTimeout(() => {
    copiedRecordId.value = null;
  }, 2500);
}
```

### 即时更新（TRANSCRIPTION_COMPLETED 事件）

HistoryView 需监听 `transcription:completed` 事件，在新转录完成时更新列表：

```typescript
import { listenToEvent, TRANSCRIPTION_COMPLETED } from '../composables/useTauriEvents';
import type { TranscriptionCompletedPayload } from '../types/events';
import type { UnlistenFn } from '@tauri-apps/api/event';

let unlistenTranscriptionCompleted: UnlistenFn | null = null;

onMounted(async () => {
  // 初始载入
  await historyStore.resetAndFetch();

  // 监听新转录事件
  unlistenTranscriptionCompleted = await listenToEvent<TranscriptionCompletedPayload>(
    TRANSCRIPTION_COMPLETED,
    () => {
      // 收到新转录事件，重新载入列表以确保资料完整（从 DB 读取含 createdAt 等完整栏位）
      historyStore.resetAndFetch();
    }
  );
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
});
```

**注意**：TranscriptionCompletedPayload 是 Pick 型别，不包含全部 TranscriptionRecord 栏位（缺少 triggerMode、wasModified、createdAt），因此收到事件后选择 resetAndFetch() 从 DB 重新载入完整记录，而非直接用 payload 构建 TranscriptionRecord 插入列表。

### 时间格式化 Helper

```typescript
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function truncateText(text: string, maxLength = 50): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
```

### UI 设计参考

遵循既有 UI 模式（DictionaryView.vue 和 SettingsView.vue）：

- **容器**：`rounded-xl border border-zinc-700 bg-zinc-900 p-5`
- **页面标题**：`text-2xl font-bold text-white` + `text-zinc-400` 副标题
- **输入框**：`rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500`
- **按钮（主要）**：`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500`
- **标记徽章**：`rounded-full bg-{color}-500/20 px-2 py-0.5 text-xs font-medium text-{color}-400`
- **空状态**：`rounded-lg border border-dashed border-zinc-600 px-4 py-8 text-center text-zinc-400`
- **回馈讯息**：`text-sm text-green-400`（成功）/ `text-sm text-red-400`（错误），搭配 transition fade
- **载入状态**：`text-center text-zinc-400`
- **卡片 hover**：`transition hover:bg-zinc-800/50`

### 记录卡片布局建议

```
┌─────────────────────────────────────────────┐
│ 2026-03-03 14:30    [AI 整理]    3.2 秒     │  ← 摘要行
│ 这是一段转录文字的前五十个字截断预览...     │  ← 预览行
│                                              │
│ ▼ 展开后                                     │
│ ┌──────────────────────────────────────────┐ │
│ │ 整理后文字：                              │ │
│ │ （完整的 processedText 内容）             │ │
│ ├──────────────────────────────────────────┤ │
│ │ 原始文字：                                │ │
│ │ （完整的 rawText 内容）                   │ │
│ ├──────────────────────────────────────────┤ │
│ │ 录音：3.2s  转录：1.1s  AI：0.8s        │ │
│ │ 字数：156   模式：hold                    │ │
│ │              [复制]                        │ │
│ └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 不需修改的档案

- `src/types/transcription.ts` — TranscriptionRecord 已定义
- `src/types/events.ts` — TranscriptionCompletedPayload 已定义
- `src/composables/useTauriEvents.ts` — 事件常数已定义
- `src/lib/database.ts` — schema 和索引已建立
- `src/router.ts` — /history 路由已注册
- `src/MainApp.vue` — sidebar 导航已包含历史记录

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/stores/useHistoryStore.ts` | 扩展搜寻 + 分页功能（searchTranscriptionList, resetAndFetch, loadMore, searchQuery, hasMore, currentOffset） |
| `src/views/HistoryView.vue` | 从 placeholder 实作为完整页面（搜寻框、记录列表、展开详细、复制、空状态、无限卷动、即时更新） |

### 跨 Story 备注

- **Story 4.1** 是前提：提供 addTranscription + 基本 fetchTranscriptionList + mapRowToRecord
- **Story 4.3** 会使用 useHistoryStore.calculateDashboardStats() 和 transcription:completed 事件
- 本 Story 新增的 searchTranscriptionList 和分页 API 只在 HistoryView 使用，不影响其他消费者
- mapRowToRecord 是 Story 4.1 建立的共用 helper，本 Story 直接使用

### Project Structure Notes

- 不新增任何新档案
- 所有修改在既有专案结构内
- HistoryView.vue 是 Main Window 页面，只在 Main Window 中渲染
- 路由已在 router.ts 中注册，无需修改

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — AC 完整定义（lines 660-696）
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — 前端直接 SQL、SQLite WAL
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — Tauri Events 跨视窗同步、Pinia stores 结构
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR] — SQLite 查询 < 200ms
- [Source: _bmad-output/implementation-artifacts/4-1-transcription-auto-save.md] — 前一 Story：SQL 映射、fetchTranscriptionList 骨架、TranscriptionCompletedPayload 定义
- [Source: src/stores/useHistoryStore.ts] — 现有骨架（fetchTranscriptionList TODO）
- [Source: src/views/HistoryView.vue] — 空 placeholder
- [Source: src/views/DictionaryView.vue] — UI 设计参考（section cards、feedback、empty state、table）
- [Source: src/views/SettingsView.vue] — UI 设计参考（input 样式、按钮样式、feedback transition）
- [Source: src/types/transcription.ts] — TranscriptionRecord 完整栏位
- [Source: src/types/events.ts] — TranscriptionCompletedPayload
- [Source: src/composables/useTauriEvents.ts] — TRANSCRIPTION_COMPLETED、listenToEvent
- [Source: src/lib/database.ts] — transcriptions 表 schema + 索引（timestamp DESC）
- [Source: src/router.ts] — /history 路由已注册

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 160 tests passed

### Completion Notes List

- useHistoryStore 新增 searchTranscriptionList (LIKE + pagination) + resetAndFetch + loadMore
- HistoryView 完整重写（search debounce 300ms, record list expand/collapse, copy clipboard, IntersectionObserver infinite scroll, transcription:completed event-driven updates）

### Change Log

- Story 4.2 完整实作 — 历史记录浏览、搜寻与复制

### File List

- src/stores/useHistoryStore.ts
- src/views/HistoryView.vue
- src/lib/formatUtils.ts (new, shared with DashboardView)
- tests/unit/use-history-store.test.ts
