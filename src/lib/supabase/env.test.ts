import { describe, expect, it } from 'vitest';
import { getSupabasePublicEnv } from './env';

describe('getSupabasePublicEnv', () => {
  it('未設定時はnullを返す', () => {
    expect(getSupabasePublicEnv({})).toBeNull();
    expect(getSupabasePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' })).toBeNull();
  });

  it('公開URLとpublishable keyだけを返す', () => {
    expect(getSupabasePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }))
      .toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
  });
});
