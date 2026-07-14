export function authCallbackUrl(origin: string): string {
  return new URL('/auth/callback', origin).toString();
}

export function calendarCallbackUrl(origin: string): string {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('flow', 'calendar');
  return url.toString();
}

export function safeAuthDestination(flow: string | null): '/calendar' | '/today' {
  return flow === 'calendar' ? '/calendar' : '/today';
}
