import 'server-only';
import type { ExternalCalendarEvent, GoogleCalendarSummary } from '@/types/calendar';

export class CalendarReconnectError extends Error {}
export class CalendarServiceError extends Error {}
export class CalendarOAuthConfigurationError extends Error {}
type Fetcher = typeof fetch;
const MAX_PAGES = 20;
const MAX_CALENDARS = 1_000;
const MAX_EVENTS = 5_000;

function configured(name: 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET'): string {
  const value = process.env[name];
  if (!value) throw new CalendarOAuthConfigurationError('Google OAuthのサーバー設定が未完了です。');
  return value;
}

async function fetchWithTimeout(fetcher: Fetcher, input: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetcher(input, { ...init, signal: controller.signal }); }
  catch { throw new CalendarServiceError('Google Calendarへの接続がタイムアウトしました。'); }
  finally { clearTimeout(timer); }
}

export async function refreshGoogleAccessToken(refreshToken: string, fetcher: Fetcher = fetch, timeoutMs = 10_000): Promise<string> {
  const response = await fetchWithTimeout(fetcher, 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: configured('GOOGLE_OAUTH_CLIENT_ID'), client_secret: configured('GOOGLE_OAUTH_CLIENT_SECRET'), refresh_token: refreshToken, grant_type: 'refresh_token' }),
  }, timeoutMs);
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const providerCode = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string' ? result.error : null;
    if (providerCode === 'invalid_grant') throw new CalendarReconnectError('Google Calendarへの再接続が必要です。');
    if (providerCode === 'invalid_client' || providerCode === 'unauthorized_client') throw new CalendarOAuthConfigurationError('Google OAuthのClient IDまたはClient Secretが一致していません。');
    throw new CalendarServiceError('Google Calendarの認証を更新できませんでした。');
  }
  if (typeof result !== 'object' || result === null || !('access_token' in result) || typeof result.access_token !== 'string') throw new CalendarServiceError('Google Calendarの認証応答が不正です。');
  return result.access_token;
}

async function googleJson(url: URL, accessToken: string, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetcher, url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 401 || response.status === 403) throw new CalendarReconnectError('Google Calendarへの再接続が必要です。');
  if (!response.ok) throw new CalendarServiceError('Google Calendarからデータを取得できませんでした。');
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) throw new CalendarServiceError('Google Calendarの応答が不正です。');
  return data as Record<string, unknown>;
}

export async function listGoogleCalendars(accessToken: string, selectedIds: readonly string[], fetcher: Fetcher = fetch): Promise<GoogleCalendarSummary[]> {
  const calendars: GoogleCalendarSummary[] = [];
  let pageToken: string | undefined;
  const seenTokens = new Set<string>();
  let pages = 0;
  do {
    pages += 1;
    if (pages > MAX_PAGES) throw new CalendarServiceError('Google Calendarの取得ページ数が上限を超えました。');
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await googleJson(url, accessToken, fetcher);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string') continue;
      calendars.push({ calendarId: item.id, summary: 'summary' in item && typeof item.summary === 'string' ? item.summary : '名称未設定', primary: 'primary' in item && item.primary === true, selected: selectedIds.includes(item.id), backgroundColor: 'backgroundColor' in item && typeof item.backgroundColor === 'string' ? item.backgroundColor : null });
      if (calendars.length > MAX_CALENDARS) throw new CalendarServiceError('Google Calendarの取得件数が上限を超えました。');
    }
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
    if (pageToken && seenTokens.has(pageToken)) throw new CalendarServiceError('Google Calendarのページ情報が不正です。');
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);
  return calendars;
}

export function validateCalendarSelection(requested: readonly string[], available: readonly GoogleCalendarSummary[]): string[] {
  const unique = [...new Set(requested)];
  const allowed = new Set(available.map((calendar) => calendar.calendarId));
  if (!unique.every((id) => allowed.has(id))) throw new CalendarServiceError('利用できないCalendarが含まれています。');
  return unique;
}

export function validateCalendarIdInput(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || !value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 512)) {
    throw new CalendarServiceError('Calendar選択が不正です。');
  }
  return [...new Set(value)];
}

export function validateEventRange(timeMin: string | null, timeMax: string | null): { timeMin: string; timeMax: string } {
  if (!timeMin || !timeMax) throw new CalendarServiceError('取得期間を指定してください。');
  const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!instantPattern.test(timeMin) || !instantPattern.test(timeMax)) throw new CalendarServiceError('取得期間が不正です。');
  const min = new Date(timeMin); const max = new Date(timeMax);
  if (Number.isNaN(min.getTime()) || Number.isNaN(max.getTime()) || min >= max) throw new CalendarServiceError('取得期間が不正です。');
  if (max.getTime() - min.getTime() > 93 * 86_400_000) throw new CalendarServiceError('取得期間は93日以内にしてください。');
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

function normalizedLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'calendar.google.com' ? url.toString() : null; } catch { return null; }
}

export function normalizeGoogleEvent(calendarId: string, value: unknown): ExternalCalendarEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (item.status === 'cancelled' || typeof item.id !== 'string') return null;
  const startValue = typeof item.start === 'object' && item.start ? item.start as Record<string, unknown> : {};
  const endValue = typeof item.end === 'object' && item.end ? item.end as Record<string, unknown> : {};
  const allDay = typeof startValue.date === 'string';
  const start = allDay ? startValue.date : startValue.dateTime;
  const end = allDay ? endValue.date : endValue.dateTime;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  return { id: item.id, calendarId, title: typeof item.summary === 'string' && item.summary.trim() ? item.summary : '予定（タイトルなし）', start, end, allDay, status: item.status === 'tentative' ? 'tentative' : 'confirmed', htmlLink: normalizedLink(item.htmlLink), colorId: typeof item.colorId === 'string' ? item.colorId : null };
}

export async function listGoogleEvents(accessToken: string, calendarIds: readonly string[], range: { timeMin: string; timeMax: string }, fetcher: Fetcher = fetch): Promise<ExternalCalendarEvent[]> {
  const events = new Map<string, ExternalCalendarEvent>();
  let pages = 0;
  for (const calendarId of calendarIds.length ? calendarIds : ['primary']) {
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      pages += 1;
      if (pages > MAX_PAGES) throw new CalendarServiceError('Google Calendar予定の取得ページ数が上限を超えました。');
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      Object.entries({ ...range, singleEvents: 'true', orderBy: 'startTime', timeZone: 'Asia/Tokyo', maxResults: '2500' }).forEach(([key, value]) => url.searchParams.set(key, value));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await googleJson(url, accessToken, fetcher);
      for (const item of Array.isArray(data.items) ? data.items : []) {
        const event = normalizeGoogleEvent(calendarId, item);
        if (event) events.set(`${calendarId}:${event.id}`, event);
        if (events.size > MAX_EVENTS) throw new CalendarServiceError('Google Calendar予定の取得件数が上限を超えました。');
      }
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
      if (pageToken && seenTokens.has(pageToken)) throw new CalendarServiceError('Google Calendar予定のページ情報が不正です。');
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
  }
  return [...events.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export async function revokeGoogleToken(token: string, fetcher: Fetcher = fetch, timeoutMs = 10_000): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(fetcher, 'https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }, timeoutMs);
    return response.ok;
  } catch {
    return false;
  }
}
