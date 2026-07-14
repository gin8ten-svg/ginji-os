# Scheduling Rules

## 1. Hard constraints

必ず守る。

- 固定予定と重複させない
- ユーザーの稼働時間外に配置しない
- 開始時刻は終了時刻より前
- 同一タスクの時間ブロックを重複させない
- 分割不可タスクは連続した十分な長さの枠へ置く
- ユーザーがロックした予定を移動しない
- 過去の時間へ配置しない
- 外部カレンダーへの書き込みは承認後のみ

## 2. Soft constraints

可能な限り守る。

- 締切が近いものを優先
- 優先度が高いものを優先
- 集中力が必要な作業は早い時間帯
- 長時間作業には休憩を挟む
- カテゴリー切替を減らす
- 細切れの空き時間には短いタスク
- 1日の作業量を過剰にしない

## 3. Initial scoring idea

各タスクに仮スコアを付ける。

```text
score =
  priority_weight
  + urgency_weight
  + overdue_weight
  + goal_weight
  - fragmentation_penalty
  - context_switch_penalty
```

AIだけで順位を決めず、数値スコアを基礎に説明・微調整させる。

## 4. Planner output schema

```json
{
  "target_date": "2026-07-15",
  "timezone": "Asia/Tokyo",
  "summary": "締切の近い課題と民泊業務を優先した計画",
  "blocks": [
    {
      "task_id": "uuid",
      "start_at": "2026-07-15T09:00:00+09:00",
      "end_at": "2026-07-15T10:00:00+09:00",
      "reason": "締切が近く、60分の連続枠が必要"
    }
  ],
  "unscheduled": [
    {
      "task_id": "uuid",
      "reason": "利用可能時間が不足"
    }
  ],
  "warnings": []
}
```

## 5. Server validation after AI output

- task_idがユーザー所有か
- start/endが有効か
- 空き時間内か
- 固定予定と重複していないか
- 合計時間がremaining_minutesを不当に超えていないか
- 指定日の範囲内か
- 重複ブロックがないか

不正な場合、カレンダーへ書き込まず再生成またはエラー表示する。

## 6. Deterministic planning baseline

- 対象期間はAsia/Tokyoの今日から7日間、稼働時間は08:00〜22:00
- 25分未満の空き枠は使用しない
- Google予定の重複・隣接区間を統合し、終日予定は`[start, end)`で扱う
- Routineを曜日と利用可能時間の範囲へ先に置く
- Taskは期限超過、期限、優先度、残り時間、作成日時、IDの順で安定ソートする
- 期限内のTaskは期限後へ配置しない。すでに期限超過したTaskは期間先頭から早急に配置する
- 分割ブロックは`minimumBlockMinutes`以上とし、分割不可Taskは単一連続枠だけを使う
- 同一入力は同一結果を返し、この段階ではAI APIとCalendar書き込みを使用しない
