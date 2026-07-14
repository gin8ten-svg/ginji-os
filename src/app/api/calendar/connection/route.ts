import { authenticatedCalendarContext } from '@/lib/calendar/server';
import { disconnectCalendarConnection, publicConnectionStatus } from '@/lib/calendar/connection';
import { calendarJson } from '@/lib/calendar/responses';

export async function GET() {
  const context = await authenticatedCalendarContext();
  if (!context.ok) return context.response;
  return calendarJson(publicConnectionStatus(context.connection));
}

export async function DELETE() {
  const context = await authenticatedCalendarContext();
  if (!context.ok) return context.response;
  try {
    const result = await disconnectCalendarConnection(context.client, context.userId, context.connection?.encrypted_refresh_token);
    return calendarJson({ disconnected: true, googleRevoked: result.googleRevoked });
  } catch { return calendarJson({ error: 'Google Calendar接続を解除できませんでした。' }, 500); }
}
