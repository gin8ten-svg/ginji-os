import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { CalendarEventAlreadyExistsError, CalendarServiceError, type GoogleCalendarEventWriteInput } from '@/lib/calendar/google-api';
import { approvePlanningSession, completePlanningTimeBlock, createAdvisedPlanningSession, createPlanningSession, deletePlanningBlock, getAiAdviceUsageSummary, getPlanningCalendarEventPreview, getPlanningDailyReview, getPlanningEstimationAccuracy, getPlanningExecutionPreview, getPlanningExecutionReview, getPlanningSession, getPlanningSessionCalendarEventManagementPreview, mutatePlanningSessionCalendarEvents, planningFreshnessReason, planningGoogleEventId, regeneratePlanningSession, rejectPlanningSession, skipPlanningTimeBlock, updatePlanningBlockTask, updatePlanningBlockTime, writePlanningSessionToCalendar } from '@/lib/planning/server';
import { buildPlanningInputSnapshotV2, hashPlanningInputSnapshotV2, PLANNING_ENGINE_VERSION, type PlanningInputSnapshotV2 } from '@/lib/planning/input-snapshot-v2';
import { buildPlanningResult } from '@/lib/planner/engine';
import { AI_ADVISOR_VERSION } from '@/lib/planning/advisor';
import { PlanningApiError } from '@/lib/planning/responses';
import type { Database, Json, PlanningBlockRow, PlanningSessionRow } from '@/types/database';
import type { PlanningResult, ProposedTimeBlock } from '@/types/planning';
import type { TaskStore } from '@/types/tasks';

type Operation = 'select' | 'insert' | 'delete';
type QueryResult = { data: unknown; error: { message: string } | null };
type Call = { table: string; operation: Operation; payload?: unknown; filters: Array<[string, unknown]> };

class StubQuery implements PromiseLike<QueryResult> {
  private operation: Operation = 'select';
  private readonly filters: Array<[string, unknown]> = [];
  private recorded = false;
  constructor(private readonly owner: FakeSupabase, private readonly table: string) {}
  private record(operation: Operation, payload?: unknown) { this.operation = operation; if (!this.recorded) { this.owner.calls.push({ table: this.table, operation, payload, filters: this.filters }); this.recorded = true; } return this; }
  select() { return this.recorded ? this : this.record('select'); }
  insert(payload: unknown) { return this.record('insert', payload); }
  delete() { return this.record('delete'); }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  in(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  not(column: string, operator: string, value: unknown) { this.filters.push([column, `not.${operator}.${String(value)}`]); return this; }
  gte(column: string, value: unknown) { this.filters.push([`${column}.gte`, value]); return this; }
  lt(column: string, value: unknown) { this.filters.push([`${column}.lt`, value]); return this; }
  order() { return this; }
  limit() { return this; }
  single() { return Promise.resolve(this.owner.result(this.table, this.operation)); }
  maybeSingle() { return Promise.resolve(this.owner.result(this.table, this.operation)); }
  then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return Promise.resolve(this.owner.result(this.table, this.operation)).then(onfulfilled, onrejected); }
}

class FakeSupabase {
  readonly calls: Call[] = [];
  readonly rpcCalls: Array<{ name: string; args: unknown }> = [];
  private readonly results = new Map<string, QueryResult[]>();
  private readonly rpcResults: QueryResult[] = [];
  queue(table: string, operation: Operation, result: QueryResult) { const key = `${table}:${operation}`; this.results.set(key, [...(this.results.get(key) ?? []), result]); }
  queueRpc(result: QueryResult) { this.rpcResults.push(result); }
  result(table: string, operation: Operation) { const key = `${table}:${operation}`; const values = this.results.get(key) ?? []; const result = values.shift(); this.results.set(key, values); return result ?? { data: [], error: null }; }
  client(): SupabaseClient<Database> { return { from: (table: string) => new StubQuery(this, table), rpc: async (name: string, args?: unknown) => { this.rpcCalls.push({ name, args }); return this.rpcResults.shift() ?? { data: null, error: null }; } } as unknown as SupabaseClient<Database>; }
}

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-07-15T00:00:00.000Z';
const snapshot: PlanningInputSnapshotV2 = { schemaVersion: 'planning-input-v2', engineVersion: PLANNING_ENGINE_VERSION, window: { start: '2026-07-14T23:00:00.000Z', end: '2026-07-21T13:00:00.000Z', timeZone: 'Asia/Tokyo', workdayStart: '08:00', workdayEnd: '22:00', minimumSlotMinutes: 25, dates: ['2026-07-15'] }, now: '2026-07-15T00:00:00.000Z', tasks: [{ id: '33333333-3333-4333-8333-333333333333', title: 'Task', dueAt: null, priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: false, minimumBlockMinutes: 25, completedAt: null, updatedAt: createdAt }], routines: [], completions: [], busy: [] };
const hash = hashPlanningInputSnapshotV2(snapshot);
const block: ProposedTimeBlock = { id: 'block', source: 'task', taskId: '33333333-3333-4333-8333-333333333333', routineId: null, title: 'Task', start: '2026-07-15T02:00:00.000Z', end: '2026-07-15T03:00:00.000Z', splitIndex: 1 };
const sessionRow = (status: PlanningSessionRow['status'] = 'draft', manuallyEdited = false): PlanningSessionRow => ({ id: sessionId, user_id: userId, status, window_start: '2026-07-14T23:00:00.000Z', window_end: '2026-07-21T13:00:00.000Z', input_now: '2026-07-15T00:00:00.000Z', input_hash: hash, engine_version: PLANNING_ENGINE_VERSION, warning_codes: [], result_summary: { unscheduledTasks: [], unscheduledRoutines: [] }, created_at: createdAt, updated_at: createdAt, approved_at: status === 'approved' ? '2026-07-15T00:30:00.000Z' : null, rejected_at: status === 'rejected' ? '2026-07-15T00:30:00.000Z' : null, idempotency_key: null, blocks_revision: 1, input_snapshot_version: 'planning-input-v2', input_snapshot: snapshot as unknown as Json, manually_edited: manuallyEdited });
const blockRow: PlanningBlockRow = { id: '44444444-4444-4444-8444-444444444444', planning_session_id: sessionId, user_id: userId, source_type: 'task', source_entity_id: block.taskId!, title: block.title, start_at: block.start, end_at: block.end, block_index: 1, duration_minutes: 60, metadata: {}, created_at: createdAt };
const store: TaskStore = { version: 1, tasks: [{ id: block.taskId!, title: 'Task', description: '', dueAt: null, priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: false, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt, updatedAt: createdAt, source: 'user' }], routines: [], routineCompletions: [] };
const result: PlanningResult = { window: { start: sessionRow().window_start, end: sessionRow().window_end, timeZone: 'Asia/Tokyo', workdayStart: '08:00', workdayEnd: '22:00', minimumSlotMinutes: 25, dates: ['2026-07-15'] }, busyIntervals: [], freeSlots: [], proposedBlocks: [block], unscheduledTasks: [], unscheduledRoutines: [], warnings: [] };
const validAdviceForServer = { orderedSourceIds: ['task_1'], explanationBySourceId: { task_1: 'safe reason' }, globalSummary: 'safe', warnings: [] };
const dependencies = (now = new Date('2026-07-15T01:00:00.000Z'), inputHash = hash, planningResult = result, inputSnapshot = snapshot) => ({ now: () => now, loadCurrentInput: async () => ({ store, events: [], result: planningResult, warningCodes: [], snapshot: inputSnapshot, hash: inputHash }) });
const queueGet = (fake: FakeSupabase, session: PlanningSessionRow | null, blocks: PlanningBlockRow[] = [blockRow]) => { fake.queue('planning_sessions', 'select', { data: session, error: null }); fake.queue('planning_blocks', 'select', { data: blocks, error: null }); };
const writableCalendar = { calendarId: 'primary', summary: 'Main', primary: true, selected: true, backgroundColor: null, accessRole: 'owner' as const, writable: true };
const writeDependencies = (createEvent: (input: GoogleCalendarEventWriteInput) => Promise<ReturnType<typeof writtenEvent>> = async (input) => writtenEvent(input), planningResult = result) => ({ ...dependencies(new Date('2026-07-15T01:00:00.000Z'), hash, planningResult), calendarAccess: async () => ({ userId, accessToken: 'access-token', connection: { user_id: userId, granted_scopes: ['https://www.googleapis.com/auth/calendar.events'], selected_calendar_ids: ['primary'], needs_reconnect: false, connected_at: createdAt, updated_at: createdAt } }), listCalendars: async () => [writableCalendar], createEvent: async (_calendarId: string, _accessToken: string, input: GoogleCalendarEventWriteInput) => createEvent(input), getEvent: async (_calendarId: string, eventId: string) => writtenEvent({ eventId, title: 'Task', start: block.start, end: block.end, timeZone: 'Asia/Tokyo' }) });
function writtenEvent(input: GoogleCalendarEventWriteInput) { return { id: input.eventId, title: input.title, start: input.start, end: input.end, status: 'confirmed' as const, writeKey: input.eventId, etag: '"event-etag"' }; }
const queueWriteValidation = (fake: FakeSupabase, blocks: PlanningBlockRow[] = [blockRow], knownWrites: unknown[] = []) => { fake.queue('time_blocks', 'select', { data: knownWrites, error: null }); queueGet(fake, sessionRow('approved'), blocks); fake.queue('planning_sessions', 'select', { data: { status: 'approved', blocks_revision: 1 }, error: null }); };
const managedRow = { planning_block_id: blockRow.id, google_calendar_id: 'primary', google_event_id: planningGoogleEventId(userId, sessionId, blockRow.id), start_at: block.start, end_at: block.end, calendar_write_status: 'succeeded' as const, calendar_event_state: 'active' as const };

describe('planning session freshness', () => {
  const session = sessionRow();
  it('23時間59分後は有効', () => expect(planningFreshnessReason(session, [], new Date('2026-07-15T23:59:00.000Z'))).toBeNull());
  it('24時間以上で期限切れ', () => expect(planningFreshnessReason(session, [], new Date('2026-07-16T00:00:00.000Z'))).toBe('SESSION_EXPIRED'));
  it('window_end以降は期限切れ', () => expect(planningFreshnessReason({ ...session, created_at: '2026-07-21T12:00:00Z' }, [], new Date(session.window_end))).toBe('WINDOW_EXPIRED'));
  it('ブロック開始前は有効', () => expect(planningFreshnessReason(session, [block], new Date('2026-07-15T01:59:00Z'))).toBeNull());
  it('開始から5分以内は許容', () => expect(planningFreshnessReason(session, [block], new Date('2026-07-15T02:05:00Z'))).toBeNull());
  it('開始から5分超過はstale', () => expect(planningFreshnessReason(session, [block], new Date('2026-07-15T02:05:00.001Z'))).toBe('BLOCK_ALREADY_STARTED'));
  it('終了済みblockはstale', () => expect(planningFreshnessReason(session, [block], new Date(block.end))).toBe('BLOCK_ALREADY_ENDED'));
});

describe('planning server runtime workflows', () => {
  it('sessionとblocksをowner値で保存しdraftを返す', async () => {
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'select', { data: null, error: null }); fake.queueRpc({ data: sessionId, error: null }); queueGet(fake, sessionRow());
    const detail = await createPlanningSession(fake.client(), userId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dependencies());
    expect(detail.status).toBe('draft'); expect(detail.blocks).toHaveLength(1);
    expect(fake.rpcCalls[0]).toMatchObject({ name: 'create_planning_session_v2', args: { p_idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_input_snapshot_version: 'planning-input-v2' } });
    expect(JSON.stringify(fake.rpcCalls[0])).not.toContain(userId);
    expect(JSON.stringify(detail)).not.toMatch(/user_id|token|secret/i);
  });
  it('原子的保存RPC失敗を秘匿し中途半端なcleanupを行わない', async () => {
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'select', { data: null, error: null }); fake.queueRpc({ data: null, error: { message: 'database token owner@example.com' } });
    await expect(createPlanningSession(fake.client(), userId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dependencies())).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', message: '計画案を保存できませんでした。' });
    expect(fake.calls.some((item) => item.operation === 'delete')).toBe(false);
  });
  it('同じuserとkeyは既存sessionを入力再取得前に返す', async () => {
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'select', { data: { id: sessionId, input_snapshot_version: 'planning-input-v2' }, error: null }); queueGet(fake, sessionRow()); let inputCalls = 0;
    const detail = await createPlanningSession(fake.client(), userId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { ...dependencies(), loadCurrentInput: async () => { inputCalls += 1; return dependencies().loadCurrentInput(); } });
    expect(detail.sessionId).toBe(sessionId); expect(inputCalls).toBe(0); expect(fake.rpcCalls).toHaveLength(0);
  });
  it('legacy idempotency conflictをV2 Sessionとして返さない', async () => {
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'select', { data: { id: sessionId, input_snapshot_version: null }, error: null });
    await expect(createPlanningSession(fake.client(), userId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dependencies())).rejects.toMatchObject({ code: 'PLAN_STALE' });
    expect(fake.rpcCalls).toHaveLength(0);
  });
  it('同時2POSTのDB競合結果が同じsessionIdなら同じ保存内容を返す', async () => {
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'select', { data: null, error: null }); fake.queue('planning_sessions', 'select', { data: null, error: null }); fake.queueRpc({ data: sessionId, error: null }); fake.queueRpc({ data: sessionId, error: null }); queueGet(fake, sessionRow()); queueGet(fake, sessionRow());
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const values = await Promise.all([createPlanningSession(fake.client(), userId, key, dependencies()), createPlanningSession(fake.client(), userId, key, dependencies())]);
    expect(values[0]).toEqual(values[1]); expect(fake.rpcCalls.filter((item) => item.name === 'create_planning_session_v2')).toHaveLength(2);
  });
  it('sessionとblocksの両方をuser_idで取得しsnapshot内部値を返さない', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow());
    const detail = await getPlanningSession(fake.client(), userId, sessionId);
    expect(detail.sessionId).toBe(sessionId); expect(JSON.stringify(detail)).not.toMatch(/input_now|result_summary|user_id|blocks_revision/);
    fake.calls.forEach((call) => expect(call.filters).toContainEqual(['user_id', userId]));
  });
  it('他ユーザー相当の空結果はPLAN_NOT_FOUND', async () => { const fake = new FakeSupabase(); queueGet(fake, null, []); await expect(getPlanningSession(fake.client(), userId, sessionId)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' }); });
  it('実行PreviewはV2 snapshot由来titleとown task blockだけを返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_sessions', 'select', { data: sessionRow('approved'), error: null });
    fake.queue('planning_blocks', 'select', { data: [{ ...blockRow, title: '未信頼title' }], error: null });
    fake.queue('time_blocks', 'select', { data: [{ planning_block_id: blockRow.id, task_id: block.taskId, start_at: block.start, end_at: block.end, status: 'approved', actual_minutes: null }], error: null });
    const preview = await getPlanningExecutionPreview(fake.client(), userId, sessionId);
    expect(preview).toEqual({ sessionId, status: 'approved', timeZone: 'Asia/Tokyo', blocks: [{ planningBlockId: blockRow.id, taskId: block.taskId, title: 'Task', start: block.start, end: block.end, plannedMinutes: 60, status: 'approved', actualMinutes: null }] });
    fake.calls.forEach((call) => expect(call.filters).toContainEqual(['user_id', userId]));
  });
  it('V2 snapshotが無い旧形式Sessionでも現在のtask titleへfallbackして実行Previewを返す', async () => {
    const fake = new FakeSupabase();
    const legacy = { ...sessionRow('approved'), input_snapshot_version: null, input_snapshot: null, engine_version: 'deterministic-v1' };
    fake.queue('planning_sessions', 'select', { data: legacy, error: null });
    fake.queue('planning_blocks', 'select', { data: [blockRow], error: null });
    fake.queue('time_blocks', 'select', { data: [{ planning_block_id: blockRow.id, task_id: block.taskId, start_at: block.start, end_at: block.end, status: 'approved', actual_minutes: null }], error: null });
    fake.queue('tasks', 'select', { data: [{ id: block.taskId, title: '現在のtitle' }], error: null });
    const preview = await getPlanningExecutionPreview(fake.client(), userId, sessionId);
    expect(preview).toEqual({ sessionId, status: 'approved', timeZone: 'Asia/Tokyo', blocks: [{ planningBlockId: blockRow.id, taskId: block.taskId, title: '現在のtitle', start: block.start, end: block.end, plannedMinutes: 60, status: 'approved', actualMinutes: null }] });
    fake.calls.forEach((call) => expect(call.filters).toContainEqual(['user_id', userId]));
  });
  it('実行完了RPC結果を正規化しuser IDを引数へ渡さない', async () => {
    const fake = new FakeSupabase(); fake.queueRpc({ data: { result: 'COMPLETED', status: 'completed', actual_minutes: 45, task_completed: true }, error: null });
    await expect(completePlanningTimeBlock(fake.client(), sessionId, blockRow.id, 45)).resolves.toEqual({ planningBlockId: blockRow.id, status: 'completed', actualMinutes: 45, outcome: 'completed', taskCompleted: true });
    expect(fake.rpcCalls[0]).toEqual({ name: 'complete_planning_time_block', args: { p_session_id: sessionId, p_block_id: blockRow.id, p_actual_minutes: 45 } });
    expect(JSON.stringify(fake.rpcCalls[0])).not.toContain(userId);
  });
  it('実行対象なし・完了不可を構造化errorへ変換する', async () => {
    const missing = new FakeSupabase(); missing.queueRpc({ data: { result: 'NOT_FOUND' }, error: null });
    await expect(completePlanningTimeBlock(missing.client(), sessionId, blockRow.id, null)).rejects.toMatchObject({ code: 'TIME_BLOCK_NOT_FOUND', status: 404 });
    const invalid = new FakeSupabase(); invalid.queueRpc({ data: { result: 'NOT_COMPLETABLE' }, error: null });
    await expect(completePlanningTimeBlock(invalid.client(), sessionId, blockRow.id, null)).rejects.toMatchObject({ code: 'TIME_BLOCK_NOT_COMPLETABLE', status: 409 });
  });
  it('スキップRPC結果を正規化しuser IDを引数へ渡さない', async () => {
    const fake = new FakeSupabase(); fake.queueRpc({ data: { result: 'SKIPPED', status_reason: 'user_skipped' }, error: null });
    await expect(skipPlanningTimeBlock(fake.client(), sessionId, blockRow.id, 'user_skipped')).resolves.toEqual({ planningBlockId: blockRow.id, status: 'skipped', statusReason: 'user_skipped', outcome: 'skipped' });
    expect(fake.rpcCalls[0]).toEqual({ name: 'skip_planning_time_block', args: { p_session_id: sessionId, p_block_id: blockRow.id, p_reason: 'user_skipped' } });
    expect(JSON.stringify(fake.rpcCalls[0])).not.toContain(userId);
  });
  it('すでにスキップ済みのblockは既存の理由付きでALREADY_SKIPPEDを返す', async () => {
    const fake = new FakeSupabase(); fake.queueRpc({ data: { result: 'ALREADY_SKIPPED', status_reason: 'carried_over' }, error: null });
    await expect(skipPlanningTimeBlock(fake.client(), sessionId, blockRow.id, 'user_skipped')).resolves.toEqual({ planningBlockId: blockRow.id, status: 'skipped', statusReason: 'carried_over', outcome: 'already_skipped' });
  });
  it('スキップ対象なし・スキップ不可・未終了を構造化errorへ変換する', async () => {
    const missing = new FakeSupabase(); missing.queueRpc({ data: { result: 'NOT_FOUND' }, error: null });
    await expect(skipPlanningTimeBlock(missing.client(), sessionId, blockRow.id, 'user_skipped')).rejects.toMatchObject({ code: 'TIME_BLOCK_NOT_FOUND', status: 404 });
    const notSkippable = new FakeSupabase(); notSkippable.queueRpc({ data: { result: 'NOT_SKIPPABLE' }, error: null });
    await expect(skipPlanningTimeBlock(notSkippable.client(), sessionId, blockRow.id, 'user_skipped')).rejects.toMatchObject({ code: 'TIME_BLOCK_NOT_SKIPPABLE', status: 409 });
    const notYetEnded = new FakeSupabase(); notYetEnded.queueRpc({ data: { result: 'NOT_YET_ENDED' }, error: null });
    await expect(skipPlanningTimeBlock(notYetEnded.client(), sessionId, blockRow.id, 'carried_over')).rejects.toMatchObject({ code: 'TIME_BLOCK_NOT_YET_ENDED', status: 409 });
  });
  it('実行Reviewは今週分をAsia/Tokyoの日付境界で正しく集計し、未記録実績とcompleted以外を区別する', async () => {
    const fake = new FakeSupabase();
    fake.queue('time_blocks', 'select', {
      data: [
        { start_at: '2026-07-14T01:00:00.000Z', end_at: '2026-07-14T02:00:00.000Z', status: 'completed', actual_minutes: 50 },
        { start_at: '2026-07-14T05:00:00.000Z', end_at: '2026-07-14T05:30:00.000Z', status: 'approved', actual_minutes: null },
        { start_at: '2026-07-15T00:30:00.000Z', end_at: '2026-07-15T01:30:00.000Z', status: 'completed', actual_minutes: null },
        { start_at: '2026-07-13T14:59:00.000Z', end_at: '2026-07-13T15:29:00.000Z', status: 'approved', actual_minutes: null },
        { start_at: '2026-07-10T01:00:00.000Z', end_at: '2026-07-10T02:00:00.000Z', status: 'completed', actual_minutes: 999 },
      ],
      error: null,
    });
    const review = await getPlanningExecutionReview(fake.client(), userId, new Date('2026-07-16T00:30:00.000Z'));
    expect(review).toEqual({
      timeZone: 'Asia/Tokyo',
      days: [
        { date: '2026-07-13', plannedMinutes: 30, actualMinutes: 0, totalBlocks: 1, completedBlocks: 0, recordedActualBlocks: 0 },
        { date: '2026-07-14', plannedMinutes: 90, actualMinutes: 50, totalBlocks: 2, completedBlocks: 1, recordedActualBlocks: 1 },
        { date: '2026-07-15', plannedMinutes: 60, actualMinutes: 0, totalBlocks: 1, completedBlocks: 1, recordedActualBlocks: 0 },
        { date: '2026-07-16', plannedMinutes: 0, actualMinutes: 0, totalBlocks: 0, completedBlocks: 0, recordedActualBlocks: 0 },
      ],
    });
    const call = fake.calls.find((item) => item.table === 'time_blocks');
    expect(call?.filters).toEqual(expect.arrayContaining([
      ['user_id', userId],
      ['calendar_write_status', 'succeeded'],
      ['task_id', 'not.is.null'],
      ['start_at.gte', '2026-07-12T15:00:00.000Z'],
      ['start_at.lt', '2026-07-16T15:00:00.000Z'],
    ]));
  });
  it('日次Reviewは指定日のblockだけをtitle付きで返し、状態別に集計する', async () => {
    const fake = new FakeSupabase();
    fake.queue('time_blocks', 'select', {
      data: [
        { planning_block_id: 'block-1', task_id: 'task-1', start_at: '2026-07-15T00:00:00.000Z', end_at: '2026-07-15T01:00:00.000Z', status: 'completed', status_reason: null, actual_minutes: 50 },
        { planning_block_id: 'block-2', task_id: 'task-2', start_at: '2026-07-15T02:00:00.000Z', end_at: '2026-07-15T02:30:00.000Z', status: 'skipped', status_reason: 'carried_over', actual_minutes: null },
        { planning_block_id: 'block-3', task_id: 'task-3', start_at: '2026-07-15T05:00:00.000Z', end_at: '2026-07-15T06:00:00.000Z', status: 'approved', status_reason: null, actual_minutes: null },
      ],
      error: null,
    });
    fake.queue('planning_blocks', 'select', { data: [{ id: 'block-1', title: 'タスクA' }, { id: 'block-2', title: 'タスクB' }, { id: 'block-3', title: 'タスクC' }], error: null });
    const review = await getPlanningDailyReview(fake.client(), userId, '2026-07-15');
    expect(review).toEqual({
      date: '2026-07-15',
      timeZone: 'Asia/Tokyo',
      blocks: [
        { taskId: 'task-1', title: 'タスクA', start: '2026-07-15T00:00:00.000Z', end: '2026-07-15T01:00:00.000Z', plannedMinutes: 60, status: 'completed', statusReason: null, actualMinutes: 50 },
        { taskId: 'task-2', title: 'タスクB', start: '2026-07-15T02:00:00.000Z', end: '2026-07-15T02:30:00.000Z', plannedMinutes: 30, status: 'skipped', statusReason: 'carried_over', actualMinutes: null },
        { taskId: 'task-3', title: 'タスクC', start: '2026-07-15T05:00:00.000Z', end: '2026-07-15T06:00:00.000Z', plannedMinutes: 60, status: 'approved', statusReason: null, actualMinutes: null },
      ],
      summary: { completed: 1, skipped: 1, pending: 1, plannedMinutes: 150, actualMinutes: 50 },
    });
  });
  it('日次Reviewは不正な日付形式を400で拒否する', async () => {
    const fake = new FakeSupabase();
    await expect(getPlanningDailyReview(fake.client(), userId, '2026-13-40')).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
  });
  it('見積もり誤差は完了・実績記録済みblockだけをタスク単位で集計し、誤差の大きい順に上位を返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('time_blocks', 'select', {
      data: [
        { task_id: 'task-1', start_at: '2026-07-10T00:00:00.000Z', end_at: '2026-07-10T01:00:00.000Z', actual_minutes: 90 },
        { task_id: 'task-2', start_at: '2026-07-11T00:00:00.000Z', end_at: '2026-07-11T00:30:00.000Z', actual_minutes: 30 },
      ],
      error: null,
    });
    fake.queue('tasks', 'select', { data: [{ id: 'task-1', title: '重いタスク' }, { id: 'task-2', title: '軽いタスク' }], error: null });
    const summary = await getPlanningEstimationAccuracy(fake.client(), userId, new Date('2026-07-15T00:00:00.000Z'), 30);
    expect(summary).toEqual({
      rangeDays: 30,
      sampleSize: 2,
      totalPlannedMinutes: 90,
      totalActualMinutes: 120,
      averageVarianceMinutes: 15,
      averageVariancePercent: 33.3,
      overEstimatedCount: 0,
      underEstimatedCount: 1,
      accurateCount: 1,
      items: [{ taskId: 'task-1', title: '重いタスク', plannedMinutes: 60, actualMinutes: 90, varianceMinutes: 30 }, { taskId: 'task-2', title: '軽いタスク', plannedMinutes: 30, actualMinutes: 30, varianceMinutes: 0 }],
    });
  });
  it('見積もり誤差は実績記録なしの場合、空のsummaryを返す', async () => {
    const fake = new FakeSupabase(); fake.queue('time_blocks', 'select', { data: [], error: null });
    await expect(getPlanningEstimationAccuracy(fake.client(), userId)).resolves.toEqual({ rangeDays: 30, sampleSize: 0, totalPlannedMinutes: 0, totalActualMinutes: 0, averageVarianceMinutes: 0, averageVariancePercent: null, overEstimatedCount: 0, underEstimatedCount: 0, accurateCount: 0, items: [] });
  });
  it.each(['approved', 'rejected', 'superseded'] as const)('legacy %s Sessionは読み取りを維持し変更しない', async (status) => {
    const fake = new FakeSupabase(); const legacy = { ...sessionRow(status), input_snapshot_version: null, input_snapshot: null, engine_version: 'deterministic-v1' }; queueGet(fake, legacy);
    expect((await getPlanningSession(fake.client(), userId, sessionId)).status).toBe(status); expect(fake.rpcCalls).toHaveLength(0); expect(fake.calls.some((call) => call.operation !== 'select')).toBe(false);
  });
  it('承認済みV2を再検証しsnapshot由来titleだけでCalendar Previewを返す', async () => {
    const fake = new FakeSupabase();
    queueGet(fake, sessionRow('approved'), [{ ...blockRow, title: '保存block側の未信頼title' }]);
    fake.queue('planning_sessions', 'select', { data: { status: 'approved', blocks_revision: 1 }, error: null });
    const preview = await getPlanningCalendarEventPreview(fake.client(), userId, sessionId, dependencies());
    expect(preview).toEqual({ sessionId, status: 'approved', windowStart: snapshot.window.start, windowEnd: snapshot.window.end, timeZone: 'Asia/Tokyo', calendarId: null, events: [{ sourceType: 'task', sourceId: block.taskId, title: 'Task', start: block.start, end: block.end, blockIndex: 1, durationMinutes: 60, calendarState: 'not_created' }] });
    expect(JSON.stringify(preview)).not.toMatch(/input_snapshot|inputSnapshot|input_hash|inputHash|blocks_revision|user_id/);
    expect(fake.rpcCalls).toHaveLength(0); expect(fake.calls.every((call) => call.operation === 'select')).toBe(true);
    fake.calls.forEach((call) => expect(call.filters).toContainEqual(['user_id', userId]));
  });
  it.each(['draft', 'rejected', 'superseded'] as const)('%s SessionはCalendar Preview対象外', async (status) => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow(status)); let inputCalls = 0;
    await expect(getPlanningCalendarEventPreview(fake.client(), userId, sessionId, { ...dependencies(), loadCurrentInput: async () => { inputCalls += 1; return dependencies().loadCurrentInput(); } })).rejects.toMatchObject({ code: 'PLAN_NOT_APPROVED', status: 409 });
    expect(inputCalls).toBe(0); expect(fake.rpcCalls).toHaveLength(0);
  });
  it('legacy approved SessionをCalendar Previewで拒否する', async () => {
    const fake = new FakeSupabase(); queueGet(fake, { ...sessionRow('approved'), input_snapshot_version: null, input_snapshot: null, engine_version: 'deterministic-v1' });
    await expect(getPlanningCalendarEventPreview(fake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_STALE', message: expect.stringContaining('承認') });
    expect(fake.rpcCalls).toHaveLength(0);
  });
  it('snapshot改ざん・現在hash差分・blocks差分・freshness切れをCalendar Previewで拒否する', async () => {
    const changedSnapshot = { ...snapshot, tasks: [{ ...snapshot.tasks[0], title: 'Tampered' }] };
    const snapshotFake = new FakeSupabase(); queueGet(snapshotFake, { ...sessionRow('approved'), input_snapshot: changedSnapshot as unknown as Json });
    await expect(getPlanningCalendarEventPreview(snapshotFake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_INVALID' });

    const hashFake = new FakeSupabase(); queueGet(hashFake, sessionRow('approved'));
    await expect(getPlanningCalendarEventPreview(hashFake.client(), userId, sessionId, dependencies(new Date('2026-07-15T01:00:00Z'), 'b'.repeat(64)))).rejects.toMatchObject({ code: 'PLAN_STALE', message: expect.stringContaining('再度承認') });

    const blocksFake = new FakeSupabase(); queueGet(blocksFake, sessionRow('approved'));
    await expect(getPlanningCalendarEventPreview(blocksFake.client(), userId, sessionId, dependencies(new Date('2026-07-15T01:00:00Z'), hash, { ...result, proposedBlocks: [] }))).rejects.toMatchObject({ code: 'PLAN_INVALID' });

    const freshnessFake = new FakeSupabase(); queueGet(freshnessFake, sessionRow('approved'));
    await expect(getPlanningCalendarEventPreview(freshnessFake.client(), userId, sessionId, dependencies(new Date('2026-07-16T00:00:00Z')))).rejects.toMatchObject({ code: 'PLAN_STALE', message: expect.stringContaining('再度承認') });
  });
  it('Preview最終確認中にsupersededへ変わったSessionを返さない', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow('approved')); fake.queue('planning_sessions', 'select', { data: { status: 'superseded', blocks_revision: 1 }, error: null });
    await expect(getPlanningCalendarEventPreview(fake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_NOT_APPROVED' });
    expect(fake.rpcCalls).toHaveLength(0);
  });
  it('Calendar書き込み前に完全再検証しsnapshot titleと決定論的event IDだけを送る', async () => {
    const fake = new FakeSupabase(); queueWriteValidation(fake, [{ ...blockRow, title: '未信頼のblock title' }]);
    fake.queueRpc({ data: { result: 'RESERVED', attempt_token: '55555555-5555-4555-8555-555555555555' }, error: null }); fake.queueRpc({ data: 'FINISHED', error: null });
    const inputs: GoogleCalendarEventWriteInput[] = [];
    const response = await writePlanningSessionToCalendar(fake.client(), userId, sessionId, 'primary', writeDependencies(async (input) => { inputs.push(input); return writtenEvent(input); }));
    expect(response).toMatchObject({ status: 'completed', createdCount: 1, alreadyCreatedCount: 0, failedCount: 0 });
    expect(inputs).toEqual([{ eventId: planningGoogleEventId(userId, sessionId, blockRow.id), title: 'Task', start: block.start, end: block.end, timeZone: 'Asia/Tokyo' }]);
    expect(fake.rpcCalls[0]).toMatchObject({ name: 'reserve_calendar_event_write', args: { p_session_id: sessionId, p_block_id: blockRow.id, p_input_hash: hash, p_blocks_revision: 1, p_calendar_id: 'primary' } });
    expect(JSON.stringify(fake.rpcCalls)).not.toContain(userId); expect(JSON.stringify(response)).not.toMatch(/input_hash|blocks_revision|access-token/);
  });
  it('成功済みblockはGoogleへ再送せずidempotentに返す', async () => {
    const fake = new FakeSupabase(); queueWriteValidation(fake); fake.queueRpc({ data: { result: 'ALREADY_SUCCEEDED', google_event_id: planningGoogleEventId(userId, sessionId, blockRow.id) }, error: null }); let createCalls = 0;
    const response = await writePlanningSessionToCalendar(fake.client(), userId, sessionId, 'primary', writeDependencies(async (input) => { createCalls += 1; return writtenEvent(input); }));
    expect(response).toMatchObject({ status: 'completed', createdCount: 0, alreadyCreatedCount: 1 }); expect(createCalls).toBe(0); expect(fake.rpcCalls).toHaveLength(1);
  });
  it('再試行時はDBのCalendar/Event IDと時刻が一致する自己作成予定だけをcurrent hashから除外', async () => {
    const inputNow = new Date(snapshot.now);
    const cleanResult = buildPlanningResult({ now: inputNow, events: [], tasks: store.tasks, routines: store.routines, completions: store.routineCompletions });
    const cleanBlock = cleanResult.proposedBlocks[0];
    expect(cleanBlock).toBeDefined();
    const cleanSnapshot = buildPlanningInputSnapshotV2({ window: cleanResult.window, now: inputNow, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events: [] });
    const cleanHash = hashPlanningInputSnapshotV2(cleanSnapshot);
    const retrySession = { ...sessionRow('approved'), window_start: cleanResult.window.start, window_end: cleanResult.window.end, input_hash: cleanHash, input_snapshot: cleanSnapshot as unknown as Json };
    const retryBlockRow = { ...blockRow, start_at: cleanBlock.start, end_at: cleanBlock.end, block_index: cleanBlock.splitIndex, duration_minutes: (new Date(cleanBlock.end).getTime() - new Date(cleanBlock.start).getTime()) / 60_000 };
    const eventId = planningGoogleEventId(userId, sessionId, blockRow.id);
    const knownWrite = { google_calendar_id: 'primary', google_event_id: eventId, start_at: cleanBlock.start, end_at: cleanBlock.end };
    const selfEvent = { id: eventId, calendarId: 'primary', title: 'Task', start: cleanBlock.start, end: cleanBlock.end, allDay: false, status: 'confirmed' as const, htmlLink: null, colorId: null };
    const busyResult = buildPlanningResult({ now: inputNow, events: [selfEvent], tasks: store.tasks, routines: store.routines, completions: store.routineCompletions });
    const busySnapshot = buildPlanningInputSnapshotV2({ window: busyResult.window, now: inputNow, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events: [selfEvent] });
    const base = writeDependencies();
    const retryInput = { store, events: [selfEvent], result: busyResult, warningCodes: [], snapshot: busySnapshot, hash: hashPlanningInputSnapshotV2(busySnapshot) };
    const queueRetryValidation = (fake: FakeSupabase, event: typeof selfEvent) => {
      fake.queue('time_blocks', 'select', { data: [knownWrite], error: null });
      queueGet(fake, retrySession, [retryBlockRow]);
      fake.queue('planning_sessions', 'select', { data: { status: 'approved', blocks_revision: 1 }, error: null });
      return { ...base, now: () => inputNow, loadCurrentInput: async () => ({ ...retryInput, events: [event] }) };
    };

    const fake = new FakeSupabase(); const matchingDependencies = queueRetryValidation(fake, selfEvent); fake.queueRpc({ data: { result: 'ALREADY_SUCCEEDED' }, error: null });
    await expect(writePlanningSessionToCalendar(fake.client(), userId, sessionId, 'primary', matchingDependencies)).resolves.toMatchObject({ status: 'completed', alreadyCreatedCount: 1 });

    const mismatched = new FakeSupabase();
    const shiftedEvent = { ...selfEvent, start: new Date(new Date(selfEvent.start).getTime() + 60_000).toISOString() };
    const mismatchedDependencies = queueRetryValidation(mismatched, shiftedEvent);
    await expect(writePlanningSessionToCalendar(mismatched.client(), userId, sessionId, 'primary', mismatchedDependencies)).rejects.toMatchObject({ code: 'PLAN_STALE' });
    expect(mismatched.rpcCalls).toHaveLength(0);
  });
  it('Google成功後の通信断相当は同じevent IDの409を照合して成功確定する', async () => {
    const fake = new FakeSupabase(); queueWriteValidation(fake); fake.queueRpc({ data: { result: 'RESERVED', attempt_token: '55555555-5555-4555-8555-555555555555' }, error: null }); fake.queueRpc({ data: 'FINISHED', error: null });
    const response = await writePlanningSessionToCalendar(fake.client(), userId, sessionId, 'primary', writeDependencies(async () => { throw new CalendarEventAlreadyExistsError('duplicate'); }));
    expect(response).toMatchObject({ status: 'completed', createdCount: 0, alreadyCreatedCount: 1 }); expect(fake.rpcCalls[1]).toMatchObject({ name: 'complete_calendar_event_write', args: { p_success: true, p_after_data: { outcome: 'already_created' } } });
  });
  it('一部失敗を記録して後続blockを継続し成功分をロールバックしない', async () => {
    const secondBlock: ProposedTimeBlock = { ...block, id: 'second', start: '2026-07-15T03:00:00.000Z', end: '2026-07-15T03:30:00.000Z', splitIndex: 2 };
    const secondRow: PlanningBlockRow = { ...blockRow, id: '66666666-6666-4666-8666-666666666666', start_at: secondBlock.start, end_at: secondBlock.end, block_index: 2, duration_minutes: 30 };
    const fake = new FakeSupabase(); queueWriteValidation(fake, [blockRow, secondRow]);
    fake.queueRpc({ data: { result: 'RESERVED', attempt_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, error: null }); fake.queueRpc({ data: 'FINISHED', error: null });
    fake.queueRpc({ data: { result: 'RESERVED', attempt_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, error: null }); fake.queueRpc({ data: 'FINISHED', error: null });
    let providerCalls = 0;
    const response = await writePlanningSessionToCalendar(fake.client(), userId, sessionId, 'primary', writeDependencies(async (input) => { providerCalls += 1; if (providerCalls === 1) throw new CalendarServiceError('provider detail'); return writtenEvent(input); }, { ...result, proposedBlocks: [block, secondBlock] }));
    expect(response).toMatchObject({ status: 'partial', createdCount: 1, failedCount: 1, notAttemptedCount: 0 });
    expect(response.events.map((item) => item.writeStatus)).toEqual(['failed', 'created']);
    expect(fake.rpcCalls.filter((call) => call.name === 'complete_calendar_event_write').map((call) => (call.args as { p_success: boolean }).p_success)).toEqual([false, true]);
  });
  it('予定追加scope不足と計画時に未選択のCalendarをGoogle呼び出し前に拒否', async () => {
    const scopeFake = new FakeSupabase(); queueWriteValidation(scopeFake); let listCalls = 0;
    await expect(writePlanningSessionToCalendar(scopeFake.client(), userId, sessionId, 'primary', { ...writeDependencies(), calendarAccess: async () => ({ userId, accessToken: 'access', connection: { user_id: userId, granted_scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'], selected_calendar_ids: ['primary'], needs_reconnect: false, connected_at: createdAt, updated_at: createdAt } }), listCalendars: async () => { listCalls += 1; return [writableCalendar]; } })).rejects.toMatchObject({ code: 'CALENDAR_RECONNECT_REQUIRED' }); expect(listCalls).toBe(0); expect(scopeFake.rpcCalls).toHaveLength(0);
    const targetFake = new FakeSupabase(); queueWriteValidation(targetFake);
    await expect(writePlanningSessionToCalendar(targetFake.client(), userId, sessionId, 'other', writeDependencies())).rejects.toMatchObject({ code: 'CALENDAR_NOT_WRITABLE' }); expect(targetFake.rpcCalls).toHaveLength(0);
  });
  it('Calendar未選択時はGoogle Calendar Listが示す実IDのprimaryだけを許可', async () => {
    const primaryId = 'user@example.com';
    const fake = new FakeSupabase(); queueWriteValidation(fake); fake.queueRpc({ data: { result: 'ALREADY_SUCCEEDED' }, error: null });
    const base = writeDependencies();
    const noSelectionAccess = async () => { const access = await base.calendarAccess(); return { ...access, connection: { ...access.connection, selected_calendar_ids: [] } }; };
    const response = await writePlanningSessionToCalendar(fake.client(), userId, sessionId, primaryId, {
      ...base,
      calendarAccess: noSelectionAccess,
      listCalendars: async () => [{ ...writableCalendar, calendarId: primaryId, primary: true, selected: false }],
    });
    expect(response).toMatchObject({ status: 'completed', calendarId: primaryId, alreadyCreatedCount: 1 });

    const nonPrimary = new FakeSupabase(); queueWriteValidation(nonPrimary);
    await expect(writePlanningSessionToCalendar(nonPrimary.client(), userId, sessionId, 'shared@example.com', {
      ...base,
      calendarAccess: noSelectionAccess,
      listCalendars: async () => [{ ...writableCalendar, calendarId: 'shared@example.com', primary: false, selected: false }],
    })).rejects.toMatchObject({ code: 'CALENDAR_NOT_WRITABLE' });
    expect(nonPrimary.rpcCalls).toHaveLength(0);
  });
  it('作成済み予定を操作直前に再検証しETag付きでcanonical内容へ更新する', async () => {
    const inputNow = new Date(snapshot.now);
    const cleanResult = buildPlanningResult({ now: inputNow, events: [], tasks: store.tasks, routines: store.routines, completions: store.routineCompletions });
    const cleanBlock = cleanResult.proposedBlocks[0]; expect(cleanBlock).toBeDefined();
    const cleanSnapshot = buildPlanningInputSnapshotV2({ window: cleanResult.window, now: inputNow, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events: [] });
    const cleanHash = hashPlanningInputSnapshotV2(cleanSnapshot);
    const cleanSession = { ...sessionRow('approved'), window_start: cleanResult.window.start, window_end: cleanResult.window.end, input_hash: cleanHash, input_snapshot: cleanSnapshot as unknown as Json };
    const cleanBlockRow = { ...blockRow, start_at: cleanBlock.start, end_at: cleanBlock.end, block_index: cleanBlock.splitIndex, duration_minutes: (new Date(cleanBlock.end).getTime() - new Date(cleanBlock.start).getTime()) / 60_000 };
    const cleanManagedRow = { ...managedRow, start_at: cleanBlock.start, end_at: cleanBlock.end };
    const shiftedBusyEvent = { id: cleanManagedRow.google_event_id, calendarId: 'primary', title: 'Google側で変更', start: new Date(new Date(cleanBlock.start).getTime() + 60 * 60_000).toISOString(), end: new Date(new Date(cleanBlock.end).getTime() + 60 * 60_000).toISOString(), allDay: false, status: 'confirmed' as const, htmlLink: null, colorId: null };
    const shiftedResult = buildPlanningResult({ now: inputNow, events: [shiftedBusyEvent], tasks: store.tasks, routines: store.routines, completions: store.routineCompletions });
    const shiftedSnapshot = buildPlanningInputSnapshotV2({ window: shiftedResult.window, now: inputNow, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events: [shiftedBusyEvent] });
    const fake = new FakeSupabase(); fake.queue('time_blocks', 'select', { data: [cleanManagedRow], error: null }); queueGet(fake, cleanSession, [cleanBlockRow]); fake.queue('planning_sessions', 'select', { data: { status: 'approved', blocks_revision: 1 }, error: null });
    fake.queueRpc({ data: { result: 'RESERVED', attempt_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, error: null });
    fake.queueRpc({ data: 'FINISHED', error: null });
    const canonical = writtenEvent({ eventId: cleanManagedRow.google_event_id, title: 'Task', start: cleanBlock.start, end: cleanBlock.end, timeZone: 'Asia/Tokyo' });
    let updateCalls = 0;
    const response = await mutatePlanningSessionCalendarEvents(fake.client(), userId, sessionId, 'update', {
      ...writeDependencies(),
      now: () => inputNow,
      loadCurrentInput: async () => ({ store, events: [shiftedBusyEvent], result: shiftedResult, warningCodes: [], snapshot: shiftedSnapshot, hash: hashPlanningInputSnapshotV2(shiftedSnapshot) }),
      getEvent: async () => ({ ...canonical, title: 'Google側で変更', etag: '"changed-etag"' }),
      updateEvent: async (_calendarId, eventId, _accessToken, input, etag) => { updateCalls += 1; expect(eventId).toBe(cleanManagedRow.google_event_id); expect(input.title).toBe('Task'); expect(etag).toBe('"changed-etag"'); return canonical; },
    });
    expect(response).toMatchObject({ operation: 'update', status: 'completed', changedCount: 1, failedCount: 0 });
    expect(updateCalls).toBe(1); expect(fake.rpcCalls.map((call) => call.name)).toEqual(['reserve_calendar_event_mutation', 'complete_calendar_event_mutation']);
    expect(JSON.stringify(response)).not.toMatch(/google_event_id|attempt_token|access-token/i);
  });
  it('staleでも削除用管理Previewはsnapshot canonical内容だけを返す', async () => {
    const fake = new FakeSupabase(); fake.queue('time_blocks', 'select', { data: [managedRow], error: null }); queueGet(fake, sessionRow('approved'), [{ ...blockRow, title: '未信頼title' }]);
    const preview = await getPlanningSessionCalendarEventManagementPreview(fake.client(), userId, sessionId);
    expect(preview).toEqual({ sessionId, status: 'approved', timeZone: 'Asia/Tokyo', calendarId: 'primary', events: [{ sourceType: 'task', sourceId: block.taskId, title: 'Task', start: block.start, end: block.end, blockIndex: 1, durationMinutes: 60, calendarState: 'active' }] });
    expect(fake.rpcCalls).toHaveLength(0); expect(JSON.stringify(preview)).not.toMatch(/google_event_id|input_hash|blocks_revision|user_id/);
  });
  it('削除はcurrent hash/freshnessに依存せず所有済みeventだけをETag付きで削除する', async () => {
    const fake = new FakeSupabase(); fake.queue('time_blocks', 'select', { data: [managedRow], error: null }); queueGet(fake, sessionRow('superseded'), [blockRow]);
    fake.queueRpc({ data: { result: 'RESERVED', attempt_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, error: null });
    fake.queueRpc({ data: 'FINISHED', error: null });
    let deleteCalls = 0;
    const response = await mutatePlanningSessionCalendarEvents(fake.client(), userId, sessionId, 'delete', {
      ...writeDependencies(),
      getEvent: async () => writtenEvent({ eventId: managedRow.google_event_id, title: 'Task', start: block.start, end: block.end, timeZone: 'Asia/Tokyo' }),
      deleteEvent: async (_calendarId, eventId, _accessToken, etag) => { deleteCalls += 1; expect(eventId).toBe(managedRow.google_event_id); expect(etag).toBe('"event-etag"'); },
    });
    expect(response).toMatchObject({ operation: 'delete', status: 'completed', changedCount: 1 }); expect(deleteCalls).toBe(1);
  });
  it('所有マーカー不一致ではGoogle予定を変更せず失敗auditを確定する', async () => {
    const fake = new FakeSupabase(); queueWriteValidation(fake, [blockRow], [managedRow]);
    fake.queueRpc({ data: { result: 'RESERVED', attempt_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, error: null });
    fake.queueRpc({ data: 'FINISHED', error: null });
    let updateCalls = 0;
    const response = await mutatePlanningSessionCalendarEvents(fake.client(), userId, sessionId, 'update', {
      ...writeDependencies(),
      getEvent: async () => ({ ...writtenEvent({ eventId: managedRow.google_event_id, title: 'Task', start: block.start, end: block.end, timeZone: 'Asia/Tokyo' }), writeKey: 'other-owner' }),
      updateEvent: async () => { updateCalls += 1; throw new Error('must not update'); },
    });
    expect(response).toMatchObject({ status: 'failed', failedCount: 1, events: [{ mutationStatus: 'failed', errorCode: 'CALENDAR_EVENT_MISMATCH' }] });
    expect(updateCalls).toBe(0); expect(fake.rpcCalls[1]).toMatchObject({ name: 'complete_calendar_event_mutation', args: { p_success: false, p_error_code: 'CALENDAR_EVENT_MISMATCH' } });
  });
  it('正常承認しDB hashだけをRPCへ渡す', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: 'APPROVED', error: null }); queueGet(fake, sessionRow('approved'));
    const detail = await approvePlanningSession(fake.client(), userId, sessionId, dependencies());
    expect(detail.status).toBe('approved'); expect(fake.rpcCalls[0]).toEqual({ name: 'approve_planning_session', args: { p_session_id: sessionId, p_input_hash: hash, p_blocks_revision: 1 } });
  });
  it('hash staleではRPCを呼ばずdraftを維持', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies(new Date('2026-07-15T01:00:00Z'), 'b'.repeat(64)))).rejects.toMatchObject({ code: 'PLAN_STALE' });
    expect(fake.rpcCalls).toHaveLength(0); expect(sessionRow().status).toBe('draft');
  });
  it('title変更後は旧V2 draftをPLAN_STALEとして承認しない', async () => {
    const changedSnapshot = { ...snapshot, tasks: [{ ...snapshot.tasks[0], title: 'Changed title' }] }; const changedHash = hashPlanningInputSnapshotV2(changedSnapshot);
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies(new Date('2026-07-15T01:00:00Z'), changedHash, result, changedSnapshot))).rejects.toMatchObject({ code: 'PLAN_STALE' }); expect(fake.rpcCalls).toHaveLength(0);
  });
  it('stored snapshot改ざんとhash改ざんをPLAN_INVALIDにする', async () => {
    const changedSnapshot = { ...snapshot, tasks: [{ ...snapshot.tasks[0], title: 'Tampered' }] };
    const snapshotFake = new FakeSupabase(); queueGet(snapshotFake, { ...sessionRow(), input_snapshot: changedSnapshot as unknown as Json }); snapshotFake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(snapshotFake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_INVALID', status: 409 });
    const hashFake = new FakeSupabase(); queueGet(hashFake, { ...sessionRow(), input_hash: 'b'.repeat(64) }); hashFake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(hashFake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_INVALID', status: 409 });
  });
  it('legacy draftはApprovalとAI Adviceを拒否し自動backfillしない', async () => {
    const legacy = { ...sessionRow(), input_snapshot_version: null, input_snapshot: null, engine_version: 'deterministic-v1' };
    const approval = new FakeSupabase(); queueGet(approval, legacy); approval.queue('planning_sessions', 'select', { data: legacy, error: null });
    await expect(approvePlanningSession(approval.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_STALE' }); expect(approval.rpcCalls).toHaveLength(0);
    const advice = new FakeSupabase(); queueGet(advice, legacy); advice.queue('planning_sessions', 'select', { data: legacy, error: null });
    await expect(createAdvisedPlanningSession(advice.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ advise: async () => validAdviceForServer }) })).rejects.toMatchObject({ code: 'PLAN_STALE' }); expect(advice.rpcCalls).toHaveLength(0);
    expect([...approval.calls, ...advice.calls].some((call) => call.operation === ('update' as Operation) || call.operation === 'insert')).toBe(false);
  });
  it('実時刻staleではRPCを呼ばない', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies(new Date('2026-07-16T00:00:00Z')))).rejects.toMatchObject({ code: 'PLAN_STALE' }); expect(fake.rpcCalls).toHaveLength(0);
  });
  it('再検証失敗をPLAN_INVALIDにする', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies(new Date('2026-07-15T01:00:00Z'), hash, { ...result, proposedBlocks: [] }))).rejects.toMatchObject({ code: 'PLAN_INVALID' });
  });
  it.each(['approved', 'rejected', 'superseded'] as const)('%sは再承認不可', async (status) => { const fake = new FakeSupabase(); queueGet(fake, sessionRow(status)); await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_NOT_DRAFT' }); expect(fake.rpcCalls).toHaveLength(0); });
  it('RPC競合をPLAN_NOT_DRAFTへ変換', async () => { const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: 'NOT_UPDATED', error: null }); await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_NOT_DRAFT' }); });
  it('blocks取得中のrevision変化はRPC前にPLAN_STALE', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: { ...sessionRow(), blocks_revision: 2 }, error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_STALE', message: '計画案が変更されています。最新の計画案を作成してください。' }); expect(fake.rpcCalls).toHaveLength(0);
  });
  it('検証後のrevision競合をBLOCKS_CHANGEDから安全なPLAN_STALEへ変換', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: 'BLOCKS_CHANGED', error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_STALE', status: 409 }); expect(fake.rpcCalls[0]?.args).toMatchObject({ p_blocks_revision: 1 });
  });
  it('manually_edited=trueはvalidateStoredPlanの完全一致を要求せず、hard constraintだけで承認できる', async () => {
    const fake = new FakeSupabase();
    const editedRow = sessionRow('draft', true);
    queueGet(fake, editedRow);
    fake.queue('planning_sessions', 'select', { data: editedRow, error: null });
    fake.queueRpc({ data: 'APPROVED', error: null });
    queueGet(fake, { ...editedRow, status: 'approved' });
    const detail = await approvePlanningSession(fake.client(), userId, sessionId, dependencies());
    expect(detail.status).toBe('approved');
  });
  it('manually_edited=trueでもremaining_minutesを超える配置はPLAN_INVALID', async () => {
    const fake = new FakeSupabase();
    const editedRow = sessionRow('draft', true);
    queueGet(fake, editedRow);
    fake.queue('planning_sessions', 'select', { data: editedRow, error: null });
    const deps = dependencies();
    const shortStore = { ...store, tasks: [{ ...store.tasks[0], remainingMinutes: 30 }] };
    await expect(approvePlanningSession(fake.client(), userId, sessionId, { ...deps, loadCurrentInput: async () => ({ ...(await deps.loadCurrentInput()), store: shortStore }) })).rejects.toMatchObject({ code: 'PLAN_INVALID' });
  });
  it('正常却下しRPC競合とapproved却下を拒否', async () => {
    const good = new FakeSupabase(); queueGet(good, sessionRow()); good.queueRpc({ data: 'REJECTED', error: null }); queueGet(good, sessionRow('rejected')); expect((await rejectPlanningSession(good.client(), userId, sessionId)).status).toBe('rejected');
    const race = new FakeSupabase(); queueGet(race, sessionRow()); race.queueRpc({ data: 'NOT_UPDATED', error: null }); await expect(rejectPlanningSession(race.client(), userId, sessionId)).rejects.toMatchObject({ code: 'PLAN_NOT_DRAFT' });
    const approved = new FakeSupabase(); queueGet(approved, sessionRow('approved')); await expect(rejectPlanningSession(approved.client(), userId, sessionId)).rejects.toMatchObject({ code: 'PLAN_NOT_DRAFT' });
  });
  it('他ユーザーsessionは承認・却下ともPLAN_NOT_FOUND', async () => {
    const approveFake = new FakeSupabase(); queueGet(approveFake, null, []); await expect(approvePlanningSession(approveFake.client(), userId, sessionId, dependencies())).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    const rejectFake = new FakeSupabase(); queueGet(rejectFake, null, []); await expect(rejectPlanningSession(rejectFake.client(), userId, sessionId)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  });
  it('AI adviceは元sessionを更新せず新しいdraftへ安全なmetadataとblocksを保存する', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: true, error: null }); fake.queueRpc({ data: 'usage-event-id', error: null });
    const advice = { advisorVersion: 'openai-advice-v1', model: 'test-model', globalSummary: 'safe', warnings: [], orderedSources: [{ alias: 'task_1', sourceType: 'task' as const, sourceId: block.taskId!, explanation: 'safe reason', changed: false }] };
    const advised = { ...sessionRow(), id: '55555555-5555-4555-8555-555555555555', engine_version: `${PLANNING_ENGINE_VERSION}+${AI_ADVISOR_VERSION}`, warning_codes: ['AI_ADVICE_APPLIED'], result_summary: { unscheduledTasks: [], unscheduledRoutines: [], advice } }; fake.queueRpc({ data: advised.id, error: null }); queueGet(fake, advised, [{ ...blockRow, planning_session_id: advised.id }]);
    const detail = await createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ model: 'test-model', advise: async (input) => ({ orderedSourceIds: input.deterministicOrdering, explanationBySourceId: { task_1: 'safe reason' }, globalSummary: 'safe', warnings: [] }) }) });
    expect(detail.status).toBe('draft'); expect(detail.advice?.model).toBe('test-model');
    expect(fake.rpcCalls.find((item) => item.name === 'create_planning_session_v2')?.args).toMatchObject({ p_idempotency_key: null, p_engine_version: `${PLANNING_ENGINE_VERSION}+${AI_ADVISOR_VERSION}`, p_input_snapshot_version: 'planning-input-v2' });
    expect(fake.rpcCalls.find((item) => item.name === 'record_ai_advice_usage')?.args).toMatchObject({ p_planning_session_id: sessionId, p_model: 'test-model', p_candidate_count: 1, p_success: true, p_error_code: null });
    expect(fake.calls.some((item) => item.operation === 'delete')).toBe(false); expect(fake.calls.some((item) => item.operation === ('update' as Operation))).toBe(false);
  });
  it('AI応答が無効な場合も利用量をsuccess:falseで記録してから元のエラーを返す', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: true, error: null }); fake.queueRpc({ data: 'usage-event-id', error: null });
    await expect(createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ model: 'test-model', advise: async () => ({ invalid: true } as never) }) })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fake.rpcCalls.find((item) => item.name === 'record_ai_advice_usage')?.args).toMatchObject({ p_model: 'test-model', p_success: false, p_error_code: 'AI_INVALID_RESPONSE' });
    expect(fake.rpcCalls.some((item) => item.name === 'create_planning_session_v2')).toBe(false);
  });
  it('利用量記録RPCの失敗はAI改善案の成否に影響しない', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: true, error: null }); fake.queueRpc({ data: null, error: { message: 'boom' } });
    const advised = { ...sessionRow(), id: '55555555-5555-4555-8555-555555555555', engine_version: `${PLANNING_ENGINE_VERSION}+${AI_ADVISOR_VERSION}` }; fake.queueRpc({ data: advised.id, error: null }); queueGet(fake, advised, [{ ...blockRow, planning_session_id: advised.id }]);
    const detail = await createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ model: 'test-model', advise: async (input) => ({ orderedSourceIds: input.deterministicOrdering, explanationBySourceId: { task_1: 'safe reason' }, globalSummary: 'safe', warnings: [] }) }) });
    expect(detail.status).toBe('draft');
  });
  it('原子予約失敗はprovider呼び出し前にrate limitする', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: false, error: null }); let calls = 0;
    await expect(createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ advise: async () => { calls += 1; return { orderedSourceIds: [], explanationBySourceId: {}, globalSummary: '', warnings: [] }; } }) })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' }); expect(calls).toBe(0);
  });
  it('予約RPCエラー時はproviderを呼ばず生エラーを隠す', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: null, error: { message: 'database secret' } }); let calls = 0;
    await expect(createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ advise: async () => { calls += 1; return validAdviceForServer; } }) })).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', message: 'AI相談を開始できませんでした。' }); expect(calls).toBe(0);
  });
  it('事前abortは予約もproviderも実行せず元sessionを維持する', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); const controller = new AbortController(); controller.abort(); let calls = 0;
    await expect(createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), signal: controller.signal, advisor: () => ({ advise: async () => { calls += 1; return validAdviceForServer; } }) })).rejects.toMatchObject({ code: 'AI_REQUEST_CANCELLED' }); expect(calls).toBe(0); expect(fake.rpcCalls).toHaveLength(0); expect(fake.calls.some((item) => item.operation === 'insert')).toBe(false);
  });
  it('provider実行中abortではAI draftを保存せず元sessionを維持する', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: true, error: null }); const controller = new AbortController(); let started!: () => void; const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const pending = createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), signal: controller.signal, advisor: () => ({ advise: async (_input, signal) => new Promise((_resolve, reject) => { started(); signal?.addEventListener('abort', () => reject(new PlanningApiError('AI_REQUEST_CANCELLED', 'AI相談をキャンセルしました。', 499)), { once: true }); }) }) });
    await providerStarted; controller.abort(); await expect(pending).rejects.toMatchObject({ code: 'AI_REQUEST_CANCELLED' }); expect(fake.calls.some((item) => item.operation === 'insert')).toBe(false); expect(fake.calls.some((item) => item.operation === ('update' as Operation))).toBe(false);
  });
  it('同一ユーザーの並列2相談は予約成功側だけproviderと保存へ進む', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: true, error: null }); fake.queueRpc({ data: false, error: null }); fake.queueRpc({ data: 'usage-event-id', error: null });
    const advised = { ...sessionRow(), id: '55555555-5555-4555-8555-555555555555', engine_version: `${PLANNING_ENGINE_VERSION}+${AI_ADVISOR_VERSION}` }; fake.queueRpc({ data: advised.id, error: null }); queueGet(fake, advised, [{ ...blockRow, planning_session_id: advised.id }]); let providerCalls = 0;
    const options = { ...dependencies(), advisor: () => ({ advise: async () => { providerCalls += 1; return validAdviceForServer; } }) };
    const settled = await Promise.allSettled([createAdvisedPlanningSession(fake.client(), userId, sessionId, options), createAdvisedPlanningSession(fake.client(), userId, sessionId, options)]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1); expect(settled.filter((item) => item.status === 'rejected' && item.reason?.code === 'AI_RATE_LIMITED')).toHaveLength(1); expect(providerCalls).toBe(1); expect(fake.rpcCalls.filter((item) => item.name === 'create_planning_session_v2')).toHaveLength(1); expect(fake.calls.some((item) => item.operation === ('update' as Operation))).toBe(false);
  });
});

describe('計画blockの手動編集', () => {
  it('block削除RPCを呼び、削除後の最新セッションを返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    fake.queueRpc({ data: 'DELETED', error: null });
    queueGet(fake, { ...sessionRow('draft', true) }, []);
    const result = await deletePlanningBlock(fake.client(), userId, sessionId, blockRow.id);
    expect(result.blocks).toEqual([]);
    expect(fake.rpcCalls[0]).toEqual({ name: 'delete_planning_block', args: { p_block_id: blockRow.id } });
  });
  it('block所有権がURLのsessionIdと一致しなければPLAN_BLOCK_NOT_FOUND', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_blocks', 'select', { data: { planning_session_id: 'other-session' }, error: null });
    await expect(deletePlanningBlock(fake.client(), userId, sessionId, blockRow.id)).rejects.toMatchObject({ code: 'PLAN_BLOCK_NOT_FOUND', status: 404 });
    expect(fake.rpcCalls).toHaveLength(0);
  });
  it('draft以外のsessionへの削除RPCはPLAN_NOT_DRAFT', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    fake.queueRpc({ data: 'NOT_DELETED', error: null });
    await expect(deletePlanningBlock(fake.client(), userId, sessionId, blockRow.id)).rejects.toMatchObject({ code: 'PLAN_NOT_DRAFT', status: 409 });
  });
  it('時刻更新RPCを呼び、更新後の最新セッションを返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    fake.queueRpc({ data: 'UPDATED', error: null });
    queueGet(fake, sessionRow('draft', true));
    const result = await updatePlanningBlockTime(fake.client(), userId, sessionId, blockRow.id, block.start, block.end);
    expect(result.status).toBe('draft');
    expect(fake.rpcCalls[0]).toEqual({ name: 'update_planning_block_time', args: { p_block_id: blockRow.id, p_start_at: block.start, p_end_at: block.end } });
  });
  it('時刻更新が他blockと重複する場合はPLAN_BLOCK_OVERLAPS', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    fake.queueRpc({ data: 'OVERLAPS', error: null });
    await expect(updatePlanningBlockTime(fake.client(), userId, sessionId, blockRow.id, block.start, block.end)).rejects.toMatchObject({ code: 'PLAN_BLOCK_OVERLAPS', status: 409 });
  });
  it('タスク差し替えRPCを呼び、更新後の最新セッションを返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    fake.queueRpc({ data: 'UPDATED', error: null });
    queueGet(fake, sessionRow('draft', true));
    const result = await updatePlanningBlockTask(fake.client(), userId, sessionId, blockRow.id, '66666666-6666-4666-8666-666666666666');
    expect(result.status).toBe('draft');
    expect(fake.rpcCalls[0]).toEqual({ name: 'update_planning_block_task', args: { p_block_id: blockRow.id, p_task_id: '66666666-6666-4666-8666-666666666666' } });
  });
  it('存在しない・完了済みタスクへの差し替えはINVALID_REQUEST、routineブロックはPLAN_INVALID', async () => {
    const notFound = new FakeSupabase();
    notFound.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    notFound.queueRpc({ data: 'TASK_NOT_FOUND', error: null });
    await expect(updatePlanningBlockTask(notFound.client(), userId, sessionId, blockRow.id, '77777777-7777-4777-8777-777777777777')).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });

    const notTaskBlock = new FakeSupabase();
    notTaskBlock.queue('planning_blocks', 'select', { data: { planning_session_id: sessionId }, error: null });
    notTaskBlock.queueRpc({ data: 'NOT_TASK_BLOCK', error: null });
    await expect(updatePlanningBlockTask(notTaskBlock.client(), userId, sessionId, blockRow.id, '88888888-8888-4888-8888-888888888888')).rejects.toMatchObject({ code: 'PLAN_INVALID', status: 409 });
  });
});

describe('計画案の再生成', () => {
  it('draft状態のsessionは却下してから新しいsessionを作成する', async () => {
    const fake = new FakeSupabase();
    queueGet(fake, sessionRow('draft'));
    fake.queueRpc({ data: 'REJECTED', error: null });
    fake.queue('planning_sessions', 'select', { data: null, error: null });
    fake.queueRpc({ data: sessionId, error: null });
    queueGet(fake, sessionRow());
    const detail = await regeneratePlanningSession(fake.client(), userId, sessionId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dependencies());
    expect(detail.status).toBe('draft');
    expect(fake.rpcCalls.map((item) => item.name)).toEqual(['reject_planning_session', 'create_planning_session_v2']);
  });
  it('draft以外のsessionはreject RPCを呼ばずに新しいsessionを作成する', async () => {
    const fake = new FakeSupabase();
    queueGet(fake, sessionRow('approved'));
    fake.queue('planning_sessions', 'select', { data: null, error: null });
    fake.queueRpc({ data: sessionId, error: null });
    queueGet(fake, sessionRow());
    await regeneratePlanningSession(fake.client(), userId, sessionId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', dependencies());
    expect(fake.rpcCalls.map((item) => item.name)).toEqual(['create_planning_session_v2']);
  });
  it('却下に失敗した場合はPLAN_STALE', async () => {
    const fake = new FakeSupabase();
    queueGet(fake, sessionRow('draft'));
    fake.queueRpc({ data: 'NOT_UPDATED', error: null });
    await expect(regeneratePlanningSession(fake.client(), userId, sessionId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', dependencies())).rejects.toMatchObject({ code: 'PLAN_STALE' });
  });
});

describe('AI Advice利用状況の月次集計', () => {
  it('当月分のトークン数・成否・概算コストを集計する', async () => {
    const fake = new FakeSupabase();
    fake.queue('ai_advice_usage_events', 'select', {
      data: [
        { model: 'gpt-5.6-luna', input_tokens: 1000, output_tokens: 500, success: true },
        { model: 'gpt-5.6-luna', input_tokens: 2000, output_tokens: 1000, success: true },
        { model: 'gpt-5.6-luna', input_tokens: null, output_tokens: null, success: false },
      ],
      error: null,
    });
    const summary = await getAiAdviceUsageSummary(fake.client(), userId, new Date('2026-07-15T00:00:00.000Z'));
    expect(summary.totalCalls).toBe(3);
    expect(summary.successfulCalls).toBe(2);
    expect(summary.failedCalls).toBe(1);
    expect(summary.totalInputTokens).toBe(3000);
    expect(summary.totalOutputTokens).toBe(1500);
    expect(summary.estimatedCostUsd).toBeCloseTo((3000 / 1_000_000) * 2 + (1500 / 1_000_000) * 8, 6);
    expect(summary.monthStart).toBe('2026-06-30T15:00:00.000Z');
    expect(summary.monthlyCallLimit).toBe(200);
    expect(summary.nearMonthlyLimit).toBe(false);
    const call = fake.calls.find((item) => item.table === 'ai_advice_usage_events');
    expect(call?.filters).toEqual(expect.arrayContaining([
      ['user_id', userId],
      ['created_at.gte', '2026-06-30T15:00:00.000Z'],
      ['created_at.lt', '2026-07-31T15:00:00.000Z'],
    ]));
  });
  it('呼び出しなしの場合は0件のsummaryを返す', async () => {
    const fake = new FakeSupabase(); fake.queue('ai_advice_usage_events', 'select', { data: [], error: null });
    const summary = await getAiAdviceUsageSummary(fake.client(), userId, new Date('2026-07-15T00:00:00.000Z'));
    expect(summary).toMatchObject({ totalCalls: 0, successfulCalls: 0, failedCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, estimatedCostUsd: 0 });
  });
  it('月間上限の80%以上でnearMonthlyLimitがtrueになる', async () => {
    const original = process.env.AI_ADVICE_MONTHLY_CALL_LIMIT;
    process.env.AI_ADVICE_MONTHLY_CALL_LIMIT = '10';
    try {
      const fake = new FakeSupabase();
      fake.queue('ai_advice_usage_events', 'select', { data: Array.from({ length: 8 }, () => ({ model: 'gpt-5.6-luna', input_tokens: 10, output_tokens: 10, success: true })), error: null });
      const summary = await getAiAdviceUsageSummary(fake.client(), userId, new Date('2026-07-15T00:00:00.000Z'));
      expect(summary.monthlyCallLimit).toBe(10);
      expect(summary.nearMonthlyLimit).toBe(true);
    } finally {
      if (original === undefined) delete process.env.AI_ADVICE_MONTHLY_CALL_LIMIT; else process.env.AI_ADVICE_MONTHLY_CALL_LIMIT = original;
    }
  });
});
