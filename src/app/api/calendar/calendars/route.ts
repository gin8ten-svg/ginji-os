import { listGoogleCalendars, validateCalendarIdInput, validateCalendarSelection } from '@/lib/calendar/google-api';
import { calendarAccessContext, calendarErrorResponse } from '@/lib/calendar/server';
import { calendarJson } from '@/lib/calendar/responses';

export async function GET() {
  const context = await calendarAccessContext();
  if (!context.ok) return context.response;
  try { return calendarJson({ calendars: await listGoogleCalendars(context.accessToken, context.connection.selected_calendar_ids) }); }
  catch (error) { return calendarErrorResponse(error); }
}

export async function PUT(request: Request) {
  const context = await calendarAccessContext();
  if (!context.ok) return context.response;
  let body: unknown;
  try { body = await request.json(); } catch { return calendarJson({ error: 'リクエストが不正です。' }, 400); }
  if (typeof body !== 'object' || body === null || !('calendarIds' in body)) return calendarJson({ error: 'Calendar選択が不正です。' }, 400);
  try {
    const requested = validateCalendarIdInput(body.calendarIds);
    const available = await listGoogleCalendars(context.accessToken, context.connection.selected_calendar_ids);
    const validated = validateCalendarSelection(requested, available);
    const { error } = await context.client.from('calendar_connections').update({ selected_calendar_ids: validated }).eq('user_id', context.userId);
    if (error) return calendarJson({ error: 'Calendar選択を保存できませんでした。' }, 500);
    return calendarJson({ selectedCalendarIds: validated });
  } catch (error) { return calendarErrorResponse(error); }
}
