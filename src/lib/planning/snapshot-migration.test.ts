import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260715001000_planning_input_snapshot_v2.sql', 'utf8');

describe('planning input snapshot v2 migration', () => {
  it('nullable pairとschema/object/size制約を非破壊追加', () => {
    expect(migration).toContain('add column input_snapshot_version text null'); expect(migration).toContain('add column input_snapshot jsonb null');
    for (const fragment of ['planning_sessions_input_snapshot_pair_check', "input_snapshot_version = 'planning-input-v2'", "jsonb_typeof(input_snapshot) = 'object'", "input_snapshot ->> 'schemaVersion' = input_snapshot_version", 'octet_length(input_snapshot::text) <= 1000000']) expect(migration).toContain(fragment);
    expect(migration).not.toMatch(/update\s+public\.planning_sessions/i); expect(migration).not.toMatch(/delete\s+from\s+public\.planning/i);
  });
  it('snapshot列をdraft中も不変にする', () => {
    expect(migration).toContain('new.input_snapshot_version is distinct from old.input_snapshot_version');
    expect(migration).toContain('new.input_snapshot is distinct from old.input_snapshot');
  });
  it('旧RPCを維持して別名V2 RPCを追加', () => {
    expect(migration).toContain('create function public.create_planning_session_v2(');
    expect(migration).not.toMatch(/drop function public\.create_planning_session/i);
    expect(migration).not.toMatch(/revoke[^;]*public\.create_planning_session\(/i);
  });
  it('V2 RPCはauth.uid・固定search_path・原子保存・legacy conflict検出', () => {
    expect(migration).toContain('current_user_id uuid := (select auth.uid())'); expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("existing_snapshot_version is distinct from 'planning-input-v2'");
    expect(migration).toContain('insert into public.planning_sessions'); expect(migration).toContain('insert into public.planning_blocks');
    const signature = migration.slice(migration.indexOf('create function public.create_planning_session_v2('), migration.indexOf('returns uuid'));
    expect(signature).not.toMatch(/user_id/i);
  });
  it('authenticatedだけへ実行を許可しGoogle/OpenAIを変更しない', () => {
    expect(migration).toContain('from public, anon, authenticated'); expect(migration).toContain('to authenticated');
    expect(migration).not.toMatch(/calendar_connections|google_|ai_advice_rate_limits|openai_api_key/i);
  });
});
