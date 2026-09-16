# SP-11 admin-console-p1 — 管理平面 Phase 1（健全性・利用量・監査横断・運用監視）

> **Phase**: 1（MVP） / **前提**: SP-10（計測の完成） / **後続**: SP-12
> **一次資料**: `CLAUDE.md` §10.4 / §10.5 / §10.6 / `docs/01` `BR-37` `BR-40`〜`BR-44` / `docs/02` `F-056`〜`F-059`（**`F-059 AC-7`**）/ `F-064 AC-10` / 章 7.7 / `docs/03` §8.2 / §7.6.3 / `docs/04` `A-002`〜`A-006`（**`A-005` 項目 13 / 14 / 15**）/ `docs/04` 申し送り 16 / `docs/05` §5.5 / §5.7 / §6.9（**API-A8**）/ §8.3-Q / §9.4 / §9.7 / §16.5
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-11`
> 🔴 **2026-09-15 に SP-08 の完了確認から `T-11-11`（`S-015` の検索・ページング）/ `T-11-12`（一覧テーブルの列幅と氏名セルの規約）を新設した**（§3 / §4 / §6-12・13）。**どちらも主平面の UI 是正であり、本スプリントの機能 ID（`F-056`〜`F-059`）に紐づかない持ち込みタスク**（`T-11-10` と同じ扱い。`docs/dev-plan.md` `PM-A-09`）。🔴 **なぜここか**: SP-09 は中核のクリティカルパスで 13 タスク、SP-10 は 12、SP-12 は「新機能を実装しない」仕上げ専用で、**Phase 1 内で目安 12 に収まり、かつ第 1 回リリース前に確実に消化される置き場が本スプリントだけ**だった（`docs/dev-plan.md` §8 の 2026-09-15 の行）。**両タスクは `ui-design` による `docs/04` の改訂が先**（`CLAUDE.md` §8.7）—— 改訂は SP-09 / SP-10 の期間中に済ませてよい。
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`A-002`〜`A-006`、および `T-11-11` / `T-11-12` の `S-015` / `S-016`〔画像は生成済み〕）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**全 88 枚が生成済みである**（2026-09-03。[Issue #17](https://github.com/Festal-KM/SES-Platform/issues/17) = A の決着後に残り 82 枚を生成し、`docs/04` 改訂 5 の `S-046` 分 3 枚を追加した）。**本スプリントの着手条件は満たされている。** 画面の新設・改訂で不足が生じた場合のみ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

`CLAUDE.md` §10.6 が Phase 1 に定める管理平面のスコープ（**利用量の可視化・監査ログ横断検索・運用監視の最小版**）を成立させる。加えて `F-056` の**健全性監視（異常順）**を入れる。

🔴 **管理平面はデータ分離を越える唯一の経路であり、最も慎重に設計する。** 本スプリントで守るのは **既定 read-only**（`BR-37`）と **運営者にも見せないもの**（`BR-40`）である。

## 2. 対応機能 ID

`F-056`（健全性の異常順）/ `F-057` / `F-058` / `F-059`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-11-01 | テナント健全性（異常順）と `A-002` | 既定の並び順が異常度の高い順である | `F-056 AC-2` | M |
| T-11-02 | 利用量・クォータ管理と `A-004` | 🔴 **金額と件数の両方 + 消費率 + 基準比の倍率**。変更は `PLATFORM_OWNER` のみ | `F-057 AC-1`〜`AC-5` | L |
| T-11-03 | 監査ログ横断検索と `A-006` | 🔴 **期間必須**。PII マスキング。内容へ到達する導線が無い | `F-058 AC-1`〜`AC-4` | M |
| T-11-04 | 運用監視（Phase 1 の項目）と `A-005` | 表示は件数・状態・エラー種別・日時のみ。🔴 **項目 13 / 14 / 15 を含む**（送信基盤の上限到達・送信保留の理由別内訳・削除予告の未配送） | `F-059 AC-1`〜`AC-4` / **`AC-7`** / `docs/05` §16.5 / API-A8 | L |
| T-11-05 | 🔴 `GATE_RUNNING` 滞留の区別表示 | 🔴 **上限到達による滞留が失敗ジョブ数・FAIL 率・未対応 `SUBMIT_FAILED` に加算されない** | `F-059 AC-6` | M |
| T-11-06 | 送信ドメイン未検証テナントの検知 | 検証状態と経過日数が分かる。業務データの内容に立ち入らない | `F-059 AC-5` / `BR-71` | M |
| T-11-07 | 運営者マスキングの二層と非開示の検証 | 🔴 **E2E #15**（非開示のものが管理平面のどの応答にも現れない） | `BR-40` `BR-42` | M |
| T-11-08 | Anthropic tier 80% 到達の検知 | Start tier の頭打ちを事前に検知できる | E-3 / `docs/03` §8.2 | S |
| 🔴 **T-11-09** | 🔴 **監査ログ詳細への `summary` の露出（`S-041`）**（[Issue #40](https://github.com/Festal-KM/SES-Platform/issues/40) = **回答 2**。2026-09-10） | 🔴 **全 action の `summary` を棚卸ししたうえで露出する。閲覧者ロールごとの見え方を確認する。`A-006`（運営者）は別扱い（PII マスキング）** | [#40](https://github.com/Festal-KM/SES-Platform/issues/40) / `F-005` / `F-014 AC-5` / `BR-42` | M |
| 🔴 **T-11-10** | 🔴 **Amazon SNS の準備と日本向け SMS 送信上限の確認・申請**（[Issue #45](https://github.com/Festal-KM/SES-Platform/issues/45)。**非コードタスク**） | リードタイムの実測値が記録され、**SP-13 の実装（`T-13-10`）が待ちにならない** | [#45](https://github.com/Festal-KM/SES-Platform/issues/45) / `docs/dev-plan.md` §5 **E-17** | S |
| 🔴 **T-11-11** | 🔴 **`S-015`（匿名共有の設定）の検索・ページング**（SP-08 からの申し送り。2026-09-15。**主平面の UI 是正**） | 🔴 **台帳 200 件超のパートナーが、201 件目以降のエンジニアも共有可 / 解除できる。** `ui-design` が `docs/04` §S-015 を先に改訂している。**一括で全件をオンにする操作は依然として存在しない** | `F-016 AC-1` / `AC-2` / `docs/04` §S-015 / `docs/05` §6.5 #29 / `CLAUDE.md` §1.2（取引先は主利用者） | M |
| 🔴 **T-11-12** | 🔴 **一覧テーブルの列幅と氏名セルの規約の決着**（`S-016` desktop 1440 の「更新日」列 + `S-005` / `S-010` / `S-011` / `S-016` の氏名セルの切り詰め vs 折り返し。SP-08 からの申し送り。2026-09-15） | 🔴 **`S-016` desktop（1440）で右パネルを開いた状態でも候補テーブルの全 8 列が横スクロール無しに読める。** 氏名セルの規約（`docs/04` §10.3）と 4 画面の実装が一致している。**モバイル spec と折り返し検出器の判定を緩めていない** | `F-017 AC-7` / `docs/04` §10.3 / §S-016 / `CLAUDE.md` §13.3 | M |

## 4. タスク詳細

### T-11-01 テナント健全性（異常順）と `A-002`（M）

- **実装**: `GET /api/admin/tenants`（API-A2）の並び順。画面は `A-002`（Tier 3）。
- 🔴 **異常なテナントを上位に出す**（`F-056 AC-2`）: 最終アクティビティの停滞 / 席の未利用 / パートナー数 0 / トライアル期限切れ。
- **目的は「その顧客が使えているか」を捉え、解約の申し出より前に接触すること**（`docs/01` 章 7.3）。
- 🔴 **表示するのは件数・状態・日時のみ**（`F-056 AC-1` / `BR-40`。SP-03 で実装済みの制約を維持する）。
- **完了の判定**: `F-056 AC-2` の結合テスト（異常度スコアの決定性と並び順）。

### T-11-02 利用量・クォータ管理と `A-004`（L）

- **実装**: `GET /api/admin/usage` / `PUT /api/admin/tenants/{id}/quota`（API-A6）。画面は `A-004`（Tier 3）。
- 🔴 **応答は金額と件数の両方 + 消費率 + 基準比の倍率**（`docs/03` §7.6.3-2 / `F-063 AC-5`）。**金額（USD）は管理平面（API-A6 / API-A15）にのみ現れ、テナント側の画面には現れない**（`F-027 AC-6`）。
- 🔴 **「金額上限に対する消費率」と「基準ユニット比の倍率」の両方を出す**（`docs/03` `ui-design` 申し送り 7 / §7.6.3-2）。**消費率だけでは異常の程度が分からない。**
- **件数と金額の対応が同一画面で確認でき、1 件あたり標準原価の改定時に両者の乖離を検知できる**（`F-063 AC-5`）。
- 🔴 **クォータの変更は `PLATFORM_OWNER` のみ。`PLATFORM_SUPPORT` には操作の導線が存在しない**（`F-057 AC-2` / `BR-44`）。API を直接呼んでも拒否される。
- 🔴 **クォータの引き下げには適用日の指定と対象テナントへの通知が必須であり、即時反映のみの操作が存在しない**（`F-057 AC-3`）。**既存顧客の上限を予告なく引き下げない。**
- **消化率が常に低いテナントと、上限に張り付くテナントをそれぞれ抽出できる**（`F-057 AC-1`）。
- クォータ変更を `AuditLog` に記録（`F-057 AC-4`）。
- **ブロッカーではないが確認中**: `Q-T-3`②（件数クォータの初期値）。既定は `docs/03` §7.6.2 の表。**設定値であり実装は値に依存しない。**
- **完了の判定**: `F-057 AC-1`〜`AC-5` の結合テスト。

### T-11-03 監査ログ横断検索と `A-006`（M）

- **実装**: `GET /api/admin/audit-logs`（API-A7）。画面は `A-006`（Tier 3）。
- 🔴 **`from` / `to` を必須にする**（`docs/03` `ui-design` 申し送り 9 / §8.3-3）。**期間なしの全件検索の導線を作らない**（`AuditLog` は 100 テナントで年間約 1 億行になる）。
- 🔴 **検索結果に表示される個人名・メールアドレス・電話番号がマスキングされる**（`F-058 AC-1` / `BR-42`）。
- 🔴 **「エンジニア詳細を閲覧した」という記録から、そのエンジニアの氏名・経歴・スキルシートへ到達する導線が存在しない**（`F-058 AC-2` / `BR-40`）。
- 🔴 **チャット本文・提案本文・スキルシート本文が検索結果にもエクスポートにも含まれない**（`F-058 AC-3`）。
- 横断検索の実行（誰が・いつ・どの条件で）を `AuditLog` に記録（`F-058 AC-4`）。
- **完了の判定**: `F-058 AC-1`〜`AC-4` の結合テスト（マスキング済み応答のスナップショット）。
- ✅ **決着（2026-09-16 実装）**: 期間上限 **31 日**（`AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS`。超過は 400 + `AUDIT_LOG_PERIOD_TOO_LONG`）/ フィルタは `targetTenantId`（`tenantId` ではない。T-04-07 の (c)）/ `summary` は `@ses/domain` の `maskAuditSummary()` で**内容キーはキーごと落とし、身元・商流キーと非トークン形状の値は `[masked]`**（部分伏せ無し。`actorDisplayName` 無し）/ 到達導線は `tests/static/admin-no-content-reach.test.ts` で静的固定（`/api/admin/audit-logs/{}` も禁止）/ 検索の記録は既存の `admin.audit_log.search` に条件のみ / CSV エクスポートは作らない。詳細は `docs/05` §6.9「API-A7 の実装の決着」。

- **T-11-03 の申し送り（2026-09-16。code-reviewer）**: ①`docs/04` §A-006 のフィルタとの差分（`actorType` のみ / `targetType` 未実装 / `deviceKind` 追加）は `docs/04` に注記済み。`ui-design` 改訂で確定させる ②`tests/static/admin-no-content-reach.test.ts` は `db.user.findMany()` 形しか見ず、別名経由（`const u = db.user; u.findMany()`）は検出しない（`PlatformReadDb` に `$queryRaw` が無いため raw 経路は型で止まる）。T-11-07 で識別子の別名まで追うか判断 ③`reason` を内容キーとして落とすため `auth.login_failed` の `PASSWORD_MISMATCH` / `USER_DISABLED` の区別が `A-006` から消える。必要なら列挙値だけ残す形状判定へ ④`withPlatformWrite` の `before` / `after`（`JSON.stringify` 文字列）は 64 文字超で `[masked]` に畳まれ、`admin.tenant.create` の内容が `A-006` から読めない。安全側だが障害調査の材料としては T-11-07 で扱う。

### T-11-04 運用監視（Phase 1 の項目）と `A-005`（L）

- **実装**: `GET /api/admin/monitoring`（API-A8）。画面は `A-005`（Tier 3）。項目ごとに独立して返す。
- 🔴 **Phase 1 の監視項目**（`F-059` 処理④ / `docs/04` `A-005` の項目表 / `docs/05` §16.5）: 失敗ジョブ（項目 3）/ `SUBMITTING` の滞留（項目 2）/ 未対応の `SUBMIT_FAILED`（項目 1）/ **`GATE_RUNNING` の滞留**（項目 12。T-11-05）/ ウイルススキャン失敗（項目 4）/ ゲート FAIL 率（項目 5）/ `F-026` の計測欠測（項目 6）/ `F-064` の削除ジョブの失敗（項目 7）/ **送信ドメイン未検証**（項目 11。T-11-06）/ 匿名候補の一意率 / スケジューラ停止 / 🔴 **項目 13 / 14 / 15 / 16**（下記）。
- 🔴 **項目 13 / 14 / 15 / 16 は API-A8 の 4 つの `kind` として返す**（`docs/05` §6.9 API-A8 / §16.5。`docs/04` `A-005` 項目 13 / 14 / 15）。**13 / 14 / 15 は `docs/02` `F-059 AC-7` / 章 7.7 / `F-064 AC-10` の Phase 1 要求であり、16 は T-04-03（メール送信の実装）からの申し送りである。**

  | 項目 | `kind` | 表示 / データ源 | 守ること |
  |---|---|---|---|
  | **13** メール送信基盤の上限到達・接近（**環境全体**） | `MAIL_PROVIDER_QUOTA` | 送信件数 / 上限 / 消費率 / 到達（接近）時刻 / **保留中のメール件数**。データ源は ①`email_dispatches(status='HELD_PROVIDER_QUOTA')` の件数と `MIN(held_at)` ②`EmailSender.getQuota()`（Redis 60 秒キャッシュ。`sentLast24h = max(SES, ZSET mail:provider:sent24h)`）③`consumptionRate` と `MAIL_PROVIDER_QUOTA_WARN_RATIO`（既定 0.8）を跨いだ最初の時刻 | 🔴 **`tenantId` を型に持たない**（環境全体）。`A-003` / `A-004` への導線を置かない。🔴 **`getQuota()` が取得できないときは `providerReading.available=false` を返し、`max24h` / `consumptionRate` を 0 で埋めない**（画面は「上限を確認できていません」）。🔴 **再送の操作導線を置かない**（復帰は `send.hold-release` の自動）。🔴 **テナント日次上限（`F-027` = `A-004` のメール列）とは別行・別集計** |
  | **14** 送信保留（**理由別内訳**） | `SEND_HOLD` | `proposals` / `contracts` の `sendHoldReasonKey IS NOT NULL` を **`GROUP BY sendHoldReasonKey, tenant_id`**。理由（§10.4 の 7 値）ごとに件数 / `MIN(sendHoldSince)` | 🔴 **`PROVIDER_QUOTA` のみ `scope:'ENVIRONMENT'` で `tenantId` を落として 1 行に畳み、`RATE_LIMIT` を含む他 6 値は `scope:'TENANT'` のテナント行**。導線は `RATE_LIMIT` → `A-004`、それ以外のテナント行 → `A-003`、`PROVIDER_QUOTA` → **無し**。🔴 **両者を混ぜて集計しない**（環境枠で止まったテナントに `S-038` を案内しない）。**再送の操作導線を置かない** |
  | **15** 削除予告の未配送 | `PURGE_NOTICE_PENDING` | `tenants(lifecycle_state='CLOSING')` かつ `closing_entered_at + 30日 <= today` のうち予告が `SENT` / `MOCKED` でないもの。`cause='NOTICE_PENDING'`（`QUEUED` / `HELD_PROVIDER_QUOTA` あり、または予告行が 1 件も無い）/ `'NOTICE_UNDELIVERED'`（`FAILED` のみ）と `overdueDays` | 🔴 **項目 7（削除ジョブの失敗 = `TenantPurgeRun.status='FAILED'` / `kind='PURGE_JOB_FAILED'`）と別行**（`F-059 AC-2`「失敗と保留・完了を混ぜない」）。**失敗ジョブ数に加算しない**（予告待ちは障害ではない）。**これは「異常」ではなく「削除が進んでいない理由」**であり、閾値超過の色を付けない。行から `A-003` へ |
  | 🔴 **16** `EmailDispatch` の `QUEUED` 滞留（**送信済み未記録の疑い**）<br>**T-04-03 からの申し送り**（本スプリントで実装する） | `MAIL_DISPATCH_STUCK` | `email_dispatches(status='QUEUED')` で滞留時間が閾値超過（既定 15 分。`email.dispatch` の `attempts: 3` × バックオフ 5s/30s が尽きる時間より十分長く取る）。件数と最古の滞留時刻 | 🔴 **「外部へ 1 通出たかもしれないのに、その事実を DB に書けなかった」ことの唯一のシグナルである。** 発生源は 2 つで、どちらも同じ行の状態になるため **1 項目に合流させる**（`docs/05` §16.5 / `apps/worker/src/jobs/email-send.ts`）: ①送信**成功後**の `QUEUED → SENT` / `MOCKED` の記録が失敗（ジョブの戻り値 `SENT_UNRECORDED`）②**`UNKNOWN`**（応答不明 = タイムアウト・**送信経路の 5xx**）の確定 `QUEUED → FAILED` が失敗（戻り値 `FAILED{ recorded: false }`）。🔴 **どちらもジョブは正常終了する**（throw して `attempts: 3` に乗せると行が `QUEUED` のままもう 1 通送る = `BR-21` の直接違反）。**したがって失敗ジョブ数（項目 3）には現れず、この項目でしか見えない。** 🔴 **再送ボタンを置かない** —— 到達したか不明な送信を人手で再送させると二重送信になる。判断材料は `EmailEvent`（`sesMessageId` のバウンス / 配信通知）である。件数・時刻のみで宛先・本文に立ち入らない（`BR-40`） |

  - ⚠️ **項目 16 は `docs/04` の `A-005` 項目表にまだ無い**（T-04-03 の実装中に判明した申し送りであるため）。着手時に `CLAUDE.md` §8.7 に従い `ui-design` で `docs/04` に 1 行追加してから実装すること（表示は件数・最古の滞留時刻のみ / 🔴 **再送の操作導線を置かない**）。
  - 🔴 **項目 13 / 14 / 15 のいずれも「保留は障害ではない」**（`CLAUDE.md` §4.2「失敗と保留を混同しない」/ `F-059 AC-7`）。**失敗ジョブ数（項目 3）・未対応 `SUBMIT_FAILED`（項目 1）/ `SEND_FAILED`（項目 10）・ゲート FAIL 率（項目 5）のいずれにも加算しない。** 🔴 **ただし CAS 後に SES が同期拒否した稀な経路は `SUBMIT_FAILED` / `SEND_FAILED` に計上される**（`docs/05` §8.3-Q ⑤。`F-059 AC-7` の非加算は**事前保留分のみ**）。
  - **空の表現**（`docs/04` `A-005`）: 🔴 **項目 13 は 0 件ではなく消費率で成立を示す**（「本日の送信: N / 上限 M 通（X%）— 保留 0 件」。**送信枠は常に消費されており「0 件」が正常ではない**）。項目 14 の 0 件は「保留中の送信はありません」、項目 15 の 0 件は「削除待ちのテナントはありません」と**成立を明示する**。
  - **なぜ Phase 1 か**: 🔴 **枯渇は `F-054 AC-9`（期限予告が本人に届く）と `F-064 AC-10`（通知されないまま削除が実行される経路が存在しない）を無言で破る。** SP-10 の T-10-08 / T-10-09 / T-10-12 はメール到達性と配送確認を前提に完了判定を書いており、**その前提が監視外だと成立しない。**
  - **上限値**: `packages/config` の `MAIL_PROVIDER_DAILY_QUOTA` / `MAIL_PROVIDER_QUOTA_WARN_RATIO` を読む（**値をハードコードしない**）。SES の枠が引き上げられても `min()` で追随する。
- **Phase 2 で `F-043` の未起票検知、Phase 3 で `SENDING`（契約書）の滞留・未対応の `SEND_FAILED`・電子署名の未着が加わる。** 🔴 **Phase 1 の監視に穴が空く項目は無い**（Phase 1 に存在しない事象のみが後から加わる）。
- 🔴 **`SUBMITTING` のまま一定時間を超えた提案が一覧に現れる**（`F-059 AC-1`。片道の遷移であるため滞留は必ず検知対象になる）。
- 🔴 **未対応の `SUBMIT_FAILED` が `LOST` / `GATE_FAILED` / `DECLINED` と混ざらずに集計される**（`F-059 AC-2` / `BR-23`）。
- 🔴 **表示されるのは件数・状態・エラー種別・日時のみで、提案本文・エンジニア氏名・スキルシート内容が含まれない**（`F-059 AC-3` / `BR-40`）。
- **計測欠測が検知対象に含まれる**（`F-059 AC-4`。`F-043` の未起票は Phase 2）。
- **`SchedulerRun` の生存監視**（24 時間更新が無ければ「スケジューラ停止」）を含める（`docs/05` §9.9）。
- **Sentry と併用する**（`docs/05` §16.3）。
- **完了の判定**: `F-059 AC-1`〜`AC-4` の結合テスト（各事象を作ると一覧に現れる）。🔴 **加えて `F-059 AC-7` の結合テスト**: ①`MAIL_PROVIDER_DAILY_QUOTA` に対して 80% / 100% の送信を作ると **項目 13**（`kind='MAIL_PROVIDER_QUOTA'`）に `consumptionRate` / `reachedAt` / `nearingSince` / `heldCount` が現れ、**テナント日次上限（`A-004` のメール列）とは別行**であること ②`getQuota()` を失敗させると `providerReading.available=false` が返り、`max24h` / `consumptionRate` が 0 で埋められないこと ③提案を `PROVIDER_QUOTA` で保留させると **項目 14** に `scope:'ENVIRONMENT'` の 1 行として出て `tenantId` を持たず、`RATE_LIMIT` の保留は `scope:'TENANT'` のテナント行として出ること ④①〜③のいずれも失敗ジョブ数・未対応 `SUBMIT_FAILED`・ゲート FAIL 率に加算されないこと ⑤`CLOSING` で予告が `HELD_PROVIDER_QUOTA` のテナントが **項目 15** に `cause='NOTICE_PENDING'` / `overdueDays` 付きで現れ、**項目 7（`PURGE_JOB_FAILED`）とは別行**であること ⑥項目 13 / 14 の `PROVIDER_QUOTA` 行に**クリック先の導線と再送ボタンが存在しない**こと。🔴 **加えて項目 16（T-04-03 からの申し送り）**: ⑦`email_dispatches` に閾値を超えて `QUEUED` のまま残る行を作ると `kind='MAIL_DISPATCH_STUCK'` に件数と最古の滞留時刻が現れ、**失敗ジョブ数（項目 3）には加算されない**こと ⑧その行に**再送の操作導線が存在しない**こと（到達したか不明な送信を人手で再送させない）。

- 🔴 **T-10-02 からの申し送り（2026-09-16。実装者 + code-reviewer）**: 計測欠測・ストレージ乖離の材料は `listOpenUsageMeasurementFindings`（`@ses/db/platform`。`countsByKind` / `items`）で、`A-005` に「計測欠測」「ストレージの乖離」の 2 行として写す。あわせて次を表示・運用手順で扱う: ①`demo` は web / worker が別プロセスの `MockObjectStore` を持つため worker 側の実測が常に 0 バイトになり、アップロードのあるテナントは毎日 `STORAGE_DIVERGENCE` になる —— `demo` は検算対象外と明示するか T-10-06 で扱う ②`usage.daily-rollup` は「昨日」だけを突き合わせるため、ワーカー停止中の日に生じた `GAP_MISMATCH` は検知されるが自動では直らない（Phase 1 に再実行の導線が無い。運営者の対処手順として扱う）③`SUSPENDED` 中はファンアウト対象外でスナップショットが取られず、7 日以内に `ACTIVE` へ戻るとその期間が `GAP_MISSING` になる（「計測しなかった」事実としては正しいが、表示上「欠測」と区別できない）④`usage-storage-reconcile` の解消スコープが当月キーのみのため、月末日に開いた `STORAGE_DIVERGENCE` が翌月 1 日に一致した場合、前月キーの行が閉じられず残る（前月キーもスコープに含めれば閉じる。SP-11 で直してよい）。

### T-11-05 🔴 `GATE_RUNNING` 滞留の区別表示（M）

- **実装**: `F-059 AC-6` / `docs/05` §16.5。
- 🔴 **`GATE_RUNNING` のまま一定時間を超えた対象が一覧に現れ、滞留の理由が「AI の日次コスト上限による停止」と「ジョブ失敗」に区別して表示される**（`F-027 AC-5`）。
- 🔴 **上限到達による滞留は障害ではないため、失敗ジョブ件数・ゲート FAIL 率・未対応 `SUBMIT_FAILED` のいずれの指標にも加算されない**（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。
- 🔴 **表示されるのは件数・理由・滞留時間のみで、提案本文には立ち入らない。**
- 🔴 **運営者は `A-005` の項目 12 で滞留を検知し、テナント利用者に再依頼を促すだけ**（`docs/05` §9.10 / [Issue #16](https://github.com/Festal-KM/SES-Platform/issues/16)）。**BullMQ の retry に相当する運営者操作を作らない**（`app_platform*` に `proposals` / `review_gates` の書き込みが無いため、作ろうとしても権限で弾かれる）。
- **完了の判定**: `F-059 AC-6` の結合テスト（HELD と `JOB_FAILED` が別区分で出て、指標に加算されない）+ 運営者向け retry 操作が存在しないことの静的テスト。
- ✅ **決着（2026-09-16 実装。材料まで。画面は T-11-04）**: `listGateStalls(ctx, { now, stallThresholdMinutes, failedJobs })`（`@ses/db/platform`。`packages/db/src/platform/queries/gate-stalls.ts`。`withPlatformRead` + `admin.monitoring.view`。純粋部分 `classifyGateStalls`）。理由は **3 区分** —— `AI_COST_LIMIT_HELD`（`review_gates(execution='HELD_AI_COST_LIMIT')`。**保留 = 障害ではない**）/ `JOB_FAILED`（🔴 **検知元は BullMQ の `gate.run` failed セット 1 つ**。`review_gates` に失敗の行は無く `SchedulerRun` は `gate.run` の単位ではない。項目 3 と同じ出所）/ `RUNNING_OVERDUE`（何も無く **`GATE_STALL_ALERT_MINUTES`**〔新設。既定 30〕超過 = 応答不明）。閾値は `RUNNING_OVERDUE` にだけ掛け、保留と失敗は即時に載せる。failed → 保留 → 閾値の優先順位（保留 + failed の両方がある対象は `JOB_FAILED` = 自動復帰が止まっている）。`packages/db` は Redis に依存しないため failed セットは**呼び出し側が `packages/connectors` の読み取り専用の照会で取り `failedJobs` で渡す**（照会関数は T-11-04 が足す）。応答はテナント ID・対象種別と ID・理由・時刻・分数のみ（`countsByReason` は 3 区分が別キー）。`tests/static/admin-no-content-reach.test.ts` に **`gate-stalls.ts` 1 本に限る行の読み取りの例外を足し、`select` のキーを状態・時刻・ID の許可リストで固定**した（件数の引き算では対象ごとの区別が付かない。列 GRANT は従来どおり）。運営者の retry が存在しないことは新設の `tests/static/admin-no-gate-retry.test.ts`（19 件。書き込みメソッドを持つ管理平面 API を固定の 6 本に固定）+ 結合 ⑨（`app_platform*` に `proposals` / `review_gates` の書き込み 0 件、UPDATE は `permission denied` を実測）。結合テスト `tests/isolation/admin-gate-stalls.test.ts`（23 件）+ ユニット `gate-stalls.test.ts`（23 件）。「失敗ジョブ数」「ゲート FAIL 率」の集計関数は**作っていない**（T-11-04）。詳細は `docs/05` §16.5 項目 12 / API-A8。
- 🔴 **T-11-04 への申し送り（`A-005` 項目 12 の表示）**: ①API-A8 に `items[kind='GATE_STALL']`（`docs/05` API-A8 の行の形。`listGateStalls` の DTO をそのまま写す）を足す。ルートは `apps/web/lib/db/bootstrap.ts` に `gateStallRuntime()` = `{ stallThresholdMinutes: GATE_STALL_ALERT_MINUTES }` の起動時アクセサを足して渡す（**ルートで `process.env` を読まない**）②🔴 **failed セットの読み取り**: `packages/connectors/src/bullmq.ts` に `gate.run` キューの failed を**読むだけ**の関数（例 `listBullMqFailedGateRunJobs(connection): Promise<Array<{ data: GateRunJob; failedAt: Date }>>`。`Queue.getFailed()` → `job.data` + `job.finishedOn ?? job.timestamp`）を足し、`FailedGateRunJob[]` に写して渡す。**`Job.retry()` / `remove()` / `enqueue` を持つオブジェクトを管理平面に渡さない**（`admin-no-gate-retry` ① は `@ses/connectors` の `createBullMq*` / `GATE_RUN_JOB` / `gateRunJobId` / `*GateRunQueue` / `*JobEnqueuer` / `BullMqConnection` の import を弾き、`listBullMqFailedGateRunJobs` のような読み取り専用の名前は通す〔対照テストで固定済み〕。`apps/web/lib/jobs/**` は `account-mail` 以外を弾くので、読み取りのアクセサは `apps/web/lib/jobs/` ではなく `apps/web/lib/monitoring/` 等に置き、`bootstrap.ts` で configure する）。Redis を読めなかったときは `RUNNING_OVERDUE` に畳まず、項目 12 を `failedJobsAvailable=false` 相当で「失敗記録を照合できていません」と出す（項目 13 の `providerReading.available=false` と同じ扱い）③**表示**: 行は `tenantId × reason` に畳み、列 = テナント（`A-003` への導線）/ 理由 / 件数 / 最長の滞留時間（`max(stalledMinutes)`）/ 最古の `since`。🔴 **`AI_COST_LIMIT_HELD` は保留の色**（`docs/04` `A-005` 項目 13 / 14 と同じ。障害の色にしない。行から `A-004`〔クォータの引き上げ〕へ）、**`JOB_FAILED` / `RUNNING_OVERDUE` は障害の色**。🔴 **操作導線を置かない**（retry / 削除 / 状態変更のボタンは作らない。`app_platform` に書き込みは無い）。添える文言は「テナント利用者に『レビュー依頼』（#39）の再実行を促してください」（`packages/i18n`）。`RUNNING_OVERDUE` には「ワーカー / Redis の稼働を確認」を添える ④🔴 **指標の非加算**: 項目 3（失敗ジョブ数）は BullMQ の failed セットから数えるため `AI_COST_LIMIT_HELD` は構造的に入らない。項目 5（ゲート FAIL 率）は `execution='DONE'` のみを分母・分子にすること（`docs/05` §16.5）。項目 1（未対応 `SUBMIT_FAILED`）は `state='SUBMIT_FAILED'` のみ。**結合テストで `AI_COST_LIMIT_HELD` の対象が 3 指標のいずれにも現れないことを固定する**（本タスクの結合 ⑤は状態と `execution` の側から固定済み。集計関数ができた時点で関数の側からも固定する）⑤`targetId` は表示してもよいが**リンクにしない**（管理平面に ID から内容を引く API は無く、`admin-no-content-reach` ③ が `/api/admin/proposals` を禁じている）⑥`rows` は 500 件で切られる（`total` と食い違えば「他 N 件」）⑦`PROJECT_PUBLISH` の行は対象の生存を確認していない（`project_publish_requests` に `app_platform` の GRANT が無い）。案件が削除された後の failed 記録が残ることがある。気になるなら SP-12 で `project_publish_requests(tenant_id, project_id, content_hash, requested_at)` に列 GRANT を足して母集団を絞る ⑧`E2E #15` の禁止値に提案の件名・本文・`findings` の抜粋を足す（結合 ⑥ が JSON 上で固定済み）。

### T-11-06 送信ドメイン未検証テナントの検知（M）

- **実装**: `F-059 AC-5` / `BR-71` / `F-001 AC-4`。
- 🔴 **送信ドメインの検証が未完了・失効のテナントが一覧に現れ、検証開始からの経過日数が分かる。** **このテナントは取引先へ 1 通も送れない状態にある**ため、運営者が顧客より先に気づいて伴走できる（`docs/01` 章 7.1 / 章 7.4）。
- **表示されるのは検証状態と日時のみで、業務データの内容には立ち入らない**（`BR-40`）。
- **`domain.recheck`（毎日 05:30 JST）で失効したものも同じ一覧に載る**（SP-04 の T-04-04）。
- **完了の判定**: `F-059 AC-5` の結合テスト。
- **決着（2026-09-16。実装者）**: 材料は `listUnverifiedSendingDomains(ctx, { now })`（`@ses/db/platform`。`withPlatformRead` + `admin.monitoring.view`。詳細は `docs/05` §16.5 項目 11）。対象 = `SANDBOX` / `ACTIVE` かつ `VERIFIED` 行が無いテナント（行が無い = 開設時に未入力も含む。`SUSPENDED` / `CLOSING` / `PURGED` は対象外）、1 テナント 1 行、`daysSinceStarted` 降順。🔴 **「一度も検証されていない `FAILED`」と「失効」を区別するために `tenant_sending_domains.revoked_at` を追加した**（migration 20260922000000。`expireSendingDomain` が `VERIFIED` からの降格でだけ立て、`markSendingDomainVerified` が消す。`docs/05` §3.9 / §8.3）—— 従来のスキーマでは両者が同じ行の形に合流し、`sending_domain.state_change` の監査も未実装で復元できなかった。結合テスト `tests/isolation/admin-sending-domains.test.ts`（22 件）。
- 🔴 **T-11-04 への申し送り（`A-005` 項目 11 の表示）**: ①行の見出しは「送信ドメイン未検証・失効のテナント」で件数は `total`、内訳は `countsByStatus`（`NOT_REGISTERED` = 未登録 / `REGISTERED` = 登録のみ〔SES 未作成〕/ `PENDING` = DNS 反映待ち / `FAILED` = 検証不成立〔一度も検証されていない〕/ `REVOKED` = **失効**）。`FAILED` / `REVOKED` を「障害」の色にしない（DNS 反映待ちが最多。`docs/04` 申し送り 8）②列 = テナント名（`A-003` への導線）/ 契約状態（`SANDBOX` は「試用中」と表示。本契約移行の条件であることを添える）/ ドメイン（`null` は「未登録」）/ 状態 / **検証開始からの経過日数**（`daysSinceStarted`。先頭が最も長い）/ 最終確認（`lastCheckedAt`）/ **失効**（`revokedAt` があれば「失効 N 日前」= `daysSinceRevoked`。`status` が `REGISTERED` / `PENDING` で `revokedAt` がある行は「失効後、再設定中」と読む）/ 提示中の DNS レコード本数（`expectedRecords`。値は出さない）③🔴 **表示するのはこの DTO のキーだけ**。ドメインの行へ遡って `dkim_tokens` / `mail_from_domain` / `last_failure_reason` を出さない（`BR-40`。E2E #15 の禁止値に DKIM トークン・MAIL FROM ドメインを足す）④運営者の操作は「気づいて伴走する」まで。**再検証・再設定のボタンを置かない**（検証は `OWNER` が `S-036` から行う。`app_platform` に `UPDATE` は無い）⑤`SUSPENDED` のテナントは載らないため、停止解除（`A-013`）の直後に項目 11 が増えうる —— 解除の確認画面で「送信ドメインが未検証です」を添える価値があるが本タスクの範囲外（SP-20 の停止・再開で扱う）⑥`items` は 500 件で切られる（`total` と食い違えば「他 N 件」を出す）。

### T-11-07 運営者マスキングの二層と非開示の検証（M）

- **実装**: `docs/05` §5.5（二層のマスキング）/ §5.7（運営者向け画面で見せるもの）。
- 🔴 **層 1 = DB の列レベル `GRANT`**（`app_platform` に非開示列を与えない）。**層 2 = シリアライザ**。**片方だけにしない。**
- 🔴 **運営者にも見せないもの**（`BR-40`）: 外部サービスのアクセストークン平文 / **スキルシートの原本と本文** / エンジニアの氏名・生年月日・連絡先 / チャットの本文。**運営者に必要なのは「件数・状態・エラー」であって「内容」ではない。**
- **E2E #15**: 運営者に非開示のものが**管理平面のどの応答にも現れない**（`A-002`〜`A-006` の全応答を JSON 化して禁止キー・禁止値が 0 件）。
- **静的テスト**: `platform-grants.test.ts`（SP-02 で作成。本タスクで対象列を確定させる）。
- **完了の判定**: E2E #15 が green + 静的テスト green。

### T-11-08 Anthropic tier 80% 到達の検知（S）

- **実装**: `docs/03` §8.2 / `docs/03` `pm` 申し送り 3。
- 🔴 **Start tier の $500 / 月では 39 テナントで頭打ちになる。** 80% 到達を `F-057`（クォータ管理）と `F-059`（運用監視）で検知する。
- **プラットフォーム全体の月次 AI コストを `A-004` / `A-005` に表示し、tier 上限に対する消費率を出す。**
- **完了の判定**: 80% 到達で `A-005` にアラートが出る結合テスト。
- ✅ **決着（2026-09-16 実装。材料まで。画面は T-11-02 / T-11-04）**: `readProviderMonthlySpend(ctx, { now, capUsd, warnPercent })`（`@ses/db/platform`。`packages/db/src/platform/queries/provider-spend.ts`。`withPlatformRead` + `admin.monitoring.view`）が **JST 暦月の `AiUsage` 全テナント合計**を `GROUP BY tenant_id, role` で**都度**集計し `{ periodKey, spentUsd, capUsd, consumptionRate, level, byRole, tenantCount, observedAt }` を返す。水準は **`decideLimitLevel`（`packages/domain`。T-10-03 のテナント別上限と同じ 1 実装。新関数を作っていない）**、閾値は **`QUOTA_WARNING_THRESHOLD_PERCENT`（既存。既定 80）**、上限は `ANTHROPIC_MONTHLY_SPEND_CAP_USD`（既存）で、どちらも起動時解決の値を引数で受ける。**日次のスナップショット表は作らなかった**（`docs/05` §16.5 項目 17 に理由）。`packages/domain` / `packages/config` / `apps/**` / migration に変更なし。結合テスト `tests/isolation/admin-provider-spend.test.ts`（16 件）+ 純粋部分のユニット `provider-spend.test.ts`（14 件）。詳細は `docs/05` §7.6 の行 / §16.5 項目 17 / API-A8。
- 🔴 **T-11-04 への申し送り（`A-005` 項目 17 の表示）**: ①API-A8 に `items[kind='PROVIDER_SPEND']: { scope:'ENVIRONMENT'; periodKey; spentUsd; capUsd; consumptionRate; level; tenantCount }` を足す（`docs/05` API-A8 の行）。**`byRole` は載せない**（`A-004` の材料）②`capUsd` / `warnPercent` は `apps/web/lib/db/bootstrap.ts` に `usageLimitsRuntime()` と同じ形の起動時アクセサ（例 `providerSpendRuntime()` = `{ capUsd: ANTHROPIC_MONTHLY_SPEND_CAP_USD, warnPercent: QUOTA_WARNING_THRESHOLD_PERCENT }`）を足してルートから渡す。**ルートで `process.env` を読まない** ③🔴 **`docs/04` の `A-005` 項目表に項目 17 がまだ無い**（項目 16 と同じ。`CLAUDE.md` §8.7 に従い着手時に `ui-design` で 1 行足す）。行の見出しは「AI 支出（環境全体）/ tier 上限」、対象テナント欄は項目 13 と同じ `−（環境全体）`、件数欄に `当月 $spentUsd / 上限 $capUsd（consumptionRate%）— N テナント` ④🔴 **`BELOW` でも行を出す**（項目 13 と同じく消費率で成立を示す。「0 件 = 正常」ではない）。`NEARING`（80%〜）で警告色、🔴 **`REACHED` は「全テナントの AI 機能が同時に止まる」危険であり、単一テナントの上限到達（`A-004` / `usage_limit_states`）と同じ色・同じ行に混ぜない**。対処は運営者の tier 昇格申請（`docs/03` §8.2）であり**画面に操作導線を置かない**（`app_platform` に書き込みは無い）⑤`consumptionRate` は **`capUsd` に対する率**（1 を超えうる。超えたら「上限超過」と表示し 100% に丸めない）⑥表示する値は DTO のキーだけ。`ai_usage` の行（対象・モデル・プロンプト版）へ遡らない（`BR-40`。E2E #15 の禁止値に対象 ID を足す）⑦`periodKey` は JST 暦月で、Anthropic 側の請求月（UTC）とは月末に 9 時間ずれる。画面に「推定値。請求額とは一致しない」を添える（`docs/05` §7.6 の ⚠️）⑧`A-003` / `A-004` への導線を描かない（`tenantId` が無い）。
- 🔴 **T-11-02 への申し送り（`A-004` の環境全体の行）**: ①`A-004` の上部（テナント一覧の外）に **「環境全体の当月 AI 支出 / tier 上限」** を 1 行置き、`readProviderMonthlySpend` の `spentUsd` / `capUsd` / `consumptionRate` / `level` と **`byRole`（6 ロール固定。`'0.000000'` を含む）** を出す（`F-057`「どのロールが原価を食っているか」/ `docs/03` §7.6.3-2）。テナント別の行（`usage_counters` / `usage_limit_states`。T-10-03 の `listUsageLimitAlerts`）と**別の集計・別の行**であることを表示で明示する（環境枠の到達をテナントの上限到達と混同させない）②金額は運営者向けなので出してよいが、**この DTO を主平面（`GET /api/usage` 系）に写さない**（`apps/web/lib/usage/view.types.test.ts` の型テストが金額キーを弾く。`@ses/db/platform` は主平面から import できない）③1 ページの読み込みで `readProviderMonthlySpend` と他の材料を並べて呼ぶと `admin.monitoring.view` の監査行が呼び出しごとに 1 行ずつ増える（既存の材料と同じ。1 画面 1 行に畳みたければ `withPlatformRead` を 1 回にして中で複数の材料を読む形に寄せる —— その場合も `readProviderMonthlySpend` の純粋部分 `summarizeProviderSpend` は再利用できる）。

### T-11-09 🔴 監査ログ詳細への `summary` の露出（`S-041`）（M）

- **背景**: [Issue #40](https://github.com/Festal-KM/SES-Platform/issues/40) に人間の回答が届いた（2026-09-10）—— **選択肢 2（監査ログの詳細に `summary` を出す）。既定として置いていた 1（据え置き）から変更された。**
- **何が足りていないか**: `F-014 AC-5` が求める「公開範囲の変更が監査ログに**残る**」は記録側（`project.visibility_change` の `before` / `after`）で満たしているが、**変更前後の公開先を画面から読む手段が無い**（`membership.role_change` の `beforeRole` / `afterRole` も同じ）。
- 🔴 **順序は上流から**（`CLAUDE.md` §8.7）: **`docs/04` §S-041 の列定義 → `docs/05` §6.4 #10 の応答 → 実装。** **結合テストが現在「`summary` を返さないこと」を意図した境界として固定している**ため、**そのテストごと更新する**（`docs/dev-plan.md` §8 の 2026-09-07 [Issue #36](https://github.com/Festal-KM/SES-Platform/issues/36) の前例と同じ扱い）。
- 🔴 **受け入れ基準（3 点。1 action だけ出すことはできないため、副作用を先に片づける）**:
  1. 🔴 **全 action の `summary` の棚卸しが済んでいること。** `summary` は **action ごとに異なる構造の値**が入る自由な JSON であり、**一律に出すと PII や商流情報が監査ログ画面に載る経路になる。** `BR-27` の記録対象すべてについて「何が入っているか」を表にし、**出す / 出さない / 出す前に落とす列**を明記する。🔴 **`skill_sheet.view` / `skill_sheet.download`（`F-012`）・`proposal.*`・`chat.*` は特に慎重に見る** —— 氏名・単価・エンド企業名・本文の断片が入っていれば、**その場で `summary` の書き込み側を直す**（画面で隠すのではなく、記録に入れない）。⚠️ **「今は入っていない」で通さない** —— **後から入りうる**ので、**出してよいキーの許可リスト方式**にして、未知のキーは既定で出さない構造にする。
  2. 🔴 **閲覧者ロールごとの見え方を確認すること。** `S-041` の閲覧者は `OWNER` / `ADMIN` のみ（`docs/04`）だが、🔴 **ホストの `ADMIN` にパートナー由来の行の `summary` が見えることの是非**を必ず判定する（第二境界。`CLAUDE.md` §3.1）。**他社の当事者・他社のエンジニア名が `summary` 経由で漏れないこと**を結合テストで固定する。**`VIEWER` / `PARTNER_*` に `S-041` の導線が無いこと自体も変えない。**
  3. 🔴 **運営者の横断検索（`A-006` / `T-11-03`）は別扱いである。** `CLAUDE.md` §10.4-6 / `BR-40` / `BR-42` により、**運営者には PII をマスキングして見せる**。🔴 **`S-041` に `summary` を出すことを理由に `A-006` にも出さない。** **`A-006` の応答に `summary` の生値が現れないこと**を `T-11-07` の E2E #15（非開示のものが管理平面のどの応答にも現れない）に含めて固定する。**「テナント側に出したから運営者にも」は、運営者に必要なのは件数・状態・エラーであって内容ではない、という §10.5 の原則に反する。**
- **完了の判定**: 上記 3 点 + ①`docs/04` / `docs/05` が先に更新されている ②`S-041` の詳細で `project.visibility_change` の before / after が読める（`F-014 AC-5` の画面側の充足）③許可リストに無いキーが応答に現れない結合テストが green ④`A-006` に生値が出ないことの E2E が green。

### T-11-10 🔴 Amazon SNS の準備と SMS 送信上限の確認・申請（S・非コードタスク）

- **背景**: [Issue #45](https://github.com/Festal-KM/SES-Platform/issues/45) で **2 要素認証への SMS 追加が人間の決定として確定した**（2026-09-10）。**プロバイダの既定は Amazon SNS**、**管理権限ロール（運営者 / `OWNER` / `ADMIN`）は TOTP 必須のまま**。**実装は SP-13 の `T-13-10`** である。
- 🔴 **なぜ実装より前（Phase 1 のうち）に置くか**: **日本向け SMS は送信上限（spending limit）の引き上げにサポートケースが要る可能性があり、リードタイムが読めない**（⚠️ **未裏取り**。`docs/dev-plan.md` §5 **E-17**）。**実装スプリントに入ってから申請すると待ち行列になる**（SES 本番アクセス申請＝ E-1 で実際に起きた。§6.4 R-02）。🔴 **自分でコントロールできない依存は、開発の完了を待たずに着手する**（`docs/dev-plan.md` §5 の原則）。
- **何を行うか**: ①**`tech-selection` に `docs/03` への裏取り（単価・送信上限・日本の事業者要件・到達率・代替）を依頼する**（本タスクは申請の実務、裏取りは `docs/03` の仕事。**両方の持ち主を空にしない**）②SNS のアカウント設定（サンドボックス状態の確認 / 検証済み宛先 / 送信上限）③**必要なら上限引き上げを申請し、提出日と応答日を記録する** ④**実プロバイダへの疎通確認は `production` が立った後に行う**（`T-13-10`。**環境が無い状態で「送れた」を確認したことにしない**）。
- **完了の判定**: ①申請の要否と結果（または「不要と判明した」こと）が `docs/dev-plan.md` §5 E-17 と §8 に記録されている ②`docs/03` に SMS プロバイダの確定値が入っている（`tech-selection` の成果物）③🔴 **`T-13-10` の着手時に待ちが発生しない状態になっている。**

### T-11-11 🔴 `S-015` の検索・ページング（M。**SP-08 からの申し送り。主平面の UI 是正**）

- **背景**（`docs/sprints/SP-08-anonymous-share.md` §8.6-5。2026-09-15）: `T-08-02` が実装した `S-015`（`apps/web/app/(main)/engineer-shares/engineer-share-screen.tsx`）と `GET /api/engineer-shares`（#29）は、**自社エンジニアの一覧を先頭 200 件で切っており検索・ページングが無い**。🔴 **台帳が 200 件を超えるパートナーは、201 件目以降のエンジニアを共有可にも解除にもできない** —— 経路 4 の入口が台帳の規模で閉じる。`docs/04` §S-015 には検索・ページングの記述が無く（**設計の欠落**）、実装は記述どおりに作られている。
- 🔴 **なぜ Phase 1 のリリース前か**: **取引先は 1 日 4〜5 時間滞在する主利用者であり、取引先向けの画面を簡易版にしない**（`CLAUDE.md` §1.2 の 🔴）。SES の取引先には数百名規模の要員を持つ会社が普通に在る。**「解除できない」は `F-016 AC-2`（いつでも解除でき即時反映）の実質的な違反**である。
- 🔴 **順序は上流から**（`CLAUDE.md` §8.7）: **`ui-design` が `docs/04` §S-015 を改訂**（検索条件の項目 = 氏名 / 稼働可能時期 / 共有状態を最小とする。**共有中と共有していない一覧の 2 表に対する検索・ページングの扱い**、モバイルでの検索の提供〔`S-005` と同じく省略しない〕、空状態の文言）→ **`program-design` が `docs/05` §6.5 #29 にカーソルページングと検索パラメータを追記**（`S-005` の #15 と同じ形。**`nextCursor` を返し、残件数・総件数を返さない**〔`docs/05` §4.8〕）→ 実装。
- **実装で守ること**:
  - 🔴 **一括で全件をオンにする操作は依然として存在しない**（`F-016 AC-1`。検索結果に対する「すべて共有」を作らない。**解除の一括**も作らない —— 解除は安全側の操作だが、1 件ずつの確認がある現行の形を崩さない）。
  - 🔴 **`previewedFields` のキー集合と丸め後の値だけを返す**現行の契約を変えない（`tests/isolation/engineer-shares.test.ts:550` が固定）。
  - **検索の評価はパートナー自身の台帳（C3 の自社行）に対して行う** —— 匿名候補の `criteria.ts` とは無関係（自社の台帳なので生値で検索してよい）。**フリーワードは `packages/db/src/search/**` の 1 箇所化を使う**（SP-06 の規律。新しい `ILIKE` を書かない）。
  - **モバイルでも検索を提供する**（`S-005` と同じ。省略しない。`CLAUDE.md` §13.3）。**1 件ずつの解除がモバイルで完結する**現行の性質を保つ。
- **完了の判定**: ①`docs/04` §S-015 と `docs/05` #29 が先に更新されている ②結合テスト: 台帳 250 件のパートナーで 201 件目のエンジニアを検索で見つけて共有可にでき、解除もできる（`engineer-shares.test.ts` に追加）③応答の契約（`items` / `nextCursor` の 2 キー。総件数を返さない）が型テストで固定 ④`S-015` の `*.render.test.tsx` と `home.mobile.spec.ts`（`S-015` を含む）が green で、判定を緩めていない ⑤一括オンの経路が存在しないテスト（`engineer-shares.test.ts:291`）が引き続き green。

### T-11-12 🔴 一覧テーブルの列幅と氏名セルの規約の決着（M。**SP-08 からの申し送り。主平面の UI 是正**）

- **背景**（`docs/sprints/SP-08-anonymous-share.md` §8.6-4。2026-09-15。2 件を 1 タスクにまとめた —— どちらも「一覧テーブルの列の描き方」の話で、別々に決めると同じ 4 画面を 2 度触る）:
  1. **`S-016` desktop（1440）で、候補テーブルの最終列「更新日」が横スクロール無しには見えない**（右パネルを開いた状態。`T-08-09` のスクリーンショット `tests/e2e/screenshots/S-016-desktop1440-host-anonymous-selected.png`）。Tier 2 の主画面であり、`docs/04` §S-016 は「8 列 + 右の詳細パネル」を定める。**BLOCKED ではない**（横スクロールで到達はできる）が、**更新日は Phase 1 の並び順のキーであり、見えないと並び順の説明（画面上部の 1 行）と表示が結びつかない**。
  2. 🔴 **氏名セルの切り詰め vs 折り返し**（`T-08-10` で発見。`docs/04` §10.3 の表に「未決着」と注記済み）: `docs/04` §10.3 の共通規約は「1 行で切り詰め + ツールチップ」だが、`S-005` / `S-010` / `S-011` の実装は**折り返し**（`whitespace-normal`）で描いている。🔴 **触端末ではツールチップを開けない**ため、切り詰めを採ると**モバイルで氏名の末尾が読めない**（`CLAUDE.md` §13.3「判断材料を隠さない」と衝突する）。逆に折り返しを採ると、1 万件規模の一覧で行の高さが揃わない。**どちらかが常に正しい前提を置かない。**
- 🔴 **順序は上流から**（`CLAUDE.md` §8.7）: **`ui-design` が `docs/04` §10.3（共通規約）と §S-016「デバイス別」を改訂** —— 氏名セルは「デスクトップは切り詰め + ツールチップ、`lg` 未満は折り返し」のような**ブレークポイント別の規約**を含めて決める。決定と根拠は `docs/04` §11 に 1 項を新設して残す（`T-08-10` の §11-12 と同じ形）→ 実装（`S-005` / `S-010` / `S-011` / `S-016` の 4 画面 + `@ses/ui` の `Table` に共通化できるなら共通化）。
- **実装で守ること**:
  - 🔴 **`S-016` は右パネルを開いた状態で全 8 列が読めること**（列幅の配分 / 更新日を `YYYY-MM-DD` の固定幅にする / 種別列をアイコン + ツールチップにしない〔文字で読めること〕等。**列を削らない** —— 8 列は `docs/04` §S-016 の定め）。
  - 🔴 **`T-08-11` の折り返し検出器（`expectNoBrokenLabels`）と `expectNoHorizontalOverflow` の判定を緩めない。** `1a1e7f8` の名称列の下限幅（10rem）は残す。
  - 🔴 **モバイルで判断材料を落とさない**（`CLAUDE.md` §13.3）。切り詰めを採る場合は**モバイルでは折り返す**か、全文へ到達する導線（詳細画面）が同じ行に在ること。
  - **`packages/ui` に文言を持たせない / 基底に打ち消せない値を焼き込まない**（SP-21 §8.4 の 3 点）。
- **完了の判定**: ①`docs/04` §10.3 / §S-016 が先に更新され、決定と根拠が §11 に在る ②`S-016` desktop 1440 のスクリーンショットで 8 列すべてが右パネルと同時に読める（`tests/e2e/anonymous-share.spec.ts` ②に `candidate-list-updated-on-{ref}` 相当の可視判定を足す。**新しい spec は作らない**）③4 画面の氏名セルが規約と一致する（`*.render.test.tsx`）④既存の E2E 43 本と `expectNoBrokenLabels` / `expectNoHorizontalOverflow` が判定無改変で green。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | 異常度スコアの算出（決定的）。マスキング関数。消費率・基準比の倍率の算出。 |
| **結合（DB あり）** | `F-056 AC-2` / `F-057` / `F-058` の全 AC と **`F-059`（`AC-1` / `AC-2` の契約書分を除く。Phase 3 の T-17-08 / T-19-08）**。`PLATFORM_SUPPORT` の権限差（クォータ変更が 403）。`GATE_RUNNING` 滞留の区別と指標への非加算。🔴 **`F-059 AC-7`: 項目 13 / 14 / 15 の 6 点**（T-11-04 の完了の判定①〜⑥）。 |
| **静的テスト** | `platform-grants.test.ts` / `platform-write-scope.test.ts`（SP-02 で作成、対象列をここで確定）。運営者向け retry 操作が存在しない。 |
| **E2E** | 🔴 **E2E #15**（運営者に非開示のものが管理平面のどの応答にも現れない）。`A-002`〜`A-006` の主要導線。**Tier 3 だがモバイルで遮断しない**（`CLAUDE.md` §13.3）。 |
| **外部 API のモック方針** | Sentry は `development` では無効化する。SES のバウンス・苦情の Webhook はフィクスチャ（SP-04 で作成済み）を流して `A-005` に現れることを検証する。 |

## 6. 完了判定

1. `F-056`（健全性）/ `F-057` / `F-058` の全 AC と、**`F-059`（`AC-1` / `AC-2` の契約書分を除く）** が結合テストで green。
   - 🔴 **`F-059 AC-1` / `AC-2` の Phase 3 分（`SENDING`（契約書）の滞留・未対応の `SEND_FAILED`）は本スプリントの対象外である**（本ファイル §4 T-11-04 のとおり、Phase 1 に `Contract` は存在しない）。**完成させるのは `T-17-08`**（`SENDING` の滞留 / 未対応の `SEND_FAILED`）**と `T-19-08`**（電子署名の未着）。
   - **到達不能な条件を完了判定に書かない**（`MODE: REVIEW` は 1 件でも NG なら `PHASE_INCOMPLETE` とするため、書くとこのスプリントが永久に閉じない）。
2. 🔴 **管理平面が既定 read-only であり、書き込みが許されるのは契約・クォータ・機能フラグ・お知らせに限られる**（静的テストで固定）。
3. 🔴 **E2E #15 が green** — 運営者に非開示のものが管理平面のどの応答にも現れない（列レベル `GRANT` とシリアライザの二層）。
4. 🔴 **`GATE_RUNNING` の滞留が「AI 上限」と「ジョブ失敗」に区別され、上限到達分が失敗ジョブ数・ゲート FAIL 率・未対応 `SUBMIT_FAILED` に加算されない。**
5. 🔴 **送信ドメイン未検証・失効のテナントが検知でき、経過日数が分かる。**
6. 🔴 **クォータ変更が `PLATFORM_OWNER` のみで、引き下げに適用日と通知が必須。**
7. 監査ログ横断検索が期間必須で、PII がマスキングされ、内容への到達導線が無い。
8. Anthropic tier の 80% 到達が検知できる。
9. 🔴 **`A-005` の項目 13 / 14 / 15 が Phase 1 で実装され、API-A8 が `kind='MAIL_PROVIDER_QUOTA'` / `'SEND_HOLD'` / `'PURGE_NOTICE_PENDING'` を返す**（`F-059 AC-7` / `F-064 AC-10` / `docs/05` §16.5 / §6.9）。
   - 🔴 **項目 13 は環境全体の値であり `tenantId` を持たず、テナント日次上限（`F-027` = `A-004` のメール列）とは別行である。** 上限値は `MAIL_PROVIDER_DAILY_QUOTA`（`packages/config`）でありハードコードされていない。
   - 🔴 **項目 14 の `PROVIDER_QUOTA` 行のみ `scope:'ENVIRONMENT'`**、`RATE_LIMIT` を含む他 6 値は `scope:'TENANT'`。**混ぜて集計していない。**
10. 🔴 **`S-041` の詳細で `summary` が読め、許可リストに無いキーが応答に現れない**（`T-11-09`。[Issue #40](https://github.com/Festal-KM/SES-Platform/issues/40) = 回答 2）。🔴 **`A-006`（運営者の横断検索）に `summary` の生値が現れない**（`BR-40` / `BR-42`。E2E #15）。
11. **`T-11-10`（Amazon SNS の準備と送信上限の確認・申請）の結果が `docs/dev-plan.md` §5 E-17 / §8 に記録されている**（[Issue #45](https://github.com/Festal-KM/SES-Platform/issues/45)）。🔴 **本項は非コードタスクだが、記録が無ければ未完了とする**（`T-01-09` / `T-12-09` と同じ扱い）。
12. 🔴 **`T-11-11`**: `S-015` で台帳 200 件超のパートナーが 201 件目以降を共有可 / 解除でき、`docs/04` §S-015 と `docs/05` #29 が先に更新されている。**一括オンの経路が依然として存在しない**（SP-08 からの申し送り。**主平面の是正。管理平面の成立とは別枠で数える**）。
13. 🔴 **`T-11-12`**: `S-016` desktop 1440 で右パネルと同時に全 8 列が読め、氏名セルの規約（`docs/04` §10.3）と `S-005` / `S-010` / `S-011` / `S-016` の実装が一致し、決定と根拠が `docs/04` §11 に在る。**折り返し検出器と横溢れの判定を緩めていない**（同上）。
   - 🔴 **項目 15 は項目 7（削除ジョブの失敗）と別行**であり、失敗ジョブ数に加算されない。
   - 🔴 **項目 13 / 14 に再送ボタンが無い**（復帰は `send.hold-release` の自動。人間の再送と多重化すると二重送信になる）。
10. **申し送り**: `docs/05` TBD-12 は**決着済み**であり、本項目は `sandbox` 固有ではなく**環境全体の機構**として `production` でも有効である。🔴 **SES の枠が引き上げられても監視項目を外さない**（外すと引き上げ後の枯渇に気づけない）。`F-059 AC-1` / `AC-2` の契約書分は Phase 3 の T-17-08 / T-19-08 へ送る（§6-1）。
