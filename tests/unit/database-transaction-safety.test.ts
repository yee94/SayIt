import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * 回归守门：禁止以「独立 execute() 呼叫」发出 BEGIN/COMMIT/ROLLBACK。
 *
 * tauri-plugin-sql 每次 execute()/select() 都从 sqlx 连线池借一条全新连线，
 * 无连线亲和性；跨呼叫的 BEGIN 与 COMMIT 可能落在不同实体连线，导致
 * "cannot commit - no transaction is active"（首次启动跑 migration 必现）。
 * Migration / 批次写入必须改用幂等语句，不可依赖跨呼叫交易。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("DB 连线池安全：禁止跨呼叫交易语句", () => {
  const files = [
    "src/lib/database.ts",
    "src/stores/useVocabularyStore.ts",
  ];

  for (const file of files) {
    it(`[P1] ${file} 不得有独立的 execute("BEGIN/COMMIT/ROLLBACK") 呼叫`, () => {
      const source = readSource(file);
      // 全档扫描（\s* 可跨换行），亦能捕捉跨行的 .execute(\n  "COMMIT"\n)
      const pattern =
        /\.execute\(\s*[`"'](?:BEGIN(?:\s+TRANSACTION)?|COMMIT|ROLLBACK)\b/gi;
      const offending = [...source.matchAll(pattern)].map((match) => {
        const lineNo = source.slice(0, match.index).split("\n").length;
        return `L${lineNo}: ${match[0]}`;
      });

      expect(
        offending,
        `发现跨呼叫交易语句（连线池无亲和性，COMMIT 可能落在无交易的连线）：\n${offending.join(
          "\n",
        )}`,
      ).toEqual([]);
    });
  }
});