export function authCallbackUrl(origin: string): string {
  return new URL('/auth/callback', origin).toString();
}
