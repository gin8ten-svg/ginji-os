import { NextResponse } from 'next/server';
import { listGoogleCalendars, validateCalendarSelection } from '@/lib/calendar/google-api';
import { calendarAccessContext, calendarErrorResponse } from '@/lib/calendar/server';

export async function GET() {
  const context = await calendarAccessContext();
  if (!context.ok) return context.response;
  try { return NextResponse.json({ calendars: await listGoogleCalendars(context.accessToken, context.connection.selected_calendar_ids) }); }
  catch (error) { return calendarErrorResponse(error); }
}

export async function PUT(request: Request) {
  const context = await calendarAccessContext();
  if (!context.ok) return context.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'リクエストが不正です。' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null || !('calendarIds' in body) || !Array.isArray(body.calendarIds) || !body.calendarIds.every((id) => typeof id === 'string') || body.calendarIds.length > 100) return NextResponse.json({ error: 'Calendar選択が不正です。' }, { status: 400 });
  const requested = [...new Set(body.calendarIds as string[])];
  try {
    const available = await listGoogleCalendars(context.accessToken, context.connection.selected_calendar_ids);
    const validated = validateCalendarSelection(requested, available);
    const { error } = await context.client.from('calendar_connections').update({ selected_calendar_ids: validated }).eq('user_id', context.userId);
    if (error) return NextResponse.json({ error: 'Calendar選択を保存できませんでした。' }, { status: 500 });
    return NextResponse.json({ selectedCalendarIds: validated });
  } catch (error) { return calendarErrorResponse(error); }
}
