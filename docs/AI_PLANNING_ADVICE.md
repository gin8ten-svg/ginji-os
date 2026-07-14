# AI Planning Advice

## Role and boundary

AIはTaskとRoutineの推奨順序、短い理由、全体方針、注意事項だけを返す。start/endの決定、所有権判定、
Task/Routine変更、Session承認、Google Calendar操作は行わない。時刻配置と全hard constraintは既存の
決定論的Planning Engineが担当する。

## Minimized input

providerへ送るのは不透明な `task_N` / `routine_N` alias、優先度、期限までの分数、所要・残り時間、分割条件、
時間帯制約、決定論的rank、未配置reason code、日別busy/free集計だけである。aliasと実IDの対応はサーバー
メモリ内だけに置く。タイトル、説明、メモ、user_id、メール、Calendar/Event ID、Google予定タイトル、Token、
Session UUID、promptとなり得る自由記述を送らない。

## Provider and structured output

公式OpenAI Node SDKのResponses APIをserver-only層から1回だけ呼ぶ。既定モデルは環境変数で変更可能な
`gpt-5.6-luna`。Structured Outputのstrict JSON Schemaを使い、tools、会話履歴、background mode、
自動retryを使用しない。出力tokenとtimeoutを制限する。利用にはOpenAI APIのコストが発生する。

出力はalias順序、alias別説明、全体要約、最大5件の警告だけである。サーバーで型、未知alias、重複、欠落、
文字数、制御文字、HTML、URLを再検証する。不正responseは保存せず安全な構造化エラーに変換する。

## Safe ordering and approval

期限超過、今日、明日、狭いRoutine、7日以内、柔軟Routine、7日より先、期限なしのhard priority bandを使う。
AIが変更できるのは同じband内だけで、期限や狭いRoutineを後回しにできない。AI順序を適用後にEngineを再実行し、
新しいdraft Sessionとして保存する。元Sessionは変更しない。

承認時はAIを再度呼ばない。現在入力とhash・鮮度・所有entityを再取得し、保存された安全な順序を再sanitizeして
Engineを再実行し、blocksのcanonical一致を確認してから既存RPCを使う。Adviceだけでは承認できない。

## Failure and rate limiting

APIキー未設定、timeout、rate limit、provider failure、invalid responseでも元のdeterministic planを維持する。
同一ユーザーのAI draft作成後30秒は再実行を拒否し、入力は100 entityまでとする。将来は共有ストアによる分散
rate limit、利用量監視、request idempotencyを追加する。

`OPENAI_API_KEY` と `OPENAI_PLANNING_MODEL` はserver-onlyで、`NEXT_PUBLIC_` を付けない。キー、prompt全文、
生response、内部reasoningをログ・DB・クライアントへ出さない。Google Calendar書き込みは実装しない。
