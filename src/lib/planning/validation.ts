import 'server-only';
import { PlanningApiError } from '@/lib/planning/responses';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertPlanningSessionId(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new PlanningApiError('INVALID_REQUEST', '計画案IDの形式が正しくありません。', 400);
}

export function assertPlanningIdempotencyKey(value: string | null): asserts value is string {
  if (!value) throw new PlanningApiError('INVALID_REQUEST', 'Idempotency-Keyが必要です。', 400);
  if (!UUID_PATTERN.test(value)) throw new PlanningApiError('INVALID_REQUEST', 'Idempotency-Keyの形式が正しくありません。', 400);
}
