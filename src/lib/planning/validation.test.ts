import { describe, expect, it, vi } from 'vitest';
import { assertPlanningBlockId, assertPlanningIdempotencyKey, assertPlanningSessionId, planningActualMinutes, planningBlockUpdatePayload, planningCalendarWriteTarget, planningEstimationRangeDays, planningReviewDate, planningSkipReason } from '@/lib/planning/validation';

const { authenticatedPlanningClient } = vi.hoisted(() => ({ authenticatedPlanningClient: vi.fn() }));
vi.mock('@/lib/planning/server', () => ({
  authenticatedPlanningClient,
  getPlanningSession: vi.fn(),
  approvePlanningSession: vi.fn(),
  rejectPlanningSession: vi.fn(),
  createAdvisedPlanningSession: vi.fn(),
  createPlanningSession: vi.fn(),
  listPlanningSessions: vi.fn(),
  writePlanningSessionToCalendar: vi.fn(),
}));

import { GET } from '@/app/api/planning/sessions/[id]/route';
import { POST as approve } from '@/app/api/planning/sessions/[id]/approve/route';
import { POST as reject } from '@/app/api/planning/sessions/[id]/reject/route';
import { POST as advice } from '@/app/api/planning/sessions/[id]/advice/route';
import { POST as create } from '@/app/api/planning/sessions/route';
import { POST as writeToCalendar } from '@/app/api/planning/sessions/[id]/write-to-calendar/route';

describe('planning session UUID validation', () => {
  it('標準UUIDを受け入れる', () => expect(() => assertPlanningSessionId('11111111-1111-4111-8111-111111111111')).not.toThrow());
  it.each(['short', 'arbitrary-value', "' or 1=1 --", ''])('不正値 %j を安全な400にする', (value) => {
    try { assertPlanningSessionId(value); throw new Error('expected error'); }
    catch (error) { expect(error).toMatchObject({ code: 'INVALID_REQUEST', status: 400, message: '計画案IDの形式が正しくありません。' }); }
  });
  it.each([
    ['GET', GET],
    ['approve', approve],
    ['reject', reject],
    ['advice', advice],
    ['write-to-calendar', writeToCalendar],
  ])('%s routeは不正UUIDをDB・認証へ渡さない', async (_name, handler) => {
    authenticatedPlanningClient.mockClear();
    const response = await handler(new Request('http://localhost/api/planning/sessions/bad'), { params: Promise.resolve({ id: 'bad' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_REQUEST', error: '計画案IDの形式が正しくありません。' });
    expect(authenticatedPlanningClient).not.toHaveBeenCalled();
  });
});

describe('planning Calendar write target validation', () => {
  it('calendarIdだけを受け入れ、title・blockなどの追加入力を拒否する', () => {
    expect(planningCalendarWriteTarget({ calendarId: 'primary' })).toBe('primary');
    for (const value of [{}, { calendarId: '' }, { calendarId: ' primary' }, { calendarId: 'primary', title: 'client-title' }, { calendarId: ['primary'] }]) expect(() => planningCalendarWriteTarget(value)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });
  it('不正bodyは認証・DBより前に拒否する', async () => {
    authenticatedPlanningClient.mockClear();
    const response = await writeToCalendar(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111/write-to-calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendarId: 'primary', title: 'client-title' }) }), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(400); expect(authenticatedPlanningClient).not.toHaveBeenCalled();
  });
});

describe('planning execution validation', () => {
  it('block UUIDとnullまたは0以上の整数だけを受け入れる', () => {
    expect(() => assertPlanningBlockId('44444444-4444-4444-8444-444444444444')).not.toThrow();
    expect(() => assertPlanningBlockId('bad')).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
    expect(planningActualMinutes({ actualMinutes: null })).toBeNull();
    expect(planningActualMinutes({ actualMinutes: 0 })).toBe(0);
    expect(planningActualMinutes({ actualMinutes: 45 })).toBe(45);
    for (const value of [{}, { actualMinutes: -1 }, { actualMinutes: 1.5 }, { actualMinutes: '45' }, { actualMinutes: 45, title: 'client-title' }]) expect(() => planningActualMinutes(value)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });
});

describe('planning block update payload validation', () => {
  it('{start,end}または{taskId}のどちらかだけを受け入れる', () => {
    expect(planningBlockUpdatePayload({ start: '2026-07-15T10:00', end: '2026-07-15T11:00' })).toEqual({ kind: 'time', start: '2026-07-15T10:00', end: '2026-07-15T11:00' });
    expect(planningBlockUpdatePayload({ taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).toEqual({ kind: 'task', taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    for (const value of [{}, { start: '2026-07-15T10:00' }, { start: 'bad', end: '2026-07-15T11:00' }, { taskId: 'not-a-uuid' }, { start: '2026-07-15T10:00', end: '2026-07-15T11:00', taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]) {
      expect(() => planningBlockUpdatePayload(value)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
    }
  });
});

describe('planning skip reason validation', () => {
  it('user_skippedとcarried_overだけを受け入れる', () => {
    expect(planningSkipReason({ reason: 'user_skipped' })).toBe('user_skipped');
    expect(planningSkipReason({ reason: 'carried_over' })).toBe('carried_over');
    for (const value of [{}, { reason: 'other' }, { reason: 'user_skipped', extra: 1 }, { reason: 1 }]) expect(() => planningSkipReason(value)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });
});

describe('planning review query validation', () => {
  it('date未指定はfallbackを返し、YYYY-MM-DD以外は拒否する', () => {
    expect(planningReviewDate(null, '2026-07-15')).toBe('2026-07-15');
    expect(planningReviewDate('2026-07-15', '2026-07-01')).toBe('2026-07-15');
    for (const value of ['2026/07/15', '2026-13-01', 'not-a-date', '']) expect(() => planningReviewDate(value, '2026-07-15')).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });
  it('daysは未指定でfallback、7〜90の整数以外は拒否する', () => {
    expect(planningEstimationRangeDays(null)).toBe(30);
    expect(planningEstimationRangeDays('7')).toBe(7);
    expect(planningEstimationRangeDays('90')).toBe(90);
    for (const value of ['6', '91', '30.5', 'abc']) expect(() => planningEstimationRangeDays(value)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });
});

describe('planning idempotency header validation', () => {
  it('標準UUIDを受け入れ、欠落・不正値を400にする', () => {
    expect(() => assertPlanningIdempotencyKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).not.toThrow();
    for (const value of [null, '', 'not-a-uuid']) expect(() => assertPlanningIdempotencyKey(value)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });
  it.each([[null, 'Idempotency-Keyが必要です。'], ['bad', 'Idempotency-Keyの形式が正しくありません。']])('不正header %jは認証・DBより前に拒否', async (value, message) => {
    authenticatedPlanningClient.mockClear(); const headers = value ? { 'Idempotency-Key': value } : undefined;
    const response = await create(new Request('http://localhost/api/planning/sessions', { method: 'POST', headers }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: 'INVALID_REQUEST', error: message }); expect(authenticatedPlanningClient).not.toHaveBeenCalled();
  });
});
