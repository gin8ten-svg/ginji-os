import type OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlanningAdviceInput, orderingSourceIds, sanitizeAdvice } from '@/lib/planning/advisor';
import { OpenAIPlanningAdvisor, planningAdviceSchema } from '@/lib/planning/openai-advisor';
import { buildPlanningResult } from '@/lib/planner/engine';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { PlanningAdviceInput } from '@/types/planning-session';
import type { Routine, Task, TaskStore } from '@/types/tasks';

const now = new Date('2026-07-15T00:00:00.000Z');
const iso = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`).toISOString();
const task = (id: string, title: string, dueAt: string | null = null): Task => ({ id, title, description: `private-${title}`, dueAt, priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: false, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', source: 'user' });
const routine = (id: string, name: string): Routine => ({ id, name, description: `private-${name}`, frequency: { type: 'daily' }, estimatedMinutes: 30, priority: 3, category: '', availableStartTime: null, availableEndTime: null, isActive: true, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', source: 'user' });
const event: ExternalCalendarEvent = { id: 'google-secret-id', calendarId: 'calendar-secret-id', title: 'Google private title', start: iso('2026-07-15', '12:00'), end: iso('2026-07-15', '13:00'), allDay: false, status: 'confirmed', htmlLink: null, colorId: null };
const store = (tasks = [task('b', 'Task secret B'), task('a', 'Task secret A')], routines = [routine('r', 'Routine secret')]): TaskStore => ({ version: 1, tasks, routines, routineCompletions: [] });
const aliases = () => { const value = store(); return buildPlanningAdviceInput(value, buildPlanningResult({ now, events: [event], tasks: value.tasks, routines: value.routines, completions: [] }), now); };
const validAdvice = { orderedSourceIds: ['task_2', 'task_1', 'routine_1'], explanationBySourceId: { task_1: 'one', task_2: 'two', routine_1: 'routine' }, globalSummary: 'summary', warnings: [] };

describe('minimal AI planning input', () => {
  it('自由記述・Google識別子・user/token/secretをprovider payloadへ含めない', () => {
    const text = JSON.stringify(aliases().input);
    for (const forbidden of ['Task secret', 'Routine secret', 'private-', 'Google private title', 'google-secret-id', 'calendar-secret-id', 'user_id', 'token', 'secret']) expect(text).not.toContain(forbidden);
  });
  it('alias対応は入力順でなくID順に決定する', () => { const first = aliases(); const reversed = store([...store().tasks].reverse(), [...store().routines].reverse()); const second = buildPlanningAdviceInput(reversed, buildPlanningResult({ now, events: [event], tasks: reversed.tasks, routines: reversed.routines, completions: [] }), now); expect([...first.aliasToSource]).toEqual([...second.aliasToSource]); });
  it('100件超は停止する', () => { const values = store(Array.from({ length: 101 }, (_, index) => task(String(index).padStart(3, '0'), `t${index}`)), []); expect(() => buildPlanningAdviceInput(values, buildPlanningResult({ now, events: [], tasks: values.tasks, routines: [], completions: [] }), now)).toThrow('AI_INPUT_TOO_LARGE'); });
});

describe('structured advice sanitization', () => {
  it('正常parseし未知alias・重複を除去して欠落を補完', () => { const built = aliases(); const result = sanitizeAdvice(built.input, { ...validAdvice, orderedSourceIds: ['task_2', 'unknown', 'task_2'] }); expect(result.orderedSourceIds).toEqual(['task_2', 'routine_1', 'task_1']); expect(orderingSourceIds(result, built)).toEqual(['task:b', 'routine:r', 'task:a']); });
  it('長文を切り詰め、制御文字・HTML・URL・Markdown linkを除去', () => { const result = sanitizeAdvice(aliases().input, { ...validAdvice, globalSummary: `<b>${'x'.repeat(600)}</b> https://example.com`, warnings: ['bad\u0000 [link](https://example.com)'], explanationBySourceId: { ...validAdvice.explanationBySourceId, task_1: `<script>${'y'.repeat(250)}</script>` } }); expect(result.globalSummary.length).toBeLessThanOrEqual(500); expect(JSON.stringify(result)).not.toMatch(/<|https?:|\u0000/); expect(result.explanationBySourceId.task_1.length).toBeLessThanOrEqual(200); });
  it('追加propertyと不正型を拒否', () => { expect(() => sanitizeAdvice(aliases().input, { ...validAdvice, extra: true })).toThrow('AI_INVALID_RESPONSE'); expect(() => sanitizeAdvice(aliases().input, { ...validAdvice, warnings: 'bad' })).toThrow('AI_INVALID_RESPONSE'); });
  it('空順序は決定論的順序へfallback', () => expect(sanitizeAdvice(aliases().input, { ...validAdvice, orderedSourceIds: [] }).orderedSourceIds).toEqual(aliases().input.deterministicOrdering));
  it('strict JSON schemaは全階層で追加propertyを拒否', () => { const schema = planningAdviceSchema(aliases().input); expect(schema.additionalProperties).toBe(false); expect(schema.properties.explanationBySourceId.additionalProperties).toBe(false); });
});

describe('hard priority band ordering', () => {
  it('同一band内だけAI順序を反映する', () => { const tasks = [task('a', 'A', iso('2026-07-18', '18:00')), task('b', 'B', iso('2026-07-18', '18:00'))]; const result = buildPlanningResult({ now, events: [], tasks, routines: [], completions: [], orderingOverride: ['task:b', 'task:a'] }); expect(result.proposedBlocks.map((item) => item.taskId)).toEqual(['b', 'a']); });
  it('逆順でも期限超過・今日・明日のbandを越えない', () => { const tasks = [task('overdue', 'O', iso('2026-07-14', '18:00')), task('today', 'T', iso('2026-07-15', '18:00')), task('tomorrow', 'M', iso('2026-07-16', '18:00'))]; const result = buildPlanningResult({ now, events: [], tasks, routines: [], completions: [], orderingOverride: ['task:tomorrow', 'task:today', 'task:overdue'] }); expect(result.proposedBlocks.map((item) => item.taskId)).toEqual(['overdue', 'today', 'tomorrow']); });
  it('狭いRoutine枠を7日以内Taskより先に守る', () => { const narrow = { ...routine('narrow', 'N'), availableStartTime: '10:00', availableEndTime: '10:30' }; const result = buildPlanningResult({ now, events: [], tasks: [task('later', 'L', iso('2026-07-18', '18:00'))], routines: [narrow], completions: [], orderingOverride: ['task:later', 'routine:narrow'] }); expect(result.proposedBlocks.some((item) => item.routineId === 'narrow' && item.start === iso('2026-07-15', '10:00'))).toBe(true); });
  it('AI順序でもGoogle busy、期限、remaining、不重複を維持し決定論的', () => { const tasks = [task('a', 'A', iso('2026-07-15', '18:00')), task('b', 'B', iso('2026-07-15', '18:00'))]; const input = { now, events: [event], tasks, routines: [], completions: [], orderingOverride: ['task:b', 'task:a'] }; const result = buildPlanningResult(input); expect(result).toEqual(buildPlanningResult(input)); expect(result.proposedBlocks.every((block) => new Date(block.end) <= new Date(tasks.find((item) => item.id === block.taskId)!.dueAt!))).toBe(true); for (let index = 1; index < result.proposedBlocks.length; index += 1) expect(new Date(result.proposedBlocks[index - 1].end) <= new Date(result.proposedBlocks[index].start)).toBe(true); expect(result.proposedBlocks.every((block) => !(new Date(block.end) > new Date(event.start) && new Date(block.start) < new Date(event.end)))).toBe(true); });
});

describe('OpenAI Responses adapter', () => {
  const input: PlanningAdviceInput = { candidates: [{ alias: 'task_1', sourceType: 'task', priority: 3, deterministicRank: 1, unscheduledReasonCode: null }], deterministicOrdering: ['task_1'], aggregate: { planningDays: 7, busyMinutesByDay: [], freeMinutesByDay: [], maximumContinuousFreeMinutes: 0, scheduledCount: 0, unscheduledCount: 1 } };
  afterEach(() => { delete process.env.OPENAI_API_KEY; });
  it('未設定はAI_NOT_CONFIGURED', () => expect(() => new OpenAIPlanningAdvisor({ apiKey: '' })).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' })));
  it('Responses APIをtool・履歴・backgroundなしで1回だけ呼ぶ', async () => { let calls = 0; let payload: unknown; const client = { responses: { create: async (value: unknown) => { calls += 1; payload = value; return { output: [], output_text: JSON.stringify({ orderedSourceIds: ['task_1'], explanationBySourceId: { task_1: 'reason' }, globalSummary: 'summary', warnings: [] }) }; } } } as unknown as OpenAI; const result = await new OpenAIPlanningAdvisor({ apiKey: 'test-only', client }).advise(input); expect(result.globalSummary).toBe('summary'); expect(calls).toBe(1); expect(payload).toMatchObject({ background: false, store: false, reasoning: { effort: 'none' }, max_output_tokens: 1200 }); expect(payload).not.toHaveProperty('tools'); expect(JSON.stringify(payload)).not.toMatch(/previous_response_id|conversation/); });
  it('不正JSON・refusalをAI_INVALID_RESPONSEにする', async () => { const invalid = { responses: { create: async () => ({ output: [], output_text: '{' }) } } as unknown as OpenAI; await expect(new OpenAIPlanningAdvisor({ apiKey: 'test-only', client: invalid }).advise(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' }); const refusal = { responses: { create: async () => ({ output: [{ type: 'message', content: [{ type: 'refusal' }] }], output_text: '' }) } } as unknown as OpenAI; await expect(new OpenAIPlanningAdvisor({ apiKey: 'test-only', client: refusal }).advise(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' }); });
  it('timeout・rate limit・provider errorを秘匿して分類', async () => { for (const [error, code] of [[{ name: 'APIConnectionTimeoutError', message: 'secret' }, 'AI_TIMEOUT'], [{ status: 429, message: 'secret' }, 'AI_RATE_LIMITED'], [new Error('provider secret'), 'AI_PROVIDER_ERROR']] as const) { const client = { responses: { create: async () => { throw error; } } } as unknown as OpenAI; await expect(new OpenAIPlanningAdvisor({ apiKey: 'test-only', client }).advise(input)).rejects.toMatchObject({ code }); } });
});

describe('AI static security boundary', () => {
  const provider = readFileSync('src/lib/planning/openai-advisor.ts', 'utf8');
  const client = readFileSync('src/lib/planning/client.ts', 'utf8') + readFileSync('src/components/planner-panel.tsx', 'utf8');
  it('API key参照はserver-only providerだけに隔離', () => { expect(provider).toContain("import 'server-only'"); expect(provider).toContain('process.env.OPENAI_API_KEY'); expect(client).not.toContain('OPENAI_API_KEY'); expect(client).not.toContain('OPENAI_PLANNING_MODEL'); });
  it('tool calling・console logging・Google書き込みを実装しない', () => { expect(provider).not.toMatch(/console\.|tools\s*:/); expect(provider).not.toMatch(/web_search|file_search|code_interpreter/); const routes = readFileSync('src/app/api/planning/sessions/[id]/advice/route.ts', 'utf8'); expect(routes).not.toMatch(/calendar|google/i); });
});
