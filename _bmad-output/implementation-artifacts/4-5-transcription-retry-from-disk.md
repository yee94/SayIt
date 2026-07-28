# Story 4.5: 转录失败一键重送

Status: done

## Story

As a 使用者,
I want 转录失败时可以一键重送录音给 Whisper,
so that 我不需要崩溃重讲。

## Acceptance Criteria

1. **AC1: HUD error 状态显示重送按钮**
   - Given HUD 显示 error 状态
   - When 该次失败有对应的录音档案存在于磁碟（`audioFilePath !== null`）且尚未尝试过重送
   - Then 显示重送按钮（不区分是否确定有说话）
   - And 重送按钮沿用现有 retry-icon（`&#x21BB;`），位于 notch-right 区域
   - And 录音太短（< 300ms）虽写入 failed 但 audioFilePath 仍有值，透过 `canRetry` 控制（录音太短不启用重送）

2. **AC2: 点击重送触发重新转录**
   - Given 使用者点击重送按钮
   - When 上一次录音的 WAV 档案存在于磁碟
   - Then 从磁碟读取 WAV 档案（透过新增的 `retranscribe_from_file` Rust Command）
   - And HUD 切换为「转录中...」（复用 `transcribing` 状态）
   - And 重新呼叫 Whisper API 进行转录

3. **AC3: 重送成功**
   - Given 重送的 Whisper API 回传有效文字
   - When 转录结果非空
   - Then 进入正常的 AI 整理 → 贴上流程（复用 `completePasteFlow`）
   - And 更新 `transcriptions` 表的 `status` 从 `failed` 更新为 `success`
   - And 更新 `rawText`、`processedText`、`transcriptionDurationMs`、`enhancementDurationMs` 等栏位

4. **AC4: 重送也失败**
   - Given 重送的 Whisper API 再次回传空字串
   - When 二次转录失败
   - Then HUD 显示「辨识失败，请重新录音」
   - And 不再提供重送按钮（限重送 1 次）

5. **AC5: 重送次数限制**
   - Given HUD error 状态
   - When 已执行过一次重送
   - Then 第二次失败后不再显示重送按钮
   - And 使用者只能重新录音

## Tasks / Subtasks

- [x] Task 1: 新增 `retranscribe_from_file` Rust Command（AC: #2）
  - [x] 1.1 在 `transcription.rs` 新增 `retranscribe_from_file` Command
  - [x] 1.2 Command 接收 `file_path: String`（WAV 完整路径）+ `api_key`、`vocabulary_term_list`、`model_id`、`language` 参数
  - [x] 1.3 从磁碟读取 WAV 档案（`std::fs::read`）取代从 `wav_buffer` 取得
  - [x] 1.4 复用 `transcribe_audio` 中的 Groq API 呼叫逻辑（提取共用函式 `send_transcription_request`）
  - [x] 1.5 回传 `Result<TranscriptionResult, TranscriptionError>`（与 `transcribe_audio` 相同型别）
  - [x] 1.6 在 `lib.rs` 的 `invoke_handler` 注册 `retranscribe_from_file`

- [x] Task 2: useVoiceFlowStore 新增重送状态与流程（AC: #1, #2, #3, #4, #5）
  - [x] 2.1 新增 `lastFailedTranscriptionId: ref<string | null>` — 追踪上一次失败的 transcription ID
  - [x] 2.2 新增 `lastFailedAudioFilePath: ref<string | null>` — 追踪上一次失败的录音档路径
  - [x] 2.3 新增 `lastFailedRecordingDurationMs: ref<number>` — 追踪上一次失败的录音时长（供 record 建立用）
  - [x] 2.4 新增 `isRetryAttempt: ref<boolean>` — 标记当前是否为重送尝试
  - [x] 2.5 新增 `canRetry: computed<boolean>` — `status === 'error' && lastFailedAudioFilePath !== null && !isRetryAttempt`
  - [x] 2.6 在失败流程（空转录、API 错误）中设定 `lastFailedTranscriptionId`、`lastFailedAudioFilePath`、`lastFailedRecordingDurationMs`
  - [x] 2.7 录音太短（< 300ms）不设定重送状态（没有意义重送太短的录音）
  - [x] 2.8 在 `handleStartRecording()` 开头重置所有重送状态（`lastFailedTranscriptionId = null`、`lastFailedAudioFilePath = null`、`isRetryAttempt = false`）
  - [x] 2.9 在 store `return` 区块 expose `canRetry` 和 `handleRetryTranscription`（现有 return 只有 status/message/recordingElapsedSeconds/lastWasModified/initialize/cleanup/transitionTo）

- [x] Task 3: 实作 `handleRetryTranscription()` 方法（AC: #2, #3, #4）
  - [x] 3.1 新增 `handleRetryTranscription()` async 方法（expose 给 App.vue）
  - [x] 3.2 设定 `isRetryAttempt = true`，清除 auto-hide timer
  - [x] 3.3 切换 HUD 为 `transcribing` 状态（复用 `transitionTo('transcribing', t('voiceFlow.transcribing'))`）
  - [x] 3.4 呼叫 `invoke<TranscriptionResult>('retranscribe_from_file', { filePath, apiKey, vocabularyTermList, modelId, language })`
  - [x] 3.5 成功时：进入 AI 整理 → `completePasteFlow`，更新 DB（`updateTranscriptionOnRetrySuccess`），记录 Whisper API 用量（`saveApiUsageRecordList`）
  - [x] 3.6 失败时（空转录或 API 错误）：`transitionTo('error', t('voiceFlow.retryFailed'))`，清除 `lastFailedAudioFilePath`，重置 `isRetryAttempt = false`
  - [x] 3.7 注意：成功时 `isRetryAttempt` 在 `completePasteFlow` 回来后重置；失败时在 catch 中立即重置

- [x] Task 4: useHistoryStore 新增 `updateTranscriptionOnRetrySuccess()` 方法（AC: #3）
  - [x] 4.1 新增 SQL 常数 `UPDATE_ON_RETRY_SUCCESS_SQL`：`UPDATE transcriptions SET status = 'success', raw_text = $1, processed_text = $2, transcription_duration_ms = $3, enhancement_duration_ms = $4, was_enhanced = $5, char_count = $6 WHERE id = $7`
  - [x] 4.2 实作 `updateTranscriptionOnRetrySuccess(params)` 方法
  - [x] 4.3 更新后发送 `TRANSCRIPTION_COMPLETED` 事件通知 Dashboard 更新

- [x] Task 5: App.vue 修改 handleRetry 为呼叫重送流程（AC: #1, #2）
  - [x] 5.1 将 `handleRetry()` 从「开启 Dashboard」改为呼叫 `voiceFlowStore.handleRetryTranscription()`
  - [x] 5.2 移除现有的 `Window.getByLabel('main-window')` 相关逻辑
  - [x] 5.3 `Window` import 仍需保留（`onMounted` 中 line 58 仍使用 `Window.getByLabel('main-window')` 启动时开 Dashboard）
  - [x] 5.4 传递 `canRetry` prop 给 NotchHud：`:can-retry="voiceFlowStore.canRetry"`

- [x] Task 6: NotchHud.vue 重送按钮显示逻辑调整（AC: #1, #5）
  - [x] 6.1 新增 `canRetry` prop（`boolean`，来自 `voiceFlowStore.canRetry`）
  - [x] 6.2 重送按钮的 `v-if` 条件改为 `visualMode === 'error' && canRetry`
  - [x] 6.3 确保重送后（isRetryAttempt = true）按钮消失

- [x] Task 7: i18n 翻译键新增（AC: #4）
  - [x] 7.1 5 个 locale JSON 新增 `voiceFlow.retryFailed` 翻译键
  - [x] 7.2 zh-TW: `"辨识失败，请重新录音"`
  - [x] 7.3 en: `"Recognition failed, please record again"`
  - [x] 7.4 ja: `"认识失败、もう一度录音してください"`
  - [x] 7.5 zh-CN: `"识别失败，请重新录音"`
  - [x] 7.6 ko: `"인식 실패, 다시 녹음해 주세요"`

- [x] Task 8: 单元测试（AC: #1-#5）
  - [x] 8.1 `useVoiceFlowStore` 测试：重送成功流程
  - [x] 8.2 `useVoiceFlowStore` 测试：重送失败流程（不再提供重送）
  - [x] 8.3 `useVoiceFlowStore` 测试：录音太短不启用重送
  - [x] 8.4 `useVoiceFlowStore` 测试：canRetry computed 逻辑

- [ ] Task 9: 手动测试验证（AC: #1-#5）
  - [ ] 9.1 验证 HUD error 状态显示重送按钮
  - [ ] 9.2 验证点击重送后 HUD 切换为 transcribing
  - [ ] 9.3 验证重送成功后正常贴上 + DB status 更新为 success
  - [ ] 9.4 验证重送失败后显示「辨识失败，请重新录音」且无重送按钮
  - [ ] 9.5 验证新录音时重送状态正确重置

### Review Follow-ups (AI)

- [ ] [AI-Review][CRITICAL] F1: `completePasteFlow` 中 INSERT 与 UPDATE 冲突 — 重送成功时 `completePasteFlow` 内部 `saveTranscriptionRecord` 尝试 INSERT 已存在的 id（PRIMARY KEY 冲突），且 `saveApiUsageRecordList` 被呼叫两次导致 API 用量双倍记录 [src/stores/useVoiceFlowStore.ts:1166,1194,1219,1245,1261,1285]
- [ ] [AI-Review][HIGH] F2: 重送期间缺乏竞态保护 — `handleRetryTranscription` 不设定 `isRecording = true`，hotkey 可同时触发新录音，导致重送结果与新录音流程冲突 [src/stores/useVoiceFlowStore.ts:793,1073]
- [ ] [AI-Review][HIGH] F3: 测试未涵盖重复 INSERT/API 用量场景 — 重送成功测试未验证 `mockAddTranscription` 不被呼叫 + `mockAddApiUsage` 不被重复呼叫，掩盖 F1 bug [tests/unit/use-voice-flow-store.test.ts:1902-1947]
- [ ] [AI-Review][MEDIUM] F4: `updateTranscriptionOnRetrySuccess` payload 中 `recordingDurationMs` 硬编码为 0 — 应使用 `lastFailedRecordingDurationMs` 或传入实际值 [src/stores/useHistoryStore.ts:507]
- [ ] [AI-Review][MEDIUM] F5: `retranscribe_from_file` 缺乏 file_path 基本验证 — 无路径检查、副档名检查、目录范围限制 [src-tauri/src/plugins/transcription.rs:229-262]
- [ ] [AI-Review][LOW] F6: 部分 NotchHud 测试未传入 `canRetry` 必要 prop — 多数既有测试缺少此 prop，产生 Vue runtime 警告 [tests/component/NotchHud.test.ts:45,57,68,107,125]
- [ ] [AI-Review][LOW] F7: `std::fs::read` 同步 I/O 在 async context — 目前影响可忽略但应留意未来大档案场景 [src-tauri/src/plugins/transcription.rs:243]

## Dev Notes

### 现有骨架分析

| 档案 | 现状 | Story 4.5 任务 |
|------|------|----------------|
| `src-tauri/src/plugins/transcription.rs` | `transcribe_audio` 从 `wav_buffer` 取 WAV → Groq API | 新增 `retranscribe_from_file`：从磁碟读 WAV → Groq API（提取共用函式） |
| `src-tauri/src/lib.rs` | 已有 `invoke_handler` 注册区块 | 新增 1 个 Command 注册 |
| `src/stores/useVoiceFlowStore.ts` | `handleStopRecording()` 含完整流程 + 失败记录写入 | 新增 `handleRetryTranscription()` + 重送状态 refs |
| `src/stores/useHistoryStore.ts` | `addTranscription()` 负责 INSERT | 新增 `updateTranscriptionOnRetrySuccess()` 负责 UPDATE |
| `src/App.vue` | `handleRetry()` 目前只开 Dashboard | 改为呼叫 `voiceFlowStore.handleRetryTranscription()` |
| `src/components/NotchHud.vue` | error 状态已有 retry-icon + `@retry` emit | 新增 `canRetry` prop 控制按钮显示 |

### Rust `retranscribe_from_file` 设计要点

```
 transcribe_audio()          retranscribe_from_file()
       │                              │
       ▼                              ▼
  wav_buffer.take()              std::fs::read(file_path)
       │                              │
       └──────────┬───────────────────┘
                  │
                  ▼
      send_transcription_request(wav_data, ...)
                  │
                  ▼
       TranscriptionResult
```

重构策略：将 `transcribe_audio` 中「组装 multipart form → 发送 API → 解析回应」的逻辑提取为内部共用函式 `send_transcription_request(wav_data: Vec<u8>, ...)`，两个 Command 共用。

```rust
#[command]
pub async fn retranscribe_from_file(
    transcription_state: State<'_, TranscriptionState>,
    file_path: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    // 注意：std::fs::read 是同步 I/O，但 WAV 档案通常很小（< 1MB），
    // 在 Tauri command 的 async context 中可接受。
    // 若未来需要处理大档案，改用 tokio::fs::read。
    let wav_data = std::fs::read(&file_path)
        .map_err(|e| TranscriptionError::RequestFailed(
            format!("Failed to read WAV file: {}", e)
        ))?;
    send_transcription_request(
        wav_data, transcription_state, api_key,
        vocabulary_term_list, model_id, language,
    ).await
}
```

**注意**：
- `retranscribe_from_file` 不需要 `AudioRecorderState`（不从 wav_buffer 取资料），只需要 `TranscriptionState`（Groq client + prompt 格式化）。
- 提取的 `send_transcription_request` 是内部函式（非 `#[command]`），参数中 `TranscriptionState` 应以 `&TranscriptionState` 引用传入（不是 `State<'_, T>` wrapper）。两个 Command 各自解包 `State<>` 后传引用给共用函式。
- `MINIMUM_AUDIO_SIZE` 检查应保留在共用函式中（从磁碟读取的档案也可能损坏或过小）。

### useVoiceFlowStore 重送流程

```
 App.vue handleRetry()
       │
       ▼
 voiceFlowStore.handleRetryTranscription()
       │
  isRetryAttempt = true
  transitionTo('transcribing')
       │
       ▼
 invoke('retranscribe_from_file', {
   filePath: lastFailedAudioFilePath,
   apiKey, vocabularyTermList, modelId, language
 })
       │
  ┌────┴────┐
  ▼         ▼
成功       失败
  │         │
  ▼         ▼
 AI 整理    transitionTo('error', '辨识失败，请重新录音')
 → paste    清除 lastFailedAudioFilePath
 → UPDATE   isRetryAttempt = false
 DB status
 → API usage
```

### 失败场景分类与重送行为

| 失败场景 | 设定重送状态？ | 理由 |
|---------|-------------|------|
| 空转录（Whisper 回传空字串） | 是 | 主要重送目标 |
| API 错误（网路/伺服器错误） | 是 | 暂时性问题，重送有意义 |
| 录音太短（< 300ms） | 否 | 重送太短录音无意义 |
| save_recording_file 失败 | 否 | 无档案可重送（audioFilePath = null） |

### 重送状态生命周期

```
 正常录音失败 → 设定 lastFailed* → canRetry = true
       │
  使用者点击重送
       │
  isRetryAttempt = true → canRetry = false（按钮消失）
       │
  ┌────┴────┐
  ▼         ▼
成功       失败
  │         │
  ▼         ▼
重置所有    清除 lastFailedAudioFilePath
lastFailed* isRetryAttempt = false
状态       canRetry = false（无路径可重送）

 新录音开始 → 重置所有 lastFailed* + isRetryAttempt
```

### DB UPDATE 策略

重送成功时需要 UPDATE 而非 INSERT：

```sql
UPDATE transcriptions
SET status = 'success',
    raw_text = $1,
    processed_text = $2,
    transcription_duration_ms = $3,
    enhancement_duration_ms = $4,
    was_enhanced = $5,
    char_count = $6
WHERE id = $7
```

不需更新的栏位：`id`、`created_at`、`audio_file_path`、`recording_duration_ms`、`trigger_mode`。

### 现有 handleRetry 行为变更（Breaking Change）

App.vue 的 `handleRetry()` 目前只是打开 Dashboard：
```typescript
async function handleRetry() {
  const mainWindow = await Window.getByLabel("main-window");
  if (!mainWindow) return;
  await mainWindow.show();
  await mainWindow.setFocus();
}
```

Story 4.5 将此改为实际的重送转录操作。使用者不再需要手动去 Dashboard 重新处理。

### Store Return 扩展

现有 return 区块（line 1119）：
```typescript
return {
  status, message, recordingElapsedSeconds, lastWasModified,
  initialize, cleanup, transitionTo,
};
```

需新增：
```typescript
return {
  status, message, recordingElapsedSeconds, lastWasModified,
  canRetry,                    // 新增
  initialize, cleanup, transitionTo,
  handleRetryTranscription,    // 新增
};
```

### HUD 互动注意事项

error 状态时 `setIgnoreCursorEvents(false)` 已在 `transitionTo('error')` 中设定，所以重送按钮可以接收点击事件。重送触发后切换为 `transcribing`，此时 `setIgnoreCursorEvents(true)` 会自动恢复。

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src-tauri/src/plugins/transcription.rs` | 提取共用函式 + 新增 `retranscribe_from_file` Command |
| `src-tauri/src/lib.rs` | `invoke_handler` 注册 1 个新 Command |
| `src/stores/useVoiceFlowStore.ts` | 新增重送状态 refs + `handleRetryTranscription()` + `canRetry` computed + expose |
| `src/stores/useHistoryStore.ts` | 新增 `updateTranscriptionOnRetrySuccess()` |
| `src/App.vue` | `handleRetry()` 改呼叫 `voiceFlowStore.handleRetryTranscription()` |
| `src/components/NotchHud.vue` | 新增 `canRetry` prop + 条件渲染 |
| `src/i18n/locales/*.json`（5 个） | 新增 `voiceFlow.retryFailed` 翻译键 |

### 不需修改的档案

- `src/lib/database.ts` — 不需 migration（schema 不变）
- `src/types/transcription.ts` — 型别不变
- `src/types/audio.ts` — 型别不变
- `src/composables/useTauriEvents.ts` — 不新增事件常数（重送不需要新事件）
- `src/router.ts` — 路由不变
- `src/MainApp.vue` — sidebar 不变
- `src/views/HistoryView.vue` — 历史页面不变
- `src/views/SettingsView.vue` — 设定页面不变

### 跨 Story 备注

- **Story 4.4**（前置，已完成）：提供 `audio_file_path` 和 `status` 栏位 + 录音档磁碟储存 + 失败记录写入机制
- **Story 2.4**（后续，v0.9.0）：幻觉侦测拦截也会设定 `status: 'failed'`，届时也应启用重送机制
- `transcribe_audio` 的 `wav_buffer.take()` 是一次性消费，重送时 buffer 已空，必须从磁碟读取

### 依赖 Story 4.4 的前提

Story 4.5 假设以下已完成：
- `transcriptions` 表有 `audio_file_path` 和 `status` 栏位（Migration v4）
- `save_recording_file` Command 已实作并在失败流程中保存录音
- `useVoiceFlowStore.handleStopRecording()` 失败时写入 `status: 'failed'` 记录
- `HistoryView` 显示 failed 记录的 Badge

### Project Structure Notes

- 不新增新的 Vue 元件档案
- 不新增新的 store 档案
- 不新增新的 Rust plugin 档案（扩展现有 `transcription.rs`）
- 遵循现有依赖方向：App.vue → stores → lib → Rust Commands

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5] — AC 完整定义（lines 835-862）
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-15.md#问题 2+3] — 重送机制决策、流程图、限制条件
- [Source: _bmad-output/implementation-artifacts/4-4-recording-storage-history-playback.md] — 前置 Story 完整规格，audio_file_path 和 status 栏位来源
- [Source: src-tauri/src/plugins/transcription.rs] — 现有 `transcribe_audio` Command（wav_buffer.take() + Groq API 呼叫）
- [Source: src/stores/useVoiceFlowStore.ts] — 现有 `handleStopRecording()` 流程、`failRecordingFlow()`、`completePasteFlow()`
- [Source: src/App.vue] — 现有 `handleRetry()` 只开 Dashboard
- [Source: src/components/NotchHud.vue] — 现有 retry-icon + `@retry` emit
- [Source: src/stores/useHistoryStore.ts] — 现有 `addTranscription()` INSERT 机制
- [Source: src/types/audio.ts] — `TranscriptionResult` 型别定义
- [Source: src/types/transcription.ts] — `TranscriptionRecord` 型别定义

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Rust cargo check: pass, cargo test: 68/68 pass
- vue-tsc --noEmit: pass (no errors)
- Vitest: 302/302 pass (was 290, added 12 new tests)

### Completion Notes List

- Task 1: 提取 `send_transcription_request` 共用函式，`transcribe_audio` 和 `retranscribe_from_file` 共用 API 呼叫逻辑
- Task 2: 新增 4 个 ref + 1 个 computed，在空转录和 API 错误时设定重送状态，录音太短不设定
- Task 3: `handleRetryTranscription()` 完整实作三条路径（AI 整理成功、AI 整理失败 fallback、跳过 AI 整理）
- Task 4: `UPDATE_ON_RETRY_SUCCESS_SQL` + `updateTranscriptionOnRetrySuccess()` + emit `TRANSCRIPTION_COMPLETED`
- Task 5: `handleRetry()` 改为呼叫 store 方法，传递 `canRetry` prop
- Task 6: retry icon 的 `v-if` 加上 `canRetry` 条件
- Task 7: 5 个 locale 档案各新增 `voiceFlow.retryFailed`
- Task 8: 8 个 VoiceFlow 重送测试 + 4 个 HistoryStore updateTranscriptionOnRetrySuccess 测试
- Task 9: 手动测试待执行

### Change Log

- 2026-03-15: Tasks 1-8 完成，Task 9（手动测试）待执行
- 2026-03-15: AI Code Review 完成 — 发现 1 CRITICAL + 2 HIGH + 2 MEDIUM + 2 LOW，共 7 个 action items 已建立

### File List

- `src-tauri/src/plugins/transcription.rs` — 提取 `send_transcription_request` + 新增 `retranscribe_from_file` Command
- `src-tauri/src/lib.rs` — 注册 `retranscribe_from_file` 至 `invoke_handler`
- `src/stores/useVoiceFlowStore.ts` — 重送状态 refs + `canRetry` computed + `handleRetryTranscription()` + 失败时设定重送状态
- `src/stores/useHistoryStore.ts` — `UPDATE_ON_RETRY_SUCCESS_SQL` + `updateTranscriptionOnRetrySuccess()`
- `src/App.vue` — `handleRetry()` 改呼叫 store + 传递 `canRetry` prop
- `src/components/NotchHud.vue` — 新增 `canRetry` prop + 条件渲染
- `src/i18n/locales/zh-TW.json` — 新增 `voiceFlow.retryFailed`
- `src/i18n/locales/en.json` — 新增 `voiceFlow.retryFailed`
- `src/i18n/locales/ja.json` — 新增 `voiceFlow.retryFailed`
- `src/i18n/locales/zh-CN.json` — 新增 `voiceFlow.retryFailed`
- `src/i18n/locales/ko.json` — 新增 `voiceFlow.retryFailed`
- `tests/unit/use-voice-flow-store.test.ts` — 8 个重送测试
- `tests/unit/use-history-store.test.ts` — 4 个 updateTranscriptionOnRetrySuccess 测试
- `tests/component/NotchHud.test.ts` — 更新 2 个既有测试 + 新增 1 个 canRetry=false 测试
