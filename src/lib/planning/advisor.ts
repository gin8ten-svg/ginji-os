import type { PlanningAdvice, PlanningAdviceInput, PlanningAdvisor } from '@/types/planning-session';

export function sanitizeAdvice(input: PlanningAdviceInput, advice: PlanningAdvice): PlanningAdvice {
  const allowed = new Set([...input.taskIds, ...input.routineIds]);
  const orderedSourceIds = [...new Set(advice.orderedSourceIds)].filter((id) => allowed.has(id));
  const explanationBySourceId = Object.fromEntries(Object.entries(advice.explanationBySourceId).filter(([id]) => allowed.has(id)));
  return { ...advice, orderedSourceIds, explanationBySourceId };
}

export class DeterministicPlanningAdvisor implements PlanningAdvisor {
  async advise(input: PlanningAdviceInput): Promise<PlanningAdvice> {
    return { orderedSourceIds: input.currentDeterministicOrdering.filter((id) => input.taskIds.includes(id) || input.routineIds.includes(id)), explanationBySourceId: {}, globalSummary: '決定論的Planning Engineの順序を維持します。', warnings: [] };
  }
}
