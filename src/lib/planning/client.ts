import type { AiAdviceUsageSummary, EstimationAccuracySummary, PlanningCalendarEventManagementPreview, PlanningCalendarEventMutationResult, PlanningCalendarEventPreview, PlanningCalendarWriteResult, PlanningDailyReview, PlanningErrorCode, PlanningExecutionPreview, PlanningExecutionResult, PlanningReview, PlanningSessionDetail, PlanningSessionSummary, PlanningSkipReason, PlanningSkipResult } from '@/types/planning-session';

export class PlanningClientError extends Error {
  constructor(readonly code: PlanningErrorCode, message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', headers: { ...init?.headers, Accept: 'application/json' } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const value = body && typeof body === 'object' ? body as { code?: PlanningErrorCode; error?: string } : {};
    throw new PlanningClientError(value.code ?? 'PERSISTENCE_FAILED', value.error ?? '計画の処理に失敗しました。', response.status);
  }
  return body as T;
}

export const createCloudPlanningSession = (idempotencyKey: string, signal?: AbortSignal) => request<PlanningSessionDetail>('/api/planning/sessions', { method: 'POST', signal, headers: { 'Idempotency-Key': idempotencyKey } });
export const regenerateCloudPlanningSession = (id: string, idempotencyKey: string, signal?: AbortSignal) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/regenerate`, { method: 'POST', signal, headers: { 'Idempotency-Key': idempotencyKey } });
export const deleteCloudPlanningBlock = (sessionId: string, blockId: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' });
export const updateCloudPlanningBlockTime = (sessionId: string, blockId: string, start: string, end: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(blockId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start, end }) });
export const updateCloudPlanningBlockTask = (sessionId: string, blockId: string, taskId: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(blockId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId }) });
export const listCloudPlanningSessions = (signal?: AbortSignal) => request<{ sessions: PlanningSessionSummary[] }>('/api/planning/sessions', { signal });
export const getCloudPlanningSession = (id: string, signal?: AbortSignal) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}`, { signal });
export const getCloudPlanningCalendarEventPreview = (id: string, signal?: AbortSignal) => request<PlanningCalendarEventPreview>(`/api/planning/sessions/${encodeURIComponent(id)}/calendar-preview`, { signal });
export const getCloudPlanningCalendarEventManagementPreview = (id: string, signal?: AbortSignal) => request<PlanningCalendarEventManagementPreview>(`/api/planning/sessions/${encodeURIComponent(id)}/write-to-calendar`, { signal });
export const writeCloudPlanningSessionToCalendar = (id: string, calendarId: string) => request<PlanningCalendarWriteResult>(`/api/planning/sessions/${encodeURIComponent(id)}/write-to-calendar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendarId }) });
export const updateCloudPlanningSessionCalendarEvents = (id: string) => request<PlanningCalendarEventMutationResult>(`/api/planning/sessions/${encodeURIComponent(id)}/write-to-calendar`, { method: 'PATCH' });
export const deleteCloudPlanningSessionCalendarEvents = (id: string) => request<PlanningCalendarEventMutationResult>(`/api/planning/sessions/${encodeURIComponent(id)}/write-to-calendar`, { method: 'DELETE' });
export const getCloudPlanningExecutionPreview = (id: string, signal?: AbortSignal) => request<PlanningExecutionPreview>(`/api/planning/sessions/${encodeURIComponent(id)}/execution`, { signal });
export const completeCloudPlanningTimeBlock = (sessionId: string, blockId: string, actualMinutes: number | null) => request<PlanningExecutionResult>(`/api/planning/sessions/${encodeURIComponent(sessionId)}/execution/${encodeURIComponent(blockId)}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actualMinutes }) });
export const skipCloudPlanningTimeBlock = (sessionId: string, blockId: string, reason: PlanningSkipReason) => request<PlanningSkipResult>(`/api/planning/sessions/${encodeURIComponent(sessionId)}/execution/${encodeURIComponent(blockId)}/skip`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
export const approveCloudPlanningSession = (id: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/approve`, { method: 'POST' });
export const rejectCloudPlanningSession = (id: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/reject`, { method: 'POST' });
export const adviseCloudPlanningSession = (id: string, signal?: AbortSignal) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/advice`, { method: 'POST', signal });
export const getCloudPlanningExecutionReview = (signal?: AbortSignal) => request<PlanningReview>('/api/planning/review', { signal });
export const getCloudPlanningDailyReview = (date: string, signal?: AbortSignal) => request<PlanningDailyReview>(`/api/planning/review/daily?date=${encodeURIComponent(date)}`, { signal });
export const getCloudPlanningEstimationAccuracy = (days = 30, signal?: AbortSignal) => request<EstimationAccuracySummary>(`/api/planning/review/estimation-accuracy?days=${encodeURIComponent(String(days))}`, { signal });
export const getCloudAiAdviceUsage = (signal?: AbortSignal) => request<AiAdviceUsageSummary>('/api/planning/ai-usage', { signal });
