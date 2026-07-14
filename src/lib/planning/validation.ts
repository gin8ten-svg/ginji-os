import 'server-only';
import { PlanningApiError } from '@/lib/planning/responses';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertPlanningSessionId(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new PlanningApiError('INVALID_REQUEST', '計画案IDの形式が正しくありません。', 400);
}
