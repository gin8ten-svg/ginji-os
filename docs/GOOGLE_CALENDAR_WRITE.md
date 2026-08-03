# Google Calendar write

## Scope

`POST /api/planning/sessions/:id/write-to-calendar` は、承認済みのV2 Planning Sessionを、ユーザーが明示確認した
1つのGoogle Calendarへblock単位で追加する。request bodyは `{ "calendarId": "..." }` だけを受け付け、title、時刻、
block、user IDは受け付けない。作成済み予定の更新・削除とlegacy Sessionは対象外である。

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

## Partial failure policy

全体rollbackはしない。成功したGoogle予定を削除せず`succeeded`として残し、provider失敗blockは`failed`にして後続blockを
継続する。認証失効・scope不足の場合はそのblockを失敗確定し、残りを`not_attempted`として停止する。再試行では
`succeeded`を送らず、`failed`とlease切れだけを処理する。別requestで処理中のblockは`in_progress`として返す。

Google作成成功後、DB確定前にprocessが停止した場合は`writing` leaseが切れた後に再試行する。同じ決定論的Event IDへの
作成は409になり、既存予定の完全一致確認後にDBを`succeeded`へ収束させる。Google側の成功予定を自動削除しない。

## Deployment and manual verification

アプリをdeployする前にMigrationを対象DBへ適用する。既存のread-only接続は追加scopeを持たないため、Calendar画面から
再接続し、予定追加権限を明示同意する。

1. 未来時刻を持つV2 Sessionを作成・承認し、Previewで書き込み可能なCalendarを選ぶ。
2. 確認dialogから追加し、Google Calendarの件数、title、start/endと`time_blocks`の`succeeded`を確認する。
3. 同じPOSTを再実行してGoogle側の件数が増えず、レスポンスが`already_created`になることを確認する。
4. 1件をprovider失敗させ、成功分が残り、失敗auditが作られ、そのblockだけ再試行できることを確認する。
5. 他ユーザーSession、legacy、superseded、stale hash、過去block、未選択またはreader Calendar、旧scope接続を拒否することを確認する。

このリポジトリ作業ではMigration適用と実Googleへの書き込みは行わない。非本番DBでの真の並列transaction検証も別途行う。
