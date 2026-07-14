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

hash再計算では生成時の `input_now` を維持して決定論性を保つ。それとは独立して承認時の実時刻を検査し、
作成から24時間以上、Planning Window終了後、終了済みブロック、または開始から5分を超えたブロックを含む
Sessionは `PLAN_STALE` として承認しない。

## Authorization and API safety

- 全APIはSupabase Authのユーザーをサーバーで取得する。
- RLSと明示的な `user_id` filterを併用し、他ユーザーのIDは404として扱う。
- SessionとBlockの所有者一致は複合外部キーでも保証する。
- 全responseは `Cache-Control: private, no-store`。
- Supabase/Googleの生エラーや秘密情報を返さない。
- 承認・却下はdraft条件付きRPCで競合と二重操作を防ぐ。

## AI and Calendar boundary

外部AI providerは任意のAdvice生成だけに限定し、Google Calendar書き込みAPIは存在しない。`PlanningAdvisor` は最小化したID、順序、
集計だけを扱い、未知IDを破棄できる。AI助言だけで承認することはできず、決定論的Engineが最終検証者である。

OpenAI Adviceを利用する場合も、元のdeterministic draftは変更せず新しいdraftを作る。承認時にAIを再度
呼び出さず、保存済みのsanitize済み順序を現在所有するentityだけへ絞り、hard priority bandとEngineで
再配置して保存blocksと比較する。AI responseや説明だけでapprovedへ遷移しない。

`planning_sessions.status = approved` だけでは、将来のGoogle Calendar書き込み許可として十分ではない。
書き込みAPIは書き込み直前に、認証ユーザー、Session所有権、approved状態、現在入力、input_hash、実時刻鮮度、
Planning Engine再実行、保存blocksとのcanonical比較、対象Calendar、ユーザーの最終確認をすべて再検証する。
approvedだけを条件にGoogle APIを呼ばず、現在のapprove RPCを単独の権限境界として利用しない。

書き込みは別の冪等APIとし、部分成功、再試行、重複防止を監査記録へ残す。現在はwrite scope、Google Event ID、
書き込み用tableを追加しない。

## Deferred hardening

- Session生成のIdempotency-Key、同一hash draft再利用、生成中request重複排除
- `duration_minutes` とstart/endのDB整合制約（既存データ互換性を確認した別Migration）
- approved SessionとblocksをDBレベルで変更不能にするpolicyまたは狭いcapability
