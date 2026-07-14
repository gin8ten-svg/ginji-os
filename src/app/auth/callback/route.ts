import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeAuthDestination } from '@/lib/auth/urls';
import { saveCalendarConnection } from '@/lib/calendar/connection';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const flow = request.nextUrl.searchParams.get('flow');
  const destination = safeAuthDestination(flow);
  const errorDestination = flow === 'calendar' ? '/calendar' : '/login';
  if (request.nextUrl.searchParams.has('error')) return NextResponse.redirect(new URL(`${errorDestination}?${flow === 'calendar' ? 'calendarError' : 'error'}=oauth_denied`, request.url));
  if (!code) return NextResponse.redirect(new URL(`${errorDestination}?${flow === 'calendar' ? 'calendarError' : 'error'}=missing_code`, request.url));
  try {
    const client = await createClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (flow === 'calendar') {
      const refreshToken = data.session?.provider_refresh_token;
      const userId = data.session?.user.id;
      if (!refreshToken || !userId) return NextResponse.redirect(new URL('/calendar?calendarError=missing_refresh_token', request.url));
      await saveCalendarConnection(client, userId, refreshToken);
    }
    return NextResponse.redirect(new URL(destination, request.url));
  } catch {
    return NextResponse.redirect(new URL(`${errorDestination}?${flow === 'calendar' ? 'calendarError' : 'error'}=exchange_failed`, request.url));
  }
}
