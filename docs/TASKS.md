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

## Milestone 3 — Calendar read

- [ ] Google OAuthスコープ設計
- [ ] 接続状態画面
- [ ] 対象日の予定取得
- [ ] 終日予定処理
- [ ] 空き時間計算
- [ ] タイムゾーンテスト

## Milestone 4 — Planner proposal

- [ ] 制約エンジン
- [ ] 優先順位スコア
- [ ] OpenAI構造化出力
- [ ] サーバー検証
- [ ] 提案プレビュー
- [ ] 手動編集
- [ ] 再生成

## Milestone 5 — Calendar write

- [ ] 承認画面
- [ ] Googleイベント作成
- [ ] 冪等性
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

Milestone 2のSupabase基盤まで。Google OAuth ProviderのClient ID / Secret設定は手動で行う。
