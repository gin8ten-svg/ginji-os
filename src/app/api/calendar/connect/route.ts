import { createClient } from '@/lib/supabase/server';
import { CALENDAR_OAUTH_COOKIE, CALENDAR_OAUTH_MAX_AGE_SECONDS, createCalendarOAuthState } from '@/lib/calendar/oauth-state';
import { calendarJson } from '@/lib/calendar/responses';

export async function POST() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return calendarJson({ error: '認証が必要です。' }, 401);
  try {
    const response = calendarJson({ ready: true });
    response.cookies.set(CALENDAR_OAUTH_COOKIE, createCalendarOAuthState(data.user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/auth/callback',
      maxAge: CALENDAR_OAUTH_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    return calendarJson({ error: 'Google Calendar接続を開始できませんでした。' }, 500);
  }
}
