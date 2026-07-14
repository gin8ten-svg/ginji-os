import { authCallbackUrl, calendarCallbackUrl } from '@/lib/auth/urls';
import { GOOGLE_CALENDAR_SCOPES } from '@/types/calendar';

export function normalGoogleOAuthOptions(origin: string) {
  return { redirectTo: authCallbackUrl(origin) };
}

export function calendarGoogleOAuthOptions(origin: string) {
  return {
    redirectTo: calendarCallbackUrl(origin),
    scopes: GOOGLE_CALENDAR_SCOPES.join(' '),
    queryParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  };
}
