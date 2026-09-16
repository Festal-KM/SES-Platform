# SP-09 proposal-flow — 提案の作成・承認・冪等送信・商談結果

> **Phase**: 1（MVP。**中核スプリント**） / **前提**: SP-04（送信ドメイン）/ SP-07（品質ゲート）/ SP-08（`createProposalDraft`） / **後続**: SP-10 / SP-12
> **一次資料**: `CLAUDE.md` §3.3 / §3.4 / §4.2 / §5 / §13.3 / `docs/02` `F-019` `F-021`〜`F-025` / 章 7.7 / `docs/04` `S-019`〜`S-024` / `docs/05` §8.3-Q / §9.4 / §10（冪等性・不可逆事故の防止）/ §10.4 / §11.5 / §12.1 / §12.5
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-09`
> 🔴 **着手条件（2 件。SP-07 から送られた。いずれも「本スプリントの中核 E2E が原理的に緑にならない」ため、督促ではなく前提である）**
>
> | # | 条件 | なぜ本スプリントの前提なのか | 未解消のまま着手する場合 |
> |---|---|---|---|
> | **①** | ✅ **決着（2026-09-10。人間の回答「1 で」= `app_scan_probe` と同型の `SECURITY DEFINER` 経路。既定どおり）。実装タスクは `T-09-13`（本ファイル §3 / §4。実行順は先頭）。** 🔴 **ブロッカーとしては解消したが、実装は済んでいない** —— `T-09-13` を `T-09-01` より前に実施する。〔以下は決着前の記述〕 🔴 **[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41)（パートナー所属エンジニアの提案がゲートで fail-closed）の決着と実装** | `gate.run` はジョブのホスト文脈で走るため `engineers` / `engineer_skills`（**C3**）を読めず、**パートナーが作成した提案はゲートを通せずに落ちる**（`ReviewGate` が 1 行も書かれない。`docs/05` §11.9 ⑦ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-06）。🔴 **本スプリントの目的 1「パートナーが提案 → ホストが承認 → 送信」＝ `CLAUDE.md` §5 の Phase 1 成功条件 1 そのものであり、この状態では `T-09-11` シナリオ 1 が緑にならない。** 既定は **`app_scan_probe` と同型**（専用 DB ロール + `SECURITY DEFINER` + 列レベル `GRANT`。T-05-05 の前例）。🔴 **「ワーカーがパートナー所有行に触れるときの汎用の入口」を作らないこと**が要点（`docs/dev-plan.md` §6.3）。順序は **`docs/05` → migration → 実装**（`CLAUDE.md` §8.7） | 🔴 **`T-09-01`（提案の作成）の着手前に解消する。** 未解消のまま `T-09-11` まで進むと、**中核 E2E が「実装が悪い」のか「経路が塞がっている」のか切り分けられない**まま 5 回の `/iterate` を消費する |
> | **②** | ✅ **決着（2026-09-10。コミット `89545bb`。CI run `34438822934` green）。`T-07-11`（ワーカーの起動配線とスケジュール基盤）は SP-08 に先行して完了している** —— `apps/worker/src/{bootstrap,runtime,scheduler}.ts` + `main.ts` の配線 + `app_scheduler_probe` / `app_list_scheduler_tenants()`（`docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-11 の完了記録。**記録は 2026-09-15 に補填**〔SP-07 の完了確認より後のコミットだったため漏れており、SP-08 の完了確認で一度「未着手」と誤記された。訂正済み〕）。**本表の外で消化済みであり、先頭タスクにはならない。** ⚠️ 🔴 **ただし `T-09-11` に残る制約は別物である**: **E2E ハーネス（`tests/e2e/harness`）に Redis とワーカーが無い**（PostgreSQL と MinIO だけ。`docs/05` §11.12 ⑦）。ワーカーは配線済みだが、**ブラウザ経路の E2E #3 / #4 / #23 を通すにはハーネス側に Redis + `gate.run` ワーカーを足す必要がある** —— これは `T-09-11` の仕事であり、下記の旧記述はこの区別を書いていなかった。〔以下は決着前の記述〕 🔴 **`T-07-11`（ワーカーの起動配線とスケジュール基盤）の完了** | **`gate.run` の Worker が `apps/worker/src/main.ts` に配線されておらず、宣言済みのスケジュールジョブ 5 本もすべて無主である**（`docs/05` §11.12 ⑧ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-11）。🔴 **この状態ではブラウザ経路の E2E #3 / #4 / #23 が成立しない** —— テストから `gate.run` を走らせる経路自体が無いため、SP-07 の検証はすべて結合層（`tests/isolation/*`）に置かれている。**着手条件は `Q-07-1` / `Q-07-2`（= [Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19) の追記分 / [#44](https://github.com/Festal-KM/SES-Platform/issues/44)）であり、いずれも既定値が置いてあるため回答を待って止めない** | 🔴 **実施は SP-08 と並走、遅くとも本スプリントの先頭タスク。本スプリントより後ろに置いてはならない**（`docs/dev-plan.md` §3.2 / §4.1 / §8 の 2026-09-09 の行）。**タスク ID は `T-07-11` のまま変えない**（`CLAUDE.md` §8.8） |
>
> ✅ **前提 SP-08 は 2026-09-15 に完了した**（`MODE: REVIEW` / `TARGET: SP-08` = `PHASE_COMPLETE`。11 / 11。最終 CI run `34947464880` green〔E2E 43 本〕。`docs/sprints/SP-08-anonymous-share.md` §8）。**本スプリントが再利用する `createProposalDraft()` は `packages/db/src/proposal-draft.ts` に 1 実装で存在する。** 🔴 **SP-08 からの申し送り 2 件を本ファイルに反映した**（2026-09-15）: **`T-09-01`** = 応諾で作る `Proposal(DRAFT)` の**提案先が空文字**である（§4 T-09-01 の「SP-08 からの申し送り」）/ **`T-09-12`** = `createProposalDraft()` の `freezeCareers()` を `engineer_careers` の行複製に置き換える（§4 T-09-12）。
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

✅ **ヘッダの着手条件 ② は決着済みである（2026-09-10、`89545bb`）。`T-07-11` は本表の外で消化されており、先頭タスクにはならない。** 🔴 **`T-09-11` の前提として残るのは「E2E ハーネスに Redis とワーカーを足す」ことであり、それは `T-09-11` 自身の作業である**（`docs/05` §11.12 ⑦。ワーカーの配線とは別）。〔以下は決着前の記述〕🔴 **本表の前に、上記ヘッダの着手条件 ① / ② を消化する。** ②（`T-07-11`）は **SP-08 と並走していれば本表の外**だが、**未実施のまま本スプリントに入った場合は本表の先頭タスクとして実施する**（`T-09-01` より前）。**新しい ID を振らず `T-07-11` のまま扱う**（`CLAUDE.md` §8.8。振り直すと SP-07 の完了記録・`docs/05` §11.12 ⑧・[Issue #44](https://github.com/Festal-KM/SES-Platform/issues/44) からの参照が切れる）。

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| ~~（T-07-11）~~ | ~~🔴 **ワーカーの起動配線とスケジュール基盤**（SP-07 からの持ち越し。**SP-08 と並走済みなら本表から外れる**）~~ ✅ **2026-09-10 に完了（`89545bb`）。本表から外れた** | ~~`gate.run` の Worker が待ち受け、宣言済みの 5 本が実際に走る~~ 満たした（現在は `proposal-request.expire` を含む 6 本） | `docs/05` §9.1 / §11.12 ⑧ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-11 | — |
| 🔴 **T-09-12** | 🔴 **`EngineerCareer` 子テーブルの新設と `EngineerSnapshot.careers` の凍結対象化**（[Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) = **回答 A**。2026-09-10）。**番号は 12 だが実行順は先頭** | 経歴が構造化して保存でき、**提案作成時に `EngineerSnapshot.careers` へ凍結される**（空配列にならない） | [#35](https://github.com/Festal-KM/SES-Platform/issues/35) / `F-008` / `F-019 AC-2` | M |
| 🔴 **T-09-13** | 🔴 **ゲート実行文脈からパートナー台帳を読む経路**（[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) = **回答 1**。2026-09-10）。**番号は 13 だが実行順は 2 番目** | パートナー所属エンジニアの提案が `gate.run` で fail-closed にならず、**3 層の判定が実データで下る** | [#41](https://github.com/Festal-KM/SES-Platform/issues/41) / `F-020` / `docs/05` §11.9 ⑦ | M |
| T-09-01 | 提案の作成と情報凍結（`F-019`）と `S-020` | ホストが読めるのは `EngineerSnapshot` のみ。台帳更新で既存提案が変わらない | `F-019 AC-1`〜`AC-4` | L |
| T-09-02 | 提案の状態機械と 422（`F-024`） | §4.2 に無い遷移は 422。状態は変化せずエラーが記録される | `F-024 AC-1` / `BR-33` | M |
| T-09-03 | 提案の承認・却下（`F-021`）と `S-021` | 🔴 **判断材料を表示しないまま承認する導線が存在しない**（モバイルでも同じ） | `F-021 AC-1`〜`AC-6` | L |
| T-09-04 | 承認後の内容変更で承認が無効になる | 🔴 `contentHash` の不一致で承認 CAS が 0 件更新になる | `docs/05` §11.5 | M |
| T-09-05 | `SendAttempt` と冪等性キーの規約 | 🔴 **決定的な文字列**（乱数 UUID にしない）。2 本の `UNIQUE` | `docs/03` `program-design` 申し送り 3 / K-5 | M |
| T-09-06 | 🔴 **提案の送信（`F-022`）** | 🔴 **2 回起動しても外部呼び出しは 1 回。自動リトライが存在しない** | `F-022 AC-1`〜`AC-7` / K-5 | L |
| T-09-07 | 応答不明時の隔離と `SUBMIT_FAILED` の確定 | 🔴 **`SUBMITTING` は片道。自動で `APPROVED` に戻る経路が無い** | `F-022 AC-2` / `docs/05` §10.6 | M |
| T-09-08 | 送信失敗の一覧と人手再送（`F-023`）と `S-022` ✅ **2026-09-16 完了** | 🔴 **自動再送の仕組み・設定・ジョブが存在しない**。確認を必ず挟む | `F-023 AC-1`〜`AC-3` | M |
| T-09-09 | 提案一覧・詳細・履歴（`F-024`）と `S-019` / `S-023` ✅ **2026-09-16 完了** | 4 つの「うまくいかなかった」が独立にフィルタできる | `F-024 AC-2` `AC-3` | M |
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
- 🔴 **SP-08 からの申し送り（2026-09-15。T-08-07）**: **`packages/db/src/proposal-draft.ts` の `createProposalDraft()` は `freezeCareers()` を通して `EngineerSnapshot.careers` を凍結する形で既に在り、現在の `freezeCareers()` は既定 C の暫定として空配列を返す。** 本タスクは **`freezeCareers()` の中身を `engineer_careers` の行複製（提案作成時点の全行を凍結）に置き換える**。🔴 **`createProposalDraft()` の呼び出し元（#33 応諾 / SP-09 #36）は変えない** —— 凍結の入口が 1 つであることが、SP-08 でこの形にした理由である（凍結内容を呼び出し元ごとに書くと、経路 2 と経路 4 由来の提案で凍結の中身が食い違う）。**着手条件は揃っている**: `docs/02` `F-008` / `docs/04` §S-006 / §S-007 / `docs/05` §3.4 + §4.4 の 3 段は Issue #35 = A の反映で更新済み、ワイヤーフレームは `S-006` / `S-007` の 3 枚が生成済み。
- **完了の判定**: ①`docs/02` → `docs/04` → `docs/05` が先に更新されている ②migration が入り、カタログ走査（`docs/05` §4.7）と二重防御のテストが green ③経歴を持つエンジニアで提案を作ると `EngineerSnapshot.careers` に凍結され、**その後に台帳の経歴を書き換えても提案の内容が変わらない**結合テストが green ④**匿名候補の出力に経歴が現れない**テストが green ⑤🔴 **`createProposalDraft()` の呼び出し元が増えておらず、`freezeCareers()` が空配列を返す経路が残っていない**（経路 4 の応諾〔#33〕で作った提案にも経歴が凍結される —— `tests/isolation/proposal-request-respond.test.ts` の凍結の検証に `careers` を足す）。

### T-09-13 🔴 ゲート実行文脈からパートナー台帳を読む経路（M・**実行順は 2 番目**）

- **背景**: [Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) に人間の回答が届いた（2026-09-10）—— **選択肢 1（`app_scan_probe` と同型の「専用 DB ロール + `SECURITY DEFINER` + 列レベル `GRANT`」で解く）。既定と同じ。**
- **何が壊れているか**: `gate.run` はジョブのホスト文脈で走るため `engineers` / `engineer_skills`（**C3**）を読めず、**パートナーが作成した提案は `ReviewGate` を 1 行も書かずに落ちる**（fail-closed。`docs/05` §11.9 ⑦ / `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-06）。
- 🔴 **なぜ `T-09-01` より前でなければならないか**: **「パートナーが提案 → ホストが承認 → 送信」は `CLAUDE.md` §5 の Phase 1 成功条件 1 そのもの**であり、この状態では `T-09-11` のシナリオ 1 が**原理的に**緑にならない。**先に `T-09-01` を作ってからゲートの穴に気づくと、`EngineerSnapshot` に何を凍結するか（＝ゲートに何を渡すか）まで作り直しになる。**
- 🔴 **順序は上流から**（`CLAUDE.md` §8.7）: **`docs/05`（§4.4.2 の行由来コンテキスト / §11.9 ⑦ / §8.5.1 と同型の節）→ migration → 実装。**
- **実装で守ること**:
  - 🔴 **専用ロール 1 つ + `SECURITY DEFINER` 関数 + 列レベル `GRANT`**。**読む列は照合に要るものだけに絞る**（~~氏名・連絡先・スキルシート本文を読めるようにしない~~ → **訂正（2026-09-16、`docs/05` §11.14 に追随）: 読むのは整合層の 3 列 + PII 層の既知値 5 列〔`display_name` / `birth_date` / `contact_email` / `contact_phone` / `affiliation_label`〕である。連絡先は「伏せるための既知値」として読まなければパートナー所属エンジニアの提案で PII 層が決定的に素通りする〔`mask()` は既知値主・パターン補助で、機械的検出は既知値に無い値を指摘しない〕。**スキルシート本文・`owner_partner_company_id`・営業メモは読めるようにしない。読んだ値をゲート結果・監査・LLM 以外に出さない**）。**書き込みを与えない。**
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
- 🔴 **SP-08 からの申し送り（2026-09-15。T-08-07）: 経路 4 の応諾（#33）が `createProposalDraft()` で作る `Proposal(DRAFT)` は、提案先（提案を送る相手）が**空文字**である** —— 依頼の時点では提案先が決まっておらず、`createProposalDraft()` は「凍結」の責務だけを持つ。**本タスクで次の 3 点を揃える**: ①**#37（`PATCH /api/proposals/{id}`）で提案先を必須入力にする**（`DRAFT` の間だけ設定・変更できる）②🔴 **#39（ゲート実行依頼）で、提案先が空の `DRAFT` を 422 で弾く**（`GATE_RUNNING` へ遷移させない。**提案先が無い提案に商流層のゲートは掛けられない** —— 「その公開範囲で出してはならない相手に出ていないか」の「相手」が無い）③**`docs/04` §S-020「新規は提案先が決まった状態で開く」を `ui-design` が改訂する**（経路 4 由来の `DRAFT` は提案先が未設定の状態で開くため。**上流が先**。`CLAUDE.md` §8.7）。🔴 **#36（自社候補からの作成）では提案先を必須の入力に含め、経路 4 由来だけが「後から埋める」形になる** —— この差を `S-020` に明示する（未設定の欄を無言で空にしない）。
- **完了の判定**: `F-019 AC-1`〜`AC-4` の結合テスト + 型テスト。🔴 **加えて、パートナーが作成した提案がゲートを通ること**（着手条件①の解消の確認。**通らないままだと `T-09-11` シナリオ 1 が緑にならない**）。🔴 **さらに、提案先が空の `DRAFT` が #39 で 422 になり、#37 で提案先を設定した後にだけゲートへ進めること**（SP-08 の申し送り。経路 4 の応諾で作った提案を使う結合テスト）。

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
- ⚠️ **T-09-01 からの申し送り（2026-09-16）**: `S-021` が #40 の `contentHash`（ホスト文脈の再計算値）と `review_gates.content_hash` を突き合わせて「内容が変わった」を描くと、**取引先作成の提案では変更していないのに「変更あり」になる**（添付のハッシュ材料が所属で食い違う。詳細は T-09-04 の申し送り）。判断材料の表示に使う前に T-09-04 側の修正方向を先に決めること。

### T-09-04 承認後の内容変更で承認が無効になる（M）

- **実装**: `docs/05` §11.5。`Proposal.contentHash` と `ReviewGate.contentHash` の一致を**承認 CAS の条件**に入れる（`CHECK` ではなく）。
- 🔴 **承認後に本文を変更すると承認が無効になり、再検証なしで送信できない**（E2E #10）。
- **完了の判定**: E2E #10 が green。結合テスト（ハッシュ不一致で送信 CAS が 0 件更新）。
- 🔴 **T-09-01 からの申し送り（2026-09-16。レビューが実 DB で再現）: `contentHash` が読む側の所属で食い違う。** `computeProposalContentHash`（`packages/db/src/gate-content-hash.ts`）は添付の材料を `engineer_snapshots.skillSheet` **リレーション**（`id` / `objectKey` / `version`）から取るが、`skill_sheets` は C3（所有者だけ）なので、**ホスト文脈で取引先作成の提案を読むとリレーションが `null` になり、同一提案でホストのハッシュ ≠ 取引先のハッシュ**になる。**本タスク（T-09-01）では壊れていない**根拠: ①`proposals.content_hash` を書くのは #39 だけで、依頼者（取引先）の文脈のハッシュが列に入る ②`gate.run` は payload のハッシュを信頼して `review_gates.content_hash` に写す（再計算しない）ので、承認 CAS が突き合わせる 2 列は一致する ③ずれの向きは「変更あり」の偽陽性であり、検査していない内容が承認される方向（バイパス）にはならない。**影響先**: 本タスク（T-09-04）の「承認後の内容変更で承認が無効になる」判定（#40 / `S-021` がホスト文脈で再計算したハッシュと `review_gates.content_hash` を比べると、変更していないのに「変更あり」になる）と、#39 のキャッシュ判定（`findCachedReviewGate` を**ホスト**が呼ぶと同じ内容でも別ハッシュとして再実行される。取引先が呼ぶ限りは一致する）。**修正方向**: 添付の材料をリレーションではなく凍結列 `engineer_snapshots.skill_sheet_id`（C5。ホストも読める）にする（`objectKey` / `version` を材料から外す。版の差し替えは #37 が `skill_sheet_id` を書き換えるのでハッシュは変わる）か、`readProposalGateHashInput` を所属によらず同じ材料が読める経路（`app_gate_probe` と同型）で読む。**どちらも `docs/05` §11.5 の材料の定義（`gateHashSource` の入力）を先に直す**（`CLAUDE.md` §8.7）。

- 🔴 **T-09-03 からの申し送り（2026-09-16。code-reviewer が実 DB で確認）**:
  1. **承認 CAS（§11.5 手順 3）と `contentHash` 素材 v3（凍結列 `engineer_snapshots.skill_sheet_id`）は T-09-03 で実装済み。** 本タスクの残りは手順 2 / 手順 4 の側である。
  2. 🔴 **`EngineerSnapshot.careers` が `contentHash` の材料に入っていない**（`docs/05` §11.5 は「careers の全行の 5 項目」を列挙するが `packages/domain/src/gate/hash.ts` `GateHashSnapshot` と `packages/db/src/gate-content-hash.ts` の `select` に無い。T-09-12 の取りこぼしで、ゲートは `gate-target.ts` で careers を検査している）。**本タスクで `v4` に上げて材料に入れる。** 確認: `hash.test.ts` に「careers の 1 行を変えると連結が変わる」。
  3. 🔴 **`docs/05` §11.5 手順 2「`APPROVAL_PENDING` / `APPROVED` なら `DRAFT` に戻す」は `CLAUDE.md` §4.2 に無い遷移（`APPROVED → DRAFT`）を前提にしており、`#37`（`DRAFT` のみ編集可。T-09-01）とも食い違う。** [Issue #54](https://github.com/Festal-KM/SES-Platform/issues/54) で確認中（`decision-needed`）。**既定値は「追加しない」**: §11.5 手順 2 を `#37` の実装に合わせて改訂し、手順 3 / 4 のハッシュ一致条件は API を通らない経路に対する多層防御と位置づける。
  4. 送信前判定（`docs/05` §10.2 ①-c / ②-b）が使う「ゲートが現在の内容に対して有効か」の判定を、承認 CAS と **1 実装**で共有する形で `packages/db` に置く（T-09-06 が消費する。ここで別実装を書くと承認と送信で判定が食い違う）。
  5. **ワーカーの自動承認がテナントのライフサイクル状態を見ない**（`apps/worker/src/jobs/gate-run.ts` は `autoApproveEnabled` だけを読む）。同じ `select` に `lifecycleState` を足し、`SANDBOX` / `ACTIVE` 以外では自動承認を呼ばない。確認: `gate-run.test.ts` に `SUSPENDED` で `approveProposal` が呼ばれないケース。
  6. `docs/05` §6.5 に「#41 / #42 の実装の決着（T-09-03）」の節が無い。T-09-01 / T-09-02 と同じ作法で記録する（`approveProposal` を `packages/db` に置いた理由・3 段の拒否順序・`S-021` の primary が T-09-06 まで「承認する」であること・`tests/e2e/harness/db-admin.ts` のシーム）。
  7. E2E #10 の「再検証なしで送信できない」の部分は送信 API（#43）が T-09-06 のため、本タスクでは結合テスト（ハッシュ不一致で `APPROVED → SUBMITTING` の CAS が 0 件更新）で担保し、E2E の送信側アサーションは T-09-06 で足す。
- ✅ **T-09-04 の決着（2026-09-16）**: 上記 1〜7 を実施。①`docs/05` §11.5 手順 2 を #37 の実装（`DRAFT` のみ）に合わせて改訂し、手順 3 / 4 を API を通らない経路への多層防御と位置づけた（⚠️ 暫定。[Issue #54](https://github.com/Festal-KM/SES-Platform/issues/54)）②`contentHash` 素材 `v4`（`EngineerSnapshot.careers`。凍結行の順序のまま綴じる。既存の `v3` 行は `GATE_STALE` → 再検証で復帰。マイグレーションしない根拠は §11.5）③送信前判定 `readProposalGateFreshness` / 送信 CAS `castProposalToSubmitting`（`SystemTenantCtx` 限定）を承認 CAS と同じ SQL 述語で `packages/db` に置いた（§6.5「承認の無効化と送信前判定の共有」）④`tests/isolation/proposal-approval-invalidation.test.ts`（12 件）⑤`gate.run` の自動承認が `lifecycleState` を見る（`shouldAutoApprove` の入力に追加。`SANDBOX` / `ACTIVE` のみ）⑥§6.5 に「#41 / #42 の実装の決着（T-09-03）」を記録 ⑦E2E #10 を `tests/e2e/home.mobile.spec.ts` の承認 test の続きに追加（送信側は T-09-06）。

### T-09-05 `SendAttempt` と冪等性キーの規約（M）

- **実装**: `docs/05` §10.1 / `docs/03` `program-design` 申し送り 3 / `docs/02` `program-design` 申し送り 3。
- 🔴 **冪等性キーは `{entity}:{entity_id}:{attempt_seq}` の決定的な文字列。乱数 UUID にしない**（「同じ送信の再実行」と「人間が意図した再送」が区別できなくなる）。
- 🔴 **`SendAttempt` に `UNIQUE(entity_type, entity_id, attempt_seq)` と `UNIQUE(idempotency_key)` の 2 本**（SP-02 で作成済み。本タスクで実効性を検証する）。
- 🔴 **`packages/connectors` の送信関数が `SendAttemptToken` を必須引数に取る**（CAS と INSERT を経ずに外部送信できない構造にする）。
- **完了の判定**: 型テスト（`SendAttemptToken` なしで送信関数を呼べない）+ 結合テスト（同一 `attempt_seq` の 2 回目の INSERT が失敗する）。

- ✅ **T-09-05 の決着（2026-09-16）**: トークン 3 型と `SEND_ENTITY_TYPES` を `packages/domain/src/idempotency.ts` に一本化（`packages/connectors` は re-export）。`packages/db/src/send.ts` に `reserveSendAttempt`（`SystemTenantCtx`。`INSERT … ON CONFLICT DO NOTHING RETURNING`。0 行は `ALREADY_RESERVED`）/ `settleSendAttempt`（`RESERVED` からの CAS）/ `nextSendAttemptSeq`（`HumanTenantCtx` のみ。**ジョブは採番しない**）。実 DB で 2 本の UNIQUE が独立に効く・同時 5 回で RESERVED 1 回・ジョブ再実行で seq が増えないことを固定（`tests/isolation/send-attempt.test.ts` 18 件）。`as SendAttemptToken` は `send.ts` の 1 箇所だけ（`tests/static/send-attempt-token-single-path.test.ts`）。code-reviewer 1 回: 申し送りの「#43 は 409」が `docs/05` §10.5 の復帰経路を塞ぐ指摘 → T-09-06 節で訂正済み。

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
- 🔴 **T-09-04 からの申し送り（2026-09-16）**:
  1. **§10.2 ①-c / ②-b の判定と ③ の CAS は `packages/db` に実装済み**（`docs/05` §6.5「承認の無効化と送信前判定の共有（T-09-04）」/ §11.5 手順 4）: `readProposalGateFreshness(ctx, proposalId)`（`{ state, storedHash, currentHash, reviewGateId, gateFresh }`）と `castProposalToSubmitting(ctx: SystemTenantCtx, { proposalId, now })`（`SUBMITTING` / `NOT_FOUND` / `NOT_APPROVED` / `GATE_STALE`）。**別実装を書かない**（承認 CAS と同じ SQL 述語 `passedReviewGateExistsSql` を使っている）。`GATE_STALE` は `sendHoldReasonKey='GATE_STALE'` の保留（§10.4 / §10.5。`SUBMIT_FAILED` にしない）、`NOT_APPROVED` は「多重実行 / 状態違い」として**外部 API を呼ばずに終了**。
  2. `castProposalToSubmitting` は `ProposalEvent(STATE, APPROVED → SUBMITTING, actorUserId=null)` を同じトランザクションで書く。**`SendAttempt` の INSERT（④。T-09-05）と `AuditLog(proposal.submit)`（⑥）は書かない** —— 送信ジョブ側で足す。`SUBMITTING → SUBMITTED / SUBMIT_FAILED` の確定（⑥。所有者 `SEND_JOB`）は本タスクでは未実装。
  3. 🔴 `tests/static/auth-db-callers.test.ts` の `castProposalToSubmitting` 許可リストは空。**`apps/worker/src/jobs/send-proposal.ts`（1 ファイル）を足す**。`apps/web/**` からは決して参照しない（独立した `it` が 0 件を固定している）。
  4. `send.proposal` の事前判定 ①-a（テナント状態）は `packages/domain` の `isExecutableTenantLifecycleState`（`TENANT_EXECUTABLE_LIFECYCLE_STATES` = `SANDBOX` / `ACTIVE`。T-09-04 で `gate.run` の自動承認に使ったのと同じ 1 実装）を使う。 🔴 **渡す値は `tenants` から読んだ `lifecycle_state` であり `ctx.lifecycleState` ではない** —— `SystemTenantCtx.lifecycleState` は常に `'ACTIVE'` 固定（`packages/db/src/context.ts`）なので、ctx の値を渡すと停止中テナントでも送信できてしまう（`gate-run.ts` が同じ `select` で読んでいるのと同じ形にする）。結合テストに「`SUSPENDED` で `castProposalToSubmitting` が呼ばれない」を入れる（T-09-04 のレビュー申し送り、2026-09-16）。
  5. E2E #10 の「再検証なしで送信できない」の**送信側アサーション**（承認後に `proposals.content_hash` をずらした提案に #43 を叩いても `SUBMITTING` に入らず `GATE_STALE` の保留になる）を `tests/e2e/home.mobile.spec.ts` の T-09-04 の続き、または送信の spec に足す。
  6. `S-021` の primary を「承認する」から切り替える場合（`proposals.approval.action.approve`）、**押した瞬間に「送信済み」と見せない**（`docs/05` §6.5 T-09-03 の決着）。
  7. ⚠️ `contentHash` 素材は `v4`（careers 入り）。**T-09-03 以前に E2E / 開発 DB に残った `v3` の行は承認・送信で `GATE_STALE` になる**（fail-closed。再検証で復帰。`docs/05` §11.5「版の切り替え」）。E2E のシードは毎回作り直すので影響しない。
- 🔴 **T-09-05 からの申し送り（2026-09-16。`docs/05` §10.1「T-09-05 の実装の決着」）**:
  1. **④ は `reserveSendAttempt(ctx: SystemTenantCtx, { entityType: 'PROPOSAL', entityId, origin, now })`**（`packages/db/src/send.ts`）。**ジョブは `attempt_seq` を採番しない** —— payload の `attemptSeq` を `SendAttemptOrigin` に写す（`1` → `{ kind: 'INITIAL' }` / `≥ 2` → `{ kind: 'RESEND', attemptSeq, requestedBy }`）。🔴 したがって **`send.proposal` の payload に `requestedBy: string | null` を足す**（`docs/05` §9.4 の `{ tenantId, proposalId, attemptSeq }` への追加。#43 / #44〔T-09-08〕とも操作者の `User.id`。seq 1 = `INITIAL` では無視される）。`origin` の不整合（`RESEND` で `requestedBy` 無し等）は `SendAttemptOriginError`（実装バグ。保留にも失敗にもしない）。
  2. **戻り値は `{ outcome: 'RESERVED', token } | { outcome: 'ALREADY_RESERVED', existing }`。** `ALREADY_RESERVED` は例外ではなく「同じ試行が既に送信中 / 確定済み」であり、**外部 API を呼ばずに終了する**（`docs/05` §10.2 ④）。`existing.status` が `RESERVED` なら別の実行が送信中、`SUCCEEDED` / `FAILED` / `UNKNOWN` なら確定済み。
  3. 🔴 **② の遅延判定に `readSendAttempt(ctx, { entityType: 'PROPOSAL', entityId, attemptSeq: payload.attemptSeq })` を含め、行が既にあれば CAS の前に終了する。** 含めないと、古い重複ジョブが ③ `castProposalToSubmitting` を通った直後に ④ で `ALREADY_RESERVED` になり、`SUBMITTING` のまま誰も確定しない行が残る（`docs/05` §10.6 の滞留と同じ形）。
  4. **⑤ は `deps.emailSender.send({ …, token })`**（`EmailSendInput.token` は `SendAttemptToken | DispatchToken` で必須。`email-send.ts` の `dispatchTokenFor` と同じ位置）。🔴 `as SendAttemptToken` を書かない（`tests/static/send-attempt-token-single-path.test.ts` が `apps/**` で 0 件を固定する）。
  5. **⑥ は `settleSendAttempt(ctx, token, { status: 'SUCCEEDED', externalId, now })` / `{ status: 'FAILED' | 'UNKNOWN', failureKind, failureDetail?, now }`** を **`Proposal` の確定（`SUBMITTING → SUBMITTED / SUBMIT_FAILED`。T-09-07）と同じ手順の中**で呼ぶ。`ALREADY_SETTLED` は上書きしない。`failureDetail` にトークン・宛先・本文を載せない（500 文字で切られる）。
  6. 🔴 `tests/static/auth-db-callers.test.ts` の許可リストは **`reserveSendAttempt` / `settleSendAttempt` に `apps/worker/src/jobs/send-proposal.ts` を足す**（`castProposalToSubmitting` と同じ 1 ファイル）。**`nextSendAttemptSeq` は `apps/web/**`（#43 の実装ファイル）に足し、`apps/worker/**` には決して足さない**（独立した `it` が 0 件を固定している）。🔴 **#43 も #44 も `nextSendAttemptSeq(ctx, { entityType: 'PROPOSAL', entityId })` を呼ぶ**（レビュー指摘で訂正、2026-09-16）。戻り値 1 なら `INITIAL`、2 以上なら `RESEND`（`requestedBy = ctx.userId`）を payload に載せる。既に試行がある `APPROVED` に #43 が来るのは「前回の失敗を #44 で了承済みで、seq N+1 のジョブが ④ に到達せず保留（`GATE_STALE` / ②-a の 30 分超過等）になった」場合であり、`docs/05` §10.5「保留は自動復帰しない。人間が `S-021` / `S-022` から再度『送信』を選ぶ」の復帰経路そのものである。**409 にしない**（409 にすると seq 1 FAILED → #44 → 保留 → #43 が 409 / #44 は `APPROVED` なので 422、で誰も送れなくなる）。同じ `attemptSeq` の重複 enqueue は BullMQ の `jobId` と ②（`readSendAttempt`）③④ が 1 回に収束させる。T-09-06 の結合テストに「`SUBMIT_FAILED` → #44 → seq 2 ジョブを `GATE_STALE` 保留 → #43 が 202 で `attemptSeq: 2` を返し `send_attempts` は増えない」を入れる。
  7. §17.3 #23 の「`SendAttempt` は提案ごとに 1 行」は、`PROVIDER_QUOTA` の保留が **① で CAS の前に止まる**（④ に到達しない）ことで成立する。保留 → `send.hold-release` → 再 enqueue でも `attemptSeq` は同じ（`docs/05` §10.4）。

- ✅ **決着（2026-09-16。T-09-06）**: `docs/05` §6.5「#43 と `send.proposal` の実装の決着（T-09-06）」/ §9.4 / §10.4 / §10.5 のとおり。#43 は enqueue するだけで状態を動かさず（202 + `{ outcome, attemptSeq, jobId, state: 'APPROVED', sendHoldReasonKey }`。`state: 'SUBMITTING'` のスケッチは採らず、行の状態を返す）、ドメイン未検証は **202 + `DOMAIN_UNVERIFIED` の保留**（ガードの 422 ではなく、`send.hold-release` が検証後に自動復帰させるため）。`send.proposal` は §10.2 の順序どおりで、`jobId = send.proposal.{proposalId}.{attemptSeq}` + `removeOnComplete: true`（型で必須）、`DEFER` は同じジョブの `moveToDelayed`、④ `ALREADY_RESERVED` は `SUBMIT_FAILED(RESERVATION_CONFLICT)`、⑥ は `settleProposalSubmission`（`SendAttempt` と `Proposal` を 1 tx）。`send.hold-release` の `Proposal` 側は `email_dispatches` 側と同じ実行に統合し、`PROVIDER_QUOTA` は 1 本に混ぜて古い順。監査は `proposal.submit` の USER（要求）/ SYSTEM（確定）の 2 行（独自 action を作らない）。結合テスト `tests/isolation/send-proposal.test.ts`（20 件）+ E2E `home.mobile.spec.ts`（ハーネスに Redis を追加。worker は無い = Issue #47 の既定値）。⚠️ **設計上の齟齬 2 件を Issue 起票に回す**: ①送信ジョブの ①-d は環境で免除しない（免除すると ⑤ でモックを含む単一経路が分類 3 の `fromDomain: null` を拒否し `SUBMIT_FAILED` に落ちる。`sandbox` で検証不要を成立させる設計が要る）②添付の実体は送っていない（`EmailSendInput` に添付が無い。CLEAN の再確認はパートナー所有版の限定経路が要る）。
- 🔴 **T-09-06 からの申し送り（2026-09-16）**:
  1. **T-09-07 へ**: `UNKNOWN` の確定経路（`SendAttempt.status='UNKNOWN'` + `SUBMIT_FAILED`。`ExternalSendError(UNKNOWN)` と分類できない例外の両方）は本タスクで実装済み（`send-proposal.ts` の `classifySendError` / `settleProposalSubmission`）。残るのは **E2E #8**（応答不明 → `SUBMIT_FAILED` → 自動再送されない → 人手再送で 1 回）と、`A-005` 用の「`SUBMITTING` 滞留」（`settleProposalSubmission` が `PROPOSAL_NOT_SUBMITTING` を返した / ⑤ の後に DB 例外で throw した行）の運用手順。モックに「応答不明を再現するモード」を持たせるのは T-09-07（結合テストは `throwingSender` で代用した）。
  2. **T-09-08 へ**: #44 は `nextSendAttemptSeq`（`HumanTenantCtx`）で採番し、`send.proposal` の payload `{ tenantId, proposalId, attemptSeq, requestedBy: ctx.userId, enqueuedAt: now.toISOString() }` を `requireSendProposalJobQueue().enqueue(...)` に渡す（#43 の `requestProposalSubmission` と同じ形。`BLOCKED_BY_FAILED_JOB` は 409 `SEND_JOB_BLOCKED`）。🔴 **`SUBMIT_FAILED → APPROVED` の `ProposalEvent` に `actorUserId = 人間` を必ず書く** —— `send.hold-release` が seq ≥ 2 の保留を復帰させるとき、`resolveProposalSendResumeOrigin` はこの記録から `requestedBy` を復元する（無ければ `SendAttemptOriginError` で復帰しない）。`AuditLog` は `proposal.resend`（§16.1）。`S-022` は `listSendAttempts` で試行ごとの `status` / `failureKind` / `externalId` を描き、`RESERVATION_CONFLICT` の行は「試行の記録を確認してから再送」と案内する。`tests/static/auth-db-callers.test.ts` の `nextSendAttemptSeq` に `resend` の実装ファイルを足す。
  3. **T-09-09 へ**: `HostProposalView.sendHold`（`{ reasonKey, since } | null`）は本タスクで基底 view に足した（**`PartnerProposalView` には無い**。型テストが固定）。#45 / #46 はこれを基に足す。#46 が入ったら `S-021` のポーリングは `router.refresh()`（現状）から #46 の `GET` に置き換えてよい。`S-019` の一覧では保留を `SUBMIT_FAILED` と**別の表示**にする（`docs/04` 申し送り 8 / §10.4「失敗率の指標に混入させない」）。`ProposalEvent.note` の印は `SEND_FAILURE:<failureKind>`（確定時の失敗）を `S-023` の履歴で「送信失敗（種別）」として描く。
  4. **T-09-11 へ**: E2E ハーネスに Redis は足した（`tests/e2e/harness/redis.ts`）。**worker を立てる**（Issue #47 の既定値 = 設計は T-09-11）と、`development` の E2E テナントに**検証済みの送信ドメイン行**を用意すること（送信ジョブの ①-d は環境で免除しない。行が無いと `DOMAIN_UNVERIFIED` の保留で止まる）。E2E #7（2 回起動で外部 1 回 = `callCount()`）/ #9（保留 → 検証 → 自動復帰）/ #10 送信側（`GATE_STALE`）はブラウザ経路ではここで初めて通る。
  5. **SP-11 T-11-04 へ**: `A-005` 項目 14（送信保留の理由別内訳）は `proposals(send_hold_reason_key, send_hold_since)` を読む（部分インデックス `proposals_send_hold_idx`）。`RESERVATION_CONFLICT` の `SUBMIT_FAILED` は「未対応の `SUBMIT_FAILED`」に数える。`send.hold-release` の戻り値 `sendHoldsBlocked`（failed 記録に阻まれた件数）は失敗ジョブ数と並べて出す。
  6. **Issue 起票（オーケストレーター）**: 上の ⚠️ 2 件（`sandbox` のドメイン免除とモックの `fromDomain` / 添付の実体と CLEAN 再確認の限定経路）。

- ✅ **T-09-06 の決着（2026-09-16）**: #43 は enqueue のみ（202。既に試行がある `APPROVED` は seq N+1）。`send.proposal` は §10.2 の順序（①②を CAS の前に。保留は `APPROVED` + 属性。④ `ALREADY_RESERVED` は外部を呼ばず `SUBMIT_FAILED(RESERVATION_CONFLICT)`。⑤ は tx 外。⑥ は 1 tx）。`jobId = send.proposal.{id}.{seq}` + `removeOnComplete: true` を型で必須化。`send.hold-release` に `Proposal` 側を統合（`GATE_STALE` は SQL で除外）。`S-021` primary は「送信する」→ 202 後は「受け付けました。送信中です」。code-reviewer 1 回: 二重送信の交錯を全経路で辿り外部 2 回に至らず。REQUEST_CHANGES 1 件（payload の `tenantId` 改竄で他テナントに到達しない結合テストの追加）→ 追加し 21/21。**人間判断へ**: [Issue #57](https://github.com/Festal-KM/SES-Platform/issues/57)（非本番で送信が `DOMAIN_UNVERIFIED` 保留で止まる。既定 = 現状維持、`T-10-06` 着手前まで）/ [Issue #58](https://github.com/Festal-KM/SES-Platform/issues/58)（添付の実体。既定 = 送らない）。**レビュー申し送り（任意）**: `send-proposal-holds.ts` の `resolveProposalSendResumeOrigin` が `SendAttemptOriginError` を投げると同一テナントの他の保留の復帰がその回は飛ぶ —— 行単位で捕捉して `sendHoldsBlocked` に数える形を T-09-07 で検討。

### T-09-07 応答不明時の隔離と `SUBMIT_FAILED` の確定（M）

- **実装**: `docs/05` §10.6。
- 🔴 **`SUBMITTING` は片道である。入ったら必ず `SUBMITTED` か `SUBMIT_FAILED` に確定させる。`SUBMITTING` のまま自動で `APPROVED` に戻る経路は存在しない**（`F-022 AC-2` / `CLAUDE.md` §4.2）。
- **応答不明（タイムアウト等）は `SUBMIT_FAILED` に確定させ、人間の再送に委ねる**（自動判断しない。`docs/01` 章 5.3 の T9）。
- 🔴 **`SUBMIT_FAILED` は `LOST` / `GATE_FAILED` / `DECLINED` と別の状態として保持される**（`F-022 AC-6` / `BR-23`）。
- **完了の判定**: E2E #8（応答不明 → `SUBMIT_FAILED` → 自動再送されない → 人手再送で 1 回だけ送信）。

### T-09-08 送信失敗の一覧と人手再送（M）

  8. **`send.proposal` の `jobId` を `{proposalId}:{attemptSeq}` の冪等キーにする場合の注意**: `externalSendQueue` は `removeOnComplete` を持たないため（`packages/connectors/src/queues.ts`）、保留 → `send.hold-release` の「同じ `attemptSeq` で再 enqueue」（§10.4 / §12.6）が completed 記録に静かに捨てられる（`gate.run` が `removeOnComplete: true` にしたのと同型）。`queue-attempts.test.ts` がキューのオプションを固定しているので、**設計として先に決める**（`docs/05` §9.4 / §10.4 に決着を書く）。
  9. `SendAttemptOriginError` は ④ の入口で投げられる。③ の後に投げると `SUBMITTING` のまま行が無い滞留になるため、**payload の `origin` 整合（seq ≥ 2 なら `requestedBy` 必須）は ① の Zod 検証で先に落とす**。
  10. `nextSendAttemptSeq` は取引先文脈でも呼べてしまう（`send_attempts` は C2 HOST_ONLY なので常に 1 が返る = 黙って誤った採番。ジョブ側の ② で止まるため二重送信にはならない）。#43 / #44 は `requireRole(OWNER/ADMIN/SALES)` で取引先を先に弾くこと。`HostTenantCtx` への型の狭め込みは T-09-06 で同時に行ってよい。

- **実装**: `POST /api/proposals/{id}/resend`（#44）。画面は `S-022`（Tier 2）。
- 🔴 **再送を自動的に起動する仕組み・設定・ジョブが存在しない**（`F-023 AC-1` / `docs/05` §6.8）。
- 🔴 **`acknowledged` が `true` でなければ 400**（`F-023 AC-2`）。**再送の実行前に「届いている可能性がある」旨の確認を表示する。**
- **再送時は新しい `attempt_seq`（= 新しい `idempotency_key`）を採番し、`F-022` の手順を再度実行する。**
- 再送の指示者・日時・理由を `AuditLog` に記録する（`F-023 AC-3`）。
- **静的テスト**: `Proposal` の `SUBMIT_FAILED → APPROVED` を呼ぶコードが `resend/route.ts` 以外に無いことを AST で検査する（`docs/05` §10.6。Phase 3 の `contract-resend-human-only.test.ts` と**対**にする）。
- **完了の判定**: `F-023 AC-1`〜`AC-3` の結合テスト + 静的テスト。
- ✅ **決着（2026-09-16。T-09-08）**: `docs/05` §6.5「#44 と `S-022` の実装の決着（T-09-08）」のとおり。#44 は `{ acknowledged: true, reason }`（`false` は 400 `RESEND_NOT_ACKNOWLEDGED`、欠落は 400 `VALIDATION`）→ `nextSendAttemptSeq` → 1 tx（3 段 → `SUBMIT_FAILED → APPROVED` の CAS → `ProposalEvent(actorUserId = 人間, note = 'RESEND:<理由>')` → `AuditLog(proposal.resend, { attemptSeq, previousFailureKind, reasonLength〔自由入力の文字数。本文は載せない〕})`）→ #43 と共有の尾部 `enqueueProposalSend`（`submit.ts` から切り出し。ドメイン未検証は 202 + `DOMAIN_UNVERIFIED` の保留）→ 202（#43 と同じ形）。`SUBMIT_FAILED → APPROVED` を起こすコードは `lib/proposals/resend.ts` の 1 実装で、`tests/static/proposal-resend-human-only.test.ts` が 5 パターンの AST 検査 + `apps/worker/**` / `packages/**` 0 件 + ジョブ名に `resend` / `retry` 無しを固定。`S-022`（`/proposals/send-failures`。Tier 2）は `listProposalSendFailures`（`SUBMIT_FAILED` 専用。保留中の `APPROVED` は出ない。試行は `externalId` を含む）+ `send-failure-rows.ts`（`failureKind` → `docs/04` の 6 語 + 競合。**応答不明は失敗と別の語・別の色**。3 回超で運営への案内。詳細パネルと確認ステップに試行ごとの記録を描く `SendFailureAttemptList`）+ 確認ステップ（届いている可能性 + 再掲 + 試行ごとの記録 + チェック + 理由）→ 202 後は `S-021` へ。一括再送は置かない。結合 `tests/isolation/proposal-resend.test.ts`（同時 2 回の #44 を含む 11 件）/ render 7 件 / ユニット 2 本 / E2E は `home.mobile.spec.ts` の続き（シーム `settleProposalSendAsFailedForE2e`）。
- 🔴 **T-09-08 からの申し送り（2026-09-16）**:
  1. **T-09-07 へ**: E2E #8 の通し（応答不明 → `SUBMIT_FAILED` → 自動再送されない → 人手再送で 1 回）の**人手再送側は `S-022` / #44 が揃った**。残るのは「応答不明を再現するモックのモード」と worker（T-09-11）。`harness/db-admin.ts` の `settleProposalSendAsFailedForE2e`（送信ジョブの ⑥ と同じ列で `UNKNOWN` + `SUBMIT_FAILED` を作る）は worker が入ったら実経路に置き換えてよい。`A-005` の「未対応の `SUBMIT_FAILED`」は `proposals(state='SUBMIT_FAILED')` を数えればよく、`S-022` と同じ母集団である（保留を混ぜない）。
  2. **T-09-09 へ**: ①`apps/web/lib/proposals/send-failures.ts` の `listProposalSendFailures` は `S-022` が要る最小の一覧（`where: { state: 'SUBMIT_FAILED' }` + `send_attempts` の結合）。#45（`GET /api/proposals?state=...`）を作るときに**統合する**（`S-022` の行が要るのは提案先 / 凍結側のエンジニア名 / 案件名 / `lastFailureReason` / `failedAt` / 試行の要約）。②`S-019` の一覧では `SUBMIT_FAILED` を保留（`APPROVED` + `sendHoldReasonKey`）と**別の表示**にし、`SUBMIT_FAILED` の行から `S-022` へ導線を置く（`docs/04` §S-019「送信失敗の行から `S-022` へ」）。③`S-023` の履歴は `ProposalEvent.note` の `RESEND:<理由>` を「再送（理由）」として描く（`SEND_FAILURE:<failureKind>` の対）。④`S-003` の要対応キュー（送信失敗）は `PROPOSAL_SEND_FAILURES_PATH`（`lib/proposals/hrefs.ts`）へ。⑤一括再送（デスクトップのみ。`docs/04` §S-022）は本タスクでは置いていない —— 置くなら「確認は 1 件ずつの内容を列挙」を満たす設計が先。
  3. **レビュー申し送り（任意）**: `S-022` の失敗理由の畳み込み（`classifySendFailureKind`）は SES の例外名に依存する（`packages/connectors/src/email/ses/errors.ts` の `PERMANENT_CODES` / `THROTTLED_CODES` と同じ語）。コネクタ側で名前を足したら `send-failure-rows.ts` にも反映する（両者を 1 実装にする案は `packages/connectors` → `apps/web` の依存方向のまま可能だが、画面の語の判断を connector に置かない方を採った）。

### T-09-09 提案一覧・詳細・履歴（M）

- **実装**: `GET /api/proposals`（#45）/ `GET /api/proposals/{id}`（#46）/ `POST /api/proposals/{id}/events`（#47）。画面は `S-019` / `S-023`（Tier 2）。
- 🔴 **4 つの「うまくいかなかった」を別の表示にする**（`docs/02` `ui-design` 申し送り 6 / `BR-23` / `BR-60`）: `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `DECLINED`。**一覧のフィルタ・集計・通知のすべてで別の語・別の区分。いずれか 2 つが同じ区分にまとめられる表示が存在しない**（`F-024 AC-2`）。
- 🔴 **`byState` は境界適用後**（`docs/05` §4.8）。
- 🔴 **`PartnerProposalDetailView` に `duplicateFindings` が存在しない**（`F-037 AC-1` / `BR-08`。**重複提案の検知は Phase 2 だが、型の分離は本タスクで行う** — 後から足すと漏れる）。
- 🔴 **パートナーが参照できる提案履歴は自社が作成した提案に限られる**（`F-024 AC-3`）。
- **完了の判定**: `F-024 AC-2` / `AC-3` の結合テスト + 型テスト。

- **T-09-03 からの申し送り（2026-09-16）**: 却下（#42）は `DRAFT` に戻すが `review_gates` の DONE / PASS 行は残るため、**内容を変えずに #39 を再依頼すると 422 `GATE_ALREADY_COMPLETED`**（`docs/05` §11.10 ⑤。fail-closed）。誤って却下した場合は何かを編集する必要がある。`S-023` の履歴・`S-020` の導線の文言にこの事実を反映するか、本タスクで判断する。
- ✅ **決着（2026-09-16。T-09-09）**: `docs/05` §6.5「#45 / #46 / #47 と `S-019` / `S-023` の実装の決着（T-09-09）」のとおり。#45 は `listProposals`（`lib/proposals/list.ts`。`state[]` は `ProposalState` の 14 値だけ / `projectId` / `engineerId` / `q` = 提案先の社名・案件名の部分一致 / ID カーソル。応答 `{ items, total, byState, requestsByState, nextCursor }` で、**`byState` は 14 キー必須・境界適用後・状態フィルタ抜き**、**`DECLINED` は `requestsByState`（`ProposalRequest`）の別ブロック**、保留中の `APPROVED` は `APPROVED` に数え行の `sendHold` で別表示。行は一覧用の別の型 `HostProposalListItem` / `PartnerProposalListItem`。T-09-08 の `listProposalSendFailures` は本関数に統合〔`S-022` は `state: ['SUBMIT_FAILED']` + 内部オプション `order: 'UPDATED_ASC'`〕）。#46 は `readProposalDetail`（`HostProposalDetailView` / `PartnerProposalDetailView` = 基底 view + `snapshot.careers`〔凍結側〕/ `events`〔`lib/proposals/events.ts` が書き手の接頭辞で 7 種に分類。取引先には再送の理由・失敗の種別を伏せる〕/ `createdByName` / `submittedAt`、ホストだけ `approval` / `sendAttempts` / `lastFailureReason`。🔴 **`PartnerProposalDetailView` に `duplicateFindings` / `owner` / `sendHold` / `approval` / `sendAttempts` が無い**ことを型テスト + 結合テストの深さ走査で固定）。`S-021` の送信中ポーリングは #46 の `GET` に置き換えた。#47 は `createProposalNote`（`{ kind: 'NOTE', note }` の 1 値。**`proposals` を UPDATE しない**〔`state` / `updated_at` 不変〕。`ProposalEvent(NOTE, from = to = 現在)` + `AuditLog(proposal_event.create, summary = { kind })`〔本文を載せない〕。作成者 / ホストの 3 ロール、`VIEWER` 403、`requireExecutable`）。`S-019`（`/proposals`。`(list)` ルートグループ）は 14 状態の独立チップ + 提案依頼の別ブロック + 保留の注記 + `SUBMIT_FAILED` ≥ 1 のときだけ `S-022` 導線。`S-023`（`/proposals/{id}`）は固定ヘッダ / `S-021` と同じ判断ヘッダ / 履歴の 9 種の描き分け〔自動承認 = 「システム（全層 PASS のため）」〕/ 凍結内容〔経歴は凍結行 + 日時〕/ ゲート結果 / 状態別の導線〔🔴 却下由来の `DRAFT` は「内容を変更してからレビューに出してください」= T-09-03 の申し送り〕/ メモ追加。`targetType` の読み取り側は 3 列とも既存の 1 定数（`GateTargetType` / `PROPOSAL_SEND_ENTITY_TYPE` / 新設 `PROPOSAL_AUDIT_TARGET_TYPE`）に揃えた。結合 `tests/isolation/proposal-list-detail.test.ts`（12 件。Redis 不要）/ 型 + ユニット 5 本 / render 2 本（16 件）/ E2E は `home.mobile.spec.ts` の続き（`S-019` → `S-023` → メモ → `S-022`）。ホーム（`S-003` / `S-004`）に `S-019` への導線を足した。
- 🔴 **T-09-09 からの申し送り（2026-09-16）**:
  1. **T-09-10 へ**: `S-023` の商談中（`SUBMITTED` / `INTERVIEW_SCHEDULED` / `INTERVIEWED` / `RESULT_PENDING`）の導線は `proposalInterviewHref(id)` = `/proposals/{id}/interview`（`lib/proposals/hrefs.ts`）を指す**リンクだけ**が置いてある。`S-024` はこの URL に置くこと（変えるなら `hrefs.ts` の 1 箇所）。#48 の `note` は `ProposalEvent.note` にそのまま入り、`S-023` の履歴は `TRANSITION` の `detail` として描く（接頭辞は付けない —— 付けると `events.ts` の分類に新しい印が要る）。`WON` の `S-025` 導線は Phase 3。
  2. **T-09-11 へ**: E2E の `S-019` / `S-023` の掴み手は `proposal-list-row-{id}` / `proposal-list-state-chip-{STATE}`（`data-failure-kind`）/ `proposal-detail`（`data-proposal-state`）/ `proposal-detail-timeline` の `[data-event-kind=...]`。シナリオ 1 の「結果記録（`WON`）」の後は `S-023` の履歴で `TRANSITION` の連なりを確かめられる。worker が入ると `S-021` の送信中ポーリング（#46）が `SUBMITTING → SUBMITTED` を実際に拾うので、E2E #7 の送信側は `proposal-approval` の `data-proposal-state` が `SUBMITTED` になるまで待てばよい（`router.refresh()` の定期実行ではなく #46 の差分で発火する）。
  3. **SP-12（Phase 1 hardening）へ**: ① 🔴 **`audit_logs.target_type` の表記の統一** —— `'Proposal'`（`apps/web/lib/proposals/{approval,gate,resend,service,submit,transition}.ts` のローカル定数 `PROPOSAL_TARGET_TYPE` と `packages/db/src/{proposal-approval,proposal-send}.ts`）と `'PROPOSAL'`（`apps/worker/src/jobs/gate-run.ts` の `GATE_RESULT` / `packages/db/seed/presets/isolation.ts` の一部）が混在している。書き込み側を `PROPOSAL_AUDIT_TARGET_TYPE`（`@ses/db`。T-09-09 で新設）に寄せ、既存行を `UPDATE audit_logs SET target_type = 'Proposal' WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%'` で移行する（`S-041` に対象種別フィルタを足す前に）。② **`S-019` の一括承認**（`docs/04` §S-019「一括操作（ホスト）」。デスクトップのみ）は置いていない —— `S-021` の「プレビューの末尾まで確認するまで承認できない」（`F-021 AC-4` / `BR-49`）と両立する設計（1 件ずつの判断材料の列挙）が先。③ `S-023` の「ゲート結果の履歴」（`docs/04` §S-023 セクション 4「実行ごとの層別結果」）は**現在の結果（#40）だけ**を描いている。実行ごとの履歴は `review_gates` を `target_id` で複数行読む API（#40 の拡張）が要る。④ `S-003` の要対応キュー（承認待ち / 送信失敗 → `S-022`）は未実装（SP-10 の範囲）。`S-022` への URL は `PROPOSAL_SEND_FAILURES_PATH` を使うこと（T-09-08 の申し送り④を引き継ぐ）。⑤ 取引先の `S-023` 履歴に**ホストの承認者の表示名**が出る（`users` の C8 DIRECTORY はホスト所属の行を全員に見せる設計であり、`ProposalEvent` の実行者名のための意図された開示）。`approval`（承認記録）は型から外してあるが、履歴の主体名まで伏せるかは `docs/05` §4.4 C8 の判断事項として確認する。
  4. **レビュー申し送り（任意）**: `listProposals` の `q` はリレーション越しの案件名一致（`project: { name: freeWordFilter(q) }`）を含む。`projects` の C4 が効くので取引先に公開されていない案件名では一致しないが、索引は効かない（`freeWordFilter` の注記どおり段階 1）。件数が増えたら `search-sql-single-path` の経路に載せる。

### T-09-10 商談結果の記録（M）

- **実装**: `POST /api/proposals/{id}/transition`（#48）の商談部分。画面は `S-024`（**Tier 1**）。
- **記録する遷移**: `SUBMITTED` → `INTERVIEW_SCHEDULED` → `INTERVIEWED` → `RESULT_PENDING` → `WON` / `LOST`。`SUBMITTED` / `INTERVIEW_SCHEDULED` / `INTERVIEWED` / `RESULT_PENDING` からの `WITHDRAWN`。
- 🔴 **結果（`WON` / `LOST` / `WITHDRAWN`）はシステムが自動で確定しない。人間の操作でのみ確定する**（`F-025 AC-1`）。**業務基盤の外（電話・対面）で決まる事実であり、システムは推測してはならない。**
- 🔴 **`LOST` は `SUBMIT_FAILED` / `GATE_FAILED` / `DECLINED` と別に集計される**（`F-025 AC-3`）。
- **`WON` の確定により `Assignment` が生成できる状態になる**（`F-025 AC-2`。Phase 1 は記録のみ。**Phase 2 の `F-042` で接続する**）。
- **面談調整の連絡（`F-041`）は Phase 2**（SP-15）。Phase 1 は日程の**記録**のみ。
- 各記録を `ProposalEvent` と `AuditLog` に残す。
- **完了の判定**: `F-025 AC-1`〜`AC-3` の結合テスト + `S-024` のモバイル操作の E2E。
- ✅ **決着（2026-09-16。T-09-10）**: `docs/05` §6.5「`S-024` の実装の決着（T-09-10）」のとおり。新しい API は作らず `S-024`（`/proposals/{id}/interview`。`proposalInterviewHref`）が #48 の `MANUAL` の商談部分を呼ぶ。操作の出し分けは `interview-rows.ts` が **遷移表 × #48 の射程 × `canTransitionProposal`（#48 の第 3 段と同じ関数）** から導き、取引先には `SUBMITTED → INTERVIEW_SCHEDULED` / `WON` / `LOST` のボタンが描かれない（⚠️ 取引先の商談部分は **6 本**〔実施 / 結果待ち + 4 状態からの辞退〕。「5 本」は数え間違いで、集合は変えていない）。`note` は `interview-note.ts` が「面談日程: … / 面談実施: … / 結果: 決定（…）/ 結果: 見送り（…）/ 辞退（…）」と利用者の入力 + 固定の語だけで組む自由記述（接頭辞なし。単価・本文・氏名を混ぜる入力面が無い）。終端（`WON` / `LOST` / `WITHDRAWN`）は確認ステップ。`WON` 後は `Assignment` を作らず Phase 2 の注記だけ。**自動確定は無い**ことを `tests/static/proposal-outcome-human-only.test.ts`（結果の値をリテラルで書き込む記述は非テストソースに 0 件 / worker に結果の語が無い / `proposal.` で始まるジョブ名が無い）が固定。結合 `tests/isolation/proposal-interview.test.ts`（13 件）/ ユニット 2 本（28 件）/ render 1 本（13 件）/ E2E は `home.mobile.spec.ts` の末尾に `devices['iPhone 15']`（Chromium）の test を 1 本足した（`SUBMITTED → … → WON` を画面から完遂。前提の「送信済み」はシーム `settleProposalSendAsSucceededForE2e`）。
- 🔴 **T-09-10 からの申し送り（2026-09-16）**:
  1. **T-09-11 へ**: シナリオ 1 の「面談日程 → 面談実施 → 結果確定（`WON`）」は `S-024` から進める。掴み手は `proposal-interview`（`data-proposal-state` / `data-audience` / `data-can-record`）→ `proposal-interview-operation-{SCHEDULE|INTERVIEWED|RESULT_PENDING|WON|LOST|WITHDRAWN}`（`data-to` / `data-terminal`）→ `proposal-interview-form`（`data-operation`）の `proposal-interview-scheduled-at`（`datetime-local`。`fill('2026-10-01T14:00')`）/ `proposal-interview-interviewed-on`（`date`）/ `proposal-interview-memo` → `proposal-interview-note-preview`（送る文字列そのもの）→ `proposal-interview-submit`。終端は `proposal-interview-confirm`（`data-operation`）→ `proposal-interview-confirm-submit`。成功は `proposal-interview-result`（`data-result` = 遷移先）で、`router.refresh()` 後に `data-proposal-state` が動く（#48 の応答を `waitForResponse` で掴んでから待つと安定する。`home.mobile.spec.ts` の `waitTransition`）。終端後は `proposal-interview-closed`（`data-closed-state`）+ `WON` だけ `proposal-interview-won-note`。`S-023` 側は `[data-event-kind="TRANSITION"]` が 4 本。worker を立てるなら `settleProposalSendAsSucceededForE2e` は不要になる（#43 → 送信ジョブで `SUBMITTED` に確定させ、そこから `S-024` へ）。
  2. **T-09-11 へ（取引先）**: 取引先の `S-024` は自社提案だけ（他社は `proposal-interview-not-found`）。`data-audience="PARTNER"` + `proposal-interview-partner-notice`。日程の確定・結果の確定は描かれず、API 直叩きは 403 `PROPOSAL_TRANSITION_FORBIDDEN`。
  3. **SP-12（Phase 1 hardening）へ**: ① `docs/05` §6.5「#48 の実装の決着」の「取引先は … 5 本」の記述を 6 本に訂正する（`pm` の文書整備。実装は 6 本で一致している）。② `S-024` の日時入力は `datetime-local` の壁時計をそのまま `note` に書く（TZ を持たない記録）。面談調整の連絡（`F-041`。Phase 2 SP-15）で日時を構造化して送るときは、`ProposalEvent.note` の自由記述ではなく別の列 / 型で持つこと（`note` を正規表現で読まない）。③ `S-024` の「直近の履歴 3 件」は #46 の `events` 全件を読んで末尾 3 件を切り出している（提案 1 件の履歴は多くて数十行なので現状は問題ないが、履歴が肥大したら #46 に `limit` を足す）。

### T-09-11 🔴 Phase 1 成功条件 1・2 の E2E（L）

- **実装**: `tests/e2e/proposal-cycle.spec.ts`（`docs/05` §17.3 #3 / #4 / #7 / #8 / #9 / #10 / #13 / §12.1）。
- 🔴 **前提（2 件。どちらも欠けると本タスクは原理的に緑にならない。ヘッダの着手条件と同じもの）**: ①**[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) の解消** —— **パートナーが作成した提案がゲートを通ること**（シナリオ 1 の「パートナーが提案 → ゲート実行」がここで止まる）②~~**`T-07-11` の完了**~~ ✅ **配線は済んでいる（2026-09-10、`89545bb`）。残るのは 🔴 E2E ハーネスに Redis と `gate.run` ワーカーを足すこと** —— **`tests/e2e/harness` は PostgreSQL と MinIO だけであり（`docs/05` §11.12 ⑦）、このままではブラウザ経路の提案が `GATE_RUNNING` のまま永久に待つ**。**これは本タスク自身の作業である**（`T-07-11` の話ではない。混同しない）。
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

0. 🔴 **着手条件 ① / ②（ヘッダ）が解消済みである** — ①[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41)（パートナー所属エンジニアの提案のゲート）が決着し、**パートナーが作成した提案がゲートを通る** ②✅ **`T-07-11`（ワーカーの起動配線）は完了済み（2026-09-10、`89545bb`）** —— 🔴 **代わって残るのは、`T-09-11` が E2E ハーネスに Redis + `gate.run` ワーカーを足し、ブラウザ経路から `gate.run` が実際に走ること**（`docs/05` §11.12 ⑦）。🔴 **この 2 つは 2〜3 の前提であり、欠けたまま「実装は終わった」とはできない**（`docs/dev-plan.md` §3.2 / §4.1 / §8 の 2026-09-09 の行 / §9 の #41 / `Q-07-1` / `Q-07-2` の行）。
1. `F-019` / `F-021` / `F-022` / `F-023` / `F-024` / `F-025` の全 AC が結合テストで green。
2. 🔴 **T-09-11 のシナリオ 1 が green** — 「案件登録 → 公開 → 提案 → ゲート → 承認 → 送信 → 結果記録」を E2E で完遂できる（`CLAUDE.md` §5 成功条件 1）。
3. 🔴 **T-09-11 のシナリオ 2 が green** — **ゲート FAIL の提案が送信できない**（`CLAUDE.md` §5 成功条件 2）。force / override の API・設定・導線が存在しない。
4. 🔴 **送信が冪等**（2 回起動で外部 1 回）。`send.*` の `attempts` が 1 で固定され、型で他の値を設定できない。
5. 🔴 **`SUBMITTING` は片道で、自動リトライ・自動再送の仕組み・設定・ジョブが存在しない。** 再送は人間の明示操作のみで、確認を必ず挟む。
   - 🔴 **保留（`sendHoldReasonKey`）は「自動再送」ではない。** 外部を 1 回も呼んでいないため `BR-22` の射程外であり、`DOMAIN_UNVERIFIED` / `PROVIDER_QUOTA` は `send.hold-release` が自動復帰させてよい（`GATE_STALE` は対象外）。**失敗（`SUBMIT_FAILED`）と保留を混同しない。**
6. 🔴 **承認後に内容が変わると再検証なしに送信できない。**
7. 🔴 **モバイルビューポートで承認の判断材料が省略されず、一括承認が既定でない。**
8. `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `DECLINED` が独立にフィルタ・集計できる。
