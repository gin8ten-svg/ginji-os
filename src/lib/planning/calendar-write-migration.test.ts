import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260803000100_google_calendar_write.sql', 'utf8');
const eventIdValidationFix = readFileSync('supabase/migrations/20260803000200_fix_google_event_id_validation.sql', 'utf8');
const eventManagement = readFileSync('supabase/migrations/20260803000300_google_calendar_event_management.sql', 'utf8');
const execution = readFileSync('supabase/migrations/20260804000100_complete_planning_time_blocks.sql', 'utf8');
const route = readFileSync('src/app/api/planning/sessions/[id]/write-to-calendar/route.ts', 'utf8');
const server = readFileSync('src/lib/planning/server.ts', 'utf8');

describe('Google Calendar write migration', () => {
  it('block単位状態・決定論的event ID・対象Calendarを一意に保持', () => {
    expect(migration).toContain('create table public.time_blocks');
    for (const column of ['planning_block_id', 'google_calendar_id', 'google_event_id', 'calendar_write_status', 'calendar_write_attempt_token', 'calendar_write_lease_until', 'calendar_write_attempt_count', 'calendar_write_error_code', 'written_at']) expect(migration).toContain(column);
    expect(migration).toContain('unique (planning_block_id)'); expect(migration).toContain('unique (user_id, google_calendar_id, google_event_id)');
  });
  it('event IDはPostgreSQLの正規表現反復上限に触れず文字種と長さを検証', () => {
    expect(eventIdValidationFix).toContain('drop constraint if exists time_blocks_google_event_id_check');
    expect(eventIdValidationFix).toContain('length(google_event_id) between 5 and 1024');
    expect(eventIdValidationFix).toContain("google_event_id ~ '^[0-9a-v]+$'");
    expect(eventIdValidationFix).toContain('length(p_google_event_id) not between 5 and 1024');
    expect(eventIdValidationFix).toContain("p_google_event_id !~ '^[0-9a-v]+$'");
    expect(eventIdValidationFix).not.toContain('{5,1024}');
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

describe('Google Calendar event management migration', () => {
  it('event lifecycleと更新・削除のlease状態をblock単位で保持', () => {
    for (const column of ['calendar_event_state', 'calendar_mutation_status', 'calendar_mutation_attempt_token', 'calendar_mutation_lease_until', 'calendar_mutation_attempt_count', 'calendar_mutation_error_code', 'calendar_updated_at', 'calendar_deleted_at']) expect(eventManagement).toContain(column);
    expect(eventManagement).toContain("calendar_event_state in ('pending','active','deleted')");
    expect(eventManagement).toContain("calendar_mutation_status in ('idle','updating','deleting','update_failed','delete_failed')");
  });
  it('mutation予約はauth.uidだけを使いSession・block・time_blockをlockして再確認', () => {
    const signature = eventManagement.slice(eventManagement.indexOf('create function public.reserve_calendar_event_mutation('), eventManagement.indexOf('returns jsonb', eventManagement.indexOf('create function public.reserve_calendar_event_mutation(')));
    expect(signature).not.toMatch(/user_id/i); expect(eventManagement).toContain('current_user_id uuid := (select auth.uid())');
    expect(eventManagement).toMatch(/from public\.planning_sessions[\s\S]*for update;/);
    expect(eventManagement).toMatch(/from public\.time_blocks[\s\S]*for update;/);
    expect(eventManagement).toContain("p_operation = 'update' and session_record.status <> 'approved'");
    expect(eventManagement).toContain("p_operation = 'delete' and session_record.status not in ('approved','superseded')");
  });
  it('更新・削除結果とauditを同じtransactionで確定しRPCだけを公開', () => {
    expect(eventManagement).toContain('calendar_event_update_succeeded'); expect(eventManagement).toContain('calendar_event_update_failed');
    expect(eventManagement).toContain('calendar_event_delete_succeeded'); expect(eventManagement).toContain('calendar_event_delete_failed');
    expect(eventManagement).toContain('insert into public.audit_logs'); expect(eventManagement).not.toMatch(/commit|rollback/i);
    expect(eventManagement).toContain('revoke all on function public.reserve_calendar_event_mutation(uuid, uuid, text, bigint, text) from public, anon, authenticated');
    expect(eventManagement).toContain('grant execute on function public.complete_calendar_event_mutation(uuid, uuid, boolean, text, jsonb) to authenticated');
  });
  it('削除済みeventをcreate APIが暗黙に再作成しない', () => {
    expect(eventManagement).toContain("write_record.calendar_event_state = 'deleted'"); expect(eventManagement).toContain("'result', 'EVENT_DELETED'");
  });
});

describe('planning time block completion migration', () => {
  it('auth.uid由来の所有権とSession・time block・task lockを同一transactionで確認', () => {
    const signature = execution.slice(execution.indexOf('create function public.complete_planning_time_block('), execution.indexOf('returns jsonb'));
    expect(signature).not.toMatch(/user_id/i);
    expect(execution).toContain('current_user_id uuid := (select auth.uid())');
    expect(execution).toMatch(/from public\.planning_sessions[\s\S]*for update;/);
    expect(execution).toMatch(/from public\.time_blocks[\s\S]*for update;/);
    expect(execution).toMatch(/from public\.tasks[\s\S]*for update;/);
  });
  it('完了済み再送でtask残り時間を二重減算せず、未記録の実績だけ追記可能', () => {
    const completedBranch = execution.slice(execution.indexOf("if execution_record.status = 'completed'"), execution.indexOf("if execution_record.status not in"));
    expect(completedBranch).toContain("'ACTUAL_RECORDED'");
    expect(completedBranch).toContain("'ALREADY_COMPLETED'");
    expect(completedBranch).not.toContain('update public.tasks');
    expect(execution).toContain('remaining_minutes = next_remaining');
  });
  it('table直接UPDATEを開放せず専用RPCだけをauthenticatedへ公開', () => {
    expect(execution).toContain('revoke all on function public.complete_planning_time_block(uuid, uuid, integer) from public, anon, authenticated');
    expect(execution).toContain('grant execute on function public.complete_planning_time_block(uuid, uuid, integer) to authenticated');
  });
  it('完了・実績記録をaudit_logsへ記録し、actionのCHECK制約へ追加する', () => {
    expect(execution).toContain("audit_logs_action_check check (action in");
    expect(execution).toContain("'time_block_completed'");
    const completedBranch = execution.slice(execution.indexOf("if execution_record.status = 'completed'"), execution.indexOf("if execution_record.status not in"));
    expect(completedBranch).toContain('insert into public.audit_logs');
    const finalBranch = execution.slice(execution.indexOf("if execution_record.status not in"));
    expect(finalBranch).toContain('insert into public.audit_logs');
    expect((execution.match(/insert into public\.audit_logs/g) ?? []).length).toBe(2);
  });
  it('完了・実績記録はcalendar書き込み状態や紐づくGoogle Event IDを一切変更しない', () => {
    const updateStatements = [...execution.matchAll(/update public\.time_blocks\s+set([\s\S]*?)where/g)].map((match) => match[1]);
    expect(updateStatements.length).toBeGreaterThan(0);
    const calendarColumns = ['calendar_write_status', 'calendar_write_attempt_token', 'calendar_write_lease_until', 'calendar_write_attempt_count', 'calendar_write_error_code', 'written_at', 'google_calendar_id', 'google_event_id', 'calendar_event_state', 'calendar_mutation_status', 'calendar_mutation_attempt_token', 'calendar_mutation_lease_until', 'calendar_mutation_attempt_count', 'calendar_mutation_error_code', 'calendar_updated_at', 'calendar_deleted_at'];
    for (const statement of updateStatements) {
      for (const column of calendarColumns) expect(statement).not.toContain(column);
    }
    expect(execution).not.toMatch(/update public\.time_blocks[\s\S]*?set[\s\S]*?calendar_write_status\s*=/);
  });
});
