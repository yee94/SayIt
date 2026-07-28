---
title: 'Rust Native Audio Pipeline'
slug: 'rust-native-audio-pipeline'
created: '2026-03-07 22:36:47'
status: 'done'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
tech_stack: ['Rust', 'cpal 0.15+', 'hound', 'rustfft', 'reqwest (via tauri-plugin-http)', 'Tauri v2 Commands/Events', 'TypeScript', 'Vue 3', 'Pinia']
files_to_modify: ['src-tauri/Cargo.toml', 'src-tauri/src/plugins/mod.rs', 'src-tauri/src/plugins/audio_recorder.rs', 'src-tauri/src/plugins/transcription.rs', 'src-tauri/src/lib.rs', 'src/lib/recorder.ts (DELETE)', 'src/lib/transcriber.ts (DELETE)', 'src/stores/useVoiceFlowStore.ts', 'src/composables/useAudioWaveform.ts', 'src/composables/useTauriEvents.ts', 'src/types/audio.ts', 'src/components/NotchHud.vue', 'src/App.vue', 'tests/component/NotchHud.test.ts', 'tests/unit/use-voice-flow-store.test.ts', 'tests/unit/recorder.test.ts (DELETE)', 'tests/unit/transcriber.test.ts (DELETE)']
code_patterns: ['Tauri Command (invoke) for request-response', 'Tauri Event (emit) for streaming waveform data to frontend', 'Mutex<Option<T>> singleton pattern for Rust state (see audio_control.rs)', 'platform_* helper functions wrapping cfg(target_os) blocks (see audio_control.rs)', 'Pinia store as sole bridge between views and lib/', 'app.manage(State) for Tauri managed state injection', 'invoke_handler generate_handler![] for Command registration']
test_patterns: ['Vitest + vi.mock for Tauri invoke/listen', 'vi.hoisted for mock declarations', 'Rust #[cfg(test)] mod tests in same file', 'existing use-voice-flow-store.test.ts needs major refactor']
---

# Tech-Spec: Rust Native Audio Pipeline

**Created:** 2026-03-07 22:36:47

## Overview

### Problem Statement

SayIt 的音讯撷取目前使用 Web API（`getUserMedia` / `MediaRecorder`），运行在 Tauri HUD webview 中。这导致两个问题：

1. **WKWebView 背景限制**：macOS 的 WKWebView 要求 webview 处于「活跃」状态才能完成 `getUserMedia`。快捷键触发时前景 app 持有焦点，HUD webview 在背景，导致 `getUserMedia` 挂起。因此无法实现 lazy init（按需初始化麦克风），麦克风图示在 app 启动后即常驻 macOS 状态列。

2. **职责错置**：HUD webview 承担了录音控制、音讯分析、转录 API 呼叫等非 UI 职责，违反「UI 层只做显示」的架构原则。转录 API 呼叫也因此受限于 webview 的生命周期。

### Solution

将整个音讯管线搬到 Rust 侧：

- **录音**：使用 `cpal` crate 跨平台撷取 PCM 音讯，`hound` 编码为 WAV
- **转录**：Rust 直接呼叫 Groq Whisper API（`reqwest`）
- **波形资料**：Rust 计算频率资料，透过 Tauri Event 推送给前端
- **前端**：HUD webview 退化为纯 UI 显示层，透过 Tauri Commands 控制录音、透过 Events 接收状态更新

Rust 不受 WKWebView 限制，可实现真正的 lazy init — 麦克风图示仅在录音期间出现。

### Scope

**In Scope:**
- Rust 新增 `audio_recorder` plugin：`cpal` 录音、WAV 编码、麦克风 lazy init/release
- Rust 新增 `transcription` plugin：Groq Whisper API 呼叫（含词汇注入）
- Rust 推送波形频率资料给前端（Tauri Event）
- 前端移除 `recorder.ts`、`transcriber.ts`
- `useVoiceFlowStore` 改用 Tauri Commands/Events 驱动录音流程
- `useAudioWaveform` 改为监听 Rust 推送的频率资料
- 更新相关测试

**Out of Scope:**
- AI 整理（`enhancer.ts`）迁移 — 保留在前端
- HUD UI 元件/动画重设计
- 新增音讯格式支援（WAV 足够，Groq API 支援）
- Windows 平台实作（本 spec 先完成 macOS，Windows 结构预留但不实作）

## Context for Development

### Codebase Patterns

- **Rust plugin 结构**：plugins 放在 `src-tauri/src/plugins/`，在 `mod.rs` 用 `pub mod` 注册，`lib.rs` 的 `invoke_handler` 用 `generate_handler![]` 挂载 Commands
- **Rust state 管理**：`app.manage(XxxState::new())` 在 `setup()` 中初始化，Command 透过 `State<XxxState>` 注入。内部用 `Mutex<Option<T>>` 做 singleton（参见 `audio_control.rs`）
- **平台条件编译**：`mod macos {}` + `mod windows_xxx {}` 分模组，再用 `platform_*()` helper wrapping `cfg(target_os)` blocks（参见 `audio_control.rs:257-286`）
- **前端架构**：`lib/` 封装外部 API，`stores/` 透过 Pinia 管理状态，`views/` 不直接呼叫 `lib/`
- **IPC 模式**：Commands 用 `invoke()` 做 request-response，Events 用 `emit()`/`listen()` 做 push/streaming
- **IPC 契约**：`CLAUDE.md` 有完整 Command/Event 表格，新增需同步更新
- **波形资料流（现有）**：`useVoiceFlowStore` 持有 `analyserHandle: ref<AudioAnalyserHandle | null>`，prop 传到 `NotchHud.vue` → `useAudioWaveform.ts`，用 `useRafFn` 每帧读取 6 个 frequency bin（index: 9,4,1,2,6,12），做 dB normalize + lerp 平滑

### Files to Reference

| File | Purpose | Action |
| ---- | ------- | ------ |
| `src/lib/recorder.ts` | Web API 录音：`getUserMedia`, `MediaRecorder`, `AudioContext` analyser | **DELETE** |
| `src/lib/transcriber.ts` | Groq Whisper API：`FormData` + `@tauri-apps/plugin-http` fetch | **DELETE** |
| `tests/unit/recorder.test.ts` | recorder.ts 测试（mock MediaRecorder/getUserMedia） | **DELETE** |
| `src/stores/useVoiceFlowStore.ts` | 语音流程 Pinia store：改用 Tauri Commands/Events 驱动录音与转录 | **MAJOR REFACTOR** |
| `src/composables/useAudioWaveform.ts` | 波形动画：`useRafFn` + `AudioAnalyserHandle.getFrequencyData()` | **REFACTOR** |
| `src/types/audio.ts` | `AudioAnalyserHandle` interface + `DEFAULT_ANALYSER_CONFIG` | **REPLACE** |
| `src/components/NotchHud.vue` | HUD 元件：接收 `analyserHandle` prop | **UPDATE** |
| `src/App.vue` | HUD 入口：传递 `voiceFlowStore.analyserHandle` | **UPDATE** |
| `tests/component/NotchHud.test.ts` | HUD 状态与波形生命周期测试 | **UPDATE** |
| `tests/unit/use-voice-flow-store.test.ts` | store 测试：mock Tauri commands/events | **MAJOR REFACTOR** |
| `src-tauri/src/plugins/audio_control.rs` | 系统音量控制（441 行） | **REFERENCE** |
| `src-tauri/src/plugins/hotkey_listener.rs` | 快捷键 + Event emit | **REFERENCE** |
| `src-tauri/src/lib.rs` | Tauri Builder：`invoke_handler`, `setup`, `app.manage()` | **MODIFY** |
| `src-tauri/src/plugins/mod.rs` | Plugin 模组注册 | **MODIFY** |
| `src-tauri/Cargo.toml` | Rust 依赖 | **MODIFY** |

### Technical Decisions

- **`cpal` 跨平台音讯撷取**：`Host::default()` → `host.default_input_device()` → 选择装置实际支援的 `SupportedStreamConfig`。优先 16kHz；若装置不支援则 fallback 到 `default_input_config()`。`build_input_stream()` 需依 `sample_format`（`f32`/`i16`/`u16` 等）分派对应 callback。`Stream` drop 时自动释放装置 — 天然 lazy init
- **`hound` WAV 编码**：`WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: Int }`。录音期间 PCM 写入 `Vec<i16>`，停止时用 `WavWriter::new(Cursor::new(Vec))` 编码到记忆体（不落磁碟）
- **`reqwest` 呼叫 Groq API**：已在依赖树（`tauri-plugin-http` 间接引入），加 `reqwest = { version = "0.12", features = ["multipart"] }`。用 `multipart::Form` 建构 FormData
- **FFT 频率分析**：`rustfft` 做 64-point FFT（对应现有 `fftSize: 64`），取 magnitude 转 dB。只取 6 bin（index 9,4,1,2,6,12），normalize 后推送
- **Tauri Event 推送波形**：`app.emit("audio:waveform", WaveformPayload { levels: [f32; 6] })` 每 ~16ms 推送。前端 `useAudioWaveform` 改为 `listen("audio:waveform")` + `useRafFn` lerp
- **API Key 传递**：`invoke("transcribe_audio", { apiKey, vocabularyTermList, modelId })` 时传入，Rust 不持久化
- **lazy init**：`start_recording` Command 开启 `cpal` stream → `stop_recording` 关闭 stream + 编码 WAV → `transcribe_audio` 送 Groq API
- **录音资料传递**：`stop_recording` 将 WAV buffer 暂存在 Rust State，`transcribe_audio` 从 State 取用并清空，避免大型 binary 经过 IPC
- **`isSilenceOrHallucination` 保留前端**：Rust 回传 `rawText` + `noSpeechProbability`，前端现有逻辑判断

## Implementation Plan

### Tasks

- [x] Task 1: 新增 Rust 依赖
  - File: `src-tauri/Cargo.toml`
  - Action: 在 `[dependencies]` 新增 `cpal`、`hound`、`rustfft`、`reqwest`（含 multipart feature）
  - 实作细节:
    ```toml
    cpal = "0.15"
    hound = "3.5"
    rustfft = "6"
    reqwest = { version = "0.12", features = ["multipart", "json"] }
    ```
  - Notes: `reqwest` 已在依赖树中（`tauri-plugin-http` 间接引入），显式加入以使用 `multipart` feature。`json` feature 用于解析 Groq API 回应

- [x] Task 2: 建立 `audio_recorder` Rust plugin
  - File: `src-tauri/src/plugins/audio_recorder.rs`（新建）
  - Action: 实作 Rust 侧录音模组
  - 实作细节:
    - **State 结构**：
      ```rust
      pub struct AudioRecorderState {
          inner: Mutex<Option<RecordingSession>>,
          wav_buffer: Mutex<Option<Vec<u8>>>,
      }

      struct RecordingSession {
          stream: cpal::Stream,
          samples: Arc<Mutex<Vec<i16>>>,
          sample_rate: u32,
          app_handle: AppHandle,
      }
      ```
    - **`start_recording` Command**：
      1. 取得 `Mutex` lock，检查是否已在录音（幂等 guard）
      2. `cpal::default_host().default_input_device()` 取得麦克风
      3. 先从 `supported_input_configs()` 选择装置真的支援的设定；优先 16kHz，否则 fallback 到 `default_input_config()`
      4. `device.build_input_stream()` 依 `sample_format` 分派对应 callback：
         - 将 PCM samples（f32 → i16 转换）写入 `Arc<Mutex<Vec<i16>>>`
         - 每 ~16ms 对最近的 64 个 sample 做 FFT，计算 6 个 bin 的 dB 值
         - `app.emit("audio:waveform", WaveformPayload { levels })` 推送给前端
      5. `stream.play()` 开始录音
      6. 将 `RecordingSession` 存入 State
    - **`stop_recording` Command**：
      1. 从 State 取出 `RecordingSession`（take → drop `Stream` → 麦克风释放）
      2. 取出 `samples: Vec<i16>`
      3. 用 `hound::WavWriter::new(Cursor::new(Vec::new()), WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: Int })` 编码 WAV
      4. 将 WAV `Vec<u8>` 存入 `wav_buffer` State
      5. 回传 `StopRecordingResult { recording_duration_ms: f64 }` 给前端
    - **Error 型别**：`AudioRecorderError` enum，实作 `thiserror::Error` + `serde::Serialize`（同 `ClipboardError` 模式）
  - Notes:
    - `cpal::Stream` 不是 `Send`，需要在建立 stream 的同一 thread 持有。使用 dedicated thread + channel 或 `Arc` 包装
    - FFT 计算在 audio callback 中执行，不要 block — 使用 ring buffer 或 atomic 传递 sample 到另一 thread
    - `f32 → i16` 转换：`(sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16`

- [x] Task 3: 实作 FFT 波形分析
  - File: `src-tauri/src/plugins/audio_recorder.rs`（同 Task 2 档案）
  - Action: 在 audio callback 中计算频率资料并推送 Tauri Event
  - 实作细节:
    - 维护一个 64-sample 的 ring buffer
    - 当 buffer 满时（每 64 samples ≈ 4ms @ 16kHz），执行一次 FFT：
      1. `rustfft::FftPlanner::new().plan_fft_forward(64)`
      2. 将 i16 samples 转为 `Complex<f32>`
      3. 计算 magnitude → dB：`20.0 * log10(magnitude / fft_size as f32)`
      4. 从 FFT 结果取 6 个 bin（index 1,2,4,6,9,12）
      5. dB normalize：`(dB - (-100)) / ((-20) - (-100))` clamp 到 [0, 1]
    - 限制推送频率：每 16ms 最多推送一次（`Instant::elapsed()`）
    - **Event payload**:
      ```rust
      #[derive(Clone, serde::Serialize)]
      struct WaveformPayload {
          levels: [f32; 6],
      }
      ```
    - `app.emit("audio:waveform", payload)`
  - Notes: 前端 `FREQUENCY_BIN_PICK_INDEX_LIST = [9, 4, 1, 2, 6, 12]` — 注意顺序是前端显示顺序，不是 bin index 大小顺序

- [x] Task 4: 建立 `transcription` Rust plugin
  - File: `src-tauri/src/plugins/transcription.rs`（新建）
  - Action: 实作 Groq Whisper API 呼叫
  - 实作细节:
    - **`transcribe_audio` Command**：
      ```rust
      #[command]
      pub async fn transcribe_audio(
          state: State<'_, AudioRecorderState>,
          api_key: String,
          vocabulary_term_list: Option<Vec<String>>,
          model_id: Option<String>,
      ) -> Result<TranscriptionResult, TranscriptionError>
      ```
    - 流程：
      1. 从 `state.wav_buffer` 取出 WAV data（`take()`），若无资料则回传错误
      2. 检查 WAV 大小 ≥ 1000 bytes（对应现有 `MINIMUM_AUDIO_BLOB_SIZE`）
      3. 建构 `reqwest::multipart::Form`：
         - `file`: `Part::bytes(wav_data).file_name("recording.wav").mime_str("audio/wav")`
         - `model`: `model_id.unwrap_or("whisper-large-v3")`
         - `language`: `"zh"`
         - `response_format`: `"verbose_json"`
         - `prompt`（可选）：`format_whisper_prompt(&vocabulary_term_list)`（最多 50 个 term）
      4. `reqwest::Client::new().post(GROQ_API_URL).bearer_auth(&api_key).multipart(form).send().await`
      5. 解析 JSON 回应，提取 `text`、`segments[].no_speech_prob`
      6. 回传 `TranscriptionResult { raw_text, transcription_duration_ms, no_speech_probability }`
    - **常数**（从 `transcriber.ts` 搬过来）：
      ```rust
      const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
      const TRANSCRIPTION_LANGUAGE: &str = "zh";
      const MAX_WHISPER_PROMPT_TERMS: usize = 50;
      const MINIMUM_AUDIO_SIZE: usize = 1000;
      const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
      ```
    - **`format_whisper_prompt()`**：
      ```rust
      fn format_whisper_prompt(term_list: &[String]) -> String {
          let terms: Vec<&str> = term_list.iter().take(MAX_WHISPER_PROMPT_TERMS).map(|s| s.as_str()).collect();
          format!("Important Vocabulary: {}", terms.join(", "))
      }
      ```
    - **回传型别**（Tauri Command 需 Serialize）：
      ```rust
      #[derive(serde::Serialize)]
      #[serde(rename_all = "camelCase")]
      pub struct TranscriptionResult {
          pub raw_text: String,
          pub transcription_duration_ms: f64,
          pub no_speech_probability: f64,
      }
      ```
    - **Groq API 回应结构**（Deserialize）：
      ```rust
      #[derive(serde::Deserialize)]
      struct WhisperVerboseResponse {
          text: String,
          segments: Vec<WhisperSegment>,
      }
      #[derive(serde::Deserialize)]
      struct WhisperSegment {
          no_speech_prob: f64,
      }
      ```
  - Notes: `reqwest` 的 async 需在 Tauri Command 中使用 `async fn`。Tauri v2 支援 async commands

- [x] Task 5: 注册 Rust plugins 和 Commands
  - File: `src-tauri/src/plugins/mod.rs`, `src-tauri/src/lib.rs`
  - Action:
    1. `mod.rs` 新增：`pub mod audio_recorder;` 和 `pub mod transcription;`
    2. `lib.rs` `setup()` 新增：`app.manage(plugins::audio_recorder::AudioRecorderState::new());`
    3. `lib.rs` `invoke_handler` 新增：
       ```rust
       plugins::audio_recorder::start_recording,
       plugins::audio_recorder::stop_recording,
       plugins::transcription::transcribe_audio,
       ```
  - Notes: 遵循现有的 `audio_control` 注册模式

- [x] Task 6: 更新前端型别定义
  - File: `src/types/audio.ts`
  - Action: 替换 `AudioAnalyserHandle` 为波形 level 相关型别
  - 实作细节:
    ```typescript
    export interface WaveformPayload {
      levels: number[];
    }

    export interface StopRecordingResult {
      recordingDurationMs: number;
    }

    export interface TranscriptionResult {
      rawText: string;
      transcriptionDurationMs: number;
      noSpeechProbability: number;
    }
    ```
  - Notes: 移除 `AudioAnalyserHandle`、`AudioAnalyserConfig`、`DEFAULT_ANALYSER_CONFIG`

- [x] Task 7: 重构 `useAudioWaveform` composable
  - File: `src/composables/useAudioWaveform.ts`
  - Action: 从 `AudioAnalyserHandle.getFrequencyData()` pull 模式改为 Tauri Event push 模式
  - 实作细节:
    - 移除：`analyserHandle` 参数、`useRafFn` 中的 `getFrequencyData()` 呼叫
    - 新增：`listen("audio:waveform")` 监听 Rust 推送的 `WaveformPayload`
    - 保留：`useRafFn` 用于 lerp 平滑动画（从 Event 收到的 target levels → lerp → 实际显示 levels）
    - 签名变更：
      ```typescript
      // Before: export function useAudioWaveform(analyserHandle: Ref<AudioAnalyserHandle | null>)
      // After:
      export function useAudioWaveform()
      ```
    - 新增 `startListening()` / `stopListening()` 控制 Event 监听的生命周期
    - 避免 listener 晚到时残留，确保快速切换状态时不会留下多余监听
    - `stopListening()` 时 unlisten + 将 target levels 归零
  - Notes: lerp 常数（`LERP_SPEED = 0.25`、`DB_FLOOR`、`DB_CEILING`）不再需要 — Rust 侧已做 normalize，前端只做 lerp

- [x] Task 8: 重构 `useVoiceFlowStore`
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 移除 `recorder.ts` 和 `transcriber.ts` 的 import 和呼叫，改用 Tauri Commands
  - 实作细节:
    - **移除 import**：
      ```
      initializeMicrophone, startRecording, stopRecording,
      createAudioAnalyser, destroyAudioAnalyser
      ```
      和 `transcribeAudio` from `../lib/transcriber`
    - **移除 state**：`analyserHandle: ref<AudioAnalyserHandle | null>(null)` — 波形动画改由 `useAudioWaveform` 内部管理
    - **移除 return**：`analyserHandle` 从 store 的 return 物件中移除
    - **`handleStartRecording()` 改为**：
      ```typescript
      async function handleStartRecording() {
        if (isRecording.value) return;
        isRecording.value = true;
        lastWasModified.value = null;
        recordingStartTime = performance.now();
        try {
          await Promise.all([
            muteSystemAudioIfEnabled(),
            invoke("start_recording"),
          ]);
          startElapsedTimer();
          transitionTo("recording", RECORDING_MESSAGE);
          writeInfoLog("useVoiceFlowStore: recording started");
        } catch (error) {
          const errorMessage = getMicrophoneErrorMessage(error);
          failRecordingFlow(errorMessage, `...`, error);
        }
      }
      ```
    - **`handleStopRecording()` 改为**：
      1. `const result = await invoke<StopRecordingResult>("stop_recording")` — 停止录音 + 取得 WAV
      2. 用 `result.recordingDurationMs` 检查最短录音时间
      3. `transitionTo("transcribing", ...)`
      4. `const transcription = await invoke<TranscriptionResult>("transcribe_audio", { apiKey, vocabularyTermList, modelId })` — Rust 呼叫 Groq API
      5. 后续 `isSilenceOrHallucination()`、enhancement、paste 逻辑不变
    - **`initialize()` 改为**：移除 `try { await initializeMicrophone(); ... } catch { ... }` 区块 — Rust 侧不需要启动时初始化
    - **`cleanup()` 改为**：移除 `destroyAudioAnalyser()` 呼叫 — 前端不再管理音讯资源
    - **`failRecordingFlow()` 中**：不需要呼叫 `restoreSystemAudio()` 以外的清理（Rust `Stream` 已在 `stop_recording` 中 drop）
  - Notes:
    - `audioBlob` 不再存在 — Rust 内部管理 WAV buffer
    - `transcribeAudio()` 的签名变了 — 不再传 `audioBlob`，改为 Rust Command 直接从内部 State 取 WAV
    - `recordingDurationMs` 改为从 Rust `stop_recording` 回传值取得；此值刻意包含麦克风/装置启动成本，作为「录音时间太短」UX 缓冲的一部分

- [x] Task 9: 更新 `NotchHud.vue` 和 `App.vue`
  - File: `src/components/NotchHud.vue`, `src/App.vue`
  - Action: 移除 `analyserHandle` prop，改为 composable 内部管理
  - 实作细节:
    - **`NotchHud.vue`**：
      - 移除 `analyserHandle` prop 定义
      - 移除 `const analyserHandleRef = toRef(props, "analyserHandle")`
      - 改为直接呼叫 `const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } = useAudioWaveform()`（无参数）
      - 其余 waveform 显示逻辑不变（`barStyleList` computed 用 `waveformLevelList`）
    - **`App.vue`**：
      - 移除 `NotchHud` 上的 `:analyser-handle="voiceFlowStore.analyserHandle"` prop
  - Notes: `useAudioWaveform` 的 `startWaveformAnimation()` 和 `stopWaveformAnimation()` 语义不变，但内部改为控制 Event listener + lerp animation

- [x] Task 10: 删除前端录音/转录模组
  - File: `src/lib/recorder.ts`, `src/lib/transcriber.ts`, `tests/unit/recorder.test.ts`
  - Action: 删除这三个档案
  - Notes:
    - 确认无其他档案 import 这些模组（Task 8 已移除 store 的 import）
    - `transcriber.ts` 中的 `TranscriptionResult` 型别已在 Task 6 于 `types/audio.ts` 重新定义
    - `transcriber.ts` 中的 `formatWhisperPrompt()` 已在 Task 4 于 Rust 重新实作
    - `SettingsView.vue` 中有 `startRecording`/`stopRecording` 函式名称，但那是快捷键录制的本地函式（与 `recorder.ts` 无关），不受影响

- [x] Task 11: 重构前端测试
  - File: `tests/unit/use-voice-flow-store.test.ts`
  - Action: 将 mock 从 `recorder.ts`/`transcriber.ts` 改为 mock `invoke()`/`listen()`
  - 实作细节:
    - **移除 mock**：
      - `mockInitializeMicrophone`, `mockStartRecording`, `mockStopRecording`, `mockReleaseMicrophone`
      - `mockTranscribeAudio`
      - `vi.mock("../../src/lib/recorder", ...)` 整个 mock block
      - `vi.mock("../../src/lib/transcriber", ...)` 整个 mock block
    - **新增 mock**：
      - `mockInvoke` 改为按 command 名称分派：
        ```typescript
        mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
          switch (cmd) {
            case "start_recording": return undefined;
            case "stop_recording": return { recordingDurationMs: 2500 };
            case "transcribe_audio": return {
              rawText: "测试转录",
              transcriptionDurationMs: 320,
              noSpeechProbability: 0.01,
            };
            // ... 其他既有 commands (debug_log, paste_text 等) ...
            default: return undefined;
          }
        });
        ```
    - **测试案例调整**：
      - `initialize` 测试：移除「应初始化麦克风」的 assertion
      - `handleStartRecording` 测试：改为 assert `mockInvoke` 被呼叫 with `"start_recording"`
      - `handleStopRecording` 测试：改为 assert `mockInvoke` 被呼叫 with `"stop_recording"` 和 `"transcribe_audio"`
      - 错误处理测试：mock `invoke("start_recording")` reject
  - Notes: 测试的核心逻辑（状态转换、mute/restore、paste、enhancement）不变，只是 mock 的对象从前端模组改为 Tauri IPC

- [x] Task 12: 更新 Tauri 前端权限设定
  - File: `src-tauri/capabilities/default.json`（如存在）
  - Action: 确认 Tauri v2 的 capability 设定允许新增的 Commands 被前端呼叫
  - Notes: Tauri v2 的 capability system 可能需要在 `default.json` 中加入新 command 的权限。检查现有设定是否用 wildcard 或需要明确列出

### Acceptance Criteria

- [x] AC 1: Given 应用刚启动且使用者未按快捷键, when 检视 macOS 状态列, then 不应出现 SayIt 的麦克风图示
- [x] AC 2: Given 应用已启动且处于 idle 状态, when 使用者按下快捷键, then 麦克风图示出现且 HUD 显示录音状态（含波形动画）
- [x] AC 3: Given 正在录音中, when 使用者放开快捷键且转录/贴上成功, then 麦克风图示在停止录音后消失、转录结果正确贴上
- [x] AC 4: Given 正在录音中, when 录音流程发生错误（如 API key 缺失、转录失败）, then 麦克风图示消失且 HUD 显示错误讯息
- [x] AC 5: Given 使用者刚完成一次录音, when 再次按下快捷键, then 麦克风重新启动且录音正常运作（连续使用不中断）
- [x] AC 6: Given 使用者体感可接受的录音时间仍不足以覆盖装置启动与收音成本, when 系统判定为太短, then HUD 显示「录音时间太短」且麦克风图示消失
- [x] AC 7: Given 录音中, when HUD 显示波形动画, then 波形跟随音讯输入即时变化（视觉效果与迁移前一致）
- [x] AC 8: Given 使用者设定了自订词汇, when 录音并转录, then Groq API 收到的 prompt 包含词汇列表（与迁移前行为一致）
- [x] AC 9: Given Groq API 回传 `no_speech_prob` 高于阈值, when 前端判断为静默, then HUD 显示「未侦测到语音」（静默侦测逻辑不变）
- [x] AC 10: Given AI 整理（enhancement）启用, when 转录完成, then 整理流程正常运作（不受 Rust 迁移影响）

## Additional Context

### Dependencies

**新增 Rust crate：**
- `cpal = "0.15"` — 跨平台音讯输入
- `hound = "3.5"` — WAV 编码
- `rustfft = "6"` — FFT 频率分析
- `reqwest = { version = "0.12", features = ["multipart", "json"] }` — HTTP multipart（已在依赖树，显式加入以使用 multipart feature）

**移除前端依赖：** 无（`getUserMedia` / `MediaRecorder` 是浏览器原生 API，不需移除套件）

### Testing Strategy

**Rust 单元测试：**
- WAV 编码正确性：已知 PCM samples → 验证 WAV header + data 长度
- `format_whisper_prompt()`：空列表、超过 50 个 term、正常列表
- FFT normalize：已知 dB 值 → 预期 [0,1] 范围
- `TranscriptionResult` 序列化：确认 camelCase rename

**前端单元测试：**
- `useVoiceFlowStore`：mock `invoke()` 按 command 分派，测试状态转换、错误处理、短录音 UX 路径
- `NotchHud` / `useAudioWaveform`：mock `listen("audio:waveform")`，验证 listener 晚到时不残留、波形生命周期正确
- 移除 `recorder.test.ts`（379 行）

**手动测试：**
1. 启动 app → 确认状态列无麦克风图示
2. 按快捷键 → 确认图示出现 → 放开 → 确认图示消失
3. 连续录音 3 次 → 确认稳定性
4. 波形动画正常显示且跟随音讯
5. 转录结果正确（含词汇注入）
6. 极短按压（<300ms）→ 确认「录音时间太短」
7. 错误情境（无 API key、API 失败）→ 确认错误讯息正确

### Notes

- **`cpal::Stream` 非 `Send` 问题**：`cpal::Stream` 在某些平台不是 `Send`，不能直接存入 `Mutex<Option<Stream>>`。解法：在 dedicated OS thread 上建立 stream，用 `mpsc::channel` 控制 start/stop，stream 的生命周期由该 thread 管理
- **FFT 效能**：64-point FFT 在 audio callback 中执行，计算量极小（~几十微秒），不会影响录音品质
- **WAV 大小**：16kHz mono 16-bit 的 WAV，每秒 32KB。5 秒录音 ≈ 160KB + 44 bytes header，Groq API 上限 25MB，完全足够
- **Groq API timeout**：现有前端没有设定 timeout，Rust 侧建议加上 30 秒 timeout（`reqwest::Client::builder().timeout(Duration::from_secs(30))`）
- **`enhancer.ts` 保留前端**：AI 整理仍使用前端的 `@tauri-apps/plugin-http` fetch 呼叫 Groq LLM API，不受此迁移影响
- **Windows 预留**：`audio_recorder.rs` 的 `cpal` 部分是跨平台的，Windows 无需额外 `cfg` 条件。`transcription.rs` 也是纯 Rust HTTP，跨平台。但 spec 标记 Windows 为 Out of Scope 以控制测试范围
- **首次使用麦克风权限**：macOS 会在 `cpal` 首次存取麦克风时弹出系统权限对话框。`start_recording` Command 的 catch 区块需能处理权限被拒绝的情况（`cpal::BuildStreamError`）
- **短录音 UX 缓冲**：`recordingDurationMs` 刻意包含麦克风与装置启动时间，目的是把硬体暖机成本包进使用者体感；「录音时间太短」不只是字面上的发声时间不足，也是启动成本未被覆盖的 UX 讯号
