import { describe, expect, it } from "vitest";
import { buildDailyUsageSeries } from "../../src/lib/usageTrend";
import type { DailyUsageTrend } from "../../src/types/transcription";

function toLocalKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("buildDailyUsageSeries", () => {
  it("空输入回传空阵列（保留图表空状态）", () => {
    expect(buildDailyUsageSeries([], 14)).toEqual([]);
  });

  it("days <= 0 回传空阵列", () => {
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 1, totalChars: 10 },
    ];
    expect(buildDailyUsageSeries(rows, 0)).toEqual([]);
    expect(buildDailyUsageSeries(rows, -3)).toEqual([]);
  });

  it("补零成长度为 days 的升幂连续区间，末日为 endDate", () => {
    const endDate = new Date(2026, 2, 5); // 2026-03-05 本地
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);

    expect(series).toHaveLength(7);
    // 升幂
    const dates = series.map((d) => d.date);
    expect(dates).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
    expect(series[series.length - 1]).toEqual({
      date: "2026-03-05",
      count: 5,
      totalChars: 250,
    });
  });

  it("缺席日补 0、命中日正确映射 count/totalChars", () => {
    const endDate = new Date(2026, 2, 5);
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
      { date: "2026-03-01", count: 3, totalChars: 120 },
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);
    const byDate = new Map(series.map((d) => [d.date, d]));

    expect(byDate.get("2026-03-01")).toEqual({
      date: "2026-03-01",
      count: 3,
      totalChars: 120,
    });
    expect(byDate.get("2026-03-05")).toEqual({
      date: "2026-03-05",
      count: 5,
      totalChars: 250,
    });
    // 其余 5 天皆为 0
    const zeroDays = series.filter(
      (d) => d.date !== "2026-03-01" && d.date !== "2026-03-05",
    );
    expect(zeroDays).toHaveLength(5);
    for (const day of zeroDays) {
      expect(day.count).toBe(0);
      expect(day.totalChars).toBe(0);
    }
  });

  it("跨月边界产生正确的连续日期", () => {
    const endDate = new Date(2026, 2, 2); // 2026-03-02
    const series = buildDailyUsageSeries(
      [{ date: "2026-03-02", count: 1, totalChars: 4 }],
      5,
      endDate,
    );
    expect(series.map((d) => d.date)).toEqual([
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("忽略落在区间外的资料列", () => {
    const endDate = new Date(2026, 2, 5);
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
      { date: "2026-02-20", count: 9, totalChars: 999 }, // 区间外
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);

    expect(series).toHaveLength(7);
    expect(series.some((d) => d.date === "2026-02-20")).toBe(false);
    // 区间外资料不影响总和
    const total = series.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(5);
  });

  it("预设 endDate 为今天，末日为今天的本地日期", () => {
    const series = buildDailyUsageSeries(
      [{ date: toLocalKey(new Date()), count: 2, totalChars: 8 }],
      14,
    );
    expect(series).toHaveLength(14);
    expect(series[series.length - 1].date).toBe(toLocalKey(new Date()));
    expect(series[series.length - 1].count).toBe(2);
  });
});
