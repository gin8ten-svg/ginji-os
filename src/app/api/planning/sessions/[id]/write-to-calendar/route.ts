import { authenticatedPlanningClient, getPlanningSessionCalendarEventManagementPreview, mutatePlanningSessionCalendarEvents, writePlanningSessionToCalendar } from '@/lib/planning/server';
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertPlanningSessionId(id);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getPlanningSessionCalendarEventManagementPreview(client, user.id, id));
  } catch (error) { return planningError(error); }
}

async function mutate(context: { params: Promise<{ id: string }> }, operation: 'update' | 'delete') {
  try {
    const { id } = await context.params;
    assertPlanningSessionId(id);
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await mutatePlanningSessionCalendarEvents(client, user.id, id, operation));
  } catch (error) { return planningError(error); }
}

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  return mutate(context, 'update');
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return mutate(context, 'delete');
}
