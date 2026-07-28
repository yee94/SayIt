# Story 1.4: 语音录音→转录→贴上完整流程

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 按住热键说话后，语音自动转为文字并贴入游标位置,
So that 我能在任何应用程式中用语音取代打字。

## Acceptance Criteria

1. **Hold 模式录音→转录→贴上** — API Key 已设定且热键系统运作中。使用者按住触发键（Hold 模式）时，系统透过 `navigator.mediaDevices.getUserMedia()` 开始麦克风录音。useVoiceFlowStore 状态更新为 `'recording'`，发送 `voice-flow:state-changed` 事件 `{ status: 'recording' }`。使用者放开触发键时，MediaRecorder 停止录音并产生音讯 blob，音讯封装为 Groq Whisper API 可接受的格式（multipart/form-data），状态更新为 `'transcribing'`。

2. **Groq Whisper API 转录** — 音讯送至 Groq Whisper API（model: whisper-large-v3, language: zh），取得繁体中文转录结果。API 请求透过 HTTPS 传送。API Key 从 useSettingsStore 取得。

3. **自动贴上至游标位置** — 转录结果取得后，系统呼叫 `invoke('paste_text', { text })` 将文字贴入。clipboard_paste.rs 将文字写入系统剪贴簿并模拟 Cmd+V（macOS）或 Ctrl+V（Windows）执行贴上。文字出现在当前游标所在的应用程式中。useVoiceFlowStore 状态更新为 `'success'`。

4. **Toggle 模式支援** — Toggle 模式启用时，使用者按一下触发键开始录音，再按一下停止。录音→转录→贴上流程与 Hold 模式相同。

5. **API 错误处理** — Groq Whisper API 请求失败（网路断线、API 错误等），API 回应非 200 或网路超时时，useVoiceFlowStore 状态更新为 `'error'`，发送 `voice-flow:state-changed` 事件 `{ status: 'error', message: '人类可读错误讯息' }`。不执行贴上动作。App 回到 idle 状态，可立即重试。

6. **useVoiceFlow 迁移至 useVoiceFlowStore** — 现有 `useVoiceFlow.ts` composable 的录音/转录/贴上流程逻辑迁移至 `useVoiceFlowStore`（Pinia store）驱动。现有 `useHudState.ts` 的视窗显示/隐藏和 auto-hide timer 逻辑整合至 store。`App.vue` 改为使用 `useVoiceFlowStore`。旧 composables 逻辑被 store 完全取代后移除。

## Tasks / Subtasks

- [x] Task 1: 扩展 useVoiceFlowStore 为完整流程引擎 (AC: #1, #2, #3, #4, #5, #6)
  - [x] 1.1 在 `useVoiceFlowStore.ts` 新增内部状态：
    - `isRecording: ref<boolean>(false)` — 防止重复触发
    - `recordingStartTime: ref<number>(0)` — 录音开始时间戳（`performance.now()`）
    - `autoHideTimer: ReturnType<typeof setTimeout> | null` — auto-hide 计时器（非 ref，不需响应式）
    - `unlistenFunctions: UnlistenFn[]` — 事件监听解除函式阵列
  - [x] 1.2 将 `useHudState.ts` 的视窗管理逻辑移入 store：
    - `showHud()` — `getCurrentWindow().show()` + `setIgnoreCursorEvents(true)`（让滑鼠穿透 HUD，不抢目标应用焦点）
    - `hideHud()` — `getCurrentWindow().hide()`
    - 扩展既有 `transitionTo()` — 加入计时器管理 + 视窗显示/隐藏副作用：
      - `idle` → `hideHud()`
      - `recording` / `transcribing` → `showHud()`
      - `success` → `showHud()` → 1000ms 后 `transitionTo('idle')`
      - `error` → `showHud()` → 2000ms 后 `transitionTo('idle')`
    - 每次 `transitionTo()` 先清除既有 `autoHideTimer`
  - [x] 1.3 新增 `initialize()` action（迁移自 `useVoiceFlow.ts`）：
    - 呼叫 `settingsStore.loadSettings()` 确保设定已载入（含 API Key、hotkey 设定）
    - 呼叫 `initializeMicrophone()` from `lib/recorder.ts`
    - 注册 Tauri 事件监听（使用 `useTauriEvents.ts` 的常数）：
      - `HOTKEY_PRESSED` → `handleStartRecording()`
      - `HOTKEY_RELEASED` → `handleStopRecording()`
      - `HOTKEY_TOGGLED` → 根据 `payload.action` 呼叫 start/stop
      - `HOTKEY_ERROR` → `transitionTo('error', payload.message)`
    - 将所有 `unlisten` 函式存入 `unlistenFunctions`
  - [x] 1.4 新增 `handleStartRecording()` action：
    - 防重复：若 `isRecording.value === true` 直接 return
    - `isRecording.value = true`
    - `recordingStartTime.value = performance.now()`
    - 呼叫 `initializeMicrophone()`（确保权限）
    - 呼叫 `startRecording()` from `lib/recorder.ts`（同步呼叫，不需 await）
    - `transitionTo('recording', '录音中...')`
    - 发送 `voice-flow:state-changed` 事件 `{ status: 'recording' }`
  - [x] 1.5 新增 `handleStopRecording()` action：
    - 若 `isRecording.value === false` 直接 return
    - **不立即设 `isRecording = false`**（防止非同步期间重复触发 race condition）
    - `transitionTo('transcribing', '转录中...')`
    - 呼叫 `stopRecording()` 取得 audio blob
    - 计算 `recordingDurationMs = performance.now() - recordingStartTime.value`
    - 从 `useSettingsStore().getApiKey()` 取得 API Key
    - 若 API Key 为空 → `isRecording.value = false` + `transitionTo('error', API_KEY_MISSING_ERROR)` + 发送 error 事件 + return
    - 呼叫 `transcribeAudio(audioBlob, apiKey)` from `lib/transcriber.ts`
    - 若 `!result.rawText`（无语音侦测）→ `isRecording.value = false` + `transitionTo('error', '未侦测到语音')` + return
    - `transitionTo('idle')` — 先转 idle 让 HUD 隐藏
    - `await invoke('paste_text', { text: result.rawText })` 贴上文字
    - `isRecording.value = false` — 整个流程完成才解锁
    - `transitionTo('success', '已贴上 ✓')`
    - 发送 `voice-flow:state-changed` 事件 `{ status: 'success' }`
    - 整体包裹 try/catch：catch 时 `isRecording.value = false` + `transitionTo('error', humanReadableMessage)` + 发送 error 事件
    - **注意**：`isRecording` 在每个 exit path（success、error、early return）都必须设为 false
  - [x] 1.6 新增 `cleanup()` action：
    - 清除 `autoHideTimer`
    - 遍历 `unlistenFunctions` 执行每个 `unlisten()`
    - 清空 `unlistenFunctions`
  - [x] 1.7 确保 store 汇出所有必要属性：
    - 状态：`status`, `message`（给 NotchHud 使用）
    - Actions：`initialize()`, `cleanup()`, `transitionTo()`
    - 不汇出内部状态 `isRecording`, `recordingStartTime`, `autoHideTimer`

- [x] Task 2: 合并 TranscriptionResult 至 TranscriptionRecord，更新 transcriber.ts (AC: #2)
  - [x] 2.1 移除 `src/types/index.ts` 的 `TranscriptionResult` 介面（POC 遗留型别）
  - [x] 2.2 修改 `transcribeAudio()` 回传型别为 `Pick<TranscriptionRecord, 'rawText' | 'transcriptionDurationMs'>`：
    - 原本回传 `{ text, duration }` → 改为 `{ rawText, transcriptionDurationMs }`
    - import `TranscriptionRecord` from `types/transcription.ts`
  - [x] 2.3 更新所有使用 `TranscriptionResult` 的地方：
    - `result.text` → `result.rawText`
    - `result.duration` → `result.transcriptionDurationMs`
    - 涵盖 `useVoiceFlowStore.ts`、`transcriber.test.ts` 等引用处
  - [x] 2.4 确认 `types/transcription.ts` 的 `TranscriptionRecord` 已包含所需栏位（`rawText`, `transcriptionDurationMs`）— 不需修改

- [x] Task 3: 更新 App.vue 使用 useVoiceFlowStore (AC: #6)
  - [x] 3.1 移除 `import { useVoiceFlow }` 和相关呼叫
  - [x] 3.2 新增 `import { useVoiceFlowStore }`
  - [x] 3.3 在 `setup` / `<script setup>` 中：
    - `const voiceFlowStore = useVoiceFlowStore()`
    - `onMounted` 中呼叫 `await voiceFlowStore.initialize()`
    - `onUnmounted` 中呼叫 `voiceFlowStore.cleanup()`
  - [x] 3.4 NotchHud props 改为从 store 读取：
    - `:status="voiceFlowStore.status"` `:message="voiceFlowStore.message"`
  - [x] 3.5 启动动画逻辑保留在 App.vue 中（这是 HUD-only 的 UI 逻辑，不需移到 store）

- [x] Task 4: 清理旧 composables (AC: #6)
  - [x] 4.1 确认 `useVoiceFlow.ts` 的所有逻辑已被 store 完全取代
  - [x] 4.2 确认 `useHudState.ts` 的所有逻辑已被 store 完全取代
  - [x] 4.3 在 App.vue 和任何其他引用处移除 `useVoiceFlow` 和 `useHudState` 的 import
  - [x] 4.4 将 `useVoiceFlow.ts` 和 `useHudState.ts` 标记为可移除或删除
    - 注意：若有测试档案（`tests/unit/use-voice-flow.test.ts`）需要对应更新或移除
  - [x] 4.5 保留 `src/composables/useTauriEvents.ts`（跨视窗事件工具，非 HUD 专用）

- [x] Task 5: 跨视窗事件广播 (AC: #1, #3, #5)
  - [x] 5.1 在 `handleStartRecording()` 和 `handleStopRecording()` 中，使用 `emit()` 发送 `VOICE_FLOW_STATE_CHANGED` 事件
    - **import 方式**：`import { emit } from "@tauri-apps/api/event"`（直接 import，不经过 composables）
    - **常数 import**：`import { VOICE_FLOW_STATE_CHANGED } from "@/composables/useTauriEvents"`（纯值常数可接受）
  - [x] 5.2 事件 payload 型别：`VoiceFlowStateChangedPayload`（from `types/events.ts`），格式 `{ status: HudStatus, message: string }`
  - [x] 5.3 确保事件使用 `emit()` 全域广播（非 `emitTo`），所有视窗都会收到

- [x] Task 6: 建立 useVoiceFlowStore 单元测试 (AC: #1-6)
  - [x] 6.1 建立 `tests/unit/use-voice-flow-store.test.ts`
  - [x] 6.2 Mock 所有外部依赖：recorder.ts、transcriber.ts、invoke、emit、listen、getCurrentWindow
  - [x] 6.3 测试 `initialize()`：事件监听注册、loadSettings 呼叫、initializeMicrophone 呼叫
  - [x] 6.4 测试 `handleStartRecording()`：正常流程、防重复触发（isRecording guard）、麦克风失败
  - [x] 6.5 测试 `handleStopRecording()`：正常流程（录音→转录→贴上）、API Key 缺失、空转录结果、API 错误、race condition 防护
  - [x] 6.6 测试 `transitionTo()`：各状态的 HUD 视窗管理（showHud/hideHud）、success/error auto-hide timer
  - [x] 6.7 测试 `cleanup()`：timer 清除、事件监听解除
  - [x] 6.8 移除 `tests/unit/use-voice-flow.test.ts`（逻辑已迁移，旧测试不再适用）

- [x] Task 7: 整合验证 (AC: #1-6)
  - [x] 7.1 `cargo check` 通过
  - [x] 7.2 `vue-tsc --noEmit` 通过
  - [x] 7.3 更新 `tests/unit/transcriber.test.ts`（配合 TranscriptionResult → TranscriptionRecord 合并）
  - [x] 7.4 手动测试：Hold 模式 — 按住触发键 → 录音 → 放开 → 转录 → 文字贴入游标位置
  - [x] 7.5 手动测试：Toggle 模式 — 按一下开始 → 录音 → 再按一下停止 → 转录 → 文字贴入游标位置
  - [x] 7.6 手动测试：API Key 缺失时 → HUD 显示错误讯息引导至设定页面
  - [x] 7.7 手动测试：网路断线时 → HUD 显示错误讯息，App 回到 idle
  - [x] 7.8 手动测试：快速重复触发 → 转录中按热键无反应（race condition 防护）
  - [x] 7.9 手动测试：HUD 状态转换流畅 — idle → recording → transcribing → success → idle（auto-hide）
  - [x] 7.10 手动测试：HUD 错误状态 — error → 2 秒后自动回 idle
  - [x] 7.11 手动测试：无语音录音 → HUD 显示「未侦测到语音」错误

## Dev Notes

### 架构模式与约束

**Brownfield 专案** — 基于 Story 1.1（V2 基础架构）、1.2（跨平台热键系统）、1.3（API Key 储存 + System Tray）继续扩展。

**本 Story 的核心架构变更：** 将 composable-based 的状态管理（useVoiceFlow + useHudState）迁移至 Pinia store-based 架构（useVoiceFlowStore），符合 V2 架构文件的决策。

**依赖方向规则（严格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**禁止：**
- ❌ views/ 直接呼叫 lib/（必须透过 store）
- ❌ API Key 存入 SQLite（只用 tauri-plugin-store）
- ❌ 在元件中直接执行 SQL
- ❌ Store 中引入 Vue lifecycle hooks（onMounted 等）

### 迁移策略：useVoiceFlow + useHudState → useVoiceFlowStore

**为什么迁移：**
- 架构文件指定状态管理使用 Pinia stores
- useVoiceFlowStore 已存在但只有骨架（19 行），useVoiceFlow composable 持有所有实际逻辑
- 双重状态管理（composable + store）导致架构不一致
- Store 更易测试，且支援跨视窗状态共享（透过 Tauri Events）

**迁移前后对比：**

```
迁移前：
App.vue → useVoiceFlow() → useHudState()
                         → recorder.ts
                         → transcriber.ts
                         → invoke('paste_text')

迁移后：
App.vue → useVoiceFlowStore
              ├─ 状态管理（status, message, isRecording）
              ├─ HUD 视窗控制（showHud/hideHud + auto-hide）
              ├─ 事件监听（hotkey events）
              ├─ 录音流程（recorder.ts）
              ├─ 转录流程（transcriber.ts）
              └─ 贴上流程（invoke paste_text）
```

**useHudState.ts 逻辑去向：**
- `showHud()` → 移入 store：`getCurrentWindow().show()` + `setIgnoreCursorEvents(true)`（让滑鼠穿透 HUD，**不用 setFocus**）
- `hideHud()` → 移入 store：`getCurrentWindow().hide()`
- `transitionTo()` + auto-hide timer → 合并入 store 的 `transitionTo()`
- `state` ref → 使用 store 的 `status` + `message`
- `cleanup()` timer → 移入 store 的 `cleanup()`

**useVoiceFlow.ts 逻辑去向：**
- `initialize()` → store 的 `initialize()` action
- 事件监听（HOTKEY_PRESSED/RELEASED/TOGGLED/ERROR）→ store `initialize()` 内注册
- `handleStartRecording()` → store action
- `handleStopRecording()` → store action
- `isRecording` ref → store 内部 ref
- `state` ref → 已由 store 的 `status`/`message` 取代

### 现有 useVoiceFlowStore 程式码（需扩展）

```typescript
// 现有骨架（19 行）
export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");

  function transitionTo(newStatus: HudStatus, newMessage?: string) {
    status.value = newStatus;
    message.value = newMessage ?? "";
  }

  return { status, message, transitionTo };
});
```

需要扩展为：完整的录音→转录→贴上流程引擎 + HUD 视窗管理。

### 现有 useVoiceFlow.ts 关键流程（需迁移）

**事件监听初始化（lines 37-91）：**
```typescript
// HOTKEY_PRESSED → handleStartRecording()
// HOTKEY_RELEASED → handleStopRecording()
// HOTKEY_TOGGLED → 根据 action start/stop
// HOTKEY_ERROR → transitionTo("error", message)
```

**录音开始（handleStartRecording, lines 100-115）：**
```typescript
async function handleStartRecording() {
  if (isRecording.value) return;  // 防重复
  isRecording.value = true;
  try {
    await initializeMicrophone();
    transitionTo("recording", "Recording...");
    await startRecording();
  } catch (err) {
    isRecording.value = false;
    transitionTo("error", "麦克风初始化失败");
  }
}
```

**录音停止 + 转录 + 贴上（handleStopRecording, lines 117-159）：**
```typescript
// ⚠️ 现有程式码有 race condition：isRecording 在非同步操作前就清除
// Store 版本修正：isRecording 在每个 exit path 才设为 false
async function handleStopRecording() {
  if (!isRecording.value) return;
  // ❌ 现有：isRecording = false（太早）
  // ✅ Store 版：不在此处设 false，移至每个 exit path
  transitionTo("transcribing", "Transcribing...");
  try {
    const audioBlob = await stopRecording();
    const currentApiKey = settingsStore.getApiKey();
    if (!currentApiKey) { isRecording.value = false; /* error + return */ }
    const result = await transcribeAudio(audioBlob, currentApiKey);
    if (!result.rawText) { isRecording.value = false; /* "未侦测到语音" + return */ }
    transitionTo("idle");  // 先隐藏 HUD
    await invoke("paste_text", { text: result.rawText });
    isRecording.value = false;  // ✅ 流程完成才解锁
    transitionTo("success", `已贴上 ✓`);
  } catch (err) {
    isRecording.value = false;  // ✅ 错误时也解锁
    transitionTo("error", humanReadableMessage);
  }
}
```

**重要时序：** `transitionTo("idle")` → 隐藏 HUD → 目标应用获得焦点 → `paste_text` 贴上。如果不先隐藏 HUD，`paste_text` 的 `window.hide()` 会触发（见 clipboard_paste.rs line 54-58），但顺序可能不正确。

**Race condition 修正：** `isRecording` 作为整个非同步流程的锁，只在流程完成（success/error/early return）时才释放。这防止使用者在转录期间再次触发录音。

### 现有 useHudState.ts 关键逻辑（需迁移）

```typescript
// 视窗管理
async function showHud() {
  await appWindow.show();
  await appWindow.setIgnoreCursorEvents(true); // 滑鼠穿透，不抢焦点
}
async function hideHud() {
  await appWindow.hide();
}

// 状态转换 + auto-hide
function transitionTo(status: HudStatus, message = "") {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  state.value = { status, message };

  switch (status) {
    case "idle": hideHud(); break;
    case "recording":
    case "transcribing": showHud(); break;
    case "success":
      showHud();
      autoHideTimer = setTimeout(() => transitionTo("idle"), 1000);
      break;
    case "error":
      showHud();
      autoHideTimer = setTimeout(() => transitionTo("idle"), 2000);
      break;
  }
}
```

**注意：** `showHud()` 使用 `getCurrentWindow().show()` + `setIgnoreCursorEvents(true)`（不用 `setFocus()`，避免抢走目标应用焦点）。`hideHud()` 使用 `getCurrentWindow().hide()`。在 store 中同样可以使用此 API，因为 store 在 HUD Window 的 Vue App 实例中初始化。

### transcriber.ts 改造重点

**现有回传型别（POC 遗留，需合并至 V2 型别）：**
```typescript
// ❌ 移除 — src/types/index.ts 的 POC 型别
interface TranscriptionResult {
  text: string;      // 转录文字
  duration: number;  // 转录 API 耗时（毫秒）— 名称模糊
}
```

**改为使用 V2 型别（已存在于 src/types/transcription.ts）：**
```typescript
// ✅ 使用 TranscriptionRecord 的 Pick 子集
import type { TranscriptionRecord } from "@/types/transcription";
type TranscriberResult = Pick<TranscriptionRecord, "rawText" | "transcriptionDurationMs">;

// transcribeAudio() 回传：
return { rawText: data.text, transcriptionDurationMs };
```

**影响范围：**
- `result.text` → `result.rawText`（所有引用处）
- `result.duration` → `result.transcriptionDurationMs`（所有引用处）
- 移除 `TranscriptionResult` 从 `types/index.ts`

**注意：** `recordingDurationMs` 由 store 在 `handleStopRecording()` 中计算（`performance.now() - recordingStartTime`），不由 transcriber.ts 负责。transcriber.ts 只负责回报转录 API 呼叫耗时。

### clipboard_paste.rs 呼叫格式

**Tauri Command 签名（不修改）：**
```rust
#[tauri::command]
pub fn paste_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), ClipboardError>
```

**前端呼叫：**
```typescript
await invoke("paste_text", { text: transcriptionText });
```

**内部流程（已实作，不需修改）：**
1. 写入文字到系统剪贴簿（arboard）
2. 等待 50ms（剪贴簿同步）
3. macOS：模拟 Cmd+V（CGEvent，事件源=`Private`，投递位置=`Session`）
4. Windows：恢复目标前景视窗 → 模拟 Ctrl+V（SendInput）

> ⚠️ macOS CGEvent 事件源必须使用 `CGEventSourceStateID::Private`，不可使用 `HIDSystemState` 或 `CombinedSessionState`。Toggle 模式下 modifier trigger key（如右 Option）的残留 Alternate flag 会污染 Cmd+V 事件，导致目标 app 重复贴上。

**重要时序问题：** `paste_text` 内部已经会隐藏 HUD 视窗。但 store 的 `transitionTo('idle')` 也会呼叫 `hideHud()`。建议的处理方式：在呼叫 `paste_text` 前先 `transitionTo('idle')`（触发 hideHud），然后 `paste_text` 内部的 hide 会是 no-op（视窗已隐藏）。这是现有 `useVoiceFlow.ts` 的做法（line 149: `transitionTo("idle")` → line 151: `invoke("paste_text")`）。

### Tauri Events 跨视窗通讯

**事件常数（定义在 composables/useTauriEvents.ts，个别汇出）：**
```typescript
// 个别常数汇出（非物件）
export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;

// 函式别名汇出
export { emit as emitEvent } from "@tauri-apps/api/event";
export { listen as listenToEvent } from "@tauri-apps/api/event";
```

**⚠️ Store 中的 import 策略（避免依赖方向违规）：**
```typescript
// ❌ 不要从 composables import（违反 stores/ → lib/ 规则）
// import { emitEvent } from "@/composables/useTauriEvents";

// ✅ Store 直接 import Tauri API + 事件常数
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  HOTKEY_PRESSED, HOTKEY_RELEASED, HOTKEY_TOGGLED, HOTKEY_ERROR,
  VOICE_FLOW_STATE_CHANGED,
} from "@/composables/useTauriEvents"; // 常数是纯值，不算依赖违规
```

**注意：** 常数 import 是纯值参考，不引入 Vue 响应式依赖，因此从 composables import 常数可接受。但函式（`emitEvent`/`listenToEvent`）应直接从 `@tauri-apps/api/event` import，因为它们只是 re-export。

**事件发送范例：**
```typescript
// 在 store 中发送事件（使用直接 import 的 emit）
await emit(VOICE_FLOW_STATE_CHANGED, {
  status: "recording",
  message: "录音中...",
});
```

**注意：** `emit` 是全域广播，所有视窗都会收到。HUD Window 的 store 发送事件，Main Window 的相关 store 可以订阅并更新。但 Story 1.4 的 Main Window 不需要做任何反应（Dashboard 更新是 Story 4.1 的范围）。

### TypeScript 事件型别（types/events.ts）

**Store 必须使用的型别（已定义在 `src/types/events.ts`）：**
```typescript
import type { HotkeyEventPayload, HotkeyErrorPayload, VoiceFlowStateChangedPayload } from "@/types/events";

// 热键事件 payload
interface HotkeyEventPayload {
  mode: TriggerMode;      // "hold" | "toggle"
  action: "start" | "stop";
}

// 热键错误 payload
interface HotkeyErrorPayload {
  error: string;    // 错误码
  message: string;  // 人类可读讯息
}

// 语音流程状态变更 payload
interface VoiceFlowStateChangedPayload {
  status: HudStatus;
  message: string;
}
```

**使用场景：**
- `listen<HotkeyEventPayload>(HOTKEY_PRESSED, ...)` — type-safe 事件监听
- `listen<HotkeyErrorPayload>(HOTKEY_ERROR, ...)` — 错误事件
- `emit(VOICE_FLOW_STATE_CHANGED, payload as VoiceFlowStateChangedPayload)` — 状态广播

### debug_log 除错模式

**现有模式（从 useVoiceFlow.ts 迁移）：**
```typescript
import { invoke } from "@tauri-apps/api/core";

function log(message: string) {
  invoke("debug_log", { level: "info", message });
}

function logError(message: string) {
  invoke("debug_log", { level: "error", message });
}
```

**Store 中应保留此模式**，在关键节点记录日志：initialize、recording start/stop、transcription、paste、errors。Rust 端 `debug_log` command 已存在，不需修改。

### hotkey_listener.rs 事件 payload 格式

**Rust 端发送的事件 payload：**
```rust
// Hold 模式
HotkeyEventPayload { mode: TriggerMode::Hold, action: HotkeyAction::Start }
// Serde 序列化为 JSON：{ "mode": "hold", "action": "start" }

HotkeyEventPayload { mode: TriggerMode::Hold, action: HotkeyAction::Stop }
// JSON：{ "mode": "hold", "action": "stop" }

// Toggle 模式
HotkeyEventPayload { mode: TriggerMode::Toggle, action: HotkeyAction::Start }
// JSON：{ "mode": "toggle", "action": "start" }
```

**前端接收（使用 types/events.ts 型别）：**
```typescript
import type { HotkeyEventPayload, HotkeyErrorPayload } from "@/types/events";

listen<HotkeyEventPayload>(HOTKEY_PRESSED, () => {
  // Hold 模式按下 → 开始录音
  handleStartRecording();
});

listen<HotkeyEventPayload>(HOTKEY_RELEASED, () => {
  // Hold 模式放开 → 停止录音
  handleStopRecording();
});

listen<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
  // Toggle 模式切换
  if (event.payload.action === "start") handleStartRecording();
  if (event.payload.action === "stop") handleStopRecording();
});

listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
  logError(`hotkey error: ${event.payload.message}`);
  transitionTo("error", "请授予辅助使用权限");
});
```

### recorder.ts 使用要点

**现有 API（不需修改）：**
```typescript
import { initializeMicrophone, startRecording, stopRecording } from "@/lib/recorder";

await initializeMicrophone();   // 请求麦克风权限，16kHz 取样率
startRecording();               // 同步呼叫：建立 MediaRecorder 并开始收集 audio chunks（不需 await）
const blob = await stopRecording(); // 停止录音，回传合并的 audio Blob
```

**recorder.ts 不追踪录音时间。** 录音时长由 store 用 `performance.now()` 差值计算：
```typescript
recordingStartTime.value = performance.now(); // startRecording 前
// ... 录音中 ...
const recordingDurationMs = performance.now() - recordingStartTime.value; // stopRecording 后
```

### 测试档案影响

**受影响的测试：**
- `tests/unit/use-voice-flow.test.ts` — 移除（逻辑迁移至 store，由新测试取代）
- `tests/unit/use-voice-flow-store.test.ts` — 新建（Task 6，测试 store 的完整流程）
- `tests/unit/transcriber.test.ts` — 更新（`text` → `rawText`，`duration` → `transcriptionDurationMs`，移除 `TranscriptionResult` 参考）

**Story 1.3 的测试结果：** 6 files / 77 tests 全部通过。本 Story 的改动可能 break 部分测试。

### 跨 Story 注意事项

- **Story 2.1** 会建立 `enhancer.ts` 并在 voiceFlow 中新增 `'enhancing'` 状态。本 Story 的 useVoiceFlowStore 设计需要预留 `'enhancing'` 状态的扩展空间（HudStatus union type 已包含 `'enhancing'`）
- **Story 4.1** 会在 `handleStopRecording()` 后新增历史记录写入。本 Story 的 store 结构需要方便后续扩展（在 success 之后加入 `useHistoryStore.addTranscription()` 呼叫）
- **Story 1.5** 会扩展 NotchHud.vue 为完整 6 态显示。本 Story 只处理 4 态（idle/recording/transcribing/success/error），enhancing 由 Story 2.1 加入

### 前一个 Story (1.3) 关键学习

- `cargo check` 有既存 warnings（objc macro cfg, dead_code）— 不影响功能，不需处理
- `vue-tsc --noEmit` 在 Story 1.3 修复了 `transcriber.ts:17` 的 `import.meta.env` 型别错误
- tauri-plugin-updater 已从 lib.rs 移除（commit ae44200）— 不要重新加入
- `getApiKey()` getter 已在 Story 1.3 建立，本 Story 直接使用
- 前端 TriggerKey 使用 union type 保持与 Rust serde 一致
- 错误处理模式：`err instanceof Error ? err.message : String(err)` 已确立为标准
- `useSettingsStore` 的 `loadSettings()` 在 `main-window.ts` 的 `bootstrap()` 中呼叫，在 HUD Window 的 `main.ts` 中也需要确认是否呼叫（检查 `App.vue` 的 `initialize()` 流程）

### Git 历史分析

**最近 commit 模式：**
- `feat:` 前缀用于功能实作（Story 1.1, 1.2, 1.3）
- `fix:` 前缀用于 code review 后修复
- `docs:` 前缀用于 BMAD artifacts 更新
- `refactor:` 前缀用于重新命名/重构

**最近改动的关键档案（与本 Story 直接相关）：**
- `src/stores/useVoiceFlowStore.ts` — Story 1.1 建立骨架（19 行），未被任何元件使用
- `src/composables/useVoiceFlow.ts` — Story 1.2/1.3 修改了事件监听 + API Key 取用
- `src/composables/useHudState.ts` — Story 1.1 以来未变动
- `src/App.vue` — Story 1.1 建立 HUD 入口，使用 useVoiceFlow
- `src/lib/transcriber.ts` — Story 1.3 移除 env var，改为 apiKey 参数注入
- `src/lib/recorder.ts` — POC 以来未变动

### 技术版本确认（2026-03-02）

| 技术 | 版本 | 备注 |
|------|------|------|
| Groq Whisper API | whisper-large-v3 | model 参数，language: "zh" |
| Tauri | v2.10.x | `invoke()`, `emit()`, `getCurrentWindow()` |
| Pinia | 3.x | `defineStore("voice-flow", () => { ... })` |
| Vue Router | 5.0.3 | hash mode |
| MediaRecorder API | Web Standard | 16kHz, 降噪 |
| arboard (Rust) | 3.6.1 | 跨平台剪贴簿 |

### 不需要的 Cargo/NPM 依赖变更

本 Story **不需要安装任何新依赖**。所有需要的技术已在 Story 1.1-1.3 安装完毕。

### 现有档案改动点

**修改档案：**
```
src/stores/useVoiceFlowStore.ts    — 从骨架扩展为完整流程引擎（核心工作）
src/App.vue                         — 改用 useVoiceFlowStore 替代 useVoiceFlow
src/types/index.ts                  — 移除 TranscriptionResult 介面（合并至 TranscriptionRecord）
src/lib/transcriber.ts              — 回传型别改用 Pick<TranscriptionRecord>，text → rawText
tests/unit/transcriber.test.ts      — 配合 TranscriptionRecord 合并更新
```

**新增档案：**
```
tests/unit/use-voice-flow-store.test.ts — useVoiceFlowStore 完整单元测试
```

**移除档案（迁移完成后）：**
```
src/composables/useVoiceFlow.ts     — 逻辑完全迁移至 store
src/composables/useHudState.ts      — 逻辑完全迁移至 store
```

**不修改的档案（明确排除）：**
- `src/lib/recorder.ts` — 录音 API 不变
- `src-tauri/src/plugins/clipboard_paste.rs` — 贴上逻辑不变
- `src-tauri/src/plugins/hotkey_listener.rs` — 热键逻辑不变
- `src-tauri/src/lib.rs` — Tray/视窗配置不变
- `src/composables/useTauriEvents.ts` — 事件工具不变
- `src/views/SettingsView.vue` — 设定 UI 不变
- `src/components/NotchHud.vue` — 接收 props 不变，只是资料来源从 composable 改为 store
- `src/main-window.ts` — Main Window 启动逻辑不变
- `Cargo.toml` / `package.json` — 不需新增依赖
- `capabilities/default.json` — 权限不变

### 安全规则提醒

- API Key 从 `useSettingsStore().getApiKey()` 取得，不硬编码
- API Key 不写入任何日志（`console.log` 不印 Key 值）
- API Key 不透过 Tauri Event 传播
- CSP `connect-src 'self' https://api.groq.com` 限制 API Key 只能传到 Groq

### 效能注意事项

- **E2E 目标（不含 AI 整理）** — < 1.5 秒（从放开按键到文字出现在游标位置）
- **HUD 状态转换** — < 100ms（Tauri Events 驱动，非轮询）
- **剪贴簿操作延迟** — paste_text 内部有 200ms + 50ms 等待（总计 250ms）
- **录音编码** — MediaRecorder 自动处理，16kHz 取样率
- **API 呼叫** — 非同步，不阻塞 UI

### Project Structure Notes

- 本 Story 改动符合统一专案结构：store 层处理状态管理和业务流程
- useVoiceFlowStore 成为 HUD Window 的核心状态引擎
- 依赖方向维持单向：App.vue → store → lib services
- store 不引入 Vue lifecycle hooks（onMounted 等），使用 `initialize()`/`cleanup()` 模式

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture — Pinia Stores 结构]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries — Component Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points — 核心语音流程]
- [Source: _bmad-output/planning-artifacts/prd.md#语音触发与录音 FR1-FR6, FR13-FR14, FR26-FR28]
- [Source: _bmad-output/implementation-artifacts/1-3-api-key-storage-system-tray.md — 跨 Story 注意事项, Dev Notes]
- [Source: _bmad-output/project-context.md — Critical Implementation Rules, Framework-Specific Rules]
- [Source: Codebase — src/composables/useVoiceFlow.ts（迁移来源）]
- [Source: Codebase — src/composables/useHudState.ts（迁移来源）]
- [Source: Codebase — src/stores/useVoiceFlowStore.ts（扩展目标）]
- [Source: Codebase — src/lib/recorder.ts（录音服务）]
- [Source: Codebase — src/lib/transcriber.ts（转录服务）]
- [Source: Codebase — src-tauri/src/plugins/clipboard_paste.rs（贴上服务）]
- [Source: Codebase — src-tauri/src/plugins/hotkey_listener.rs（事件格式）]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex (Codex CLI)

### Debug Log References

- `2026-03-02` `pnpm test`：5/5 测试档、48/48 测试案例通过
- `2026-03-02` `pnpm exec vue-tsc --noEmit`：通过（0 errors）
- `2026-03-02` `cargo check`（`src-tauri`）：通过（0 errors, 0 warnings）
- `2026-03-02` Code Review 后 `pnpm test`：5/5 测试档、50/50 测试案例通过（+2 新测试）
- `2026-03-02` Code Review 后 `pnpm exec vue-tsc --noEmit`：通过（0 errors）

### Completion Notes List

- 已将 `useVoiceFlowStore` 扩展为完整录音→转录→贴上流程，整合 HUD 显示/隐藏与 auto-hide timer。
- 已把 `App.vue` 改为使用 `useVoiceFlowStore`，并在元件卸载时执行 `cleanup()`。
- 已完成 `TranscriptionResult` → `TranscriptionRecord` 子型别迁移，更新 `transcriber.ts` 与相关测试。
- 已移除旧 composables（`useVoiceFlow.ts`, `useHudState.ts`）与旧单元测试，新增 `use-voice-flow-store` 测试覆盖核心流程。
- 因终端机环境限制，Task 7 的手动验证项目（7.4-7.11）尚未执行，故事维持 `in-progress`。
- `2026-03-02` Code Review (Claude Opus 4.6) 修复 6 项 issues：
  - [H1] `handleStopRecording` 贴上前改为 `transitionTo("idle")` 符合 spec
  - [M1] `getCurrentWindow()` 改为 lazy 初始化（`getAppWindow()`）
  - [M2] 补 `HOTKEY_ERROR` 事件处理单元测试
  - [M3] `types.test.ts` HudStatus 测试补上 `enhancing`
  - [M4] `showHud/hideHud` 错误改为 `.catch(writeErrorLog)` 不再静默吞掉
  - [L4] 补 auto-hide timer emit idle 事件测试

### File List

- `src/stores/useVoiceFlowStore.ts` (modified)
- `src/App.vue` (modified)
- `src/lib/transcriber.ts` (modified)
- `src/types/index.ts` (modified)
- `tests/unit/use-voice-flow-store.test.ts` (added)
- `tests/unit/transcriber.test.ts` (modified)
- `tests/unit/types.test.ts` (modified)
- `src/composables/useVoiceFlow.ts` (deleted)
- `src/composables/useHudState.ts` (deleted)
- `tests/unit/use-voice-flow.test.ts` (deleted)
- `tests/unit/use-hud-state.test.ts` (deleted)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/1-4-voice-record-transcribe-paste.md` (modified)

### Change Log

- `2026-03-02`：完成 Task 1-6 与 Task 7.1-7.3；保留 Task 7.4-7.11 手动验证待执行。
- `2026-03-02`：Code Review (Claude Opus 4.6) — 修复 1 HIGH / 4 MEDIUM / 1 LOW issues，测试 48→50。
