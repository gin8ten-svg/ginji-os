# Planning Approval

## Lifecycle

サーバーは認証ユーザーの現在データだけを取得し、決定論的Planning Engineを実行して `draft` を保存する。
ユーザーは下書きを明示的に `approved` または `rejected` にできる。別の下書きを承認すると、残る下書きは
原子的なDB関数内で `superseded` になる。承認済み計画を暗黙に変更しない。

未ログイン時は同じEngineを端末内で利用できるが、Planning SessionをSupabaseへ保存しない。Local承認は
その画面・端末だけの確認状態であり、Cloud Sessionとは別物である。

## Generation and stale detection

`POST /api/planning/sessions` はrequest bodyのuser_id、Task、Routine、Calendar event、blockを受け取らない。
サーバーがTask、Routine、対象期間の完了履歴、選択Calendarの予定を取得し、下書きとブロックを保存する。

入力hashはPlanning Window、基準時刻、計画関連Task/Routineフィールド、Routine Completion、正規化して
mergeしたGoogle busy区間、Engine versionのcanonical JSONをSHA-256にする。Googleの件名、説明、参加者、
Tokenは含めない。承認時に同じ入力を取得してhashとEngine出力を再検証し、差があれば `PLAN_STALE` として
承認しない。

## Authorization and API safety

- 全APIはSupabase Authのユーザーをサーバーで取得する。
- RLSと明示的な `user_id` filterを併用し、他ユーザーのIDは404として扱う。
- SessionとBlockの所有者一致は複合外部キーでも保証する。
- 全responseは `Cache-Control: private, no-store`。
- Supabase/Googleの生エラーや秘密情報を返さない。
- 承認・却下はdraft条件付きRPCで競合と二重操作を防ぐ。

## AI and Calendar boundary

現在は外部AI providerもGoogle Calendar書き込みAPIも存在しない。`PlanningAdvisor` は最小化したID、順序、
集計だけを扱い、未知IDを破棄できる。AI助言だけで承認することはできず、決定論的Engineが最終検証者である。

将来のCalendar書き込みAPIは、認証ユーザーが所有する `approved` Sessionだけを受け付け、再検証、冪等性、
監査記録を別途設計してから追加する。
