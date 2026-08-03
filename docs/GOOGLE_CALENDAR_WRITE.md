# Google Calendar write

## Scope

`POST /api/planning/sessions/:id/write-to-calendar` は、承認済みのV2 Planning Sessionを、ユーザーが明示確認した
1つのGoogle Calendarへblock単位で追加する。request bodyは `{ "calendarId": "..." }` だけを受け付け、title、時刻、
block、user IDは受け付けない。legacy Sessionは対象外である。

同じURLの`PATCH`は、この機能が作成した予定を保存snapshotのcanonical title・start・endへ再同期する。`DELETE`は
この機能が作成した予定を削除する。どちらもbodyからtitle、時刻、Calendar ID、Event IDを受け取らず、DBに保存した
対応だけを対象に別の明示確認dialogから実行する。任意編集、新旧Planning Session間の自動対応付け、Ginji OS以外が
作成した予定の変更・削除は対象外とする。
同じURLの`GET`は、通常Previewがstaleを拒否した場合にも削除対象を確認できる読み取り専用管理Previewであり、保存snapshotの
canonical表示とDB lifecycleだけを返す。stale時は再同期を許可せず、削除だけを確認可能にする。

## Write-time validation

Previewのレスポンスは書き込み入力として再利用しない。POSTごとにサーバーが次を再実行する。

1. 認証ユーザーの所有するSessionとblocksだけを取得する。
2. Sessionが`approved`かつ`planning-input-v2`であること、保存snapshotと保存hashの自己整合性を確認する。
3. 現在のTask、Routine、完了履歴、Google busy入力からcanonical snapshot/hashを再生成して保存hashと比較する。
4. `deterministic-v2`を再実行し、保存blocksとcanonical比較する。
5. 実時刻でSession、window、各blockのfreshnessを確認する。
6. Sessionの`status`と`blocks_revision`を再取得する。
7. Calendar接続、`calendar.events` scope、計画時に選択したCalendar ID、Calendar Listの`accessRole`が書き込み可能かを確認する。
8. 各blockのGoogle API呼び出し直前に予約RPCがSession行をlockし、所有権、`approved`、input hash、
   `blocks_revision`、block所属、Session内の対象Calendar統一を再確認する。

既にこの機能が作成したGoogle予定はcurrent busy入力にも現れるため、再試行時だけ、DBに保存したCalendar ID・Event ID・
start/endがすべて一致する予定をhash再生成前のbusy入力から除外する。これにより成功済みblock自身でSessionをstaleにせず、
他の予定変更は引き続きstaleとして拒否する。表示・送信titleは保存snapshotのcanonical titleだけを使う。

## Idempotency and state

Migration `20260803000100_google_calendar_write.sql` が `time_blocks` と `audit_logs` を追加する。1 planning blockにつき
`time_blocks`は1行だけで、`google_calendar_id`、`google_event_id`、`calendar_write_status`、attempt token、2分のlease、
attempt count、error code、`written_at`を保持する。Session内で一度書き込みを開始した後は対象Calendarを変更できない。

Google Event IDはuser ID、Session ID、planning block IDからSHA-256で決定論的に生成する。予約RPCはSession行とblock行を
lockし、成功済みなら`ALREADY_SUCCEEDED`、有効lease中なら`IN_PROGRESS`を返す。失敗済みまたはlease切れだけが新しい
attempt tokenで再予約できる。Googleが409を返した場合は同じIDの予定をGETし、ID、private write key、canonical title、
start/end、非cancelled状態が一致した場合だけ成功済みとして回収する。

状態遷移は次のとおり。

```text
未作成 ──reserve──> writing ──Google成功──> succeeded
                         └──Google失敗──> failed ──retry──> writing
                         └──lease切れ────────retry──> writing
```

`complete_calendar_event_write` はattempt tokenが一致する`writing`行だけを確定し、同じDB transaction内で成功または失敗の
`audit_logs`を作る。`time_blocks`と`audit_logs`はRLSを有効にし、認証ユーザーにはown SELECTだけを許可する。直接の
INSERT/UPDATE/DELETEは禁止し、user ID引数を持たないSECURITY DEFINER RPCが内部の`auth.uid()`だけを使う。

Migration `20260803000300_google_calendar_event_management.sql` は`calendar_event_state`と更新・削除専用のattempt token、
2分lease、attempt count、error、updated/deleted時刻を追加する。`reserve_calendar_event_mutation`はSession、block、
time_blockをこの順にlockし、操作種別、所有権、保存hash/revision、作成成功済みeventとの対応を再確認する。
`complete_calendar_event_mutation`はtokenが一致する操作だけを確定し、更新・削除の成功・失敗auditを同じtransactionで残す。

## Update and delete safety

更新は現在も`approved`でfreshなV2 Sessionだけを対象に、追加時と同じsnapshot・現在hash・Engine・保存blocks・Calendar権限の
完全再検証を行う。再同期対象自身の時刻driftだけはDBのCalendar/Event IDでbusy入力から除外し、それ以外の予定変更はstaleとする。
Google APIの直前にeventをGETし、DBの決定論的Event IDとprivate `ginjiEventId`が一致することを確認する。
一致したeventだけを保存snapshotのcanonical内容へ`If-Match`付きPATCHで再同期する。すでに一致する場合は送信しない。

削除はstale化や新しい承認による`superseded`後の清掃にも必要なため、現在入力hashと実時刻freshnessは権限条件にしない。
代わりに、保存snapshot自身のhash、immutable block、DBのCalendar/Event対応、認証・所有権、Calendar書き込み権限、Google上の
private所有マーカーと最新ETagを直前に検証する。Googleの404/410は削除済みとして冪等成功に収束させる。ETag競合、所有マーカー
不一致、対象不明はGoogleへ変更を送らず失敗auditにする。削除済みeventを追加APIが暗黙に再作成することはない。

## Partial failure policy

全体rollbackはしない。成功したGoogle予定を削除せず`succeeded`として残し、provider失敗blockは`failed`にして後続blockを
継続する。認証失効・scope不足の場合はそのblockを失敗確定し、残りを`not_attempted`として停止する。再試行では
`succeeded`を送らず、`failed`とlease切れだけを処理する。別requestで処理中のblockは`in_progress`として返す。

Google作成成功後、DB確定前にprocessが停止した場合は`writing` leaseが切れた後に再試行する。同じ決定論的Event IDへの
作成は409になり、既存予定の完全一致確認後にDBを`succeeded`へ収束させる。Google側の成功予定を自動削除しない。

更新・削除もblock単位のleaseで処理し、部分成功を保持して失敗分だけを再試行する。削除のGoogle成功後にDB確定前で停止した
場合は、再試行時の404/410を成功としてDBを`deleted`へ収束させる。更新はGETでcanonical一致を確認できれば再送せず成功へ
収束する。

## Deployment and manual verification

アプリをdeployする前にMigrationを対象DBへ適用する。既存のread-only接続は追加scopeを持たないため、Calendar画面から
再接続し、予定追加権限を明示同意する。

1. 未来時刻を持つV2 Sessionを作成・承認し、Previewで書き込み可能なCalendarを選ぶ。
2. 確認dialogから追加し、Google Calendarの件数、title、start/endと`time_blocks`の`succeeded`を確認する。
3. 同じPOSTを再実行してGoogle側の件数が増えず、レスポンスが`already_created`になることを確認する。
4. 1件をprovider失敗させ、成功分が残り、失敗auditが作られ、そのblockだけ再試行できることを確認する。
5. 他ユーザーSession、legacy、superseded、stale hash、過去block、未選択またはreader Calendar、旧scope接続を拒否することを確認する。
6. Google側で作成済みeventのtitleまたは時刻を変更し、再同期の確認後にcanonical内容へ戻ることを確認する。
7. 削除確認をキャンセルした場合は残り、確認後はGoogleと`time_blocks.calendar_event_state`が`deleted`になることを確認する。
8. 同じDELETEを再実行して削除済み状態が冪等成功となり、他eventを削除しないことを確認する。

非本番DBでの真の並列transaction検証は別途行う。
