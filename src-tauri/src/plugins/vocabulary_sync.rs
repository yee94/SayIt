//! 可选 iCloud/共享文件夹词典同步：原生选目录 + 读写设备快照 CSV。
//! 快照档名：`sayit-vocabulary-{deviceId}.csv`

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{command, AppHandle};

const SYNC_FILE_PREFIX: &str = "sayit-vocabulary-";
const SYNC_FILE_SUFFIX: &str = ".csv";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularySyncSnapshot {
    pub device_id: String,
    pub path: String,
    pub content: String,
}

#[cfg(target_os = "macos")]
fn pick_directory_macos() -> Result<Option<String>, String> {
    use objc::{class, msg_send, runtime::Object, sel, sel_impl};
    use std::ffi::CStr;

    unsafe {
        let panel: *mut Object = msg_send![class!(NSOpenPanel), openPanel];
        if panel.is_null() {
            return Err("Failed to create NSOpenPanel".to_string());
        }

        let _: () = msg_send![panel, setCanChooseFiles: false];
        let _: () = msg_send![panel, setCanChooseDirectories: true];
        let _: () = msg_send![panel, setAllowsMultipleSelection: false];
        let _: () = msg_send![panel, setCanCreateDirectories: true];
        let _: () = msg_send![panel, setMessage: ns_string("选择用于词典同步的 iCloud 文件夹")];

        // NSModalResponseOK == 1
        let response: i64 = msg_send![panel, runModal];
        if response != 1 {
            return Ok(None);
        }

        let urls: *mut Object = msg_send![panel, URLs];
        if urls.is_null() {
            return Ok(None);
        }
        let count: u64 = msg_send![urls, count];
        if count == 0 {
            return Ok(None);
        }

        let url: *mut Object = msg_send![urls, objectAtIndex: 0_u64];
        if url.is_null() {
            return Ok(None);
        }
        let path: *mut Object = msg_send![url, path];
        if path.is_null() {
            return Ok(None);
        }
        let utf8: *const i8 = msg_send![path, UTF8String];
        if utf8.is_null() {
            return Ok(None);
        }
        let c_str = CStr::from_ptr(utf8);
        let path_str = c_str.to_string_lossy().to_string();
        if path_str.trim().is_empty() {
            Ok(None)
        } else {
            Ok(Some(path_str))
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn ns_string(text: &str) -> *mut objc::runtime::Object {
    use objc::{class, msg_send, runtime::Object, sel, sel_impl};
    use std::ffi::CString;

    let c_string = CString::new(text).unwrap_or_default();
    let ns_string: *mut Object = msg_send![class!(NSString), stringWithUTF8String: c_string.as_ptr()];
    ns_string
}

#[cfg(not(target_os = "macos"))]
fn pick_directory_macos() -> Result<Option<String>, String> {
    Err("Directory picker is only supported on macOS".to_string())
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Sync directory does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("Sync path is not a directory: {}", path.display()));
    }
    Ok(())
}

fn snapshot_path(directory: &Path, device_id: &str) -> PathBuf {
    directory.join(format!(
        "{SYNC_FILE_PREFIX}{}{SYNC_FILE_SUFFIX}",
        device_id.trim()
    ))
}

fn parse_device_id_from_filename(name: &str) -> Option<String> {
    if !name.starts_with(SYNC_FILE_PREFIX) || !name.ends_with(SYNC_FILE_SUFFIX) {
        return None;
    }
    let mid = &name[SYNC_FILE_PREFIX.len()..name.len() - SYNC_FILE_SUFFIX.len()];
    let trimmed = mid.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 打开原生目录选择器（macOS NSOpenPanel）；取消回传 null
#[command]
pub fn pick_vocabulary_sync_directory(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = pick_directory_macos();
        let _ = tx.send(result);
    })
    .map_err(|e| format!("Failed to run directory picker on main thread: {e}"))?;

    rx.recv_timeout(Duration::from_secs(300))
        .map_err(|_| "Directory picker timed out".to_string())?
}

/// 列出同步目录内所有设备快照（含内容）
#[command]
pub fn list_vocabulary_sync_snapshots(
    directory_path: String,
) -> Result<Vec<VocabularySyncSnapshot>, String> {
    let directory = PathBuf::from(directory_path.trim());
    ensure_directory(&directory)?;

    let mut snapshots = Vec::new();
    let entries = fs::read_dir(&directory)
        .map_err(|e| format!("Failed to read sync directory: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read sync entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(device_id) = parse_device_id_from_filename(name) else {
            continue;
        };
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        snapshots.push(VocabularySyncSnapshot {
            device_id,
            path: path.to_string_lossy().to_string(),
            content,
        });
    }

    snapshots.sort_by(|a, b| a.device_id.cmp(&b.device_id));
    Ok(snapshots)
}

/// 写出本机设备快照（原子写）
#[command]
pub fn write_vocabulary_sync_snapshot(
    directory_path: String,
    device_id: String,
    content: String,
) -> Result<String, String> {
    let directory = PathBuf::from(directory_path.trim());
    ensure_directory(&directory)?;

    let trimmed_device_id = device_id.trim();
    if trimmed_device_id.is_empty() {
        return Err("deviceId is required".to_string());
    }
    if trimmed_device_id.contains('/') || trimmed_device_id.contains('\\') {
        return Err("deviceId contains invalid path characters".to_string());
    }

    let path = snapshot_path(&directory, trimmed_device_id);
    let tmp_path = path.with_extension("csv.tmp");
    fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write sync temp file: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to replace sync snapshot: {e}")
    })?;

    Ok(path.to_string_lossy().to_string())
}
