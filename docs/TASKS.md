# Development Tasks

## Milestone 0 — Repository bootstrap

- [x] Next.js + TypeScript + Tailwind初期化
- [x] ESLint設定
- [x] 環境変数サンプル
- [x] 基本ディレクトリ作成（docs/ARCHITECTURE.mdを実構成に合わせて記載）
- [x] CIでlint/typecheck/test/build
- [x] モバイル用アプリシェル

## Milestone 1 — Local UI prototype

- [x] Today画面
- [x] Tasks画面
- [x] Calendar仮画面
- [x] Review仮画面
- [x] ダミーデータ
- [x] タスク作成モーダル
- [x] 通常タスクのlocalStorage CRUDと自動分類
- [x] ルーティン設定と日付別完了履歴
- [x] Todayへの当日ルーティン表示

## Milestone 2 — Supabase

- [x] Supabaseプロジェクト
- [x] Googleログイン（Provider設定は手動）
- [x] DBマイグレーション
- [x] RLS
- [x] ToDo CRUD
- [x] ユーザー設定
- [x] 他ユーザーへ公開する前に、2ユーザーによるRLS分離テストを実施する（`supabase/tests/rls-isolation.integration.test.ts`。ローカルSupabaseで実行確認済み、2026-08-18、16件全パス）

## Practical MVP — Daily use

- [x] Todayダッシュボードとクイック追加
- [x] タスク検索・絞り込み・並び替え
- [x] ルーティン管理と当日完了
- [x] 月間カレンダー
- [x] 週次振り返り
- [x] ローディング・エラー・保存フィードバック

## Milestone 3 — Calendar read

- [x] Google OAuthスコープ設計
- [x] 接続状態画面
- [x] 対象日の予定取得
- [x] 終日予定処理
- [x] 空き時間計算（Planner制約エンジンで実装）
- [x] タイムゾーンテスト

## Milestone 4 — Planner proposal

- [x] 制約エンジン
- [x] 優先順位スコア（priority/urgency/overdue。goal_weightは常に0、fragmentation/context_switchは未統合）
- [x] OpenAI Responses APIによる最小化Structured Advice
- [x] サーバー検証
- [x] 提案プレビュー
- [x] Planning Session保存・stale検出・明示承認/却下
- [x] AI-ready助言interface（外部providerなし）
- [x] Planning Session生成のIdempotency-Key・原子的保存・重複request排除
- [x] Planning Input Snapshot V2とtitle整合性基盤（Migration適用・動作確認済み、2026/07/31）
- [x] AI AdviceのDB原子rate limit
- [x] AI Adviceの利用量監視（ai_advice_usage_events・record_ai_advice_usage RPC、Review画面に月次概算表示）
- [x] 手動編集（update_planning_block_time/task・delete_planning_block、manually_edited時はhard constraintのみ再検証）
- [x] 再生成（regeneratePlanningSession、既存draftを明示rejectしてから新規作成）

## Milestone 5 — Calendar write

- [x] 承認画面（承認確認モーダルに対象期間・block数・合計時間・手動編集注記を表示）
- [x] V2 Migration適用・動作確認後にGoogle Calendar Event Previewを実装
- [x] Googleイベント作成
- [x] block単位の冪等性（DB状態 + 決定論的Google Event ID）
- [x] approved/rejected/superseded SessionとblockのDB不変化
- [x] 非本番DBでBlock DELETE RPC対Approvalの真の並列transactionとauth.users CASCADE削除を実証（`supabase/tests/concurrency.integration.test.ts`。ローカルSupabaseで実行確認済み、2026-08-18）
- [x] duration_minutesとstart/endのDB整合制約
- [x] Calendar書き込み直前の完全再検証
- [x] 部分成功を保持し失敗blockだけ再試行する方針
- [x] audit_logs
- [x] 作成済み予定のcanonical再同期・削除（個別確認、所有マーカー・ETag検証、block単位冪等性）
- [x] V2 rollout完了後、旧create_planning_session RPCを別Migrationでrevoke / drop

## Milestone 6 — Execution and review

- [x] 完了（Google Calendar追加済みtask blockを原子的に完了し、task残り時間へ反映）
- [x] スキップ（skip_planning_time_block RPC、reason=user_skipped）
- [x] 実績時間（block単位、完了時または完了後に記録）
- [x] 持ち越し（skip_planning_time_block RPC、reason=carried_over。remaining_minutesは変更せず次回planning時に自動再候補化）
- [x] 日次レビュー（getPlanningDailyReview、Review画面に日別カード追加）
- [x] 見積もり誤差（getPlanningEstimationAccuracy、直近30日のタスク単位概算をReview画面に表示）

## Current task

TASKS.md記載の全項目を実装済み。

- [x] ローカルSupabase（`supabase start` → `supabase db reset`）で`npm run test:integration`を実行し、RLS分離テストと並列transaction/CASCADE実証を確認する（`docs/TESTING.md`参照。2026-08-18、Docker Desktop起動のうえ実施、16件全パス）。
- [x] 一連のフロー（ログイン→タスク→計画生成→承認→Calendar書込→完了→週次レビュー各セクション表示）を本番環境（`ginji-os.vercel.app`）・実Google Calendar接続ありで通しで手動確認した（2026-08-18）。手動編集・スキップ・持ち越しは未確認のまま残っている。

### 2026-08-18の手動確認で発覚し対応した問題

- 本番Supabaseプロジェクト（`ginji-os-dev`）が無操作により一時停止していた（DNS unresolvedを確認）→ ダッシュボードから復元
- Google Calendar接続のrefresh tokenが失効していた（最終接続2026/08/03、Testing公開状態のtoken 7日失効が原因と推測）→ 接続解除→再接続で復旧
- 本番`main`ブランチが2026/08/04時点（PR #6）で止まっており、Milestone 5後半〜6（完了/スキップ/持ち越し・日次振り返り・週次レビュー・見積もり誤差・AI利用状況・統合テスト）4コミットが未マージ・未デプロイだった → PR #7を作成・マージし本番デプロイ（https://github.com/gin8ten-svg/ginji-os/pull/7）
- 上記に伴うmigration 4件（`20260804000100`〜`20260810000100`、`ai_advice_usage_events`テーブル含む）が本番Supabaseに未適用で、Review画面の「日次振り返り」「AI利用状況」がAPI 500エラーになっていた → `supabase db push`で適用し解消（同時に存在した無関係な進行中作業のmigration 5件は一時退避して触れずに実施）

### 2026-08-21に発覚し対応した重大バグ

- **新規の計画作成・再計算が本番で全て失敗する状態だった**（`計画案を保存できませんでした。`/`PERSISTENCE_FAILED`）。原因は、コミット`3fd4244`（2026-08-12）で`PLANNING_ENGINE_VERSION`を`deterministic-v2`→`deterministic-v3`へ上げた際、DB関数`create_planning_session_v2`（`supabase/migrations/20260715001000_planning_input_snapshot_v2.sql`）側の許可バージョンチェックが`deterministic-v2`のままハードコードされて更新されていなかったこと。2026-08-18にPR #7をマージし本番へ`deterministic-v3`のアプリコードがデプロイされて以降、本番の計画作成が壊れていた（ローカル統合テストはこの経路を直接検証していなかったため未検出）。`supabase/migrations/20260821000100_fix_planning_engine_v3.sql`で許可バージョンを`deterministic-v3`へ更新し解消。実際に計画再作成が201で成功することを確認済み。
