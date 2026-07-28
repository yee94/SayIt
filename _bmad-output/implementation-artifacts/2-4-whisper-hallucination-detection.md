> **⚠️ 历史档案** — 此文件记录 v0.8.0–v0.8.6 期间的四层幻觉侦测规范，已于 v0.8.7 简化为二层纯物理信号侦测。幻觉字典、自动学习、HallucinationView 等功能已全部移除。当前规范见 `_bmad-output/project-context.md`。

# Story 2.4: Whisper 幻觉侦测与自动学习

Status: done

## Story

As a 使用者,
I want 系统自动侦测并拦截 Whisper 幻觉文字,
So that 没讲话或很短停顿时不会有乱码被贴入编辑器。

## Acceptance Criteria

1. **AC1: Layer 1 — 语速异常侦测（强判定）**
   - Given 转录结果回传
   - When 录音时长 < 1 秒且文字 > 10 字（语速异常，物理上不可能）
   - Then 判定为幻觉，不贴上，HUD 显示「未侦测到语音」
   - And 该文字自动加入 `hallucination_terms` 表（`source: 'auto'`）
   - And HUD 短暂通知「已学习幻觉词：{text}」（使用独立 `hallucination:learned` 事件）

2. **AC2: Layer 2 + Layer 3 组合侦测（强判定）**
   - Given 转录结果回传
   - When `noSpeechProbability > 0.9` 且文字完全命中幻觉词库（精确匹配或包含匹配）
   - Then 判定为幻觉，不贴上，HUD 显示「未侦测到语音」

3. **AC3: 双层弱可疑组合判定**
   - Given 转录结果回传
   - When 两层弱可疑指标同时成立：`noSpeechProbability > 0.7` 且语速偏高（录音时长 < 2 秒且文字 > 15 字）
   - Then 判定为幻觉，不贴上，HUD 显示「未侦测到语音」

4. **AC4: 单层弱可疑放行**
   - Given 转录结果回传
   - When 只有单一层弱可疑指标成立（仅 `noSpeechProbability > 0.7`，或仅语速偏高，但不同时成立）
   - Then 放行，正常贴上

5. **AC5: 多语言内建幻觉词库**
   - Given 转录语言设定为不同语言
   - When 幻觉侦测 Layer 3 载入内建词库
   - Then 根据 `selectedTranscriptionLocale` 载入对应语言的幻觉词库
   - And `zh`（含 `zh-TW`、`zh-CN`）载入中文幻觉词（「谢谢收看」「字幕组」「请订阅」「感谢观看」等）
   - And `en` 载入英文幻觉词（「Thank you for watching」「Subscribe」「Like and share」等）
   - And `ja` 载入日文幻觉词（「ご视聴ありがとう」「チャンネル登录」等）
   - And `ko` 载入韩文幻觉词（「시청해 주셔서 감사합니다」「구독」等）
   - And `auto` 载入所有语言的幻觉词库（合并）

6. **AC6: 幻觉词库管理页面**
   - Given 幻觉词库页面（`HallucinationView.vue`）
   - When 使用者从侧边栏导航至 `/hallucinations`
   - Then 显示所有幻觉词（内建 + 自动学习 + 手动新增），标示来源分类
   - And 使用者可手动新增幻觉词（`source: 'manual'`）
   - And 使用者可删除自动学习和手动新增的幻觉词（内建词不可删除）
   - And 页面顶部显示幻觉词总数统计

7. **AC7: HUD 学习通知**
   - Given 幻觉文字被自动加入词库
   - When Layer 1 语速异常强判定触发自动学习
   - Then HUD 短暂播放学习音效（复用 `play_learned_sound`）
   - And HUD 显示「已学习」通知（复用 `vocabulary:learned` 事件 + NotchHud 现有通知机制）

8. **AC8: 幻觉拦截后的历史记录与重送**
   - Given 幻觉侦测判定结果为幻觉
   - When 拦截不贴上
   - Then 仍然写入 `transcriptions` 表，`status` 为 `failed`（复用 Story 4.4 的 failed 记录机制）
   - And 录音档案仍然保存（复用 Story 4.4 的录音储存机制）
   - And 设定 `lastFailedTranscriptionId`、`lastFailedAudioFilePath`、`lastFailedRecordingDurationMs` 重送状态
   - And 重送按钮显示（`canRetry` computed 自动为 true，复用 Story 4.5 的重送机制）

## Tasks / Subtasks

- [x] Task 1: SQLite Migration v4 → v5（AC: #1, #6）
  - [x] 1.1 在 `database.ts` 新增 migration v5（沿用 v4 的 TRANSACTION 模式）
  - [x] 1.2 建立 `hallucination_terms` 表：
    ```sql
    CREATE TABLE IF NOT EXISTS hallucination_terms (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK(source IN ('builtin', 'auto', 'manual')),
      locale TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
  - [x] 1.3 建立索引：`CREATE INDEX IF NOT EXISTS idx_hallucination_terms_locale ON hallucination_terms(locale);`
  - [x] 1.4 更新 `schema_version` 至 5

- [x] Task 2: 幻觉侦测模组 — `src/lib/hallucinationDetector.ts`（AC: #1, #2, #3, #4）
  - [x] 2.1 建立 `src/lib/hallucinationDetector.ts`，定义 `HallucinationDetectionResult` 型别：
    ```typescript
    export interface HallucinationDetectionResult {
      isHallucination: boolean;
      reason: 'speed-anomaly' | 'high-nsp-term-match' | 'dual-weak-suspicious' | null;
      shouldAutoLearn: boolean;
      detectedText: string;
    }
    ```
  - [x] 2.2 定义常数：
    - `SPEED_ANOMALY_MAX_DURATION_MS = 1000`（Layer 1 录音时长门槛）
    - `SPEED_ANOMALY_MIN_CHARS = 10`（Layer 1 文字长度门槛）
    - `HIGH_NSP_THRESHOLD = 0.9`（Layer 2 强判定门槛）
    - `WEAK_NSP_THRESHOLD = 0.7`（Layer 2 弱可疑门槛）
    - `WEAK_SPEED_MAX_DURATION_MS = 2000`（弱可疑语速门槛）
    - `WEAK_SPEED_MIN_CHARS = 15`（弱可疑文字长度门槛）
  - [x] 2.3 实作 `detectHallucination(params: { rawText: string; recordingDurationMs: number; noSpeechProbability: number; hallucinationTermList: string[] }): HallucinationDetectionResult`
    - Layer 1：录音时长 < 1000ms 且文字字数 > 10 → `isHallucination: true, reason: 'speed-anomaly', shouldAutoLearn: true`
    - Layer 2 + 3：`noSpeechProbability > 0.9` 且 `rawText` 命中幻觉词库 → `isHallucination: true, reason: 'high-nsp-term-match', shouldAutoLearn: false`
    - 双弱可疑：`noSpeechProbability > 0.7` 且录音 < 2000ms 且字数 > 15 → `isHallucination: true, reason: 'dual-weak-suspicious', shouldAutoLearn: false`
    - 其他 → `isHallucination: false, reason: null, shouldAutoLearn: false`
  - [x] 2.4 实作 `matchesHallucinationTermList(text: string, termList: string[]): boolean` — 精确匹配（`text.trim() === term`）或包含匹配（`text.includes(term)`）。包含匹配可能有误判（如「谢谢大家好」包含「谢谢大家」），但此函式只在 Layer 2+3 中使用（需 `noSpeechProbability > 0.9` 前置条件），实际误判风险极低

- [x] Task 3: 多语言内建幻觉词库 — `src/lib/builtinHallucinationTerms.ts`（AC: #5）
  - [x] 3.1 建立 `src/lib/builtinHallucinationTerms.ts`
  - [x] 3.2 定义 `BUILTIN_HALLUCINATION_TERMS: Record<string, string[]>` — 以 Whisper 语言 code 为 key：
    - `zh`：「谢谢收看」「字幕组」「请订阅」「感谢观看」「欢迎订阅」「谢谢大家」「下期再见」「感谢收听」「请点赞」等
    - `en`：「Thank you for watching」「Subscribe」「Like and share」「Please subscribe」「Thanks for watching」等
    - `ja`：「ご视聴ありがとう」「チャンネル登录」「ご视聴ありがとうございました」等
    - `ko`：「시청해 주셔서 감사합니다」「구독」「좋아요」等
  - [x] 3.3 实作 `getBuiltinTermListForLocale(transcriptionLocale: TranscriptionLocale): string[]`：
    - `zh-TW` / `zh-CN` → 回传 `zh` 词库
    - `en` → 回传 `en` 词库
    - `ja` → 回传 `ja` 词库
    - `ko` → 回传 `ko` 词库
    - `auto` → 合并所有语言的词库并去重

- [x] Task 4: `useHallucinationStore.ts` — Pinia Store（AC: #1, #5, #6）
  - [x] 4.1 建立 `src/stores/useHallucinationStore.ts`，`defineStore('hallucination', () => { ... })`
  - [x] 4.2 定义 `HallucinationTermEntry` 型别：
    ```typescript
    interface HallucinationTermEntry {
      id: string;
      term: string;
      source: 'builtin' | 'auto' | 'manual';
      locale: string;
      createdAt: string;
    }
    ```
  - [x] 4.3 实作 `fetchTermList(): Promise<void>` — 从 SQLite 读取所有幻觉词
  - [x] 4.4 实作 `addTerm(term: string, source: 'auto' | 'manual', locale: string): Promise<void>` — 新增幻觉词至 SQLite（重复时静默忽略）
  - [x] 4.5 实作 `removeTerm(id: string): Promise<void>` — 删除幻觉词（仅允许删除 `source !== 'builtin'` 的词）
  - [x] 4.6 实作 `getTermListForDetection(transcriptionLocale: TranscriptionLocale): Promise<string[]>`：
    - 先将 `TranscriptionLocale` 映射为 Whisper language code list（`zh-TW`/`zh-CN` → `['zh']`、`auto` → `['zh', 'en', 'ja', 'ko']`）
    - 从 DB 查询 `WHERE locale IN (...)` 取得使用者自订/自动学习的幻觉词
    - 合并 `getBuiltinTermListForLocale(transcriptionLocale)` 的内建词库
    - 回传去重清单
  - [x] 4.7 实作 `initializeBuiltinTerms(): Promise<void>` — App 启动时将 `builtinHallucinationTerms.ts` 的内建词写入 DB（`INSERT OR IGNORE`），`source: 'builtin'`
  - [x] 4.8 定义 `RawHallucinationTermRow` 介面 + `mapRowToEntry()` 映射函式（snake_case → camelCase）
  - [x] 4.9 expose `termList`, `addTerm`, `removeTerm`, `fetchTermList`, `getTermListForDetection`, `initializeBuiltinTerms`

- [x] Task 5: `useVoiceFlowStore` 整合幻觉侦测（AC: #1, #2, #3, #4, #7, #8）
  - [x] 5.1 在 `stopListeningFlow()` 中，`transcribe_audio` 成功回传后、`isEmptyTranscription` 检查之后，新增幻觉侦测逻辑
  - [x] 5.2 呼叫 `hallucinationStore.getTermListForDetection(transcriptionLocale)` 取得幻觉词清单
  - [x] 5.3 呼叫 `detectHallucination({ rawText, recordingDurationMs, noSpeechProbability, hallucinationTermList })`
  - [x] 5.4 若 `isHallucination === true`：
    - 写入 `transcriptions` 表，`status: 'failed'`（复用 `buildTranscriptionRecord` + `saveTranscriptionRecord`）
    - 设定重送状态：`lastFailedTranscriptionId = transcriptionId`、`lastFailedAudioFilePath = audioFilePath`、`lastFailedRecordingDurationMs = recordingDurationMs`（与空转录的重送设定逻辑一致）
    - 呼叫 `failRecordingFlow(t('voiceFlow.noSpeechDetected'), ...)`
  - [x] 5.5 若 `shouldAutoLearn === true`（在 5.4 的 return 之前执行）：
    - 取得 Whisper language code：`const whisperCode = settingsStore.getWhisperLanguageCode() ?? 'zh'`（用于 DB 中 locale 栏位）
    - 呼叫 `hallucinationStore.addTerm(rawText.trim(), 'auto', whisperCode)`
    - 发送独立 `hallucination:learned` 事件通知 HUD（payload: `{ termList: [rawText.trim()] }`）
    - HUD 收到后显示「已学习幻觉词」通知文字，与字典学习通知区分
  - [x] 5.6 若 `isHallucination === false`：继续现有流程（AI 整理 → 贴上）
  - [x] 5.7 在 `handleRetryTranscription()` 中也加入幻觉侦测（重送的转录结果同样需要检查）

- [x] Task 6: `HallucinationView.vue` — 幻觉词库管理页面（AC: #6）
  - [x] 6.1 建立 `src/views/HallucinationView.vue`
  - [x] 6.2 页面布局：
    - 顶部：标题 + 幻觉词总数统计
    - 新增区域：输入框 + 新增按钮（Enter 可新增）
    - 词库列表：每笔显示 `term`、`source` Badge（内建 / 自动学习 / 手动）、`locale`、新增时间
    - 删除按钮：`source === 'builtin'` 时 disabled
  - [x] 6.3 使用 shadcn-vue 元件（Badge, Button, Input, Table 等）
  - [x] 6.4 空状态：「尚无幻觉词记录，系统会自动学习 Whisper 常见幻觉文字」
  - [x] 6.5 列表按 `source` 分群（内建 → 自动学习 → 手动）或按时间排序，提供筛选
  - [x] 6.6 `onMounted` 呼叫 `hallucinationStore.fetchTermList()`

- [x] Task 7: Router + Sidebar 新增 `/hallucinations` 路由（AC: #6）
  - [x] 7.1 `src/router.ts` 新增路由：`{ path: "/hallucinations", component: HallucinationView }`
  - [x] 7.2 `src/MainApp.vue` 的 `navItems` 新增幻觉词库导航项：
    - `{ path: "/hallucinations", label: t("mainApp.nav.hallucinations"), icon: markRaw(ShieldAlert) }`
    - 位置：在「自订字典」和「设定」之间
  - [x] 7.3 import `ShieldAlert` from `lucide-vue-next`（或其他语意合适的图标）

- [x] Task 8: i18n 翻译键新增（AC: #1, #5, #6, #7）
  - [x] 8.1 5 个 locale JSON 新增以下翻译键群：
    - `mainApp.nav.hallucinations`：侧边栏导航项名称
    - `hallucination.title`：页面标题
    - `hallucination.totalCount`：「共 {count} 个幻觉词」
    - `hallucination.addPlaceholder`：输入框 placeholder
    - `hallucination.addButton`：新增按钮
    - `hallucination.emptyState`：空状态提示
    - `hallucination.sourceBuiltin`：「内建」
    - `hallucination.sourceAuto`：「自动学习」
    - `hallucination.sourceManual`：「手动新增」
    - `hallucination.deleteConfirm`：删除确认
    - `hallucination.duplicateWarning`：「此幻觉词已存在」
    - `voiceFlow.hallucinationLearned`：「已学习幻觉词」（HUD 通知用）
  - [x] 8.2 确保 5 个 locale 档案的 key 结构完全一致

- [x] Task 9: App 启动初始化内建幻觉词库（AC: #5）
  - [x] 9.1 在 `main-window.ts` 的启动流程中，`initializeDatabase()` 成功后呼叫 `hallucinationStore.initializeBuiltinTerms()`
  - [x] 9.2 HUD 视窗（`App.vue`）不执行 `initializeBuiltinTerms()`（避免双视窗同时写入 DB 的竞态问题）。HUD 中的 `getTermListForDetection()` 只做读取，依赖 Dashboard 视窗先完成初始化。若 Dashboard 尚未启动，`getTermListForDetection()` 仍能正确回传内建词库（因为 `getBuiltinTermListForLocale()` 是纯函式，不依赖 DB 中的 builtin 记录）
  - [x] 9.3 `initializeBuiltinTerms` 使用 `INSERT OR IGNORE` 确保幂等性（重复执行不会新增重复词）

- [ ] Task 10: 手动测试验证（AC: #1-#8）
  - [ ] 10.1 验证短录音（< 1 秒）产生长文字时被拦截
  - [ ] 10.2 验证高 noSpeechProbability + 命中幻觉词时被拦截
  - [ ] 10.3 验证双弱可疑组合被拦截
  - [ ] 10.4 验证单弱可疑正常放行
  - [ ] 10.5 验证自动学习后幻觉词出现在幻觉词库页面
  - [ ] 10.6 验证 HUD 显示学习通知
  - [ ] 10.7 验证拦截后重送按钮可用
  - [ ] 10.8 验证幻觉词库页面 CRUD 操作正常
  - [ ] 10.9 验证切换转录语言后，内建词库正确切换

### Review Follow-ups (AI)

- [ ] [AI-Review][HIGH] F1: HallucinationView.vue handleAddTerm() locale 硬编码为 "zh"，应从 settingsStore.getWhisperLanguageCode() 取得 [src/views/HallucinationView.vue:56]
- [ ] [AI-Review][HIGH] F2: handleRetryTranscription 幻觉拦截后使用 transitionTo 而非 failRecordingFlow，可能导致 HUD autoHide 行为不一致 [src/stores/useVoiceFlowStore.ts:1207-1214]
- [ ] [AI-Review][MEDIUM] F3: initializeBuiltinTerms 逐笔 INSERT 36 次 IPC 呼叫，建议包 TRANSACTION 或先检查是否已初始化 [src/stores/useHallucinationStore.ts:169-179]
- [ ] [AI-Review][MEDIUM] F4: matchesHallucinationTermList 英文比对 case-sensitive，Whisper 英文输出大小写不稳定可能导致漏命中 [src/lib/hallucinationDetector.ts:51-58]
- [ ] [AI-Review][MEDIUM] F5: hallucination.title i18n key 已定义但未使用（dead key） [src/views/HallucinationView.vue + 5 locale JSON]
- [ ] [AI-Review][MEDIUM] F6: AC7 文字自相矛盾（同时提到「独立事件」和「复用 vocabulary:learned」），需更正 Story 规格 [story AC7]
- [ ] [AI-Review][LOW] F7: HallucinationView.vue 错误/载入讯息复用 dictionary.* 翻译键，应新增 hallucination.loadFailed / hallucination.loading [src/views/HallucinationView.vue:95,160]
- [ ] [AI-Review][LOW] F8: 测试缺少 edge case：recordingDurationMs=0、noSpeechProbability 超出 0-1 范围 [tests/unit/hallucination-detector.test.ts]

## Dev Notes

### 架构模式与约束

**Brownfield 专案** — 基于 Story 2.3（品质监控）及 Story 4.4/4.5（录音储存 + 重送）继续扩展。本 Story 是 sprint change proposal 中问题 1 的实作，为 v0.9.0 核心功能。

**前置 Story 已完成的前提：**
- Story 4.4：`transcriptions` 表有 `audio_file_path` 和 `status` 栏位，`save_recording_file` Command 已实作
- Story 4.5：`retranscribe_from_file` Command、重送状态（`lastFailed*`）、`canRetry` computed、`handleRetryTranscription()` 已实作
- `TranscriptionResult` 已包含 `noSpeechProbability` 栏位（`src/types/audio.ts`）

**本 Story 的核心架构变更：**
1. 新增 SQLite `hallucination_terms` 表（Migration v5）
2. 新增 `hallucinationDetector.ts` — 纯逻辑侦测模组（`lib/` 层）
3. 新增 `builtinHallucinationTerms.ts` — 多语言内建词库（`lib/` 层）
4. 新增 `useHallucinationStore.ts` — 幻觉词库 CRUD Store
5. 新增 `HallucinationView.vue` — 幻觉词库管理页面
6. 修改 `useVoiceFlowStore.ts` — 整合幻觉侦测流程
7. 修改 `router.ts` + `MainApp.vue` — 新增路由和导航

**依赖方向规则（严格遵守）：**
```
views/HallucinationView.vue → stores/useHallucinationStore.ts → lib/database.ts
stores/useVoiceFlowStore.ts → lib/hallucinationDetector.ts（纯逻辑）
stores/useVoiceFlowStore.ts → stores/useHallucinationStore.ts（取词库清单）
lib/hallucinationDetector.ts → 无外部依赖（纯函式）
lib/builtinHallucinationTerms.ts → 无外部依赖（常数 + 纯函式）
```

**禁止：**
- views/ 不可直接 import `hallucinationDetector.ts`（必须透过 store）
- 元件不可直接执行 SQL
- 不使用 Tailwind 原生色彩
- 不硬编码使用者可见字串（全部走 i18n）

### 三层侦测逻辑流程图

```
 transcribe_audio() 回传 TranscriptionResult
       │
       ▼
 isEmptyTranscription(rawText)?
       │
   ┌───┤
   │   │ true → 既有的空转录流程（不变）
   │   │
   │   │ false ↓
   │   │
   │   ▼
   │ detectHallucination({
   │   rawText, recordingDurationMs,
   │   noSpeechProbability, hallucinationTermList
   │ })
   │   │
   │   ▼
   │ ┌──── Layer 1: 语速异常？ ────────────────────────┐
   │ │ recordingDurationMs < 1000 && chars > 10         │
   │ │     → 强判定幻觉 + 自动学习                       │
   │ └──────────────────────────────────────────────────┘
   │   │ no
   │   ▼
   │ ┌──── Layer 2+3: 高 NSP + 词库命中？ ──────────────┐
   │ │ noSpeechProbability > 0.9 && matchesTermList()    │
   │ │     → 强判定幻觉（不学习，已知词）                  │
   │ └──────────────────────────────────────────────────┘
   │   │ no
   │   ▼
   │ ┌──── 双弱可疑？ ─────────────────────────────────┐
   │ │ noSpeechProbability > 0.7 &&                     │
   │ │ recordingDurationMs < 2000 && chars > 15          │
   │ │     → 组合判定幻觉                                │
   │ └──────────────────────────────────────────────────┘
   │   │ no
   │   ▼
   │ 放行：进入正常 AI 整理 → 贴上流程
   │
   └── (空转录既有流程)
```

### `hallucination_terms` 表设计

| 栏位 | 型别 | 说明 |
|------|------|------|
| `id` | `TEXT PRIMARY KEY` | UUID（前端 `crypto.randomUUID()`） |
| `term` | `TEXT NOT NULL UNIQUE` | 幻觉词文字 |
| `source` | `TEXT NOT NULL` | `'builtin'` / `'auto'` / `'manual'` |
| `locale` | `TEXT NOT NULL` | 对应语言（`zh` / `en` / `ja` / `ko`） |
| `created_at` | `TEXT DEFAULT datetime('now')` | 建立时间 |

**与 `vocabulary` 表分开**的原因：语意不同（幻觉词是「要排除的」，字典词是「要保留的」），混用会增加查询复杂度。

**UNIQUE 约束设计决策**：`term TEXT NOT NULL UNIQUE` 表示同一文字全域唯一，不区分 locale。理由：幻觉词的本质是「不管哪个语言设定，只要出现就可疑」——例如使用者 `auto` 模式下自动学习了「谢谢大家」，之后切到 `zh-TW` 也应该能命中。若需要同文字多 locale 的场景（极少），可改为 `UNIQUE(term, locale)` 复合唯一。（**待确认**：见 Review Finding F2）

### hallucinationDetector.ts 设计

**纯函式模组**：不依赖 Vue/Pinia/Tauri，可单独测试。

```typescript
// hallucinationDetector.ts — 核心侦测逻辑

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  noSpeechProbability: number;
  hallucinationTermList: string[];
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason: 'speed-anomaly' | 'high-nsp-term-match' | 'dual-weak-suspicious' | null;
  shouldAutoLearn: boolean;
  detectedText: string;
}

export function detectHallucination(
  params: HallucinationDetectionParams
): HallucinationDetectionResult {
  const { rawText, recordingDurationMs, noSpeechProbability, hallucinationTermList } = params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 语速异常（物理定律级判断）
  if (recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS && charCount > SPEED_ANOMALY_MIN_CHARS) {
    return {
      isHallucination: true,
      reason: 'speed-anomaly',
      shouldAutoLearn: true,
      detectedText: trimmedText,
    };
  }

  // Layer 2 + 3: 高 NSP + 词库命中
  if (noSpeechProbability > HIGH_NSP_THRESHOLD
      && matchesHallucinationTermList(trimmedText, hallucinationTermList)) {
    return {
      isHallucination: true,
      reason: 'high-nsp-term-match',
      shouldAutoLearn: false,
      detectedText: trimmedText,
    };
  }

  // 双弱可疑组合
  const isWeakNsp = noSpeechProbability > WEAK_NSP_THRESHOLD;
  const isWeakSpeed = recordingDurationMs < WEAK_SPEED_MAX_DURATION_MS
                      && charCount > WEAK_SPEED_MIN_CHARS;
  if (isWeakNsp && isWeakSpeed) {
    return {
      isHallucination: true,
      reason: 'dual-weak-suspicious',
      shouldAutoLearn: false,
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    shouldAutoLearn: false,
    detectedText: trimmedText,
  };
}
```

### useVoiceFlowStore 修改策略

**插入点**：在 `isEmptyTranscription(result.rawText)` 判定为 false 之后、AI 整理分支之前。

```
 isEmptyTranscription(result.rawText)?
       │
       │ false
       ▼
 ┌─ 新增：幻觉侦测 ─────────────────────┐
 │ const hallucinationTermList =           │
 │   await hallucinationStore              │
 │     .getTermListForDetection(locale)    │
 │                                         │
 │ const detection = detectHallucination({ │
 │   rawText, recordingDurationMs,         │
 │   noSpeechProbability,                  │
 │   hallucinationTermList                 │
 │ })                                      │
 │                                         │
 │ if (detection.isHallucination) {        │
 │   // 写 failed 记录 + 设重送 + 自动学习│
 │   return;                               │
 │ }                                       │
 └─────────────────────────────────────────┘
       │
       ▼
 既有 AI 整理 → 贴上流程（不变）
```

**需修改的路径**：
1. `stopListeningFlow()` — 主流程
2. `handleRetryTranscription()` — 重送流程（也需要幻觉侦测）

**注意**：幻觉侦测是在非空转录结果上额外筛选。空转录（`isEmptyTranscription`）仍走既有流程，两者互不干扰。

### useHallucinationStore SQL 操作

```typescript
const FETCH_ALL_SQL = `
  SELECT id, term, source, locale, created_at
  FROM hallucination_terms
  ORDER BY source ASC, created_at DESC
`;

const INSERT_TERM_SQL = `
  INSERT OR IGNORE INTO hallucination_terms (id, term, source, locale)
  VALUES ($1, $2, $3, $4)
`;

const DELETE_TERM_SQL = `
  DELETE FROM hallucination_terms WHERE id = $1 AND source != 'builtin'
`;

const FETCH_BY_LOCALE_SQL = `
  SELECT term FROM hallucination_terms
  WHERE locale IN ($1)
`;
// 注意：auto 模式时需动态构建 WHERE locale IN ('zh', 'en', 'ja', 'ko')
// 或分次查询后合并，避免 SQL injection（tauri-plugin-sql 参数化不支援 IN 阵列）
```

### HallucinationView.vue 布局

```
┌─────────────────────────────────────────────────┐
│ 幻觉词库管理              共 42 个幻觉词         │
│                                                  │
│ ┌──────────────────────────────┐ ┌──────┐       │
│ │ 输入新的幻觉词...             │ │ 新增 │       │
│ └──────────────────────────────┘ └──────┘       │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │ 词汇              来源       语言   操作   │  │
│ ├────────────────────────────────────────────┤  │
│ │ 谢谢收看          [内建]     zh     —      │  │
│ │ Thank you for...  [内建]     en     —      │  │
│ │ 字幕由Amara提供   [自动学习]  zh     [删除] │  │
│ │ 请订阅我的频道     [手动]     zh     [删除] │  │
│ └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 跨 Story 备注

- **Story 4.4**（前置，已完成）：`status: 'failed'` 记录机制、`save_recording_file` Command
- **Story 4.5**（前置，已完成）：`retranscribe_from_file`、重送状态、`canRetry` computed
- **Story 2.2**（已完成）：Whisper prompt + AI 整理 prompt（幻觉侦测不影响 prompt 逻辑）
- **Story 2.3**（已完成）：品质监控在成功贴上后才启动，幻觉拦截不触发品质监控
- **v0.7.3 幻听策略修正**：目前 `isEmptyTranscription()` 只拦截完全空白。本 Story 新增的幻觉侦测是「非空白但可疑」的第二层过滤，两者互补而非替代

### 不需修改的 Rust 端

- **`TranscriptionResult`** 已包含 `noSpeechProbability`（`src/types/audio.ts`）
- **`StopRecordingResult`** 已包含 `recordingDurationMs`
- **幻觉侦测完全在前端 TypeScript 层完成**，不需新增 Rust Command
- 理由：所有需要的资料（rawText、recordingDurationMs、noSpeechProbability）在前端已可取得

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/lib/database.ts` | Migration v4 → v5（`hallucination_terms` 表） |
| `src/lib/hallucinationDetector.ts` | **新增** — 纯函式幻觉侦测模组 |
| `src/lib/builtinHallucinationTerms.ts` | **新增** — 多语言内建幻觉词库 |
| `src/stores/useHallucinationStore.ts` | **新增** — 幻觉词库 CRUD Store |
| `src/views/HallucinationView.vue` | **新增** — 幻觉词库管理页面 |
| `src/stores/useVoiceFlowStore.ts` | 整合幻觉侦测（`stopListeningFlow` + `handleRetryTranscription`） |
| `src/router.ts` | 新增 `/hallucinations` 路由 |
| `src/MainApp.vue` | `navItems` 新增幻觉词库导航项 |
| `src/main-window.ts` | 启动时初始化内建幻觉词库 |
| `src/App.vue` | 不需修改（HUD 不执行 `initializeBuiltinTerms`，`getTermListForDetection` 只读取） |
| `src/i18n/locales/zh-TW.json` | 新增翻译键 |
| `src/i18n/locales/en.json` | 新增翻译键 |
| `src/i18n/locales/ja.json` | 新增翻译键 |
| `src/i18n/locales/zh-CN.json` | 新增翻译键 |
| `src/i18n/locales/ko.json` | 新增翻译键 |

### 不需修改的档案（明确排除）

- `src-tauri/src/plugins/transcription.rs` — Rust 端不变，前端消费既有 `TranscriptionResult`
- `src-tauri/src/plugins/audio_recorder.rs` — 录音逻辑不变
- `src-tauri/src/lib.rs` — 不需新增 Rust Command
- `src-tauri/Cargo.toml` — 不需新增 Rust 依赖
- `src/lib/enhancer.ts` — AI 整理逻辑不变
- `src/stores/useHistoryStore.ts` — 历史 store 不变（复用既有的 `addTranscription`）
- `src/stores/useSettingsStore.ts` — 设定 store 不变
- `src/stores/useVocabularyStore.ts` — 字典 store 不变
- `src/views/SettingsView.vue` — 设定页面不变
- `src/components/NotchHud.vue` — HUD 已有 `vocabulary:learned` 学习通知机制，直接复用
- `package.json` — 不需新增 JS 依赖

### 效能注意事项

- `detectHallucination()` 是同步纯函式，计算量极低（字串比对 + 数值比较）
- `getTermListForDetection()` 涉及 SQLite 查询，但词库量小（< 100 笔），查询 < 10ms
- 幻觉侦测在每次转录结束后执行，不影响录音/转录效能
- 内建词库初始化（`initializeBuiltinTerms`）使用 `INSERT OR IGNORE`，App 启动时仅新增缺失项目

### 安全规则提醒

- 幻觉词库不包含任何个人资讯
- 幻觉侦测结果不上传至任何外部服务
- 幻觉词库仅存于本地 SQLite

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-15.md#问题 1] — 三层幻觉侦测架构决策、影响范围分析
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] — AC 完整定义（lines 563-600）
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 描述] — 幻觉侦测功能定位
- [Source: _bmad-output/project-context.md#幻觉检测策略] — v0.7.3 修正：`isEmptyTranscription()` 只拦截完全空白
- [Source: _bmad-output/implementation-artifacts/4-4-recording-storage-history-playback.md] — 前置 Story：`audio_file_path`、`status` 栏位、`save_recording_file`
- [Source: _bmad-output/implementation-artifacts/4-5-transcription-retry-from-disk.md] — 前置 Story：`retranscribe_from_file`、重送机制
- [Source: src/types/audio.ts] — `TranscriptionResult.noSpeechProbability`（已存在）
- [Source: src/stores/useVoiceFlowStore.ts] — 现有 `isEmptyTranscription()`、`stopListeningFlow()`、`handleRetryTranscription()`
- [Source: src/lib/database.ts] — 现有 schema version 4、migration 模式
- [Source: src/composables/useTauriEvents.ts] — `VOCABULARY_LEARNED` 事件常数（复用）
- [Source: src/components/NotchHud.vue] — 现有学习通知机制（`vocabulary:learned` event handler）
- [Source: src/router.ts] — 现有路由定义
- [Source: src/MainApp.vue] — 现有 `navItems` 和 Sidebar 结构
- [Source: src/i18n/languageConfig.ts] — `TranscriptionLocale` 型别

## Dev Agent Record

### 2026-03-15 实作记录

**完成 Task 1-9（Task 10 为手动测试）**

#### 新增档案
| 档案 | 说明 |
|------|------|
| `src/lib/hallucinationDetector.ts` | 纯函式三层幻觉侦测模组 |
| `src/lib/builtinHallucinationTerms.ts` | 多语言内建幻觉词库（zh/en/ja/ko） |
| `src/stores/useHallucinationStore.ts` | 幻觉词库 CRUD Pinia Store |
| `src/views/HallucinationView.vue` | 幻觉词库管理页面（shadcn-vue） |
| `tests/unit/hallucination-detector.test.ts` | hallucinationDetector 单元测试（22 tests） |
| `tests/unit/builtin-hallucination-terms.test.ts` | builtinHallucinationTerms 单元测试（11 tests） |

#### 修改档案
| 档案 | 修改范围 |
|------|---------|
| `src/lib/database.ts` | Migration v4 → v5（hallucination_terms 表 + locale 索引） |
| `src/stores/useVoiceFlowStore.ts` | 整合幻觉侦测（handleStopRecording + handleRetryTranscription） |
| `src/composables/useTauriEvents.ts` | 新增 `HALLUCINATION_LEARNED` 事件常量 |
| `src/types/events.ts` | 新增 `HallucinationLearnedPayload` 型别 |
| `src/components/NotchHud.vue` | 监听 `hallucination:learned` 事件，显示独立通知 |
| `src/router.ts` | 新增 `/hallucinations` 路由 |
| `src/MainApp.vue` | navItems 新增幻觉词库导航项（ShieldAlert icon） |
| `src/main-window.ts` | 启动时初始化内建幻觉词库 |
| `src/i18n/locales/zh-TW.json` | 新增 hallucination.* + voiceFlow.hallucination* 翻译键 |
| `src/i18n/locales/en.json` | 同上 |
| `src/i18n/locales/ja.json` | 同上 |
| `src/i18n/locales/zh-CN.json` | 同上 |
| `src/i18n/locales/ko.json` | 同上 |

#### 测试结果
- 全部 335 tests 通过（18 test files）
- TypeScript 型别检查通过（vue-tsc --noEmit）
- 新增 33 个测试覆盖 hallucinationDetector + builtinHallucinationTerms

#### 设计决策
- `hallucination:learned` 使用独立事件（不复用 `vocabulary:learned`），NotchHud 显示「已学习幻觉词」标签
- `hallucination_terms.term` 使用 UNIQUE(term) 全域唯一
- 幻觉拦截触发重送（设定 lastFailed* 状态启用 canRetry）
- `getTermListForDetection()` DB 查询失败时仍回传内建词库（graceful degradation）
