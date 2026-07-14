import 'server-only';
import { NextResponse } from 'next/server';
import { CalendarReconnectError, refreshGoogleAccessToken } from '@/lib/calendar/google-api';
import { decryptRefreshToken } from '@/lib/calendar/token-crypto';
import { createClient } from '@/lib/supabase/server';
import type { CalendarConnectionRow } from '@/types/database';

export async function authenticatedCalendarContext() {
  const client = await createClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { ok: false, response: NextResponse.json({ error: '認証が必要です。' }, { status: 401 }) } as const;
  const { data: connection, error } = await client.from('calendar_connections').select('*').eq('user_id', userData.user.id).maybeSingle();
  if (error) return { ok: false, response: NextResponse.json({ error: 'Calendar接続情報を確認できませんでした。' }, { status: 500 }) } as const;
  return { ok: true, client, userId: userData.user.id, connection: connection as CalendarConnectionRow | null } as const;
}

export async function calendarAccessContext() {
  const context = await authenticatedCalendarContext();
  if (!context.ok) return context;
  if (!context.connection) return { ok: false, response: NextResponse.json({ error: 'Google Calendarが未接続です。' }, { status: 409 }) } as const;
  if (context.connection.needs_reconnect) return { ok: false, response: NextResponse.json({ error: 'Google Calendarへの再接続が必要です。', needsReconnect: true }, { status: 409 }) } as const;
  try {
    const refreshToken = decryptRefreshToken(context.connection.encrypted_refresh_token);
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    return { ...context, ok: true, connection: context.connection, accessToken } as const;
  } catch (error) {
    if (error instanceof CalendarReconnectError) {
      await context.client.from('calendar_connections').update({ needs_reconnect: true }).eq('user_id', context.userId);
      return { ok: false, response: NextResponse.json({ error: 'Google Calendarへの再接続が必要です。', needsReconnect: true }, { status: 409 }) } as const;
    }
    return { ok: false, response: NextResponse.json({ error: error instanceof Error ? error.message : 'Google Calendarへ接続できませんでした。' }, { status: 502 }) } as const;
  }
}

export function calendarErrorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Google Calendarの処理に失敗しました。' }, { status: 400 });
}
