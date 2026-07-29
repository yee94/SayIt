/**
 * 本地差分纠错学习：比较「粘贴的转写」与「用户修改后的输入框」提取词典候选。
 * 思路对齐有赞 correctionLearner（本地优先，不依赖 LLM）。
 */

const CJK_SHORT_PHRASE_MIN = 2;
const CJK_SHORT_PHRASE_MAX = 8;
const CJK_AUTO_PURE_HAN_MAX = 4;
const GENERAL_SHORT_PHRASE_MAX_CHARS = 40;
const GENERAL_SHORT_PHRASE_MAX_WORDS = 4;
const CJK_SENTENCE_PUNCTUATION_RE =
  /[。！？!?；;，,、：:“”"‘’'【】[\]{}（）()《》〈〉「」『』…·\r\n]/u;
const GENERAL_UNSAFE_TERM_RE = /[/@\\\r\n]/u;
const CJK_SENTENCE_FRAGMENT_RE =
  /(帮我|这个|那个|这些|那些|现在|刚才|今天|明天|昨天|时候|一下|一点|有点|可以|应该|需要|不要|不能|不会|没有|已经|还是|就是|然后|如果|搜索|输入|输出|修改|测试|识别|问题|哪里|什么|为什么|怎么|一个|两个|三个|四个|五个|几个|多少|个字|个词|半句|整句|不是|属于|看到|出现|出来|进去|打开|关闭|继续|结束|完成|恢复|自然|进入|添加|保存|生效|改成|变成|觉得|感觉|发生|用户|录音|组件|状态|效果|能力|功能|逻辑|内容|文字|位置|样式|速度|提醒|词组|智能|词典|一句话)/u;
const CJK_SENTENCE_PARTICLE_RE = /[的了着过吗呢啊吧呀]/u;
const CJK_PRONOUN_OR_DEICTIC_EDGE_RE =
  /^(我|你|他|她|它|这|那)|(?:我|你|他|她|它|这|那)$/u;
const CJK_TERM_SUFFIX_HINT_CHARS = new Set(Array.from("宝销资店单"));
const COMMON_CJK_CONTEXT_STOPS = new Set(
  Array.from(
    "的了着过吗呢啊吧呀是有和与及或把被给对从到在用让说看很更最都也还要会能就不这那我你他她它应",
  ),
);

const hasHan = (value: string) => /[\u4e00-\u9fff]/u.test(value);
const isHanChar = (value: string) => /^[\u4e00-\u9fff]$/u.test(value);
const hasLatin = (value: string) => /[A-Za-z]/.test(value);
const isTermChar = (value: string) => /[\p{L}\p{N}]/u.test(value);

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, ""))
    .filter((w) => w.length > 0);
}

function normalizeCandidate(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
}

function sanitizeForDistance(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isSafeCorrectionCandidate(value: string): boolean {
  const candidate = normalizeCandidate(value);
  if (!candidate) return false;
  if (candidate.length < 2 || candidate.length > GENERAL_SHORT_PHRASE_MAX_CHARS)
    return false;
  if (![...candidate].some(isTermChar)) return false;
  if (GENERAL_UNSAFE_TERM_RE.test(candidate)) return false;
  if (candidate.split(/\s+/).filter(Boolean).length > GENERAL_SHORT_PHRASE_MAX_WORDS)
    return false;

  if (hasHan(candidate)) {
    const charLength = Array.from(candidate).length;
    if (charLength < CJK_SHORT_PHRASE_MIN || charLength > CJK_SHORT_PHRASE_MAX)
      return false;
    if (!hasLatin(candidate) && charLength > CJK_AUTO_PURE_HAN_MAX) return false;
    if (CJK_SENTENCE_PUNCTUATION_RE.test(candidate)) return false;
    if (CJK_SENTENCE_FRAGMENT_RE.test(candidate)) return false;
    if (CJK_SENTENCE_PARTICLE_RE.test(candidate)) return false;
    if (CJK_PRONOUN_OR_DEICTIC_EDGE_RE.test(candidate)) return false;
  }

  return true;
}

function extractTermCandidates(value: string): string[] {
  const input = normalizeCandidate(value);
  if (!input) return [];

  const hasCjk = /[\u4e00-\u9fff]/u.test(input);
  const hasLat = /[A-Za-z]/.test(input);
  const candidates = new Set<string>();

  const maybeAdd = (raw: string) => {
    const candidate = normalizeCandidate(raw);
    if (!isSafeCorrectionCandidate(candidate)) return;
    candidates.add(candidate);
  };

  if (hasCjk && hasLat) {
    maybeAdd(input);
    const latinTerms = input.match(/[A-Za-z][A-Za-z0-9.+#-]{1,39}/g) || [];
    for (const term of latinTerms) maybeAdd(term);
  } else {
    maybeAdd(input);
  }

  return Array.from(candidates);
}

function isSafeShortPhrase(value: string): boolean {
  return isSafeCorrectionCandidate(value);
}

interface LocalizedChange {
  originalChars: string[];
  editedChars: string[];
  start: number;
  originalChanged: string[];
  editedChanged: string[];
}

function findLocalizedCharChange(
  originalText: string,
  editedText: string,
): LocalizedChange | null {
  const originalChars = Array.from(originalText || "");
  const editedChars = Array.from(editedText || "");
  if (originalChars.length === 0 || editedChars.length === 0) return null;

  let prefix = 0;
  while (
    prefix < originalChars.length &&
    prefix < editedChars.length &&
    originalChars[prefix] === editedChars[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < originalChars.length - prefix &&
    suffix < editedChars.length - prefix &&
    originalChars[originalChars.length - 1 - suffix] ===
      editedChars[editedChars.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const originalChanged = originalChars.slice(
    prefix,
    originalChars.length - suffix,
  );
  const editedChanged = editedChars.slice(prefix, editedChars.length - suffix);
  if (
    editedChanged.length === 0 ||
    (originalChanged.length === 0 && editedChanged.length === 0)
  ) {
    return null;
  }

  const maxChanged = Math.max(originalChanged.length, editedChanged.length);
  if (maxChanged > CJK_SHORT_PHRASE_MAX) return null;

  const maxTotal = Math.max(originalChars.length, editedChars.length, 1);
  const unchangedRatio = (prefix + suffix) / maxTotal;
  if (maxTotal > 4 && unchangedRatio < 0.45) return null;

  return {
    originalChars,
    editedChars,
    start: prefix,
    originalChanged,
    editedChanged,
  };
}

function buildNeighborPair(
  change: LocalizedChange,
  direction: "left" | "right",
): [string, string] | null {
  const { originalChars, editedChars, start, originalChanged, editedChanged } =
    change;
  if (originalChanged.length !== 1 || editedChanged.length !== 1) return null;

  const index = direction === "left" ? start - 1 : start + 1;
  if (index < 0 || index >= originalChars.length || index >= editedChars.length)
    return null;

  const originalNeighbor = originalChars[index];
  const editedNeighbor = editedChars[index];
  if (originalNeighbor !== editedNeighbor || !isHanChar(editedNeighbor))
    return null;

  const source =
    direction === "left"
      ? `${originalNeighbor}${originalChanged[0]}`
      : `${originalChanged[0]}${originalNeighbor}`;
  const target =
    direction === "left"
      ? `${editedNeighbor}${editedChanged[0]}`
      : `${editedChanged[0]}${editedNeighbor}`;

  return [source, target];
}

function isWeakCjkNeighborPair(
  pair: [string, string] | null,
  direction: "left" | "right",
): boolean {
  if (!pair?.[1]) return true;
  const chars = Array.from(pair[1]);
  const neighbor = direction === "left" ? chars[0] : chars[chars.length - 1];
  return COMMON_CJK_CONTEXT_STOPS.has(neighbor);
}

function extractLocalizedCjkSubstitutions(
  originalText: string,
  editedText: string,
): Array<[string, string]> {
  if (!hasHan(originalText) || !hasHan(editedText)) return [];

  const change = findLocalizedCharChange(originalText, editedText);
  if (!change) return [];

  const targetChanged = normalizeCandidate(change.editedChanged.join(""));
  const sourceChanged = normalizeCandidate(change.originalChanged.join(""));

  if (
    targetChanged &&
    sourceChanged &&
    Array.from(targetChanged).every(isTermChar) &&
    Array.from(sourceChanged).every(isTermChar) &&
    isSafeShortPhrase(targetChanged)
  ) {
    return [[sourceChanged, targetChanged]];
  }

  if (
    change.editedChanged.length === 1 &&
    isHanChar(change.editedChanged[0])
  ) {
    const leftPair = buildNeighborPair(change, "left");
    const rightPair = buildNeighborPair(change, "right");
    const leftSafe = leftPair && isSafeShortPhrase(leftPair[1]);
    const rightSafe = rightPair && isSafeShortPhrase(rightPair[1]);

    if (leftSafe && rightSafe && leftPair && rightPair) {
      const leftChars = Array.from(leftPair[1]);
      const rightChars = Array.from(rightPair[1]);
      const leftHasSuffixHint = CJK_TERM_SUFFIX_HINT_CHARS.has(
        leftChars[leftChars.length - 1],
      );
      const rightHasSuffixHint = CJK_TERM_SUFFIX_HINT_CHARS.has(
        rightChars[rightChars.length - 1],
      );
      if (rightHasSuffixHint && !leftHasSuffixHint) return [rightPair];
      if (leftHasSuffixHint && !rightHasSuffixHint) return [leftPair];

      const leftWeak = isWeakCjkNeighborPair(leftPair, "left");
      const rightWeak = isWeakCjkNeighborPair(rightPair, "right");
      if (leftWeak && !rightWeak) return [rightPair];
      if (rightWeak && !leftWeak) return [leftPair];
      // 左右都可学时：中文单字纠正常见为「前缀词根 + 改字」（发现、客销），优先左侧词对
      return [leftPair];
    }

    if (leftSafe && leftPair) return [leftPair];
    if (rightSafe && rightPair) return [rightPair];
  }

  return [];
}

function findEditedRegion(originalText: string, fieldValue: string): string {
  if (fieldValue.length <= originalText.length * 1.5) {
    return fieldValue;
  }

  const idx = fieldValue.indexOf(originalText);
  if (idx !== -1) {
    return originalText;
  }

  const origWords = tokenize(originalText);
  const fieldWords = tokenize(fieldValue);
  const windowSize = origWords.length;

  if (fieldWords.length <= windowSize) {
    return fieldValue;
  }

  let bestStart = 0;
  let bestScore = -1;

  for (let i = 0; i <= fieldWords.length - windowSize; i++) {
    let matches = 0;
    for (let j = 0; j < windowSize; j++) {
      if (fieldWords[i + j].toLowerCase() === origWords[j].toLowerCase()) {
        matches++;
      }
    }
    if (matches > bestScore) {
      bestScore = matches;
      bestStart = i;
    }
  }

  if (bestScore < windowSize * 0.3) {
    return fieldValue;
  }

  return fieldWords.slice(bestStart, bestStart + windowSize).join(" ");
}

function findSubstitutions(
  origWords: string[],
  editedWords: string[],
): { substitutions: Array<[string, string]>; lcsLength: number } {
  const m = origWords.length;
  const n = editedWords.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const aligned: Array<[string | null, string | null]> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()
    ) {
      aligned.unshift([origWords[i - 1], editedWords[j - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      aligned.unshift([null, editedWords[j - 1]]);
      j--;
    } else {
      aligned.unshift([origWords[i - 1], null]);
      i--;
    }
  }

  const subs: Array<[string, string]> = [];
  for (let k = 0; k < aligned.length; k++) {
    const [origW, editW] = aligned[k];
    if (origW === null || editW !== null) continue;

    const deleted = [origW];
    let jj = k + 1;
    while (jj < aligned.length) {
      const [nextOrigW, nextEditW] = aligned[jj];
      if (nextOrigW !== null && nextEditW === null) {
        deleted.push(nextOrigW);
        jj++;
        continue;
      }
      break;
    }

    const inserted: string[] = [];
    while (jj < aligned.length) {
      const [nextOrigW, nextEditW] = aligned[jj];
      if (nextOrigW === null && nextEditW !== null) {
        inserted.push(nextEditW);
        jj++;
        continue;
      }
      break;
    }

    if (deleted.length > 0 && inserted.length > 0) {
      subs.push([deleted.join(" "), inserted.join(" ")]);
      k = jj - 1;
    }
  }

  return { substitutions: subs, lcsLength: dp[m][n] };
}

function buildMixedScriptContextSubstitutions(
  substitutions: Array<[string, string]>,
  editedRegion: string,
): Array<[string, string]> {
  if (!Array.isArray(substitutions) || typeof editedRegion !== "string")
    return [];

  const results: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const [origWord, correctedWord] of substitutions) {
    const original = normalizeCandidate(origWord);
    const corrected = normalizeCandidate(correctedWord);
    if (!original || !corrected || !hasHan(corrected)) continue;

    let startIndex = 0;
    while (startIndex < editedRegion.length) {
      const index = editedRegion.indexOf(corrected, startIndex);
      if (index === -1) break;

      const before = editedRegion.slice(0, index);
      const after = editedRegion.slice(index + corrected.length);
      const leftMatch = before.match(/[A-Za-z][A-Za-z0-9.+#-]{0,39}\s*$/);
      const rightMatch = after.match(/^\s*[A-Za-z][A-Za-z0-9.+#-]{0,39}/);

      if (leftMatch) {
        const rawLeft = leftMatch[0];
        const left = rawLeft.trim();
        const separator = /\s$/.test(rawLeft) ? " " : "";
        const sourcePhrase = `${left}${separator}${original}`;
        const targetPhrase = `${left}${separator}${corrected}`;
        const key = `${sourcePhrase}\0${targetPhrase}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push([sourcePhrase, targetPhrase]);
        }
      }

      if (rightMatch) {
        const rawRight = rightMatch[0];
        const right = rawRight.trim();
        const separator = /^\s/.test(rawRight) ? " " : "";
        const sourcePhrase = `${original}${separator}${right}`;
        const targetPhrase = `${corrected}${separator}${right}`;
        const key = `${sourcePhrase}\0${targetPhrase}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push([sourcePhrase, targetPhrase]);
        }
      }

      startIndex = index + corrected.length;
    }
  }

  return results;
}

/**
 * 中文无拼音库时：用字元编辑距离判断是否为「小范围修正」。
 * 同长度短词允许较高距离（同音近形字替换）；长词更严格。
 */
function isHanCorrectionSimilar(originalValue: string, correctedValue: string): boolean {
  const a = Array.from(normalizeCandidate(originalValue));
  const b = Array.from(normalizeCandidate(correctedValue));
  if (a.length === 0 || b.length === 0) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  const maxLen = Math.max(a.length, b.length);
  const dist = editDistance(a.join(""), b.join(""));
  const ratio = dist / maxLen;

  if (maxLen <= 2) return ratio <= 1;
  if (maxLen <= CJK_AUTO_PURE_HAN_MAX) return ratio <= 0.67;
  return ratio <= 0.34;
}

function collectCorrectionCandidates(
  substitutions: Array<[string, string]>,
  existingDictionary: string[],
): string[] {
  const safeDict = Array.isArray(existingDictionary) ? existingDictionary : [];
  const dictSet = new Set(safeDict.map((w) => w.toLowerCase()));
  const seenCorrections = new Set<string>();
  const results: string[] = [];

  for (const [origWord, correctedWord] of substitutions) {
    if (!origWord || !correctedWord) continue;

    const sourceCandidates = extractTermCandidates(origWord);
    const targetCandidates = extractTermCandidates(correctedWord);
    if (targetCandidates.length === 0) continue;

    const sourceDistancePool = (
      sourceCandidates.length > 0 ? sourceCandidates : [origWord]
    )
      .map((w) => sanitizeForDistance(w))
      .filter(Boolean);

    for (const candidate of targetCandidates) {
      const normalizedCandidate = candidate.toLowerCase();
      if (dictSet.has(normalizedCandidate)) continue;
      if (seenCorrections.has(normalizedCandidate)) continue;
      if (sourceCandidates.some((w) => w.toLowerCase() === normalizedCandidate))
        continue;

      const distTarget = sanitizeForDistance(candidate);
      if (!distTarget) continue;

      if (hasHan(candidate)) {
        if (!hasHan(origWord) || !isHanCorrectionSimilar(origWord, candidate)) {
          continue;
        }
      } else if (sourceDistancePool.length > 0) {
        let bestRatio = Number.POSITIVE_INFINITY;
        for (const distSource of sourceDistancePool) {
          const maxLen = Math.max(distSource.length, distTarget.length);
          if (maxLen === 0) continue;
          const dist = editDistance(distSource, distTarget);
          const ratio = dist / maxLen;
          if (ratio < bestRatio) bestRatio = ratio;
        }
        const maxLen = Math.max(
          ...sourceDistancePool.map((s) => Math.max(s.length, distTarget.length)),
        );
        const maxDistanceRatio = maxLen <= 4 ? 0.5 : 0.65;
        if (bestRatio > maxDistanceRatio) continue;
      }

      results.push(candidate);
      seenCorrections.add(normalizedCandidate);
    }
  }

  return results;
}

/**
 * 从用户对粘贴转写的修改中提取应写入字典的规范词。
 */
export function extractCorrections(
  originalText: string,
  fieldValue: string,
  existingDictionary: string[] = [],
): string[] {
  if (!originalText || !fieldValue) return [];
  if (originalText === fieldValue) return [];

  const editedRegion = findEditedRegion(originalText, fieldValue);
  if (editedRegion === originalText) return [];

  const origWords = tokenize(originalText);
  const editedWords = tokenize(editedRegion);

  if (origWords.length === 0 || editedWords.length === 0) return [];

  const localizedCjkSubs =
    hasHan(originalText) && hasHan(editedRegion)
      ? extractLocalizedCjkSubstitutions(originalText, editedRegion)
      : [];

  if (
    hasHan(originalText) &&
    hasHan(editedRegion) &&
    origWords.length === 1 &&
    editedWords.length === 1
  ) {
    const localizedMixedScriptContextSubs = buildMixedScriptContextSubstitutions(
      localizedCjkSubs,
      editedRegion,
    );
    return collectCorrectionCandidates(
      [...localizedCjkSubs, ...localizedMixedScriptContextSubs],
      existingDictionary,
    );
  }

  const isShortSample = Math.max(origWords.length, editedWords.length) <= 4;
  const isVeryShortSample = Math.max(origWords.length, editedWords.length) <= 2;

  const lengthDeltaRatio =
    Math.abs(editedWords.length - origWords.length) /
    Math.max(origWords.length, 1);
  const maxLengthDeltaRatio = isShortSample ? 1 : 0.4;
  if (lengthDeltaRatio > maxLengthDeltaRatio) return [];

  const { substitutions: subs, lcsLength } = findSubstitutions(
    origWords,
    editedWords,
  );
  const localizedSubsFromBlocks: Array<[string, string]> = [];
  for (const [originalBlock, editedBlock] of subs) {
    localizedSubsFromBlocks.push(
      ...extractLocalizedCjkSubstitutions(originalBlock, editedBlock),
    );
  }
  const allLocalizedCjkSubs = [...localizedCjkSubs, ...localizedSubsFromBlocks];
  const localizedMixedScriptContextSubs = buildMixedScriptContextSubstitutions(
    allLocalizedCjkSubs,
    editedRegion,
  );
  const changedRatio = subs.length / Math.max(origWords.length, 1);
  const unchangedRatio =
    lcsLength / Math.max(origWords.length, editedWords.length, 1);
  const maxChangedRatio = isVeryShortSample ? 1 : isShortSample ? 0.8 : 0.35;
  const minUnchangedRatio = isShortSample ? 0 : 0.45;
  if (changedRatio > maxChangedRatio || unchangedRatio < minUnchangedRatio) {
    if (allLocalizedCjkSubs.length === 0 || unchangedRatio < minUnchangedRatio)
      return [];
    return collectCorrectionCandidates(
      [...localizedMixedScriptContextSubs, ...allLocalizedCjkSubs],
      existingDictionary,
    );
  }

  const mixedScriptContextSubs = buildMixedScriptContextSubstitutions(
    subs,
    editedRegion,
  );
  return collectCorrectionCandidates(
    [
      ...localizedMixedScriptContextSubs,
      ...allLocalizedCjkSubs,
      ...subs,
      ...mixedScriptContextSubs,
    ],
    existingDictionary,
  );
}
