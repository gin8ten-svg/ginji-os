import { createHash, randomUUID } from 'node:crypto';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export interface IntegrationEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * ローカルSupabase (`supabase start`) だけを許可する。SUPABASE_URLが127.0.0.1/localhost以外を
 * 指す場合は例外を投げ、共有・本番プロジェクトへ誤って書き込むことを防ぐ。
 */
export function requireIntegrationEnv(): IntegrationEnv {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY が未設定です。' +
        'docs/TESTING.md の手順に従い、`supabase start` のローカル値を .env.test.local に設定してください。',
    );
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
    throw new Error(
      `SUPABASE_URL がローカル以外を指しています (${url})。本番/共有Supabaseへ誤って書き込まないよう、127.0.0.1のローカルインスタンスのみ許可しています。`,
    );
  }
  return { url, anonKey, serviceRoleKey };
}

export function createServiceRoleClient(env: IntegrationEnv = requireIntegrationEnv()): SupabaseClient<Database> {
  return createSupabaseClient<Database>(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface EphemeralUser {
  id: string;
  email: string;
  password: string;
}

/** テスト専用の使い捨てユーザーを作成する。メールは実サービスに存在しない .invalid ドメインを使う。 */
export async function createEphemeralUser(service: SupabaseClient<Database>, label: string): Promise<EphemeralUser> {
  const email = `rls-test-${label}-${randomUUID()}@example.invalid`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    throw new Error(`テストユーザー作成に失敗しました (${label}): ${error?.message ?? 'unknown error'}`);
  }
  return { id: data.user.id, email, password };
}

export async function deleteEphemeralUser(service: SupabaseClient<Database>, userId: string): Promise<void> {
  await service.auth.admin.deleteUser(userId);
}

export async function signInAsEphemeralUser(env: IntegrationEnv, user: EphemeralUser): Promise<SupabaseClient<Database>> {
  const client = createSupabaseClient<Database>(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) {
    throw new Error(`テストユーザーのサインインに失敗しました (${user.email}): ${error.message}`);
  }
  return client;
}

export interface TwoUserContext {
  env: IntegrationEnv;
  service: SupabaseClient<Database>;
  userA: EphemeralUser;
  userB: EphemeralUser;
  clientA: SupabaseClient<Database>;
  clientB: SupabaseClient<Database>;
}

/** 2人の使い捨てユーザーを作成してテストを実行し、成否によらず必ず削除する。 */
export async function withTwoUsers<T>(fn: (ctx: TwoUserContext) => Promise<T>): Promise<T> {
  const env = requireIntegrationEnv();
  const service = createServiceRoleClient(env);
  const userA = await createEphemeralUser(service, 'a');
  const userB = await createEphemeralUser(service, 'b');
  try {
    const clientA = await signInAsEphemeralUser(env, userA);
    const clientB = await signInAsEphemeralUser(env, userB);
    return await fn({ env, service, userA, userB, clientA, clientB });
  } finally {
    await deleteEphemeralUser(service, userA.id);
    await deleteEphemeralUser(service, userB.id);
  }
}

export function fakeInputHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * fixture作成はすべてservice-roleクライアント（RLSをバイパスする）で行う。
 * これによりテスト対象であるユーザー間分離を、fixtureの作成経路とは独立に検証できる。
 */
export async function insertTaskFixture(
  service: SupabaseClient<Database>,
  userId: string,
  overrides: Partial<Database['public']['Tables']['tasks']['Insert']> = {},
): Promise<string> {
  const { data, error } = await service
    .from('tasks')
    .insert({
      user_id: userId,
      title: `RLSテストタスク ${randomUUID()}`,
      priority: 3,
      estimated_minutes: 30,
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`タスクfixture作成に失敗しました: ${error?.message}`);
  return data.id;
}

export async function insertRoutineFixture(
  service: SupabaseClient<Database>,
  userId: string,
  overrides: Partial<Database['public']['Tables']['routines']['Insert']> = {},
): Promise<string> {
  const { data, error } = await service
    .from('routines')
    .insert({
      user_id: userId,
      name: `RLSテストルーティン ${randomUUID()}`,
      frequency_type: 'daily',
      estimated_minutes: 30,
      priority: 3,
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`ルーティンfixture作成に失敗しました: ${error?.message}`);
  return data.id;
}

export interface PlanningSessionFixture {
  sessionId: string;
  blockId: string;
  inputHash: string;
  windowStart: Date;
  windowEnd: Date;
}

export async function insertPlanningSessionFixture(
  service: SupabaseClient<Database>,
  userId: string,
  taskId: string,
): Promise<PlanningSessionFixture> {
  const inputHash = fakeInputHash(`${userId}:${randomUUID()}`);
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);
  const { data: session, error: sessionError } = await service
    .from('planning_sessions')
    .insert({
      user_id: userId,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      input_now: windowStart.toISOString(),
      input_hash: inputHash,
      engine_version: 'integration-test',
    })
    .select('id')
    .single();
  if (sessionError || !session) {
    throw new Error(`planning_sessions fixture作成に失敗しました: ${sessionError?.message}`);
  }

  const { data: block, error: blockError } = await service
    .from('planning_blocks')
    .insert({
      planning_session_id: session.id,
      user_id: userId,
      source_type: 'task',
      source_entity_id: taskId,
      title: 'RLSテストブロック',
      start_at: windowStart.toISOString(),
      end_at: windowEnd.toISOString(),
      duration_minutes: 60,
    })
    .select('id')
    .single();
  if (blockError || !block) {
    throw new Error(`planning_blocks fixture作成に失敗しました: ${blockError?.message}`);
  }

  return { sessionId: session.id, blockId: block.id, inputHash, windowStart, windowEnd };
}

/** 承認済みsession + Calendar書き込み成功済みtime_blockまで一気に作る（skip/complete系RPCのfixture用）。 */
export async function insertExecutableTimeBlockFixture(
  service: SupabaseClient<Database>,
  userId: string,
  taskId: string,
): Promise<{ sessionId: string; blockId: string; timeBlockId: string }> {
  const plan = await insertPlanningSessionFixture(service, userId, taskId);
  const { error: approveError } = await service
    .from('planning_sessions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', plan.sessionId);
  if (approveError) throw new Error(`planning_sessions承認fixtureに失敗しました: ${approveError.message}`);

  const { data: timeBlock, error: timeBlockError } = await service
    .from('time_blocks')
    .insert({
      user_id: userId,
      task_id: taskId,
      planning_session_id: plan.sessionId,
      planning_block_id: plan.blockId,
      start_at: plan.windowStart.toISOString(),
      end_at: plan.windowEnd.toISOString(),
      status: 'approved',
      source: 'ai',
      google_calendar_id: 'primary',
      google_event_id: `abcde${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      calendar_write_status: 'succeeded',
      calendar_write_attempt_count: 1,
      calendar_event_state: 'active',
      written_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (timeBlockError || !timeBlock) {
    throw new Error(`time_blocks fixture作成に失敗しました: ${timeBlockError?.message}`);
  }

  return { sessionId: plan.sessionId, blockId: plan.blockId, timeBlockId: timeBlock.id };
}
