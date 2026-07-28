---
title: 'gh-35 — 可选择贴上后不要占用剪贴簿'
type: 'feature'
created: '2026-05-08'
status: 'done'
baseline_commit: '5ebc4c0e9f68d6ec32959780b7c85cc7485410fc'
context:
  - '{project-root}/src-tauri/src/plugins/clipboard_paste.rs'
  - '{project-root}/src/stores/useSettingsStore.ts'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** SayIt 自动贴上转录文字后，会覆盖使用者原本的剪贴簿内容。常见工作流（先复制 prompt → 讲话贴上 → 想再贴回原内容）会被破坏。对应 GitHub issue #35。

**Approach:** Settings 新增 toggle「将转录文字复制到剪贴簿」，预设开启以保留现况。关闭时 `paste_text` 走「快照原剪贴簿 → 写入转录 → 模拟 Cmd+V/Ctrl+V → 等 200ms → 还原快照」流程，沿用 `capture_selected_text_via_clipboard` 已验证的 snapshot 模式。

## Boundaries & Constraints

**Always:**
- 预设值为 `true`（保留现况），旧使用者升级后行为不变
- 跨 macOS 与 Windows 一致实作
- 设定改动必须透过 `SETTINGS_UPDATED` event 跨视窗同步
- 还原延迟抽为 const，方便日后调整
- 还原失败时记录 log，不阻断贴上流程

**Ask First:**
- 实测若 200ms 还原延迟不足
- Settings 文案最终定稿

**Never:**
- 不支援多型别剪贴簿（图片／档案／RTF）。原内容非文字时，OFF 模式保留转录文字、不做 best-effort 还原
- 不引入新的剪贴簿管理 crate，沿用 arboard
- 不改变 ON 模式现有行为，零回归风险为硬指标

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default ON | `toggle=true`, 剪贴簿="原文字" | 贴上转录文字，剪贴簿停留为「转录文字」 | N/A |
| OFF + 文字剪贴簿 | `toggle=false`, 剪贴簿="原文字" | 贴上转录文字后，剪贴簿恢复为「原文字」 | 还原失败：log warn，不阻断 |
| OFF + 空剪贴簿 | `toggle=false`, 剪贴簿空 | 贴上转录文字后，剪贴簿留下转录文字（与非文字情境一致；2026-05-08 使用者拍板放宽） | N/A |
| OFF + 非文字剪贴簿 | `toggle=false`, 剪贴簿=图片/档案 | 贴上转录文字后，剪贴簿留下转录文字 | 不尝试还原（已知 trade-off） |
| OFF + 贴上失败 | `toggle=false`, CGEvent/SendInput 失败 | 仍还原快照，再向前端抛错 | 错误透过 ClipboardError 回传 |

</frozen-after-approval>

## Code Map

- `src-tauri/src/plugins/clipboard_paste.rs` -- `paste_text` command 主流程；新增 `restore_clipboard: bool` 参数与 snapshot／还原逻辑，已有 `capture_selected_text_via_clipboard` 可参考
- `src/stores/useVoiceFlowStore.ts` -- 第 756 行 `invoke("paste_text", ...)` 为唯一前端呼叫点；需传入新参数
- `src/stores/useSettingsStore.ts` -- 新增栏位 `copyTranscriptionToClipboard`（const + ref + load + save + refresh + return），对齐既有 `isMuteOnRecordingEnabled` 结构
- `src/views/SettingsView.vue` -- 在「应用程式」区段（与 `muteOnRecording` 同层）新增 Switch 与双情境说明，模板参考第 1826 行
- `src/i18n/locales/{zh-TW,zh-CN,en,ja,ko}.json` -- 五语系新增 `settings.app.copyTranscriptionToClipboard.{label,descriptionOn,descriptionOff}` 三个 key

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/plugins/clipboard_paste.rs` -- 抽 `RESTORE_DELAY_MS: u64 = 200` const，并在 `paste_text` 新增 `restore_clipboard` 参数；OFF 路径：读原剪贴簿文字 → 写入转录 → 触发 paste → sleep `RESTORE_DELAY_MS` → 还原快照（失败时 log 不 throw）-- 核心行为改变
- [x] `src-tauri/src/plugins/clipboard_paste.rs` -- 新增 unit test：(1) `restore_clipboard=false` 路径下参数传递与 const 值 (2) ON 路径无 snapshot 逻辑（行为不变）-- regression 保护
- [x] `src/stores/useSettingsStore.ts` -- 新增 `DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD = true` 与 `copyTranscriptionToClipboard` ref；补 `loadSettings` 读取、`saveCopyTranscriptionToClipboard` 写入 + emit `SETTINGS_UPDATED`、`refreshCrossWindowSettings` 同步、return 暴露 -- 设定持久化
- [x] `src/stores/useVoiceFlowStore.ts` -- 第 756 行 `invoke("paste_text", ...)` 改传 `{ text, restoreClipboard: !settingsStore.copyTranscriptionToClipboard }` -- 接通 toggle
- [x] `src/views/SettingsView.vue` -- 在 `muteOnRecording` Switch 同区段新增 Switch（绑 `:model-value` + `@update:model-value` + Label `for`），双情境说明用 `descriptionOn` / `descriptionOff` 条件渲染 -- UI 入口
- [x] `src/i18n/locales/zh-TW.json` -- 新增 `settings.app.copyTranscriptionToClipboard.{label,descriptionOn,descriptionOff}`，文案：label「将转录文字复制到剪贴簿」；descriptionOn「⋯⋯会留在剪贴簿，可再用 Cmd+V 重复贴出，但会覆盖原本复制的内容。」；descriptionOff「⋯⋯剪贴簿维持原本内容，方便接续使用。」-- 主语系
- [x] `src/i18n/locales/{zh-CN,en,ja,ko}.json` -- 对应翻译（与既有 muteOnRecording 风格一致）-- 其他语系

**Acceptance Criteria:**
- Given 全新安装启动，when 读取 settings store，then `copyTranscriptionToClipboard === true`（保留现况）
- Given toggle = OFF 且剪贴簿是纯文字，when 触发完整录音 → 自动贴上流程，then 贴上完成后剪贴簿仍为原文字（macOS + Windows 各验）
- Given toggle = OFF 且剪贴簿为图片或档案，when 触发贴上，then 贴上成功，剪贴簿停留为转录文字，图片不会被「还原成空」（已知 trade-off）
- Given Settings UI 切换 toggle，when 在另一个视窗读 store，then 透过 `SETTINGS_UPDATED` event 即时同步
- Given Settings UI，when 使用者看到 toggle，then 文案不出现工程术语（「还原 / 快照 / restore / snapshot」），用「保留 / 留在剪贴簿」描述行为

## Spec Change Log

### 2026-05-08 — Codex review 后使用者放宽 spec（frozen 区人类重新谈判）

- **Trigger**：Codex `/codex:review` 指出 OFF + 空剪贴簿情境下，实作（保留转录文字）与 spec I/O Matrix（剪贴簿维持空）不一致
- **使用者决策**：选 B「把 spec 改宽松」— 因为使用者几乎不会察觉空剪贴簿状态，多写 `clipboard.set_text("")` 来精确还原成本不值得
- **Spec 变更**：I/O Matrix 第 3 列「OFF + 空剪贴簿」期望从「剪贴簿维持空」改为「剪贴簿留下转录文字（与非文字情境一致）」。frozen 区依规则只有人类能改，使用者已明示授权
- **附带处理**：`.claude/*.lock` 加入 `.gitignore`，确保 `scheduled_tasks.lock` 等 Claude Code 本机 runtime 档不会被误 commit
- **无程式码改动**：实作早就走「None → 不还原」路径，原本就是这个行为；本次只是让 spec 对齐现况

### 2026-05-08 — Simplify pass（patch only，无 spec 变动）

- **Trigger**：`/simplify` 命令跑三方审查（reuse / quality / efficiency）
- **Patches applied**：
  1. **重用 `restore_clipboard` helper**：把 paste_text 内联的 snapshot 还原 match block 改为呼叫既有 helper；同步把 helper 重新命名为 `restore_clipboard_text` 以避开与新增 `restore_clipboard: bool` 参数的 shadow 风险（两个既有呼叫点同步更新）
  2. **删除 `test_restore_delay_ms_locked_to_200`**：跟自身常数比对的仪式型测试，改由 `test_restore_delay_ms_within_sane_range` 50–1000ms 区间守门，留下实质意义且不阻挡未来微调
  3. **清掉 WHAT-style 编号注解**：`// 1) Snapshot...` 到 `// 6) 还原跑完...` 等只重述程式码动作的注解全删；保留含 WHY 的注解（如为何 capture error 而非 ?-propagate、为何即使 paste 失败也要还原）
  4. **简化 snapshot 三态注解**：原本三行解释 (a)(b)(c)，改为一句「Err 涵盖非文字内容／暂时锁等情况，视为『无可还原』」；match arm 本身已是文件
- **Defers**（已记入 deferred-work.md）：第 5 条 boolean setting saver factory、第 6 条 `<SettingsToggleRow>` 元件、第 7 条反向布林命名 — 这三项属于跨 setting / 跨元件的广泛重构，超出 issue #35 范围

### 2026-05-08 — Review iteration 1（patch only，无 spec 变动）

- **Trigger**：三方 review（blind hunter / edge case hunter / acceptance auditor）共找到 10 条发现
- **Patches applied**：
  1. **`clipboard_paste.rs` snapshot 路径**：把 `clipboard.get_text().ok()` 改为 `match` 三态（Ok-non-empty / Ok-empty / Err），让 logging 区分「空剪贴簿」与「读取失败」，未来 debug 报告直接看 log 就能定位
  2. **`clipboard_paste.rs` 测试**：新增 `test_restore_delay_ms_within_sane_range` 守门 50–1000ms 范围；补注解说明为何完整行为测试走手动 + 前端 vitest 而非 Rust unit test
- **Defers** 移到 `deferred-work.md`：A 还原视窗并发、E set_text 早退、F 并发 paste_text、H clipboard handle 重用、J 既有 release println
- **Rejects**（合 spec、噪音）：B 图片被覆盖（spec I/O Matrix 已标 trade-off）、C 反向布林风格疑虑、G 还原失败不通知（spec 明写只 log）

## Verification

**Commands:**
- `cd src-tauri && cargo test --lib clipboard_paste` -- expected: 新增测试与既有测试全部通过
- `cd src-tauri && cargo clippy --all-targets -- -D warnings` -- expected: 零警告
- `pnpm test` -- expected: vitest 既有套件全绿
- `npx vue-tsc --noEmit` -- expected: 型别检查零错
- `pnpm tauri dev` -- expected: 手动验证 ON/OFF 两种模式各跑一次完整流程

**Manual checks:**
- macOS：复制一段文字 → 触发 SayIt 讲话 → 完成贴上 → 再 Cmd+V，OFF 应贴出原文字、ON 应贴出转录文字
- Windows（CI 或实机）：同上逻辑；焦点还原（`restore_target_window`）仍正常
- 切换 UI 语言到 zh-CN / en / ja / ko，确认 Switch 文案无 fallback 显示英文 key

## Suggested Review Order

**剪贴簿核心流程（Rust）**

- 入口：`paste_text` 命令签名加上 `restore_clipboard` 布林，贯穿后续六步骤逻辑
  [`clipboard_paste.rs:333`](../../src-tauri/src/plugins/clipboard_paste.rs#L333)

- 还原延迟常数：抽出 200ms 为 const，附 trade-off 注解（太短/太长的危害）
  [`clipboard_paste.rs:9`](../../src-tauri/src/plugins/clipboard_paste.rs#L9)

- Snapshot 三态：Ok-非空 / Ok-空 / Err，分别 log 不同讯息方便事后 debug
  [`clipboard_paste.rs:363`](../../src-tauri/src/plugins/clipboard_paste.rs#L363)

- 还原段：等 `RESTORE_DELAY_MS` 后 set_text(original)，失败只 log 不阻断贴上
  [`clipboard_paste.rs:436`](../../src-tauri/src/plugins/clipboard_paste.rs#L436)

**设定持久化（Pinia + tauri-plugin-store）**

- 预设值 `true` — 升级旧使用者行为不变的硬指标
  [`useSettingsStore.ts:74`](../../src/stores/useSettingsStore.ts#L74)

- save 函式 + `SETTINGS_UPDATED` event broadcast 给所有视窗
  [`useSettingsStore.ts:1193`](../../src/stores/useSettingsStore.ts#L1193)

- `SettingsKey` union 增加新成员，跨视窗事件型别安全
  [`events.ts:36`](../../src/types/events.ts#L36)

**触发点：把 toggle 反向接到 IPC**

- 唯一前端呼叫点：`!isCopyTranscriptionToClipboardEnabled` → `restoreClipboard`
  [`useVoiceFlowStore.ts:759`](../../src/stores/useVoiceFlowStore.ts#L759)

**Settings UI**

- Switch + 双情境动态说明（ON/OFF 切换显示不同描述）
  [`SettingsView.vue:1876`](../../src/views/SettingsView.vue#L1876)

- Toggle handler：呼叫 store + 显示 success/error feedback
  [`SettingsView.vue:660`](../../src/views/SettingsView.vue#L660)

**文案（i18n）**

- 主语系字串组（label / descriptionOn / descriptionOff / enabled / disabled）
  [`zh-TW.json:139`](../../src/i18n/locales/zh-TW.json#L139)

**守门（测试）**

- 200ms 锁定测试 + 50–1000ms 区间 sanity check
  [`clipboard_paste.rs:561`](../../src-tauri/src/plugins/clipboard_paste.rs#L561)
