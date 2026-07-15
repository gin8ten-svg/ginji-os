import { describe, expect, it, vi } from 'vitest';
import { CalendarClientError } from '@/lib/calendar/client';
import { PlanningIdempotencyKey, PlanningRequestCoordinator, resolvePlanningCalendarInput } from '@/lib/planner/calendar-input';
import { createPlanningWindow } from '@/lib/planner/engine';

const window = createPlanningWindow(new Date('2026-07-15T00:00:00.000Z'));
const status = (connected: boolean, needsReconnect = false) => ({ connected, needsReconnect, connectedAt: null, selectedCalendarIds: [] });
const dependencies = (connection = status(true), events: never[] = []) => ({ getConnection: vi.fn(async () => connection), getEvents: vi.fn(async () => ({ events })) });

describe('Planning Calendar input policy', () => {
  it('Local modeとログイン済み未接続は警告付きで空イベントを返す', async () => {
    const local = await resolvePlanningCalendarInput(false, window, new AbortController().signal, dependencies());
    const disconnected = await resolvePlanningCalendarInput(true, window, new AbortController().signal, dependencies(status(false)));
    expect(local.warnings[0]).toContain('外部予定を反映していません');
    expect(disconnected.warnings).toEqual(local.warnings);
  });
  it('401セッション失効とneedsReconnectは計画を停止する', async () => {
    const auth = dependencies(); auth.getConnection.mockRejectedValue(new CalendarClientError('raw', 'AUTH_REQUIRED'));
    await expect(resolvePlanningCalendarInput(true, window, new AbortController().signal, auth)).rejects.toThrow('再ログイン');
    await expect(resolvePlanningCalendarInput(true, window, new AbortController().signal, dependencies(status(true, true)))).rejects.toThrow('再接続');
  });
  it('events失敗は計画を停止し正常取得だけを返す', async () => {
    const failed = dependencies(); failed.getEvents.mockRejectedValue(new CalendarClientError('provider raw', 'CALENDAR_FETCH_FAILED'));
    await expect(resolvePlanningCalendarInput(true, window, new AbortController().signal, failed)).rejects.toThrow('取得できない');
    await expect(resolvePlanningCalendarInput(true, window, new AbortController().signal, dependencies())).resolves.toEqual({ events: [], warnings: [] });
  });
});

describe('Planning request coordination', () => {
  it('新しいrequestが前回をabortし最新generationだけを許可する', () => {
    const coordinator = new PlanningRequestCoordinator(); const first = coordinator.begin(); const second = coordinator.begin();
    expect(first.signal.aborted).toBe(true); expect(coordinator.isCurrent(first.generation)).toBe(false); expect(coordinator.isCurrent(second.generation)).toBe(true);
  });
  it('abortされたrequestをcurrentにせずerror反映を防ぐ', () => {
    const coordinator = new PlanningRequestCoordinator(); const request = coordinator.begin(); coordinator.abort();
    expect(request.signal.aborted).toBe(true); expect(coordinator.isCurrent(request.generation)).toBe(false);
  });
  it('失敗後のretryは同じkey、成功後の明示再計算は新しいkeyを使う', () => {
    const values = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']; let index = 0; const keys = new PlanningIdempotencyKey(() => values[index++]);
    const first = keys.forRetryableOperation(); expect(keys.forRetryableOperation()).toBe(first); keys.complete(); expect(keys.forRetryableOperation()).toBe(values[1]);
  });
});
