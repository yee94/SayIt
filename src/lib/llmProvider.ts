// ── Custom OpenAI-compatible LLM ──────────────────────────

export const DEFAULT_LLM_BASE_URL =
  "https://api.openai.com/v1/chat/completions";
export const DEFAULT_LLM_MODEL_ID = "gpt-4o-mini";
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;
export const DEFAULT_LLM_MAX_TOKENS = 8192;

// ── 统一型别 ──────────────────────────────────────────────

/** OpenAI 兼容多模态 content part（文字 / 图片） */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  /** 纯文字，或 vision 模型用的 content parts */
  content: string | LlmContentPart[];
}

export interface LlmChatRequest {
  model: string;
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs?: number;
}

export interface LlmChatResult {
  text: string;
  usage: LlmUsageData | null;
}

// ── OpenAI-compatible fetch ───────────────────────────────

function normalizeChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_LLM_BASE_URL;
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

export function buildFetchParams(
  request: LlmChatRequest,
  apiKey: string,
  baseUrl: string,
): { url: string; init: RequestInit } {
  const url = normalizeChatCompletionsUrl(baseUrl);
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
  };
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    body.max_tokens = request.maxTokens;
  }

  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

// ── Response 解析 ─────────────────────────────────────────

interface OpenAiCompatibleResponse {
  choices?: { message: { content: string } }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_time?: number;
    completion_time?: number;
    total_time?: number;
  };
  error?: { message?: string } | string;
  type?: string;
}

export function parseProviderResponse(json: unknown): LlmChatResult {
  const data = json as OpenAiCompatibleResponse;
  if (data?.error || data?.type === "error") {
    const errMsg =
      typeof data.error === "object" && data.error !== null
        ? data.error.message ?? "Unknown error"
        : data.error ?? "Unknown error";
    throw new Error(`LLM API error: ${errMsg}`);
  }

  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  let usage: LlmUsageData | null = null;

  if (data.usage) {
    usage = {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };
    if (data.usage.prompt_time !== undefined) {
      usage.promptTimeMs = Math.round(data.usage.prompt_time * 1000);
      usage.completionTimeMs = Math.round(
        (data.usage.completion_time ?? 0) * 1000,
      );
      usage.totalTimeMs = Math.round((data.usage.total_time ?? 0) * 1000);
    }
  }

  return { text, usage };
}
