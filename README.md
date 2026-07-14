# Ginji OS

ToDoとカレンダーを統合し、AIが毎日の実行計画を作成する個人向けスケジュール管理アプリ。

## Status

1ユーザー向け実用MVP。Googleログイン、クラウド保存、Today、Tasks、Routines、Calendar、Reviewを利用できます。

## Documents

- `START_HERE.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DESIGN_RULES.md`
- `docs/TASKS.md`
- `docs/SCHEDULING_RULES.md`
- `docs/PLANNING_APPROVAL.md`

Planning Engineの案は、ログイン時に下書きとして保存し、最新入力による再検証後に明示承認できます。承認は確認状態の保存だけで、Google Calendarへの書き込みや外部AI呼び出しは行いません。

## AI Instructions

- Codex: `AGENTS.md`
- Claude Code: `CLAUDE.md`

## Initial prompts

- `prompts/01_CODEX_BOOTSTRAP.md`
- `prompts/02_CLAUDE_REVIEW.md`
- `prompts/03_CODEX_FIX_REVIEW.md`

## Run locally

1. Install Node.js 24 LTS and npm.
2. Run `npm install`.
3. Start the prototype with `npm run dev`.
4. Open `http://localhost:3000`.
