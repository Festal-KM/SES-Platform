# SP-09 proposal-flow — 提案の作成・承認・冪等送信・商談結果

> **Phase**: 1（MVP。**中核スプリント**） / **前提**: SP-04（送信ドメイン）/ SP-07（品質ゲート）/ SP-08（`createProposalDraft`） / **後続**: SP-10 / SP-12
> **一次資料**: `CLAUDE.md` §3.3 / §3.4 / §4.2 / §5 / §13.3 / `docs/02` `F-019` `F-021`〜`F-025` / 章 7.7 / `docs/04` `S-019`〜`S-024` / `docs/05` §8.3-Q / §9.4 / §10（冪等性・不可逆事故の防止）/ §10.4 / §11.5 / §12.1 / §12.5
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-09`
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-019`〜`S-024`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**85 枚中 3 枚のみ生成済み**であり、無ければ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

🔴 **`CLAUDE.md` §5 の Phase 1 成功条件のうち 2 つ**を成立させる。

1. 「案件登録 → パートナーへ公開 → パートナーが提案 → ゲート実行 → ホストが承認 → 送信 → 結果記録」を **E2E で完遂できる**。
2. 🔴 **ゲート FAIL の提案が送信できない**ことをテストで証明できる。

あわせて `CLAUDE.md` §7 の **「提案メール・契約書の二重送信 / 誤送信 = 0 件」（K-5）** の防止機構を、**送信機能と同じスプリント**に置く（後付けにしない）。

## 2. 対応機能 ID

`F-019`（提案の作成と情報凍結。越境経路 2）/ `F-021`（承認・却下）/ `F-022`（送信。冪等）/ `F-023`（送信失敗と人手再送）/ `F-024`（状態管理・履歴・一覧）/ `F-025`（商談結果）

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-09-01 | 提案の作成と情報凍結（`F-019`）と `S-020` | ホストが読めるのは `EngineerSnapshot` のみ。台帳更新で既存提案が変わらない | `F-019 AC-1`〜`AC-4` | L |
| T-09-02 | 提案の状態機械と 422（`F-024`） | §4.2 に無い遷移は 422。状態は変化せずエラーが記録される | `F-024 AC-1` / `BR-33` | M |
| T-09-03 | 提案の承認・却下（`F-021`）と `S-021` | 🔴 **判断材料を表示しないまま承認する導線が存在しない**（モバイルでも同じ） | `F-021 AC-1`〜`AC-6` | L |
| T-09-04 | 承認後の内容変更で承認が無効になる | 🔴 `contentHash` の不一致で承認 CAS が 0 件更新になる | `docs/05` §11.5 | M |
| T-09-05 | `SendAttempt` と冪等性キーの規約 | 🔴 **決定的な文字列**（乱数 UUID にしない）。2 本の `UNIQUE` | `docs/03` `program-design` 申し送り 3 / K-5 | M |
| T-09-06 | 🔴 **提案の送信（`F-022`）** | 🔴 **2 回起動しても外部呼び出しは 1 回。自動リトライが存在しない** | `F-022 AC-1`〜`AC-7` / K-5 | L |
| T-09-07 | 応答不明時の隔離と `SUBMIT_FAILED` の確定 | 🔴 **`SUBMITTING` は片道。自動で `APPROVED` に戻る経路が無い** | `F-022 AC-2` / `docs/05` §10.6 | M |
| T-09-08 | 送信失敗の一覧と人手再送（`F-023`）と `S-022` | 🔴 **自動再送の仕組み・設定・ジョブが存在しない**。確認を必ず挟む | `F-023 AC-1`〜`AC-3` | M |
| T-09-09 | 提案一覧・詳細・履歴（`F-024`）と `S-019` / `S-023` | 4 つの「うまくいかなかった」が独立にフィルタできる | `F-024 AC-2` `AC-3` | M |
| T-09-10 | 商談結果の記録（`F-025`）と `S-024` | 結果はシステムが自動確定しない。人間の操作のみ | `F-025 AC-1`〜`AC-3` | M |
| T-09-11 | 🔴 **Phase 1 成功条件 1・2 の E2E** | 1 サイクル完遂 + ゲート FAIL が送信できない | `CLAUDE.md` §5 | L |

## 4. タスク詳細

### T-09-01 提案の作成と情報凍結（L）

- **実装**: `POST /api/proposals`（#36。🔴 **SP-08 の `createProposalDraft()` プリミティブを再利用する。2 実装にしない**）/ `PATCH /api/proposals/{id}`（#37。🔴 **`DRAFT` のみ。他状態は 422**）。画面は `S-020`（Tier 2）。
- 🔴 **作成時点のエンジニア情報を `EngineerSnapshot` として凍結する。** 以後の台帳更新は提案内容を変えない（`F-019 AC-2`）。
- 🔴 **ホストが参照できるパートナー所属エンジニアの情報は `EngineerSnapshot` に限られる**（`F-019 AC-1` / `BR-06`）。台帳の現在値・他の提案の内容・他のエンジニアには到達できない。
- 🔴 **添付するスキルシートは `CLEAN` の版に限る**（`F-019 AC-3` / `F-011 AC-1`）。
- 🔴 **パートナーは、同一案件に対する他社の提案の存在・件数・単価・エンジニア名を、一覧・件数・並び順・通知のいずれからも知り得ない**（`F-019 AC-4` / `BR-07`）。`PartnerProposalView` / `HostProposalView` を型として分ける（`docs/05` §4.8）。
- 作成・更新を `ProposalEvent` と `AuditLog` に記録する。
- **本文は Phase 1 では手入力**（`proposal-drafter` は Phase 2 の `F-034`）。
- **完了の判定**: `F-019 AC-1`〜`AC-4` の結合テスト + 型テスト。

### T-09-02 提案の状態機械と 422（M）

- **実装**: `packages/domain/src/state/proposal.ts`（純粋関数）。`POST /api/proposals/{id}/transition`（#48）。
- 🔴 **`CLAUDE.md` §4.2 に定義された遷移のみを許可し、それ以外は `InvalidStateTransitionError`（HTTP 422）で拒否する。サイレントに無視しない**（`F-024 AC-1` / `BR-33`）。
- 🔴 **状態を追加しない。** 保留は状態ではなく列（`sendHoldReasonKey` / `sendHoldSince`）で表す（`P-A-02`）。
- 各遷移を `ProposalEvent` に記録する。
- **完了の判定**: 全遷移の網羅ユニットテスト（許可 / 拒否の両方）+ 422 の結合テスト（**状態が変化せずエラーが記録される**）。

### T-09-03 提案の承認・却下（L）

- **実装**: `POST /api/proposals/{id}/approve`（#41）/ `reject`（#42）。画面は `S-021`（**Tier 1: モバイル完結**）。
- 🔴 **`#41` の request は空。ゲート結果を引数に取らない**（`docs/05` §6.5）。承認側がゲート結果を持ち込めない構造にする。
- 🔴 **`APPROVED` を経ずに `SUBMITTING` / `SUBMITTED` へ進む経路が存在しない**（`F-021 AC-1` / `BR-16`）。**DB 制約（部分 UNIQUE + CAS の `WHERE status='APPROVED'`）で担保する**（`docs/05` §10.3）。
- 🔴 **承認画面に、ゲートの指摘・整合層の警告・提案先・単価・エンジニアの要点が同一画面に表示され、これらを表示しないまま承認する導線が存在しない**（`F-021 AC-4` / `BR-49`）。🔴 **モバイルビューポートでも同じ。** 狭い画面を理由に判断材料を隠さない。
- 🔴 **「不合格」と「警告」を視覚的に別のものとして設計する**（`docs/02` `ui-design` 申し送り 5）。**警告のみでは送信を止めない。** 混同すると承認者が警告を不合格と誤認し、ゲートの意味が変わる。
- 🔴 **一括承認はモバイルビューポートでは既定の操作として表示されない**（`F-021 AC-6` / `BR-50`）。
- **自動承認**（`F-021 AC-3` / `AC-5`）: `autoApproveEnabled` が有効**かつ全層 PASS** の場合のみ承認を自動付与し、承認者を `system` として記録する。🔴 **1 層でも FAIL なら自動承認されず `GATE_FAILED` に留まる。** 監査ログから「なぜ自動承認されたか（全層 PASS）」を辿れる。
- 🔴 **`autoApproveEnabled`（テナント単位）とロール別承認モード（テナント × ロール）を同じ画面ブロックに置かない**（`F-035 AC-6` / `docs/03` `ui-design` 申し送り 11）。
- **静的テスト**: `approval-mode-isolation.test.ts`（`docs/05` §17.2 #8。`proposals/**` に `TenantRoleApprovalMode` / `decideRoleHandoff` が現れない）。
- **完了の判定**: `F-021 AC-1`〜`AC-6` の結合テスト + **モバイルビューポートの E2E**（`docs/05` §17.3 #13）。

### T-09-04 承認後の内容変更で承認が無効になる（M）

- **実装**: `docs/05` §11.5。`Proposal.contentHash` と `ReviewGate.contentHash` の一致を**承認 CAS の条件**に入れる（`CHECK` ではなく）。
- 🔴 **承認後に本文を変更すると承認が無効になり、再検証なしで送信できない**（E2E #10）。
- **完了の判定**: E2E #10 が green。結合テスト（ハッシュ不一致で送信 CAS が 0 件更新）。

### T-09-05 `SendAttempt` と冪等性キーの規約（M）

- **実装**: `docs/05` §10.1 / `docs/03` `program-design` 申し送り 3 / `docs/02` `program-design` 申し送り 3。
- 🔴 **冪等性キーは `{entity}:{entity_id}:{attempt_seq}` の決定的な文字列。乱数 UUID にしない**（「同じ送信の再実行」と「人間が意図した再送」が区別できなくなる）。
- 🔴 **`SendAttempt` に `UNIQUE(entity_type, entity_id, attempt_seq)` と `UNIQUE(idempotency_key)` の 2 本**（SP-02 で作成済み。本タスクで実効性を検証する）。
- 🔴 **`packages/connectors` の送信関数が `SendAttemptToken` を必須引数に取る**（CAS と INSERT を経ずに外部送信できない構造にする）。
- **完了の判定**: 型テスト（`SendAttemptToken` なしで送信関数を呼べない）+ 結合テスト（同一 `attempt_seq` の 2 回目の INSERT が失敗する）。

### T-09-06 🔴 提案の送信（`F-022`）（L）

- **実装**: `POST /api/proposals/{id}/submit`（#43）。ジョブ `send.proposal`（🔴 **`attempts: 1` 固定**）。`docs/05` §10.2 の実行順序をそのまま実装する。
- **ガードの順序**: `requireExecutable` → `requireNotViewer` → `requireVerifiedSendingDomain`（SP-04）。
- 🔴 **送信直前に `APPROVED` → `SUBMITTING` を CAS で更新し、失敗したら実行しない**（多重実行の排除）。
- 🔴 **同一提案に対して送信を 2 回起動しても、外部への送信は 1 回しか行われない**（`F-022 AC-1`。同一 `idempotency_key`）。
- 🔴 **外部 API 呼び出しの結果が確定した後に自動リトライしない**（`F-022 AC-3` / `BR-22`）。**`attempts: 1` を型で固定**（SP-04 の T-04-01）。
- 🔴 **`production` 以外ではモック実装が選択され、実在の宛先へ到達しない**（`F-022 AC-4`。宛先は提案先・エンド企業 = 分類 3 であり**全非本番環境でモック**）。
- 🔴 **`production` でモック実装が選択された場合、アプリケーションは起動に失敗する**（`F-022 AC-5`。SP-01 の T-01-03 で実装済み。ここで送信経路について検証する）。
- 🔴 **送信ドメイン未検証なら `SUBMITTING` に入らず「設定未了」として保留する**（`F-022 AC-7`。SP-04 の T-04-05）。**`SUBMIT_FAILED`（障害）と区別する。**
- 🔴 **送信基盤（環境全体）のクォータ到達なら `sendHoldReasonKey='PROVIDER_QUOTA'` で保留する**（`docs/05` §10.2 ①-e / §10.4 / §8.3-Q ⑥ / `docs/02` 章 7.7-② / `F-059 AC-7`）:
  - `§10.2` ①-e で `decideQuota('EMAIL_COUNT')`（テナント日次上限 → `RATE_LIMIT`）**に加えて** `decideProviderQuota`（環境全体 → `PROVIDER_QUOTA`）を評価する。🔴 **判定関数は SP-04 の T-04-04 で作った `packages/domain/src/quota/provider.ts` を再利用し、2 実装にしない。**
  - 🔴 **`HOLD` なら CAS の前に止める。** `Proposal` は `APPROVED` のまま（`SUBMITTING` に入らず `SUBMIT_FAILED` にも落とさない）。**状態を増やさない**（属性値の追加。`P-A-02`）。
  - 🔴 **`RATE_LIMIT` と DB でも表示でも区別する。** 前者はテナントの利用量、後者は環境全体の制約であり対処する相手が異なる。**利用者への提示は `packages/i18n` の `sendHold.PROVIDER_QUOTA` = 「送信基盤の混雑により保留中。お客様側の設定では解消しません。自動で再送されます」とし、🔴 `S-038` への導線を出さない**（残量が潤沢な `S-038` に誘導しても打つ手が無い。`docs/05` §10.4）。
  - **復帰は `send.hold-release`**（`docs/05` §9.4）。`EmailDispatch(HELD_PROVIDER_QUOTA)` と**同じ枠（`headroom`）を分け合い**、`sendHoldSince` / `heldAt` の古い順に配分される。🔴 **復帰したジョブも §10.2 の ①②③ を最初から通る。**
  - 🔴 **CAS 後に SES が同期的に日次枠超過を返した稀な競合は `SUBMIT_FAILED` に落とす**（外部呼び出しを 1 回行った以上、保留に戻さない。`BR-22`。`docs/05` §8.3-Q ⑤）。**事前判定 ①-e が主経路である。**
  - **指標**: 🔴 **`PROVIDER_QUOTA` の保留は失敗ジョブ数・未対応 `SUBMIT_FAILED`・ゲート FAIL 率のいずれにも加算しない**（`A-005` 項目 14 に出る。実装は SP-11 の T-11-04）。
- **応答**: `202` + `{ attemptSeq, jobId, state: 'SUBMITTING' }`。確定は `GET /api/proposals/{id}` のポーリングで取る。**保留された場合は `SUBMITTING` に入らないため、`state` は `APPROVED` のまま `sendHoldReasonKey` が付く。**
- 送信を `AuditLog` と `ProposalEvent` に記録する。
- **完了の判定**: `F-022 AC-1`〜`AC-7` の結合テスト。E2E #7（2 回起動で外部呼び出し 1 回）。🔴 **加えて `docs/05` §17.3 #23 の `send.*` 経路** — `MAIL_PROVIDER_DAILY_QUOTA=1` で承認済み提案を 2 件送信し、2 件目が `sendHoldReasonKey='PROVIDER_QUOTA'`（**`RATE_LIMIT` ではない**）で `APPROVED` のまま留まり、`S-022` の文言に `S-038` 導線が無く、`now` を 24h 進めて `send.hold-release` を実行すると `SUBMITTED` になり、モックの `callCount()` が合計 2、`SendAttempt` は提案ごとに 1 行であること。

### T-09-07 応答不明時の隔離と `SUBMIT_FAILED` の確定（M）

- **実装**: `docs/05` §10.6。
- 🔴 **`SUBMITTING` は片道である。入ったら必ず `SUBMITTED` か `SUBMIT_FAILED` に確定させる。`SUBMITTING` のまま自動で `APPROVED` に戻る経路は存在しない**（`F-022 AC-2` / `CLAUDE.md` §4.2）。
- **応答不明（タイムアウト等）は `SUBMIT_FAILED` に確定させ、人間の再送に委ねる**（自動判断しない。`docs/01` 章 5.3 の T9）。
- 🔴 **`SUBMIT_FAILED` は `LOST` / `GATE_FAILED` / `DECLINED` と別の状態として保持される**（`F-022 AC-6` / `BR-23`）。
- **完了の判定**: E2E #8（応答不明 → `SUBMIT_FAILED` → 自動再送されない → 人手再送で 1 回だけ送信）。

### T-09-08 送信失敗の一覧と人手再送（M）

- **実装**: `POST /api/proposals/{id}/resend`（#44）。画面は `S-022`（Tier 2）。
- 🔴 **再送を自動的に起動する仕組み・設定・ジョブが存在しない**（`F-023 AC-1` / `docs/05` §6.8）。
- 🔴 **`acknowledged` が `true` でなければ 400**（`F-023 AC-2`）。**再送の実行前に「届いている可能性がある」旨の確認を表示する。**
- **再送時は新しい `attempt_seq`（= 新しい `idempotency_key`）を採番し、`F-022` の手順を再度実行する。**
- 再送の指示者・日時・理由を `AuditLog` に記録する（`F-023 AC-3`）。
- **静的テスト**: `Proposal` の `SUBMIT_FAILED → APPROVED` を呼ぶコードが `resend/route.ts` 以外に無いことを AST で検査する（`docs/05` §10.6。Phase 3 の `contract-resend-human-only.test.ts` と**対**にする）。
- **完了の判定**: `F-023 AC-1`〜`AC-3` の結合テスト + 静的テスト。

### T-09-09 提案一覧・詳細・履歴（M）

- **実装**: `GET /api/proposals`（#45）/ `GET /api/proposals/{id}`（#46）/ `POST /api/proposals/{id}/events`（#47）。画面は `S-019` / `S-023`（Tier 2）。
- 🔴 **4 つの「うまくいかなかった」を別の表示にする**（`docs/02` `ui-design` 申し送り 6 / `BR-23` / `BR-60`）: `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `DECLINED`。**一覧のフィルタ・集計・通知のすべてで別の語・別の区分。いずれか 2 つが同じ区分にまとめられる表示が存在しない**（`F-024 AC-2`）。
- 🔴 **`byState` は境界適用後**（`docs/05` §4.8）。
- 🔴 **`PartnerProposalDetailView` に `duplicateFindings` が存在しない**（`F-037 AC-1` / `BR-08`。**重複提案の検知は Phase 2 だが、型の分離は本タスクで行う** — 後から足すと漏れる）。
- 🔴 **パートナーが参照できる提案履歴は自社が作成した提案に限られる**（`F-024 AC-3`）。
- **完了の判定**: `F-024 AC-2` / `AC-3` の結合テスト + 型テスト。

### T-09-10 商談結果の記録（M）

- **実装**: `POST /api/proposals/{id}/transition`（#48）の商談部分。画面は `S-024`（**Tier 1**）。
- **記録する遷移**: `SUBMITTED` → `INTERVIEW_SCHEDULED` → `INTERVIEWED` → `RESULT_PENDING` → `WON` / `LOST`。`SUBMITTED` / `INTERVIEW_SCHEDULED` / `INTERVIEWED` / `RESULT_PENDING` からの `WITHDRAWN`。
- 🔴 **結果（`WON` / `LOST` / `WITHDRAWN`）はシステムが自動で確定しない。人間の操作でのみ確定する**（`F-025 AC-1`）。**業務基盤の外（電話・対面）で決まる事実であり、システムは推測してはならない。**
- 🔴 **`LOST` は `SUBMIT_FAILED` / `GATE_FAILED` / `DECLINED` と別に集計される**（`F-025 AC-3`）。
- **`WON` の確定により `Assignment` が生成できる状態になる**（`F-025 AC-2`。Phase 1 は記録のみ。**Phase 2 の `F-042` で接続する**）。
- **面談調整の連絡（`F-041`）は Phase 2**（SP-15）。Phase 1 は日程の**記録**のみ。
- 各記録を `ProposalEvent` と `AuditLog` に残す。
- **完了の判定**: `F-025 AC-1`〜`AC-3` の結合テスト + `S-024` のモバイル操作の E2E。

### T-09-11 🔴 Phase 1 成功条件 1・2 の E2E（L）

- **実装**: `tests/e2e/proposal-cycle.spec.ts`（`docs/05` §17.3 #3 / #4 / #7 / #8 / #9 / #10 / #13 / §12.1）。
- **シナリオ 1（1 サイクル完遂。`CLAUDE.md` §5 成功条件 1）**:
  案件登録 → パートナーへ公開 → パートナーが提案（`DRAFT`）→ レビュー依頼（`GATE_RUNNING`）→ ゲート全層 PASS（`APPROVAL_PENDING`）→ ホストが承認（`APPROVED`）→ 送信（`SUBMITTING` → `SUBMITTED`）→ 面談日程 → 面談実施 → 結果確定（`WON`）。
- **シナリオ 2（ゲート FAIL が送信できない。`CLAUDE.md` §5 成功条件 2 / E2E #4）**:
  🔴 **PII 層 FAIL の提案が `GATE_FAILED` に留まり、承認 API・送信 API を直叩きしても拒否される。「了解のうえ送信」の導線も API も設定も無い。** FAIL を解消する手段は**元データの修正と再実行のみ**。
- **シナリオ 3（冪等性。E2E #7 / #8 / #9）**: 2 回起動で外部 1 回 / 応答不明 → `SUBMIT_FAILED` → 自動再送されない → 人手再送で 1 回 / ドメイン未検証の保留が `SUBMIT_FAILED` にならず検証後に自動復帰。
- **シナリオ 4（承認の無効化。E2E #10）**: 承認後に本文を変更すると承認が無効になり、再検証なしで送信できない。
- **シナリオ 5（モバイル承認。E2E #13）**: 🔴 **`devices['iPhone 15']` で `S-021` を開き、判断材料（ゲートの指摘・警告・提案先・単価・エンジニアの要点）が省略されず、一括承認が既定でない。**
- **完了の判定**: 5 シナリオすべてが green。**このテストが無い / 赤のままスプリントを閉じない**（K-5。完了確認モードで無条件 NG）。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | `packages/domain` の状態遷移（許可 / 拒否の全網羅）。冪等性キーの生成（決定的）。`contentHash` の算出。 |
| **結合（DB + Redis）** | `F-019` / `F-021`〜`F-025` の全 AC。CAS の競合（同時 2 リクエストで 1 回だけ `SUBMITTING`）。`SendAttempt` の 2 本の `UNIQUE`。承認 CAS のハッシュ条件。`attempts: 1` の実効性（失敗しても再実行されない）。🔴 **`sendHoldReasonKey='PROVIDER_QUOTA'` の保留と `send.hold-release` による復帰**（`RATE_LIMIT` と別値で記録される / `SUBMITTING` に入らない / `SUBMIT_FAILED` にならない / 復帰後も §10.2 の ①②③ を通る）。 |
| **静的テスト** | `queue-attempts.test.ts`（`send.proposal` の `attempts: 1`）/ `execute-guard.test.ts`（#41〜#44 が `requireExecutable` を呼ぶ）/ `approval-mode-isolation.test.ts`（#8）/ `SUBMIT_FAILED → APPROVED` の呼び出し元限定。 |
| **E2E** | 🔴 **T-09-11 の 5 シナリオ**（`docs/05` §17.3 #3 / #4 / #7 / #8 / #9 / #10 / #13）+ 🔴 **#23 の `send.*` 経路**（`PROVIDER_QUOTA` の保留 → `send.hold-release` → `SUBMITTED`。`A-005` 項目 14 に `PROVIDER_QUOTA=1` / `RATE_LIMIT=0`。画面の検証は SP-11）。 |
| **外部 API のモック方針** | 🔴 **メール送信は `packages/connectors/src/mock/**`**（`docs/05` §17.5）。**分類 3（提案先・エンド企業）は全非本番環境でモック。** モックの `callCount()` で「2 回起動しても 1 回」を検証し、加えて**コンテナのネットワークを外向き遮断**して外部到達を構造的に不可能にする（二重）。応答不明（タイムアウト）を再現するモードをモックに持たせる。 |

## 6. 完了判定

1. `F-019` / `F-021` / `F-022` / `F-023` / `F-024` / `F-025` の全 AC が結合テストで green。
2. 🔴 **T-09-11 のシナリオ 1 が green** — 「案件登録 → 公開 → 提案 → ゲート → 承認 → 送信 → 結果記録」を E2E で完遂できる（`CLAUDE.md` §5 成功条件 1）。
3. 🔴 **T-09-11 のシナリオ 2 が green** — **ゲート FAIL の提案が送信できない**（`CLAUDE.md` §5 成功条件 2）。force / override の API・設定・導線が存在しない。
4. 🔴 **送信が冪等**（2 回起動で外部 1 回）。`send.*` の `attempts` が 1 で固定され、型で他の値を設定できない。
5. 🔴 **`SUBMITTING` は片道で、自動リトライ・自動再送の仕組み・設定・ジョブが存在しない。** 再送は人間の明示操作のみで、確認を必ず挟む。
   - 🔴 **保留（`sendHoldReasonKey`）は「自動再送」ではない。** 外部を 1 回も呼んでいないため `BR-22` の射程外であり、`DOMAIN_UNVERIFIED` / `PROVIDER_QUOTA` は `send.hold-release` が自動復帰させてよい（`GATE_STALE` は対象外）。**失敗（`SUBMIT_FAILED`）と保留を混同しない。**
6. 🔴 **承認後に内容が変わると再検証なしに送信できない。**
7. 🔴 **モバイルビューポートで承認の判断材料が省略されず、一括承認が既定でない。**
8. `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `DECLINED` が独立にフィルタ・集計できる。
