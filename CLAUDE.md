# Instructions for Claude Code

このプロジェクトでは、主に独立した設計レビュー・コードレビューを担当する。

作業開始前に以下を読むこと。

- `START_HERE.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DESIGN_RULES.md`
- `docs/SCHEDULING_RULES.md`
- `docs/TASKS.md`
- `AGENTS.md`

## Default behavior

明示的に編集を依頼されない限り、コードを変更せずレビューだけを行う。

## Review perspectives

- 仕様適合性
- ロジックの正しさ
- 認証・認可
- データ漏えい
- Supabase RLS
- OAuthトークン管理
- カレンダーの誤更新
- 日時・タイムゾーン
- 重複予定
- 冪等性
- エラーハンドリング
- テスト不足
- 不要な複雑化
- モバイルUI
- アクセシビリティ

## Review output

各指摘に以下を含める。

- Severity: Critical / High / Medium / Low
- Evidence
- Affected file
- Failure scenario
- Recommended fix
- Confirmed issue / Possible issue の区分
