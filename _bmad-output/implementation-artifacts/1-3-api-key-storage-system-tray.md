# Story 1.3: API Key 安全储存与 System Tray 整合

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 安全地储存我的 Groq API Key 并从 System Tray 开启主视窗,
So that 我的 API Key 不会外泄，且能方便地存取 App 设定。

## Acceptance Criteria

1. **API Key 本地储存** — 使用者在 SettingsView 的 API Key 输入框中输入 API Key 并储存。API Key 透过 tauri-plugin-store 储存于本地 `settings.json`（明文 JSON，安全依赖 OS 档案系统权限，不存入 SQLite）。输入框以密码模式显示（遮罩）。useSettingsStore 更新 `hasApiKey` 状态。

2. **API Key 读取与使用** — App 启动或其他模组需要 API Key 时，可从 tauri-plugin-store 读取已储存的 API Key。API Key 仅在记忆体中供 `transcriber.ts`（及未来 `enhancer.ts`）使用。`transcriber.ts` 不再从 `import.meta.env.VITE_GROQ_API_KEY` 读取。

3. **System Tray 选单开启 Main Window** — 使用者透过 System Tray 右键选单的「开启 Dashboard」项目开启 Main Window 并显示 Dashboard 页面。若 Main Window 已开启，则将其带至前景。（两平台统一透过选单开启，不监听 tray icon 点击事件）

4. **首次启动引导** — App 首次启动且无 API Key 时，自动开启 Main Window 并导向 Settings 页面的 API Key 区块，显示提示讯息引导使用者输入 API Key。

5. **System Tray 右键选单** — 使用者右键点击 System Tray 图示时，显示选单项目：「开启 Dashboard」、「结束」。选择「开启 Dashboard」开启 Main Window。选择「结束」关闭 App。

## Tasks / Subtasks

- [x] Task 1: 扩展 System Tray 选单与视窗管理 (AC: #3, #5)
  - [x] 1.1 在 `lib.rs` 新增 `"open-dashboard"` 选单项目（`MenuItem::with_id`），排在 `"quit"` 之前
  - [x] 1.2 `on_menu_event` 新增 `"open-dashboard"` 处理：呼叫 `show_main_window()` 辅助函式
  - [x] 1.3 建立 `show_main_window(app: &AppHandle)` 辅助函式：
    - `app.get_webview_window("main-window")` 取得视窗
    - 若视窗存在：`window.show()` + `window.set_focus()`
    - 若视窗不存在：不做动作（双视窗在 tauri.conf.json 定义，App 生命周期内始终存在）
  - [x] 1.4 保留既有的 `"quit"` 选单项目行为不变（不加入 `on_tray_icon_event`，两平台统一透过选单开启视窗）

- [x] Task 2: 实作 API Key 储存与读取逻辑 (AC: #1, #2)
  - [x] 2.1 在 `useSettingsStore.ts` 新增 `apiKey` 私有 ref（不对外暴露原始值）：
    - `const apiKey = ref<string>("")` — 仅在 store 内部使用
    - 将现有 `const hasApiKey = ref(false)` 改为 `const hasApiKey = computed(() => apiKey.value !== "")` — 自动根据 apiKey 计算，不需手动更新
  - [x] 2.2 新增 `getApiKey(): string` getter — 回传 `apiKey.value`，供 `transcriber.ts` 和未来 `enhancer.ts` 使用
  - [x] 2.3 新增 `saveApiKey(key: string)` action：
    - 验证输入：`key.trim()` 非空，否则抛出错误
    - 使用 `await load(STORE_NAME)` 载入 store（与现有 `loadSettings()` 一致）
    - `await store.set("groqApiKey", key.trim())` 写入 API Key
    - `await store.save()` 确保持久化
    - 更新 `apiKey.value = key.trim()`（`hasApiKey` 为 computed 自动更新）
    - 包裹 try/catch 错误处理（遵循 `saveHotkeyConfig` 模式）
  - [x] 2.4 新增 `deleteApiKey()` action：
    - 使用 `await load(STORE_NAME)` 载入 store
    - `await store.delete("groqApiKey")`
    - `await store.save()`
    - 重置 `apiKey.value = ""`（`hasApiKey` 为 computed 自动更新为 false）
    - 包裹 try/catch 错误处理
  - [x] 2.5 扩展现有 `loadSettings()` — 新增读取 `groqApiKey`：
    - `const savedKey = await store.get<string>("groqApiKey")`
    - 若存在：设定 `apiKey.value = savedKey`（`hasApiKey` 为 computed 自动更新）
    - 若不存在：保持预设值
  - [x] 2.6 汇出 `hasApiKey`（computed，自动 readonly）和 `getApiKey`、`saveApiKey`、`deleteApiKey` action
  - [x] 2.7 移除 `saveSettings()` 空函式和 TODO 注解（各别 save 函式已取代其用途）

- [x] Task 3: 改造 transcriber.ts 的 API Key 来源 (AC: #2)
  - [x] 3.1 移除 `transcriber.ts` 中的 `import.meta.env.VITE_GROQ_API_KEY` 读取
  - [x] 3.2 修改 `transcribeAudio` 函式签名，新增 `apiKey: string` 参数
  - [x] 3.3 函式内使用传入的 `apiKey` 设定 `Authorization: Bearer ${apiKey}` header
  - [x] 3.4 若 `apiKey` 为空，抛出 `Error("API Key 未设定，请至设定页面输入 Groq API Key")`
  - [x] 3.5 更新 `useVoiceFlow.ts` 中的 `transcribeAudio` 呼叫：
    - 从 `useSettingsStore().getApiKey()` 取得 API Key
    - 传入 `transcribeAudio(audioBlob, apiKey)`
    - 若 API Key 未设定，emit `voice-flow:state-changed` 带 error 讯息引导设定

- [x] Task 4: 建立 SettingsView API Key 区块 UI (AC: #1, #4)
  - [x] 4.1 在 `SettingsView.vue` 新增 API Key 设定区块：
    - 区块标题「Groq API Key」
    - 状态 badge：已设定（绿）/ 未设定（红）
  - [x] 4.2 API Key 输入栏位：
    - `<input :type="isApiKeyVisible ? 'text' : 'password'">`
    - 眼睛图示切换显示/隐藏（`isApiKeyVisible` toggle）
    - placeholder：`"gsk_..."`
  - [x] 4.3 操作按钮：
    - 「储存」按钮 → 呼叫 `settingsStore.saveApiKey(inputValue)`
    - 「删除」按钮（仅 hasApiKey 时显示）→ 确认后呼叫 `settingsStore.deleteApiKey()`
  - [x] 4.4 储存成功/失败的短暂回馈提示（Tailwind transition）
  - [x] 4.5 API Key 取得说明连结或文字提示（引导使用者到 Groq Console 取得 Key）
  - [x] 4.6 使用既有 Tailwind 深色风格（`bg-zinc-900`, `text-white`, `text-zinc-400` 等，参考 `MainApp.vue`）

- [x] Task 5: 首次启动 API Key 引导 (AC: #4)
  - [x] 5.1 在前端 `main-window.ts` 的 `bootstrap()` 中，`loadSettings()` 完成后检查 `hasApiKey`：
    - 若 `hasApiKey === false`：先 `router.push('/settings')` 导向设定页面
    - 等待 `nextTick()` 确保路由渲染完成
    - 再 `getCurrentWindow().show()` + `setFocus()` 显示 Main Window（避免闪烁 Dashboard）
  - [x] 5.2 在 SettingsView 中，根据 `!hasApiKey` 状态显示引导提示（不使用 route query parameter）：
    - 「欢迎使用 SayIt！请先设定 Groq API Key 以启用语音输入功能。」
    - 提供 Groq Console 连结
    - 设定 API Key 后引导提示自动消失（hasApiKey 为 computed，自动更新）

- [x] Task 6: 整合验证 (AC: #1-5)
  - [x] 6.1 `cargo check` 通过
  - [x] 6.2 `vue-tsc --noEmit` 通过（消除 transcriber.ts 的 `import.meta.env` 型别错误）
  - [x] 6.3 手动测试：API Key 储存 → 重启 App → API Key 仍可读取
  - [x] 6.4 手动测试：无 API Key 时 App 启动引导至设定页面
  - [x] 6.5 手动测试：有 API Key 时录音→转录→贴上流程正常
  - [x] 6.6 手动测试：System Tray 右键选单「开启 Dashboard」开启 Main Window
  - [x] 6.7 手动测试：System Tray 右键选单「结束」关闭 App
  - [x] 6.8 手动测试：Main Window 已开启时再选「开启 Dashboard」，视窗带至前景

## Dev Notes

### 架构模式与约束

**Brownfield 专案** — 基于 Story 1.1（V2 基础架构）和 Story 1.2（跨平台热键系统）继续扩展。

**依赖方向规则（严格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**禁止：**
- ❌ views/ 直接呼叫 lib/（必须透过 store）
- ❌ API Key 存入 SQLite（只用 tauri-plugin-store）
- ❌ 在元件中直接执行 SQL

### tauri-plugin-store 使用要点

**依赖状态：已安装，不需新增依赖。**

| 项目 | 状态 |
|------|------|
| `tauri-plugin-store` (Cargo.toml) | ✅ ~2.4 已安装 |
| `@tauri-apps/plugin-store` (package.json) | ✅ ^2.4.2 已安装 |
| `store:default` (capabilities/default.json) | ✅ 已有权限 |
| lib.rs plugin 注册 | ✅ `tauri_plugin_store::Builder::default().build()` 已注册 |

**前端 API 用法（与现有 useSettingsStore 一致）：**
```typescript
import { load } from "@tauri-apps/plugin-store";

// 载入 store（使用现有的 STORE_NAME 常数，与 loadSettings() 中已使用的方式一致）
const store = await load(STORE_NAME);  // STORE_NAME = "settings.json"

// 设值
await store.set("groqApiKey", apiKeyValue);

// 取值（支援泛型）
const key = await store.get<string>("groqApiKey");

// 删除
await store.delete("groqApiKey");

// 持久化（autoSave 会自动触发，但建议关键操作后手动 save）
await store.save();
```

**重要：tauri-plugin-store 为明文 JSON 储存。** 储存的 `settings.json` 是明文 JSON 档案，安全依赖 OS 档案系统权限（App Data 目录仅限当前使用者存取）。API Key 不暴露于日志、网路传输或 Tauri Events。这是已确认的架构决策（内部效率工具，明文本地储存安全等级已足够），不需要改用 stronghold。

**Store 档案位置：** 各平台的 App Data 目录（macOS: `~/Library/Application Support/com.sayit.app/settings.json`）

### transcriber.ts 改造重点

**现有 API Key 读取方式（需替换）：**
```typescript
// ❌ 现有方式 — 从 .env 环境变数读取
const apiKey = import.meta.env.VITE_GROQ_API_KEY;
if (!apiKey) {
  throw new Error("VITE_GROQ_API_KEY is not set in .env");
}
```

**改为参数注入：**
```typescript
// ✅ 新方式 — 透过参数传入
export async function transcribeAudio(audioBlob: Blob, apiKey: string): Promise<TranscriptionResult> {
  if (!apiKey) {
    throw new Error("API Key 未设定，请至设定页面输入 Groq API Key");
  }
  // 使用 apiKey 设定 Authorization header
  // ...
}
```

**呼叫端（useVoiceFlow.ts）改动：**
```typescript
const settingsStore = useSettingsStore();
const apiKey = settingsStore.getApiKey();
if (!apiKey) {
  // emit error 引导使用者到设定页面
  return;
}
const result = await transcribeAudio(audioBlob, apiKey);
```

**副作用：** 移除 `import.meta.env.VITE_GROQ_API_KEY` 将同时消除 `transcriber.ts:17` 的既存 `vue-tsc` 型别错误（前两个 Story 已注记为非范围内问题，本 Story 自然修复）。

### System Tray 改造重点

**现有 Tray 程式码（lib.rs）：**
```rust
// 只有 quit 选单项
let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&quit_item])?;

TrayIconBuilder::new()
    .menu(&menu)
    .tooltip("SayIt")
    .on_menu_event(|app, event| match event.id.as_ref() {
        "quit" => { app.exit(0); }
        _ => {}
    })
    .build(app)?;
```

**需要改为：**
```rust
// 新增「开启 Dashboard」选单项
let open_item = MenuItem::with_id(app, "open-dashboard", "开启 Dashboard", true, None::<&str>)?;
let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

TrayIconBuilder::new()
    .menu(&menu)
    .tooltip("SayIt")
    .on_menu_event(|app, event| match event.id.as_ref() {
        "open-dashboard" => { show_main_window(app); }
        "quit" => { app.exit(0); }
        _ => {}
    })
    // 不加入 on_tray_icon_event — 两平台统一透过选单开启视窗
    .build(app)?;
```

**show_main_window 辅助函式：**
```rust
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main-window") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
```

**注意事项：**
- 视窗 label 是 `"main-window"`（tauri.conf.json 中定义）
- `visible: false` 是预设值 — 视窗物件始终存在但隐藏
- `show()` + `set_focus()` 组合确保视窗可见且在前景

### 首次启动引导逻辑

**推荐方案：前端驱动（main-window.ts）**

```typescript
// main-window.ts bootstrap() 中
async function bootstrap() {
  await initializeDatabase();
  const pinia = createPinia();
  const app = createApp(MainApp).use(pinia).use(router);
  app.mount("#app");

  // 首次启动引导
  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();
  if (!settingsStore.hasApiKey) {
    // 先导向设定页面，再显示视窗，避免闪烁 Dashboard
    router.push("/settings");
    const { nextTick } = await import("vue");
    await nextTick();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().show();
    await getCurrentWindow().setFocus();
  }
}
```

**为何前端驱动优于 Rust 驱动：**
- `hasApiKey` 的判断需要读取 tauri-plugin-store，前端已有 Store API
- 路由跳转需要在 Vue Router 层面完成
- Rust 侧不需要知道 API Key 状态（前端直接呼叫 Groq API）

### 现有 useSettingsStore 程式码分析

**已实作（Story 1.2）：**
- `hotkeyConfig` ref + `triggerMode` computed
- `loadSettings()` — 读取 hotkeyTriggerKey、hotkeyTriggerMode，同步 Rust
- `saveHotkeyConfig()` — 写入 store + invoke update_hotkey_config
- Store 名称：`"settings.json"`

**待实作（本 Story）：**
- `apiKey` ref（私有，不对外暴露）
- `hasApiKey` 改为 `computed(() => apiKey.value !== "")`
- `getApiKey(): string` getter（回传 apiKey.value）
- `saveApiKey(key: string)` / `deleteApiKey()` actions
- `loadSettings()` 扩展读取 groqApiKey
- 移除 `saveSettings()` 空函式和 TODO 注解（各别 save 函式已取代）

**Store 实例共用：** `loadSettings()` 已有 `const store = await load(STORE_NAME)`，新增的 API Key 操作使用相同 `STORE_NAME` 常数。`load()` 内部有快取机制，多次呼叫回传同一实例。

### SettingsView UI 设计指引

**风格参考（MainApp.vue 深色主题）：**
- 背景：`bg-zinc-900`
- 文字：`text-white`（标题）、`text-zinc-400`（副标题）
- 边框：`border-zinc-700`
- 输入框：`bg-zinc-800 text-white border border-zinc-600 rounded-lg px-4 py-2`
- 按钮（主要）：`bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2`
- 按钮（危险）：`bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg px-4 py-2`
- Badge（成功）：`bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full`
- Badge（警告）：`bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full`

**UI 结构建议：**
```
┌─ API Key 设定 ──────────────────────────────────┐
│                                                   │
│  Groq API Key  [已设定 ●] 或 [未设定 ●]           │
│                                                   │
│  ┌──────────────────────────────┐  👁  ┌───────┐ │
│  │ gsk_••••••••••••••••••••     │      │ 储存  │ │
│  └──────────────────────────────┘      └───────┘ │
│                                                   │
│  💡 前往 console.groq.com 取得 API Key             │
│                                                   │
│  [删除 API Key]  ← 仅已设定时显示                  │
└───────────────────────────────────────────────────┘
```

### 跨 Story 注意事项

- **Story 1.4** 会将 `useVoiceFlow.ts` 迁移至 `useVoiceFlowStore`。本 Story 的 `transcribeAudio` 呼叫改动在 `useVoiceFlow.ts` composable 中进行，1.4 迁移时需同步搬移。
- **Story 2.1** 会建立 `enhancer.ts`，也需要 API Key。本 Story 的 `getApiKey()` 设计已考虑到这一点，`enhancer.ts` 可直接从 `useSettingsStore` 取用。
- **Story 5.1** 会建立完整的快捷键设定 UI。本 Story 的 SettingsView 只处理 API Key 区块，预留空间给 5.1 的快捷键区块。

### 前一个 Story (1.2) 关键学习

- `cargo check` 有既存 warnings（objc macro cfg, dead_code）— 不影响功能，不需处理
- `vue-tsc --noEmit` 有 `transcriber.ts:17` 的 `import.meta.env` 型别错误 — **本 Story 移除 env 读取后将自然修复**
- tauri-plugin-updater 已从 lib.rs 移除（commit ae44200）— 不要重新加入
- useSettingsStore 的 `loadSettings()` 已有完整的 store 读取框架，本 Story 在同一模式下扩展
- 前端 TriggerKey 使用 union type 保持与 Rust serde 一致 — 沿用此模式
- `HotkeyListenerState` 的 `is_pressed`/`is_toggled_on` 改为 `Arc<AtomicBool>` — 跨线程共享的正确做法

### Git 历史分析

最近 commit 模式：
- `feat:` 前缀用于功能实作（Story 1.1, 1.2）
- `fix:` 前缀用于 code review 后修复
- `docs:` 前缀用于 BMAD artifacts 更新
- `refactor:` 前缀用于重新命名/重构

**最近改动的关键档案（与本 Story 相关）：**
- `src-tauri/src/lib.rs` — Story 1.2 新增了 `update_hotkey_config` command 和 `hotkey_listener` plugin 注册
- `src/stores/useSettingsStore.ts` — Story 1.2 建立了 loadSettings/saveHotkeyConfig 框架
- `src/composables/useVoiceFlow.ts` — Story 1.2 替换了事件监听为新 hotkey 事件
- `src/lib/transcriber.ts` — POC 以来未变动，仍使用 env var

### 技术版本确认（2026-03-02）

| 技术 | 版本 | 备注 |
|------|------|------|
| tauri-plugin-store (Rust) | ~2.4 | 已安装，已在 lib.rs 注册 |
| @tauri-apps/plugin-store (JS) | ^2.4.2 | 已安装，已在 useSettingsStore 使用 |
| Tauri tray-icon feature | 2.x | 已启用，lib.rs 已有 tray 设定 |

### 不需要的 Cargo/NPM 依赖变更

本 Story **不需要安装任何新依赖**。所有需要的 plugin 已在 Story 1.1 安装完毕。

### 现有档案改动点

**修改档案：**
```
src-tauri/src/lib.rs                  — 扩展 Tray 选单 + show_main_window + 首次启动引导（可选）
src/stores/useSettingsStore.ts        — 新增 API Key 储存/读取/删除逻辑
src/lib/transcriber.ts                — 移除 env var，改为 apiKey 参数注入
src/composables/useVoiceFlow.ts       — 呼叫 transcribeAudio 时传入 API Key
src/views/SettingsView.vue            — 建立 API Key 设定 UI
src/main-window.ts                    — 新增首次启动引导（loadSettings → 检查 hasApiKey → 导向 settings）
```

**不修改的档案（明确排除）：**
- `App.vue` — HUD 行为不变
- `MainApp.vue` — sidebar 结构不变
- `router.ts` — 路由已定义，不需改动
- `hotkey_listener.rs` — 热键逻辑不变
- `clipboard_paste.rs` — 剪贴簿逻辑不变
- `database.ts` — SQLite 不存 API Key
- `Cargo.toml` — 不需新增依赖
- `package.json` — 不需新增依赖
- `capabilities/default.json` — `store:default` 已有

### 安全规则提醒

- API Key 不写入任何日志（`console.log` 不印 Key 值）
- API Key 不透过 Tauri Event 传播（不 emit API Key）
- CSP `connect-src 'self' https://api.groq.com` 限制 API Key 只能传到 Groq
- `settings.json` 储存在 App Data 目录，不进 git

### Project Structure Notes

- 本 Story 改动符合统一专案结构：store 层处理资料持久化，view 层处理 UI，lib 层处理 API 呼叫
- `transcriber.ts` 保持为纯逻辑 service（lib/ 层），不引入 Vue/Pinia 依赖 — API Key 透过参数注入而非在 service 内 import store
- SettingsView.vue 只透过 `useSettingsStore` 操作设定，不直接使用 `Store` API

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Security — tauri-plugin-store 本地储存]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture — Pinia Stores 结构]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries — Data Boundaries]
- [Source: _bmad-output/planning-artifacts/prd.md#应用程式管理 FR31-FR32]
- [Source: _bmad-output/implementation-artifacts/1-2-rdev-cross-platform-hotkey.md — 跨 Story 注意事项]
- [Source: Codebase — src-tauri/src/lib.rs（System Tray 现有实作）]
- [Source: Codebase — src/stores/useSettingsStore.ts（Story 1.2 已建立框架）]
- [Source: Codebase — src/lib/transcriber.ts（env var API Key 读取）]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex (CLI)

### Debug Log References

- 2026-03-02 `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- 2026-03-02 `pnpm exec vue-tsc --noEmit` ✅
- 2026-03-02 `pnpm test` ✅（6 files / 77 tests 全部通过）
- 手动整合验证（6.3~6.8）需在 GUI 环境执行，CLI 无法直接完成

### Completion Notes List

- 完成 Task 1~5 与 Task 6.1~6.2：System Tray 新增「开启 Dashboard」、API Key 本地储存/删除/读取、转录流程改为参数注入 API Key、SettingsView API Key UI、首次启动导向设定页面。
- `transcriber.ts` 不再读取 `import.meta.env.VITE_GROQ_API_KEY`，改由 `useSettingsStore().getApiKey()` 提供，且缺少 API Key 时 emit `voice-flow:state-changed` 错误讯息。
- 更新并修正对应单元测试（`transcriber`、`use-voice-flow`），目前测试绿灯。
- 保留 Task 6.3~6.8 未勾选，待使用者在本机桌面环境完成手动验证后再标记完成并切换至 `review`。

### File List

- src-tauri/src/lib.rs
- src/stores/useSettingsStore.ts
- src/lib/transcriber.ts
- src/lib/errorUtils.ts
- src/composables/useVoiceFlow.ts
- src/views/SettingsView.vue
- src/main-window.ts
- tests/unit/transcriber.test.ts
- tests/unit/use-voice-flow.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/1-3-api-key-storage-system-tray.md

## Change Log

- 2026-03-02: 完成 Story 1.3 主要开发与自动化验证，Story 状态更新为 `in-progress`（待手动整合验证 6.3~6.8）。
- 2026-03-02: Code Review 修复 — (1) 新增 `getApiKey()` getter，`apiKey` ref 不再对外暴露 (2) SettingsView 移除对 `lib/errorUtils` 的直接 import（架构边界修复）(3) 移除未使用的 `aiPrompt` ref (4) File List 补上 `errorUtils.ts` (5) 更新 `useVoiceFlow.ts` 和测试改用 `getApiKey()` — 6 files / 77 tests ✅，vue-tsc ✅。
- 2026-03-03: 手动整合测试全部通过（6.3~6.8），Story 状态更新为 `done`。
