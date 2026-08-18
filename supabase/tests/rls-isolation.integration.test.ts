import { describe, expect, it } from 'vitest';
import {
  insertExecutableTimeBlockFixture,
  insertPlanningSessionFixture,
  insertRoutineFixture,
  insertTaskFixture,
  withTwoUsers,
} from './helpers';

/**
 * docs/DATABASE.md の「RLS policy principle」（すべてのユーザー所有テーブルで
 * auth.uid() = user_id の行だけをSELECT/INSERT/UPDATE/DELETE可能にする）を、
 * FakeSupabaseモックではなく実Postgres/Supabase Auth上で検証する。
 */
describe('RLS isolation (real Supabase, two ephemeral users)', () => {
  it('tasks: ユーザーBはユーザーAのタスクを読み書きできない', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);

      const { data: selectByB, error: selectError } = await clientB.from('tasks').select('id').eq('id', taskId);
      expect(selectError).toBeNull();
      expect(selectByB).toEqual([]);

      const { data: updateByB } = await clientB.from('tasks').update({ title: '乗っ取り' }).eq('id', taskId).select('id');
      expect(updateByB).toEqual([]);

      const { data: deleteByB } = await clientB.from('tasks').delete().eq('id', taskId).select('id');
      expect(deleteByB).toEqual([]);

      const { data: selectByA } = await clientA.from('tasks').select('id, title').eq('id', taskId);
      expect(selectByA).toHaveLength(1);
      expect(selectByA?.[0].title).not.toBe('乗っ取り');
    });
  });

  it('routines / routine_completions: ユーザーBは他人のルーティンと実行履歴を読み書きできない', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const routineId = await insertRoutineFixture(service, userA.id);
      const { data: completion, error: completionError } = await service
        .from('routine_completions')
        .insert({ user_id: userA.id, routine_id: routineId, target_date: '2026-08-08' })
        .select('id')
        .single();
      expect(completionError).toBeNull();

      const { data: routinesByB } = await clientB.from('routines').select('id').eq('id', routineId);
      expect(routinesByB).toEqual([]);

      const { data: completionsByB } = await clientB
        .from('routine_completions')
        .select('id')
        .eq('id', completion!.id);
      expect(completionsByB).toEqual([]);

      const { data: deleteByB } = await clientB.from('routines').delete().eq('id', routineId).select('id');
      expect(deleteByB).toEqual([]);

      const { data: routinesByA } = await clientA.from('routines').select('id').eq('id', routineId);
      expect(routinesByA).toHaveLength(1);
    });
  });

  it('categories: ユーザーBは他人のカテゴリーを読み書きできない', async () => {
    await withTwoUsers(async ({ service, userA, clientB }) => {
      const { data: category, error } = await service
        .from('categories')
        .insert({ user_id: userA.id, name: `RLSテストカテゴリ ${userA.id}` })
        .select('id')
        .single();
      expect(error).toBeNull();

      const { data: categoriesByB } = await clientB.from('categories').select('id').eq('id', category!.id);
      expect(categoriesByB).toEqual([]);
    });
  });

  it('calendar_connections: ユーザーBは他人のCalendar接続状態を読み書きできない', async () => {
    await withTwoUsers(async ({ service, userA, clientB }) => {
      const { error } = await service
        .from('calendar_connections')
        .insert({ user_id: userA.id, granted_scopes: ['calendar.events'] });
      expect(error).toBeNull();

      const { data: byB } = await clientB.from('calendar_connections').select('user_id').eq('user_id', userA.id);
      expect(byB).toEqual([]);

      const { data: updateByB } = await clientB
        .from('calendar_connections')
        .update({ needs_reconnect: true })
        .eq('user_id', userA.id)
        .select('user_id');
      expect(updateByB).toEqual([]);
    });
  });

  it('planning_sessions / planning_blocks: ユーザーBは他人の計画案を読み書きできない', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);

      const { data: sessionByB } = await clientB.from('planning_sessions').select('id').eq('id', plan.sessionId);
      expect(sessionByB).toEqual([]);

      const { data: blockByB } = await clientB.from('planning_blocks').select('id').eq('id', plan.blockId);
      expect(blockByB).toEqual([]);

      // planning_blocksへのDELETEはauthenticatedから完全に剥奪されている
      // （20260715000900のrevoke delete。delete_planning_block RPC経由のみ許可）。
      // 所有者かどうかに関わらずテーブルレベルの権限エラーになる。
      const { data: deleteBlockByB, error: deleteBlockByBError } = await clientB
        .from('planning_blocks')
        .delete()
        .eq('id', plan.blockId)
        .select('id');
      expect(deleteBlockByBError).not.toBeNull();
      expect(deleteBlockByB).toBeNull();

      const { data: sessionByA } = await clientA.from('planning_sessions').select('id').eq('id', plan.sessionId);
      expect(sessionByA).toHaveLength(1);
    });
  });

  it('time_blocks / audit_logs: authenticatedからの直接書き込みは全員拒否され、SELECTも自分の行だけに限定される', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const { timeBlockId } = await insertExecutableTimeBlockFixture(service, userA.id, taskId);

      const { data: timeBlocksByB } = await clientB.from('time_blocks').select('id').eq('id', timeBlockId);
      expect(timeBlocksByB).toEqual([]);

      const { data: timeBlocksByA } = await clientA.from('time_blocks').select('id').eq('id', timeBlockId);
      expect(timeBlocksByA).toHaveLength(1);

      // time_blocksへの直接insert/updateはauthenticatedへ権限が付与されていない（RPC経由のみ）。
      const { error: directInsertError } = await clientA.from('time_blocks').insert({
        user_id: userA.id,
        planning_session_id: crypto.randomUUID(),
        planning_block_id: crypto.randomUUID(),
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 60_000).toISOString(),
        google_calendar_id: 'primary',
        google_event_id: 'abcdefghij',
        calendar_write_status: 'succeeded',
      });
      expect(directInsertError).not.toBeNull();

      const { error: directUpdateError } = await clientA
        .from('time_blocks')
        .update({ status: 'completed' })
        .eq('id', timeBlockId);
      expect(directUpdateError).not.toBeNull();

      const { data: auditByB } = await clientB.from('audit_logs').select('id').eq('entity_id', timeBlockId);
      expect(auditByB).toEqual([]);
    });
  });

  it('ai_advice_rate_limits: authenticatedからの直接アクセスは拒否され、RPCは呼び出し本人の行だけを操作する', async () => {
    await withTwoUsers(async ({ service, userA, userB, clientA, clientB }) => {
      const { error: directSelectError } = await clientA.from('ai_advice_rate_limits').select('user_id');
      expect(directSelectError).not.toBeNull();

      const { data: reservedByA, error: rpcErrorA } = await clientA.rpc('reserve_ai_advice_request');
      expect(rpcErrorA).toBeNull();
      expect(reservedByA).toBe(true);

      const { data: reservedByB, error: rpcErrorB } = await clientB.rpc('reserve_ai_advice_request');
      expect(rpcErrorB).toBeNull();
      expect(reservedByB).toBe(true);

      const { data: rows } = await service
        .from('ai_advice_rate_limits')
        .select('user_id')
        .in('user_id', [userA.id, userB.id]);
      expect(rows).toHaveLength(2);
    });
  });

  it('RPCへ他ユーザーのID(session/block)を渡しても越権できない: approve/reject/complete/skip/delete', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);

      const { data: approveByB } = await clientB.rpc('approve_planning_session', {
        p_session_id: plan.sessionId,
        p_input_hash: plan.inputHash,
        p_blocks_revision: plan.blocksRevision,
      });
      expect(approveByB).toBe('NOT_UPDATED');

      const { data: rejectByB } = await clientB.rpc('reject_planning_session', { p_session_id: plan.sessionId });
      expect(rejectByB).toBe('NOT_UPDATED');

      const { data: deleteBlockByB } = await clientB.rpc('delete_planning_block', { p_block_id: plan.blockId });
      expect(deleteBlockByB).toBe('NOT_DELETED');

      // Aから見ると、Bの越権試行後もsessionはdraftのまま・blockも残っている。
      const { data: sessionAfter } = await clientA
        .from('planning_sessions')
        .select('status')
        .eq('id', plan.sessionId)
        .single();
      expect(sessionAfter?.status).toBe('draft');

      const { timeBlockId } = await insertExecutableTimeBlockFixture(service, userA.id, taskId);
      const executableSession = await service
        .from('time_blocks')
        .select('planning_session_id, planning_block_id')
        .eq('id', timeBlockId)
        .single();

      const { data: completeByB } = await clientB.rpc('complete_planning_time_block', {
        p_session_id: executableSession.data!.planning_session_id,
        p_block_id: executableSession.data!.planning_block_id,
        p_actual_minutes: 10,
      });
      expect(completeByB).toMatchObject({ result: 'NOT_FOUND' });

      const { data: skipByB } = await clientB.rpc('skip_planning_time_block', {
        p_session_id: executableSession.data!.planning_session_id,
        p_block_id: executableSession.data!.planning_block_id,
        p_reason: 'user_skipped',
      });
      expect(skipByB).toMatchObject({ result: 'NOT_FOUND' });

      const { data: timeBlockAfter } = await service.from('time_blocks').select('status,status_reason').eq('id', timeBlockId).single();
      expect(timeBlockAfter?.status).toBe('approved');
      expect(timeBlockAfter?.status_reason).toBeNull();
    });
  });

  it('skip_planning_time_block: 本人のblockはスキップでき、他人はSELECTできない', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const { timeBlockId } = await insertExecutableTimeBlockFixture(service, userA.id, taskId);
      const executableSession = await service
        .from('time_blocks')
        .select('planning_session_id, planning_block_id')
        .eq('id', timeBlockId)
        .single();

      const { data: skipResult } = await clientA.rpc('skip_planning_time_block', {
        p_session_id: executableSession.data!.planning_session_id,
        p_block_id: executableSession.data!.planning_block_id,
        p_reason: 'user_skipped',
      });
      expect(skipResult).toMatchObject({ result: 'SKIPPED', status_reason: 'user_skipped' });

      const { data: byB } = await clientB.from('time_blocks').select('id').eq('id', timeBlockId);
      expect(byB).toEqual([]);
    });
  });

  it('update_planning_block_time / update_planning_block_task / delete_planning_block: 他人のblockへは越権できない', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const otherTaskId = await insertTaskFixture(service, userA.id);
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);

      const { data: updateTimeByB } = await clientB.rpc('update_planning_block_time', {
        p_block_id: plan.blockId,
        p_start_at: plan.windowStart.toISOString(),
        p_end_at: plan.windowEnd.toISOString(),
      });
      expect(updateTimeByB).toBe('NOT_UPDATED');

      const { data: updateTaskByB } = await clientB.rpc('update_planning_block_task', {
        p_block_id: plan.blockId,
        p_task_id: otherTaskId,
      });
      expect(updateTaskByB).toBe('NOT_UPDATED');

      const { data: deleteByB } = await clientB.rpc('delete_planning_block', { p_block_id: plan.blockId });
      expect(deleteByB).toBe('NOT_DELETED');

      const { data: blockAfter } = await clientA.from('planning_blocks').select('id,title,start_at').eq('id', plan.blockId).single();
      expect(blockAfter?.title).toBe('RLSテストブロック');
      expect(new Date(blockAfter!.start_at).getTime()).toBe(plan.windowStart.getTime());

      const { data: sessionAfter } = await clientA.from('planning_sessions').select('manually_edited').eq('id', plan.sessionId).single();
      expect(sessionAfter?.manually_edited).toBe(false);
    });
  });

  it('update_planning_block_time: 本人のdraft blockは時刻を変更でき、manually_editedがtrueになる', async () => {
    await withTwoUsers(async ({ service, userA, clientA }) => {
      const taskId = await insertTaskFixture(service, userA.id, { remaining_minutes: 120 });
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);
      const newStart = new Date(plan.windowStart.getTime() + 30 * 60 * 1000);
      const newEnd = new Date(plan.windowEnd.getTime() + 30 * 60 * 1000);

      const { data: result } = await clientA.rpc('update_planning_block_time', {
        p_block_id: plan.blockId,
        p_start_at: newStart.toISOString(),
        p_end_at: newEnd.toISOString(),
      });
      expect(result).toBe('UPDATED');

      const { data: session } = await clientA.from('planning_sessions').select('manually_edited,blocks_revision').eq('id', plan.sessionId).single();
      expect(session?.manually_edited).toBe(true);
      // guard_planning_block_mutationトリガーがblock UPDATE時に+1する分のみ進む
      // （update_planning_block_time自身は二重にはインクリメントしない）。
      expect(session?.blocks_revision).toBe(plan.blocksRevision + 1);
    });
  });

  it('ai_advice_usage_events: 直接テーブル書き込みは拒否され、RPCは呼び出し本人の行だけを作成する', async () => {
    await withTwoUsers(async ({ service, userA, clientA, clientB }) => {
      const { error: directInsertError } = await clientA.from('ai_advice_usage_events').insert({
        user_id: userA.id,
        model: 'test-model',
        candidate_count: 1,
        success: true,
      });
      expect(directInsertError).not.toBeNull();

      const { data: eventId, error: rpcError } = await clientA.rpc('record_ai_advice_usage', {
        p_planning_session_id: null,
        p_model: 'test-model',
        p_candidate_count: 3,
        p_input_tokens: 100,
        p_output_tokens: 50,
        p_success: true,
        p_error_code: null,
      });
      expect(rpcError).toBeNull();
      expect(eventId).toBeTruthy();
      const id = eventId as string;

      const { data: byA } = await clientA.from('ai_advice_usage_events').select('id,model').eq('id', id);
      expect(byA).toHaveLength(1);

      const { data: byB } = await clientB.from('ai_advice_usage_events').select('id').eq('id', id);
      expect(byB).toEqual([]);

      const { data: rows } = await service.from('ai_advice_usage_events').select('user_id').eq('id', id);
      expect(rows?.[0]?.user_id).toBe(userA.id);
    });
  });

  it('record_ai_advice_usage: 他人のplanning_session_idを渡してもそのsessionへは紐付かない', async () => {
    await withTwoUsers(async ({ service, userA, userB, clientB }) => {
      const taskId = await insertTaskFixture(service, userA.id);
      const plan = await insertPlanningSessionFixture(service, userA.id, taskId);

      const { data: eventId, error } = await clientB.rpc('record_ai_advice_usage', {
        p_planning_session_id: plan.sessionId,
        p_model: 'test-model',
        p_candidate_count: 1,
        p_input_tokens: null,
        p_output_tokens: null,
        p_success: false,
        p_error_code: 'AI_PROVIDER_ERROR',
      });
      expect(error).toBeNull();

      const { data: row } = await service.from('ai_advice_usage_events').select('user_id,planning_session_id').eq('id', eventId as string).single();
      expect(row?.user_id).toBe(userB.id);
      expect(row?.planning_session_id).toBeNull();
    });
  });
});
