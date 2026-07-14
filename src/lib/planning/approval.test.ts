import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DeterministicPlanningAdvisor, sanitizeAdvice } from '@/lib/planning/advisor';
import { PlanningApiError, planningError, planningJson } from '@/lib/planning/responses';
import { validateStoredPlan } from '@/lib/planning/server';
import type { PlanningResult, ProposedTimeBlock } from '@/types/planning';
import type { TaskStore } from '@/types/tasks';

const migration = readFileSync('supabase/migrations/20260715000400_planning_approval.sql', 'utf8');
const sessionsRoute = readFileSync('src/app/api/planning/sessions/route.ts', 'utf8');
const serverSource = readFileSync('src/lib/planning/server.ts', 'utf8');
const block: ProposedTimeBlock = { id: 'b', source: 'task', taskId: 'task-a', routineId: null, title: 'A', start: '2026-07-15T00:00:00.000Z', end: '2026-07-15T01:00:00.000Z', splitIndex: 1 };
const result = (blocks = [block]): PlanningResult => ({ window: { start: '2026-07-14T23:00:00.000Z', end: '2026-07-21T13:00:00.000Z', timeZone: 'Asia/Tokyo', workdayStart: '08:00', workdayEnd: '22:00', minimumSlotMinutes: 25, dates: ['2026-07-15'] }, busyIntervals: [], freeSlots: [], proposedBlocks: blocks, unscheduledTasks: [], unscheduledRoutines: [], warnings: [] });
const store: TaskStore = { version: 1, tasks: [{ id: 'task-a', title: 'A', description: '', dueAt: null, priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: false, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt: '', updatedAt: '', source: 'user' }], routines: [], routineCompletions: [] };

describe('planning approval constraints', () => {
  it('保存ブロックと決定論的再計算が一致する場合だけ有効', () => expect(validateStoredPlan([block], result(), store)).toBe(true));
  it('overlapや時刻改変を再計算差分として拒否', () => expect(validateStoredPlan([{ ...block, end: '2026-07-15T01:30:00.000Z' }], result(), store)).toBe(false));
  it('完了済みTaskを拒否', () => expect(validateStoredPlan([block], result(), { ...store, tasks: [{ ...store.tasks[0], completedAt: '2026-07-15T00:00:00Z' }] })).toBe(false));
  it('期限後・duration超過などengine出力との差分を拒否', () => expect(validateStoredPlan([block], result([{ ...block, end: '2026-07-15T00:30:00.000Z' }]), store)).toBe(false));
});

describe('migration ownership and atomic transition', () => {
  it('両tableでRLSと所有者policyを定義', () => { expect(migration.match(/enable row level security/g)).toHaveLength(2); expect(migration).toContain('(select auth.uid()) = user_id'); });
  it('planning_blocksに複合所有者FKがある', () => expect(migration).toContain('foreign key (planning_session_id, user_id) references public.planning_sessions(id, user_id)'));
  it('anonをrevokeしauthenticatedだけへgrant', () => { expect(migration).toContain('revoke all on public.planning_sessions, public.planning_blocks from anon'); expect(migration).toContain('to authenticated'); });
  it('draft条件付きRPCで二重承認・承認後却下を防ぐ', () => { expect(migration).toMatch(/status = 'draft' and input_hash = p_input_hash/); expect(migration).toMatch(/reject_planning_session[\s\S]*status = 'draft'/); });
});

describe('server-owned generation and authorization', () => {
  it('生成POSTはrequest bodyを受け取らない', () => { expect(sessionsRoute).not.toContain('.json('); expect(sessionsRoute).not.toContain('user_id'); });
  it('sessionとblock取得にuser_id条件を併用する', () => { expect(serverSource).toContain(".eq('id', id).eq('user_id', userId)"); expect(serverSource).toContain(".eq('planning_session_id', id).eq('user_id', userId)"); });
  it('Google未接続は空eventとwarningへ正規化する', () => expect(serverSource).toContain("events: [], warningCodes: ['CALENDAR_NOT_CONNECTED']"));
  it('Calendar書き込みやservice roleを利用しない', () => { expect(serverSource).not.toMatch(/service.?role/i); expect(serverSource).not.toMatch(/insertGoogle|updateGoogle|deleteGoogle/); });
});

describe('safe API responses', () => {
  it('全responseをprivate no-storeにする', () => expect(planningJson({ ok: true }).headers.get('Cache-Control')).toBe('private, no-store'));
  it('構造化errorを返す', async () => expect(await planningError(new PlanningApiError('PLAN_STALE', 'stale', 409)).json()).toEqual({ code: 'PLAN_STALE', error: 'stale' }));
  it('未知errorの詳細を漏らさない', async () => expect(await planningError(new Error('database secret')).json()).toEqual({ code: 'PERSISTENCE_FAILED', error: '計画の処理に失敗しました。' }));
});

describe('AI-ready advisor', () => {
  const advisorInput = { taskIds: ['a'], routineIds: [] as string[], currentDeterministicOrdering: ['a'], unscheduledReasons: [], aggregate: { busyMinutes: 0, freeMinutes: 60, blockCount: 1 } };
  it('未知IDと未知IDの説明を破棄する', () => expect(sanitizeAdvice(advisorInput, { orderedSourceIds: ['a', 'unknown'], explanationBySourceId: { a: 'ok', unknown: 'no' }, globalSummary: '', warnings: [] })).toMatchObject({ orderedSourceIds: ['a'], explanationBySourceId: { a: 'ok' } }));
  it('no-op advisorは承認状態を生成せず決定論的順序だけ返す', async () => expect((await new DeterministicPlanningAdvisor().advise(advisorInput)).orderedSourceIds).toEqual(['a']));
});
