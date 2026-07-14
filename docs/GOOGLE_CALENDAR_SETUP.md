# Google Calendar read-only setup

この機能はGoogle Calendarを読み取るだけです。予定の作成・更新・削除は行いません。

## Google Cloud

1. 既存のGoogle OAuthプロジェクトでGoogle Calendar APIを有効にする。
2. OAuth同意画面へ次のスコープを追加する。
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
3. アプリがTestingの場合は利用するGoogleアカウントをTest usersへ追加する。
4. 既存OAuth Web clientのAuthorized redirect URIに、Supabase Auth callback
   `https://wiasmlwvodnbccsmhaeo.supabase.co/auth/v1/callback` が登録済みであることを確認する。

Calendar権限は通常ログインでは要求されません。Calendar画面の「Google Calendarを接続」から追加同意します。

## Supabase Auth URL Configuration

本番の `https://ginji-os.vercel.app/auth/callback` をRedirect URLsへ登録します。
Preview環境を確認する場合は、管理されたVercel Preview URLだけを追加してください。無制限な外部URLは登録しません。

## Server environment variables

VercelのProduction、Preview、Developmentへ次の名前を登録します。値をクライアント公開変数にしないでください。

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `CALENDAR_TOKEN_ENCRYPTION_KEY`

暗号鍵は32 byteのランダム値をBase64化したものを使用します。例としてローカル端末で
`openssl rand -base64 32` を実行し、秘密値として安全に登録します。既存接続がある状態で暗号鍵を
変更すると復号できなくなるため、ローテーション時はversion移行を先に実装してください。

設定後に再デプロイし、Calendar画面から接続します。Refresh Tokenが返らない場合はGoogleアカウントの
接続許可を確認したうえで「再接続」を実行してください。
