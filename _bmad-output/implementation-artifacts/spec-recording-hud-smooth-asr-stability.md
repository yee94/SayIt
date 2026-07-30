---
title: '录音刘海流畅度与实时 ASR 稳定态'
type: 'bugfix'
created: '2026-07-30'
status: 'done'
baseline_commit: 'e63157f9aefb426a0a99e3526f449db3155fca8a'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-ui-design-spec.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-audio-first-frame-ready.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 开始录音时，HUD 会等待输入设备的首批 PCM，个别录音在日志中出现约一秒的等待；录音态同时以高频 IPC、逐帧响应式更新、条形高度过渡、字幕渐变和形状裁切叠加，容易形成动画掉帧感。旧字幕高光以 `background-position`、`background-clip:text` 和无限循环实现，持续触发字形重绘并与波形热路径竞争。实时 ASR 服务已返回句级 `definite`，当前 IPC 丢弃这项稳定性信息，HUD 无法区分已确定和仍在修正的文字。

**Approach:** 保留首帧就绪语义、启动屏障与字幕高光；高光改为字幕内容变更时触发的合成层短促扫光，使用 `transform` 与 `opacity` 完成。波形刷新继续使用低开销路径，并缩小 HUD 文字。把 ASR 的稳定文本与待定尾段通过既有 `transcription:partial` 事件传到 HUD，待定尾段以下划线呈现。

## Boundaries & Constraints

**Always:** 保持首批 PCM 已入缓冲后才进入录音态；保持 Hold、Toggle、早放键、ESC、整段转录回退、实时 ASR 失败处理和四语行为；保留字幕高光效果；`definite=true` 表示句级稳定，session final 继续只由现有会话级字段判定；稳定性仅服务 HUD 呈现，最终转录、贴上和持久化继续使用完整文本；启动诊断日志只记录耗时与阶段，不记录语音内容或凭证。

**Ask First:** 新增持久化诊断资料、Tauri command/event、第三方依赖、录音协议、麦克风首帧 timeout、AppleScript/辅助功能学习流程。

**Never:** 以固定延迟替换首帧确认；以 `utterance.definite` 结束 ASR 会话；移除字幕高光效果；为性能优化丢弃 PCM、降低转录正确性或改变 AppleScript/学习流程。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 常规录音 | 首帧快速抵达且有波形事件 | HUD 保持当前状态机，波形以受控频率平滑更新，字幕字体缩小 | 现有启动和录音流程继续执行 |
| 设备暖机 | `start_recording` 等待首帧 | HUD 显示连接态；日志记录 `first-frame-ready` 等待毫秒数 | 现有 10 秒首帧 timeout 与可恢复错误继续生效 |
| 有句级稳定文本 | ASR `utterances` 同时包含 `definite=true/false` | HUD 显示稳定前缀；待定尾段带下划线 | 服务端缺少 utterances 时，完整 partial 作为待定文字显示 |
| 文本相同但稳定性更新 | 同一累计文字的 `definite` 状态变化 | HUD 立即移除对应文字的下划线 | 维持当前全文与 session-final 判断 |
| ASR 或录音结束 | success、error、cancelled、idle | 清空稳定与待定字幕；HUD 收起保持平滑 | 既有 cleanup 与下一轮会话隔离继续执行 |

</frozen-after-approval>

## Code Map

- `src-tauri/src/plugins/audio_recorder.rs` -- 音频 callback、FFT 波形事件节流和首帧就绪边界。
- `src-tauri/src/plugins/transcription.rs` -- 豆包 ASR JSON 解析、partial event payload 与 live ASR 推送循环。
- `src/types/events.ts` -- Rust partial payload 的 TypeScript 契约。
- `src/stores/useVoiceFlowStore.ts` -- 录音启动耗时日志、实时字幕状态和跨会话清理。
- `src/App.vue` -- 将稳定/待定字幕传给 HUD。
- `src/composables/useAudioWaveform.ts` -- 波形目标值与帧动画的低分配更新。
- `src/components/NotchHud.vue` -- 录音条形、刘海形状、字幕分段与紧凑排版。
- `tests/component/NotchHud.test.ts`、`src-tauri/src/plugins/transcription.rs` 测试区 -- HUD 分段呈现与 ASR 解析回归覆盖。

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/plugins/audio_recorder.rs` -- 将录音态波形事件设为适合 HUD 的固定低频率，保留同一 FFT 计算、六个频段和音频采集路径，降低跨进程事件压力。
- [x] `src/components/NotchHud.vue` -- 保留字幕高光，并改为字幕内容变更时以合成层 `transform`/`opacity` 触发一次短促扫光，避免录音中持续的字形裁切与渐变重绘。
- [x] `src/components/NotchHud.vue` -- 使用固定的紧凑字幕区域与轻量尺寸/透明度过渡取代字幕展开时的 `clip-path` 插值；缩小实时字幕、连接提示和计时文字，保留可读性及 reduced-motion 支持。
- [x] `src/stores/useVoiceFlowStore.ts` -- 在 `start_recording` 前后以 `performance.now()` 记录首帧就绪等待毫秒数；日志继续使用现有写入通道，并保留当前并发启动、停止和错误语义。
- [x] `src-tauri/src/plugins/transcription.rs` -- 从 `utterances[].definite` 提取稳定与待定片段，扩展既有 `transcription:partial` payload；当文本或分段稳定性变更时发事件，继续用会话级 final 字段控制读循环。
- [x] `src/types/events.ts`、`src/stores/useVoiceFlowStore.ts`、`src/App.vue`、`src/components/NotchHud.vue` -- 将 stable/unstable 文本建模为可选的实时字幕数据；HUD 将稳定段正常渲染、待定段以下划线渲染，缺少分段数据时把已有文本作为待定内容；生命周期结束时统一清空。
- [x] `tests/component/NotchHud.test.ts`、`src-tauri/src/plugins/transcription.rs` 测试区 -- 扩展现有断言，覆盖稳定/待定分段、稳定性单独更新、缺少 utterances 的回退和现有 session-final 语义。

**Acceptance Criteria:**
- Given 输入设备已经开始采样，when HUD 进入录音态，then 波形保持平滑且每秒跨 IPC 的更新次数受固定上限控制。
- Given 录音启动受设备暖机影响，when 首帧到达或失败，then 日志包含首帧等待毫秒数，HUD 和资源清理由既有状态机控制。
- Given 服务端确认某个 utterance，when HUD 收到对应 partial，then 已确认文字无下划线，仍在识别的尾段有下划线。
- Given partial 的文字保持相同且 `definite` 变化，when 新事件抵达，then HUD 的下划线状态同步更新。
- Given 用户结束、取消或重试录音，when 流程切换到终态，then 两类实时字幕都被清空，下一轮录音无遗留文字。

## Design Notes

日志与现有记录一起说明根因：`capture_target_window`、选中文字探测和 AppleScript 互不构成启动等待链；`start_recording` 的首帧等待与高频 HUD 渲染是两条独立压力来源。AppleScript 继续仅服务粘贴后的 correction 学习路径。旧高光的无限 `background-position` 加 `background-clip:text` 在 WKWebView 走字形重绘，和旧版 Vue 波形、height 布局与高频 IPC 同时占用渲染线程。高光继续保留，以短促的合成层扫光替代持续重绘。

稳定性数据采用同一 partial 事件的可选字段，维持现有事件名和 IPC 流程。服务端缺少 `utterances` 时使用 `text` 作为待定字幕，表达保守且可见的识别过程。

## Verification

**Commands:**
- `pnpm vitest run tests/component/NotchHud.test.ts` -- HUD 分段字幕与既有状态测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml transcription` -- ASR 解析、session final 与 partial payload 测试通过。
- `pnpm exec vue-tsc --noEmit` -- Vue props、事件契约和 store 类型检查通过。
- `node scripts/check-simplified-chinese.mjs` -- 新增中文符合简体规则。

**Manual checks:**
- 用内建麦克风和蓝牙设备各录制一次，观察连接态、录音波形、下划线尾段和结束转录；检查日志中的首帧毫秒字段。
- 在录音中快速放开热键及按 ESC，确认 HUD 收起、重试与下一轮录音保持现有行为。

## Suggested Review Order

**实时 ASR 分段契约**

- 从服务端 utterance 提取稳定前缀并保持全文与分段一致。
  [`transcription.rs:375`](../../src-tauri/src/plugins/transcription.rs#L375)

- 仅在文本或稳定性发生变化时发送既有 partial 事件。
  [`transcription.rs:614`](../../src-tauri/src/plugins/transcription.rs#L614)

- 前端最终全文屏蔽迟到 partial，维持跨会话隔离。
  [`useVoiceFlowStore.ts:396`](../../src/stores/useVoiceFlowStore.ts#L396)

**录音反馈性能**

- 字幕变化只触发一次短促扫光，重复文本保持同一序列。
  [`NotchHud.vue:150`](../../src/components/NotchHud.vue#L150)

- 实时字幕脱离祖先滤镜层，避免高光触发整棵 HUD 重绘。
  [`NotchHud.vue:517`](../../src/components/NotchHud.vue#L517)

- 保留六频段 FFT，限制跨进程波形刷新至约 20fps。
  [`audio_recorder.rs:388`](../../src-tauri/src/plugins/audio_recorder.rs#L388)

- 用固定缓冲和 CSS 变量避开逐帧响应式数组分配。
  [`useAudioWaveform.ts:16`](../../src/composables/useAudioWaveform.ts#L16)

- 录音条与字幕扫光使用合成层 transform，避免布局重算。
  [`NotchHud.vue:650`](../../src/components/NotchHud.vue#L650)

**验证覆盖**

- 覆盖 ASR 分段、回退与 camelCase IPC 序列化。
  [`transcription.rs:1556`](../../src-tauri/src/plugins/transcription.rs#L1556)

- 覆盖前端分段、终稿屏蔽与新会话复位。
  [`use-voice-flow-store.test.ts:2667`](../../tests/unit/use-voice-flow-store.test.ts#L2667)

- 覆盖 HUD 下划线分段和旧 prop 兼容呈现。
  [`NotchHud.test.ts:408`](../../tests/component/NotchHud.test.ts#L408)
