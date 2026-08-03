import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeAuthDestination } from '@/lib/auth/urls';
import { disconnectCalendarConnection, publicConnectionStatus, saveCalendarConnection } from '@/lib/calendar/connection';
import { CalendarEventAlreadyExistsError, CalendarEventConflictError, CalendarEventNotFoundError, CalendarOAuthConfigurationError, CalendarReconnectError, CalendarServiceError, createGoogleCalendarEvent, deleteGoogleCalendarEvent, getGoogleCalendarEvent, googleCalendarEventMatchesWriteInput, listGoogleCalendars, listGoogleEvents, normalizeGoogleEvent, refreshGoogleAccessToken, revokeGoogleToken, updateGoogleCalendarEvent, validateCalendarIdInput, validateCalendarSelection, validateEventRange, validateWritableCalendar } from '@/lib/calendar/google-api';
import { decryptRefreshToken, encryptRefreshToken } from '@/lib/calendar/token-crypto';
import { datesCoveredByAllDayEvent } from '@/lib/calendar/event-dates';
import { createCalendarOAuthState, verifyCalendarOAuthState } from '@/lib/calendar/oauth-state';
import type { Database } from '@/types/database';

const key = Buffer.alloc(32, 7).toString('base64');
const originalEnv = { ...process.env };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => { process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = key; process.env.CALENDAR_OAUTH_STATE_SECRET = 'state-secret-that-is-at-least-32-bytes'; process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret'; });
afterEach(() => { process.env = { ...originalEnv }; });

describe('Calendar token encryption', () => {
  it('AES-256-GCMで暗号化・復号し、同じ平文でも暗号文が異なる', () => { const one = encryptRefreshToken('refresh-token'); const two = encryptRefreshToken('refresh-token'); expect(one).not.toBe(two); expect(one.startsWith('v1.')).toBe(true); expect(decryptRefreshToken(one)).toBe('refresh-token'); });
  it('改ざん暗号文の復号を拒否する', () => { const parts = encryptRefreshToken('secret').split('.'); parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`; expect(() => decryptRefreshToken(parts.join('.'))).toThrow('invalid'); });
  it('暗号キー未設定時は安全に失敗する', () => { delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY; expect(() => encryptRefreshToken('secret')).toThrow('not configured'); });
  it.each(['', 'short', `${key} `, `${key}\n`, `${key.slice(0, -2)}!!`])('不正なBase64暗号キーを拒否する', (invalid) => { expect(() => encryptRefreshToken('secret', invalid)).toThrow('not configured'); });
  it('32 byteを超えるBase64暗号キーを拒否する', () => { expect(() => encryptRefreshToken('secret', Buffer.alloc(33).toString('base64'))).toThrow('not configured'); });
});

describe('Google OAuth token refresh', () => {
  it('Access Tokenを取得する', async () => { const access = await refreshGoogleAccessToken('refresh-secret', async (_url, init) => { expect(String(init?.body)).toContain('grant_type=refresh_token'); return json({ access_token: 'access-token' }); }); expect(access).toBe('access-token'); });
  it('invalid_grantを再接続エラーにする', async () => { await expect(refreshGoogleAccessToken('bad', async () => json({ error: 'invalid_grant', error_description: 'sensitive' }, 400))).rejects.toBeInstanceOf(CalendarReconnectError); });
  it.each(['invalid_client', 'unauthorized_client'])('OAuth client設定エラーを秘密情報なしで分類する', async (code) => { await expect(refreshGoogleAccessToken('never-return-this', async () => json({ error: code, error_description: 'provider-sensitive-detail' }, 401))).rejects.toBeInstanceOf(CalendarOAuthConfigurationError); });
  it('その他のToken更新失敗をGoogle生レスポンスなしで分類する', async () => { await expect(refreshGoogleAccessToken('never-return-this', async () => json({ error: 'temporarily_unavailable', error_description: 'provider-sensitive-detail' }, 503))).rejects.toThrow('認証を更新できません'); });
  it('timeoutを安全なエラーにする', async () => { const hanging = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch; await expect(refreshGoogleAccessToken('refresh', hanging, 1)).rejects.toThrow('タイムアウト'); });
});

describe('Calendar connection callback persistence', () => {
  it('Refresh Tokenを暗号化しSECURITY DEFINER RPC経由で保存する', async () => { const calls: [string, Record<string, unknown>][] = []; const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { error: null }; } } as unknown as SupabaseClient<Database>; await saveCalendarConnection(client, 'plain-refresh'); const [fn, args] = calls[0]; expect(fn).toBe('save_calendar_connection'); expect(args).toMatchObject({ p_granted_scopes: expect.any(Array) }); expect(JSON.stringify(args)).not.toContain('plain-refresh'); expect(decryptRefreshToken(String(args.p_encrypted_refresh_token))).toBe('plain-refresh'); });
  it('Refresh Tokenなしを接続成功にしない', async () => { await expect(saveCalendarConnection({} as SupabaseClient<Database>, null)).rejects.toThrow('missing'); });
  it('callback遷移先を固定しopen redirectを許可しない', () => { expect(safeAuthDestination('calendar')).toBe('/calendar'); expect(safeAuthDestination('https://evil.example')).toBe('/today'); });
  it('disconnectは認証ユーザー自身だけをfilterする', async () => { const filters: unknown[][] = []; const client = { rpc: async () => ({ data: null, error: null }), from: () => ({ delete: () => ({ eq: async (...args: unknown[]) => { filters.push(args); return { error: null }; } }) }) } as unknown as SupabaseClient<Database>; await disconnectCalendarConnection(client, 'authenticated-user'); expect(filters).toEqual([['user_id', 'authenticated-user']]); });
  it('revoke失敗時もDB接続を削除し秘密値を返さない', async () => { let deleted = false; const encrypted = encryptRefreshToken('never-expose-this'); const client = { rpc: async () => ({ data: encrypted, error: null }), from: () => ({ delete: () => ({ eq: async () => { deleted = true; return { error: null }; } }) }) } as unknown as SupabaseClient<Database>; const result = await disconnectCalendarConnection(client, 'user', async () => new Response('', { status: 500 })); expect(deleted).toBe(true); expect(result).toEqual({ googleRevoked: false }); expect(JSON.stringify(result)).not.toContain('never-expose-this'); });
  it('Google revoke成功を返す', async () => { const client = { rpc: async () => ({ data: encryptRefreshToken('token'), error: null }), from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }) } as unknown as SupabaseClient<Database>; await expect(disconnectCalendarConnection(client, 'user', async (_url: string | URL | Request, init?: RequestInit) => { expect(init?.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' }); return new Response('', { status: 200 }); })).resolves.toEqual({ googleRevoked: true }); });
  it('Google revoke timeoutをfalseとして安全に処理する', async () => { const hanging = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch; await expect(revokeGoogleToken('secret', hanging, 1)).resolves.toBe(false); });
  it('公開接続状態にTokenや暗号文を含めず予定追加scopeを判定', () => { const status = publicConnectionStatus({ user_id: 'user', granted_scopes: ['scope'], selected_calendar_ids: ['primary'], needs_reconnect: false, connected_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' }); expect(status).toEqual({ connected: true, connectedAt: '2026-07-15T00:00:00.000Z', selectedCalendarIds: ['primary'], needsReconnect: false, canWriteEvents: false }); expect(publicConnectionStatus({ user_id: 'user', granted_scopes: ['https://www.googleapis.com/auth/calendar.events'], selected_calendar_ids: [], needs_reconnect: false, connected_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' }).canWriteEvents).toBe(true); expect(JSON.stringify(status)).not.toContain('ciphertext'); });
});

describe('Google Calendar read normalization', () => {
  it('Calendar Listのpaginationを処理する', async () => { const requests: string[] = []; const fetcher = (async (input) => { requests.push(String(input)); return requests.length === 1 ? json({ items: [{ id: 'one', summary: 'One', primary: true }], nextPageToken: 'next' }) : json({ items: [{ id: 'two', summary: 'Two' }] }); }) as typeof fetch; const calendars = await listGoogleCalendars('access', ['two'], fetcher); expect(calendars).toHaveLength(2); expect(calendars[1].selected).toBe(true); expect(requests[1]).toContain('pageToken=next'); });
  it('eventsのpagination、キャンセル除外、重複整理を行う', async () => { let calls = 0; const event = { id: 'event', summary: '予定', status: 'confirmed', start: { dateTime: '2026-07-15T09:00:00+09:00' }, end: { dateTime: '2026-07-15T10:00:00+09:00' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=x' }; const fetcher = (async () => ++calls === 1 ? json({ items: [event, { ...event, id: 'cancelled', status: 'cancelled' }], nextPageToken: 'next' }) : json({ items: [event] })) as typeof fetch; const events = await listGoogleEvents('access', ['primary'], { timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }, fetcher); expect(events).toHaveLength(1); expect(events[0]).not.toHaveProperty('description'); expect(calls).toBe(2); });
  it('同じpageTokenの繰り返しを拒否する', async () => { const fetcher = (async () => json({ items: [], nextPageToken: 'same' })) as typeof fetch; await expect(listGoogleCalendars('access', [], fetcher)).rejects.toThrow('ページ情報'); });
  it('Eventの同じpageTokenの繰り返しを拒否する', async () => { const fetcher = (async () => json({ items: [], nextPageToken: 'same' })) as typeof fetch; await expect(listGoogleEvents('access', ['primary'], { timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }, fetcher)).rejects.toThrow('ページ情報'); });
  it('Calendar最大ページ数を超える応答を拒否する', async () => { let call = 0; const fetcher = (async () => json({ items: [], nextPageToken: `page-${++call}` })) as typeof fetch; await expect(listGoogleCalendars('access', [], fetcher)).rejects.toThrow('ページ数'); expect(call).toBe(20); });
  it('Event最大ページ数を超える応答を拒否する', async () => { let call = 0; const fetcher = (async () => json({ items: [], nextPageToken: `page-${++call}` })) as typeof fetch; await expect(listGoogleEvents('access', ['primary'], { timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }, fetcher)).rejects.toThrow('ページ数'); expect(call).toBe(20); });
  it('Calendar最大件数を超える応答を拒否する', async () => { const items = Array.from({ length: 1001 }, (_, index) => ({ id: `calendar-${index}` })); await expect(listGoogleCalendars('access', [], async () => json({ items }))).rejects.toThrow('取得件数'); });
  it('Event最大件数を超える応答を拒否する', async () => { const items = Array.from({ length: 5001 }, (_, index) => ({ id: `event-${index}`, start: { date: '2026-07-15' }, end: { date: '2026-07-16' } })); await expect(listGoogleEvents('access', ['primary'], { timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }, async () => json({ items }))).rejects.toThrow('取得件数'); });
  it('終日とタイムゾーン付きイベントを正規化する', () => { expect(normalizeGoogleEvent('primary', { id: 'all-day', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } })).toMatchObject({ allDay: true, start: '2026-07-15' }); expect(normalizeGoogleEvent('primary', { id: 'timed', start: { dateTime: '2026-07-15T09:00:00+09:00' }, end: { dateTime: '2026-07-15T10:00:00+09:00' } })).toMatchObject({ allDay: false }); });
  it('取得期間を厳密に検証して93日超を拒否する', () => { expect(validateEventRange('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')).toEqual({ timeMin: '2026-07-01T00:00:00.000Z', timeMax: '2026-08-01T00:00:00.000Z' }); expect(() => validateEventRange('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z')).toThrow('93日'); expect(() => validateEventRange('2026-07-01', '2026-08-01')).toThrow('不正'); });
  it('取得可能なCalendar IDだけを許可する', () => { const available = [{ calendarId: 'primary', summary: 'Main', primary: true, selected: false, backgroundColor: null, accessRole: 'owner' as const, writable: true }]; expect(validateCalendarSelection(['primary', 'primary'], available)).toEqual(['primary']); expect(() => validateCalendarSelection(['other'], available)).toThrow(CalendarServiceError); });
  it('Calendar IDを衛生検証し重複を除去する', () => { expect(validateCalendarIdInput(['primary', 'primary'])).toEqual(['primary']); expect(() => validateCalendarIdInput('primary')).toThrow(); expect(() => validateCalendarIdInput([''])).toThrow(); expect(() => validateCalendarIdInput(['x'.repeat(513)])).toThrow(); expect(() => validateCalendarIdInput(Array(101).fill('x'))).toThrow(); });
  it('Calendar ListのaccessRoleから書き込み可否を判定', async () => { const calendars = await listGoogleCalendars('access', [], async () => json({ items: [{ id: 'read', accessRole: 'reader' }, { id: 'write', accessRole: 'writer' }, { id: 'owner', accessRole: 'owner' }] })); expect(calendars.map((item) => item.writable)).toEqual([false, true, true]); expect(validateWritableCalendar('write', calendars).calendarId).toBe('write'); expect(() => validateWritableCalendar('read', calendars)).toThrow(CalendarServiceError); });
});

describe('Google Calendar event write', () => {
  const input = { eventId: '0123456789abcdef', title: 'Snapshot title', start: '2026-07-15T02:00:00.000Z', end: '2026-07-15T03:00:00.000Z', timeZone: 'Asia/Tokyo' as const };
  const providerEvent = { id: input.eventId, etag: '"event-etag"', summary: input.title, status: 'confirmed', start: { dateTime: input.start }, end: { dateTime: input.end }, extendedProperties: { private: { ginjiEventId: input.eventId } } };
  it('canonical title・時刻・決定論的IDだけをPOSTしTokenをbodyへ含めない', async () => { const event = await createGoogleCalendarEvent('primary', 'access-secret', input, async (url, init) => { expect(String(url)).toContain('/calendars/primary/events'); expect(init?.method).toBe('POST'); expect((init?.headers as Record<string, string>).authorization).toBe('Bearer access-secret'); const body = JSON.parse(String(init?.body)); expect(body).toMatchObject({ id: input.eventId, summary: 'Snapshot title', start: { dateTime: input.start, timeZone: 'Asia/Tokyo' }, end: { dateTime: input.end, timeZone: 'Asia/Tokyo' } }); expect(JSON.stringify(body)).not.toContain('access-secret'); return json(providerEvent); }); expect(event.id).toBe(input.eventId); });
  it('409を重複専用errorにしGETした同一eventを照合できる', async () => { await expect(createGoogleCalendarEvent('primary', 'access', input, async () => json({ error: { message: 'provider detail' } }, 409))).rejects.toBeInstanceOf(CalendarEventAlreadyExistsError); const event = await getGoogleCalendarEvent('primary', input.eventId, 'access', async (_url, init) => { expect(init?.method).toBe('GET'); return json(providerEvent); }); expect(googleCalendarEventMatchesWriteInput(event, input)).toBe(true); expect(googleCalendarEventMatchesWriteInput({ ...event, title: 'Changed' }, input)).toBe(false); });
  it.each([401, 403])('作成時の%iを再接続errorにする', async (status) => { await expect(createGoogleCalendarEvent('primary', 'access', input, async () => json({}, status))).rejects.toBeInstanceOf(CalendarReconnectError); });
  it('providerの生errorを返さない', async () => { await expect(createGoogleCalendarEvent('primary', 'access', input, async () => json({ error: 'provider-secret-detail' }, 500))).rejects.toMatchObject({ message: 'Google Calendarへ予定を作成できませんでした。' }); });
  it('ETag付きPATCHでcanonical内容だけを再同期する', async () => {
    const event = await updateGoogleCalendarEvent('primary', input.eventId, 'access-secret', input, '"event-etag"', async (url, init) => {
      expect(String(url)).toContain(`/events/${input.eventId}`); expect(init?.method).toBe('PATCH');
      expect((init?.headers as Record<string, string>)['if-match']).toBe('"event-etag"');
      const body = JSON.parse(String(init?.body)); expect(body).toMatchObject({ summary: input.title, extendedProperties: { private: { ginjiEventId: input.eventId } } });
      expect(body).not.toHaveProperty('id'); expect(JSON.stringify(body)).not.toContain('access-secret');
      return json(providerEvent);
    });
    expect(googleCalendarEventMatchesWriteInput(event, input)).toBe(true);
  });
  it('ETag付きDELETEを送り404は削除済み・412は競合として区別する', async () => {
    await expect(deleteGoogleCalendarEvent('primary', input.eventId, 'access', '"event-etag"', async (_url, init) => { expect(init?.method).toBe('DELETE'); expect((init?.headers as Record<string, string>)['if-match']).toBe('"event-etag"'); return new Response(null, { status: 204 }); })).resolves.toBeUndefined();
    await expect(deleteGoogleCalendarEvent('primary', input.eventId, 'access', '"event-etag"', async () => json({}, 404))).rejects.toBeInstanceOf(CalendarEventNotFoundError);
    await expect(updateGoogleCalendarEvent('primary', input.eventId, 'access', input, '"event-etag"', async () => json({}, 412))).rejects.toBeInstanceOf(CalendarEventConflictError);
  });
  it('GETの404を削除済みとして区別する', async () => { await expect(getGoogleCalendarEvent('primary', input.eventId, 'access', async () => json({}, 404))).rejects.toBeInstanceOf(CalendarEventNotFoundError); });
});

describe('終日イベント日付展開', () => {
  it.each([
    ['1日', '2026-07-15', '2026-07-16', ['2026-07-15']],
    ['3日', '2026-07-15', '2026-07-18', ['2026-07-15', '2026-07-16', '2026-07-17']],
    ['月またぎ', '2026-07-31', '2026-08-02', ['2026-07-31', '2026-08-01']],
    ['年またぎ', '2026-12-31', '2027-01-02', ['2026-12-31', '2027-01-01']],
  ])('%sを[start, end)で展開する', (_name, start, end, expected) => { expect(datesCoveredByAllDayEvent(start, end)).toEqual(expected); });
  it('不正区間を空配列にする', () => { expect(datesCoveredByAllDayEvent('2026-07-15', '2026-07-15')).toEqual([]); expect(datesCoveredByAllDayEvent('invalid', '2026-07-16')).toEqual([]); });
});

describe('Calendar OAuth開始状態', () => {
  it('同一ユーザーかつ期限内だけ許可する', () => { const state = createCalendarOAuthState('user-a', 1_000); expect(verifyCalendarOAuthState(state, 'user-a', 2_000)).toBe(true); expect(verifyCalendarOAuthState(state, 'user-b', 2_000)).toBe(false); expect(verifyCalendarOAuthState(state, 'user-a', 602_000)).toBe(false); });
  it('Cookieなし・改ざん・nonce不正を拒否する', () => { expect(verifyCalendarOAuthState(undefined, 'user')).toBe(false); const state = createCalendarOAuthState('user'); expect(verifyCalendarOAuthState(`${state}x`, 'user')).toBe(false); });
});
