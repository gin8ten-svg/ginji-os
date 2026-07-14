export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

export interface CalendarConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
  selectedCalendarIds: string[];
  needsReconnect: boolean;
}

export interface GoogleCalendarSummary {
  calendarId: string;
  summary: string;
  primary: boolean;
  selected: boolean;
  backgroundColor: string | null;
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
