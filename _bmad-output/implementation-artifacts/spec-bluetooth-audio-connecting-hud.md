---
title: '音频设备连接 HUD 状态'
type: 'feature'
created: '2026-07-29'
status: 'done'
baseline_commit: '195c0df6619d8fe6c8a5ac6a80285d8884823554'
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-ui-design-spec.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-hotkey-immediate-recording-feedback.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 快捷键触发后，HUD 在 `start_recording` 尚未完成蓝牙或其他输入设备选择、音频流建立和 `play()` 确认前便显示录音波形，用户无法分辨麦克风仍在连接，可能误以为已经开始拾音。

**Approach:** 在即时反馈与真正录音之间新增 `connecting` 状态：触发后立即显示“连接麦克风...”及连接动效；Rust 确认音频流可用后再切换到现有波形与计时器。所有输入设备共用此状态，不做不可靠的蓝牙名称判断。

## Boundaries & Constraints

**Always:** HUD 立即出现；连接态不启动波形、字幕或计时器；`start_recording` 成功后才进入 `recording`；早放键、ESC、双击、失败和下一轮录音保持会话隔离；同步四语文案。

**Ask First:** 改 Rust ready 协议；仅向蓝牙设备显示；调整音效、静音时序、窗口尺寸或既有状态视觉。

**Never:** 用固定延时假装 ready；增加依赖、权限、数据库或 IPC；破坏即时展示与异步定位。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 正常启动 | Promise pending → resolve | 连接态立即出现；ready 后切录音态并从 0 计时 | N/A |
| 启动时放键 | stop 到达，Promise pending | 等待同一 Promise；ready 后直接停止，不闪录音态 | 沿用停止流程 |
| 启动时 ESC | `connecting` + pending | 显示已取消；ready 后停止 recorder，不污染下一轮 | 清理现有资源 |
| 启动失败 | Promise reject | 转既有麦克风错误态，可再次触发 | 错误只显示一次 |

</frozen-after-approval>

## Code Map

- `CLAUDE.md`、`_bmad-output/project-context.md`、相关开发文档 -- 移除强制 `design.pen` 前置门槛。
- `src/types/index.ts` -- `HudStatus` 新增 `connecting`。
- `src/stores/useVoiceFlowStore.ts` -- 启动 Promise、状态广播与资源时序。
- `src/components/NotchHud.vue` -- 状态到连接视觉、文案及录音视觉的映射。
- `src/i18n/locales/{zh-CN,en,ja,ko}.json` -- 四语连接文案。
- 三个相关测试文件 -- 时序、视觉与类型回归。

## Tasks & Acceptance

**Execution:**
- [x] 项目规则与开发文档 -- 按用户指示移除 UI 实现前必须更新或确认 `design.pen` 的限制；保留设计稿文件本身作为可选参考。
- [x] `src/types/index.ts`、`src/stores/useVoiceFlowStore.ts` -- 新增并广播连接态；将录音态移至 Promise resolve 后；纳入 HUD 展示、忙碌判定与 ESC recorder 清理。
- [x] `src/components/NotchHud.vue`、四个 locale JSON -- 实现已确认视觉与文案，保留既有尺寸和动画曲线。
- [x] 三个相关测试文件 -- 覆盖正常、早放键、ESC、失败、视觉和类型行为。

**Acceptance Criteria:**
- Given 输入设备正在初始化，when 用户触发录音，then HUD 同一调用回合显示连接态，Rust ready 前无波形、字幕或递增计时。
- Given Promise 成功且会话有效，when ready，then 切到录音态、从 0 计时并启动 live ASR。
- Given 连接期间停止、取消或失败，when异步启动结算，then 不闪现错误录音态、不产生 `Not recording`、麦克风残留或跨轮污染。

## Design Notes

`start_recording` 已覆盖设备选择、stream build 与 `stream.play()`，可作为真实 ready 边界，无需修改 Rust。音效和静音保持当前时序。

## Verification

**Commands:**
- `pnpm vitest run tests/unit/use-voice-flow-store.test.ts tests/component/NotchHud.test.ts tests/unit/types.test.ts` -- 新旧状态及时序测试通过。
- `pnpm exec vue-tsc --noEmit` -- 所有 `HudStatus` 消费者通过类型检查。
- `node scripts/check-simplified-chinese.mjs` -- 简体中文和 locale 键检查通过。

**Manual checks:**
- AirPods/蓝牙耳机验证 Hold、Toggle、快速放键和 ESC；波形仅在 ready 后出现且无残留占用。
- 内建麦克风验证快速切换无尺寸跳动，既有状态无回归。

## Suggested Review Order

**录音状态时序**

- 入口先广播连接态，ready 后才启动录音反馈。
  [`useVoiceFlowStore.ts:1398`](../../src/stores/useVoiceFlowStore.ts#L1398)

- 状态类型显式纳入 connecting，约束所有消费者。
  [`index.ts:1`](../../src/types/index.ts#L1)

**HUD 呈现与可访问性**

- 状态监听切换连接视觉并停止波形动画。
  [`NotchHud.vue:401`](../../src/components/NotchHud.vue#L401)

- 连接动效与状态播报独立于录音内容。
  [`NotchHud.vue:508`](../../src/components/NotchHud.vue#L508)

- 减少动画偏好关闭脉冲缩放。
  [`NotchHud.vue:712`](../../src/components/NotchHud.vue#L712)

**文案与项目规则**

- 四语连接文案以同一 key 同步。
  [`zh-CN.json:304`](../../src/i18n/locales/zh-CN.json#L304)

- design.pen 降为可选历史参考。
  [`project-overview.md:72`](../../docs/project-overview.md#L72)

**回归覆盖**

- Promise 时序覆盖 ready、早放键、ESC 与失败。
  [`use-voice-flow-store.test.ts:436`](../../tests/unit/use-voice-flow-store.test.ts#L436)

- 组件测试排除波形、计时器和字幕泄漏。
  [`NotchHud.test.ts:63`](../../tests/component/NotchHud.test.ts#L63)
