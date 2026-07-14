import { NextResponse } from 'next/server';
import { authenticatedCalendarContext } from '@/lib/calendar/server';
import { disconnectCalendarConnection, publicConnectionStatus } from '@/lib/calendar/connection';

export async function GET() {
  const context = await authenticatedCalendarContext();
  if (!context.ok) return context.response;
  return NextResponse.json(publicConnectionStatus(context.connection));
}

export async function DELETE() {
  const context = await authenticatedCalendarContext();
  if (!context.ok) return context.response;
  try { await disconnectCalendarConnection(context.client, context.userId); }
  catch { return NextResponse.json({ error: 'Google Calendar接続を解除できませんでした。' }, { status: 500 }); }
  return NextResponse.json({ disconnected: true });
}
