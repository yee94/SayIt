use std::io::Cursor;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
// SinkExt used by handle_binary_frame generic bound
use tauri::{command, AppHandle, Emitter, Runtime, State};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use super::audio_recorder::AudioRecorderState;

// ========== Constants ==========

const DEFAULT_WS_URL: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const DEFAULT_RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
const TARGET_SAMPLE_RATE: u32 = 16_000;
const PCM_CHUNK_MS: u32 = 200;
const PCM_BYTES_PER_SAMPLE: usize = 2;
const PCM_CHUNK_BYTES: usize =
    (TARGET_SAMPLE_RATE as usize * PCM_BYTES_PER_SAMPLE * PCM_CHUNK_MS as usize) / 1000;
const MINIMUM_AUDIO_SIZE: usize = 1000;
const MAX_AUDIO_FILE_SIZE: usize = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_SECS: u64 = 60;
const FINAL_RESULT_TIMEOUT_MS: u64 = 5_000;
const MAX_HOTWORDS: usize = 50;

// Binary protocol (Volcengine openspeech v3)
const PROTOCOL_VERSION: u8 = 0b0001;
const CLIENT_FULL_REQUEST: u8 = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST: u8 = 0b0010;
const SERVER_ERROR_RESPONSE: u8 = 0b1111;
const NO_SEQUENCE: u8 = 0b0000;
const LAST_PACKET_NO_SEQUENCE: u8 = 0b0010;
const SERIAL_JSON: u8 = 0b0001;
const SERIAL_NONE: u8 = 0b0000;
const COMPRESSION_NONE: u8 = 0b0000;

// ========== State ==========

/// 錄音中即時 ASR session（邊說邊出字幕）
struct LiveAsrSession {
    /// 設 true 後 worker 會送 final 包並收尾
    finish: Arc<AtomicBool>,
    /// 設 true 表示取消（ESC），不取最終結果
    cancel: Arc<AtomicBool>,
    /// worker 完成後寫入最終文本
    result: Arc<Mutex<Option<Result<TranscriptionResult, String>>>>,
    /// 等 worker 結束
    done_rx: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
}

pub struct TranscriptionState {
    live: Mutex<Option<LiveAsrSession>>,
}

impl TranscriptionState {
    pub fn new() -> Self {
        Self {
            live: Mutex::new(None),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.live.lock() {
            if let Some(session) = guard.take() {
                session.cancel.store(true, Ordering::SeqCst);
                session.finish.store(true, Ordering::SeqCst);
                if let Ok(mut rx) = session.done_rx.lock() {
                    if let Some(rx) = rx.take() {
                        let _ = rx.recv_timeout(std::time::Duration::from_millis(500));
                    }
                }
            }
        }
    }
}

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("No audio data available — call stop_recording first")]
    NoAudioData,
    #[error("Audio data too small ({0} bytes), recording may have failed")]
    AudioTooSmall(usize),
    #[error("Audio file too large ({size_mb:.1} MB, limit {limit_mb} MB). Please shorten your recording.")]
    FileTooLarge { size_mb: f64, limit_mb: usize },
    #[error("Doubao ASR credentials missing (appId / accessKey)")]
    ApiKeyMissing,
    #[error("Doubao ASR request failed: {0}")]
    RequestFailed(String),
    #[error("Doubao ASR returned error: {0}")]
    ApiError(String),
    #[error("Failed to parse audio: {0}")]
    ParseError(String),
    #[error("Lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for TranscriptionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========== Result Types ==========

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub transcription_duration_ms: f64,
    pub no_speech_probability: f64,
}

/// 串流中間結果（供 HUD 即時字幕）
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionPartialPayload {
    pub text: String,
}

const TRANSCRIPTION_PARTIAL_EVENT: &str = "transcription:partial";

// ========== Binary Codec ==========

fn generate_header(
    message_type: u8,
    message_type_specific_flags: u8,
    serial_method: u8,
) -> [u8; 8] {
    let mut buffer = [0u8; 8];
    let header_size: u8 = 1;
    buffer[0] = (PROTOCOL_VERSION << 4) | header_size;
    buffer[1] = (message_type << 4) | message_type_specific_flags;
    buffer[2] = (serial_method << 4) | COMPRESSION_NONE;
    buffer[3] = 0x00;
    buffer
}

fn encode_full_client_request(request_data: &serde_json::Value) -> Vec<u8> {
    let json_buf = serde_json::to_vec(request_data).unwrap_or_default();
    let mut header = generate_header(CLIENT_FULL_REQUEST, NO_SEQUENCE, SERIAL_JSON);
    let len = (json_buf.len() as u32).to_be_bytes();
    header[4..8].copy_from_slice(&len);
    let mut out = Vec::with_capacity(8 + json_buf.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&json_buf);
    out
}

fn encode_audio_only_request(pcm: &[u8], is_last: bool) -> Vec<u8> {
    let flags = if is_last {
        LAST_PACKET_NO_SEQUENCE
    } else {
        NO_SEQUENCE
    };
    let mut header = generate_header(CLIENT_AUDIO_ONLY_REQUEST, flags, SERIAL_NONE);
    let len = (pcm.len() as u32).to_be_bytes();
    header[4..8].copy_from_slice(&len);
    let mut out = Vec::with_capacity(8 + pcm.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(pcm);
    out
}

fn parse_server_error_message(buffer: &[u8]) -> Option<String> {
    if buffer.len() < 12 {
        return None;
    }
    let header_size = (buffer[0] & 0x0f) as usize;
    let error_code_offset = header_size * 4;
    if buffer.len() < error_code_offset + 8 {
        return None;
    }
    let error_code = i32::from_be_bytes([
        buffer[error_code_offset],
        buffer[error_code_offset + 1],
        buffer[error_code_offset + 2],
        buffer[error_code_offset + 3],
    ]);
    let payload_size = u32::from_be_bytes([
        buffer[error_code_offset + 4],
        buffer[error_code_offset + 5],
        buffer[error_code_offset + 6],
        buffer[error_code_offset + 7],
    ]) as usize;
    let payload_start = error_code_offset + 8;
    let payload_end = (payload_start + payload_size).min(buffer.len());
    if payload_end <= payload_start {
        return Some(format!("error_code={error_code}"));
    }
    let raw = String::from_utf8_lossy(&buffer[payload_start..payload_end])
        .trim()
        .to_string();
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
        let msg = parsed
            .get("error")
            .or_else(|| parsed.get("message"))
            .or_else(|| parsed.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or(raw.as_str());
        return Some(format!("error_code={error_code}: {msg}"));
    }
    Some(format!("error_code={error_code}: {raw}"))
}

/// 服务端 message_type_specific_flags 低位：
/// - bit0 = 带 sequence（结果帧）
/// - bit1 = last packet（会话结束）
const SERVER_FLAG_HAS_SEQUENCE: u8 = 0b0001;
const SERVER_FLAG_LAST_PACKET: u8 = 0b0010;

/// 解析服务端 JSON 帧。
///
/// 实测 openspeech v3 bigmodel_async 布局：
/// - 无 sequence（flags bit0=0，如 init ack）：
///   `[headerSize*4][payload_size:4][payload]`
/// - 有 sequence（flags bit0=1，流式/最终结果）：
///   `[headerSize*4][sequence:4][payload_size:4][payload]`
///
/// 注意：旧实现把 size/sequence 顺序写反了，JSON 永远解析失败 → 空文本 →「未检测到语音」。
fn parse_server_message_with_meta(buffer: &[u8]) -> Option<(serde_json::Value, bool)> {
    if buffer.len() < 4 {
        return None;
    }
    let header_size_words = (buffer[0] & 0x0f) as usize;
    let header_bytes = header_size_words * 4;
    if header_bytes == 0 || buffer.len() < header_bytes {
        return None;
    }
    let message_type = buffer[1] >> 4;
    if message_type == SERVER_ERROR_RESPONSE {
        return None;
    }
    let flags = buffer[1] & 0x0f;
    let is_last = (flags & SERVER_FLAG_LAST_PACKET) != 0;
    let has_sequence = (flags & SERVER_FLAG_HAS_SEQUENCE) != 0;

    // 优先按 flags 选布局；失败再 fallback 另一种（兼容 ack / 结果帧）
    let layouts: &[(bool,)] = if has_sequence {
        &[(true,), (false,)]
    } else {
        &[(false,), (true,)]
    };

    for (use_sequence,) in layouts {
        if let Some(value) = try_parse_payload(buffer, header_bytes, *use_sequence) {
            return Some((value, is_last));
        }
    }

    // 最后兜底：从 header 后扫描 JSON `{`
    if let Some(value) = find_json_object(&buffer[header_bytes..]) {
        return Some((value, is_last));
    }
    None
}

fn try_parse_payload(
    buffer: &[u8],
    header_bytes: usize,
    use_sequence: bool,
) -> Option<serde_json::Value> {
    let meta_len = if use_sequence { 8usize } else { 4usize };
    if buffer.len() < header_bytes + meta_len {
        return None;
    }
    let size_offset = if use_sequence {
        header_bytes + 4
    } else {
        header_bytes
    };
    let payload_size = u32::from_be_bytes([
        buffer[size_offset],
        buffer[size_offset + 1],
        buffer[size_offset + 2],
        buffer[size_offset + 3],
    ]) as usize;
    let payload_start = header_bytes + meta_len;
    if payload_size == 0 || buffer.len() < payload_start + payload_size {
        return None;
    }
    let payload = &buffer[payload_start..payload_start + payload_size];
    let text = std::str::from_utf8(payload).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    serde_json::from_str(text).ok()
}

fn find_json_object(bytes: &[u8]) -> Option<serde_json::Value> {
    let start = bytes.iter().position(|&b| b == b'{')?;
    let text = std::str::from_utf8(&bytes[start..]).ok()?.trim();
    serde_json::from_str(text).ok()
}

/// 从服务端 JSON 提取当前累计文本 + 是否「会话级」结束。
///
/// 重要：单条 utterance 的 `definite=true` 只表示该句落定，**不是整段录音结束**。
/// 过早把 utterance-definite 当 session final，会只拿到开头一小段文字。
fn extract_text_and_final(parsed: &serde_json::Value) -> (String, bool) {
    let utterances = parsed
        .pointer("/result/utterances")
        .and_then(|v| v.as_array())
        .or_else(|| parsed.get("utterances").and_then(|v| v.as_array()));

    let mut text = String::new();
    if let Some(t) = parsed.pointer("/result/text").and_then(|v| v.as_str()) {
        // result.text 通常是整段累计文本（含已 definite 的句子）
        text = t.to_string();
    } else if let Some(arr) = parsed.get("result").and_then(|v| v.as_array()) {
        text = arr
            .iter()
            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");
    } else if let Some(list) = utterances {
        // fallback：拼接全部 utterances（含未 definite 的 partial）
        text = list
            .iter()
            .filter_map(|u| u.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");
    } else if let Some(t) = parsed.get("text").and_then(|v| v.as_str()) {
        text = t.to_string();
    }

    // 仅会话级 final 才允许提前结束读循环；utterance definite 只用于更新文本
    let session_final = parsed
        .get("is_final")
        .and_then(|v| v.as_bool())
        .or_else(|| parsed.get("final").and_then(|v| v.as_bool()))
        .or_else(|| parsed.pointer("/result/is_final").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    (text, session_final)
}

/// 用最新服务端文本更新累计结果：优先更长（避免 partial 回退覆盖完整句）
fn merge_transcript(current: &mut String, incoming: &str) {
    let next = incoming.trim();
    if next.is_empty() {
        return;
    }
    if next.len() >= current.len() || current.is_empty() || next.starts_with(current.as_str()) {
        *current = next.to_string();
    } else if current.starts_with(next) {
        // 较短前缀，忽略
    } else {
        // 非前缀关系时仍取最新（服务端可能重整标点/分句）
        *current = next.to_string();
    }
}

// ========== Audio helpers ==========

fn resample_linear(samples: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if from_rate == 0 || samples.is_empty() || from_rate == to_rate {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((samples.len() as f64) / ratio).round().max(1.0) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let idx = src.floor() as usize;
        let frac = src - idx as f64;
        let a = samples[idx.min(samples.len() - 1)] as f64;
        let b = samples[(idx + 1).min(samples.len() - 1)] as f64;
        out.push((a + (b - a) * frac).round() as i16);
    }
    out
}

fn wav_to_pcm_16k_mono(wav_data: &[u8]) -> Result<Vec<u8>, TranscriptionError> {
    let cursor = Cursor::new(wav_data);
    let mut reader = hound::WavReader::new(cursor)
        .map_err(|e| TranscriptionError::ParseError(format!("Invalid WAV: {e}")))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;

    let raw_samples: Vec<i16> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| TranscriptionError::ParseError(e.to_string()))?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|r| {
                r.map(|f| {
                    let clamped = f.clamp(-1.0, 1.0);
                    (clamped * i16::MAX as f32) as i16
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| TranscriptionError::ParseError(e.to_string()))?,
    };

    // Downmix to mono if multi-channel
    let mono: Vec<i16> = if channels == 1 {
        raw_samples
    } else {
        raw_samples
            .chunks(channels)
            .map(|frame| {
                let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                (sum / channels as i32) as i16
            })
            .collect()
    };

    let resampled = resample_linear(&mono, spec.sample_rate, TARGET_SAMPLE_RATE);
    let mut pcm = Vec::with_capacity(resampled.len() * 2);
    for sample in resampled {
        pcm.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(pcm)
}

fn build_session_config(
    language: Option<&str>,
    vocabulary_term_list: Option<&[String]>,
) -> serde_json::Value {
    let uid = format!("sayit-{}", Uuid::new_v4());

    let mut audio = serde_json::json!({
        "format": "pcm",
        "rate": TARGET_SAMPLE_RATE,
        "bits": 16,
        "channel": 1,
    });

    if let Some(lang) = language {
        let mapped = if lang.starts_with("zh") {
            "zh-CN".to_string()
        } else if lang == "en" {
            "en-US".to_string()
        } else if lang == "ja" {
            "ja-JP".to_string()
        } else if lang == "ko" {
            "ko-KR".to_string()
        } else if lang.len() == 2 {
            format!("{}-{}", lang, lang.to_uppercase())
        } else {
            lang.to_string()
        };
        audio["language"] = serde_json::Value::String(mapped);
    }

    let mut corpus = serde_json::Map::new();
    if let Some(terms) = vocabulary_term_list {
        let hotwords: Vec<serde_json::Value> = terms
            .iter()
            .take(MAX_HOTWORDS)
            .filter_map(|t| {
                let word = t.trim();
                if word.is_empty() {
                    None
                } else {
                    Some(serde_json::json!({ "word": word }))
                }
            })
            .collect();
        if !hotwords.is_empty() {
            corpus.insert("boosting_table_name".into(), serde_json::json!(""));
            // context with hotwords as text hints
            let context_items: Vec<serde_json::Value> = hotwords
                .iter()
                .filter_map(|h| h.get("word").and_then(|w| w.as_str()))
                .map(|w| serde_json::json!({ "text": w }))
                .collect();
            if !context_items.is_empty() {
                corpus.insert(
                    "context".into(),
                    serde_json::json!({ "context_data": context_items }),
                );
            }
        }
    }

    // enable_nonstream：离线整段录音场景，服务端会在收完音频后做一次非流式精修，
    // 与有赞 asrService 对齐，避免只拿到流式过程中的前几句。
    let request = serde_json::json!({
        "model_name": "bigmodel",
        "show_utterances": true,
        "enable_nonstream": true,
        "enable_itn": true,
        "enable_ddc": true,
        "enable_lid": true,
        "request_id": Uuid::new_v4().to_string(),
        "corpus": corpus,
    });

    serde_json::json!({
        "user": { "uid": uid },
        "audio": audio,
        "request": request,
    })
}

// ========== Shared Transcription Logic ==========

/// 处理一帧服务端 Binary 消息。
/// 返回：
/// - `Ok((None, false))` 继续
/// - `Ok((None, true))` 会话 last packet / final（可结束读循环）
/// - `Ok((Some(err), _))` 服务端业务错误（已 close）
/// `on_partial` 在累计文本有更新时回调（供 HUD 即時字幕）。
async fn handle_binary_frame(
    data: &[u8],
    accumulated_text: &mut String,
    write: &mut (impl SinkExt<Message> + Unpin),
    mut on_partial: impl FnMut(&str),
) -> Result<(Option<TranscriptionError>, bool), TranscriptionError> {
    if data.len() < 2 {
        return Ok((None, false));
    }
    let message_type = data[1] >> 4;
    if message_type == SERVER_ERROR_RESPONSE {
        let msg = parse_server_error_message(data)
            .unwrap_or_else(|| "Unknown Doubao ASR server error".into());
        let _ = write.close().await;
        return Ok((Some(TranscriptionError::ApiError(msg)), true));
    }

    let flags = data[1] & 0x0f;
    let is_last_packet = (flags & SERVER_FLAG_LAST_PACKET) != 0;

    if let Some((parsed, flag_last)) = parse_server_message_with_meta(data) {
        let (text, session_final) = extract_text_and_final(&parsed);
        if !text.trim().is_empty() {
            let previous = accumulated_text.clone();
            merge_transcript(accumulated_text, &text);
            if !accumulated_text.is_empty() && *accumulated_text != previous {
                on_partial(accumulated_text);
            }
        }
        let done = is_last_packet || flag_last || session_final;
        return Ok((None, done));
    }

    Ok((None, is_last_packet))
}

fn emit_transcription_partial<R: Runtime>(app: Option<&AppHandle<R>>, text: &str) {
    let Some(app) = app else {
        return;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    let _ = app.emit(
        TRANSCRIPTION_PARTIAL_EVENT,
        TranscriptionPartialPayload {
            text: trimmed.to_string(),
        },
    );
}

async fn send_doubao_transcription_request<R: Runtime>(
    app: Option<&AppHandle<R>>,
    wav_data: Vec<u8>,
    app_id: &str,
    access_key: &str,
    vocabulary_term_list: Option<&[String]>,
    language: Option<&str>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if app_id.trim().is_empty() || access_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }
    if wav_data.len() < MINIMUM_AUDIO_SIZE {
        return Err(TranscriptionError::AudioTooSmall(wav_data.len()));
    }
    if wav_data.len() > MAX_AUDIO_FILE_SIZE {
        let size_mb = wav_data.len() as f64 / (1024.0 * 1024.0);
        let limit_mb = MAX_AUDIO_FILE_SIZE / (1024 * 1024);
        return Err(TranscriptionError::FileTooLarge { size_mb, limit_mb });
    }

    let pcm = wav_to_pcm_16k_mono(&wav_data)?;
    if pcm.len() < 320 {
        // < 10ms of audio
        return Err(TranscriptionError::AudioTooSmall(pcm.len()));
    }

    println!(
        "[transcription] Sending {} bytes PCM (from {} bytes WAV) to Doubao ASR",
        pcm.len(),
        wav_data.len()
    );

    let start_time = Instant::now();
    let session_config = build_session_config(language, vocabulary_term_list);
    let connect_id = Uuid::new_v4().to_string();

    let mut request = DEFAULT_WS_URL
        .into_client_request()
        .map_err(|e| TranscriptionError::RequestFailed(format!("Invalid WS URL: {e}")))?;
    {
        let headers = request.headers_mut();
        headers.insert(
            "X-Api-App-Key",
            HeaderValue::from_str(app_id)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
        headers.insert(
            "X-Api-Access-Key",
            HeaderValue::from_str(access_key)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
        headers.insert(
            "X-Api-Resource-Id",
            HeaderValue::from_static(DEFAULT_RESOURCE_ID),
        );
        headers.insert(
            "X-Api-Connect-Id",
            HeaderValue::from_str(&connect_id)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
        headers.insert(
            "X-Api-Request-Id",
            HeaderValue::from_str(&connect_id)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
    }

    let connect_result = tokio::time::timeout(
        std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .map_err(|_| TranscriptionError::RequestFailed("WebSocket connection timeout".into()))?
    .map_err(|e| TranscriptionError::RequestFailed(format!("WebSocket connect failed: {e}")))?;

    let (ws_stream, _response) = connect_result;
    let (mut write, mut read) = ws_stream.split();

    // Full client request (session init)
    let init_buf = encode_full_client_request(&session_config);
    write
        .send(Message::Binary(init_buf.into()))
        .await
        .map_err(|e| TranscriptionError::RequestFailed(format!("Failed to send init: {e}")))?;

    let mut accumulated_text = String::new();
    let mut last_packet_sent = false;
    let mut offset = 0usize;

    // 发送期间也持续读 partial，避免只在发完后才处理、错过中间结果。
    // 音频按 200ms 节奏送出，贴近实时流式（全量灌包时服务端偶发只认开头）。
    let send_deadline =
        tokio::time::Instant::now() + std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS);

    while !last_packet_sent {
        if tokio::time::Instant::now() >= send_deadline {
            let _ = write.close().await;
            return Err(TranscriptionError::RequestFailed(
                "Timed out while uploading audio".into(),
            ));
        }

        // 先尽量读掉已到达的服务端帧（上传阶段若已 last packet 也先记着，发完再退出）
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(1), read.next()).await {
                Ok(Some(Ok(Message::Binary(data)))) => {
                    let (err, _done) = handle_binary_frame(
                        &data,
                        &mut accumulated_text,
                        &mut write,
                        |text| emit_transcription_partial(app, text),
                    )
                    .await?;
                    if let Some(err) = err {
                        return Err(err);
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                    let _ = write.close().await;
                    return Err(TranscriptionError::RequestFailed(
                        "WebSocket closed while uploading audio".into(),
                    ));
                }
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => {
                    let _ = write.close().await;
                    return Err(TranscriptionError::RequestFailed(format!(
                        "WebSocket read error: {e}"
                    )));
                }
                Err(_) => break, // 无更多可读帧
            }
        }

        if offset < pcm.len() {
            let end = (offset + PCM_CHUNK_BYTES).min(pcm.len());
            let chunk = &pcm[offset..end];
            let packet = encode_audio_only_request(chunk, false);
            write.send(Message::Binary(packet.into())).await.map_err(|e| {
                TranscriptionError::RequestFailed(format!("Failed to send audio: {e}"))
            })?;
            offset = end;
            // 离线整段回放：不按实时 200ms 节流（否则 30 秒录音要传 30 秒）。
            // 每包 yield 一次让读侧能 drain partial / 反压。
            tokio::task::yield_now().await;
        } else {
            let final_packet = encode_audio_only_request(&[], true);
            write
                .send(Message::Binary(final_packet.into()))
                .await
                .map_err(|e| {
                    TranscriptionError::RequestFailed(format!("Failed to send final: {e}"))
                })?;
            last_packet_sent = true;
            println!(
                "[transcription] Final audio packet sent ({} bytes PCM), waiting for result…",
                pcm.len()
            );
        }
    }

    // 末包之后继续读，直到 session final / 连接关闭 / 超时。
    // 不可在首个 utterance definite 时退出——那只是分句落定。
    let final_deadline =
        tokio::time::Instant::now() + std::time::Duration::from_millis(FINAL_RESULT_TIMEOUT_MS);

    loop {
        let remaining = final_deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            println!(
                "[transcription] Final-result wait timed out; using best text so far (len={})",
                accumulated_text.len()
            );
            break;
        }

        let next = tokio::time::timeout(remaining, read.next()).await;
        match next {
            Ok(Some(Ok(Message::Binary(data)))) => {
                let (err, done) = handle_binary_frame(
                    &data,
                    &mut accumulated_text,
                    &mut write,
                    |text| emit_transcription_partial(app, text),
                )
                .await?;
                if let Some(err) = err {
                    return Err(err);
                }
                if done {
                    println!(
                        "[transcription] Session final / last packet received (len={})",
                        accumulated_text.len()
                    );
                    break;
                }
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => break,
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(e))) => {
                let _ = write.close().await;
                return Err(TranscriptionError::RequestFailed(format!(
                    "WebSocket read error: {e}"
                )));
            }
            Err(_) => break, // timeout
        }
    }

    let _ = write.close().await;

    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;
    let raw_text = accumulated_text.trim().to_string();
    // Doubao has no Whisper-style NSP; empty text → treat as silence, otherwise speech.
    let no_speech_probability = if raw_text.is_empty() { 1.0 } else { 0.0 };

    println!(
        "[transcription] Doubao response in {transcription_duration_ms:.0}ms: \"{raw_text}\" (noSpeechProb={no_speech_probability:.3})"
    );

    Ok(TranscriptionResult {
        raw_text,
        transcription_duration_ms,
        no_speech_probability,
    })
}

// ========== Commands ==========

#[command]
pub async fn transcribe_audio(
    app: AppHandle,
    state: State<'_, AudioRecorderState>,
    _transcription_state: State<'_, TranscriptionState>,
    app_id: String,
    access_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if app_id.trim().is_empty() || access_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    let wav_data = {
        let mut guard = state
            .wav_buffer
            .lock()
            .map_err(|_| TranscriptionError::LockPoisoned)?;
        guard.take().ok_or(TranscriptionError::NoAudioData)?
    };

    send_doubao_transcription_request(
        Some(&app),
        wav_data,
        &app_id,
        &access_key,
        vocabulary_term_list.as_deref(),
        language.as_deref(),
    )
    .await
}

#[command]
pub async fn retranscribe_from_file(
    app: AppHandle,
    _transcription_state: State<'_, TranscriptionState>,
    file_path: String,
    app_id: String,
    access_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if app_id.trim().is_empty() || access_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    let wav_data = std::fs::read(&file_path).map_err(|e| {
        TranscriptionError::RequestFailed(format!("Failed to read WAV file: {e}"))
    })?;

    println!(
        "[transcription] Retranscribing from file: {} ({} bytes)",
        file_path,
        wav_data.len()
    );

    send_doubao_transcription_request(
        Some(&app),
        wav_data,
        &app_id,
        &access_key,
        vocabulary_term_list.as_deref(),
        language.as_deref(),
    )
    .await
}

#[command]
pub async fn test_asr_connection(
    _transcription_state: State<'_, TranscriptionState>,
    app_id: String,
    access_key: String,
) -> Result<(), TranscriptionError> {
    if app_id.trim().is_empty() || access_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    // ~1 second of silence at 16 kHz
    let silence_samples = vec![0i16; 16_000];
    let wav_data = super::audio_recorder::encode_wav(&silence_samples, 16_000)
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    send_doubao_transcription_request::<tauri::Wry>(
        None,
        wav_data,
        &app_id,
        &access_key,
        None,
        None,
    )
    .await
    .map(|_| ())
}

// ========== Live streaming ASR（邊說邊出） ==========

/// 錄音開始後呼叫：掛上 PCM 訂閱 + 開 WS，持續 emit `transcription:partial`。
#[command]
pub fn start_live_asr(
    app: AppHandle,
    audio_state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
    app_id: String,
    access_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    language: Option<String>,
) -> Result<(), TranscriptionError> {
    if app_id.trim().is_empty() || access_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    // 取消上一輪殘留 session
    cancel_live_session_inner(&transcription_state, &audio_state);

    let (pcm_tx, pcm_rx) = std::sync::mpsc::sync_channel::<Vec<i16>>(32);
    let sample_rate = audio_state
        .attach_live_pcm_sink(pcm_tx)
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    let finish = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(AtomicBool::new(false));
    let result: Arc<Mutex<Option<Result<TranscriptionResult, String>>>> =
        Arc::new(Mutex::new(None));
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();

    let finish_w = finish.clone();
    let cancel_w = cancel.clone();
    let result_w = result.clone();
    let app_w = app.clone();

    std::thread::Builder::new()
        .name("live-asr".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    if let Ok(mut g) = result_w.lock() {
                        *g = Some(Err(format!("Failed to create live ASR runtime: {e}")));
                    }
                    let _ = done_tx.send(());
                    return;
                }
            };

            let outcome = rt.block_on(run_live_asr_session(
                app_w,
                pcm_rx,
                sample_rate,
                app_id,
                access_key,
                vocabulary_term_list,
                language,
                finish_w,
                cancel_w,
            ));

            if let Ok(mut g) = result_w.lock() {
                *g = Some(outcome.map_err(|e| e.to_string()));
            }
            let _ = done_tx.send(());
        })
        .map_err(|e| TranscriptionError::RequestFailed(format!("live-asr spawn failed: {e}")))?;

    let mut guard = transcription_state
        .live
        .lock()
        .map_err(|_| TranscriptionError::LockPoisoned)?;
    *guard = Some(LiveAsrSession {
        finish,
        cancel,
        result,
        done_rx: Mutex::new(Some(done_rx)),
    });

    println!("[transcription] Live ASR started (sample_rate={sample_rate})");
    Ok(())
}

/// 停止錄音後呼叫：送 final、等結果。若 live session 不存在則回傳錯誤（前端可 fallback）。
#[command]
pub async fn finish_live_asr(
    audio_state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
) -> Result<TranscriptionResult, TranscriptionError> {
    // 先卸 sink，錄音 callback 不再往 channel 塞
    audio_state.detach_live_pcm_sink();

    let session = {
        let mut guard = transcription_state
            .live
            .lock()
            .map_err(|_| TranscriptionError::LockPoisoned)?;
        guard.take()
    }
    .ok_or(TranscriptionError::NoAudioData)?;

    session.finish.store(true, Ordering::SeqCst);

    // 等 worker（阻塞放 blocking 線程，避免卡 runtime）
    let done_rx = session
        .done_rx
        .lock()
        .map_err(|_| TranscriptionError::LockPoisoned)?
        .take();
    if let Some(rx) = done_rx {
        let wait = tokio::task::spawn_blocking(move || {
            // 最長等 REQUEST_TIMEOUT + final timeout
            let _ = rx.recv_timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS + 10));
        })
        .await;
        if let Err(e) = wait {
            return Err(TranscriptionError::RequestFailed(format!(
                "live ASR join failed: {e}"
            )));
        }
    }

    let outcome = session
        .result
        .lock()
        .map_err(|_| TranscriptionError::LockPoisoned)?
        .take()
        .unwrap_or_else(|| Err("Live ASR produced no result".into()));

    match outcome {
        Ok(r) => Ok(r),
        Err(msg) => Err(TranscriptionError::RequestFailed(msg)),
    }
}

/// ESC / 取消：關掉 live session，不取結果。
#[command]
pub fn cancel_live_asr(
    audio_state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
) -> Result<(), TranscriptionError> {
    cancel_live_session_inner(&transcription_state, &audio_state);
    Ok(())
}

fn cancel_live_session_inner(
    transcription_state: &TranscriptionState,
    audio_state: &AudioRecorderState,
) {
    audio_state.detach_live_pcm_sink();
    if let Ok(mut guard) = transcription_state.live.lock() {
        if let Some(session) = guard.take() {
            session.cancel.store(true, Ordering::SeqCst);
            session.finish.store(true, Ordering::SeqCst);
            if let Ok(mut rx) = session.done_rx.lock() {
                if let Some(rx) = rx.take() {
                    let _ = rx.recv_timeout(std::time::Duration::from_millis(800));
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_live_asr_session(
    app: AppHandle,
    pcm_rx: std::sync::mpsc::Receiver<Vec<i16>>,
    sample_rate: u32,
    app_id: String,
    access_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    language: Option<String>,
    finish: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
) -> Result<TranscriptionResult, TranscriptionError> {
    let start_time = Instant::now();
    let session_config =
        build_session_config(language.as_deref(), vocabulary_term_list.as_deref());
    let connect_id = Uuid::new_v4().to_string();

    let mut request = DEFAULT_WS_URL
        .into_client_request()
        .map_err(|e| TranscriptionError::RequestFailed(format!("Invalid WS URL: {e}")))?;
    {
        let headers = request.headers_mut();
        headers.insert(
            "X-Api-App-Key",
            HeaderValue::from_str(&app_id)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
        headers.insert(
            "X-Api-Access-Key",
            HeaderValue::from_str(&access_key)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
        headers.insert(
            "X-Api-Resource-Id",
            HeaderValue::from_static(DEFAULT_RESOURCE_ID),
        );
        headers.insert(
            "X-Api-Connect-Id",
            HeaderValue::from_str(&connect_id)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
        headers.insert(
            "X-Api-Request-Id",
            HeaderValue::from_str(&connect_id)
                .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?,
        );
    }

    let connect_result = tokio::time::timeout(
        std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .map_err(|_| TranscriptionError::RequestFailed("WebSocket connection timeout".into()))?
    .map_err(|e| TranscriptionError::RequestFailed(format!("WebSocket connect failed: {e}")))?;

    let (ws_stream, _response) = connect_result;
    let (mut write, mut read) = ws_stream.split();

    let init_buf = encode_full_client_request(&session_config);
    write
        .send(Message::Binary(init_buf.into()))
        .await
        .map_err(|e| TranscriptionError::RequestFailed(format!("Failed to send init: {e}")))?;

    let mut accumulated_text = String::new();
    let mut pcm_byte_buf: Vec<u8> = Vec::with_capacity(PCM_CHUNK_BYTES * 4);
    // 目標：每 200ms 送一包 16k mono
    let target_chunk_samples = (TARGET_SAMPLE_RATE as usize * PCM_CHUNK_MS as usize) / 1000;
    let mut pending_samples: Vec<i16> = Vec::with_capacity(target_chunk_samples * 2);
    let mut last_packet_sent = false;
    let mut total_pcm_bytes: usize = 0;

    // 錄音 device 可能不是 16k；累積原始 sample 後再線性重採樣送出
    let from_rate = if sample_rate == 0 { TARGET_SAMPLE_RATE } else { sample_rate };

    while !last_packet_sent {
        if cancel.load(Ordering::SeqCst) {
            let _ = write.close().await;
            return Err(TranscriptionError::RequestFailed("Live ASR cancelled".into()));
        }

        // 先 drain 服務端 partial
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(1), read.next()).await {
                Ok(Some(Ok(Message::Binary(data)))) => {
                    let (err, _done) = handle_binary_frame(
                        &data,
                        &mut accumulated_text,
                        &mut write,
                        |text| emit_transcription_partial(Some(&app), text),
                    )
                    .await?;
                    if let Some(err) = err {
                        return Err(err);
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                    let _ = write.close().await;
                    return Err(TranscriptionError::RequestFailed(
                        "WebSocket closed during live ASR".into(),
                    ));
                }
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => {
                    let _ = write.close().await;
                    return Err(TranscriptionError::RequestFailed(format!(
                        "WebSocket read error: {e}"
                    )));
                }
                Err(_) => break,
            }
        }

        // 從錄音 channel 取 PCM（非阻塞 + 短超時，兼顧 finish 信號）
        let finished = finish.load(Ordering::SeqCst);
        match pcm_rx.recv_timeout(std::time::Duration::from_millis(if finished {
            5
        } else {
            40
        })) {
            Ok(batch) => {
                pending_samples.extend_from_slice(&batch);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                // sink 已卸 / 錄音結束：視同 finish
                finish.store(true, Ordering::SeqCst);
            }
        }

        // 重採樣後湊滿 200ms 就送
        if from_rate == TARGET_SAMPLE_RATE {
            while pending_samples.len() >= target_chunk_samples {
                let chunk: Vec<i16> = pending_samples.drain(..target_chunk_samples).collect();
                pcm_byte_buf.clear();
                for s in &chunk {
                    pcm_byte_buf.extend_from_slice(&s.to_le_bytes());
                }
                total_pcm_bytes += pcm_byte_buf.len();
                let packet = encode_audio_only_request(&pcm_byte_buf, false);
                write
                    .send(Message::Binary(packet.into()))
                    .await
                    .map_err(|e| {
                        TranscriptionError::RequestFailed(format!("Failed to send audio: {e}"))
                    })?;
            }
        } else {
            // 非 16k：等夠一段再重採樣送（約 200ms 原始）
            let need = ((target_chunk_samples as u64 * from_rate as u64)
                / TARGET_SAMPLE_RATE as u64)
                .max(1) as usize;
            while pending_samples.len() >= need {
                let raw: Vec<i16> = pending_samples.drain(..need).collect();
                let resampled = resample_linear(&raw, from_rate, TARGET_SAMPLE_RATE);
                pcm_byte_buf.clear();
                for s in &resampled {
                    pcm_byte_buf.extend_from_slice(&s.to_le_bytes());
                }
                total_pcm_bytes += pcm_byte_buf.len();
                let packet = encode_audio_only_request(&pcm_byte_buf, false);
                write
                    .send(Message::Binary(packet.into()))
                    .await
                    .map_err(|e| {
                        TranscriptionError::RequestFailed(format!("Failed to send audio: {e}"))
                    })?;
            }
        }

        if finish.load(Ordering::SeqCst) {
            // 排空 channel 殘餘
            while let Ok(batch) = pcm_rx.try_recv() {
                pending_samples.extend_from_slice(&batch);
            }
            // 送尾段
            if !pending_samples.is_empty() {
                let resampled = if from_rate == TARGET_SAMPLE_RATE {
                    pending_samples.clone()
                } else {
                    resample_linear(&pending_samples, from_rate, TARGET_SAMPLE_RATE)
                };
                pending_samples.clear();
                pcm_byte_buf.clear();
                for s in &resampled {
                    pcm_byte_buf.extend_from_slice(&s.to_le_bytes());
                }
                total_pcm_bytes += pcm_byte_buf.len();
                let packet = encode_audio_only_request(&pcm_byte_buf, false);
                let _ = write.send(Message::Binary(packet.into())).await;
            }
            let final_packet = encode_audio_only_request(&[], true);
            write
                .send(Message::Binary(final_packet.into()))
                .await
                .map_err(|e| {
                    TranscriptionError::RequestFailed(format!("Failed to send final: {e}"))
                })?;
            last_packet_sent = true;
            println!(
                "[transcription] Live ASR final packet sent ({} bytes PCM)",
                total_pcm_bytes
            );
        }
    }

    if cancel.load(Ordering::SeqCst) {
        let _ = write.close().await;
        return Err(TranscriptionError::RequestFailed("Live ASR cancelled".into()));
    }

    // 等 final
    let final_deadline =
        tokio::time::Instant::now() + std::time::Duration::from_millis(FINAL_RESULT_TIMEOUT_MS);
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = write.close().await;
            return Err(TranscriptionError::RequestFailed("Live ASR cancelled".into()));
        }
        let remaining = final_deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, read.next()).await {
            Ok(Some(Ok(Message::Binary(data)))) => {
                let (err, done) = handle_binary_frame(
                    &data,
                    &mut accumulated_text,
                    &mut write,
                    |text| emit_transcription_partial(Some(&app), text),
                )
                .await?;
                if let Some(err) = err {
                    return Err(err);
                }
                if done {
                    break;
                }
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => break,
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(e))) => {
                let _ = write.close().await;
                return Err(TranscriptionError::RequestFailed(format!(
                    "WebSocket read error: {e}"
                )));
            }
            Err(_) => break,
        }
    }

    let _ = write.close().await;
    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;
    let raw_text = accumulated_text.trim().to_string();
    let no_speech_probability = if raw_text.is_empty() { 1.0 } else { 0.0 };

    println!(
        "[transcription] Live ASR done in {transcription_duration_ms:.0}ms: \"{raw_text}\" (pcm={total_pcm_bytes})"
    );

    Ok(TranscriptionResult {
        raw_text,
        transcription_duration_ms,
        no_speech_probability,
    })
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_full_client_request_header() {
        let payload = serde_json::json!({"a": 1});
        let buf = encode_full_client_request(&payload);
        assert!(buf.len() > 8);
        assert_eq!(buf[0] >> 4, PROTOCOL_VERSION);
        assert_eq!(buf[1] >> 4, CLIENT_FULL_REQUEST);
        let payload_len = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize;
        assert_eq!(payload_len, buf.len() - 8);
    }

    #[test]
    fn test_encode_audio_last_flag() {
        let buf = encode_audio_only_request(&[1, 2, 3, 4], true);
        assert_eq!(buf[1] >> 4, CLIENT_AUDIO_ONLY_REQUEST);
        assert_eq!(buf[1] & 0x0f, LAST_PACKET_NO_SEQUENCE);
        assert_eq!(u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]), 4);
        assert_eq!(&buf[8..], &[1, 2, 3, 4]);
    }

    #[test]
    fn test_resample_identity() {
        let samples = vec![0i16, 100, -100, 200];
        let out = resample_linear(&samples, 16000, 16000);
        assert_eq!(out, samples);
    }

    #[test]
    fn test_wav_to_pcm_roundtrip() {
        let samples = vec![100i16; 1600]; // 100ms
        let wav = super::super::audio_recorder::encode_wav(&samples, 16000).unwrap();
        let pcm = wav_to_pcm_16k_mono(&wav).unwrap();
        assert_eq!(pcm.len(), samples.len() * 2);
    }

    #[test]
    fn test_transcription_result_serialization() {
        let result = TranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: 0.01,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rawText\""));
        assert!(json.contains("\"transcriptionDurationMs\""));
        assert!(json.contains("\"noSpeechProbability\""));
    }

    #[test]
    fn test_extract_text_from_result_text() {
        let parsed = serde_json::json!({
            "result": {
                "text": "你好世界",
                "utterances": [{ "text": "你好", "definite": true }]
            }
        });
        let (text, is_final) = extract_text_and_final(&parsed);
        // 优先 result.text（整段累计），而不是只取第一条 utterance
        assert_eq!(text, "你好世界");
        // utterance definite 不再视为 session final
        assert!(!is_final);
    }

    #[test]
    fn test_session_final_flag() {
        let parsed = serde_json::json!({
            "result": { "text": "完整句子", "is_final": true }
        });
        let (text, is_final) = extract_text_and_final(&parsed);
        assert_eq!(text, "完整句子");
        assert!(is_final);
    }

    #[test]
    fn test_merge_transcript_prefers_longer() {
        let mut cur = "你好".to_string();
        merge_transcript(&mut cur, "你好世界");
        assert_eq!(cur, "你好世界");
        merge_transcript(&mut cur, "你");
        assert_eq!(cur, "你好世界");
    }

    /// 服务端结果帧：`[hdr][sequence:4][payload_size:4][json]`
    /// 旧实现把 size/seq 写反，导致 JSON 解析失败 → 空文本。
    #[test]
    fn test_parse_server_message_sequence_then_size() {
        let json =
            r#"{"result":{"text":"嘿，哈喽，我们现在可以说一些话了吗？"}}"#.as_bytes();
        let mut buf = vec![0u8; 4];
        buf[0] = (PROTOCOL_VERSION << 4) | 1; // header_size=1 → 4 bytes
        buf[1] = (0b1001 << 4) | SERVER_FLAG_HAS_SEQUENCE | SERVER_FLAG_LAST_PACKET; // mt=9
        buf[2] = (SERIAL_JSON << 4) | COMPRESSION_NONE;
        buf[3] = 0;
        let sequence: i32 = 6;
        buf.extend_from_slice(&sequence.to_be_bytes());
        buf.extend_from_slice(&(json.len() as u32).to_be_bytes());
        buf.extend_from_slice(json);

        let (parsed, is_last) = parse_server_message_with_meta(&buf).expect("parse");
        assert!(is_last);
        let (text, _) = extract_text_and_final(&parsed);
        assert!(text.contains("哈喽"));
        assert!(text.contains("可以说一些话"));
    }

    /// 旧错误布局 size+seq 会把 payload 切坏；正确布局 seq+size 才能读出整句。
    #[test]
    fn test_wrong_size_seq_layout_fails_correct_succeeds() {
        let json = r#"{"result":{"text":"完整句子内容"}}"#.as_bytes();
        let mut buf = vec![0u8; 4];
        buf[0] = (PROTOCOL_VERSION << 4) | 1;
        buf[1] = (0b1001 << 4) | SERVER_FLAG_HAS_SEQUENCE;
        buf[2] = (SERIAL_JSON << 4) | COMPRESSION_NONE;
        buf[3] = 0;
        let sequence: i32 = 2;
        buf.extend_from_slice(&sequence.to_be_bytes());
        buf.extend_from_slice(&(json.len() as u32).to_be_bytes());
        buf.extend_from_slice(json);

        // 旧逻辑：把 sequence 当成 size → 通常解析失败或取到残片
        let header_bytes = 4usize;
        let wrong_size = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize;
        let wrong_start = header_bytes + 8;
        let wrong_slice = if wrong_size > 0 && wrong_start + wrong_size <= buf.len() {
            std::str::from_utf8(&buf[wrong_start..wrong_start + wrong_size]).ok()
        } else {
            None
        };
        assert!(
            wrong_slice.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()).is_none(),
            "old size+seq layout should not parse valid JSON"
        );

        let (parsed, _) = parse_server_message_with_meta(&buf).expect("correct layout");
        let (text, _) = extract_text_and_final(&parsed);
        assert_eq!(text, "完整句子内容");
    }

    /// init ack：无 sequence，`[hdr][payload_size:4][json]`
    #[test]
    fn test_parse_server_message_size_only_ack() {
        let json = br#"{"result":{"additions":{"log_id":"abc"}}}"#;
        let mut buf = vec![0u8; 4];
        buf[0] = (PROTOCOL_VERSION << 4) | 1;
        buf[1] = (0b1001 << 4) | 0; // no sequence
        buf[2] = (SERIAL_JSON << 4) | COMPRESSION_NONE;
        buf[3] = 0;
        buf.extend_from_slice(&(json.len() as u32).to_be_bytes());
        buf.extend_from_slice(json);

        let (parsed, is_last) = parse_server_message_with_meta(&buf).expect("parse ack");
        assert!(!is_last);
        assert!(parsed.pointer("/result/additions/log_id").is_some());
    }
}
