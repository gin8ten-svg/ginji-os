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

### AI planning

OpenAI API。
モデルには自由形式の予定を書かせず、定義済みスキーマに従う計画案を返させる。

## 2. Data flow

1. ユーザーがGoogleでログイン
2. ToDoを登録
3. サーバーが対象日のカレンダー予定を取得
4. サーバーが空き時間を決定
5. 制約エンジンが配置可能枠を作成
6. AIが優先順位・分割案を返す
7. サーバーが重複、期限、所要時間を再検証
8. ユーザーへプレビュー表示
9. ユーザー承認後にGoogleカレンダーへ書き込み
10. 書き込み結果と監査履歴を保存

## 3. Safety boundaries

AIに直接Google APIの資格情報を渡さない。
AIは計画案を返すだけで、実際の予定作成はサーバーが検証後に実施する。

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
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_APP_URL`

OpenAI APIキー、Googleクライアントシークレットはサーバー専用。現在のSupabase基盤はservice roleキーを使用しない。

## 6. Deployment

- Application: Vercel
- Database/Auth: Supabase
- Source: GitHub
- Preview deployments: Pull Request単位

## 7. Proposed directory

```text
app/
  (auth)/
  today/
  tasks/
  calendar/
  planner/
  review/
  api/
components/
  ui/
  tasks/
  calendar/
  planner/
lib/
  auth/
  db/
  calendar/
  planner/
  validation/
types/
supabase/
  migrations/
tests/
docs/
```
