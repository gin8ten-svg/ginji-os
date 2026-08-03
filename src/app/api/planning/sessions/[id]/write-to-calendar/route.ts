import { authenticatedPlanningClient, writePlanningSessionToCalendar } from '@/lib/planning/server';
import { PlanningApiError, planningError, planningJson } from '@/lib/planning/responses';
import { assertPlanningSessionId, planningCalendarWriteTarget } from '@/lib/planning/validation';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertPlanningSessionId(id);
    let body: unknown;
    try { body = await request.json(); } catch { throw new PlanningApiError('INVALID_REQUEST', 'リクエストが不正です。', 400); }
    const calendarId = planningCalendarWriteTarget(body);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await writePlanningSessionToCalendar(client, user.id, id, calendarId));
  } catch (error) { return planningError(error); }
}
