import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticatedPlanningClient: vi.fn(), getPlanningSession: vi.fn() }));
vi.mock('@/lib/planning/server', () => ({ ...mocks }));

import { GET } from '@/app/api/planning/sessions/[id]/route';

describe('planning route public response', () => {
  it('snapshot・hash・revision・idempotencyを返さない', async () => {
    mocks.authenticatedPlanningClient.mockResolvedValue({ client: {}, user: { id: 'user-a' } });
    mocks.getPlanningSession.mockResolvedValue({ sessionId: '11111111-1111-4111-8111-111111111111', status: 'approved', windowStart: '2026-07-15T00:00:00.000Z', windowEnd: '2026-07-16T00:00:00.000Z', blocks: [], unscheduledTasks: [], unscheduledRoutines: [], warnings: [], engineVersion: 'deterministic-v2', createdAt: '2026-07-15T00:00:00.000Z', approvedAt: '2026-07-15T01:00:00.000Z', rejectedAt: null, advice: null });
    const response = await GET(new Request('http://localhost/api/planning/sessions/11111111-1111-4111-8111-111111111111'), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(JSON.stringify(body)).not.toMatch(/input_snapshot|inputSnapshot|input_hash|inputHash|blocks_revision|idempotency_key/);
  });
});
