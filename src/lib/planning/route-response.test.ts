import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticatedPlanningClient: vi.fn(), getPlanningCalendarEventPreview: vi.fn(), getPlanningSession: vi.fn() }));
vi.mock('@/lib/planning/server', () => ({ ...mocks }));

import { GET } from '@/app/api/planning/sessions/[id]/route';
import { GET as GET_CALENDAR_PREVIEW } from '@/app/api/planning/sessions/[id]/calendar-preview/route';

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
});
