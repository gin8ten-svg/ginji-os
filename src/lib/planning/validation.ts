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

export function planningCalendarWriteTarget(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('calendarId' in value)) throw new PlanningApiError('INVALID_REQUEST', '追加先Calendarを指定してください。', 400);
  const calendarId = value.calendarId;
  if (typeof calendarId !== 'string' || calendarId.length < 1 || calendarId.length > 512 || calendarId.trim() !== calendarId || /[\u0000-\u001F\u007F-\u009F]/.test(calendarId)) throw new PlanningApiError('INVALID_REQUEST', '追加先Calendarが不正です。', 400);
  return calendarId;
}
