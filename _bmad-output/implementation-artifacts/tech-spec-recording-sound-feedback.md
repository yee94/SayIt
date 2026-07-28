---
title: '录音操作音效回馈'
slug: 'recording-sound-feedback'
created: '2026-03-08'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Rust (AudioServicesPlaySystemSound / Win32 PlaySound)', 'Tauri Command', 'macOS AudioToolbox', 'Win32 PlaySound']
files_to_modify: ['src-tauri/src/plugins/sound_feedback.rs', 'src-tauri/src/plugins/mod.rs', 'src-tauri/src/lib.rs', 'src/stores/useVoiceFlowStore.ts', 'src-tauri/Cargo.toml', 'src-tauri/resources/sounds/start.wav', 'src-tauri/resources/sounds/stop.wav', 'CLAUDE.md']
code_patterns: ['cfg(target_os) 条件编译', 'mod macos / mod windows 平台分离', 'Tauri Command 注册在 lib.rs invoke_handler', 'plugins/mod.rs 注册新模组']
test_patterns: ['Rust #[cfg(test)] mod tests 在同档案底部', 'Vitest + jsdom 前端测试']
---

# Tech-Spec: 录音操作音效回馈

**Created:** 2026-03-08

## Overview

### Problem Statement

使用者按下快捷键开始/结束录音时缺乏听觉回馈，无法直觉感知操作是否生效。

### Solution

在开始录音和结束录音时播放系统音效（macOS `NSSound` / Windows `PlaySound`），音效播放不受「录音静音」功能影响，固定开启不可关闭。

### Scope

**In Scope:**
- 开始录音时播放一个系统音效
- 结束录音时播放另一个系统音效
- macOS + Windows 双平台支援
- 音效不受 `mute_system_audio` 影响

**Out of Scope:**
- 使用者自订音效档案
- 音效开关设定
- 其他状态（转录完成、错误等）的音效

## Context for Development

### Codebase Patterns

- 录音流程由 `useVoiceFlowStore.ts` 的 `handleStartRecording()` / `handleStopRecording()` 驱动
- 系统静音功能在 `plugins/audio_control.rs`，透过 `mute_system_audio` / `restore_system_audio` command 控制
- 静音机制：macOS CoreAudio `AudioObjectSetPropertyData(kAudioDevicePropertyMute)` / Windows WASAPI `IAudioEndpointVolume::SetMute`
- 平台特定逻辑使用 `#[cfg(target_os = "...")]` + 各平台子模组（`mod macos` / `mod windows_audio`）
- plugin 档案在 `src-tauri/src/plugins/` 下，需在 `mod.rs` 注册
- Tauri command 在 `lib.rs` 的 `tauri::generate_handler![]` 巨集注册
- State 在 `lib.rs` 的 `.setup()` 中用 `app.manage()` 初始化

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/stores/useVoiceFlowStore.ts` | 录音流程主控 store（音效呼叫插入点） |
| `src-tauri/src/plugins/audio_control.rs` | 系统音量控制（静音/还原），参考平台分离模式 |
| `src-tauri/src/plugins/audio_recorder.rs` | 音讯录制 plugin |
| `src-tauri/src/plugins/mod.rs` | plugin 模组注册 |
| `src-tauri/src/lib.rs` | Tauri command 注册 + State 初始化 |
| `tests/unit/use-voice-flow-store.test.ts` | VoiceFlow store 前端测试 |

### Technical Decisions

- **音效选择**：macOS 使用 `Funk`（开始）+ `Bottle`（结束），Windows 使用自订 WAV 档案 `dm/Windows Hardware Insert`（开始）+ `dm/Windows Hardware Remove`（结束），透过 `include_bytes!` 嵌入 binary
- **播放 API**：macOS `AudioServicesPlaySystemSound`（AudioToolbox framework，不依赖 RunLoop），Windows `PlaySoundA`（Win32 API）+ `SND_MEMORY` 从记忆体播放嵌入的 WAV 资料
- **为什么不用 NSSound**：`NSSound.play()` 依赖 RunLoop 驱动播放事件，Tauri `#[command]` 跑在 tokio worker thread 上没有 RunLoop，会导致音效不播放。`AudioServicesPlaySystemSound` 不依赖 RunLoop，适合背景执行绪呼叫
- 音效播放在 Rust 端执行，不经由前端
- 音效固定开启，无使用者设定
- **静音绕过策略**：调整时序确保音效播放时系统未静音
  - 开始录音：fire-and-forget `play_start_sound` + `setTimeout` 400ms 延迟静音同时排定 → await `start_recording`
  - `delayedMuteTimer` 管理：在 `handleStopRecording`、`failRecordingFlow`、`cleanup` 中 `clearTimeout`，防止录音结束后 stale timer 触发静音
  - 结束录音：await `restoreSystemAudio` → fire-and-forget `play_stop_sound`
- **非阻塞播放**：macOS `AudioServicesPlaySystemSound` 立即回传、不阻塞，Windows `PlaySound` 用 `SND_ASYNC`
- 新增 `src-tauri/src/plugins/sound_feedback.rs` 作为独立 plugin
- **objc FFI 参考**：`clipboard_paste.rs` 中的 `msg_send!` 模式为 macOS FFI 范例参考
- **前端直接 invoke**：不建立封装函式，直接 `invoke("play_start_sound")` / `invoke("play_stop_sound")`，与现有 store 惯例一致

## Implementation Plan

### Tasks

- [ ] Task 1: 建立 `sound_feedback.rs` plugin — macOS 实作
  - File: `src-tauri/src/plugins/sound_feedback.rs`
  - Action: 建立新档案，实作 macOS 平台音效播放
  - Notes:
    - 建立 `mod macos` 子模组，使用 AudioToolbox framework 的 `AudioServicesPlaySystemSound`
    - 不使用 `NSSound`（因为它依赖 RunLoop，tokio worker thread 上不播放）
    - 透过 `extern "C"` FFI 宣告 `AudioServicesCreateSystemSoundID` 和 `AudioServicesPlaySystemSound`
    - 音效档案路径：`/System/Library/Sounds/Funk.aiff`（开始）、`/System/Library/Sounds/Bottle.aiff`（结束）
    - 需要建立 `CFURLRef`（透过 `core_foundation` crate 的 `CFURL::from_path`）指向音效档案
    - 流程：`CFURL::from_path()` → `AudioServicesCreateSystemSoundID()` → `AudioServicesPlaySystemSound()`
    - `AudioServicesPlaySystemSound` 立即回传、不阻塞、不依赖 RunLoop
    - 提供 `play_start_sound()` 和 `play_stop_sound()` 两个公开函式
    - `AudioServicesCreateSystemSoundID` 失败时回传非零 OSStatus，需检查并 `eprintln!` 记录
    - 音效播放失败时静默处理，不应影响录音流程
    - 参考 `clipboard_paste.rs` 的 macOS FFI 模式

- [ ] Task 2: 建立 `sound_feedback.rs` plugin — Windows 实作
  - File: `src-tauri/src/plugins/sound_feedback.rs`
  - Action: 在同档案内建立 `mod windows_sound` 子模组
  - Notes:
    - 使用 `windows::Win32::Media::PlaySoundA` + `SND_MEMORY | SND_ASYNC` 从记忆体播放嵌入的 WAV 资料
    - WAV 档案透过 `include_bytes!("../../resources/sounds/start.wav")` 和 `stop.wav` 在编译时嵌入
    - 音效来源：Windows 11 dm 主题的 `Windows Hardware Insert.wav`（开始）和 `Windows Hardware Remove.wav`（结束），选用冷门音效避免与系统常见音效混淆
    - `PlaySoundA` 第一个参数为 `PCSTR(bytes.as_ptr())`，指向记忆体中的 WAV 资料
    - `PlaySoundA` 回传 `Result`，失败时 `eprintln!` 记录
    - 与 macOS 相同的错误处理策略（静默失败）
    - 不使用 `SND_ALIAS` + 系统别名，因为使用者可能自订系统音效，且常见别名易与系统功能混淆

- [ ] Task 3: 建立平台无关包装函式 + Tauri Commands
  - File: `src-tauri/src/plugins/sound_feedback.rs`
  - Action: 建立 `platform_play_start_sound()` / `platform_play_stop_sound()` 包装函式，并建立对应的 Tauri `#[command]`
  - Notes:
    - 使用 `#[cfg(target_os = "...")]` 条件编译分派到各平台实作
    - `#[cfg(not(any(...)))]` fallback 为 no-op（`println!` 记录后回传）
    - Tauri commands 确切签名为 `#[command] pub fn play_start_sound()` 和 `#[command] pub fn play_stop_sound()`，无参数，回传 `()`（不使用 `Result`）
    - Commands 不需要 State，纯函式呼叫
    - 平台函式内部的错误已静默处理，command 层级不需要再 catch

- [ ] Task 4: 注册新 plugin 模组
  - File: `src-tauri/src/plugins/mod.rs`
  - Action: 新增 `pub mod sound_feedback;`

- [ ] Task 5: 注册 Tauri commands
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `tauri::generate_handler![]` 巨集中新增 `plugins::sound_feedback::play_start_sound` 和 `plugins::sound_feedback::play_stop_sound`

- [ ] Task 6: 新增 Windows `Win32_Media` feature
  - File: `src-tauri/Cargo.toml`
  - Action: 在 `[target.'cfg(target_os = "windows")'.dependencies]` 的 windows features 中新增 `"Win32_Media"`
  - Notes: `PlaySoundW` 位于 `windows::Win32::Media`，需要此 feature

- [ ] Task 7: 修改前端录音流程 — 开始录音加入音效
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 `handleStartRecording()` 函式
  - Notes:
    - 修改后完整流程（在既有 try block 内部）：
      1. `void invoke("play_start_sound").catch(() => {})` — fire-and-forget 播放开始音效，catch 静默处理失败
      2. `await invoke("start_recording")` — 同时启动录音（与音效同步开始）
      3. `startElapsedTimer()` + `transitionTo("recording")` — 原有逻辑不变
      4. `delayedMuteTimer = setTimeout(() => { void muteSystemAudioIfEnabled() }, START_SOUND_DURATION_MS)` — 延迟 400ms 后静音，在音效主要可感知段播完后静音
    - 400ms 为 Funk 音效 attack + sustain 段的可感知长度（全长 2.16s 但后段为低音量 decay），抽取为 `const START_SOUND_DURATION_MS = 400`，放在档案顶部常数区
    - `setTimeout` 必须在 `await invoke("start_recording")` 之前排定，确保 timer 与音效同时起跑，不受 IPC 耗时影响
    - `delayedMuteTimer` 必须在 `handleStopRecording`、`failRecordingFlow`、`cleanup` 中 `clearTimeout`，防止录音结束后 stale timer 误触静音
    - 音效用 fire-and-forget（不需 await），因为音效与录音同时启动，不存在时序依赖
    - 音效失败（`.catch(() => {})`）不影响后续流程，静默吞掉错误
    - 音效播放初期的少量声音可能被麦克风录进去，但 Whisper 能正确辨识为背景音，对 UX 影响极小

- [ ] Task 8: 修改前端录音流程 — 结束录音加入音效
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 `handleStopRecording()` 函式
  - Notes:
    - **重要**：现有 `restoreSystemAudio()` 是 fire-and-forget（`void invoke(...)`），不等待结果。必须改为 await 确保音量已还原
    - 将 `restoreSystemAudio()` 改为 async 函式，内部 `await invoke("restore_system_audio")`，失败仍静默处理
    - 修改后完整流程：
      1. `await restoreSystemAudio()` — 确保系统音量已还原
      2. `void invoke("play_stop_sound").catch(() => {})` — fire-and-forget 播放结束音效（此时系统已非静音）
      3. 继续原有的 `transitionTo("transcribing")` 及后续流程
    - 结束音效用 fire-and-forget 即可（不需 await），因为后续流程不依赖音效完成
    - 音效呼叫失败不影响转录流程

- [ ] Task 9: 更新前端测试
  - File: `tests/unit/use-voice-flow-store.test.ts`
  - Action: 为新增的 `play_start_sound` / `play_stop_sound` invoke 呼叫加入 mock
  - Notes:
    - 在现有的 `vi.mock` 中加入对 `play_start_sound` 和 `play_stop_sound` 的 mock
    - 验证开始录音时 `play_start_sound` 被呼叫
    - 验证结束录音时 `play_stop_sound` 被呼叫

- [ ] Task 10: 更新 CLAUDE.md IPC 契约表
  - File: `CLAUDE.md`
  - Action: 在「Tauri Commands（Frontend → Rust）」表格中新增两个 command
  - Notes:
    - `play_start_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()`
    - `play_stop_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()`

### Acceptance Criteria

- [ ] AC 1: Given 使用者按下快捷键开始录音，when 录音流程启动，then 播放开始音效（macOS: Funk, Windows: dm/Hardware Insert）
- [ ] AC 2: Given 使用者释放快捷键结束录音，when 录音停止且系统音量还原后，then 播放结束音效（macOS: Bottle, Windows: dm/Hardware Remove）
- [ ] AC 3: Given 「录音时静音」功能已启用，when 开始录音，then 音效在静音前播放，使用者能听到音效
- [ ] AC 4: Given 「录音时静音」功能未启用，when 开始录音，then 音效正常播放
- [ ] AC 5: Given 系统音效播放失败（如音效档不存在），when 开始/结束录音，then 录音流程不受影响，正常继续
- [ ] AC 6: Given Windows 平台，when 开始/结束录音，then 播放对应的 Windows 系统音效
- [ ] AC 7: Given 使用 toggle 模式，when 连续按两次快捷键（开始→结束），then 分别听到开始音效和结束音效

## Additional Context

### Dependencies

- **macOS**: `core-foundation` crate 0.10（已存在于 `Cargo.toml`）— 用于 `CFURL` 建构。`AudioServicesPlaySystemSound` / `AudioServicesCreateSystemSoundID` 透过 `extern "C"` FFI 直接宣告（AudioToolbox framework 已被 Tauri 连结，不需额外 crate）
- **Windows**: `windows` crate 0.61（已存在）— 需 `Win32_Media` feature 用于 `PlaySoundA`。WAV 档案透过 `include_bytes!` 嵌入，无需 runtime 资源路径解析
- 无新增外部 crate 依赖

### Testing Strategy

**Rust 端：**
- `sound_feedback.rs` 底部加入 `#[cfg(test)] mod tests`
- 测试包装函式存在且可呼叫（平台相关的实际播放无法在 CI 测试）
- 非支援平台的 no-op fallback 测试

**前端：**
- 更新 `use-voice-flow-store.test.ts`，mock `play_start_sound` / `play_stop_sound` invoke
- 验证 `handleStartRecording` 呼叫 `play_start_sound`
- 验证 `handleStopRecording` 呼叫 `play_stop_sound`
- 验证音效呼叫失败不影响主流程

**手动测试：**
- macOS: 确认听到 Funk（开始）+ Bottle（结束）
- 开启「录音时静音」：确认开始音效在静音前可听到
- 关闭「录音时静音」：确认两个音效都完整播放
- 确认音效不会被 Whisper 转录为文字（正常状况下因为音效短暂，不影响）

### Notes

- **音效被录进去的风险**：音效与录音同时启动，前 ~400ms 音效仍在播放中（静音前）。由于系统音效走 output device、录音走 input device（麦克风），除非使用者用外放喇叭+近距离麦克风，否则不会被录进去。即使被录到，Whisper 能正确辨识为背景音而非语音，对转录结果影响极小。
- **Windows 音效选择**：使用 Windows 11 dm 主题的 `Windows Hardware Insert.wav` / `Windows Hardware Remove.wav`，透过 `include_bytes!` 嵌入 binary + `PlaySoundA` `SND_MEMORY` 播放。选用冷门主题音效避免与系统常见功能（通知、错误等）混淆。WAV 档案存放于 `src-tauri/resources/sounds/`（start.wav / stop.wav），合计 ~200KB。
- **未来扩展**：若需支援自订音效或音效开关，建议在 `useSettingsStore` 新增设定项，并将音效名称作为 Tauri command 参数传入。
- **400ms 延迟静音**：`START_SOUND_DURATION_MS = 400` 为 Funk 音效 attack + sustain 段的可感知长度。Funk 全长 ~2.16s 但后段为低音量 decay/release，人耳不敏感。400ms 在音效主要段播完后即静音，兼顾听觉回馈与快速静音。`setTimeout` 必须在 `await invoke("start_recording")` 之前排定，否则 IPC 耗时会叠加导致延迟过长。
- **restoreSystemAudio 改为 async**：此修改影响既有的 `handleStopRecording` 流程，从 fire-and-forget 改为 await。这是为了确保系统音量在播放结束音效前已恢复。对现有功能无副作用（原本失败也是静默处理）。

### Adversarial Review 修正摘要

| Finding | 修正方式 |
|---------|---------|
| F1 (Critical): restoreSystemAudio race condition | Task 8: 改为 await restoreSystemAudio 后再播放 stop sound |
| F9 (Medium): NSSound RunLoop 依赖 | Task 1: 改用 AudioServicesPlaySystemSound |
| F3 (High): fire-and-forget + sleep 时序不准 | Task 7: 改为 fire-and-forget 音效 + setTimeout 400ms 延迟静音（在 await 之前排定）+ delayedMuteTimer 管理防止 stale timer |
| F4 (High): 修改后流程不具体 | Task 7/8: 补上完整步骤流程 |
| F2 (High): sleep 实作方式未指定 | Task 7: 指定 inline Promise + setTimeout |
| F6 (Medium): NSSound nil check | Task 1: 改用 AudioServices，回传 OSStatus 检查 |
| F8 (Medium): command 签名歧义 | Task 3: 明确 `pub fn play_start_sound()` 回传 `()` |
| F10 (Medium): Windows 宽字串 | Task 2: 补上 `w!()` 巨集说明 |
| F12 (Low): 缺少 FFI 参考 | Technical Decisions: 补上参考 clipboard_paste.rs |
| F13 (Low): 未更新 IPC 契约表 | Task 10: 新增更新 CLAUDE.md |
| F5 (Medium): Win32_Media feature | Task 6: 保持不变，实作时验证 |
| F7 (Medium): 是否需封装函式 | Technical Decisions: 明确不需要 |
| F11 (Low): 150ms 无依据 | Notes: 补上说明为经验值 |
