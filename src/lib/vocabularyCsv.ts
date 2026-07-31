import type { VocabularyEntry, VocabularySource } from "../types/vocabulary";

/** CSV 表头：与磁盘档案栏位顺序一致 */
export const VOCABULARY_CSV_HEADER = "id,term,weight,source,created_at";

/**
 * RFC4180 风格转义：含逗号 / 引号 / 换行时包双引号，内部引号加倍。
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 解析单行 CSV 字段（支援双引号包起来的逗号与转义引号）。
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** 将词条序列化为完整 CSV 字串（含表头；空表也写表头） */
export function serializeVocabularyCsv(entries: VocabularyEntry[]): string {
  const lines = [VOCABULARY_CSV_HEADER];
  for (const entry of entries) {
    lines.push(
      [
        escapeCsvField(entry.id),
        escapeCsvField(entry.term),
        String(entry.weight),
        escapeCsvField(entry.source),
        escapeCsvField(entry.createdAt),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function isVocabularySource(value: string): value is VocabularySource {
  return value === "manual" || value === "ai";
}

/** 解析 CSV 正文；缺栏位或非法行跳过，不抛错 */
export function parseVocabularyCsv(content: string): VocabularyEntry[] {
  const normalized = content.replace(/^\uFEFF/, "").trim();
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const startIndex =
    parseCsvLine(lines[0] ?? "")
      .map((f) => f.trim().toLowerCase())
      .join(",") === VOCABULARY_CSV_HEADER
      ? 1
      : 0;

  const entries: VocabularyEntry[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i] ?? "");
    if (fields.length < 5) continue;

    const [id, term, weightRaw, source, createdAt] = fields;
    if (!id?.trim() || !term?.trim() || !createdAt?.trim()) continue;
    if (!source || !isVocabularySource(source.trim())) continue;

    const weight = Number.parseInt(weightRaw ?? "1", 10);
    entries.push({
      id: id.trim(),
      term: term.trim(),
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
      source: source.trim() as VocabularySource,
      createdAt: createdAt.trim(),
    });
  }
  return entries;
}

/** 依 weight DESC、created_at DESC 排序（对齐旧 SQL ORDER BY） */
export function sortVocabularyEntries(
  entries: VocabularyEntry[],
): VocabularyEntry[] {
  return [...entries].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
