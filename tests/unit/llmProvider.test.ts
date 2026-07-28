import { describe, it, expect } from "vitest";
import {
  buildFetchParams,
  parseProviderResponse,
  DEFAULT_LLM_BASE_URL,
  type LlmChatRequest,
} from "../../src/lib/llmProvider";

const TEST_API_KEY = "test-api-key-123";

const BASE_REQUEST: LlmChatRequest = {
  model: "test-model",
  messages: [
    { role: "system", content: "You are a helper" },
    { role: "user", content: "Hello" },
  ],
  temperature: 0.1,
  maxTokens: 2048,
};

describe("llmProvider.ts (OpenAI-compatible)", () => {
  describe("buildFetchParams", () => {
    it("[P0] 预设 URL + Bearer auth + OpenAI body", () => {
      const { url, init } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        DEFAULT_LLM_BASE_URL,
      );

      expect(url).toBe(DEFAULT_LLM_BASE_URL);
      expect(init.method).toBe("POST");

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("test-model");
      expect(body.messages).toHaveLength(2);
      expect(body.temperature).toBe(0.1);
      expect(body.max_tokens).toBe(2048);
    });

    it("[P0] Base URL 仅到 /v1 时自动补 chat/completions", () => {
      const { url } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        "https://example.com/v1",
      );
      expect(url).toBe("https://example.com/v1/chat/completions");
    });

    it("[P0] 已是 chat/completions 的 URL 不重复拼接", () => {
      const { url } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        "https://proxy.local/v1/chat/completions",
      );
      expect(url).toBe("https://proxy.local/v1/chat/completions");
    });
  });

  describe("parseProviderResponse", () => {
    it("[P0] choices[0].message.content + usage", () => {
      const result = parseProviderResponse({
        choices: [{ message: { content: "  hello  " } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });
      expect(result.text).toBe("hello");
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it("[P1] error body 应抛错", () => {
      expect(() =>
        parseProviderResponse({ error: { message: "boom" } }),
      ).toThrow(/boom/);
    });
  });
});
