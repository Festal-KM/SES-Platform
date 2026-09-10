# SP-09 proposal-flow — 提案の作成・承認・冪等送信・商談結果

> **Phase**: 1（MVP。**中核スプリント**） / **前提**: SP-04（送信ドメイン）/ SP-07（品質ゲート）/ SP-08（`createProposalDraft`） / **後続**: SP-10 / SP-12
> **一次資料**: `CLAUDE.md` §3.3 / §3.4 / §4.2 / §5 / §13.3 / `docs/02` `F-019` `F-021`〜`F-025` / 章 7.7 / `docs/04` `S-019`〜`S-024` / `docs/05` §8.3-Q / §9.4 / §10（冪等性・不可逆事故の防止）/ §10.4 / §11.5 / §12.1 / §12.5
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-09`
> 🔴 **着手条件（2 件。SP-07 から送られた。いずれも「本スプリントの中核 E2E が原理的に緑にならない」ため、督促ではなく前提である）**
>
> | # | 条件 | なぜ本スプリントの前提なのか | 未解消のまま着手する場合 |
> |---|---|---|---|
> | **①** | ✅ **決着（2026-09-10。人間の回答「1 で」= `app_scan_probe` と同型の `SECURITY DEFINER` 経路。既定どおり）。実装タスクは `T-09-13`（本ファイル §3 / §4。実行順は先頭）。** 🔴 **ブロッカーとしては解消したが、実装は済んでいない** —— `T-09-13` を `T-09-01` より前に実施する。〔以下は決着前の記述〕 🔴 **[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41)（パートナー所属エンジニアの提案がゲートで fail-closed）の決着と実装** | `gate.run` はジョブのホスト文脈で走るため `engineers` / `engineer_skills`（**C3**）を読めず、**パートナーが作成した提案はゲートを通せずに落ちる**（`ReviewGate` が 1 行も書かれない。`docs/05` §11.9 ⑦ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-06）。🔴 **本スプリントの目的 1「パートナーが提案 → ホストが承認 → 送信」＝ `CLAUDE.md` §5 の Phase 1 成功条件 1 そのものであり、この状態では `T-09-11` シナリオ 1 が緑にならない。** 既定は **`app_scan_probe` と同型**（専用 DB ロール + `SECURITY DEFINER` + 列レベル `GRANT`。T-05-05 の前例）。🔴 **「ワーカーがパートナー所有行に触れるときの汎用の入口」を作らないこと**が要点（`docs/dev-plan.md` §6.3）。順序は **`docs/05` → migration → 実装**（`CLAUDE.md` §8.7） | 🔴 **`T-09-01`（提案の作成）の着手前に解消する。** 未解消のまま `T-09-11` まで進むと、**中核 E2E が「実装が悪い」のか「経路が塞がっている」のか切り分けられない**まま 5 回の `/iterate` を消費する |
> | **②** | 🔴 **`T-07-11`（ワーカーの起動配線とスケジュール基盤）の完了** | **`gate.run` の Worker が `apps/worker/src/main.ts` に配線されておらず、宣言済みのスケジュールジョブ 5 本もすべて無主である**（`docs/05` §11.12 ⑧ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-11）。🔴 **この状態ではブラウザ経路の E2E #3 / #4 / #23 が成立しない** —— テストから `gate.run` を走らせる経路自体が無いため、SP-07 の検証はすべて結合層（`tests/isolation/*`）に置かれている。**着手条件は `Q-07-1` / `Q-07-2`（= [Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19) の追記分 / [#44](https://github.com/Festal-KM/SES-Platform/issues/44)）であり、いずれも既定値が置いてあるため回答を待って止めない** | 🔴 **実施は SP-08 と並走、遅くとも本スプリントの先頭タスク。本スプリントより後ろに置いてはならない**（`docs/dev-plan.md` §3.2 / §4.1 / §8 の 2026-09-09 の行）。**タスク ID は `T-07-11` のまま変えない**（`CLAUDE.md` §8.8） |
>
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-019`〜`S-024`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**全 88 枚が生成済みである**（2026-09-03。[Issue #17](https://github.com/Festal-KM/SES-Platform/issues/17) = A の決着後に残り 82 枚を生成し、`docs/04` 改訂 5 の `S-046` 分 3 枚を追加した）。**本スプリントの着手条件は満たされている。** 画面の新設・改訂で不足が生じた場合のみ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

🔴 **`CLAUDE.md` §5 の Phase 1 成功条件のうち 2 つ**を成立させる。

1. 「案件登録 → パートナーへ公開 → パートナーが提案 → ゲート実行 → ホストが承認 → 送信 → 結果記録」を **E2E で完遂できる**。
2. 🔴 **ゲート FAIL の提案が送信できない**ことをテストで証明できる。

あわせて `CLAUDE.md` §7 の **「提案メール・契約書の二重送信 / 誤送信 = 0 件」（K-5）** の防止機構を、**送信機能と同じスプリント**に置く（後付けにしない）。

## 2. 対応機能 ID

`F-019`（提案の作成と情報凍結。越境経路 2）/ `F-021`（承認・却下）/ `F-022`（送信。冪等）/ `F-023`（送信失敗と人手再送）/ `F-024`（状態管理・履歴・一覧）/ `F-025`（商談結果）

## 3. タスク一覧

🔴 **本表の前に、上記ヘッダの着手条件 ① / ② を消化する。** ②（`T-07-11`）は **SP-08 と並走していれば本表の外**だが、**未実施のまま本スプリントに入った場合は本表の先頭タスクとして実施する**（`T-09-01` より前）。**新しい ID を振らず `T-07-11` のまま扱う**（`CLAUDE.md` §8.8。振り直すと SP-07 の完了記録・`docs/05` §11.12 ⑧・[Issue #44](https://github.com/Festal-KM/SES-Platform/issues/44) からの参照が切れる）。

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| （T-07-11） | 🔴 **ワーカーの起動配線とスケジュール基盤**（SP-07 からの持ち越し。**SP-08 と並走済みなら本表から外れる**） | `gate.run` の Worker が待ち受け、宣言済みの 5 本が実際に走る | `docs/05` §9.1 / §11.12 ⑧ | L |
| 🔴 **T-09-12** | 🔴 **`EngineerCareer` 子テーブルの新設と `EngineerSnapshot.careers` の凍結対象化**（[Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) = **回答 A**。2026-09-10）。**番号は 12 だが実行順は先頭** | 経歴が構造化して保存でき、**提案作成時に `EngineerSnapshot.careers` へ凍結される**（空配列にならない） | [#35](https://github.com/Festal-KM/SES-Platform/issues/35) / `F-008` / `F-019 AC-2` | M |
| 🔴 **T-09-13** | 🔴 **ゲート実行文脈からパートナー台帳を読む経路**（[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) = **回答 1**。2026-09-10）。**番号は 13 だが実行順は 2 番目** | パートナー所属エンジニアの提案が `gate.run` で fail-closed にならず、**3 層の判定が実データで下る** | [#41](https://github.com/Festal-KM/SES-Platform/issues/41) / `F-020` / `docs/05` §11.9 ⑦ | M |
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

🔴 **`T-09-12` / `T-09-13` は番号こそ末尾だが、実行順は `T-09-01` より前である**（`CLAUDE.md` §8.8 に従い既存 ID を振り直さない。`docs/dev-plan.md` `PM-A-09`「SP 番号 / タスク番号は採番順であって実行順ではない」）。**どちらも「後から入れると遡れない / 中核 E2E が原理的に緑にならない」性質のものである。**

### T-09-12 🔴 `EngineerCareer` の新設と `EngineerSnapshot.careers` の凍結（M・**実行順は先頭**）

- **背景**: [Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) に人間の回答が届いた（2026-09-10）—— **選択肢 A（`EngineerCareer` 子テーブルを新設する）**。**既定として置いていた C（Phase 1 は構造化保存を行わず、`EngineerSnapshot.careers` を空配列で凍結する）から変更された。**
- 🔴 **なぜ `T-09-01` より前でなければならないか**: **凍結は遡れない。** `EngineerSnapshot` は提案作成の時点のエンジニア情報を固定するものであり（`F-019 AC-2`）、**表を後から足しても、それ以前に作られたスナップショットに経歴は入らない**。`T-09-01` を先に実装すると、**そこで作られた提案だけ経歴の無いスナップショットになる**（`docs/dev-plan.md` §9 の Issue #35 の行）。
- 🔴 **順序は上流から**（`CLAUDE.md` §8.7。**スプリントファイルとコードだけを直さない**）: **`docs/02` `F-008`（経歴の入力と保存）→ `docs/04` §S-006 / §S-007（経歴の表示・入力欄）→ `docs/05` §3.4（`EngineerCareer` の表定義）+ §4.4 のポリシークラス割り当て + `EngineerSnapshot` の凍結内容 → migration → 実装**。**`program-design` が `docs/05` を直すまで実装に入らない。**
- **実装で守ること**:
  - 🔴 **所有パートナーの継承と freeze トリガの対象に含める**（SP-02 の T-02-08 と同型）。**親（`engineers`）の `partner_company_id` を継承し、行から直接は変えられない。** 単一列 FK ではなく **複合 FK（`(tenant_id, engineer_id)`）**とする（[Issue #33](https://github.com/Festal-KM/SES-Platform/issues/33) の決着に従う）。
  - 🔴 **ポリシークラスは親の `Engineer` と同じ（C3）**。**新表を作ったのにクラス割り当てを忘れると、`docs/05` §4.7 のカタログ走査が落ちる**（＝落ちることで気づける。除外リストに足して通さない）。
  - 🔴 **`EngineerSnapshot.careers` に凍結する**。以後の台帳更新が既存提案の内容を変えないこと（`F-019 AC-2`）。
  - 🔴 **匿名共有（経路 4）の開示項目を増やさない**（`CLAUDE.md` §3.1 経路 4 / §8.6）。**経歴は匿名 5 項目に含まれない。** `packages/domain/src/anonymize/**` の出力に経歴が 1 文字も現れないことをテストで固定する（**個人が特定できる情報の代表例である**）。
  - 🔴 **LLM へ渡す経路を作らない**（Phase 1 では `sheet-parser` が無い）。経歴は人が入力する。
  - **保持期間削除（`F-046`。SP-16）の対象に含める** —— 削除の射程から漏れると、個人情報が消えない列が残る。`docs/05` の該当節に追記する。
- **完了の判定**: ①`docs/02` → `docs/04` → `docs/05` が先に更新されている ②migration が入り、カタログ走査（`docs/05` §4.7）と二重防御のテストが green ③経歴を持つエンジニアで提案を作ると `EngineerSnapshot.careers` に凍結され、**その後に台帳の経歴を書き換えても提案の内容が変わらない**結合テストが green ④**匿名候補の出力に経歴が現れない**テストが green。

### T-09-13 🔴 ゲート実行文脈からパートナー台帳を読む経路（M・**実行順は 2 番目**）

- **背景**: [Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) に人間の回答が届いた（2026-09-10）—— **選択肢 1（`app_scan_probe` と同型の「専用 DB ロール + `SECURITY DEFINER` + 列レベル `GRANT`」で解く）。既定と同じ。**
- **何が壊れているか**: `gate.run` はジョブのホスト文脈で走るため `engineers` / `engineer_skills`（**C3**）を読めず、**パートナーが作成した提案は `ReviewGate` を 1 行も書かずに落ちる**（fail-closed。`docs/05` §11.9 ⑦ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-06）。
- 🔴 **なぜ `T-09-01` より前でなければならないか**: **「パートナーが提案 → ホストが承認 → 送信」は `CLAUDE.md` §5 の Phase 1 成功条件 1 そのもの**であり、この状態では `T-09-11` のシナリオ 1 が**原理的に**緑にならない。**先に `T-09-01` を作ってからゲートの穴に気づくと、`EngineerSnapshot` に何を凍結するか（＝ゲートに何を渡すか）まで作り直しになる。**
- 🔴 **順序は上流から**（`CLAUDE.md` §8.7）: **`docs/05`（§4.4.2 の行由来コンテキスト / §11.9 ⑦ / §8.5.1 と同型の節）→ migration → 実装。**
- **実装で守ること**:
  - 🔴 **専用ロール 1 つ + `SECURITY DEFINER` 関数 + 列レベル `GRANT`**。**読む列は照合に要るものだけに絞る**（氏名・連絡先・スキルシート本文を読めるようにしない）。**書き込みを与えない。**
  - 🔴 **テナント境界は関数本体の `app_tenant_id()` が課し、`NULL` は fail-closed で拒否する**（T-05-05 の `app_scan_probe` の前例）。
  - 🔴 **「ワーカーがパートナー所有行に触れるときの汎用の入口」を作らない**（`docs/dev-plan.md` §6.3。**分離のバイパスが汎用のエスケープハッチになるのが最大の失敗である**）。呼び出し元を静的テストで 1 箇所に固定する（`tests/static/auth-db-callers.test.ts` の `ALLOWED_CALLERS` と同型）。
  - 🔴 **新しいロールを `tests/isolation/roles.test.ts` のロール走査（SP-02 の #5 / #10）の対象に入れる。** **除外リストを広げて通さない。**
  - ⚠️ **[Issue #27](https://github.com/Festal-KM/SES-Platform/issues/27) ②の残射程と同じ論点である。** `SkillSheetExtraction` の生成（SP-14）は**書く列も表も違う**ため、本タスクの関数を流用しない。
- **完了の判定**: ①`docs/05` が先に更新されている ②migration が入り、ロール走査と二重防御が green ③**パートナー所属エンジニアの提案で `gate.run` が 3 層すべての判定を下し、`ReviewGate` が 1 行書かれる**結合テストが green（実 DB + RLS）④**その経路でホストの台帳・他社のエンジニアが 1 件も読めない**ことのテストが green ⑤`tests/isolation/gate-injection.test.ts`（K-3 の証明）が引き続き green。

### T-09-01 提案の作成と情報凍結（L）

- **実装**: `POST /api/proposals`（#36。🔴 **SP-08 の `createProposalDraft()` プリミティブを再利用する。2 実装にしない**）/ `PATCH /api/proposals/{id}`（#37。🔴 **`DRAFT` のみ。他状態は 422**）。画面は `S-020`（Tier 2）。
- 🔴 **作成時点のエンジニア情報を `EngineerSnapshot` として凍結する。** 以後の台帳更新は提案内容を変えない（`F-019 AC-2`）。
- 🔴 **ホストが参照できるパートナー所属エンジニアの情報は `EngineerSnapshot` に限られる**（`F-019 AC-1` / `BR-06`）。台帳の現在値・他の提案の内容・他のエンジニアには到達できない。
- 🔴 **添付するスキルシートは `CLEAN` の版に限る**（`F-019 AC-3` / `F-011 AC-1`）。
- 🔴 **パートナーは、同一案件に対する他社の提案の存在・件数・単価・エンジニア名を、一覧・件数・並び順・通知のいずれからも知り得ない**（`F-019 AC-4` / `BR-07`）。`PartnerProposalView` / `HostProposalView` を型として分ける（`docs/05` §4.8）。
- 作成・更新を `ProposalEvent` と `AuditLog` に記録する。
- **本文は Phase 1 では手入力**（`proposal-drafter` は Phase 2 の `F-034`）。
- 🔴 **本タスクの前に `T-09-12`（経歴の凍結。[Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) = A）と `T-09-13`（ゲート実行文脈。[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) = 1）を済ませる**（2026-09-10 に人間が決定。本ファイル §4 の該当節）。**どちらも本タスクを先に作ると作り直しになる。**
- 🔴 **着手条件①（[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41)。実装は `T-09-13`）を本タスクの前に解消する。** パートナーが作成した提案は、現状 `gate.run` がホスト文脈で `engineers` / `engineer_skills`（C3）を読めず **fail-closed で落ちる**（`docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-06 / `docs/05` §11.9 ⑦）。🔴 **本タスクは「パートナーが提案を作る」経路そのものであり、ここを実装してからゲートの穴に気づくと、`EngineerSnapshot` の凍結内容（何をゲートに渡すか）まで作り直しになる。** 既定は `app_scan_probe` と同型（専用ロール + `SECURITY DEFINER` + 列レベル `GRANT`）。順序は **`docs/05` → migration → 実装**（`CLAUDE.md` §8.7）。
- **完了の判定**: `F-019 AC-1`〜`AC-4` の結合テスト + 型テスト。🔴 **加えて、パートナーが作成した提案がゲートを通ること**（着手条件①の解消の確認。**通らないままだと `T-09-11` シナリオ 1 が緑にならない**）。

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
- 🔴 **前提（2 件。どちらも欠けると本タスクは原理的に緑にならない。ヘッダの着手条件と同じもの）**: ①**[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) の解消** —— **パートナーが作成した提案がゲートを通ること**（シナリオ 1 の「パートナーが提案 → ゲート実行」がここで止まる）②**`T-07-11` の完了** —— **`gate.run` の Worker が配線され、E2E ハーネスから実際に走ること**（配線が無いと `GATE_RUNNING` のまま永久に待つ）。
- 🔴 **SP-07 から引き継ぐブラウザ経路の E2E は 3 本ある**（SP-07 では結合層に置いた。`docs/sprints/SP-07-ai-layer-gate.md` §5 の読み替え / `docs/dev-plan.md` §8 の 2026-09-09 の行）: **#4**（ゲート FAIL が送信できない。案件公開分の結合層は `tests/isolation/project-publish-gate.test.ts`）/ **#18**（プロンプトインジェクションでゲートの判定が変わらない）/ **#23 の前半**（AI 上限と HELD。結合層は `tests/isolation/gate-hold-release.test.ts`）。**同じ検証を 2 箇所に書かない** —— **ブラウザ経路でしか確かめられないこと**（画面から到達できる導線 / 承認・送信 API が保留中に拒否されること / モバイル）に絞る。
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

0. 🔴 **着手条件 ① / ②（ヘッダ）が解消済みである** — ①[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41)（パートナー所属エンジニアの提案のゲート）が決着し、**パートナーが作成した提案がゲートを通る** ②**`T-07-11`（ワーカーの起動配線）が完了し、`gate.run` の Worker が待ち受けている**。🔴 **この 2 つは 2〜3 の前提であり、欠けたまま「実装は終わった」とはできない**（`docs/dev-plan.md` §3.2 / §4.1 / §8 の 2026-09-09 の行 / §9 の #41 / `Q-07-1` / `Q-07-2` の行）。
1. `F-019` / `F-021` / `F-022` / `F-023` / `F-024` / `F-025` の全 AC が結合テストで green。
2. 🔴 **T-09-11 のシナリオ 1 が green** — 「案件登録 → 公開 → 提案 → ゲート → 承認 → 送信 → 結果記録」を E2E で完遂できる（`CLAUDE.md` §5 成功条件 1）。
3. 🔴 **T-09-11 のシナリオ 2 が green** — **ゲート FAIL の提案が送信できない**（`CLAUDE.md` §5 成功条件 2）。force / override の API・設定・導線が存在しない。
4. 🔴 **送信が冪等**（2 回起動で外部 1 回）。`send.*` の `attempts` が 1 で固定され、型で他の値を設定できない。
5. 🔴 **`SUBMITTING` は片道で、自動リトライ・自動再送の仕組み・設定・ジョブが存在しない。** 再送は人間の明示操作のみで、確認を必ず挟む。
   - 🔴 **保留（`sendHoldReasonKey`）は「自動再送」ではない。** 外部を 1 回も呼んでいないため `BR-22` の射程外であり、`DOMAIN_UNVERIFIED` / `PROVIDER_QUOTA` は `send.hold-release` が自動復帰させてよい（`GATE_STALE` は対象外）。**失敗（`SUBMIT_FAILED`）と保留を混同しない。**
6. 🔴 **承認後に内容が変わると再検証なしに送信できない。**
7. 🔴 **モバイルビューポートで承認の判断材料が省略されず、一括承認が既定でない。**
8. `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `DECLINED` が独立にフィルタ・集計できる。
