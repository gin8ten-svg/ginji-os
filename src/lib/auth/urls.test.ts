import { describe, expect, it } from 'vitest';
import { authCallbackUrl } from './urls';

describe('authCallbackUrl', () => {
  it('現在のoriginからcallback URLを作る', () => {
    expect(authCallbackUrl('https://ginji-os.vercel.app')).toBe('https://ginji-os.vercel.app/auth/callback');
  });

  it('末尾スラッシュを重複させない', () => {
    expect(authCallbackUrl('https://preview.example.com/')).toBe('https://preview.example.com/auth/callback');
  });
});
