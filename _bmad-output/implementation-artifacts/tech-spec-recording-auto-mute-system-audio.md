---
title: '录音自动静音系统喇叭'
slug: 'recording-auto-mute-system-audio'
created: '2026-03-05'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4, 5, 6]
tech_stack: ['Rust CoreAudio (macOS)', 'Rust windows 0.61 WASAPI/EndpointVolume (Windows)', 'Tauri Commands', 'Vue 3 Pinia', 'shadcn-vue Switch', 'tauri-plugin-store']
files_to_modify:
  - 'src-tauri/src/plugins/audio_control.rs (新增)'
  - 'src-tauri/src/plugins/mod.rs'
  - 'src-tauri/src/lib.rs'
  - 'src-tauri/Cargo.toml'
  - 'src-tauri/build.rs'
  - 'src/stores/useVoiceFlowStore.ts'
  - 'src/stores/useSettingsStore.ts'
  - 'src/views/SettingsView.vue'
  - 'CLAUDE.md (IPC 契约表更新)'
code_patterns:
  - 'Rust plugin 架构：一档一功能于 plugins/，mod.rs 汇出'
  - 'Tauri Command 签名：<R: Runtime> 泛型约束'
  - 'Settings 持久化：tauri-plugin-store load(STORE_NAME) → get/set/save'
  - 'Settings UI：Card + Switch + useFeedbackMessage() 模式'
  - 'VoiceFlow 状态：Pinia store，handleStartRecording/handleStopRecording 为主流程'
  - '错误路径：failRecordingFlow() 统一处理录音流程错误'
  - 'Event 封装：useTauriEvents.ts + emitEvent()'
test_patterns:
  - 'Rust 单元测试：lib.rs 内 #[cfg(test)] mod tests'
  - 'TS 单元测试：tests/unit/*.test.ts (Vitest + jsdom)'
  - 'VoiceFlow 测试：tests/unit/use-voice-flow-store.test.ts'
review_findings_resolved:
  - 'R1-F1: Windows COM 改用 COINIT_APARTMENTTHREADED'
  - 'R1-F2: 补上 AudioObjectPropertyAddress 完整结构体定义'
  - 'R1-F3: 补充 Windows features 验证说明'
  - 'R1-F4: 分析双重 restore 路径，确认幂等设计覆盖'
  - 'R1-F5: 明确指定 Mutex lock 粒度需贯穿整个操作'
  - 'R1-F6: 不上 App Store，Sandbox entitlement 不适用'
  - 'R1-F7: restore 失败不通知使用者（仅 log）'
  - 'R1-F8: Switch handler 改为接收参数'
  - 'R1-F9: 补上 SETTINGS_UPDATED payload key'
  - 'R1-F10: 改为直接读 store ref，不用本地 ref'
  - 'R1-F11-12: 移除行号引用，改用函式名称定位'
  - 'R1-F13: 明确指定 ref<boolean> 型别'
  - 'R2-adversarial-F1: Windows COM 加 CoUninitialize scope guard（ComGuard）'
  - 'R2-adversarial-F2: restore 失败时仍清除 state，防止永久静音'
  - 'R2-adversarial-F8: 预设静音 ON 维持不动（使用者决策）'
  - 'R2-adversarial-F12: 移除多余 Arc wrapper（Tauri State 已包 Arc）'
  - 'R3-simplify-Q1: COM guard 移到 get_system_mute/set_system_mute 层级，修正 use-after-uninit'
  - 'R3-simplify-Q2: 移除 S_FALSE dead code 分支（windows-rs 映射为 Ok）'
  - 'R3-simplify-Q4: loadSettings fallback 补上 isMuteOnRecordingEnabled 重设'
  - 'R3-simplify-E1: mute 与 initializeMicrophone 改为 Promise.all 并行'
  - 'R3-simplify-R1: restoreSystemAudio 加 void 前缀统一风格'
  - 'R3-build: build.rs 加入 CoreAudio framework 连结（cargo check 不触发 linker）'
---

# Tech-Spec: 录音自动静音系统喇叭

**Created:** 2026-03-05

## Overview

### Problem Statement

使用者按下录音快捷键时，系统喇叭可能正在播放音乐、通知音或其他声音，这些声音会被麦克风收到，干扰录音品质和语音转录的准确度。

### Solution

在录音开始时，透过 Rust 端原生 API（macOS: CoreAudio, Windows: WASAPI/EndpointVolume）记住当前系统 mute 状态并静音，录音结束后恢复原 mute 状态。提供 Settings 页面开关让使用者控制此行为（预设开启）。

### Scope

**In Scope:**

- Rust 端新增系统音量控制 plugin（macOS CoreAudio + Windows EndpointVolume）
- 新增 Tauri Commands：`mute_system_audio` / `restore_system_audio`
- `useVoiceFlowStore` 在录音流程中呼叫静音/恢复
- Settings 页面新增「录音时自动静音」开关（预设开启）
- 安全机制：多重恢复路径 + 幂等设计

**Out of Scope:**

- 麦克风音量/增益控制
- 针对单一应用程式的音量控制（只控制系统主音量）
- Linux 平台支援
- macOS App Store Sandbox entitlement（确认不上 App Store）

## Context for Development

### Codebase Patterns

- **Rust plugin 架构**：每个功能一个档案于 `src-tauri/src/plugins/`，在 `mod.rs` 汇出
- **Tauri Command 签名**：必须加泛型 `<R: Runtime>` 约束，返回 `Result<T, CustomError>`
- **录音流程**：集中在 `useVoiceFlowStore`，透过 `handleStartRecording()` / `handleStopRecording()` 控制
- **错误处理**：`failRecordingFlow()` 统一处理录音流程错误——静音恢复也必须在此路径触发
- **Settings 持久化**：`tauri-plugin-store` 的 `load("settings.json")` → `get<T>()` / `set()` / `save()`
- **Settings UI 模式**：`Card` + `Switch` `:model-value` + `@update:model-value` + `useFeedbackMessage()` 回馈
- **macOS 原生呼叫模式**：`extern "C"` 直接宣告 C API（参考 `lib.rs` 的 `CGEventCreate` 用法）
- **Windows 原生呼叫模式**：`windows` crate 的 COM API，需 `unsafe` 区块

### Files to Modify/Create

| File | Action | Purpose |
| ---- | ------ | ------- |
| `src-tauri/src/plugins/audio_control.rs` | **新增** | 系统音量控制 Rust plugin（macOS CoreAudio + Windows EndpointVolume） |
| `src-tauri/src/plugins/mod.rs` | 修改 | 加入 `pub mod audio_control;` |
| `src-tauri/src/lib.rs` | 修改 | 注册 commands + 初始化 state |
| `src-tauri/Cargo.toml` | 修改 | Windows: 加 `Win32_Media_Audio`, `Win32_System_Com` features |
| `src-tauri/build.rs` | 修改 | macOS: 连结 `CoreAudio.framework`（`extern "C"` FFI 需手动连结） |
| `src/stores/useVoiceFlowStore.ts` | 修改 | 录音流程中呼叫 mute/restore |
| `src/stores/useSettingsStore.ts` | 修改 | 新增 `isMuteOnRecordingEnabled` 状态 |
| `src/views/SettingsView.vue` | 修改 | 新增自动静音 Switch |

### Files to Reference (Read-Only)

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/plugins/hotkey_listener.rs` | 参考双平台 plugin 架构（state 管理 + cfg 条件编译） |
| `src-tauri/src/plugins/keyboard_monitor.rs` | 参考 Tauri command + state 管理模式 |
| `src/composables/useTauriEvents.ts` | Event 常量命名模式 |
| `src/composables/useFeedbackMessage.ts` | Settings 回馈 UI 模式 |

### Technical Decisions

- **只操作 mute flag**：不动音量数值，避免恢复时音量不对
- **幂等 restore**：内部 flag 追踪是否有 pending restore，多次呼叫安全
- **fire-and-forget 静音**：mute 失败不阻挡录音流程（降级为无静音模式，仅 log warning）
- **restore 失败不通知使用者**：仅 log error，不显示 UI 通知
- **Settings 预设开启**：`DEFAULT_MUTE_ON_RECORDING = true`
- **Windows COM 线程模型**：使用 `COINIT_APARTMENTTHREADED`（不是 `COINIT_MULTITHREADED`），因为 Tauri 的 Tao 视窗管理可能已在 STA 模式初始化 COM。若已 init 返回 `S_FALSE` 是安全的；若返回 `RPC_E_CHANGED_MODE` 则跳过 init 继续执行（已在 STA 模式下）
- **Mutex lock 粒度**：`mute_system_audio` 和 `restore_system_audio` 的 Mutex lock 必须贯穿整个「读取 flag → 呼叫系统 API → 写入 flag」操作，不可中途释放再重新取得
- **双重 restore 路径分析**：`handleStopRecording()` 开头呼叫 `restoreSystemAudio()`，后续若 `completePasteFlow()` 失败走到 `failRecordingFlow()` 会再次呼叫。幂等设计保证第二次 restore 读到 `was_muted_before = None` 直接跳过，不会出错

## Implementation Plan

### Tasks

- [x] **Task 1: 修改 Cargo.toml — 新增 Windows audio features**
  - File: `src-tauri/Cargo.toml`
  - Action: 在 `[target.'cfg(target_os = "windows")'.dependencies]` 的 `windows` features 阵列中加入 `"Win32_Media_Audio"` 和 `"Win32_System_Com"`
  - Notes: macOS 不需要新增 crate，使用 `extern "C"` 直接呼叫 CoreAudio C API
  - ⚠️ 实作时验证：确认 `MMDeviceEnumerator`（CLSID）、`CoCreateInstance`、`CLSCTX_ALL` 是否在这两个 features 下可用。若不够，可能还需 `"Win32_System_Com_StructuredStorage"` 或其他 features。编译时若出现 unresolved import 错误，根据错误讯息逐一加入缺失 features。

- [x] **Task 2: 新增 audio_control.rs — Rust 音量控制 plugin**
  - File: `src-tauri/src/plugins/audio_control.rs`（新增）
  - Action: 实作双平台系统音量 mute/restore
  - 结构（实际实作移除了多余 Arc，Tauri State 已自带 Arc）：
    ```rust
    pub struct AudioControlState {
        was_muted_before: Mutex<Option<bool>>,  // None = 没有 pending restore
    }
    ```
  - **⚠️ Mutex lock 粒度规则**：`mute` 和 `restore` 操作中，Mutex lock 必须持有到整个「读 flag → 呼叫系统 API → 写 flag」序列完成。不可在读取后释放锁再重新取得，否则并发 command 会造成竞争条件。
  - **⚠️ restore 先清 state**：`restore_system_audio` 先将 `was_muted_before` 清为 `None`，再呼叫 platform API 恢复。确保即使恢复失败，下次录音仍可正常 mute/restore，不会永久卡住。
  - macOS 实作（`#[cfg(target_os = "macos")]`）：
    - 完整结构体定义：
      ```rust
      #[repr(C)]
      struct AudioObjectPropertyAddress {
          mSelector: u32,
          mScope: u32,
          mElement: u32,
      }
      ```
    - `get_default_output_device() -> Option<u32>` — 组装 `AudioObjectPropertyAddress { mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain }` 并呼叫 `AudioObjectGetPropertyData(kAudioObjectSystemObject, ...)`
    - `get_device_mute(device_id: u32) -> Result<bool>` — 组装 `AudioObjectPropertyAddress { mSelector: kAudioDevicePropertyMute, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain }` 并读取
    - `set_device_mute(device_id: u32, muted: bool) -> Result<()>` — 同上 address，呼叫 `AudioObjectSetPropertyData`
    - 使用 `extern "C"` 宣告 `AudioObjectGetPropertyData` / `AudioObjectSetPropertyData`
  - Windows 实作（`#[cfg(target_os = "windows")]`）：
    - `init_com() -> Result<ComGuard>` — COM 初始化 + scope guard（ComGuard 在 Drop 时自动 CoUninitialize）
    - `get_default_endpoint_volume() -> Result<IAudioEndpointVolume>` — 纯取得介面（不含 COM init）
    - `get_system_mute() -> Result<bool>` — `init_com()` + `get_default_endpoint_volume()` + `GetMute()`
    - `set_system_mute(muted: bool) -> Result<()>` — `init_com()` + `get_default_endpoint_volume()` + `SetMute()`
    - **⚠️ COM guard 必须活到操作完成**：`ComGuard` 放在 public function（`get_system_mute`/`set_system_mute`）层级，确保 COM apartment 在使用 COM interface 期间保持有效。不可将 guard 放在 `get_default_endpoint_volume` 内，否则 guard drop 后 COM interface 会失效（use-after-uninit）
    - **COM 初始化处理**：使用 `COINIT_APARTMENTTHREADED`。`windows-rs` 将 `S_OK` 和 `S_FALSE` 都映射为 `Ok(())`（需配对 CoUninitialize）；`RPC_E_CHANGED_MODE`（0x80010106）映射为 `Err`，跳过 init 继续操作（不需 CoUninitialize）
  - Tauri Commands：
    - `mute_system_audio(state: State<AudioControlState>) -> Result<(), String>` — 在 lock 内：读 flag → 若 None 则取系统 mute 状态 → 设为 mute → 写入 flag
    - `restore_system_audio(state: State<AudioControlState>) -> Result<(), String>` — 在 lock 内：读 flag → 若 Some(was_muted) 则先清除 flag 为 None → 再恢复系统 mute 状态（先清后恢复，确保失败不卡住）
  - 幂等逻辑：
    - `mute`: 若 `was_muted_before` 已有值（pending restore），跳过（已经静音了）
    - `restore`: 若 `was_muted_before` 为 `None`，跳过（没有 pending restore）

- [x] **Task 3: 注册 audio_control module**
  - File: `src-tauri/src/plugins/mod.rs`
  - Action: 在现有 3 行后加入 `pub mod audio_control;`

- [x] **Task 4: 注册 Tauri Commands 和 State**
  - File: `src-tauri/src/lib.rs`
  - Action:
    - 在 `.invoke_handler(tauri::generate_handler![...])` 中加入 `plugins::audio_control::mute_system_audio` 和 `plugins::audio_control::restore_system_audio`
    - 在 `.setup()` 内加入 `app.manage(plugins::audio_control::AudioControlState::new());`

- [x] **Task 5: useSettingsStore 新增静音设定**
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    - 新增 `export const DEFAULT_MUTE_ON_RECORDING = true;`
    - 新增 `const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);`（型别明确为 `ref<boolean>`，与 `isAutoStartEnabled` 模式一致）
    - `loadSettings()` 中加入读取：`const savedMuteOnRecording = await store.get<boolean>("muteOnRecording"); isMuteOnRecordingEnabled.value = savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;`
    - 新增方法：
      ```typescript
      async function saveMuteOnRecording(enabled: boolean) {
        try {
          const store = await load(STORE_NAME);
          await store.set("muteOnRecording", enabled);
          await store.save();
          isMuteOnRecordingEnabled.value = enabled;

          const payload: SettingsUpdatedPayload = {
            key: "muteOnRecording",
            value: enabled,
          };
          await emitEvent(SETTINGS_UPDATED, payload);
          console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
        } catch (err) {
          console.error("[useSettingsStore] saveMuteOnRecording failed:", extractErrorMessage(err));
          throw err;
        }
      }
      ```
    - 在 return 中汇出 `isMuteOnRecordingEnabled` 和 `saveMuteOnRecording`

- [x] **Task 6: useVoiceFlowStore 整合静音流程**
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    - 新增 helper：
      ```typescript
      async function muteSystemAudioIfEnabled() {
        const settingsStore = useSettingsStore();
        if (!settingsStore.isMuteOnRecordingEnabled) return;
        try {
          await invoke("mute_system_audio");
        } catch (err) {
          writeErrorLog(`useVoiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`);
        }
      }

      function restoreSystemAudio() {
        void invoke("restore_system_audio").catch((err) =>
          writeErrorLog(`useVoiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`)
        );
      }
      ```
    - `handleStartRecording()`：`await Promise.all([muteSystemAudioIfEnabled(), initializeMicrophone()])` — 两者并行（互不依赖：mute 操作系统喇叭输出，mic init 操作麦克风输入）
    - `handleStopRecording()`：在函式最开头（`stopElapsedTimer()` 之前）呼叫 `restoreSystemAudio()`（fire-and-forget，确保不论后续流程成功或失败都恢复）
    - `failRecordingFlow()`：在函式开头加入 `restoreSystemAudio()`
  - **⚠️ 双重 restore 路径**：`handleStopRecording` 开头 restore → 后续 `completePasteFlow` 的 catch 呼叫 `failRecordingFlow` 再次 restore。这是刻意设计：幂等的 `restore_system_audio` 第二次呼叫时读到 `was_muted_before = None` 直接跳过。
  - Notes:
    - `muteSystemAudioIfEnabled()` 是 async 但与 `initializeMicrophone()` 并行（Promise.all），失败不阻挡录音
    - `restoreSystemAudio()` 是 fire-and-forget（不 await），不影响后续流程
    - `handleStopRecording` 开头恢复是因为：不论后续转录/整理/贴上是否成功，喇叭都应该恢复

- [x] **Task 7: SettingsView 新增自动静音开关**
  - File: `src/views/SettingsView.vue`
  - Action:
    - 在 `<script setup>` 新增：
      - `const muteOnRecordingFeedback = useFeedbackMessage();`
      - handler（直接读 store ref，不建本地 ref，与 `isAutoStartEnabled` 模式一致）：
        ```typescript
        async function handleToggleMuteOnRecording(newValue: boolean) {
          try {
            await settingsStore.saveMuteOnRecording(newValue);
            muteOnRecordingFeedback.show("success", newValue ? "已启用录音自动静音" : "已停用录音自动静音");
          } catch (err) {
            muteOnRecordingFeedback.show("error", extractErrorMessage(err));
          }
        }
        ```
      - `onBeforeUnmount` 中加入：`muteOnRecordingFeedback.clearTimer();`
    - 在 template 的「应用程式」Card（`<CardContent>` 内），在 auto-start 区块**之前**插入：
      ```html
      <div class="flex items-center justify-between">
        <div>
          <Label for="mute-on-recording">录音时自动静音</Label>
          <p class="text-sm text-muted-foreground">开始录音时自动静音系统喇叭，结束后恢复</p>
        </div>
        <Switch
          id="mute-on-recording"
          :model-value="settingsStore.isMuteOnRecordingEnabled"
          @update:model-value="handleToggleMuteOnRecording"
        />
      </div>
      <div class="border-t border-border" />
      ```
    - feedback transition 同 auto-start 模式

### Acceptance Criteria

- [x] **AC 1**: Given 使用者启用「录音时自动静音」设定（预设开启），when 按下录音快捷键开始录音，then 系统喇叭被静音（mute）
- [x] **AC 2**: Given 录音正在进行中且系统已被静音，when 录音结束（放开快捷键），then 系统 mute 状态恢复到录音前的原始状态
- [x] **AC 3**: Given 录音过程中发生错误（如麦克风失败），when 录音流程进入错误状态，then 系统 mute 状态仍然被恢复
- [x] **AC 4**: Given 使用者在 Settings 停用「录音时自动静音」，when 按下录音快捷键，then 系统喇叭不被静音
- [x] **AC 5**: Given 系统喇叭在录音前已经是 mute 状态，when 录音开始和结束，then 系统仍维持 mute 状态（不会意外 unmute）
- [x] **AC 6**: Given 静音 API 呼叫失败（如权限问题），when 录音开始，then 录音流程不被阻挡，仅 log warning
- [x] **AC 7**: Given Settings 页面开启，when 切换「录音时自动静音」开关，then 设定被持久化并显示回馈讯息
- [x] **AC 8**: Given macOS 环境，when 执行静音/恢复操作，then 透过 CoreAudio API 正确控制预设输出装置 mute 状态
- [x] **AC 9**: Given Windows 环境，when 执行静音/恢复操作，then 透过 WASAPI/EndpointVolume 正确控制系统音量 mute 状态

## Additional Context

### Dependencies

**Cargo.toml 变更：**
- Windows `windows` crate 需新增 features：`"Win32_Media_Audio"`, `"Win32_System_Com"`
- macOS 不需要新增 crate（使用 `extern "C"` 直接呼叫 CoreAudio C API），但需在 `build.rs` 加入 `println!("cargo:rustc-link-lib=framework=CoreAudio")` 连结 framework
- ⚠️ `cargo check` 不触发 linker，只有 `cargo build` / `pnpm tauri dev` 才会出现 linker 错误
- ⚠️ 实作时若 import 报错，可能还需 `"Win32_System_Com_StructuredStorage"` 等额外 features

**macOS CoreAudio API：**
```rust
use std::ffi::c_void;

/// CoreAudio property address — 必须 repr(C) 确保记忆体对齐正确
#[repr(C)]
struct AudioObjectPropertyAddress {
    mSelector: u32,
    mScope: u32,
    mElement: u32,
}

extern "C" {
    fn AudioObjectGetPropertyData(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        ioDataSize: *mut u32,
        outData: *mut c_void,
    ) -> i32;  // OSStatus, 0 = noErr

    fn AudioObjectSetPropertyData(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        inDataSize: u32,
        inData: *const c_void,
    ) -> i32;  // OSStatus, 0 = noErr
}

// FourCC 常数（big-endian byte order）
const kAudioHardwarePropertyDefaultOutputDevice: u32 = 0x644F7574; // 'dOut'
const kAudioDevicePropertyMute: u32 = 0x6D757465;                  // 'mute'
const kAudioObjectPropertyScopeOutput: u32 = 0x6F757470;           // 'outp'
const kAudioObjectPropertyScopeGlobal: u32 = 0x676C6F62;           // 'glob'
const kAudioObjectPropertyElementMain: u32 = 0;
const kAudioObjectSystemObject: u32 = 1;
```

**Windows WASAPI API：**
```rust
use windows::Win32::Media::Audio::{
    eRender, eConsole,
    IMMDeviceEnumerator, MMDeviceEnumerator,
    IAudioEndpointVolume,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize,
    CLSCTX_ALL, COINIT_APARTMENTTHREADED,  // ⚠️ 不是 COINIT_MULTITHREADED
};
use windows::core::Interface;

// COM 初始化处理（windows-rs HRESULT 映射规则）：
// - S_OK (0) → Ok(()): 成功初始化，需配对 CoUninitialize
// - S_FALSE (1) → Ok(()): 已在同模式下初始化，仍需配对 CoUninitialize
// - RPC_E_CHANGED_MODE (0x80010106) → Err: 已在不同模式，跳过（不需 CoUninitialize）
// ⚠️ ComGuard scope guard 必须存活到 COM interface 操作完成
```

### Testing Strategy

**Rust 单元测试（`audio_control.rs` 内 `#[cfg(test)]`）：**
- `test_audio_control_state_new` — 初始化时 `was_muted_before` 为 `None`
- `test_mute_idempotent` — 连续呼叫 mute 不 panic（第二次跳过）
- `test_restore_without_mute` — 没有先 mute 就 restore 不 panic（跳过）
- `test_state_reset_after_restore` — restore 后 state 回到 `None`

**注意**：平台 API 呼叫（CoreAudio/WASAPI）是真实系统呼叫，无法在 CI 中 mock。Rust 测试聚焦在 state 管理逻辑。

**手动测试步骤：**
1. macOS: 播放音乐 → 按录音快捷键 → 确认音乐静音 → 放开 → 确认音乐恢复
2. Windows: 同上流程
3. 录音前已 mute → 录音开始/结束 → 确认仍为 mute
4. Settings 关闭自动静音 → 录音 → 确认音乐不被静音
5. 录音中故意触发错误（如拔麦克风）→ 确认音量恢复

### Notes

**高风险项目：**
- macOS CoreAudio `AudioObjectPropertyAddress` 结构的 `repr(C)` 对齐必须正确，否则 UB — 完整结构定义已在 Dependencies 区段提供
- Windows COM 初始化使用 `COINIT_APARTMENTTHREADED`，处理 `RPC_E_CHANGED_MODE` 回传值。`ComGuard` scope guard 确保配对 `CoUninitialize`
- `IAudioEndpointVolume` 是 COM 介面，`windows` crate 的 `Interface` trait 会自动管理 `Release()`
- Windows COM guard 必须放在 public function 层级（`get_system_mute`/`set_system_mute`），不可放在 `get_default_endpoint_volume` 内（否则 guard drop 后 COM interface 失效）
- macOS `extern "C"` FFI 需在 `build.rs` 手动连结 `CoreAudio.framework`（`cargo check` 不会报错，只有 `cargo build` 的 linker 阶段才会暴露）
- Mutex lock 必须贯穿完整 read→syscall→write 序列，防止并发 command 竞争

**已知限制：**
- 只控制预设输出装置；如使用者切换输出装置（如插入耳机），mute 的是旧装置
- macOS 某些 USB/蓝牙音讯装置可能不支援 mute 属性（会在 CoreAudio 层回传错误码）
- restore 失败时仅 log，不通知使用者（使用者需手动取消静音）

**未来考虑（Out of Scope）：**
- 支援 per-app 音量控制（macOS: Audio Middleware, Windows: `ISimpleAudioVolume`）
- 监听音讯装置切换事件（`kAudioHardwarePropertyDefaultOutputDevice` property listener）
