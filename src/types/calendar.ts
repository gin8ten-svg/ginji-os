export const GOOGLE_CALENDAR_EVENT_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events' as const;
export const GOOGLE_CALENDAR_SCOPES = [
  GOOGLE_CALENDAR_EVENT_WRITE_SCOPE,
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

export function hasGoogleCalendarEventWriteScope(scopes: readonly string[]): boolean {
  return scopes.includes(GOOGLE_CALENDAR_EVENT_WRITE_SCOPE);
}

export interface CalendarConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
  selectedCalendarIds: string[];
  needsReconnect: boolean;
  canWriteEvents: boolean;
}

export interface GoogleCalendarSummary {
  calendarId: string;
  summary: string;
  primary: boolean;
  selected: boolean;
  backgroundColor: string | null;
  accessRole: 'freeBusyReader' | 'reader' | 'writerWithoutPrivateAccess' | 'writer' | 'owner' | 'unknown';
  writable: boolean;
}

export interface ExternalCalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: 'confirmed' | 'tentative';
  htmlLink: string | null;
  colorId: string | null;
}
