# Deferred Work

从 spec / code review 中搜集到、确认过但选择不在当下处理的事项。每笔需含：来源、发现、为何延后、后续再处理时的切入点。

## 来自 spec-gh-35-preserve-clipboard.md（2026-05-08）

### 1. 还原视窗 200ms 内的并发竞争

- **发现**：OFF 模式下，`paste_text` 会在贴上后等 200ms 再还原快照。这 200ms 内若使用者按 Cmd+C 或 clipboard manager（Maccy / 1Password / Ditto / Paste 等）写入，新内容会被快照覆盖。
- **延后理由**：spec 讨论时已认为这是已知 trade-off；实务上 200ms 视窗极短、发生机率低；解决需要「比对写入时间戳」的逻辑，跨平台复杂度高。
- **后续切入点**：若有使用者实际回报，`clipboard_paste.rs` 的还原逻辑可在 set_text 前先读目前内容，比对是不是我们写入的转录文字才动手；只是「读取剪贴簿」本身也是非原子的，仍有 TOCTOU 视窗。

### 2. `set_text(&text)` 写入失败时 `?`-propagate 跳过 restore

- **发现**：步骤 2 的 `clipboard.set_text(&text)?` 若失败会直接返回，跳过后续 step 5 的还原。理论上若是「部分写入」，使用者的原始剪贴簿就遗失。
- **延后理由**：arboard 在 macOS（NSPasteboard）和 Windows（OpenClipboard / SetClipboardData）的写入是原子的，部分写入是理论风险；实作 fallback restore 路径会增加程式码复杂度但收益极低。
- **后续切入点**：若未来换掉 arboard 或加入第三平台支援，重新评估这个 path。

### 3. 并发 `paste_text` 呼叫互相干扰

- **发现**：两个 `paste_text` 重叠执行时（toggle 模式下快速连发、或 paste-during-correction-flow），call A 的 snapshot 可能捞到 call B 写入的转录文字当「原内容」，最终剪贴簿落在错的内容。
- **延后理由**：现行设计对单次热键触发是安全的，并发场景需要全域 mutex 才能解；spec 没有列为硬性需求。
- **后续切入点**：在 `FocusState` 旁边加一个 `Arc<Mutex<()>>` paste guard，paste_text 入口先 lock；或在前端 store 层做去重。

### 4. clipboard handle 跨长 sleep 的安全性

- **发现**：`paste_text` 拿一次 `Clipboard::new()` handle 跨 50ms + paste + 200ms 共约 250ms+ 才用来还原。arboard 在 macOS 偶有 pasteboard handle 失效跨长间隔的个案。
- **延后理由**：实测尚未观察到失效；分配新 handle 的成本不高但增加几行程式码，效益尚不确定。
- **后续切入点**：若还原 log 出现「Failed to restore clipboard」高频率错误，把还原段改为 `Clipboard::new()` 重新拿 handle。

### 5. Boolean toggle 设定的 `saveXxx` 函式与 load/refresh blocks 高度重复

- **发现**：`useSettingsStore.ts` 已累积 4+ 个结构相同的 boolean toggle 储存函式（`saveMuteOnRecording` / `saveSoundEffectsEnabled` / `saveSmartDictionaryEnabled` / 本次新增的 `saveCopyTranscriptionToClipboard`）。每个都是 `load → set → save → ref.value = val → emit SETTINGS_UPDATED → catch+captureError+throw`，约 25 行。对应的 load 与 refresh blocks 也成对重复。
- **延后理由**：抽 `createBooleanSettingSaver(key, ref, step)` factory 属于跨 setting 的广泛重构，已超出 issue #35 范围；此 PR 加 1 个 toggle 的成本可接受。
- **后续切入点**：未来再加第 5 个 boolean toggle 时是抽出 factory 的最佳时机。

### 6. SettingsView 的 Switch + 双描述 + feedback transition 已是可抽元件的模板

- **发现**：`mute-on-recording`、`sound-feedback`、本次新增的 `copy-transcription-to-clipboard` 三个区段是 35–40 行的逐行同形复制（差别只在某个用 `descriptionOn/Off`，其他用单一 description key）。
- **延后理由**：抽 `<SettingsToggleRow>` 元件需设计合理的 props 接口，且影响其他既有区段的测试；不在 #35 的范围。
- **后续切入点**：抽元件时把双描述当预设能力（吃 `descriptionOn/Off`），单一描述当降级用法。

### 7. IPC 参数的反向布林命名 `restoreClipboard: !isCopyTranscriptionToClipboardEnabled`

- **发现**：`useVoiceFlowStore.ts` 第 759 行需要做 negation 把 store 的「复制到剪贴簿」翻译成 Rust 的「还原剪贴簿」；20+ 个 vitest 期望变成 `restoreClipboard: false`，阅读时得做心智反转。
- **延后理由**：把 store 栏位重新命名（例如改成 `isPreserveClipboardEnabled`）会扩散到整个 Settings UI、i18n 文案、5 个语系字串，且使用者已经拍板过「将转录文字复制到剪贴簿」这个 UI 文案，store 栏位名与其同义是合理的；现行翻译成本是单点。
- **后续切入点**：若这个翻译点未来成为 bug 来源，考虑改 Rust 的 IPC 参数名为 `keepInClipboard`（语意正向），这样两端都不需 negation。

### 8. 既有 `🔴🔴🔴 paste_text CALLED` debug println 在 release build 持续输出

- **发现**：`clipboard_paste.rs` 的 `paste_text` 入口有一行非 `cfg(debug_assertions)` 包覆的 println，会在 release build 持续打到 stdout。
- **延后理由**：此 println 是 baseline 既有程式码，非本 story 引入；且在 Tauri app 中 stdout 通常被 OS 吞掉。属于既有 tech-debt。
- **后续切入点**：未来做 logging 统一改造时一并处理（`tracing` crate 整合）。
