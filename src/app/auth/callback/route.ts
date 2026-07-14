import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeAuthDestination } from '@/lib/auth/urls';
import { saveCalendarConnection } from '@/lib/calendar/connection';
import { CALENDAR_OAUTH_COOKIE, verifyCalendarOAuthState } from '@/lib/calendar/oauth-state';
import { withPrivateCache } from '@/lib/calendar/responses';

function calendarRedirect(request: NextRequest, code: string) {
  const response = withPrivateCache(NextResponse.redirect(new URL(`/calendar?calendarError=${code}`, request.url)));
  response.cookies.delete({ name: CALENDAR_OAUTH_COOKIE, path: '/auth/callback' });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const flow = request.nextUrl.searchParams.get('flow');
  const destination = safeAuthDestination(flow);
  const errorDestination = flow === 'calendar' ? '/calendar' : '/login';
  if (request.nextUrl.searchParams.has('error')) return flow === 'calendar' ? calendarRedirect(request, 'oauth_denied') : NextResponse.redirect(new URL(`${errorDestination}?error=oauth_denied`, request.url));
  if (!code) return flow === 'calendar' ? calendarRedirect(request, 'missing_code') : NextResponse.redirect(new URL(`${errorDestination}?error=missing_code`, request.url));
  try {
    const client = await createClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (flow === 'calendar') {
      const refreshToken = data.session?.provider_refresh_token;
      const userId = data.session?.user.id;
      if (!userId || !verifyCalendarOAuthState(request.cookies.get(CALENDAR_OAUTH_COOKIE)?.value, userId)) return calendarRedirect(request, 'account_mismatch');
      if (!refreshToken) return calendarRedirect(request, 'missing_refresh_token');
      await saveCalendarConnection(client, userId, refreshToken);
      const response = withPrivateCache(NextResponse.redirect(new URL(destination, request.url)));
      response.cookies.delete({ name: CALENDAR_OAUTH_COOKIE, path: '/auth/callback' });
      return response;
    }
    return NextResponse.redirect(new URL(destination, request.url));
  } catch {
    return flow === 'calendar' ? calendarRedirect(request, 'exchange_failed') : NextResponse.redirect(new URL(`${errorDestination}?error=exchange_failed`, request.url));
  }
}
