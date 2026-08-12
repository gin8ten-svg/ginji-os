# Database Design

## users_profile

Supabase Authのユーザーに紐づく設定。

| Column | Type | Notes |
|---|---|---|
| user_id | uuid | PK, auth.users FK |
| display_name | text | nullable |
| timezone | text | default Asia/Tokyo |
| day_start_time | time | default 07:00 |
| day_end_time | time | default 23:00 |
| default_focus_minutes | int | default 60 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## tasks

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | indexed |
| title | text | required |
| description | text | nullable |
| status | text | inbox/planned/in_progress/completed/cancelled |
| priority | int | 1-5 |
| due_at | timestamptz | nullable |
| estimated_minutes | int | nullable |
| remaining_minutes | int | nullable |
| splittable | boolean | default true |
| minimum_block_minutes | int | default 25 |
| category_id | uuid | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| completed_at | timestamptz | nullable |

## categories

| Column | Type |
|---|---|
| id | uuid |
| user_id | uuid |
| name | text |
| created_at | timestamptz |

## routines

繰り返し設定の本体。ルーティン自体には完了状態を持たせない。

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | indexed |
| name | text | required |
| description | text | nullable |
| frequency_type | text | daily/weekdays |
| weekdays | smallint[] | 0（日）〜6（土）、曜日指定時に使用 |
| estimated_minutes | int | required |
| priority | int | 1-5 |
| category_id | uuid | nullable |
| available_start_time | time | nullable |
| available_end_time | time | nullable |
| is_active | boolean | default true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## routine_completions

ルーティンの日付ごとの実行履歴。ユーザータイムゾーン上の対象日を保存する。

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | indexed |
| routine_id | uuid | routines FK |
| target_date | date | Asia/TokyoなどユーザーTZ上の日付 |
| completed_at | timestamptz | |

`routine_id, target_date` に一意制約を付ける。ルーティン削除時の履歴削除方針を
マイグレーション時に明示し、すべての行へユーザー単位のRLSを適用する。

## calendar_connections

| Column | Type | Notes |
|---|---|---|
| user_id | uuid | PK, auth.users FK |
| granted_scopes | text[] | |
| selected_calendar_ids | text[] | |
| needs_reconnect | boolean | |
| connected_at | timestamptz | |
| updated_at | timestamptz | |

暗号化Refresh Tokenは`calendar_connections`に置かず、`calendar_connection_secrets`（`user_id`をPKとしてFK cascade）へ分離する。
`anon`/`authenticated`へは直接のtable権限を一切付与せず、`save_calendar_connection(p_encrypted_refresh_token, p_granted_scopes)`と
`get_calendar_connection_token()`のSECURITY DEFINER RPCだけを`authenticated`が実行できる。両RPCとも内部の`auth.uid()`だけで
対象行を決定し、他ユーザーのTokenへは到達できない。

## planning_sessions

| Column | Type |
|---|---|
| id | uuid |
| user_id | uuid |
| target_date | date |
| status | text |
| input_snapshot | jsonb |
| output_snapshot | jsonb |
| created_at | timestamptz |
| approved_at | timestamptz |
| idempotency_key | uuid nullable、user単位partial unique |
| input_snapshot_version | text nullable、V2はplanning-input-v2 |
| input_snapshot | jsonb nullable、server-only canonical input |

terminal status（approved/rejected/superseded）のsnapshot列とblocksは変更不能。例外的に、新しいSessionの承認RPCだけが
windowの重複するapprovedを、元のapproved_atを保持してsupersededへ遷移できる。approvedのhalf-open window重複は
DB排他制約でも禁止する。利用者はSessionを直接UPDATE・DELETEできず、status遷移だけを専用RPCで行う。
生成は `create_planning_session_v2` がcanonical snapshotとblocksを同一transactionで保存する。
V2 rollout完了後、旧 `create_planning_session` RPCは`20260803000400_drop_legacy_planning_session_rpc.sql`で
実行権限を剥奪して削除した。既存legacy行はsnapshot列をnullのまま読み取り専用で維持する。

## planning_blocks

親planning_sessionがdraftの間だけ変更可能。start/endは分境界、正区間で、`duration_minutes` は実時間差と完全一致する。

## time_blocks

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| task_id | uuid | nullable |
| routine_id | uuid | nullable |
| planning_session_id | uuid | required |
| planning_block_id | uuid | required、unique |
| start_at | timestamptz | |
| end_at | timestamptz | |
| status | text | proposed/approved/in_progress/completed/skipped |
| source | text | manual/ai/google |
| google_calendar_id | text | required |
| google_event_id | text | required、user/calendar/eventでunique |
| calendar_write_status | text | writing/succeeded/failed |
| calendar_write_attempt_token | uuid | writing中だけ保持 |
| calendar_write_lease_until | timestamptz | writing中だけ保持 |
| calendar_write_attempt_count | int | 1以上 |
| calendar_write_error_code | text | failed時だけ保持 |
| written_at | timestamptz | succeeded時だけ保持 |
| calendar_event_state | text | pending/active/deleted |
| calendar_mutation_status | text | idle/updating/deleting/update_failed/delete_failed |
| calendar_mutation_attempt_token | uuid | 更新・削除処理中だけ保持 |
| calendar_mutation_lease_until | timestamptz | 更新・削除処理中だけ保持 |
| calendar_mutation_attempt_count | int | 0以上 |
| calendar_mutation_error_code | text | 更新・削除失敗時だけ保持 |
| calendar_updated_at | timestamptz | canonical再同期成功時刻 |
| calendar_deleted_at | timestamptz | 削除成功時刻 |
| actual_minutes | int | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

`planning_block_id, planning_session_id, user_id` の複合FKでPlanning Block所有関係を固定する。1 blockは1つの
Google Calendar/Event IDだけに対応する。認証ユーザーはown SELECTのみ可能で、mutationはSession行をlockして
status/hash/revision/Calendarを再確認する `reserve_calendar_event_write` と、attempt tokenを照合して結果とauditを
同一transactionで確定する `complete_calendar_event_write` だけを使う。
作成済み予定の更新・削除は、同じ所有関係をlockする`reserve_calendar_event_mutation`と、attempt tokenを照合する
`complete_calendar_event_mutation`だけを使う。削除済みeventは追加RPCから暗黙に再作成しない。

タスクblockの完了と実績時間は`complete_planning_time_block`だけで更新する。RPCは`auth.uid()`から所有者を確定し、
approvedまたはsuperseded Session、Google Calendar書き込み成功済みの`time_blocks`、参照先taskを同一transactionでlockする。
初回完了時だけ予定block分をtaskの`remaining_minutes`から減らし、0分になったtaskを完了にする。完了済みblockの再送では
残り時間を再度減らさず、`actual_minutes`が未記録の場合だけ後から実績値を追記できる。この操作はGoogle Calendarを変更しない。
状態が変化する完了・実績記録は`time_block_completed`としてaudit_logsへ記録する。

V2 snapshot移行前に承認済みだったSession（`input_snapshot_version`が`null`）は実行Previewの取得時にsnapshotの
titleを使わず、`tasks`テーブルの現在のtitleへfallbackする。

## audit_logs

| Column | Type |
|---|---|
| id | uuid |
| user_id | uuid |
| action | text |
| entity_type | text |
| entity_id | uuid |
| before_data | jsonb |
| after_data | jsonb |
| created_at | timestamptz |

Calendar追加・更新・削除ではactionを`calendar_event_{write|update|delete}_{succeeded|failed}`、entity_typeを
`time_block`として記録する。RLS下でown SELECTだけを許可し、直接mutationは許可しない。

## ai_advice_rate_limits

AI相談の同一ユーザー並列実行をDB時刻で原子的に抑止するサーバー専用テーブル。`user_id` は
`auth.users(id)` を参照する主キーで、`reserved_at` と `updated_at` を保持する。RLSを有効にしたうえで
`anon` / `authenticated` の直接テーブル権限を剥奪し、引数なしの `reserve_ai_advice_request()` だけを
`authenticated` が実行できる。関数は内部の `auth.uid()` と単一UPSERTを使い、30秒境界を判定する。

## ai_advice_usage_events

AI Advice呼び出しの利用量監視用テーブル。`user_id`（`auth.users`参照）、`planning_session_id`（`planning_sessions`参照、
`on delete set null`）、`model`、`candidate_count`、`input_tokens`/`output_tokens`（nullable）、`success`、`error_code`
（nullable）、`created_at` を保持する。自由記述・AI出力全文・ユーザー識別子は保存しない。RLSで own SELECTだけを許可し、
`anon`/`authenticated`への直接テーブル書き込み権限は付与せず、`record_ai_advice_usage(...)`のSECURITY DEFINER RPCだけが
`authenticated`から呼び出せる。関数は`auth.uid()`で行の所有者を固定し、渡された`planning_session_id`が呼び出し本人の
Sessionでない場合はNULL化して記録を継続する（他人のSessionへは紐付けない）。成功・失敗いずれの呼び出しでも記録し、
記録自体の失敗はAI Advice機能の成否をブロックしない（ベストエフォート）。概算コストは`src/lib/planning/ai-pricing.ts`の
単価定数から算出し、実際の請求額とは一致しない。

## RLS policy principle

すべてのユーザー所有テーブル（routines、routine_completionsを含む）で、`auth.uid() = user_id` の行だけをSELECT、INSERT、UPDATE、DELETE可能にする。

暗号化Refresh Tokenは`calendar_connections`から`calendar_connection_secrets`へ分離済みで、通常のクライアントクエリでは取得できない。
