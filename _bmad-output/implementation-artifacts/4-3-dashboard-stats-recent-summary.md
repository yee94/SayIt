# Story 4.3: Dashboard 统计与最近转录摘要

Status: done

## Story

As a 使用者,
I want 在 Dashboard 看到使用统计和最近的转录摘要,
so that 我能量化语音输入带来的效率增益并快速回顾最近的使用。

## Acceptance Criteria

1. **AC1: 6 张统计卡片**
   - Given Main Window 的 Dashboard 页面（DashboardView.vue）
   - When 使用者开启 Dashboard
   - Then 显示 6 张统计卡片，资料从 useHistoryStore.calculateDashboardStats() 计算
   - And 所有统计查询回应 < 200ms

2. **AC2: 统计计算逻辑**
   - Given Dashboard 统计卡片
   - When 计算统计数据
   - Then 「总口述时间」= sum(recordingDurationMs) 转为小时/分钟显示
   - And 「口述字数」= sum(charCount)
   - And 「平均口述速度」= total_chars / total_recording_duration（字/分钟）
   - And 「节省时间」= total_chars / 40（假设平均打字速度 40 字/分钟）转为小时/分钟
   - And 「总使用次数」= count(records)
   - And 「AI 整理使用率」= count(wasEnhanced=true) / count(total) 显示为百分比

3. **AC3: 最近 10 笔转录摘要**
   - Given Dashboard 页面统计卡片下方
   - When Dashboard 载入
   - Then 显示最近 10 笔转录摘要列表
   - And 每笔显示：时间戳、文字前 50 字截断、是否经 AI 整理
   - And 点击可跳转至历史页面对应记录

4. **AC4: 空状态**
   - Given 无任何历史记录
   - When Dashboard 页面载入
   - Then 统计卡片显示初始值（0 小时、0 字、0 次等）
   - And 最近转录列表显示空状态提示

5. **AC5: 即时更新**
   - Given 新的转录记录完成
   - When Main Window 收到 `transcription:completed` Tauri Event
   - Then Dashboard 统计数据自动重新计算并更新
   - And 最近转录列表自动新增该笔记录至顶部
   - And 无需手动重新整理页面

## Tasks / Subtasks

- [x] Task 1: 扩展 useHistoryStore.calculateDashboardStats() 和新增 fetchRecentTranscriptionList() (AC: #1, #2, #3)
  - [x] 1.1 重构 calculateDashboardStats() 使用 SQL 聚合查询（而非 in-memory 计算）
  - [x] 1.2 扩展 DashboardStats 介面新增 totalRecordingDurationMs、totalCharacters（含 sum(recordingDurationMs)）
  - [x] 1.3 新增 fetchRecentTranscriptionList(limit = 10) 方法：SELECT ... ORDER BY timestamp DESC LIMIT 10
  - [x] 1.4 新增 dashboardStats ref 和 recentTranscriptionList ref
  - [x] 1.5 新增 refreshDashboard() 整合统计 + 最近列表载入

- [x] Task 2: 实作 DashboardView.vue 统计卡片 (AC: #1, #2, #4)
  - [x] 2.1 6 张统计卡片 grid 布局（2x3 或 3x2 responsive）
  - [x] 2.2 每张卡片：图标/emoji + 标题 + 主要数值 + 单位
  - [x] 2.3 数值格式化：时长转 h/min、字数加千分位、百分比
  - [x] 2.4 空状态：数值显示 0（不隐藏卡片）

- [x] Task 3: 实作最近转录摘要列表 (AC: #3, #4)
  - [x] 3.1 统计卡片下方显示最近 10 笔
  - [x] 3.2 每笔：时间戳 + 文字前 50 字截断 + AI 整理标记
  - [x] 3.3 点击跳转至 /history（使用 router.push）
  - [x] 3.4 空状态提示（如「开始使用语音输入，统计数据将在此显示」）

- [x] Task 4: 实作即时更新与手动测试 (AC: #5, #1-#4)
  - [x] 4.1 onMounted 监听 TRANSCRIPTION_COMPLETED 事件
  - [x] 4.2 收到事件后呼叫 refreshDashboard() 重新计算
  - [x] 4.3 onBeforeUnmount 清理事件监听
  - [x] 4.4 手动测试：验证卡片数值、最近列表、空状态、即时更新

## Dev Notes

### 现有骨架分析

| 档案 | 现状 | Story 4.3 任务 |
|------|------|----------------|
| `src/views/DashboardView.vue` | 空 placeholder（仅 title + subtitle） | 实作完整 Dashboard 页面 |
| `src/stores/useHistoryStore.ts` | calculateDashboardStats() 有基本 in-memory 实作 | 重构为 SQL 聚合查询 + 新增 fetchRecentTranscriptionList |
| `src/types/transcription.ts` | DashboardStats 有 4 个栏位 | 需扩展为 6 个统计值的完整介面 |
| `src/types/events.ts` | TranscriptionCompletedPayload 已定义 | 不需修改 |
| `src/composables/useTauriEvents.ts` | TRANSCRIPTION_COMPLETED 已定义 | 不需修改 |
| `src/router.ts` | /dashboard 路由已注册 | 不需修改 |

### 依赖前提

- **Story 4.1**：addTranscription + fetchTranscriptionList + mapRowToRecord
- **Story 4.2**：不直接依赖，但共用 useHistoryStore

### DashboardStats 介面扩展

现有 DashboardStats 只有 4 个栏位，epics 要求 6 张统计卡片。需扩展：

```typescript
// 建议修改 src/types/transcription.ts
export interface DashboardStats {
  totalTranscriptions: number;          // 总使用次数
  totalCharacters: number;              // 口述字数
  totalRecordingDurationMs: number;     // 总口述时间（毫秒）
  averageSpeedCharsPerMin: number;      // 平均口述速度（字/分钟）
  estimatedTimeSavedMs: number;         // 节省时间（毫秒）
  enhancedCount: number;                // AI 整理次数（用于计算使用率百分比）
}
```

**注意**：现有 `calculateDashboardStats()` 有 `averageDurationMs` 栏位（Story 4.1 骨架定义），epics 要求的是「平均口述速度（字/分钟）」而非「平均转录耗时」。需确认是否修改介面栏位名或新增。建议直接修改为上述介面。

### SQL 聚合查询替代 in-memory 计算

现有 `calculateDashboardStats()` 在 in-memory list 上 reduce，对大量记录不效率。改用 SQL 聚合：

```typescript
interface DashboardStatsRow {
  total_count: number;
  total_characters: number;
  total_recording_duration_ms: number;
  enhanced_count: number;
}

async function refreshDashboardStats(): Promise<DashboardStats> {
  const db = getDatabase();
  const rows = await db.select<DashboardStatsRow[]>(
    `SELECT
       COUNT(*) as total_count,
       COALESCE(SUM(char_count), 0) as total_characters,
       COALESCE(SUM(recording_duration_ms), 0) as total_recording_duration_ms,
       COALESCE(SUM(CASE WHEN was_enhanced = 1 THEN 1 ELSE 0 END), 0) as enhanced_count
     FROM transcriptions`
  );

  const row = rows[0];
  const totalMinutes = row.total_recording_duration_ms / 60000;
  const ASSUMED_TYPING_SPEED_CHARS_PER_MIN = 40;

  return {
    totalTranscriptions: row.total_count,
    totalCharacters: row.total_characters,
    totalRecordingDurationMs: row.total_recording_duration_ms,
    averageSpeedCharsPerMin: totalMinutes > 0
      ? Math.round(row.total_characters / totalMinutes)
      : 0,
    estimatedTimeSavedMs: Math.round(
      (row.total_characters / ASSUMED_TYPING_SPEED_CHARS_PER_MIN) * 60000
    ),
    enhancedCount: row.enhanced_count,
  };
}
```

### 最近 10 笔查询

```typescript
async function fetchRecentTranscriptionList(limit = 10): Promise<TranscriptionRecord[]> {
  const db = getDatabase();
  const rows = await db.select<RawTranscriptionRow[]>(
    `SELECT id, timestamp, raw_text, processed_text,
            recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
            char_count, trigger_mode, was_enhanced, was_modified, created_at
     FROM transcriptions
     ORDER BY timestamp DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(mapRowToRecord);
}
```

### 6 张统计卡片定义

| # | 标题 | 计算 | 格式 |
|---|------|------|------|
| 1 | 总口述时间 | sum(recordingDurationMs) | `X 小时 Y 分钟` 或 `X 分钟` |
| 2 | 口述字数 | sum(charCount) | `12,345 字` |
| 3 | 平均口述速度 | totalChars / totalRecordingMinutes | `XXX 字/分钟` |
| 4 | 节省时间 | totalChars / 40 字/分钟 | `X 小时 Y 分钟` |
| 5 | 总使用次数 | count(records) | `XXX 次` |
| 6 | AI 整理使用率 | enhancedCount / totalCount * 100 | `XX%` |

### 数值格式化 Helpers

```typescript
function formatDurationFromMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("zh-TW");
}

function formatPercentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}
```

### 统计卡片 UI 布局

```
┌─────────────────────────────────────────────────────┐
│ Dashboard                                            │
│ 语音转文字统计总览                                    │
│                                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ 总口述时间│ │ 口述字数  │ │ 平均速度  │              │
│ │ 2h 30min │ │ 12,345 字│ │ 82 字/分  │              │
│ └──────────┘ └──────────┘ └──────────┘              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ 节省时间  │ │ 使用次数  │ │ AI 使用率 │              │
│ │ 5h 8min  │ │ 156 次   │ │ 78%      │              │
│ └──────────┘ └──────────┘ └──────────┘              │
│                                                      │
│ 最近转录                                             │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 2026-03-03 14:30  [AI]  这是一段转录文字前五...  │ │
│ │ 2026-03-03 14:25        另一段文字的预览内容...  │ │
│ │ ...                                              │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 卡片 Tailwind 样式建议

```html
<!-- 卡片 grid -->
<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
  <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
    <p class="text-sm text-zinc-400">总口述时间</p>
    <p class="mt-1 text-2xl font-bold text-white">2 小时 30 分钟</p>
  </div>
  <!-- ... -->
</div>
```

### 跳转至历史页面

最近列表点击跳转使用 Vue Router：

```typescript
import { useRouter } from 'vue-router';
const router = useRouter();

function navigateToHistory() {
  router.push('/history');
}
```

**注意**：epics 提到「点击可跳转至历史页面对应记录」，但 Story 4.2 的搜寻是关键字搜寻而非 ID 定位。建议先实作为跳转至 /history 页面即可（不带 query param 定位特定记录），如需精确定位可在后续迭代实作。

### 即时更新（TRANSCRIPTION_COMPLETED 事件）

与 Story 4.2 的 HistoryView 相同模式：

```typescript
import { listenToEvent, TRANSCRIPTION_COMPLETED } from '../composables/useTauriEvents';
import type { UnlistenFn } from '@tauri-apps/api/event';

let unlistenTranscriptionCompleted: UnlistenFn | null = null;

onMounted(async () => {
  await refreshDashboard();

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      refreshDashboard(); // 重新计算统计 + 重新载入最近列表
    }
  );
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
});
```

### refreshDashboard 整合方法

建议在 useHistoryStore 中新增：

```typescript
const dashboardStats = ref<DashboardStats>({
  totalTranscriptions: 0,
  totalCharacters: 0,
  totalRecordingDurationMs: 0,
  averageSpeedCharsPerMin: 0,
  estimatedTimeSavedMs: 0,
  enhancedCount: 0,
});
const recentTranscriptionList = ref<TranscriptionRecord[]>([]);

async function refreshDashboard() {
  const [stats, recent] = await Promise.all([
    refreshDashboardStats(),
    fetchRecentTranscriptionList(10),
  ]);
  dashboardStats.value = stats;
  recentTranscriptionList.value = recent;
}
```

### 不需修改的档案

- `src/types/events.ts` — TranscriptionCompletedPayload 已定义
- `src/composables/useTauriEvents.ts` — TRANSCRIPTION_COMPLETED 已定义
- `src/lib/database.ts` — schema 和索引已建立
- `src/router.ts` — /dashboard 路由已注册
- `src/MainApp.vue` — sidebar 导航已包含 Dashboard

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/types/transcription.ts` | 扩展 DashboardStats 介面（6 个统计栏位） |
| `src/stores/useHistoryStore.ts` | 重构 calculateDashboardStats 为 SQL 聚合 + 新增 fetchRecentTranscriptionList + refreshDashboard + 新 refs |
| `src/views/DashboardView.vue` | 从 placeholder 实作为完整 Dashboard（6 张卡片 + 最近列表 + 空状态 + 即时更新） |

### 跨 Story 备注

- **Story 4.1** 是前提：addTranscription 写入记录、mapRowToRecord helper
- **Story 4.2** 是前提：fetchTranscriptionList 基本版已实作
- DashboardStats 介面修改会影响 calculateDashboardStats() 的 caller — 目前只有 DashboardView 使用，影响范围小
- DashboardView 是 Main Window 的预设首页（/ redirect 到 /dashboard）

### Project Structure Notes

- 不新增任何新档案
- 所有修改在既有专案结构内
- DashboardView.vue 是 Main Window 预设首页
- DashboardStats 介面修改影响 useHistoryStore return type

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — AC 完整定义（lines 697-734）
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR] — SQLite 查询 < 200ms
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — Pinia stores、Tauri Events 跨视窗同步
- [Source: _bmad-output/implementation-artifacts/4-1-transcription-auto-save.md] — SQL 映射、mapRowToRecord、TranscriptionCompletedPayload
- [Source: _bmad-output/implementation-artifacts/4-2-history-browse-search-copy.md] — HistoryView UI 模式、listenToEvent 模式
- [Source: src/stores/useHistoryStore.ts] — 现有 calculateDashboardStats() in-memory 骨架
- [Source: src/views/DashboardView.vue] — 空 placeholder
- [Source: src/types/transcription.ts] — 现有 DashboardStats（4 栏位，需扩展为 6 栏位）
- [Source: src/views/DictionaryView.vue] — UI 设计参考
- [Source: src/views/SettingsView.vue] — UI 设计参考
- [Source: src/router.ts] — /dashboard 路由（预设首页）

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

无错误。166 tests passed，vue-tsc 无新增错误。

### Completion Notes List

- Task 1: 重构 calculateDashboardStats 为 SQL 聚合查询 fetchDashboardStats()，移除旧有 in-memory 计算；扩展 DashboardStats 介面为 6 栏位；新增 fetchRecentTranscriptionList(limit=10)、dashboardStats ref、recentTranscriptionList ref、refreshDashboard() 整合方法
- Task 2: DashboardView.vue 从 placeholder 完整实作 6 张统计卡片（2x3 responsive grid），含 formatDurationFromMs、formatNumber、formatPercentage 格式化 helpers，空状态显示 0
- Task 3: 最近 10 笔转录摘要列表，含时间戳、文字截断 50 字、AI 整理标记、点击跳转至 /history、空状态提示
- Task 4: onMounted 监听 TRANSCRIPTION_COMPLETED 事件呼叫 refreshDashboard()，onBeforeUnmount 清理监听
- 测试：更新 use-history-store.test.ts 移除旧 calculateDashboardStats 测试，新增 fetchDashboardStats(3)、fetchRecentTranscriptionList(3)、refreshDashboard(2) 共 8 个测试

### Change Log

- 2026-03-03: Story 4.3 完整实作 — Dashboard 统计卡片 + 最近转录摘要 + SQL 聚合 + 即时更新

### File List

- src/types/transcription.ts (modified) — DashboardStats 介面扩展 4→6 栏位
- src/stores/useHistoryStore.ts (modified) — SQL 聚合查询、fetchDashboardStats、fetchRecentTranscriptionList、refreshDashboard、新 refs
- src/views/DashboardView.vue (rewritten) — 6 张统计卡片 + 最近列表 + 空状态 + 即时更新
- tests/unit/use-history-store.test.ts (modified) — 替换旧测试 + 新增 8 个 dashboard 相关测试
