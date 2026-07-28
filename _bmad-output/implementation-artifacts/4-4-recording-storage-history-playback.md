# Story 4.4: 录音永久储存与历史播放

Status: done

## Story

As a 使用者,
I want 每次录音档案永久储存，并可在历史记录中播放,
so that 我能回听自己说了什么，也能在辨识失败时重送。

## Acceptance Criteria

1. **AC1: 录音档案写入磁碟**
   - Given 录音结束
   - When `stop_recording()` 完成 WAV 编码
   - Then WAV 档案写入 `{APP_DATA}/recordings/{transcription_id}.wav`
   - And `transcriptions` 表的 `audio_file_path` 栏位记录档案路径

2. **AC2: 失败记录仍保存录音**
   - Given 转录失败（Whisper 回传空字串、录音太短、API 错误）
   - When 失败流程触发
   - Then 仍然写入 `transcriptions` 表，`status` 为 `failed`
   - And 录音档案仍然保存于磁碟
   - And 未来 Story 2.4 幻觉拦截也应复用此 `failed` 机制

3. **AC3: 历史记录播放按钮**
   - Given HistoryView 显示历史记录
   - When 该记录有对应的录音档案存在
   - Then 显示播放按钮
   - And 点击后透过 `convertFileSrc()` + HTML5 `<audio>` 播放

4. **AC4: 录音档案不存在时按钮 disabled**
   - Given HistoryView 显示历史记录
   - When 录音档案已被清理不存在
   - Then 播放按钮灰显 disabled

5. **AC5: 设定页面录音储存管理**
   - Given 设定页面
   - When 使用者查看录音储存设定
   - Then 显示「删除所有录音档」按钮（含确认对话框）
   - And 显示「自动清理」开关 + 天数设定（预设 7 天）

6. **AC6: 自动清理执行**
   - Given 自动清理已启用
   - When App 启动
   - Then 自动删除超过设定天数的录音档
   - And 对应的 `transcriptions` 记录的 `audio_file_path` 设为 null

## Tasks / Subtasks

- [x] Task 1: SQLite Migration v3 → v4（AC: #1, #2）
  - [x] 1.1 在 `database.ts` 新增 migration v4（包裹在 `BEGIN TRANSACTION` / `COMMIT` 中，失败时 `ROLLBACK`，沿用 v3 migration 模式）
  - [x] 1.2 `ALTER TABLE transcriptions ADD COLUMN audio_file_path TEXT`
  - [x] 1.3 `ALTER TABLE transcriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'success'`
  - [x] 1.4 `CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status)`
  - [x] 1.5 更新 `schema_version` 至 4

- [x] Task 2: Rust 端录音档写入磁碟（AC: #1）
  - [x] 2.1 在 `audio_recorder.rs` 新增 `save_recording_file` Tauri Command
  - [x] 2.2 Command 接收 `id: String` + `app: AppHandle`，从 `AudioRecorderState.wav_buffer` 取出 WAV 资料
  - [x] 2.3 使用 `app.path().app_data_dir()` 取得 App Data 路径，建立 `recordings/` 子目录
  - [x] 2.4 写入 `recordings/{id}.wav`，回传档案完整路径 `Result<String, String>`
  - [x] 2.5 在 `lib.rs` 的 `invoke_handler` 注册 `save_recording_file`

- [x] Task 3: Rust 端录音档清理 Commands（AC: #5, #6）
  - [x] 3.1 新增 `delete_all_recordings` Command：删除 `recordings/` 目录下所有 `.wav` 档案，回传删除数量 `Result<u32, String>`
  - [x] 3.2 新增 `cleanup_old_recordings` Command：接收 `days: u32`，删除修改时间超过指定天数的 `.wav`，回传被删除的档案名称清单 `Result<Vec<String>, String>`（档名不含副档名 = transcription ID，供前端更新 DB）
  - [x] 3.3 在 `lib.rs` 的 `invoke_handler` 注册两个新 Command

- [x] Task 4: 更新 TranscriptionRecord 型别与 Store（AC: #1, #2）
  - [x] 4.1 `src/types/transcription.ts`：`TranscriptionRecord` 新增 `audioFilePath: string | null` 和 `status: 'success' | 'failed'`
  - [x] 4.2 `src/stores/useHistoryStore.ts`：`RawTranscriptionRow` 新增 `audio_file_path` 和 `status` 栏位
  - [x] 4.3 `mapRowToRecord()` 新增 `audioFilePath` 和 `status` 映射
  - [x] 4.4 所有 SELECT SQL 常数新增 `audio_file_path, status` 栏位
  - [x] 4.5 `INSERT_SQL` 新增 `audio_file_path, status` 参数（$12, $13）
  - [x] 4.6 `addTranscription()` 传入 `audioFilePath` 和 `status`

- [x] Task 5: useVoiceFlowStore 整合录音储存流程（AC: #1, #2）
  - [x] 5.1 在 `stopListeningFlow()` 中，`stop_recording` 成功后立即呼叫 `invoke('save_recording_file', { id: transcriptionId })`
  - [x] 5.2 `transcriptionId` 在 `stopListeningFlow` 开头以 `crypto.randomUUID()` 生成，贯穿整个流程
  - [x] 5.3 `buildTranscriptionRecord()` 新增 `audioFilePath` 和 `status` 参数
  - [x] 5.4 成功流程：`status: 'success'`，`audioFilePath` 来自 `save_recording_file` 回传值
  - [x] 5.5 失败流程（空转录 / 录音太短）：呼叫 `addTranscription` 写入 `status: 'failed'`，保留 `audioFilePath`
  - [x] 5.6 `save_recording_file` 失败时不阻断主流程，`audioFilePath` 设为 `null` 并 log 警告

- [x] Task 6: HistoryView 播放功能与 failed 记录显示（AC: #2, #3, #4）
  - [x] 6.1 新增 `convertFileSrc` import（`@tauri-apps/api/core`）
  - [x] 6.2 每笔记录旁新增播放按钮（Play icon from lucide-vue-next）
  - [x] 6.3 按钮状态逻辑：`audioFilePath` 有值 → enabled，`audioFilePath` 为 null → disabled
  - [x] 6.8 `status === 'failed'` 的记录显示红色 Badge（shadcn-vue `<Badge variant="destructive">`），文字「辨识失败」，不隐藏 failed 记录（Story 4.5 重送需要看到它们）
  - [x] 6.4 播放逻辑：`convertFileSrc(record.audioFilePath)` 取得安全 URL → 建立 `Audio` 物件 → `play()`
  - [x] 6.5 播放状态追踪：`playingRecordId` ref，播放中显示 Pause icon，点击可暂停
  - [x] 6.6 确保同一时间只有一个录音在播放（播放新的自动停止旧的）
  - [x] 6.7 `onBeforeUnmount` 时清理 Audio 物件（停止播放、释放资源）

- [x] Task 7: SettingsView 录音储存管理 UI（AC: #5）
  - [x] 7.1 `useSettingsStore` 新增 `isRecordingAutoCleanupEnabled`（boolean）和 `recordingAutoCleanupDays`（number, default 7）设定
  - [x] 7.2 SettingsView 新增「录音储存」section（位于现有 section 之后）
  - [x] 7.3 「删除所有录音档」按钮 + AlertDialog 确认对话框
  - [x] 7.4 「自动清理」Switch + 天数 Input（disabled when switch off）
  - [x] 7.5 删除操作呼叫 `invoke('delete_all_recordings')`，成功后显示 feedback 讯息
  - [x] 7.6 删除后更新所有 transcriptions 的 `audio_file_path` 为 null（SQL UPDATE）

- [x] Task 8: App 启动自动清理（AC: #6）
  - [x] 8.1 在 `main-window.ts` 启动时读取 `isRecordingAutoCleanupEnabled` 和 `recordingAutoCleanupDays`
  - [x] 8.2 若自动清理启用，呼叫 `invoke<string[]>('cleanup_old_recordings', { days })` 执行清理
  - [x] 8.3 用回传的 ID 清单批次 SQL UPDATE：`UPDATE transcriptions SET audio_file_path = NULL WHERE id IN (...)`
  - [x] 8.4 清理操作在背景执行（`setTimeout(() => ..., 0)` 或 `queueMicrotask`），不阻断 App 启动

- [x] Task 9: i18n 翻译键新增
  - [x] 9.1 5 个 locale JSON（`src/i18n/locales/{zh-TW,en,ja,zh-CN,ko}.json`）新增录音储存管理相关翻译键
  - [x] 9.2 翻译键包含：播放按钮 tooltip、删除确认对话框文字、自动清理设定标签、清理 feedback 讯息

- [ ] Task 10: 手动测试验证（AC: #1-#6）
  - [ ] 10.1 验证录音后 `recordings/` 目录出现对应 WAV 档案
  - [ ] 10.2 验证 `transcriptions` 表 `audio_file_path` 和 `status` 栏位正确
  - [ ] 10.3 验证 HistoryView 播放按钮可播放录音
  - [ ] 10.4 验证录音不存在时按钮 disabled
  - [ ] 10.5 验证设定页面删除和自动清理功能

## Dev Notes

### 现有骨架分析

| 档案 | 现状 | Story 4.4 任务 |
|------|------|----------------|
| `src-tauri/src/plugins/audio_recorder.rs` | `stop_recording` 回传 `StopRecordingResult { recordingDurationMs }`，WAV 存于 `wav_buffer` | 新增 `save_recording_file`、`delete_all_recordings`、`cleanup_old_recordings` Commands |
| `src-tauri/src/lib.rs` | 已有 `invoke_handler` 注册区块 | 新增 3 个 Command 注册 |
| `src/lib/database.ts` | schema version 3（最新 migration: vocabulary weight/source） | 新增 migration v4：`audio_file_path` + `status` 栏位 |
| `src/types/transcription.ts` | `TranscriptionRecord` 缺少 `audioFilePath`、`status` | 扩展介面 |
| `src/stores/useHistoryStore.ts` | `RawTranscriptionRow`、`mapRowToRecord()`、SQL 常数 | 扩展所有 SQL + 型别映射 |
| `src/stores/useVoiceFlowStore.ts` | `stopListeningFlow()` 完整流程已存在 | 穿插 `save_recording_file` 呼叫 + 失败记录写入 |
| `src/views/HistoryView.vue` | 历史记录列表已实作（搜寻、展开、复制） | 新增播放按钮 + 播放逻辑 |
| `src/views/SettingsView.vue` | 多个设定 section 已存在 | 新增「录音储存」section |
| `src/stores/useSettingsStore.ts` | tauri-plugin-store 读写已封装 | 新增清理设定 |

### 依赖 Story 4.1–4.3 的前提

Story 4.4 假设以下已完成：
- `useHistoryStore.addTranscription()` — SQL INSERT + 事件发送（Story 4.1）
- `HistoryView.vue` — 列表显示、搜寻、展开、复制（Story 4.2）
- `DashboardView.vue` — 统计卡片（Story 4.3）
- `database.ts` — schema version 3，transcriptions 表已存在

### Rust `save_recording_file` 实作要点

```rust
#[command]
pub fn save_recording_file(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioRecorderState>,
) -> Result<String, String> {
    let wav_data = state
        .wav_buffer
        .lock()
        .map_err(|e| format!("Failed to lock wav_buffer: {}", e))?
        .clone()
        .ok_or_else(|| "No WAV data available".to_string())?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings dir: {}", e))?;

    let file_path = recordings_dir.join(format!("{}.wav", id));
    std::fs::write(&file_path, &wav_data)
        .map_err(|e| format!("Failed to write WAV file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}
```

### Rust `delete_all_recordings` 实作要点

```rust
#[command]
pub fn delete_all_recordings(
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    if !recordings_dir.exists() {
        return Ok(0);
    }

    let mut count = 0u32;
    for entry in std::fs::read_dir(&recordings_dir)
        .map_err(|e| format!("Failed to read recordings dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "wav") {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
            count += 1;
        }
    }
    Ok(count)
}
```

### Rust `cleanup_old_recordings` 实作要点

回传被删除的档案名称清单（不含副档名 = transcription ID），供前端更新 DB：

```rust
#[command]
pub fn cleanup_old_recordings(
    days: u32,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");
    if !recordings_dir.exists() {
        return Ok(vec![]);
    }

    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(u64::from(days) * 24 * 60 * 60);

    let mut deleted_id_list: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(&recordings_dir)
        .map_err(|e| format!("Failed to read recordings dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        if !path.extension().map_or(false, |ext| ext == "wav") {
            continue;
        }
        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("Failed to get metadata: {}", e))?;
        let modified = metadata.modified()
            .map_err(|e| format!("Failed to get modified time: {}", e))?;
        if modified < cutoff {
            // 取得不含副档名的 stem（= transcription ID）
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                deleted_id_list.push(stem.to_string());
            }
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
        }
    }
    Ok(deleted_id_list)
}
```

### Database Migration v4

沿用 v3 migration 的 TRANSACTION 模式（BEGIN → COMMIT / ROLLBACK）：

```typescript
// --- Migration v3 → v4: recording storage + status ---
const v4VersionRows = await connection.select<{ version: number }[]>(
  "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
);
const v4CurrentVersion = v4VersionRows[0]?.version ?? 1;

if (v4CurrentVersion < 4) {
  await connection.execute("BEGIN TRANSACTION;");
  try {
    await connection.execute(
      "ALTER TABLE transcriptions ADD COLUMN audio_file_path TEXT;",
    );
    await connection.execute(
      "ALTER TABLE transcriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'success';",
    );
    await connection.execute(
      "CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);",
    );
    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (4);",
    );
    await connection.execute("COMMIT;");
  } catch (migrationError) {
    await connection.execute("ROLLBACK;");
    throw migrationError;
  }
  console.log("[database] Migration v3 → v4: recording storage + status columns");
}
```

### TranscriptionRecord 型别扩展

```typescript
export interface TranscriptionRecord {
  // ...existing fields...
  audioFilePath: string | null;
  status: 'success' | 'failed';
}
```

### RawTranscriptionRow 扩展

```typescript
interface RawTranscriptionRow {
  // ...existing fields...
  audio_file_path: string | null;
  status: string;
}
```

### mapRowToRecord 扩展

```typescript
function mapRowToRecord(row: RawTranscriptionRow): TranscriptionRecord {
  return {
    // ...existing mappings...
    audioFilePath: row.audio_file_path,
    status: row.status as 'success' | 'failed',
  };
}
```

### useVoiceFlowStore 流程修改重点

`stopListeningFlow()` 核心变更：

1. 流程开头生成 `transcriptionId = crypto.randomUUID()`
2. `stop_recording` 成功后，立即 `invoke('save_recording_file', { id: transcriptionId })`
3. 保存回传的 `audioFilePath`（失败时设 null）
4. 所有 `buildTranscriptionRecord()` 呼叫传入 `audioFilePath` 和 `status`
5. 失败流程（空转录、录音太短）也呼叫 `addTranscription` 写入 DB，`status: 'failed'`

**失败记录写入时机**：
- `isEmptyTranscription(result.rawText)` → 写入 failed 记录
- `recordingDurationMs < MINIMUM_RECORDING_DURATION_MS` → 写入 failed 记录
- API 错误（transcribe_audio invoke 失败）→ 写入 failed 记录（如果有 audioFilePath）

### HistoryView 播放 UI 模式

```typescript
import { convertFileSrc } from '@tauri-apps/api/core';

const playingRecordId = ref<string | null>(null);
let currentAudio: HTMLAudioElement | null = null;

function handlePlayRecording(record: TranscriptionRecord) {
  // 停止正在播放的
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  // 如果点击同一个（暂停）
  if (playingRecordId.value === record.id) {
    playingRecordId.value = null;
    return;
  }

  if (!record.audioFilePath) return;

  const audioSrc = convertFileSrc(record.audioFilePath);
  currentAudio = new Audio(audioSrc);
  playingRecordId.value = record.id;

  currentAudio.addEventListener('ended', () => {
    playingRecordId.value = null;
    currentAudio = null;
  });

  currentAudio.play().catch(() => {
    playingRecordId.value = null;
    currentAudio = null;
  });
}

// onBeforeUnmount 清理
onBeforeUnmount(() => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  playingRecordId.value = null;
});
```

### Tauri v2 Asset Protocol 配置（重要）

`convertFileSrc()` 在 Tauri v2 中将本地档案路径转换为 `http://asset.localhost/...` URL。需要两处配置：

**1. CSP 允许 asset protocol（`tauri.conf.json`）：**

现有 CSP 为 `default-src 'self'`，会阻挡 `http://asset.localhost` 域名的请求。需扩展 CSP：

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https://api.groq.com; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' http://asset.localhost"
    }
  }
}
```

新增 `media-src 'self' http://asset.localhost` 允许 `<audio>` 载入 asset protocol URL。

**2. Asset Protocol Scope（`tauri.conf.json`）：**

Tauri v2 需在 `app.security` 中启用 asset protocol scope，限制可存取的本地路径：

```json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPDATA/recordings/**"]
      }
    }
  }
}
```

**注意**：`tauri.conf.json` 是保护档案（CLAUDE.md: 🟡 警告级），修改前需确认必要性。此处修改是功能性需求，必须执行。

### SettingsView 新 Section 布局

新增在现有 sections 之后，沿用同样的 Card + Section Header 模式：

```
┌─────────────────────────────────────────┐
│ 录音储存管理                             │
│                                          │
│ 自动清理  [Switch]                       │
│ 保留天数  [7] 天                         │
│                                          │
│ [删除所有录音档]  (destructive button)   │
└─────────────────────────────────────────┘
```

### useSettingsStore 新增设定

```typescript
const isRecordingAutoCleanupEnabled = ref(false);
const recordingAutoCleanupDays = ref(7);
```

使用 `tauri-plugin-store` 持久化，key：
- `recordingAutoCleanupEnabled` (boolean)
- `recordingAutoCleanupDays` (number)

### 不需修改的档案

- `src/composables/useTauriEvents.ts` — 不新增事件常数
- `src/router.ts` — 路由不变
- `src/MainApp.vue` — sidebar 不变
- `src/components/NotchHud.vue` — HUD 不变（重送功能属 Story 4.5）
- `src/App.vue` — HUD 视窗不变

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src-tauri/src/plugins/audio_recorder.rs` | 新增 `save_recording_file`、`delete_all_recordings`、`cleanup_old_recordings` Commands |
| `src-tauri/src/lib.rs` | `invoke_handler` 注册 3 个新 Command |
| `src/lib/database.ts` | Migration v3 → v4（`audio_file_path` + `status` 栏位） |
| `src/types/transcription.ts` | `TranscriptionRecord` 扩展 `audioFilePath`、`status` |
| `src/stores/useHistoryStore.ts` | `RawTranscriptionRow` 扩展 + SQL 常数扩展 + `addTranscription` 扩展 |
| `src/stores/useVoiceFlowStore.ts` | `stopListeningFlow` 穿插录音储存 + 失败记录写入 |
| `src/views/HistoryView.vue` | 新增播放按钮 + 播放逻辑 |
| `src/views/SettingsView.vue` | 新增「录音储存管理」section |
| `src/stores/useSettingsStore.ts` | 新增 `isRecordingAutoCleanupEnabled`、`recordingAutoCleanupDays` |
| `src/main-window.ts` | App 启动时执行自动清理 |
| `src-tauri/tauri.conf.json` | 可能需启用 asset protocol scope |
| `src/i18n/locales/*.json`（5 个） | 新增翻译键 |

### 跨 Story 备注

- **Story 4.1–4.3** 是前提：提供 transcriptions 表基本结构 + HistoryView + useHistoryStore
- **Story 4.5**（转录失败一键重送）依赖 4.4：需要磁碟上的 WAV 档案才能重送，以及 `status` 栏位判断失败记录
- **Story 2.4**（幻觉侦测）与 4.4 的 `status: 'failed'` 栏位有交互：幻觉拦截也应记为 failed（但 Story 2.4 排在 v0.9.0，4.4 先行）
- 本 Story 新增的 `audioFilePath` 和 `status` 栏位会被 Story 4.5 消费（重送按钮读取 audioFilePath）
- `StopRecordingResult` 新增 `peakEnergyLevel` 栏位的需求（sprint-change-proposal 提及）本 Story 不处理，留给 Story 4.5 或 2.4

### Project Structure Notes

- 不新增新的 Vue 元件档案，播放逻辑直接在 HistoryView.vue 内实作
- 不新增新的 store 档案，扩展现有 useSettingsStore 和 useHistoryStore
- Rust 端不新增新的 plugin 档案，扩展现有 audio_recorder.rs
- 遵循现有依赖方向：views → stores → lib → Rust Commands

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4] — AC 完整定义（lines 803-834）
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-15.md#问题 2+3] — 录音储存决策、清理策略、历史播放技术方案
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — SQLite Schema（`audio_file_path`、`status` 栏位定义）
- [Source: _bmad-output/planning-artifacts/architecture.md#录音档管理] — 储存位置、格式、命名、清理策略
- [Source: _bmad-output/planning-artifacts/architecture.md#Tauri Commands] — `save_recording_file`、`delete_all_recordings`、`cleanup_old_recordings` 定义
- [Source: _bmad-output/planning-artifacts/prd.md#FR37] — 录音永久储存与播放功能需求
- [Source: _bmad-output/planning-artifacts/prd.md#FR39] — 录音档清理设定（设定页面部分）
- [Source: src-tauri/src/plugins/audio_recorder.rs] — 现有 `StopRecordingResult`、`AudioRecorderState.wav_buffer`
- [Source: src/lib/database.ts] — 现有 schema version 3、migration 模式
- [Source: src/types/transcription.ts] — 现有 `TranscriptionRecord` 定义
- [Source: src/stores/useHistoryStore.ts] — 现有 SQL 常数、`RawTranscriptionRow`、`mapRowToRecord()`
- [Source: src/stores/useVoiceFlowStore.ts] — 现有 `stopListeningFlow()` 流程
- [Source: src/views/HistoryView.vue] — 现有历史记录列表 UI
- [Source: src/views/SettingsView.vue] — 现有设定页面 section 模式
- [Source: src/stores/useSettingsStore.ts] — 现有 tauri-plugin-store 读写封装

## Dev Agent Record

### Agent Model Used
claude-opus-4-6[1m]

### Debug Log References

### Completion Notes List
- Task 1-9 全部完成，Task 10（手动测试）需使用者验证
- Rust cargo check 通过，68 个 Rust 测试全过
- TypeScript vue-tsc --noEmit 通过
- Vitest 289 个测试全过（16 个测试档案）
- 既有测试已更新以匹配新的 `audioFilePath` 和 `status` 栏位
- `Cargo.toml` 新增 `protocol-asset` feature（asset protocol 需要）
- `tauri.conf.json` CSP 新增 `media-src` + `assetProtocol` scope（播放录音需要）
- `buildTranscriptionRecord` 的 `id` 参数改为外部传入，不再内部生成（ID 需在流程开头生成以供 save_recording_file 使用）

### Change Log
- 2026-03-15: Task 1-9 实作完成

### File List
- `src/lib/database.ts` — Migration v3→v4
- `src-tauri/src/plugins/audio_recorder.rs` — 3 个新 Commands + Manager import
- `src-tauri/src/lib.rs` — invoke_handler 注册 3 个新 Commands
- `src-tauri/Cargo.toml` — 新增 protocol-asset feature
- `src-tauri/tauri.conf.json` — CSP media-src + assetProtocol scope
- `src/types/transcription.ts` — TranscriptionRecord 扩展
- `src/stores/useHistoryStore.ts` — SQL + 型别 + clearAudioFilePath 方法
- `src/stores/useVoiceFlowStore.ts` — 录音储存整合 + 失败记录写入
- `src/stores/useSettingsStore.ts` — 新增清理设定
- `src/views/HistoryView.vue` — 播放按钮 + failed Badge
- `src/views/SettingsView.vue` — 录音储存管理 section
- `src/main-window.ts` — App 启动自动清理
- `src/i18n/locales/zh-TW.json` — 翻译键
- `src/i18n/locales/en.json` — 翻译键
- `src/i18n/locales/ja.json` — 翻译键
- `src/i18n/locales/zh-CN.json` — 翻译键
- `src/i18n/locales/ko.json` — 翻译键
- `tests/unit/use-history-store.test.ts` — 更新测试
- `tests/unit/use-voice-flow-store.test.ts` — 更新测试
