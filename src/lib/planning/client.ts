import type { PlanningErrorCode, PlanningSessionDetail, PlanningSessionSummary } from '@/types/planning-session';

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

export const createCloudPlanningSession = (signal?: AbortSignal) => request<PlanningSessionDetail>('/api/planning/sessions', { method: 'POST', signal });
export const listCloudPlanningSessions = (signal?: AbortSignal) => request<{ sessions: PlanningSessionSummary[] }>('/api/planning/sessions', { signal });
export const getCloudPlanningSession = (id: string, signal?: AbortSignal) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}`, { signal });
export const approveCloudPlanningSession = (id: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/approve`, { method: 'POST' });
export const rejectCloudPlanningSession = (id: string) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/reject`, { method: 'POST' });
export const adviseCloudPlanningSession = (id: string, signal?: AbortSignal) => request<PlanningSessionDetail>(`/api/planning/sessions/${encodeURIComponent(id)}/advice`, { method: 'POST', signal });
