import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260715000600_ai_advice_rate_limit.sql', 'utf8');

class AtomicReservationModel {
  private readonly reservations = new Map<string, number>();

  reserve(userId: string | null, serverNow: number, untrusted?: { clientNow?: number; resultSummary?: unknown }): boolean {
    void untrusted;
    if (!userId) return false;
    const previous = this.reservations.get(userId);
    if (previous !== undefined && previous > serverNow - 30_000) return false;
    this.reservations.set(userId, serverNow);
    return true;
  }
}

describe('AI advice atomic reservation migration', () => {
  it('auth.uidとDB nowだけを使う引数なし単一UPSERT', () => {
    expect(migration).toContain('create or replace function public.reserve_ai_advice_request()');
    expect(migration).toMatch(/insert into public\.ai_advice_rate_limits[\s\S]*on conflict \(user_id\) do update[\s\S]*where public\.ai_advice_rate_limits\.reserved_at <= now\(\) - interval '30 seconds'[\s\S]*returning true/);
    expect(migration).toContain('values ((select auth.uid()), now(), now())');
    expect(migration).not.toMatch(/reserve_ai_advice_request\s*\([^)]*user_id/i);
  });

  it('PK・auth.users FK・RLS・直接権限revoke・限定executeを定義', () => {
    expect(migration).toContain('user_id uuid primary key references auth.users(id) on delete cascade');
    expect(migration).toContain('alter table public.ai_advice_rate_limits enable row level security');
    expect(migration).toContain('revoke all on public.ai_advice_rate_limits from anon, authenticated');
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('revoke all on function public.reserve_ai_advice_request() from public, anon');
    expect(migration).toContain('grant execute on function public.reserve_ai_advice_request() to authenticated');
  });

  it('同一ユーザーの同時予約は1件だけ成功し別ユーザーは独立', async () => {
    const store = new AtomicReservationModel(); const now = Date.parse('2026-07-15T00:00:00Z');
    const sameUser = await Promise.all([Promise.resolve().then(() => store.reserve('user-a', now)), Promise.resolve().then(() => store.reserve('user-a', now))]);
    expect(sameUser.sort()).toEqual([false, true]); expect(store.reserve('user-b', now)).toBe(true);
  });

  it.each([[29_900, false], [30_000, true], [30_100, true]] as const)('%dms後の境界を判定', (elapsed, expected) => {
    const store = new AtomicReservationModel(); const start = Date.parse('2026-07-15T00:00:00Z'); expect(store.reserve('user-a', start)).toBe(true); expect(store.reserve('user-a', start + elapsed)).toBe(expected);
  });

  it('クライアント時刻・result_summary改ざんでは迂回できず未認証を拒否', () => {
    const store = new AtomicReservationModel(); const now = Date.parse('2026-07-15T00:00:00Z'); expect(store.reserve('user-a', now)).toBe(true);
    expect(store.reserve('user-a', now + 1_000, { clientNow: now + 365 * 24 * 60 * 60 * 1000, resultSummary: { created_at: '1900-01-01', engine_version: 'safe' } })).toBe(false);
    expect(store.reserve(null, now)).toBe(false);
  });
});
