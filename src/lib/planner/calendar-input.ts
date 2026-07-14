import { CalendarClientError } from '@/lib/calendar/client';
import type { CalendarConnectionStatus, ExternalCalendarEvent } from '@/types/calendar';
import type { PlanningWindow } from '@/types/planning';

const NO_CALENDAR_WARNING = 'Google Calendar未接続のため、外部予定を反映していません。';

interface Dependencies {
  getConnection(signal: AbortSignal): Promise<CalendarConnectionStatus>;
  getEvents(start: string, end: string, signal: AbortSignal): Promise<{ events: ExternalCalendarEvent[] }>;
}

export async function resolvePlanningCalendarInput(isAuthenticated: boolean, window: PlanningWindow, signal: AbortSignal, dependencies: Dependencies): Promise<{ events: ExternalCalendarEvent[]; warnings: string[] }> {
  if (!isAuthenticated) return { events: [], warnings: [NO_CALENDAR_WARNING] };
  let connection: CalendarConnectionStatus;
  try { connection = await dependencies.getConnection(signal); }
  catch (error) {
    if (error instanceof CalendarClientError && error.code === 'AUTH_REQUIRED') throw new Error('ログイン状態を確認できません。再ログインしてから計画を作成してください。');
    throw new Error('Google Calendarの接続状態を確認できないため、計画を作成できませんでした。');
  }
  if (connection.needsReconnect) throw new Error('Google Calendarを再接続してから計画案を作成してください。');
  if (!connection.connected) return { events: [], warnings: [NO_CALENDAR_WARNING] };
  try { return { events: (await dependencies.getEvents(window.start, window.end, signal)).events, warnings: [] }; }
  catch (error) {
    if (error instanceof CalendarClientError && error.code === 'AUTH_REQUIRED') throw new Error('ログイン状態を確認できません。再ログインしてから計画を作成してください。');
    if (error instanceof CalendarClientError && error.code === 'RECONNECT_REQUIRED') throw new Error('Google Calendarを再接続してから計画案を作成してください。');
    throw new Error('Google Calendar予定を取得できないため、計画を作成できませんでした。');
  }
}

export class PlanningRequestCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;
  begin(): { generation: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return { generation: this.generation, signal: this.controller.signal };
  }
  isCurrent(generation: number): boolean { return generation === this.generation && !this.controller?.signal.aborted; }
  finish(generation: number): void { if (generation === this.generation) this.controller = null; }
  abort(): void { this.controller?.abort(); this.controller = null; this.generation += 1; }
}
