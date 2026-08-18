import 'server-only';
import { PlanningApiError } from '@/lib/planning/responses';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertPlanningSessionId(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new PlanningApiError('INVALID_REQUEST', '計画案IDの形式が正しくありません。', 400);
}

export function assertPlanningBlockId(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new PlanningApiError('INVALID_REQUEST', '計画block IDの形式が正しくありません。', 400);
}

export function planningActualMinutes(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('actualMinutes' in value)) {
    throw new PlanningApiError('INVALID_REQUEST', '実績時間を指定してください。', 400);
  }
  const actualMinutes = value.actualMinutes;
  if (actualMinutes === null) return null;
  if (typeof actualMinutes !== 'number' || !Number.isInteger(actualMinutes) || actualMinutes < 0 || actualMinutes > 2_147_483_647) {
    throw new PlanningApiError('INVALID_REQUEST', '実績時間は0以上の整数で入力してください。', 400);
  }
  return actualMinutes;
}

export type PlanningBlockUpdatePayload = { kind: 'time'; start: string; end: string } | { kind: 'task'; taskId: string };

export function planningBlockUpdatePayload(value: unknown): PlanningBlockUpdatePayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlanningApiError('INVALID_REQUEST', '更新内容を指定してください。', 400);
  }
  const keys = Object.keys(value);
  if (keys.length === 2 && 'start' in value && 'end' in value) {
    const { start, end } = value as { start: unknown; end: unknown };
    if (typeof start !== 'string' || typeof end !== 'string' || Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
      throw new PlanningApiError('INVALID_REQUEST', '開始・終了時刻の形式が正しくありません。', 400);
    }
    return { kind: 'time', start, end };
  }
  if (keys.length === 1 && 'taskId' in value) {
    const taskId = (value as { taskId: unknown }).taskId;
    if (typeof taskId !== 'string' || !UUID_PATTERN.test(taskId)) {
      throw new PlanningApiError('INVALID_REQUEST', '差し替え先タスクIDの形式が正しくありません。', 400);
    }
    return { kind: 'task', taskId };
  }
  throw new PlanningApiError('INVALID_REQUEST', '更新内容が不正です。{start,end} または {taskId} を指定してください。', 400);
}

export function planningSkipReason(value: unknown): 'user_skipped' | 'carried_over' {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('reason' in value)) {
    throw new PlanningApiError('INVALID_REQUEST', 'スキップ理由を指定してください。', 400);
  }
  const reason = value.reason;
  if (reason !== 'user_skipped' && reason !== 'carried_over') {
    throw new PlanningApiError('INVALID_REQUEST', 'スキップ理由が不正です。', 400);
  }
  return reason;
}

export function assertPlanningIdempotencyKey(value: string | null): asserts value is string {
  if (!value) throw new PlanningApiError('INVALID_REQUEST', 'Idempotency-Keyが必要です。', 400);
  if (!UUID_PATTERN.test(value)) throw new PlanningApiError('INVALID_REQUEST', 'Idempotency-Keyの形式が正しくありません。', 400);
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function planningReviewDate(value: string | null, fallback: string): string {
  if (value === null) return fallback;
  if (!DATE_KEY_PATTERN.test(value) || Number.isNaN(new Date(`${value}T00:00:00+09:00`).getTime())) {
    throw new PlanningApiError('INVALID_REQUEST', '日付の形式が正しくありません。', 400);
  }
  return value;
}

export function planningEstimationRangeDays(value: string | null, fallback = 30): number {
  if (value === null) return fallback;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 7 || days > 90) {
    throw new PlanningApiError('INVALID_REQUEST', '集計期間は7〜90日の整数で指定してください。', 400);
  }
  return days;
}

export function planningCalendarWriteTarget(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('calendarId' in value)) throw new PlanningApiError('INVALID_REQUEST', '追加先Calendarを指定してください。', 400);
  const calendarId = value.calendarId;
  if (typeof calendarId !== 'string' || calendarId.length < 1 || calendarId.length > 512 || calendarId.trim() !== calendarId || /[\u0000-\u001F\u007F-\u009F]/.test(calendarId)) throw new PlanningApiError('INVALID_REQUEST', '追加先Calendarが不正です。', 400);
  return calendarId;
}
