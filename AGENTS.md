# Instructions for Codex

作業開始前に必ず以下を読むこと。

- `START_HERE.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DESIGN_RULES.md`
- `docs/SCHEDULING_RULES.md`
- `docs/TASKS.md`

## Working rules

1. 依頼された範囲外の機能を勝手に追加しない。
2. 関係のないファイルを変更しない。
3. 既存機能を削除・置換する場合は、理由を明示する。
4. 外部サービスへの書き込みは明示的な承認フローを前提にする。
5. APIキー、OAuthシークレット、サービスロールキーをクライアントへ露出させない。
6. TypeScriptの型を優先し、安易な `any` を使わない。
7. 日時処理ではタイムゾーンを明示する。
8. 実装後に可能な範囲で lint、typecheck、test、build を実行する。
9. 作業完了時に以下を報告する。
   - 実装内容
   - 変更ファイル
   - 実行した検証
   - 未解決事項
   - 手動確認手順

## Preferred workflow

- まずコードベースを調査
- 実装計画を提示
- 小さな単位で実装
- 検証
- 差分要約
