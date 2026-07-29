# Changelog

SayIt 版本更新纪录。

## [0.12.5] - 2026-07-29

### Added

- 智能字典从手动修正中自动学习：转写贴上后约 30 秒持续读取当前输入框的改动，本地差分会立即把替换过的词加入字典；复杂改动再交由 AI 辅助判断，后续语音识别更贴合你的常用词
- 屏幕上下文感知（macOS）：录音时可选截取一帧屏幕并读取前台应用名，AI 整理会结合界面中的专有名词和场景用语提升文本准确度；截图只用于当次请求，需使用支持 Vision 的 LLM 和「屏幕录制」权限
- 失败记录可重新识别：保留音频的识别失败记录可在历史中直接重试转录，避免重新录制

### Fixed

- 智能字典在 HUD 获得焦点后无法读取原输入框：录音开始时保存目标应用 PID，并通过 macOS 辅助功能从目标应用读取编辑内容；Notes、多数网页和 Electron 编辑器可以持续学习修正词

### Improved

- 自定义字典管理效率提升：词条支持原地编辑、空值和重复词校验，学习成功的 HUD 提示同步显示已加入的词
- 正式版调试信息写入 Application Support 日志，便于定位识别与辅助功能问题

## [0.12.4] - 2026-07-29

### Fixed

- 全屏应用下刘海 HUD 不显示：其他应用进入 macOS 全屏后，原先用 Tauri `show()`（`makeKeyAndOrderFront`）无法可靠出现在全屏 Space；改为每次展示时重新套用 `fullScreenAuxiliary` / 高层级，并以 `orderFrontRegardless` 前置，录音与词汇学习通知在全屏场景下也能看到刘海状态

## [0.12.3] - 2026-07-29

### Fixed

- 快捷键录音反馈延迟：按下快捷键后 HUD 立即显示录音状态；麦克风启动、窗口定位和实时识别改在后台继续，提前松键、取消与重试会按序收尾

## [0.12.2] - 2026-07-28

### Improved

- macOS Dock 行为简化：打开 Dashboard 时自动显示 Dock 图标，关闭 Dashboard 后自动隐藏图标并保留菜单栏入口；设置页同步移除手动开关

## [0.12.1] - 2026-07-28

### Fixed

- 无私钥发布构建：关闭 Tauri Updater 产物与 minisign 签名步骤，三平台直接生成并发布安装包，解决构建末尾因 Updater 私钥格式缺失而失败的问题

### Improved

- 凭证操作按钮统一：ASR 与 LLM 的显示、保存按钮采用一致的宽度和排列，LLM API Key 在保存前也可直接切换显示状态

## [0.12.0] - 2026-07-28

### Added

- 录音时实时显示识别字幕：豆包 SeedASR 改为录音期间持续流式传输，HUD 会随语音更新文字；停止录音后直接收取 final 结果，连接异常时仍会回退到原本的整段转录流程
- Typeless 词典一键导入（macOS）：可读取本机已登录的 Typeless 词典，批量加入 SayIt 自定义字典；既有词条与大小写重复项会自动跳过，Windows 会显示平台支持提示
- 简体中文成为新安装默认语言：系统语言为裸 `zh` 时默认使用 `zh-CN`，界面、格式化文字、默认 Prompt 与错误信息同步采用简体中文

### Improved

- 发布流程改为无开发者认证构建：macOS 使用 ad-hoc 签名，Windows 产出未签名安装程序；保留 Tauri Updater minisign 验证，更新来源切换至 `yee94/SayIt`
- Release 加入完整质量门禁：Vue 类型、ESLint、Vitest，以及 macOS／Windows Rust Clippy 和测试全部通过后，才开始建立三平台安装包并自动公开 GitHub Release
- App 品牌、设置页与项目说明更新为当前的豆包 SeedASR、OpenAI 兼容 LLM 和四语产品状态

## [0.11.0] - 2026-07-12

### Added

- 「隐藏 Dock 图示」设定（macOS）（#56）：启用后 App 只留选单列图示；切换即时生效（内建 `setDockVisibility` + capability），启动时由 Rust 端读取设定套用，全程 non-fatal
- Azure 之外四家供应商模型清单全面迁移（#68）：因应 Groq 2026-07-17 起下架旧模型与 claude-3-5-haiku retired，换上八个最新经济型模型（Groq 预设 qwen3.6-27b、Gemini 预设 3.5-flash、OpenAI 预设 gpt-5.6-luna、Anthropic haiku-4-5）；`DECOMMISSIONED_MODEL_MAP` 链式解析让旧设定自动迁移、不需重新设定
- 语意守卫 `hallucinationDetector`（#43）：侦测 AI 整理输出与逐字稿语意脱钩时自动改贴原始逐字稿，不再凭空输出
- 转译结果简→繁确定性转换 `simplifiedToTraditional`（#39）
- 语音转文字自动重试（#10）：429 尊重 `Retry-After`（上限 10 秒）、5xx／连线失败走 1s/2s backoff、最多 3 次尝试；timeout 与 4xx 不重试；连线测试不受影响
- 仪表板显示付费 LLM 供应商今日用量（#62，@lettucebo）；用量趋势图零值补齐 + 稀疏资料座标轴修正（#59，@lettucebo）
- Windows UIA text-field reader + fail-closed guard，智慧字典基础建设（#64，@lettucebo）
- 每次更新后首次开启 Dashboard 弹出「更新摘要」，列出本版重点（沿用升级提示机制、四语系）

### Fixed

- 编辑模式选取侦测全面重写（#24、#25、#36）：以 macOS Accessibility 被动查询（`read_selection_state` 三态）取代「录音开始就模拟 Cmd+C」，根治无选取误触发编辑模式与按住触发键冒出「c」字的问题；AX 不可用的 App（如 Heptabase）自动退到「停止录音后 250ms 剪贴簿后备」；录音世代编号防跨录音状态污染
- 转译错误全被标成「操作失败」的问题（#37、#38）：错误分类改能处理字串型错误并比对真实讯息，429／5xx／网路问题现在分级显示
- OpenAI GPT-5.x 整理必定失败的问题：停送 `temperature`、改送 `reasoning_effort: "none"`（5.6 世代已移除 `minimal`）；Gemini 3.x 以 `thinkingConfig.thinkingLevel: "MINIMAL"` 压制思考输出
- DB 迁移在 connection pool 下的竞态（#65，@lettucebo）：connection-pool-safe migrations + `DATABASE_READY` handshake
- 转译 HTTP client 改用 rustls（#63，@lettucebo）：解决部分环境 TLS 连线问题
- Windows 端既有 clippy lint 错误清理（#57，@lettucebo）

### Improved

- API 用量 fallback 单价更新为 gemini-3.5-flash 天花板；Gemini 免费额度显示改为「已使用 N 次」纯用量（不再显示误导的剩余进度条）

### Added

- 设定中的「测试连线」按钮：可即时验证当前 LLM Provider / Whisper 模型的 API key 与连线是否正常，失败时显示具体原因（API key 无效 / 额度不足 / 服务端问题 / 网路问题），让使用者能自助 debug 设定问题（#34）
- 设定可选择「自动贴上后还原原本剪贴簿内容」：之前 SayIt 把转录文字写进剪贴簿后就留在那里，使用者原本复制的东西被覆盖。新增「将转录文字复制到剪贴簿」toggle（设定 → 一般），预设 ON 保留现行行为（避免回归），关闭时 SayIt 会在贴上后 200ms 还原使用者原本的剪贴簿（纯文字场景；图片/档案因 arboard 无法无损 snapshot 而保持不动）（#35）

### Fixed

- Gemini 2.5 系列做 AI 整理时长转录文字被截断的问题（#23、#34）：根因是 Gemini 把 thinking tokens 计入 `maxOutputTokens` 配额，原本对所有 provider 统一给 2048 token 预算被 thinking 吃掉一部分后不够用。改为 per-provider 预设：Gemini / OpenAI 16384、Anthropic / Groq 8192（后者模型上限 8192，给 16384 会被 API reject）
- 使用 OpenAI 或 Anthropic 整理时被 Content Security Policy 阻挡的问题：`connect-src` 加入 `api.openai.com` 与 `api.anthropic.com`
- 转录失败 catch path 没写入 `rmsEnergyLevel` 的问题：补上 assignment，避免幻觉侦测 fallback 逻辑收到 undefined

### Improved

- LlmProviderId switch 加上 exhaustiveness assertion：未来新增 provider 时编译期会抓到漏处理的 case
- 错误传递链保留 `cause`：debug 时能看到完整堆叠
- CI 升级：push/PR 触发 ESLint + cargo clippy + cargo test，避免 lint/test 倒退被 merge

## [0.9.5] - 2026-05-01

### Fixed

- 同时启动多个 SayIt 实例造成热键触发后重复录音、重复贴上的问题（Windows 受影响，macOS 因 Launch Services 预设单例较少触发）：导入 `tauri-plugin-single-instance`，第二个实例启动时立即退出，并把现有实例的 Dashboard 视窗叫到前景

## [0.9.4] - 2026-04-07

### Fixed

- 自订字典在某些 Windows 环境下新增词汇时报「table vocabulary has no column named source」的问题（#27）：在 DB 初始化的关键表验证阶段新增幂等的 vocabulary column 自我修复逻辑，无论 schema_version 为何都会检查并补上缺失的 weight/source 栏位

## [0.9.3] - 2026-03-28

### Fixed

- 简易模式 Fn 快捷键在 Globe 键 MacBook 上一触发就马上送出的问题：FlagsChanged handler 从 toggle-based 改为 flag-based 侦测，只回应 keycode 63 事件

## [0.9.2] - 2026-03-28

### Added

- Google Gemini LLM Provider：支援 Gemini 2.5 Flash 和 Flash-Lite（有免费额度），新增 API Key 管理、request/response 格式转换
- Gemini SAFETY block 侦测：`finishReason` 非 STOP 时抛出有意义的错误，不再静默 fallback
- Gemini 单元测试：buildFetchParams + parseProviderResponse + helpers（6 个测试）
- Tauri HTTP scope + CSP 加入 `generativelanguage.googleapis.com`
- 升级通知合并 LLM provider 项目，新增 Gemini 说明
- OpenAI 标示「推荐」（4 语系）

### Changed

- Provider 排序：Groq → Gemini → OpenAI → Anthropic（免费的在前面）
- Provider RadioGroup 从 3 栏改 2 栏（4 个 provider 排 2×2）
- 4 语系 provider description 加入 Gemini 有免费额度

## [0.9.1] - 2026-03-28

### Fixed

- HUD notch 宽度加宽（350→420px），避免录音中模式标签被 MacBook camera 区域遮挡
- mode-switch notch 宽度加宽（200→350px），确保切换模式标签完整显示
- mode-switch 消失时新增 collapsing 缩小动画（原为直接淡出）
- Tauri HUD 视窗与 Rust 定位常数同步更新（400→470px）

## [0.9.0] - 2026-03-28

### Added

- 编辑选取文字功能：选取文字后触发 SayIt，语音变成 AI 指令（翻译、改写、摘要等），处理结果直接取代原文
- Rust `read_selected_text` command：macOS AXSelectedText 读取选取文字，共用 `FocusedElementContext` AX 走访结构
- 功能介绍页面：侧边栏新增「功能介绍」（Lightbulb icon），展示 8 个操作功能卡片
- Edit mode prompt 模板：四语系编辑模式专用 prompt（`EDIT_MODE_PROMPTS`）
- `EnhanceOptions.maxTokens`：edit mode 使用 4096（既有增强为 2048）
- DB migration v7→v8：`is_edit_mode`、`edit_source_text` 栏位
- HUD 琥珀色「编辑」badge + `HudStatus: "editing"` 状态
- 升级通知新增 item9（编辑选取文字）并依亮点重新排序

### Improved

- Rust `text_field_reader.rs` 重构：提取 `FocusedElementContext` struct 消除 ~50 行重复 AX 走访逻辑
- `isEditMode` 改为 computed（从 `editSourceText` 推导），消除冗余 state
- `read_selected_text` 非阻塞侦测（`.then()`），不延迟开始音效
- HUD badge CSS 提取 `.hud-badge` 共用 base class
- `useHistoryStore` SQL SELECT 栏位提取 `TRANSCRIPTION_SELECT_COLUMNS` 常数
- 功能介绍文案改为生活化口吻（四语系）

## [0.8.9] - 2026-03-19

### Fixed

- 修正 macOS 上选择特定麦克风后停止录音，麦克风指示灯（橘色圆点）不消失的安全问题：cpal 0.15.3 CoreAudio backend 对非预设装置建立 disconnect listener 造成 Arc 循环引用，AudioUnit 永不释放。修正方式为优先使用 default_input_device() 避免循环引用，并在停止时显式呼叫 stream.pause() 作为兜底防御

## [0.8.8] - 2026-03-18

### Added

- 麦克风选择功能：设定中可指定录音使用的输入装置（Rust `list_audio_input_devices` + `start_recording` 接受 `device_name`）
- Enhancement anomaly 侦测：LLM 输出异常时自动重试（最多 3 次），仍异常则 fallback 到原始文字

### Improved

- Layer 2b peak energy escape hatch：peak >= 0.03 时跳过 RMS+NSP 检查，减少小声说话「未侦测到语音」误报
- Enhancer temperature 从 0.3 降至 0.1，输出更稳定
- Active prompt 规则：合并重复表达时保留语气（问句仍是问句），新增禁止将问句改写为肯定句

### Fixed

- `getMicrophoneErrorMessage` 支援 Rust AudioRecorderError 字串匹配（No input device / Failed to build audio stream / Failed to get input config）

## [0.8.7](https://github.com/yee94/SayIt/releases/tag/v0.8.7) - 2026-03-17

### Changed

- AI 整理预设模型切换为 Kimi K2（既有使用者首次更新自动迁移，可在设定中改回）
- 重写积极模式 prompt（四语言）：修正 AI 整理会回答逐字稿中的问题而非整理文字

### Improved

- 简化幻觉侦测系统：移除幻觉字典和自动学习机制，改为纯物理信号二层侦测（语速异常 + 无人声），不再误判正常语句
- 移除 RMS 单独判断，所有 RMS 侦测需搭配 Whisper NSP 联合确认，避免小声说话被误判

### Removed

- 移除幻觉字典功能（DB table、Store、管理页面、Sidebar 导航、自动学习、HUD 通知）

## [0.8.6](https://github.com/yee94/SayIt/releases/tag/v0.8.6) - 2026-03-16

### Fixed

- 修正历史纪录播放录音在正式版（production build）无声的问题：macOS 上 convertFileSrc 产生的 asset:// URL 被 CSP 阻挡，改用 Rust IPC 读取位元组 + Blob URL 播放，dev/production 行为一致
- 修正快速连点不同纪录时播放与 UI 状态不同步的 race condition
- 播放失败时新增 Sentry 错误回报（原本静默吞错）
- 修正 read_recording_file command 的安全性：改为接受 id 参数，Rust 端组合路径，避免任意档案读取风险

## [0.8.5](https://github.com/yee94/SayIt/releases/tag/v0.8.5) - 2026-03-16

### Fixed

- 彻底修正版本升级后资料库初始化失败（database is locked / no such table）：HUD 视窗不再呼叫 Database.load()，改用 connectToDatabase() 等待 Dashboard 建好连线池后复用，从架构层面消除连线池覆盖的竞态条件
- 自动恢复先前版本损坏导致遗失的 api_usage 表
- 升级提示弹窗新增资料库修复说明

## [0.8.4](https://github.com/yee94/SayIt/releases/tag/v0.8.4) - 2026-03-16

### Fixed

- 修正版本升级后「no such table: api_usage」错误：HUD 视窗的 Database.load() 覆盖 Dashboard 的连线池，导致 migration 中的 DROP TABLE 失去 transaction 保护
- 防止连线池覆盖：第二个视窗改用 Database.get() 复用既有连线池
- 自动恢复遗失的 api_usage 表：migration 结束后验证关键表是否存在，不存在则重建

## [0.8.3](https://github.com/yee94/SayIt/releases/tag/v0.8.3) - 2026-03-16

### Fixed

- 修正版本升级后首次启动出现「database is locked (code: 5)」错误：HUD 与 Dashboard 双视窗同时初始化资料库导致竞态条件，加入 Promise lock 序列化初始化 + PRAGMA busy_timeout 防护

## [0.8.2](https://github.com/yee94/SayIt/releases/tag/v0.8.2) - 2026-03-16

### Fixed

- 修正旧版升级（v0.6.0 以前、v0.7.x）资料库初始化失败：ALTER TABLE ADD COLUMN 在 transaction 内对后续语句不可见，导致 "no such column: weight" 或 "no such column: status" 错误
- 修正仪表板「平均每次字数」偏高：改用原始辨识字数计算，不再受 AI 整理后文字膨胀影响
- 修正仪表板「节省时间」高估：公式改为（打字时间 − 口述时间），而非仅计算打字时间

## [0.8.1](https://github.com/yee94/SayIt/releases/tag/v0.8.1) - 2026-03-16

### Fixed

- 修正资料库升级（v2→v3、v3→v4）可能因重复栏位名而失败，导致历史记录无法显示的问题
- 修正语音辨识幻觉侦测误判：Whisper noSpeechProbability 聚合策略从 MAX 改为 MIN，避免有说话却被判定为「未侦测到语音」
- 修正升级后更新摘要未显示：改为版本号比对机制，所有升级的使用者都能看到更新内容
- 修正自动更新通知弹在隐藏视窗：下载完成后自动显示 Dashboard 视窗
- 修正自动更新只在启动时检查一次：恢复定时检查机制（每 15 分钟）

## [0.8.0](https://github.com/yee94/SayIt/releases/tag/v0.8.0) - 2026-03-16

### AI 整理模式切换

新增三种 AI 整理模式，可在设定页快速切换：

- **精简模式**：修错字、去赘词、补标点，保持原句结构
- **积极模式**（类似 Typeless）：理解语意后重新排版，以段落和列点呈现
- **自订模式**：使用自订 Prompt

旧版使用者升级后，自订 Prompt 会自动保留；使用预设值的使用者将自动迁移至精简模式。

### Added

- 录音档自动储存，历史记录可播放与重新转录
- Whisper 幻觉侦测与自动学习，减少无声时的错误文字
- 按 ESC 可随时取消录音、转录或 AI 整理
- 音效回馈：录音开始、结束及错误时播放提示音（可在设定中开关）
- 历史记录展开后原始文字旁新增复制按钮
- 升级提示 Dialog：旧版使用者首次开启时显示更新摘要

### Changed

- HUD 状态显示优化与辅助使用权限引导改善
- 幻觉侦测升级为 RMS 能量 + 4 层侦测机制，移除内建词库

## [0.7.3](https://github.com/yee94/SayIt/releases/tag/v0.7.3) - 2026-03-13

### Fixed

- 修复英文语句含重复冠词（the、and 等）被误判为「未侦测到语音」的问题
- 移除 Whisper 幻听拦截机制，非空转录结果一律贴上，让使用者自行判断模型输出品质

## [0.7.2](https://github.com/yee94/SayIt/releases/tag/v0.7.2) - 2026-03-11

### Added

- 字典分析模型独立设定：文字整理与字典分析可分别选用最适合的 AI 模型
- 新增 Kimi K2 Instruct 模型选项（文字整理 + 字典分析皆可选）
- 模型下拉选单新增特色标签（平衡 · 预设 / 稳定可靠 · 成本高 / 最快 · 最便宜 / 最聪明 · 较慢）

### Fixed

- 修复模型下拉选单选中后 Badge 文字与模型名称黏在一起的问题

## [0.7.1](https://github.com/yee94/SayIt/releases/tag/v0.7.1) - 2026-03-10

### Fixed

- 移除已下架的 Llama 4 Maverick 17B 模型选项（Groq 已停用），已选用的使用者自动迁移至 Qwen3 32B

## [0.7.0](https://github.com/yee94/SayIt/releases/tag/v0.7.0) - 2026-03-10

### 智慧字典学习

SayIt 现在会自动从你的修正中学习。每次语音输入贴上后，如果你修改了文字，系统会侦测修正内容并透过 AI 分析，将专有名词和术语自动加入字典。字典越丰富，语音辨识就越准确——你用得越多，它就越懂你。

- 贴上后自动侦测修正，AI 筛选出值得学习的词汇
- 字典权重系统：常用词优先送入辨识提示，越常被修正的词权重越高
- 字典页面改版：AI 推荐与手动新增分区显示，附权重标示
- HUD 即时通知新学习的词汇
- 设定中可开关（macOS 预设开启）

## [0.6.0](https://github.com/yee94/SayIt/releases/tag/v0.6.0) - 2026-03-09

### Added

- 转录语言独立设定：UI 语言与 Whisper 语言可分开选择，支援「自动侦测」模式
- Sentry 错误监控全覆盖：29 个 captureError 呼叫点 + 全域错误处理器（双视窗）

### Changed

- macOS 贴上机制改为 CGEvent Cmd+V 模拟，修复 LINE 等无标准 Edit 选单的 App 贴上失败问题

### Fixed

- 修复自动更新后 App 无法重新启动的问题（_exit(0) 截杀 Tauri restart 逻辑）

## [0.5.0](https://github.com/yee94/SayIt/releases/tag/v0.5.0) - 2026-03-08

### Added

- 录音开始／结束音效回馈，让使用者明确感知录音状态

## [0.4.0](https://github.com/yee94/SayIt/releases/tag/v0.4.0) - 2026-03-08

### Added

- 多语言（i18n）支援：vue-i18n 基础建设、所有 Vue 元件与 views 国际化、Stores/Lib/Rust 转录层整合

### Fixed

- 强化 Whisper 静音幻觉侦测，减少无声片段产生错误转录

## [0.3.0](https://github.com/yee94/SayIt/releases/tag/v0.3.0) - 2026-03-08

### Added

- 跨平台自动贴上功能（macOS AX API + Windows SendInput）
- 音讯录制与转录迁移至 Rust 原生管线，提升效能与稳定性
- 优雅关机与持久化键盘监控机制

### Fixed

- 修正 Sentry sourcemap upload 指令与 release publish 设定

## [0.2.5](https://github.com/yee94/SayIt/releases/tag/v0.2.5) - 2026-03-06

### Added

- Sentry release 自动化整合

### Fixed

- 修复语音 fallback 机制与设定同步更新问题

## [0.2.4](https://github.com/yee94/SayIt/releases/tag/v0.2.4) - 2026-03-06

### Changed

- 优化预设 prompt 防护性，切换预设模型为 Qwen3 32B

## [0.2.3](https://github.com/yee94/SayIt/releases/tag/v0.2.3) - 2026-03-06

### Fixed

- Dashboard 额度文字修正与短文字门槛预设停用
- 停用 Dashboard 右键选单并移除重复的更新检查

## [0.2.2](https://github.com/yee94/SayIt/releases/tag/v0.2.2) - 2026-03-06

### Fixed

- 重构自动更新流程，修复检查更新无回应问题

## [0.2.1](https://github.com/yee94/SayIt/releases/tag/v0.2.1) - 2026-03-06

### Added

- 设定页新增「关于 SayIt」区块与社群连结

### Fixed

- 修正 stable-name asset 上传路径以支援 cross-compilation
- 新增 workflow_dispatch 触发器并分离 tag 推送

## [0.2.0](https://github.com/yee94/SayIt/releases/tag/v0.2.0) - 2026-03-06

### Added

- 自动更新 UI 与定时检查机制（启动 5 秒后首次检查，每 4 小时定期检查）
- CI/CD stable-name asset 上传至 GitHub Release

### Fixed

- 授予辅助使用权限后自动侦测并启用快捷键

## [0.1.0](https://github.com/yee94/SayIt/releases/tag/v0.1.0) - 2026-03-05

### Added

- 语音转文字核心功能（Groq Whisper API）
- HUD + Dashboard 双视窗架构
- 全域快捷键系统（OS 原生 API，支援自订录制）
- API Key 安全储存（tauri-plugin-store）
- 转录历史记录与搜寻（SQLite）
- AI 文字强化（Groq LLM）
- API 用量追踪与每日免费额度
- 多萤幕 HUD 追踪定位
- 可调整文字强化门槛
- macOS Accessibility 权限导引
- CI/CD pipeline 与 Apple Code Signing
- 录音自动静音系统喇叭
