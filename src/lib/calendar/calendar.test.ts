import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeAuthDestination } from '@/lib/auth/urls';
import { disconnectCalendarConnection, publicConnectionStatus, saveCalendarConnection } from '@/lib/calendar/connection';
import { CalendarReconnectError, CalendarServiceError, listGoogleCalendars, listGoogleEvents, normalizeGoogleEvent, refreshGoogleAccessToken, validateCalendarSelection, validateEventRange } from '@/lib/calendar/google-api';
import { decryptRefreshToken, encryptRefreshToken } from '@/lib/calendar/token-crypto';
import type { Database } from '@/types/database';

const key = Buffer.alloc(32, 7).toString('base64');
const originalEnv = { ...process.env };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => { process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = key; process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret'; });
afterEach(() => { process.env = { ...originalEnv }; });

describe('Calendar token encryption', () => {
  it('AES-256-GCMで暗号化・復号し、同じ平文でも暗号文が異なる', () => { const one = encryptRefreshToken('refresh-token'); const two = encryptRefreshToken('refresh-token'); expect(one).not.toBe(two); expect(one.startsWith('v1.')).toBe(true); expect(decryptRefreshToken(one)).toBe('refresh-token'); });
  it('改ざん暗号文の復号を拒否する', () => { const parts = encryptRefreshToken('secret').split('.'); parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`; expect(() => decryptRefreshToken(parts.join('.'))).toThrow('invalid'); });
  it('暗号キー未設定時は安全に失敗する', () => { delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY; expect(() => encryptRefreshToken('secret')).toThrow('not configured'); });
});

describe('Google OAuth token refresh', () => {
  it('Access Tokenを取得する', async () => { const access = await refreshGoogleAccessToken('refresh-secret', async (_url, init) => { expect(String(init?.body)).toContain('grant_type=refresh_token'); return json({ access_token: 'access-token' }); }); expect(access).toBe('access-token'); });
  it('invalid_grantを再接続エラーにする', async () => { await expect(refreshGoogleAccessToken('bad', async () => json({ error: 'invalid_grant', error_description: 'sensitive' }, 400))).rejects.toBeInstanceOf(CalendarReconnectError); });
  it('timeoutを安全なエラーにする', async () => { const hanging = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch; await expect(refreshGoogleAccessToken('refresh', hanging, 1)).rejects.toThrow('タイムアウト'); });
});

describe('Calendar connection callback persistence', () => {
  it('Refresh Tokenを暗号化し、認証user_idで保存する', async () => { const payloads: Record<string, unknown>[] = []; const client = { from: () => ({ upsert: async (value: Record<string, unknown>) => { payloads.push(value); return { error: null }; } }) } as unknown as SupabaseClient<Database>; await saveCalendarConnection(client, 'authenticated-user', 'plain-refresh', new Date('2026-07-15T00:00:00.000Z')); const payload = payloads[0]; expect(payload).toMatchObject({ user_id: 'authenticated-user', token_format_version: 1 }); expect(JSON.stringify(payload)).not.toContain('plain-refresh'); expect(decryptRefreshToken(String(payload.encrypted_refresh_token))).toBe('plain-refresh'); });
  it('Refresh Tokenなしを接続成功にしない', async () => { await expect(saveCalendarConnection({} as SupabaseClient<Database>, 'user', null)).rejects.toThrow('missing'); });
  it('callback遷移先を固定しopen redirectを許可しない', () => { expect(safeAuthDestination('calendar')).toBe('/calendar'); expect(safeAuthDestination('https://evil.example')).toBe('/today'); });
  it('disconnectは認証ユーザー自身だけをfilterする', async () => { const filters: unknown[][] = []; const client = { from: () => ({ delete: () => ({ eq: async (...args: unknown[]) => { filters.push(args); return { error: null }; } }) }) } as unknown as SupabaseClient<Database>; await disconnectCalendarConnection(client, 'authenticated-user'); expect(filters).toEqual([['user_id', 'authenticated-user']]); });
  it('公開接続状態にTokenや暗号文を含めない', () => { const status = publicConnectionStatus({ user_id: 'user', encrypted_refresh_token: 'ciphertext', token_format_version: 1, granted_scopes: ['scope'], selected_calendar_ids: ['primary'], needs_reconnect: false, connected_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' }); expect(status).toEqual({ connected: true, connectedAt: '2026-07-15T00:00:00.000Z', selectedCalendarIds: ['primary'], needsReconnect: false }); expect(JSON.stringify(status)).not.toContain('ciphertext'); });
});

describe('Google Calendar read normalization', () => {
  it('Calendar Listのpaginationを処理する', async () => { const requests: string[] = []; const fetcher = (async (input) => { requests.push(String(input)); return requests.length === 1 ? json({ items: [{ id: 'one', summary: 'One', primary: true }], nextPageToken: 'next' }) : json({ items: [{ id: 'two', summary: 'Two' }] }); }) as typeof fetch; const calendars = await listGoogleCalendars('access', ['two'], fetcher); expect(calendars).toHaveLength(2); expect(calendars[1].selected).toBe(true); expect(requests[1]).toContain('pageToken=next'); });
  it('eventsのpagination、キャンセル除外、重複整理を行う', async () => { let calls = 0; const event = { id: 'event', summary: '予定', status: 'confirmed', start: { dateTime: '2026-07-15T09:00:00+09:00' }, end: { dateTime: '2026-07-15T10:00:00+09:00' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=x' }; const fetcher = (async () => ++calls === 1 ? json({ items: [event, { ...event, id: 'cancelled', status: 'cancelled' }], nextPageToken: 'next' }) : json({ items: [event] })) as typeof fetch; const events = await listGoogleEvents('access', ['primary'], { timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }, fetcher); expect(events).toHaveLength(1); expect(events[0]).not.toHaveProperty('description'); expect(calls).toBe(2); });
  it('終日とタイムゾーン付きイベントを正規化する', () => { expect(normalizeGoogleEvent('primary', { id: 'all-day', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } })).toMatchObject({ allDay: true, start: '2026-07-15' }); expect(normalizeGoogleEvent('primary', { id: 'timed', start: { dateTime: '2026-07-15T09:00:00+09:00' }, end: { dateTime: '2026-07-15T10:00:00+09:00' } })).toMatchObject({ allDay: false }); });
  it('取得期間を厳密に検証して93日超を拒否する', () => { expect(validateEventRange('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')).toEqual({ timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }); expect(() => validateEventRange('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z')).toThrow('93日'); expect(() => validateEventRange('2026-07-01', '2026-08-01')).toThrow('不正'); });
  it('取得可能なCalendar IDだけを許可する', () => { const available = [{ calendarId: 'primary', summary: 'Main', primary: true, selected: false, backgroundColor: null }]; expect(validateCalendarSelection(['primary', 'primary'], available)).toEqual(['primary']); expect(() => validateCalendarSelection(['other'], available)).toThrow(CalendarServiceError); });
});
