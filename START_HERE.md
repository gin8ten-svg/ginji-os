# Ginji OS — Start Here

## 目的

自分で登録したToDo、Googleカレンダー上の固定予定、期限・優先度・必要時間を基に、
AIが毎日の実行計画を作成し、承認後にカレンダーへ反映する個人向けスケジュール管理アプリを作る。

## MVPの成功条件

1. Googleアカウントでログインできる
2. ToDoを登録・編集・完了できる
3. Googleカレンダーの予定を読み込める
4. 今日の空き時間を計算できる
5. 「今日を組む」で作業予定案を生成できる
6. ユーザーが予定案を修正・承認できる
7. 承認済み作業枠をGoogleカレンダーへ登録できる
8. 完了・未完了・実績時間を記録できる
9. 未完了タスクを翌日以降へ再配置できる

## 最初の進め方

1. このフォルダ全体をGitHubリポジトリのルートに置く
2. Codexで `prompts/01_CODEX_BOOTSTRAP.md` を実行する
3. ローカルで画面を確認する
4. Claude Codeで `prompts/02_CLAUDE_REVIEW.md` を実行する
5. レビュー結果をCodexへ渡して修正する

## 仮の技術構成

- Frontend / Backend: Next.js + TypeScript
- UI: Tailwind CSS
- Database / Auth: Supabase
- Calendar: Google Calendar API
- AI: OpenAI API
- Hosting: Vercel
- Repository: GitHub

## 開発原則

- 1機能ずつ実装する
- AIが既存の固定予定を勝手に削除・移動しない
- 外部サービスへの書き込みは原則としてユーザー承認後
- 日時は内部ではUTC、表示はAsia/Tokyo
- 機密情報をブラウザへ露出させない
- 変更前後をGitで追跡できるようにする
