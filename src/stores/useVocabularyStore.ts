import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "../lib/database";
import { extractErrorMessage } from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { sortVocabularyEntries } from "../lib/vocabularyCsv";
import { emitEvent, VOCABULARY_CHANGED } from "../composables/useTauriEvents";
import type { VocabularyEntry, VocabularySource } from "../types/vocabulary";
import type { VocabularyChangedPayload } from "../types/events";
import i18n from "../i18n";

/** Rust load_vocabulary_csv 回传 */
interface VocabularyCsvLoadResult {
  entries: VocabularyCsvRow[];
  fileExists: boolean;
}

/** 与 Rust VocabularyCsvEntry / CSV 栏位对齐（serde camelCase） */
interface VocabularyCsvRow {
  id: string;
  term: string;
  weight: number;
  source: string;
  createdAt: string;
}

interface SqliteVocabularyRow {
  id: string;
  term: string;
  weight: number;
  source: string;
  created_at: string;
}

function mapRowToEntry(row: VocabularyCsvRow): VocabularyEntry {
  return {
    id: row.id,
    term: row.term,
    weight: row.weight,
    source: row.source as VocabularySource,
    createdAt: row.createdAt,
  };
}

function toCsvRow(entry: VocabularyEntry): VocabularyCsvRow {
  return {
    id: entry.id,
    term: entry.term,
    weight: entry.weight,
    source: entry.source,
    createdAt: entry.createdAt,
  };
}

function nowSqliteDatetime(): string {
  // 对齐旧 SQLite datetime('now') 风格，便于排序与展示
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const useVocabularyStore = defineStore("vocabulary", () => {
  const termList = ref<VocabularyEntry[]>([]);
  const isLoading = ref(false);
  /** 是否已完成至少一次 CSV 载入（含空表） */
  const hasLoaded = ref(false);

  const termCount = computed(() => termList.value.length);

  function isDuplicateTerm(term: string, excludeId?: string): boolean {
    const normalizedInput = term.trim().toLowerCase();
    return termList.value.some(
      (entry) =>
        entry.id !== excludeId &&
        entry.term.trim().toLowerCase() === normalizedInput,
    );
  }

  /** 整表写回 CSV（原子写在 Rust 端） */
  async function persistTermList(entries: VocabularyEntry[]): Promise<void> {
    const sorted = sortVocabularyEntries(entries);
    await invoke("save_vocabulary_csv", {
      entries: sorted.map(toCsvRow),
    });
    termList.value = sorted;
  }

  /**
   * 旧版 SQLite vocabulary → CSV 一次性迁移。
   * 仅在 CSV 档案尚不存在时执行；迁移后写出 CSV（可为空表头），避免重复灌入。
   */
  async function migrateFromSqliteIfNeeded(
    fileExists: boolean,
  ): Promise<VocabularyEntry[] | null> {
    if (fileExists) return null;

    try {
      const db = getDatabase();
      const rows = await db.select<SqliteVocabularyRow[]>(
        "SELECT id, term, weight, source, created_at FROM vocabulary ORDER BY weight DESC, created_at DESC",
      );
      const migrated = rows.map((row) => ({
        id: row.id,
        term: row.term,
        weight: row.weight,
        source: row.source as VocabularySource,
        createdAt: row.created_at,
      }));
      await persistTermList(migrated);
      console.log(
        `[vocabulary-store] migrated ${migrated.length} terms from SQLite → CSV`,
      );
      return migrated;
    } catch (error) {
      // DB 尚未就绪或无表：仍写出空 CSV，标记已落地
      console.warn(
        `[vocabulary-store] SQLite migrate skipped: ${extractErrorMessage(error)}`,
      );
      await persistTermList([]);
      return [];
    }
  }

  async function fetchTermList() {
    isLoading.value = true;
    try {
      const result = await invoke<VocabularyCsvLoadResult>(
        "load_vocabulary_csv",
      );
      const migrated = await migrateFromSqliteIfNeeded(result.fileExists);
      if (migrated) {
        termList.value = migrated;
      } else {
        termList.value = sortVocabularyEntries(
          result.entries.map(mapRowToEntry),
        );
      }
      hasLoaded.value = true;
    } catch (error) {
      console.error(
        `[vocabulary-store] fetchTermList failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "fetch" });
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function addTerm(term: string) {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    if (isDuplicateTerm(trimmedTerm)) {
      throw new Error(i18n.global.t("dictionary.duplicateEntry"));
    }

    const id = crypto.randomUUID();
    try {
      const next = [
        ...termList.value,
        {
          id,
          term: trimmedTerm,
          weight: 1,
          source: "manual" as const,
          createdAt: nowSqliteDatetime(),
        },
      ];
      await persistTermList(next);
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      console.error(
        `[vocabulary-store] addTerm failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "add" });
      throw error;
    }
  }

  async function removeTerm(id: string) {
    const entry = termList.value.find((e) => e.id === id);
    if (!entry) return;

    try {
      await persistTermList(termList.value.filter((e) => e.id !== id));
      void emitEvent(VOCABULARY_CHANGED, {
        action: "removed",
        term: entry.term,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      console.error(
        `[vocabulary-store] removeTerm failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "remove" });
      throw error;
    }
  }

  async function updateTerm(id: string, term: string) {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) {
      throw new Error(i18n.global.t("dictionary.emptyTerm"));
    }

    const entry = termList.value.find((e) => e.id === id);
    if (!entry) return;

    if (entry.term === trimmedTerm) return;

    if (isDuplicateTerm(trimmedTerm, id)) {
      throw new Error(i18n.global.t("dictionary.duplicateEntry"));
    }

    try {
      const next = termList.value.map((e) =>
        e.id === id ? { ...e, term: trimmedTerm } : e,
      );
      await persistTermList(next);
      void emitEvent(VOCABULARY_CHANGED, {
        action: "updated",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      console.error(
        `[vocabulary-store] updateTerm failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "update" });
      throw error;
    }
  }

  const manualTermList = computed(() =>
    termList.value.filter((entry) => entry.source === "manual"),
  );

  const aiSuggestedTermList = computed(() =>
    termList.value.filter((entry) => entry.source === "ai"),
  );

  async function addAiSuggestedTerm(term: string) {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    if (isDuplicateTerm(trimmedTerm)) {
      // 已存在，静默处理（呼叫端会做 weight +1）
      return;
    }

    const id = crypto.randomUUID();
    try {
      const next = [
        ...termList.value,
        {
          id,
          term: trimmedTerm,
          weight: 1,
          source: "ai" as const,
          createdAt: nowSqliteDatetime(),
        },
      ];
      await persistTermList(next);
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      console.error(
        `[vocabulary-store] addAiSuggestedTerm failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "add-ai" });
      throw error;
    }
  }

  async function batchIncrementWeights(termIdList: string[]) {
    if (termIdList.length === 0) return;
    try {
      const bump = new Set(termIdList);
      const next = termList.value.map((entry) =>
        bump.has(entry.id) ? { ...entry, weight: entry.weight + 1 } : entry,
      );
      await persistTermList(next);
    } catch (error) {
      console.error(
        `[vocabulary-store] batchIncrementWeights failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "increment-weights" });
      throw error;
    }
  }

  async function getTopTermListByWeight(limit: number): Promise<string[]> {
    try {
      // 以记忆体为准；若尚未载入则先拉 CSV
      if (!hasLoaded.value) {
        await fetchTermList();
      }
      return sortVocabularyEntries(termList.value)
        .slice(0, limit)
        .map((entry) => entry.term);
    } catch (error) {
      console.error(
        `[vocabulary-store] getTopTermListByWeight failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "top-by-weight" });
      return [];
    }
  }

  /**
   * 批量汇入词条（source=manual）。
   * 已存在（大小写不敏感）则跳过；成功后只刷新一次并广播一次事件。
   */
  async function importTerms(
    terms: string[],
  ): Promise<{ added: number; skipped: number }> {
    const existingKeys = new Set(
      termList.value.map((entry) => entry.term.trim().toLowerCase()),
    );

    const toInsert: VocabularyEntry[] = [];
    const batchKeys = new Set<string>();
    let skipped = 0;
    const createdAt = nowSqliteDatetime();

    for (const raw of terms) {
      const term = raw.trim();
      if (!term) {
        skipped += 1;
        continue;
      }
      const key = term.toLowerCase();
      if (existingKeys.has(key) || batchKeys.has(key)) {
        skipped += 1;
        continue;
      }
      batchKeys.add(key);
      toInsert.push({
        id: crypto.randomUUID(),
        term,
        weight: 1,
        source: "manual",
        createdAt,
      });
    }

    if (toInsert.length === 0) {
      return { added: 0, skipped };
    }

    try {
      await persistTermList([...termList.value, ...toInsert]);
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: toInsert[0]?.term ?? "",
      } satisfies VocabularyChangedPayload);
      return { added: toInsert.length, skipped };
    } catch (error) {
      console.error(
        `[vocabulary-store] importTerms failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "import" });
      try {
        await fetchTermList();
      } catch {
        /* ignore refresh error */
      }
      throw error;
    }
  }


  /** 以合并结果整表覆写（供 iCloud 同步写回）；不广播以免触发同步回圈 */
  async function replaceAllTerms(entries: VocabularyEntry[]): Promise<void> {
    try {
      await persistTermList(entries);
    } catch (error) {
      console.error(
        `[vocabulary-store] replaceAllTerms failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "replace-all" });
      throw error;
    }
  }

  async function importFromTypeless(): Promise<{
    fetched: number;
    added: number;
    skipped: number;
  }> {
    const terms = await invoke<string[]>("fetch_typeless_dictionary_terms");
    const result = await importTerms(terms);
    return { fetched: terms.length, ...result };
  }

  return {
    termList,
    isLoading,
    termCount,
    manualTermList,
    aiSuggestedTermList,
    isDuplicateTerm,
    fetchTermList,
    addTerm,
    addAiSuggestedTerm,
    batchIncrementWeights,
    getTopTermListByWeight,
    importTerms,
    importFromTypeless,
    replaceAllTerms,
    removeTerm,
    updateTerm,
  };
});