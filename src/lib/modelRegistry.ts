// ── LLM（自订 OpenAI-compatible）──────────────────────────

export const DEFAULT_LLM_MODEL_ID = "gpt-4o-mini";

/** 相容旧 store 型别；现在只有自订 endpoint 一种模式。 */
export type LlmProviderId = "custom";
export type LlmModelId = string;

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "custom";

// ── ASR（Doubao SeedASR）──────────────────────────────────

export const DOUBAO_ASR_MODEL_ID = "doubao-seedasr";
export const DOUBAO_ASR_DISPLAY_NAME = "Doubao SeedASR";

// 旧 Whisper 型别保留最小 stub，避免散落引用立刻炸；不再暴露可选模型。
export type WhisperModelId = typeof DOUBAO_ASR_MODEL_ID;
export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = DOUBAO_ASR_MODEL_ID;

export interface LlmModelConfig {
  id: string;
  providerId: LlmProviderId;
  displayName: string;
  badgeKey: string;
  speedTps: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  freeQuotaRpd: number;
  freeQuotaTpd: number;
  isDefault: boolean;
}

export interface WhisperModelConfig {
  id: WhisperModelId;
  displayName: string;
  costPerHour: number;
  freeQuotaRpd: number;
  freeQuotaAudioSecondsPerDay: number;
  isDefault: boolean;
}

export const DECOMMISSIONED_MODEL_MAP: Record<string, string> = {};

export const LLM_MODEL_LIST: LlmModelConfig[] = [
  {
    id: DEFAULT_LLM_MODEL_ID,
    providerId: "custom",
    displayName: DEFAULT_LLM_MODEL_ID,
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 0,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
];

export const WHISPER_MODEL_LIST: WhisperModelConfig[] = [
  {
    id: DOUBAO_ASR_MODEL_ID,
    displayName: DOUBAO_ASR_DISPLAY_NAME,
    costPerHour: 0,
    freeQuotaRpd: 0,
    freeQuotaAudioSecondsPerDay: 0,
    isDefault: true,
  },
];

export function findLlmModelConfig(id: string): LlmModelConfig | undefined {
  return LLM_MODEL_LIST.find((m) => m.id === id) ?? {
    id,
    providerId: "custom",
    displayName: id,
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 0,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  };
}

export function findWhisperModelConfig(
  id: string,
): WhisperModelConfig | undefined {
  return WHISPER_MODEL_LIST.find((m) => m.id === id) ?? WHISPER_MODEL_LIST[0];
}

export function getModelListByProvider(
  _providerId: LlmProviderId,
): LlmModelConfig[] {
  return LLM_MODEL_LIST;
}

export function getDefaultModelIdForProvider(
  _providerId: LlmProviderId,
): LlmModelId {
  return DEFAULT_LLM_MODEL_ID;
}

export function getEffectiveLlmModelId(savedId: string | null): LlmModelId {
  const trimmed = savedId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_LLM_MODEL_ID;
}

export function getEffectiveWhisperModelId(
  _savedId: string | null,
): WhisperModelId {
  return DEFAULT_WHISPER_MODEL_ID;
}
