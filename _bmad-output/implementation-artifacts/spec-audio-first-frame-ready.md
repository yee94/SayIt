---
title: '首帧音频就绪录音状态'
type: 'bugfix'
created: '2026-07-29'
status: 'done'
baseline_commit: 'c4cf975b4b815cb5950db5dd5547f8de3bbdda3d'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-bluetooth-audio-connecting-hud.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 现有 `start_recording` 在 CPAL `stream.play()` 成功后便回传 ready，但蓝牙设备此时可能尚未把任何 PCM 送进输入 callback。前端因此几乎立即从“连接麦克风...”切到录音态，首个音节仍可能发生在实际采样开始前而丢失。

**Approach:** 将原生 ready 边界提升为“输入 callback 已收到首批音频数据”。录音流仍立即启动和缓存首批数据；前端保持连接态直到该确认到达，随后才显示录音波形、启动计时和实时 ASR。

## Boundaries & Constraints

**Always:** 所有输入设备适用；首批数据（包含静音）一到即确认，不以音量阈值或固定等待伪造 ready；首批数据必须已进入录音缓冲；Hold、Toggle、早放键、ESC、失败和下一轮录音仍保持会话隔离；四语与既有连接 HUD 不变。

**Ask First:** 更改 HUD 文案、尺寸、动画、音效或静音时序；新增 Tauri command/event、依赖、权限或持久化资料。

**Never:** 按蓝牙设备名分支；丢弃首批 PCM；在 callback 内阻塞或等待前端；以固定延时代替真实数据确认。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 正常首帧 | `stream.play()` 后首个非空 callback | 已缓存该批 PCM，原生命令 resolve，HUD 切到录音态 | N/A |
| 蓝牙暖机 | play 成功但 callback 延迟 | HUD 持续显示连接态；不启动计时或 live ASR | 首帧到达后正常继续 |
| 首帧前放键 / ESC | 前端启动 Promise pending | 保持既有等待同一 Promise 后 stop 的屏障 | 不出现 `Not recording` 或跨轮污染 |
| callback 永不抵达 | stream 已启动但驱动不送数据 | 在明确 native timeout 后返回录音错误并释放 stream | HUD 进入既有错误态，可再次触发 |

</frozen-after-approval>

## Code Map

- `src-tauri/src/plugins/audio_recorder.rs` -- CPAL stream 建立、首次 callback 确认、首批 live ASR 预缓冲、超时及资源释放。
- `src/stores/useVoiceFlowStore.ts` -- 将 `start_recording` Promise 作为 connecting → recording 的已有边界，无需新 IPC。
- `tests/unit/use-voice-flow-store.test.ts` -- 验证前端保持连接态直到原生 Promise resolve 的回归语义。
- `src-tauri/src/plugins/audio_recorder.rs` 的单元测试区 -- 测试首帧一次性就绪通知与超时/错误可观察的纯同步辅助逻辑。

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/plugins/audio_recorder.rs` -- 用一次性、非阻塞的首帧通知替换 `stream.play()` 后的成功 ready；首批 PCM 同时预缓冲至 live ASR sink 可挂载；将 stream 建立/播放失败继续走原错误通道，并在首帧等待超时后停止并释放 stream。
- [x] `src-tauri/src/plugins/audio_recorder.rs` -- 以可脱离真实硬件的单元测试覆盖首帧只通知一次、空 callback 不确认、native timeout 与错误送达。
- [x] `tests/unit/use-voice-flow-store.test.ts` -- 明确连接态期间不会转录音态、计时或启动 live ASR，且 resolve 后才继续既有流程。

**Acceptance Criteria:**
- Given 蓝牙或其他设备已 `play()` 但尚未回调 PCM，when 用户开始录音，then HUD 持续显示“连接麦克风...”，不显示波形或递增计时。
- Given 输入 callback 收到第一批实际 PCM，when 该批已写入缓冲，then `start_recording` 成功、HUD 转录音态并从 0 开始计时。
- Given live ASR 在原生 ready 后才挂载，when 首批 PCM 已先到达，then live ASR 以原始顺序收到该批，不遗漏首音节。
- Given 用户在首帧前放键或按 ESC，when 首帧后来到达或等待失败，then recorder 恰好释放一次，不产生 `Not recording`、错误闪回或下一轮污染。
- Given 驱动在合理等待内始终不回调，when native timeout 到期，then 前端显示可恢复的麦克风错误，且后续录音可再次启动。

## Design Notes

`stream.play()` 仅代表 CoreAudio 已接受启动请求；首个 non-empty callback 才是应用已实际取得 PCM 的可验证边界。callback 只执行一次 `try_send` / 原子通知，不能等待 receiver。Rust 启动路径在 timeout 时应把 `should_stop` 设为 true、join 线程并返回错误，避免前端的启动/停止屏障永久悬挂。

## Verification

**Commands:**
- `cargo test --manifest-path src-tauri/Cargo.toml audio_recorder` -- 首帧通知与录音状态单元测试通过。
- `pnpm vitest run tests/unit/use-voice-flow-store.test.ts` -- 前端连接态和取消时序测试通过。
- `pnpm exec vue-tsc --noEmit` -- 类型检查通过。
- `node scripts/check-simplified-chinese.mjs` -- 简体中文检查通过。

**Manual checks:**
- AirPods：第一次说话时 HUD 先显示连接态；首个音节被完整转录，首帧后才出现波形与计时器。
- 内建麦克风：连接态可极短，但不会阻碍正常 Hold、Toggle、快速放键或 ESC。

## Suggested Review Order

**原生真实 ready 边界**

- 启动命令仅在首批 PCM 入缓冲后成功。
  [`audio_recorder.rs:446`](../../src-tauri/src/plugins/audio_recorder.rs#L446)

- callback 写入首帧后才推进连接状态。
  [`audio_recorder.rs:1063`](../../src-tauri/src/plugins/audio_recorder.rs#L1063)

- 超时与首帧前 stream error 都释放录音线程。
  [`audio_recorder.rs:199`](../../src-tauri/src/plugins/audio_recorder.rs#L199)

**首音节的实时 ASR 交接**

- sink 挂载时按原顺序补送早到的 PCM。
  [`audio_recorder.rs:241`](../../src-tauri/src/plugins/audio_recorder.rs#L241)

- callback 在 sink 缺席时有界缓存首批 PCM。
  [`audio_recorder.rs:165`](../../src-tauri/src/plugins/audio_recorder.rs#L165)

**回归证据**

- 前端保持连接态，直到原生启动 Promise resolve。
  [`use-voice-flow-store.test.ts:482`](../../tests/unit/use-voice-flow-store.test.ts#L482)

- 原生测试覆盖一次性 ready、异常与预缓冲顺序。
  [`audio_recorder.rs:1372`](../../src-tauri/src/plugins/audio_recorder.rs#L1372)
