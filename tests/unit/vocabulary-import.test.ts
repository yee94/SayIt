import { describe, expect, it } from "vitest";
import {
  assertVocabularyImportFileSize,
  parseVocabularyImportText,
  VOCABULARY_IMPORT_MAX_BYTES,
} from "../../src/lib/vocabularyImport";

describe("parseVocabularyImportText", () => {
  it("解析 Typeless 單欄 CSV（每行一詞）", () => {
    const result = parseVocabularyImportText("Vue.js\nTauri\nPinia\n");
    expect(result.terms).toEqual(["Vue.js", "Tauri", "Pinia"]);
    expect(result.invalidCount).toBe(0);
    expect(result.duplicateInFileCount).toBe(0);
  });

  it("忽略 BOM、空行與 # 註解", () => {
    const result = parseVocabularyImportText(
      "\uFEFF# exported from typeless\n\nKubernetes\n\nPostgreSQL\n",
    );
    expect(result.terms).toEqual(["Kubernetes", "PostgreSQL"]);
  });

  it("CSV 取第一欄並剝除雙引號", () => {
    const result = parseVocabularyImportText('"OpenAI","extra"\nClaude\n');
    expect(result.terms).toEqual(["OpenAI", "Claude"]);
  });

  it("檔內大小寫不敏感去重，保留首次寫法", () => {
    const result = parseVocabularyImportText("SayIt\nsayit\nSAYIT\nVite\n");
    expect(result.terms).toEqual(["SayIt", "Vite"]);
    expect(result.duplicateInFileCount).toBe(2);
  });

  it("解析 JSON 字串陣列", () => {
    const result = parseVocabularyImportText(
      JSON.stringify(["alpha", "beta", "alpha"]),
    );
    expect(result.terms).toEqual(["alpha", "beta"]);
    expect(result.duplicateInFileCount).toBe(1);
  });

  it("解析 JSON 物件陣列（term / word）", () => {
    const result = parseVocabularyImportText(
      JSON.stringify([{ term: "Rust" }, { word: "SQLite" }, { text: "Vitest" }]),
    );
    expect(result.terms).toEqual(["Rust", "SQLite", "Vitest"]);
  });

  it("空內容回傳空陣列", () => {
    expect(parseVocabularyImportText("   ").terms).toEqual([]);
  });
});

describe("assertVocabularyImportFileSize", () => {
  it("超過 5MB 拋 FILE_TOO_LARGE", () => {
    expect(() =>
      assertVocabularyImportFileSize(VOCABULARY_IMPORT_MAX_BYTES + 1),
    ).toThrow("FILE_TOO_LARGE");
  });

  it("等於上限不拋錯", () => {
    expect(() =>
      assertVocabularyImportFileSize(VOCABULARY_IMPORT_MAX_BYTES),
    ).not.toThrow();
  });
});
