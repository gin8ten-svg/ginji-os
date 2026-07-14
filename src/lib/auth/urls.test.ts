import { describe, expect, it } from 'vitest';
import { authCallbackUrl, calendarCallbackUrl } from './urls';
import { calendarGoogleOAuthOptions, normalGoogleOAuthOptions } from './oauth-options';

describe('authCallbackUrl', () => {
  it('現在のoriginからcallback URLを作る', () => {
    expect(authCallbackUrl('https://ginji-os.vercel.app')).toBe('https://ginji-os.vercel.app/auth/callback');
  });

  it('末尾スラッシュを重複させない', () => {
    expect(authCallbackUrl('https://preview.example.com/')).toBe('https://preview.example.com/auth/callback');
  });

  it('Calendar追加同意だけを専用flowへ戻す', () => {
    expect(calendarCallbackUrl('https://preview.example.com')).toBe('https://preview.example.com/auth/callback?flow=calendar');
  });

  it('通常ログインではCalendar scopeやoffline同意を要求しない', () => {
    expect(normalGoogleOAuthOptions('https://app.example')).toEqual({ redirectTo: 'https://app.example/auth/callback' });
    expect(normalGoogleOAuthOptions('https://app.example')).not.toHaveProperty('scopes');
  });

  it('Calendar接続時だけread-only scopeとoffline同意を要求する', () => {
    const options = calendarGoogleOAuthOptions('https://app.example');
    expect(options.scopes).toContain('calendar.events.readonly');
    expect(options.scopes).toContain('calendar.calendarlist.readonly');
    expect(options.queryParams).toEqual({ access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' });
  });
});
