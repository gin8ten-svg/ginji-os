import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { CalendarEventAlreadyExistsError, CalendarEventConflictError, CalendarEventNotFoundError, CalendarReconnectError, CalendarServiceError, createGoogleCalendarEvent, deleteGoogleCalendarEvent, getGoogleCalendarEvent, googleCalendarEventMatchesWriteInput, listGoogleCalendars, listGoogleEvents, updateGoogleCalendarEvent, validateWritableCalendar, type GoogleCalendarEventWriteInput, type GoogleCalendarWrittenEvent } from '@/lib/calendar/google-api';
import { calendarAccessContext, markCalendarNeedsReconnect } from '@/lib/calendar/server';
import { buildPlanningResult, createPlanningWindow, googleEventsToBusyIntervals, mergeBusyIntervals, validateProposedBlocksAgainstConstraints } from '@/lib/planner/engine';
import { adviceView, AI_ADVISOR_VERSION, buildPlanningAdviceInput, orderingSourceIds, sanitizeAdvice } from '@/lib/planning/advisor';
import { OpenAIPlanningAdvisor, type PlanningAdviceUsage } from '@/lib/planning/openai-advisor';
import { aiAdviceMonthlyCallLimit, estimateAiAdviceCostUsd } from '@/lib/planning/ai-pricing';
import { buildPlanningInputSnapshotV2, hashPlanningInputSnapshotV2, PLANNING_ENGINE_VERSION, PLANNING_INPUT_SNAPSHOT_VERSION, validatePlanningInputSnapshotV2, type PlanningInputSnapshotV2 } from '@/lib/planning/input-snapshot-v2';
import { PlanningApiError } from '@/lib/planning/responses';
import { SupabaseTaskRepository } from '@/lib/supabase-task-repository';
import { createClient } from '@/lib/supabase/server';
import { shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import { weekStart } from '@/lib/practical-mvp';
import type { AiAdviceUsageEventRow, CalendarConnectionRow, Database, Json, PlanningBlockRow, PlanningSessionRow, TimeBlockRow } from '@/types/database';
import type { PlanningResult, ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';
import type { AiAdviceUsageSummary, CalendarEventMutationOperation, CalendarEventPreviewItem, EstimationAccuracySummary, PlanningAdviceView, PlanningAdvisor, PlanningCalendarEventManagementPreview, PlanningCalendarEventMutationItem, PlanningCalendarEventMutationResult, PlanningCalendarEventPreview, PlanningCalendarEventWriteItem, PlanningCalendarWriteResult, PlanningDailyReview, PlanningExecutionPreview, PlanningExecutionResult, PlanningReview, PlanningReviewDay, PlanningSessionDetail, PlanningSessionSummary, PlanningSkipReason, PlanningSkipResult } from '@/types/planning-session';
import type { TaskStore } from '@/types/tasks';
import { hasGoogleCalendarEventWriteScope, type GoogleCalendarSummary } from '@/types/calendar';

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
  return { sessionId: session.id, status: session.status, windowStart: session.window_start, windowEnd: session.window_end, blocks: blocks.map(proposedFromRow), ...summary, warnings: session.warning_codes.map((code) => warningText[code] ?? code), engineVersion: session.engine_version, createdAt: session.created_at, approvedAt: session.approved_at, rejectedAt: session.rejected_at, manuallyEdited: session.manually_edited };
}

interface AdviceDependencies extends PlanningServerDependencies { advisor: () => PlanningAdvisor & { model?: string; lastUsage?: () => PlanningAdviceUsage | null }; signal?: AbortSignal; }
const defaultAdviceDependencies: AdviceDependencies = { ...defaultDependencies, advisor: () => new OpenAIPlanningAdvisor() };

const legacySnapshotError = () => new PlanningApiError('PLAN_STALE', 'この計画案は旧形式です。新しい計画案を作成し、承認してください。', 409);

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
  if (!validateSavedPlanningBlocks(row.manually_edited, saved.blocks, input.result, input)) throw new PlanningApiError('PLAN_INVALID', '元の計画案を再検証できませんでした。', 422);
  // 手動編集済みsavedはinput.resultと一致しないことがあるため、鮮度は元のsaved.blocksで確認する。
  if (planningFreshnessReason(row, saved.blocks, now)) throw staleTimeError();
  let aliases; try { aliases = buildPlanningAdviceInput(input.store, input.result, new Date(row.input_now)); } catch (error) { if (error instanceof Error && error.message === 'AI_INPUT_TOO_LARGE') throw new PlanningApiError('AI_INPUT_TOO_LARGE', 'AIへ相談できる項目数は100件までです。', 422); throw error; }
  if (deps.signal?.aborted) throw new PlanningApiError('AI_REQUEST_CANCELLED', 'AI相談をキャンセルしました。', 499);
  const { data: reserved, error: reservationError } = await client.rpc('reserve_ai_advice_request');
  if (reservationError) throw new PlanningApiError('PERSISTENCE_FAILED', 'AI相談を開始できませんでした。', 500);
  if (!reserved) throw new PlanningApiError('AI_RATE_LIMITED', 'AIへの再相談は30秒待ってから実行してください。', 429);
  if (deps.signal?.aborted) throw new PlanningApiError('AI_REQUEST_CANCELLED', 'AI相談をキャンセルしました。', 499);
  const advisor = deps.advisor();
  const candidateCount = aliases.input.candidates.length;
  const model = advisor.model ?? 'configured-model';
  let succeeded = false;
  try {
    const raw = await advisor.advise(aliases.input, deps.signal);
    let advice; try { advice = sanitizeAdvice(aliases.input, raw); } catch { throw new PlanningApiError('AI_INVALID_RESPONSE', 'AIから有効な改善案を取得できませんでした。', 502); }
    const ordering = orderingSourceIds(advice, aliases);
    const advisedResult = buildPlanningResult({ now: new Date(row.input_now), events: input.events, tasks: input.store.tasks, routines: input.store.routines, completions: input.store.routineCompletions, orderingOverride: ordering });
    if (!validateStoredPlan(advisedResult.proposedBlocks, advisedResult, input.store)) throw new PlanningApiError('PLAN_INVALID', 'AI改善案を安全に配置できませんでした。', 422);
    const view = adviceView(advice, aliases, model);
    succeeded = true;
    await recordAiAdviceUsage(client, id, model, candidateCount, advisor.lastUsage?.() ?? null, true, null);
    return await persistPlanningSession(client, userId, input, { ...advisedResult, warnings: input.result.warnings }, { inputNow: new Date(row.input_now), engineVersion: `${PLANNING_ENGINE_VERSION}+${AI_ADVISOR_VERSION}`, warningCodes: [...new Set([...input.warningCodes, 'AI_ADVICE_APPLIED'])], advice: view });
  } catch (error) {
    if (!succeeded) await recordAiAdviceUsage(client, id, model, candidateCount, advisor.lastUsage?.() ?? null, false, error instanceof PlanningApiError ? error.code : 'AI_PROVIDER_ERROR');
    throw error;
  }
}

/**
 * AI Advice利用量の記録はベストエフォート。自由記述やAI出力全文は送らず、
 * モデル名・候補数・トークン数・成否・エラーコードだけを記録する。記録失敗で
 * ユーザー体験（計画案自体の成否）をブロックしない。
 */
async function recordAiAdviceUsage(client: SupabaseClient<Database>, sessionId: string, model: string, candidateCount: number, usage: PlanningAdviceUsage | null, success: boolean, errorCode: string | null): Promise<void> {
  try {
    await client.rpc('record_ai_advice_usage', {
      p_planning_session_id: sessionId,
      p_model: model,
      p_candidate_count: candidateCount,
      p_input_tokens: usage?.inputTokens ?? null,
      p_output_tokens: usage?.outputTokens ?? null,
      p_success: success,
      p_error_code: errorCode,
    });
  } catch {
    // 利用量記録の失敗は握りつぶす（ログ目的のみで、計画案生成の成否には影響させない）。
  }
}

function tokyoMonthWindow(now: Date): { start: string; end: string } {
  const [yearStr, monthStr] = tokyoDateKey(now).split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const pad = (value: number) => String(value).padStart(2, '0');
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: new Date(`${year}-${pad(month)}-01T00:00:00+09:00`).toISOString(),
    end: new Date(`${nextYear}-${pad(nextMonth)}-01T00:00:00+09:00`).toISOString(),
  };
}

type AiAdviceUsageRow = Pick<AiAdviceUsageEventRow, 'model' | 'input_tokens' | 'output_tokens' | 'success'>;

export async function getAiAdviceUsageSummary(client: SupabaseClient<Database>, userId: string, now = new Date()): Promise<AiAdviceUsageSummary> {
  const { start, end } = tokyoMonthWindow(now);
  const { data, error } = await client
    .from('ai_advice_usage_events')
    .select('model,input_tokens,output_tokens,success')
    .eq('user_id', userId)
    .gte('created_at', start)
    .lt('created_at', end);
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', 'AI利用状況を取得できませんでした。', 500);
  const rows = (data ?? []) as AiAdviceUsageRow[];

  const totalCalls = rows.length;
  const successfulCalls = rows.filter((row) => row.success).length;
  const totalInputTokens = rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0);
  const totalOutputTokens = rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0);
  const estimatedCostUsd = Math.round(rows.reduce((sum, row) => sum + estimateAiAdviceCostUsd(row.model, row.input_tokens ?? 0, row.output_tokens ?? 0), 0) * 10_000) / 10_000;
  const monthlyCallLimit = aiAdviceMonthlyCallLimit();

  return {
    monthStart: start,
    totalCalls,
    successfulCalls,
    failedCalls: totalCalls - successfulCalls,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd,
    monthlyCallLimit,
    nearMonthlyLimit: monthlyCallLimit !== null && totalCalls >= monthlyCallLimit * 0.8,
  };
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

function normalizedBlocks(blocks: ProposedTimeBlock[]) { return blocks.map((item) => ({ source: item.source, sourceId: item.taskId ?? item.routineId, start: new Date(item.start).toISOString(), end: new Date(item.end).toISOString(), blockIndex: item.splitIndex, duration: Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000) })).sort((a, b) => a.start.localeCompare(b.start) || String(a.sourceId).localeCompare(String(b.sourceId))); }

export function validateStoredPlan(blocks: ProposedTimeBlock[], current: PlanningResult, store: TaskStore): boolean {
  const entities = new Set([...store.tasks.filter((item) => !item.completedAt).map((item) => `task:${item.id}`), ...store.routines.filter((item) => item.isActive).map((item) => `routine:${item.id}`)]);
  if (!blocks.every((item) => entities.has(`${item.source}:${item.taskId ?? item.routineId}`) && new Date(item.start) < new Date(item.end))) return false;
  return JSON.stringify(normalizedBlocks(blocks)) === JSON.stringify(normalizedBlocks(current.proposedBlocks));
}

/**
 * manually_edited=falseの通常draftは決定論的Engineの再計算結果との完全一致を要求する
 * （validateStoredPlan）。手動編集済みdraftはEngineの特定の配置と一致しなくなるため、
 * hard constraintだけを独立に再検証するvalidateProposedBlocksAgainstConstraintsへ切り替える。
 */
function validateSavedPlanningBlocks(manuallyEdited: boolean, blocks: ProposedTimeBlock[], expected: PlanningResult, input: Pick<PlanningInput, 'store' | 'events'>): boolean {
  if (!manuallyEdited) return validateStoredPlan(blocks, expected, input.store);
  const googleBusy = mergeBusyIntervals(googleEventsToBusyIntervals(input.events, expected.window));
  return validateProposedBlocksAgainstConstraints(blocks, expected.window, input.store, googleBusy).ok;
}

function expectedPlanningResult(saved: PlanningSessionDetail, row: PlanningSessionRow, current: PlanningInput): PlanningResult {
  const owned = new Set([...current.store.tasks.map((item) => `task:${item.id}`), ...current.store.routines.map((item) => `routine:${item.id}`)]);
  const ordering = saved.advice?.orderedSources.map((item) => `${item.sourceType}:${item.sourceId}`).filter((item) => owned.has(item));
  return ordering?.length ? buildPlanningResult({ now: new Date(row.input_now), events: current.events, tasks: current.store.tasks, routines: current.store.routines, completions: current.store.routineCompletions, orderingOverride: ordering }) : current.result;
}

interface ValidatedPlanningCalendarBlock extends CalendarEventPreviewItem { planningBlockId: string }
type KnownCalendarWrite = Pick<TimeBlockRow, 'planning_block_id' | 'google_calendar_id' | 'google_event_id' | 'start_at' | 'end_at' | 'calendar_write_status' | 'calendar_event_state'>;

function calendarCandidateBlocks(blocks: readonly ProposedTimeBlock[], snapshot: PlanningInputSnapshotV2): ValidatedPlanningCalendarBlock[] {
  const titles = new Map<string, string>([
    ...snapshot.tasks.map((item) => [`task:${item.id}`, item.title] as const),
    ...snapshot.routines.map((item) => [`routine:${item.id}`, item.title] as const),
  ]);
  return blocks.map((block) => {
    const sourceId = block.taskId ?? block.routineId;
    const title = sourceId ? titles.get(`${block.source}:${sourceId}`) : undefined;
    const durationMinutes = (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000;
    if (!sourceId || !title || !Number.isInteger(durationMinutes) || durationMinutes <= 0) throw new PlanningApiError('PLAN_INVALID', 'Calendarプレビューを安全に生成できませんでした。', 422);
    return { planningBlockId: block.id, sourceType: block.source, sourceId, title, start: block.start, end: block.end, blockIndex: block.splitIndex, durationMinutes };
  }).sort((a, b) => a.start.localeCompare(b.start) || a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId) || a.blockIndex - b.blockIndex);
}

function publicCalendarEvent(event: ValidatedPlanningCalendarBlock, calendarState?: CalendarEventPreviewItem['calendarState']): CalendarEventPreviewItem {
  return { sourceType: event.sourceType, sourceId: event.sourceId, title: event.title, start: event.start, end: event.end, blockIndex: event.blockIndex, durationMinutes: event.durationMinutes, ...(calendarState ? { calendarState } : {}) };
}

function removeKnownCalendarWrites(input: PlanningInput, inputNow: Date, knownWrites: readonly KnownCalendarWrite[], allowManagedTimeDrift = false): PlanningInput {
  if (!knownWrites.length) return input;
  const known = new Map(knownWrites.map((item) => [`${item.google_calendar_id}:${item.google_event_id}`, { start: new Date(item.start_at).getTime(), end: new Date(item.end_at).getTime(), managed: item.calendar_write_status === 'succeeded' && item.calendar_event_state === 'active' }]));
  const events = input.events.filter((event) => {
    const expected = known.get(`${event.calendarId}:${event.id}`);
    return !expected || (!(allowManagedTimeDrift && expected.managed) && (expected.start !== new Date(event.start).getTime() || expected.end !== new Date(event.end).getTime()));
  });
  if (events.length === input.events.length) return input;
  const result = buildPlanningResult({ now: inputNow, events, tasks: input.store.tasks, routines: input.store.routines, completions: input.store.routineCompletions });
  const snapshot = buildPlanningInputSnapshotV2({ window: result.window, now: inputNow, tasks: input.store.tasks, routines: input.store.routines, completions: input.store.routineCompletions, events });
  return { ...input, events, result: { ...result, warnings: input.result.warnings }, snapshot, hash: hashPlanningInputSnapshotV2(snapshot) };
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
const stalePreviewError = () => new PlanningApiError('PLAN_STALE', '計画案が古くなっています。新しい計画案を作成し、再度承認してください。', 409);

async function validatePlanningCalendarCandidate(client: SupabaseClient<Database>, userId: string, id: string, dependencies: Partial<PlanningServerDependencies>, knownWrites: readonly KnownCalendarWrite[] = [], allowManagedTimeDrift = false): Promise<{ row: PlanningSessionRow; blocksRevision: number; events: ValidatedPlanningCalendarBlock[] }> {
  const deps = { ...defaultDependencies, ...dependencies };
  const [{ data: row, error }, { data: blockRows, error: blockError }] = await Promise.all([
    client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    client.from('planning_blocks').select('*').eq('planning_session_id', id).eq('user_id', userId).order('start_at'),
  ]);
  if (error || blockError) throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendarプレビューを取得できませんでした。', 500);
  if (!row) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (row.status !== 'approved') throw new PlanningApiError('PLAN_NOT_APPROVED', '承認済みの計画案だけをプレビューできます。', 409);

  const snapshot = verifyStoredPlanningSnapshot(row);
  const saved = detailFromRows(row, blockRows);
  const inputNow = new Date(row.input_now);
  const current = removeKnownCalendarWrites(await deps.loadCurrentInput(client, userId, inputNow), inputNow, knownWrites, allowManagedTimeDrift);
  if (current.hash !== row.input_hash) throw new PlanningApiError('PLAN_STALE', 'タスクや予定が変更されています。新しい計画案を作成し、再度承認してください。', 409);
  const expected = expectedPlanningResult(saved, row, current);
  if (!validateSavedPlanningBlocks(row.manually_edited, saved.blocks, expected, current)) throw new PlanningApiError('PLAN_INVALID', '承認済み計画を再検証できませんでした。', 422);
  // 手動編集済みsavedはexpectedと一致しないことがあるため、鮮度は実際に承認・書き込み対象のsaved.blocksで確認する。
  if (planningFreshnessReason(row, saved.blocks, deps.now())) throw stalePreviewError();
  const events = calendarCandidateBlocks(saved.blocks, snapshot);

  const { data: finalState, error: finalStateError } = await client.from('planning_sessions').select('status,blocks_revision').eq('id', id).eq('user_id', userId).maybeSingle();
  if (finalStateError) throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendarプレビューを取得できませんでした。', 500);
  if (!finalState) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (finalState.status !== 'approved') throw new PlanningApiError('PLAN_NOT_APPROVED', '計画案の承認状態が変更されています。最新の承認済み計画を選択してください。', 409);
  if (finalState.blocks_revision !== row.blocks_revision) throw stalePreviewError();

  return { row, blocksRevision: row.blocks_revision, events };
}

export async function getPlanningCalendarEventPreview(client: SupabaseClient<Database>, userId: string, id: string, dependencies: Partial<PlanningServerDependencies> = {}): Promise<PlanningCalendarEventPreview> {
  const { data: knownRows, error: knownRowsError } = await client.from('time_blocks').select('planning_block_id,google_calendar_id,google_event_id,start_at,end_at,calendar_write_status,calendar_event_state').eq('planning_session_id', id).eq('user_id', userId);
  if (knownRowsError) throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar書き込み状態を確認できませんでした。', 500);
  const knownWrites = (knownRows ?? []) as KnownCalendarWrite[];
  const validated = await validatePlanningCalendarCandidate(client, userId, id, dependencies, knownWrites, true);
  const snapshot = verifyStoredPlanningSnapshot(validated.row);
  const byBlock = new Map(knownWrites.map((row) => [row.planning_block_id, row]));
  const events = validated.events.map((event) => {
    const row = byBlock.get(event.planningBlockId);
    const calendarState: CalendarEventPreviewItem['calendarState'] = !row ? 'not_created' : row.calendar_event_state === 'deleted' ? 'deleted' : row.calendar_write_status === 'succeeded' ? 'active' : row.calendar_write_status === 'writing' ? 'writing' : 'write_failed';
    return publicCalendarEvent(event, calendarState);
  });
  const calendarIds = [...new Set(knownWrites.map((row) => row.google_calendar_id))];
  return { sessionId: validated.row.id, status: 'approved', windowStart: snapshot.window.start, windowEnd: snapshot.window.end, timeZone: snapshot.window.timeZone, calendarId: calendarIds.length === 1 ? calendarIds[0] : null, events };
}

interface PlanningCalendarWriteAccess { userId: string; accessToken: string; connection: CalendarConnectionRow }
interface PlanningCalendarWriteDependencies extends PlanningServerDependencies {
  calendarAccess: (userId: string) => Promise<PlanningCalendarWriteAccess>;
  listCalendars: (accessToken: string, selectedIds: readonly string[]) => Promise<GoogleCalendarSummary[]>;
  createEvent: (calendarId: string, accessToken: string, input: GoogleCalendarEventWriteInput) => Promise<GoogleCalendarWrittenEvent>;
  getEvent: (calendarId: string, eventId: string, accessToken: string) => Promise<GoogleCalendarWrittenEvent>;
  updateEvent: (calendarId: string, eventId: string, accessToken: string, input: GoogleCalendarEventWriteInput, etag: string) => Promise<GoogleCalendarWrittenEvent>;
  deleteEvent: (calendarId: string, eventId: string, accessToken: string, etag: string) => Promise<void>;
}

async function requiredPlanningCalendarWriteAccess(userId: string): Promise<PlanningCalendarWriteAccess> {
  const context = await calendarAccessContext();
  if (!context.ok) {
    const body: unknown = await context.response.clone().json().catch(() => null);
    const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : null;
    if (code === 'NOT_CONNECTED') throw new PlanningApiError('CALENDAR_NOT_CONNECTED', 'Google Calendarを接続してください。', 409);
    if (code === 'RECONNECT_REQUIRED') throw new PlanningApiError('CALENDAR_RECONNECT_REQUIRED', 'Google Calendarを再接続してください。', 409);
    if (code === 'AUTH_REQUIRED') throw new PlanningApiError('AUTH_REQUIRED', '認証が必要です。', 401);
    throw new PlanningApiError('CALENDAR_WRITE_FAILED', 'Google Calendarへ接続できませんでした。', 502);
  }
  if (context.userId !== userId) throw new PlanningApiError('AUTH_REQUIRED', '認証が必要です。', 401);
  if (!hasGoogleCalendarEventWriteScope(context.connection.granted_scopes)) throw new PlanningApiError('CALENDAR_RECONNECT_REQUIRED', '予定の追加権限が必要です。Google Calendarを再接続してください。', 409);
  return { userId: context.userId, accessToken: context.accessToken, connection: context.connection };
}

const defaultPlanningCalendarWriteDependencies: PlanningCalendarWriteDependencies = {
  ...defaultDependencies,
  calendarAccess: requiredPlanningCalendarWriteAccess,
  listCalendars: listGoogleCalendars,
  createEvent: createGoogleCalendarEvent,
  getEvent: getGoogleCalendarEvent,
  updateEvent: updateGoogleCalendarEvent,
  deleteEvent: deleteGoogleCalendarEvent,
};

export function planningGoogleEventId(userId: string, sessionId: string, blockId: string): string {
  return createHash('sha256').update(`ginji-calendar-event-v1:${userId}:${sessionId}:${blockId}`).digest('hex');
}

type CalendarWriteReservation =
  | { result: 'RESERVED'; attemptToken: string }
  | { result: 'ALREADY_SUCCEEDED' }
  | { result: 'IN_PROGRESS' };

function jsonObject(value: Json): Record<string, Json | undefined> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;
}

async function reserveCalendarEventWrite(client: SupabaseClient<Database>, validated: { row: PlanningSessionRow; blocksRevision: number }, blockId: string, calendarId: string, googleEventId: string): Promise<CalendarWriteReservation> {
  const { data, error } = await client.rpc('reserve_calendar_event_write', { p_session_id: validated.row.id, p_block_id: blockId, p_input_hash: validated.row.input_hash, p_blocks_revision: validated.blocksRevision, p_calendar_id: calendarId, p_google_event_id: googleEventId });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar書き込み状態を保存できませんでした。', 500);
  const value = jsonObject(data); const result = typeof value?.result === 'string' ? value.result : null;
  if (result === 'RESERVED' && typeof value?.attempt_token === 'string') return { result, attemptToken: value.attempt_token };
  if (result === 'ALREADY_SUCCEEDED') return { result };
  if (result === 'IN_PROGRESS') return { result };
  if (result === 'NOT_FOUND') throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (result === 'NOT_APPROVED') throw new PlanningApiError('PLAN_NOT_APPROVED', '計画案の承認状態が変更されています。', 409);
  if (result === 'INPUT_CHANGED' || result === 'BLOCKS_CHANGED') throw stalePreviewError();
  if (result === 'BLOCK_NOT_FOUND') throw new PlanningApiError('PLAN_INVALID', '承認済み計画のblockを確認できませんでした。', 422);
  if (result === 'CALENDAR_MISMATCH') throw new PlanningApiError('CALENDAR_TARGET_MISMATCH', 'この計画案は別のCalendarへの書き込みが開始されています。', 409);
  if (result === 'EVENT_DELETED') throw new PlanningApiError('CALENDAR_EVENT_NOT_FOUND', 'この計画案の予定は削除済みです。再追加する場合は新しい計画案を作成・承認してください。', 409);
  throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar書き込み状態を確認できませんでした。', 500);
}

async function completeCalendarEventWrite(client: SupabaseClient<Database>, blockId: string, attemptToken: string, success: boolean, errorCode: string | null, outcome: string): Promise<void> {
  const { data, error } = await client.rpc('complete_calendar_event_write', { p_block_id: blockId, p_attempt_token: attemptToken, p_success: success, p_error_code: errorCode, p_after_data: { outcome } });
  if (error || data !== 'FINISHED') throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar書き込み結果を保存できませんでした。再試行してください。', 500);
}

async function writeOrRecoverGoogleEvent(deps: PlanningCalendarWriteDependencies, calendarId: string, accessToken: string, input: GoogleCalendarEventWriteInput): Promise<'created' | 'already_created'> {
  try {
    const created = await deps.createEvent(calendarId, accessToken, input);
    if (!googleCalendarEventMatchesWriteInput(created, input)) throw new CalendarServiceError('Google Calendarから不整合な予定が返されました。');
    return 'created';
  }
  catch (error) {
    if (!(error instanceof CalendarEventAlreadyExistsError)) throw error;
    const existing = await deps.getEvent(calendarId, input.eventId, accessToken);
    if (!googleCalendarEventMatchesWriteInput(existing, input)) throw new CalendarServiceError('同じIDのGoogle Calendar予定が一致しません。');
    return 'already_created';
  }
}

function writeResultItem(event: ValidatedPlanningCalendarBlock, writeStatus: PlanningCalendarEventWriteItem['writeStatus'], errorCode: PlanningCalendarEventWriteItem['errorCode'] = null): PlanningCalendarEventWriteItem {
  return { ...publicCalendarEvent(event), writeStatus, errorCode };
}

export async function writePlanningSessionToCalendar(client: SupabaseClient<Database>, userId: string, id: string, calendarId: string, dependencies: Partial<PlanningCalendarWriteDependencies> = {}): Promise<PlanningCalendarWriteResult> {
  const deps = { ...defaultPlanningCalendarWriteDependencies, ...dependencies };
  const { data: knownRows, error: knownRowsError } = await client.from('time_blocks').select('planning_block_id,google_calendar_id,google_event_id,start_at,end_at,calendar_write_status,calendar_event_state').eq('planning_session_id', id).eq('user_id', userId);
  if (knownRowsError) throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar書き込み状態を確認できませんでした。', 500);
  const validated = await validatePlanningCalendarCandidate(client, userId, id, deps, (knownRows ?? []) as KnownCalendarWrite[]);
  const access = await deps.calendarAccess(userId);
  if (!hasGoogleCalendarEventWriteScope(access.connection.granted_scopes)) throw new PlanningApiError('CALENDAR_RECONNECT_REQUIRED', '予定の追加権限が必要です。Google Calendarを再接続してください。', 409);
  const selectedCalendarIds = access.connection.selected_calendar_ids;
  if (selectedCalendarIds.length && !selectedCalendarIds.includes(calendarId)) throw new PlanningApiError('CALENDAR_NOT_WRITABLE', '計画時に読み取ったCalendarから追加先を選択してください。', 409);

  let calendars: GoogleCalendarSummary[];
  try { calendars = await deps.listCalendars(access.accessToken, access.connection.selected_calendar_ids); }
  catch (error) {
    if (error instanceof CalendarReconnectError) {
      await markCalendarNeedsReconnect(client, userId);
      throw new PlanningApiError('CALENDAR_RECONNECT_REQUIRED', 'Google Calendarを再接続してください。', 409);
    }
    throw new PlanningApiError('CALENDAR_WRITE_FAILED', '追加先Calendarを確認できませんでした。', 502);
  }
  let targetCalendar: GoogleCalendarSummary;
  try { targetCalendar = validateWritableCalendar(calendarId, calendars); }
  catch { throw new PlanningApiError('CALENDAR_NOT_WRITABLE', '書き込み可能なCalendarを選択してください。', 409); }
  if (!selectedCalendarIds.length && !targetCalendar.primary) throw new PlanningApiError('CALENDAR_NOT_WRITABLE', '計画時に読み取ったメインCalendarを選択してください。', 409);

  const results: PlanningCalendarEventWriteItem[] = [];
  let needsReconnect = false;
  for (let index = 0; index < validated.events.length; index += 1) {
    const event = validated.events[index];
    const googleEventId = planningGoogleEventId(userId, id, event.planningBlockId);
    const reservation = await reserveCalendarEventWrite(client, validated, event.planningBlockId, calendarId, googleEventId);
    if (reservation.result === 'ALREADY_SUCCEEDED') { results.push(writeResultItem(event, 'already_created')); continue; }
    if (reservation.result === 'IN_PROGRESS') { results.push(writeResultItem(event, 'in_progress')); continue; }

    const input: GoogleCalendarEventWriteInput = { eventId: googleEventId, title: event.title, start: event.start, end: event.end, timeZone: 'Asia/Tokyo' };
    let outcome: 'created' | 'already_created';
    try { outcome = await writeOrRecoverGoogleEvent(deps, calendarId, access.accessToken, input); }
    catch (error) {
      const reconnect = error instanceof CalendarReconnectError;
      const errorCode = reconnect ? 'CALENDAR_RECONNECT_REQUIRED' : 'CALENDAR_WRITE_FAILED';
      await completeCalendarEventWrite(client, event.planningBlockId, reservation.attemptToken, false, errorCode, 'failed');
      results.push(writeResultItem(event, 'failed', 'CALENDAR_WRITE_FAILED'));
      if (reconnect) {
        needsReconnect = true;
        await markCalendarNeedsReconnect(client, userId);
        for (const remaining of validated.events.slice(index + 1)) results.push(writeResultItem(remaining, 'not_attempted'));
        break;
      }
      continue;
    }
    await completeCalendarEventWrite(client, event.planningBlockId, reservation.attemptToken, true, null, outcome);
    results.push(writeResultItem(event, outcome));
  }

  const createdCount = results.filter((item) => item.writeStatus === 'created').length;
  const alreadyCreatedCount = results.filter((item) => item.writeStatus === 'already_created').length;
  const failedCount = results.filter((item) => item.writeStatus === 'failed').length;
  const inProgressCount = results.filter((item) => item.writeStatus === 'in_progress').length;
  const notAttemptedCount = results.filter((item) => item.writeStatus === 'not_attempted').length;
  const completedCount = createdCount + alreadyCreatedCount;
  const status = failedCount + inProgressCount + notAttemptedCount === 0 ? 'completed' : completedCount > 0 ? 'partial' : 'failed';
  return { sessionId: id, calendarId, status, createdCount, alreadyCreatedCount, failedCount, inProgressCount, notAttemptedCount, needsReconnect, events: results };
}

type ManagedCalendarRow = Pick<TimeBlockRow, 'planning_block_id' | 'google_calendar_id' | 'google_event_id' | 'start_at' | 'end_at' | 'calendar_write_status' | 'calendar_event_state'>;
type CalendarMutationReservation = { result: 'RESERVED'; attemptToken: string } | { result: 'ALREADY_DELETED' } | { result: 'IN_PROGRESS' };

async function loadManagedCalendarRows(client: SupabaseClient<Database>, userId: string, id: string): Promise<ManagedCalendarRow[]> {
  const { data, error } = await client.from('time_blocks').select('planning_block_id,google_calendar_id,google_event_id,start_at,end_at,calendar_write_status,calendar_event_state').eq('planning_session_id', id).eq('user_id', userId).eq('calendar_write_status', 'succeeded');
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '作成済みCalendar予定を確認できませんでした。', 500);
  return (data ?? []) as ManagedCalendarRow[];
}

function managedCalendarEvents(userId: string, sessionId: string, events: readonly ValidatedPlanningCalendarBlock[], rows: readonly ManagedCalendarRow[]): Array<{ event: ValidatedPlanningCalendarBlock; row: ManagedCalendarRow }> {
  const byBlock = new Map(events.map((event) => [event.planningBlockId, event]));
  return rows.map((row) => {
    const event = byBlock.get(row.planning_block_id);
    if (!event || row.google_event_id !== planningGoogleEventId(userId, sessionId, row.planning_block_id) || new Date(row.start_at).getTime() !== new Date(event.start).getTime() || new Date(row.end_at).getTime() !== new Date(event.end).getTime()) {
      throw new PlanningApiError('PLAN_INVALID', '作成済みCalendar予定と承認済み計画の対応を検証できませんでした。', 422);
    }
    return { event, row };
  });
}

async function storedCalendarEventsForDeletion(client: SupabaseClient<Database>, userId: string, id: string, rows: readonly ManagedCalendarRow[]): Promise<{ row: PlanningSessionRow; blocksRevision: number; managed: ReturnType<typeof managedCalendarEvents> }> {
  const [{ data: session, error }, { data: blocks, error: blockError }] = await Promise.all([
    client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    client.from('planning_blocks').select('*').eq('planning_session_id', id).eq('user_id', userId).order('start_at'),
  ]);
  if (error || blockError) throw new PlanningApiError('PERSISTENCE_FAILED', '作成済みCalendar予定を確認できませんでした。', 500);
  if (!session) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (session.status !== 'approved' && session.status !== 'superseded') throw new PlanningApiError('PLAN_NOT_APPROVED', '承認済みまたは更新済みの計画案だけを管理できます。', 409);
  const snapshot = verifyStoredPlanningSnapshot(session);
  const events = calendarCandidateBlocks(blocks.map(proposedFromRow), snapshot);
  return { row: session, blocksRevision: session.blocks_revision, managed: managedCalendarEvents(userId, id, events, rows) };
}

export async function getPlanningSessionCalendarEventManagementPreview(client: SupabaseClient<Database>, userId: string, id: string): Promise<PlanningCalendarEventManagementPreview> {
  const rows = await loadManagedCalendarRows(client, userId, id);
  if (!rows.length) throw new PlanningApiError('CALENDAR_EVENT_NOT_FOUND', 'この計画案には作成済みのGoogle Calendar予定がありません。', 409);
  const validated = await storedCalendarEventsForDeletion(client, userId, id, rows);
  const calendarIds = [...new Set(rows.map((row) => row.google_calendar_id))];
  if (calendarIds.length !== 1) throw new PlanningApiError('PLAN_INVALID', '管理対象のCalendarを一意に確認できませんでした。', 422);
  return {
    sessionId: id,
    status: validated.row.status as 'approved' | 'superseded',
    timeZone: 'Asia/Tokyo',
    calendarId: calendarIds[0],
    events: validated.managed.map(({ event, row }) => publicCalendarEvent(event, row.calendar_event_state === 'deleted' ? 'deleted' : 'active')),
  };
}

async function reserveCalendarEventMutation(client: SupabaseClient<Database>, validated: { row: PlanningSessionRow; blocksRevision: number }, blockId: string, operation: CalendarEventMutationOperation): Promise<CalendarMutationReservation> {
  const { data, error } = await client.rpc('reserve_calendar_event_mutation', { p_session_id: validated.row.id, p_block_id: blockId, p_input_hash: validated.row.input_hash, p_blocks_revision: validated.blocksRevision, p_operation: operation });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar予定の操作状態を保存できませんでした。', 500);
  const value = jsonObject(data); const result = typeof value?.result === 'string' ? value.result : null;
  if (result === 'RESERVED' && typeof value?.attempt_token === 'string') return { result, attemptToken: value.attempt_token };
  if (result === 'ALREADY_DELETED' || result === 'IN_PROGRESS') return { result };
  if (result === 'NOT_FOUND') throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (result === 'NOT_APPROVED' || result === 'NOT_MANAGEABLE') throw new PlanningApiError('PLAN_NOT_APPROVED', '計画案の状態が変更されています。', 409);
  if (result === 'INPUT_CHANGED' || result === 'BLOCKS_CHANGED') throw stalePreviewError();
  if (result === 'BLOCK_NOT_FOUND') throw new PlanningApiError('PLAN_INVALID', '承認済み計画のblockを確認できませんでした。', 422);
  if (result === 'EVENT_NOT_FOUND' || result === 'EVENT_DELETED') throw new PlanningApiError('CALENDAR_EVENT_NOT_FOUND', '管理対象のGoogle Calendar予定が見つかりません。', 409);
  throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar予定の操作状態を確認できませんでした。', 500);
}

async function completeCalendarEventMutation(client: SupabaseClient<Database>, blockId: string, attemptToken: string, success: boolean, errorCode: string | null, outcome: string): Promise<void> {
  const { data, error } = await client.rpc('complete_calendar_event_mutation', { p_block_id: blockId, p_attempt_token: attemptToken, p_success: success, p_error_code: errorCode, p_after_data: { outcome } });
  if (error || data !== 'FINISHED') throw new PlanningApiError('PERSISTENCE_FAILED', 'Calendar予定の操作結果を保存できませんでした。再試行してください。', 500);
}

function mutationResultItem(event: ValidatedPlanningCalendarBlock, mutationStatus: PlanningCalendarEventMutationItem['mutationStatus'], errorCode: PlanningCalendarEventMutationItem['errorCode'] = null): PlanningCalendarEventMutationItem {
  return { ...publicCalendarEvent(event), mutationStatus, errorCode };
}

function calendarMutationErrorCode(error: unknown): PlanningCalendarEventMutationItem['errorCode'] {
  if (error instanceof CalendarEventNotFoundError) return 'CALENDAR_EVENT_NOT_FOUND';
  if (error instanceof CalendarEventConflictError) return 'CALENDAR_EVENT_CONFLICT';
  if (error instanceof CalendarServiceError && error.message.includes('所有')) return 'CALENDAR_EVENT_MISMATCH';
  return 'CALENDAR_WRITE_FAILED';
}

async function requiredManagedCalendar(client: SupabaseClient<Database>, userId: string, rows: readonly ManagedCalendarRow[], deps: PlanningCalendarWriteDependencies): Promise<{ access: PlanningCalendarWriteAccess; calendarId: string }> {
  const calendarIds = [...new Set(rows.map((row) => row.google_calendar_id))];
  if (calendarIds.length !== 1) throw new PlanningApiError('PLAN_INVALID', '管理対象のCalendarを一意に確認できませんでした。', 422);
  const access = await deps.calendarAccess(userId);
  let calendars: GoogleCalendarSummary[];
  try { calendars = await deps.listCalendars(access.accessToken, access.connection.selected_calendar_ids); }
  catch (error) {
    if (error instanceof CalendarReconnectError) {
      await markCalendarNeedsReconnect(client, userId);
      throw new PlanningApiError('CALENDAR_RECONNECT_REQUIRED', 'Google Calendarを再接続してください。', 409);
    }
    throw new PlanningApiError('CALENDAR_WRITE_FAILED', '管理対象Calendarを確認できませんでした。', 502);
  }
  try { validateWritableCalendar(calendarIds[0], calendars); }
  catch { throw new PlanningApiError('CALENDAR_NOT_WRITABLE', '管理対象Calendarへの書き込み権限を確認してください。', 409); }
  return { access, calendarId: calendarIds[0] };
}

export async function mutatePlanningSessionCalendarEvents(client: SupabaseClient<Database>, userId: string, id: string, operation: CalendarEventMutationOperation, dependencies: Partial<PlanningCalendarWriteDependencies> = {}): Promise<PlanningCalendarEventMutationResult> {
  const deps = { ...defaultPlanningCalendarWriteDependencies, ...dependencies };
  const rows = await loadManagedCalendarRows(client, userId, id);
  if (!rows.length) throw new PlanningApiError('CALENDAR_EVENT_NOT_FOUND', 'この計画案には作成済みのGoogle Calendar予定がありません。', 409);

  let validated: { row: PlanningSessionRow; blocksRevision: number; managed: ReturnType<typeof managedCalendarEvents> };
  if (operation === 'update') {
    const candidate = await validatePlanningCalendarCandidate(client, userId, id, deps, rows, true);
    validated = { row: candidate.row, blocksRevision: candidate.blocksRevision, managed: managedCalendarEvents(userId, id, candidate.events, rows) };
  } else {
    validated = await storedCalendarEventsForDeletion(client, userId, id, rows);
  }
  const activeManaged = validated.managed.filter(({ row }) => row.calendar_event_state === 'active');
  if (!activeManaged.length && operation === 'update') throw new PlanningApiError('CALENDAR_EVENT_NOT_FOUND', '再同期できるGoogle Calendar予定がありません。', 409);
  const { access, calendarId } = await requiredManagedCalendar(client, userId, rows, deps);
  const results: PlanningCalendarEventMutationItem[] = [];
  let needsReconnect = false;

  for (let index = 0; index < validated.managed.length; index += 1) {
    const { event, row } = validated.managed[index];
    if (row.calendar_event_state === 'deleted') {
      if (operation === 'delete') results.push(mutationResultItem(event, 'already_deleted'));
      continue;
    }
    const reservation = await reserveCalendarEventMutation(client, validated, event.planningBlockId, operation);
    if (reservation.result === 'ALREADY_DELETED') { results.push(mutationResultItem(event, 'already_deleted')); continue; }
    if (reservation.result === 'IN_PROGRESS') { results.push(mutationResultItem(event, 'in_progress')); continue; }

    const input: GoogleCalendarEventWriteInput = { eventId: row.google_event_id, title: event.title, start: event.start, end: event.end, timeZone: 'Asia/Tokyo' };
    let outcome: PlanningCalendarEventMutationItem['mutationStatus'];
    try {
      let existing: GoogleCalendarWrittenEvent;
      try { existing = await deps.getEvent(calendarId, row.google_event_id, access.accessToken); }
      catch (error) {
        if (operation === 'delete' && error instanceof CalendarEventNotFoundError) {
          await completeCalendarEventMutation(client, event.planningBlockId, reservation.attemptToken, true, null, 'already_deleted');
          results.push(mutationResultItem(event, 'already_deleted'));
          continue;
        }
        throw error;
      }
      if (existing.id !== row.google_event_id || existing.writeKey !== row.google_event_id) throw new CalendarServiceError('Google Calendar予定の所有マーカーが一致しません。');
      if (operation === 'update') {
        if (googleCalendarEventMatchesWriteInput(existing, input)) outcome = 'already_current';
        else {
          if (!existing.etag) throw new CalendarServiceError('Google Calendar予定の更新条件を確認できません。');
          const updated = await deps.updateEvent(calendarId, row.google_event_id, access.accessToken, input, existing.etag);
          if (!googleCalendarEventMatchesWriteInput(updated, input)) throw new CalendarServiceError('Google Calendar予定をcanonical内容へ更新できませんでした。');
          outcome = 'updated';
        }
      } else {
        if (!existing.etag) throw new CalendarServiceError('Google Calendar予定の削除条件を確認できません。');
        try { await deps.deleteEvent(calendarId, row.google_event_id, access.accessToken, existing.etag); outcome = 'deleted'; }
        catch (error) { if (error instanceof CalendarEventNotFoundError) outcome = 'already_deleted'; else throw error; }
      }
    } catch (error) {
      const reconnect = error instanceof CalendarReconnectError;
      const errorCode = reconnect ? 'CALENDAR_RECONNECT_REQUIRED' : calendarMutationErrorCode(error);
      await completeCalendarEventMutation(client, event.planningBlockId, reservation.attemptToken, false, errorCode, 'failed');
      results.push(mutationResultItem(event, 'failed', errorCode));
      if (reconnect) {
        needsReconnect = true;
        await markCalendarNeedsReconnect(client, userId);
        for (const remaining of validated.managed.slice(index + 1)) results.push(mutationResultItem(remaining.event, 'not_attempted'));
        break;
      }
      continue;
    }
    await completeCalendarEventMutation(client, event.planningBlockId, reservation.attemptToken, true, null, outcome);
    results.push(mutationResultItem(event, outcome));
  }

  const changedCount = results.filter((item) => item.mutationStatus === 'updated' || item.mutationStatus === 'deleted').length;
  const unchangedCount = results.filter((item) => item.mutationStatus === 'already_current' || item.mutationStatus === 'already_deleted').length;
  const failedCount = results.filter((item) => item.mutationStatus === 'failed').length;
  const inProgressCount = results.filter((item) => item.mutationStatus === 'in_progress').length;
  const notAttemptedCount = results.filter((item) => item.mutationStatus === 'not_attempted').length;
  const completedCount = changedCount + unchangedCount;
  const status = failedCount + inProgressCount + notAttemptedCount === 0 ? 'completed' : completedCount > 0 ? 'partial' : 'failed';
  return { sessionId: id, calendarId, operation, status, changedCount, unchangedCount, failedCount, inProgressCount, notAttemptedCount, needsReconnect, events: results };
}

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
  const expected = expectedPlanningResult(saved, row, current);
  if (!validateSavedPlanningBlocks(row.manually_edited, saved.blocks, expected, current)) throw new PlanningApiError('PLAN_INVALID', '計画案を再検証できませんでした。', 422);
  // 手動編集済みsavedはexpectedと一致しないことがあるため、鮮度は実際に承認対象のsaved.blocksで確認する。
  if (planningFreshnessReason(row, saved.blocks, deps.now())) throw staleTimeError();
  // approvedは確認状態にすぎない。Calendar書き込みは直前の完全再検証と別の冪等APIを必須とする。
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

/** 既存draftがあれば明示的に却下してから、同一のcalculate()経路で新しいdraftを作成する。 */
export async function regeneratePlanningSession(client: SupabaseClient<Database>, userId: string, currentSessionId: string, idempotencyKey: string, dependencies: Partial<PlanningServerDependencies> = {}): Promise<PlanningSessionDetail> {
  const current = await getPlanningSession(client, userId, currentSessionId);
  if (current.status === 'draft') {
    const { data, error } = await client.rpc('reject_planning_session', { p_session_id: currentSessionId });
    if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画案を再作成できませんでした。', 500);
    if (data !== 'REJECTED') throw new PlanningApiError('PLAN_STALE', '計画案の状態が変更されています。最新の状態を確認してください。', 409);
  }
  return createPlanningSession(client, userId, idempotencyKey, dependencies);
}

async function ownedDraftBlockSession(client: SupabaseClient<Database>, userId: string, sessionId: string, blockId: string, action: string): Promise<void> {
  const { data: block, error } = await client.from('planning_blocks').select('planning_session_id').eq('id', blockId).eq('user_id', userId).maybeSingle();
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', `計画blockを${action}できませんでした。`, 500);
  if (!block || block.planning_session_id !== sessionId) throw new PlanningApiError('PLAN_BLOCK_NOT_FOUND', `${action}対象の計画blockが見つかりません。`, 404);
}

export async function deletePlanningBlock(client: SupabaseClient<Database>, userId: string, sessionId: string, blockId: string): Promise<PlanningSessionDetail> {
  await ownedDraftBlockSession(client, userId, sessionId, blockId, '削除');
  const { data, error } = await client.rpc('delete_planning_block', { p_block_id: blockId });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画blockを削除できませんでした。', 500);
  if (data !== 'DELETED') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案のblockだけを削除できます。', 409);
  return getPlanningSession(client, userId, sessionId);
}

export async function updatePlanningBlockTime(client: SupabaseClient<Database>, userId: string, sessionId: string, blockId: string, start: string, end: string): Promise<PlanningSessionDetail> {
  await ownedDraftBlockSession(client, userId, sessionId, blockId, '更新');
  const { data, error } = await client.rpc('update_planning_block_time', { p_block_id: blockId, p_start_at: start, p_end_at: end });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画blockを更新できませんでした。', 500);
  if (data === 'OVERLAPS') throw new PlanningApiError('PLAN_BLOCK_OVERLAPS', 'この時間帯は他の予定と重複しています。', 409);
  if (data !== 'UPDATED') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案のblockだけを編集できます。', 409);
  return getPlanningSession(client, userId, sessionId);
}

export async function updatePlanningBlockTask(client: SupabaseClient<Database>, userId: string, sessionId: string, blockId: string, taskId: string): Promise<PlanningSessionDetail> {
  await ownedDraftBlockSession(client, userId, sessionId, blockId, '更新');
  const { data, error } = await client.rpc('update_planning_block_task', { p_block_id: blockId, p_task_id: taskId });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '計画blockを更新できませんでした。', 500);
  if (data === 'NOT_TASK_BLOCK') throw new PlanningApiError('PLAN_INVALID', 'この計画blockはタスクの差し替えに対応していません。', 409);
  if (data === 'TASK_NOT_FOUND') throw new PlanningApiError('INVALID_REQUEST', '差し替え先のタスクが見つかりません。', 400);
  if (data !== 'UPDATED') throw new PlanningApiError('PLAN_NOT_DRAFT', '下書きの計画案のblockだけを編集できます。', 409);
  return getPlanningSession(client, userId, sessionId);
}

type ExecutionTimeBlockRow = Pick<TimeBlockRow, 'planning_block_id' | 'task_id' | 'start_at' | 'end_at' | 'status' | 'status_reason' | 'actual_minutes'>;

export async function getPlanningExecutionPreview(client: SupabaseClient<Database>, userId: string, id: string): Promise<PlanningExecutionPreview> {
  const { data: session, error: sessionError } = await client.from('planning_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (sessionError) throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を取得できませんでした。', 500);
  if (!session) throw new PlanningApiError('PLAN_NOT_FOUND', '計画案が見つかりません。', 404);
  if (session.status !== 'approved' && session.status !== 'superseded') throw new PlanningApiError('PLAN_NOT_APPROVED', '承認済みの計画案だけを実行記録できます。', 409);
  const isLegacySnapshot = session.input_snapshot_version === null && session.input_snapshot === null;
  const snapshot = isLegacySnapshot ? null : verifyStoredPlanningSnapshot(session);

  const [{ data: blockRows, error: blockError }, { data: executionRows, error: executionError }] = await Promise.all([
    client.from('planning_blocks').select('*').eq('planning_session_id', id).eq('user_id', userId).order('start_at'),
    client.from('time_blocks').select('planning_block_id,task_id,start_at,end_at,status,status_reason,actual_minutes').eq('planning_session_id', id).eq('user_id', userId).eq('calendar_write_status', 'succeeded').order('start_at'),
  ]);
  if (blockError || executionError) throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を取得できませんでした。', 500);

  const planningBlocks = new Map(((blockRows ?? []) as PlanningBlockRow[]).map((row) => [row.id, row]));
  const executionTaskIds = [...new Set(((executionRows ?? []) as ExecutionTimeBlockRow[]).map((row) => row.task_id).filter((taskId): taskId is string => taskId !== null))];
  const taskTitles = snapshot ? new Map(snapshot.tasks.map((task) => [task.id, task.title])) : await currentTaskTitles(client, userId, executionTaskIds);
  const blocks = ((executionRows ?? []) as ExecutionTimeBlockRow[]).flatMap((row) => {
    if (!row.task_id) return [];
    const planningBlock = planningBlocks.get(row.planning_block_id);
    const title = taskTitles.get(row.task_id);
    if (!planningBlock || planningBlock.source_type !== 'task' || planningBlock.source_entity_id !== row.task_id || planningBlock.start_at !== row.start_at || planningBlock.end_at !== row.end_at || !title) {
      throw new PlanningApiError('PLAN_INVALID', '実行blockと承認済み計画の対応を検証できませんでした。', 422);
    }
    if (row.status !== 'approved' && row.status !== 'in_progress' && row.status !== 'completed' && row.status !== 'skipped') return [];
    return [{ planningBlockId: row.planning_block_id, taskId: row.task_id, title, start: row.start_at, end: row.end_at, plannedMinutes: planningBlock.duration_minutes, status: row.status, statusReason: row.status_reason, actualMinutes: row.actual_minutes }];
  });
  return { sessionId: id, status: session.status, timeZone: 'Asia/Tokyo', blocks };
}

async function currentTaskTitles(client: SupabaseClient<Database>, userId: string, taskIds: string[]): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map();
  const { data, error } = await client.from('tasks').select('id,title').eq('user_id', userId).in('id', taskIds);
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を取得できませんでした。', 500);
  return new Map((data ?? []).map((row) => [row.id, row.title]));
}

export async function completePlanningTimeBlock(client: SupabaseClient<Database>, sessionId: string, blockId: string, actualMinutes: number | null): Promise<PlanningExecutionResult> {
  const { data, error } = await client.rpc('complete_planning_time_block', { p_session_id: sessionId, p_block_id: blockId, p_actual_minutes: actualMinutes });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を保存できませんでした。', 500);
  const value = jsonObject(data);
  const result = typeof value?.result === 'string' ? value.result : null;
  if (result === 'NOT_FOUND') throw new PlanningApiError('TIME_BLOCK_NOT_FOUND', '実行対象のblockが見つかりません。Google Calendarへの追加状態を確認してください。', 404);
  if (result === 'SESSION_NOT_EXECUTABLE') throw new PlanningApiError('PLAN_NOT_APPROVED', '計画案の状態が変更されています。承認済み計画を選択してください。', 409);
  if (result === 'NOT_TASK_BLOCK' || result === 'NOT_COMPLETABLE') throw new PlanningApiError('TIME_BLOCK_NOT_COMPLETABLE', 'このblockはタスク完了として記録できません。', 409);
  if (result !== 'COMPLETED' && result !== 'ALREADY_COMPLETED' && result !== 'ACTUAL_RECORDED') {
    throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を確認できませんでした。', 500);
  }
  const savedActualMinutes = typeof value?.actual_minutes === 'number' && Number.isInteger(value.actual_minutes) ? value.actual_minutes : null;
  return {
    planningBlockId: blockId,
    status: 'completed',
    actualMinutes: savedActualMinutes,
    outcome: result === 'COMPLETED' ? 'completed' : result === 'ACTUAL_RECORDED' ? 'actual_recorded' : 'already_completed',
    taskCompleted: value?.task_completed === true,
  };
}

export async function skipPlanningTimeBlock(client: SupabaseClient<Database>, sessionId: string, blockId: string, reason: PlanningSkipReason): Promise<PlanningSkipResult> {
  const { data, error } = await client.rpc('skip_planning_time_block', { p_session_id: sessionId, p_block_id: blockId, p_reason: reason });
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を保存できませんでした。', 500);
  const value = jsonObject(data);
  const result = typeof value?.result === 'string' ? value.result : null;
  if (result === 'NOT_FOUND') throw new PlanningApiError('TIME_BLOCK_NOT_FOUND', '実行対象のblockが見つかりません。Google Calendarへの追加状態を確認してください。', 404);
  if (result === 'SESSION_NOT_EXECUTABLE') throw new PlanningApiError('PLAN_NOT_APPROVED', '計画案の状態が変更されています。承認済み計画を選択してください。', 409);
  if (result === 'NOT_TASK_BLOCK' || result === 'NOT_SKIPPABLE') throw new PlanningApiError('TIME_BLOCK_NOT_SKIPPABLE', 'このblockはスキップ・持ち越しとして記録できません。', 409);
  if (result === 'NOT_YET_ENDED') throw new PlanningApiError('TIME_BLOCK_NOT_YET_ENDED', '予定時刻が終了するまで持ち越しにはできません。', 409);
  if (result !== 'SKIPPED' && result !== 'ALREADY_SKIPPED') throw new PlanningApiError('PERSISTENCE_FAILED', '実行記録を確認できませんでした。', 500);
  const statusReason = value?.status_reason === 'user_skipped' || value?.status_reason === 'carried_over' ? value.status_reason : reason;
  return { planningBlockId: blockId, status: 'skipped', statusReason, outcome: result === 'SKIPPED' ? 'skipped' : 'already_skipped' };
}

type ReviewTimeBlockRow = Pick<TimeBlockRow, 'start_at' | 'end_at' | 'status' | 'actual_minutes'>;

export async function getPlanningExecutionReview(client: SupabaseClient<Database>, userId: string, now = new Date()): Promise<PlanningReview> {
  const today = tokyoDateKey(now);
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, index) => shiftTokyoDate(start, index)).filter((date) => date <= today);
  const windowStart = new Date(`${start}T00:00:00+09:00`).toISOString();
  const windowEnd = new Date(`${shiftTokyoDate(today, 1)}T00:00:00+09:00`).toISOString();

  const { data, error } = await client
    .from('time_blocks')
    .select('start_at,end_at,status,actual_minutes')
    .eq('user_id', userId)
    .eq('calendar_write_status', 'succeeded')
    .not('task_id', 'is', null)
    .gte('start_at', windowStart)
    .lt('start_at', windowEnd);
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '振り返りを取得できませんでした。', 500);

  const buckets = new Map<string, PlanningReviewDay>(days.map((date) => [date, { date, plannedMinutes: 0, actualMinutes: 0, totalBlocks: 0, completedBlocks: 0, recordedActualBlocks: 0 }]));
  for (const row of (data ?? []) as ReviewTimeBlockRow[]) {
    const bucket = buckets.get(tokyoDateKey(new Date(row.start_at)));
    if (!bucket) continue;
    bucket.plannedMinutes += Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000);
    bucket.totalBlocks += 1;
    if (row.status !== 'completed') continue;
    bucket.completedBlocks += 1;
    if (row.actual_minutes !== null) { bucket.actualMinutes += row.actual_minutes; bucket.recordedActualBlocks += 1; }
  }
  return { timeZone: 'Asia/Tokyo', days: days.map((date) => buckets.get(date)!) };
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
type DailyReviewTimeBlockRow = Pick<TimeBlockRow, 'planning_block_id' | 'task_id' | 'start_at' | 'end_at' | 'status' | 'status_reason' | 'actual_minutes'>;

export async function getPlanningDailyReview(client: SupabaseClient<Database>, userId: string, date: string): Promise<PlanningDailyReview> {
  if (!DATE_KEY_PATTERN.test(date)) throw new PlanningApiError('INVALID_REQUEST', '日付の形式が正しくありません。', 400);
  const windowStart = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(windowStart.getTime())) throw new PlanningApiError('INVALID_REQUEST', '日付の形式が正しくありません。', 400);
  const windowEnd = new Date(`${shiftTokyoDate(date, 1)}T00:00:00+09:00`);

  const { data, error } = await client
    .from('time_blocks')
    .select('planning_block_id,task_id,start_at,end_at,status,status_reason,actual_minutes')
    .eq('user_id', userId)
    .eq('calendar_write_status', 'succeeded')
    .not('task_id', 'is', null)
    .gte('start_at', windowStart.toISOString())
    .lt('start_at', windowEnd.toISOString())
    .order('start_at');
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '日次振り返りを取得できませんでした。', 500);
  const rows = (data ?? []) as DailyReviewTimeBlockRow[];

  const blockIds = rows.map((row) => row.planning_block_id);
  const { data: blockRows, error: blockError } = blockIds.length
    ? await client.from('planning_blocks').select('id,title').eq('user_id', userId).in('id', blockIds)
    : { data: [] as Array<{ id: string; title: string }>, error: null };
  if (blockError) throw new PlanningApiError('PERSISTENCE_FAILED', '日次振り返りを取得できませんでした。', 500);
  const titles = new Map((blockRows ?? []).map((row) => [row.id, row.title]));

  const blocks = rows.flatMap((row) => {
    if (row.status !== 'approved' && row.status !== 'in_progress' && row.status !== 'completed' && row.status !== 'skipped') return [];
    return [{
      taskId: row.task_id!,
      title: titles.get(row.planning_block_id) ?? '(削除された予定)',
      start: row.start_at,
      end: row.end_at,
      plannedMinutes: Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000),
      status: row.status,
      statusReason: row.status_reason,
      actualMinutes: row.actual_minutes,
    }];
  });

  const summary = blocks.reduce((acc, block) => {
    acc.plannedMinutes += block.plannedMinutes;
    if (block.status === 'completed') { acc.completed += 1; acc.actualMinutes += block.actualMinutes ?? 0; }
    else if (block.status === 'skipped') acc.skipped += 1;
    else acc.pending += 1;
    return acc;
  }, { completed: 0, skipped: 0, pending: 0, plannedMinutes: 0, actualMinutes: 0 });

  return { date, timeZone: 'Asia/Tokyo', blocks, summary };
}

type EstimationTimeBlockRow = Pick<TimeBlockRow, 'task_id' | 'start_at' | 'end_at' | 'actual_minutes'>;

export async function getPlanningEstimationAccuracy(client: SupabaseClient<Database>, userId: string, now = new Date(), rangeDays = 30): Promise<EstimationAccuracySummary> {
  const clampedDays = Math.min(90, Math.max(7, Math.round(rangeDays)));
  const windowStart = new Date(now.getTime() - clampedDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from('time_blocks')
    .select('task_id,start_at,end_at,actual_minutes')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .eq('calendar_write_status', 'succeeded')
    .not('task_id', 'is', null)
    .not('actual_minutes', 'is', null)
    .gte('start_at', windowStart);
  if (error) throw new PlanningApiError('PERSISTENCE_FAILED', '見積もり誤差を取得できませんでした。', 500);
  const rows = (data ?? []) as EstimationTimeBlockRow[];
  if (!rows.length) {
    return { rangeDays: clampedDays, sampleSize: 0, totalPlannedMinutes: 0, totalActualMinutes: 0, averageVarianceMinutes: 0, averageVariancePercent: null, overEstimatedCount: 0, underEstimatedCount: 0, accurateCount: 0, items: [] };
  }

  const byTask = new Map<string, { plannedMinutes: number; actualMinutes: number }>();
  for (const row of rows) {
    const taskId = row.task_id!;
    const plannedMinutes = Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000);
    const current = byTask.get(taskId) ?? { plannedMinutes: 0, actualMinutes: 0 };
    current.plannedMinutes += plannedMinutes;
    current.actualMinutes += row.actual_minutes ?? 0;
    byTask.set(taskId, current);
  }
  const titles = await currentTaskTitles(client, userId, [...byTask.keys()]);

  let totalPlannedMinutes = 0; let totalActualMinutes = 0; let overEstimatedCount = 0; let underEstimatedCount = 0; let accurateCount = 0;
  const items = [...byTask.entries()].map(([taskId, value]) => {
    totalPlannedMinutes += value.plannedMinutes; totalActualMinutes += value.actualMinutes;
    const varianceMinutes = value.actualMinutes - value.plannedMinutes;
    if (varianceMinutes > 0) underEstimatedCount += 1; else if (varianceMinutes < 0) overEstimatedCount += 1; else accurateCount += 1;
    return { taskId, title: titles.get(taskId) ?? '(削除されたタスク)', plannedMinutes: value.plannedMinutes, actualMinutes: value.actualMinutes, varianceMinutes };
  }).sort((a, b) => Math.abs(b.varianceMinutes) - Math.abs(a.varianceMinutes)).slice(0, 10);

  const averageVarianceMinutes = Math.round((totalActualMinutes - totalPlannedMinutes) / byTask.size);
  const averageVariancePercent = totalPlannedMinutes > 0 ? Math.round(((totalActualMinutes - totalPlannedMinutes) / totalPlannedMinutes) * 1000) / 10 : null;

  return { rangeDays: clampedDays, sampleSize: byTask.size, totalPlannedMinutes, totalActualMinutes, averageVarianceMinutes, averageVariancePercent, overEstimatedCount, underEstimatedCount, accurateCount, items };
}
