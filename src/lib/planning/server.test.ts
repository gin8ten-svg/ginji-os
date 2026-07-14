import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { approvePlanningSession, createAdvisedPlanningSession, createPlanningSession, getPlanningSession, planningFreshnessReason, rejectPlanningSession } from '@/lib/planning/server';
import type { Database, PlanningBlockRow, PlanningSessionRow } from '@/types/database';
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
  client(): SupabaseClient<Database> { return { from: (table: string) => new StubQuery(this, table), rpc: async (name: string, args: unknown) => { this.rpcCalls.push({ name, args }); return this.rpcResults.shift() ?? { data: null, error: null }; } } as unknown as SupabaseClient<Database>; }
}

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-07-15T00:00:00.000Z';
const hash = 'a'.repeat(64);
const block: ProposedTimeBlock = { id: 'block', source: 'task', taskId: '33333333-3333-4333-8333-333333333333', routineId: null, title: 'Task', start: '2026-07-15T02:00:00.000Z', end: '2026-07-15T03:00:00.000Z', splitIndex: 1 };
const sessionRow = (status: PlanningSessionRow['status'] = 'draft'): PlanningSessionRow => ({ id: sessionId, user_id: userId, status, window_start: '2026-07-14T23:00:00.000Z', window_end: '2026-07-21T13:00:00.000Z', input_now: '2026-07-15T00:00:00.000Z', input_hash: hash, engine_version: 'deterministic-v1', warning_codes: [], result_summary: { unscheduledTasks: [], unscheduledRoutines: [] }, created_at: createdAt, updated_at: createdAt, approved_at: status === 'approved' ? '2026-07-15T00:30:00.000Z' : null, rejected_at: status === 'rejected' ? '2026-07-15T00:30:00.000Z' : null });
const blockRow: PlanningBlockRow = { id: '44444444-4444-4444-8444-444444444444', planning_session_id: sessionId, user_id: userId, source_type: 'task', source_entity_id: block.taskId!, title: block.title, start_at: block.start, end_at: block.end, block_index: 1, duration_minutes: 60, metadata: {}, created_at: createdAt };
const store: TaskStore = { version: 1, tasks: [{ id: block.taskId!, title: 'Task', description: '', dueAt: null, priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: false, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt, updatedAt: createdAt, source: 'user' }], routines: [], routineCompletions: [] };
const result: PlanningResult = { window: { start: sessionRow().window_start, end: sessionRow().window_end, timeZone: 'Asia/Tokyo', workdayStart: '08:00', workdayEnd: '22:00', minimumSlotMinutes: 25, dates: ['2026-07-15'] }, busyIntervals: [], freeSlots: [], proposedBlocks: [block], unscheduledTasks: [], unscheduledRoutines: [], warnings: [] };
const dependencies = (now = new Date('2026-07-15T01:00:00.000Z'), inputHash = hash, planningResult = result) => ({ now: () => now, loadCurrentInput: async () => ({ store, events: [], result: planningResult, warningCodes: [], hash: inputHash }) });
const queueGet = (fake: FakeSupabase, session: PlanningSessionRow | null, blocks: PlanningBlockRow[] = [blockRow]) => { fake.queue('planning_sessions', 'select', { data: session, error: null }); fake.queue('planning_blocks', 'select', { data: blocks, error: null }); };

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
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'insert', { data: sessionRow(), error: null }); fake.queue('planning_blocks', 'insert', { data: null, error: null });
    const detail = await createPlanningSession(fake.client(), userId, dependencies());
    expect(detail.status).toBe('draft'); expect(detail.blocks).toHaveLength(1);
    expect(fake.calls.find((item) => item.table === 'planning_sessions' && item.operation === 'insert')?.payload).toMatchObject({ user_id: userId, status: 'draft' });
    expect(JSON.stringify(detail)).not.toMatch(/user_id|token|secret/i);
  });
  it('blocks保存失敗時にsessionを削除し安全なPERSISTENCE_FAILEDを返す', async () => {
    const fake = new FakeSupabase(); fake.queue('planning_sessions', 'insert', { data: sessionRow(), error: null }); fake.queue('planning_blocks', 'insert', { data: null, error: { message: 'database token owner@example.com' } }); fake.queue('planning_sessions', 'delete', { data: null, error: null });
    await expect(createPlanningSession(fake.client(), userId, dependencies())).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', message: '計画案を保存できませんでした。' });
    expect(fake.calls.find((item) => item.operation === 'delete')?.filters).toEqual([['id', sessionId], ['user_id', userId]]);
  });
  it('sessionとblocksの両方をuser_idで取得しsnapshot内部値を返さない', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow());
    const detail = await getPlanningSession(fake.client(), userId, sessionId);
    expect(detail.sessionId).toBe(sessionId); expect(JSON.stringify(detail)).not.toMatch(/input_now|result_summary|user_id/);
    fake.calls.forEach((call) => expect(call.filters).toContainEqual(['user_id', userId]));
  });
  it('他ユーザー相当の空結果はPLAN_NOT_FOUND', async () => { const fake = new FakeSupabase(); queueGet(fake, null, []); await expect(getPlanningSession(fake.client(), userId, sessionId)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' }); });
  it('正常承認しDB hashだけをRPCへ渡す', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queueRpc({ data: 'APPROVED', error: null }); queueGet(fake, sessionRow('approved'));
    const detail = await approvePlanningSession(fake.client(), userId, sessionId, dependencies());
    expect(detail.status).toBe('approved'); expect(fake.rpcCalls[0]).toEqual({ name: 'approve_planning_session', args: { p_session_id: sessionId, p_input_hash: hash } });
  });
  it('hash staleではRPCを呼ばずdraftを維持', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null });
    await expect(approvePlanningSession(fake.client(), userId, sessionId, dependencies(new Date('2026-07-15T01:00:00Z'), 'b'.repeat(64)))).rejects.toMatchObject({ code: 'PLAN_STALE' });
    expect(fake.rpcCalls).toHaveLength(0); expect(sessionRow().status).toBe('draft');
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
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queue('planning_sessions', 'select', { data: [], error: null });
    const advice = { advisorVersion: 'openai-advice-v1', model: 'test-model', globalSummary: 'safe', warnings: [], orderedSources: [{ alias: 'task_1', sourceType: 'task' as const, sourceId: block.taskId!, explanation: 'safe reason', changed: false }] };
    fake.queue('planning_sessions', 'insert', { data: { ...sessionRow(), id: '55555555-5555-4555-8555-555555555555', engine_version: 'deterministic-v1+openai-advice-v1', warning_codes: ['AI_ADVICE_APPLIED'], result_summary: { unscheduledTasks: [], unscheduledRoutines: [], advice } }, error: null }); fake.queue('planning_blocks', 'insert', { data: null, error: null });
    const detail = await createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ model: 'test-model', advise: async (input) => ({ orderedSourceIds: input.deterministicOrdering, explanationBySourceId: { task_1: 'safe reason' }, globalSummary: 'safe', warnings: [] }) }) });
    expect(detail.status).toBe('draft'); expect(detail.advice?.model).toBe('test-model');
    const insert = fake.calls.find((item) => item.table === 'planning_sessions' && item.operation === 'insert'); expect(insert?.payload).toMatchObject({ status: 'draft', user_id: userId, engine_version: 'deterministic-v1+openai-advice-v1' });
    expect(fake.calls.some((item) => item.operation === 'delete')).toBe(false); expect(fake.calls.some((item) => item.operation === ('update' as Operation))).toBe(false);
  });
  it('直近30秒のAI draftはprovider呼び出し前にrate limitする', async () => {
    const fake = new FakeSupabase(); queueGet(fake, sessionRow()); fake.queue('planning_sessions', 'select', { data: sessionRow(), error: null }); fake.queue('planning_sessions', 'select', { data: [{ ...sessionRow(), engine_version: 'deterministic-v1+openai-advice-v1', created_at: '2026-07-15T00:59:45Z' }], error: null }); let calls = 0;
    await expect(createAdvisedPlanningSession(fake.client(), userId, sessionId, { ...dependencies(), advisor: () => ({ advise: async () => { calls += 1; return { orderedSourceIds: [], explanationBySourceId: {}, globalSummary: '', warnings: [] }; } }) })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' }); expect(calls).toBe(0);
  });
});
