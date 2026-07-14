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
`calendar.events.readonly` と `calendar.calendarlist.readonly` を要求する。Google API呼び出しは
Route Handlerに限定し、Access Tokenは永続化しない。Refresh TokenはAES-256-GCMで暗号化して
`calendar_connections` に保存する。外部イベントはDBへ複製せず、クライアントの一時状態だけで扱う。

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
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `CALENDAR_TOKEN_ENCRYPTION_KEY`
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
