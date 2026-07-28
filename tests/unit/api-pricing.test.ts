import { describe, it, expect } from "vitest";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../../src/lib/apiPricing";

describe("apiPricing.ts (custom endpoints)", () => {
  it("[P0] Doubao ASR 無法本地估價，回傳 0", () => {
    expect(calculateWhisperCostCeiling(10_000, "doubao-seedasr")).toBe(0);
    expect(calculateWhisperCostCeiling(3_600_000, "doubao-seedasr")).toBe(0);
  });

  it("[P0] 自訂 LLM 無法本地估價，回傳 0", () => {
    expect(calculateChatCostCeiling(1000, "gpt-4o-mini")).toBe(0);
    expect(calculateChatCostCeiling(1_000_000, "any-model")).toBe(0);
    // 相容舊 2-arg 呼叫
    expect(calculateChatCostCeiling(150, "legacy-model-id")).toBe(0);
  });
});
