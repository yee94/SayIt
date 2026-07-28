# Story 5.1: 快捷键设定介面

Status: done

## Story

As a 使用者,
I want 在设定页面自订触发键和触发模式,
so that 我能选择最顺手的按键组合来触发语音输入。

## Acceptance Criteria

1. **AC1: 触发键下拉选单**
   - Given SettingsView.vue 的快捷键设定区块
   - When 使用者开启设定页面
   - Then 显示「触发键」下拉选单，依当前平台显示可选项
   - And macOS 可选：Fn、左 Option、右 Option、左 Control、右 Control、Command、Shift
   - And Windows 可选：右 Alt（预设）、左 Alt、Control、Shift
   - And 当前已选的触发键为预设选中状态

2. **AC2: 触发模式切换**
   - Given 快捷键设定区块
   - When 使用者开启设定页面
   - Then 显示「触发模式」切换控制项（Hold / Toggle）
   - And 当前模式为预设选中状态
   - And 附带简短说明：Hold =「按住录音，放开停止」/ Toggle =「按一下开始，再按停止」

3. **AC3: 触发键变更即时生效**
   - Given 使用者变更触发键
   - When 从下拉选单选择新的触发键
   - Then useSettingsStore 更新 hotkeyConfig 并持久化至 tauri-plugin-store
   - And 发送 `settings:updated` Tauri Event `{ key: 'hotkey', value: newConfig }`
   - And hotkey_listener.rs 接收事件后即时切换为新触发键
   - And 无需重启 App

4. **AC4: 触发模式变更即时生效**
   - Given 使用者变更触发模式
   - When 切换 Hold / Toggle
   - Then useSettingsStore 更新 triggerMode 并持久化至 tauri-plugin-store
   - And 发送 `settings:updated` Tauri Event `{ key: 'triggerMode', value: 'hold' | 'toggle' }`
   - And hotkey_listener.rs 即时切换模式
   - And 无需重启 App

5. **AC5: 重启后保持设定**
   - Given App 重新启动
   - When hotkey_listener.rs 初始化
   - Then 从 tauri-plugin-store 读取已储存的触发键和触发模式
   - And 使用使用者上次设定的配置启动
   - And 若无储存设定，使用平台预设值（macOS: Fn + Hold / Windows: 右Alt + Hold）

## Tasks / Subtasks

- [x] Task 1: 新增快捷键设定 section 到 SettingsView.vue (AC: #1, #2)
  - [x] 1.1 新增快捷键设定 section（放在 API Key section 上方）
  - [x] 1.2 触发键下拉选单：`<select>` 绑定 hotkeyConfig.triggerKey
  - [x] 1.3 依平台过滤可选项（isMac 判断）
  - [x] 1.4 触发模式切换：两个 radio button 或 segmented control（Hold / Toggle）
  - [x] 1.5 模式说明文字：Hold =「按住录音，放开停止」/ Toggle =「按一下开始，再按停止」

- [x] Task 2: 实作触发键和触发模式变更处理 (AC: #3, #4)
  - [x] 2.1 handleTriggerKeyChange：呼叫 settingsStore.saveHotkeyConfig(newKey, currentMode)
  - [x] 2.2 handleTriggerModeChange：呼叫 settingsStore.saveHotkeyConfig(currentKey, newMode)
  - [x] 2.3 变更后显示回馈讯息（「快捷键已更新」）
  - [x] 2.4 错误处理：try/catch 显示错误回馈

- [x] Task 3: 发送 settings:updated Tauri Event (AC: #3, #4)
  - [x] 3.1 在 useSettingsStore.saveHotkeyConfig() 成功后发送 SETTINGS_UPDATED 事件
  - [x] 3.2 payload: `{ key: 'hotkey', value: { triggerKey, triggerMode } }`
  - [x] 3.3 使用 emitEvent（广播给所有视窗）

- [x] Task 4: 手动整合测试 (AC: #1-#5)
  - [x] 4.1 验证触发键选单正确显示平台选项
  - [x] 4.2 验证变更触发键后立即生效（不需重启）
  - [x] 4.3 验证变更触发模式后立即生效
  - [x] 4.4 验证重启 App 后设定保持
  - [x] 4.5 验证预设值正确（macOS: Fn + Hold / Windows: 右Alt + Hold）

## Dev Notes

### 已完成的基础设施分析

大部分底层功能已在先前 Stories（1.1、1.2）实作完成：

| 元件 | 现状 | Story 5.1 需做的 |
|------|------|-------------------|
| `src/stores/useSettingsStore.ts` | **完整**：hotkeyConfig ref、saveHotkeyConfig()、loadSettings()、syncHotkeyConfigToRust() | 新增 SETTINGS_UPDATED 事件发送 |
| `src/types/settings.ts` | **完整**：TriggerKey union type、HotkeyConfig interface | 不需修改 |
| `src-tauri/src/lib.rs` | **完整**：update_hotkey_config Rust command | 不需修改 |
| `src-tauri/src/plugins/hotkey_listener.rs` | **完整**：HotkeyListenerState、trigger key/mode 即时切换 | 不需修改 |
| `src/views/SettingsView.vue` | 有 API Key section + AI Prompt section | **新增快捷键 section** |
| `src/composables/useTauriEvents.ts` | SETTINGS_UPDATED 常数已定义 | 不需修改 |
| `src/types/events.ts` | SettingsUpdatedPayload 已定义 | 不需修改 |

**结论**：此 Story 主要是 UI 工作 + 一行 Tauri Event 发送。Store 和 Rust 端已完成。

### useSettingsStore 现有 API

```typescript
// 已存在：
const hotkeyConfig = ref<HotkeyConfig | null>(null);
const triggerMode = computed<TriggerMode>(() => hotkeyConfig.value?.triggerMode ?? "hold");

async function saveHotkeyConfig(key: TriggerKey, mode: TriggerMode) {
  // 1. 持久化到 tauri-plugin-store
  // 2. 更新 hotkeyConfig ref
  // 3. syncHotkeyConfigToRust() — invoke Rust command 即时切换
}

async function loadSettings() {
  // startup 时载入：hotkey config + API Key + AI Prompt
}
```

**saveHotkeyConfig 已处理**：持久化 + 同步到 Rust。Story 5.1 只需在成功后额外发送 SETTINGS_UPDATED 事件。

### settings:updated 事件发送

在 `useSettingsStore.saveHotkeyConfig()` 末尾新增：

```typescript
import { emitEvent, SETTINGS_UPDATED } from '../composables/useTauriEvents';
import type { SettingsUpdatedPayload } from '../types/events';

// saveHotkeyConfig 成功后
const payload: SettingsUpdatedPayload = {
  key: 'hotkey',
  value: { triggerKey: key, triggerMode: mode },
};
await emitEvent(SETTINGS_UPDATED, payload);
```

**注意**：使用 `emitEvent`（广播所有视窗），让 HUD Window 也能收到设定变更通知。

### TriggerKey 平台选项

```typescript
// src/types/settings.ts 已定义
type TriggerKey = "fn" | "option" | "rightOption" | "command" | "rightAlt" | "leftAlt" | "control" | "rightControl" | "shift";

// 平台选项分组
const MAC_TRIGGER_KEY_OPTIONS: { value: TriggerKey; label: string }[] = [
  { value: "fn", label: "Fn" },
  { value: "option", label: "左 Option (⌥)" },
  { value: "rightOption", label: "右 Option (⌥)" },
  { value: "control", label: "左 Control (⌃)" },
  { value: "rightControl", label: "右 Control (⌃)" },
  { value: "command", label: "Command (⌘)" },
  { value: "shift", label: "Shift (⇧)" },
];

const WINDOWS_TRIGGER_KEY_OPTIONS: { value: TriggerKey; label: string }[] = [
  { value: "rightAlt", label: "右 Alt" },
  { value: "leftAlt", label: "左 Alt" },
  { value: "control", label: "Control" },
  { value: "shift", label: "Shift" },
];

const isMac = navigator.userAgent.includes("Mac");
const triggerKeyOptions = isMac ? MAC_TRIGGER_KEY_OPTIONS : WINDOWS_TRIGGER_KEY_OPTIONS;
```

### 触发键下拉选单

```html
<select
  :value="settingsStore.hotkeyConfig?.triggerKey"
  class="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500"
  @change="handleTriggerKeyChange(($event.target as HTMLSelectElement).value as TriggerKey)"
>
  <option v-for="opt in triggerKeyOptions" :key="opt.value" :value="opt.value">
    {{ opt.label }}
  </option>
</select>
```

### 触发模式切换

使用两个 radio-style 按钮（segmented control 风格）：

```html
<div class="flex gap-2">
  <button
    type="button"
    class="rounded-lg px-4 py-2 text-sm font-medium transition"
    :class="settingsStore.triggerMode === 'hold'
      ? 'bg-blue-600 text-white'
      : 'border border-zinc-600 text-zinc-300 hover:bg-zinc-800'"
    @click="handleTriggerModeChange('hold')"
  >
    Hold
  </button>
  <button
    type="button"
    class="rounded-lg px-4 py-2 text-sm font-medium transition"
    :class="settingsStore.triggerMode === 'toggle'
      ? 'bg-blue-600 text-white'
      : 'border border-zinc-600 text-zinc-300 hover:bg-zinc-800'"
    @click="handleTriggerModeChange('toggle')"
  >
    Toggle
  </button>
</div>
<p class="mt-2 text-sm text-zinc-400">
  {{ settingsStore.triggerMode === 'hold'
    ? '按住录音，放开停止'
    : '按一下开始，再按停止' }}
</p>
```

### 事件处理函式

```typescript
async function handleTriggerKeyChange(newKey: TriggerKey) {
  const currentMode = settingsStore.triggerMode;
  try {
    await settingsStore.saveHotkeyConfig(newKey, currentMode);
    showHotkeyFeedback("success", "触发键已更新");
  } catch (err) {
    showHotkeyFeedback("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey = settingsStore.hotkeyConfig?.triggerKey ?? getDefaultTriggerKey();
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    showHotkeyFeedback("success", "触发模式已更新");
  } catch (err) {
    showHotkeyFeedback("error", extractErrorMessage(err));
  }
}
```

### UI 布局建议

快捷键 section 放在 API Key section 上方（快捷键是最常调整的设定）：

```
┌─ 设定 ──────────────────────────────────────────────┐
│                                                      │
│ ┌─ 快捷键设定 ─────────────────────────────────────┐ │
│ │ 触发键    [下拉选单: Fn ▼]                        │ │
│ │ 触发模式  [Hold] [Toggle]                         │ │
│ │           按住录音，放开停止                        │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ┌─ Groq API Key ──────────────────────── [已设定] ─┐ │
│ │ ...                                              │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ┌─ AI 整理 Prompt ────────────────────────────────┐ │
│ │ ...                                              │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### AC5 重启保持设定 — 已完成

`useSettingsStore.loadSettings()` 已在 `main-window.ts` 启动时呼叫，会从 tauri-plugin-store 读取储存的 `hotkeyTriggerKey` 和 `hotkeyTriggerMode`，并透过 `syncHotkeyConfigToRust()` 同步到 Rust。**AC5 已由现有程式码满足，不需额外实作。**

### 不需修改的档案

- `src/types/settings.ts` — TriggerKey、HotkeyConfig 已完整定义
- `src/types/events.ts` — SettingsUpdatedPayload 已定义
- `src/composables/useTauriEvents.ts` — SETTINGS_UPDATED 已定义
- `src-tauri/src/lib.rs` — update_hotkey_config command 已实作
- `src-tauri/src/plugins/hotkey_listener.rs` — 即时切换已实作
- `src/router.ts` — /settings 路由已注册
- `src/MainApp.vue` — sidebar 已包含设定

### 需要修改的档案清单

| 档案 | 修改范围 |
|------|---------|
| `src/views/SettingsView.vue` | 新增快捷键设定 section（触发键下拉 + 触发模式切换 + 回馈讯息） |
| `src/stores/useSettingsStore.ts` | saveHotkeyConfig() 末尾新增 SETTINGS_UPDATED 事件发送（1-2 行） |

### 跨 Story 备注

- **Story 5.2** 会在 SettingsView 新增「开机自启动」开关 section
- saveHotkeyConfig 的 SETTINGS_UPDATED 事件目前无消费者（HUD Window 不需要反应快捷键变更，因为 Rust 端已直接处理）。但事件机制为未来扩展预留

### Project Structure Notes

- 不新增任何新档案
- 所有修改在既有专案结构内
- SettingsView.vue 是 Main Window 设定页面
- useSettingsStore 的修改极小（1-2 行事件发送）

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1] — AC 完整定义（lines 742-781）
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — Tauri Events 跨视窗同步
- [Source: _bmad-output/planning-artifacts/architecture.md#Security] — tauri-plugin-store 本地储存
- [Source: src/stores/useSettingsStore.ts] — 完整：hotkeyConfig、saveHotkeyConfig、loadSettings、syncHotkeyConfigToRust
- [Source: src/types/settings.ts] — TriggerKey union type、HotkeyConfig interface
- [Source: src/types/events.ts] — SettingsUpdatedPayload
- [Source: src/composables/useTauriEvents.ts] — SETTINGS_UPDATED 常数
- [Source: src/views/SettingsView.vue] — 现有 API Key + AI Prompt sections（UI 参考）
- [Source: src-tauri/src/lib.rs] — update_hotkey_config Rust command（line 87）
- [Source: src-tauri/src/plugins/hotkey_listener.rs] — HotkeyListenerState 即时切换

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vue-tsc: 无新增错误
- pnpm test: 182 tests passed (11 test files)

### Completion Notes List

- SettingsView.vue 新增快捷键设定 section，放在 API Key section 上方
- 触发键下拉选单依平台显示 macOS (Fn/左Option/右Option/左Control/右Control/Command/Shift) 或 Windows (右Alt/左Alt/Control/Shift) 选项
- 触发模式 Hold/Toggle segmented button 含动态说明文字
- 回馈讯息使用独立的 hotkeyFeedback state + 2.5s 自动消失 timer
- useSettingsStore.saveHotkeyConfig() 新增 SETTINGS_UPDATED 事件广播（emitEvent）
- 已有 AC5（重启保持设定）由既有 loadSettings() 满足，无需额外实作
- 新增 tests/unit/use-settings-store.test.ts（16 个测试覆盖 loadSettings、saveHotkeyConfig、saveApiKey、deleteApiKey、saveAiPrompt、resetAiPrompt）
- 测试重点：saveHotkeyConfig 的 SETTINGS_UPDATED 事件广播、store 持久化、Rust sync、ref 更新、fallback 逻辑

### Change Log

| 档案 | 修改范围 |
|------|----------|
| `src/views/SettingsView.vue` | 新增快捷键设定 section（触发键下拉 + Hold/Toggle 模式切换 + 回馈讯息 + onBeforeUnmount cleanup） |
| `src/stores/useSettingsStore.ts` | saveHotkeyConfig() 新增 SETTINGS_UPDATED 事件发送（+imports, +5 行） |
| `tests/unit/use-settings-store.test.ts` | 新增 16 个单元测试（loadSettings 5 + saveHotkeyConfig 5 + saveApiKey 2 + deleteApiKey 1 + saveAiPrompt 2 + resetAiPrompt 1） |

### Change Log

- 2026-03-03: 新增右侧修饰键选项 — macOS 触发键选单从 5 项扩展为 7 项（新增右 Option、右 Control），原有 Option/Control 标签改为「左 Option」/「左 Control」

### File List

- src/views/SettingsView.vue
- src/stores/useSettingsStore.ts
- tests/unit/use-settings-store.test.ts (new)
