import { authenticatedPlanningClient, regeneratePlanningSession } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningIdempotencyKey, assertPlanningSessionId } from '@/lib/planning/validation';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertPlanningSessionId(id);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    assertPlanningIdempotencyKey(idempotencyKey);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await regeneratePlanningSession(client, user.id, id, idempotencyKey), 201);
  } catch (error) { return planningError(error); }
}
