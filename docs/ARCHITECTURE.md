# Architecture

## 1. Components

### Client

Next.js App RouterによるレスポンシブWebアプリ。

### Server

Next.jsのServer ActionsまたはRoute Handlers。
外部API、データベース、AIへのアクセスはサーバー側で行う。

### Data

Supabase Postgres。

### Authentication

Supabase Auth + Google OAuth。

### Calendar integration

Google Calendar API。
追加同意の開始ユーザーは用途分離した秘密鍵で署名した短命HttpOnly Cookieへ記録し、OAuth callback後の
認証ユーザーと一致した場合だけ暗号化Refresh Tokenを保存する。APIはページ数・件数を制限し、個人データを
返すレスポンスは `private, no-store` とする。

Calendar権限は通常ログインから分離し、Calendar画面の明示的な接続操作でのみ
`calendar.events` と `calendar.calendarlist.readonly` を要求する。Google API呼び出しは
Route Handlerに限定し、Access Tokenは永続化しない。Refresh TokenはAES-256-GCMで暗号化して
`calendar_connection_secrets` へ保存し、`authenticated`への直接table権限は付与せずSECURITY DEFINER RPC経由でのみ
読み書きする。外部イベントはDBへ複製せず、クライアントの一時状態だけで扱う。

### AI planning

OpenAI API。
モデルには自由形式の予定を書かせず、定義済みスキーマに従う計画案を返させる。

AI導入前のPlanning Engineは、正規化済みGoogle予定、Task、Routineだけを入力にする純粋な決定論的層とする。
Google Tokenやuser_idは入力に含めない。Asia/Tokyoの08:00〜22:00を7日分生成し、固定予定を差し引いた
空き枠へTaskとRoutineをeffective deadlineで横断的に配置する。計画生成とPreviewはGoogleへ書き込まず、
承認済みV2 Sessionだけが別の明示確認付きAPIから書き込める。

Planning Sessionはサーバーが現在のTask、Routine、完了履歴、正規化済みbusy区間から生成する。
`planning_sessions` と所有者を複合外部キーで固定した `planning_blocks` をRLS下へ保存し、承認時には
同じ決定論的Engineで再計算する。canonical入力のSHA-256が変化した場合はstaleとして409を返す。
クライアント作成ブロック、user_id、Google Tokenは入力として受け取らない。将来のAIは順序・説明の
助言だけを返し、最終配置と承認可否は制約Engineが決める。

新規Sessionは `planning-input-v2` のcanonical snapshotを保存し、Task/Routineの正規化titleを含むsnapshot全体から
SHA-256を生成する。snapshot schemaとPlanning Engine (`deterministic-v2`) は別々にversion管理する。Approvalと
AI Adviceは保存snapshotの自己整合性と現在入力から再生成したhashを検証し、snapshotやhashを公開APIへ返さない。
legacy Sessionは自動backfillせず読み取りだけを維持し、legacy draftのApprovalとAI Adviceは拒否する。

Cloud生成は必須のUUID `Idempotency-Key` とuser単位partial unique indexを使い、Sessionとblocksを単一DB関数で
原子的に保存する。通信retryは同じkey、明示的な再計算は新しいkeyを使う。terminal Sessionは監査snapshotとして
利用者によるUPDATE・直接DELETE不能で、そのblocksも変更不能とする。新しいSessionの承認時だけ、重複windowの既存approvedを
snapshotとapproved_atを保持したままsupersededへ原子的に遷移でき、DB排他制約でもapproved window重複を防ぐ。
blocksは分境界およびstart/endとdurationの完全一致をDBで保証する。
block変更は親Sessionのrevisionを更新し、Approval RPCは親行ロック下で検証済みrevisionとの一致を必須とする。
Blockの直接DELETEはauthenticatedへ許可せず、専用SECURITY DEFINER RPCがBlock行とdraft親Sessionを順にロックし、
revision増加と削除を単一transactionで実行する。RLS述語に副作用を持たせず、DELETE triggerも使わないため、
正式なアカウント削除のFK CASCADEは妨げない。

AI Planning Adviceはserver-onlyのOpenAI Responses APIアダプターを通し、Task/Routineのalias、数値、分類、
空き時間集計だけをStructured Outputへ渡す。自由記述、ユーザー識別子、Google予定識別子・タイトル・Tokenは
送信しない。AIはhard priority band内の順序と説明だけを提案し、決定論的Engineが再配置・再検証した結果を
別のdraft Sessionとして保存する。AI失敗時も元のdraftと通常Plannerは利用できる。

## 2. Data flow

1. ユーザーがGoogleでログイン
2. ToDoを登録
3. サーバーが対象日のカレンダー予定を取得
4. サーバーが空き時間を決定
5. 制約エンジンが配置可能枠を作成
6. AIが優先順位・分割案を返す
7. サーバーが重複、期限、所要時間を再検証
8. ユーザーへプレビュー表示
9. ユーザー承認後にPlanning Sessionを承認済みにする（承認だけではGoogleへ書き込まない）
10. 別の明示確認後、書き込みAPIが完全再検証してblock単位でGoogle予定を作成する
11. 書き込み結果と監査履歴を保存する

## 3. Safety boundaries

AIに直接Google APIの資格情報を渡さない。
AIは計画案を返すだけで、実際の予定作成はサーバーが検証後に実施する。

Planning Sessionの `approved` はユーザー確認の記録であり、Calendar書き込み権限そのものではない。
書き込みAPIは認証・所有権・status・最新入力hash・実時刻鮮度・Engine出力・保存blocks・対象Calendarを
書き込み直前に再検証し、最終確認とblock単位idempotencyを備える。approve RPCだけをGoogle APIの権限境界にしない。
immutableなapproved snapshotでも、書き込み直前に現在入力・所有権・Calendar接続を再検証する。
Google Calendar Event Previewは承認済みV2 Sessionだけを再検証して読み取り専用表示する。保存snapshot・現在hash・
決定論的Engine出力・保存blocks・実時刻鮮度を確認し、snapshotのcanonical titleを使う。書き込みはPreviewを信用せず
同じ検証を独立して再実行し、DB予約RPCでstatus/hash/revision/block/対象CalendarをGoogle呼び出し直前にも確認する。
詳細は `docs/GOOGLE_CALENDAR_WRITE.md` を参照する。

作成済みGoogle予定の再同期・削除も、DBに保存したCalendar/Event対応とGoogle private所有マーカーを操作直前に照合する。
再同期はfreshなapproved計画のcanonical snapshotだけを使い、削除はstale/superseded後の清掃を可能にする代わりに保存snapshot・
immutable block・所有関係・対象Calendarを再検証する。両操作とも最新ETagを`If-Match`で送り、明示確認なしに実行しない。

## 4. Time handling

- DB保存: UTC
- ユーザータイムゾーン初期値: Asia/Tokyo
- 終日予定と時刻付き予定を区別
- 日付境界はユーザータイムゾーンで計算

## 5. Environment variables

例:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `CALENDAR_TOKEN_ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL`
- `AI_ADVICE_MONTHLY_CALL_LIMIT`（任意、AI Advice月間呼び出し上限の目安。既定200）

OpenAI APIキー、Googleクライアントシークレットはサーバー専用。現在のSupabase基盤はservice roleキーを使用しない。

## 6. Deployment

- Application: Vercel
- Database/Auth: Supabase
- Source: GitHub
- Preview deployments: Pull Request単位

## 7. Directory structure

計画段階の構成案（route group、`components/{ui,tasks,calendar,planner}`、`lib/{db,validation}`、独立`tests/`）から実装時に以下へ変化した。route groupは導入せずフラットな`app/`配下にpage・API routeを置き、コンポーネントは`components/`直下にフラット配置、テストはミラーツリーではなく対象ファイルにco-locate（`foo.ts`に対し`foo.test.ts`）している。`lib/`はドメインごとに`auth/calendar/planner/planning/supabase`のサブディレクトリへ分割し、決定論的Planning Engine（`lib/planner/`）とPlanning SessionのDB/API層（`lib/planning/`）は責務が異なるため統合していない。

```text
src/
  app/
    page.tsx, layout.tsx, error.tsx, globals.css
    today/ tasks/ calendar/ review/ login/   （各page.tsx）
    auth/callback/, auth/logout/             （route.ts）
    api/
      calendar/{calendars,connect,connection,events}/route.ts
      planning/
        review/route.ts
        sessions/route.ts
        sessions/[id]/route.ts
        sessions/[id]/{advice,approve,reject,calendar-preview,write-to-calendar}/route.ts
        sessions/[id]/execution/route.ts
        sessions/[id]/execution/[blockId]/complete/route.ts
  components/        フラット配置（app-shell, planner-panel, planning-execution,
                      planning-review, calendar-event-preview, task-form-modal,
                      routine-form-modal, task-data-provider 等）
  lib/
    auth/            get-user.ts, oauth-options.ts, urls.ts
    calendar/        google-api.ts, connection.ts, token-crypto.ts, event-dates.ts 等
    planner/         engine.ts（決定論的Planning Engine）, calendar-input.ts
    planning/        server.ts（DB/RPC層）, advisor.ts, openai-advisor.ts, client.ts,
                      validation.ts, hash.ts, input-snapshot-v2.ts, approval-ui.ts
    supabase/        client.ts, server.ts, env.ts, converters.ts, proxy.ts
    直下ファイル      date-time.ts, task-repository.ts, supabase-task-repository.ts,
                      task-planning.ts, practical-mvp.ts, mock-data.ts,
                      repository-mode.ts, submission-gate.ts, task-store-adapter.ts
  types/             calendar.ts, planning.ts, planning-session.ts, tasks.ts, database.ts
  test/              server-only.ts（vitest用のserver-onlyダミーモック）
supabase/
  migrations/
docs/
```

テストは各モジュールへの co-location を採用しており（例: `src/lib/planning/server.test.ts`）、独立した`tests/`ツリーは持たない。実DBに接続する統合テストは`supabase/tests/`（`docs/TESTING.md`参照）に分離し、`src/**/*.test.ts`（`npm run test`、CI対象）とは明確に区別する。
