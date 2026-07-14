import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revokeGoogleToken } from '@/lib/calendar/google-api';
import { decryptRefreshToken, encryptRefreshToken } from '@/lib/calendar/token-crypto';
import type { Database } from '@/types/database';
import { GOOGLE_CALENDAR_SCOPES } from '@/types/calendar';
import type { CalendarConnectionRow } from '@/types/database';
import type { CalendarConnectionStatus } from '@/types/calendar';

export async function saveCalendarConnection(client: SupabaseClient<Database>, userId: string, refreshToken: string | null | undefined, now = new Date()): Promise<void> {
  if (!refreshToken) throw new Error('Google Calendar refresh token is missing.');
  const { error } = await client.from('calendar_connections').upsert({
    user_id: userId,
    encrypted_refresh_token: encryptRefreshToken(refreshToken),
    token_format_version: 1,
    granted_scopes: [...GOOGLE_CALENDAR_SCOPES],
    needs_reconnect: false,
    connected_at: now.toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error('Calendar connection could not be saved.');
}

export function publicConnectionStatus(connection: CalendarConnectionRow | null): CalendarConnectionStatus {
  return { connected: Boolean(connection), connectedAt: connection?.connected_at ?? null, selectedCalendarIds: connection?.selected_calendar_ids ?? [], needsReconnect: connection?.needs_reconnect ?? false };
}

export async function disconnectCalendarConnection(client: SupabaseClient<Database>, userId: string, encryptedRefreshToken?: string, fetcher: typeof fetch = fetch): Promise<{ googleRevoked: boolean }> {
  let googleRevoked = false;
  if (encryptedRefreshToken) {
    try { googleRevoked = await revokeGoogleToken(decryptRefreshToken(encryptedRefreshToken), fetcher); } catch { googleRevoked = false; }
  }
  const { error } = await client.from('calendar_connections').delete().eq('user_id', userId);
  if (error) throw new Error('Calendar connection could not be deleted.');
  return { googleRevoked };
}
