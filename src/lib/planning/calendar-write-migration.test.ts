import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260803000100_google_calendar_write.sql', 'utf8');
const route = readFileSync('src/app/api/planning/sessions/[id]/write-to-calendar/route.ts', 'utf8');
const server = readFileSync('src/lib/planning/server.ts', 'utf8');

describe('Google Calendar write migration', () => {
  it('block単位状態・決定論的event ID・対象Calendarを一意に保持', () => {
    expect(migration).toContain('create table public.time_blocks');
    for (const column of ['planning_block_id', 'google_calendar_id', 'google_event_id', 'calendar_write_status', 'calendar_write_attempt_token', 'calendar_write_lease_until', 'calendar_write_attempt_count', 'calendar_write_error_code', 'written_at']) expect(migration).toContain(column);
    expect(migration).toContain('unique (planning_block_id)'); expect(migration).toContain('unique (user_id, google_calendar_id, google_event_id)');
    expect(migration).toContain("google_event_id ~ '^[0-9a-v]{5,1024}$'");
  });
  it('Session・Block・userの複合所有関係とCASCADEをDBで固定', () => {
    expect(migration).toContain('unique (id, planning_session_id, user_id)');
    expect(migration).toContain('foreign key (planning_block_id, planning_session_id, user_id)');
    expect(migration).toContain('references public.planning_blocks(id, planning_session_id, user_id) on delete cascade');
    expect(migration).toContain('foreign key (task_id, user_id) references public.tasks(id, user_id) on delete set null (task_id)');
    expect(migration).toContain('foreign key (routine_id, user_id) references public.routines(id, user_id) on delete set null (routine_id)');
    expect(migration).toContain('user_id uuid not null references auth.users(id) on delete cascade');
  });
  it('time_blocks・audit_logsはRLS下でown SELECTだけを許可し直接mutationを拒否', () => {
    expect(migration).toContain('alter table public.time_blocks enable row level security'); expect(migration).toContain('alter table public.audit_logs enable row level security');
    expect(migration).toContain('time_blocks_select_own'); expect(migration).toContain('audit_logs_select_own');
    expect(migration).toContain('using ((select auth.uid()) = user_id)');
    expect(migration).toContain('revoke all on public.time_blocks, public.audit_logs from public, anon, authenticated');
    expect(migration).not.toMatch(/create policy (time_blocks|audit_logs)_(insert|update|delete)/);
  });
  it('予約RPCはuser引数を持たずSession lock下でstatus・hash・revision・block・Calendarを再確認', () => {
    const signature = migration.slice(migration.indexOf('create function public.reserve_calendar_event_write('), migration.indexOf('returns jsonb'));
    expect(signature).not.toMatch(/user_id/i); expect(migration).toContain('current_user_id uuid := (select auth.uid())');
    expect(migration).toMatch(/from public\.planning_sessions[\s\S]*for update;/); expect(migration).toContain("session_status <> 'approved'"); expect(migration).toContain('session_hash is distinct from p_input_hash'); expect(migration).toContain('session_revision is distinct from p_blocks_revision');
    expect(migration).toContain('planning_session_id = p_session_id'); expect(migration).toContain("return pg_catalog.jsonb_build_object('result', 'CALENDAR_MISMATCH')");
  });
  it('成功済みskip・writing lease・失敗再予約で並列retryを重複送信させない', () => {
    expect(migration).toContain("calendar_write_status = 'succeeded'"); expect(migration).toContain("'result', 'ALREADY_SUCCEEDED'");
    expect(migration).toContain("calendar_write_status = 'writing'"); expect(migration).toContain("'result', 'IN_PROGRESS'");
    expect(migration).toContain("calendar_write_lease_until = pg_catalog.clock_timestamp() + interval '2 minutes'");
    expect(migration).toContain('calendar_write_attempt_count = calendar_write_attempt_count + 1');
  });
  it('結果確定と成功・失敗auditを同じDB transaction内で実行', () => {
    const complete = migration.slice(migration.indexOf('create function public.complete_calendar_event_write('));
    expect(complete).toContain('update public.time_blocks'); expect(complete).toContain('insert into public.audit_logs');
    expect(complete).toContain('calendar_event_write_succeeded'); expect(complete).toContain('calendar_event_write_failed');
    expect(complete).toContain("'time_block'"); expect(complete).not.toMatch(/commit|rollback/i);
  });
  it('RPCだけをauthenticatedへ公開しpublic・anonを拒否', () => {
    expect(migration).toContain('revoke all on function public.reserve_calendar_event_write(uuid, uuid, text, bigint, text, text) from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.reserve_calendar_event_write(uuid, uuid, text, bigint, text, text) to authenticated');
    expect(migration).toContain('revoke all on function public.complete_calendar_event_write(uuid, uuid, boolean, text, jsonb) from public, anon, authenticated');
  });
});

describe('Google Calendar write static boundary', () => {
  it('POST bodyからCalendar IDだけを受け、title・blocksをserver生成する', () => { expect(route).toContain('planningCalendarWriteTarget(body)'); expect(route).not.toMatch(/body\.(title|blocks|events)/); expect(server).toContain('title: event.title'); });
  it('Preview関数の結果を受け取らずwrite内で完全再検証する', () => { expect(server).toMatch(/writePlanningSessionToCalendar[\s\S]*validatePlanningCalendarCandidate/); expect(server).not.toMatch(/writePlanningSessionToCalendar\([^)]*preview/i); });
});
