# Claude Code 作業レポート（本番復旧・検証セッション）

作業日: 2026-08-18（このリポジトリの currentDate）
作業内容: 実装ではなく「本番環境の障害調査・復旧」と「実データによるEnd-to-Endフロー確認」
このレポートはCodexへの引き継ぎ用です。

---

## 1. 作業開始時の状態

- `git status` はクリーン、ブランチは `feature/task-actual-time`（最新コミット `240d980`）。
- ただし本番（`https://ginji-os.vercel.app`）は**完全に機能停止**していた。原因はセッション開始時点では不明。

## 2. 発見した問題と対応（時系列）

### 2.1 Supabaseプロジェクトの自動一時停止
- `ginji-os-dev`（Supabase project ref `wiasmlwvodnbccsmhaeo`）が無操作により一時停止しており、DNSすら解決しない状態（`NXDOMAIN`）だった。
- Supabaseダッシュボードから "Resume project" を実行し復元。データはバックアップから復元され、データ損失はなし。
- **Free tierのため、今後も約1週間操作がないと再度一時停止する。** オーナーは個人利用のみを想定しており「不便がなければ大掛かりな対策は不要」との方針（2026-08-18確認）。Pro化や自動ping等の恒久対策は現時点では不要という判断。次回発生時も本セクションと同じ手順（ダッシュボード→Resume）で数分で復旧できる。

### 2.2 Google Calendar接続のrefresh token失効
- Calendar画面で「Google Calendarへの再接続が必要です」が発生。実装コード（`src/lib/calendar/google-api.ts`）を確認したところ`invalid_grant`エラーで、実際のトークン無効化が原因（UIの`connection.needsReconnect`フラグとは別経路のエラー）。
- 最終接続日時が2026/08/03だったこと、`docs/GOOGLE_CALENDAR_SETUP.md`に「アプリがTestingの場合は利用するGoogleアカウントをTest usersへ追加する」との記載があることから、**Google OAuth consent screenがTesting公開状態のままで、refresh tokenが7日で失効した可能性が高い**（未検証の推測）。
- 「接続解除」→「Google Calendarを接続」で再度OAuth同意フローを通し復旧。以降は追加権限ありで正常動作を確認。
- **恒久対策の余地**: OAuth consent screenを本番公開（Google審査）にすれば7日失効は解消するはずだが、オーナーの意向（2.1と同様、個人利用なら不便がなければ良い）を踏まえ、今回は対応していない。Codex側で必要と判断すれば検討してよい。

### 2.3 本番`main`ブランチが3週間停滞・未デプロイ
- 本番デプロイ元の`main`は2026/08/04時点（PR #6マージ）で止まっており、`feature/task-actual-time`上の以下4コミット（Milestone 5後半〜6、統合テスト）が未マージ・未デプロイだった。
  - `cbaf79d` feat: complete planning time blocks, record actual minutes, and show weekly review
  - `1526a03` docs: add CLAUDE_WORK_REPORT.md for autonomous session on 2026-08-05
  - `3fd4244` feat: add skip/carry-over, daily review, estimation accuracy, and integration tests
  - `240d980` fix: run integration tests against real local Supabase and fix bugs they caught
- これにより、本番Review画面で「日次振り返り」「週次予定/実績時間」「見積もり誤差」「AI利用状況」の4セクション用APIルート（`/api/planning/review*`, `/api/planning/ai-usage`）自体が本番に存在せず404していた。
- **対応**: `feature/task-actual-time`をpushし、PR #7（https://github.com/gin8ten-svg/ginji-os/pull/7 ）を作成。CI（validate: lint/typecheck/test/build相当）が全パスしたことを確認し、`main`へマージ。Vercel本番デプロイも自動で完了（"Deployment has completed"を確認）。

### 2.4 本番Supabaseへのmigration未適用
- PR #7マージ後も「日次振り返り」「AI利用状況」がAPI 500エラー（`code: "PERSISTENCE_FAILED"`）のまま。
- `supabase migration list`（`--linked`、cloud project `wiasmlwvodnbccsmhaeo`に対して）で確認したところ、以下4件のmigrationが**ローカルには存在するが本番Supabaseには未適用**だった。
  - `20260804000100_complete_planning_time_blocks.sql`
  - `20260808000100_planning_time_block_skip.sql`
  - `20260809000100_planning_manual_edit.sql`
  - `20260810000100_ai_advice_usage_events.sql`（`ai_advice_usage_events`テーブルを新規作成。これが欠けていたためAI利用状況APIが500していた）
- **重要な注意**: `supabase/migrations/`には上記4件に加えて、**本セッションとは無関係な別の未コミット進行中作業「THE HOSPITEL OS」の migration が5件**（`20260818000100`〜`20260818000500`、命名から浦山さんのゲストハウス業務管理システムと推測）が同じディレクトリに存在していた。`supabase db push`はデフォルトで pending な migration を全件適用するため、この5件を巻き込まないよう、**該当5ファイルを一時的にリポジトリ外へ退避 → 必要な4件だけ `supabase db push --yes` で適用 → 退避したファイルを元の場所へ復元**という手順を踏んだ（詳細は3節参照）。
- 適用後、本番Review画面で4セクションすべてが正しく表示されることをブラウザで確認済み。

## 3. 検出した「別プロジェクトとの同居」問題（要・オーナー判断）

`~/Downloads/ginji_os_starter`（このリポジトリ）の作業ツリーに、GinjiOSとは無関係な「THE HOSPITEL OS」というプロジェクトの**未コミットの実装一式**が存在していた。

```
?? docs/THE_HOSPITEL_OS.md
?? src/app/api/hospitel/
?? src/app/hospitel/
?? src/components/hospitel/
?? src/lib/hospitel/
?? src/types/hospitel.ts
?? supabase/migrations/20260818000100_hospitel_phase1.sql
?? supabase/migrations/20260818000200_hospitel_phase1_workflows.sql
?? supabase/migrations/20260818000300_hospitel_cleaning_next_checkin.sql
?? supabase/migrations/20260818000400_hospitel_module_state.sql
?? supabase/migrations/20260818000500_hospitel_phase2_phase4.sql
?? supabase/tests/hospitel-rls.integration.test.ts
 M .env.example / next-env.d.ts / package-lock.json / package.json / src/app/layout.tsx / src/types/database.ts
```

- 本セッションではこれらのファイルには一切触れていない（読み書き・commit・push・migration適用すべて対象外）。
- これがGinjiOSリポジトリに意図的に同居させる設計（同一Next.jsアプリ内のマルチプロダクト構成）なのか、単に別セッションが誤って同じディレクトリで作業してしまったものなのかは本セッションでは判断していない。**Codexまたはオーナーへの確認が必要**。今後GinjiOS側でmigrationやgit操作を行う際は、この未コミットファイル群を巻き込まないよう引き続き注意すること。

## 4. 実施した検証

- `npm run test` — 409件全パス
- `npm run test:integration`（ローカルSupabase、Docker Desktop起動のうえ`supabase start`→`db reset`→grant適用）— 16件全パス（RLS分離テスト10件相当、並列transaction/CASCADE削除3件相当を含む）
- 本番環境（`ginji-os.vercel.app`）で以下を実ブラウザ操作・実Googleアカウント（gin8ten@gmail.com）・実Google Calendarで確認
  - Googleログイン
  - タスク一覧表示（既存の期限超過タスク）
  - 「7日間の計画案」生成（下書き）→古い計画のstale検出が正しく動作することを確認（2回再現）
  - 計画案の承認（承認時点ではCalendar未書き込みであることのUI表示を確認）
  - Google Calendar追加内容のPreview→実際の書き込み（新規2件・失敗0件で成功、実カレンダーに反映）
  - タスク完了操作（○ボタンでの完了、メトリクス即時更新を確認）
  - Review画面: 日次振り返り・今週の予定/実績時間・見積もり誤差・AI利用状況の4セクション表示（migration適用後）
- **未確認のまま残った項目**: 手動編集（block時刻/タスク変更）、スキップ、持ち越しのUI操作は今回試していない。

## 5. コミット

| コミット | ブランチ | 内容 |
|---|---|---|
| （push済み、新規なし） | `feature/task-actual-time` → `main`へPR #7としてマージ | Milestone 5後半〜6実装（既存4コミットの反映） |
| `9a19efe` | `main`に直接commit + push | `docs/TASKS.md`更新（本セッションの確認結果・障害対応履歴を記録） |

- PR #7: https://github.com/gin8ten-svg/ginji-os/pull/7 （マージ済み）
- `docs/TASKS.md`のCurrent task欄に、本レポートの2節と同内容の要約を記載済み。

## 6. 残課題

### Medium
- 手動編集・スキップ・持ち越しのUI操作が未確認（コード・単体テストレベルでは実装・テスト済み、実ブラウザでの動作は未確認）。
- 「THE HOSPITEL OS」との同居問題（3節）。放置するとGinjiOS側の今後の作業がこの未コミットファイル群を誤って巻き込むリスクがある。

### Low（オーナーの意向により対応不要と判断済み、参考情報として記載）
- Supabase無料枠の自動一時停止（2.1）
- Google OAuth Testing公開状態によるtoken失効（2.2、未検証の推測）

## 7. 次にCodexへ依頼する推奨タスク

以下はそのままプロンプトとして使えます。

```
本番環境の障害復旧作業（CLAUDE_WORK_REPORT_2026-08-18.md参照）を踏まえて、このリポジトリを評価し改善してください。
特に以下を確認・対応してください。

1. docs/TASKS.md に残っている「手動編集・スキップ・持ち越しのUI操作」の実ブラウザ確認を行う。
2. supabase/migrations/ 配下に存在する「THE HOSPITEL OS」関連の未コミットファイル
   （docs/THE_HOSPITEL_OS.md, src/app/hospitel/, src/components/hospitel/, src/lib/hospitel/,
   src/types/hospitel.ts, supabase/migrations/20260818*_hospitel_*.sql,
   supabase/tests/hospitel-rls.integration.test.ts、および .env.example / next-env.d.ts /
   package-lock.json / package.json / src/app/layout.tsx / src/types/database.ts への変更）が
   GinjiOSと同一リポジトリに意図的に同居させる設計なのか確認し、そうでなければ分離を提案する。
   このファイル群には十分注意し、GinjiOS関連のコミットに誤って巻き込まないこと。
3. Google OAuth consent screenが依然Testing公開状態であれば、7日でtokenが失効し同じ障害が
   再発するリスクを踏まえ、本番公開への切り替えが必要かオーナーに確認する（対応は不要という
   判断が既にあるため、追加提案として留める程度でよい）。
```

---

*本レポートは実装ではなく本番復旧・検証作業の記録です。コード変更はCLAUDE.mdの既定方針（レビューのみ）に従い、`docs/TASKS.md`の更新以外は行っていません。*
