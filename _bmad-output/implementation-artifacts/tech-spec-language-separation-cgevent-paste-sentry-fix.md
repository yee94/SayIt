---
title: '语言设定分离、macOS CGEvent 贴上、Sentry 错误回报修补'
slug: 'language-separation-cgevent-paste-sentry-fix'
created: '2026-03-08'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['vue-i18n ^11', 'vue ^3.5', 'tauri-plugin-store ^2.4.2', 'Rust core-graphics 0.24', 'Rust core-foundation 0.10', 'Rust objc 0.2', '@sentry/vue ^10.42.0', 'sentry 0.46']
files_to_modify:
  - 'src/stores/useSettingsStore.ts'
  - 'src/views/SettingsView.vue'
  - 'src/types/events.ts'
  - 'src/i18n/languageConfig.ts'
  - 'src/i18n/prompts.ts'
  - 'src/i18n/locales/zh-TW.json'
  - 'src/i18n/locales/en.json'
  - 'src/i18n/locales/ja.json'
  - 'src/i18n/locales/zh-CN.json'
  - 'src/i18n/locales/ko.json'
  - 'src-tauri/src/plugins/clipboard_paste.rs'
  - 'src-tauri/src/plugins/transcription.rs'
  - 'src/stores/useVoiceFlowStore.ts'
  - 'src/lib/sentry.ts'
  - 'src-tauri/src/lib.rs'
  - 'src/stores/useVocabularyStore.ts'
  - 'src/stores/useHistoryStore.ts'
  - 'src/components/AccessibilityGuide.vue'
  - 'src/MainApp.vue'
  - 'src/main.ts'
  - 'src/main-window.ts'
  - 'tests/unit/i18n-settings.test.ts'
  - 'tests/unit/use-settings-store.test.ts'
code_patterns:
  - 'Settings Store: load() -> get() -> set() -> save() -> emitEvent()'
  - 'Cross-window sync: refreshCrossWindowSettings() reads store and updates ref'
  - 'Sentry: captureError(err, { source, ...context }) from lib/sentry.ts'
  - 'HUD event: emitEvent(EVENT_NAME, payload) from composables/useTauriEvents'
  - 'Rust command: #[command] pub fn -> Result<T, E> via ? operator'
  - 'CGEvent in hotkey_listener.rs: CGEventTap::new + CFRunLoop（监听用，非模拟）'
  - 'CGEvent keyboard sim: CGEventCreateKeyboardEvent(source, keycode, keydown) + set_flags'
  - 'macOS keycodes: Command=55, V=9; CGEventFlags::CGEventFlagMaskCommand'
  - 'completePasteFlow: invoke("paste_text") → catch → failRecordingFlow → captureError'
  - 'HudStatus: "idle"|"recording"|"transcribing"|"enhancing"|"success"|"error"'
test_patterns:
  - 'Vitest + jsdom, vi.mock @tauri-apps series'
  - 'Store test: import -> useStore() -> call method -> expect mockStoreSet'
  - 'i18n-settings.test.ts: saveLocale 持久化、getWhisperLanguageCode 映射、detectSystemLocale'
  - 'use-settings-store.test.ts: 501 行，mock store get/set/delete/save'
  - 'Rust: #[cfg(test)] mod tests + assert_eq!'
---

# Tech-Spec: 语言设定分离、macOS CGEvent 贴上、Sentry 错误回报修补

**Created:** 2026-03-08

## Overview

### Problem Statement

1. **语言耦合**：APP 介面语言和 Whisper 转录语言强耦合。切换 UI 语言会自动改变转录语言，但许多使用者用英文 UI 却讲中文。需要两者独立设定。

2. **贴上失效**：macOS AX Menu Press 贴上机制在 LINE 等无标准 Edit > Paste 选单的 app 中失效（搜寻不到 `AXMenuItemCmdChar="v"` 的 menu item）。且错误被静默吞掉——`paste_text()` 回传 `Ok(())` 即使贴上实际失败。

3. **Sentry 缺口**：使用者遇到错误但 Sentry 没收到回报。盘点发现 6 个根本原因，包含大量 catch 只做 console.error 没有 captureError、HUD 视窗 Sentry integrations 为空、paste 失败被吞掉、缺少全域错误处理器等。

### Solution

1. **语言分离**：新增独立的 `selectedTranscriptionLocale` 设定（含「自动侦测」选项），Whisper `language` 参数和 AI prompt 改跟转录语言走。

2. **CGEvent 贴上**：macOS 改用 CGEvent Cmd+V 模拟键盘贴上，移除 AX Menu Press。失败时回传 `Err` 给前端。

3. **Sentry 修补**：补齐前端 captureError 调用、修复 HUD Sentry 初始化、加入 Vue errorHandler + unhandledrejection 全域处理、Rust 加 panic handler。Paste 失败时 HUD 显示提示 + Sentry 回报。

### Scope

**In Scope:**

- Feature A（语言分离）：
  - 新增 `selectedTranscriptionLocale` ref 和 `saveTranscriptionLocale()` 在 useSettingsStore
  - 新增「自动侦测」选项（不传 language 参数给 Whisper）
  - `getWhisperLanguageCode()` 改读新 ref
  - `resetAiPrompt()` 改用转录语言
  - AI prompt 自动切换逻辑从 `saveLocale` 移到 `saveTranscriptionLocale`
  - SettingsView 新增转录语言下拉选单
  - 5 个 i18n 档案更新
  - 跨视窗同步
  - 迁移：旧版预设转录语言 = 当前 UI 语言

- Feature B（CGEvent 贴上）：
  - macOS：移除 `trigger_paste_via_menu()` + `find_and_press_paste_menu_item()`
  - macOS：新增 CGEvent Cmd+V 模拟（Cmd↓ V↓ V↑ Cmd↑）
  - `paste_text()` 失败时回传 `Err(ClipboardError::KeyboardSimulation(...))`
  - 前端：paste 失败时 HUD 显示「已复制，请手动 ⌘V」提示

- Feature C（Sentry 修补）：
  - `lib/sentry.ts`：HUD 初始化加回必要 integrations
  - `main.ts` / `main-window.ts`：加入 Vue errorHandler + unhandledrejection 全域处理
  - stores 补齐 captureError：useVoiceFlowStore、useSettingsStore、useVocabularyStore、useHistoryStore
  - 元件补齐：AccessibilityGuide.vue、MainApp.vue
  - Rust lib.rs：加入 sentry panic handler integration
  - paste 失败时 Sentry captureError

**Out of Scope:**

- Windows 贴上机制（SendInput 不动，但也要改为回传 Err）
- Whisper 语言列表扩充超过现有 5 种 + auto
- 翻译模式功能
- Rust 各插件的 eprintln 全面改为 Sentry 上报（仅处理影响使用者体验的关键路径）
- Sentry performance tracing 调整

## Context for Development

### Codebase Patterns

- **Settings Store 模式**：`load()` → `store.get()` → `ref.value =` → `store.set()` → `store.save()` → `emitEvent(SETTINGS_UPDATED, { key, value })`
- **跨视窗同步**：`refreshCrossWindowSettings()` 全量重读 store 并更新所有 ref
- **Sentry 上报**：`captureError(err, { source: "xxx", ...context })` 来自 `src/lib/sentry.ts`
- **Rust command 错误**：用 `Result<T, CustomError>` + `?` operator，前端收到 rejected Promise
- **HUD 状态机**：`transitionTo(status, message)` 改变 HUD 状态，`failRecordingFlow()` 统一处理错误流程
- **CGEvent 现有用法**：`hotkey_listener.rs` 和 `keyboard_monitor.rs` 用 `CGEventTap::new()` 监听键盘事件（读取用），clipboard 需要用 `CGEventCreateKeyboardEvent` 模拟键盘事件（写入用）
- **Paste 前端流程**：`completePasteFlow()` → `invoke("paste_text")` → 成功走 `transitionTo("success")` / 失败走 `failRecordingFlow()` → `captureError()`

### Files to Reference

| File | Purpose | 关键行号 |
| ---- | ------- | ------- |
| `src/stores/useSettingsStore.ts` | 语言设定核心，新增 transcriptionLocale | L69-90: refs, L110-180: loadSettings, L517-554: saveLocale+getWhisperLanguageCode, L578-641: refreshCrossWindowSettings |
| `src/i18n/languageConfig.ts` | 语言选项、Whisper code 映射 | L1: SupportedLocale type, L13-49: LANGUAGE_OPTIONS, L101-104: getWhisperCodeForLocale |
| `src/i18n/prompts.ts` | AI prompt 预设值查表 | DEFAULT_PROMPTS record, getDefaultPromptForLocale() |
| `src/views/SettingsView.vue` | 设定页 UI | L950-970: 介面语言下拉 |
| `src/types/events.ts` | SettingsKey 联合型别 | L21-29: SettingsKey |
| `src-tauri/src/plugins/clipboard_paste.rs` | 贴上机制 | L29-83: trigger_paste_via_menu（要移除）, L234-267: Windows SendInput, L279-327: paste_text（吞掉错误） |
| `src-tauri/src/plugins/transcription.rs` | Whisper API 呼叫 | L10: TRANSCRIPTION_LANGUAGE="zh", L142: language field 构建 |
| `src/stores/useVoiceFlowStore.ts` | 转录+贴上流程 | L98-116: isSilenceOrHallucination CJK 检测, L393-414: completePasteFlow, L254-286: 静音/监控等只 log 无 Sentry |
| `src/lib/sentry.ts` | Sentry 初始化 | initSentryForHud（integrations:[] 空）, initSentryForDashboard, captureError helper |
| `src/main.ts` | HUD 入口 | 缺 Vue errorHandler + unhandledrejection |
| `src/main-window.ts` | Dashboard 入口 | 有 bootstrap captureError，缺 errorHandler |
| `src/stores/useHistoryStore.ts` | 历史记录 DB 操作 | 0 个 try-catch 有 captureError |
| `src/stores/useVocabularyStore.ts` | 词汇 DB 操作 | 所有 catch 只 console.error |
| `src-tauri/src/lib.rs` | Rust Sentry 初始化 | L342-387: sentry::init，缺 panic handler |
| `docs/adr-paste-mechanism.md` | ADR 决策文件 | CGEvent 改回决议 |

### Technical Decisions

1. **转录语言型别**：新增 `TranscriptionLocale = SupportedLocale | "auto"` type alias。不扩充 `SupportedLocale` 本身，保持 UI locale 型别干净。`"auto"` 时前端传 `null` 给 Rust，Rust 不加 language field 到 Groq API form。

2. **AI prompt 与 auto**：选择「自动侦测」时，`resetAiPrompt()` 使用 **UI 语言**的预设 prompt（因为无法预知使用者会说什么语言，但使用者的 UI 语言通常反映偏好的输出语言）。`getDefaultPromptForLocale()` 接收 auto 时 fallback 到 `selectedLocale.value`。

3. **CJK 幻觉检测与 auto**：auto 模式下**跳过 CJK 幻觉检测**（`getWhisperLanguageCode() !== "zh"` 的分支），因为无法预知 Whisper 会侦测到什么语言。

4. **Rust transcription.rs 修改**：`language` 参数为 `None` 时，**不加入** `language` field 到 multipart form（而非 fallback 到 `"zh"`）。移除 `TRANSCRIPTION_LANGUAGE` 常数。

5. **CGEvent 实作**：用 `CGEventCreateKeyboardEvent(source, keycode, keydown)` + `CGEventPost` 送出 4 事件。macOS keycodes: Command=55, V=9。设定 `CGEventFlags::CGEventFlagMaskCommand` 修饰键。事件源使用 `CGEventSourceStateID::Private`（隔离状态，不继承物理键盘的 modifier flag），投递位置使用 `CGEventTapLocation::Session`。⚠️ 禁止使用 `HIDSystemState`/`CombinedSessionState`（Toggle 模式 + modifier trigger key 会残留 flag 导致重复贴上）。

6. **paste_text 失败处理**：macOS 和 Windows 都改为回传 `Err(ClipboardError::KeyboardSimulation(msg))`。前端 `completePasteFlow()` 的 catch 已有 `failRecordingFlow()` + `captureError()`，Rust 改回传 Err 后前端自动生效。HUD 显示 `t("voiceFlow.pasteFailed")` 讯息。

7. **HUD Sentry integrations**：保持 `integrations: []`（HUD 刻意不做 browser tracing）。`captureError()` / `captureException()` 不依赖 integrations，可正常手动上报。真正的问题是 catch 区块没呼叫 `captureError()`。

8. **Sentry 修补范围**：
   - ✅ 补齐：全域 Vue errorHandler + unhandledrejection（main.ts, main-window.ts）
   - ✅ 补齐：useVoiceFlowStore 非关键 catch（mute、monitor、addTranscription、hideHud 等）
   - ✅ 补齐：useVocabularyStore、useHistoryStore 的 catch
   - ✅ 补齐：AccessibilityGuide.vue、MainApp.vue 的 catch
   - ✅ 补齐：useSettingsStore 关键操作（saveHotkeyConfig、loadSettings）
   - ❌ 不动：Rust 各插件 eprintln（低优先级，下次迭代）
   - ✅ Rust lib.rs：加入 `sentry::integrations::panic` handler

## Implementation Plan

### Tasks

#### Feature A：语言设定分离（依赖顺序：底层型别 → Store → Rust → UI）

- [x] Task 1: 新增 TranscriptionLocale 型别和 auto 语言选项
  - File: `src/i18n/languageConfig.ts`
  - Action:
    - 新增 `export type TranscriptionLocale = SupportedLocale | "auto";`
    - **不动** `LANGUAGE_OPTIONS` 阵列（auto 不进入此阵列，避免污染 `detectSystemLocale()`、`getHtmlLangForLocale()` 等现有函式）
    - 新增 `TRANSCRIPTION_LANGUAGE_OPTIONS` 常数：在开头放 auto 选项 `{ locale: "auto" as TranscriptionLocale, displayName: "自动侦测", whisperCode: null }`，后接 `LANGUAGE_OPTIONS` 的 5 种语言（可用 spread 或 map 取出 locale + displayName）
    - 新增 `getWhisperCodeForTranscriptionLocale(locale: TranscriptionLocale): string | null` 函式：`"auto"` 回传 `null`，其余 delegate 到现有 `getWhisperCodeForLocale()`
    - 保留 `getWhisperCodeForLocale()` 签名不变（仍接受 `SupportedLocale`，回传 `string`），避免影响既有呼叫点
  - Notes: `SupportedLocale` 和 `LANGUAGE_OPTIONS` 完全不动。新增的 `TranscriptionLocale` 和 `TRANSCRIPTION_LANGUAGE_OPTIONS` 是独立的平行结构。（修正 F-04）

- [x] Task 2: 扩充 SettingsKey 和 i18n 翻译
  - File: `src/types/events.ts`
  - Action: `SettingsKey` 联合型别新增 `| "transcriptionLocale"`
  - File: `src/i18n/locales/zh-TW.json`
  - Action: 在 `settings.app` 新增：`"transcriptionLanguage": "转录语言"`, `"transcriptionLanguageDescription": "语音转文字时使用的辨识语言"`, `"transcriptionLanguageUpdated": "转录语言已更新"`, `"autoDetect": "自动侦测"`
  - File: `src/i18n/locales/en.json`
  - Action: 同上英文版：`"transcriptionLanguage": "Transcription Language"`, `"transcriptionLanguageDescription": "Language used for speech recognition"`, `"transcriptionLanguageUpdated": "Transcription language updated"`, `"autoDetect": "Auto Detect"`
  - File: `src/i18n/locales/ja.json`, `zh-CN.json`, `ko.json`
  - Action: 同上各语言版本

- [x] Task 3: Store 核心逻辑修改
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    - import `TranscriptionLocale` from languageConfig
    - 新增 `selectedTranscriptionLocale = ref<TranscriptionLocale>(FALLBACK_LOCALE)`
    - 新增 `saveTranscriptionLocale(locale: TranscriptionLocale)` 函式：
      - 模式同 `saveLocale()`：`store.set("selectedTranscriptionLocale", locale)` → `store.save()` → `emitEvent`
      - **AI prompt 自动切换逻辑移入此处**（从 `saveLocale` 搬来）：比较旧 transcription locale 的预设 prompt，若相同则更新为新 locale 的预设
      - auto 模式的 prompt：用 `getDefaultPromptForLocale(selectedLocale.value)` fallback 到 UI 语言。非 auto 时用 `getDefaultPromptForLocale(locale)`（TS narrowing 自动排除 `"auto"`）（修正 F-03）
    - 修改 `getWhisperLanguageCode()` → `return getWhisperCodeForTranscriptionLocale(selectedTranscriptionLocale.value)`（用 Task 1 新增的函式，回传 `string | null`）
    - 修改 `resetAiPrompt()` 的 `getDefaultPromptForLocale()` 呼叫：需先 narrow `TranscriptionLocale` 到 `SupportedLocale`：
      ```typescript
      const promptLocale: SupportedLocale =
        selectedTranscriptionLocale.value === "auto"
          ? selectedLocale.value
          : selectedTranscriptionLocale.value; // 这里 TS 会 narrow 为 SupportedLocale
      const defaultPrompt = getDefaultPromptForLocale(promptLocale);
      ```
      （修正 F-03：三元运算的 false 分支经过 `=== "auto"` 判断后，TS narrowing 会排除 `"auto"`，型别自动收窄为 `SupportedLocale`）
    - 修改 `loadSettings()`：在 locale 载入后，新增读取 `"selectedTranscriptionLocale"`。若不存在（迁移），预设为 `selectedLocale.value`，写回 store
    - 修改 `saveLocale()`：**移除** AI prompt 自动切换逻辑（L527-533）
    - 修改 `refreshCrossWindowSettings()`：新增读取 `"selectedTranscriptionLocale"` 并同步到 ref
    - 在 return 物件新增：`selectedTranscriptionLocale`, `saveTranscriptionLocale`
  - Notes: `getWhisperLanguageCode()` 回传 `string | null`，null 表示 auto

- [x] Task 4: Rust 端支援 auto-detect（省略 language field）
  - File: `src-tauri/src/plugins/transcription.rs`
  - Action:
    - 移除 L10 的 `const TRANSCRIPTION_LANGUAGE: &str = "zh";`
    - 修改 L140-143 的 form 构建逻辑：
      ```rust
      let mut form = reqwest::multipart::Form::new()
          .part("file", file_part)
          .text("model", model)
          .text("response_format", "verbose_json");
      // 条件性加入 language
      if let Some(lang) = language {
          form = form.text("language", lang);
      }
      ```
  - Notes: 前端传 `null`（Rust 收到 `None`）时不加 language field，Groq Whisper 自动侦测。⚠️ 实作前需确认 Tauri v2 的 `invoke("transcribe_audio", { language: null })` 是否正确序列化为 Rust `Option<String>::None`——可在 dev mode 用 `debug_log` 验证（修正 F-05）

- [x] Task 5: 更新 CJK 幻觉检测逻辑
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 L109-113 的 CJK 检测条件：
    ```typescript
    const whisperLang = settingsStore.getWhisperLanguageCode();
    if (
      whisperLang === "zh" &&
      !CJK_REGEX.test(rawText) &&
      hasRepeatedTokens(rawText)
    )
    ```
    当 `whisperLang` 为 `null`（auto 模式）时自然跳过（`null === "zh"` 为 false）
  - Notes: 无需特殊处理 auto，null 自动走 false 分支

- [x] Task 6: SettingsView 新增转录语言下拉选单
  - File: `src/views/SettingsView.vue`
  - Action:
    - import `TRANSCRIPTION_LANGUAGE_OPTIONS`, `TranscriptionLocale` from languageConfig
    - 在介面语言下拉（L970）后、`localeFeedback` transition 后，新增分隔线 + 转录语言区块：
      - `<Label>` + `<p class="text-sm text-muted-foreground">` 说明文字
      - `<Select :model-value="settingsStore.selectedTranscriptionLocale" @update:model-value="handleTranscriptionLocaleChange">`
      - 选项用 `TRANSCRIPTION_LANGUAGE_OPTIONS`，auto 选项的 displayName 用 `$t("settings.app.autoDetect")`（其余用 `opt.displayName`）
    - 新增 `transcriptionLocaleFeedback = useFeedbackMessage()`
    - 新增 `handleTranscriptionLocaleChange(newLocale: TranscriptionLocale)` handler
  - Notes: UI 布局参考 Typeless 截图——语言区块两个独立下拉

#### Feature B：macOS CGEvent 贴上（依赖顺序：Rust → 前端自动生效）

- [x] Task 7: macOS 改用 CGEvent Cmd+V 模拟贴上
  - File: `src-tauri/src/plugins/clipboard_paste.rs`
  - Action:
    - **移除** `trigger_paste_via_menu()` 函式（L29-83）和 `find_and_press_paste_menu_item()` 函式（L87-229）
    - **新增** `simulate_paste_via_cgevent()` 函式（`#[cfg(target_os = "macos")]`）：
      ```rust
      fn simulate_paste_via_cgevent() -> Result<(), String> {
          // 用 CGEventCreateKeyboardEvent + CGEventPost
          // 事件序列：Cmd↓ → V↓ → V↑ → Cmd↑
          // keycodes: Command_L=55, V=9
          // V↓/V↑ 需设定 CGEventFlags::CGEventFlagMaskCommand
      }
      ```
    - **修改** `paste_text()` 的 `#[cfg(target_os = "macos")]` 区块：
      - 呼叫 `simulate_paste_via_cgevent()`
      - 失败时 `return Err(ClipboardError::KeyboardSimulation(e))`（不再吞掉错误）
    - **修改** `paste_text()` 的 `#[cfg(target_os = "windows")]` 区块：
      - 失败时同样 `return Err(ClipboardError::KeyboardSimulation(e))`
    - 移除 `ClipboardError::KeyboardSimulation` 上的 `#[allow(dead_code)]` attribute（因为现在 macOS 和 Windows 都会用到）
    - 移除不再需要的 imports（`core_foundation`, `objc` 等 AX API 相关）
  - Notes: CGEvent 需要 Accessibility 权限（已有）。4 事件完整配对，paste 场景下幽灵按键风险趋近于零

- [x] Task 8: 更新 Rust 测试
  - File: `src-tauri/src/plugins/clipboard_paste.rs`
  - Action: 现有 `ClipboardError` 测试无需修改（`KeyboardSimulation` variant 测试已存在）。确认编译通过即可

#### Feature C：Sentry 错误回报修补（依赖顺序：全域处理 → Store → 元件 → Rust）

- [x] Task 9: 加入全域错误处理器
  - File: `src/main.ts`（HUD 入口）
  - Action:
    - **在 `createApp()` 之后、`mount()` 之前**，新增 `unhandledrejection` listener 和 Vue errorHandler：
      ```typescript
      // ⚠️ unhandledrejection 必须在 mount 之前注册，
      //    确保 mount 期间的 async 错误也能被捕获（修正 F-11）
      window.addEventListener("unhandledrejection", (event) => {
        captureError(event.reason, { source: "hud-unhandled-rejection" });
      });

      app.config.errorHandler = (err, _instance, info) => {
        console.error("[HUD] Vue error:", err);
        captureError(err, { source: "hud-vue-error", info });
      };

      app.use(pinia).use(i18n).mount("#app");
      ```
    - import `captureError` from `./lib/sentry`
  - File: `src/main-window.ts`（Dashboard 入口）
  - Action: 同上，但 source tag 改为 `"dashboard-vue-error"` 和 `"dashboard-unhandled-rejection"`
  - Notes: errorHandler 和 unhandledrejection 都在 Sentry init 之后、mount 之前设定。顺序：Sentry init → addEventListener → errorHandler → mount

- [x] Task 10: useVoiceFlowStore 补齐 captureError
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在以下 catch 区块新增 `captureError(err, { source: "voice-flow", step: "xxx" })`：
    - L254-258: `muteSystemAudio` 失败 → `step: "mute-audio"`
    - L264-267: `restoreSystemAudio` 失败 → `step: "restore-audio"`
    - L272-276: `start_quality_monitor` 失败 → `step: "quality-monitor"`
    - L283-286: `addTranscription` 失败 → `step: "save-transcription"`
    - L328-332: `hideHud` 失败 → `step: "hide-hud"`
    - L342-346: `showHud` 失败 → `step: "show-hud"`
    - L365-370: `showHud/enableCursor` 失败 → `step: "show-hud-cursor"`
  - Notes: 这些都是非关键路径（不影响主流程），但对诊断问题很重要

- [x] Task 11: useSettingsStore 补齐 captureError
  - File: `src/stores/useSettingsStore.ts`
  - Action: 在以下 catch 区块新增 `captureError`（import from `../lib/sentry`）：
    - `syncHotkeyConfigToRust` catch (L103-107) → `{ source: "settings", step: "sync-hotkey" }`
    - `loadSettings` catch → `{ source: "settings", step: "load" }`
    - `saveHotkeyConfig` 系列 catch → `{ source: "settings", step: "save-hotkey" }`
    - `saveApiKey` catch → `{ source: "settings", step: "save-api-key" }`
    - `saveLocale` catch → `{ source: "settings", step: "save-locale" }`
    - `saveMuteOnRecording` catch → `{ source: "settings", step: "save-mute" }`
  - Notes: 保留现有 `console.error()` 不动，在其后方追加 `captureError`

- [x] Task 12: useVocabularyStore 补齐 captureError
  - File: `src/stores/useVocabularyStore.ts`
  - Action: 在所有 catch 区块追加 `captureError(err, { source: "vocabulary", step: "xxx" })`：
    - `fetchTermList` → `step: "fetch"`
    - `addTerm` → `step: "add"`
    - `removeTerm` → `step: "remove"`
  - Notes: import `captureError` from `../lib/sentry`

- [x] Task 13: useHistoryStore 补齐错误处理
  - File: `src/stores/useHistoryStore.ts`
  - Action:
    - 在以下已有 try-catch 的函式中追加 `captureError(err, { source: "history", step: "xxx" })`：
      - `fetchTranscriptions()` → `step: "fetch"`
      - `addTranscription()` → `step: "add"`
      - `deleteTranscription()` → `step: "delete"`
      - `updateTranscription()` → `step: "update"`
      - `fetchStats()` → `step: "fetch-stats"`
    - 对没有 try-catch 的 DB 操作（如果有）：包 try-catch + captureError，但保留 rethrow（`catch (err) { captureError(...); throw err; }`）
    - import `captureError` from `../lib/sentry`
  - Notes: 不要吞掉错误（保留 throw），只补 captureError 上报。实作时需 Read 档案确认实际函式清单（修正 F-10）

- [x] Task 14: 元件补齐 captureError
  - File: `src/components/AccessibilityGuide.vue`
  - Action: 在 catch 区块追加 captureError：
    - permission check → `{ source: "accessibility", step: "check-permission" }`
    - reinitialize → `{ source: "accessibility", step: "reinitialize" }`
    - open settings → `{ source: "accessibility", step: "open-settings" }`
  - File: `src/MainApp.vue`
  - Action: 在 catch 区块追加 captureError：
    - autoCheckAndDownload → `{ source: "updater", step: "auto-check" }`
    - manual update check → `{ source: "updater", step: "manual-check" }`

- [x] Task 15: Rust Sentry panic handler（受限于 panic="abort"）
  - File: `src-tauri/src/lib.rs`
  - Action:
    - 确认 `sentry::init(...)` 的 `default_integrations` 包含 panic handler（SDK 0.46 预设启用）
    - **⚠️ 已知限制**：`Cargo.toml` 的 `[profile.release]` 设定 `panic = "abort"`，panic hook 触发后程式立即 abort，Sentry SDK 可能来不及 flush 事件。解法：在 `sentry::init` 选项中设定 `auto_session_tracking: true` 和 `session_mode: SessionMode::Application`，让 crash 至少被记为 abnormal session。完整的 panic event 上报在 `panic = "abort"` 下**不保证可靠**
    - 同时确认 `_exit(0)` 之前有 `sentry::Hub::current().client().map(|c| c.flush(Some(Duration::from_secs(2))))`，确保正常 shutdown 时 Sentry 有机会 flush 伫列中的事件
  - Notes: （修正 F-09）`panic = "abort"` 是效能最佳化（减少 binary size），改为 `panic = "unwind"` 会增加 ~10% binary size，目前不值得。session tracking 是 pragmatic workaround

#### 测试更新

- [x] Task 16: 更新 i18n-settings 测试
  - File: `tests/unit/i18n-settings.test.ts`
  - Action:
    - 新增 `TranscriptionLocale` 型别测试
    - 新增 `getWhisperCodeForLocale("auto")` → `null` 的测试
    - 新增 `TRANSCRIPTION_LANGUAGE_OPTIONS` 包含 auto + 5 语言的测试
    - 新增 `saveTranscriptionLocale()` 持久化和 event emit 测试

- [x] Task 17: 更新 use-settings-store 测试
  - File: `tests/unit/use-settings-store.test.ts`
  - Action:
    - 新增 `selectedTranscriptionLocale` 初始化测试
    - 新增迁移测试：store 无 `selectedTranscriptionLocale` 时预设为 `selectedLocale`
    - 新增 `getWhisperLanguageCode()` 读取 `selectedTranscriptionLocale`（非 `selectedLocale`）的测试
    - 新增跨视窗同步 `refreshCrossWindowSettings()` 含 transcriptionLocale 的测试

### Acceptance Criteria

#### Feature A：语言设定分离

- [x] AC-A1: Given 使用者在设定页, when 切换介面语言为 English, then UI 切换为英文且转录语言保持不变（如仍为繁体中文）
- [x] AC-A2: Given 使用者在设定页, when 切换转录语言为日本語, then 下次录音 Whisper 收到 `language="ja"` 参数
- [x] AC-A3: Given 使用者选择转录语言为「自动侦测」, when 执行录音, then Whisper API 不带 `language` 参数（Rust 端不加 language field）
- [x] AC-A4: Given 使用者切换转录语言且 AI prompt 为旧语言的预设值, when 切换完成, then AI prompt 自动更新为新语言的预设值
- [x] AC-A5: Given 使用者切换转录语言为「自动侦测」且 AI prompt 为预设值, when 切换完成, then AI prompt 更新为 UI 语言的预设 prompt
- [x] AC-A6: Given 旧版使用者升级（store 中无 `selectedTranscriptionLocale`）, when app 启动, then 转录语言自动设为当前 UI 语言，行为不变
- [x] AC-A7: Given 使用者在 Dashboard 切换转录语言, when HUD 收到 `SETTINGS_UPDATED` event, then HUD 的 `selectedTranscriptionLocale` 经由 `refreshCrossWindowSettings()` 同步更新（修正 F-06：HUD 无设定 UI，语言切换只在 Dashboard 发生）
- [x] AC-A8: Given 转录语言设为「自动侦测」, when Whisper 转录回中文结果, then CJK 幻觉检测被跳过（不会误判为幻觉）

#### Feature B：macOS CGEvent 贴上

- [x] AC-B1: Given macOS 环境, when 转录完成后自动贴上, then 使用 CGEvent Cmd+V 模拟键盘事件（非 AX Menu Press）
- [x] AC-B2: Given 前景 app 为 LINE（无标准 Paste 选单）, when 转录完成, then 文字成功贴上到 LINE 输入框
- [x] AC-B3: Given macOS 环境且 CGEvent 模拟失败, when paste_text 被呼叫, then Rust 回传 `Err(ClipboardError::KeyboardSimulation(...))` 且前端 HUD 显示错误提示
- [x] AC-B4: Given Windows 环境且 SendInput 失败, when paste_text 被呼叫, then 同样回传 `Err`（行为一致）
- [x] AC-B5: Given 任何平台贴上失败, when 前端收到 Err, then Sentry 收到 captureError 回报且包含 `source: "voice-flow"` 标签

#### Feature C：Sentry 错误回报修补

- [x] AC-C1: Given HUD 视窗中 Vue 元件抛出未捕获的错误, when errorHandler 触发, then Sentry 收到 exception 且包含 `source: "hud-vue-error"` 标签
- [x] AC-C2: Given Dashboard 中有未处理的 Promise rejection, when unhandledrejection 触发, then Sentry 收到 exception
- [x] AC-C3: Given useVocabularyStore.addTerm() DB 操作失败, when catch 执行, then 同时 console.error 和 captureError 被呼叫
- [x] AC-C4: Given useHistoryStore DB 操作失败, when 错误发生, then Sentry 收到包含 `source: "history"` 的 exception
- [x] AC-C5: Given 开发环境（import.meta.env.PROD = false）, when captureError 被呼叫, then 不会送出到 Sentry（isSentryEnabled 回 false），也不会 crash
- [x] AC-C6: Given Rust 端发生 panic, when sentry panic handler 触发, then Sentry 收到 panic event

## Additional Context

### Dependencies

- 无新增外部依赖
- Rust `core-graphics` 0.24 已在 Cargo.toml（用于 CGEvent）
- `@sentry/vue` ^10.42.0 已安装

### Testing Strategy

**Feature A（语言分离）：**
- 更新 `tests/unit/i18n-settings.test.ts`：新增 `TranscriptionLocale` 型别测试、`"auto"` 选项的 `getWhisperCodeForLocale` 映射（回传 null）、`saveTranscriptionLocale` 持久化
- 更新 `tests/unit/use-settings-store.test.ts`：新增 `selectedTranscriptionLocale` 初始化、迁移逻辑、跨视窗同步

**Feature B（CGEvent 贴上）：**
- `clipboard_paste.rs` 的 Rust unit test 更新（ClipboardError variant 测试）
- `pnpm tauri dev` 手动测试：在 LINE / Notes / Terminal 中测试贴上
- 确认 Windows CI build 通过（SendInput 改回传 Err）

**Feature C（Sentry 修补）：**
- 手动测试：开发模式下 `captureError` 呼叫不应 crash（isSentryEnabled 回 false）
- `npx vue-tsc --noEmit` 确认型别正确

**整合验证：**
- `pnpm test` 全部通过
- `npx vue-tsc --noEmit` 型别检查通过
- `pnpm tauri dev` 手动测试三个 feature 的端对端流程

### Notes

- **Sentry HUD integrations 为空不是 bug** — 是刻意设计（HUD 不需 browser tracing）。真正的问题是 catch 区块没呼叫 `captureError()`
- **Windows SendInput** 也要改为回传 `Err`（目前同样静默吞掉），保持双平台行为一致
- **CGEvent keycodes**：macOS 虚拟键码定义在 `hotkey_listener.rs` 的 `macos_keycodes` module（Command_L=55, V=9）
- **Sentry 修补不包含 Rust 端 eprintln** — 这些是 audio、hotkey 等系统层操作，影响面小，放下次迭代
- **auto 模式的 AI prompt** 用 UI 语言的 prompt，因为 Whisper verbose_json 回应虽然有 detected language，但修改 enhancement 流程来动态选 prompt 太复杂，不在本次范围
