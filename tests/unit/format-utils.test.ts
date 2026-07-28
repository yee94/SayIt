import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatDuration,
  formatDurationMs,
  formatNumber,
  formatCostCeiling,
} from "../../src/lib/formatUtils";
import type { TranscriptionRecord } from "../../src/types/transcription";

describe("formatUtils.ts", () => {
  describe("formatTimestamp", () => {
    it("应格式化有效的 timestamp", () => {
      const result = formatTimestamp(1700000000000);
      expect(result).toBeTruthy();
      expect(result).not.toBe("-");
    });

    it("NaN 应回传 '-'", () => {
      expect(formatTimestamp(NaN)).toBe("-");
    });

    it("Infinity 应回传 '-'", () => {
      expect(formatTimestamp(Infinity)).toBe("-");
    });

    it("-Infinity 应回传 '-'", () => {
      expect(formatTimestamp(-Infinity)).toBe("-");
    });

    it("0 应回传 '-'", () => {
      expect(formatTimestamp(0)).toBe("-");
    });

    it("负数应回传 '-'", () => {
      expect(formatTimestamp(-1)).toBe("-");
    });
  });

  describe("truncateText", () => {
    it("短文字不应截断", () => {
      expect(truncateText("短文字")).toBe("短文字");
    });

    it("超过 maxLength 应截断并加省略号", () => {
      const longText = "a".repeat(60);
      const result = truncateText(longText, 50);
      expect(result).toBe("a".repeat(50) + "...");
    });

    it("空字串应回传空字串", () => {
      expect(truncateText("")).toBe("");
    });

    it("自订 maxLength 应正确运作", () => {
      expect(truncateText("12345678", 5)).toBe("12345...");
    });

    it("恰好等于 maxLength 不应截断", () => {
      expect(truncateText("12345", 5)).toBe("12345");
    });
  });

  describe("getDisplayText", () => {
    it("有 processedText 时应回传 processedText", () => {
      const record = {
        rawText: "原始",
        processedText: "处理后",
      } as TranscriptionRecord;
      expect(getDisplayText(record)).toBe("处理后");
    });

    it("processedText 为 null 时应回传 rawText", () => {
      const record = {
        rawText: "原始",
        processedText: null,
      } as TranscriptionRecord;
      expect(getDisplayText(record)).toBe("原始");
    });
  });

  describe("formatDurationFromMs", () => {
    it("0 毫秒应回传 '0 分钟'", () => {
      expect(formatDurationFromMs(0)).toBe("0 分钟");
    });

    it("30 秒应回传 '1 分钟'", () => {
      expect(formatDurationFromMs(30000)).toBe("1 分钟");
    });

    it("5 分钟应回传 '5 分钟'", () => {
      expect(formatDurationFromMs(300000)).toBe("5 分钟");
    });

    it("90 分钟应回传 '1 小时 30 分钟'", () => {
      expect(formatDurationFromMs(5400000)).toBe("1 小时 30 分钟");
    });

    it("120 分钟应回传 '2 小时'", () => {
      expect(formatDurationFromMs(7200000)).toBe("2 小时");
    });
  });

  describe("formatDuration", () => {
    it("500ms 应回传 '1 秒'", () => {
      expect(formatDuration(500)).toBe("1 秒");
    });

    it("5000ms 应回传 '5 秒'", () => {
      expect(formatDuration(5000)).toBe("5 秒");
    });

    it("90000ms 应回传 '1:30'", () => {
      expect(formatDuration(90000)).toBe("1:30");
    });

    it("65000ms 应回传 '1:05'", () => {
      expect(formatDuration(65000)).toBe("1:05");
    });
  });

  describe("formatDurationMs", () => {
    it("500ms 应回传 '500 ms'", () => {
      expect(formatDurationMs(500)).toBe("500 ms");
    });

    it("1500ms 应回传 '1.5 秒'", () => {
      expect(formatDurationMs(1500)).toBe("1.5 秒");
    });

    it("0ms 应回传 '0 ms'", () => {
      expect(formatDurationMs(0)).toBe("0 ms");
    });

    it("999ms 应回传 '999 ms'", () => {
      expect(formatDurationMs(999)).toBe("999 ms");
    });
  });

  describe("formatNumber", () => {
    it("0 应格式化为 '0'", () => {
      expect(formatNumber(0)).toBe("0");
    });

    it("小数字不应加分隔符", () => {
      expect(formatNumber(999)).toBe("999");
    });

    it("千位以上应加分隔符", () => {
      const result = formatNumber(1234567);
      expect(result).toContain("1");
      expect(result).toContain("234");
      expect(result).toContain("567");
      expect(result.length).toBeGreaterThan(7);
    });
  });

  describe("formatCostCeiling", () => {
    it("费用为 0 时应回传 '$0'", () => {
      expect(formatCostCeiling(0)).toBe("$0");
    });

    it("正数费用应回传带 ≤ 前缀的四位小数", () => {
      expect(formatCostCeiling(0.0042)).toBe("≤ $0.0042");
    });

    it("极小费用应正确显示四位小数", () => {
      expect(formatCostCeiling(0.000308)).toBe("≤ $0.0003");
    });

    it("较大费用应正确显示", () => {
      expect(formatCostCeiling(1.5)).toBe("≤ $1.5000");
    });
  });
});
