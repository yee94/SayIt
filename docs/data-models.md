# Data Models

> SQLite Schema（tauri-plugin-sql · WAL mode）+ tauri-plugin-store 键值
> 扫描日期：2026-05-08 · 当前 schema_version：**8**

---

## 一、储存分层

```
┌─────────────────────────────────────────────────────────┐
│                  Frontend Storage Layer                 │
│                                                         │
│  tauri-plugin-store                                     │
│  └── SettingsStore：API Key、provider、model、hotkey... │
│       （JSON KV，存放于 OS app data 目录）              │
│                                                         │
│  tauri-plugin-sql (sqlite:app.db)                       │
│  ├── transcriptions      ← 转录历史 + 统计              │
│  ├── api_usage           ← API 用量（whisper / chat / vocab） │
│  ├── vocabulary          ← 字典 + 智慧学习权重          │
│  └── schema_version      ← migration 控制              │
│                                                         │
│  WAL mode + busy_timeout 5000 + synchronous NORMAL     │
└─────────────────────────────────────────────────────────┘
```

**为什么 API Key 不放 SQLite**？因为 SQLite DB 档案是普通档案系统档，没有额外加密；`tauri-plugin-store` 的 KV store 在某些平台（macOS Keychain integration）有更好的安全保护。**这是硬规则**。

---

## 二、SQLite Schema

### 2.1 `transcriptions`

每笔完成的转录都会插入一列。

| 栏位                          | 型别                | 约束                                       | 用途                                              |
| ----------------------------- | ------------------- | ------------------------------------------ | ------------------------------------------------- |
| `id`                          | TEXT                | PRIMARY KEY                                | 前端 `crypto.randomUUID()`                        |
| `timestamp`                   | INTEGER             | NOT NULL                                   | epoch ms                                          |
| `raw_text`                    | TEXT                | NOT NULL                                   | Whisper 原始输出                                  |
| `processed_text`              | TEXT                | NULL                                       | LLM 整理后（NULL = 未启用整理）                   |
| `recording_duration_ms`       | INTEGER             | NOT NULL                                   | 录音长度                                          |
| `transcription_duration_ms`   | INTEGER             | NOT NULL                                   | Whisper 耗时                                      |
| `enhancement_duration_ms`     | INTEGER             | NULL                                       | LLM 整理耗时                                      |
| `char_count`                  | INTEGER             | NOT NULL                                   | `raw_text` 字元数（v6 修正后一致）                |
| `trigger_mode`                | TEXT                | CHECK IN ('hold', 'toggle')                | 触发模式                                          |
| `was_enhanced`                | INTEGER             | DEFAULT 0                                  | 0/1 boolean                                       |
| `was_modified`                | INTEGER             | NULL                                       | quality monitor 结果（NULL=未测量）               |
| `created_at`                  | TEXT                | DEFAULT (datetime('now'))                  | ISO timestamp                                     |
| `audio_file_path`             | TEXT                | NULL                                       | 本机 .wav 路径（v4+，可重新转录用）               |
| `status`                      | TEXT                | NOT NULL DEFAULT 'success'                 | success / error / partial（v4+）                  |
| `is_edit_mode`                | INTEGER             | NOT NULL DEFAULT 0                         | Edit Mode 旗标（v8+）                             |
| `edit_source_text`            | TEXT                | NULL                                       | Edit Mode 的来源文字（v8+）                       |

**Indexes**：
- `idx_transcriptions_timestamp` ON `timestamp DESC`
- `idx_transcriptions_created_at` ON `created_at`
- `idx_transcriptions_status` ON `status`（v4+）

### 2.2 `api_usage`

每笔转录 / 整理 / 字典分析都会记录 API 用量。

| 栏位                          | 型别                | 约束                                                          |
| ----------------------------- | ------------------- | ------------------------------------------------------------- |
| `id`                          | TEXT                | PRIMARY KEY                                                   |
| `transcription_id`            | TEXT                | NOT NULL, FK→transcriptions(id)                               |
| `api_type`                    | TEXT                | CHECK IN ('whisper', 'chat', 'vocabulary_analysis')           |
| `model`                       | TEXT                | NOT NULL                                                      |
| `prompt_tokens`               | INTEGER             | NULL                                                          |
| `completion_tokens`           | INTEGER             | NULL                                                          |
| `total_tokens`                | INTEGER             | NULL                                                          |
| `prompt_time_ms`              | REAL                | NULL                                                          |
| `completion_time_ms`          | REAL                | NULL                                                          |
| `total_time_ms`               | REAL                | NULL                                                          |
| `audio_duration_ms`           | INTEGER             | NULL（whisper only）                                          |
| `estimated_cost_ceiling`      | REAL                | NULL                                                          |
| `created_at`                  | TEXT                | DEFAULT (datetime('now'))                                     |

**Index**：`idx_api_usage_transcription_id` ON `transcription_id`

⚠️ **已知 issue**：`addApiUsage(whisper/chat)` 偶发 `FOREIGN KEY constraint failed` (787)，可能是 `transcriptions` 与 `api_usage` 写入 race。

### 2.3 `vocabulary`

| 栏位          | 型别     | 约束                                       |
| ------------- | -------- | ------------------------------------------ |
| `id`          | TEXT     | PRIMARY KEY                                |
| `term`        | TEXT     | NOT NULL UNIQUE                            |
| `created_at`  | TEXT     | DEFAULT (datetime('now'))                  |
| `weight`      | INTEGER  | NOT NULL DEFAULT 1（v3+，智慧学习权重）    |
| `source`      | TEXT     | NOT NULL DEFAULT 'manual'（v3+，'manual'/'auto'） |

**Index**：`idx_vocabulary_weight` ON `weight DESC`

### 2.4 `schema_version`

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY
);
```

只存最新版本一列；migration 用 `INSERT OR REPLACE` 更新。

---

## 三、Migration 链（v1 → v8）

| Version | 变更                                                                                                        | 档案位置                          |
| ------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **v1**  | 建立 `transcriptions` + `vocabulary` + `schema_version`                                                     | `database.ts:113-156`             |
| **v2**  | 新增 `api_usage` 表                                                                                         | `database.ts:158-194`             |
| **v3**  | `vocabulary` 加 `weight` / `source`；`api_usage.api_type` CHECK 扩充 `vocabulary_analysis`（重建表）        | `database.ts:196-273`             |
| **v4**  | `transcriptions` 加 `audio_file_path` / `status`                                                            | `database.ts:275-310`             |
| **v5**  | 新增 `hallucination_terms` 表                                                                               | `database.ts:312-343`             |
| **v6**  | 重算 `char_count = LENGTH(raw_text)`（修正既有资料）                                                        | `database.ts:345-371`             |
| **v7**  | DROP `hallucination_terms`（改为纯前端记忆体实作）                                                          | `database.ts:373-394`             |
| **v8**  | `transcriptions` 加 `is_edit_mode` / `edit_source_text`                                                     | `database.ts:396-420`             |

### 3.1 Migration 写法准则

1. **DDL 在 transaction 外**：`tauri-plugin-sql` 驱动下，`ALTER TABLE ADD COLUMN` 在显式 transaction 内对后续语句不可见 → 用 `addColumnIfNotExists()` helper（幂等）
2. **CHECK 修改要重建表**：SQLite 不支援 ALTER CONSTRAINT
3. **DROP TABLE 前先清残留**：用 `DROP TABLE IF EXISTS xxx_new` 防上次失败残留
4. **transaction 包 schema_version 更新**：跟其他 DDL 一起 commit / rollback
5. **加新 migration 不要改旧 migration**：使用者已执行的 migration 不可变更

### 3.2 连线恢复逻辑（防失败 migration 后永久坏）

`doInitializeDatabase` 在所有 migration 之后做「关键表验证与恢复」（`database.ts:422-476`）：

- `vocabulary` column 恢复：无条件重跑 `addColumnIfNotExists` 补 `weight`/`source`（issue #27 — Windows 环境下 v3 推进但 column 未落地）
- `api_usage` 表恢复：若不存在但 `api_usage_new` 存在（上次 migration 没 RENAME 成功），直接 RENAME；否则重建空表（资料遗失但 app 可用）

---

## 四、Frontend Store 结构（记忆体状态）

不入库、仅 runtime 存在：

### 4.1 `useVoiceFlowStore`（核心状态机）

```
HudStatus = 'idle' | 'recording' | 'transcribing' | 'enhancing'
          | 'editing' | 'success' | 'error' | 'cancelled'

State：
  hudState: { status, message }
  recordingSession: { startedAt, audioBufferId? }
  currentTranscription?: TranscriptionRecord
  triggerMode: 'hold' | 'toggle'
  qualityMonitor: { isActive, transcriptionId }
  correctionMonitor: { isActive }
  editMode: { isActive, sourceText, fieldRef? }
  smartDictionary: { learnedTerms[] }
```

### 4.2 `useSettingsStore`

```
State：
  apiKey: string
  provider: 'groq' | 'gemini' | 'openai' | 'anthropic'
  llmModelId: LlmModelId
  whisperModelId: WhisperModelId
  hotkeyConfig: { triggerKey, triggerMode }
  audioInputDeviceName?: string
  language: 'auto' | 'zh-CN' | 'en' | 'ja' | 'ko'  // 历史 zh-TW 会迁移为 zh-CN
  enhancementEnabled: boolean
  enhancementThreshold: number
  audioMuteSystemDuringRecord: boolean
  recordingAutoCleanupEnabled: boolean
  recordingAutoCleanupDays: number
  customPromptList: PromptConfig[]
  promptModeId: string
  ... (约 30+ 个设定项)
```

> 全部设定变更会 emit `settings:updated` → 跨视窗同步。

### 4.3 `useHistoryStore`

```
State：
  transcriptions: TranscriptionRecord[]
  searchQuery: string
  filteredTranscriptions: computed
  paginationCursor?: number
```

### 4.4 `useVocabularyStore`

```
State：
  vocabulary: VocabularyEntry[]
```

---

## 五、型别命名惯例

| 后缀            | 用途                              | 范例                                  |
| --------------- | --------------------------------- | ------------------------------------- |
| `*Record`       | SQLite 一列                       | `TranscriptionRecord`、`VocabularyEntry` |
| `*Payload`      | Tauri Event payload               | `WaveformPayload`、`HotkeyEventPayload` |
| `*Config`       | 设定物件                          | `HotkeyConfig`、`PromptConfig`        |
| `*Entry`        | 字典 / 列表项                     | `VocabularyEntry`                     |
| `*Dto`          | Store 间传递                      | —                                     |
| `*Handle`       | 资源控制                          | `AudioAnalyserHandle`                 |

---

## 六、SQLite 映射规则（mapRowToRecord）

- 表名：复数 snake_case（`transcriptions`、`api_usage`）
- 栏位：snake_case（`raw_text`） → TS camelCase（`rawText`） via `mapRowToRecord()`
- Boolean：`INTEGER` → `row.was_enhanced === 1`
- Nullable boolean：`INTEGER | null` → `row.was_modified === null ? null : row.was_modified === 1`
- 主键：`TEXT` UUID（前端 `crypto.randomUUID()`）
- 参数语法：`$1, $2`（tauri-plugin-sql 风格，不是 `?`）

---

## 七、Recording File Storage

`save_recording_file(id)` Command 会将 cpal 缓冲写成 WAV，路径模式：

```
$APPDATA/recordings/<id>.wav
```

`tauri.conf.json` 的 `assetProtocol.scope` 开放 `$APPDATA/recordings/**`，前端可透过 `convertFileSrc()` 取得 `asset://localhost/...` URL 播放。

> ⚠️ **macOS production CSP 限制**：`media-src` 必须含 `http://asset.localhost`（已设定）。Dev mode 不受 CSP 影响，安全功能必须用 `pnpm tauri build --debug` 测试。

`cleanup_old_recordings(days)` 启动时依设定（预设 30 天）删除过期录音。

---

## 八、Storage Locations（OS）

| 平台    | App data 路径                                                    |
| ------- | ---------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/com.sayit.app/`                   |
| Windows | `%APPDATA%\com.sayit.app\`                                       |

子目录：
- `app.db`（SQLite + WAL `app.db-wal` + shared memory `app.db-shm`）
- `recordings/<id>.wav`
- `store.json`（tauri-plugin-store）

---

## 九、Open Issues / Tech Debt

| 议题                                                                | 影响范围                          |
| ------------------------------------------------------------------- | --------------------------------- |
| `addApiUsage` 偶发 FK 失败（787）                                    | 统计资料不齐                      |
| 没有资料备份 / 汇出功能                                              | 换机器 / 重灌会丢历史             |
| `transcriptions.audio_file_path` 与实体档案可能不一致（手动删档）    | HistoryView 播放 fallback         |
| Migration v6 用 `LENGTH(raw_text)` 计算字元数对非 ASCII 不精确       | 字数统计可能略偏                  |
