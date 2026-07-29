//! 屏幕上下文截图：供 AI 整理时附带前台应用与单帧 PNG。
//! macOS 使用 `screencapture`（需屏幕录制权限）；Windows 使用 GDI 截取主显示器。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContextCapture {
    /// PNG base64（无 data: 前缀）；失败时为 null
    pub image_base64: Option<String>,
    /// 前台应用名（尽力取得）
    pub app_name: Option<String>,
    /// window | display | none
    pub capture_mode: String,
}

fn screenshot_dir() -> PathBuf {
    std::env::temp_dir().join("sayit-screenshots")
}

fn unique_png_path() -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    screenshot_dir().join(format!("ctx-{millis}.png"))
}

fn read_png_as_base64(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read screenshot failed: {e}"))?;
    if bytes.is_empty() {
        return Err("screenshot file empty".to_string());
    }
    Ok(BASE64.encode(bytes))
}

fn cleanup_path(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(target_os = "macos")]
fn frontmost_app_name() -> Option<String> {
    // NSWorkspace.frontmostApplication.localizedName
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
        let name: *mut Object = msg_send![app, localizedName];
        if name.is_null() {
            return None;
        }
        let utf8: *const i8 = msg_send![name, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(
            std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned(),
        )
    }
}

#[cfg(target_os = "windows")]
fn frontmost_app_name() -> Option<String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let written = GetWindowTextW(hwnd, &mut buf);
        if written <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..written as usize]))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn frontmost_app_name() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn capture_display_png(path: &std::path::Path) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "invalid screenshot path".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir screenshot dir: {e}"))?;

    // -x: 无快门声；-t png；主显示器全屏
    let status = Command::new("screencapture")
        .args(["-x", "-t", "png", path.to_str().unwrap_or("")])
        .status()
        .map_err(|e| format!("screencapture spawn failed: {e}"))?;

    if !status.success() {
        return Err(format!(
            "screencapture exited with status {status} (need Screen Recording permission?)"
        ));
    }
    if !path.exists() {
        return Err("screencapture produced no file".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn capture_display_png(path: &std::path::Path) -> Result<(), String> {
    // 使用 PowerShell + System.Drawing 截主屏（避免复杂 GDI 绑定）
    let dir = path
        .parent()
        .ok_or_else(|| "invalid screenshot path".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir screenshot dir: {e}"))?;

    let path_str = path
        .to_str()
        .ok_or_else(|| "screenshot path not utf-8".to_string())?
        .replace('\'', "''");

    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('{path_str}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
"#
    );

    let status = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status()
        .map_err(|e| format!("powershell screenshot failed: {e}"))?;

    if !status.success() {
        return Err(format!("powershell screenshot exited {status}"));
    }
    if !path.exists() {
        return Err("powershell produced no screenshot file".to_string());
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn capture_display_png(_path: &std::path::Path) -> Result<(), String> {
    Err("screen capture not supported on this platform".to_string())
}

/// 捕获一帧屏幕上下文：前台应用名 + 主显示器 PNG（base64）。
/// 失败不抛致命错误：image 可为 null，仍回传 app_name。
#[tauri::command]
pub fn capture_screen_context() -> Result<ScreenContextCapture, String> {
    let app_name = frontmost_app_name();
    let path = unique_png_path();

    match capture_display_png(&path) {
        Ok(()) => match read_png_as_base64(&path) {
            Ok(b64) => {
                cleanup_path(&path);
                println!(
                    "[screen-context] captured png ({} chars base64), app={:?}",
                    b64.len(),
                    app_name
                );
                Ok(ScreenContextCapture {
                    image_base64: Some(b64),
                    app_name,
                    capture_mode: "display".to_string(),
                })
            }
            Err(e) => {
                cleanup_path(&path);
                eprintln!("[screen-context] encode failed: {e}");
                Ok(ScreenContextCapture {
                    image_base64: None,
                    app_name,
                    capture_mode: "none".to_string(),
                })
            }
        },
        Err(e) => {
            cleanup_path(&path);
            eprintln!("[screen-context] capture failed: {e}");
            Ok(ScreenContextCapture {
                image_base64: None,
                app_name,
                capture_mode: "none".to_string(),
            })
        }
    }
}

/// 清理临时截图目录（会话结束或关闭功能时调用，best-effort）。
#[tauri::command]
pub fn cleanup_screen_context_temp() -> Result<(), String> {
    let dir = screenshot_dir();
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}
