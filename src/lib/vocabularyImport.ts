/** Typeless 相容的詞庫檔解析（單欄 CSV / 每行一詞 TXT / JSON 字串陣列） */

export const VOCABULARY_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export interface VocabularyImportParseResult {
  /** 去重後的有效詞條（保留首次出現的原始大小寫） */
  terms: string[];
  /** 解析到但因空白/無效被丟棄的行數 */
  invalidCount: number;
  /** 檔內重複被合併掉的次數 */
  duplicateInFileCount: number;
}

/**
 * 從單行取出詞條。
 * Typeless 官方 bulk import：一欄 CSV，每行一個詞。
 * 若有逗號，取第一欄；去掉包住的雙引號。
 */
function extractTermFromLine(line: string): string {
  let raw = line.trim();
  if (!raw) return "";

  // 註解行（第三方 txt bundle 常見）
  if (raw.startsWith("#")) return "";

  // CSV：取第一欄
  if (raw.includes(",")) {
    const first = raw.split(",")[0] ?? "";
    raw = first.trim();
  }

  // 去掉 CSV 常見的雙引號包裹
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1).replace(/""/g, '"').trim();
  }

  return raw;
}

function normalizeUniqueTerms(candidates: string[]): VocabularyImportParseResult {
  const terms: string[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateInFileCount = 0;

  for (const candidate of candidates) {
    const term = candidate.trim();
    if (!term) {
      invalidCount += 1;
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      duplicateInFileCount += 1;
      continue;
    }
    seen.add(key);
    terms.push(term);
  }

  return { terms, invalidCount, duplicateInFileCount };
}

/**
 * 解析 Typeless / 相容格式的詞庫檔內容。
 * 支援：
 * - 純文字 / CSV：每行一詞
 * - JSON：`string[]` 或 `{ term: string }[]` / `{ word: string }[]`
 */
export function parseVocabularyImportText(content: string): VocabularyImportParseResult {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { terms: [], invalidCount: 0, duplicateInFileCount: 0 };
  }

  // JSON 陣列（第三方 export bundle 可能用 dictionary.json）
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const candidates = parsed.map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            if (typeof record.term === "string") return record.term;
            if (typeof record.word === "string") return record.word;
            if (typeof record.text === "string") return record.text;
          }
          return "";
        });
        return normalizeUniqueTerms(candidates);
      }
    } catch {
      // 不是合法 JSON，改走逐行解析
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const candidates = lines.map(extractTermFromLine);
  // 空行不計入 invalid（常見分隔），只計非空但抽不出詞的
  let blankishInvalid = 0;
  const nonEmptyCandidates: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line || line.startsWith("#")) continue;
    const term = candidates[i] ?? "";
    if (!term) {
      blankishInvalid += 1;
      continue;
    }
    nonEmptyCandidates.push(term);
  }

  const result = normalizeUniqueTerms(nonEmptyCandidates);
  return {
    terms: result.terms,
    invalidCount: result.invalidCount + blankishInvalid,
    duplicateInFileCount: result.duplicateInFileCount,
  };
}

export function assertVocabularyImportFileSize(byteLength: number): void {
  if (byteLength > VOCABULARY_IMPORT_MAX_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }
}
