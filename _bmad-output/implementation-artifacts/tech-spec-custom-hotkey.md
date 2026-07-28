---
title: '自订快捷键支援（Custom Hotkey）'
slug: 'custom-hotkey'
created: '2026-03-05'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Vue 3 Composition API', 'Rust', 'CGEventTap (macOS)', 'SetWindowsHookExW (Windows)', 'tauri-plugin-store', 'shadcn-vue', 'Pinia']
files_to_modify: ['src/types/settings.ts', 'src/stores/useSettingsStore.ts', 'src/views/SettingsView.vue', 'src-tauri/src/plugins/hotkey_listener.rs', 'src-tauri/src/lib.rs', 'src/lib/errorUtils.ts', 'src/lib/keycodeMap.ts']
code_patterns: ['TriggerKey closed enum → open enum with Custom variant', 'serde tagged enum for Rust↔JSON', 'DOM keydown for recording → platform keycode mapping', 'two-tier UI: preset Select + custom Record']
test_patterns: ['Vitest unit tests in tests/unit/', 'Rust #[cfg(test)] mod tests in same file']
reviewed: true
review_findings_addressed: 15
---

# Tech-Spec: 自订快捷键支援（Custom Hotkey）

**Created:** 2026-03-05

## Overview

### Problem Statement

目前使用者只能从固定的 9 个修饰键（Fn、Option、Control、Command、Shift 等）中选择触发键，无法使用其他按键（如 F5、CapsLock、~ 等非修饰键）。这限制了使用者根据自身习惯配置最顺手的快捷键。

### Solution

采用两层设计：
- **简易模式**（现状保留）：Select 下拉选单，提供平台推荐的修饰键快速选择
- **进阶模式**（新增）：按键录制（Record）UI，使用者点击录制按钮后按下任意单键，系统自动捕捉为触发键

包含冲突侦测机制——若使用者选择的按键为常见系统快捷键，显示警告但仍允许设定。

自订键设定独立持久化——切换模式不会遗失设定。

### Scope

**In Scope:**
- 前端：简易模式 / 进阶模式切换 UI
- 前端：按键录制 UI（点击「录制」→ 按任意键 → 捕捉并显示按键名称）
- 前端：冲突侦测警告（危险键 + 已有 preset 的键）
- 前端：DOM keydown 盲区说明（Fn、媒体键等系统键无法录制）
- Rust (macOS)：扩充 CGEventTap 回呼支援任意 keycode 比对（FlagsChanged + KeyDown/KeyUp）
- Rust (Windows)：扩充 SetWindowsHookExW 回呼支援任意 VK code 比对
- Rust：`TriggerKey` 型别扩充 + serde 序列化测试验证
- Store：独立持久化 custom key（`customTriggerKey` 栏位），切模式不遗失
- IPC：`update_hotkey_config` command 扩充支援 custom keycode

**Out of Scope:**
- 复合组合键（Cmd+Shift+X 等多键同时按下）
- 修改 HUD 动画或录音流程
- 触发模式变更（Hold/Toggle 维持现状，与本功能正交）

## Context for Development

### Codebase Patterns

1. **TriggerKey 封闭 enum 镜像模式**：Rust `TriggerKey` enum 与 TS `TriggerKey` 字串联合型别完全镜像，透过 `#[serde(rename_all = "camelCase")]` 序列化为 JSON。前端用字串字面型别（`"fn" | "option" | ...`），Rust 用 enum variant。
2. **设定持久化链路**：UI → `useSettingsStore.saveHotkeyConfig()` → `tauri-plugin-store` 写入 `settings.json` → `invoke("update_hotkey_config")` 同步 Rust state → `emitEvent(SETTINGS_UPDATED)` 广播所有视窗。
3. **Rust 键码比对模式**：macOS 透过 `matches_trigger_key_macos(keycode, &trigger)` 比对 CGEventTap 回传的 keycode；Windows 在 `hook_proc` 中用 `match trigger { ... kbd.vkCode == VK_XXX }` 比对。两者都是封闭 match，新增 `Custom` variant 需在两处加入分支。
4. **修饰键 vs 一般键的事件差异**：macOS CGEventTap 中，修饰键只触发 `FlagsChanged` 事件（flag-based 检测），一般键触发 `KeyDown`/`KeyUp`。目前只监听 `FlagsChanged`+Fn fallback，支援一般键需要**扩充 `KeyDown`/`KeyUp` 处理分支**。
5. **DOM keyCode vs 平台 keycode 差异**：WebView `KeyboardEvent.code` 是 Web 标准（如 `"F5"`、`"KeyA"`），需映射到 macOS keycode（如 F5=96）和 Windows VK code（如 F5=0x74）。
6. **DOM keydown 盲区**：Fn 键不触发 DOM keydown 事件（无 `"Fn"` code）、Media keys 被系统拦截、CapsLock 在 WKWebView 中 keyup 行为不一致。录制 UI 必须处理「按了但收不到事件」的情况。
7. **平台侦测**：现有程式码用 `navigator.userAgent.includes("Mac")`（`useSettingsStore.ts:26`、`SettingsView.vue:44`），新模组应统一使用同一侦测方式。

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/types/settings.ts:4-18` | `TriggerKey` 型别定义、`HotkeyConfig` 介面 |
| `src/stores/useSettingsStore.ts:25-28` | `getDefaultTriggerKey()` 平台预设 |
| `src/stores/useSettingsStore.ts:53-65` | `syncHotkeyConfigToRust()` — invoke IPC |
| `src/stores/useSettingsStore.ts:129-158` | `saveHotkeyConfig()` — 持久化 + 同步 + 广播 |
| `src/views/SettingsView.vue:43-88` | 快捷键 UI 区块（Select + mode toggle） |
| `src/views/SettingsView.vue:309-389` | 快捷键 template |
| `src-tauri/src/plugins/hotkey_listener.rs:12-27` | Rust `TriggerKey` enum |
| `src-tauri/src/plugins/hotkey_listener.rs:49-74` | `HotkeyListenerState` + `update_config()` |
| `src-tauri/src/plugins/hotkey_listener.rs:78-129` | `handle_key_event()` — Hold/Toggle 逻辑（不需修改） |
| `src-tauri/src/plugins/hotkey_listener.rs:142-150` | macOS keycode 常数 |
| `src-tauri/src/plugins/hotkey_listener.rs:213-224` | `matches_trigger_key_macos()` — 键码比对 |
| `src-tauri/src/plugins/hotkey_listener.rs:228-241` | `is_modifier_pressed()` — flag 检测 |
| `src-tauri/src/plugins/hotkey_listener.rs:260-334` | CGEventTap 回呼（FlagsChanged/KeyDown/KeyUp） |
| `src-tauri/src/plugins/hotkey_listener.rs:379-389` | Windows VK code 常数 |
| `src-tauri/src/plugins/hotkey_listener.rs:441-477` | Windows `hook_proc` — VK code 比对 |
| `src-tauri/src/lib.rs:87-99` | `update_hotkey_config` Tauri command |
| `src/lib/errorUtils.ts` | 错误讯息本地化 |

### Technical Decisions

**TD-1: TriggerKey 扩充为 tagged union**

Rust:
```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerKey {
    Fn, Option, RightOption, Command,
    RightAlt, LeftAlt,
    Control, RightControl, Shift,
    Custom { keycode: u16 },
}
```

TypeScript:
```typescript
export type PresetTriggerKey =
  | "fn" | "option" | "rightOption" | "command"
  | "rightAlt" | "leftAlt"
  | "control" | "rightControl" | "shift";

export interface CustomTriggerKey {
  custom: { keycode: number };
}

export type TriggerKey = PresetTriggerKey | CustomTriggerKey;
```

Serde externally tagged 表示法将 `Custom { keycode: 96 }` 序列化为 `{ "custom": { "keycode": 96 } }`。**此假设必须用 Rust 单元测试 `assert_eq!(serde_json::to_string(...), ...)` 验证，不可仅靠口头断言**。（Review F1）

**keycode 语意**：`keycode: u16` 的值在 macOS 是 CGEvent keycode，在 Windows 是 VK code。两者数值体系完全不同（如 F5: macOS=96, Windows=0x74）。此栏位为平台相依值，不可跨平台使用。（Review F5）

**TD-2: 按键录制使用前端 DOM `keydown` + 映射表**

新增 `src/lib/keycodeMap.ts`，汇出：
- `domCodeToMacKeycode: Record<string, number>` — DOM `event.code` → macOS keycode
- `domCodeToWindowsVkCode: Record<string, number>` — DOM `event.code` → Windows VK code
- `KEY_DISPLAY_NAMES: Record<string, string>` — `event.code` → 显示名称
- `getPlatformKeycode(domCode: string): number | null` — 取得当前平台的原生 keycode
- `getKeyDisplayName(domCode: string): string` — 取得按键显示名称
- `DANGEROUS_KEYS: Set<string>` — 冲突侦测用的危险键清单
- `PRESET_DOM_CODES: Set<string>` — 对应现有 preset 修饰键的 DOM code 集合（用于提示使用者切回简易模式）
- `isDangerousKey(domCode: string): boolean`
- `isPresetEquivalentKey(domCode: string): boolean` — 检查是否为已有 preset 的修饰键

平台侦测使用与现有程式码一致的 `navigator.userAgent.includes("Mac")` 方式。（Review F6：统一现有做法而非引入新依赖）

**已知 DOM keydown 盲区**（Review F3）：
- **Fn 键**：不触发 DOM keydown（无 `"Fn"` code），完全无法录制
- **Media keys**（播放/暂停/音量）：被 macOS 系统拦截，WebView 收不到
- **Power / Eject / Touch Bar 专用键**：不产生 DOM 事件
- CapsLock 的 keyup 在某些 WebView 中不触发

→ 录制 UI 超时讯息改为「未侦测到按键，部分系统键（Fn、媒体键）无法录制，请使用简易模式」

**TD-3: CGEventTap 回呼扩充 KeyDown/KeyUp 处理**

Custom key 若为非修饰键，不会触发 `FlagsChanged`，需在 `KeyDown`/`KeyUp` 分支加入：
```rust
CGEventType::KeyDown => {
    if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
        if keycode == *custom_kc {
            handle_key_event(&app_handle, true, &state);
        }
    }
    // existing Fn fallback...
}
```

若 Custom key 恰好是修饰键，`FlagsChanged` 分支也需处理（flag-based 检测）���
```rust
CGEventType::FlagsChanged => {
    // ...existing modifier logic...
    if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
        if keycode == *custom_kc {
            if let Some(pressed) = is_modifier_pressed(flags, &trigger) {
                handle_key_event(&app_handle, pressed, &state, &mode);
            } else {
                let was_pressed = state.is_pressed.load(Ordering::SeqCst);
                handle_key_event(&app_handle, !was_pressed, &state, &mode);
            }
        }
    }
}
```
注意：`is_modifier_pressed` 对已知修饰键 keycode（含 Fn=63）回传 `Some(bool)` 基于 CGEventFlags；未知 keycode 回传 `None` 时 fallback 至 toggle-based。

**CapsLock 注意**（Review F4）：CapsLock（keycode 57）在 macOS 的 `FlagsChanged` 行为特殊——按住不放时只触发一次事件，且 macOS 有系统层级延迟（长按切换输入法）。toggle-based 检测在 Hold 模式下可能不可靠。已将 CapsLock 加入 `DANGEROUS_KEYS` 并标注警告。

**TD-4: Windows hook_proc 扩充**

```rust
let matches = match trigger {
    TriggerKey::RightAlt => kbd.vkCode == VK_RMENU,
    // ...existing...
    TriggerKey::Custom { keycode } => kbd.vkCode == keycode as u32,
};
```

`u16 as u32` 零扩展安全，Windows VK code 实际范围 0-254 不会超过 u16 上限。

**TD-5: 冲突侦测清单**

`DANGEROUS_KEYS` 包含（Review F9 扩充）：
- **通用危险键**：`Escape`, `Enter`, `Space`, `Tab`, `Backspace`, `Delete`
- **系统键**：`MetaLeft`, `MetaRight`（Win/Cmd）
- **CapsLock**（macOS 行为不可靠，额外警告标注）
- **功能键风险**：`F1`（Help）, `F11`（全萤幕）, `PrintScreen`, `NumLock`, `ScrollLock`, `Insert`, `Pause`

**TD-6: 按键显示名称**

映射表同时提供 displayName，UI 显示人类可读名称。持久化存 keycode 数字，显示时查表。

**TD-7: 自订键独立持久化**（Review F7）

`settings.json` 结构：
```json
{
  "hotkeyTriggerKey": "fn",
  "hotkeyTriggerMode": "hold",
  "customTriggerKey": { "custom": { "keycode": 96 } },
  "customTriggerKeyDomCode": "F5"
}
```

- `hotkeyTriggerKey`：当前 active 的触发键（preset 或 custom 值）
- `customTriggerKey`：独立保存的自订键设定（切到简易模式时保留，不清除）
- `customTriggerKeyDomCode`：保存 DOM code 字串，用于反查显示名称（避免 keycode → display name 的反向映射）

切到简易模式 → `hotkeyTriggerKey` 改为 preset 值，`customTriggerKey` 不动
切回自订模式 → `hotkeyTriggerKey` 改为 `customTriggerKey` 的值

**TD-8: 录到已有 preset 键的处理**（Review F12）

当录制的 `event.code` 在 `PRESET_DOM_CODES` 中（如 `"ShiftLeft"` → 对应 preset `Shift`），显示提示：「此按键已在简易模式中可用，建议切换至简易模式」。不阻挡，使用者可忽略继续存为 Custom。

## Implementation Plan

### Task 依赖（Review F8）

```
Task 1 (keycodeMap) ──→ Task 2 (TS 型别) ──→ Task 5 (Store) ──→ Task 6 (UI)
                                            ↗                       ↑
                        Task 3 (Rust macOS) ─┘                      │
                        Task 4 (Rust Windows)─┘                     │
                        Task 7 (errorUtils) ────────────────────────┘
```

建议执行顺序：`1 → 2 → [3, 4 平行] → 5 → 7 → 6`

### Tasks

- [x] **Task 1: 新增按键映射模组 `src/lib/keycodeMap.ts`**
  - File: `src/lib/keycodeMap.ts`（新建）
  - Action: 建立 DOM `event.code` → 平台原生 keycode 映射表
  - 内容：
    - `domCodeToMacKeycode` 映射（覆盖 F1-F12、字母键 A-Z、数字键 0-9、符号键、CapsLock、功能键等约 80-100 键）
    - `domCodeToWindowsVkCode` 映射（同上范围）
    - `KEY_DISPLAY_NAMES: Record<string, string>` — `event.code` → 显示名称（如 `"F5"`, `"CapsLock"`, `"A"`）
    - `getPlatformKeycode(domCode: string): number | null` — 平台侦测用 `navigator.userAgent.includes("Mac")`，与现有程式码一致
    - `getKeyDisplayName(domCode: string): string` — 返回显示名称，fallback 为 `domCode` 本身
    - `DANGEROUS_KEYS: Set<string>` — 完整清单：`Escape, Enter, Space, Tab, Backspace, Delete, MetaLeft, MetaRight, CapsLock, F1, F11, PrintScreen, NumLock, ScrollLock, Insert, Pause`
    - `isDangerousKey(domCode: string): boolean`
    - `PRESET_DOM_CODES: Set<string>` — `ShiftLeft, ShiftRight, ControlLeft, ControlRight, AltLeft, AltRight, MetaLeft, MetaRight` 等对应现有 preset 的 DOM code
    - `isPresetEquivalentKey(domCode: string): boolean`
    - `getDangerousKeyWarning(domCode: string): string | null` — CapsLock 回传额外警告「macOS 上 CapsLock 在 Hold 模式下可能不稳定」，其他危险键回传通用警告
  - Notes: 纯函式模组，无 Vue/Tauri 依赖。平台侦测函式接受可选参数方便测试。

- [x] **Task 2: 扩充 TypeScript 型别定义**
  - File: `src/types/settings.ts`
  - Action: 将 `TriggerKey` 从字串联合型别扩充为支援 custom variant
  - 具体变更：
    ```typescript
    export type PresetTriggerKey =
      | "fn" | "option" | "rightOption" | "command"
      | "rightAlt" | "leftAlt"
      | "control" | "rightControl" | "shift";

    export interface CustomTriggerKey {
      custom: { keycode: number };
    }

    export type TriggerKey = PresetTriggerKey | CustomTriggerKey;

    export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
      return typeof key === "string";
    }

    export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
      return typeof key === "object" && "custom" in key;
    }
    ```
  - Notes: `HotkeyConfig` 介面不变。型别守卫供 UI 和 Store 判断使用。

- [x] **Task 3: 扩充 Rust `TriggerKey` enum + serde 测试**
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `TriggerKey` enum 新增 `Custom` variant + 扩充 macOS 处理
  - 具体变更：
    - 在 enum 末尾新增 `Custom { keycode: u16 }`
    - 在 `matches_trigger_key_macos()` 新增：`TriggerKey::Custom { keycode: custom_kc } => keycode == *custom_kc`
    - 在 `is_modifier_pressed()` 新增：`TriggerKey::Custom { .. } => None`
    - 扩充 CGEventTap 回呼 `FlagsChanged`：Custom + keycode 匹配 → `is_modifier_pressed` flag-based 检测（已知修饰键），fallback toggle-based（未知键）
    - 扩充 CGEventTap 回呼 `KeyDown`：Custom + keycode 匹配 → `handle_key_event(true)`
    - 扩充 CGEventTap 回呼 `KeyUp`：Custom + keycode 匹配 → `handle_key_event(false)`
    - **新增 `#[cfg(test)]` 测试**（Review F1）：
      - `test_custom_trigger_key_serde_serialize`：`assert_eq!(serde_json::to_value(TriggerKey::Custom { keycode: 96 }).unwrap(), json!({"custom": {"keycode": 96}}))`
      - `test_custom_trigger_key_serde_deserialize`：从 `json!({"custom": {"keycode": 96}})` 反序列化
      - `test_preset_trigger_key_serde_roundtrip`：验证 `"fn"` 字串序列化/反序列化不受 Custom variant 影响
      - `test_matches_trigger_key_macos_custom`：验证 Custom variant 的比对
  - Notes: `handle_key_event()` 不需修改

- [x] **Task 4: 扩充 Windows hook_proc**
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `windows_hook` 模组的 `hook_proc` match 分支加入 Custom
  - 具体变更：`TriggerKey::Custom { keycode } => kbd.vkCode == keycode as u32`
  - Notes: Windows hook 已统一处理 KeyDown/KeyUp，不需额外分支。可与 Task 3 平行。

- [x] **Task 5: 扩充 Pinia Store（独立持久化）**
  - File: `src/stores/useSettingsStore.ts`
  - Action: 支援 `CustomTriggerKey` + 独立持久化自订键设定
  - 具体变更：
    - 新增 state：`customTriggerKey: ref<CustomTriggerKey | null>(null)` 和 `customTriggerKeyDomCode: ref<string>("")`
    - `saveHotkeyConfig(key: TriggerKey, mode: TriggerMode)`：若 key 为 custom，同时写入 `hotkeyTriggerKey` 和 `customTriggerKey` + `customTriggerKeyDomCode`
    - `saveCustomTriggerKey(keycode: number, domCode: string, mode: TriggerMode)`：新增专用函式，同时更新 active key 和 custom key 储存
    - `switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode)`：切到简易模式，只更新 `hotkeyTriggerKey`，不清除 `customTriggerKey`
    - `switchToCustomMode(mode: TriggerMode)`：切到自订模式，从 `customTriggerKey` 还原 active key
    - `loadSettings()`：额外读取 `customTriggerKey` 和 `customTriggerKeyDomCode`
    - 新增 helper：`getTriggerKeyDisplayName(key: TriggerKey): string`
    - **修正 log 格式**（Review F13）：`console.log(\`[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}\`)`
    - **向后相容验证**（Review F2）：`loadSettings()` 中加入防御：若 `store.get("hotkeyTriggerKey")` 回传字串，直接当 PresetTriggerKey 使用；若回传物件，当 CustomTriggerKey 使用
  - Notes: `syncHotkeyConfigToRust()` 签名不变，Rust serde 自动处理

- [x] **Task 6: 实作按键录制 UI + 两层切换**
  - File: `src/views/SettingsView.vue`
  - Action: 在快捷键设定 Card 中新增两层 UI
  - 具体变更：
    - **模式切换**：在触发键 Select 上方新增「简易 / 自订」切换（用两个按钮，类似现有 Hold/Toggle 切换样式）
    - **简易模式**（`isCustomMode = false`）：保持现有 Select 下拉逻辑不变
    - **自订模式**（`isCustomMode = true`）：
      - 显示当前自订键名称（从 `customTriggerKeyDomCode` 查表）或「未设定」
      - 一个「录制」Button，点击后进入录制状态
      - 录制状态：Button 文字变为「请按下按键...」，脉动动画（`animate-pulse`）
      - **动态注册 keydown listener**（Review F11）：仅在 `isRecording = true` 时 `addEventListener`，录制结束时 `removeEventListener`。不要挂整个元件生命周期。
      - 录制 keydown handler：
        - `event.preventDefault()` + `event.stopPropagation()`
        - Escape → 取消录制
        - 捕捉 `event.code` → `getPlatformKeycode()` 取得 keycode
        - keycode 为 null → 显示「不支援此按键」错误
        - `isDangerousKey()` → 显示黄色警告（`getDangerousKeyWarning()` 取得讯息），仍储存
        - `isPresetEquivalentKey()` → 显示提示「此按键已在简易模式中可用，建议切换至简易模式」（Review F12），仍储存
        - 正常 → `settingsStore.saveCustomTriggerKey(keycode, domCode, currentMode)`
      - 录制超时 10 秒，超时讯息：「未侦测到按键。部分系统键（Fn、媒体键）无法录制，请使用简易模式。」（Review F3）
      - 录制按钮下方小字：「Fn、媒体键等系统键请使用简易模式」（Review F3）
    - **模式切换联动**（Review F7）：
      - 从简易切到自订：若有保存的 `customTriggerKey`，自动还原为 active key；否则显示「未设定」等待录制
      - 从自订切到简易：active key 切回平台预设 preset key，**但 `customTriggerKey` 保留不清除**
    - **初始化**：`onMounted` 时根据 `settingsStore.hotkeyConfig?.triggerKey` 判断是 preset 还是 custom，设定 `isCustomMode` 初始值
    - **系统级快捷键限制说明**（Review F10）：`event.preventDefault()` 无法拦截系统级快捷键（Cmd+Q、Win+L 等），在录制 UI 不需额外处理，但超时提示已覆盖此情境
  - Notes: 使用 shadcn-vue `Button` 元件。警告用黄色（`text-yellow-400` 或语意色彩），提示用蓝色（`text-blue-400`）。

- [x] **Task 7: 新增冲突警告错误讯息**
  - File: `src/lib/errorUtils.ts`
  - Action: 新增快捷键相关警告/提示讯息函式
  - 具体变更：
    - `getHotkeyConflictWarning(domCode: string): string` — 通用：「此按键（{displayName}）可能与系统快捷键冲突，建议选择其他按键」
    - `getHotkeyCapslockWarning(): string` — CapsLock 专用：「CapsLock 在 macOS 的 Hold 模式下可能不稳定，建议使用 Toggle 模式或选择其他按键」
    - `getHotkeyPresetHint(domCode: string): string` — preset 提示：「此按键已在简易模式中可用，建议切换至简易模式」
    - `getHotkeyRecordingTimeoutMessage(): string` — 超时：「未侦测到按键。部分系统键（Fn、媒体键）无法录制，请使用简易模式。」
    - `getHotkeyUnsupportedKeyMessage(): string` — 不支援：「不支援此按键」
  - Notes: 所有讯息繁体中文。警告为黄色（非错误），提示为蓝色。

### Acceptance Criteria

- [x] **AC 1**: Given 使用者在简易模式下, when 从 Select 选择 "Fn" 触发键, then 行为与现有功能完全相同（向后相容）
- [x] **AC 2**: Given 使用者切换到自订模式, when 点击「录制」按钮并按下 F5 键, then 系统捕捉 F5 并显示「F5」作为当前触发键
- [x] **AC 3**: Given 使用者已录制 F5 为触发键, when 在任意应用程式中按下 F5, then SayIt 触发录音（Hold 模式：按住开始、放开停止）
- [x] **AC 4**: Given 使用者已录制 F5 为触发键（Toggle 模式）, when 按下 F5, then SayIt 开始录音；再按 F5 则停止录音
- [x] **AC 5**: Given 使用者在录制状态中, when 按下 Escape, then 取消录制（不设定触发键），回到非录制状态
- [x] **AC 6**: Given 使用者在录制状态中, when 等待超过 10 秒未按键, then 自动取消录制，显示「未侦测到按键。部分系统键（Fn、媒体键）无法录制，请使用简易模式。」
- [x] **AC 7**: Given 使用者在录制状态中, when 按下 Enter 键, then 显示黄色警告「此按键可能与系统快捷键冲突」，但仍成功设定为触发键
- [x] **AC 8**: Given 使用者在录制状态中, when 按下 WebView 无法映射的按键, then 显示「不支援此按键」错误，不设定触发键
- [x] **AC 9**: Given 使用者设定自订键后关闭并重启 App, when App 启动载入 settings.json, then 自订键正确还原，Rust 端正确监听
- [x] **AC 10**: Given 使用者设定自订键后, when 切回简易模式再切回自订模式, then 自订键设定仍保留（不需重新录制）
- [x] **AC 11**: Given 旧版 settings.json 存有 `"hotkeyTriggerKey": "fn"`, when 新版 App 启动, then 正确读取为 preset 触发键（向后相容）
- [x] **AC 12（macOS）**: Given 使用者录制 CapsLock 为触发键, when 按下 CapsLock, then CGEventTap 的 FlagsChanged 正确触发 handle_key_event，且显示 CapsLock 专用警告
- [x] **AC 13（Windows）**: Given 使用者录制 F5 为触发键, when 按下 F5, then Windows keyboard hook 正确触发 handle_key_event
- [x] **AC 14**: Given 使用者在自订模式录制了 Left Shift（已有 preset）, when 录制完成, then 显示蓝色提示「此按键已在简易模式中可用」，仍储存为 custom key
- [x] **AC 15**: Given Rust 端 `TriggerKey::Custom { keycode: 96 }`, when serde 序列化, then 输出为 `{"custom":{"keycode":96}}`（有 Rust 单元测试验证）
- [x] **AC 16**: Given 使用者在非录制状态, when 在设定页面输入 API Key 或 Prompt 文字, then keydown listener 不会被触发（动态注册）

## Additional Context

### Dependencies

- 无新外部依赖——仅新增一个 `src/lib/keycodeMap.ts` 内部映射模组
- Rust 端无新 crate 依赖——`Custom { keycode: u16 }` 直接用现有 serde 序列化
- 依赖现有模组：`useFeedbackMessage` composable（显示警告/成功讯息）、shadcn-vue `Button` 元件

### Testing Strategy

**单元测试（Vitest）：**
- `tests/unit/keycode-map.test.ts`：
  - `getPlatformKeycode()` 对常见键的映射正确性（F1-F12, A-Z, 0-9, CapsLock）
  - `isDangerousKey()` 侦测完整清单
  - `isPresetEquivalentKey()` 侦测
  - `getKeyDisplayName()` 回传值
  - `getDangerousKeyWarning()` 对 CapsLock 回传专用警告
- `tests/unit/types.test.ts`：扩充现有测试，验证 `isPresetTriggerKey()` / `isCustomTriggerKey()` 型别守卫

**Rust 测试：**
- 在 `hotkey_listener.rs` 的 `#[cfg(test)]` 中新增：
  - `test_custom_trigger_key_serde_serialize`：精确验证 JSON 输出
  - `test_custom_trigger_key_serde_deserialize`：验证反序列化
  - `test_preset_trigger_key_backward_compat`：验证 `"fn"` 字串不受新 variant 影响
  - `test_matches_trigger_key_macos_custom`：验证 Custom variant 的比对

**手动测试：**
- macOS: 录制 F5 → 按 F5 触发录音 → 放开停止
- macOS: 录制 CapsLock → 测试 FlagsChanged 路径 + 警告显示
- Windows: 录制 F5 → 按 F5 触发录音
- 两平台：简易↔自订模式切换（自订键保留验证）、App 重启还原、Escape 取消、10 秒超时讯息
- 向后相容：用旧版 settings.json 启动新版 App

### Notes

- **高风险项：DOM keyCode → macOS keycode 映射表准确性**。映射表需手动维护，若有遗漏会导致「不支援此按键」。建议先覆盖最常见的 80 个键，后续根据使用者回报补充。
- **CapsLock 在 macOS 的特殊行为**：CapsLock 触发 `FlagsChanged` 事件（keycode 57），有系统层级延迟（长按切换输入法），且 Hold 模式下可能不可靠。已加入 `DANGEROUS_KEYS` + 专用警告。
- **Hold 模式 + 一般��的语意**：一般键（如 F5）有明确的 KeyDown/KeyUp，Hold 模式语意清晰。修饰键走 FlagsChanged flag-based 路径（`is_modifier_pressed` 查 CGEventFlags）；未知修饰键 fallback toggle-based。Preset Fn 只回应 keycode 63 的 FlagsChanged（避免 Globe 键系统事件干扰）。
- **DOM keydown 盲区**：Fn、Media keys、Power 等完全不触发 DOM 事件，录制 UI 已加入超时提示和说明文字。
- **系统级快捷键**：`event.preventDefault()` 无法拦截 Cmd+Q、Win+L 等。录制中按这些键可能导致 App 退出或系统锁定，此为 OS 层级限制，不做额外处理。
- 触发模式（Hold / Toggle）与本功能正交，`handle_key_event()` 不需修改。
- 向后相容：serde externally tagged enum 对旧格式字串（如 `"fn"`）反序列化为 unit variant，Custom variant 不影响。Rust 测试验证此假设。
