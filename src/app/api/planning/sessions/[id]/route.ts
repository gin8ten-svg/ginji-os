import { authenticatedPlanningClient, getPlanningSession } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getPlanningSession(client, user.id, id));
  } catch (error) { return planningError(error); }
}
