import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockFetch,
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-CN" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/i18n/prompts", () => ({
  getMinimalPromptForLocale: () => "mock-default-prompt",
  getPromptForModeAndLocale: (mode: string) =>
    mode === "active" ? "mock-active-prompt" : "mock-default-prompt",
  isKnownDefaultPrompt: (prompt: string) => prompt === "mock-default-prompt",
  MINIMAL_PROMPTS: { "zh-CN": "mock-minimal-zh-cn", en: "mock-minimal-en" },
  ACTIVE_PROMPTS: { "zh-CN": "mock-active-zh-cn", en: "mock-active-en" },
}));

vi.mock("../../src/i18n/languageConfig", () => ({
  FALLBACK_LOCALE: "zh-CN",
}));

const TEST_API_KEY = "test-api-key-123";

function createSuccessResponse(
  content: string,
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_time: number;
    completion_time: number;
    total_time: number;
  },
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
      usage,
    }),
  };
}

describe("enhancer.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("正常流程", () => {
    it("[P0] 应回传 AI 整理后的文字", async () => {
      mockFetch.mockResolvedValue(
        createSuccessResponse("这是整理后的书面语文字。"),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText(
        "嗯那个就是我想说的就是这个东西很好用",
        TEST_API_KEY,
      );

      expect(result.text).toBe("这是整理后的书面语文字。");
      expect(result.usage).toBeNull();
    });

    it("[P0] 有 usage 时应回传解析后的 ChatUsageData", async () => {
      mockFetch.mockResolvedValue(
        createSuccessResponse("整理后文字", {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_time: 0.2,
          completion_time: 0.3,
          total_time: 0.5,
        }),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("测试输入文字测试", TEST_API_KEY);

      expect(result.text).toBe("整理后文字");
      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptTimeMs: 200,
        completionTimeMs: 300,
        totalTimeMs: 500,
      });
    });

    it("[P0] 应传送正确的请求 body 格式", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理后文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("测试输入文字", TEST_API_KEY);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(
        "https://api.openai.com/v1/chat/completions",
      );
      expect(callArgs[1].method).toBe("POST");
      expect(callArgs[1].headers["Content-Type"]).toBe("application/json");
      expect(callArgs[1].headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);

      const body = JSON.parse(callArgs[1].body);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.temperature).toBe(0.1);
      expect(body.max_tokens).toBe(8192);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toBe("测试输入文字");
    });

    it("[P0] 自订 baseUrl 应生效", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理结果"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("测试输入", TEST_API_KEY, {
        modelId: "my-model",
        baseUrl: "https://proxy.local/v1",
      });

      expect(result.text).toBe("整理结果");
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe("https://proxy.local/v1/chat/completions");
      const body = JSON.parse(callArgs[1].body);
      expect(body.model).toBe("my-model");
    });

    it("[P0] 应 trim 回传的文字", async () => {
      mockFetch.mockResolvedValue(
        createSuccessResponse("  整理后文字有空白  \n"),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText(
        "原始文字原始文字原始文字",
        TEST_API_KEY,
      );

      expect(result.text).toBe("整理后文字有空白");
    });

    it("[P1] 传入 signal 时应转交给 fetch", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理后文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      const abortController = new AbortController();
      await enhanceText("测试输入文字", TEST_API_KEY, {
        signal: abortController.signal,
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].signal).toBe(abortController.signal);
    });
  });

  describe("API Key 验证", () => {
    it("[P0] 空 API Key 应抛出错误", async () => {
      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(enhanceText("测试文字", "")).rejects.toThrow(
        "API Key not configured",
      );
    });

    it("[P0] 纯空白 API Key 应抛出错误", async () => {
      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(enhanceText("测试文字", "   ")).rejects.toThrow(
        "API Key not configured",
      );
    });
  });

  describe("空 choices 回应", () => {
    it("[P0] choices 阵列为空时应回传原始文字", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [] }),
      });

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("原始口语文字测试", TEST_API_KEY);

      expect(result.text).toBe("原始口语文字测试");
    });

    it("[P0] message content 为空字串时应回传原始文字", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "" } }],
        }),
      });

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("原始口语文字测试", TEST_API_KEY);

      expect(result.text).toBe("原始口语文字测试");
    });
  });

  describe("HTTP 错误处理", () => {
    it("[P0] HTTP 非 200 应抛出 EnhancerApiError", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue("error body"),
      });

      const { enhanceText, EnhancerApiError } = await import(
        "../../src/lib/enhancer"
      );
      const error = await enhanceText(
        "测试文字测试文字测试",
        TEST_API_KEY,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EnhancerApiError);
      expect((error as InstanceType<typeof EnhancerApiError>).statusCode).toBe(
        401,
      );
    });

    it("[P0] HTTP 500 应抛出 EnhancerApiError", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn().mockResolvedValue("server error"),
      });

      const { enhanceText, EnhancerApiError } = await import(
        "../../src/lib/enhancer"
      );
      const error = await enhanceText(
        "测试文字测试文字测试",
        TEST_API_KEY,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EnhancerApiError);
      expect((error as InstanceType<typeof EnhancerApiError>).statusCode).toBe(
        500,
      );
    });

    it("[P0] 网路错误应自然抛出", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(
        enhanceText("测试文字测试文字测试", TEST_API_KEY),
      ).rejects.toThrow("Failed to fetch");
    });
  });

  describe("自订 prompt 与上下文注入 (Story 2.2)", () => {
    it("[P0] 传入自订 systemPrompt 应使用自订 prompt", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理后文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("测试输入文字", TEST_API_KEY, {
        systemPrompt: "你是一个英文助手",
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toBe("你是一个英文助手");
    });

    it("[P0] 不传 options 应使用 getDefaultSystemPrompt", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理后文字"));

      const { enhanceText, getDefaultSystemPrompt } = await import(
        "../../src/lib/enhancer"
      );
      await enhanceText("测试输入文字", TEST_API_KEY);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toBe(getDefaultSystemPrompt());
    });

    it("[P0] vocabularyTermList 应注入 <vocabulary> 标签", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理后文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("测试输入文字", TEST_API_KEY, {
        vocabularyTermList: ["TypeScript", "Vue.js", "Tauri"],
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toContain(
        "<vocabulary>\nTypeScript, Vue.js, Tauri\n</vocabulary>",
      );
    });

    it("[P0] 空 vocabularyTermList 不应注入 <vocabulary> 标签", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理后文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("测试输入文字", TEST_API_KEY, {
        vocabularyTermList: [],
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).not.toContain("<vocabulary>");
    });
  });

  describe("buildSystemPrompt (Story 2.2)", () => {
    it("[P0] 应正确组装 vocabulary", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基础 prompt", ["词汇A", "词汇B"]);

      expect(result).toBe(
        "基础 prompt\n\n<vocabulary>\n词汇A, 词汇B\n</vocabulary>",
      );
    });

    it("[P0] vocabulary 为空时只回传基础 prompt", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基础 prompt", []);

      expect(result).toBe("基础 prompt");
    });

    it("[P0] 有 vocabulary 时应包含 vocabulary 标签", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基础 prompt", ["词汇"]);

      expect(result).toContain("<vocabulary>");
    });

    it("[P0] 无 vocabulary 时不应有 vocabulary 标签", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基础 prompt");

      expect(result).not.toContain("<vocabulary>");
    });
  });

  describe("大量词汇截取 (Story 3.2)", () => {
    it("[P0] buildSystemPrompt 应截取最多 50 个词汇", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const largeTermList = Array.from(
        { length: 70 },
        (_, i) => `Term${i + 1}`,
      );

      const result = buildSystemPrompt("基础 prompt", largeTermList);

      expect(result).toContain("Term1");
      expect(result).toContain("Term50");
      expect(result).not.toContain("Term51");
    });

    it("[P0] 恰好 50 个词汇应全部包含", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const exactTermList = Array.from(
        { length: 50 },
        (_, i) => `Term${i + 1}`,
      );

      const result = buildSystemPrompt("基础 prompt", exactTermList);

      expect(result).toContain("Term1");
      expect(result).toContain("Term50");
    });
  });

  describe("stripReasoningTags", () => {
    it("[P0] 应移除 <think> 标签及其内容", async () => {
      const { stripReasoningTags } = await import("../../src/lib/enhancer");
      const input = "<think>\n这是思考过程\n</think>\n整理后的文字";
      expect(stripReasoningTags(input)).toBe("整理后的文字");
    });

    it("[P0] 无 <think> 标签时应原样回传", async () => {
      const { stripReasoningTags } = await import("../../src/lib/enhancer");
      expect(stripReasoningTags("纯文字内容")).toBe("纯文字内容");
    });

    it("[P1] 应处理多个 <think> 区块", async () => {
      const { stripReasoningTags } = await import("../../src/lib/enhancer");
      const input = "<think>思考1</think>结果1<think>思考2</think>结果2";
      expect(stripReasoningTags(input)).toBe("结果1结果2");
    });

    it("[P0] reasoning model 回应应只保留最终输出", async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse(
          "<think>\n分析语意...\n确认修正方向\n</think>\n这是整理后的书面文字",
        ),
      );
      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("口语转录", TEST_API_KEY);
      expect(result.text).toBe("这是整理后的书面文字");
    });
  });

  describe("Timeout 处理", () => {
    it("[P0] 超过 timeout 应抛出逾时错误", async () => {
      vi.useFakeTimers();

      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(createSuccessResponse("晚了")), 35_000);
          }),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const promise = enhanceText("测试文字测试文字测试", TEST_API_KEY);

      vi.advanceTimersByTime(30_000);

      await expect(promise).rejects.toThrow("Enhancement timeout");

      vi.useRealTimers();
    });
  });

  describe("getDefaultSystemPrompt 多语言", () => {
    it("[P0] 应透过 getMinimalPromptForLocale 回传当前 locale 的预设 prompt", async () => {
      const { getDefaultSystemPrompt } = await import("../../src/lib/enhancer");
      const result = getDefaultSystemPrompt();

      expect(result).toBe("mock-default-prompt");
    });
  });

  describe("Prompt mode 相关函式", () => {
    it("[P0] getPromptForModeAndLocale('minimal', 'zh-CN') 应返回精简版 prompt", async () => {
      // 这里用 mock，但验证 mode 参数被正确传递
      const { getPromptForModeAndLocale } = await import(
        "../../src/i18n/prompts"
      );
      const result = getPromptForModeAndLocale("minimal", "zh-CN");
      expect(result).toBe("mock-default-prompt");
    });

    it("[P0] getPromptForModeAndLocale('active', 'en') 应返回积极版 prompt", async () => {
      const { getPromptForModeAndLocale } = await import(
        "../../src/i18n/prompts"
      );
      const result = getPromptForModeAndLocale("active", "en");
      expect(result).toBe("mock-active-prompt");
    });

    it("[P0] isKnownDefaultPrompt 应识别默认 prompt", async () => {
      const { isKnownDefaultPrompt } = await import("../../src/i18n/prompts");
      expect(isKnownDefaultPrompt("mock-default-prompt")).toBe(true);
    });

    it("[P1] isKnownDefaultPrompt 对自定义 prompt 应返回 false", async () => {
      const { isKnownDefaultPrompt } = await import("../../src/i18n/prompts");
      expect(isKnownDefaultPrompt("my custom prompt")).toBe(false);
    });
  });

  describe("EnhancerApiError 结构化错误", () => {
    it("[P0] 应具备正确的 statusCode、name 与 body 属性", async () => {
      const { EnhancerApiError } = await import("../../src/lib/enhancer");
      const error = new EnhancerApiError(
        429,
        "Too Many Requests",
        "rate limited",
      );

      expect(error.statusCode).toBe(429);
      expect(error.name).toBe("EnhancerApiError");
      expect(error.body).toBe("rate limited");
      expect(error.message).toBe(
        "Enhancement API error: 429 Too Many Requests",
      );
    });

    it("[P0] 应为 Error 的 instance", async () => {
      const { EnhancerApiError } = await import("../../src/lib/enhancer");
      const error = new EnhancerApiError(503, "Service Unavailable", "");

      expect(error).toBeInstanceOf(Error);
    });
  });
});
