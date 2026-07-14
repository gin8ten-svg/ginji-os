import type { ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';

export type PlanningSessionStatus = 'draft' | 'approved' | 'rejected' | 'superseded';
export type PlanningErrorCode = 'AUTH_REQUIRED' | 'CALENDAR_NOT_CONNECTED' | 'CALENDAR_RECONNECT_REQUIRED' | 'PLAN_NOT_FOUND' | 'PLAN_NOT_DRAFT' | 'PLAN_STALE' | 'PLAN_INVALID' | 'PERSISTENCE_FAILED';

export interface PlanningSessionDetail {
  sessionId: string; status: PlanningSessionStatus; windowStart: string; windowEnd: string;
  blocks: ProposedTimeBlock[]; unscheduledTasks: UnscheduledTask[]; unscheduledRoutines: UnscheduledRoutine[];
  warnings: string[]; inputHash: string; engineVersion: string; createdAt: string;
  approvedAt: string | null; rejectedAt: string | null;
}

export interface PlanningSessionSummary {
  sessionId: string; status: PlanningSessionStatus; windowStart: string; windowEnd: string;
  engineVersion: string; warningCodes: string[]; createdAt: string; approvedAt: string | null; blockCount: number;
}

export interface PlanningAdviceInput {
  taskIds: string[]; routineIds: string[]; currentDeterministicOrdering: string[];
  unscheduledReasons: Array<{ sourceId: string; reason: string }>;
  aggregate: { busyMinutes: number; freeMinutes: number; blockCount: number };
}
export interface PlanningAdvice { orderedSourceIds: string[]; explanationBySourceId: Record<string, string>; globalSummary: string; warnings: string[] }
export interface PlanningAdvisor { advise(input: PlanningAdviceInput): Promise<PlanningAdvice> }
