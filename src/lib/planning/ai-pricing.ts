import 'server-only';

/**
 * AI Advice利用状況の概算コスト計算用の単価定数。価格改定時はここだけを更新する。
 * 実際の請求額とは一致しない概算であり、ユーザー向け表示でも「概算」と明示すること。
 */
export interface AiAdvicePricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const DEFAULT_PRICING: AiAdvicePricing = { inputPerMillionUsd: 2, outputPerMillionUsd: 8 };

const PRICING_BY_MODEL: Record<string, AiAdvicePricing> = {
  'gpt-5.6-luna': { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
};

export function estimateAiAdviceCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_BY_MODEL[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * pricing.inputPerMillionUsd + (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
}

const DEFAULT_MONTHLY_CALL_LIMIT = 200;

/** `AI_ADVICE_MONTHLY_CALL_LIMIT` が未設定・不正な場合は既定値へフォールバックする。0以下を指定すると上限表示を無効化する。 */
export function aiAdviceMonthlyCallLimit(): number | null {
  const raw = process.env.AI_ADVICE_MONTHLY_CALL_LIMIT?.trim();
  if (!raw) return DEFAULT_MONTHLY_CALL_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_MONTHLY_CALL_LIMIT;
  return value > 0 ? Math.round(value) : null;
}
