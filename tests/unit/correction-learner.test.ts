import { describe, expect, it } from "vitest";
import {
  editDistance,
  extractCorrections,
  isSafeCorrectionCandidate,
} from "@/lib/correctionLearner";
import {
  canonicalizeTranscription,
  matchCanonicalTerm,
} from "@/lib/termCanonicalizer";

describe("correctionLearner", () => {
  it("editDistance 基本正确", () => {
    expect(editDistance("kit", "sit")).toBe(1);
    expect(editDistance("Vue", "vue")).toBe(1);
  });

  it("过滤句子片段与语气词", () => {
    expect(isSafeCorrectionCandidate("帮我打开")).toBe(false);
    expect(isSafeCorrectionCandidate("的")).toBe(false);
    expect(isSafeCorrectionCandidate("Vue.js")).toBe(true);
  });

  it("英文专有名词修正可学习", () => {
    const terms = extractCorrections(
      "use view js for the app",
      "use Vue.js for the app",
      [],
    );
    expect(terms.some((t) => /vue/i.test(t))).toBe(true);
  });

  it("中文短词局部修正可学习", () => {
    const terms = extractCorrections("AI 课销是什么", "AI 客销是什么", []);
    expect(terms).toContain("客销");
  });

  it("中文单字纠错应学到左侧词对（发线→发现）", () => {
    const terms = extractCorrections("发线一个问题", "发现一个问题", []);
    expect(terms).toContain("发现");
  });

  it("整句重写不学习", () => {
    const terms = extractCorrections(
      "今天天气很好我们出去玩吧",
      "完全不同的另一段文字内容测试",
      [],
    );
    expect(terms).toEqual([]);
  });

  it("已在字典中的词不重复学习", () => {
    const terms = extractCorrections(
      "use view js",
      "use Vue.js",
      ["Vue.js"],
    );
    expect(terms.every((t) => t.toLowerCase() !== "vue.js")).toBe(true);
  });
});

describe("termCanonicalizer", () => {
  it("大小写归一到规范词", () => {
    expect(matchCanonicalTerm("openai", ["OpenAI"])).toBe("OpenAI");
  });

  it("完全一致时不替换", () => {
    expect(matchCanonicalTerm("OpenAI", ["OpenAI"])).toBe(null);
  });

  it("整段转写归一", () => {
    const out = canonicalizeTranscription(
      "i love openai and typescript",
      ["OpenAI", "TypeScript"],
    );
    expect(out).toContain("OpenAI");
    expect(out).toContain("TypeScript");
  });
});
