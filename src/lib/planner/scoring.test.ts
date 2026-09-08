import { describe, expect, it } from 'vitest';
import { candidateBaseScore, DEFAULT_PLANNING_SCORE_WEIGHTS } from '@/lib/planner/scoring';

describe('candidateBaseScore', () => {
  const now = new Date('2026-07-15T00:00:00.000Z').getTime();
  const windowEnd = now + 7 * 24 * 60 * 60 * 1000;

  it('priorityが高いほどスコアが高い（他条件が同じ場合）', () => {
    const base = { effectiveDeadline: windowEnd, isOverdue: false, now, windowEnd };
    const low = candidateBaseScore({ ...base, priority: 1 });
    const high = candidateBaseScore({ ...base, priority: 5 });
    expect(high).toBeGreaterThan(low);
  });

  it('締切が近いほどスコアが高い（urgency）', () => {
    const base = { priority: 3, isOverdue: false, now, windowEnd };
    const soon = candidateBaseScore({ ...base, effectiveDeadline: now + 60_000 });
    const far = candidateBaseScore({ ...base, effectiveDeadline: windowEnd });
    expect(soon).toBeGreaterThan(far);
  });

  it('overdueは固定加点として作用する', () => {
    const base = { priority: 3, effectiveDeadline: windowEnd, now, windowEnd };
    const overdue = candidateBaseScore({ ...base, isOverdue: true });
    const onTime = candidateBaseScore({ ...base, isOverdue: false });
    expect(overdue - onTime).toBe(DEFAULT_PLANNING_SCORE_WEIGHTS.overdueWeight);
  });

  it('goal_weightは常に0として寄与しない', () => {
    expect(DEFAULT_PLANNING_SCORE_WEIGHTS.goalWeight).toBe(0);
  });
});
