use arboard::Clipboard;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Runtime, State};

/// 贴上指令触发后等多久才把剪贴簿还原成原内容（毫秒）。
/// 太短：目标 app 还没消费完 paste，会贴到旧内容；太长：使用者感受得到延迟。
/// 200ms 在实测下对绝大部分 app 足够。
const RESTORE_DELAY_MS: u64 = 200;

// ========== Focus State ==========

/// 储存使用者启动录音前的前景目标，贴上后 / 学习读取时恢复。
/// - Windows: HWND（SendInput 依赖前景窗）
/// - macOS: 目标 App 的 PID（HUD 抢焦点后，AX 需按 PID 读目标 App 的输入框）
pub struct FocusState {
    #[cfg(target_os = "windows")]
    target_hwnd: std::sync::Mutex<isize>,
    #[cfg(target_os = "macos")]
    target_pid: std::sync::Mutex<i32>,
}

impl FocusState {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            target_hwnd: std::sync::Mutex::new(0),
            #[cfg(target_os = "macos")]
            target_pid: std::sync::Mutex::new(0),
        }
    }

    /// macOS: 取得录音开始时记下的目标 App PID（0 = 未知）
    #[cfg(target_os = "macos")]
    pub fn macos_target_pid(&self) -> i32 {
        self.target_pid.lock().map(|g| *g).unwrap_or(0)
    }
}

// ========== Errors ==========

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("Clipboard access failed: {0}")]
    ClipboardAccess(String),
    #[error("Keyboard simulation failed: {0}")]
    KeyboardSimulation(String),
}

impl serde::Serialize for ClipboardError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 透过 CGEvent 模拟 Cmd+V 键盘事件来触发贴上。
///
/// 事件序列：Cmd↓ → V↓ → V↑ → Cmd↑
/// keycodes: Command_L=55, V=9
/// 需要 Accessibility 权限（已有）。
/// 4 事件完整配对，paste 场景下幽灵按键风险趋近于零。
#[cfg(target_os = "macos")]
fn simulate_paste_via_cgevent() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEYCODE_COMMAND_L: u16 = 55;
    const KEYCODE_V: u16 = 9;

    // Private source：隔离的事件源，不继承物理键盘的 modifier 状态
    // 解决 Toggle 模式下右 Option 残留 Alternate flag 导致重复贴上的问题
    let source = CGEventSource::new(CGEventSourceStateID::Private)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    // Cmd ↓
    let cmd_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_COMMAND_L, true)
        .map_err(|_| "Failed to create Cmd down event".to_string())?;
    cmd_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // V ↓ (with Command flag)
    let v_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, true)
        .map_err(|_| "Failed to create V down event".to_string())?;
    v_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // V ↑ (with Command flag)
    let v_up = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, false)
        .map_err(|_| "Failed to create V up event".to_string())?;
    v_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Cmd ↑
    let cmd_up = CGEvent::new_keyboard_event(source, KEYCODE_COMMAND_L, false)
        .map_err(|_| "Failed to create Cmd up event".to_string())?;
    cmd_up.set_flags(CGEventFlags::CGEventFlagNull);

    // Post events in sequence (Session 层：避免新版 macOS HID 管线重复投递)
    cmd_down.post(CGEventTapLocation::Session);
    v_down.post(CGEventTapLocation::Session);
    v_up.post(CGEventTapLocation::Session);
    cmd_up.post(CGEventTapLocation::Session);

    Ok(())
}

/// 透过 CGEvent 模拟 Cmd+C 键盘事件来触发复制。
///
/// 事件序列：Cmd↓ → C↓ → C↑ → Cmd↑
/// keycodes: Command_L=55, C=8
#[cfg(target_os = "macos")]
fn simulate_copy_via_cgevent() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEYCODE_COMMAND_L: u16 = 55;
    const KEYCODE_C: u16 = 8;

    let source = CGEventSource::new(CGEventSourceStateID::Private)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    let cmd_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_COMMAND_L, true)
        .map_err(|_| "Failed to create Cmd down event".to_string())?;
    cmd_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let c_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, true)
        .map_err(|_| "Failed to create C down event".to_string())?;
    c_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let c_up = CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, false)
        .map_err(|_| "Failed to create C up event".to_string())?;
    c_up.set_flags(CGEventFlags::CGEventFlagCommand);

    let cmd_up = CGEvent::new_keyboard_event(source, KEYCODE_COMMAND_L, false)
        .map_err(|_| "Failed to create Cmd up event".to_string())?;
    cmd_up.set_flags(CGEventFlags::CGEventFlagNull);

    cmd_down.post(CGEventTapLocation::Session);
    c_down.post(CGEventTapLocation::Session);
    c_up.post(CGEventTapLocation::Session);
    cmd_up.post(CGEventTapLocation::Session);

    Ok(())
}

/// 透过 SendInput 模拟 Ctrl+C 按键来触发复制。
#[cfg(target_os = "windows")]
fn simulate_copy_via_keyboard() -> Result<(), String> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    unsafe {
        let mut inputs: [INPUT; 4] = mem::zeroed();

        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki.wVk = VK_CONTROL;

        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki.wVk = VK_C;

        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki.wVk = VK_C;
        inputs[2].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki.wVk = VK_CONTROL;
        inputs[3].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        let sent = SendInput(&inputs, mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(format!("SendInput returned {}, expected 4", sent));
        }
    }

    Ok(())
}

/// 透过 SendInput 模拟 Ctrl+V 按键来触发贴上。
///
/// Windows 不像 macOS 有 CGEvent 残留问题，SendInput 是标准做法。
/// SendInput 会送到当前前景视窗，因此呼叫前必须确保目标视窗已是前景。
#[cfg(target_os = "windows")]
fn simulate_paste_via_keyboard() -> Result<(), String> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    unsafe {
        let mut inputs: [INPUT; 4] = mem::zeroed();

        // Ctrl ↓
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki.wVk = VK_CONTROL;

        // V ↓
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki.wVk = VK_V;

        // V ↑
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki.wVk = VK_V;
        inputs[2].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        // Ctrl ↑
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki.wVk = VK_CONTROL;
        inputs[3].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        let sent = SendInput(&inputs, mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(format!("SendInput returned {}, expected 4", sent));
        }
    }

    Ok(())
}

/// 恢复先前捕获的前景视窗焦点。
/// 使用 AttachThreadInput 技巧绕过 Windows 对 SetForegroundWindow 的限制。
#[cfg(target_os = "windows")]
fn restore_target_window(hwnd_value: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::AttachThreadInput;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    unsafe {
        let target = HWND(hwnd_value as *mut _);
        let current_fg = GetForegroundWindow();

        if current_fg == target {
            return; // 已是前景，无需操作
        }

        let current_thread = GetWindowThreadProcessId(current_fg, None);
        let target_thread = GetWindowThreadProcessId(target, None);

        if current_thread != target_thread && current_thread != 0 && target_thread != 0 {
            let _ = AttachThreadInput(current_thread, target_thread, true);
            let _ = SetForegroundWindow(target);
            let _ = AttachThreadInput(current_thread, target_thread, false);
        } else {
            let _ = SetForegroundWindow(target);
        }

        println!("[clipboard-paste] Restored target window: {:?}", target);
    }
}

/// 捕获当前前景视窗，供后续 paste_text 恢复焦点。
/// 应在 hotkey 触发时（HUD 显示前）呼叫。
/// 回传目标标识：macOS = PID；Windows = HWND 的 isize；其它 = 0。
#[tauri::command]
pub fn capture_target_window(state: State<'_, FocusState>) -> Result<i64, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        unsafe {
            let hwnd = GetForegroundWindow();
            let raw = hwnd.0 as isize;
            if let Ok(mut guard) = state.target_hwnd.lock() {
                *guard = raw;
            }
            println!("[clipboard-paste] Captured target window: {:?}", hwnd);
            Ok(raw as i64)
        }
    }
    #[cfg(target_os = "macos")]
    {
        // 记录录音开始时的前台 App PID，供智能字典学习在 HUD 抢焦点后仍能读到目标输入框
        let pid = macos_frontmost_pid().unwrap_or(0);
        if let Ok(mut guard) = state.target_pid.lock() {
            *guard = pid;
        }
        println!("[clipboard-paste] Captured target app pid={pid}");
        Ok(i64::from(pid))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = state;
        Ok(0)
    }
}

#[cfg(target_os = "macos")]
fn macos_frontmost_pid() -> Option<i32> {
    use objc::{class, msg_send, runtime::Object, sel, sel_impl};
    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        if pid > 0 {
            Some(pid)
        } else {
            None
        }
    }
}

/// 透过模拟 Cmd+C（macOS）/ Ctrl+C（Windows）撷取当前选取的文字。
///
/// 流程：储存剪贴簿 → 清空 → 模拟复制 → 等待 → 读取 → 还原 → 回传。
/// 对任何支援 Cmd+C 的 app 都有效，不依赖 Accessibility API。
pub fn capture_selected_text_via_clipboard() -> Result<Option<String>, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    // 1. 储存当前剪贴簿文字
    let original_text = clipboard.get_text().ok();

    // 2. 清空剪贴簿作为哨兵值
    clipboard.set_text("").map_err(|e| e.to_string())?;

    // 3. 模拟 Cmd+C / Ctrl+C（失败时先还原剪贴簿再 return）
    let copy_result = {
        #[cfg(target_os = "macos")]
        {
            simulate_copy_via_cgevent()
        }
        #[cfg(target_os = "windows")]
        {
            simulate_copy_via_keyboard()
        }
    };
    if let Err(e) = copy_result {
        restore_clipboard_text(&mut clipboard, &original_text);
        return Err(e);
    }

    // 4. 等待剪贴簿更新
    thread::sleep(Duration::from_millis(100));

    // 5. 读取剪贴簿
    let copied_text = clipboard.get_text().ok().filter(|t| !t.is_empty());

    // 6. 还原剪贴簿
    restore_clipboard_text(&mut clipboard, &original_text);

    // 7. 回传
    match copied_text {
        Some(text) => {
            eprintln!(
                "[clipboard-paste] capture_selected_text: got {} chars",
                text.len()
            );
            Ok(Some(text))
        }
        None => {
            eprintln!("[clipboard-paste] capture_selected_text: no selection detected");
            Ok(None)
        }
    }
}

fn restore_clipboard_text(clipboard: &mut Clipboard, original_text: &Option<String>) {
    if let Some(ref text) = original_text {
        if let Err(e) = clipboard.set_text(text) {
            eprintln!("[clipboard-paste] failed to restore clipboard: {e}");
        }
    }
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), ClipboardError> {
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn paste_text<R: Runtime>(
    _app: AppHandle<R>,
    focus_state: State<'_, FocusState>,
    text: String,
    restore_clipboard: bool,
) -> Result<(), ClipboardError> {
    // DEBUG: 追踪 paste_text 被呼叫次数
    use std::sync::atomic::AtomicU32;
    static PASTE_CALL_COUNT: AtomicU32 = AtomicU32::new(0);
    let call_id = PASTE_CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    println!(
        "🔴🔴🔴 [clipboard-paste] paste_text CALLED (#{}) — {} chars (restore={})",
        call_id,
        text.len(),
        restore_clipboard
    );
    #[cfg(debug_assertions)]
    println!(
        "[clipboard-paste] Pasting {} chars: \"{}\"",
        text.len(),
        text
    );
    #[cfg(not(debug_assertions))]
    println!("[clipboard-paste] Pasting {} chars", text.len());

    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;

    // 若使用者要求还原，先抓快照。Err 涵盖非文字内容／暂时锁等情况，视为「无可还原」
    let original_text = if restore_clipboard {
        match clipboard.get_text() {
            Ok(t) if !t.is_empty() => {
                println!(
                    "[clipboard-paste] Snapshot original clipboard ({} chars)",
                    t.len()
                );
                Some(t)
            }
            Ok(_) => {
                println!("[clipboard-paste] Snapshot: clipboard was empty");
                None
            }
            Err(e) => {
                eprintln!("[clipboard-paste] Snapshot: read failed (likely non-text content): {e}");
                None
            }
        }
    } else {
        None
    };

    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    println!("[clipboard-paste] Text copied to clipboard");

    thread::sleep(Duration::from_millis(50));

    // 捕获错误而非 ?-propagate：要先跑完还原才回报错误，避免转录文字遗留在剪贴簿
    let mut paste_err: Option<String> = None;

    #[cfg(target_os = "macos")]
    {
        let _ = &focus_state; // macOS 不需要焦点恢复（CGEvent 是进程级）
        match simulate_paste_via_cgevent() {
            Ok(()) => println!("[clipboard-paste] Paste triggered via CGEvent (Cmd+V)"),
            Err(e) => {
                eprintln!("[clipboard-paste] CGEvent paste failed: {e}");
                paste_err = Some(e);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 恢复录音前的前景视窗，确保 SendInput 送到正确目标
        let saved_hwnd = focus_state.target_hwnd.lock().ok().map(|g| *g).unwrap_or(0);
        if saved_hwnd != 0 {
            restore_target_window(saved_hwnd);
            thread::sleep(Duration::from_millis(50));
        }

        match simulate_paste_via_keyboard() {
            Ok(()) => println!("[clipboard-paste] Paste triggered via SendInput (Ctrl+V)"),
            Err(e) => {
                eprintln!("[clipboard-paste] SendInput paste failed: {}", e);
                paste_err = Some(e);
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        compile_error!("paste_text keyboard simulation is not implemented for this platform");
    }

    // 即使 paste 失败也要还原，避免转录文字遗留在剪贴簿
    if restore_clipboard {
        thread::sleep(Duration::from_millis(RESTORE_DELAY_MS));
        restore_clipboard_text(&mut clipboard, &original_text);
    }

    if let Some(e) = paste_err {
        return Err(ClipboardError::KeyboardSimulation(e));
    }

    println!("[clipboard-paste] Done");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // ClipboardError Display 格式化测试
    // ============================================================

    #[test]
    fn test_clipboard_access_error_display() {
        let error = ClipboardError::ClipboardAccess("permission denied".to_string());
        assert_eq!(
            error.to_string(),
            "Clipboard access failed: permission denied"
        );
    }

    #[test]
    fn test_keyboard_simulation_error_display() {
        let error = ClipboardError::KeyboardSimulation("CGEvent failed".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: CGEvent failed"
        );
    }

    #[test]
    fn test_clipboard_access_error_display_empty_message() {
        let error = ClipboardError::ClipboardAccess(String::new());
        assert_eq!(error.to_string(), "Clipboard access failed: ");
    }

    #[test]
    fn test_keyboard_simulation_error_display_unicode() {
        let error = ClipboardError::KeyboardSimulation("键盘模拟失败".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: 键盘模拟失败"
        );
    }

    // ============================================================
    // ClipboardError Serialize 测试
    // ============================================================

    #[test]
    fn test_clipboard_access_error_serialize() {
        let error = ClipboardError::ClipboardAccess("no clipboard".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "\"Clipboard access failed: no clipboard\"");
    }

    #[test]
    fn test_keyboard_simulation_error_serialize() {
        let error = ClipboardError::KeyboardSimulation("event creation failed".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(
            json,
            "\"Keyboard simulation failed: event creation failed\""
        );
    }

    #[test]
    fn test_error_serialize_roundtrip_is_string() {
        // ClipboardError 序列化后应为纯字串，非物件
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let value: serde_json::Value = serde_json::to_value(&error).unwrap();
        assert!(value.is_string(), "序列化结果应为 JSON 字串，非物件");
    }

    // ============================================================
    // ClipboardError Debug trait 测试
    // ============================================================

    #[test]
    fn test_clipboard_error_debug_format() {
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let debug_str = format!("{error:?}");
        assert!(debug_str.contains("ClipboardAccess"));
        assert!(debug_str.contains("test"));
    }

    #[test]
    fn test_keyboard_error_debug_format() {
        let error = ClipboardError::KeyboardSimulation("sim fail".to_string());
        let debug_str = format!("{error:?}");
        assert!(debug_str.contains("KeyboardSimulation"));
        assert!(debug_str.contains("sim fail"));
    }

    /// 还原延迟区间守门：避免改成 0（还没贴完就还原）或数秒（使用者感受到延迟）。
    /// 改动延迟值前须做手动实测，仅靠单元测试无法保证真实 paste 已消费完。
    #[test]
    fn test_restore_delay_ms_within_sane_range() {
        assert!(
            (50..=1000).contains(&RESTORE_DELAY_MS),
            "RESTORE_DELAY_MS={RESTORE_DELAY_MS} 应落在 50ms..=1000ms 之间"
        );
    }
}
