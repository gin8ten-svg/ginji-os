# Testing

## Unit / component tests（CI対象）

```bash
npm run test
```

`src/**/*.test.ts` に対象データベースへ接続しないテストをco-locateしている（`FakeSupabase`等のモックのみ使用）。`.github/workflows/*.yml` のCIでもこのコマンドのみを実行する。

## Integration tests（ローカル専用、CI対象外）

`supabase/tests/**/*.integration.test.ts` は実際のローカルPostgres/Supabase Authに接続し、RLS分離・並列トランザクションなど`FakeSupabase`では検証できない挙動を確認する。**CIでは実行しない。** 本番/共有Supabaseプロジェクトへ接続することも一切ない（`supabase/tests/helpers.ts` の `requireIntegrationEnv()` が `SUPABASE_URL` を `127.0.0.1`/`localhost` 以外へは接続させない）。

### セットアップ

1. Supabase CLIをローカルで起動する（初回はDockerが必要）。

   ```bash
   supabase start
   ```

2. 全migrationを新規ローカルDBへ適用する（destructiveなのでローカル専用インスタンスのみに使う）。

   ```bash
   supabase db reset
   ```

3. `supabase status -o env` の出力から `API_URL`・`ANON_KEY`・`SERVICE_ROLE_KEY` を確認し、リポジトリ直下に `.env.test.local`（`.gitignore`済み、コミットしない）を作成する。

   ```bash
   # .env.test.local
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=<supabase status -o env の ANON_KEY>
   SUPABASE_SERVICE_ROLE_KEY=<supabase status -o env の SERVICE_ROLE_KEY>
   ```

   `.env.local`（アプリ本体がcloud Supabaseへ接続するために使う設定）とは別ファイルであり、混同しないこと。

### 実行

```bash
npm run test:integration
```

### 内容

- `supabase/tests/rls-isolation.integration.test.ts` — `docs/DATABASE.md`の「`auth.uid()=user_id`の行だけを許可する」原則を、実DB上で2人のユーザー（サインアップ→サインイン→操作→削除まで使い捨て）で検証する。他ユーザーの行はSELECT/UPDATE/DELETEできず、承認・完了・スキップ・削除系RPCへ他人のIDを渡しても越権できないことを確認する。
- `supabase/tests/concurrency.integration.test.ts` — `reserve_calendar_event_write`の二重予約防止、`delete_planning_block`と`approve_planning_session`の真の並列実行時に矛盾状態が発生しないこと、`auth.users`削除時の関連行CASCADE削除を実DBのロック・トランザクション挙動で検証する。

### 後始末

各テストは`try/finally`で使い捨てユーザーを削除するため、通常は追加の後始末は不要。テストが異常終了しゴミが残った場合は`supabase db reset`でローカルDBを初期化する。
