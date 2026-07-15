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
- `docs/AI_PLANNING_ADVICE.md`

Planning Engineの案は下書きとして保存し、最新入力による再検証後に明示承認できます。任意のAI Adviceは優先順位と理由だけを提案し、時刻配置と安全性は決定論的Engineが再検証します。承認してもGoogle Calendarへは書き込みません。

Cloud計画生成は `Idempotency-Key` でretry時の二重保存を防ぎます。承認・却下・更新済みSessionとそのblocksは
監査snapshotとしてDBレベルで変更不能です。再計算は既存の承認済みSessionを変更せず、新しいdraftを作成します。

Server-onlyのAI設定:

- `OPENAI_API_KEY`
- `OPENAI_PLANNING_MODEL`（既定: `gpt-5.6-luna`）

APIキー未設定でも通常のPlanning Engineと承認フローは利用できます。

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
