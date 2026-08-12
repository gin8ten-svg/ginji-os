import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createEphemeralUser,
  createServiceRoleClient,
  deleteEphemeralUser,
  insertPlanningSessionFixture,
  insertTaskFixture,
  requireIntegrationEnv,
  signInAsEphemeralUser,
  withTwoUsers,
} from './helpers';

/**
 * FakeSupabaseモックでは検証できない、実Postgresのロック・トランザクション分離レベルでの
 * 並行実行の正しさを確認する。TASKS.mdの「非本番DBでBlock DELETE RPC対Approvalの
 * 真の並列transactionとauth.users CASCADE削除を実証する」に対応する。
 */
describe('Concurrency and CASCADE behavior (real Supabase)', () => {
  it('reserve_calendar_event_write: 同一blockへの同時予約は片方だけがRESERVEDになる', async () => {
    await withTwoUsers(async ({ service, userA, clientA }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);
      await service
        .from('planning_sessions')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', plan.sessionId);

      const args = {
        p_session_id: plan.sessionId,
        p_block_id: plan.blockId,
        p_input_hash: plan.inputHash,
        p_blocks_revision: 0,
        p_calendar_id: 'primary',
        p_google_event_id: `abcde${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      };

      const [first, second] = await Promise.all([
        clientA.rpc('reserve_calendar_event_write', args),
        clientA.rpc('reserve_calendar_event_write', args),
      ]);

      const results = [first.data, second.data].map((value) => (value as { result: string }).result);
      expect(results.sort()).toEqual(['IN_PROGRESS', 'RESERVED']);

      const { data: timeBlocks } = await service
        .from('time_blocks')
        .select('id')
        .eq('planning_block_id', plan.blockId);
      expect(timeBlocks).toHaveLength(1);
    });
  });

  it('delete_planning_block と approve_planning_session の真の並列実行は矛盾状態を生まない', async () => {
    await withTwoUsers(async ({ service, userA, clientA }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);

      const [deleteResult, approveResult] = await Promise.all([
        clientA.rpc('delete_planning_block', { p_block_id: plan.blockId }),
        clientA.rpc('approve_planning_session', {
          p_session_id: plan.sessionId,
          p_input_hash: plan.inputHash,
          p_blocks_revision: 0,
        }),
      ]);

      const { data: sessionAfter } = await service
        .from('planning_sessions')
        .select('status, blocks_revision')
        .eq('id', plan.sessionId)
        .single();
      const { data: blockAfter } = await service
        .from('planning_blocks')
        .select('id')
        .eq('id', plan.blockId);

      if (approveResult.data === 'APPROVED') {
        // 承認が先にblocks_revision=0で成立した場合、削除側は古いrevisionを前提にしていたため
        // blocks_revisionの不一致でNOT_DELETEDになる想定だが、削除がapprove変更前にrevisionを
        // 進めた場合はdeleteが先勝ちしていたはず。ここでは「承認成功」と「blockが消えている」が
        // 同時に成り立つ（矛盾）ことだけを禁止する。
        expect(blockAfter).toHaveLength(deleteResult.data === 'DELETED' ? 0 : 1);
      } else {
        expect(sessionAfter?.status).toBe('draft');
      }

      // 承認成功かつblock削除済み、という矛盾状態は絶対に発生しない。
      const approvedAndBlockGone = approveResult.data === 'APPROVED' && blockAfter?.length === 0;
      expect(approvedAndBlockGone).toBe(false);
    });
  });

  it('auth.usersの削除で関連する全テーブルの行がCASCADE削除される', async () => {
    const env = requireIntegrationEnv();
    const service = createServiceRoleClient(env);
    const user = await createEphemeralUser(service, 'cascade');
    let deleted = false;
    try {
      const client = await signInAsEphemeralUser(env, user);
      const taskId = await insertTaskFixture(service, user.id);
      const plan = await insertPlanningSessionFixture(service, user.id, taskId);
      await service.from('categories').insert({ user_id: user.id, name: `cascade-${randomUUID()}` });
      await client.rpc('reserve_ai_advice_request');

      await deleteEphemeralUser(service, user.id);
      deleted = true;

      const [tasks, sessions, blocks, categories, rateLimits] = await Promise.all([
        service.from('tasks').select('id').eq('id', taskId),
        service.from('planning_sessions').select('id').eq('id', plan.sessionId),
        service.from('planning_blocks').select('id').eq('id', plan.blockId),
        service.from('categories').select('id').eq('user_id', user.id),
        service.from('ai_advice_rate_limits').select('user_id').eq('user_id', user.id),
      ]);

      expect(tasks.data).toEqual([]);
      expect(sessions.data).toEqual([]);
      expect(blocks.data).toEqual([]);
      expect(categories.data).toEqual([]);
      expect(rateLimits.data).toEqual([]);
    } finally {
      if (!deleted) await deleteEphemeralUser(service, user.id);
    }
  });
});
