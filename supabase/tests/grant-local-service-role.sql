-- ローカル統合テスト専用。supabase/migrations/ には含めない。
--
-- docs/ARCHITECTURE.md の方針どおり、本番Supabase基盤はservice roleキーを使用せず、
-- 各テーブルは`authenticated`ロールへのRLS前提のGRANTのみを持つ（service_roleへの
-- 明示GRANTは存在しない）。service_roleは`rolbypassrls`によりRLSこそ回避できるが、
-- Postgresの権限モデル上テーブルGRANT自体は別物であり、GRANTがない状態ではRLS分離
-- テストのfixture作成（`supabase/tests/helpers.ts`のinsertTaskFixture等）が
-- "permission denied for table ..." で失敗する。
--
-- 本番migrationへ含めてservice_roleへ恒久的なテーブルアクセスを与えると、
-- 上記の設計方針に反する権限拡大になるため、ここではローカルの使い捨てDBにのみ
-- `supabase db reset` 後に個別適用する（docs/TESTING.mdの手順参照）。
grant select, insert, update, delete on
  public.user_profiles,
  public.categories,
  public.tasks,
  public.routines,
  public.routine_completions,
  public.calendar_connections,
  public.calendar_connection_secrets,
  public.planning_sessions,
  public.planning_blocks,
  public.time_blocks,
  public.audit_logs,
  public.ai_advice_rate_limits,
  public.ai_advice_usage_events
to service_role;
