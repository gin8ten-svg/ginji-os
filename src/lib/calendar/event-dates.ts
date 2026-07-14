import type { ExternalCalendarEvent } from '@/types/calendar';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function datesCoveredByAllDayEvent(start: string, exclusiveEnd: string): string[] {
  if (!validDateKey(start) || !validDateKey(exclusiveEnd) || exclusiveEnd <= start) return [];
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const end = new Date(`${exclusiveEnd}T00:00:00Z`);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function externalEventCoversDate(event: ExternalCalendarEvent, date: string): boolean {
  return event.allDay ? datesCoveredByAllDayEvent(event.start, event.end).includes(date) : false;
}
