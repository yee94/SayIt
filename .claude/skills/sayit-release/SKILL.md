---
name: sayit-release
description: SayIt 发版流程编排 — 起草 CHANGELOG、同步 4 语系升级弹窗、对齐 upgradeNoticeItemCount、最后呼叫 ./scripts/release.sh。当使用者说「准备发新版」「要 release vX.Y.Z」「准备 release v0.10.0」「要发版了」「更新 CHANGELOG」「要更新升级弹窗」「同步多语系升级提示」之类的话时必须触发；即使对方没讲「sayit-release」这几个字、只说「我们来发 v0.11.0」也要触发。负责 release.sh 之前的所有准备工作，呼叫 release.sh 前一定要先取得使用者明确同意。
---

# SayIt 发版流程

这个 skill 编排 SayIt 从「准备发新版」到「呼叫 release.sh」之间的所有准备工作。release.sh 自身负责 4 点版本号 bump、commit、tag、push；这个 skill 负责把 release.sh 需要的前置条件全部准备好，并产生使用者体感得到的 release notes（CHANGELOG）和升级弹窗（4 语系 upgradeNotice）。

## 为什么分成 skill + release.sh 两段

release.sh 的 guard 设计（working tree 干净、CHANGELOG 含目标版本区块、tag 不存在、不在 detached HEAD）让它一定能 idempotent 地完成或干净地失败。skill 不绕过这些 guard、也不重做 release.sh 已经会做的事，只负责生产 release.sh 需要的「材料」。这个分工让两边各自单纯：skill 出错不会误触 push；release.sh 改逻辑不会牵连到内容生成。

## 整体流程

```
 使用者：「准备发 v0.11.0」
     │
     ▼
 ① 对齐版本号参数（X.Y.Z 是什么？建议下一版）
     │
     ▼
 ② 搜集材料（git log 上一个 tag..HEAD、git status）
     │
     ▼
 ③ 起草 CHANGELOG（分类 → 写入顶部 → 等使用者迁订）
     │
     ▼
 ④ 起草 upgradeNotice（询问亮点 → zh-CN → 翻译 3 语 → 同步 itemCount）
     │
     ▼
 ⑤ Sanity check（4 语系 key 对齐、itemCount 对得上、CHANGELOG 含目标版本区块）
     │
     ▼
 ⑥ 询问使用者「要跑 release.sh 吗？」
     │
     │ 使用者明确同意（「跑」「部署」「go」「发吧」之类）
     ▼
 ⑦ 跑 ./scripts/release.sh X.Y.Z（只在使用者明确同意时跑）
```

## 步骤 ① 对齐版本号

在做任何事情之前先确定目标版本号 X.Y.Z。

读取当前版本：
```bash
jq -r .version /Users/jackle/workspace/say-it/src-tauri/tauri.conf.json
```

如果使用者已经在指令里明说（「发 v0.11.0」），直接用。如果没明说，用 semver 规则推荐：
- 只有 bug fix → patch（0.10.0 → 0.10.1）
- 有新功能但不破坏相容性 → minor（0.10.0 → 0.11.0）
- 破坏相容性 → major（0.10.0 → 1.0.0）

把推荐版本号告诉使用者，等他确认或修改。**版本号未确认前不要往下走**。

## 步骤 ② 搜集材料

两件事并行做：

```bash
# 上一个 tag 到目前的 commit
git -C /Users/jackle/workspace/say-it log "$(git -C /Users/jackle/workspace/say-it describe --tags --abbrev=0)..HEAD" --no-merges --pretty='%h %s'

# 确认 working tree 状态
git -C /Users/jackle/workspace/say-it status --short
```

如果 working tree 不干净，先告知使用者「目前有 N 个未 commit 变更，release.sh 会挡下来，要先处理」。让他决定是先 commit 那些变更、还是先继续 skill 流程（变更可能会被一起包进这次 release）。

## 步骤 ③ 起草 CHANGELOG

CHANGELOG.md 在专案根目录，格式固定。

### 标题格式

```markdown
## [X.Y.Z] - YYYY-MM-DD
```

日期用今天的日期（执行时取 `date +%Y-%m-%d`，不要写死）。

### 子分类

只用三个分类：

| 分类 | 何时放这里 |
|------|-----------|
| `### Added` | 新功能、新介面、新档案、新支援 |
| `### Fixed` | bug fix、错误行为修正 |
| `### Improved` | 效能优化、重构、开发体验（DX）改进、CI/CD 升级 |

不用 `### Changed` / `### Deprecated` / `### Removed` 这些 keep-a-changelog 的其他分类，SayIt 的 CHANGELOG 惯例只用上面三个。

### 从 commit 推断分类

| commit prefix | 分类 |
|---------------|------|
| `feat:` `feat(*):` | Added |
| `fix:` `fix(*):` | Fixed |
| `refactor:` `perf:` `chore(ci):` `chore(deps):` | Improved |
| `docs:` `chore:` `test:` | 不写进 CHANGELOG（内部变更，使用者无感） |

例外：如果 `chore` 的内容其实使用者有感（例如「同步多语系」「修预设值」），仍要写进 CHANGELOG，分类取决于影响面。

### 条目写法

每条 bullet 的结构：

```
- [简述使用者感受到的事]：[为什么出现问题或为什么这样设计]，[实际做的事和取舍]（#issue）
```

**范例**：

```markdown
- Gemini 2.5 系列做 AI 整理时长转录文字被截断的问题（#23、#34）：根因是 Gemini 把 thinking tokens 计入 `maxOutputTokens` 配额，原本对所有 provider 统一给 2048 token 预算被 thinking 吃掉一部分后不够用。改为 per-provider 预设：Gemini / OpenAI 16384、Anthropic / Groq 8192（后者模型上限 8192，给 16384 会被 API reject）
```

注意三件事：
1. **使用者语言而非开发者语言**：写「长转录文字被截断」不写「response.choices[0].message.content 不完整」
2. **解释 why**：不只说「修了 X」，要说「为什么 X 会坏」、「为什么选这个解法」
3. **保留技术细节**：API 名称、token 数字、档案行为、CSP 规则这些技术细节要留着（读者里有开发者）

### 写入位置

写在 CHANGELOG.md 的 `# Changelog` 标题之下，紧接着现有最新版本之前。

```markdown
# Changelog

SayIt 版本更新纪录。

## [X.Y.Z] - YYYY-MM-DD     ← 写在这里

### Added
- ...

### Fixed
- ...

### Improved
- ...

## [上一个版本] - ...        ← 已存在
```

### 起草后的检查

写完先把草稿展示给使用者，**不要直接写进档案**。等使用者说「OK」或「改 X」再实际 Edit 写入。

理由：CHANGELOG 是面向使用者的文案，每个发版的人对「什么算亮点、用什么语气、要不要提技术细节」都有不同直觉，先给使用者看草稿可以避免一改再改。

## 步骤 ④ 起草 upgradeNotice

### 机制背景

升级弹窗由 Dashboard 启动时 `consumeUpgradeNotice()` 触发，比对 `lastSeenVersion`（存在 tauri-plugin-store）和 `__APP_VERSION__`（build-time 从 package.json 注入）。不相等就显示。

需要动 5 个档案：
1. `src/MainApp.vue`：`upgradeNoticeItemCount` 常数（控制显示几个 item）
2. `src/i18n/locales/zh-CN.json`：`mainView.upgradeNotice` 区块
3. `src/i18n/locales/en.json`：同上
4. `src/i18n/locales/ja.json`：同上
5. `src/i18n/locales/ko.json`：同上

### 内容策略

每次发版只展示 1-3 个本版**最有感**的亮点。亮点要从 CHANGELOG 筛选，不是把 CHANGELOG 全贴进来。判准：

- **使用者每天都会用到、能被立刻感受到** → 优先放（例：新功能、UI 改善）
- **修一个过去常被回报的痛点** → 优先放（例：常见 bug fix）
- **内部优化、CI/CD、refactor** → 不放
- **超技术的根因说明** → 放但要转成白话

每个 item 的写法：

```
[亮点主题冒号]：[使用者场景 + 之前的问题 + 现在的体验]
```

### 翻译流程

使用者只写 zh-CN，skill 自动翻译为 en、ja、ko。**不要叫使用者写 4 种**。

#### 翻译时的 4 语系语感

| 语系 | 语感方向 | 注意 |
|------|---------|------|
| zh-CN | 简体 + 中国大陆用语：「设置」「粘贴」「连接」 | 全形标点 |
| en | plain English、技术细节保留，避免 marketing 腔 | 用 em-dash `—` 连接补述 |
| ja | 丁宁体（です・ます调）、技术文书风 | 全形标点，专业术语保留英文 |
| ko | `-합니다` 体、技术用语自然 | 半形标点 + 空格 |

#### 翻译品质检查清单

- [ ] 4 语系都涵盖了同一组「主题 + why + how」三要素
- [ ] zh-CN 全部使用简体中文和中国大陆用语
- [ ] en 使用自然英语表达，保留必要技术细节
- [ ] ja 用丁宁体一致
- [ ] ko 收尾是 `-니다`/`-습니다` 结构

### 写入步骤

```
① 询问使用者本版 1-3 个亮点主题
② 使用者用 zh-CN 描述（一两句话即可）
③ skill 把 zh-CN 整理成「主题冒号 + 使用者场景 + why + how」格式
④ skill 翻译 3 语系（en / ja / ko）
⑤ 把整组 upgradeNotice（4 语系 × N 个 item）展示给使用者审订
⑥ 使用者 OK 后实际 Edit 5 个档案：
   - 4 个 .json 的 mainView.upgradeNotice 区块
   - MainApp.vue 的 upgradeNoticeItemCount
```

### 重要：itemN 处理策略

每次发版**只保留新版本的 item**，不要累积上一版的。理由：

1. 升级弹窗的目的是让使用者快速知道「这次升级多了什么」，过往版本的 item 已经没价值
2. 累积会让弹窗越来越长，最终没人读
3. 保留旧 i18n key（item3, item4...）会让 grep / refactor 出现假阳性

所以 Edit 时：

- 新版有 N 个 item → 4 个 .json 都只留 `title` + `item1..itemN` + `dismiss`
- 旧版的 `item3..item10` 整批删掉
- `MainApp.vue` 的 `upgradeNoticeItemCount` 改成 N

## 步骤 ⑤ Sanity check

实际呼叫 release.sh 之前确认三件事，不对就回头修：

```bash
# 1. 4 个 .json 的 upgradeNotice 区块都对齐到 N 个 item + title + dismiss
rg -n '"upgradeNotice"' src/i18n/locales/ -A $((N+2))

# 2. MainApp.vue 的 itemCount 等于 N
rg -n 'upgradeNoticeItemCount = ' src/MainApp.vue

# 3. CHANGELOG.md 含 [X.Y.Z] 区块
rg -n "^## \[X.Y.Z\]" CHANGELOG.md
```

任何一项对不上，回去把它修好再走步骤 ⑥。

## 步骤 ⑥ 取得跑 release.sh 的明确同意

不要自动跑 release.sh。用 AskUserQuestion 问使用者：

- **问题**：「要不要现在跑 ./scripts/release.sh X.Y.Z？这会自动 bump 4 处版本号、commit、打 tag、push 到 remote 触发 CI/CD（不可逆）。」
- **选项**：
  - 「跑 release.sh」
  - 「先看一下 git diff 再决定」
  - 「先别跑，我手动处理」

只有第一个选项才往下跑步骤 ⑦。

## 步骤 ⑦ 跑 release.sh

```bash
cd /Users/jackle/workspace/say-it && ./scripts/release.sh X.Y.Z
```

### release.sh 可能挡下来的情况

| 讯息 | 原因 | 处理方式 |
|------|------|---------|
| `CHANGELOG.md 缺少 vX.Y.Z 的纪录` | 步骤 ③ 没写进去 | 回到步骤 ③ |
| `有未 commit 的变更` | 之前有残留 | 提示使用者「skill 改的档案还没 commit，跑 release 之前要先 commit」并协助 git add + git commit |
| `tag vX.Y.Z 已存在` | 版本号用过了 | 提示使用者要不同版本号 |
| `目前不在 git branch 上` | detached HEAD | 提示 `git switch main` |

注意：**skill 完成步骤 ④ 的 Edit 后，这些变更需要先 commit 才能跑 release.sh**。skill 在步骤 ⑥ 应该主动建议「我已经改了 CHANGELOG.md / 4 个 i18n .json / MainApp.vue 共 6 个档，要不要我 commit 起来？」，使用者同意后再 commit、再进步骤 ⑦。

### Commit message 范例

```
docs: add CHANGELOG entry for vX.Y.Z

chore: update upgradeNotice for vX.Y.Z highlights
```

或一个合并 commit：

```
docs(release): prepare vX.Y.Z release notes

- CHANGELOG.md: add vX.Y.Z section
- i18n: update upgradeNotice for 5 locales
- MainApp.vue: bump upgradeNoticeItemCount to N
```

## 共通注意事项

### 不要动 Cargo.lock

Cargo.lock 是 release.sh 自动处理的（透过 cargo build 同步 sayit crate 版本）。skill 不要手动编辑 Cargo.lock，那是 hard-block 的保护档案。

### 分支归属

主要发版从 `main` 出。如果使用者在 feature branch 上跑这个 skill，先确认意图：

- 「PR 已 merge 进 main、我刚切回 main」→ OK
- 「我在 feature branch 上想直接发」→ 提示「release.sh 不挡这个但通常不是你想要的，CI/CD release.yml 也只认 tag 不认 branch」，让使用者自己决定

### 日期一致性

CHANGELOG 标题的日期应该等于今天日期，不是亮点被开发的日期。执行时取 `date +%Y-%m-%d`，不要写死字串。

### 跨档案修改后的交叉验证

修改完 6 个档案（CHANGELOG + 4 个 .json + MainApp.vue），用步骤 ⑤ 的 sanity check 命令交叉验证一次。CLAUDE.md 规定「同时修改多个相关文件时必须交叉验证」，这一步是硬性的。

### 语音通知

每次触发此 skill 都遵守 CLAUDE.md 的语音通知规范：开始时 say、执行中 say、完成前 say。内容反映当前任务（「我来起草 CHANGELOG」「翻译 3 语完成」「等你决定要不要跑 release.sh」），20 字以内。
