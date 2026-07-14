import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CALENDAR_OAUTH_COOKIE = 'ginji_calendar_oauth';
export const CALENDAR_OAUTH_MAX_AGE_SECONDS = 600;

interface CalendarOAuthState { userId: string; issuedAt: number; nonce: string }

function secret(): string {
  const value = process.env.CALENDAR_OAUTH_STATE_SECRET;
  if (!value || value.length < 32) throw new Error('Calendar OAuth state is not configured.');
  return value;
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createCalendarOAuthState(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ userId, issuedAt: now, nonce: randomBytes(18).toString('base64url') } satisfies CalendarOAuthState)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyCalendarOAuthState(value: string | undefined, expectedUserId: string, now = Date.now()): boolean {
  if (!value) return false;
  try {
    const [payload, supplied, extra] = value.split('.');
    if (!payload || !supplied || extra) return false;
    const expected = signature(payload);
    const suppliedBytes = Buffer.from(supplied, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return false;
    const state = parsed as Partial<CalendarOAuthState>;
    return state.userId === expectedUserId
      && typeof state.issuedAt === 'number'
      && state.issuedAt <= now
      && now - state.issuedAt <= CALENDAR_OAUTH_MAX_AGE_SECONDS * 1_000
      && typeof state.nonce === 'string'
      && /^[A-Za-z0-9_-]{24}$/.test(state.nonce);
  } catch { return false; }
}
