# SP-08 anonymous-share — 匿名共有と提案依頼（越境経路 4）

> **Phase**: 1（MVP） / **前提**: SP-06（複合検索・案件） / **後続**: SP-09
> **一次資料**: `CLAUDE.md` §3.1 経路 4 / §5 / §9-13 / `docs/01` `BR-53`〜`BR-59` / `docs/02` `F-016` `F-017` `F-018` / A-04 / `docs/03` §4.13 / `docs/04` `S-015`〜`S-018` `S-016` / `docs/05` §4.5 / §4.6 / §12.2
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-08`
> 🔴 **並走タスク（SP-07 からの持ち越し。2026-09-09）**: **`T-07-11`（ワーカーの起動配線とスケジュール基盤）を本スプリントと並走で実施してよい。** SP-07 では「今つないでもどの環境でも動かない」ため見送った（`docs/05` §11.12 ⑧）。🔴 **遅くとも SP-09 の先頭までに完了させる。SP-09 より後ろに置いてはならない** —— `gate.run` の Worker が無主のままではブラウザ経路の **E2E #3 / #4 / #23** が成立せず、`CLAUDE.md` §5 の Phase 1 成功条件 1・2 に到達できない。**本スプリントのタスク（`T-08-01`〜）とは独立で、依存も無い**（匿名共有はジョブを使わない）ため、**着手が遅れても本スプリントの完了判定には影響しない**。詳細と受け入れ基準は `docs/sprints/SP-07-ai-layer-gate.md` §4 T-07-11、持ち主は `docs/dev-plan.md` §3.2 / §4.1 / §8 の 2026-09-09 の行。**タスク ID は `T-07-11` のまま変えない**（`CLAUDE.md` §8.8）。
> 🔴 **もう 1 件の着手条件（2026-09-09 に追加）**: **[Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43)（Tailwind CSS / shadcn/ui が未導入）の決着。** `CLAUDE.md` §2 は UI を「Tailwind CSS + shadcn/ui」と確定させているが、SP-03〜SP-07 の画面は素の CSS で実装されている。🔴 **`S-015`〜`S-018` を素の CSS で作ってから入れ替えると、そのぶんだけ UI 実装のやり直しになる**ため、**本スプリントの画面タスク着手前に決着させる**（既定 = UI 基盤スプリントを差し込む。`docs/dev-plan.md` §9）。<br>✅ **決着した（2026-09-10）: 既定どおり `SP-21 ui-foundation` を新設し、実行順を本スプリントの直前（SP-07 の直後）に置いた**（`docs/sprints/SP-21-ui-foundation.md` / `docs/dev-plan.md` §3.2.1）。🔴 **したがって本スプリントの画面タスク（`S-015`〜`S-018`）は SP-21 の完了後に着手する。** ⚠️ **番号は 21 だが実行順はここである**（既存 ID を振り直さないための採番。`CLAUDE.md` §8.8 / `PM-A-09`）。🔴 **第 1 回リリースが Phase 1 完了（SP-12 の後）になったため（[Issue #46](https://github.com/Festal-KM/SES-Platform/issues/46)）、素の CSS のままリリースを迎えることはあり得ない。**<br>✅ **`SP-21` は 2026-09-11 に完了した**（`T-21-01`〜`T-21-07` の 7 / 7。CI run **`34553246355`** green。`docs/sprints/SP-21-ui-foundation.md` §8）。🔴 **したがって本スプリントの画面タスクは着手可能であり、`S-015`〜`S-018` は Tailwind ユーティリティと `@ses/ui`（`packages/ui`）で作る** —— `.ses-*` の手書き className は 0 件、`apps/web/app/globals.css` は**存在しない**。🔴 **2 本目の CSS を足さない**（`apps/web/app/tailwind.css` が唯一のスタイルシートである）。🔴 **SP-21 から 2 件の申し送りタスクを受け取った: `T-08-10`（`docs/04` §S-005 の食い違い。**`T-08-05` より前**）と `T-08-11`（ラベル折り返し検出器の常設化。スプリント末）**（§4）。
> ✅ **着手条件が 1 つ解消した（2026-09-10）: [Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5)（匿名 5 項目の丸め粒度）に人間の回答「OK です」が届き、`docs/03` §4.13.1（= `docs/02` A-04）の粒度で確定した。** 内訳は **経験年数 5 段階 / 単価 10 万円刻み・100 万円以上打ち止め / 稼働可能時期 5 段階 / 勤務地は都道府県 + リモート 3 値 / スキルは辞書名の上位 8 件**、**k-匿名性の件数閾値は Phase 1 では入れない**。🔴 **したがって本スプリントは「暫定値で実装し、後で人間確認」ではなく「確定値で実装する」。** ⚠️ **これは `CLAUDE.md` §5 が Phase 1 のリリース条件と定める再識別リスク評価（`R-1`）の承認そのものである**（承認者は事業責任者単独。[Issue #18](https://github.com/Festal-KM/SES-Platform/issues/18) = 回答 ①）。**承認の事実と根拠の記録は `T-12-06` が持つ**（`docs/sprints/SP-12-phase1-hardening.md`）。🔴 **粒度を実装で勝手に変えないこと** —— 変えたくなったら `docs/03` §4.13.1 の改訂と再承認から始める（`CLAUDE.md` §8.6 / §8.7）。
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-015`〜`S-018`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**全 88 枚が生成済みである**（2026-09-03。[Issue #17](https://github.com/Festal-KM/SES-Platform/issues/17) = A の決着後に残り 82 枚を生成し、`docs/04` 改訂 5 の `S-046` 分 3 枚を追加した）。**本スプリントの着手条件は満たされている。** 画面の新設・改訂で不足が生じた場合のみ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

🔴 **`CLAUDE.md` §5 の Phase 1 成功条件の 3 つ目**を成立させる — 「パートナーが共有可にしたエンジニアが**ホストの検索結果に匿名 5 項目でのみ現れ、`Proposal` が作成されるまで実名・所属会社名・スキルシートに到達できない**ことをテストで証明できる」。

経路 4 は「ホストが取引先の人材を能動的に探せる」唯一の経路であり、🔴 **開き方を誤ると台帳を丸ごと読めるのと同じになる**（`CLAUDE.md` §3.1）。本スプリントは**開示を増やさないこと**が実装の主目的である。

## 2. 対応機能 ID

`F-016`（共有設定 / パートナー側）/ `F-017`（匿名候補の表示と丸め / ホスト側）/ `F-018`（提案依頼）

## 3. 事前確認（🔴 リリース条件 R-1）

✅ **2026-09-10 に決着した**（ヘッダの ✅ 行。回答「OK です」= `docs/03` §4.13.1 の粒度で確定。**T-08-01 は確定値で実装済み**）。**以下は決着前の記述であり、消さずに残す**（`CLAUDE.md` §9 の規約）。**残るのは `T-12-06` での根拠の記録のみ。**

🔴 **[Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5)（匿名 5 項目の丸め方）は本スプリント着手時点で未回答である**（`docs/dev-plan.md` §5 E-9 / §9）。

- **既定値で進める**: `docs/03` §4.13.1（= `docs/02` A-04）の丸め方をそのまま実装する。
- **ブロッカーではない**が、🔴 **Phase 1 のリリース条件（R-1）であるため、SP-12 の T-12-06 で人間の承認を得るまで Phase 1 を閉じない。**
- 丸めの粒度は 🔴 **`packages/config/src/anonymize.ts` に定数として外出しし、関数の外から差し替えられるようにする**（`docs/05` TBD-2）。回答が来たときに丸め関数を書き換えずに済む。

## 4. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-08-01 | 🔴 **匿名 5 項目の丸め（純粋関数）** | 丸め規則どおりの粒度でのみ表示。`7 年` / `65 万円` / `渋谷区` / 具体日付が出ない | `F-017 AC-3` / A-04 | L |
| T-08-02 | 共有設定の opt-in / 解除（`F-016`）と `S-015` | 🔴 **新規登録直後は必ずオフ。一括で全件オンにする既定操作が存在しない** | `F-016 AC-1` `AC-2` `AC-4` | M |
| T-08-03 | 共有スコープ読み取りと匿名候補の生成 | 🔴 ホストは `engineer_shares` の**行を読めない**。真偽値のみ | `BR-56` / `P-A-14` | L |
| T-08-04 | 案件スコープの参照子と `AnonymousCandidateView` | 🔴 同一人物であることを**案件をまたいで突合できない** | `F-017 AC-2` / `BR-55` | M |
| T-08-05 | 検索結果への混在（`S-016`） | 2 本のクエリを**アプリ層で決定的にマージ**。Phase 1 はスコア表示なし | `F-009` / `F-017 AC-7` | L |
| T-08-06 | 提案依頼の発行・取り下げ（ホスト側）と `S-017` | 依頼メッセージに商流情報を含めない。確定単価の入力欄が無い | `F-018` / `F-017 AC-4` | M |
| T-08-07 | 提案依頼の応諾・辞退（パートナー側）と `S-018` | 🔴 **応諾と `Proposal(DRAFT)` の生成を同一トランザクション**で行う | `F-018 AC-3` | L |
| T-08-08 | `DECLINED` / `EXPIRED` の区別と理由の非開示 | 🔴 辞退理由がホストの画面・API・通知・エクスポート・集計に現れない | `F-018 AC-1` `AC-2` `AC-4` `AC-5` | M |
| T-08-09 | 経路 4 の E2E（#5 / #6） | 🔴 **Phase 1 成功条件 3 の証明** | `CLAUDE.md` §5 / `F-017 AC-6` | M |
| 🔴 **T-08-10** | 🔴 **`docs/04` §S-005「デバイス別」と実装の食い違いの解消**（SP-21 からの申し送り。**実行順は `T-08-05` より前**） | 🔴 **文書と実装が一致する。** `ui-design` による `docs/04` の改訂か実装の修正かが決定され、根拠とともに記録されている | `docs/04` §S-005 / §11-2 / `CLAUDE.md` §8.7 / `docs/sprints/SP-21-ui-foundation.md` §8.6 | S |
| 🔴 **T-08-11** | 🔴 **ラベル折り返し検出器の常設化**（`expectNoBrokenLabels`。SP-21 からの申し送り。**実行順はスプリント末**） | 🔴 **既存 12 spec から呼ばれ、テスト本数が増えない。** 🔴 **申し送りの `scrollWidth` / `scrollHeight` の式だけを移植していない** | `CLAUDE.md` §13.3 / `docs/sprints/SP-21-ui-foundation.md` §8.5 | S〜M |

🔴 **`T-08-10` / `T-08-11` は本スプリントの機能 ID（`F-016` / `F-017` / `F-018`）に紐づかない横断タスクである**（2026-09-11 に SP-21 の完了確認から新設）。**番号は末尾だが実行順は上表のとおりであり、`T-08-10` は `T-08-05` より前、`T-08-11` はスプリント末である**（`docs/dev-plan.md` `PM-A-09`「SP 番号・タスク番号は採番順であって実行順ではない」。`T-09-12` / `T-09-13` と同じ扱い）。**完了判定では §7 の 9 / 10 として、匿名共有の成立とは別枠で数える。**

## 5. タスク詳細

### T-08-01 🔴 匿名 5 項目の丸め（純粋関数）（L）

- **実装**: `packages/domain/src/anonymize/rounding.ts`（**純粋関数 1 つに閉じる**。`docs/05` §4.6 / TBD-2）。粒度の定数は `packages/config/src/anonymize.ts`。
- **丸め規則**（`docs/03` §4.13.1 / `docs/02` A-04 / `F-017 AC-3`）:
  - **スキル** — 辞書の正規化済み名称のみ。フリーテキスト不可。**上位 8 件まで**（経験年数の降順、同順は辞書 ID 順の決定的な順序）
  - **経験年数** — 5 段階（`1 年未満` / `1〜3 年` / `3〜5 年` / `5〜10 年` / `10 年以上`）
  - **単価** — **10 万円刻み**のレンジ（例 `60〜70 万円`）。上限は `100 万円以上` で打ち止め
  - **稼働可能時期** — 5 段階（`即日` / `当月中` / `翌月` / `翌々月` / `3 か月以降`）
  - **勤務地** — **都道府県のみ**（市区町村・沿線・駅名を出さない）+ リモート可否 3 値（`フルリモート可` / `一部リモート可` / `常駐のみ`）
- 🔴 **なぜこの粒度か**（`docs/03` §4.13.1）: 単価を 10 万円刻みに粗くしたのは**単価と稼働可能時期の組み合わせが個人を最も強く特定する**ため。スキルに上限を設けたのは**スキルの組み合わせが事実上の指紋になる**ため。
- 🔴 **開示する項目そのものを 5 から増やさない**（`BR-54` / `CLAUDE.md` §8.6）。**スキルの上位 8 件は項目の追加ではなく 1 項目内の粒度である。**
- 🔴 **k-匿名性による件数閾値は Phase 1 では入れない**（母集団が小さい立ち上げ期にほとんど表示されなくなり、経路 4 が使えない機能になるため。`docs/02` A-04 / `docs/03` §4.13.2-4）。一意率は運営平面の監視指標として出す（SP-11）。
- 🔴 **並び替えのキーに使う更新日時も日単位に丸めて表示する**（`docs/03` `ui-design` 申し送り 3 / §4.13.2-2）。
- **完了の判定**: `F-017 AC-3` のユニットテスト（例: 経験年数 7 年 → `5〜10 年`、単価 65 万円 → `60〜70 万円`、勤務地「東京都渋谷区」→ `東京都`。`7 年` / `65 万円` / `渋谷区` / `2026-09-16` がいずれも出力に現れない）+ 決定性テスト。
- ✅ **完了（2026-09-10、コミット `cf5ee3b`。同日の `70efaf1` で `docs/03` §4.13.1 / `docs/05` §4.6 の型定義を実装に追随）** — `packages/domain/src/anonymize/rounding.ts`（純粋関数。`Date` を作らず基準日と粒度の境界を引数で受ける）+ 粒度定数 `packages/config/src/anonymize.ts`（🔴 **[Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5) の確定値**。暫定ではない）。区分値は `ANONYMIZED_YEARS_BANDS`（5 段階）/ `AnonymizedPriceBand`（`RANGE` 10 万円刻み・`OPEN` 100 万円以上）/ `AnonymizedAvailabilityBand`（5 段階）/ `AnonymizedRemoteMode`（3 値）+ 都道府県コード + 辞書名の上位 8 件。**丸め後の型 `RoundedAnonymousAttributes` に生値のフィールドが存在しない**（開示を増やさないことを型で固定）。ユニット `rounding.test.ts` / `packages/config/src/anonymize.test.ts`（境界値 + 決定性）。

### T-08-02 共有設定の opt-in / 解除（M）

- **実装**: `GET /api/engineer-shares` / `PUT /api/engineers/{id}/share`（#29）。画面は `S-015`（Tier 2。取引先向け）。
- 🔴 **`PARTNER_ADMIN` / `PARTNER_SALES` のみ。ホストは 403。** ホスト側ロールはこの設定を変更できない（主導権は最後までパートナーにある）。
- 🔴 **エンジニア新規登録直後の共有設定は必ずオフ。一括で全件をオンにする既定操作が存在しない**（`F-016 AC-1` / `BR-53`）。
- 🔴 **共有停止の操作は即時に反映され、その時点でホストの候補一覧から消える**（`F-016 AC-2`）。**キャッシュ等による遅延表示も含めて現れない。**
- 共有の開始・停止を `AuditLog` に記録（`F-016 AC-4`）。
- 🔴 **他のパートナーは、あるパートナーが共有している候補の存在・件数を知る手段を持たない**（`F-016 AC-5` / `BR-56`）。
- **画面の空状態**: 「共有している人材はいません」（**煽らない**。`docs/04`）。
- **完了の判定**: `F-016 AC-1`〜`AC-5` の結合テスト（**共有停止の直後にホストが検索して 0 件**を含む）。
- ✅ **完了（2026-09-11、コミット `eae1086`）** — `GET /api/engineer-shares` / `PUT /api/engineers/{id}/share`（#29。`apps/web/lib/engineer-shares/{service,schemas,policy}.ts`）と `S-015`（`apps/web/app/(main)/engineer-shares/engineer-share-screen.tsx`。Tailwind + `@ses/ui`。**共有可にする操作は丸め後 5 項目のプレビューを見せる確認ステップを挟む**〔`docs/04` §S-015〕）。結合テスト `tests/isolation/engineer-shares.test.ts`（実 DB + 実 Route Handler）が固定するもの: 🔴 **`AC-1`** = `POST /api/engineers` 直後に `engineer_shares` の行が無い / **一括で全件をオンにする経路が存在しない**（コレクションに書き込みメソッドが無い） / 🔴 **主導権** = ホスト 3 ロール 403・`VIEWER` 403・他パートナーのエンジニアは 404（行もできない） / **`AC-4`** = `engineer_share.create` / `update` の監査（`summary` に氏名・単価・スキルを載せない。**冪等な no-op は記録しない**） / 🔴 **`AC-5` / `BR-56`** = A1 が共有しても A2 の一覧に 1 件も現れず件数も動かない。ホスト文脈から `engineer_shares` の行が 1 件も読めない（C3） / 🔴 **`AC-2`** = 停止直後にホストの検索で 0 件（件数にも出ない）+ **`cache-control: no-store`** / **`previewedFields` のキー集合が固定**され、丸める前の値（65 万円 / 稼働可能日 / 市区町村）が応答に現れない。⚠️ **[Issue #49](https://github.com/Festal-KM/SES-Platform/issues/49) を起票**（停止中〔`SUSPENDED` / `CLOSING`〕のテナントに属するパートナーは `requireExecutable()` により共有を**解除できない**。`CLAUDE.md` §3.1「いつでも解除でき」との緊張。既定 A = 現状維持。回答 C なら変更点は `app_engineer_is_shared()` の述語 1 箇所だけ）。

### T-08-03 共有スコープ読み取りと匿名候補の生成（L）

- **実装**: `docs/05` §4.5 / `P-A-14`。
- 🔴 **`EngineerShare` は C3 に属し、ホストからは行を読めない。** ホストが得られるのは `app_engineer_is_shared()`（`SECURITY DEFINER`）が返す**存在の真偽だけ**である。
- 🔴 **専用ロール `app_share_probe` の権限は `engineer_shares` の 3 列の `SELECT` だけ**（SP-02 の T-02-09 テスト #10 が固定）。
- 🔴 **ホストが匿名候補を得る経路は `MatchCandidate`（C2）だけ**であり、その行は `withSharedCandidateScope` で作る。**`withSharedCandidateScope` の外で `app.shared_scope` を立てられない**（`$executeRaw` の ESLint 禁止 + `withTenant` が毎回 `SET LOCAL app.shared_scope = 'off'` で上書き）。
- 🔴 **理由**（`P-A-14`）: 代替案「`engineer_shares` にホスト向けの追加 SELECT ポリシー」は行（`partner_company_id` / `shared_by`）がホストに見え **`BR-06` に抵触する**ため退けた。**越境経路は増えていない**（経路 4 の DB 側実装を確定させただけ）。
- **完了の判定**: SP-02 の二重防御テスト #6 / #7 が実データで green（ホスト文脈で `app.shared_scope='on'` を立てて `engineer_shares` を直接 SELECT しても 0 件）。
- ✅ **完了（2026-09-11、コミット `2f585fd`）** — `packages/db/src/shared-candidate.ts`（`withSharedCandidateScope`）+ `scope-settings.ts`（`app.shared_scope` の GUC は `sharedCandidateScopeSettingsSql` の 1 箇所だけが立て、`withTenant` を含む他経路が毎回 `'off'` で上書き）+ migration `20260916000000_shared_candidate_scope`（`app_engineer_is_shared()` = `SECURITY DEFINER`、所有者 `app_share_probe`、`engineer_shares` の **3 列 `SELECT` のみ**）。静的: `withSharedCandidateScope` の named import を ESLint で禁止 + `tests/static/auth-db-callers.test.ts` の許可リストで `apps/**` の参照元を固定。結合: `tests/isolation/shared-candidate-scope.test.ts`（二重防御 #6 / #7 の実データ版 + **`SharedCandidateDb` の全メンバーを実 DB で走査**）。<br>🔴 **レビューが実 DB で再現した実バグ（初回実装を差し戻し）**: `SharedCandidateDb` に素の Prisma デリゲート（`matchCandidate`）を載せていたため、**ホストが `select: { engineer: { select: { displayName, ownerPartnerCompany: { select: { name } } } } }` のリレーション経由で共有エンジニアの実名と共有元パートナーの ID・社名を取得できた。** すべてのテスト（型テスト・RLS・Prisma 拡張）を素通りしていた。原因は 4 つ: ①**RLS は行を守るが列を守れない**（②で開けた行は全列ぶん開く）②**Prisma の `$allOperations` はネストしたリレーション読み取りでは走らない** ③`Pick<delegate, 'findMany'>` は `select` / `include` の型を保持する ④`@ts-expect-error db.engineer` 型テストはリレーション経由を構造上捕まえられない。→ **`SharedCandidateDb` は用途ごとの専用メソッドだけを公開し、引数・戻り値をスカラーと固定形の DTO に限る**（`select` / `include` を受け取る型を表面に出さない）。**回帰は実 DB テストが全メンバーについて実測する**（`docs/05` §4.5 に記録）。🔴 **越境経路は増えていない**（`P-A-14`）。

### T-08-04 案件スコープの参照子と `AnonymousCandidateView`（M）

- **実装**: `docs/05` §4.6 / `docs/03` `program-design` 申し送り 13 / `docs/02` `program-design` 申し送り 7。
- 🔴 **参照子は `HMAC(ANON_REFERENCE_HMAC_SECRET, project_id ‖ engineer_id)` の先頭 16 バイト。** `engineer_id` を応答に載せない。**案件が違えば別の参照子になる。**
- 🔴 **`AnonymousCandidateView` の型に、実名・所属会社名・社内 ID・営業メモ・スキルシート・詳細な経歴の並びのフィールドが存在しない**（`undefined` ではなく型が違う。`F-017 AC-1`）。
- 🔴 **同一の匿名候補が複数の案件の候補一覧に現れても、それが同一人物であることをホストが突き合わせられる識別子・値の組が応答に含まれない**（`F-017 AC-2` / `BR-55`）。
- 🔴 **`GET /api/candidates/{candidateRef}`（詳細エンドポイント）を作らない**（`docs/05` §6.8）。**詳細エンドポイントは 5 項目を超える経路になる。**
- **完了の判定**: `F-017 AC-1` / `AC-2` の結合テスト + 型テスト。E2E #6（同一候補が複数案件で異なる参照子）。
- ✅ **完了（2026-09-11、コミット `ab5b949`）** — `apps/web/lib/anonymize/reference.ts`（`HMAC-SHA256(ANON_REFERENCE_HMAC_SECRET, project_id ‖ engineer_id)` の先頭 16 バイト。鍵は起動時 DI で受け、`engineer_id` は応答に載せない）+ `candidate-view.ts`（`AnonymousCandidateView` と `ANONYMOUS_CANDIDATE_VIEW_KEYS`。**5 項目 + 参照子 + 日単位の更新日の 8 キーだけが型として存在する**）+ `labels.ts`。型テスト `candidate-view.test.ts` / 結合 `tests/isolation/anonymous-candidate-view.test.ts`（JSON を深さ 8 まで走査し `FORBIDDEN_KEYS` が 0 件。**実装の定数と型の一致**）/ 静的 `tests/static/forbidden-api-routes.test.ts`（🔴 **`GET /api/candidates/{candidateRef}` のルートが存在しない**。App Router のディレクトリ走査で固定）。🔴 **並び順からの突合も塞いだ** —— 同一候補が 2 案件で同じ相対位置に出ると参照子が違っても突き合わせられるため、並びを `updatedOn`（日単位）降順 → `candidateRef` 昇順とし、**同日更新の候補の相対順序が案件ごとに変わる**ことをテストで固定した（`candidate-view.test.ts:245`）。`index` / `rank` / `position` のフィールドは型として作らない（`F-017 AC-2` / `BR-55`）。

### T-08-05 検索結果への混在（L）

- **実装**: `GET /api/engineers`（#15）と `GET /api/projects/{id}/candidates`（#30）に `AnonymousCandidateView` を混在させる。画面は ~~`S-005` /~~ `S-016`（Tier 2）。⚠️ **暫定。[Issue #50](https://github.com/Festal-KM/SES-Platform/issues/50) で確認中（2026-09-14）: 既定 A = 匿名候補は `S-016` にだけ出す。`#15` は `?projectId=` が渡されたときだけ混ぜ、`S-005` は渡さない**（参照子が案件スコープであり、案件が無いと定義できない。`docs/04` `U-14` / `docs/05` §6.4「#15 の実装の決着（T-08-05）」）。
- 🔴 **匿名候補の検索は「自社スコープ」「共有スコープ」の 2 本のクエリに分け、アプリ層で決定的な順序でマージする**（`docs/03` `program-design` 申し送り 18）。**1 本のクエリにまとめると越境の実装が 1 箇所に集まらない。**
- 🔴 **Phase 1 は `F-009` の決定的な並び順の中に自社エンジニアと混在させる。スコア・順位・重みの表示が存在しない**（`F-017 AC-7`）。**Phase 2 で `F-029` のスコア順に並ぶ際も、開示項目は 5 項目のまま変わらない。**
- 🔴 **パートナー所属の利用者の画面に匿名候補が 1 件も現れない**（`F-017 AC-5` / `BR-56`）。`#30` はパートナーには 1 件も含まない。
- 🔴 **Phase 1 の画面に重み設定を置かない**（`F-030 AC-4`。`S-040` は Phase 2）。
- **完了の判定**: `F-017 AC-5` / `AC-7` の結合テスト + マージ順序の決定性テスト（10 回実行で一致）。
- ✅ **完了（2026-09-15、コミット `5d304af`。付随 `57d001a` = CI の MinIO イメージ取得先を quay.io へ〔Docker Hub の pull access denied〕）** — `GET /api/projects/{id}/candidates`（#30）と `GET /api/engineers?projectId=`（#15。🔴 **`projectId` が無ければ匿名候補は 1 件も混ざらない**）。`apps/web/lib/candidates/{list,list-rows}.ts` + `packages/db/src/search/anonymous-candidates.ts`（**自社スコープ / 共有スコープの 2 本のクエリをアプリ層で決定的にマージ**。応答に `phase: 'P1'`、スコア・順位・重みのフィールド無し）。画面 `S-016`（`apps/web/app/(main)/projects/[id]/candidates/**`。匿名候補の行の表示名は「共有候補」の一語、右パネルは 5 項目 + 依頼の導線のみ、`/engineers/{id}` への導線が要素ごと無い）。パートナーには #30 が 1 件も含まない（`F-017 AC-5`）。結合 `tests/isolation/project-candidates.test.ts` / ユニット `apps/web/lib/candidates/list.test.ts`（決定性）。<br>🔴 **設計書に無かった再識別チャネルを実装者が発見して塞いだ**（[Issue #51](https://github.com/Festal-KM/SES-Platform/issues/51) `assumption`）: 匿名候補への検索条件を**生値の SQL 述語**で評価すると、`yearsMin=7` で当たり `yearsMin=8` で外れる、という**当たり方の差から「7 年」が復元できる**（単価は 1 万円刻み、稼働開始日は 1 日刻みで二分探索できる —— 丸めは表示にしか効かない）。→ `packages/domain/src/anonymize/criteria.ts`（純粋関数）で**丸め後の区分に対して「その区分の中に条件を満たしうる値があるか」で評価**し、🔴 **開示していない属性（フリーワード `q` / 稼働状況）は匿名候補に対して評価しない**（関数が引数に取らない = 渡せないものは評価できない）。`docs/02` `F-009` / `F-017` に追記、`A-25`。<br>⚠️ **[Issue #50](https://github.com/Festal-KM/SES-Platform/issues/50) を起票**（匿名候補を `S-005` にも混ぜるか。`CLAUDE.md` §3.1「マッチング結果にのみ」と §5「複合検索の結果に混在」の読みが割れる。**既定 A = `S-016` にだけ出す**で実装。`docs/04` §S-005 / `U-14`、`docs/05` §6.4「#15 の実装の決着」に暫定注記。B へ変えるときは `S-005` に案件セレクタを足して `projectId` を渡すだけで済む形にしてある）。

### T-08-06 提案依頼の発行・取り下げ（ホスト側）（M）

- **実装**: `POST /api/proposal-requests`（#31）/ `GET /api/proposal-requests`（#32）/ `POST .../withdraw`（#35）。画面は `S-016` / `S-017`（Tier 1）。
- 🔴 **`requireExecutable` を通す**（テナントが `SUSPENDED` / `CLOSING` なら拒否。`F-004 AC-7` / `AC-8`）。
- 🔴 **依頼メッセージに商流情報を含めない**（`F-018` 入力）。
- 🔴 **匿名候補に対して確定単価の入力・交渉・見積の操作が存在しない**（`F-017 AC-4` / `BR-58`）。表示は単価レンジのみ。
- 🔴 **`HostProposalRequestView` に `declineReason` フィールドが存在しない**（`F-018 AC-1`。型が違う）。
- **Phase 1 の通知手段はアプリ内表示**（Phase 2 で `F-039` に集約）。
- **完了の判定**: `F-018` の状態遷移テスト（`REQUESTED` → `WITHDRAWN_BY_HOST`）+ 型テスト。
- ✅ **完了（2026-09-15、コミット `fc12d52`）** — `POST /api/proposal-requests`（#31）/ `GET /api/proposal-requests`（#32。契約は `{ items, nextCursor }` の 2 キーだけ）/ `POST .../{id}/withdraw`（#35）。`apps/web/lib/proposal-requests/{service,schemas,policy,views,message-check,list-rows,detail-rows}.ts`。画面 `S-017`（`apps/web/app/(main)/proposal-requests/**`。Tier 1。取り下げは右パネル〔モバイルでは一覧の下〕で確認 1 段）。🔴 **`requireExecutable` を通す**（`SUSPENDED` / `CLOSING` は 409）。🔴 **依頼メッセージに単価・エンド企業名が含まれると 422**（`message-check.ts`。照合に `@ses/ai` の `mask()` を使う —— 商流情報の検出規則を 2 実装にしない）。🔴 **`HostProposalRequestView` に `declineReason` / `engineerId` / `partnerCompanyId` / `respondedBy` / `issuedBy` が型として存在しない**（`views.types.test.ts`）。**参照子を知っているだけでは依頼が成立しない**（`candidateRef` は capability ではない: 呼び出し元がホストであること + 参照子が**この案件**の `MatchCandidate` に一致すること + **その時点で共有中**であることをすべて通す。逆引き `candidateRef` → `engineer_id` は `withSharedCandidateScope` の中でサーバ側だけが行い、`engineer_id` を応答に載せない。依頼先 `partner_company_id` はアプリ層で決めず共有スコープの中で確定する）。結合 `tests/isolation/proposal-requests.test.ts`。<br>🔴 **レビューが検出した実バグ（テストは素通り）**: 本タスクで `apps/web` に `@ses/ai` の依存を足したことで、**`createAiClient` / `createRoleRunner` などの AI 実行系を `apps/web` から Lint エラーなしに import できる状態**になっていた（従来は依存が無いこと自体が `CLAUDE.md` §3.2「アプリコードから SDK を直接呼ばない」の担保だった）。→ `tests/static/ai-single-path.test.ts` に 🔴 **許可リスト方式の静的走査**を追加（`apps/web` が `@ses/ai` から import できるのは `mask` / `MASK_CATEGORIES` / `MASK_PLACEHOLDERS` と型だけ。named import / namespace import / dynamic import / re-export の 4 形を fixture で固定。**バレルに実行系の名前が増えても、許可リストに無い名前は既定で落ちる**）。<br>⚠️ **[Issue #52](https://github.com/Festal-KM/SES-Platform/issues/52) を起票**（取り下げ後に同じ候補へ再依頼できるべきか。現行は `@@unique([tenantId, projectId, engineerId])` により **1 案件 × 1 候補につき 1 回**。既定 = 現状維持）。

### T-08-07 提案依頼の応諾・辞退（パートナー側）（L）

- **実装**: `POST /api/proposal-requests/{id}/accept`（#33）/ `decline`（#34）。画面は `S-018`（Tier 1。取引先向け）。ジョブ `proposal-request.expire`（毎日 03:20 JST。`REQUESTED` かつ `expiresAt <= now` → `EXPIRED`）。
- 🔴 **`ACCEPTED` 遷移と `Proposal(DRAFT)` の生成を同一トランザクションで行う**（`docs/02` `program-design` 申し送り 12 / `F-018 AC-3`）。**片方だけ成立する状態を作らない。**
- **本タスクで `createProposalDraft()` プリミティブを作る**（`Proposal(DRAFT)` + `EngineerSnapshot` の凍結）。🔴 **SP-09 の `POST /api/proposals`（#36）はこのプリミティブを再利用する。2 実装にしない。**
- 🔴 **`ACCEPTED` になるまで、実名・所属会社名・スキルシートに到達できない。`ACCEPTED` と同時に `Proposal(DRAFT)` が 1 件生成され、その時点で開示される**（経路 2 に合流。`F-018 AC-3`）。
- 🔴 **`CLAUDE.md` §4.2 に無い遷移は `InvalidStateTransitionError`（HTTP 422）で拒否する。サイレントに無視しない。**
- **パートナーには辞退する自由がある**（`BR-57`）。辞退理由は社内限定で記録する。
- **完了の判定**: `F-018 AC-3` の結合テスト（**トランザクション失敗時に両方ロールバックされる**ことを注入テストで確認）+ 422 の遷移テスト。
- ✅ **完了（2026-09-15、コミット `b9fae76`）** — `POST /api/proposal-requests/{id}/accept`（#33）/ `decline`（#34）。画面 `S-018`（`apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.tsx`。Tier 1。取引先向け。辞退理由は自社の記録として読める）。🔴 **`createProposalDraft()` を `packages/db/src/proposal-draft.ts` に単一実装**（`Proposal(DRAFT)` + `EngineerSnapshot`〔実名・最新 `CLEAN` 版のスキルシート・`freezeCareers()`〕+ `ProposalEvent` + 監査を **1 トランザクション**で。**SP-09 の #36 はこれを再利用する。2 実装にしない**）。期限切れジョブ `proposal-request.expire`（`packages/db/src/proposal-request-expiry.ts` + `apps/worker/src/jobs/proposal-request-expire.ts`。毎日 03:20 JST。**`T-07-11`（`89545bb`、2026-09-10）が置いた `apps/worker/src/runtime.ts` の `runScheduled` + テナントファンアウトの既存経路に 6 本目のスケジュールとして乗せた** —— スケジュール宣言は 5 → 6 本、`runtime.test.ts:135` が固定。⚠️ **E2E が `tests/e2e/harness/db-admin.ts` の `expireProposalRequestByDeadline` で期限到来の前提を作るのは、E2E ハーネスに Redis とワーカーが無いため**〔`tests/e2e/harness` は PostgreSQL と MinIO だけ。`docs/05` §11.12 ⑦〕**であり、ワーカーが未配線だからではない**。**この制約は `T-09-11` に残る**）。結合 `tests/isolation/proposal-request-respond.test.ts`（実 DB + 実 Route Handler）が固定するもの: ①🔴 **注入テスト** = `proposal_events` の `INSERT` 権限を一時的に外して `createProposalDraft` の途中で失敗させると、`proposal_requests` / `proposals` / `engineer_snapshots` / `proposal_events` / `audit_logs` の**どれも増えない**（プロダクション経路に seam を置かない）②🔴 **開示の前後比較** = 応諾前はホストの #32 とホスト文脈の `engineers` に実名・所属会社名が 1 文字も無く、応諾後に **`EngineerSnapshot` 経由で初めて**読める（台帳 `engineers` は応諾後もホストから読めない。`F-019 AC-1`）③遷移表に無い応諾・辞退は **422 `INVALID_STATE_TRANSITION`**（状態不変・`Proposal` 無し・`state.invalid_transition` を記録）④同時に取り下げられた依頼（CAS 競合）は 422 ⑤**自社に公開されていない案件への依頼は応諾が 422 `PROPOSAL_REQUEST_PROJECT_NOT_SHARED`、辞退はできる**（`BR-57`）⑥辞退理由は行にだけ在り、監査の `summary` にもホストの #32 のどの深さにも無い ⑦認可（ホスト 403 / 他社 404 / 取引先 `VIEWER` 403 / `SUSPENDED` 409）⑧期限切れジョブは `REQUESTED` かつ期限超過だけを `EXPIRED` にし、2 度目は 0 件（冪等）。<br>⚠️ **申し送り（SP-09 `T-09-01`）**: 応諾で作る `Proposal(DRAFT)` の**提案先は空文字**である（依頼時点では提案先が決まっていない）。#37（`PATCH /api/proposals/{id}`）で提案先を必須入力にし、#39（ゲート実行依頼）で提案先が空の `DRAFT` を 422 で弾き、`docs/04` §S-020「新規は提案先が決まった状態で開く」を `ui-design` が改訂する。

### T-08-08 `DECLINED` / `EXPIRED` の区別と理由の非開示（M）

- **実装**: `docs/05` §4.8 の型の分離を `ProposalRequest` に適用する。
- 🔴 **`DECLINED` の理由がホスト側の画面・API 応答・通知・エクスポート・集計のいずれにも現れない**（`F-018 AC-1` / `BR-57`）。
- 🔴 **ホストは `DECLINED` と `EXPIRED` を区別できるが、`DECLINED` の理由は区別できない**（`F-018 AC-2`）。
- 🔴 **`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` の件数は成約率の分母に入らない**（`F-018 AC-4` / `BR-60`）。**KPI の実装は SP-19（`F-051`）だが、状態の区別は本タスクで確定させる。**
- 🔴 **`GATE_FAILED`（`F-020`）・`SUBMIT_FAILED`（`F-022`）・`LOST`（`F-025`）と `DECLINED` が、一覧のフィルタ・集計・通知のいずれでも別の区分として扱われる**（`F-018 AC-5` / `BR-23`）。**1 つの「失効」にまとめない。**
- 🔴 **パートナーは、同じ候補に他社から提案依頼が来ているかを知る手段を持たない**（`F-018 AC-6`）。
- **完了の判定**: `F-018 AC-1` / `AC-2` / `AC-4` / `AC-5` の結合テスト + 型テスト（`declineReason` がホスト向け型に無い）。
- ✅ **完了（2026-09-15、コミット `f119ab6`。実装変更なし = 既に T-08-06 / T-08-07 で満たされていた区別を型とテストで固定した）** — `packages/domain/src/state/indicators.ts`（🔴 **「成約率の分母に入る状態 / 入らない状態」の唯一の定義**。分母は `SUBMITTED` 以降の 7 状態。`GATE_FAILED` → ゲート不合格率、`SUBMIT_FAILED` → 障害率で**別区分**。🔴 **`ProposalRequest` の 5 状態はこの表に存在せず、`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` を分母に入れる経路は引数の型 `ProposalState` が受け付けない** —— `ProposalRequestState` を渡すコードはコンパイルで落ちる。SP-19 の `F-051` はこの値集合から `WHERE state IN (...)` を引き、独自の配列を作らない）。静的 `tests/static/proposal-request-outcome-separation.test.ts` / 結合 `tests/isolation/proposal-request-outcomes.test.ts`（ホストは `DECLINED` と `EXPIRED` を区別できるが理由は区別できない。一覧のフィルタ・集計・通知で `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` と `DECLINED` が別区分）。パートナーは同じ候補に他社から依頼が来ているかを知る手段を持たない（`F-018 AC-6`。⑦の E2E で A2 の応答がバイト同一）。⚠️ **本タスクは 2026-09-15 のレビュー方針（`CLAUDE.md` §8.3。テストのみ = レビュー省略）によりコードレビューを省略した。**

### T-08-09 経路 4 の E2E（M）

- **実装**: `tests/e2e/anonymous-share.spec.ts`（`docs/05` §17.3 #5 / #6）。
- **シナリオ**（🔴 **`CLAUDE.md` §5 Phase 1 成功条件 3 の証明**）:
  1. パートナー A1 がエンジニア X を登録 → **共有オフ**であることを確認 → 共有可に設定する。
  2. ホストが検索を実行 → **X が匿名 5 項目でのみ現れる**。表示・API 応答・エクスポート・（Phase 2 では）根拠文のいずれにも実名・所属会社名・社内 ID・営業メモ・スキルシート・詳細な経歴の並びが**含まれない**。
  3. 🔴 **`Proposal` が作成される前に実名・所属会社名・スキルシートへ到達できる導線が 1 つも存在しない**（`F-017 AC-6`。露出 0 件）— 画面・API・URL 直打ちのすべてで確認する。
  4. ホストが提案依頼を送る → パートナーが**辞退** → ホスト側に理由が現れない。`DECLINED` と `EXPIRED` が区別できる。
  5. 別の候補で**応諾** → `Proposal(DRAFT)` が 1 件生成され、**その時点で**実名・所属会社名・スキルシートが開示される。
  6. 同一候補が別の案件の一覧にも現れるとき、**参照子が異なり突合できない**（E2E #6）。
  7. パートナー A2 の画面に、A1 の共有候補が **1 件も現れない**（存在・件数とも）。
  8. パートナー A1 が共有を停止 → ホストの検索結果から**即座に消える**。
- **完了の判定**: 8 つすべてが green。**このテストが無い / 赤のままスプリントを閉じない**（K-4。完了確認モードで無条件 NG）。
- ✅ **完了（2026-09-15、コミット `ab762c9`）** — `tests/e2e/anonymous-share.spec.ts`（**8 シナリオ = 8 `test`。`serial` で状態を引き継ぐ**。①〜⑧が §5 の列挙と 1 対 1）。**E2E 合計 43 本**（35 + 8。desktop 23 + 8 / mobile 12）。検証の手口: **API 応答の JSON を深さ 8 まで走査し、許可キー集合（5 項目 + 参照子 + `updatedOn` の 8 キー）の外のキーが 0 件・禁止値（実名 / 連絡先 / 営業メモ / 社内 ID / 共有元の会社 ID・社名・担当者 ID / スキルシートの ID・オブジェクトキー・ファイル名 / 丸める前の単価・稼働開始日 / 辞書 ID）が 0 件**。🔴 **許可キー集合は実装の定数を import せず設計書（`docs/05` §4.6）から独立に持つ** —— 実装側で項目が増えたら E2E が落ちる（開示項目の追加は人間の承認事項）。「ホストは X を識別できない」設計の中でテストが X の行を掴む方法は、**共有元 A1 の操作の前後で #30 の参照子集合を差分する**（差分がちょうど 1 件であることも表明）。⑦は A1 の活動の前後で **A2 の応答がバイト列で同一**。⑧は `cache-control: no-store` まで見る。`S-015`〜`S-018` に `expectNoBrokenLabels` / `expectNoHiddenCountHints` を掛ける（判定は無改変）。合成データ X / Y / Z は API 経由で作り `afterAll` で seed の状態へ戻す（`isolation.spec.ts` ④ T-05-09 の「A1 の台帳は seed の 1 件だけ」を守る）。ハーネス `tests/e2e/harness/db-admin.ts` に `markSkillSheetClean` / `expireProposalRequestByDeadline` / `assertEngineerSnapshotFrozen` / `deleteT0809SyntheticEngineers` のシームを追加。スクリーンショット `tests/e2e/screenshots/S-01{5,6,7,8}-{desktop1440,tablet768,mobile390}-*.png`（12 枚）。**ローカルの Playwright 最終実行は passed**（`test-results/.last-run.json`）。🔴 **CI run `34947464880`（コミット `ab762c9`）success —— E2E 43 本を含む。K-4 の証跡**（初回の完了確認時は run が実行中だったため判定を保留し、同日に success を確認した。§8）。**2026-09-15 のレビュー方針（`CLAUDE.md` §8.3。テストのみ）によりコードレビューは省略した。**

### T-08-10 🔴 `docs/04` §S-005 の食い違いの解消（S。🔴 **実行順は `T-08-05` より前**）

- **背景**（`docs/sprints/SP-21-ui-foundation.md` §8.6。2026-09-11 の SP-21 完了確認で確認された既存の差分。**SP-21 由来ではなく `T-05-09` からの差分である**）:
  - `docs/04:564` §S-005「デバイス別」: **「モバイル = 1 行 = 氏名 + 稼働可能時期 + 主要スキル 2 件の 3 行構成」**
  - 実装（`apps/web/app/(main)/engineers/engineer-ledger-screen.tsx:4-14`）: **同じ 3 項目を 3 列のテーブル**で出し、スキルは**上位 3 件 + `+N`**。理由はコードに記録済み（🔴 **「一覧はカードで並べない」= `docs/04` §11-2「`S-005` は 1 万件規模を前提にしたテーブル」**）。
  - 🔴 **つまり `docs/04` の内部（§S-005 デバイス別 対 §11-2）で食い違っている。** 項目集合も Tier（T2）も一致しているため実害は出ていないが、**文書と実装が食い違ったまま次の実装者が読む状態**である。
- 🔴 **なぜ `T-08-05` より前か**: **`T-08-05` は同じ `S-005` に匿名候補を混在させる**（§5 T-08-05）。**食い違ったままの `docs/04` を入力にすると、実装者は「カードに直す」か「文書を無視する」かのどちらかを黙って選ぶことになる。** どちらも後から追えない。
- **手順**（🔴 **`CLAUDE.md` §8.7。上流の改訂が先**）:
  1. **どちらを正とするかを決める。** 判断材料は 🔴 **`CLAUDE.md` §13.3「Tier 3 をモバイルで非表示にしない / 判断材料を隠さない」**と、**1 万件規模の一覧をモバイルで比較する業務**（`docs/04` §11-2）。⚠️ **`docs/04` の 2 箇所が食い違っている以上、「どちらかが常に正しい」という前提を置かない。**
  2. **`docs/04` を正とするなら実装を直し、実装を正とするなら `ui-design` で `docs/04` §S-005「デバイス別」を改訂する**（併せて §11-2 との整合を明記する）。**改訂したら `/design-iterate ui-design` をかける。**
  3. 決定と根拠を `docs/dev-plan.md` §8 に 1 行で記録する。
- **受け入れ基準**:
  1. 🔴 **`docs/04` §S-005「デバイス別」の記述と `engineer-ledger-screen.tsx` のモバイル表示が一致している。**
  2. 🔴 **Tier（T2）を変えていない**（変えるなら `docs/04` の Tier 表の改訂が先。§13.2）。
  3. 🔴 **モバイルで判断材料（氏名 / 稼働可能時期 / 主要スキル）を落としていない**（`CLAUDE.md` §13.3）。**表示項目の集合を減らす方向の決着を採らない。**
  4. `engineer-ledger-screen.render.test.tsx` と `tests/e2e/settings.mobile.spec.ts` / `projects.mobile.spec.ts` の既存判定（`expectNoHorizontalOverflow` の 1px 許容を含む）を**緩めていない**。
- **完了の判定**: 上記 1〜4 + `docs/dev-plan.md` §8 への記録 + CI green。
- ✅ **完了（2026-09-11、コミット `dbc3e8d`。実行順どおり `T-08-05` より前）** — 🔴 **実装を正とし、`docs/04` を改訂した**（`ui-design`）。判断の根拠: `docs/04` の中で孤立していたのは §S-005「デバイス別」の**旧文 1 文**（「モバイル = 1 行 = 氏名 + 稼働可能時期 + 主要スキル 2 件の 3 行構成」）であり、§7.2（同型データの一覧はテーブル / カードで並べない）・§7.1（ファーストビューに 12 行以上）・§10.3（主要スキルは上位 3 + `+N`）・`designer` 申し送り 2（`S-005` は 1 万件規模を前提にしたテーブル）の**いずれとも食い違っていた**。業務上の根拠は「移動中に、今すぐ動ける人を探す」動作が**稼働可能時期を縦に走査する**ことであり、1 レコードを積み上げると比較ができなくなる（`CLAUDE.md` §13.3「判断材料を隠さない」は**比較できる形で残すこと**まで要求する）。**反映**: `docs/04` §S-005「デバイス別」を「3 ブレークポイントとも同じテーブルで列だけを間引く（モバイル 3 列 = 氏名 / 主要スキル / 稼働可能時期）」に改め、**§11-12 を新設**（決定と根拠）、§S-011 の参照先の誤り（`§11-2` → §7.2 / `designer` 申し送り 2 / §11-12）を訂正、`designer` 申し送り 2 に「モバイル / タブレットでもカードにしない」を追記。**表示項目の集合と Tier（T2）は変えていない**（主要スキルは 2 件 → 3 件に増えている）。`engineer-ledger-screen.render.test.tsx` / モバイル spec の判定は緩めていない。⚠️ **`docs/dev-plan.md` §8 への 1 行の記録は、タスク完了時に漏れており、2026-09-15 の完了確認で補填した**（§8 の 2026-09-11 付の行。**記録の欠落であり、決定と根拠は `docs/04` §11-12 に当時から在る**）。**副産物として発見した未決着 1 件**: 氏名セルの**切り詰め（`docs/04` §10.3 の共通規約）vs 折り返し（`S-005` / `S-010` / `S-011` の実装）**。`docs/04` §10.3 の表に「未決着。2 画面まとめて決める」と注記済み。**持ち主は `T-11-12`**（§8 申し送り）。

### T-08-11 🔴 ラベル折り返し検出器の常設化（S〜M。🔴 **実行順はスプリント末**）

- **背景**（`docs/sprints/SP-21-ui-foundation.md` §8.5）: T-21-01 で見つかった **38px 幅・98px 高のボタン（ラベルが 1 文字ずつ 6 行）** は、🔴 **最初から壊れていたのに E2E が通っていた**（縦に伸びた当たり判定が Playwright のクリック位置ずれを吸収していた）。T-21-06 が計測器を作り、**199 要素を走査して 4 判定すべて 0 件**であることを確認済みである。
- **実装**: `tests/e2e/support/assertions.ts` に **`expectNoBrokenLabels(source: string, page: Page)`** を足し、**既存 12 spec（`audit-k7.mobile` / `home.mobile` / `projects.mobile` / `settings.mobile`）から呼ぶ**。**実装と閾値は T-21-06 の計測器をそのまま移植できる。**
- **受け入れ基準**:
  1. 🔴 **テスト本数を増やさない。** 既存の spec の中から呼ぶ形にする（`expectNoHorizontalOverflow` / `expectNoHiddenCountHints` と同じ置き場所・同じ呼び方）。
  2. 🔴 **申し送りの式（`el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1`）だけを移植してはならない。** 🔴 **この式は上記の実害を検出できない** —— ラベルが 1 文字ずつ折り返って**枠の中に収まる**ため `scrollWidth == clientWidth` になる（**和文は文字単位で改行できるので溢れが発生しない**）。**折り返しそのものを測る判定**（`wrapped-short-label`: 行ボックス数 3 以上かつラベル 24 文字以内 / `one-char-per-line`: 行数 2 以上かつ 1 行 2 文字以下）を実装する。
  3. **初回計測で出た偽陽性 4 件を、閾値の緩和ではなく判定条件の明確化で解消する**（🔴 **「落ちたので閾値を上げた」を残さない**。SP-21 §5 / §6 の規律）。**除外が要る要素は、理由をコード中に 1 件ずつ書く**（一括の除外セレクタを作らない）。
  4. 🔴 **導入時点で 12 spec すべてが green**（現状 0 件であり、導入初日から緑になるはずである。**緑にならない場合は検出器ではなく画面を直す**）。
  5. `T-08-02` / `T-08-06` / `T-08-07` で新設した画面（`S-015`〜`S-018`）も走査対象に入っている。
- **完了の判定**: 上記 1〜5 + CI green（run 番号を完了記録に残す）。
- ✅ **完了（2026-09-15、コミット `0ebc742` + 是正 `1a1e7f8`。⚠️ 実行順は「スプリント末」の計画に対し、`T-08-05` の直前に前倒しした** —— 新設画面 `S-015`〜`S-018` を作る前に検出器を置くほうが、作った後に走らせるより安い） — `tests/e2e/support/assertions.ts` の **`expectNoBrokenLabels(source, page)`**。**既存 12 spec（`audit-k7.mobile` 2 / `home.mobile` 2 / `projects.mobile` 5 / `settings.mobile` 3）から呼び、テスト本数は 35 のまま**（受け入れ基準 1）。🔴 **申し送りの `scrollWidth` / `scrollHeight` の式だけを移植していない**（受け入れ基準 2） —— 判定は 5 つ: `wrapped-short-label`（直下テキストの行数 ≥ 3 かつ 24 文字以内）/ `one-char-per-line`（行数 ≥ 2 かつ 1 行 2 文字以下）/ `clipped-x` / `clipped-y`（溢れ。補助）/ `unreachable-overflow`（ビューポート外かつスクロール容器の祖先が無い）。🔴 **偽陽性 4 件は閾値を 1 つも動かさず、判定条件の明確化で解消した**（受け入れ基準 3。要素を名指しで除外するセレクタは 0 件。`.playwright/t0811/label.audit.ts` で素朴な版と本実装を同じ DOM に当てて実体を名指しで確認）: ①② `S-005` / `S-010` の `<legend class="sr-only">` = **1×1px + `overflow: hidden` の幾何条件**で除く（🔴 クラス名では見ない）③④ `S-012` / `S-007` の `<legend>単価レンジ（…）（円）</legend>` = **JSX の補間が隣接する 4 つのテキストノードになり `Range.getClientRects()` が 1 行でも矩形 4 つを返す**ため、**矩形を縦方向の重なりで束ねて行数を数える**（`countLines`）。⚠️ **SP-21 §8.5 / T-21-06 の記録の訂正**: 偽陽性の原因は「フォント切替」ではなく、実測では **`sr-only`（2 件）と JSX 補間の隣接テキストノード（2 件）**である（フォント切替による `top` の 1〜2px のずれは `countLines` が同じ規則で吸収するが、初回計測の偽陽性の原因ではない）。**走査対象は T-21-06 と同じ集合**（`button` / `a` / `th` / `label` / `legend` / `summary` / `[role=button]` / `[role=tab]`）。<br>🔴 **導入初日に CI で実バグを捕捉した**（受け入れ基準 4「緑にならない場合は検出器ではなく画面を直す」を実践）: `S-010` 案件一覧の**案件名列が CI（Linux フォント）でだけ 62px に潰れて 3 行に折れて**いた（Windows では通る）。→ `1a1e7f8` で `S-010` / `S-005` の名称列に下限幅（10rem 未満に潰さない）。**検出器側は触っていない。** `S-015`〜`S-018` は各画面の spec（`anonymous-share.spec.ts` / `projects.mobile.spec.ts` / `home.mobile.spec.ts`）から呼ばれ走査対象に入っている（受け入れ基準 5）。**CI**: 導入初日の run が上記の捕捉で赤 → `1a1e7f8` 以降 green（⚠️ 同日の `57d001a` は CI 環境側の是正〔MinIO イメージの取得先〕であり画面の話ではない。run 番号は §8 の完了記録に集約）。

## 6. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | 丸め関数（5 項目 × 境界値。`docs/02` `F-017 AC-3` の例をそのまま）。参照子の生成（案件が違えば別値 / 同一案件では安定）。マージ順序の決定性。 |
| **結合（DB あり）** | `F-016` / `F-017` / `F-018` の全 AC。共有停止の即時反映。`app_share_probe` の権限。応諾のトランザクション原子性。422 の遷移拒否。 |
| **静的テスト** | `AnonymousCandidateView` / `HostProposalRequestView` の型テスト（禁止フィールドが存在しない）。`GET /api/candidates/{ref}` のルートが存在しない。 |
| **E2E** | 🔴 **T-08-09 の 8 シナリオ**（`docs/05` §17.3 #5 / #6）。`S-015`〜`S-018` の主要導線。Tier 1 の画面（`S-017` / `S-018`）は**モバイルビューポートで操作まで完結**すること。 |
| **外部 API のモック方針** | 本スプリントは外部 API を叩かない（提案依頼の通知は Phase 1 ではアプリ内表示）。**Phase 2 で `F-039` に集約する際、宛先分類の適用を SP-15 で追加する。** |

## 7. 完了判定

1. `F-016` / `F-017` / `F-018` の全 AC が結合テストで green。
2. 🔴 **T-08-09 の E2E 8 シナリオが green**（`CLAUDE.md` §5 Phase 1 成功条件 3 の証明）。
3. 🔴 **匿名候補の表示項目が 5 項目を超えず、丸め規則どおりの粒度でのみ表示される。**
4. 🔴 **案件をまたいで同一人物を追跡できる識別子・値の組が応答に含まれない。**
5. 🔴 **共有は既定オフで、一括オンの既定操作が存在せず、停止が即座に反映される。**
6. 🔴 **辞退理由がホストのどの経路にも現れず、`DECLINED` / `EXPIRED` / `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` が別区分として扱われる。**
7. `ACCEPTED` と `Proposal(DRAFT)` 生成が原子的であり、片方だけ成立しない。
8. **申し送り**: 🔴 **R-1（Issue #5 の丸め方の承認）は未達のまま。SP-12 の T-12-06 で人間の承認を得るまで Phase 1 を閉じない。** `createProposalDraft()` プリミティブを SP-09 の #36 が再利用する。
9. 🔴 **`T-08-10`**: `docs/04` §S-005「デバイス別」と実装が一致し、決定と根拠が `docs/dev-plan.md` §8 に記録されている（**横断タスク。匿名共有の成立とは別枠**）。
10. 🔴 **`T-08-11`**: `expectNoBrokenLabels` が `tests/e2e/support/assertions.ts` に在り、既存 12 spec から呼ばれ、**テスト本数が増えておらず**、CI green である（**同上**）。

---

## 8. 完了記録（2026-09-15。`MODE: REVIEW` / `TARGET: SP-08`）

✅ **判定: `PHASE_COMPLETE`（§7 の 10 / 10）** —— 経緯として残す: 初回の確認時点では**最終 push（`b9fae76` / `f119ab6` / `ab762c9` = T-08-07〜T-08-09）の CI run が実行中で green の証跡が無く、`PHASE_INCOMPLETE: 1 件` と判定した**（本スプリントには Windows と CI〔Linux フォント〕で結果が割れた実例 `1a1e7f8` があるため、ローカルの passed を CI green の代わりにしない）。同日、**3 run とも success が確認された**（`b9fae76` = run `34942064215` / `f119ab6` = run `34945281378` / `ab762c9` = run **`34947464880`**〔E2E 43 本を含む〕）ため、`PHASE_COMPLETE` に改めた（8.3）。

### 8.1 タスクの完了状況（11 / 11 実装済み）

| ID | 完了日 | コミット | 備考 |
|---|---|---|---|
| T-08-01 | 2026-09-10 | `cf5ee3b`（+ docs `70efaf1`） | 丸めの純粋関数。Issue #5 の確定値で実装 |
| T-08-02 | 2026-09-11 | `eae1086` | `S-015` / #29。Issue #49 を起票 |
| T-08-03 | 2026-09-11 | `2f585fd` | 🔴 **初回実装の実名漏洩をレビューが実 DB で再現し差し戻し** → 専用メソッド化 |
| T-08-04 | 2026-09-11 | `ab5b949` | HMAC 参照子 / `AnonymousCandidateView`。並び順からの突合も塞いだ |
| T-08-10 | 2026-09-11 | `dbc3e8d` | `docs/04` §S-005 の改訂（実装を正とした）。**§8 への記録は本確認で補填** |
| T-08-11 | 2026-09-15 | `0ebc742` + `1a1e7f8` | 検出器の常設化。**導入初日に CI で実バグ（`S-010` 名称列）を捕捉** |
| T-08-05 | 2026-09-15 | `5d304af`（+ ci `57d001a`） | `S-016` / #30 / #15。🔴 **設計書に無かった再識別チャネルを塞いだ**（Issue #51）。Issue #50 を起票 |
| T-08-06 | 2026-09-15 | `fc12d52` | `S-017` / #31 / #32 / #35。🔴 **`apps/web` からの AI 実行系 import をレビューが検出** → 許可リスト走査。Issue #52 を起票 |
| T-08-07 | 2026-09-15 | `b9fae76` | `S-018` / #33 / #34 / 期限切れジョブ。`createProposalDraft()` 単一実装 |
| T-08-08 | 2026-09-15 | `f119ab6` | 実装変更なし。成約率の分母の定義を `packages/domain` に固定（レビュー省略） |
| T-08-09 | 2026-09-15 | `ab762c9` | E2E 8 シナリオ。**E2E 43 本**（レビュー省略） |

**実行順**は計画どおり `T-08-01` → `T-08-02` → `T-08-03` → `T-08-04` → `T-08-10` → **`T-08-11`（前倒し）** → `T-08-05` → `T-08-06` → `T-08-07` → `T-08-08` → `T-08-09`。⚠️ **`T-08-11` は「スプリント末」の計画に対し `T-08-05` の直前に前倒しした** —— 新設 4 画面を作る前に検出器を置いたほうが安い。結果として `S-015`〜`S-018` は**最初から走査対象として作られた**。

### 8.2 §7 の完了判定に対する結果

| # | 判定 | OK / NG | 証跡 |
|---|---|---|---|
| 1 | `F-016` / `F-017` / `F-018` の全 AC が結合テストで green | OK | `tests/isolation/{engineer-shares,shared-candidate-scope,anonymous-candidate-view,project-candidates,proposal-requests,proposal-request-respond,proposal-request-outcomes}.test.ts`（7 ファイル）。CI run は 8.3 |
| 2 | 🔴 T-08-09 の E2E 8 シナリオが green | OK | `tests/e2e/anonymous-share.spec.ts`（8 `test`）。**CI run `34947464880`（`ab762c9`）success。E2E 43 本を含む。** ローカル最終実行 `test-results/.last-run.json` = `passed`。（初回確認時は run が実行中で NG としたが、同日に success を確認して OK に改めた） |
| 3 | 🔴 5 項目を超えず丸め規則どおりの粒度のみ | OK | `rounding.test.ts` / `anonymous-candidate-view.test.ts`（許可キー 8 / 禁止キー 0）/ E2E ②（許可キー集合を設計書から独立に持つ） |
| 4 | 🔴 案件をまたぐ追跡識別子が無い | OK | `candidate-view.test.ts:210`〜（HMAC の案件スコープ / 連番・辞書 ID・生の更新日時が型に無い / 同日候補の相対順序が案件ごとに変わる）/ `forbidden-api-routes.test.ts`（詳細エンドポイントが無い）/ E2E ⑥ |
| 5 | 🔴 既定オフ / 一括オン無し / 停止が即時 | OK | `engineer-shares.test.ts:273` / `:291` / `:482`（`no-store` を含む）/ E2E ① ⑧ |
| 6 | 🔴 辞退理由の非開示と 5 状態の別区分 | OK | `views.types.test.ts`（`declineReason` が型に無い）/ `proposal-request-respond.test.ts` ⑤ / `proposal-request-outcomes.test.ts` / `indicators.ts`（`ProposalRequestState` を型で受け付けない）/ E2E ④ |
| 7 | `ACCEPTED` と `Proposal(DRAFT)` の原子性 | OK | `proposal-request-respond.test.ts:272`（`proposal_events` の INSERT 権限を外す注入で 5 表とも増えない） |
| 8 | 申し送り（R-1 は T-12-06 / `createProposalDraft()` を #36 が再利用） | OK | R-1 の**承認**は [Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5) で得た。**根拠の記録は `T-12-06` に残る**。`createProposalDraft()` は `packages/db/src/proposal-draft.ts` に 1 実装 |
| 9 | 🔴 T-08-10: `docs/04` §S-005 と実装が一致し、決定と根拠が `docs/dev-plan.md` §8 に在る | OK（**§8 の行は本確認で補填**） | `docs/04:566`（デバイス別）/ §11-12 / `engineer-ledger-screen.tsx`。⚠️ **タスク完了時に §8 への記録が漏れていた**（決定と根拠は `docs/04` §11-12 に当時から在る）。`docs/dev-plan.md` §8 の 2026-09-11 付の行として補填 |
| 10 | 🔴 T-08-11: 検出器が 12 spec から呼ばれ、本数不変、CI green | OK | `assertions.ts:183` / 呼び出し 4 spec（12 `test`）/ E2E 35 → 43 の増分は T-08-09 の 8 本だけ / `1a1e7f8` 以降の CI green |

**K-4（`docs/dev-plan.md` §6.1）**: 防止実装（`rounding.ts` の純粋関数 / HMAC 参照子 / 詳細エンドポイントを作らない）と証明テスト（`anonymous-share.spec.ts` + 上記の結合・型・静的テスト）が対で存在する。**無条件 NG の条件（テストが無い / 赤）には該当しない。**

### 8.3 テスト green の証跡

- **E2E**: **43 本**（desktop 31 = `isolation.spec.ts` 19 + `audit-k7.spec.ts` 3 + `projects.spec.ts` 1 + **`anonymous-share.spec.ts` 8** / mobile 12）。ローカル最終実行 `test-results/.last-run.json` = `passed`（`failedTests: []`）。
- **結合（`tests/isolation/**`）**: SP-08 で 7 ファイル追加（8.2 の表）。**静的**: `forbidden-api-routes.test.ts` / `proposal-request-outcome-separation.test.ts` を追加、`ai-single-path.test.ts` に許可リスト走査を追加。
- **CI**: **14 コミットすべてで green**（[Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の運用 C の確認記録として残す —— 機械的強制は未達であり「CI があるから守られている」と読み替えない。`docs/dev-plan.md` §6.4 R-05）。**スプリント末の 3 run**: `b9fae76`（T-08-07）= run **`34942064215`** success / `f119ab6`（T-08-08）= run **`34945281378`** success / 🔴 **`ab762c9`（T-08-09）= run `34947464880` success（E2E 43 本を含む。K-4 の証跡）**。⚠️ **本スプリントでは Windows と CI（Linux フォント）で結果が割れた実例（`1a1e7f8`）があるため、「ローカルで passed」を CI green の代わりにしない** —— 初回確認時に最新 run が実行中だったため判定を保留し、success の確認後に `PHASE_COMPLETE` とした。
- ⚠️ **`docs/05` §11.13 ④**: `tests/isolation/**` は `dist` 越しに走るため、`pnpm -r build` を挟まない実行は防御を壊しても緑のままになる。CI（`build → … → test:isolation → test:e2e` の 1 ジョブ直列）はこの手順を満たす。

### 8.4 🔴 レビューが捕まえた実バグ 3 件（いずれも全テストを素通りしていた）

1. **`T-08-03` 実名漏洩**（差し戻し）— §5 T-08-03 の完了記録。**RLS は列を守れない / Prisma 拡張はネストしたリレーションで走らない / `Pick<delegate, 'findMany'>` は `select` を保持 / 型テストはリレーション経由を捕まえられない**。→ 専用メソッド + 実 DB の全メンバー走査。
2. **`T-08-06` `apps/web` からの AI 実行系 import**（Lint エラーなし）— §5 T-08-06 の完了記録。「依存が無いこと」が担保だった規律は、依存を足した瞬間に消える。→ 許可リスト方式の静的走査。
3. **`T-08-11` 導入初日（CI）: `S-010` 案件名列が Linux フォントでだけ 62px に潰れ 3 行に折れる**（Windows では通る）— §5 T-08-11 の完了記録。→ 名称列に下限幅（`1a1e7f8`）。

🔴 **1 と 2 は `CLAUDE.md` §8.3 のレビュー方針（2026-09-15）が「境界領域は 0 回にしない」と定めた根拠そのものである。**

### 8.5 人間への起票（いずれも既定値で進行中。ブロッカーなし）

| Issue | 論点 | 既定値 | 起点 |
|---|---|---|---|
| [#49](https://github.com/Festal-KM/SES-Platform/issues/49) | 停止中（`SUSPENDED` / `CLOSING`）のパートナーが共有を解除できない（§3.1「いつでも解除でき」との緊張） | A = 現状維持。C なら `app_engineer_is_shared()` の述語 1 箇所 | T-08-02 / T-08-03 |
| [#50](https://github.com/Festal-KM/SES-Platform/issues/50) | 匿名候補を `S-005` にも混ぜるか（`CLAUDE.md` §3.1 と §5 の読みが割れる） | A = `S-016` のみ。`#15` は `?projectId=` のときだけ混ぜる | T-08-05 |
| [#51](https://github.com/Festal-KM/SES-Platform/issues/51)（`assumption`） | 検索条件は丸め後の区分で評価し、非開示属性は評価しない | 実装済み（`criteria.ts`） | T-08-05 |
| [#52](https://github.com/Festal-KM/SES-Platform/issues/52) | 取り下げ後に同じ候補へ再依頼できるべきか | 現状維持（1 案件 × 1 候補 1 回） | T-08-06 |
| [#5](https://github.com/Festal-KM/SES-Platform/issues/5) への追記 | **候補の出現・消滅のタイミング**（共有開始 / 解除の瞬間を観測すると、個人の動きと突き合わせられる）という残存リスク。**人間が受け入れ済みでない項目** | — | T-08-09 |

### 8.6 申し送り（次スプリント / リリース判定へ）

1. 🔴 **SP-09 `T-09-01`**: 応諾で作る `Proposal(DRAFT)` の**提案先は空文字**。#37 で必須入力 / #39 で空の `DRAFT` を 422 / `docs/04` §S-020「新規は提案先が決まった状態で開く」の改訂（`ui-design`）。**SP-09 の T-09-01 に反映済み。**
2. 🔴 **SP-09 `T-09-12`**: `createProposalDraft()` の `freezeCareers()` を **`engineer_careers` の行複製に置き換える**。着手条件（`docs/02` `F-008` → `docs/04` §S-006 / §S-007 → `docs/05` §3.4 / §4.4 の 3 段 + ワイヤーフレーム 3 枚）は揃っている。**SP-09 の T-09-12 に反映済み。**
3. ✅ **`T-07-11`（ワーカーの起動配線）は本スプリントに先行して 2026-09-10 に完了していた**（コミット `89545bb`。CI run `34438822934`）。⚠️ **初回の完了確認では「未着手」と誤記した** —— 原因は `docs/sprints/SP-07-ai-layer-gate.md` の `T-07-11` に ✅ 完了記録が無かったこと（SP-07 の完了確認より後にコミットされた）。**同日に訂正し、SP-07 側に完了記録を補填した。** `proposal-request.expire` は `runtime.ts` の既存経路に乗っており無主ではない。🔴 **SP-09 の `T-09-11` に残る制約は別物** —— **E2E ハーネス（`tests/e2e/harness`）に Redis とワーカーが無い**ため、ブラウザ経路の E2E #3 / #4 / #23 を通すにはハーネスに Redis + `gate.run` ワーカーを足す必要がある（`docs/05` §11.12 ⑦）。**ワーカーの配線の話と混同しない。**
4. **`T-11-12`（新設）**: `S-016` desktop 1440 で候補テーブル最終列「更新日」が横スクロール無しには見えない（Tier 2 の主画面として列幅の見直し。BLOCKED ではない）+ **氏名セルの切り詰め vs 折り返し**（`docs/04` §10.3 と `S-005` / `S-010` / `S-011` の実装の食い違い。T-08-10 で発見）。
5. **`T-11-11`（新設）**: `S-015` に検索・ページングが無く、**台帳 200 件超のパートナーはそれ以降を共有可にできない**（`ui-design` の判断事項。取引先は 1 日 4〜5 時間滞在する主利用者であり、`S-015` を簡易版にしない）。
6. **`docs/05` に `/design-iterate program-design` をかける**（改訂 9 / 10 = T-08-03 / T-08-05 / T-08-07 の決着の追記に対して。`CLAUDE.md` §8.7 手順 4。**オーケストレーターの作業**）。
7. **SP-21 §8.5 / T-21-06 の記録の訂正**: 偽陽性 4 件の原因は「フォント切替」ではなく `sr-only`（2 件）と JSX 補間の隣接テキストノード（2 件）。`docs/sprints/SP-21-ui-foundation.md` §8.5 に追記済み。
8. **R-1 の根拠の記録は `T-12-06`**（承認は得た。母集団規模 / 丸め粒度 / 残存リスク〔#5 追記分を含む〕を紙に残す）。
