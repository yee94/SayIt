#[cfg(target_os = "macos")]
use serde::Deserialize;

#[cfg(target_os = "macos")]
const API_BASE: &str = "https://api.typeless.com";
#[cfg(target_os = "macos")]
const APP_VERSION: &str = "mac_1.3.0";
#[cfg(target_os = "macos")]
const HMAC_KEY: &str = "9088eaec863c54571b4f28f6535b5f2526be3f5015791e659e4bdb31";
#[cfg(target_os = "macos")]
const AES_PASSWORD: &str = "46d40fe4218b857cae25f9c01c2664a98833fc69a0fda798c709fd1f";
#[cfg(target_os = "macos")]
const CLIENT_URL: &str =
    "file:///Applications/Typeless.app/Contents/Resources/app.asar/dist/renderer/hub.html";
#[cfg(target_os = "macos")]
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Typeless/1.3.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36";

#[cfg(target_os = "macos")]
#[derive(Deserialize)]
struct ElectronStoreData {
    #[serde(rename = "userData")]
    user_data: String,
}

#[cfg(target_os = "macos")]
#[derive(Deserialize)]
struct TypelessUserData {
    refresh_token: String,
    user_id: String,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use serde_json::{json, Value};
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    const K_CC_PBKDF2: u32 = 2;
    const K_CC_PRF_HMAC_SHA256: u32 = 3;
    const K_CC_PRF_HMAC_SHA512: u32 = 5;
    const K_CC_DECRYPT: u32 = 1;
    const K_CC_ENCRYPT: u32 = 0;
    const K_CC_ALGORITHM_AES: u32 = 0;
    const K_CC_OPTION_PKCS7_PADDING: u32 = 1;
    const K_CC_HMAC_ALG_SHA1: u32 = 0;

    #[link(name = "System")]
    unsafe extern "C" {
        fn CCKeyDerivationPBKDF(
            algorithm: u32,
            password: *const i8,
            password_len: usize,
            salt: *const u8,
            salt_len: usize,
            prf: u32,
            rounds: u32,
            derived_key: *mut u8,
            derived_key_len: usize,
        ) -> i32;
        fn CCCrypt(
            operation: u32,
            algorithm: u32,
            options: u32,
            key: *const u8,
            key_len: usize,
            iv: *const u8,
            data_in: *const u8,
            data_in_len: usize,
            data_out: *mut u8,
            data_out_available: usize,
            data_out_moved: *mut usize,
        ) -> i32;
        fn CC_SHA256(data: *const u8, len: u32, digest: *mut u8) -> *mut u8;
        fn CC_MD5(data: *const u8, len: u32, digest: *mut u8) -> *mut u8;
        fn CCHmac(
            algorithm: u32,
            key: *const u8,
            key_len: usize,
            data: *const u8,
            data_len: usize,
            mac_out: *mut u8,
        );
    }

    fn pbkdf2(password: &[u8], salt: &[u8], prf: u32) -> Result<[u8; 32], String> {
        let mut output = [0_u8; 32];
        let status = unsafe {
            CCKeyDerivationPBKDF(
                K_CC_PBKDF2,
                password.as_ptr().cast(),
                password.len(),
                salt.as_ptr(),
                salt.len(),
                prf,
                10_000,
                output.as_mut_ptr(),
                output.len(),
            )
        };
        if status == 0 {
            Ok(output)
        } else {
            Err(format!("TYPELESS_CRYPTO_FAILED:{status}"))
        }
    }

    fn sha256(data: &[u8]) -> [u8; 32] {
        let mut digest = [0_u8; 32];
        unsafe {
            CC_SHA256(data.as_ptr(), data.len() as u32, digest.as_mut_ptr());
        }
        digest
    }

    fn md5(data: &[u8]) -> [u8; 16] {
        let mut digest = [0_u8; 16];
        unsafe {
            CC_MD5(data.as_ptr(), data.len() as u32, digest.as_mut_ptr());
        }
        digest
    }

    fn hmac_sha1(key: &[u8], data: &[u8]) -> [u8; 20] {
        let mut digest = [0_u8; 20];
        unsafe {
            CCHmac(
                K_CC_HMAC_ALG_SHA1,
                key.as_ptr(),
                key.len(),
                data.as_ptr(),
                data.len(),
                digest.as_mut_ptr(),
            );
        }
        digest
    }

    fn aes_cbc(operation: u32, data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
        let mut output = vec![0_u8; data.len() + 16];
        let mut moved = 0_usize;
        let status = unsafe {
            CCCrypt(
                operation,
                K_CC_ALGORITHM_AES,
                K_CC_OPTION_PKCS7_PADDING,
                key.as_ptr(),
                key.len(),
                iv.as_ptr(),
                data.as_ptr(),
                data.len(),
                output.as_mut_ptr(),
                output.len(),
                &mut moved,
            )
        };
        if status != 0 {
            return Err(format!("TYPELESS_CRYPTO_FAILED:{status}"));
        }
        output.truncate(moved);
        Ok(output)
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn base64(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let a = chunk[0];
            let b = chunk.get(1).copied().unwrap_or(0);
            let c = chunk.get(2).copied().unwrap_or(0);
            output.push(TABLE[(a >> 2) as usize] as char);
            output.push(TABLE[(((a & 0x03) << 4) | (b >> 4)) as usize] as char);
            output.push(if chunk.len() > 1 {
                TABLE[(((b & 0x0f) << 2) | (c >> 6)) as usize] as char
            } else {
                '='
            });
            output.push(if chunk.len() > 2 {
                TABLE[(c & 0x3f) as usize] as char
            } else {
                '='
            });
        }
        output
    }

    fn typeless_dir() -> Result<PathBuf, String> {
        env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join("Library/Application Support/Typeless"))
            .ok_or_else(|| "TYPELESS_HOME_NOT_FOUND".to_string())
    }

    fn current_encryption_key() -> Result<[u8; 32], String> {
        let arch = match env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        };
        let platform_hash = hex(&sha256(format!("darwin-{arch}").as_bytes()));
        pbkdf2(
            format!("{platform_hash}Typeless").as_bytes(),
            b"typeless-user-service",
            K_CC_PRF_HMAC_SHA256,
        )
    }

    fn decrypt_user_data() -> Result<TypelessUserData, String> {
        let path = typeless_dir()?.join("user-data.json");
        let raw = fs::read(path).map_err(|_| "TYPELESS_SESSION_NOT_FOUND".to_string())?;
        if raw.len() < 18 || raw[16] != b':' {
            return Err("TYPELESS_SESSION_INVALID".to_string());
        }

        let iv = &raw[..16];
        let iv_salt = String::from_utf8_lossy(iv);
        let password = pbkdf2(
            &current_encryption_key()?,
            iv_salt.as_bytes(),
            K_CC_PRF_HMAC_SHA512,
        )?;
        let decrypted = aes_cbc(K_CC_DECRYPT, &raw[17..], &password, iv)
            .map_err(|_| "TYPELESS_SESSION_INVALID".to_string())?;
        let store: ElectronStoreData = serde_json::from_slice(&decrypted)
            .map_err(|_| "TYPELESS_SESSION_INVALID".to_string())?;
        serde_json::from_str(&store.user_data).map_err(|_| "TYPELESS_SESSION_INVALID".to_string())
    }

    fn device_id() -> String {
        let path = env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join("Library/Application Support/now.typeless.desktop/device.cache"));
        path.and_then(|value| fs::read_to_string(value).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "UNKNOWN".to_string())
    }

    fn evp_bytes_to_key(password: &[u8], salt: &[u8]) -> ([u8; 32], [u8; 16]) {
        let mut derived = Vec::with_capacity(48);
        let mut previous = Vec::<u8>::new();
        while derived.len() < 48 {
            let mut input = previous.clone();
            input.extend_from_slice(password);
            input.extend_from_slice(salt);
            previous = md5(&input).to_vec();
            derived.extend_from_slice(&previous);
        }
        let mut key = [0_u8; 32];
        let mut iv = [0_u8; 16];
        key.copy_from_slice(&derived[..32]);
        iv.copy_from_slice(&derived[32..48]);
        (key, iv)
    }

    fn cryptojs_aes_encrypt(plaintext: &str, salt: &[u8; 8]) -> Result<String, String> {
        let (key, iv) = evp_bytes_to_key(AES_PASSWORD.as_bytes(), salt);
        let encrypted = aes_cbc(K_CC_ENCRYPT, plaintext.as_bytes(), &key, &iv)?;
        let mut output = b"Salted__".to_vec();
        output.extend_from_slice(salt);
        output.extend_from_slice(&encrypted);
        Ok(base64(&output))
    }

    fn security_headers(
        user: &TypelessUserData,
        path: &str,
    ) -> Result<Vec<(&'static str, String)>, String> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "TYPELESS_TIME_INVALID".to_string())?
            .as_millis();
        let sign_str = format!("{timestamp}:{APP_VERSION}:{path}:{}", user.user_id);
        let sha1_key = format!("{timestamp}:{HMAC_KEY}");
        let signature = hex(&hmac_sha1(sha1_key.as_bytes(), sign_str.as_bytes()));

        let random_bytes = *uuid::Uuid::new_v4().as_bytes();
        let mut salt = [0_u8; 8];
        salt.copy_from_slice(&random_bytes[..8]);
        let random_number =
            100_000 + (u32::from_be_bytes(random_bytes[..4].try_into().unwrap()) % 900_000);
        let payload = json!({
            "X-Env": "prod",
            "X-Client-Domain": CLIENT_URL,
            "X-Client-Path": CLIENT_URL,
            "X-Random": random_number.to_string(),
            "t": timestamp,
            "p": signature,
            "d": device_id(),
            "3c86e26ccbb7274f752e7d868a1541ebfb7f37e7": { "a": "" }
        });
        let x_authorization = cryptojs_aes_encrypt(&payload.to_string(), &salt)?;

        Ok(vec![
            ("Authorization", format!("Bearer {}", user.refresh_token)),
            ("Content-Type", "application/json".to_string()),
            ("X-App-Version", APP_VERSION.to_string()),
            ("X-Authorization", x_authorization),
            ("X-Browser-Major", "130".to_string()),
            ("X-Browser-Name", "Chrome".to_string()),
            ("X-Browser-Version", "130.0.6723.191".to_string()),
            ("User-Agent", USER_AGENT.to_string()),
        ])
    }

    pub async fn fetch_terms() -> Result<Vec<String>, String> {
        let user = decrypt_user_data()?;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| "TYPELESS_API_FAILED".to_string())?;
        let mut terms = Vec::<String>::new();
        let mut offset = 0_usize;
        const PAGE_SIZE: usize = 200;

        loop {
            let path = "/user/dictionary/list";
            let mut request =
                client.get(format!("{API_BASE}{path}?size={PAGE_SIZE}&offset={offset}"));
            for (name, value) in security_headers(&user, path)? {
                request = request.header(name, value);
            }
            let response = request
                .send()
                .await
                .map_err(|_| "TYPELESS_API_FAILED".to_string())?;
            let status = response.status();
            let body: Value = response
                .json()
                .await
                .map_err(|_| "TYPELESS_API_FAILED".to_string())?;
            if !status.is_success() || body.get("status").and_then(Value::as_str) != Some("OK") {
                return Err(if status.as_u16() == 401 {
                    "TYPELESS_SESSION_EXPIRED".to_string()
                } else {
                    format!("TYPELESS_API_FAILED:HTTP_{}", status.as_u16())
                });
            }

            let words = body
                .pointer("/data/words")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let total = body
                .pointer("/data/total_count")
                .and_then(Value::as_u64)
                .unwrap_or(words.len() as u64) as usize;
            for word in &words {
                if let Some(term) = word.get("term").and_then(Value::as_str) {
                    let trimmed = term.trim();
                    if !trimmed.is_empty() {
                        terms.push(trimmed.to_string());
                    }
                }
            }
            if terms.len() >= total || words.is_empty() {
                break;
            }
            offset += PAGE_SIZE;
        }

        Ok(terms)
    }

    #[cfg(test)]
    mod integration_test {
        #[tokio::test]
        #[ignore = "requires a local Typeless login session"]
        async fn fetches_local_typeless_dictionary() {
            let terms = super::fetch_terms().await.expect("Typeless import failed");
            assert!(!terms.is_empty());
        }
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn fetch_typeless_dictionary_terms() -> Result<Vec<String>, String> {
    macos::fetch_terms().await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn fetch_typeless_dictionary_terms() -> Result<Vec<String>, String> {
    Err("TYPELESS_PLATFORM_UNSUPPORTED".to_string())
}
