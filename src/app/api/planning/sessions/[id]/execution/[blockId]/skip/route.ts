import { authenticatedPlanningClient, skipPlanningTimeBlock } from '@/lib/planning/server';
import { PlanningApiError, planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningBlockId, assertPlanningSessionId, planningSkipReason } from '@/lib/planning/validation';

export async function POST(request: Request, context: { params: Promise<{ id: string; blockId: string }> }) {
  try {
    const { id, blockId } = await context.params;
    assertPlanningSessionId(id);
    assertPlanningBlockId(blockId);
    let body: unknown;
    try { body = await request.json(); } catch { throw new PlanningApiError('INVALID_REQUEST', 'リクエストが不正です。', 400); }
    const reason = planningSkipReason(body);
    const { client } = await authenticatedPlanningClient();
    return planningJson(await skipPlanningTimeBlock(client, id, blockId, reason));
  } catch (error) { return planningError(error); }
}
