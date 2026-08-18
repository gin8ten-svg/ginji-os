import { authenticatedPlanningClient, getAiAdviceUsageSummary } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';

export async function GET() {
  try {
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getAiAdviceUsageSummary(client, user.id));
  } catch (error) { return planningError(error); }
}
