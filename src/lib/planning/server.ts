import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { listGoogleEvents } from '@/lib/calendar/google-api';
import { calendarAccessContext } from '@/lib/calendar/server';
import { buildPlanningResult, createPlanningWindow } from '@/lib/planner/engine';
import { adviceView, AI_ADVISOR_VERSION, buildPlanningAdviceInput, orderingSourceIds, sanitizeAdvice } from '@/lib/planning/advisor';
import { OpenAIPlanningAdvisor } from '@/lib/planning/openai-advisor';
import { buildPlanningInputSnapshotV2, hashPlanningInputSnapshotV2, PLANNING_ENGINE_VERSION, PLANNING_INPUT_SNAPSHOT_VERSION, validatePlanningInputSnapshotV2, type PlanningInputSnapshotV2 } from '@/lib/planning/input-snapshot-v2';
import { PlanningApiError } from '@/lib/planning/responses';
import { SupabaseTaskRepository } from '@/lib/supabase-task-repository';
import { createClient } from '@/lib/supabase/server';
import type { Database, Json, PlanningBlockRow, PlanningSessionRow } from '@/types/database';
import type { PlanningResult, ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';
import type { PlanningAdviceView, PlanningAdvisor, PlanningSessionDetail, PlanningSessionSummary } from '@/types/planning-session';
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
  const snapshot = buildPlanningInputSnapshotV2({ window: result.window, now, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events: calendar.events });
  const hash = hashPlanningInputSnapshotV2(snapshot);
  return { store, events: calendar.events, result: { ...result, warnings: calendar.warningCodes.map((code) => warningText[code] ?? code) }, warningCodes: calendar.warningCodes, snapshot, hash };
}

function blockInsert(sessionId: string, userId: string, block: ProposedTimeBlock) {
  const sourceId = block.taskId ?? block.routineId;
  if (!sourceId) throw new PlanningApiError('PLAN_INVALID', '計画ブロックの参照先が不正です。', 422);
  const duration = (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000;
  if (!Number.isInteger(duration) || duration <= 0) throw new PlanningApiError('PLAN_INVALID', '計画ブロックは分単位である必要があります。', 422);
  return { planning_session_id: sessionId, user_id: userId, source_type: block.source, source_entity_id: sourceId, title: block.title, start_at: block.start, end_at: block.end, block_index: block.splitIndex, duration_minutes: duration, metadata: {} };
}

function resultSummary(result: PlanningResult, advice: PlanningAdviceView | null = null): Json {
  return { unscheduledTasks: result.unscheduledTasks as unknown as Json, unscheduledRoutines: result.unscheduledRoutines as unknown as Json, advice: advice as unknown as Json };
}

function parseAdviceView(value: Json | undefined): PlanningAdviceView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, Json | undefined>;
  if (typeof item.advisorVersion !== 'string' || typeof item.model !== 'string' || typeof item.globalSummary !== 'string' || !Array.isArray(item.warnings) || !item.warnings.every((warning) => typeof warning === 'string') || !Array.isArray(item.orderedSources)) return null;
  const orderedSources = item.orderedSources.flatMap((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    const record = source as Record<string, Json | undefined>;
    if (typeof record.alias !== 'string' || (record.sourceType !== 'task' && record.sourceType !== 'routine') || typeof record.sourceId !== 'string' || typeof record.explanation !== 'string' || typeof record.changed !== 'boolean') return [];
    const sourceType: 'task' | 'routine' = record.sourceType;
    return [{ alias: record.alias, sourceType, sourceId: record.sourceId, explanation: record.explanation, changed: record.changed }];
  });
  return { advisorVersion: item.advisorVersion, model: item.model, globalSummary: item.globalSummary, warnings: item.warnings as string[], orderedSources };
}

async function persistPlanningSession(client: SupabaseClient<Database>, userId: string, input: PlanningInput, result: PlanningResult, options: { inputNow: Date; engineVersion: string; warningCodes: string[]; advice?: PlanningAdviceView | null; idempotencyKey?: string | null }): Promise<PlanningSessionDetail> {
  const blocks = result.proposedBlocks.map((block) => { const value = blockInsert('pending', userId, block); return { source_type: value.source_type, source_entity_id: value.source_entity_id, title: value.title, start_at: value.start_at, end_at: value.end_at, block_index: value.block_index, duration_minutes: value.duration_minutes, metadata: value.metadata }; });
  const { data: sessionId, error } = await client.rpc('create_planning_session_v2', { p_idempotency_key: options.idempotencyKey ?? null, p_window_start: result.window.start, p_window_end: result.window.end, p_input_now: options.inputNow.toISOString(), p_input_hash: input.hash, p_input_snapshot_version: PLANNING_INPUT_SNAPSHOT_VERSION, p_input_snapshot: input.snapshot as unknown as Json, p_engine_version: options.engineVersion, p_warning_codes: options.warningCodes, p_result_summary: resultSummary(result, options.advice), p_blocks: blocks as unknown as Json });
  if (error || !sessionId) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を保存できませんでした。', 500);
  return getPlanningSession(client, userId, sessionId);
}

export async function createPlanningSession(client: SupabaseClient<Database>, userId: string, idempotencyKey: string, dependencies: Partial<PlanningServerDependencies> = {}): Promise<PlanningSessionDetail> {
  const deps = { ...defaultDependencies, ...dependencies };
  const { data: existing, error } = await client.from('planning_sessions').select('id,input_snapshot_version').eq('user_id', userId).eq('idempotency_key', idempotencyKey).maybeSingle();
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を確認できませんでした。', 500);
  if (existing) {
    if (existing.input_snapshot_version !== PLANNING_INPUT_SNAPSHOT_VERSION) throw legacySnapshotError();
    return getPlanningSession(client, userId, existing.id);
  }
  const now = deps.now();
  const input = await deps.loadCurrentInput(client, userId, now);
  return persistPlanningSession(client, userId, input, input.result, { inputNow: now, engineVersion: PLANNING_ENGINE_VERSION, warningCodes: input.warningCodes, idempotencyKey });
}

function summaryData(value: Json): { unscheduledTasks: UnscheduledTask[]; unscheduledRoutines: UnscheduledRoutine[]; advice: PlanningAdviceView | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { unscheduledTasks: [], unscheduledRoutines: [], advice: null };
  const record = value as Record<string, Json | undefined>;
  const advice = parseAdviceView(record.advice);
  return { unscheduledTasks: Array.isArray(record.unscheduledTasks) ? record.unscheduledTasks as unknown as UnscheduledTask[] : [], unscheduledRoutines: Array.isArray(record.unscheduledRoutines) ? record.unscheduledRoutines as unknown as UnscheduledRoutine[] : [], advice };
}

function proposedFromRow(row: PlanningBlockRow): ProposedTimeBlock {
  return { id: row.id, source: row.source_type, taskId: row.source_type === 'task' ? row.source_entity_id : null, routineId: row.source_type === 'routine' ? row.source_entity_id : null, title: row.title, start: row.start_at, end: row.end_at, splitIndex: row.block_index };
}

export function detailFromRows(session: PlanningSessionRow, blocks: PlanningBlockRow[]): PlanningSessionDetail {
  const summary = summaryData(session.result_summary);
  return { sessionId: session.id, status: session.status, windowStart: session.window_start, windowEnd: session.window_end, blocks: blocks.map(proposedFromRow), ...summary, warnings: session.warning_codes.map((code) => warningText[code] ?? code), engineVersion: session.engine_version, createdAt: session.created_at, approvedAt: session.approved_at, rejectedAt: session.rejected_at };
}

interface AdviceDependencies extends PlanningServerDependencies { advisor: () => PlanningAdvisor & { model?: string }; signal?: AbortSignal; }
const defaultAdviceDependencies: AdviceDependencies = { ...defaultDependencies, advisor: () => new OpenAIPlanningAdvisor() };

const legacySnapshotError = () => new PlanningApiError('PLAN_STALE', 'この計画案は旧形式です。新しい計画案を作成してください。', 409);

export function verifyStoredPlanningSnapshot(row: Pick<PlanningSessionRow, 'input_snapshot_version' | 'input_snapshot' | 'input_hash'>): PlanningInputSnapshotV2 {
  if (row.input_snapshot_version === null && row.input_snapshot === null) throw legacySnapshotError();
  if (row.input_snapshot_version !== PLANNING_INPUT_SNAPSHOT_VERSION || !validatePlanningInputSnapshotV2(row.input_snapshot)) {
    throw new PlanningApiError('PLAN_INVALID', '保存済みの計画入力を検証できませんでした。', 409);
  }
  if (hashPlanningInputSnapshotV2(row.input_snapshot) !== row.input_hash) throw new PlanningApiError('PLAN_INVALID', '保存済みの計画入力を検証できませんでした。', 409);
  return row.input_snapshot;
}

export async function createAdvisedPlanningSession(client: SupabaseClient<Database>, userId: string, id: string, dependencies: Partial<AdviceDependencies> = {}): Promise<PlanningSessionDetail> {
  const deps = { ...defaultAdviceDependencies, ...dependencies }; const now = deps.now();
  const saved = await getPlanningSession(client, userId, id);
  if (saved.status !== 'draft') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案だけをAIで改善できます。', 409);
  const { data: row, error: rowError } = await client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (rowError) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を取得できませんでした。', 500);
  if (!row) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  verifyStoredPlanningSnapshot(row);
  const input = await deps.loadCurrentInput(client, userId, new Date(row.input_now));
  if (input.hash !== row.input_hash) throw new PlanningApiError('PLAN_STALE', 'タスクや予定が変更されています。計画案を再作成してください。', 409);
  if (!validateStoredPlan(saved.blocks, input.result, input.store)) throw new PlanningApiError('PLAN_INVALID', '元の計画案を再検証できませんでした。', 422);
  if (planningFreshnessReason(row, input.result.proposedBlocks, now)) throw staleTimeError();
  let aliases; try { aliases = buildPlanningAdviceInput(input.store, input.result, new Date(row.input_now)); } catch (error) { if (error instanceof Error && error.message === 'AI_INPUT_TOO_LARGE') throw new PlanningApiError('AI_INPUT_TOO_LARGE', 'AIへ相談できる項目数は100件までです。', 422); throw error; }
  if (deps.signal?.aborted) throw new PlanningApiError('AI_REQUEST_CANCELLED', 'AI相談をキャンセルしました。', 499);
  const { data: reserved, error: reservationError } = await client.rpc('reserve_ai_advice_request');
  if (reservationError) throw new PlanningApiError('PERSISTENCE_FAILED', 'AI相談を開始できませんでした。', 500);
  if (!reserved) throw new PlanningApiError('AI_RATE_LIMITED', 'AIへの再相談は30秒待ってから実行してください。', 429);
  if (deps.signal?.aborted) throw new PlanningApiError('AI_REQUEST_CANCELLED', 'AI相談をキャンセルしました。', 499);
  const advisor = deps.advisor(); const raw = await advisor.advise(aliases.input, deps.signal);
  let advice; try { advice = sanitizeAdvice(aliases.input, raw); } catch { throw new PlanningApiError('AI_INVALID_RESPONSE', 'AIから有効な改善案を取得できませんでした。', 502); }
  const ordering = orderingSourceIds(advice, aliases);
  const advisedResult = buildPlanningResult({ now: new Date(row.input_now), events: input.events, tasks: input.store.tasks, routines: input.store.routines, completions: input.store.routineCompletions, orderingOverride: ordering });
  if (!validateStoredPlan(advisedResult.proposedBlocks, advisedResult, input.store)) throw new PlanningApiError('PLAN_INVALID', 'AI改善案を安全に配置できませんでした。', 422);
  const view = adviceView(advice, aliases, advisor.model ?? 'configured-model');
  return persistPlanningSession(client, userId, input, { ...advisedResult, warnings: input.result.warnings }, { inputNow: new Date(row.input_now), engineVersion: `${PLANNING_ENGINE_VERSION}+${AI_ADVISOR_VERSION}`, warningCodes: [...new Set([...input.warningCodes, 'AI_ADVICE_APPLIED'])], advice: view });
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

async function planningSnapshotForApproval(client: SupabaseClient<Database>, userId: string, id: string): Promise<{ saved: PlanningSessionDetail; row: PlanningSessionRow; blocksRevision: number }> {
  const { data: row, error } = await client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を取得できませんでした。', 500);
  if (!row) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (row.status !== 'draft') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案だけを承認できます。', 409);
  const { data: blocks, error: blockError } = await client.from('planning_blocks').select('*').eq('planning_session_id', id).eq('user_id', userId).order('start_at');
  if (blockError) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を取得できませんでした。', 500);
  const { data: revision, error: revisionError } = await client.from('planning_sessions').select('blocks_revision').eq('id', id).eq('user_id', userId).maybeSingle();
  if (revisionError || !revision) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を取得できませんでした。', 500);
  if (revision.blocks_revision !== row.blocks_revision) throw new PlanningApiError('PLAN_STALE', '計画案が変更されています。最新の計画案を作成してください。', 409);
  return { saved: detailFromRows(row, blocks), row, blocksRevision: row.blocks_revision };
}

export async function approvePlanningSession(client: SupabaseClient<Database>, userId: string, id: string, dependencies: Partial<PlanningServerDependencies> = {}): Promise<PlanningSessionDetail> {
  const deps = { ...defaultDependencies, ...dependencies };
  const { saved, row, blocksRevision } = await planningSnapshotForApproval(client, userId, id);
  verifyStoredPlanningSnapshot(row);
  const current = await deps.loadCurrentInput(client, userId, new Date(row.input_now));
  if (current.hash !== row.input_hash) throw new PlanningApiError('PLAN_STALE', 'タスクや予定が変更されています。計画案を再作成してください。', 409);
  const owned = new Set([...current.store.tasks.map((item) => `task:${item.id}`), ...current.store.routines.map((item) => `routine:${item.id}`)]);
  const ordering = saved.advice?.orderedSources.map((item) => `${item.sourceType}:${item.sourceId}`).filter((item) => owned.has(item));
  const expected = ordering?.length ? buildPlanningResult({ now: new Date(row.input_now), events: current.events, tasks: current.store.tasks, routines: current.store.routines, completions: current.store.routineCompletions, orderingOverride: ordering }) : current.result;
  if (!validateStoredPlan(saved.blocks, expected, current.store)) throw new PlanningApiError('PLAN_INVALID', '計画案を再検証できませんでした。', 422);
  if (planningFreshnessReason(row, expected.proposedBlocks, deps.now())) throw staleTimeError();
  // approvedは確認状態にすぎない。将来のCalendar書き込みは直前の完全再検証と別の冪等APIを必須とする。
  const { data, error } = await client.rpc('approve_planning_session', { p_session_id: id, p_input_hash: row.input_hash, p_blocks_revision: blocksRevision });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を承認できませんでした。', 500);
  if (data === 'BLOCKS_CHANGED') throw new PlanningApiError('PLAN_STALE', '計画案が変更されています。最新の計画案を作成してください。', 409);
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
