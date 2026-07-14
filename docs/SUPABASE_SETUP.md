# Supabase setup

対象プロジェクト: `ginji-os-dev` (`wiasmlwvodnbccsmhaeo`)

## Google OAuth（手動設定）

1. Google Cloud ConsoleでOAuth 2.0 Clientを作成する。
2. Google側の承認済みリダイレクトURIに、Supabase Dashboardの Authentication > Providers > Google に表示される callback URLを登録する。
3. Supabase Dashboardの Authentication > Providers > Google でGoogle Client ID / Client Secretを設定し、有効化する。
4. Authentication > URL ConfigurationでSite URLを `http://localhost:3000`、Redirect URLsに `http://localhost:3000/auth/callback` を追加する。本番URLもデプロイ時に追加する。
5. Googleのシークレットは `.env.local` やクライアントコードへ保存しない。

## RLS確認

1. ユーザーA/Bでログインし、それぞれタスクを1件作成する。
2. 各ユーザーから `tasks`, `routines`, `routine_completions`, `categories`, `user_profiles` をSELECTし、自分の行だけ返ることを確認する。
3. ユーザーAのセッションでユーザーBの `user_id` を指定したINSERT/UPDATE、IDを指定したUPDATE/DELETEが拒否または0件になることを確認する。
4. 未認証クライアントで全5テーブルのSELECT/INSERT/UPDATE/DELETEが許可されないことを確認する。

`service_role` やRLS無効化は確認に使用しない。日付 (`target_date`) は利用者のタイムゾーン（初期値 `Asia/Tokyo`）上の日付として送る。
