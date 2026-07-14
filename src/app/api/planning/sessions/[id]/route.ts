import { authenticatedPlanningClient, getPlanningSession } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningSessionId } from '@/lib/planning/validation';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertPlanningSessionId(id);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getPlanningSession(client, user.id, id));
  } catch (error) { return planningError(error); }
}
