# Design Rules

## Direction

スマートフォンで、一日の状態を数秒で理解できることを優先する。

## Navigation

下部タブ:

- Today
- Tasks
- Calendar
- Review

PlannerはToday画面の主要アクションから開く。

## Today hierarchy

1. 現在の作業
2. 次の予定
3. 今日の進捗
4. 残りのタイムライン
5. 再計画

## Interaction rules

- 主要ボタンは親指で押しやすい位置
- 完了は1タップ
- 延期は2タップ以内
- 削除は確認を出す
- AI反映前に変更内容を見せる
- エラーは原因と次の行動を表示する

## Copy

曖昧な表現を避ける。

良い例:
- 「この3件をGoogleカレンダーに追加」
- 「未完了の60分を明日へ移動」

悪い例:
- 「最適化する」
- 「いい感じに反映」

## Accessibility

- 色だけで状態を区別しない
- ボタンにテキストまたはaria-labelを付ける
- 十分なタップ領域
- キーボード操作を妨げない
