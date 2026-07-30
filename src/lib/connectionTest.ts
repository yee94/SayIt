import { invoke } from "@tauri-apps/api/core";
import { enhanceText, EnhancerApiError } from "./enhancer";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getTranscriptionErrorMessage,
} from "./errorUtils";
import { normalizeChatCompletionsUrl } from "./llmProvider";

export interface TestSuccess {
  ok: true;
  durationMs: number;
}

export interface TestFailure {
  ok: false;
  durationMs: number;
  errorMessage: string;
}

export type TestResult = TestSuccess | TestFailure;

/** @deprecated alias */
export type ConnectionTestResult = TestResult;

/**
 * 连接测试专用错误文案：保留可定位的原始信息（不含 Header/Token 值）。
 * 常见：scope 未授权、网关空响应、超时。
 */
export function formatLlmConnectionTestError(
  err: unknown,
  targetUrl: string,
): string {
  const raw = extractErrorMessage(err);
  const shortUrl =
    targetUrl.length > 96 ? `${targetUrl.slice(0, 96)}…` : targetUrl;

  if (/url not allowed|configured scope/i.test(raw)) {
    return `请求域名未在 Tauri HTTP scope 内：${shortUrl}`;
  }
  if (
    /empty reply|connection reset|connection refused|Failed to connect|error sending request|tcp|os error|timed?\s*out|network/i.test(
      raw,
    )
  ) {
    return `网关无响应或网络不可达（${raw.slice(0, 80)}）。目标：${shortUrl}。请用本机 curl/Python 验证同一地址`;
  }
  if (err instanceof EnhancerApiError) {
    const body = (err.body || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return body
      ? `HTTP ${err.statusCode}：${body}`
      : `HTTP ${err.statusCode} ${err.statusText || ""}`.trim();
  }

  const mapped = getEnhancementErrorMessage(err);
  // 泛化失败时附带原始片段，方便对照网关
  if (mapped && raw && !mapped.includes(raw.slice(0, 40))) {
    return `${mapped}（${raw.slice(0, 100)}）· ${shortUrl}`;
  }
  return mapped || raw || "连接测试失败";
}

export async function testLlmConnection(
  apiKey: string,
  options: {
    modelId: string;
    baseUrl: string;
    headers?: Record<string, string>;
  },
): Promise<TestResult> {
  const start = performance.now();
  const targetUrl = normalizeChatCompletionsUrl(options.baseUrl);
  try {
    await enhanceText("ping", apiKey, {
      modelId: options.modelId,
      baseUrl: options.baseUrl,
      headers: options.headers,
      systemPrompt: "Reply with the word OK only.",
      maxTokens: 8,
    });
    return { ok: true, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - start),
      errorMessage: formatLlmConnectionTestError(err, targetUrl),
    };
  }
}

export async function testAsrConnection(
  appId: string,
  accessKey: string,
): Promise<TestResult> {
  const start = performance.now();
  try {
    await invoke("test_asr_connection", { appId, accessKey });
    return { ok: true, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - start),
      errorMessage: getTranscriptionErrorMessage(err),
    };
  }
}

/** @deprecated use testAsrConnection */
export async function testWhisperConnection(
  _modelId: string,
  _apiKey: string,
): Promise<TestResult> {
  return {
    ok: false,
    durationMs: 0,
    errorMessage: "ASR now uses Doubao appId/accessKey. Use testAsrConnection.",
  };
}
