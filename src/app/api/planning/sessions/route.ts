import { authenticatedPlanningClient, createPlanningSession, listPlanningSessions } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';

export async function GET() {
  try {
    const { client, user } = await authenticatedPlanningClient();
    return planningJson({ sessions: await listPlanningSessions(client, user.id) });
  } catch (error) { return planningError(error); }
}

export async function POST() {
  try {
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await createPlanningSession(client, user.id), 201);
  } catch (error) { return planningError(error); }
}
