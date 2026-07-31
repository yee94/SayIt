import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockDbSelect = vi.fn().mockResolvedValue([]);
const mockEmit = vi.fn().mockResolvedValue(undefined);
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({
    execute: vi.fn(),
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

function createCsvRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "vocab-1",
    term: "Vue.js",
    weight: 1,
    source: "manual",
    createdAt: "2026-03-09 00:00:00",
    ...overrides,
  };
}

function mockLoadCsv(
  entries: ReturnType<typeof createCsvRow>[] = [],
  fileExists = true,
) {
  mockInvoke.mockResolvedValueOnce({ entries, fileExists });
}

function mockSaveCsv() {
  mockInvoke.mockResolvedValueOnce(undefined);
}

describe("useVocabularyStore (CSV)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockDbSelect.mockClear().mockResolvedValue([]);
    mockEmit.mockClear().mockResolvedValue(undefined);
    mockInvoke.mockClear();
  });

  describe("fetchTermList", () => {
    it("应从 load_vocabulary_csv 载入并排序", async () => {
      mockLoadCsv([
        createCsvRow({
          id: "1",
          term: "Low",
          weight: 1,
          createdAt: "2026-03-01 00:00:00",
        }),
        createCsvRow({
          id: "2",
          term: "High",
          weight: 10,
          createdAt: "2026-03-01 00:00:00",
        }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(mockInvoke).toHaveBeenCalledWith("load_vocabulary_csv");
      expect(store.termList.map((e) => e.term)).toEqual(["High", "Low"]);
    });

    it("CSV 不存在时应从 SQLite 迁移并写出 CSV", async () => {
      mockLoadCsv([], false);
      mockDbSelect.mockResolvedValueOnce([
        {
          id: "sql-1",
          term: "FromSqlite",
          weight: 2,
          source: "manual",
          created_at: "2026-01-01 00:00:00",
        },
      ]);
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(mockInvoke).toHaveBeenCalledWith("save_vocabulary_csv", {
        entries: [
          expect.objectContaining({
            id: "sql-1",
            term: "FromSqlite",
            weight: 2,
            source: "manual",
            createdAt: "2026-01-01 00:00:00",
          }),
        ],
      });
      expect(store.termList).toHaveLength(1);
      expect(store.termList[0]?.term).toBe("FromSqlite");
    });
  });

  describe("addAiSuggestedTerm", () => {
    it("应以 source='ai' 写入 CSV", async () => {
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addAiSuggestedTerm("Tauri");

      expect(mockInvoke).toHaveBeenCalledWith("save_vocabulary_csv", {
        entries: [
          expect.objectContaining({
            term: "Tauri",
            source: "ai",
            weight: 1,
          }),
        ],
      });
      expect(store.termList).toHaveLength(1);
      expect(store.termList[0]?.source).toBe("ai");
    });

    it("空字串不触发保存", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addAiSuggestedTerm("  ");

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("已存在时静默处理不抛错", async () => {
      mockLoadCsv([createCsvRow({ term: "Vue.js" })]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();
      mockInvoke.mockClear();

      await expect(store.addAiSuggestedTerm("Vue.js")).resolves.toBeUndefined();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("addTerm", () => {
    it("应以 source='manual' 写入 CSV", async () => {
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addTerm("React");

      expect(mockInvoke).toHaveBeenCalledWith("save_vocabulary_csv", {
        entries: [
          expect.objectContaining({
            term: "React",
            source: "manual",
            weight: 1,
          }),
        ],
      });
      expect(mockEmit).toHaveBeenCalledWith(
        "vocabulary:changed",
        expect.objectContaining({ action: "added", term: "React" }),
      );
    });

    it("重复词应抛 duplicateEntry", async () => {
      mockLoadCsv([createCsvRow({ term: "React" })]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      await expect(store.addTerm("react")).rejects.toThrow(
        "dictionary.duplicateEntry",
      );
    });
  });

  describe("updateTerm", () => {
    it("应就地改 term 并写回 CSV", async () => {
      mockLoadCsv([createCsvRow({ id: "vocab-1", term: "Vue.js" })]);
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      await store.updateTerm("vocab-1", "Vue 3");

      expect(mockInvoke).toHaveBeenLastCalledWith("save_vocabulary_csv", {
        entries: [expect.objectContaining({ id: "vocab-1", term: "Vue 3" })],
      });
      expect(mockEmit).toHaveBeenCalledWith(
        "vocabulary:changed",
        expect.objectContaining({ action: "updated", term: "Vue 3" }),
      );
    });

    it("与自身相同文案时不执行保存", async () => {
      mockLoadCsv([createCsvRow({ id: "vocab-1", term: "Vue.js" })]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();
      mockInvoke.mockClear();

      await store.updateTerm("vocab-1", "Vue.js");

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("与其他词重复时应抛 duplicateEntry", async () => {
      mockLoadCsv([
        createCsvRow({ id: "vocab-1", term: "Vue.js" }),
        createCsvRow({ id: "vocab-2", term: "Tauri" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      await expect(store.updateTerm("vocab-1", "Tauri")).rejects.toThrow(
        "dictionary.duplicateEntry",
      );
    });

    it("空字串应抛 emptyTerm", async () => {
      mockLoadCsv([createCsvRow({ id: "vocab-1", term: "Vue.js" })]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      await expect(store.updateTerm("vocab-1", "  ")).rejects.toThrow(
        "dictionary.emptyTerm",
      );
    });
  });

  describe("removeTerm", () => {
    it("应从列表移除并写回 CSV", async () => {
      mockLoadCsv([createCsvRow({ id: "vocab-1", term: "Vue.js" })]);
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      await store.removeTerm("vocab-1");

      expect(mockInvoke).toHaveBeenLastCalledWith("save_vocabulary_csv", {
        entries: [],
      });
      expect(store.termList).toHaveLength(0);
      expect(mockEmit).toHaveBeenCalledWith(
        "vocabulary:changed",
        expect.objectContaining({ action: "removed", term: "Vue.js" }),
      );
    });
  });

  describe("batchIncrementWeights", () => {
    it("应对匹配 ID 做 weight + 1 并写回", async () => {
      mockLoadCsv([
        createCsvRow({ id: "id-1", term: "A", weight: 1 }),
        createCsvRow({ id: "id-2", term: "B", weight: 2 }),
        createCsvRow({ id: "id-3", term: "C", weight: 3 }),
      ]);
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      await store.batchIncrementWeights(["id-1", "id-3"]);

      expect(mockInvoke).toHaveBeenLastCalledWith(
        "save_vocabulary_csv",
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ id: "id-3", weight: 4 }),
            expect.objectContaining({ id: "id-1", weight: 2 }),
            expect.objectContaining({ id: "id-2", weight: 2 }),
          ]),
        }),
      );
      expect(store.termList[0]).toMatchObject({ id: "id-3", weight: 4 });
      expect(store.termList.find((e) => e.id === "id-1")?.weight).toBe(2);
      expect(store.termList.find((e) => e.id === "id-2")?.weight).toBe(2);
    });

    it("空阵列不执行任何操作", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.batchIncrementWeights([]);

      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("getTopTermListByWeight", () => {
    it("应从 termList 按 weight DESC, createdAt DESC 回传前 N 个词", async () => {
      mockLoadCsv([
        createCsvRow({
          id: "1",
          term: "Low",
          weight: 1,
          createdAt: "2026-03-01 00:00:00",
        }),
        createCsvRow({
          id: "2",
          term: "High",
          weight: 10,
          createdAt: "2026-03-01 00:00:00",
        }),
        createCsvRow({
          id: "3",
          term: "MidNewer",
          weight: 5,
          createdAt: "2026-03-09 00:00:00",
        }),
        createCsvRow({
          id: "4",
          term: "MidOlder",
          weight: 5,
          createdAt: "2026-03-02 00:00:00",
        }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();
      mockInvoke.mockClear();

      const result = await store.getTopTermListByWeight(3);

      expect(result).toEqual(["High", "MidNewer", "MidOlder"]);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("limit 超过列表长度时回传全部", async () => {
      mockLoadCsv([
        createCsvRow({ id: "1", term: "A", weight: 2 }),
        createCsvRow({ id: "2", term: "B", weight: 1 }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      const result = await store.getTopTermListByWeight(10);
      expect(result).toEqual(["A", "B"]);
    });

    it("尚未载入时会先 load，空表回传空阵列", async () => {
      mockLoadCsv([]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.getTopTermListByWeight(10);
      expect(result).toEqual([]);
      expect(mockInvoke).toHaveBeenCalledWith("load_vocabulary_csv");
    });
  });

  describe("computed 过滤", () => {
    it("manualTermList 只包含 source=manual 的项目", async () => {
      mockLoadCsv([
        createCsvRow({ id: "1", term: "Vue.js", source: "manual" }),
        createCsvRow({ id: "2", term: "Tauri", source: "ai" }),
        createCsvRow({ id: "3", term: "Groq", source: "manual" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(store.manualTermList.map((e) => e.term)).toEqual([
        "Vue.js",
        "Groq",
      ]);
    });

    it("aiSuggestedTermList 只包含 source=ai 的项目", async () => {
      mockLoadCsv([
        createCsvRow({ id: "1", term: "Vue.js", source: "manual" }),
        createCsvRow({ id: "2", term: "Tauri", source: "ai" }),
        createCsvRow({ id: "3", term: "泰呈", source: "ai" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(store.aiSuggestedTermList.map((e) => e.term)).toEqual([
        "Tauri",
        "泰呈",
      ]);
    });
  });

  describe("importTerms", () => {
    it("批量插入新词并跳过已存在（大小写不敏感）", async () => {
      mockLoadCsv([
        createCsvRow({ id: "1", term: "Vue.js", source: "manual" }),
      ]);
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      const result = await store.importTerms(["vue.js", "Tauri", "Pinia", "  "]);

      expect(result).toEqual({ added: 2, skipped: 2 });
      expect(mockInvoke).toHaveBeenLastCalledWith("save_vocabulary_csv", {
        entries: expect.arrayContaining([
          expect.objectContaining({ term: "Vue.js" }),
          expect.objectContaining({ term: "Tauri", source: "manual" }),
          expect.objectContaining({ term: "Pinia", source: "manual" }),
        ]),
      });
      expect(store.termList).toHaveLength(3);
    });

    it("全部已存在时不写入", async () => {
      mockLoadCsv([
        createCsvRow({ id: "1", term: "Vue.js", source: "manual" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();
      mockInvoke.mockClear();

      const result = await store.importTerms(["Vue.js", "vue.js"]);
      expect(result).toEqual({ added: 0, skipped: 2 });
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("importFromTypeless", () => {
    it("拉取 Typeless 词典并汇入新词", async () => {
      mockInvoke.mockResolvedValueOnce(["Tauri", "Pinia"]);
      mockSaveCsv();

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      const result = await store.importFromTypeless();

      expect(mockInvoke).toHaveBeenCalledWith(
        "fetch_typeless_dictionary_terms",
      );
      expect(mockInvoke).toHaveBeenCalledWith("save_vocabulary_csv", {
        entries: expect.arrayContaining([
          expect.objectContaining({ term: "Tauri", source: "manual" }),
          expect.objectContaining({ term: "Pinia", source: "manual" }),
        ]),
      });
      expect(result).toEqual({ fetched: 2, added: 2, skipped: 0 });
    });
  });
});