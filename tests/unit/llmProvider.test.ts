import { describe, it, expect } from "vitest";
import {
  buildFetchParams,
  normalizeChatCompletionsUrl,
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

    it("[P0] 应合并自定义 Header", () => {
      const { init } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        DEFAULT_LLM_BASE_URL,
        {
          "HTTP-Referer": "https://example.com",
          "X-Title": "SayIt",
        },
      );
      const headers = init.headers as Record<string, string>;
      expect(headers["HTTP-Referer"]).toBe("https://example.com");
      expect(headers["X-Title"]).toBe("SayIt");
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("[P0] 应合并额外请求体字段，并保持应用管理字段", () => {
      const { init } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        DEFAULT_LLM_BASE_URL,
        undefined,
        {
          model: "override-attempt",
          chat_template_kwargs: { enable_thinking: false },
        },
      );
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("test-model");
      expect(body.messages).toEqual(BASE_REQUEST.messages);
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it("[P0] 应用 Authorization / Content-Type 应覆盖同名自定义 Header", () => {
      const { init } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        DEFAULT_LLM_BASE_URL,
        {
          Authorization: "Bearer attacker",
          "Content-Type": "text/plain",
          "X-Custom": "keep",
        },
      );
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Custom"]).toBe("keep");
    });

    it("[P1] 无自定义 Header 时行为与原先一致", () => {
      const { init } = buildFetchParams(
        BASE_REQUEST,
        TEST_API_KEY,
        DEFAULT_LLM_BASE_URL,
      );
      const headers = init.headers as Record<string, string>;
      expect(headers).toEqual({
        Authorization: `Bearer ${TEST_API_KEY}`,
        "Content-Type": "application/json",
      });
    });

    it("[P0] extra_headers + /v1 base 应等价 OpenAI SDK", () => {
      // 对齐 OpenAI(base_url=.../v1).chat.completions.create(..., extra_headers=...)
      const { url, init } = buildFetchParams(
        { ...BASE_REQUEST, model: "qwen3d6_27b" },
        "test",
        "https://proxy.example.com/v1",
        {
          "X-Client-Id": "client-example",
          "X-Request-Source": "desktop-app",
        },
      );
      expect(url).toBe(
        "https://proxy.example.com/v1/chat/completions",
      );
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Client-Id"]).toBe("client-example");
      expect(headers["X-Request-Source"]).toBe("desktop-app");
    });

    it("[P0] 误拼 /chat/complgetions 或重复拼接应纠正", () => {
      expect(
        normalizeChatCompletionsUrl(
          "https://proxy.example.com/v1/chat/complgetions",
        ),
      ).toBe(
        "https://proxy.example.com/v1/chat/completions",
      );
      expect(
        normalizeChatCompletionsUrl(
          "https://host/v1/chat/completions/chat/completions",
        ),
      ).toBe("https://host/v1/chat/completions");
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
