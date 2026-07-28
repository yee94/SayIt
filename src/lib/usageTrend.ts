import type { DailyUsageTrend } from "../types/transcription";

// 与 DAILY_USAGE_TREND_SQL 的 DATE(..., 'localtime') 对齐：用本地时间组 YYYY-MM-DD，
// 不可用 toISOString()（UTC 会差一天，造成补零时对不到实际使用日）。
function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 将「只含有使用记录日期」的趋势资料补零成连续区间。
 *
 * 回传一个长度为 `days` 的升幂序列（从 days-1 天前到 endDate 当天），
 * 缺席的日期以 count=0 / totalChars=0 补上，确保趋势图 X 轴固定显示完整区间，
 * 避免资料稀疏时出现重复日期标签与误导性的斜线内插。
 *
 * 完全没有任何使用记录时回传空阵列，让图表维持「尚无使用记录」空状态。
 */
export function buildDailyUsageSeries(
  rows: DailyUsageTrend[],
  days: number,
  endDate: Date = new Date(),
): DailyUsageTrend[] {
  if (rows.length === 0 || days <= 0) return [];

  const byDate = new Map<string, DailyUsageTrend>();
  for (const row of rows) {
    byDate.set(row.date, row);
  }

  const base = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );

  const series: DailyUsageTrend[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const current = new Date(base);
    current.setDate(base.getDate() - offset);
    const key = toLocalDateKey(current);
    const existing = byDate.get(key);
    series.push({
      date: key,
      count: existing?.count ?? 0,
      totalChars: existing?.totalChars ?? 0,
    });
  }

  return series;
}
