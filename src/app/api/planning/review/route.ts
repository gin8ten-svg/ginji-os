import { authenticatedPlanningClient, getPlanningExecutionReview } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';

export async function GET() {
  try {
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getPlanningExecutionReview(client, user.id));
  } catch (error) { return planningError(error); }
}
