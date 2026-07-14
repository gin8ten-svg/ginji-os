import type { CalendarConnectionStatus, ExternalCalendarEvent, GoogleCalendarSummary } from '@/types/calendar';

export type CalendarClientErrorCode = 'AUTH_REQUIRED' | 'NOT_CONNECTED' | 'RECONNECT_REQUIRED' | 'CALENDAR_FETCH_FAILED' | 'INVALID_RANGE';
export class CalendarClientError extends Error { constructor(message: string, readonly code: CalendarClientErrorCode) { super(message); } }

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'Google Calendarの処理に失敗しました。';
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : null;
    const safeCode: CalendarClientErrorCode = code === 'AUTH_REQUIRED' || code === 'NOT_CONNECTED' || code === 'RECONNECT_REQUIRED' || code === 'INVALID_RANGE' ? code : 'CALENDAR_FETCH_FAILED';
    throw new CalendarClientError(message, safeCode);
  }
  return body as T;
}

export function getCalendarConnection(signal?: AbortSignal) { return jsonRequest<CalendarConnectionStatus>('/api/calendar/connection', { signal }); }
export function prepareCalendarConnection() { return jsonRequest<{ ready: true }>('/api/calendar/connect', { method: 'POST' }); }
export function getCalendars(signal?: AbortSignal) { return jsonRequest<{ calendars: GoogleCalendarSummary[] }>('/api/calendar/calendars', { signal }); }
export function getCalendarEvents(timeMin: string, timeMax: string, signal?: AbortSignal) { const query = new URLSearchParams({ timeMin, timeMax }); return jsonRequest<{ events: ExternalCalendarEvent[] }>(`/api/calendar/events?${query}`, { signal }); }
export function putCalendarSelection(calendarIds: string[]) { return jsonRequest<{ selectedCalendarIds: string[] }>('/api/calendar/calendars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendarIds }) }); }
export function deleteCalendarConnection() { return jsonRequest<{ disconnected: boolean; googleRevoked: boolean }>('/api/calendar/connection', { method: 'DELETE' }); }
