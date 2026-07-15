import { authenticatedPlanningClient, createPlanningSession, listPlanningSessions } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningIdempotencyKey } from '@/lib/planning/validation';

export async function GET() {
  try {
    const { client, user } = await authenticatedPlanningClient();
    return planningJson({ sessions: await listPlanningSessions(client, user.id) });
  } catch (error) { return planningError(error); }
}

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    assertPlanningIdempotencyKey(idempotencyKey);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await createPlanningSession(client, user.id, idempotencyKey), 201);
  } catch (error) { return planningError(error); }
}
