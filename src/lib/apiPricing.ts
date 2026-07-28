/**
 * 計算 ASR 費用上限。
 * Doubao 計費由火山控制台決定，本地無法準確估算，回傳 0。
 */
export function calculateWhisperCostCeiling(
  _audioDurationMs: number,
  _modelId: string,
): number {
  return 0;
}

/**
 * 計算 LLM chat 費用上限。
 * 自訂 endpoint 價格未知，回傳 0。
 */
export function calculateChatCostCeiling(
  _promptTokens: number,
  _completionTokensOrModelId: number | string,
  _modelId?: string,
): number {
  return 0;
}
