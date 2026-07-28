---
title: '快捷键即时录音反馈'
type: 'bugfix'
created: '2026-07-29'
status: 'done'
baseline_commit: 'cd8755a3e5c163c4e28ef01c8bb86f72e191579f'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 快捷键触发后，`useVoiceFlowStore.handleStartRecording()` 会等待 Rust `start_recording` 完成音频预览关闭、输入设备选择、流建立与 `play()` 确认，才进入 `recording` 状态。HUD 的显示流程也会先等待当前显示器位置查询，导致用户的首次可见反馈受本地设备初始化时延影响。

**Approach:** 快捷键触发时立即更新 HUD 为录音状态并显示现有窗口，同时立即发起录音。录音启动 Promise 作为内部顺序屏障，确保用户在硬件尚在启动时放开按键，停止操作会在启动完成后按序执行；实时 ASR 继续以非阻塞方式启动，录音停止后沿用现有实时结果收敛与整段音频转录回退路径。

## Boundaries & Constraints

**Always:** `recording` 状态、HUD 显示和声音反馈在等待 `start_recording` 前触发；`start_recording` 仍在快捷键触发时立即调用；HUD 先展示在上次位置，再异步重定位到当前显示器；早释放、ESC、中断、启动失败、Hold 与 Toggle 均保持一致状态机；既有实时 ASR 失败后的整段音频 ASR 回退、录音文件保存、音频静音、编辑模式与 i18n 行为保持。

**Ask First:** 修改 Rust 录音命令协议、增加新的 Tauri event/command、调整 HUD 视觉结构或新增持久化诊断数据。

**Never:** 增加外部服务、依赖、权限、数据库变更或 API Key 读取路径；修改既有无关注释。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 设备启动延迟 | 按下热键，`start_recording` Promise 保持 pending | 同一调用回合内状态为 `recording`，HUD 先调用 `show()`，录音命令继续初始化 | 启动成功后开启计时器与非阻塞实时 ASR |
| 启动期间放开 | `start_recording` 尚未完成时收到停止事件 | 停止流程等待对应启动完成，再停止录音并进入既有转录链路 | 启动失败时仅显示一次录音错误，状态释放 |
| 实时 ASR 延迟或失败 | 已开始录音，实时 ASR 凭证或服务未就绪 | 音频采集持续，HUD 保持录音状态 | 停止后优先收敛实时结果，失败时以已保存 WAV 执行现有 `transcribe_audio` |
| 输入设备失败 | `start_recording` reject | 已显示的 HUD 转为错误状态 | 还原音频、释放录音锁并保留既有错误提示 |

</frozen-after-approval>

## Code Map

- `src/stores/useVoiceFlowStore.ts` -- 热键事件、HUD 展示、Rust 录音命令、实时 ASR 与最终 ASR 回退的时序中心。
- `src-tauri/src/plugins/audio_recorder.rs` -- `start_recording` 同步等待 cpal 线程 ready；现有延迟来源，协议本次保持。
- `src-tauri/src/plugins/hotkey_listener.rs` -- Hold/Toggle 直接 emit 热键事件，当前路径没有服务等待。
- `tests/unit/use-voice-flow-store.test.ts` -- Tauri invoke、HUD 窗口和热键事件的单元测试入口。

## Tasks & Acceptance

**Execution:**
- [x] `src/stores/useVoiceFlowStore.ts` -- 将 HUD 窗口 show 与录音状态转换前置到音频设备 ready 等待之前；显示后异步处理显示器定位和鼠标穿透，保留错误上报。
- [x] `src/stores/useVoiceFlowStore.ts` -- 持有单次录音启动 Promise，令 stop 流程在启动完成后按序继续；启动失败、ESC 与后续录音必须清理对应引用，实时 ASR 维持 fire-and-forget。
- [x] `tests/unit/use-voice-flow-store.test.ts` -- 以 deferred `start_recording` 覆盖 HUD 先于设备 ready 的行为、启动期间释放热键的有序停止，以及启动失败的错误状态。

**Acceptance Criteria:**
- Given cpal 设备启动耗时，when 用户按下 Hold 热键或 Toggle 开始热键，then HUD 在 `start_recording` Promise 完成前已显示录音状态。
- Given `get_hud_target_position` 耗时，when 用户开始录音，then HUD 的 `show()` 发生在位置查询完成前，并在位置结果到达后重定位。
- Given 用户在录音设备 ready 前放开 Hold 热键，when 启动 Promise 完成，then 系统按序停止同一轮录音并进入转录，且不会产生 `Not recording` 错误。
- Given 实时 ASR 启动耗时、缺少凭证或返回错误，when 已成功启动录音，then 录音持续采集，放开后使用现有实时收敛或整段音频转录完成流程。
- Given `start_recording` 返回错误，when HUD 已进入录音状态，then HUD 显示既有麦克风错误并恢复可再次触发的状态。

## Design Notes

`audio_recorder::start_recording()` 需要同步等待 preview thread join 与 cpal stream ready，等待属于真实硬件可用性边界。前端将它作为录音准备完成的确认点，同时将可见反馈与事件响应移至该确认点之前。结束时等待相同 Promise，建立跨 IPC 调度顺序的本地屏障。

## Verification

**Commands:**
- `pnpm vitest run tests/unit/use-voice-flow-store.test.ts` -- 通过即时 HUD、提前释放、失败与既有录音流程测试。
- `pnpm exec vue-tsc --noEmit` -- 通过严格 TypeScript 类型检查。

**Manual checks:**
- 使用真实麦克风在 Hold 与 Toggle 下触发，确认按键后 HUD 立刻出现、波形在硬件 ready 后开始变化、放开后转录与贴上正常。
- 在实时 ASR 凭证缺失或网络不可用时录制，确认音频采集与结束后的整段转录回退可用。

## Suggested Review Order

**即时可见反馈**

- HUD 先显示，定位与鼠标穿透在后台完成。
  [`useVoiceFlowStore.ts:248`](../../src/stores/useVoiceFlowStore.ts#L248)

- 按键事件立即进入录音状态，再等待硬件确认。
  [`useVoiceFlowStore.ts:1101`](../../src/stores/useVoiceFlowStore.ts#L1101)

**录音会话收尾**

- 单次启动 Promise 为取消和停止提供有序屏障。
  [`useVoiceFlowStore.ts:507`](../../src/stores/useVoiceFlowStore.ts#L507)

- ESC、双击与下一轮触发共享会话隔离规则。
  [`useVoiceFlowStore.ts:989`](../../src/stores/useVoiceFlowStore.ts#L989)

- 放键后等待同一轮启动完成，再停止并转录。
  [`useVoiceFlowStore.ts:1230`](../../src/stores/useVoiceFlowStore.ts#L1230)

**验证证据**

- 覆盖设备延迟、提前放键与 ESC 后重触发。
  [`use-voice-flow-store.test.ts:432`](../../tests/unit/use-voice-flow-store.test.ts#L432)
