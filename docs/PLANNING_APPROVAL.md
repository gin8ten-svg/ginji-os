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
Cloud生成では操作ごとのUUIDを `Idempotency-Key` headerへ必須とし、同じ通信のretryでは同じkeyを使う。
明示的な再計算では新しいkeyを使う。DBのuser単位partial unique indexと原子的な保存RPCにより、同時POSTでも
Sessionとblocksは1組だけ保存される。keyはレスポンス、ログ、Google、OpenAIへ渡さない。AI draftはkeyを複製せずnullにする。

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

## Immutable snapshots

Session生成RPCはSessionとblocksを単一transactionで保存する。Session snapshotの入力hash、Engine version、期間、
基準時刻、summary、warning、作成日時、idempotency keyは生成後に変更できない。`draft` から許可するstatus遷移は
`approved`、`rejected`、`superseded` だけで、terminal SessionはUPDATEできず、authenticated利用者は直接DELETEできない。承認・却下時刻はDB時刻で確定する。

planning_blocksは親Sessionがdraftの間だけINSERT・UPDATEできる。terminal親のblock追加、削除、時刻、参照先、
順序、duration、metadata変更はRLSとtriggerの両方で拒否する。start/endは秒・ミリ秒を含まない分境界とし、
`duration_minutes = extract(epoch from (end_at - start_at)) / 60` の完全一致をDB constraintで保証する。丸め補正はしない。

各block変更は親の `blocks_revision` を単調増加させる。Block DELETEは副作用のないRLS述語では扱わず、
authenticatedのtable直接DELETEを禁止したうえで `delete_planning_block(uuid)` RPCだけを正規経路とする。
RPCはBlock行、親Session行の順にロックし、revision増加と1件のDELETEを単一transactionで実行する。
削除失敗時はtransaction全体をrollbackし、terminal親や他ユーザー・存在しないBlockは同じ `NOT_DELETED` を返す。

承認処理は検証時revisionをDBへ渡し、親行を
`SELECT ... FOR UPDATE`でロックしてhash・status・revisionがすべて一致する場合だけapprovedへ遷移する。
block変更と承認のどちらが先でも、未検証blockを含むapproved状態は成立しない。revisionは内部値でAPIへ返さない。
Session/blockのDELETE triggerは設けず、RLS policyにも副作用関数を置かないため、正式なアカウント削除時の
`auth.users → planning_sessions → planning_blocks` FK CASCADEを阻害しない。

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

## Deferred verification

- 一般公開前にローカルSupabaseまたは隔離環境で2ユーザーRLS分離と真の並列POSTを実証する。
- 非本番DBでblock変更とApprovalの同時transaction、およびterminal Sessionを持つアカウントのCASCADE削除を実証する。
- 非本番DBでBlock DELETE RPCとApprovalの真の並列transactionを実証する。
