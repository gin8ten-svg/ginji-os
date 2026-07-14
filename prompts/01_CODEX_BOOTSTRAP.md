# Codex prompt — Initial bootstrap

このリポジトリの以下を最初に読んでください。

- START_HERE.md
- AGENTS.md
- docs/PRODUCT.md
- docs/ARCHITECTURE.md
- docs/DATABASE.md
- docs/DESIGN_RULES.md
- docs/SCHEDULING_RULES.md
- docs/TASKS.md

## Goal

Next.js、TypeScript、Tailwind CSSを使い、Ginji OSのモバイル優先UIプロトタイプを作成してください。
今回は外部API、Supabase、OpenAI、Google Calendarには接続しません。ダミーデータだけを使用します。

## Required screens

1. `/today`
   - 現在の作業
   - 次の予定
   - 今日の進捗
   - 今日のタイムライン
   - 「今日を組む」
   - 「今から組み直す」

2. `/tasks`
   - Inbox / Today / Upcoming / Overdue / Completed
   - タスク一覧
   - タスク新規作成
   - 完了切替
   - 編集と削除

3. `/calendar`
   - 1日表示の仮UI
   - 固定予定とAI作業枠を視覚的に区別
   - 空き時間を確認可能

4. `/review`
   - 計画時間
   - 実績時間
   - 完了率
   - 持ち越し
   - カテゴリー別の簡易表示

## Shared UI

- モバイル下部ナビゲーション
- デスクトップでも崩れない
- ローディング、空状態、エラー状態のコンポーネント
- 色だけに依存しない状態表現
- ダミーデータを1か所で管理

## Constraints

- 関係のない機能を追加しない
- バックエンド接続はしない
- APIキーを要求しない
- TypeScriptで実装
- 安易なanyを避ける
- 可能な限りServer Componentを基本とし、操作が必要な箇所だけClient Componentにする
- 外部UIライブラリの追加は必要最小限
- READMEに起動方法を追記

## Process

1. 現在のリポジトリ状態を調査
2. 実装計画と変更予定ファイルを提示
3. 実装
4. lint、typecheck、buildを実行
5. 結果を報告

## Completion report

- 実装概要
- 変更ファイル
- 実行コマンドと結果
- 手動確認方法
- 未解決事項
