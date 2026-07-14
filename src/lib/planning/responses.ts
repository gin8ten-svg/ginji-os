import 'server-only';
import { NextResponse } from 'next/server';
import type { PlanningErrorCode } from '@/types/planning-session';

export class PlanningApiError extends Error { constructor(readonly code: PlanningErrorCode, message: string, readonly status: number) { super(message); } }
export function planningJson(body: unknown, status = 200): NextResponse { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
export function planningError(error: unknown): NextResponse {
  if (error instanceof PlanningApiError) return planningJson({ error: error.message, code: error.code }, error.status);
  return planningJson({ error: '計画の処理に失敗しました。', code: 'PERSISTENCE_FAILED' }, 500);
}
