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

terminal status（approved/rejected/superseded）の行はUPDATE・DELETE不能。snapshot列はdraft中も変更せず、
status遷移だけを専用RPCで行う。生成は `create_planning_session` がblocksと同一transactionで保存する。
V2生成は互換性を保つ別RPC `create_planning_session_v2` を使用し、legacy行はsnapshot列をnullのまま維持する。

## planning_blocks

親planning_sessionがdraftの間だけ変更可能。start/endは分境界、正区間で、`duration_minutes` は実時間差と完全一致する。

## time_blocks

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| task_id | uuid | nullable |
| planning_session_id | uuid | nullable |
| start_at | timestamptz | |
| end_at | timestamptz | |
| status | text | proposed/approved/in_progress/completed/skipped |
| source | text | manual/ai/google |
| google_event_id | text | nullable |
| actual_minutes | int | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

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

## ai_advice_rate_limits

AI相談の同一ユーザー並列実行をDB時刻で原子的に抑止するサーバー専用テーブル。`user_id` は
`auth.users(id)` を参照する主キーで、`reserved_at` と `updated_at` を保持する。RLSを有効にしたうえで
`anon` / `authenticated` の直接テーブル権限を剥奪し、引数なしの `reserve_ai_advice_request()` だけを
`authenticated` が実行できる。関数は内部の `auth.uid()` と単一UPSERTを使い、30秒境界を判定する。

## RLS policy principle

すべてのユーザー所有テーブル（routines、routine_completionsを含む）で、`auth.uid() = user_id` の行だけをSELECT、INSERT、UPDATE、DELETE可能にする。

暗号化Refresh Tokenは`calendar_connections`から`calendar_connection_secrets`へ分離済みで、通常のクライアントクエリでは取得できない。
