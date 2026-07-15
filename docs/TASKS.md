# Development Tasks

## Milestone 0 — Repository bootstrap

- [x] Next.js + TypeScript + Tailwind初期化
- [x] ESLint設定
- [x] 環境変数サンプル
- [ ] 基本ディレクトリ作成
- [ ] CIでlint/typecheck/build
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
- [ ] Planning Session生成のidempotency（同一hash draft再利用・重複request排除）
- [x] AI AdviceのDB原子rate limit
- [ ] AI Adviceの利用量監視
- [ ] 手動編集
- [ ] 再生成

## Milestone 5 — Calendar write

- [ ] 承認画面
- [ ] Googleイベント作成
- [ ] 冪等性
- [ ] approved Session/blockのDB不変化と書き込み直前の完全再検証
- [ ] duration_minutesとstart/endのDB整合制約を別Migrationで検討
- [ ] 失敗時ロールバック方針
- [ ] audit_logs
- [ ] 作成済み予定の更新・削除

## Milestone 6 — Execution and review

- [ ] 完了
- [ ] スキップ
- [ ] 実績時間
- [ ] 持ち越し
- [ ] 日次レビュー
- [ ] 見積もり誤差

## Current task

Planning Session承認基盤まで。次は監査後に、承認済みSessionだけを入力にするCalendar書き込み設計。
