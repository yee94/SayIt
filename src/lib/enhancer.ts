import { fetch } from "@tauri-apps/plugin-http";
import type { ChatUsageData, EnhanceResult } from "../types/transcription";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_LLM_MAX_TOKENS,
  buildFetchParams,
  parseProviderResponse,
  type LlmChatRequest,
} from "./llmProvider";
import { getMinimalPromptForLocale } from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import i18n from "../i18n";

const MAX_VOCABULARY_TERMS = 50;

export class EnhancerApiError extends Error {
  constructor(
    public statusCode: number,
    statusText: string,
    public body: string,
  ) {
    super(`Enhancement API error: ${statusCode} ${statusText}`);
    this.name = "EnhancerApiError";
  }
}

export function getDefaultSystemPrompt(): string {
  return getMinimalPromptForLocale(i18n.global.locale.value as SupportedLocale);
}

export interface ScreenContextOptions {
  /** PNG base64，无 data: 前缀 */
  imageBase64?: string | null;
  /** 前台应用名 */
  appName?: string | null;
}

export interface EnhanceOptions {
  systemPrompt?: string;
  vocabularyTermList?: string[];
  modelId?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  /** 屏幕上下文（可选）：附带应用名 + 截图给 vision 模型 */
  screenContext?: ScreenContextOptions;
}

export function buildSystemPrompt(
  basePrompt: string,
  vocabularyTermList?: string[],
): string {
  let prompt = basePrompt;

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const truncatedTermList = vocabularyTermList.slice(0, MAX_VOCABULARY_TERMS);
    prompt += `\n\n<vocabulary>\n${truncatedTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}

/**
 * 移除 reasoning model 回应中的 <think>...</think> 区块，
 * 只保留最终输出内容。
 */
export function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function buildUserContent(
  rawText: string,
  screenContext?: ScreenContextOptions,
): LlmChatRequest["messages"][number]["content"] {
  const contextLines: string[] = [];
  if (screenContext?.appName?.trim()) {
    contextLines.push(`前台应用：${screenContext.appName.trim()}`);
  }
  const textBody =
    contextLines.length > 0
      ? `${contextLines.join("\n")}\n\n请结合屏幕上下文整理以下语音转写（只输出整理后的文字）：\n${rawText}`
      : rawText;

  const imageBase64 = screenContext?.imageBase64?.trim();
  if (imageBase64) {
    return [
      { type: "text", text: textBody },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${imageBase64}` },
      },
    ];
  }
  return textBody;
}

export async function enhanceText(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
): Promise<EnhanceResult> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API Key not configured");
  }

  const modelId = options?.modelId ?? DEFAULT_LLM_MODEL_ID;
  const baseUrl = options?.baseUrl ?? DEFAULT_LLM_BASE_URL;

  const basePrompt = options?.systemPrompt || getDefaultSystemPrompt();
  let fullPrompt = buildSystemPrompt(basePrompt, options?.vocabularyTermList);
  if (options?.screenContext?.imageBase64 || options?.screenContext?.appName) {
    fullPrompt +=
      "\n\n用户可能附带屏幕截图或前台应用名作为上下文。请利用可见 UI / 应用场景理解专有名词与意图，但仍只输出整理后的转写文字，不要描述截图。";
  }

  const request: LlmChatRequest = {
    model: modelId,
    messages: [
      { role: "system", content: fullPrompt },
      { role: "user", content: buildUserContent(rawText, options?.screenContext) },
    ],
    temperature: 0.1,
    maxTokens: options?.maxTokens ?? DEFAULT_LLM_MAX_TOKENS,
  };

  const { url, init } = buildFetchParams(request, apiKey, baseUrl);

  // 超时必须 abort 请求：仅 Promise.race 会留下挂起的 fetch，UI 可能一直停在「整理中」
  const timeoutController = new AbortController();
  const externalSignal = options?.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      const timeoutErr = new Error("Enhancement timeout");
      (timeoutErr as Error & { code: string }).code = "ENHANCEMENT_TIMEOUT";
      reject(timeoutErr);
    }, DEFAULT_LLM_TIMEOUT_MS);
  });

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await Promise.race([
      fetch(url, {
        ...init,
        signal: externalSignal ?? timeoutController.signal,
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (timeoutController.signal.aborted) {
      throw err;
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new EnhancerApiError(response.status, response.statusText, errorBody);
  }

  const json = await response.json();
  const result = parseProviderResponse(json);

  const usage: ChatUsageData | null = result.usage
    ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        promptTimeMs: result.usage.promptTimeMs,
        completionTimeMs: result.usage.completionTimeMs,
        totalTimeMs: result.usage.totalTimeMs,
      }
    : null;

  const enhancedContent = stripReasoningTags(result.text);
  // 空回应时 fallback 原文，避免把空白贴进输入框
  return {
    text: enhancedContent || rawText,
    usage,
  };
}
