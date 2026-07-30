import { fetch } from "@tauri-apps/plugin-http";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";
import {
  buildFetchParams,
  parseProviderResponse,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_LLM_BASE_URL,
  type LlmChatRequest,
  type LlmExtraBody,
  type LlmUsageData,
} from "./llmProvider";

const SYSTEM_PROMPT = `你是语音转录字典助手。
比较 <original> 和 <corrected>，找出语音辨识写错、使用者改正的词汇。
注意：<corrected> 可能包含多余文字（如重复行或额外内容），请只关注与 <original> 对应的部分。

【回传条件 — 替换后的词必须是】
✅ 专有名词（人名、地名、品牌、公司名、产品名）
✅ 技术术语（框架、程式语言、工具、协定、API）
✅ 特定领域用语（行业术语、学术用语）

【排除】
❌ 一般常用词汇（今天、因为、the、good）
❌ 标点、空格、语序、语气词的差异
❌ 使用者新增的补充内容（原文没有对应位置）
❌ 单一中文字（至少 2 字）

【范例】
original: "我的名字是陈太诚" → corrected: "我的名字是陈泰呈" → ["陈泰呈"]
original: "用view js写的" → corrected: "用Vue.js写的" → ["Vue.js"]
original: "今天天气很好" → corrected: "今天天气不错" → []

回传格式：JSON array，没有符合的就回 []。只要 JSON，不要解释。`;

export interface ApiUsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs?: number;
}

export interface VocabularyAnalysisResult {
  suggestedTermList: string[];
  usage: ApiUsageInfo | null;
  rawResponse: string;
}

const MIN_CHINESE_CHAR_COUNT = 2;
const MIN_ENGLISH_CHAR_COUNT = 2;

function isTermTooShort(term: string): boolean {
  const trimmed = term.trim();
  // 判断是否为中文为主的词
  const chineseCharCount = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (chineseCharCount > 0) {
    return chineseCharCount < MIN_CHINESE_CHAR_COUNT;
  }
  // 英文/其他
  return trimmed.length < MIN_ENGLISH_CHAR_COUNT;
}

function isValidSuggestedTerm(item: unknown): item is string {
  return (
    typeof item === "string" && item.trim().length > 0 && !isTermTooShort(item)
  );
}

function parseSuggestedTermList(content: string): string[] {
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidSuggestedTerm);
    }
  } catch {
    // AI 回传非 JSON，尝试从回传中提取 JSON array
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter(isValidSuggestedTerm);
        }
      } catch {
        // 真的解析失败，回传空阵列
      }
    }
  }
  return [];
}

function convertUsage(usage: LlmUsageData | null): ApiUsageInfo | null {
  if (!usage) return null;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptTimeMs: usage.promptTimeMs,
    completionTimeMs: usage.completionTimeMs,
    totalTimeMs: usage.totalTimeMs,
  };
}

export async function analyzeCorrections(
  pastedText: string,
  fieldText: string,
  apiKey: string,
  options?: {
    modelId?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    extraBody?: LlmExtraBody;
  },
): Promise<VocabularyAnalysisResult> {
  const modelId = options?.modelId ?? DEFAULT_LLM_MODEL_ID;
  const baseUrl = options?.baseUrl ?? DEFAULT_LLM_BASE_URL;

  const request: LlmChatRequest = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `<original>${pastedText}</original>\n<corrected>${fieldText}</corrected>`,
      },
    ],
    temperature: 0,
    maxTokens: 256,
  };

  const { url, init } = buildFetchParams(
    request,
    apiKey,
    baseUrl,
    options?.headers,
    options?.extraBody,
  );

  const timeoutMs = DEFAULT_LLM_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Vocabulary analysis API error: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  const json = await response.json();
  const result = parseProviderResponse(json);
  const usage = convertUsage(result.usage);

  if (!result.text) {
    return { suggestedTermList: [], usage, rawResponse: "" };
  }

  const suggestedTermList = parseSuggestedTermList(result.text);
  return { suggestedTermList, usage, rawResponse: result.text };
}
