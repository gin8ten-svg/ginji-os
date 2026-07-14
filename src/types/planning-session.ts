import type { ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';

export type PlanningSessionStatus = 'draft' | 'approved' | 'rejected' | 'superseded';
export type PlanningErrorCode = 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'CALENDAR_NOT_CONNECTED' | 'CALENDAR_RECONNECT_REQUIRED' | 'PLAN_NOT_FOUND' | 'PLAN_NOT_DRAFT' | 'PLAN_STALE' | 'PLAN_INVALID' | 'PERSISTENCE_FAILED' | 'AI_NOT_CONFIGURED' | 'AI_RATE_LIMITED' | 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR' | 'AI_INVALID_RESPONSE' | 'AI_INPUT_TOO_LARGE';

export interface PlanningAdviceView {
  advisorVersion: string; model: string; globalSummary: string; warnings: string[];
  orderedSources: Array<{ alias: string; sourceType: 'task' | 'routine'; sourceId: string; explanation: string; changed: boolean }>;
}

export interface PlanningSessionDetail {
  sessionId: string; status: PlanningSessionStatus; windowStart: string; windowEnd: string;
  blocks: ProposedTimeBlock[]; unscheduledTasks: UnscheduledTask[]; unscheduledRoutines: UnscheduledRoutine[];
  warnings: string[]; inputHash: string; engineVersion: string; createdAt: string;
  approvedAt: string | null; rejectedAt: string | null;
  advice: PlanningAdviceView | null;
}

export interface PlanningSessionSummary {
  sessionId: string; status: PlanningSessionStatus; windowStart: string; windowEnd: string;
  engineVersion: string; warningCodes: string[]; createdAt: string; approvedAt: string | null; blockCount: number;
}

export interface PlanningAdviceCandidate {
  alias: string; sourceType: 'task' | 'routine'; priority: number; deterministicRank: number;
  overdue?: boolean; dueInMinutes?: number | null; remainingMinutes?: number; estimatedMinutes?: number;
  splittable?: boolean; minimumBlockMinutes?: number; durationMinutes?: number; constrainedTimeWindow?: boolean;
  availableStartMinutes?: number | null; availableEndMinutes?: number | null; targetDayCount?: number;
  unscheduledReasonCode: string | null;
}
export interface PlanningAdviceInput {
  candidates: PlanningAdviceCandidate[]; deterministicOrdering: string[];
  aggregate: { planningDays: number; busyMinutesByDay: number[]; freeMinutesByDay: number[]; maximumContinuousFreeMinutes: number; scheduledCount: number; unscheduledCount: number };
}
export interface PlanningAdvice { orderedSourceIds: string[]; explanationBySourceId: Record<string, string>; globalSummary: string; warnings: string[] }
export interface PlanningAdvisor { advise(input: PlanningAdviceInput): Promise<PlanningAdvice> }
