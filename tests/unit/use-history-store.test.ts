import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { TranscriptionRecord } from "../../src/types/transcription";

const mockDbExecute = vi.fn().mockResolvedValue(undefined);
const mockDbSelect = vi.fn().mockResolvedValue([]);
const mockEmitTo = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({
    execute: mockDbExecute,
    select: mockDbSelect,
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mockEmitTo,
}));

function createTestRecord(
  overrides: Partial<TranscriptionRecord> = {},
): TranscriptionRecord {
  return {
    id: "test-uuid-001",
    timestamp: 1700000000000,
    rawText: "测试原始文字",
    processedText: null,
    recordingDurationMs: 2500,
    transcriptionDurationMs: 320,
    enhancementDurationMs: null,
    charCount: 6,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    audioFilePath: null,
    status: "success",
    isEditMode: false,
    editSourceText: null,
    ...overrides,
  };
}

function createRawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "uuid-1",
    timestamp: 1700000000000,
    raw_text: "原始文字",
    processed_text: null,
    recording_duration_ms: 2500,
    transcription_duration_ms: 320,
    enhancement_duration_ms: null,
    char_count: 4,
    trigger_mode: "hold",
    was_enhanced: 0,
    was_modified: null,
    created_at: "2026-01-01 00:00:00",
    audio_file_path: null,
    status: "success",
    is_edit_mode: 0,
    edit_source_text: null,
    ...overrides,
  };
}

describe("useHistoryStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockDbExecute.mockClear().mockResolvedValue(undefined);
    mockDbSelect.mockClear().mockResolvedValue([]);
    mockEmitTo.mockClear().mockResolvedValue(undefined);
  });

  // ==========================================================================
  // addTranscription
  // ==========================================================================

  describe("addTranscription", () => {
    it("[P0] 应执行 SQL INSERT 并将 boolean 转为 INTEGER", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({
        wasEnhanced: true,
        wasModified: null,
      });

      await store.addTranscription(record);

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO transcriptions");
      expect(params).toEqual([
        record.id,
        record.timestamp,
        record.rawText,
        record.processedText,
        record.recordingDurationMs,
        record.transcriptionDurationMs,
        record.enhancementDurationMs,
        record.charCount,
        record.triggerMode,
        1, // wasEnhanced: true → 1
        null, // wasModified: null → null
        null, // audioFilePath
        "success", // status
        0, // isEditMode: false → 0
        null, // editSourceText
      ]);
    });

    it("[P0] wasEnhanced=false 应转为 0", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({ wasEnhanced: false });
      await store.addTranscription(record);

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[9]).toBe(0);
    });

    it("[P0] wasModified=true 应转为 1", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({ wasModified: true });
      await store.addTranscription(record);

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[10]).toBe(1);
    });

    it("[P0] wasModified=false 应转为 0", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({ wasModified: false });
      await store.addTranscription(record);

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[10]).toBe(0);
    });

    it("[P0] INSERT 成功后应发送 transcription:completed 事件至 main-window", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({
        processedText: "整理后文字",
        wasEnhanced: true,
        enhancementDurationMs: 150,
      });
      await store.addTranscription(record);

      expect(mockEmitTo).toHaveBeenCalledTimes(1);
      expect(mockEmitTo).toHaveBeenCalledWith(
        "main-window",
        "transcription:completed",
        {
          id: record.id,
          rawText: record.rawText,
          processedText: "整理后文字",
          recordingDurationMs: record.recordingDurationMs,
          transcriptionDurationMs: record.transcriptionDurationMs,
          enhancementDurationMs: 150,
          charCount: record.charCount,
          wasEnhanced: true,
        },
      );
    });

    it("[P0] SQL INSERT 失败应抛出错误", async () => {
      mockDbExecute.mockRejectedValueOnce(new Error("SQLITE_CONSTRAINT"));

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord();
      await expect(store.addTranscription(record)).rejects.toThrow(
        "SQLITE_CONSTRAINT",
      );
    });
  });

  // ==========================================================================
  // fetchTranscriptionList
  // ==========================================================================

  describe("fetchTranscriptionList", () => {
    it("[P0] 应从 SQLite 载入记录并映射 snake_case → camelCase", async () => {
      mockDbSelect.mockResolvedValueOnce([
        {
          id: "uuid-1",
          timestamp: 1700000000000,
          raw_text: "原始文字",
          processed_text: "整理后文字",
          recording_duration_ms: 2500,
          transcription_duration_ms: 320,
          enhancement_duration_ms: 150,
          char_count: 5,
          trigger_mode: "hold",
          was_enhanced: 1,
          was_modified: 0,
          created_at: "2026-01-01 00:00:00",
        },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchTranscriptionList();

      expect(store.transcriptionList).toHaveLength(1);
      const record = store.transcriptionList[0];
      expect(record.id).toBe("uuid-1");
      expect(record.rawText).toBe("原始文字");
      expect(record.processedText).toBe("整理后文字");
      expect(record.recordingDurationMs).toBe(2500);
      expect(record.transcriptionDurationMs).toBe(320);
      expect(record.enhancementDurationMs).toBe(150);
      expect(record.charCount).toBe(5);
      expect(record.triggerMode).toBe("hold");
      expect(record.wasEnhanced).toBe(true);
      expect(record.wasModified).toBe(false);
      expect(record.createdAt).toBe("2026-01-01 00:00:00");
    });

    it("[P0] was_enhanced=0 应映射为 false", async () => {
      mockDbSelect.mockResolvedValueOnce([
        {
          id: "uuid-2",
          timestamp: 1700000000000,
          raw_text: "文字",
          processed_text: null,
          recording_duration_ms: 1000,
          transcription_duration_ms: 200,
          enhancement_duration_ms: null,
          char_count: 2,
          trigger_mode: "toggle",
          was_enhanced: 0,
          was_modified: null,
          created_at: "2026-01-02 00:00:00",
        },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchTranscriptionList();

      const record = store.transcriptionList[0];
      expect(record.wasEnhanced).toBe(false);
      expect(record.wasModified).toBeNull();
      expect(record.processedText).toBeNull();
      expect(record.enhancementDurationMs).toBeNull();
      expect(record.triggerMode).toBe("toggle");
    });

    it("[P0] SELECT SQL 应包含 ORDER BY timestamp DESC", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchTranscriptionList();

      const sql = mockDbSelect.mock.calls[0][0] as string;
      expect(sql).toContain("ORDER BY timestamp DESC");
    });

    it("[P0] 载入中应设定 isLoading 为 true，完成后为 false", async () => {
      let resolveSelect!: (value: unknown[]) => void;
      mockDbSelect.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSelect = resolve;
        }),
      );

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const fetchPromise = store.fetchTranscriptionList();
      expect(store.isLoading).toBe(true);

      resolveSelect([]);
      await fetchPromise;
      expect(store.isLoading).toBe(false);
    });

    it("[P0] SELECT 失败后 isLoading 应回复为 false", async () => {
      mockDbSelect.mockRejectedValueOnce(new Error("DB error"));

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await expect(store.fetchTranscriptionList()).rejects.toThrow("DB error");
      expect(store.isLoading).toBe(false);
    });
  });

  // ==========================================================================
  // updateTranscriptionOnRetrySuccess
  // ==========================================================================

  describe("updateTranscriptionOnRetrySuccess", () => {
    it("[P0] 应执行 UPDATE SQL 并将 boolean 转为 INTEGER", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.updateTranscriptionOnRetrySuccess({
        id: "test-uuid-001",
        rawText: "重送成功的文字",
        processedText: "AI 整理后的文字",
        transcriptionDurationMs: 350,
        enhancementDurationMs: 200,
        wasEnhanced: true,
        charCount: 8,
      });

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("UPDATE transcriptions");
      expect(sql).toContain("SET status = 'success'");
      expect(params).toEqual([
        "重送成功的文字",
        "AI 整理后的文字",
        350,
        200,
        1, // wasEnhanced: true → 1
        8,
        "test-uuid-001",
      ]);
    });

    it("[P0] wasEnhanced=false 应转为 0", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.updateTranscriptionOnRetrySuccess({
        id: "test-uuid-002",
        rawText: "原始文字",
        processedText: null,
        transcriptionDurationMs: 300,
        enhancementDurationMs: null,
        wasEnhanced: false,
        charCount: 4,
      });

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[4]).toBe(0);
    });

    it("[P0] UPDATE 成功后应发送 transcription:completed 事件至 main-window", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.updateTranscriptionOnRetrySuccess({
        id: "test-uuid-003",
        rawText: "重送文字",
        processedText: "整理后文字",
        transcriptionDurationMs: 400,
        enhancementDurationMs: 150,
        wasEnhanced: true,
        charCount: 5,
      });

      expect(mockEmitTo).toHaveBeenCalledTimes(1);
      expect(mockEmitTo).toHaveBeenCalledWith(
        "main-window",
        "transcription:completed",
        expect.objectContaining({
          id: "test-uuid-003",
          rawText: "重送文字",
          processedText: "整理后文字",
          wasEnhanced: true,
        }),
      );
    });

    it("[P0] SQL UPDATE 失败应抛出错误", async () => {
      mockDbExecute.mockRejectedValueOnce(new Error("SQLITE_ERROR"));

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await expect(
        store.updateTranscriptionOnRetrySuccess({
          id: "test-uuid-004",
          rawText: "测试",
          processedText: null,
          transcriptionDurationMs: 200,
          enhancementDurationMs: null,
          wasEnhanced: false,
          charCount: 2,
        }),
      ).rejects.toThrow("SQLITE_ERROR");
    });
  });

  // ==========================================================================
  // fetchDashboardStats
  // ==========================================================================

  describe("fetchDashboardStats", () => {
    it("[P0] 无记录时应回传零值统计", async () => {
      // DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 0,
          total_characters: 0,
          total_recording_duration_ms: 0,
        },
      ]);
      // DAILY_QUOTA_USAGE_SQL — 无当日记录
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const stats = await store.fetchDashboardStats();

      expect(stats.totalTranscriptions).toBe(0);
      expect(stats.totalCharacters).toBe(0);
      expect(stats.totalRecordingDurationMs).toBe(0);
      expect(stats.estimatedTimeSavedMs).toBe(0);
      expect(stats.dailyQuotaUsage).toEqual({
        whisperRequestCount: 0,
        whisperBilledAudioMs: 0,
        llmRequestCount: 0,
        llmTotalTokens: 0,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
      });
    });

    it("[P0] 应使用 SQL 聚合查询", async () => {
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 0,
          total_characters: 0,
          total_recording_duration_ms: 0,
        },
      ]);
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchDashboardStats();

      const sql = mockDbSelect.mock.calls[0][0] as string;
      expect(sql).toContain("COUNT(*)");
      expect(sql).toContain("SUM(char_count)");
      expect(sql).toContain("SUM(recording_duration_ms)");
    });

    it("[P0] 应正确计算节省时间和整合每日额度用量", async () => {
      // 节省时间 = 600 / 40 * 60000 - 120000 = 780000ms
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 10,
          total_characters: 600,
          total_recording_duration_ms: 120000,
        },
      ]);
      // DAILY_QUOTA_USAGE_SQL
      mockDbSelect.mockResolvedValueOnce([
        {
          api_type: "whisper",
          request_count: 5,
          total_tokens: 0,
          billed_audio_ms: 50000,
        },
        {
          api_type: "chat",
          request_count: 3,
          total_tokens: 1500,
          billed_audio_ms: 30000,
        },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const stats = await store.fetchDashboardStats();

      expect(stats.totalTranscriptions).toBe(10);
      expect(stats.totalCharacters).toBe(600);
      expect(stats.totalRecordingDurationMs).toBe(120000);
      expect(stats.estimatedTimeSavedMs).toBe(780000);
      expect(stats.dailyQuotaUsage).toEqual({
        whisperRequestCount: 5,
        whisperBilledAudioMs: 50000,
        llmRequestCount: 3,
        llmTotalTokens: 1500,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
      });
    });
  });

  // ==========================================================================
  // fetchRecentTranscriptionList
  // ==========================================================================

  describe("fetchRecentTranscriptionList", () => {
    it("[P0] 应使用 LIMIT 查询最近记录", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchRecentTranscriptionList(10);

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("ORDER BY timestamp DESC");
      expect(sql).toContain("LIMIT");
      expect(params).toEqual([10]);
    });

    it("[P0] 应回传 camelCase 映射后的记录", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawRow({ id: "recent-1", raw_text: "最近的文字" }),
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const results = await store.fetchRecentTranscriptionList(10);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("recent-1");
      expect(results[0].rawText).toBe("最近的文字");
    });

    it("[P0] 预设 limit 应为 10", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchRecentTranscriptionList();

      const params = mockDbSelect.mock.calls[0][1];
      expect(params).toEqual([10]);
    });
  });

  // ==========================================================================
  // refreshDashboard
  // ==========================================================================

  describe("refreshDashboard", () => {
    it("[P0] 应同时载入统计、最近列表和趋势并更新 refs", async () => {
      // fetchDashboardStats → DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 5,
          total_characters: 200,
          total_recording_duration_ms: 60000,
        },
      ]);
      // fetchDashboardStats → DAILY_QUOTA_USAGE_SQL
      mockDbSelect.mockResolvedValueOnce([
        {
          api_type: "whisper",
          request_count: 2,
          total_tokens: 0,
          billed_audio_ms: 20000,
        },
      ]);
      // fetchRecentTranscriptionList
      mockDbSelect.mockResolvedValueOnce([
        createRawRow({ id: "recent-1" }),
        createRawRow({ id: "recent-2" }),
      ]);
      // fetchDailyUsageTrend（补零后固定 14 天，命中日对应今天）
      const todayKey = (() => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      })();
      mockDbSelect.mockResolvedValueOnce([
        { date: todayKey, count: 3, total_chars: 100 },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.refreshDashboard();

      expect(store.dashboardStats.totalTranscriptions).toBe(5);
      expect(store.dashboardStats.totalCharacters).toBe(200);
      expect(store.dashboardStats.dailyQuotaUsage.whisperRequestCount).toBe(2);
      expect(store.dashboardStats.dailyQuotaUsage.whisperBilledAudioMs).toBe(
        20000,
      );
      expect(store.recentTranscriptionList).toHaveLength(2);
      expect(store.recentTranscriptionList[0].id).toBe("recent-1");
      expect(store.dailyUsageTrendList).toHaveLength(14);
      const lastDay =
        store.dailyUsageTrendList[store.dailyUsageTrendList.length - 1];
      expect(lastDay.date).toBe(todayKey);
      expect(lastDay.count).toBe(3);
      expect(lastDay.totalChars).toBe(100);
    });

    it("[P0] dashboardStats 初始值应全为零", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      expect(store.dashboardStats.totalTranscriptions).toBe(0);
      expect(store.dashboardStats.totalCharacters).toBe(0);
      expect(store.dashboardStats.totalRecordingDurationMs).toBe(0);
      expect(store.dashboardStats.estimatedTimeSavedMs).toBe(0);
      expect(store.dashboardStats.dailyQuotaUsage).toEqual({
        whisperRequestCount: 0,
        whisperBilledAudioMs: 0,
        llmRequestCount: 0,
        llmTotalTokens: 0,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
      });
      expect(store.recentTranscriptionList).toHaveLength(0);
      expect(store.dailyUsageTrendList).toHaveLength(0);
    });
  });

  // ==========================================================================
  // searchTranscriptionList
  // ==========================================================================

  describe("searchTranscriptionList", () => {
    it("[P0] 有搜寻关键字时应使用 LIKE 查询", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.searchTranscriptionList("测试", 20, 0);

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("LIKE");
      expect(params[0]).toBe("%测试%");
    });

    it("[P0] 空白搜寻应使用分页查询（无 LIKE）", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.searchTranscriptionList("  ", 20, 0);

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).not.toContain("LIKE");
      expect(params).toEqual([20, 0]);
    });

    it("[P0] 应正确传递 limit 和 offset 参数", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.searchTranscriptionList("关键字", 10, 30);

      const params = mockDbSelect.mock.calls[0][1];
      expect(params[0]).toBe("%关键字%");
      expect(params[1]).toBe(10);
      expect(params[2]).toBe(30);
    });

    it("[P0] 应回传 camelCase 映射后的记录", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawRow({ id: "found-1", raw_text: "搜寻到的文字" }),
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const results = await store.searchTranscriptionList("搜寻", 20, 0);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("found-1");
      expect(results[0].rawText).toBe("搜寻到的文字");
    });
  });

  // ==========================================================================
  // resetAndFetch
  // ==========================================================================

  describe("resetAndFetch", () => {
    it("[P0] 应重设 offset 并载入第一页", async () => {
      const page = Array.from({ length: 5 }, (_, i) =>
        createRawRow({ id: `row-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(page);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.currentOffset = 100;
      await store.resetAndFetch();

      expect(store.transcriptionList).toHaveLength(5);
      expect(store.currentOffset).toBe(5);
    });

    it("[P0] 结果少于 PAGE_SIZE 时 hasMore 应为 false", async () => {
      mockDbSelect.mockResolvedValueOnce([createRawRow()]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();

      expect(store.hasMore).toBe(false);
    });

    it("[P0] 结果等于 PAGE_SIZE 时 hasMore 应为 true", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) =>
        createRawRow({ id: `row-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(fullPage);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();

      expect(store.hasMore).toBe(true);
      expect(store.currentOffset).toBe(20);
    });

    it("[P0] 应使用 searchQuery 进行搜寻", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.searchQuery = "测试搜寻";
      await store.resetAndFetch();

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("LIKE");
      expect(params[0]).toBe("%测试搜寻%");
    });

    it("[P0] 载入中应设定 isLoading，完成后恢复", async () => {
      let resolveSelect!: (value: unknown[]) => void;
      mockDbSelect.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSelect = resolve;
        }),
      );

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const promise = store.resetAndFetch();
      expect(store.isLoading).toBe(true);

      resolveSelect([]);
      await promise;
      expect(store.isLoading).toBe(false);
    });
  });

  // ==========================================================================
  // loadMore
  // ==========================================================================

  describe("loadMore", () => {
    it("[P0] 应追加结果至现有清单并更新 offset", async () => {
      // 先载入初始页
      const initialPage = Array.from({ length: 20 }, (_, i) =>
        createRawRow({ id: `init-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(initialPage);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();
      expect(store.transcriptionList).toHaveLength(20);

      // 载入更多
      const nextPage = Array.from({ length: 5 }, (_, i) =>
        createRawRow({ id: `more-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(nextPage);

      await store.loadMore();

      expect(store.transcriptionList).toHaveLength(25);
      expect(store.currentOffset).toBe(25);
      expect(store.hasMore).toBe(false);
    });

    it("[P0] hasMore=false 时不应发起查询", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.hasMore = false;
      mockDbSelect.mockClear();

      await store.loadMore();

      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("[P0] isLoading=true 时不应发起查询", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.hasMore = true;
      store.isLoading = true;
      mockDbSelect.mockClear();

      await store.loadMore();

      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("[P0] 应传递正确的 offset 参数", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) =>
        createRawRow({ id: `row-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(fullPage);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();

      mockDbSelect.mockResolvedValueOnce([]);
      await store.loadMore();

      const params = mockDbSelect.mock.calls[1][1];
      // 第二次呼叫的 offset 应该是 20（第一页的结果数）
      expect(params).toEqual([20, 20]);
    });
  });

  // ==========================================================================
  // addApiUsage
  // ==========================================================================

  describe("addApiUsage", () => {
    it("[P0] 应执行 INSERT SQL 并传入正确参数", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.addApiUsage({
        id: "usage-001",
        transcriptionId: "tx-001",
        apiType: "whisper",
        model: "whisper-large-v3",
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        promptTimeMs: null,
        completionTimeMs: null,
        totalTimeMs: null,
        audioDurationMs: 5000,
        estimatedCostCeiling: 0.000154,
      });

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO api_usage");
      expect(params).toEqual([
        "usage-001",
        "tx-001",
        "whisper",
        "whisper-large-v3",
        null,
        null,
        null,
        null,
        null,
        null,
        5000,
        0.000154,
      ]);
    });

    it("[P0] chat 类型应正确传入 token 栏位", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.addApiUsage({
        id: "usage-002",
        transcriptionId: "tx-001",
        apiType: "chat",
        model: "llama-3.3-70b-versatile",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptTimeMs: 200,
        completionTimeMs: 300,
        totalTimeMs: 500,
        audioDurationMs: null,
        estimatedCostCeiling: 0.000118,
      });

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[4]).toBe(100); // promptTokens
      expect(params[5]).toBe(50); // completionTokens
      expect(params[6]).toBe(150); // totalTokens
      expect(params[10]).toBeNull(); // audioDurationMs
    });
  });

  // ==========================================================================
  // fetchDailyUsageTrend
  // ==========================================================================

  describe("fetchDailyUsageTrend", () => {
    it("[P0] 应回传 camelCase 映射并补零成固定区间的趋势阵列", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const toLocalKey = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      };
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const todayKey = toLocalKey(today);
      const yesterdayKey = toLocalKey(yesterday);

      // fetchDashboardStats → DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        { total_count: 0, total_characters: 0, total_recording_duration_ms: 0 },
      ]);
      // fetchDashboardStats → DAILY_QUOTA_USAGE_SQL
      mockDbSelect.mockResolvedValueOnce([]);
      // fetchRecentTranscriptionList
      mockDbSelect.mockResolvedValueOnce([]);
      // fetchDailyUsageTrend（SQL 只回有使用记录的日期）
      mockDbSelect.mockResolvedValueOnce([
        { date: todayKey, count: 5, total_chars: 250 },
        { date: yesterdayKey, count: 3, total_chars: 120 },
      ]);

      await store.refreshDashboard();

      const list = store.dailyUsageTrendList;
      // 补零后固定 14 天、升幂、今天在最后
      expect(list).toHaveLength(14);
      expect(list[list.length - 1]).toEqual({
        date: todayKey,
        count: 5,
        totalChars: 250,
      });
      expect(list[list.length - 2]).toEqual({
        date: yesterdayKey,
        count: 3,
        totalChars: 120,
      });
      // 缺席日补 0
      expect(list[0]).toEqual({
        date: list[0].date,
        count: 0,
        totalChars: 0,
      });
    });

    it("[P0] DAILY_USAGE_TREND_SQL 应包含 GROUP BY 和 LIMIT", async () => {
      // fetchDashboardStats → DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        { total_count: 0, total_characters: 0, total_recording_duration_ms: 0 },
      ]);
      // fetchDashboardStats → DAILY_QUOTA_USAGE_SQL
      mockDbSelect.mockResolvedValueOnce([]);
      // fetchRecentTranscriptionList
      mockDbSelect.mockResolvedValueOnce([]);
      // fetchDailyUsageTrend
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.refreshDashboard();

      // fetchDailyUsageTrend 是第 4 次 select 呼叫
      const trendCall = mockDbSelect.mock.calls[3];
      const sql = trendCall[0] as string;
      expect(sql).toContain("WHERE timestamp >=");
      expect(sql).toContain("GROUP BY date");
      expect(sql).toContain("LIMIT");
      const params = trendCall[1] as number[];
      // cutoff 必须是「本地午夜」（与补零的日历窗口对齐），而非滚动 24h
      const cutoff = new Date(params[0]);
      expect(cutoff.getHours()).toBe(0);
      expect(cutoff.getMinutes()).toBe(0);
      expect(cutoff.getSeconds()).toBe(0);
      expect(cutoff.getMilliseconds()).toBe(0);
      expect(params[0]).toBeLessThanOrEqual(Date.now());
      expect(params[0]).toBeGreaterThan(Date.now() - 15 * 86_400_000);
      expect(params[1]).toBe(14);
    });
  });
});
