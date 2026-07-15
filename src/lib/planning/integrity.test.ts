import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260715000700_planning_integrity_hardening.sql', 'utf8');
const raceMigration = readFileSync('supabase/migrations/20260715000800_planning_approval_race_fix.sql', 'utf8');
const deleteMigration = readFileSync('supabase/migrations/20260715000900_planning_block_delete_rpc.sql', 'utf8');
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
});

type FakeStatus = 'draft' | 'approved';

class FakePlanningStore {
  status: FakeStatus = 'draft';
  revision = 0;
  readonly block = { id: 'block-a', userId: 'user-a', sessionId: 'session-a' };
  blockExists = true;

  deleteBlock(blockId: string, userId: string, failDelete = false): 'DELETED' | 'NOT_DELETED' {
    if (!this.blockExists || blockId !== this.block.id || userId !== this.block.userId) return 'NOT_DELETED';
    if (this.status !== 'draft') return 'NOT_DELETED';
    const before = { revision: this.revision, blockExists: this.blockExists };
    this.revision += 1;
    try {
      if (failDelete) throw new Error('injected delete failure');
      this.blockExists = false;
      return 'DELETED';
    } catch (error) {
      this.revision = before.revision;
      this.blockExists = before.blockExists;
      throw error;
    }
  }

  approve(expectedRevision: number): 'APPROVED' | 'BLOCKS_CHANGED' {
    if (this.revision !== expectedRevision) return 'BLOCKS_CHANGED';
    this.status = 'approved';
    return 'APPROVED';
  }
}

describe('planning block transactional delete migration', () => {
  it('RLS副作用関数とDELETE policyを撤去し直接DELETE権限をrevoke', () => {
    expect(deleteMigration).toContain('drop policy if exists planning_blocks_delete_own_draft');
    expect(deleteMigration).toContain('drop function public.reserve_planning_block_delete(uuid, uuid)');
    expect(deleteMigration).toContain('revoke delete on table public.planning_blocks from authenticated');
    expect(deleteMigration).not.toMatch(/create policy[\s\S]*reserve_planning_block_delete/i);
  });
  it('user_id引数なしのSECURITY DEFINER RPCだけをauthenticatedへ公開', () => {
    const signature = deleteMigration.slice(deleteMigration.indexOf('create function public.delete_planning_block('), deleteMigration.indexOf('returns text'));
    expect(signature).toContain('p_block_id uuid'); expect(signature).not.toContain('user_id');
    expect(deleteMigration).toContain('security definer'); expect(deleteMigration).toContain("set search_path = ''");
    expect(deleteMigration).toContain('revoke all on function public.delete_planning_block(uuid) from public, anon, authenticated');
    expect(deleteMigration).toContain('grant execute on function public.delete_planning_block(uuid) to authenticated');
  });
  it('Block→Session→DELETEのロック順と1件保証を明示', () => {
    const blockLock = deleteMigration.indexOf('for update;');
    const sessionLock = deleteMigration.indexOf('update public.planning_sessions');
    const blockDelete = deleteMigration.indexOf('delete from public.planning_blocks');
    expect(blockLock).toBeGreaterThan(0); expect(blockLock).toBeLessThan(sessionLock); expect(sessionLock).toBeLessThan(blockDelete);
    expect(deleteMigration).toContain('get diagnostics deleted_count = row_count'); expect(deleteMigration).toContain('if deleted_count <> 1 then');
  });
  it('DELETE triggerを追加せずCASCADE経路をRPCから分離', () => {
    expect(deleteMigration).not.toMatch(/create trigger/i); expect(deleteMigration).not.toMatch(/on delete cascade/i);
    expect(deleteMigration).not.toMatch(/delete_planning_block[\s\S]*trigger/i);
  });
  it('自分のdraft Blockだけを削除しrevisionを正確に1増加', () => {
    const store = new FakePlanningStore(); expect(store.deleteBlock('block-a', 'user-a')).toBe('DELETED');
    expect(store.revision).toBe(1); expect(store.blockExists).toBe(false);
  });
  it.each([
    ['他ユーザー', 'block-a', 'user-b'],
    ['存在しないBlock', 'missing', 'user-a'],
  ])('%sはNOT_DELETEDで状態を変えない', (_label, blockId, userId) => {
    const store = new FakePlanningStore(); expect(store.deleteBlock(blockId, userId)).toBe('NOT_DELETED');
    expect(store.revision).toBe(0); expect(store.blockExists).toBe(true);
  });
  it('terminal親ではNOT_DELETEDでrevisionもBlockも不変', () => {
    const store = new FakePlanningStore(); store.status = 'approved';
    expect(store.deleteBlock('block-a', 'user-a')).toBe('NOT_DELETED'); expect(store.revision).toBe(0); expect(store.blockExists).toBe(true);
  });
  it('DELETE失敗時はrevision増加もrollback', () => {
    const store = new FakePlanningStore(); expect(() => store.deleteBlock('block-a', 'user-a', true)).toThrow('injected delete failure');
    expect(store.revision).toBe(0); expect(store.blockExists).toBe(true);
  });
  it('Delete先行なら古いrevisionのApprovalを拒否', () => {
    const store = new FakePlanningStore(); expect(store.deleteBlock('block-a', 'user-a')).toBe('DELETED');
    expect(store.approve(0)).toBe('BLOCKS_CHANGED'); expect(store.status).toBe('draft');
  });
  it('Approval先行ならDeleteを拒否してapproved Blockを保持', () => {
    const store = new FakePlanningStore(); expect(store.approve(0)).toBe('APPROVED');
    expect(store.deleteBlock('block-a', 'user-a')).toBe('NOT_DELETED'); expect(store.blockExists).toBe(true); expect(store.revision).toBe(0);
  });
});
