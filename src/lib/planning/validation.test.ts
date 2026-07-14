import { describe, expect, it, vi } from 'vitest';
import { assertPlanningSessionId } from '@/lib/planning/validation';

const { authenticatedPlanningClient } = vi.hoisted(() => ({ authenticatedPlanningClient: vi.fn() }));
vi.mock('@/lib/planning/server', () => ({
  authenticatedPlanningClient,
  getPlanningSession: vi.fn(),
  approvePlanningSession: vi.fn(),
  rejectPlanningSession: vi.fn(),
}));

import { GET } from '@/app/api/planning/sessions/[id]/route';
import { POST as approve } from '@/app/api/planning/sessions/[id]/approve/route';
import { POST as reject } from '@/app/api/planning/sessions/[id]/reject/route';

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
  ])('%s routeは不正UUIDをDB・認証へ渡さない', async (_name, handler) => {
    authenticatedPlanningClient.mockClear();
    const response = await handler(new Request('http://localhost/api/planning/sessions/bad'), { params: Promise.resolve({ id: 'bad' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_REQUEST', error: '計画案IDの形式が正しくありません。' });
    expect(authenticatedPlanningClient).not.toHaveBeenCalled();
  });
});
