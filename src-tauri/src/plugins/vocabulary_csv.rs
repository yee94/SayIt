//! 词典 CSV 持久化：双 WebView 共用一把 Mutex，写入采临时档 + rename 原子替换。
//! 预设路径：`{app_data_dir}/vocabulary.csv`
//! 可用环境变数 `SAYIT_VOCABULARY_CSV` 覆写（例如指向 iCloud 共享目录）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};

const CSV_FILE_NAME: &str = "vocabulary.csv";
const ENV_PATH_OVERRIDE: &str = "SAYIT_VOCABULARY_CSV";

/// 进程内互斥：HUD / Dashboard 同时读写时避免交错写坏档案
pub struct VocabularyCsvState {
    lock: Mutex<()>,
}

impl VocabularyCsvState {
    pub fn new() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyCsvEntry {
    pub id: String,
    pub term: String,
    pub weight: i64,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyCsvLoadResult {
    pub entries: Vec<VocabularyCsvEntry>,
    /// 档案是否已存在（含仅有表头的空表）；用于前端决定要不要从 SQLite 迁移
    pub file_exists: bool,
}

fn resolve_vocabulary_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var(ENV_PATH_OVERRIDE) {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_data_dir.join(CSV_FILE_NAME))
}

fn escape_csv_field(value: &str) -> String {
    if value.contains('"') || value.contains(',') || value.contains('\n') || value.contains('\r')
    {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn serialize_entries(entries: &[VocabularyCsvEntry]) -> String {
    let mut out = String::from("id,term,weight,source,created_at\n");
    for entry in entries {
        out.push_str(&escape_csv_field(&entry.id));
        out.push(',');
        out.push_str(&escape_csv_field(&entry.term));
        out.push(',');
        out.push_str(&entry.weight.to_string());
        out.push(',');
        out.push_str(&escape_csv_field(&entry.source));
        out.push(',');
        out.push_str(&escape_csv_field(&entry.created_at));
        out.push('\n');
    }
    out
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if in_quotes {
            if ch == '"' {
                if i + 1 < chars.len() && chars[i + 1] == '"' {
                    current.push('"');
                    i += 2;
                    continue;
                }
                in_quotes = false;
            } else {
                current.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' {
            fields.push(std::mem::take(&mut current));
        } else {
            current.push(ch);
        }
        i += 1;
    }
    fields.push(current);
    fields
}

fn parse_entries(content: &str) -> Vec<VocabularyCsvEntry> {
    let normalized = content.trim_start_matches('\u{feff}').trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let lines: Vec<&str> = normalized
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let header = parse_csv_line(lines[0])
        .iter()
        .map(|f| f.trim().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join(",");
    let start = if header == "id,term,weight,source,created_at" {
        1
    } else {
        0
    };

    let mut entries = Vec::new();
    for line in lines.iter().skip(start) {
        let fields = parse_csv_line(line);
        if fields.len() < 5 {
            continue;
        }
        let id = fields[0].trim();
        let term = fields[1].trim();
        let weight_raw = fields[2].trim();
        let source = fields[3].trim();
        let created_at = fields[4].trim();
        if id.is_empty() || term.is_empty() || created_at.is_empty() {
            continue;
        }
        if source != "manual" && source != "ai" {
            continue;
        }
        let weight = weight_raw.parse::<i64>().unwrap_or(1).max(1);
        entries.push(VocabularyCsvEntry {
            id: id.to_string(),
            term: term.to_string(),
            weight,
            source: source.to_string(),
            created_at: created_at.to_string(),
        });
    }
    entries
}

fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create vocabulary dir: {e}"))?;
    }

    let tmp_path = path.with_extension("csv.tmp");
    fs::write(&tmp_path, content).map_err(|e| format!("Failed to write vocabulary temp: {e}"))?;
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to replace vocabulary.csv: {e}")
    })?;
    Ok(())
}

/// 载入词典 CSV；档案不存在时回传空列表且 `file_exists=false`
#[command]
pub fn load_vocabulary_csv(
    app: AppHandle,
    state: State<'_, VocabularyCsvState>,
) -> Result<VocabularyCsvLoadResult, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "vocabulary csv lock poisoned".to_string())?;

    let path = resolve_vocabulary_path(&app)?;
    if !path.exists() {
        return Ok(VocabularyCsvLoadResult {
            entries: Vec::new(),
            file_exists: false,
        });
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read vocabulary.csv: {e}"))?;
    Ok(VocabularyCsvLoadResult {
        entries: parse_entries(&content),
        file_exists: true,
    })
}

/// 整表覆写词典 CSV（原子写）；空列表仍会写出表头，标记「已落地」
#[command]
pub fn save_vocabulary_csv(
    app: AppHandle,
    state: State<'_, VocabularyCsvState>,
    entries: Vec<VocabularyCsvEntry>,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "vocabulary csv lock poisoned".to_string())?;

    let path = resolve_vocabulary_path(&app)?;
    let content = serialize_entries(&entries);
    atomic_write(&path, &content)?;
    Ok(())
}

/// 回传目前使用的 CSV 绝对路径（除错 / 后续接 iCloud 用）
#[command]
pub fn get_vocabulary_csv_path(app: AppHandle) -> Result<String, String> {
    resolve_vocabulary_path(&app).map(|p| p.to_string_lossy().to_string())
}
