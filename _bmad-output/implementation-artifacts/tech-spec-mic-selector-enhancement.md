---
title: '麦克风选择器改进：预设装置名称显示 + 音量预览条'
slug: 'mic-selector-enhancement'
created: '2026-03-27 10:50:12'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Vue 3 (Composition API)', 'Rust', 'cpal 0.15', 'shadcn-vue (new-york)', 'lucide-vue-next', '@vueuse/core']
files_to_modify:
  - 'src-tauri/src/plugins/audio_recorder.rs'
  - 'src-tauri/src/lib.rs'
  - 'src/views/SettingsView.vue'
  - 'src/composables/useTauriEvents.ts'
  - 'src/types/audio.ts'
  - 'src/i18n/locales/zh-TW.json'
  - 'src/i18n/locales/en.json'
  - 'src/i18n/locales/zh-CN.json'
  - 'src/i18n/locales/ja.json'
  - 'src/i18n/locales/ko.json'
files_to_create:
  - 'src/composables/useAudioPreview.ts'
code_patterns:
  - 'Tauri command: #[command] fn → invoke_handler 注册 → invoke<T>() 呼叫'
  - 'State: pub struct → app.manage() → State<T> 注入'
  - 'Event: emit(name, payload) → listenToEvent(name, callback)'
  - 'Composable: useX() → ref + lifecycle + onUnmounted cleanup'
  - 'LERP animation: useRafFn + lerp(current, target, speed)'
  - 'Device selection: device_name.is_empty() → default_input_device()'
  - 'Shutdown: state.shutdown() in RunEvent::Exit handler'
test_patterns:
  - 'Rust: #[cfg(test)] mod tests in same file'
  - 'Frontend: tests/unit/*.test.ts with vitest'
adversarial_review: 'completed — 12 findings, 11 addressed (F12 noise)'
---

# Tech-Spec: 麦克风选择器改进：预设装置名称显示 + 音量预览条

**Created:** 2026-03-27 10:50:12

## Overview

### Problem Statement

使用者在设定页面选择麦克风时，「系统预设」选项不显示实际对应的装置名称，无法判断目前使用的是内建麦克风还是蓝牙耳机。此外，选择麦克风后没有即时回馈，无法确认选中的麦克风是否有在收音。这导致 GitHub #18、#19 等使用者回报「未侦测到语音」的问题。

### Solution

1. 在「系统预设」选项后方括号标示实际使用的装置名称（如「系统预设（MacBook Pro的麦克风）」）
2. 在麦克风下拉选单下方显示即时音量条，让使用者确认选中装置有在收音

### Scope

**In Scope:**
- 系统预设选项显示实际装置名称
- 当前选中装置的即时音量预览条（单一 RMS level bar）
- 设定页开启时自动启动预览、离开时停止
- 切换装置时重新启动预览
- 录音进行中自动停止预览（避免冲突）

**Out of Scope:**
- 全装置同时音量监测
- 下拉选单内每个选项的音量条
- 音量调整功能
- 分段录音/音讯压缩（另案处理）

## Context for Development

### Codebase Patterns

#### Rust 端架构

- **装置列举** — `audio_recorder.rs:123-141` `list_audio_input_devices()`: 用 `cpal::default_host().input_devices()` 迭代所有输入装置，回传 `Vec<AudioInputDeviceInfo { name }>`
- **预设装置** — `audio_recorder.rs:287-320`: `host.default_input_device()` 取得预设，`.name().ok()` 取名称
- **装置选择** — `device_name.is_empty()` → 用预设；否则先比对预设名称，不符再 `input_devices().find()`
- **输入格式** — `audio_recorder.rs:382-424` `determine_input_config()`: 优先 16kHz mono，不支援则 fallback 到装置预设。此函式为 `fn`（非 pub），preview code 放在同档案内可直接使用
- **Stream 建立** — `audio_recorder.rs:426-556` `build_input_stream()` → `build_typed_input_stream<T>()`: 泛型处理所有 sample format，callback 内做 mono mix + FFT waveform emit
- **cpal macOS Arc cycle workaround** — `audio_recorder.rs:281-319`: 优先使用 `default_input_device()` 路径避免 Arc cycle；stream 结束时必须 `stream.pause()` before drop（L370-378）。**preview thread 必须遵循相同 workaround**
- **State 模式** — `AudioRecorderState { recording: Mutex<Option<RecordingHandle>> }` + `shutdown()` method
- **Graceful shutdown** — `lib.rs:518-564` `RunEvent::Exit` handler 依序 shutdown 各 state

#### 前端架构

- **SettingsView 麦克风 UI** — `SettingsView.vue:1306-1358`: shadcn-vue `Select` + `_default` 特殊值 + `RefreshCw` 按钮
- **装置列表载入** — `SettingsView.vue:639-646` `loadAudioInputDeviceList()`: `invoke<AudioInputDeviceInfo[]>("list_audio_input_devices")`
- **生命周期** — `onMounted:681` 呼叫 `loadAudioInputDeviceList()`；`onBeforeUnmount:704` 清理 timers
- **Waveform composable** — `useAudioWaveform.ts`: `useRafFn` + LERP(0.25) + `listenToEvent(AUDIO_WAVEFORM)`，6 bar 动画
- **事件常量** — `useTauriEvents.ts:19` `AUDIO_WAVEFORM = "audio:waveform"`
- **型别** — `audio.ts`: `AudioInputDeviceInfo { name }`, `WaveformPayload { levels: number[] }`

### Files to Reference

| File | Purpose | Key Lines |
| ---- | ------- | --------- |
| `src-tauri/src/plugins/audio_recorder.rs` | 装置列举、录音、waveform | L118-141, L274-380, L382-424, L426-556 |
| `src-tauri/src/lib.rs` | command/state 注册、shutdown | L413-442, L444-451, L518-564 |
| `src/views/SettingsView.vue` | 设定 UI | L639-679, L681-702, L704-720, L1306-1358 |
| `src/composables/useAudioWaveform.ts` | LERP 动画参考 | 完整档案 |
| `src/composables/useTauriEvents.ts` | 事件常量 | L19 |
| `src/types/audio.ts` | TS 型别 | L1-13 |
| `src/i18n/locales/zh-TW.json` | 繁中翻译 | L124-130 audioInput section |

### Technical Decisions

1. **预设装置名称用独立 command** — 新增 `get_default_input_device_name` 而非改 `AudioInputDeviceInfo`，因为预设装置可能随时改变，需要独立查询
2. **音量预览独立 state** — `AudioPreviewState` 与 `AudioRecorderState` 完全隔离，避免预览干扰录音
3. **RMS 而非 FFT** — 预览只需单一音量值，不需 6-bar 频谱，计算更轻量
4. **Rust 端自动停止** — `start_recording` 呼叫时自动 stop preview，不需跨视窗协调
5. **30ms emit 间隔** — 比录音的 16ms 稍宽松，约 33fps，足以呈现流畅音量变化且不会在 RAF 帧间产生可见延迟
6. **preview code 在 `audio_recorder.rs` 同档案** — 直接使用 `determine_input_config`、`build_typed_input_stream` 等 private fn，无需改可见性或新建 module
7. **preview stream 不储存 samples** — 只在 callback 中计算 RMS 并 emit，不累积记忆体
8. **preview startup 需 ready 同步** — 使用 `mpsc::channel` 回报 stream 建立成功/失败，避免与 `start_recording` 的 race condition
9. **dB 对数映射** — RMS → dB（-60 to -20 dB range），AirPods Pro 等低增益麦克风的语音才有足够的视觉反馈
10. **共用 `select_input_device` helper** — recording/preview thread 共用装置选择逻辑（含 cpal Arc cycle workaround）
11. **`PreviewHandle` 含 JoinHandle** — `stop_audio_preview_inner` 会 join thread，确保装置完全释放后再开始录音
12. **前端 re-entrancy guard** — `useAudioPreview` 用 `startRequestId` 防止快速切换装置时的 listener 泄漏
13. **start_recording 锁定顺序** — 先取 recording lock 再停 preview，消除 TOCTOU race window

## Implementation Plan

### Tasks

- [x] Task 1: 新增 `get_default_input_device_name` Rust command
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action: 在 `list_audio_input_devices` command 后新增：
    ```rust
    #[command]
    pub fn get_default_input_device_name() -> Option<String> {
        let host = cpal::default_host();
        let result = host.default_input_device().and_then(|d| {
            d.name().map_err(|e| {
                eprintln!("[audio-recorder] Failed to get default device name: {}", e);
                e
            }).ok()
        });
        println!("[audio-recorder] Default input device: {:?}", result);
        result
    }
    ```
  - Notes: `device.name()` 的 `Err` 会 log 后转为 `None`，前端无法区分「无装置」vs「读名称失败」但两者 UI 行为一致（fallback 显示「系统预设」）

- [x] Task 2: 新增 `AudioPreviewState` + preview commands
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action:
    1. 新增 payload：
       ```rust
       #[derive(Clone, serde::Serialize)]
       pub struct AudioPreviewLevelPayload {
           level: f32,
       }
       ```
    2. 新增 state：
       ```rust
       pub struct AudioPreviewState {
           should_stop: Mutex<Option<Arc<AtomicBool>>>,
       }
       impl AudioPreviewState {
           pub fn new() -> Self { Self { should_stop: Mutex::new(None) } }
           pub fn shutdown(&self) {
               if let Ok(guard) = self.should_stop.lock() {
                   if let Some(flag) = guard.as_ref() {
                       flag.store(true, Ordering::SeqCst);
                   }
               }
           }
       }
       ```
    3. 新增 `start_audio_preview(app, preview_state, device_name)` command：
       - 先呼叫 `stop_audio_preview_inner` 停止旧 preview
       - Spawn `run_preview_thread`
       - 用 `mpsc::channel` 等待 stream ready signal（成功回 `Ok(())`，失败回 `Err`）
       - 回传 `Result<(), String>`
    4. 新增 `stop_audio_preview(state)` command
    5. 新增 `fn stop_audio_preview_inner(state: &AudioPreviewState)` 私有 helper

- [x] Task 3: 实作 `run_preview_thread`
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action: 新增私有函式 `fn run_preview_thread(app: AppHandle, should_stop: Arc<AtomicBool>, device_name: String, ready_tx: mpsc::Sender<Result<(), String>>)`
    1. **装置选择**：与 `run_recording_thread` L287-320 相同逻辑：
       - `device_name.is_empty()` → `host.default_input_device()`
       - 否则先比对预设名称，符合用 `default_input_device()`（macOS Arc cycle workaround）
       - 不符再 `input_devices().find()`，找不到 fallback 到预设
    2. **输入格式**：呼叫 `determine_input_config(&device)`
    3. **Stream 建立**：用与 `build_input_stream` 相同的 sample format match，但 callback 更简单：
       - Mono mix（与现有相同）
       - 累积 `sum_squares` 和 `sample_count`（用 `Arc<Mutex<(f64, usize)>>` 或 `AtomicU64`）
       - 不存 samples、不做 FFT
    4. **Ready signal**：stream 建立成功后 `ready_tx.send(Ok(()))`，失败 `ready_tx.send(Err(...))`
    5. **主回圈**：每 30ms：
       - 读取累积的 `sum_squares` / `sample_count`
       - 计算 RMS：`sqrt(sum_squares / count)` → clamp(0.0, 1.0)
       - 重置累积值
       - `app.emit("audio:preview-level", AudioPreviewLevelPayload { level: rms })`
       - 检查 `should_stop`
    6. **清理**：`stream.pause()` → drop stream（遵循 cpal macOS workaround L370-378）

- [x] Task 4: `start_recording` 自动停止 preview
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action: 在 `start_recording` command 开头（`guard.is_some()` 检查前），加入：
    ```rust
    // 停止音量预览，避免两个 stream 冲突
    if let Some(preview_state) = app.try_state::<AudioPreviewState>() {
        stop_audio_preview_inner(&preview_state);
        // 等待 preview thread 结束
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    ```
  - Notes: 用 `app.try_state` 而非 `State<T>` 参数注入，避免改动 `start_recording` 的函式签名。加 100ms sleep 确保 preview stream 完全释放装置

- [x] Task 5: 注册 commands + state + shutdown
  - File: `src-tauri/src/lib.rs`
  - Action:
    1. `invoke_handler`（L413-442）新增：
       ```
       plugins::audio_recorder::get_default_input_device_name,
       plugins::audio_recorder::start_audio_preview,
       plugins::audio_recorder::stop_audio_preview,
       ```
    2. `setup`（L444-451）新增：`app.manage(plugins::audio_recorder::AudioPreviewState::new());`
    3. `RunEvent::Exit` — **preview shutdown 必须在 recorder shutdown 之前**（避免两者同时释放装置）：
       ```rust
       // 2.5 停止音量预览（在 cpal 录音之前）
       if let Some(state) = app_handle.try_state::<plugins::audio_recorder::AudioPreviewState>() {
           state.shutdown();
       }
       // 2. 停止 cpal 录音（join thread, drop AudioUnit）
       if let Some(state) = app_handle.try_state::<plugins::audio_recorder::AudioRecorderState>() {
           state.shutdown();
       }
       ```

- [x] Task 6: 新增前端事件常量 + 型别
  - File: `src/composables/useTauriEvents.ts`
  - Action: 新增 `export const AUDIO_PREVIEW_LEVEL = "audio:preview-level" as const;`
  - File: `src/types/audio.ts`
  - Action: 新增 `export interface AudioPreviewLevelPayload { level: number; }`

- [x] Task 7: 建立 `useAudioPreview.ts` composable
  - File: `src/composables/useAudioPreview.ts`（新建）
  - Action: 参考 `useAudioWaveform.ts` 的模式，建立：
    ```typescript
    import { ref, onUnmounted } from "vue";
    import { useRafFn } from "@vueuse/core";
    import type { UnlistenFn } from "@tauri-apps/api/event";
    import { invoke } from "@tauri-apps/api/core";
    import { listenToEvent, AUDIO_PREVIEW_LEVEL } from "./useTauriEvents";
    import type { AudioPreviewLevelPayload } from "../types/audio";

    const LERP_SPEED = 0.2;

    function lerp(current: number, target: number, speed: number): number {
      return current + (target - current) * speed;
    }

    export function useAudioPreview() {
      const previewLevel = ref(0);
      const isPreviewActive = ref(false);
      let targetLevel = 0;
      let unlistenPreview: UnlistenFn | null = null;

      const { pause, resume } = useRafFn(() => {
        previewLevel.value = lerp(previewLevel.value, targetLevel, LERP_SPEED);
      }, { immediate: false });

      async function startPreview(deviceName: string): Promise<void> {
        await stopPreview();
        try {
          await invoke("start_audio_preview", { deviceName });
          unlistenPreview = await listenToEvent<AudioPreviewLevelPayload>(
            AUDIO_PREVIEW_LEVEL,
            (event) => { targetLevel = event.payload.level; },
          );
          isPreviewActive.value = true;
          resume();
        } catch (err) {
          console.error("[useAudioPreview] start failed:", err);
        }
      }

      async function stopPreview(): Promise<void> {
        isPreviewActive.value = false;
        pause();
        targetLevel = 0;
        previewLevel.value = 0;
        if (unlistenPreview) {
          unlistenPreview();
          unlistenPreview = null;
        }
        try {
          await invoke("stop_audio_preview");
        } catch { /* ignore — preview may not be running */ }
      }

      onUnmounted(() => { void stopPreview(); });

      return { previewLevel, isPreviewActive, startPreview, stopPreview };
    }
    ```
  - Notes: LERP speed 0.2（介于 waveform 0.25 和更平滑的 0.15 之间，经验证在 30ms emit 间隔下视觉流畅）

- [x] Task 8: 新增 i18n `systemDefaultWithDevice` key
  - Files: 5 个 locale JSON
  - Action: 在 `settings.audioInput` section 内，`systemDefault` key 后新增：
    | Locale | Key | Value |
    |--------|-----|-------|
    | zh-TW | `systemDefaultWithDevice` | `系统预设（{device}）` |
    | en | `systemDefaultWithDevice` | `System Default ({device})` |
    | zh-CN | `systemDefaultWithDevice` | `系统默认（{device}）` |
    | ja | `systemDefaultWithDevice` | `システムデフォルト（{device}）` |
    | ko | `systemDefaultWithDevice` | `시스템 기본값 ({device})` |
  - Notes: placeholder 名称统一用 `{device}`；长装置名称由 SelectTrigger 自动 truncate（shadcn-vue Select 内建 `overflow-hidden text-ellipsis`）

- [x] Task 9: 更新 `SettingsView.vue` — 预设装置名称 + 音量条
  - File: `src/views/SettingsView.vue`
  - Action:
    1. **Import**: 新增 `import { useAudioPreview } from "../composables/useAudioPreview";`、`Mic` from `lucide-vue-next`
    2. **Script 变数**:
       - `const defaultInputDeviceName = ref<string | null>(null);`
       - `const { previewLevel, isPreviewActive, startPreview, stopPreview } = useAudioPreview();`
    3. **`loadAudioInputDeviceList()`** 同时呼叫：
       ```typescript
       defaultInputDeviceName.value = await invoke<string | null>("get_default_input_device_name");
       ```
    4. **`handleRefreshAudioInputDeviceList()`** 同上，刷新预设名称 + restart preview
    5. **`handleAudioInputDeviceChange()`** 成功后 restart preview：
       ```typescript
       void startPreview(deviceName);
       ```
    6. **`onMounted`** 新增：`void startPreview(settingsStore.selectedAudioInputDeviceName);`
    7. **`onBeforeUnmount`** 新增：`void stopPreview();`
    8. **Template `_default` SelectItem**（L1326-1328）改为：
       ```vue
       <SelectItem value="_default">
         {{ defaultInputDeviceName
           ? $t("settings.audioInput.systemDefaultWithDevice", { device: defaultInputDeviceName })
           : $t("settings.audioInput.systemDefault")
         }}
       </SelectItem>
       ```
    9. **Template 音量条**（L1346 `</div>` 后、L1348 `<transition>` 前）新增：
       ```vue
       <div
         v-if="isPreviewActive"
         role="meter"
         :aria-valuenow="Math.round(previewLevel * 100)"
         aria-valuemin="0"
         aria-valuemax="100"
         :aria-label="$t('settings.audioInput.volumePreview')"
         class="flex items-center gap-2 h-5"
       >
         <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
         <div class="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
           <div
             class="h-full rounded-full bg-primary transition-[width] duration-75"
             :style="{ width: `${Math.round(previewLevel * 100)}%` }"
           />
         </div>
       </div>
       ```
  - Notes: 音量条加 `role="meter"` + `aria-valuenow` + `aria-label` 确保无障碍。需在 i18n 中新增 `volumePreview` key（如「麦克风音量预览」）

### Acceptance Criteria

- [x] AC 1: Given 设定页已开启且系统有预设输入装置, when 使用者查看麦克风下拉选单, then 第一个选项显示「系统预设（{装置名称}）」
- [x] AC 2: Given 系统无预设输入装置或 `device.name()` 失败, when 使用者查看麦克风下拉选单, then 第一个选项显示「系统预设」（无括号）
- [x] AC 3: Given 设定页已开启且选中装置有收音, when 使用者对麦克风说话, then 音量条宽度随音量即时变化（0%-100%）
- [x] AC 4: Given 设定页已开启且选中装置无收音, when 环境安静, then 音量条宽度接近 0%
- [x] AC 5: Given 使用者切换输入装置, when 选择新装置, then 音量条重新启动并反映新装置的音量
- [x] AC 6: Given 设定页已开启且音量预览正在执行, when 使用者按 hotkey 开始录音, then 音量预览自动停止，录音正常进行
- [x] AC 7: Given 使用者离开设定页, when 页面 unmount, then 音量预览停止，macOS 麦克风指示灯熄灭
- [x] AC 8: Given 使用者按刷新按钮, when 装置列表重新载入, then 预设装置名称更新 + 音量预览重新启动
- [x] AC 9: Given macOS 环境, when 音量预览执行中, then 不影响 HUD 视窗的录音功能（两者独立）
- [x] AC 10: Given app 退出, when `RunEvent::Exit` 触发, then `AudioPreviewState` 在 `AudioRecorderState` 之前 shutdown，不残留 thread
- [x] AC 11: Given 录音正在进行中, when 使用者开启设定页, then 不启动音量预览（避免冲突）

## Additional Context

### Dependencies

- 无新 crate 依赖（cpal 已存在；preview 不需 rustfft）
- 前端无新依赖（`@vueuse/core` 已有 `useRafFn`）
- 依赖 Task 1-5（Rust 端）完成后才能测试 Task 6-9（前端）

### Testing Strategy

**Rust 测试（cargo test）：**
- `AudioPreviewState::new()` + `shutdown()` 不 panic
- `AudioPreviewState` 重复 `shutdown()` 不 panic（double-shutdown safety）
- `AudioPreviewState` `should_stop` flag 正确传播

**前端测试（pnpm test）：**
- 现有测试回归通过（349+ tests）
- i18n smoke test 覆盖新 key（`systemDefaultWithDevice`, `volumePreview`）

**手动测试：**
1. 开启设定页 → 确认「系统预设（装置名称）」正确显示
2. 对麦克风说话 → 音量条有反应
3. 切换到其他装置 → 音量条跟着切换
4. 按 hotkey 录音 → 音量条停止，录音正常
5. 录音中开启设定页 → 音量条不启动
6. 离开设定页 → macOS 麦克风指示灯熄灭
7. 接/拔蓝牙耳机 → 按刷新，预设名称更新
8. App 退出 → 无残留 thread

### Notes

- **cpal Arc cycle**：preview stream 必须遵循 `audio_recorder.rs:281-319` workaround — 优先 `default_input_device()` 路径，stream 结束时 `stream.pause()` before drop
- **macOS 麦克风指示灯**：preview 开启时会亮，这是预期行为（使用者在测试麦克风）
- **preview code 位置**：所有 preview 相关 code 放在 `audio_recorder.rs` 同档案，直接使用 `determine_input_config` 等 private fn，不新建 module
- **i18n 额外 key**：除 `systemDefaultWithDevice` 外，需新增 `volumePreview` key（5 个 locale）用于 aria-label
- **未来考量**：可在音量条旁加「装置名称」标签，或加 dB 数值显示，但目前 out of scope

## Review Notes

- Adversarial review completed: 15 findings total
- 12 fixed, 2 kept as-is (pattern-consistent with existing codebase), 1 noise skipped
- Resolution approach: auto-fix
- Key fixes: TOCTOU race elimination, thread join for clean shutdown, atomic RMS accumulator, dB perceptual scaling, re-entrancy guard
- Commit: `cd46210`
