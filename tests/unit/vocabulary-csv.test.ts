import { describe, expect, it } from "vitest";
import {
  VOCABULARY_CSV_HEADER,
  escapeCsvField,
  parseCsvLine,
  parseVocabularyCsv,
  serializeVocabularyCsv,
  sortVocabularyEntries,
} from "../../src/lib/vocabularyCsv";
import type { VocabularyEntry } from "../../src/types/vocabulary";

function entry(
  overrides: Partial<VocabularyEntry> & Pick<VocabularyEntry, "term">,
): VocabularyEntry {
  return {
    id: overrides.id ?? "id-1",
    term: overrides.term,
    weight: overrides.weight ?? 1,
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-03-09 00:00:00",
  };
}

describe("vocabularyCsv", () => {
  describe("escapeCsvField / parseCsvLine", () => {
    it("普通字段不包引号", () => {
      expect(escapeCsvField("hello")).toBe("hello");
    });

    it("含逗号 / 引号 / 换行时应转义", () => {
      expect(escapeCsvField("a,b")).toBe('"a,b"');
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
      expect(escapeCsvField("a\nb")).toBe('"a\nb"');
    });

    it("应解析含转义引号与逗号的字段", () => {
      expect(parseCsvLine('a,"b,c","say ""hi"""')).toEqual([
        "a",
        "b,c",
        'say "hi"',
      ]);
    });
  });

  describe("serialize / parse", () => {
    it("空表仍写出表头", () => {
      expect(serializeVocabularyCsv([])).toBe(`${VOCABULARY_CSV_HEADER}\n`);
    });

    it("往返序列化应保留栏位", () => {
      const rows = [
        entry({
          id: "1",
          term: "Vue.js",
          weight: 3,
          source: "manual",
          createdAt: "2026-01-01 00:00:00",
        }),
        entry({
          id: "2",
          term: 'a,"b"',
          weight: 1,
          source: "ai",
          createdAt: "2026-02-01 00:00:00",
        }),
      ];

      const csv = serializeVocabularyCsv(rows);
      expect(csv.startsWith(`${VOCABULARY_CSV_HEADER}\n`)).toBe(true);

      const parsed = parseVocabularyCsv(csv);
      expect(parsed).toEqual(rows);
    });

    it("缺栏位或非法 source 的行应跳过", () => {
      const csv = `${VOCABULARY_CSV_HEADER}
ok,Term,1,manual,2026-01-01 00:00:00
bad,only,three
x,BadSource,1,robot,2026-01-01 00:00:00
`;
      expect(parseVocabularyCsv(csv)).toEqual([
        entry({
          id: "ok",
          term: "Term",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01 00:00:00",
        }),
      ]);
    });

    it("应忽略 BOM 与非法 weight（回退为 1）", () => {
      const csv = `\uFEFF${VOCABULARY_CSV_HEADER}
a,Term,0,manual,2026-01-01 00:00:00
b,Term2,nope,ai,2026-01-02 00:00:00
`;
      const parsed = parseVocabularyCsv(csv);
      expect(parsed.map((e) => e.weight)).toEqual([1, 1]);
    });
  });

  describe("sortVocabularyEntries", () => {
    it("应按 weight DESC、createdAt DESC 排序", () => {
      const sorted = sortVocabularyEntries([
        entry({ id: "1", term: "Low", weight: 1, createdAt: "2026-03-01 00:00:00" }),
        entry({ id: "2", term: "High", weight: 10, createdAt: "2026-03-01 00:00:00" }),
        entry({
          id: "3",
          term: "MidNewer",
          weight: 5,
          createdAt: "2026-03-09 00:00:00",
        }),
        entry({
          id: "4",
          term: "MidOlder",
          weight: 5,
          createdAt: "2026-03-02 00:00:00",
        }),
      ]);

      expect(sorted.map((e) => e.term)).toEqual([
        "High",
        "MidNewer",
        "MidOlder",
        "Low",
      ]);
    });
  });
});
