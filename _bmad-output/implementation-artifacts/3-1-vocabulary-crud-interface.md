# Story 3.1: 词汇字典 CRUD 介面

Status: done

## Story

As a 使用者,
I want 管理我的个人词汇字典（新增、删除、浏览）,
so that 我能将常用的专有名词加入系统以提升辨识准确度。

## Acceptance Criteria

1. **AC1: 字典页面载入与词汇清单显示**
   - Given Main Window 的字典页面（DictionaryView.vue）
   - When 使用者开启字典页面
   - Then 显示完整的自订词汇清单（表格形式）
   - And 页面顶部显示词汇总数统计
   - And 清单为空时显示空状态提示（如「尚无自订词汇，新增常用术语以提升辨识率」）

2. **AC2: 新增词汇**
   - Given 字典页面已开启
   - When 使用者在新增输入框中输入词汇并按下新增按钮（或 Enter）
   - Then useVocabularyStore 呼叫 addTerm() 将词汇写入 SQLite vocabulary 表
   - And 词汇清单即时更新显示新词汇
   - And 输入框清空，准备下一次输入
   - And 发送 `vocabulary:changed` Tauri Event `{ action: 'added', term: '词汇' }`

3. **AC3: 重复词汇侦测**
   - Given 使用者尝试新增词汇
   - When 输入的词汇已存在于字典中
   - Then 显示提示「此词汇已存在」
   - And 不重复新增

4. **AC4: 空白输入防护**
   - Given 使用者尝试新增词汇
   - When 输入框为空白
   - Then 新增按钮为 disabled 状态
   - And 不执行新增操作

5. **AC5: 删除词汇**
   - Given 词汇清单中有既有词汇
   - When 使用者点击某词汇旁的删除按钮
   - Then useVocabularyStore 呼叫 removeTerm() 从 SQLite 删除该词汇
   - And 词汇清单即时更新
   - And 发送 `vocabulary:changed` Tauri Event `{ action: 'removed', term: '词汇' }`

6. **AC6: App 启动载入词汇**
   - Given useVocabularyStore 已实作
   - When App 启动或字典页面载入
   - Then fetchTermList() 从 SQLite 读取所有词汇
   - And SQLite column snake_case 正确映射为 TypeScript camelCase

7. **AC7: Tauri Event 跨视窗同步**
   - Given 词汇新增或删除操作完成
   - When vocabulary:changed 事件发送
   - Then 事件 payload 遵循 VocabularyChangedPayload 介面定义
   - And 事件可被其他视窗（HUD Window）接收

## Tasks / Subtasks

- [x]Task 1: 实作 useVocabularyStore SQLite CRUD (AC: #1, #2, #3, #5, #6)
  - [x]1.1 引入 `getDatabase()` from `lib/database.ts`，建立 SQL 查询
  - [x]1.2 实作 `fetchTermList()`：SELECT 全部词汇 + snake_case → camelCase 映射
  - [x]1.3 实作 `addTerm(term: string)`：验证 → INSERT → 更新 termList → 发送 Tauri Event
  - [x]1.4 实作 `removeTerm(id: string)`：DELETE → 更新 termList → 发送 Tauri Event
  - [x]1.5 新增 `hasDuplicateTerm(term: string): boolean` computed helper
  - [x]1.6 新增 `termCount` computed 属性
  - [x]1.7 错误处理：try/catch + extractErrorMessage，新增/删除失败不影响已载入的清单

- [x]Task 2: 建构 DictionaryView.vue UI (AC: #1, #2, #3, #4, #5)
  - [x]2.1 顶部统计区：显示词汇总数（Badge 或简单文字）
  - [x]2.2 新增输入区：Input + Button，支援 Enter 送出 + disabled 空白防护
  - [x]2.3 重复词汇回馈：inline 错误文字提示「此词汇已存在」
  - [x]2.4 词汇清单表格：使用 Tailwind 手刻或 shadcn-vue Table 元件
  - [x]2.5 删除按钮：每行词汇旁显示删除按钮（红色 hover 样式）
  - [x]2.6 空状态提示：清单为空时显示引导文字
  - [x]2.7 Loading 状态：fetchTermList 期间显示 loading 指示

- [x]Task 3: 字典页面初始载入整合 (AC: #6)
  - [x]3.1 DictionaryView.vue `onMounted` 呼叫 `vocabularyStore.fetchTermList()`
  - [x]3.2 确认 database 已在 main-window.ts bootstrap 中初始化

- [x]Task 4: Tauri Event 词汇变更通知 (AC: #7)
  - [x]4.1 在 addTerm/removeTerm 成功后呼叫 `emitEvent(VOCABULARY_CHANGED, payload)`
  - [x]4.2 payload 遵循 VocabularyChangedPayload：`{ action: 'added' | 'removed', term: string }`

- [x]Task 5: 手动整合测试 (AC: #1-#7)
  - [x]5.1 验证字典页面载入显示词汇清单
  - [x]5.2 验证新增词汇成功写入 + 清单即时更新
  - [x]5.3 验证重复词汇提示
  - [x]5.4 验证空白输入 disabled
  - [x]5.5 验证删除词汇成功 + 清单即时更新
  - [x]5.6 验证空状态提示显示
  - [x]5.7 验证 App 重启后词汇持久化

## Dev Notes

### 现有骨架分析

Story 3.1 有明确的骨架基础，以下文件已建立但内容为 TODO：

| 档案 | 现状 | Story 3.1 任务 |
|------|------|----------------|
| `src/stores/useVocabularyStore.ts` | 骨架：termList ref + 3 个 TODO stub | 实作 SQL CRUD 完整逻辑 |
| `src/views/DictionaryView.vue` | 空白占位（仅标题文字） | 建构完整 CRUD UI |
| `src/types/vocabulary.ts` | `VocabularyEntry { id, term, createdAt }` 已定义 | 不需修改 |
| `src/types/events.ts` | `VocabularyChangedPayload { action: 'added' \| 'removed', term }` 已定义 | 不需修改 |
| `src/composables/useTauriEvents.ts` | `VOCABULARY_CHANGED` 常数已定义 | 不需修改 |
| `src/lib/database.ts` | vocabulary 表 schema 已建立（id, term UNIQUE, created_at） | 不需修改 |

### SQLite 操作模式

架构决策：**前端直接 SQL**（tauri-plugin-sql），资料存取逻辑集中在 Pinia store actions。

```typescript
// 正确的 SQL 操作模式 [Source: architecture.md#Data Architecture]
import { getDatabase } from '../lib/database';

// SELECT 查询
const db = getDatabase();
const rows = await db.select<RawVocabularyRow[]>(
  'SELECT id, term, created_at FROM vocabulary ORDER BY created_at DESC'
);

// INSERT 操作
await db.execute(
  'INSERT INTO vocabulary (id, term) VALUES ($1, $2)',
  [uuid, term]
);

// DELETE 操作
await db.execute(
  'DELETE FROM vocabulary WHERE id = $1',
  [id]
);
```

### snake_case → camelCase 映射

SQLite 栏位 `created_at` 需映射为 TypeScript 的 `createdAt`。映射在 store action 中处理。

```typescript
interface RawVocabularyRow {
  id: string;
  term: string;
  created_at: string;  // SQLite 原始栏位名
}

function mapRowToEntry(row: RawVocabularyRow): VocabularyEntry {
  return {
    id: row.id,
    term: row.term,
    createdAt: row.created_at,
  };
}
```

### UUID 产生

vocabulary 表 id 为 TEXT PRIMARY KEY，需要在前端产生 UUID。使用 `crypto.randomUUID()`（所有现代浏览器 + Tauri WebView 都支援）。

```typescript
const id = crypto.randomUUID();
```

### 重复词汇侦测策略

SQLite vocabulary 表的 `term` 栏位已设为 `UNIQUE` 约束。两层防护：

1. **前端先行检查**（UX 友善）：在 `addTerm()` 前比对 `termList` 中是否已存在（不区分大小写 trim 后比较）
2. **SQLite UNIQUE 约束**（最终防线）：即使前端比对遗漏，INSERT 会因 UNIQUE 约束失败

```typescript
function isDuplicateTerm(term: string): boolean {
  const normalizedInput = term.trim().toLowerCase();
  return termList.value.some(
    entry => entry.term.trim().toLowerCase() === normalizedInput
  );
}
```

### Tauri Event 发送模式

```typescript
import { emitEvent, VOCABULARY_CHANGED } from '../composables/useTauriEvents';
import type { VocabularyChangedPayload } from '../types/events';

// 新增后发送
await emitEvent(VOCABULARY_CHANGED, {
  action: 'added',
  term: newTerm,
} satisfies VocabularyChangedPayload);

// 删除后发送
await emitEvent(VOCABULARY_CHANGED, {
  action: 'removed',
  term: removedTerm,
} satisfies VocabularyChangedPayload);
```

**注意**：使用 `emitEvent`（即 `emit` from `@tauri-apps/api/event`），不是 `emitToWindow`。`emit` 会广播至所有视窗，确保 HUD Window 也能接收。Story 3.2 的 Whisper 词汇注入需要监听此事件即时更新词汇快取。

### DictionaryView.vue UI 设计参考

遵循 SettingsView.vue 已建立的 UI 模式：
- 页面容器：`<div class="p-6 text-white">`
- Section 卡片：`rounded-xl border border-zinc-700 bg-zinc-900 p-5`
- 标题：`text-2xl font-bold text-white` + 副标题 `text-zinc-400`
- 输入框：`rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500`
- 按钮（主要）：`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50`
- 按钮（危险/删除）：`rounded-lg bg-red-600/20 px-4 py-2 text-sm text-red-400 transition hover:bg-red-600/30`
- 回馈讯息：`text-sm text-green-400` 或 `text-sm text-red-400`

可使用的 shadcn-vue 元件（已安装）：
- `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` — 词汇清单表格
- `Button` — 新增/删除按钮
- `Input` — 新增词汇输入框
- `Badge` — 词汇总数统计

但目前 SettingsView.vue 使用原生 HTML + Tailwind（不使用 shadcn-vue），**建议保持一致使用原生 HTML + Tailwind**，避免同一 App 中混用两种风格。

### 页面布局结构

```
+----------------------------------------------+
| 自订字典                                      |
| 管理自订词汇以提升转录精准度                    |
|                                              |
| +------------------------------------------+ |
| | 词汇总数: 12                  [输入词汇] [新增] | |
| +------------------------------------------+ |
| |                                          | |
| | 词汇          新增时间           操作      | |
| | ─────────────────────────────────────     | |
| | SayIt         2026-03-01        [删除]   | |
| | Tauri         2026-03-01        [删除]   | |
| | Groq          2026-03-02        [删除]   | |
| | ...                                      | |
| +------------------------------------------+ |
+----------------------------------------------+
```

### 错误处理模式

遵循架构决策：Service 层抛出 → Store 层 catch + 降级 + 使用者提示。

```
addTerm() / removeTerm() 失败:
  → Store catch error
  → 不影响已载入的 termList（不回滚 UI）
  → throw error 给 View 层
  → View 显示回馈提示（红色文字）
  → 2.5 秒后自动消失
```

### 不需修改的档案

以下档案已具备 Story 3.1 所需的定义，**不需要任何修改**：

- `src/types/vocabulary.ts` — VocabularyEntry 介面已正确定义
- `src/types/events.ts` — VocabularyChangedPayload 已正确定义，action 使用 'added' | 'removed'
- `src/composables/useTauriEvents.ts` — VOCABULARY_CHANGED 常数已定义
- `src/lib/database.ts` — vocabulary 表 schema 已建立（含 UNIQUE 约束）
- `src/lib/errorUtils.ts` — extractErrorMessage helper 已存在
- `src/main-window.ts` — DB 初始化已在 bootstrap 中执行
- `src/MainApp.vue` — 字典页面路由已在 navItems 中配置
- `src/router.ts` — /dictionary 路由已存在

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/stores/useVocabularyStore.ts` | 完整实作 CRUD 逻辑（替换 3 个 TODO stub） |
| `src/views/DictionaryView.vue` | 完整重写为 CRUD UI |

### 跨 Story 备注

- **Story 3.2** 会消费 `vocabulary:changed` 事件和 `useVocabularyStore.termList` 来注入 Whisper prompt 和 AI 上下文
- **Story 2.2（已实作）** 的 enhancer.ts 已预留 `<vocabulary>` 标签注入位置，Story 3.2 将补上读取 vocabularyStore 的逻辑
- **useVocabularyStore** 目前不需在 HUD Window 初始化（HUD 不操作词汇）。但 Story 3.2 可能需要 HUD Window 存取词汇快取以注入 transcriber/enhancer — 届时再决定是否在 HUD 初始化 vocabularyStore 或改用 Tauri Event 传递词汇资料

### Project Structure Notes

- 所有修改均在既有专案结构内，不新增任何新档案
- `useVocabularyStore.ts` 和 `DictionaryView.vue` 已存在于正确目录
- 命名遵循架构规范：store camelCase、Vue PascalCase、SQL snake_case
- 依赖方向符合：`DictionaryView → useVocabularyStore → database.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — AC 完整定义
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — 前端直接 SQL、SQLite schema
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — snake_case/camelCase 映射规则
- [Source: _bmad-output/planning-artifacts/architecture.md#Communication Patterns] — Tauri Event 命名、Store Action 命名
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — 专案目录结构
- [Source: src/stores/useVocabularyStore.ts] — 现有骨架
- [Source: src/views/DictionaryView.vue] — 现有空白占位
- [Source: src/types/vocabulary.ts] — VocabularyEntry 介面
- [Source: src/types/events.ts] — VocabularyChangedPayload 介面
- [Source: src/composables/useTauriEvents.ts] — VOCABULARY_CHANGED 常数 + emitEvent
- [Source: src/lib/database.ts] — SQLite schema（vocabulary 表 + UNIQUE 约束）
- [Source: src/views/SettingsView.vue] — UI 模式参考（Tailwind classes、回馈讯息、section 卡片）
- [Source: src/stores/useSettingsStore.ts] — Store 模式参考（error handling、plugin-store pattern）
- [Source: src/lib/errorUtils.ts] — extractErrorMessage helper

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 116 tests passed

### Completion Notes List

- useVocabularyStore 完整 SQLite CRUD（fetchTermList, addTerm, removeTerm, isDuplicateTerm）
- DictionaryView 完整 UI（新增/删除/列表/空状态/统计 badge）
- vocabulary:changed Tauri Event 跨视窗同步

### Change Log

- Story 3.1 完整实作 — 词汇字典 CRUD 介面

### File List

- src/stores/useVocabularyStore.ts
- src/views/DictionaryView.vue
