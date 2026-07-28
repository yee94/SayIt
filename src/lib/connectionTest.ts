import { invoke } from "@tauri-apps/api/core";
import { enhanceText } from "./enhancer";
import {
  getEnhancementErrorMessage,
  getTranscriptionErrorMessage,
} from "./errorUtils";

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

export async function testLlmConnection(
  apiKey: string,
  options: { modelId: string; baseUrl: string },
): Promise<TestResult> {
  const start = performance.now();
  try {
    await enhanceText("ping", apiKey, {
      modelId: options.modelId,
      baseUrl: options.baseUrl,
      systemPrompt: "Reply with the word OK only.",
      maxTokens: 8,
    });
    return { ok: true, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - start),
      errorMessage: getEnhancementErrorMessage(err),
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
