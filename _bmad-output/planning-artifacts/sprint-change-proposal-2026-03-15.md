# Sprint Change Proposal — 使用者回馈体验优化

**日期**：2026-03-15
**触发来源**：真实使用者回馈（2026-03-14 群组对话）
**回报者**：康富淼、Leo Chen、子超
**变更范围分类**：Moderate（需要多个 Story 修改/新增，跨 4 个 Epic）

---

## Section 1: 问题摘要

SayIt v0.7.3 的核心语音输入流程在真实使用场景中暴露 5 个体验缺口。这些问题的共同影响是降低使用者对工具的信任感，增加「崩溃重讲」的心理负担。

| # | 问题 | 回报者 | 类型 |
|---|------|--------|------|
| 1 | Whisper 幻觉词直接贴入 | Jackle、康富淼 | 技术限制 |
| 2 | 讲完话却显示「未侦测到语音」 | 康富淼 | 技术限制 |
| 3 | HUD 重试按钮只开 Dashboard，没有重送 | 康富淼 | 未完成需求 |
| 4 | 中英混讲辨识品质差 | Leo Chen、康富淼 | 技术限制 |
| 5 | 不支援组合键触发（modifier+key） | 康富淼 | 新需求 |

**证据**：
- 康富淼：「按下去讲完会说没有声音，就要重新批趴重讲一次，发生的时候会小崩溃」
- 康富淼：「坏掉的时候会有 replay icon 那个点了是不是没有用」
- Leo Chen：「中英混着讲会爆掉」
- 康富淼用 BetterTouchTool 自行映射按键绕过组合键限制
- 康富淼已推荐给公司研究员使用（产品市场契合信号强）

---

## Section 2: 影响分析

### Epic 影响

| Epic | 影响 | 相关问题 |
|------|------|---------|
| Epic 1: 跨平台语音输入基础 | 扩展组合键 | #5 |
| Epic 2: AI 文字智慧整理 | 幻觉侦测 + 中英混讲 prompt | #1, #4 |
| Epic 3: 自订词汇字典 | 无影响 | — |
| Epic 4: 历史记录与 Dashboard | 录音储存 + 播放 + 失败记录 + 重送 | #2, #3 |
| Epic 5: 设定与生命周期 | 幻觉词库 UI + 录音清理设定 | #1, #2 |

### 文件影响

| 文件 | 需要更新 |
|------|---------|
| PRD | FR6, FR26-28, FR30 修改；新增 FR37（录音储存播放）、FR38（幻觉侦测） |
| Architecture | SQLite Schema、IPC 契约表、hotkey_listener 段落、新增录音档管理段落 |
| UX/UI Spec | HUD error 态行为、SettingsView 新区块、HistoryView 播放按钮 |
| project-context.md | 新增幻觉侦测、录音储存、组合键段落 |
| CLAUDE.md | IPC 契约表更新 |
| database.ts | v4 migration |
| i18n 翻译档 | 5 个 locale JSON 新增翻译键 |

### 技术影响

| 层面 | 影响 |
|------|------|
| SQLite Schema | 新增 `hallucination_terms` 表；`transcriptions` 新增 `audio_file_path TEXT`, `status TEXT` 栏位 |
| Rust Commands | `StopRecordingResult` 新增 `peakEnergyLevel`；新增录音档管理 Commands（清理、读取） |
| 磁碟储存 | 新增 `{APP_DATA}/recordings/` 目录，每次录音存 WAV（~32KB/秒） |
| 前端型别 | `CustomTriggerKey` 扩展 modifiers 阵列；新增幻觉侦测相关型别 |

---

## Section 3: 推荐方案

### 路径选择：直接调整（修改/新增 Story）

**理由**：
1. 所有变更都是增量式，不推翻任何现有架构
2. 每个问题的修改范围明确，可分批交付
3. 风险可控，最大工作项也不触及核心管线
4. 5 个问题互相独立，可各自成为版本发布

### 各问题解决方案

#### 问题 1：三层幻觉侦测架构

```
 Layer 1: 语速异常侦测（物理定律级判断）
   录音时长 vs 文字量比例不合理 → 幻觉
   自动将幻觉文字加入幻觉词库

 Layer 2: noSpeechProbability 门槛
   Whisper 回传的无语音机率 > 门槛 → 可疑

 Layer 3: 幻觉词库比对
   内建词库（多语言）+ 自动学习 + 使用者手动新增

 判定：任一层强判定 → 拦截
       两层弱可疑 → 组合拦截
       单层弱可疑 → 放行
```

| 决策项 | 结论 |
|--------|------|
| 储存位置 | SQLite 独立 `hallucination_terms` 表（与 vocabulary 分开） |
| 自动加入确认 | HUD 通知「已学习幻觉词：XXX」（类似字典学习音效） |
| 管理 UI | 独立页面「幻觉词库」（`/hallucinations`）+ 侧边栏导航项，与「自订字典」平行 |
| 幻觉拦截行为 | 判定为幻觉 → 不贴上，HUD 显示「未侦测到语音」 |
| 多语言处理 | 根据 selectedTranscriptionLocale 载入对应语言的内建幻觉词库 |

**影响范围**：
- **新增**：`hallucination_terms` SQLite 表、幻觉侦测模组、`HallucinationView.vue`（独立页面）、`useHallucinationStore.ts`、router 新增 `/hallucinations` 路由、侧边栏新增导航项
- **修改**：`useVoiceFlowStore.ts`（转录结果判定流程）、`database.ts`（schema migration）、`NotchHud.vue`（学习通知）、`router.ts`、`MainApp.vue`（侧边栏导航）
- **Rust 端**：不需修改（录音时长和 noSpeechProb 已有回传）

#### 问题 2+3：录音永久储存 + 一键重送 + 历史播放

**录音档储存决策**：

| 决策项 | 结论 |
|--------|------|
| 格式 | WAV（16-bit mono 16kHz，Rust 端已编码） |
| 位置 | Tauri App Data 目录 `recordings/` 子目录 |
| 命名 | `{transcription_id}.wav`（UUID 对应 transcriptions 表） |
| DB 关联 | `transcriptions` 表新增 `audio_file_path TEXT` 栏位 |
| 失败的录音 | 也写入 `transcriptions` 表，新增 `status TEXT`（`success` / `failed`） |
| 清理策略 | 设定页面提供两种：手动删除所有 + 自动清理（预设 7 天，天数可由使用者设定） |

**重送机制**：

```
 Whisper 回传空字串
       │
       ▼
 HUD 显示 "辨识失败" + 重送按钮（一律显示，不管是否确定有说话）
       │
  使用者点击重送
       │
       ▼
 从磁碟读取 WAV → 重新呼叫 transcribe_audio()
 HUD 切换为 "转录中..."（复用 transcribing 状态）
       │
  ┌────┴────┐
  ▼         ▼
成功       再次失败
正常贴上    "辨识失败，请重新录音"
流程       （不再提供重送按钮）
```

| 决策项 | 结论 |
|--------|------|
| 重送按钮显示条件 | 一律显示（所有 error 状态） |
| 重送次数 | 限 1 次 |
| 重送 HUD 状态 | 复用 `transcribing`（「转录中...」） |
| 重送失败讯息 | 「辨识失败，请重新录音」 |

**「确定有说话」内部标记**：
- 判定标准：录音 ≥ 1 秒 + peak energy ≥ 门槛
- 不影响 UI（重送按钮一律显示）
- `StopRecordingResult` 新增 `peakEnergyLevel: f32`，供未来分析使用

**历史记录播放**：

| 决策项 | 结论 |
|--------|------|
| 播放技术 | `convertFileSrc()` 转换本地路径 → HTML5 `<audio>` 串流播放 |
| UI 位置 | HistoryView 每笔记录新增播放按钮（▶） |
| 档案不存在时 | 播放按钮灰显 disabled（使用者可能已手动清理） |

**影响范围**：
- **新增**：`recordings/` 目录管理、录音档清理 Rust Command、设定页面清理 UI
- **修改（Rust）**：`audio_recorder.rs`（stop_recording 回传 peakEnergyLevel + 写入磁碟）、`transcription.rs`（重送时从磁碟读取 WAV）
- **修改（前端）**：`useVoiceFlowStore.ts`（重送流程）、`NotchHud.vue` + `App.vue`（重送按钮行为）、`HistoryView.vue`（播放按钮）、`useHistoryStore.ts`（失败记录写入）、`database.ts`（schema migration：audio_file_path + status 栏位）
- **修改（设定）**：`SettingsView.vue`（录音档清理设定）、`useSettingsStore.ts`（清理天数设定）

#### 问题 4：Whisper prompt 双语提示 + AI 后处理修正

**B：Whisper prompt 加入双语提示**
- 在 `format_whisper_prompt()` 中，除字典词外，自动加入语言混合范例文字
- 根据 `selectedTranscriptionLocale` 动态调整：
  - `zh` → 注入中英混合范例（如「部署 deploy, 测试 test, main.py」）
  - `en` → 注入英中混合范例（如「deploy 部署, API endpoint」）
  - `auto` → 注入最广泛的多语混合范例

**C：AI 整理 prompt 增加语言混淆修正**
- 在 enhancer system prompt 中加入：「修正语音辨识中明显的语言混淆，例如英文术语被转为中文谐音」
- 搭配字典词上下文，LLM 可根据语意还原正确用词

| 决策项 | 结论 |
|--------|------|
| 方案 | B + C 组合 |
| 架构改动 | 无（prompt engineering 为主） |
| 长期方向 | 等 Groq 上线支援 code-switching 的新模型 |

**影响范围**：
- **修改（Rust）**：`transcription.rs` — `format_whisper_prompt()` 增加语言混合范例
- **修改（前端）**：`enhancer.ts` — system prompt 增加语言混淆修正指令
- **修改（前端）**：`prompts.ts` — 各语言预设 prompt 加入语言修正指令
- **修改（i18n）**：5 个 locale JSON 可能需要新增翻译键

#### 问题 5：自订模式扩展为组合键

**组合键定义**：`0~N 个 modifier + 1 个普通键`

| 使用者按 | 记录结果 |
|----------|---------|
| `Space` | `{ modifiers: [], key: "Space" }` |
| `Ctrl+Space` | `{ modifiers: ["ctrl"], key: "Space" }` |
| `Cmd+Shift+V` | `{ modifiers: ["cmd", "shift"], key: "KeyV" }` |

**型别系统变更**：

```typescript
// 扩展后
export interface CustomTriggerKey {
  custom: {
    modifiers: Modifier[];  // ["ctrl", "shift", "cmd", "alt"]
    keycode: number;
  };
}
export type Modifier = "ctrl" | "shift" | "cmd" | "alt";
```

```rust
// Rust 端对应
pub struct CustomTriggerKey {
    pub modifiers: Vec<Modifier>,
    pub keycode: u16,
}
pub enum Modifier { Ctrl, Shift, Cmd, Alt }
```

**平台判定**：
- macOS：CGEventFlags 检查 modifier 状态 + keycode 匹配
- Windows：GetKeyState() 检查 modifier 状态 + VK code 匹配

**Hold/Toggle 模式**：
- Hold：modifier(s) + 普通键全部按住 → start，普通键放开 → stop
- Toggle：modifier(s) + 普通键按下 → toggle start/stop

| 决策项 | 结论 |
|--------|------|
| 组合键范围 | 0~N 个 modifier + 1 个普通键 |
| 简易模式 | 保留不动 |
| 向后相容 | 旧的 `Custom { keycode }` 解析为 `{ modifiers: [], keycode }` |

**影响范围**：
- **修改（Rust）**：`hotkey_listener.rs`（组合键判定逻辑）
- **修改（前端型别）**：`src/types/settings.ts`（CustomTriggerKey 扩展）
- **修改（前端 UI）**：`SettingsView.vue`（录制流程 + 组合键显示）
- **修改（前端 Store）**：`useSettingsStore.ts`（序列化/反序列化 + 向后相容迁移）
- **修改（前端）**：`keycodeMap.ts`（可能需新增 modifier 映射辅助函式）

---

## Section 4: 详细变更提案

### 新增 Story

#### Story 2.4: Whisper 幻觉侦测与自动学习

As a 使用者,
I want 系统自动侦测并拦截 Whisper 幻觉文字,
So that 没讲话或很短停顿时不会有乱码被贴入编辑器。

**Acceptance Criteria:**

**Given** 转录结果回传
**When** 录音时长 < 1 秒且文字 > 10 字（语速异常）
**Then** 判定为幻觉，不贴上，HUD 显示「未侦测到语音」
**And** 该文字自动加入 `hallucination_terms` 表
**And** HUD 短暂通知「已学习幻觉词：{text}」

**Given** 转录结果回传
**When** noSpeechProbability > 0.9 且文字命中幻觉词库
**Then** 判定为幻觉，不贴上

**Given** 转录结果回传
**When** 两层弱可疑指标同时成立（noSpeechProb > 0.7 且语速偏高）
**Then** 判定为幻觉，不贴上

**Given** 转录结果回传
**When** 只有一层弱可疑
**Then** 放行，正常贴上

**Given** 转录语言设定为不同语言
**When** 幻觉侦测 Layer 3 载入内建词库
**Then** 根据 `selectedTranscriptionLocale` 载入对应语言的幻觉词库
**And** `zh` 载入中文幻觉词（「谢谢收看」「字幕组」等）
**And** `en` 载入英文幻觉词（「Thank you for watching」「Subscribe」等）
**And** `auto` 载入所有语言的幻觉词库

**Given** 幻觉词库页面（HallucinationView.vue）
**When** 使用者从侧边栏开启幻觉词库页面
**Then** 显示所有幻觉词（内建 + 自动学习 + 手动新增）
**And** 使用者可手动新增/删除幻觉词

---

#### Story 4.4: 录音永久储存与历史播放

As a 使用者,
I want 每次录音档案永久储存，并可在历史记录中播放,
So that 我能回听自己说了什么，也能在辨识失败时重送。

**Acceptance Criteria:**

**Given** 录音结束
**When** `stop_recording()` 完成 WAV 编码
**Then** WAV 档案写入 `{APP_DATA}/recordings/{transcription_id}.wav`
**And** `transcriptions` 表的 `audio_file_path` 栏位记录档案路径

**Given** 转录失败（Whisper 回传空字串或幻觉拦截）
**When** 失败流程触发
**Then** 仍然写入 `transcriptions` 表，`status` 为 `failed`
**And** 录音档案仍然保存

**Given** HistoryView 显示历史记录
**When** 该记录有对应的录音档案
**Then** 显示播放按钮（▶）
**And** 点击后透过 `convertFileSrc()` + HTML5 `<audio>` 播放

**Given** HistoryView 显示历史记录
**When** 录音档案已被清理不存在
**Then** 播放按钮灰显 disabled

**Given** 设定页面
**When** 使用者查看录音储存设定
**Then** 显示「删除所有录音档」按钮
**And** 显示「自动清理」开关 + 天数设定（预设 7 天）

---

#### Story 4.5: 转录失败一键重送

As a 使用者,
I want 转录失败时可以一键重送录音给 Whisper,
So that 我不需要崩溃重讲。

**Acceptance Criteria:**

**Given** HUD 显示 error 状态
**When** 使用者点击重送按钮
**Then** 从磁碟读取上一次录音的 WAV 档案
**And** HUD 切换为「转录中...」（复用 transcribing 状态）
**And** 重新呼叫 `transcribe_audio()`

**Given** 重送成功
**When** Whisper 回传有效文字
**Then** 进入正常的 AI 整理 → 贴上流程
**And** 更新 `transcriptions` 表的 `status` 为 `success`

**Given** 重送也失败
**When** Whisper 再次回传空字串
**Then** HUD 显示「辨识失败，请重新录音」
**And** 不再提供重送按钮

**Given** HUD error 状态
**When** 重送按钮显示条件
**Then** 一律显示（不区分是否确定有说话）

---

### 修改 Story

#### Story 1.2 扩展：组合键支援

**新增 AC：**

**Given** 自订模式的按键录制
**When** 使用者按住 modifier(s) + 按一个普通键
**Then** 系统记录 `{ modifiers: [...], keycode }` 组合
**And** HUD 显示组合键名称（如「Ctrl + Space」）

**Given** 组合键已设定
**When** 使用者在任何应用程式按下相同组合
**Then** macOS 透过 CGEventFlags 验证 modifier 状态 + keycode 匹配
**And** Windows 透过 GetKeyState() 验证 modifier 状态 + VK code 匹配
**And** Hold/Toggle 模式正常运作

**Given** 旧版本使用者升级
**When** 载入旧的 `Custom { keycode }` 设定
**Then** 自动解析为 `{ modifiers: [], keycode }`（向后相容）

---

#### Story 2.2 扩展：中英混讲 prompt 强化

**新增 AC：**

**Given** Whisper API 请求即将发送
**When** `format_whisper_prompt()` 组装 prompt
**Then** 除字典词外，根据 `selectedTranscriptionLocale` 加入语言混合范例
**And** `zh` → 注入中英混合范例（如「部署 deploy, 测试 test, main.py」）
**And** `en` → 注入英中混合范例（如「deploy 部署, API endpoint」）
**And** `auto` → 注入最广泛的多语混合范例

**Given** AI 整理请求即将发送
**When** enhancer 组装 system prompt
**Then** 包含「修正语音辨识中明显的语言混淆」指令

---

## Section 5: 实作交接

### 变更范围分类：Moderate

需要多个 Story 新增/修改，跨 4 个 Epic，但不需要根本性架构重建。

### 建议发版顺序

```
 v0.8.0 ── 问题 2+3：录音储存 + 重送 + 历史播放
            Story 4.4 + Story 4.5
            DB migration v4
            最高优先：直接解决「崩溃重讲」核心痛点

 v0.9.0 ── 问题 1：幻觉侦测三层架构
            Story 2.4
            DB migration v5（hallucination_terms 表）

 v0.10.0 ─ 问题 5：组合键触发
            Story 1.2 扩展

 随时穿插 ─ 问题 4：中英混讲 prompt
            Story 2.2 扩展（最小改动）
```

### 交接对象

| 角色 | 责任 |
|------|------|
| Dev（Jackle） | 所有 Story 实作 |
| PM（Jackle） | PRD 更新、版本规划 |
| Design | design.pen 设计稿（SettingsView 新区块、HistoryView 播放、组合键 UI） |

### 成功标准

- 康富淼反馈的「崩溃重讲」场景消失（问题 2+3）
- Whisper 幻觉文字不再直接贴入（问题 1）
- 中英混讲的辨识品质使用者体感改善（问题 4）
- 使用者可设定 modifier+key 组合触发（问题 5）

---

## 后续更新记录

### 2026-03-16：幻觉侦测升级至 v2（四层架构）

问题 1 的三层幻觉侦测架构在实测中发现缺口：背景噪音（冷气、环境音）导致 `peakEnergyLevel` 超过静音门槛（0.02），Layer 2 无法触发。同时 Whisper 对幻觉可能回传 `noSpeechProbability=0.0`（极度自信的幻觉），原 NSP 相关 Layer 也无法拦截。

**变更：**
- 移除内建幻觉词库（`builtinHallucinationTerms.ts` 已删除），改为纯自动学习 + 手动新增
- Rust 端 `stop_recording()` 新增 `rms_energy_level`（均方根能量），与 peak 合并单次遍历计算
- 新增 Layer 3 背景噪音侦测（取代原 NSP+词库 Layer）：
  - 3a：`rmsEnergy < 0.008` → 极低 RMS，直接拦截（不需要 NSP）
  - 3b：`rmsEnergy < 0.015 && NSP > 0.7` → 低 RMS + 高 NSP 联合拦截
- 原 Layer 3 精确比对改编号为 Layer 4，使用自动学习 + 手动新增的词库
- `noSpeechProbability` 传入侦测函式但仅作为 Layer 3b 辅助信号
