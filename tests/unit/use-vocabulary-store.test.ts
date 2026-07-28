import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockDbExecute = vi.fn().mockResolvedValue(undefined);
const mockDbSelect = vi.fn().mockResolvedValue([]);
const mockEmit = vi.fn().mockResolvedValue(undefined);
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({
    execute: mockDbExecute,
    select: mockDbSelect,
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-CN" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

function createRawVocabularyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "vocab-1",
    term: "Vue.js",
    weight: 1,
    source: "manual",
    created_at: "2026-03-09 00:00:00",
    ...overrides,
  };
}

describe("useVocabularyStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockDbExecute.mockClear().mockResolvedValue(undefined);
    mockDbSelect.mockClear().mockResolvedValue([]);
    mockEmit.mockClear().mockResolvedValue(undefined);
    mockInvoke.mockClear();
  });

  // ==========================================================================
  // addAiSuggestedTerm
  // ==========================================================================

  describe("addAiSuggestedTerm", () => {
    it("应以 source='ai' 插入词汇", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addAiSuggestedTerm("Tauri");

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO vocabulary");
      expect(sql).toContain("'ai'");
      expect(params[1]).toBe("Tauri");
    });

    it("空字串不触发 INSERT", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addAiSuggestedTerm("  ");

      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it("UNIQUE 冲突时静默处理不抛错", async () => {
      mockDbExecute.mockRejectedValueOnce(
        new Error("UNIQUE constraint failed"),
      );

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await expect(store.addAiSuggestedTerm("Vue.js")).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // batchIncrementWeights
  // ==========================================================================

  describe("batchIncrementWeights", () => {
    it("应对每个 ID 执行 UPDATE weight + 1", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.batchIncrementWeights(["id-1", "id-2", "id-3"]);

      // 3 updates + 1 fetchTermList SELECT
      const updateCalls = mockDbExecute.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("UPDATE"),
      );
      expect(updateCalls).toHaveLength(3);
      expect(updateCalls[0][1]).toEqual(["id-1"]);
      expect(updateCalls[1][1]).toEqual(["id-2"]);
      expect(updateCalls[2][1]).toEqual(["id-3"]);
    });

    it("空阵列不执行任何操作", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.batchIncrementWeights([]);

      expect(mockDbExecute).not.toHaveBeenCalled();
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getTopTermListByWeight
  // ==========================================================================

  describe("getTopTermListByWeight", () => {
    it("应回传按 weight DESC 排序的前 N 个词", async () => {
      mockDbSelect.mockResolvedValueOnce([
        { term: "Tauri" },
        { term: "Vue.js" },
        { term: "Groq" },
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.getTopTermListByWeight(3);

      expect(result).toEqual(["Tauri", "Vue.js", "Groq"]);
      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("ORDER BY weight DESC");
      expect(sql).toContain("LIMIT $1");
      expect(params).toEqual([3]);
    });

    it("DB 失败时回传空阵列", async () => {
      mockDbSelect.mockRejectedValueOnce(new Error("DB error"));

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.getTopTermListByWeight(10);
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // manualTermList / aiSuggestedTermList computed
  // ==========================================================================

  describe("computed 过滤", () => {
    it("manualTermList 只包含 source=manual 的项目", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
        createRawVocabularyRow({ id: "2", term: "Tauri", source: "ai" }),
        createRawVocabularyRow({ id: "3", term: "Groq", source: "manual" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(store.manualTermList).toHaveLength(2);
      expect(store.manualTermList.map((e) => e.term)).toEqual([
        "Vue.js",
        "Groq",
      ]);
    });

    it("aiSuggestedTermList 只包含 source=ai 的项目", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
        createRawVocabularyRow({ id: "2", term: "Tauri", source: "ai" }),
        createRawVocabularyRow({ id: "3", term: "泰呈", source: "ai" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(store.aiSuggestedTermList).toHaveLength(2);
      expect(store.aiSuggestedTermList.map((e) => e.term)).toEqual([
        "Tauri",
        "泰呈",
      ]);
    });
  });

  // ==========================================================================
  // addTerm (manual) — 验证 source='manual'
  // ==========================================================================

  describe("addTerm", () => {
    it("应以 source='manual' 插入", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addTerm("React");

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("'manual'");
    });
  });

  // ==========================================================================
  // importTerms
  // ==========================================================================

  describe("importTerms", () => {
    it("批量插入新词并跳过已存在（大小写不敏感）", async () => {
      mockDbSelect
        .mockResolvedValueOnce([
          createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
        ])
        .mockResolvedValueOnce([
          createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
          createRawVocabularyRow({ id: "2", term: "Tauri", source: "manual" }),
          createRawVocabularyRow({ id: "3", term: "Pinia", source: "manual" }),
        ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      const result = await store.importTerms(["vue.js", "Tauri", "Pinia", "  "]);

      expect(result).toEqual({ added: 2, skipped: 2 });
      // 两次 INSERT（Tauri、Pinia）
      const insertCalls = mockDbExecute.mock.calls.filter(([sql]) =>
        String(sql).includes("INSERT INTO vocabulary"),
      );
      expect(insertCalls).toHaveLength(2);
      expect(insertCalls.every(([sql]) => String(sql).includes("'manual'"))).toBe(
        true,
      );
    });

    it("全部已存在时不写入 DB", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();
      mockDbExecute.mockClear();

      const result = await store.importTerms(["Vue.js", "vue.js"]);
      expect(result).toEqual({ added: 0, skipped: 2 });
      expect(mockDbExecute).not.toHaveBeenCalled();
    });
  });

  describe("importFromTypeless", () => {
    it("拉取 Typeless 词典并汇入新词", async () => {
      mockInvoke.mockResolvedValueOnce(["Tauri", "Pinia"]);
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ id: "1", term: "Tauri", source: "manual" }),
        createRawVocabularyRow({ id: "2", term: "Pinia", source: "manual" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      const result = await store.importFromTypeless();

      expect(mockInvoke).toHaveBeenCalledWith(
        "fetch_typeless_dictionary_terms",
      );
      expect(result).toEqual({ fetched: 2, added: 2, skipped: 0 });
    });
  });
});
