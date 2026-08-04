import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260803000400_drop_legacy_planning_session_rpc.sql', 'utf8');
const databaseTypes = readFileSync('src/types/database.ts', 'utf8');
const planningServer = readFileSync('src/lib/planning/server.ts', 'utf8');

describe('legacy planning creation RPC removal', () => {
  it('revokes and drops only the exact legacy function without cascade', () => {
    const signature = String.raw`public\.create_planning_session\(\s*uuid,\s*timestamptz,\s*timestamptz,\s*timestamptz,\s*text,\s*text,\s*text\[\],\s*jsonb,\s*jsonb\s*\)`;
    expect(migration).toMatch(new RegExp(`revoke all on function ${signature} from public, anon, authenticated;`, 'i'));
    expect(migration).toMatch(new RegExp(`drop function ${signature};`, 'i'));
    expect(migration).not.toMatch(/cascade/i);
    expect(migration).not.toMatch(/drop function\s+public\.create_planning_session_v2/i);
  });

  it('keeps the application and database types on the V2 creation surface', () => {
    expect(planningServer).toContain("client.rpc('create_planning_session_v2'");
    expect(planningServer).not.toContain("client.rpc('create_planning_session'");
    expect(databaseTypes).toContain('create_planning_session_v2:');
    expect(databaseTypes).not.toMatch(/^\s*create_planning_session:/m);
  });
});
