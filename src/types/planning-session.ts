import type { ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';

export type PlanningSessionStatus = 'draft' | 'approved' | 'rejected' | 'superseded';
export type PlanningErrorCode = 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'CALENDAR_NOT_CONNECTED' | 'CALENDAR_RECONNECT_REQUIRED' | 'CALENDAR_NOT_WRITABLE' | 'CALENDAR_TARGET_MISMATCH' | 'CALENDAR_WRITE_FAILED' | 'CALENDAR_EVENT_NOT_FOUND' | 'CALENDAR_EVENT_MISMATCH' | 'CALENDAR_EVENT_CONFLICT' | 'PLAN_NOT_FOUND' | 'PLAN_NOT_DRAFT' | 'PLAN_NOT_APPROVED' | 'PLAN_STALE' | 'PLAN_INVALID' | 'TIME_BLOCK_NOT_FOUND' | 'TIME_BLOCK_NOT_COMPLETABLE' | 'PERSISTENCE_FAILED' | 'AI_NOT_CONFIGURED' | 'AI_RATE_LIMITED' | 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR' | 'AI_INVALID_RESPONSE' | 'AI_INPUT_TOO_LARGE' | 'AI_REQUEST_CANCELLED';

export interface PlanningAdviceView {
  advisorVersion: string; model: string; globalSummary: string; warnings: string[];
  orderedSources: Array<{ alias: string; sourceType: 'task' | 'routine'; sourceId: string; explanation: string; changed: boolean }>;
}

export interface PlanningSessionDetail {
  sessionId: string; status: PlanningSessionStatus; windowStart: string; windowEnd: string;
  blocks: ProposedTimeBlock[]; unscheduledTasks: UnscheduledTask[]; unscheduledRoutines: UnscheduledRoutine[];
  warnings: string[]; engineVersion: string; createdAt: string;
  approvedAt: string | null; rejectedAt: string | null;
  advice: PlanningAdviceView | null;
}

export interface PlanningSessionSummary {
  sessionId: string; status: PlanningSessionStatus; windowStart: string; windowEnd: string;
  engineVersion: string; warningCodes: string[]; createdAt: string; approvedAt: string | null; blockCount: number;
}

export interface CalendarEventPreviewItem {
  sourceType: 'task' | 'routine'; sourceId: string; title: string;
  start: string; end: string; blockIndex: number; durationMinutes: number;
  calendarState?: 'not_created' | 'writing' | 'write_failed' | 'active' | 'deleted';
}

export interface PlanningCalendarEventPreview {
  sessionId: string; status: 'approved'; windowStart: string; windowEnd: string;
  timeZone: 'Asia/Tokyo'; calendarId: string | null; events: CalendarEventPreviewItem[];
}

export interface PlanningCalendarEventManagementPreview {
  sessionId: string; status: 'approved' | 'superseded'; timeZone: 'Asia/Tokyo'; calendarId: string;
  events: CalendarEventPreviewItem[];
}

export type CalendarEventWriteStatus = 'created' | 'already_created' | 'failed' | 'in_progress' | 'not_attempted';

export interface PlanningCalendarEventWriteItem {
  sourceType: 'task' | 'routine'; sourceId: string; title: string;
  start: string; end: string; blockIndex: number; durationMinutes: number;
  writeStatus: CalendarEventWriteStatus; errorCode: 'CALENDAR_WRITE_FAILED' | null;
}

export interface PlanningCalendarWriteResult {
  sessionId: string; calendarId: string; status: 'completed' | 'partial' | 'failed';
  createdCount: number; alreadyCreatedCount: number; failedCount: number; inProgressCount: number; notAttemptedCount: number;
  needsReconnect: boolean; events: PlanningCalendarEventWriteItem[];
}

export type CalendarEventMutationOperation = 'update' | 'delete';
export type CalendarEventMutationStatus = 'updated' | 'already_current' | 'deleted' | 'already_deleted' | 'failed' | 'in_progress' | 'not_attempted';

export interface PlanningCalendarEventMutationItem extends CalendarEventPreviewItem {
  mutationStatus: CalendarEventMutationStatus;
  errorCode: 'CALENDAR_EVENT_NOT_FOUND' | 'CALENDAR_EVENT_MISMATCH' | 'CALENDAR_EVENT_CONFLICT' | 'CALENDAR_RECONNECT_REQUIRED' | 'CALENDAR_WRITE_FAILED' | null;
}

export interface PlanningCalendarEventMutationResult {
  sessionId: string; calendarId: string; operation: CalendarEventMutationOperation; status: 'completed' | 'partial' | 'failed';
  changedCount: number; unchangedCount: number; failedCount: number; inProgressCount: number; notAttemptedCount: number;
  needsReconnect: boolean; events: PlanningCalendarEventMutationItem[];
}

export interface PlanningExecutionBlock {
  planningBlockId: string; taskId: string; title: string; start: string; end: string;
  plannedMinutes: number; status: 'approved' | 'in_progress' | 'completed'; actualMinutes: number | null;
}

export interface PlanningExecutionPreview {
  sessionId: string; status: 'approved' | 'superseded'; timeZone: 'Asia/Tokyo'; blocks: PlanningExecutionBlock[];
}

export interface PlanningExecutionResult {
  planningBlockId: string; status: 'completed'; actualMinutes: number | null;
  outcome: 'completed' | 'already_completed' | 'actual_recorded'; taskCompleted: boolean;
}

export interface PlanningReviewDay {
  date: string; plannedMinutes: number; actualMinutes: number;
  totalBlocks: number; completedBlocks: number; recordedActualBlocks: number;
}

export interface PlanningReview {
  timeZone: 'Asia/Tokyo'; days: PlanningReviewDay[];
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
export interface PlanningAdvisor { advise(input: PlanningAdviceInput, signal?: AbortSignal): Promise<PlanningAdvice> }
