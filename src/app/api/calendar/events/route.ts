import type { NextRequest } from 'next/server';
import { listGoogleEvents, validateEventRange } from '@/lib/calendar/google-api';
import { calendarAccessContext, calendarErrorResponse } from '@/lib/calendar/server';
import { calendarJson } from '@/lib/calendar/responses';

export async function GET(request: NextRequest) {
  const context = await calendarAccessContext();
  if (!context.ok) return context.response;
  let range;
  try { range = validateEventRange(request.nextUrl.searchParams.get('timeMin'), request.nextUrl.searchParams.get('timeMax')); }
  catch { return calendarJson({ error: '取得期間が不正です。', code: 'INVALID_RANGE' }, 400); }
  try {
    const calendarIds = context.connection.selected_calendar_ids.length ? context.connection.selected_calendar_ids : ['primary'];
    return calendarJson({ events: await listGoogleEvents(context.accessToken, calendarIds, range) });
  } catch (error) { return calendarErrorResponse(error, 'CALENDAR_FETCH_FAILED'); }
}
