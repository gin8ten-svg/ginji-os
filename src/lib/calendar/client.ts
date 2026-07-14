import type { CalendarConnectionStatus, ExternalCalendarEvent, GoogleCalendarSummary } from '@/types/calendar';

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'Google Calendarの処理に失敗しました。';
    throw new Error(message);
  }
  return body as T;
}

export function getCalendarConnection(signal?: AbortSignal) { return jsonRequest<CalendarConnectionStatus>('/api/calendar/connection', { signal }); }
export function getCalendars(signal?: AbortSignal) { return jsonRequest<{ calendars: GoogleCalendarSummary[] }>('/api/calendar/calendars', { signal }); }
export function getCalendarEvents(timeMin: string, timeMax: string, signal?: AbortSignal) { const query = new URLSearchParams({ timeMin, timeMax }); return jsonRequest<{ events: ExternalCalendarEvent[] }>(`/api/calendar/events?${query}`, { signal }); }
export function putCalendarSelection(calendarIds: string[]) { return jsonRequest<{ selectedCalendarIds: string[] }>('/api/calendar/calendars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendarIds }) }); }
export function deleteCalendarConnection() { return jsonRequest<{ disconnected: boolean }>('/api/calendar/connection', { method: 'DELETE' }); }
