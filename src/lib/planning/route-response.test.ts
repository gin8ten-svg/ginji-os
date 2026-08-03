import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticatedPlanningClient: vi.fn(), getPlanningCalendarEventPreview: vi.fn(), getPlanningSession: vi.fn(), getPlanningSessionCalendarEventManagementPreview: vi.fn(), mutatePlanningSessionCalendarEvents: vi.fn(), writePlanningSessionToCalendar: vi.fn() }));
vi.mock('@/lib/planning/server', () => ({ ...mocks }));

import { GET } from '@/app/api/planning/sessions/[id]/route';
import { GET as GET_CALENDAR_PREVIEW } from '@/app/api/planning/sessions/[id]/calendar-preview/route';
import { DELETE as DELETE_FROM_CALENDAR, GET as GET_CALENDAR_MANAGEMENT, PATCH as UPDATE_CALENDAR, POST as WRITE_TO_CALENDAR } from '@/app/api/planning/sessions/[id]/write-to-calendar/route';

describe('planning route public response', () => {
  it('snapshot・hash・revision・idempotencyを返さない', async () => {
    mocks.authenticatedPlanningClient.mockResolvedValue({ client: {}, user: { id: 'user-a' } });
    mocks.getPlanningSession.mockResolvedValue({ sessionId: '11111111-1111-4111-8111-111111111111', status: 'approved', windowStart: '2026-07-15T00:00:00.000Z', windowEnd: '2026-07-16T00:00:00.000Z', blocks: [], unscheduledTasks: [], unscheduledRoutines: [], warnings: [], engineVersion: 'deterministic-v2', createdAt: '2026-07-15T00:00:00.000Z', approvedAt: '2026-07-15T01:00:00.000Z', rejectedAt: null, advice: null });
    const response = await GET(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111'), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(JSON.stringify(body)).not.toMatch(/input_snapshot|inputSnapshot|input_hash|inputHash|blocks_revision|idempotency_key/);
  });
  it('Calendar Previewもprivate no-storeで内部検証値を返さない', async () => {
    mocks.authenticatedPlanningClient.mockResolvedValue({ client: {}, user: { id: 'user-a' } });
    mocks.getPlanningCalendarEventPreview.mockResolvedValue({ sessionId: '11111111-1111-4111-8111-111111111111', status: 'approved', windowStart: '2026-07-15T00:00:00.000Z', windowEnd: '2026-07-16T00:00:00.000Z', timeZone: 'Asia/Tokyo', events: [{ sourceType: 'task', sourceId: 'task-a', title: 'Snapshot title', start: '2026-07-15T01:00:00.000Z', end: '2026-07-15T02:00:00.000Z', blockIndex: 1, durationMinutes: 60 }] });
    const response = await GET_CALENDAR_PREVIEW(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111/calendar-preview'), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(body.events[0].title).toBe('Snapshot title'); expect(JSON.stringify(body)).not.toMatch(/input_snapshot|inputSnapshot|input_hash|inputHash|blocks_revision|user_id/);
  });
  it('Calendar write結果もprivate no-storeで内部検証値やTokenを返さない', async () => {
    mocks.authenticatedPlanningClient.mockResolvedValue({ client: {}, user: { id: 'user-a' } });
    mocks.writePlanningSessionToCalendar.mockResolvedValue({ sessionId: '11111111-1111-4111-8111-111111111111', calendarId: 'primary', status: 'completed', createdCount: 1, alreadyCreatedCount: 0, failedCount: 0, inProgressCount: 0, notAttemptedCount: 0, needsReconnect: false, events: [{ sourceType: 'task', sourceId: 'task-a', title: 'Snapshot title', start: '2026-07-15T01:00:00.000Z', end: '2026-07-15T02:00:00.000Z', blockIndex: 1, durationMinutes: 60, writeStatus: 'created', errorCode: null }] });
    const response = await WRITE_TO_CALENDAR(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111/write-to-calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendarId: 'primary' }) }), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(mocks.writePlanningSessionToCalendar).toHaveBeenCalledWith({}, 'user-a', '11111111-1111-4111-8111-111111111111', 'primary');
    const body = await response.json(); expect(JSON.stringify(body)).not.toMatch(/input_snapshot|input_hash|blocks_revision|access.?token|refresh.?token/i);
  });
  it.each([['PATCH', UPDATE_CALENDAR, 'update'], ['DELETE', DELETE_FROM_CALENDAR, 'delete']] as const)('%sはbody値を使わずserver管理対象だけを操作', async (method, handler, operation) => {
    mocks.authenticatedPlanningClient.mockResolvedValue({ client: {}, user: { id: 'user-a' } });
    mocks.mutatePlanningSessionCalendarEvents.mockResolvedValue({ sessionId: '11111111-1111-4111-8111-111111111111', calendarId: 'primary', operation, status: 'completed', changedCount: 1, unchangedCount: 0, failedCount: 0, inProgressCount: 0, notAttemptedCount: 0, needsReconnect: false, events: [] });
    const response = await handler(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111/write-to-calendar', { method, body: JSON.stringify({ title: 'ignored', googleEventId: 'ignored' }) }), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.mutatePlanningSessionCalendarEvents).toHaveBeenCalledWith({}, 'user-a', '11111111-1111-4111-8111-111111111111', operation);
  });
  it('管理Previewはstale時の削除導線用にprivate no-storeでcanonical表示だけを返す', async () => {
    mocks.authenticatedPlanningClient.mockResolvedValue({ client: {}, user: { id: 'user-a' } });
    mocks.getPlanningSessionCalendarEventManagementPreview.mockResolvedValue({ sessionId: '11111111-1111-4111-8111-111111111111', status: 'approved', timeZone: 'Asia/Tokyo', calendarId: 'primary', events: [{ sourceType: 'task', sourceId: 'task-a', title: 'Snapshot title', start: '2026-07-15T01:00:00.000Z', end: '2026-07-15T02:00:00.000Z', blockIndex: 1, durationMinutes: 60, calendarState: 'active' }] });
    const response = await GET_CALENDAR_MANAGEMENT(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111/write-to-calendar'), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(JSON.stringify(await response.json())).not.toMatch(/google_event_id|input_hash|blocks_revision|token/i);
  });
});
