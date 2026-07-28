/**
 * 幻觉侦测模组 — 纯函式，不依赖 Vue/Pinia/Tauri。
 *
 * 二层侦测逻辑（纯物理信号）：
 *  Layer 1: 语速异常（录音 < 1 秒但文字 > 10 字）
 *  Layer 2: 无人声侦测（静音 / 低 RMS + 高 NSP 联合判断）
 */

// ── 常数 ──

/** Layer 1 录音时长门槛（ms） */
export const SPEED_ANOMALY_MAX_DURATION_MS = 1000;
/** Layer 1 文字长度门槛 */
export const SPEED_ANOMALY_MIN_CHARS = 10;
/** Layer 2a 静音峰值能量门槛（0.0 = 完全静音, 1.0 = 最大音量） */
export const SILENCE_PEAK_ENERGY_THRESHOLD = 0.01;
/** Layer 2b 低 RMS 门槛 — 搭配高 NSP 联合判断（人声 RMS ≥ 0.03，背景噪音 RMS ≈ 0.005~0.02） */
export const SILENCE_RMS_THRESHOLD = 0.015;
/** Layer 2b NSP 门槛（Whisper 认为「可能无语音」的信心度） */
export const SILENCE_NSP_THRESHOLD = 0.7;
/** Layer 2b peak energy 天花板 — peak >= 此值表示有明确可听声音，跳过 RMS+NSP 联合判断
 *  （避免小声说话因 RMS 被静音段稀释而误判为幻觉） */
export const LAYER2B_PEAK_ENERGY_CEILING = 0.03;

// ── 型别 ──

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
  noSpeechProbability: number;
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason: "speed-anomaly" | "no-speech-detected" | null;
  detectedText: string;
}

// ── 核心函式 ──

/**
 * 二层幻觉侦测逻辑（纯物理信号）。
 *
 * Layer 1: 语速异常 — 录音不到 1 秒但 Whisper 回传超过 10 字，物理上不可能。
 * Layer 2: 无人声 — 静音（peak < 0.02）、或 peak 偏低时（< 0.03）的低 RMS + 高 NSP 联合判断。
 *          若 peak >= 0.03 表示有明确可听声音，跳过 RMS+NSP 检查避免小声说话误判。
 */
// ── 增强后侦测 ──

/** 增强后文字长度爆炸倍率门槛 — 校对只加标点空白，正常增幅 < 1.3 倍，2 倍已很宽松 */
export const ENHANCEMENT_LENGTH_EXPLOSION_RATIO = 2;

export interface EnhancementAnomalyParams {
  rawText: string;
  enhancedText: string;
}

export interface EnhancementAnomalyResult {
  isAnomaly: boolean;
  reason: "length-explosion" | null;
}

/**
 * 增强后语意偏移侦测 — 检查 LLM 增强是否产生异常结果。
 *
 * 目前只做一层「长度爆炸」侦测：校对工具只改错字和加标点，
 * 产出不应比输入长 3 倍以上。若超过，代表 LLM 在回答问题或产生幻觉。
 */
export function detectEnhancementAnomaly(
  params: EnhancementAnomalyParams,
): EnhancementAnomalyResult {
  const rawLength = params.rawText.trim().length;
  const enhancedLength = params.enhancedText.trim().length;

  // 避免除以零：rawText 为空时不判定异常
  if (rawLength === 0) {
    return { isAnomaly: false, reason: null };
  }

  if (enhancedLength >= rawLength * ENHANCEMENT_LENGTH_EXPLOSION_RATIO) {
    return { isAnomaly: true, reason: "length-explosion" };
  }

  return { isAnomaly: false, reason: null };
}

// ── 增强后语意 grounding 侦测（#43）──

/** 语意守卫：正规化后 rawText 至少要这么长才判定（过短不可靠、交给 prompt） */
export const SEMANTIC_DRIFT_MIN_RAW_CHARS = 6;
/** 语意守卫门槛：enhanced 的 bigram 落在 raw 内的比例低于此值 → 判定「内容飘走」。
 *  刻意设低（保守）：只挡「明显不相干」，避免把合法的条列化/大幅改写误判成 drift。 */
export const SEMANTIC_DRIFT_MIN_OVERLAP = 0.2;

export interface SemanticDriftResult {
  isDrift: boolean;
  /** enhanced 的 bigram 有多少比例 grounded 在 raw（containment，0~1） */
  overlapRatio: number;
}

/** 正规化：小写化、去除空白与标点，只留字母/数字/CJK 等文字字元。 */
function normalizeForOverlap(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function toBigramSet(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

/**
 * 增强后语意偏移侦测（#43 核心守卫）。
 *
 * 校对/整理的产出理应与原文高度重叠（同样的字词、只是修标点顺句）；
 * 若模型「答非所问」或自由发挥，产出会用完全不同的字词 → bigram 几乎不落在原文内。
 * 用 enhanced→raw 的 bigram containment 当指标：长度差异不惩罚（raw 较长不影响），
 * 只看「产出有多少 grounded 在原文」。门槛刻意保守、只挡明显不相干。
 *
 * 注意：这是「长度爆炸」侦测之外的第二道、独立的守卫；短输入直接豁免。
 */
export function detectSemanticDrift(
  rawText: string,
  enhancedText: string,
): SemanticDriftResult {
  const raw = normalizeForOverlap(rawText);
  const enhanced = normalizeForOverlap(enhancedText);

  // 极短原文不可靠、或 enhanced 为空 → 不在此判定 drift（交给 prompt / 既有守卫）
  if (raw.length < SEMANTIC_DRIFT_MIN_RAW_CHARS || enhanced.length === 0) {
    return { isDrift: false, overlapRatio: 1 };
  }

  const rawBigrams = toBigramSet(raw);
  const enhancedBigrams = toBigramSet(enhanced);
  // 单字元（无 bigram 可比）保护
  if (rawBigrams.size === 0 || enhancedBigrams.size === 0) {
    return { isDrift: false, overlapRatio: 1 };
  }

  let grounded = 0;
  for (const bigram of enhancedBigrams) {
    if (rawBigrams.has(bigram)) grounded += 1;
  }
  const overlapRatio = grounded / enhancedBigrams.size;

  return {
    isDrift: overlapRatio < SEMANTIC_DRIFT_MIN_OVERLAP,
    overlapRatio,
  };
}

// ── 转录幻觉侦测 ──

export function detectHallucination(
  params: HallucinationDetectionParams,
): HallucinationDetectionResult {
  const {
    rawText,
    recordingDurationMs,
    peakEnergyLevel,
    rmsEnergyLevel,
    noSpeechProbability,
  } = params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 语速异常（物理定律级判断）
  if (
    recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS &&
    charCount > SPEED_ANOMALY_MIN_CHARS
  ) {
    return {
      isHallucination: true,
      reason: "speed-anomaly",
      detectedText: trimmedText,
    };
  }

  // Layer 2: 无人声侦测
  // 2a: 完全静音 — 麦克风确认无任何声音（peak < 0.02）
  // 2b: peak 偏低（< 0.03）+ 低 RMS + 高 NSP 联合判断
  //     若 peak >= 0.03 表示有明确可听声音，跳过此检查（escape hatch）
  if (
    peakEnergyLevel < SILENCE_PEAK_ENERGY_THRESHOLD ||
    (peakEnergyLevel < LAYER2B_PEAK_ENERGY_CEILING &&
      rmsEnergyLevel < SILENCE_RMS_THRESHOLD &&
      noSpeechProbability > SILENCE_NSP_THRESHOLD)
  ) {
    return {
      isHallucination: true,
      reason: "no-speech-detected",
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    detectedText: trimmedText,
  };
}
