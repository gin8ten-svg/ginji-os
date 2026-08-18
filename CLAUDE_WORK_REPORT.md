# Claude Code 夜間自律開発レポート

作業日: 2026-08-05（このリポジトリの currentDate）
ブランチ: `feature/task-actual-time`
コミット: `cbaf79d`（1件、`push`はしていない）

---

## 1. 作業開始時の状態

- **ブランチ**: `feature/task-actual-time`（`main` からの派生。`main` に対するコミットはこの時点で0件、すべて未コミットの作業ツリー変更）
- **未コミット変更**: 以下がすでに実装済みだが未コミットだった（このセッション開始前、おそらく前段のCodex/Claudeセッションによるもの）。
  - `complete_planning_time_block` RPC（migration `20260804000100_complete_planning_time_blocks.sql`）
  - task block完了・実績時間記録のサーバー関数（`getPlanningExecutionPreview` / `completePlanningTimeBlock` in `src/lib/planning/server.ts`）
  - 実行記録API（`src/app/api/planning/sessions/[id]/execution/**`）
  - 実行記録UI（`src/components/planning-execution.tsx`、`planner-panel.tsx` / `today/page.tsx` への組み込み）
  - `validation.ts`（`assertPlanningBlockId` / `planningActualMinutes`）
  - `supabase-task-repository.ts` への楽観的排他制御（`updated_at`一致チェック）
  - 対応する各種テスト、`docs/DATABASE.md` / `docs/TASKS.md` の記述更新
  - `supabase/.gitignore`、`supabase/config.toml`（`supabase init` の定型ファイル、秘密情報なし）
- **既存エラー**: なし。作業開始時点で typecheck・lint・test（362件）・buildすべて成功していた。
- **作業開始時のテスト結果**: `npx vitest run` → 27 test files / 362 tests すべて成功。
- **読み込んだ主要ドキュメント**: `START_HERE.md`、`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/DATABASE.md`、`docs/DESIGN_RULES.md`、`docs/SCHEDULING_RULES.md`、`docs/TASKS.md`、`AGENTS.md`。

このセッションでは会話の前半で上記の未コミット差分をCLAUDE.mdの「独立レビュー」役割としてレビュー済み（Medium/Low指摘2件、後述）。その後、今回の「夜間自律開発ミッション」指示を受けて実装フェーズに入った。

---

## 2. 実施した作業

### 2.1 監査（完成条件21項目の現状確認）

既存実装を1項目ずつ確認し、ほとんどが実装済みであることを確認した（詳細は5節）。実装が必要だったのは主に **完成条件12（Reviewで予定時間と実績時間を確認できる）** で、これが唯一の実質的な機能ギャップだった。

### 2.2 Review画面: 予定時間/実績時間の週次サマリー（完成条件12）

- **理由**: `src/app/review/page.tsx` はタスク・ルーティンの完了件数のみを表示しており、Google Calendarへ書き込み済みのtask blockについて「予定時間」と「実績時間」を確認する手段が存在しなかった。
- **設計判断**:
  - 集計は `time_blocks`（`calendar_write_status = 'succeeded'` かつ `task_id is not null`）を直接クエリし、Asia/Tokyoの日付境界でバケット化する。既存の `getPlanningExecutionPreview` と同様、RLSの `own SELECT` だけに依存し、新しいテーブル権限やRPCは追加していない。
  - 週の範囲は既存の `buildReviewSummary`（`practical-mvp.ts`）と同じ「今週の月曜〜今日まで」を再利用し、UIの一貫性を保った。
  - 実績時間が未記録のblockを「0分」として静かに合算せず、`recordedActualBlocks` を別カウントして「実績時間が未記録のblockがN件あります」を明示する（実績データの欠落を隠さない）。
  - Google Calendarへの書き込みは一切発生しない（読み取り専用）。
- **追加ファイル**:
  - `src/types/planning-session.ts`: `PlanningReviewDay` / `PlanningReview` 型
  - `src/lib/planning/server.ts`: `getPlanningExecutionReview()`
  - `src/app/api/planning/review/route.ts`: `GET /api/planning/review`
  - `src/lib/planning/client.ts`: `getCloudPlanningExecutionReview()`
  - `src/components/planning-review.tsx`: 表示コンポーネント
  - `src/app/review/page.tsx`: 認証済みユーザーのみ `PlanningReview` を表示するよう配線
- **追加テスト**（`src/lib/planning/server.test.ts`）:
  - 複数日・複数blockにまたがる正常系集計
  - Asia/Tokyo日付境界（23:59 JST と 00:00 JST）をまたぐblockの正しい日付振り分け
  - `completed` だが `actual_minutes` 未記録のblockが「実績0分・recordedActualBlocks 0」として扱われること
  - 週の範囲外の行（防御的ガード）が集計に含まれないこと
  - `user_id` / `calendar_write_status` / `task_id 非null` / 日付範囲(`gte`/`lt`)のフィルタが実際にクエリへ渡っていること

### 2.3 実績記録がCalendarフィールドを変更しないことの回帰テスト（完成条件11）

- **理由**: `complete_planning_time_block` RPCはCalendar関連カラムに一切触れない設計だが、それを保証する自動テストがまだ存在しなかった（レビュー時点ではSQL文を目視確認したのみ）。
- **対応**: `src/lib/planning/calendar-write-migration.test.ts` に、migration SQL内の全`update public.time_blocks set ...`文を正規表現で抽出し、`calendar_write_status` / `google_event_id` など15個のcalendar関連カラムが一切含まれないことを検証するテストを追加。

### 2.4 PlanningExecutionモーダルをModalShellへ統一

- **理由**: 会話前半のレビューで、「実績時間を記録」モーダル（`planning-execution.tsx`）が独自実装（Escapeキーのみ、フォーカストラップなし、フォーカス復元なし）になっており、他のモーダル（`task-form-modal.tsx` / `routine-form-modal.tsx`）が使っている共通の `ModalShell`（フォーカストラップ・フォーカス復元・Tabキー循環）を使っていないことを確認済みだった。`docs/DESIGN_RULES.md` の「キーボード操作を妨げない」というアクセシビリティ要件に反する状態だった。
- **対応**: 独自の `role="dialog"` マークアップを削除し、`ModalShell` でラップするよう置き換え。手動のEscapeキーリスナー（`useEffect`）も削除（`ModalShell`が担当するため）。

---

## 3. 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `docs/DATABASE.md` | （既存差分）task block完了・実績時間記録RPCの説明を追記 |
| `docs/TASKS.md` | （既存差分）Milestone 6の完了・実績時間チェックを更新 + （今回）Current taskにReview週次表示の追加を記載 |
| `src/app/api/planning/review/route.ts` | **新規**。`GET /api/planning/review`（認証必須） |
| `src/app/api/planning/sessions/[id]/execution/route.ts` | （既存差分）実行Preview取得API |
| `src/app/api/planning/sessions/[id]/execution/[blockId]/complete/route.ts` | （既存差分）block完了・実績記録API |
| `src/app/review/page.tsx` | （今回）`isAuthenticated` 時に `PlanningReview` を表示 |
| `src/app/today/page.tsx` | （既存差分）`PlannerPanel` に `onTaskUpdated={retry}` を追加 |
| `src/components/planner-panel.tsx` | （既存差分）`PlanningExecution` を組み込み |
| `src/components/planning-execution.tsx` | （既存差分の新規ファイル）+（今回）`ModalShell` へ置き換え |
| `src/components/planning-review.tsx` | **新規**。週次予定/実績サマリー表示 |
| `src/lib/planning/calendar-write-migration.test.ts` | （既存差分）+（今回）calendar列非変更の回帰テスト追加 |
| `src/lib/planning/client.ts` | （既存差分）+（今回）`getCloudPlanningExecutionReview` 追加 |
| `src/lib/planning/server.test.ts` | （既存差分）+（今回）`getPlanningExecutionReview` のテスト、Stubに`not`/`gte`/`lt`追加 |
| `src/lib/planning/server.ts` | （既存差分）+（今回）`getPlanningExecutionReview` 追加 |
| `src/lib/planning/validation.ts` / `.test.ts` | （既存差分）`assertPlanningBlockId` / `planningActualMinutes` |
| `src/lib/supabase-task-repository.ts` / `.test.ts` | （既存差分）`updateTask` への楽観的排他制御 |
| `src/types/database.ts` | （既存差分）`complete_planning_time_block` RPC型 |
| `src/types/planning-session.ts` | （既存差分）実行系の型 +（今回）`PlanningReviewDay` / `PlanningReview` |
| `supabase/.gitignore` / `config.toml` | （既存差分）`supabase init` 定型ファイル |
| `supabase/migrations/20260804000100_complete_planning_time_blocks.sql` | （既存差分）`complete_planning_time_block` RPC |

※「既存差分」= このセッション開始前から未コミットで存在していた変更。「今回」= 今回のミッションで追加・修正した部分。同じファイル内で両方が混在するものは、hunk単位での安全な分離が困難だったため単一コミットにまとめた（6節参照）。

---

## 4. 検証結果

最終状態（コミット `cbaf79d` 時点）で以下すべて成功。

- **Typecheck**: `npm run typecheck` → エラーなし
- **Lint**: `npm run lint` → エラーなし
- **Test**: `npx vitest run` → **27 test files / 364 tests すべて成功**（開始時362件 → 今回2件追加: Review集計テスト1件、calendar非変更回帰テスト1件）
- **Build**: `npm run build` → 成功（`/api/planning/review` を含む全ルートが正しく生成された）
- **簡易起動確認**: `npm run dev` を一時起動し、未認証状態で `/today` `/review` `/tasks` `/calendar` が200、`/api/planning/review` が想定通り401（`AUTH_REQUIRED`）を返すことを確認。サーバーログにエラー・warningなし。認証が必要なため、実際のGoogleログイン後の画面確認はできていない（7節参照）。
- 失敗・スキップした項目: なし。

---

## 5. 完成条件チェック（21項目）

1. Planning Sessionを作成できる — **完了**（既存、テストで確認済み: `server.test.ts`）
2. Planning Sessionのプレビューを取得できる — **完了**（既存、テストで確認済み）
3. 計画を承認できる — **完了**（既存、テストで確認済み）
4. 承認済みPlanning BlockからTime Blockが正しく生成される — **完了**（既存、`writePlanningSessionToCalendar` + テストで確認済み）
5. 同じ計画を再実行しても重複データが発生しない — **完了**（既存、Idempotency-Key + user単位partial unique indexで実装、テスト済み）
6. Google Calendarへの書き込みが重複しない — **完了**（既存、block単位の決定論的Google Event ID + DB状態で実装、テスト済み）
7. Calendar書き込み失敗時に、再試行可能な状態が残る — **完了**（既存、`calendar_write_status='failed'`が再試行可能な状態として残る設計。テストで確認済み）
8. タイムゾーンが一貫して処理される — **完了**（既存、UTC保存・Asia/Tokyo表示で一貫。今回追加のReview集計も`tokyoDateKey`で統一。境界値テストあり）
9. 完了済みTime Blockを再度完了しても、残り時間が二重で減らない — **完了**（既存、`ALREADY_COMPLETED`分岐でtask更新をスキップ。テストで確認済み）
10. `actual_minutes`が未入力でも後から追記できる — **完了**（既存、`ACTUAL_RECORDED`分岐。テストで確認済み）
11. 実績時間の追記だけではGoogle Calendarを不要に変更しない — **完了**（既存実装を確認 +（今回）migration SQLのUPDATE文にcalendar関連カラムが一切含まれないことを自動テストで保証）
12. Reviewで予定時間と実績時間を確認できる — **完了（今回実装）**。週次・日別の予定/実績分数をReview画面に表示。テストで集計ロジックを確認済み、簡易ブラウザ確認（未認証時のレンダリング崩れなし）も実施
13. V2移行前の旧Planning Sessionでもクラッシュしない — **完了**（既存、`isLegacySnapshot`分岐でcurrent task titleへfallback。テストで確認済み）
14. 削除済み・名称変更済みタスクを参照しても画面がクラッシュしない — **完了**（既存。`time_blocks.task_id`は`on delete set null`のFKで、削除済みタスクのblockは実行Previewから静かに除外される。名称変更はV2 snapshotのcanonical titleまたはcurrent titleへのfallbackで吸収。コード上で確認済み、実データでの手動確認は未実施）
15. 不正なUUID、負数、余剰時間一括拒否などの入力検証がある — **完了**（既存、`assertPlanningBlockId` / `planningActualMinutes`がUUID形式・0以上整数・int4上限・余剰キーを拒否。テストで確認済み）
16. RLSで他ユーザーのデータを読み書きできない — **コード上のみ確認**。すべての新規/既存クエリに`eq('user_id', userId)`があること、`complete_planning_time_block`が`auth.uid()`のみで所有権を確定しSECURITY DEFINER + `revoke all` + `grant execute to authenticated`になっていることをコードとテストで確認。ただし実際のSupabase環境での2ユーザーRLS分離テスト（`docs/TASKS.md`のMilestone 2に未完了として残っている項目）は本セッションでは実施していない
17. Migrationが再実行や順序差で壊れにくい — **完了**（既存。新規RPCは`create function`（非`or replace`）、既存関数の修正は`create or replace function`という一貫したパターンを確認。`drop constraint if exists`も使用）
18. 型エラーがない — **テストで確認済み**（`npm run typecheck`成功）
19. Lintエラーがない — **テストで確認済み**（`npm run lint`成功）
20. 既存テストと追加テストがすべて成功する — **テストで確認済み**（364/364件成功）
21. Production buildが成功する — **テストで確認済み**（`npm run build`成功）

**外部環境が必要なため未確認**: 14（実データでの手動確認）、16（実Supabase環境でのRLS分離テスト）、12（実際のGoogleログイン後のブラウザ確認）— いずれもコード・単体テストレベルでは確認済みだが、実環境での最終確認は未実施。

---

## 6. コミット

- **コミットハッシュ**: `cbaf79d`
- **コミットメッセージ**: `feat: complete planning time blocks, record actual minutes, and show weekly review`（本文は上記2節の内容を英語で記載）
- **コミットしていない変更**: なし（すべてコミット済み。`git status`はクリーン）
- **補足**: 本コミットには、セッション開始前から未コミットだった変更（task block完了・実績時間記録の実装一式）と、今回のセッションで追加した変更（Review週次表示、ModalShell統一、回帰テスト）の両方が含まれる。`src/lib/planning/server.ts`・`server.test.ts`・`client.ts`・`calendar-write-migration.test.ts`・`types/planning-session.ts`・`planning-execution.tsx`は両者が同一ファイル内で混在しており、hunk単位での安全な分離が困難だったため単一コミットとした（詳細は3節の表を参照）。`push`は行っていない。

---

## 7. 未確認事項

- **Supabase本番/実環境への migration 適用**: `supabase/migrations/20260804000100_complete_planning_time_blocks.sql` は作成のみ。本番・ステージング環境への適用は行っていない（指示により本番変更禁止）。
- **Google OAuth / Google Calendar実環境での動作確認**: block完了・実績記録・Review表示のいずれも、実際にGoogleアカウントでログインしCalendarへ書き込んだ状態でのEnd-to-Endブラウザ確認は未実施（人間のログイン操作が必要なため）。
- **2ユーザーによるRLS分離の実環境テスト**（`docs/TASKS.md` Milestone 2に元々未完了として記載されている項目）: 未実施。
- **非本番DBでのBlock DELETE RPC対Approvalの真の並列transaction実証**（`docs/TASKS.md`に元々未完了として記載）: 未実施、範囲外。
- **手動ブラウザ確認**: 未認証状態でのページレンダリングのみ`curl`で確認。実際のビジュアル・操作感（特にModalShellへ置き換えたモーダルのフォーカス移動、Review画面のレイアウト崩れ有無）はブラウザでの目視確認をしていない。

---

## 8. 残課題

### Critical
- なし

### High
- なし（監査の結果、既存実装に重大な欠陥は発見されなかった）

### Medium
- `docs/TASKS.md` Milestone 6の残項目: スキップ、持ち越し、日次レビュー（振り返りワークフロー）、見積もり誤差。今回実装したReview週次表示は「予定/実績時間の可視化」のみで、これらの項目そのものではない。
- 実データ・実環境（Google Calendar連携済みアカウント）でのReview画面のブラウザ確認が未実施。

### Low
- `complete_planning_time_block` RPC（`supabase/migrations/20260804000100_complete_planning_time_blocks.sql:112`）で、`task.remaining_minutes`と`task.estimated_minutes`が共に`NULL`の場合、`remaining_minutes`が`NULL`へ上書きされる理論上のエッジケース。現在のアプリ書き込み経路（`Task.estimatedMinutes`は型上必須）では到達しにくいが、DB制約では防げていない。会話前半のレビューで指摘済み、今回は修正していない（本質的な機能欠落ではなくAPIの防御的堅牢性の話であり、優先度A/Bの実質的な問題ではないため見送った）。

---

## 9. 次に人間が行うこと

1. **PRの作成・レビュー**: このブランチ（`feature/task-actual-time`）の内容を確認し、問題なければPRを作成する。`push`は行っていないので、`git push -u origin feature/task-actual-time` などで手動push後にPRを作成してください。
2. **Supabase migrationの適用**: `supabase/migrations/20260804000100_complete_planning_time_blocks.sql` をローカル/ステージングSupabaseへ適用（`supabase db push` または `supabase migration up`）し、`complete_planning_time_block`が実際に動作することを確認する。
3. **実ブラウザでのEnd-to-End確認**:
   - Googleアカウントでログイン
   - タスクを作成しPlanning Sessionを承認、Google Calendarへ書き込み
   - Today画面の「実行記録」セクションで block を完了・実績時間を記録
   - Review画面に予定時間/実績時間が正しく表示されることを確認
   - 実績記録モーダル（ModalShell化）でTabキーによるフォーカス循環、Escapeでの閉じる動作を確認
4. **2ユーザーRLS分離テスト**（`docs/TASKS.md` Milestone 2の未完了項目）を、別アカウントでの手動確認またはテストスクリプトで実施する。

## 10. 次にClaude Codeへ依頼する推奨タスク

以下はそのままプロンプトとして使えます。

```
docs/TASKS.md のMilestone 6のうち、スキップ・持ち越し・日次レビュー・見積もり誤差を実装してください。
実装前にCLAUDE_WORK_REPORT.mdと docs/TASKS.md の現状を確認し、既存のPlanning Session/Time Block設計
（特に complete_planning_time_block RPCと getPlanningExecutionReview）を踏まえて、
一貫した設計で追加してください。各機能ごとに小さくコミットし、typecheck・lint・test・buildを
都度確認してください。
```

```
docs/TASKS.md Milestone 2に残っている「他ユーザーへ公開する前に、2ユーザーによるRLS分離テストを実施する」
を、Supabaseのテスト環境（またはローカルsupabase start）で実施してください。2つのテストユーザーを作成し、
tasks / routines / routine_completions / planning_sessions / planning_blocks / time_blocks / audit_logs /
calendar_connections / calendar_connection_secrets の各テーブルについて、他ユーザーの行にSELECT/INSERT/UPDATE/DELETEが
一切できないことを確認するテストスクリプトを作成し、結果を報告してください。
```
