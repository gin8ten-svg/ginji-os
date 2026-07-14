import { tokyoDateKey } from '@/lib/date-time';
import { planningPriorityBand } from '@/lib/planner/engine';
import type { PlanningResult } from '@/types/planning';
import type { PlanningAdvice, PlanningAdviceInput, PlanningAdviceView, PlanningAdvisor } from '@/types/planning-session';
import type { TaskStore } from '@/types/tasks';

export const AI_ADVISOR_VERSION = 'openai-advice-v1';
export const MAX_ADVICE_CANDIDATES = 100;

export interface AdviceAliases { input: PlanningAdviceInput; aliasToSource: Map<string, { sourceType: 'task' | 'routine'; sourceId: string }>; }

const minutesOfDay = (value: string | null) => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
const duration = (start: string, end: string) => Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));

export function buildPlanningAdviceInput(store: TaskStore, result: PlanningResult, now: Date): AdviceAliases {
  const tasks = store.tasks.filter((item) => !item.completedAt && item.remainingMinutes > 0).sort((a, b) => a.id.localeCompare(b.id));
  const routines = store.routines.filter((item) => item.isActive).sort((a, b) => a.id.localeCompare(b.id));
  if (tasks.length + routines.length > MAX_ADVICE_CANDIDATES) throw new Error('AI_INPUT_TOO_LARGE');
  const aliases = new Map<string, { sourceType: 'task' | 'routine'; sourceId: string }>();
  const sourceToAlias = new Map<string, string>();
  tasks.forEach((item, index) => { const alias = `task_${index + 1}`; aliases.set(alias, { sourceType: 'task', sourceId: item.id }); sourceToAlias.set(`task:${item.id}`, alias); });
  routines.forEach((item, index) => { const alias = `routine_${index + 1}`; aliases.set(alias, { sourceType: 'routine', sourceId: item.id }); sourceToAlias.set(`routine:${item.id}`, alias); });
  const deterministicSources = [...new Set(result.proposedBlocks.map((item) => `${item.source}:${item.taskId ?? item.routineId}`))];
  for (const item of [...tasks.map((task) => `task:${task.id}`), ...routines.map((routine) => `routine:${routine.id}`)]) if (!deterministicSources.includes(item)) deterministicSources.push(item);
  const ordering = deterministicSources.map((item) => sourceToAlias.get(item)).filter((item): item is string => Boolean(item));
  const rank = new Map(ordering.map((alias, index) => [alias, index + 1]));
  const candidates = [
    ...tasks.map((task, index) => { const alias = `task_${index + 1}`; const due = task.dueAt ? new Date(task.dueAt).getTime() : null; return { alias, sourceType: 'task' as const, priority: task.priority, deterministicRank: rank.get(alias) ?? ordering.length + index + 1, overdue: due !== null && due < now.getTime(), dueInMinutes: due === null ? null : Math.round((due - now.getTime()) / 60_000), remainingMinutes: task.remainingMinutes, estimatedMinutes: task.estimatedMinutes, splittable: task.splittable, minimumBlockMinutes: task.minimumBlockMinutes, unscheduledReasonCode: result.unscheduledTasks.some((item) => item.taskId === task.id) ? 'NO_FEASIBLE_SLOT' : null }; }),
    ...routines.map((routine, index) => { const alias = `routine_${index + 1}`; return { alias, sourceType: 'routine' as const, priority: routine.priority, deterministicRank: rank.get(alias) ?? ordering.length + tasks.length + index + 1, durationMinutes: routine.estimatedMinutes, constrainedTimeWindow: Boolean(routine.availableStartTime && routine.availableEndTime), availableStartMinutes: minutesOfDay(routine.availableStartTime), availableEndMinutes: minutesOfDay(routine.availableEndTime), targetDayCount: result.window.dates.filter((date) => result.proposedBlocks.some((block) => block.routineId === routine.id && tokyoDateKey(new Date(block.start)) === date) || result.unscheduledRoutines.some((item) => item.routineId === routine.id && item.targetDate === date)).length, unscheduledReasonCode: result.unscheduledRoutines.some((item) => item.routineId === routine.id) ? 'NO_FEASIBLE_SLOT' : null }; }),
  ];
  const busyMinutesByDay = result.window.dates.map((date) => result.busyIntervals.filter((item) => tokyoDateKey(new Date(item.start)) === date).reduce((sum, item) => sum + duration(item.start, item.end), 0));
  const freeMinutesByDay = result.window.dates.map((date) => result.freeSlots.filter((item) => tokyoDateKey(new Date(item.start)) === date).reduce((sum, item) => sum + duration(item.start, item.end), 0));
  return { input: { candidates, deterministicOrdering: ordering, aggregate: { planningDays: result.window.dates.length, busyMinutesByDay, freeMinutesByDay, maximumContinuousFreeMinutes: Math.max(0, ...result.freeSlots.map((item) => duration(item.start, item.end))), scheduledCount: result.proposedBlocks.length, unscheduledCount: result.unscheduledTasks.length + result.unscheduledRoutines.length } }, aliasToSource: aliases };
}

function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/<[^>]*>/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sanitizeAdvice(input: PlanningAdviceInput, value: unknown): PlanningAdvice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_INVALID_RESPONSE');
  const record = value as Record<string, unknown>; const allowedKeys = ['orderedSourceIds', 'explanationBySourceId', 'globalSummary', 'warnings'];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key)) || !Array.isArray(record.orderedSourceIds) || !record.explanationBySourceId || typeof record.explanationBySourceId !== 'object' || Array.isArray(record.explanationBySourceId) || typeof record.globalSummary !== 'string' || !Array.isArray(record.warnings)) throw new Error('AI_INVALID_RESPONSE');
  if (!record.orderedSourceIds.every((item) => typeof item === 'string') || !record.warnings.every((item) => typeof item === 'string')) throw new Error('AI_INVALID_RESPONSE');
  const allowed = new Set(input.candidates.map((item) => item.alias)); const seen = new Set<string>();
  const ordered = (record.orderedSourceIds as string[]).filter((id) => allowed.has(id) && !seen.has(id) && seen.add(id)).slice(0, MAX_ADVICE_CANDIDATES);
  for (const alias of input.deterministicOrdering) if (!seen.has(alias)) { seen.add(alias); ordered.push(alias); }
  const rawExplanations = record.explanationBySourceId as Record<string, unknown>; const explanations: Record<string, string> = {};
  for (const alias of ordered) if (typeof rawExplanations[alias] === 'string') explanations[alias] = cleanText(rawExplanations[alias], 200);
  return { orderedSourceIds: ordered, explanationBySourceId: explanations, globalSummary: cleanText(record.globalSummary, 500), warnings: (record.warnings as string[]).slice(0, 5).map((item) => cleanText(item, 160)).filter(Boolean) };
}

export function adviceView(advice: PlanningAdvice, aliases: AdviceAliases, model: string): PlanningAdviceView {
  return { advisorVersion: AI_ADVISOR_VERSION, model, globalSummary: advice.globalSummary, warnings: advice.warnings, orderedSources: advice.orderedSourceIds.flatMap((alias, index) => { const source = aliases.aliasToSource.get(alias); return source ? [{ alias, ...source, explanation: advice.explanationBySourceId[alias] ?? '', changed: aliases.input.deterministicOrdering[index] !== alias }] : []; }) };
}

export function orderingSourceIds(advice: PlanningAdvice, aliases: AdviceAliases): string[] { return advice.orderedSourceIds.flatMap((alias) => { const source = aliases.aliasToSource.get(alias); return source ? [`${source.sourceType}:${source.sourceId}`] : []; }); }

export class DeterministicPlanningAdvisor implements PlanningAdvisor { async advise(input: PlanningAdviceInput): Promise<PlanningAdvice> { return { orderedSourceIds: input.deterministicOrdering, explanationBySourceId: {}, globalSummary: '決定論的Planning Engineの順序を維持します。', warnings: [] }; } }

export function priorityBandForSource(source: { sourceType: 'task' | 'routine'; dueAt?: string | null; constrained?: boolean }, now: Date): number { return source.sourceType === 'task' ? planningPriorityBand({ kind: 'task', dueAt: source.dueAt ?? null }, now) : planningPriorityBand({ kind: 'routine', constrained: Boolean(source.constrained) }, now); }
