/**
 * 将转写结果中的近似拼写 / 大小写 / CamelCase 变体归一到字典规范词。
 */

import { editDistance } from "./correctionLearner";

const MAX_CANONICALIZE_TERMS = 100;
const MAX_EDIT_RATIO = 0.34;

function stripSeparators(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "");
}

function splitCamelCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function normalizeForMatch(value: string): string {
  return stripSeparators(splitCamelCase(value));
}

/**
 * 若 token 与字典词在大小写 / 分隔符 / 小编辑距离上近似，则返回规范词。
 */
export function matchCanonicalTerm(
  token: string,
  dictionaryTerms: string[],
): string | null {
  const trimmed = token.trim();
  if (!trimmed || dictionaryTerms.length === 0) return null;

  const tokenKey = normalizeForMatch(trimmed);
  if (!tokenKey) return null;

  let best: { term: string; score: number } | null = null;

  for (const term of dictionaryTerms) {
    const dictKey = normalizeForMatch(term);
    if (!dictKey) continue;

    if (tokenKey === dictKey) {
      // 完全匹配（忽略大小写/分隔）时：若已与规范词一致则不替换
      if (trimmed === term) return null;
      return term;
    }

    // 仅对拉丁词做编辑距离归一（中文靠完全匹配，避免误改）
    if (!/[a-z]/i.test(tokenKey) || !/[a-z]/i.test(dictKey)) continue;

    const maxLen = Math.max(tokenKey.length, dictKey.length);
    if (maxLen === 0 || maxLen > 40) continue;
    // 长度差过大不合并
    if (Math.abs(tokenKey.length - dictKey.length) > 2) continue;

    const dist = editDistance(tokenKey, dictKey);
    const ratio = dist / maxLen;
    if (ratio > MAX_EDIT_RATIO) continue;
    if (!best || ratio < best.score) {
      best = { term, score: ratio };
    }
  }

  return best ? best.term : null;
}

/**
 * 对整段转写做词级归一。空白分词；无空格的 CJK 串保留原样（仅处理有空格/标点边界的拉丁词）。
 */
export function canonicalizeTranscription(
  text: string,
  dictionaryTerms: string[],
): string {
  if (!text || dictionaryTerms.length === 0) return text;

  const terms = dictionaryTerms.slice(0, MAX_CANONICALIZE_TERMS);
  // 按 token 边界切分，保留分隔符
  return text.replace(
    /[A-Za-z][A-Za-z0-9_+.#-]*/g,
    (token) => matchCanonicalTerm(token, terms) ?? token,
  );
}
