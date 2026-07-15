import { authenticatedPlanningClient, createAdvisedPlanningSession } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningSessionId } from '@/lib/planning/validation';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; assertPlanningSessionId(id);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await createAdvisedPlanningSession(client, user.id, id, { signal: request.signal }), 201);
  } catch (error) { return planningError(error); }
}
