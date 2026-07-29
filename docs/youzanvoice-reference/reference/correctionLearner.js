const { pinyin } = require("pinyin-pro");

/**
 * Extracts transcription corrections by diffing original text against
 * the edited field value. Returns corrected words to add to the custom dictionary.
 */

/** Levenshtein edit distance between two strings */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

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

/** Tokenize text into words, stripping punctuation from edges */
function tokenize(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, ""))
    .filter((w) => w.length > 0);
}

function normalizeCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
}

function sanitizeForDistance(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

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
const CJK_PRONOUN_OR_DEICTIC_EDGE_RE = /^(我|你|他|她|它|这|那)|(?:我|你|他|她|它|这|那)$/u;
const CJK_TERM_SUFFIX_HINT_CHARS = new Set(Array.from("宝销资店单"));
const MAX_PINYIN_DISTANCE_RATIO = 0.34;

const hasHan = (value) => /[\p{Script=Han}]/u.test(value);
const isHanChar = (value) => /\p{Script=Han}/u.test(value);
const hasLatin = (value) => /[A-Za-z]/.test(value);
const isTermChar = (value) => /[\p{L}\p{N}]/u.test(value);
const COMMON_CJK_CONTEXT_STOPS = new Set(
  Array.from(
    "的了着过吗呢啊吧呀是有和与及或把被给对从到在用让说看很更最都也还要会能就不这那我你他她它应"
  )
);

// 将中文词转换为不带声调的拼音音节，供近音修正判断使用。
function getPinyinSyllables(value) {
  const normalized = normalizeCandidate(value);
  if (!normalized || !hasHan(normalized)) return [];

  try {
    return pinyin(normalized, {
      type: "array",
      toneType: "none",
      nonZh: "consecutive",
    })
      .map((item) =>
        String(item || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "")
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

// 判断原词和修改词的拼音是否相似，要求音节数量一致并限制拼音编辑距离。
function isPinyinCorrectionSimilar(originalValue, correctedValue) {
  const originalPinyin = getPinyinSyllables(originalValue);
  const correctedPinyin = getPinyinSyllables(correctedValue);
  if (originalPinyin.length === 0 || originalPinyin.length !== correctedPinyin.length) {
    return false;
  }

  const originalKey = originalPinyin.join("");
  const correctedKey = correctedPinyin.join("");
  const maxLength = Math.max(originalKey.length, correctedKey.length);
  if (maxLength === 0) return false;

  const ratio = editDistance(originalKey, correctedKey) / maxLength;
  return ratio <= MAX_PINYIN_DISTANCE_RATIO;
}

function isSafeCorrectionCandidate(value) {
  const candidate = normalizeCandidate(value);
  if (!candidate) return false;
  if (candidate.length < 2 || candidate.length > GENERAL_SHORT_PHRASE_MAX_CHARS) return false;
  if (!isTermChar(candidate)) return false;
  if (GENERAL_UNSAFE_TERM_RE.test(candidate)) return false;
  if (candidate.split(/\s+/).filter(Boolean).length > GENERAL_SHORT_PHRASE_MAX_WORDS) return false;

  if (hasHan(candidate)) {
    const charLength = Array.from(candidate).length;
    if (charLength < CJK_SHORT_PHRASE_MIN || charLength > CJK_SHORT_PHRASE_MAX) return false;
    if (!hasLatin(candidate) && charLength > CJK_AUTO_PURE_HAN_MAX) return false;
    if (CJK_SENTENCE_PUNCTUATION_RE.test(candidate)) return false;
    if (CJK_SENTENCE_FRAGMENT_RE.test(candidate)) return false;
    if (CJK_SENTENCE_PARTICLE_RE.test(candidate)) return false;
    if (CJK_PRONOUN_OR_DEICTIC_EDGE_RE.test(candidate)) return false;
  }

  return true;
}

/**
 * Extract likely dictionary terms from a token/phrase.
 * - Mixed CJK+Latin text: prefer extracting embedded terms (e.g. "你知道Antigravity吗" -> "Antigravity")
 * - Pure tokens: allow full token if concise
 */
function extractTermCandidates(value) {
  const input = normalizeCandidate(value);
  if (!input) return [];

  const hasCjk = /[\p{Script=Han}]/u.test(input);
  const hasLatin = /[A-Za-z]/.test(input);
  const candidates = new Set();

  const maybeAdd = (raw) => {
    const candidate = normalizeCandidate(raw);
    if (!isSafeCorrectionCandidate(candidate)) return;
    candidates.add(candidate);
  };

  if (hasCjk && hasLatin) {
    // Mixed-script text is often sentence context around a term.
    // Keep the full phrase only when it is short and not sentence-like,
    // then also pull embedded Latin-like identifiers.
    maybeAdd(input);
    const latinTerms = input.match(/[A-Za-z][A-Za-z0-9.+#-]{1,39}/g) || [];
    for (const term of latinTerms) {
      maybeAdd(term);
    }
  } else {
    // Pure-script text: keep the full token/phrase as the canonical correction.
    maybeAdd(input);
  }

  return Array.from(candidates);
}

function isSafeShortPhrase(value) {
  const candidate = normalizeCandidate(value);
  return isSafeCorrectionCandidate(candidate);
}

function findLocalizedCharChange(originalText, editedText) {
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

  const originalChanged = originalChars.slice(prefix, originalChars.length - suffix);
  const editedChanged = editedChars.slice(prefix, editedChars.length - suffix);
  if (editedChanged.length === 0 || (originalChanged.length === 0 && editedChanged.length === 0)) {
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

function buildNeighborPair(change, direction) {
  const { originalChars, editedChars, start, originalChanged, editedChanged } = change;
  if (originalChanged.length !== 1 || editedChanged.length !== 1) return null;

  const index = direction === "left" ? start - 1 : start + 1;
  if (index < 0 || index >= originalChars.length || index >= editedChars.length) return null;

  const originalNeighbor = originalChars[index];
  const editedNeighbor = editedChars[index];
  if (originalNeighbor !== editedNeighbor || !isHanChar(editedNeighbor)) return null;

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

function isWeakCjkNeighborPair(pair, direction) {
  if (!pair || !pair[1]) return true;
  const chars = Array.from(pair[1]);
  const neighbor = direction === "left" ? chars[0] : chars[chars.length - 1];
  return COMMON_CJK_CONTEXT_STOPS.has(neighbor);
}

function extractLocalizedCjkSubstitutions(originalText, editedText) {
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

  if (change.editedChanged.length === 1 && isHanChar(change.editedChanged[0])) {
    const leftPair = buildNeighborPair(change, "left");
    const rightPair = buildNeighborPair(change, "right");
    const leftSafe = leftPair && isSafeShortPhrase(leftPair[1]);
    const rightSafe = rightPair && isSafeShortPhrase(rightPair[1]);

    if (leftSafe && rightSafe) {
      const leftChars = Array.from(leftPair[1]);
      const rightChars = Array.from(rightPair[1]);
      const leftHasSuffixHint = CJK_TERM_SUFFIX_HINT_CHARS.has(leftChars[leftChars.length - 1]);
      const rightHasSuffixHint = CJK_TERM_SUFFIX_HINT_CHARS.has(
        rightChars[rightChars.length - 1]
      );
      if (rightHasSuffixHint && !leftHasSuffixHint) return [rightPair];
      if (leftHasSuffixHint && !rightHasSuffixHint) return [leftPair];

      const leftWeak = isWeakCjkNeighborPair(leftPair, "left");
      const rightWeak = isWeakCjkNeighborPair(rightPair, "right");
      if (leftWeak && !rightWeak) return [rightPair];
      if (rightWeak && !leftWeak) return [leftPair];
      // 左右都无法判断词边界时不自动学习，避免把相邻上下文误当成用户修改的词。
      return [];
    }

    if (leftSafe) return [leftPair];
    if (rightSafe) return [rightPair];
  }

  return [];
}

/**
 * Find the region in fieldValue that corresponds to the pasted originalText.
 * If the field only contains the pasted text, returns fieldValue as-is.
 */
function findEditedRegion(originalText, fieldValue) {
  if (fieldValue.length <= originalText.length * 1.5) {
    return fieldValue;
  }

  const idx = fieldValue.indexOf(originalText);
  if (idx !== -1) {
    return originalText;
  }

  // Sliding window: find the region with highest word overlap
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

  // Require at least 30% word overlap to consider it a match
  if (bestScore < windowSize * 0.3) {
    return fieldValue;
  }

  return fieldWords.slice(bestStart, bestStart + windowSize).join(" ");
}

/**
 * Word-level LCS to find [originalWord, editedWord] substitution pairs.
 * Returns substitution pairs plus LCS length for rewrite detection.
 */
function findSubstitutions(origWords, editedWords) {
  const m = origWords.length;
  const n = editedWords.length;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const aligned = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()) {
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

  // Group substitutions by contiguous delete+insert blocks.
  // This handles:
  // - one-to-one: "Kimmy" -> "kimi"
  // - one-to-many: "Evan" -> "E win"
  // - many-to-one: "V R S S" -> "WeRSS"
  // - many-to-many short phrase rewrites for proper nouns
  const subs = [];
  for (let k = 0; k < aligned.length; k++) {
    const [origW, editW] = aligned[k];
    if (origW === null || editW !== null) continue;

    const deleted = [origW];
    let j = k + 1;
    while (j < aligned.length) {
      const [nextOrigW, nextEditW] = aligned[j];
      if (nextOrigW !== null && nextEditW === null) {
        deleted.push(nextOrigW);
        j++;
        continue;
      }
      break;
    }

    const inserted = [];
    while (j < aligned.length) {
      const [nextOrigW, nextEditW] = aligned[j];
      if (nextOrigW === null && nextEditW !== null) {
        inserted.push(nextEditW);
        j++;
        continue;
      }
      break;
    }

    if (deleted.length > 0 && inserted.length > 0) {
      subs.push([deleted.join(" "), inserted.join(" ")]);
      k = j - 1;
    }
  }

  return {
    substitutions: subs,
    lcsLength: dp[m][n],
  };
}

function buildMixedScriptContextSubstitutions(substitutions, editedRegion) {
  if (!Array.isArray(substitutions) || typeof editedRegion !== "string") return [];

  const results = [];
  const seen = new Set();

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
        const key = `${sourcePhrase}\u0000${targetPhrase}`;
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
        const key = `${sourcePhrase}\u0000${targetPhrase}`;
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
 * Extract corrected words from a user's edits to pasted transcription text.
 *
 * @param {string} originalText - The text that was originally pasted (from transcription)
 * @param {string} fieldValue - The current value of the text field (after user edits)
 * @param {string[]} existingDictionary - Words already in the custom dictionary
 * @returns {string[]} Array of corrected words to add to the dictionary
 */
function extractCorrections(originalText, fieldValue, existingDictionary) {
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
      editedRegion
    );
    return collectCorrectionCandidates(
      [...localizedCjkSubs, ...localizedMixedScriptContextSubs],
      existingDictionary
    );
  }

  const isShortSample = Math.max(origWords.length, editedWords.length) <= 4;
  const isVeryShortSample = Math.max(origWords.length, editedWords.length) <= 2;

  const lengthDeltaRatio =
    Math.abs(editedWords.length - origWords.length) / Math.max(origWords.length, 1);
  const maxLengthDeltaRatio = isShortSample ? 1 : 0.4;
  if (lengthDeltaRatio > maxLengthDeltaRatio) return [];

  // If too much changed, treat this as a rewrite and learn nothing.
  const { substitutions: subs, lcsLength } = findSubstitutions(origWords, editedWords);
  // 句子级替换块里继续提取局部中文短词修正，例如“AI 课销是...”改为“AI 客销是...”。
  const localizedSubsFromBlocks = [];
  for (const [originalBlock, editedBlock] of subs) {
    localizedSubsFromBlocks.push(...extractLocalizedCjkSubstitutions(originalBlock, editedBlock));
  }
  const allLocalizedCjkSubs = [...localizedCjkSubs, ...localizedSubsFromBlocks];
  const localizedMixedScriptContextSubs = buildMixedScriptContextSubstitutions(
    allLocalizedCjkSubs,
    editedRegion
  );
  const changedRatio = subs.length / Math.max(origWords.length, 1);
  const unchangedRatio = lcsLength / Math.max(origWords.length, editedWords.length, 1);
  const maxChangedRatio = isVeryShortSample ? 1 : isShortSample ? 0.8 : 0.35;
  // For short samples, allow zero unchanged words so acronym-style corrections
  // (e.g. "V R S S" -> "We RSS") can still be learned.
  const minUnchangedRatio = isShortSample ? 0 : 0.45;
  if (changedRatio > maxChangedRatio || unchangedRatio < minUnchangedRatio) {
    if (allLocalizedCjkSubs.length === 0 || unchangedRatio < minUnchangedRatio) return [];
    // 多处修正同一个局部短词时，整体改动比例可能偏高，但仍可学习局部词组。
    return collectCorrectionCandidates(
      [...localizedMixedScriptContextSubs, ...allLocalizedCjkSubs],
      existingDictionary
    );
  }

  const mixedScriptContextSubs = buildMixedScriptContextSubstitutions(subs, editedRegion);
  return collectCorrectionCandidates(
    [
      ...localizedMixedScriptContextSubs,
      ...allLocalizedCjkSubs,
      ...subs,
      ...mixedScriptContextSubs,
    ],
    existingDictionary
  );
}

function collectCorrectionCandidates(substitutions, existingDictionary) {
  const safeDict = Array.isArray(existingDictionary) ? existingDictionary : [];
  const dictSet = new Set(safeDict.map((w) => w.toLowerCase()));
  const seenCorrections = new Set();
  const results = [];

  for (const [origWord, correctedWord] of substitutions) {
    if (!origWord || !correctedWord) continue;

    const sourceCandidates = extractTermCandidates(origWord);
    const targetCandidates = extractTermCandidates(correctedWord);
    if (targetCandidates.length === 0) continue;

    const sourceDistancePool = (sourceCandidates.length > 0 ? sourceCandidates : [origWord])
      .map((w) => sanitizeForDistance(w))
      .filter(Boolean);

    for (const candidate of targetCandidates) {
      const normalizedCandidate = candidate.toLowerCase();
      if (dictSet.has(normalizedCandidate)) continue;
      if (seenCorrections.has(normalizedCandidate)) continue;
      if (sourceCandidates.some((w) => w.toLowerCase() === normalizedCandidate)) continue;

      const distTarget = sanitizeForDistance(candidate);
      if (!distTarget) continue;

      if (hasHan(candidate)) {
        if (!hasHan(origWord) || !isPinyinCorrectionSimilar(origWord, candidate)) {
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
          ...sourceDistancePool.map((s) => Math.max(s.length, distTarget.length))
        );
        const isShortPureHanCandidate =
          hasHan(candidate) &&
          !hasLatin(candidate) &&
          maxLen <= CJK_AUTO_PURE_HAN_MAX &&
          Array.from(candidate).every(isHanChar);
        // 中文短词由用户手动整词修正时，允许两字全变，例如“紫璇”改为“指玄”。
        let maxDistanceRatio;
        if (hasHan(candidate)) {
          if (isShortPureHanCandidate && maxLen <= 2) {
            maxDistanceRatio = 1;
          } else if (isShortPureHanCandidate) {
            maxDistanceRatio = 0.67;
          } else if (maxLen <= 2) {
            maxDistanceRatio = 0.5;
          } else {
            maxDistanceRatio = 0.34;
          }
        } else {
          maxDistanceRatio = maxLen <= 4 ? 0.5 : 0.65;
        }
        if (bestRatio > maxDistanceRatio) continue;
      }

      results.push(candidate);
      seenCorrections.add(normalizedCandidate);
    }
  }

  return results;
}

module.exports = { extractCorrections, isSafeCorrectionCandidate };
