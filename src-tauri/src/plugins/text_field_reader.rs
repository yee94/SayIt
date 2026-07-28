/// 读取当前 focused text field 游标附近的文字。
/// macOS: 透过 AXUIElement Accessibility API。
/// Windows: 透过 UI Automation（IUIAutomation + TextPattern/ValuePattern，跑在专用 MTA 执行绪）。
///
/// 契约：回传「游标附近、有上限」的文字（非整份文件）；读不到一律回 `Ok(None)`。
#[tauri::command]
pub fn read_focused_text_field() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::read_focused_text_field_impl()
    }

    #[cfg(target_os = "windows")]
    {
        windows_impl::read_focused_text_field_impl()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

/// 读取当前聚焦文字栏位中被选取（highlight）的文字。
/// 编辑模式的「剪贴簿后备」路径：仅在 `read_selection_state` 回报
/// unavailable（AX 不可见的 App）时、于录音停止且按键放开后由前端呼叫。
/// 透过模拟 Cmd+C / Ctrl+C 撷取剪贴簿内容。
#[tauri::command]
pub fn read_selected_text() -> Result<Option<String>, String> {
    super::clipboard_paste::capture_selected_text_via_clipboard()
}

/// 选取状态侦测结果（#24/#25 编辑模式判定）。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectionState {
    /// "selection" | "noSelection" | "unavailable"
    pub kind: String,
    pub text: Option<String>,
}

impl SelectionState {
    // selection / no_selection 仅 macOS 的 AX 分类器使用；
    // Windows 端一律 unavailable，cfg 闸避免 dead_code 撞上 clippy -D warnings
    #[cfg(target_os = "macos")]
    fn selection(text: String) -> Self {
        Self {
            kind: "selection".to_string(),
            text: Some(text),
        }
    }
    #[cfg(target_os = "macos")]
    fn no_selection() -> Self {
        Self {
            kind: "noSelection".to_string(),
            text: None,
        }
    }
    fn unavailable() -> Self {
        Self {
            kind: "unavailable".to_string(),
            text: None,
        }
    }
}

/// 读取聚焦文字栏位的选取状态——编辑模式判定的主路径。
/// macOS：AX 被动查询（零按键模拟，#25 的字元污染在此路径不可能发生）。三态：
///   selection    — 确定有选取，text 为选取内容 → 前端直接进编辑模式
///   noSelection  — 确定无选取（AX 可读且长度 0）→ 一般听写，
///                  CodeMirror 类编辑器的「无选取复制整行」误判（#24）在此被排除
///   unavailable  — AX 不可见或读值失真（Heptabase/LINE 类）→ 前端在录音停止、
///                  按键放开后改走剪贴簿后备（read_selected_text）
/// Windows / 其他平台：一律 unavailable（沿用剪贴簿后备；选取读取待 UIA 版补上）。
#[tauri::command]
pub fn read_selection_state() -> SelectionState {
    #[cfg(target_os = "macos")]
    {
        macos::read_selection_state_impl()
    }

    #[cfg(not(target_os = "macos"))]
    {
        SelectionState::unavailable()
    }
}

// ========== macOS: AXUIElement ==========

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::os::raw::c_int;

    type AXUIElementRef = CFTypeRef;
    type AXError = c_int;

    const K_AX_ERROR_SUCCESS: AXError = 0;

    // AX attribute name constants
    const K_AX_FOCUSED_APPLICATION_ATTRIBUTE: &str = "AXFocusedApplication";
    const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE: &str = "AXFocusedUIElement";
    const K_AX_VALUE_ATTRIBUTE: &str = "AXValue";
    const K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE: &str = "AXSelectedTextRange";
    const K_AX_SELECTED_TEXT_ATTRIBUTE: &str = "AXSelectedText";
    const K_AX_ROLE_ATTRIBUTE: &str = "AXRole";

    const CONTEXT_CHARS: usize = 50;
    const FALLBACK_CHARS: usize = 100;

    /// 选取状态读取的总 timeout：AX 是同步跨进程呼叫，目标 App 卡死会阻塞
    /// （对齐 windows_impl 的守卫设计）。上限涵盖「解析失败 → 戳醒 Electron →
    /// 等树重建 → 重试」的最长路径。
    const SELECTION_READ_TIMEOUT_MS: u64 = 600;
    /// 对 Electron 施加 AXManualAccessibility 后等树重建的时间。
    const POKE_SETTLE_MS: u64 = 150;

    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: CFTypeRef,
        ) -> AXError;
    }

    // CFRange struct for AXValue extraction
    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct CFRange {
        location: i64,
        length: i64,
    }

    extern "C" {
        fn AXValueGetValue(value: CFTypeRef, value_type: u32, value_ptr: *mut c_void) -> bool;
    }

    // kAXValueCFRangeType = 4
    const K_AX_VALUE_CF_RANGE_TYPE: u32 = 4;

    fn get_ax_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<CFTypeRef> {
        let attr = CFString::new(attribute_name);
        let mut value: CFTypeRef = std::ptr::null();

        let err =
            unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };

        if err != K_AX_ERROR_SUCCESS || value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    fn get_ax_string_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<String> {
        let value = get_ax_attribute(element, attribute_name)?;
        let cf_string = unsafe { CFString::wrap_under_create_rule(value as *const _) };
        Some(cf_string.to_string())
    }

    /// 读取 AXSelectedTextRange 并解出 CFRange（游标位置 + 选取长度的共用来源）。
    fn read_selected_text_range(element: AXUIElementRef) -> Option<CFRange> {
        let value = get_ax_attribute(element, K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE)?;

        let mut range = CFRange {
            location: 0,
            length: 0,
        };

        let success = unsafe {
            AXValueGetValue(
                value,
                K_AX_VALUE_CF_RANGE_TYPE,
                &mut range as *mut CFRange as *mut c_void,
            )
        };

        unsafe { CFRelease(value) };

        if success {
            Some(range)
        } else {
            None
        }
    }

    fn get_cursor_position(element: AXUIElementRef) -> Option<usize> {
        let range = read_selected_text_range(element)?;
        if range.location >= 0 {
            Some(range.location as usize)
        } else {
            None
        }
    }

    fn extract_excerpt(full_text: &str, cursor_pos: Option<usize>, context: usize) -> String {
        let chars: Vec<char> = full_text.chars().collect();
        let len = chars.len();

        if len == 0 {
            return String::new();
        }

        let pos = match cursor_pos {
            Some(p) if p <= len => p,
            _ => {
                // fallback: 取末尾 FALLBACK_CHARS 字
                let start = len.saturating_sub(FALLBACK_CHARS);
                return chars[start..].iter().collect();
            }
        };

        let start = pos.saturating_sub(context);
        let end = (pos + context).min(len);

        chars[start..end].iter().collect()
    }

    fn is_text_input_role(role: &str) -> bool {
        matches!(
            role,
            "AXTextField" | "AXTextArea" | "AXComboBox" | "AXWebArea"
        )
    }

    /// AX 元素走访结果。呼叫端负责读取属性后呼叫 `cleanup()` 释放所有 CFTypeRef。
    struct FocusedElementContext {
        system_wide: AXUIElementRef,
        app: AXUIElementRef,
        element: AXUIElementRef,
        target_element: AXUIElementRef,
    }

    impl FocusedElementContext {
        fn cleanup(self) {
            unsafe {
                if self.target_element != self.element {
                    CFRelease(self.target_element);
                }
                CFRelease(self.element);
                CFRelease(self.app);
                CFRelease(self.system_wide);
            }
        }
    }

    /// 走访 AX 树取得当前聚焦的文字输入元素。
    /// 共用逻辑：system-wide → focused app → focused element → role check → WebArea child。
    fn resolve_focused_text_element() -> Option<FocusedElementContext> {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return None;
        }

        let app = match get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            Some(a) => a,
            None => {
                unsafe { CFRelease(system_wide) };
                return None;
            }
        };

        let element = match get_ax_attribute(app, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
            Some(e) => e,
            None => {
                unsafe {
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return None;
            }
        };

        let role = get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE);
        let target_element = match role.as_deref() {
            Some(r) if is_text_input_role(r) => {
                if r == "AXWebArea" {
                    match get_ax_attribute(element, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
                        Some(child) => child,
                        None => element,
                    }
                } else {
                    element
                }
            }
            _ => {
                unsafe {
                    CFRelease(element);
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return None;
            }
        };

        Some(FocusedElementContext {
            system_wide,
            app,
            element,
            target_element,
        })
    }

    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        let ctx = match resolve_focused_text_element() {
            Some(c) => c,
            None => return Ok(None),
        };

        let cursor_pos = get_cursor_position(ctx.target_element);
        let full_text = get_ax_string_attribute(ctx.target_element, K_AX_VALUE_ATTRIBUTE);
        ctx.cleanup();

        match full_text {
            Some(text) if !text.is_empty() => {
                let excerpt = extract_excerpt(&text, cursor_pos, CONTEXT_CHARS);
                if excerpt.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(excerpt))
                }
            }
            _ => Ok(None),
        }
    }

    // ========== 选取状态侦测（#24/#25 编辑模式判定） ==========

    use super::SelectionState;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    type SelectionRespTx = SyncSender<SelectionState>;

    static SELECTION_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    static SELECTION_WORKER: OnceLock<Option<Mutex<SyncSender<SelectionRespTx>>>> = OnceLock::new();

    /// 读取聚焦元素的选取长度（AXSelectedTextRange.length）。
    /// length > 0 = 真的有选取；length == 0 = 只有游标、没选取
    /// （编辑器「无选取时 Cmd+C 复制整行」不影响 AX 层的选取范围，故能分辨）。
    fn get_selection_length(element: AXUIElementRef) -> Option<i64> {
        read_selected_text_range(element).map(|range| range.length)
    }

    /// Electron/Chromium 的无障碍树是惰性启用的：对焦点 App 设
    /// AXManualAccessibility=true 可强制唤醒完整树（Electron 官方支援的旗标）。
    /// 对原生 App 设此属性会失败，无副作用。
    fn poke_focused_app_manual_accessibility() {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return;
        }
        if let Some(app) = get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            let attr = CFString::new("AXManualAccessibility");
            let value = core_foundation::boolean::CFBoolean::true_value();
            unsafe {
                AXUIElementSetAttributeValue(app, attr.as_CFTypeRef(), value.as_CFTypeRef());
                CFRelease(app);
            }
        }
        unsafe { CFRelease(system_wide) };
    }

    /// 依已解析的聚焦文字元素分类选取状态。消耗 ctx 并负责释放。
    fn classify_selection(ctx: FocusedElementContext) -> SelectionState {
        let state = match get_selection_length(ctx.target_element) {
            Some(len) if len > 0 => {
                match get_ax_string_attribute(ctx.target_element, K_AX_SELECTED_TEXT_ATTRIBUTE) {
                    Some(text) if !text.trim().is_empty() => SelectionState::selection(text),
                    // 长度 > 0 但文字读不到/为空 = 桥接失真（Electron 已知失效模式），
                    // 交给剪贴簿后备尝试捞回真实选取
                    _ => SelectionState::unavailable(),
                }
            }
            Some(_) => SelectionState::no_selection(),
            // 元素是文字输入类但范围属性不支援 → 无法判定
            None => SelectionState::unavailable(),
        };
        ctx.cleanup();
        state
    }

    /// 阻塞式选取侦测：第一次解析失败时戳醒 Electron 树再试一次。
    /// 全程只做被动 AX 查询，不模拟任何按键。
    fn selection_probe_blocking() -> SelectionState {
        if let Some(ctx) = resolve_focused_text_element() {
            return classify_selection(ctx);
        }
        poke_focused_app_manual_accessibility();
        std::thread::sleep(Duration::from_millis(POKE_SETTLE_MS));
        match resolve_focused_text_element() {
            Some(ctx) => classify_selection(ctx),
            None => SelectionState::unavailable(),
        }
    }

    /// 入口：AX 读取跑在单一常驻 worker 执行绪上、最多等 SELECTION_READ_TIMEOUT_MS
    /// （AX 为同步跨进程呼叫，目标 App 卡死不可拖住 command thread——
    /// 对齐 windows_impl 的守卫模式；常驻而非每次 spawn，卡死时最多损失
    /// 一条执行绪、不会随热键次数无上界累积）。逾时 / 忙碌一律回 unavailable，
    /// 由前端剪贴簿后备接手。
    pub fn read_selection_state_impl() -> SelectionState {
        let sender = match selection_worker_sender() {
            Some(s) => s,
            None => return SelectionState::unavailable(),
        };

        // single-flight：热键连按时避免 AX 读取堆叠。
        // 旗标由「呼叫端」在所有路径后无条件清掉，不依赖 worker
        // （worker 卡死时迟到结果只会送进已 drop 的 receiver 而被丢弃）
        if SELECTION_IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return SelectionState::unavailable();
        }

        let outcome = selection_read_once(&sender);
        SELECTION_IN_FLIGHT.store(false, Ordering::Release);
        outcome
    }

    fn selection_read_once(sender: &SyncSender<SelectionRespTx>) -> SelectionState {
        let (resp_tx, resp_rx) = sync_channel::<SelectionState>(1);
        if sender.try_send(resp_tx).is_err() {
            // worker 还卡在上一个请求（目标 App 的 AX server 无回应）
            return SelectionState::unavailable();
        }
        resp_rx
            .recv_timeout(Duration::from_millis(SELECTION_READ_TIMEOUT_MS))
            .unwrap_or_else(|_| SelectionState::unavailable())
    }

    fn selection_worker_sender() -> Option<SyncSender<SelectionRespTx>> {
        let cell = SELECTION_WORKER.get_or_init(spawn_selection_worker);
        let mutex = cell.as_ref()?;
        let guard = mutex.lock().ok()?;
        Some(guard.clone())
    }

    fn spawn_selection_worker() -> Option<Mutex<SyncSender<SelectionRespTx>>> {
        let (req_tx, req_rx) = sync_channel::<SelectionRespTx>(1);
        std::thread::Builder::new()
            .name("ax-selection-reader".into())
            .spawn(move || selection_worker_loop(req_rx))
            .ok()?;
        Some(Mutex::new(req_tx))
    }

    fn selection_worker_loop(req_rx: Receiver<SelectionRespTx>) {
        while let Ok(resp_tx) = req_rx.recv() {
            let result = selection_probe_blocking();
            // 呼叫端可能已逾时离开（receiver drop）：try_send 失败直接丢弃
            let _ = resp_tx.try_send(result);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_extract_excerpt_empty() {
            assert_eq!(extract_excerpt("", None, 50), "");
        }

        #[test]
        fn test_extract_excerpt_short_text() {
            let text = "Hello world";
            let result = extract_excerpt(text, Some(5), 50);
            assert_eq!(result, "Hello world");
        }

        #[test]
        fn test_extract_excerpt_cursor_in_middle() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(100), 50);
            assert_eq!(result.chars().count(), 100); // 50 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_start() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(0), 50);
            assert_eq!(result.chars().count(), 50); // 0 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_end() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(200), 50);
            assert_eq!(result.chars().count(), 50); // 50 before + 0 after
        }

        #[test]
        fn test_extract_excerpt_no_cursor_fallback() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, None, 50);
            assert_eq!(result.chars().count(), 100); // fallback last 100 chars
        }

        #[test]
        fn test_extract_excerpt_cjk_characters() {
            let text =
                "这是一段很长的中文测试文字，用来验证游标附近截取功能是否正确处理多位元组字元";
            let result = extract_excerpt(text, Some(10), 5);
            assert_eq!(result.chars().count(), 10); // 5 before + 5 after
        }

        #[test]
        fn test_is_text_input_role() {
            assert!(is_text_input_role("AXTextField"));
            assert!(is_text_input_role("AXTextArea"));
            assert!(is_text_input_role("AXComboBox"));
            assert!(is_text_input_role("AXWebArea"));
            assert!(!is_text_input_role("AXButton"));
            assert!(!is_text_input_role("AXStaticText"));
        }
    }
}

// ========== Windows: UI Automation ==========

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    use windows::core::BOOL;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextPattern2, IUIAutomationTextRange, IUIAutomationValuePattern,
        TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Character,
        UIA_TextPattern2Id, UIA_TextPatternId, UIA_ValuePatternId,
    };

    /// 游标前后各取的字数（对齐 macOS CONTEXT_CHARS）。
    const CONTEXT_CHARS: i32 = 50;
    /// TextPattern GetText 上限＝游标前后 excerpt 宽度（caret ± CONTEXT_CHARS）。
    /// 设成 excerpt 宽度，确保即使 provider 未照 MoveEndpointByUnit 收敛，
    /// 回传的仍是「从 range 起点（caret 前缘）」起算的 caret 区段，不会被 cap_tail 从尾端截掉。
    const GET_TEXT_CAP: i32 = CONTEXT_CHARS * 2;
    /// ValuePattern 整栏值 fallback 的字元上限（隐私 / 成本保护）。
    const MAX_VALUE_CHARS: usize = 600;
    /// 单次 UIA 读取 timeout，需小于前端轮询间隔（500ms），避免阻塞 command thread。
    const READ_TIMEOUT_MS: u64 = 250;

    type RespTx = SyncSender<Option<String>>;

    static IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    static WORKER: OnceLock<Option<Mutex<SyncSender<RespTx>>>> = OnceLock::new();

    /// 入口：把读取请求送到专用 UIA 执行绪，最多等 `READ_TIMEOUT_MS`。
    /// 任何失败 / 逾时 / 忙碌一律回 `Ok(None)`（与 macOS 一致，静默降级）。
    ///
    /// 契约：回传游标附近「有上限」的文字（TextPattern excerpt ≤ ~100 字，
    /// 或 ValuePattern 整栏值 ≤ `MAX_VALUE_CHARS` 字），绝不回传整份文件。
    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        let sender = match worker_sender() {
            Some(s) => s,
            None => return Ok(None),
        };

        // single-flight：已有读取进行中就放弃这次，避免轮询呼叫堆叠阻塞。
        if IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return Ok(None);
        }

        // 由「呼叫端」在所有路径（成功 / 逾时 / 送出失败）后清掉 IN_FLIGHT，
        // 不依赖 worker 清旗标：若某次 UIA 呼叫永久卡死、worker 回不来，
        // 旗标才不会永久卡 true 而使功能静默失效。每次呼叫各有独立 oneshot
        // channel，卡死 worker 的迟到结果只会送进已 drop 的 receiver 而被丢弃。
        let outcome = read_once(&sender);
        IN_FLIGHT.store(false, Ordering::Release);
        Ok(outcome)
    }

    /// 送一次读取请求并等 `READ_TIMEOUT_MS`；逾时 / 送出失败一律回 `None`。
    fn read_once(sender: &SyncSender<RespTx>) -> Option<String> {
        let (resp_tx, resp_rx) = sync_channel::<Option<String>>(1);
        if sender.try_send(resp_tx).is_err() {
            return None;
        }
        resp_rx
            .recv_timeout(Duration::from_millis(READ_TIMEOUT_MS))
            .unwrap_or(None)
    }

    fn worker_sender() -> Option<SyncSender<RespTx>> {
        let cell = WORKER.get_or_init(spawn_worker);
        let mutex = cell.as_ref()?;
        let guard = mutex.lock().ok()?;
        Some(guard.clone())
    }

    /// 启动长寿 MTA 执行绪，内含快取的 `IUIAutomation`。
    /// 回传 `None` 代表 COM / UIA 初始化失败（此平台功能等同 no-op）。
    fn spawn_worker() -> Option<Mutex<SyncSender<RespTx>>> {
        let (req_tx, req_rx) = sync_channel::<RespTx>(1);
        let (ready_tx, ready_rx) = sync_channel::<bool>(0);

        std::thread::Builder::new()
            .name("uia-reader".into())
            .spawn(move || worker_loop(req_rx, ready_tx))
            .ok()?;

        match ready_rx.recv() {
            Ok(true) => Some(Mutex::new(req_tx)),
            _ => None,
        }
    }

    fn worker_loop(req_rx: Receiver<RespTx>, ready_tx: SyncSender<bool>) {
        // 此执行绪专用 MTA COM，存活整个 process 生命周期；COM 物件不跨执行绪传递。
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let automation: IUIAutomation =
            match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) } {
                Ok(a) => a,
                Err(_) => {
                    let _ = ready_tx.send(false);
                    unsafe { CoUninitialize() };
                    return;
                }
            };

        let _ = ready_tx.send(true);

        while let Ok(resp_tx) = req_rx.recv() {
            let result = read_excerpt(&automation);
            // 即使呼叫端已逾时离开（receiver 被 drop）也不阻塞；IN_FLIGHT 由呼叫端清。
            let _ = resp_tx.try_send(result);
        }

        unsafe { CoUninitialize() };
    }

    /// 读取目前聚焦元素游标附近文字。全程在 worker 执行绪上跑。
    fn read_excerpt(automation: &IUIAutomation) -> Option<String> {
        let element = unsafe { automation.GetFocusedElement() }.ok()?;

        // 隐私保护：聚焦在密码 / 受保护栏位时不读取，避免把密码 / token / API key 送 LLM。
        if is_password_element(&element) {
            return None;
        }

        // 1) 优先：TextPattern 游标附近 excerpt（涵盖 contenteditable，如 Teams / 文件编辑器）。
        if let Some(text) = read_via_text_pattern(&element) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(cap_tail(trimmed, (CONTEXT_CHARS as usize) * 2));
            }
        }

        // 2) Fallback：ValuePattern 整栏值（涵盖原生 input / textarea），capped。
        if let Some(text) = read_via_value_pattern(&element) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(cap_tail(trimmed, MAX_VALUE_CHARS));
            }
        }

        None
    }

    /// 聚焦元素是否为密码 / 受保护栏位（读不到属性时保守视为「是」→ fail-closed，
    /// 对未正确暴露 IsPassword 的第三方栏位较安全，避免把可能的密码 / token 送 LLM）。
    fn is_password_element(element: &IUIAutomationElement) -> bool {
        unsafe { element.CurrentIsPassword() }
            .map(|b| b.as_bool())
            .unwrap_or(true)
    }

    fn read_via_text_pattern(element: &IUIAutomationElement) -> Option<String> {
        let range = caret_range(element)?;
        unsafe {
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                -CONTEXT_CHARS,
            );
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                CONTEXT_CHARS,
            );
            let bstr = range.GetText(GET_TEXT_CAP).ok()?;
            Some(bstr.to_string())
        }
    }

    /// 取得游标 range：先试 `TextPattern2.GetCaretRange`，再 fallback 到 `TextPattern.GetSelection()[0]`。
    fn caret_range(element: &IUIAutomationElement) -> Option<IUIAutomationTextRange> {
        unsafe {
            if let Ok(tp2) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
            {
                let mut is_active = BOOL(0);
                if let Ok(range) = tp2.GetCaretRange(&mut is_active) {
                    return Some(range);
                }
            }

            if let Ok(tp) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                if let Ok(selection) = tp.GetSelection() {
                    if matches!(selection.Length(), Ok(len) if len > 0) {
                        if let Ok(range) = selection.GetElement(0) {
                            return Some(range);
                        }
                    }
                }
            }

            None
        }
    }

    fn read_via_value_pattern(element: &IUIAutomationElement) -> Option<String> {
        unsafe {
            let value_pattern = element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()?;
            let bstr = value_pattern.CurrentValue().ok()?;
            Some(bstr.to_string())
        }
    }

    /// 取字串末尾最多 `max` 个字元（以 char 计，CJK 安全）。
    fn cap_tail(s: &str, max: usize) -> String {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() <= max {
            s.to_string()
        } else {
            chars[chars.len() - max..].iter().collect()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::cap_tail;

        #[test]
        fn test_cap_tail_shorter_than_max() {
            assert_eq!(cap_tail("hello", 10), "hello");
        }

        #[test]
        fn test_cap_tail_equal_to_max() {
            assert_eq!(cap_tail("hello", 5), "hello");
        }

        #[test]
        fn test_cap_tail_keeps_tail() {
            assert_eq!(cap_tail("abcdefghij", 3), "hij");
        }

        #[test]
        fn test_cap_tail_cjk() {
            let s = "这是一段中文测试文字";
            assert_eq!(cap_tail(s, 4), "测试文字");
            assert_eq!(cap_tail(s, 4).chars().count(), 4);
        }

        #[test]
        fn test_cap_tail_empty() {
            assert_eq!(cap_tail("", 5), "");
        }
    }
}
