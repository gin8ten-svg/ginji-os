import { describe, expect, it } from 'vitest';
import { repositoryMode } from './repository-mode';

describe('repositoryMode', () => {
  it('設定済みかつ認証済みだけSupabaseを選ぶ', () => {
    expect(repositoryMode(true, 'user-id')).toBe('supabase');
  });

  it('未認証または環境変数未設定ならLocalを選ぶ', () => {
    expect(repositoryMode(true, null)).toBe('local');
    expect(repositoryMode(false, 'user-id')).toBe('local');
  });
});
