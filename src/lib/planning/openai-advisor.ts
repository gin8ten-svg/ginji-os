import 'server-only';
import OpenAI from 'openai';
import { PlanningApiError } from '@/lib/planning/responses';
import type { PlanningAdvice, PlanningAdviceInput, PlanningAdvisor } from '@/types/planning-session';

export const DEFAULT_OPENAI_PLANNING_MODEL = 'gpt-5.6-luna';

export function planningAdviceSchema(input: PlanningAdviceInput) {
  const explanationProperties = Object.fromEntries(input.candidates.map((item) => [item.alias, { type: 'string', maxLength: 200 }]));
  return { type: 'object', additionalProperties: false, properties: { orderedSourceIds: { type: 'array', maxItems: 100, items: { type: 'string' } }, explanationBySourceId: { type: 'object', additionalProperties: false, properties: explanationProperties, required: Object.keys(explanationProperties) }, globalSummary: { type: 'string', maxLength: 500 }, warnings: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 } } }, required: ['orderedSourceIds', 'explanationBySourceId', 'globalSummary', 'warnings'] } as const;
}

const cancelledError = () => new PlanningApiError('AI_REQUEST_CANCELLED', 'AI相談をキャンセルしました。', 499);
const invalidResponseError = () => new PlanningApiError('AI_INVALID_RESPONSE', 'AIから有効な改善案を取得できませんでした。', 502);

function providerError(error: unknown, signal?: AbortSignal): PlanningApiError {
  const candidate = error as { status?: number; name?: string };
  if (signal?.aborted || candidate.name === 'AbortError' || candidate.name === 'APIUserAbortError') return cancelledError();
  if (candidate.status === 429) return new PlanningApiError('AI_RATE_LIMITED', 'AIの利用が集中しています。しばらく待ってから再試行してください。', 429);
  if (candidate.name === 'APIConnectionTimeoutError') return new PlanningApiError('AI_TIMEOUT', 'AIから時間内に応答がありませんでした。', 504);
  return new PlanningApiError('AI_PROVIDER_ERROR', 'AIの改善案を取得できませんでした。現在の計画案はそのまま利用できます。', 502);
}

export class OpenAIPlanningAdvisor implements PlanningAdvisor {
  readonly model: string;
  private readonly client: OpenAI;
  constructor(options: { apiKey?: string; model?: string; client?: OpenAI } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new PlanningApiError('AI_NOT_CONFIGURED', 'AI Planning Adviceはまだ設定されていません。', 503);
    this.model = options.model ?? (process.env.OPENAI_PLANNING_MODEL?.trim() || DEFAULT_OPENAI_PLANNING_MODEL);
    this.client = options.client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: 15_000 });
  }
  async advise(input: PlanningAdviceInput, signal?: AbortSignal): Promise<PlanningAdvice> {
    if (signal?.aborted) throw cancelledError();
    try {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: 'You advise ordering only. Use aliases exactly as supplied. Never propose times, dates, external actions, or new entities. Return concise plain text in the required schema.',
        input: JSON.stringify(input),
        text: { format: { type: 'json_schema', name: 'planning_advice', strict: true, schema: planningAdviceSchema(input) } },
        reasoning: { effort: 'none' }, max_output_tokens: 1_200, background: false, store: false,
      }, { signal });
      if (response.status !== 'completed') throw invalidResponseError();
      const refused = response.output.some((item) => item.type === 'message' && item.content.some((content) => content.type === 'refusal'));
      if (refused || !response.output_text) throw invalidResponseError();
      try { return JSON.parse(response.output_text) as PlanningAdvice; }
      catch { throw invalidResponseError(); }
    } catch (error) { if (error instanceof PlanningApiError) throw error; throw providerError(error, signal); }
  }
}
