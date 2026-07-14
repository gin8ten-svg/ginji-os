import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }) }));
vi.mock('@/lib/calendar/connection', () => ({ saveCalendarConnection: mocks.save }));

import { GET } from '@/app/auth/callback/route';
import { CALENDAR_OAUTH_COOKIE, createCalendarOAuthState } from '@/lib/calendar/oauth-state';

const originalSecret = process.env.CALENDAR_OAUTH_STATE_SECRET;
const request = (query: string, cookie?: string) => new NextRequest(`https://app.example/auth/callback?${query}`, cookie ? { headers: { cookie: `${CALENDAR_OAUTH_COOKIE}=${cookie}` } } : undefined);

beforeEach(() => {
  process.env.CALENDAR_OAUTH_STATE_SECRET = 'state-secret-that-is-at-least-32-bytes';
  mocks.exchange.mockReset();
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => { process.env.CALENDAR_OAUTH_STATE_SECRET = originalSecret; });

describe('OAuth callback authorization boundary', () => {
  it('通常ログインはCalendar scope処理をせず/todayへ戻す', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null });
    const response = await GET(request('code=normal'));
    expect(response.headers.get('location')).toBe('https://app.example/today');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('開始ユーザー一致時だけRefresh Tokenを保存して/calendarへ戻す', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, provider_refresh_token: 'refresh' } }, error: null });
    const state = createCalendarOAuthState('user-a');
    const response = await GET(request('code=calendar&flow=calendar', state));
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), 'user-a', 'refresh');
    expect(response.headers.get('location')).toBe('https://app.example/calendar');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain(`${CALENDAR_OAUTH_COOKIE}=`);
  });

  it.each([
    ['Cookieなし', false],
    ['異なるユーザー', true],
  ])('%sでは保存しない', async (_name, hasOtherState) => {
    mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, provider_refresh_token: 'refresh' } }, error: null });
    const response = await GET(request('code=calendar&flow=calendar', hasOtherState ? createCalendarOAuthState('user-b') : undefined));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('calendarError=account_mismatch');
  });

  it('Refresh Tokenなしでは保存しない', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null });
    const response = await GET(request('code=calendar&flow=calendar', createCalendarOAuthState('user-a')));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('calendarError=missing_refresh_token');
  });

  it.each([
    ['error=access_denied&flow=calendar', 'oauth_denied'],
    ['flow=calendar', 'missing_code'],
  ])('OAuth拒否・codeなしを固定エラーへ戻す', async (query, error) => {
    const response = await GET(request(query));
    expect(response.headers.get('location')).toContain(`calendarError=${error}`);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('exchange失敗と保存失敗を固定エラーへ戻す', async () => {
    mocks.exchange.mockResolvedValueOnce({ data: {}, error: new Error('provider detail') });
    expect((await GET(request('code=x&flow=calendar'))).headers.get('location')).toContain('calendarError=exchange_failed');
    mocks.exchange.mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' }, provider_refresh_token: 'refresh' } }, error: null });
    mocks.save.mockRejectedValueOnce(new Error('database detail'));
    const response = await GET(request('code=x&flow=calendar', createCalendarOAuthState('user-a')));
    expect(response.headers.get('location')).toContain('calendarError=exchange_failed');
    expect(response.headers.get('location')).not.toContain('database');
  });

  it('固定allowlist以外をredirect先として扱わない', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null });
    expect((await GET(request('code=x&flow=https://evil.example'))).headers.get('location')).toBe('https://app.example/today');
  });
});
