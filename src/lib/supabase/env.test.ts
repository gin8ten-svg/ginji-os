import { describe, expect, it } from 'vitest';
import { parseSupabasePublicEnv } from './env';

describe('parseSupabasePublicEnv', () => {
  it('未設定時はnullを返す', () => {
    expect(parseSupabasePublicEnv(undefined, undefined)).toBeNull();
    expect(parseSupabasePublicEnv('https://example.supabase.co', undefined)).toBeNull();
  });

  it('公開URLとpublishable keyだけを返す', () => {
    expect(parseSupabasePublicEnv('https://example.supabase.co', 'sb_publishable_test'))
      .toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
  });
});
