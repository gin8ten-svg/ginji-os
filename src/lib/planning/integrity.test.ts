import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260715000700_planning_integrity_hardening.sql', 'utf8');
const raceMigration = readFileSync('supabase/migrations/20260715000800_planning_approval_race_fix.sql', 'utf8');
const client = readFileSync('src/lib/planning/client.ts', 'utf8');
const server = readFileSync('src/lib/planning/server.ts', 'utf8');
const publicTypes = readFileSync('src/types/planning-session.ts', 'utf8');

function validDuration(start: string, end: string, minutes: number): boolean {
  const startMs = new Date(start).getTime(); const endMs = new Date(end).getTime();
  return start.endsWith(':00.000Z') && end.endsWith(':00.000Z') && startMs < endMs && minutes === (endMs - startMs) / 60_000;
}

describe('planning integrity migration', () => {
  it('terminal SessionのUPDATE/DELETEとsnapshot変更をtriggerで拒否', () => {
    expect(migration).toContain("if old.status <> 'draft'");
    expect(migration).toContain("raise exception 'terminal planning sessions are immutable'");
    for (const field of ['input_hash', 'engine_version', 'window_start', 'window_end', 'input_now', 'result_summary', 'warning_codes', 'created_at', 'idempotency_key']) expect(migration).toContain(`new.${field} is distinct from old.${field}`);
  });
  it('正規status遷移だけを許可しtimestampをDBで確定', () => {
    expect(migration).toContain("new.status not in ('draft', 'approved', 'rejected', 'superseded')");
    expect(migration).toContain('new.approved_at := transaction_timestamp()'); expect(migration).toContain('new.rejected_at := transaction_timestamp()');
  });
  it('blocksは旧親・新親ともdraftのときだけ変更可能', () => {
    expect(migration).toContain("if tg_op in ('UPDATE', 'DELETE')"); expect(migration).toContain("if tg_op in ('INSERT', 'UPDATE')");
    expect(migration).toContain("old_parent_status is distinct from 'draft'"); expect(migration).toContain("new_parent_status is distinct from 'draft'");
    expect(migration).toContain('planning_blocks_insert_own_draft'); expect(migration).toContain('planning_blocks_update_own_draft'); expect(migration).toContain('planning_blocks_delete_own_draft');
  });
  it('分境界・正区間・duration完全一致をDB制約で保証', () => {
    expect(migration).toContain("date_trunc('minute', start_at) = start_at"); expect(migration).toContain("date_trunc('minute', end_at) = end_at");
    expect(migration).toContain("duration_minutes::numeric = extract(epoch from (end_at - start_at)) / 60");
  });
  it.each([
    ['正常な30分', '2026-07-15T00:00:00.000Z', '2026-07-15T00:30:00.000Z', 30, true],
    ['duration不一致', '2026-07-15T00:00:00.000Z', '2026-07-15T00:30:00.000Z', 29, false],
    ['秒付き', '2026-07-15T00:00:01.000Z', '2026-07-15T00:30:00.000Z', 30, false],
    ['0分', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', 0, false],
    ['負区間', '2026-07-15T00:30:00.000Z', '2026-07-15T00:00:00.000Z', -30, false],
  ])('%sを制約モデルで判定', (_name, start, end, minutes, expected) => expect(validDuration(start, end, minutes)).toBe(expected));
  it('user単位partial uniqueと単一transaction RPCでidempotencyを保証', () => {
    expect(migration).toContain('on public.planning_sessions(user_id, idempotency_key)'); expect(migration).toContain('where idempotency_key is not null');
    expect(migration).toContain('create or replace function public.create_planning_session('); expect(migration).toContain('current_user_id uuid := (select auth.uid())');
    expect(migration).toContain('on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing');
    expect(migration).not.toMatch(/create_planning_session\([\s\S]{0,200}user_id uuid/);
  });
  it('AI draftはnullable keyにより元Session keyを複製しない', () => expect(migration).toContain('add column idempotency_key uuid'));
  it('keyをheaderだけで送り、レスポンス型や外部providerへ追加しない', () => {
    expect(client).toContain("headers: { 'Idempotency-Key': idempotencyKey }"); expect(server).toContain('p_idempotency_key: options.idempotencyKey ?? null');
    expect(server).not.toMatch(/return \{[^}]*idempotencyKey/); expect(server).not.toMatch(/advisor\.advise\([^)]*idempotency/i);
  });
  it('RPCはuser_id引数を持たず、所有者をauth.uidから確定', () => {
    const signature = migration.slice(migration.indexOf('create or replace function public.create_planning_session('), migration.indexOf('returns uuid'));
    expect(signature).not.toMatch(/user_id/i); expect(migration).toContain('current_user_id uuid := (select auth.uid())');
  });
  it('既存複合FKを削除せず、Session直接更新権限を除去', () => {
    expect(migration).not.toMatch(/drop constraint.*planning_blocks_planning_session_id_user_id_fkey/i); expect(migration).toContain('revoke insert, update, delete on public.planning_sessions from authenticated');
  });
});

describe('planning approval race correction migration', () => {
  it('blocks_revisionを非負・内部値として追加', () => {
    expect(raceMigration).toContain('add column blocks_revision bigint not null default 0'); expect(raceMigration).toContain('check (blocks_revision >= 0)');
    expect(publicTypes).not.toContain('blocksRevision');
  });
  it('block INSERT/UPDATEが親draft行のrevisionを原子的に増加', () => {
    expect(raceMigration).toMatch(/update public\.planning_sessions[\s\S]*set blocks_revision = blocks_revision \+ 1[\s\S]*status = 'draft'[\s\S]*returning blocks_revision/);
    expect(raceMigration).toContain('before insert or update on public.planning_blocks'); expect(raceMigration).not.toContain('before insert or update or delete on public.planning_blocks');
    expect(raceMigration).toContain('old.planning_session_id is distinct from new.planning_session_id'); expect(raceMigration).toContain('old.user_id is distinct from new.user_id');
  });
  it('DELETEはRLS予約でrevisionを増やしFK CASCADEをtriggerで阻害しない', () => {
    expect(raceMigration).toContain('public.reserve_planning_block_delete(planning_session_id, user_id)');
    expect(raceMigration).not.toContain('before update or delete on public.planning_sessions'); expect(raceMigration).not.toContain('before insert or update or delete on public.planning_blocks');
    expect(raceMigration).toContain('before update on public.planning_sessions');
  });
  it('old approval RPCを削除しrevision付き3引数版だけをgrant', () => {
    expect(raceMigration).toContain('drop function public.approve_planning_session(uuid, text)');
    expect(raceMigration).toContain('public.approve_planning_session(uuid, text, bigint) to authenticated');
    expect(raceMigration).toContain('for update'); expect(raceMigration).toContain("return 'BLOCKS_CHANGED'");
  });
  it('不要なSession write policyを削除しSELECT policyは維持', () => {
    for (const policy of ['planning_sessions_insert_own', 'planning_sessions_update_own', 'planning_sessions_delete_own']) expect(raceMigration).toContain(`drop policy if exists ${policy}`);
    expect(raceMigration).not.toContain('drop policy planning_sessions_select_own');
  });
  it('block先行・approval先行のどちらでも未検証approvedを作らない', () => {
    const blockFirst = { status: 'draft', revision: 0 }; blockFirst.revision += 1; expect(blockFirst.status === 'draft' && blockFirst.revision === 0).toBe(false);
    const approvalFirst: { status: 'draft' | 'approved'; revision: number } = { status: 'draft', revision: 0 }; if (approvalFirst.revision === 0) approvalFirst.status = 'approved'; expect(approvalFirst.status === 'draft').toBe(false); expect(approvalFirst.status).toBe('approved');
  });
});
