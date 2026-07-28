import { describe, it, expect } from "vitest";
import {
  detectHallucination,
  detectEnhancementAnomaly,
  SPEED_ANOMALY_MAX_DURATION_MS,
  SPEED_ANOMALY_MIN_CHARS,
  SILENCE_PEAK_ENERGY_THRESHOLD,
  SILENCE_RMS_THRESHOLD,
  SILENCE_NSP_THRESHOLD,
  LAYER2B_PEAK_ENERGY_CEILING,
  ENHANCEMENT_LENGTH_EXPLOSION_RATIO,
  detectSemanticDrift,
  SEMANTIC_DRIFT_MIN_OVERLAP,
} from "../../src/lib/hallucinationDetector";

/** 正常语音的预设参数（Layer 1/2 都不触发） */
const NORMAL_DEFAULTS = {
  rmsEnergyLevel: 0.1,
  noSpeechProbability: 0.1,
};

describe("hallucinationDetector.ts", () => {
  describe("常数值验证", () => {
    it("[P0] 常数应符合设计规格", () => {
      expect(SPEED_ANOMALY_MAX_DURATION_MS).toBe(1000);
      expect(SPEED_ANOMALY_MIN_CHARS).toBe(10);
      expect(SILENCE_PEAK_ENERGY_THRESHOLD).toBe(0.01);
      expect(SILENCE_RMS_THRESHOLD).toBe(0.015);
      expect(SILENCE_NSP_THRESHOLD).toBe(0.7);
      expect(LAYER2B_PEAK_ENERGY_CEILING).toBe(0.03);
    });
  });

  describe("Layer 1: 语速异常侦测", () => {
    it("[P0] 录音 < 1 秒且文字 > 10 字 → 幻觉", () => {
      const result = detectHallucination({
        rawText: "谢谢收看请订阅我的频道感谢大家",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("speed-anomaly");
      expect(result.detectedText).toBe("谢谢收看请订阅我的频道感谢大家");
    });

    it("[P0] 录音恰好 1000ms 不应触发 Layer 1", () => {
      const result = detectHallucination({
        rawText: "谢谢收看请订阅我的频道感谢大家",
        recordingDurationMs: 1000,
        peakEnergyLevel: 0.001,
        ...NORMAL_DEFAULTS,
      });

      // Layer 1 不触发，但 Layer 2 无人声侦测会拦截
      expect(result.reason).not.toBe("speed-anomaly");
    });

    it("[P0] 文字恰好 10 字不应触发 Layer 1", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P1] 带前后空白的文字应 trim 后计算字数", () => {
      const result = detectHallucination({
        rawText: "  谢谢收看请订阅我的频道感谢大家  ",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.detectedText).toBe("谢谢收看请订阅我的频道感谢大家");
    });
  });

  describe("Layer 2: 无人声侦测", () => {
    describe("2a: 静音（peak energy）", () => {
      it("[P0] peakEnergyLevel 低于门槛 → 幻觉", () => {
        const result = detectHallucination({
          rawText: "谢谢收看",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.001,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] peakEnergyLevel 恰好等于门槛 → 放行", () => {
        const result = detectHallucination({
          rawText: "谢谢收看",
          recordingDurationMs: 2000,
          peakEnergyLevel: SILENCE_PEAK_ENERGY_THRESHOLD,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peakEnergyLevel = 0.0（完全静音）→ 拦截", () => {
        const result = detectHallucination({
          rawText: "字幕由Amara社区提供",
          recordingDurationMs: 5000,
          peakEnergyLevel: 0.0,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });
    });

    describe("2b: 低 RMS + 高 NSP 联合判断", () => {
      it("[P0] 低 RMS + 低 NSP → 放行（小声说话不应被误判）", () => {
        const result = detectHallucination({
          rawText: "MING PAO CANADA // MING PAO TORONTO",
          recordingDurationMs: 1388,
          peakEnergyLevel: 0.031,
          rmsEnergyLevel: 0.0066,
          noSpeechProbability: 0.0,
        });

        // RMS 很低但 NSP 也低（Whisper 认为有人说话）→ 放行
        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peak < 0.03 且 rms < 0.015 且 NSP > 0.7 → 幻觉", () => {
        const result = detectHallucination({
          rawText: "MING PAO CANADA // MING PAO TORONTO",
          recordingDurationMs: 3729,
          peakEnergyLevel: 0.025,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] rms < 0.015 但 NSP <= 0.7 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.3,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] rms >= 0.015 但 NSP > 0.7 → 放行（有持续声音）", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.05,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] rms 恰好等于门槛 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.025,
          rmsEnergyLevel: SILENCE_RMS_THRESHOLD,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] NSP 恰好等于门槛 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.025,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: SILENCE_NSP_THRESHOLD,
        });

        expect(result.isHallucination).toBe(false);
      });
    });

    describe("2b: peak energy escape hatch", () => {
      it("[P0] peak >= 0.03 + 低 RMS + 高 NSP → 放行（使用者真实案例）", () => {
        const result = detectHallucination({
          rawText: "我觉得这个方案基本上还不错",
          recordingDurationMs: 5019,
          peakEnergyLevel: 0.0347,
          rmsEnergyLevel: 0.006,
          noSpeechProbability: 0.89,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peak 恰好等于 ceiling (0.03) → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: LAYER2B_PEAK_ENERGY_CEILING,
          rmsEnergyLevel: 0.01,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peak 略低于 ceiling (0.029) → 拦截（仍在 gap zone）", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.029,
          rmsEnergyLevel: 0.01,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P1] peak 高 (0.15) + 低 RMS + 高 NSP → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });
    });

    it("[P0] 实际案例：peak=0.031, rms=0.0066, NSP=0.000 → 放行（NSP 低代表 Whisper 认为有语音）", () => {
      const result = detectHallucination({
        rawText: "MING PAO CANADA // MING PAO TORONTO",
        recordingDurationMs: 1388,
        peakEnergyLevel: 0.031,
        rmsEnergyLevel: 0.0066,
        noSpeechProbability: 0.0,
      });

      // RMS 低但 NSP 也低 → 不符合联合判断条件 → 放行
      expect(result.isHallucination).toBe(false);
    });

    it("[P0] 实际案例：peak=0.031, rms=0.0066, NSP=0.900 → 放行（peak >= 0.03 escape hatch）", () => {
      const result = detectHallucination({
        rawText: "MING PAO CANADA // MING PAO TORONTO",
        recordingDurationMs: 1388,
        peakEnergyLevel: 0.031,
        rmsEnergyLevel: 0.0066,
        noSpeechProbability: 0.9,
      });

      // peak >= 0.03 → escape hatch 跳过 RMS+NSP 检查 → 放行
      expect(result.isHallucination).toBe(false);
    });
  });

  describe("正常放行", () => {
    it("[P0] 有能量的正常语音 → 放行", () => {
      const result = detectHallucination({
        rawText: "这是一段正常的语音转录文字",
        recordingDurationMs: 3000,
        peakEnergyLevel: 0.3,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("[P0] 有能量 + 曾被误判的正常文字 → 放行（不再有字典比对）", () => {
      const result = detectHallucination({
        rawText: "谢谢收看",
        recordingDurationMs: 1500,
        peakEnergyLevel: 0.15,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
    });
  });

  describe("增强后语意偏移侦测 (detectEnhancementAnomaly)", () => {
    it("[P0] 常数应为 2", () => {
      expect(ENHANCEMENT_LENGTH_EXPLOSION_RATIO).toBe(2);
    });

    it("[P0] 正常增强（长度相近）→ 放行", () => {
      const result = detectEnhancementAnomaly({
        rawText: "我觉得这个方案不错",
        enhancedText: "我觉得这个方案不错",
      });
      expect(result.isAnomaly).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("[P0] 长度爆炸（超过 2 倍）→ 拦截", () => {
      const rawText = "怎样才能更有效率";
      const enhancedText =
        "要更有效率地工作，可以：1. 制定清晰目标 2. 优先处理重要事项 3. 减少不必要的会议 4. 使用生产力工具 5. 定期回顾和调整 6. 保持适当的休息 7. 学习委派任务";
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(true);
      expect(result.reason).toBe("length-explosion");
    });

    it("[P0] 恰好 2 倍 → 拦截（>= 触发）", () => {
      const rawText = "abc";
      const enhancedText = "abcabc"; // 恰好 2 倍
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(true);
    });

    it("[P0] 低于 2 倍一个字 → 放行", () => {
      const rawText = "abc";
      const enhancedText = "abcab"; // 5 < 6
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] rawText 为空 → 放行（避免除以零）", () => {
      const result = detectEnhancementAnomaly({
        rawText: "",
        enhancedText: "some text",
      });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] rawText 只有空白 → 放行", () => {
      const result = detectEnhancementAnomaly({
        rawText: "   ",
        enhancedText: "some text",
      });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] enhancedText 为空 → 放行", () => {
      const result = detectEnhancementAnomaly({
        rawText: "一些文字",
        enhancedText: "",
      });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] 前后空白应 trim 后计算", () => {
      const rawText = "  abc  ";
      const enhancedText = "  abcabcabcd  "; // trim 后 10 > 3*3=9
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(true);
    });
  });

  describe("Layer 优先级", () => {
    it("[P0] Layer 1 优先于 Layer 2（即使静音，语速异常优先）", () => {
      const result = detectHallucination({
        rawText: "谢谢收看请订阅我的频道感谢大家",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.001,
        ...NORMAL_DEFAULTS,
      });

      expect(result.reason).toBe("speed-anomaly");
    });

    it("[P0] Layer 2 peak 优先于 Layer 2 rms（都在同一个 if 中）", () => {
      const result = detectHallucination({
        rawText: "谢谢收看",
        recordingDurationMs: 2000,
        peakEnergyLevel: 0.001,
        rmsEnergyLevel: 0.001,
        noSpeechProbability: 0.9,
      });

      // 都返回 "no-speech-detected"，不需要区分子原因
      expect(result.reason).toBe("no-speech-detected");
    });
  });

  describe("detectSemanticDrift（#43 语意守卫）", () => {
    it("[P0] 正常校对（同内容加标点）不应判定 drift", () => {
      const r = detectSemanticDrift(
        "我明天要去公司开会然后下午回家",
        "我明天要去公司开会，然后下午回家。",
      );
      expect(r.isDrift).toBe(false);
      expect(r.overlapRatio).toBeGreaterThan(0.8);
    });

    it("[P0] 去口语赘字的校对不应判定 drift", () => {
      const r = detectSemanticDrift(
        "呃我想说我们明天要不要约个时间开会讨论一下",
        "我想我们明天要约时间开会讨论一下",
      );
      expect(r.isDrift).toBe(false);
    });

    it("[P0] 答非所问／内容不相干应判定 drift", () => {
      const r = detectSemanticDrift(
        "今天天气真好想出去走走晒晒太阳",
        "好的请问有什么可以帮您的吗",
      );
      expect(r.isDrift).toBe(true);
      expect(r.overlapRatio).toBeLessThan(SEMANTIC_DRIFT_MIN_OVERLAP);
    });

    it("[P0] 极短原文（< 6 字）豁免、不判定 drift", () => {
      const r = detectSemanticDrift("现在几点", "现在是下午三点整");
      expect(r.isDrift).toBe(false);
    });

    it("[P1] enhanced 为空不判定 drift", () => {
      expect(detectSemanticDrift("我要去开会讨论专案进度", "").isDrift).toBe(
        false,
      );
    });
  });
});
