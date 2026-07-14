# Claude Code prompt — Review only

このリポジトリの以下を読んでください。

- START_HERE.md
- CLAUDE.md
- AGENTS.md
- docs/PRODUCT.md
- docs/ARCHITECTURE.md
- docs/DATABASE.md
- docs/DESIGN_RULES.md
- docs/SCHEDULING_RULES.md
- docs/TASKS.md

Codexが作成したUIプロトタイプをレビューしてください。

現時点ではコードを変更しないでください。

## Review scope

- MVP要件への適合
- 画面導線
- スマートフォン表示
- コンポーネント構成
- TypeScript
- 状態管理
- アクセシビリティ
- ダミーデータの分離
- 将来Supabaseへ置換しやすいか
- 不要な複雑化
- lint/typecheck/buildの不足
- 明らかなバグ

## Output

最初に総合評価を記載してください。

各指摘を次の形式で出してください。

- Severity:
- Confirmed / Possible:
- File:
- Evidence:
- Failure scenario:
- Recommended fix:

最後に以下を記載してください。

- 今すぐ直すべき項目
- 後回しでよい項目
- 次のMilestoneへ進めるか
