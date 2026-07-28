import { describe, it, expect } from "vitest";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  DOUBAO_ASR_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
} from "../../src/lib/modelRegistry";

describe("modelRegistry (custom LLM + Doubao ASR)", () => {
  it("[P0] 自订 model id 原样保留", () => {
    expect(getEffectiveLlmModelId("my-proxy-model")).toBe("my-proxy-model");
  });

  it("[P0] null / 空字串 fallback 到预设 LLM", () => {
    expect(getEffectiveLlmModelId(null)).toBe(DEFAULT_LLM_MODEL_ID);
    expect(getEffectiveLlmModelId("")).toBe(DEFAULT_LLM_MODEL_ID);
    expect(getEffectiveLlmModelId("   ")).toBe(DEFAULT_LLM_MODEL_ID);
  });

  it("[P0] ASR 固定 Doubao SeedASR", () => {
    expect(getEffectiveWhisperModelId(null)).toBe(DOUBAO_ASR_MODEL_ID);
    expect(getEffectiveWhisperModelId("whisper-large-v3")).toBe(
      DEFAULT_WHISPER_MODEL_ID,
    );
    expect(DEFAULT_WHISPER_MODEL_ID).toBe(DOUBAO_ASR_MODEL_ID);
  });
});
