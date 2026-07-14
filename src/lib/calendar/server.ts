import 'server-only';
import { CalendarReconnectError, refreshGoogleAccessToken } from '@/lib/calendar/google-api';
import { decryptRefreshToken } from '@/lib/calendar/token-crypto';
import { calendarJson } from '@/lib/calendar/responses';
import { createClient } from '@/lib/supabase/server';
import type { CalendarConnectionRow } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export async function markCalendarNeedsReconnect(client: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { error } = await client.from('calendar_connections').update({ needs_reconnect: true }).eq('user_id', userId);
  return !error;
}

export async function authenticatedCalendarContext() {
  const client = await createClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { ok: false, response: calendarJson({ error: '認証が必要です。' }, 401) } as const;
  const { data: connection, error } = await client.from('calendar_connections').select('*').eq('user_id', userData.user.id).maybeSingle();
  if (error) return { ok: false, response: calendarJson({ error: 'Calendar接続情報を確認できませんでした。' }, 500) } as const;
  return { ok: true, client, userId: userData.user.id, connection: connection as CalendarConnectionRow | null } as const;
}

export async function calendarAccessContext() {
  const context = await authenticatedCalendarContext();
  if (!context.ok) return context;
  if (!context.connection) return { ok: false, response: calendarJson({ error: 'Google Calendarが未接続です。' }, 409) } as const;
  if (context.connection.needs_reconnect) return { ok: false, response: calendarJson({ error: 'Google Calendarへの再接続が必要です。', needsReconnect: true }, 409) } as const;
  try {
    const refreshToken = decryptRefreshToken(context.connection.encrypted_refresh_token);
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    return { ...context, ok: true, connection: context.connection, accessToken } as const;
  } catch (error) {
    if (error instanceof CalendarReconnectError) {
      if (!await markCalendarNeedsReconnect(context.client, context.userId)) return { ok: false, response: calendarJson({ error: 'Google Calendar接続状態を更新できませんでした。', needsReconnect: true }, 500) } as const;
      return { ok: false, response: calendarJson({ error: 'Google Calendarへの再接続が必要です。', needsReconnect: true }, 409) } as const;
    }
    return { ok: false, response: calendarJson({ error: 'Google Calendarへ接続できませんでした。' }, 502) } as const;
  }
}

export function calendarErrorResponse(error: unknown) {
  const message = error instanceof Error && error.message.startsWith('Google Calendar') ? error.message : 'Google Calendarの処理に失敗しました。';
  return calendarJson({ error: message }, 400);
}
