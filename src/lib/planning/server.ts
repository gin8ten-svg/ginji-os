import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { listGoogleEvents } from '@/lib/calendar/google-api';
import { calendarAccessContext } from '@/lib/calendar/server';
import { buildPlanningResult, createPlanningWindow } from '@/lib/planner/engine';
import { planningInputHash, PLANNING_ENGINE_VERSION } from '@/lib/planning/hash';
import { PlanningApiError } from '@/lib/planning/responses';
import { SupabaseTaskRepository } from '@/lib/supabase-task-repository';
import { createClient } from '@/lib/supabase/server';
import type { Database, Json, PlanningBlockRow, PlanningSessionRow } from '@/types/database';
import type { PlanningResult, ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';
import type { PlanningSessionDetail, PlanningSessionSummary } from '@/types/planning-session';
import type { TaskStore } from '@/types/tasks';

const warningText: Record<string, string> = { CALENDAR_NOT_CONNECTED: 'Google Calendar未接続のため、外部予定を反映していません。' };
export const PLANNING_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PLANNING_APPROVAL_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

type PlanningInput = Awaited<ReturnType<typeof currentPlanningInput>>;
interface PlanningServerDependencies {
  now: () => Date;
  loadCurrentInput: (client: SupabaseClient<Database>, userId: string, now: Date) => Promise<PlanningInput>;
}
const defaultDependencies: PlanningServerDependencies = { now: () => new Date(), loadCurrentInput: currentPlanningInput };

export async function authenticatedPlanningClient(): Promise<{ client: SupabaseClient<Database>; user: User }> {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new PlanningApiError('AUTH_REQUIRED', '認証が必要です。', 401);
  return { client, user: data.user };
}

async function calendarEvents(now: Date): Promise<{ events: Awaited<ReturnType<typeof listGoogleEvents>>; warningCodes: string[] }> {
  const window = createPlanningWindow(now);
  const context = await calendarAccessContext();
  if (!context.ok) {
    const body: unknown = await context.response.clone().json().catch(() => null);
    const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : null;
    if (code === 'NOT_CONNECTED') return { events: [], warningCodes: ['CALENDAR_NOT_CONNECTED'] };
    if (code === 'RECONNECT_REQUIRED') throw new PlanningApiError('CALENDAR_RECONNECT_REQUIRED', 'Google Calendarを再接続してください。', 409);
    if (code === 'AUTH_REQUIRED') throw new PlanningApiError('AUTH_REQUIRED', '認証が必要です。', 401);
    throw new PlanningApiError('PLAN_INVALID', 'Google Calendar予定を取得できませんでした。', 502);
  }
  const ids = context.connection.selected_calendar_ids.length ? context.connection.selected_calendar_ids : ['primary'];
  try { return { events: await listGoogleEvents(context.accessToken, ids, { timeMin: window.start, timeMax: window.end }), warningCodes: [] }; }
  catch { throw new PlanningApiError('PLAN_INVALID', 'Google Calendar予定を取得できませんでした。', 502); }
}

export async function currentPlanningInput(client: SupabaseClient<Database>, userId: string, now: Date) {
  const [store, calendar] = await Promise.all([new SupabaseTaskRepository(client, userId).loadStore(), calendarEvents(now)]);
  const result = buildPlanningResult({ now, events: calendar.events, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions });
  const hash = planningInputHash({ window: result.window, now, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events: calendar.events });
  return { store, result: { ...result, warnings: calendar.warningCodes.map((code) => warningText[code] ?? code) }, warningCodes: calendar.warningCodes, hash };
}

function blockInsert(sessionId: string, userId: string, block: ProposedTimeBlock) {
  const sourceId = block.taskId ?? block.routineId;
  if (!sourceId) throw new PlanningApiError('PLAN_INVALID', '計画ブロックの参照先が不正です。', 422);
  return { planning_session_id: sessionId, user_id: userId, source_type: block.source, source_entity_id: sourceId, title: block.title, start_at: block.start, end_at: block.end, block_index: block.splitIndex, duration_minutes: Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000), metadata: {} };
}

function resultSummary(result: PlanningResult): Json {
  return { unscheduledTasks: result.unscheduledTasks as unknown as Json, unscheduledRoutines: result.unscheduledRoutines as unknown as Json };
}

export async function createPlanningSession(client: SupabaseClient<Database>, userId: string, dependencies: Partial<PlanningServerDependencies> = {}): Promise<PlanningSessionDetail> {
  const deps = { ...defaultDependencies, ...dependencies };
  const now = deps.now();
  const input = await deps.loadCurrentInput(client, userId, now);
  const { data: session, error } = await client.from('planning_sessions').insert({ user_id: userId, status: 'draft', window_start: input.result.window.start, window_end: input.result.window.end, input_now: now.toISOString(), input_hash: input.hash, engine_version: PLANNING_ENGINE_VERSION, warning_codes: input.warningCodes, result_summary: resultSummary(input.result) }).select('*').eq('user_id', userId).single();
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を保存できませんでした。', 500);
  const values = input.result.proposedBlocks.map((block) => blockInsert(session.id, userId, block));
  if (values.length) {
    const { error: blockError } = await client.from('planning_blocks').insert(values);
    if (blockError) {
      await client.from('planning_sessions').delete().eq('id', session.id).eq('user_id', userId);
      throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を保存できませんでした。', 500);
    }
  }
  return detailFromRows(session, input.result.proposedBlocks.map((block, index) => ({ ...blockInsert(session.id, userId, block), id: `response-${index}`, created_at: session.created_at } as PlanningBlockRow)));
}

function summaryData(value: Json): { unscheduledTasks: UnscheduledTask[]; unscheduledRoutines: UnscheduledRoutine[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { unscheduledTasks: [], unscheduledRoutines: [] };
  const record = value as Record<string, Json | undefined>;
  return { unscheduledTasks: Array.isArray(record.unscheduledTasks) ? record.unscheduledTasks as unknown as UnscheduledTask[] : [], unscheduledRoutines: Array.isArray(record.unscheduledRoutines) ? record.unscheduledRoutines as unknown as UnscheduledRoutine[] : [] };
}

function proposedFromRow(row: PlanningBlockRow): ProposedTimeBlock {
  return { id: row.id, source: row.source_type, taskId: row.source_type === 'task' ? row.source_entity_id : null, routineId: row.source_type === 'routine' ? row.source_entity_id : null, title: row.title, start: row.start_at, end: row.end_at, splitIndex: row.block_index };
}

export function detailFromRows(session: PlanningSessionRow, blocks: PlanningBlockRow[]): PlanningSessionDetail {
  const summary = summaryData(session.result_summary);
  return { sessionId: session.id, status: session.status, windowStart: session.window_start, windowEnd: session.window_end, blocks: blocks.map(proposedFromRow), ...summary, warnings: session.warning_codes.map((code) => warningText[code] ?? code), inputHash: session.input_hash, engineVersion: session.engine_version, createdAt: session.created_at, approvedAt: session.approved_at, rejectedAt: session.rejected_at };
}

export async function getPlanningSession(client: SupabaseClient<Database>, userId: string, id: string): Promise<PlanningSessionDetail> {
  const [{ data: session, error }, { data: blocks, error: blockError }] = await Promise.all([
    client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    client.from('planning_blocks').select('*').eq('planning_session_id', id).eq('user_id', userId).order('start_at'),
  ]);
  if (error || blockError) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を取得できませんでした。', 500);
  if (!session) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  return detailFromRows(session, blocks);
}

export async function listPlanningSessions(client: SupabaseClient<Database>, userId: string): Promise<PlanningSessionSummary[]> {
  const { data: sessions, error } = await client.from('planning_sessions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画履歴を取得できませんでした。', 500);
  if (!sessions.length) return [];
  const ids = sessions.map((item) => item.id);
  const { data: blocks, error: blockError } = await client.from('planning_blocks').select('planning_session_id').eq('user_id', userId).in('planning_session_id', ids);
  if (blockError) throw new PlanningApiError('PERSISTENCE_FAILED', '計画履歴を取得できませんでした。', 500);
  const counts = new Map<string, number>(); for (const block of blocks) counts.set(block.planning_session_id, (counts.get(block.planning_session_id) ?? 0) + 1);
  return sessions.map((item) => ({ sessionId: item.id, status: item.status, windowStart: item.window_start, windowEnd: item.window_end, engineVersion: item.engine_version, warningCodes: item.warning_codes, createdAt: item.created_at, approvedAt: item.approved_at, blockCount: counts.get(item.id) ?? 0 }));
}

function normalizedBlocks(blocks: ProposedTimeBlock[]) { return blocks.map((item) => ({ source: item.source, sourceId: item.taskId ?? item.routineId, start: item.start, end: item.end, blockIndex: item.splitIndex, duration: Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000) })).sort((a, b) => a.start.localeCompare(b.start) || String(a.sourceId).localeCompare(String(b.sourceId))); }

export function validateStoredPlan(blocks: ProposedTimeBlock[], current: PlanningResult, store: TaskStore): boolean {
  const entities = new Set([...store.tasks.filter((item) => !item.completedAt).map((item) => `task:${item.id}`), ...store.routines.filter((item) => item.isActive).map((item) => `routine:${item.id}`)]);
  if (!blocks.every((item) => entities.has(`${item.source}:${item.taskId ?? item.routineId}`) && new Date(item.start) < new Date(item.end))) return false;
  return JSON.stringify(normalizedBlocks(blocks)) === JSON.stringify(normalizedBlocks(current.proposedBlocks));
}

export type PlanningFreshnessReason = 'SESSION_EXPIRED' | 'WINDOW_EXPIRED' | 'BLOCK_ALREADY_STARTED' | 'BLOCK_ALREADY_ENDED';

export function planningFreshnessReason(session: Pick<PlanningSessionRow, 'created_at' | 'window_end'>, blocks: readonly ProposedTimeBlock[], approvalNow: Date): PlanningFreshnessReason | null {
  const now = approvalNow.getTime();
  const created = new Date(session.created_at).getTime();
  const windowEnd = new Date(session.window_end).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(created) || now - created >= PLANNING_SESSION_MAX_AGE_MS) return 'SESSION_EXPIRED';
  if (!Number.isFinite(windowEnd) || now >= windowEnd) return 'WINDOW_EXPIRED';
  for (const block of blocks) {
    const start = new Date(block.start).getTime();
    const end = new Date(block.end).getTime();
    if (!Number.isFinite(end) || end <= now) return 'BLOCK_ALREADY_ENDED';
    if (!Number.isFinite(start) || start < now - PLANNING_APPROVAL_CLOCK_TOLERANCE_MS) return 'BLOCK_ALREADY_STARTED';
  }
  return null;
}

const staleTimeError = () => new PlanningApiError('PLAN_STALE', '計画案の一部がすでに過去になっています。最新の計画案を作成してください。', 409);

export async function approvePlanningSession(client: SupabaseClient<Database>, userId: string, id: string, dependencies: Partial<PlanningServerDependencies> = {}): Promise<PlanningSessionDetail> {
  const deps = { ...defaultDependencies, ...dependencies };
  const saved = await getPlanningSession(client, userId, id);
  if (saved.status !== 'draft') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案だけを承認できます。', 409);
  const { data: row } = await client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!row) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  const current = await deps.loadCurrentInput(client, userId, new Date(row.input_now));
  if (current.hash !== row.input_hash) throw new PlanningApiError('PLAN_STALE', 'タスクや予定が変更されています。計画案を再作成してください。', 409);
  if (!validateStoredPlan(saved.blocks, current.result, current.store)) throw new PlanningApiError('PLAN_INVALID', '計画案を再検証できませんでした。', 422);
  if (planningFreshnessReason(row, current.result.proposedBlocks, deps.now())) throw staleTimeError();
  // approvedは確認状態にすぎない。将来のCalendar書き込みは直前の完全再検証と別の冪等APIを必須とする。
  const { data, error } = await client.rpc('approve_planning_session', { p_session_id: id, p_input_hash: row.input_hash });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を承認できませんでした。', 500);
  if (data !== 'APPROVED') throw new PlanningApiError('PLAN_NOT_DRAFT', '計画案の状態が変更されています。', 409);
  return getPlanningSession(client, userId, id);
}

export async function rejectPlanningSession(client: SupabaseClient<Database>, userId: string, id: string): Promise<PlanningSessionDetail> {
  const saved = await getPlanningSession(client, userId, id);
  if (saved.status !== 'draft') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案だけを却下できます。', 409);
  const { data, error } = await client.rpc('reject_planning_session', { p_session_id: id });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を却下できませんでした。', 500);
  if (data !== 'REJECTED') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案だけを却下できます。', 409);
  return getPlanningSession(client, userId, id);
}
