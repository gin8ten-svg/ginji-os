import type { NextRequest } from 'next/server';
import { listGoogleEvents, validateEventRange } from '@/lib/calendar/google-api';
import { calendarAccessContext, calendarErrorResponse } from '@/lib/calendar/server';
import { calendarJson } from '@/lib/calendar/responses';

export async function GET(request: NextRequest) {
  const context = await calendarAccessContext();
  if (!context.ok) return context.response;
  try {
    const range = validateEventRange(request.nextUrl.searchParams.get('timeMin'), request.nextUrl.searchParams.get('timeMax'));
    const calendarIds = context.connection.selected_calendar_ids.length ? context.connection.selected_calendar_ids : ['primary'];
    return calendarJson({ events: await listGoogleEvents(context.accessToken, calendarIds, range) });
  } catch (error) { return calendarErrorResponse(error); }
}
