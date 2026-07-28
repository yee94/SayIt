import { describe, expect, it } from "vitest";
import {
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../../src/lib/errorUtils";

describe("getMicrophoneErrorMessage", () => {
  it("[P0] NotAllowedError 应映射为中文权限提示", () => {
    const error = new DOMException("Permission denied", "NotAllowedError");
    expect(getMicrophoneErrorMessage(error)).toBe("需要麦克风权限才能录音");
  });

  it("[P0] NotFoundError 应映射为装置不存在讯息", () => {
    const error = new DOMException("No device found", "NotFoundError");
    expect(getMicrophoneErrorMessage(error)).toBe("未检测到麦克风设备");
  });

  it("[P0] NotReadableError 应映射为装置被占用讯息", () => {
    const error = new DOMException("Device busy", "NotReadableError");
    expect(getMicrophoneErrorMessage(error)).toBe("麦克风被其他程序占用");
  });

  it("[P0] 未知 DOMException name 应回传预设中文讯息", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(getMicrophoneErrorMessage(error)).toBe("麦克风初始化失败");
  });

  it("[P0] 非 DOMException 错误应回传预设中文讯息", () => {
    expect(getMicrophoneErrorMessage(new Error("Unknown"))).toBe(
      "麦克风初始化失败",
    );
  });
});

describe("getTranscriptionErrorMessage", () => {
  it("[P0] TypeError 应映射为网络连接中断", () => {
    expect(getTranscriptionErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "网络连接中断",
    );
  });

  it("[P0] Groq API 401 应映射为 API Key 无效", () => {
    const error = new Error("Groq API error (401): Unauthorized");
    expect(getTranscriptionErrorMessage(error)).toBe("API Key 无效或已过期");
  });

  it("[P0] Groq API 429 应映射为请求过于频繁", () => {
    const error = new Error("Groq API error (429): Rate limit exceeded");
    expect(getTranscriptionErrorMessage(error)).toBe("请求过于频繁，稍后再试");
  });

  it("[P0] Groq API 500+ 应映射为服务暂时无法使用", () => {
    const error = new Error("Groq API error (500): Internal Server Error");
    expect(getTranscriptionErrorMessage(error)).toBe("转录服务暂时无法使用");
  });

  it("[P0] Groq API 未知状态码应映射为语音转录失败", () => {
    const error = new Error("Groq API error (418): I'm a teapot");
    expect(getTranscriptionErrorMessage(error)).toBe("语音转录失败");
  });

  it("[P0] Groq API 无状态码应映射为语音转录失败", () => {
    const error = new Error("Groq API error: unknown");
    expect(getTranscriptionErrorMessage(error)).toBe("语音转录失败");
  });

  it("[P0] MediaRecorder 错误应映射为录音装置错误", () => {
    const error = new Error("MediaRecorder error during stop.");
    expect(getTranscriptionErrorMessage(error)).toBe("录音设备发生错误");
  });

  it("[P0] 未知错误应回传操作失败", () => {
    expect(getTranscriptionErrorMessage("some string error")).toBe("操作失败");
  });

  it("[P0] Tauri HTTP network error 应映射为网络连接中断", () => {
    expect(
      getTranscriptionErrorMessage(
        new Error("network error: connection refused"),
      ),
    ).toBe("网络连接中断");
  });

  it("[P0] DNS resolution failure 应映射为网络连接中断", () => {
    expect(
      getTranscriptionErrorMessage(
        new Error("dns resolve error: no such host"),
      ),
    ).toBe("网络连接中断");
  });

  it("[P0] connection timeout 应映射为网络连接中断", () => {
    expect(getTranscriptionErrorMessage(new Error("connect timeout"))).toBe(
      "网络连接中断",
    );
  });

  it("[P0] Audio file too large 应映射为录音档案过大", () => {
    const error = new Error(
      "Audio file too large (35.2 MB, limit 25 MB). Please shorten your recording.",
    );
    expect(getTranscriptionErrorMessage(error)).toBe(
      "录音文件过大，请缩短录音时间",
    );
  });

  it("[P0] Groq API error 包含 network 字眼时不应被误判为网路错误", () => {
    expect(
      getTranscriptionErrorMessage(
        new Error("Groq API error (500): network issue on server"),
      ),
    ).toBe("转录服务暂时无法使用");
  });

  // ── Rust 端實際透過 Tauri invoke reject 的「純字串」形式（#37/#38 真實情境）──
  it("[P0] 纯字串 Groq API returned error (429) 应映射为请求过于频繁", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (429): Rate limit reached",
      ),
    ).toBe("请求过于频繁，稍后再试");
  });

  it("[P0] 纯字串 Groq API returned error (503) 应映射为服务暂时无法使用", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (503): Service Unavailable",
      ),
    ).toBe("转录服务暂时无法使用");
  });

  it("[P0] 纯字串 Groq API returned error (401) 应映射为 API Key 无效", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (401): Invalid API Key",
      ),
    ).toBe("API Key 无效或已过期");
  });

  it("[P0] 纯字串 Groq API request failed 应映射为网络连接中断", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API request failed: error sending request for url",
      ),
    ).toBe("网络连接中断");
  });

  it("[P0] 纯字串 Groq API returned error 含 network 字眼时仍判服务暂时无法使用", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (500): upstream connect timeout",
      ),
    ).toBe("转录服务暂时无法使用");
  });
});

describe("getEnhancementErrorMessage - 网路错误", () => {
  it("[P0] TypeError 应映射为网络连接中断", () => {
    expect(getEnhancementErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "网络连接中断",
    );
  });

  it("[P0] Tauri HTTP network error 应映射为网络连接中断", () => {
    expect(
      getEnhancementErrorMessage(
        new Error("network error: connection refused"),
      ),
    ).toBe("网络连接中断");
  });
});

describe("getHotkeyErrorMessage", () => {
  it("[P0] accessibility_permission 应映射为辅助使用权限", () => {
    expect(getHotkeyErrorMessage("accessibility_permission")).toBe(
      "需要辅助使用权限",
    );
  });

  it("[P0] hook_install_failed 应映射为快捷键初始化失败", () => {
    expect(getHotkeyErrorMessage("hook_install_failed")).toBe(
      "快捷键初始化失败",
    );
  });

  it("[P0] 未知错误码应回传通用快捷键错误", () => {
    expect(getHotkeyErrorMessage("unknown_error")).toBe("快捷键发生错误");
  });
});
