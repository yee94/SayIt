---
title: 'LLM 自定义 Header 与刘海动画基线恢复'
type: 'feature'
created: '2026-07-30'
status: 'in-progress'
baseline_commit: 'e63157f9aefb426a0a99e3526f449db3155fca8a'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-ui-design-spec.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** OpenAI 兼容 LLM 服务常要求额外 HTTP Header，当前设置无法保存或发送。刘海 HUD 的未提交改动改变了原有的动画结构、时序和光效，使用体验偏离上次提交；部分退出路径在收缩过渡完成前隐藏 HUD，表现为直接闪掉。

**Approach:** 在 LLM 配置卡提供默认收起的“自定义 Header”，以 JSON 对象编辑并持久化到现有设置存储；所有 LLM 生产请求和连接测试复用同一 Header。HUD 动画恢复 commit `e63157f` 的结构、时序、波形和高光，仅保留较小字号与 ASR 稳定/待定分段展示；待定分段维持下划线。所有退出状态以入场动画的反向收缩与淡出完成后再隐藏视窗。

## Boundaries & Constraints

**Always:** Header 值以 JSON 字符串对象输入和存储；键和值均为非空字符串；`Authorization` 与 `Content-Type` 由应用生成并保持优先级；连接测试与文字整理使用同一 Header；四语 i18n key 集合保持一致；字节 `utterances[].definite=true` 为稳定分句，待定尾段以下划线展示；HUD 除字号和分段下划线外与 `e63157f` 保持一致；视窗隐藏等待收缩与淡出完成。

**Ask First:** Header 支持多值、环境变量插值、每个模型独立 Header、覆盖应用认证 Header、向历史或日志持久化 Header、新增第三方依赖。

**Never:** 在日志、错误讯息、SQLite 或 UI feedback 显示 Header 值；让无效 JSON 覆盖已保存 Header；改变 Rust ASR 分段协议、最终转录或现有 LLM API Key 行为。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 保存 Header | `{ "HTTP-Referer": "https://example.com" }` | 设置保存，折叠区默认关闭，请求含该 Header | 既有成功反馈 |
| 非法输入 | 非 JSON、数组、空键值或非字符串值 | 保留旧设置并显示本地化错误 | 请求继续使用旧设置 |
| 保留 Header | 输入 `Authorization` 或 `Content-Type` | 应用认证与 JSON Content-Type 生效 | 自定义同名键被应用值覆盖 |
| 跨视窗同步 | Dashboard 保存后 HUD 发起 LLM 请求 | HUD 刷新设置并使用最新 Header | 沿用 settings 事件同步 |
| 实时 ASR 字幕 | definite 前缀加待定尾段 | 原动画与高光保持，待定尾段有下划线 | 缺少 utterances 时全文作为待定 |
| HUD 退出 | success、cancelled、error、idle | 先按入场动画反向收缩并淡出，再隐藏 HUD | 快速重触发取消待隐藏动作并进入下一轮 |

</frozen-after-approval>

## Code Map

- `src/views/SettingsView.vue` -- LLM 配置表单、折叠 Header 编辑器与保存反馈。
- `src/stores/useSettingsStore.ts` -- Header 校验、tauri-store 持久化、跨视窗刷新与读取。
- `src/types/events.ts` -- 设置同步事件键。
- `src/lib/llmProvider.ts` -- OpenAI 兼容请求 Header 的唯一合并点。
- `src/lib/enhancer.ts`、`src/lib/vocabularyAnalyzer.ts`、`src/lib/connectionTest.ts` -- 把当前设置 Header 传入实际请求与测试。
- `src/components/NotchHud.vue`、`src/composables/useAudioWaveform.ts`、`src/stores/useVoiceFlowStore.ts` -- 恢复 e63157f HUD 动画基线，并使视窗隐藏等待退出动画，保留字号和稳定性分段。
- `src/i18n/locales/{zh-CN,en,ja,ko}.json` -- Header 表单和校验讯息。
- `tests/unit/llmProvider.test.ts`、`tests/unit/use-settings-store.test.ts`、`tests/component/NotchHud.test.ts` -- Header、持久化和 HUD 基线回归。

## Tasks & Acceptance

**Execution:**
- [ ] 添加 shadcn-vue Collapsible，并在 `SettingsView.vue` 以默认收起的 JSON Textarea 呈现“自定义 Header”。
- [ ] 在 Settings Store 校验、保存、读取和跨视窗同步 `Record<string, string>` Header；无效输入保留上次有效值。
- [ ] 将 Header 经 LLM 调用选项传到 `buildFetchParams()`；应用认证 Header 覆盖同名自定义 Header，连接测试、整理和字典分析使用相同合并规则。
- [ ] 补齐四语文案和现有测试，覆盖有效/无效 JSON、保留 Header 优先级、跨视窗读取和全部 LLM 调用入口。
- [ ] 以 `e63157f` 恢复 `NotchHud.vue` 与 `useAudioWaveform.ts` 的动画节奏、字幕展开、高光、阴影和波形实现；保留 13px 实时字幕、稳定/待定 span 与待定下划线。
- [ ] 对齐 `NotchHud.vue` 退出时长与 `useVoiceFlowStore.ts` 视窗隐藏时机，令 success、cancelled、error 和 idle 都完整播放反向收缩与淡出。
- [ ] 更新 HUD 组件断言，覆盖恢复后的高度与光效，以及稳定/待定下划线。

**Acceptance Criteria:**
- Given 用户输入有效 Header JSON，when 保存并发起连接测试或整理，then 请求携带自定义 Header。
- Given 用户输入保留 Header，when 请求构建，then 应用生成的认证和 Content-Type Header 生效。
- Given 用户输入无效 JSON，when 保存，then 已保存 Header 和请求行为保持。
- Given HUD 出现实时字幕，when 字幕展开和光效播放，then 动画结构、时序和阴影与 e63157f 对齐，实时字幕字号为 13px。
- Given ASR 返回非确定分句，when HUD 渲染字幕，then 待定尾段以下划线呈现。
- Given HUD 进入任一终态，when 视窗需要隐藏，then 收缩和淡出完整播放后视窗消失。

## Design Notes

Header 采用 JSON 对象，适合复制供应商示例，也让持久化和请求合并具备单一确定格式。用户 Header 先合并，应用 Header 后合并，令 API Key 认证和请求体格式保持可预测。

HUD 视觉以 e63157f 为准；稳定性分段只改变文字标记，避免重新设计动画系统。

## Verification

**Commands:**
- `pnpm vitest run tests/unit/llmProvider.test.ts tests/unit/use-settings-store.test.ts tests/component/NotchHud.test.ts` -- Header、设置和 HUD 行为通过。
- `pnpm exec vue-tsc --noEmit` -- 表单、调用参数和 i18n 类型通过。
- `node scripts/check-simplified-chinese.mjs` -- 新增中文符合简体规则。

**Manual checks:**
- 填入一个自定义 Header，使用“测试连接”与一次文字整理确认请求可达；非法 JSON 后确认旧 Header 继续工作。
- 录音观察刘海展开、波形、高光和待定下划线与上次提交的节奏一致。
