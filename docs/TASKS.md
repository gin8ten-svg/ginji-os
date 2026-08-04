# Development Tasks

## Milestone 0 — Repository bootstrap

- [x] Next.js + TypeScript + Tailwind初期化
- [x] ESLint設定
- [x] 環境変数サンプル
- [ ] 基本ディレクトリ作成
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
- [ ] 他ユーザーへ公開する前に、2ユーザーによるRLS分離テストを実施する

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
- [ ] 優先順位スコア
- [x] OpenAI Responses APIによる最小化Structured Advice
- [x] サーバー検証
- [x] 提案プレビュー
- [x] Planning Session保存・stale検出・明示承認/却下
- [x] AI-ready助言interface（外部providerなし）
- [x] Planning Session生成のIdempotency-Key・原子的保存・重複request排除
- [x] Planning Input Snapshot V2とtitle整合性基盤（Migration適用・動作確認済み、2026/07/31）
- [x] AI AdviceのDB原子rate limit
- [ ] AI Adviceの利用量監視
- [ ] 手動編集
- [ ] 再生成

## Milestone 5 — Calendar write

- [ ] 承認画面
- [x] V2 Migration適用・動作確認後にGoogle Calendar Event Previewを実装
- [x] Googleイベント作成
- [x] block単位の冪等性（DB状態 + 決定論的Google Event ID）
- [x] approved/rejected/superseded SessionとblockのDB不変化
- [ ] 非本番DBでBlock DELETE RPC対Approvalの真の並列transactionとauth.users CASCADE削除を実証
- [x] duration_minutesとstart/endのDB整合制約
- [x] Calendar書き込み直前の完全再検証
- [x] 部分成功を保持し失敗blockだけ再試行する方針
- [x] audit_logs
- [x] 作成済み予定のcanonical再同期・削除（個別確認、所有マーカー・ETag検証、block単位冪等性）
- [x] V2 rollout完了後、旧create_planning_session RPCを別Migrationでrevoke / drop

## Milestone 6 — Execution and review

- [ ] 完了
- [ ] スキップ
- [ ] 実績時間
- [ ] 持ち越し
- [ ] 日次レビュー
- [ ] 見積もり誤差

## Current task

承認済みV2 Planning SessionのGoogle Calendar追加・canonical再同期・削除、および旧`create_planning_session` RPCの
revoke/dropまで完了。非本番DBでの真の並列transaction実証は別タスクとして残す。
