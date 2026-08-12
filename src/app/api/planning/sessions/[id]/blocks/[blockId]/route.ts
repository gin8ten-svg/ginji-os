import { authenticatedPlanningClient, deletePlanningBlock, updatePlanningBlockTask, updatePlanningBlockTime } from '@/lib/planning/server';
import { PlanningApiError, planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningBlockId, assertPlanningSessionId, planningBlockUpdatePayload } from '@/lib/planning/validation';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; blockId: string }> }) {
  try {
    const { id, blockId } = await context.params;
    assertPlanningSessionId(id);
    assertPlanningBlockId(blockId);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await deletePlanningBlock(client, user.id, id, blockId));
  } catch (error) { return planningError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; blockId: string }> }) {
  try {
    const { id, blockId } = await context.params;
    assertPlanningSessionId(id);
    assertPlanningBlockId(blockId);
    let body: unknown;
    try { body = await request.json(); } catch { throw new PlanningApiError('INVALID_REQUEST', 'リクエストが不正です。', 400); }
    const payload = planningBlockUpdatePayload(body);
    const { client, user } = await authenticatedPlanningClient();
    const result = payload.kind === 'time'
      ? await updatePlanningBlockTime(client, user.id, id, blockId, payload.start, payload.end)
      : await updatePlanningBlockTask(client, user.id, id, blockId, payload.taskId);
    return planningJson(result);
  } catch (error) { return planningError(error); }
}
