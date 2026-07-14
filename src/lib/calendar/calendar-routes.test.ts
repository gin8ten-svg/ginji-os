import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';

const mocks = vi.hoisted(() => ({ client: {} as SupabaseClient<Database> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client }));

import { GET as connectionGet } from '@/app/api/calendar/connection/route';
import { calendarJson } from '@/lib/calendar/responses';
import { markCalendarNeedsReconnect } from '@/lib/calendar/server';

function unauthenticatedClient(): SupabaseClient<Database> {
  return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as unknown as SupabaseClient<Database>;
}

beforeEach(() => { mocks.client = unauthenticatedClient(); });

describe('Calendar Route Handler authorization and caching', () => {
  it.each([200, 400, 401, 409, 500])('status %iでもprivate, no-storeを設定する', (status) => {
    expect(calendarJson({ ok: status < 400 }, status).headers.get('cache-control')).toBe('private, no-store');
  });

  it('未認証GETは401で秘密情報を含めない', async () => {
    const response = await connectionGet();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toMatch(/token|cipher/i);
  });

  it('認証user_idを所有者条件に使い、暗号文を返さない', async () => {
    const filters: unknown[][] = [];
    const connection = { user_id: 'user-a', encrypted_refresh_token: 'ciphertext-secret', token_format_version: 1, granted_scopes: [], selected_calendar_ids: ['primary'], needs_reconnect: false, connected_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' };
    mocks.client = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
      from: () => ({ select: () => ({ eq: (...args: unknown[]) => { filters.push(args); return { maybeSingle: async () => ({ data: connection, error: null }) }; } }) }),
    } as unknown as SupabaseClient<Database>;
    const response = await connectionGet();
    expect(filters).toEqual([['user_id', 'user-a']]);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('ciphertext-secret');
  });

  it.each([[null, true], [{ message: 'db detail' }, false]])('needs_reconnect更新結果を検査する', async (error, expected) => {
    const filters: unknown[][] = [];
    const client = { from: () => ({ update: () => ({ eq: async (...args: unknown[]) => { filters.push(args); return { error }; } }) }) } as unknown as SupabaseClient<Database>;
    await expect(markCalendarNeedsReconnect(client, 'user-a')).resolves.toBe(expected);
    expect(filters).toEqual([['user_id', 'user-a']]);
  });
});
