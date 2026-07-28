/**
 * 计算 ASR 费用上限。
 * Doubao 计费由火山控制台决定，本地无法准确估算，回传 0。
 */
export function calculateWhisperCostCeiling(
  _audioDurationMs: number,
  _modelId: string,
): number {
  return 0;
}

/**
 * 计算 LLM chat 费用上限。
 * 自订 endpoint 价格未知，回传 0。
 */
export function calculateChatCostCeiling(
  _promptTokens: number,
  _completionTokensOrModelId: number | string,
  _modelId?: string,
): number {
  return 0;
}
