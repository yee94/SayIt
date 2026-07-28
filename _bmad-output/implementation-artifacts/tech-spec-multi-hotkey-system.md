---
title: '组合键 + Double-tap 模式切换 + 选取文字编辑'
slug: 'multi-hotkey-system'
created: '2026-03-27'
status: 'phase1-implemented'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Vue 3 Composition API', 'Rust', 'CGEventTap (macOS)', 'SetWindowsHookExW (Windows)', 'tauri-plugin-store', 'shadcn-vue', 'Pinia', 'Vitest', 'core-graphics 0.24', 'core-foundation 0.10', 'windows 0.61']
files_to_modify:
  - src-tauri/src/plugins/hotkey_listener.rs
  - src-tauri/src/lib.rs
  - src/types/settings.ts
  - src/types/events.ts
  - src/composables/useTauriEvents.ts
  - src/stores/useSettingsStore.ts
  - src/stores/useVoiceFlowStore.ts
  - src/components/NotchHud.vue
  - src/App.vue
  - src/views/SettingsView.vue
  - src/lib/keycodeMap.ts
  - src/i18n/locales/zh-TW.json
  - src/i18n/locales/en.json
  - src/i18n/locales/ja.json
  - src/i18n/locales/zh-CN.json
  - src/i18n/locales/ko.json
  - src-tauri/src/plugins/text_field_reader.rs
  - src/i18n/prompts.ts
  - tests/unit/settingsStore.test.ts
code_patterns:
  - 'TriggerKey serde tagged enum (Rust camelCase ↔ TS string union)'
  - 'Settings persist chain: store.set() → store.save() → invoke() → emitEvent(SETTINGS_UPDATED)'
  - 'CGEventTap FlagsChanged flag-based detection for modifiers, KeyDown/KeyUp for non-modifiers'
  - 'Event naming: {domain}:{action} kebab-case'
  - 'Plugin State shutdown convention: pub fn shutdown(&self)'
  - 'Architecture.md designed combo key: { modifiers: Vec<Modifier>, keycode: u16 }'
  - 'Two-tier hotkey UI: preset Select + custom Record (from tech-spec-custom-hotkey)'
  - 'VoiceFlow abort pattern: isAborted + AbortController + abort guards after every await'
  - 'Minimum recording duration: 300ms (MINIMUM_RECORDING_DURATION_MS)'
test_patterns:
  - 'Vitest unit tests in tests/unit/'
  - 'vi.mock for tauri plugin-http fetch and invoke'
  - 'Priority tags: [P0] [P1] in test names'
  - 'Rust #[cfg(test)] mod tests in same file'
reviewed: true
review_findings_addressed: 28
---

# Tech-Spec: 组合键 + Double-tap 模式切换 + 选取文字编辑

**Created:** 2026-03-27

## Overview

### Problem Statement

目前 SayIt 的自订快捷键只支援单键，使用者无法用组合键（如 ⌘+J）避免误触。切换语音整理模式（精简/积极）必须进设定页面，无法在工作流中快速切换。此外，选取文字后无法用语音指令进行改写/翻译。（GitHub Issues #12、#20）

### Solution

三个功能扩展：
1. **自订组合键**：录键时支援「修饰键 + 主键」组合（如 ⌘+J），预设单键不变
2. **Double-tap 切模式**：Hold 模式下快速按两下触发键，在精简 ↔ 积极之间切换，HUD 闪现新模式名称
3. **选取文字编辑**（Phase 2）：侦测到选取文字时自动进入语音指令模式

### Scope

**In Scope:**

- 自订快捷键支援组合键（修饰键 + 主键）
- Double-tap 切模式（Hold 模式限定，单键和组合键都支援，minimal ↔ active，持久化）
- HUD 录音时显示 prompt mode badge（精简/积极/自订）+ double-tap 闪现
- 选取文字编辑（Phase 2，macOS only）
- Rust 双平台（macOS CGEventTap + Windows hook）
- i18n 5 语言

**Out of Scope:**

- 多组快捷键 Slot（不需要，double-tap 切模式已足够）
- Windows 选取文字编辑（UI Automation 未实作）
- 语音串流 (streaming) 回应

## Context for Development

### Codebase Patterns

1. **TriggerKey serde 镜像**：Rust `TriggerKey` enum（含 `Custom { keycode }`）与 TS `TriggerKey` 型别完全镜像，`#[serde(rename_all = "camelCase")]`。自订组合键扩展此 enum。

2. **Settings 持久化链路**：UI → `useSettingsStore.saveXxx()` → `tauri-plugin-store` → `invoke("update_hotkey_config")` 同步 Rust → `emitEvent(SETTINGS_UPDATED)` 广播。

3. **CGEventTap callback**：单一闭包处理 FlagsChanged/KeyDown/KeyUp。修饰键用 `CGEventFlags` ��测，非修饰键用 keycode match。Preset Fn 只回应 keycode 63 的 FlagsChanged 事件，用 `CGEventFlagSecondaryFn` flag-based 侦测（避免 Globe 键的额外系统事件干扰���。

4. **Architecture.md 组合键设计**（第 89-93 行）：`{ modifiers: Vec<Modifier>, keycode }`，macOS 用 CGEventFlags，Windows 用 GetKeyState。向后相容：旧 `{ keycode }` = `{ modifiers: [], keycode }`。

5. **HUD 通讯**：NotchHud 接收 App.vue 的 props（从 useVoiceFlowStore 读取），不直接监听 Tauri events。新增 prop 即可。

6. **Plugin State shutdown**：必须实作 `shutdown(&self)`，处理 Mutex poisoned。

7. **ESC 为保留键**：走独立路径 emit `escape:pressed`，不可用于触发键或组合键主键。

8. **全域 promptMode**：现有 `useSettingsStore.promptMode` ref，`getAiPrompt()` 据此回传 prompt。double-tap 只需切换此 ref 并持久化。

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/plugins/hotkey_listener.rs` | Rust 快捷键核心（State、CGEventTap、Windows hook、handle_key_event） |
| `src-tauri/src/lib.rs` | Tauri command 注册、shutdown 顺序 |
| `src/types/settings.ts` | TriggerKey/HotkeyConfig/PromptMode 型别 |
| `src/types/events.ts` | HotkeyEventPayload 事件型别 |
| `src/composables/useTauriEvents.ts` | 事件常量 + listen/emit 封装 |
| `src/stores/useSettingsStore.ts` | hotkeyConfig/promptMode 持久化 |
| `src/stores/useVoiceFlowStore.ts` | 录音生命周期、事件监听、enhancer 呼叫 |
| `src/components/NotchHud.vue` | HUD VisualMode、NotchShape |
| `src/App.vue` | HUD 视窗入口，传 props 给 NotchHud |
| `src/views/SettingsView.vue` | 快捷键设定 UI（preset/custom、Hold/Toggle） |
| `src/lib/keycodeMap.ts` | DOM code ↔ platform keycode 映射 |
| `src/i18n/prompts.ts` | prompt templates × 5 语言 |
| `src-tauri/src/plugins/text_field_reader.rs` | macOS AX API 文字读取 |
| `_bmad-output/project-context.md` | 276 条实作规则（必读） |

### Technical Decisions

- **扩展现有 `TriggerKey` 而非新增 `SlotTrigger`**：在 Rust `TriggerKey` enum 新增 `Combo { modifiers, keycode }` variant，与现有 `Custom { keycode }` 并列。前端 TS 同步扩展。Serde 格式为 **externally tagged**（Rust serde 预设，enum 无 `#[serde(tag)]` 标注）。JSON 范例：`{ "combo": { "modifiers": ["command"], "keycode": 38 } }`。**注意**：enum-level `#[serde(rename_all = "camelCase")]` 只影响 variant key（如 `"rightOption"`），不传播到 struct variant 内部栏位。`Combo` 的 `modifiers` 和 `keycode` 已是小写不需 rename，但未来若加多字词栏位需在 variant 内部另加 `#[serde(rename_all)]`
- **维持单一快捷键架构**：不引入 Slot/SlotId，保持现有 `hotkeyConfig: { triggerKey, triggerMode }` 结构不变。`promptMode` 维持全域设定
- **组合键 release = 任一键放开停止**：使用者不会刻意控制放键顺序
- **Double-tap 侦测在 Rust 层**：追踪主键 press/release timing。单键追踪整个键，组合键追踪主键（修饰键保持按住）。条件：Hold 模式 + 主键 hold < 300ms + 间隔 < 350ms
- **Toggle 模式长按切模式**：Toggle 模式改为 release-based。长按 ≥ 1s → spawn thread 侦测，1s 后 `is_pressed` 仍 true 则 emit `hotkey:mode-toggle`（HUD 立即出现）。Release 时 `toggle_long_press_fired` = true 则跳过 toggle。短按 < 1s → 正常 toggle（start/stop）
- **Double-tap 循环 minimal ↔ active**：不含 custom。切换结果持久化
- **前端用 Promise-based `waitForDoubleTapResolution` 处理竞态**：`handleStopRecording` 在 `estimatedDurationMs < 350` 时 `await` 一个 Promise，等 mode-toggle event 到达（resolve true）或 400ms 超时（resolve false）。mode-toggle 确认后呼叫 `applyDoubleTapModeSwitch()` 取消录音并切模式。Toggle 模式长按时 `handleDoubleTapModeToggle` 直接呼叫 `applyDoubleTapModeSwitch()`
- **Combo 不需冲突侦测**：preset 和 custom/combo 是二选一——切到 preset 模式后 combo 设定保留但不生效，与现有 custom 单键行为一致
- **`hotkey:mode-toggle` 直接 emit `()`**：不需专用 payload struct，与现有 `escape:pressed` 模式一致
- **`mode-switch` 只存在于 NotchHud 的 `VisualMode`**：不进 `HudStatus`（store 层），由 `modeSwitchLabel` prop 驱动。显示 3 秒后 store 清空 label 并呼叫 `transitionTo("idle")` 触发 collapse 动画（与 success 流程一致）
- **ESC 中断同时清除 DoubleTapState**
- **HUD badge 显示所有模式**：精简、积极、自订都显示对应标签
- **单一 Mutex `HotkeySharedState`**：合并 active_modifiers + double_tap_state + recording_state，与现有 trigger_key Mutex 合并，避免多锁 deadlock
- **Rust-driven 录键**：录制快捷键完全由 Rust CGEventTap/Windows hook 处理（`start_hotkey_recording` / `cancel_hotkey_recording` commands + `hotkey:recording-captured` / `hotkey:recording-rejected` events），不依赖 DOM `KeyboardEvent`。解决 Fn 键不产生 DOM 事件 + 修饰键单独按被阻挡的问题
- **`ModifierFlag::Fn`**：macOS 用 `CGEventFlagSecondaryFn` 侦测。Preset Fn trigger 侦测只回应 keycode 63 的 FlagsChanged，用 flag-based 判断 press/release（不回应非 keycode-63 的 FlagsChanged，避免 Globe 键系统事件误触 release）。Recording mode 仍用 toggle-based（keycode 63 第一次 = 累积，第二次 = 捕获）。支援 Fn 单键（Custom）和 Fn+J 组合键（Combo）。Windows 无 Fn（firmware 层）
- **组合键 exact modifier match**：`matches_combo_trigger` 检查 `modifiers.len() == active_mods.len()`，⌘+J 不会被 ⌘+⇧+J 触发

## Implementation Plan

### Phase 1: 组合键 + Double-tap + HUD

- [x] Task 1: Rust 型别扩展 — TriggerKey 新增 Combo variant
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `ModifierFlag` enum（Command, Control, Option, Shift）— `#[serde(rename_all = "camelCase")]`
    - 在 `TriggerKey` enum 新增 variant：`Combo { modifiers: Vec<ModifierFlag>, keycode: u16 }`
  - Notes: 现有 `Custom { keycode }` 保留不动。Serde 为 externally tagged（预设），JSON：`{ "combo": { "modifiers": [...], "keycode": N } }`。不需 `ModTogglePayload` struct——`hotkey:mode-toggle` 直接 emit `()`

- [x] Task 2: TypeScript 型别扩展
  - File: `src/types/settings.ts`
  - Action:
    - 新增 `ModifierFlag = "command" | "control" | "option" | "shift"`
    - 新增 `ComboTriggerKey = { combo: { modifiers: ModifierFlag[]; keycode: number } }`
    - 扩展 `TriggerKey = PresetTriggerKey | CustomTriggerKey | ComboTriggerKey`
    - 新增 type guard `isComboTriggerKey(key: TriggerKey): key is ComboTriggerKey`
  - File: `src/composables/useTauriEvents.ts`
  - Action: 新增 `HOTKEY_MODE_TOGGLE = "hotkey:mode-toggle" as const`

- [x] Task 3: Rust State 重构 — 合并 Mutex + 新增 double-tap 和 modifier 追踪
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `HotkeySharedState { trigger_key: TriggerKey, trigger_mode: TriggerMode, active_modifiers: HashSet<ModifierFlag>, double_tap: DoubleTapState }`
    - 新增 `DoubleTapState { last_release_time: Option<Instant>, last_hold_start: Option<Instant> }`
    - 重构 `HotkeyListenerState`：用 `shared: Arc<Mutex<HotkeySharedState>>` 取代 `trigger_key` + `trigger_mode` 两个独立 Mutex
    - `update_config(key, mode)`：lock `shared` 更新 trigger_key + trigger_mode + 清除 double_tap + reset AtomicBool
    - `reset_key_states()`：重置 `is_pressed` + `is_toggled_on` + lock `shared` 清除 `DoubleTapState`
    - `shutdown()`：处理 `shared` Mutex poisoned

- [x] Task 4: Rust 组合键比对逻辑
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `update_active_modifiers(flags: CGEventFlags) -> HashSet<ModifierFlag>`：从 CGEventFlags 提取当前按住的修饰键
    - 扩展 `matches_trigger_key_macos(keycode, trigger_key)`：新增 `TriggerKey::Combo` 分支 → 不在此比对（组合键需要在 callback 中同时检查 modifier + keycode）
    - 新增 `matches_combo_trigger(keycode, combo, active_mods) -> bool`：`combo.modifiers ⊆ active_mods && keycode == combo.keycode`
  - Notes: 组合键的修饰键透过 `active_modifiers`（从 FlagsChanged 更新）检查，主键透过 KeyDown/KeyUp 检查

- [x] Task 5: Rust double-tap 侦测逻辑
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `check_double_tap(shared: &HotkeySharedState) -> bool`：
      - 前置：`shared.trigger_mode == Hold` → Toggle 模式直接 return false
      - 检查 `double_tap.last_release_time` 距今 < 350ms 且上次 hold < 300ms → true
    - 新增 `record_release_for_double_tap(shared: &mut HotkeySharedState, hold_start: Instant)`：hold > 300ms → 清除 last_release_time，否则记录
    - 在 `handle_key_event` pressed=true 分支：先 `check_double_tap`，true → emit `"hotkey:mode-toggle"` + `()`，**不** emit `hotkey:pressed`
    - 在 `handle_key_event` pressed=false 分支：`record_release_for_double_tap`
  - Notes: 组合键的 double-tap 追踪**主键**的 timing（使用者按住 ⌘ 快速点两下 J）

- [x] Task 6: 重构 macOS CGEventTap callback 支援组合键
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 修改 `start_event_tap` 闭包：
    - 一次 lock `shared` → 取 trigger_key + trigger_mode + update active_modifiers + 读 double_tap → 释放
    - FlagsChanged：更新 `active_modifiers`。如果 trigger 是 Combo 且修饰键消失 → 触发 release（任一键放开 = 停止）。现有单键 modifier 逻辑保留
    - KeyDown：ESC 不变。如果 trigger 是 Combo → `matches_combo_trigger` 比对。如果 trigger 是 Single/Custom → 现有逻辑
    - KeyUp：Combo 的主键放开 → 触发 release。Single/Custom → 现有逻辑
    - Fn 键特殊双重策略保留
  - Notes: callback 只 lock `shared` 一次

- [x] Task 7: 重构 Windows hook 支援组合键
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 重构 `HookContext` struct：用 `shared: Arc<Mutex<HotkeySharedState>>` 取代原有的独立 `trigger_key` + `trigger_mode` Arc。`key_handler` 和 `escape_handler` 闭包改为 close over 新的 `shared` Arc
    - `OnceLock<HookContext>` 保留（hook 只安装一次），但 `shared` 是 Arc，`update_config` 更新 Mutex 内容即生效
    - hook_proc：一次 lock `shared` → 取 trigger_key + trigger_mode + 用 `GetKeyState` 更新 active_modifiers → 释放
    - Combo 比对：`GetKeyState(VK_XXX) & 0x8000` 检查修饰键 + `vkCode` 比对主键
    - Combo release：修饰键 KeyUp 或主键 KeyUp → 触发 release

- [x] Task 8: 前端 double-tap handler
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    - 新增 `pendingDoubleTap: ref<boolean>(false)` + `doubleTapDelayTimer`
    - 修改 `handleStopRecording()`：在 **开头**（`invoke("stop_recording")` 之前），用 `recordingElapsedSeconds` 预估 duration，若 < 0.3s → 立即设 `pendingDoubleTap = true` + 启动 350ms 延迟 timer。`invoke("stop_recording")` 回来后，若 `pendingDoubleTap` 已被 mode-toggle 清除 → return。否则到 timer 结束时正常 `failRecordingFlow`
    - 在 `initialize()` 新增 `listenToEvent(HOTKEY_MODE_TOGGLE, () => handleDoubleTapModeToggle())`（无 payload，直接 `()`）
    - `handleDoubleTapModeToggle()`：如果 `pendingDoubleTap` → clearTimeout + 静默取消（transitionTo "idle"）+ 切换 `settingsStore.promptMode`（minimal ↔ active）+ `settingsStore.savePromptMode(nextMode)` + 设 `modeSwitchLabel` 触发 HUD 闪现
    - 新增 `modeSwitchLabel: ref<string>("")` + 800ms auto-clear
    - `cleanup()` 中清除 timer

- [x] Task 9: HUD prompt mode badge + mode-switch 闪现
  - File: `src/components/NotchHud.vue`
  - Action:
    - 新增 props：`promptModeLabel: string`, `modeSwitchLabel: string`
    - `VisualMode` 新增 `"mode-switch"`
    - recording 右侧 badge：`<span v-if="props.promptModeLabel" class="text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/70">{{ props.promptModeLabel }}</span>`
    - mode-switch：notch 中央显示 label，800ms 后 collapse
    - `NOTCH_SHAPE_OVERRIDES["mode-switch"] = { width: 200, height: 36, topRadius: 12, bottomRadius: 18 }`
  - File: `src/App.vue`
  - Action: 计算 `promptModeLabel`：
    - `minimal` → `t('settings.prompt.modeMinimal')`
    - `active` → `t('settings.prompt.modeActive')`
    - `custom` → `t('settings.prompt.modeCustom')`
    - 传 `modeSwitchLabel` 从 `voiceFlowStore.modeSwitchLabel`

- [x] Task 10: 组合键录制 UI
  - File: `src/views/SettingsView.vue`
  - Action: 修改 `handleKeydownForRecording`：
    - **移除 `once: true`**，改为持续 listener + 状态累积模式：开始录制后持续监听 keydown，等使用者按住修饰键后再按主键 → 捕获完整组合 → 移除 listener。只按修饰键不放（无主键）→ 维持等待
    - 捕获 `event.metaKey/ctrlKey/altKey/shiftKey` + `event.code`
    - 修饰键本身（无其他修饰）→ 单键模式（现有行为）
    - 修饰键 + 非修饰主键 → combo：`{ combo: { modifiers, keycode } }`
    - 非修饰键单独 → 单键 custom（现有行为）
    - ESC 作为主键（含 ⌘+ESC）→ 拒绝，显示「ESC 为保留键」
    - 录键 UI 显示组合键名称（⌘+J）
    - 录键超时（10s）仍保留
  - File: `src/lib/keycodeMap.ts`
  - Action: 新增 `getComboTriggerKeyDisplayName(combo: ComboTriggerKey): string`：修饰键符号（⌘/⌃/⌥/⇧）+ 主键名称，以 `+` 连接
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    - 修改 `saveCustomTriggerKey` 支援 combo（或新增 `saveComboTriggerKey`），持久化 combo + domCode
    - **修改 `getTriggerKeyDisplayName()`**：新增 `isComboTriggerKey` 分支，呼叫 `getComboTriggerKeyDisplayName`。现有 preset + custom 分支不变

- [x] Task 11: 设定 UI Combo-aware 调整
  - File: `src/views/SettingsView.vue`
  - Action:
    - **修改 `onMounted` 的 `isCustomMode` 判断**：`isCustomTriggerKey(key) || isComboTriggerKey(key)` → `isCustomMode = true`
    - **修改 `currentPresetKey` computed**：新增 `isComboTriggerKey` 判断，Combo 时回传 null（进入 custom 模式）
    - 自订键区域：显示组合键名称（如「⌘+J」），用 `getTriggerKeyDisplayName`
    - 底部加 info 提示：「长按模式下，快速按两下触发键可切换语音模式」
  - Notes: Combo 从 UI 角度等同「进阶自订」，与 Custom 共用同一区块

- [x] Task 12: i18n 新增翻译 key（5 语言）
  - Files: `src/i18n/locales/{zh-TW,en,ja,zh-CN,ko}.json`
  - Action:
    - `settings.hotkey.doubleTapHint` — 「长按模式下，快速按两下触发键可切换语音模式」
    - `settings.hotkey.comboKey` — 「组合键」
    - `voiceFlow.modeSwitched` — 「已切换至{mode}模式」
    - `voiceFlow.commandMode` — 「指令模式」（Phase 2 用）

### Phase 2: 选取文字编辑（独立 PR，macOS only）

- [ ] Task 13: Rust 扩展 text_field_reader 读取选取文字
  - File: `src-tauri/src/plugins/text_field_reader.rs`
  - Action: 新增 `TextFieldInfo { context_text, selected_text, has_selection }` + command `read_text_field_with_selection`
  - macOS: `AXSelectedTextRange` 的 `length > 0` → 撷取选取文字
  - Windows: no-op，`has_selection: false`
  - File: `src-tauri/src/lib.rs` — 注册 command

- [ ] Task 14: 指令模式 prompt template
  - File: `src/i18n/prompts.ts`
  - Action: 新增 `COMMAND_MODE_PROMPTS` × 5 语言 + `getCommandModePrompt(locale, selectedText)`

- [ ] Task 15: VoiceFlow 指令模式流程
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    - 新增 `activeCommandContext: ref<{ selectedText: string } | null>(null)`
    - `handleStartRecording()`：只在 macOS + AX 权限已授予时呼叫 `invoke("read_text_field_with_selection")`，用 `Promise.race` 设 **500ms timeout**（避免 AX API hang 延迟录音启动），try-catch 包裹，超时或失败静默 fallback。有选取 → 设 `activeCommandContext`
    - `handleStopRecording()`：如果 `activeCommandContext` → 用 command mode prompt + 语音当指令
    - 失败静默 fallback 正常流程

- [ ] Task 16: HUD 指令模式标示
  - File: `src/App.vue`
  - Action: `activeCommandContext` 存在时 `promptModeLabel = t('voiceFlow.commandMode')`

### Acceptance Criteria

**Phase 1: 组合键 + Double-tap + HUD**

- [ ] AC 1: Given 自订录键模式, when 按 ⌘+J, then UI 显示「⌘+J」，储存为 combo 触发键
- [ ] AC 2: Given ⌘+J 为触发键 + Hold 模式, when 按住 ⌘+J, then 录音。when 放开 J 或放开 ⌘, then 停止
- [ ] AC 3: Given Fn+Hold+精简（单键）, when 快速按两下 Fn（hold < 300ms, gap < 350ms）, then HUD 闪现「积极」3s，promptMode 切为 active 并持久化
- [ ] AC 4: Given ⌘+J+Hold+精简（组合键）, when 按住 ⌘ 快速点两下 J, then HUD 闪现「积极」3s，promptMode 切为 active 并持久化
- [ ] AC 5: Given 已切为 active, when 再次 double-tap 或长按, then HUD 闪现「精简」，切回 minimal
- [ ] AC 6: Given Fn+Hold, when 按住 Fn > 300ms, then 正常录音，无 double-tap
- [ ] AC 7: Given Fn+Toggle 模式, when 短按（< 1s）, then toggle on/off。when 长按（≥ 1s），then HUD 闪现模式名称 3s，切换 promptMode
- [ ] AC 7a: Given Toggle 模式 + 录键 UI, when 按 Fn 一下, then 录制为单键「Fn」（Rust-driven 录键侦测）
- [ ] AC 8: Given 录音中 + 精简模式, when HUD 显示, then 右侧显示 [精简]
- [ ] AC 9: Given 录音中 + 自订模式, when HUD 显示, then 右侧显示 [自订]
- [ ] AC 10: Given 录键模式, when 按 ⌘+ESC, then 显示「ESC 为保留键」拒绝
- [ ] AC 11: Given 旧版设定有 `customTriggerKey`, when 升级启动, then 正常载入（向下相容，combo 是新 variant 不影响旧设定）

**Phase 2: 选取文字编辑**

- [ ] AC 12: Given macOS TextEdit 选取「你好世界」, when 按快捷键口述「翻译成英文」, then LLM 处理并贴回取代
- [ ] AC 13: Given macOS 无选取, when 按快捷键, then 正常转录
- [ ] AC 14: Given Windows, when 有选取文字按快捷键, then 忽略选取，正常转录
- [ ] AC 15: Given macOS 有选取, when HUD 显示, then 标签为 [指令]

## Additional Context

### Dependencies

- **无新增外部依赖**
- Rust `TriggerKey` enum 新增 variant 需 `cargo check` + serde roundtrip test
- 前端 `TriggerKey` 扩展需 `npx vue-tsc --noEmit`
- Phase 2 依赖 Phase 1（HUD label 机制）

### Testing Strategy

**Rust 测试**（`#[cfg(test)]`）：
- [P0] `TriggerKey::Combo` serde JSON roundtrip
- [P0] `matches_combo_trigger`（全 match, partial miss, wrong modifier）
- [P1] `check_double_tap` 时间边界（< 350ms pass, > 350ms fail, hold > 300ms fail, Toggle skip）
- [P0] 向下相容：旧 `TriggerKey` JSON（preset + custom）仍能反序列化

**前端 Vitest**（`tests/unit/`）：
- [P0] `isComboTriggerKey` type guard
- [P0] `getComboTriggerKeyDisplayName` 格式化（⌘+J、⌃+⇧+Space 等）
- [P0] `getTriggerKeyDisplayName` 三 variant 测试（preset / custom / combo 都不 crash）
- [P1] double-tap mode toggle（minimal ↔ active，持久化验证）
- [P0] 更新现有 `settingsStore.test.ts` 适配 `TriggerKey` 新 variant

**手动测试**：
- `pnpm tauri dev` 双平台（macOS 必测，Windows best-effort）
- 组合键录制（按住 ⌘ 再按 J → 正确捕获，只按 ⌘ 不放 → 维持等待，超时 10s → 取消）
- 组合键触发 + release（先放修饰 / 先放主键 / 同时放 → 都停止）
- 单键 double-tap + 组合键 double-tap（按住 ⌘ 点两下 J）
- double-tap 边界（300ms hold / 350ms gap）
- HUD 显示三种模式标签（精简/积极/自订）
- Phase 2: TextEdit、Notes、VS Code、Chrome 选取侦测

### Notes

**高风险项目：**
- 单一 Mutex lock 时间需最短化（callback 内只读 config，不做 IO）
- Double-tap 竞态：`waitForDoubleTapResolution` Promise 必须在 `invoke("stop_recording")` 之前 await。ESC abort 时必须 resolve(false) 避免 suspend
- Toggle 长按：spawn thread sleep 1s 后检查 `is_pressed`，使用 `toggle_long_press_fired` flag 防止 release 时重复 toggle
- Rust-driven 录键：recording mode 时 CGEventTap/hook callback 跳过所有 trigger ��辑。Fn 键在 recording mode 用 toggle-based（keycode 63）侦测；在 trigger mode 用 flag-based（`CGEventFlagSecondaryFn`）侦测
- `getTriggerKeyDisplayName` 必须处理 Combo variant，否则 runtime crash
- mode-switch HUD 生命周期：store 设 `modeSwitchLabel` + `showHud()`，3s 后清 label + `transitionTo("idle")` 触发 collapse（与 success 流程一致）

**已知限制：**
- Windows 无 Fn 键侦测（firmware 层）
- Windows 无选取文字编辑
- Mode toggle 不含 custom 模式（只在 minimal ↔ active 循环）
- Toggle 模式改为 release-based，短按有 ~100-200ms 延迟

**未来考量（out of scope）：**
- 多组快捷键 Slot
- 选取文字编辑的 Clipboard fallback
- Windows UI Automation
