import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revokeGoogleToken } from '@/lib/calendar/google-api';
import { decryptRefreshToken, encryptRefreshToken } from '@/lib/calendar/token-crypto';
import type { Database } from '@/types/database';
import { GOOGLE_CALENDAR_SCOPES } from '@/types/calendar';
import type { CalendarConnectionRow } from '@/types/database';
import type { CalendarConnectionStatus } from '@/types/calendar';

export async function saveCalendarConnection(client: SupabaseClient<Database>, refreshToken: string | null | undefined): Promise<void> {
  if (!refreshToken) throw new Error('Google Calendar refresh token is missing.');
  const { error } = await client.rpc('save_calendar_connection', {
    p_encrypted_refresh_token: encryptRefreshToken(refreshToken),
    p_granted_scopes: [...GOOGLE_CALENDAR_SCOPES],
  });
  if (error) throw new Error('Calendar connection could not be saved.');
}

export function publicConnectionStatus(connection: CalendarConnectionRow | null): CalendarConnectionStatus {
  return { connected: Boolean(connection), connectedAt: connection?.connected_at ?? null, selectedCalendarIds: connection?.selected_calendar_ids ?? [], needsReconnect: connection?.needs_reconnect ?? false };
}

export async function disconnectCalendarConnection(client: SupabaseClient<Database>, userId: string, fetcher: typeof fetch = fetch): Promise<{ googleRevoked: boolean }> {
  let googleRevoked = false;
  const { data: encryptedRefreshToken } = await client.rpc('get_calendar_connection_token');
  if (encryptedRefreshToken) {
    try { googleRevoked = await revokeGoogleToken(decryptRefreshToken(encryptedRefreshToken), fetcher); } catch { googleRevoked = false; }
  }
  const { error } = await client.from('calendar_connections').delete().eq('user_id', userId);
  if (error) throw new Error('Calendar connection could not be deleted.');
  return { googleRevoked };
}
