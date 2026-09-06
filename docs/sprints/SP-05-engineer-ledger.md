# SP-05 engineer-ledger — エンジニア台帳・スキル辞書・スキルシート

> **Phase**: 1（MVP） / **前提**: SP-03 / **後続**: SP-06 / SP-08 / SP-09
> **一次資料**: `docs/02` `F-008` `F-010` `F-011` `F-012` / `docs/03` §3.4（ウイルススキャン）/ §3.6 / §4.5 / `docs/04` `S-005`〜`S-009` / `docs/05` §3.4 / §6.4 / §9.6 / §14 / `CLAUDE.md` §3.5
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-05`
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-005`〜`S-009`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**全 88 枚が生成済みである**（2026-09-03。[Issue #17](https://github.com/Festal-KM/SES-Platform/issues/17) = A の決着後に残り 82 枚を生成し、`docs/04` 改訂 5 の `S-046` 分 3 枚を追加した）。**本スプリントの着手条件は満たされている。** 画面の新設・改訂で不足が生じた場合のみ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

エンジニア台帳（自社 / パートナーを同じ土俵で扱う）とスキル辞書、スキルシートの版管理を通す。本スプリントの中核は **`CLAUDE.md` §7 の「スキルシートの閲覧・DL で監査ログが欠落した件数 = 0 件」（K-7）** と **「ウイルススキャンが `CLEAN` になるまで共有 URL を発行しない」（`BR-26`）** の 2 つを、**導線ではなく構造で**成立させることである。

## 2. 対応機能 ID

`F-008` / `F-010` / `F-011` / `F-012`（`F-009` の複合検索は SP-06。`F-032` / `F-033` の AI 解析は SP-14）

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-05-01 | エンジニアの登録・編集（`F-008`）と `S-007` | 所有パートナーは認証コンテキストから決まる。入力で他社を指定しても変わらない | `F-008 AC-1`〜`AC-3` | L |
| T-05-02 | エンジニア詳細（`S-006`）と閲覧の監査 | 詳細閲覧が `AuditLog` に記録される。ホストは他社エンジニアの実名に到達できない | `F-008 AC-3` `AC-4` | M |
| T-05-03 | スキル辞書・別名・新語候補（`F-010`）と `S-009` | 新語候補は明示的な採用まで正規化に使われない。グローバル辞書は編集不可 | `F-010 AC-1`〜`AC-3` | M |
| T-05-04 | S3 直接アップロードとストレージ計測 | 🔴 **上限超過なら署名付き URL を発行しない**。バイト数を `UsageCounter` に加算 | `F-011` / `docs/03` §4.5 | M |
| T-05-05 | ウイルススキャン（GuardDuty）コネクタとジョブ | 🔴 `THREATS_FOUND` の後に `NO_THREATS_FOUND` が来ても `CLEAN` に戻さない | `BR-26` / `docs/03` `program-design` 申し送り 15 | L |
| T-05-06 | スキルシートの版管理と `CLEAN` ゲート（`S-008`） | `CLEAN` でないファイルは共有 URL・提案添付・チャット添付のいずれもできない | `F-011 AC-1`〜`AC-4` | L |
| T-05-07 | 🔴 **閲覧・DL と監査ログ欠落 0 件（`F-012`）** | 🔴 **記録の書き込みが失敗したらファイルの内容が返らない** | `BR-28` / K-7 | L |
| T-05-08 | スキャン失敗・隔離の周知 | アプリ内表示は分類によらず必ず行う。メールは宛先分類に従う | `F-011` 処理④ / `A-22` | M |
| T-05-09 | エンジニア一覧の骨格（`S-005`） | 境界適用後の母集団のみ。`total` も同じ `where` | `F-004 AC-3` | M |
| T-05-10 | K-7 の結合 / E2E（3 経路の監査記録） | デスクトップ・モバイル・共有 URL のいずれでも記録される | `F-012 AC-1` | M |

## 4. タスク詳細

### T-05-01 エンジニアの登録・編集（L）

- **実装**: `POST /api/engineers` / `PATCH /api/engineers/{id}`（#16）。画面は `S-007`（Tier 3）。
- 🔴 **`EngineerInput` に `ownerPartnerCompanyId` を含めない**（`F-008 AC-2`）。所有パートナーは**登録者の所属から自動で確定**し、SP-02 の継承・freeze トリガが DB 側でも上書きする。
- 🔴 **入力項目は `BR-52` の範囲に限る**（`F-008 AC-1`）。**本籍・家族構成・健康情報・信条にあたる項目を、既定の入力項目としても自由記述欄の推奨用途としても作らない。** 集めていない情報は漏れない。
- スキルは `F-010` の辞書から選ぶ。自由入力は**別名候補として起票**する（辞書には追加しない）。
- 作成・更新・削除を `AuditLog` に記録。
- **完了の判定**: `F-008 AC-1`〜`AC-3` の結合テスト（**入力で他社を指定しても所有パートナーが変わらない**ことを含む）。
- **ブロッカーではないが確認中**: 🔴 **経歴（`careers`）の保存先** — `F-008` の入力にある経歴を Phase 1 で独立した表として持つか、スキルシート（`F-011`）に一本化するか。[Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) で確認中で、**既定 C（Phase 1 は経歴の構造化保存を行わずスキルシートのみとし、`EngineerSnapshot.careers` は空配列で凍結する）で実装済み**である。🔴 **SP-09 の提案時スナップショット（経路 2 の凍結）がこの決定に依存する** —— 後から表を足す場合、**それ以前に作られた `EngineerSnapshot` には経歴が入らない**（凍結は遡れない）。決着期限は **SP-09 着手前**（`docs/dev-plan.md` §9）。
- ✅ **完了（2026-09-06、コミット `e782282`）** — `POST /api/engineers` / `PATCH /api/engineers/{id}`（#16）と `S-007`（Tier 3）。🔴 **`EngineerInput` に `ownerPartnerCompanyId` を持たせず、所有パートナーは登録者の所属から確定する**（入力で他社を指定しても変わらない。アプリと SP-02 の継承・freeze トリガの二重）。入力項目は `BR-52` の範囲に限り、**本籍・家族構成・健康情報・信条にあたる項目を既定の入力項目としても自由記述欄の推奨用途としても作っていない**。スキルは `F-010` の辞書から選び、自由入力は別名候補として起票する（辞書には追加しない）。作成・更新・削除を `AuditLog` に記録。`F-008 AC-1`〜`AC-3` の結合テストが green。

### T-05-02 エンジニア詳細と閲覧の監査（M）

- **実装**: `GET /api/engineers/{id}`（#17）。画面は `S-006`（Tier 2）。
- 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-008 AC-4`）。**記録が成立してからでなければ内容を返さない。**
  🔴 **記録は `readEngineerDetail` の業務トランザクション内（`writeAuditLog`）で書く**（`docs/05` §6.4「#17 の実装の決着（T-05-02）」/ §16.1）。**当初ここに書いていた「`withApiRoute` の `audit` オプションで書く」は取り下げた** —— ①`S-006` はサーバコンポーネントで Route Handler を通らないため、ルート側に置くと**画面経路だけ記録が漏れる** ②`audit` はハンドラの前に別トランザクションで書くため、**404（境界外・不存在）でも「閲覧した」記録が残る**。記録の経路を 1 本にする形（`skill_sheet.download` を `issueDownloadUrl` に寄せるのと同じ）に揃えた。
- 🔴 **ホスト所属の利用者は、他パートナーが登録したエンジニアの実名・所属会社名・スキルシートに到達できない**（`F-008 AC-3`）。到達できるのは SP-08 の匿名 5 項目か、SP-09 の `EngineerSnapshot` のみ。**境界外の ID は 404**。
- **完了の判定**: `F-008 AC-3` / `AC-4` の結合テスト。
- ✅ **完了（2026-09-07、コミット `1b405c0`）** — `GET /api/engineers/{id}`（#17）と `S-006`（Tier 2）。🔴 **閲覧の記録を `readEngineerDetail` の業務トランザクション内（`writeAuditLog`）に置き、記録が成立してからでなければ内容を返さない**（`BR-27` / `F-008 AC-4`）。**当初の「`withApiRoute` の `audit` オプションで書く」は取り下げた** —— `S-006` はサーバコンポーネントで Route Handler を通らず画面経路だけ記録が漏れること、および `audit` はハンドラ前に別トランザクションで書くため **404（境界外・不存在）でも「閲覧した」記録が残る**ことの 2 点による（`docs/05` §6.4 / §16.1 に決着を追記済み）。🔴 **ホスト所属の利用者は他パートナーが登録したエンジニアの実名・所属会社名・スキルシートに到達できず、境界外の ID は 404**（`F-008 AC-3`）。到達経路は SP-08 の匿名 5 項目か SP-09 の `EngineerSnapshot` に限られる。

### T-05-03 スキル辞書・別名・新語候補（M）

- **実装**: `GET /api/skills` / `GET /api/skill-aliases`（#23）/ `POST /api/skill-aliases/{id}/decide`（#24）。画面は `S-009`（Tier 3）。
- 🔴 **新語候補は `ADMIN` または `SALES` が明示的に採用するまで検索の正規化に使われない**（`F-010 AC-1`）。**パートナーは起票のみ。**
- 🔴 **グローバル辞書（`Skill`）はテナントから編集できない**（`BR-02` の射程。`F-010 AC-2`）。テナント固有の別名は他テナントに影響しない（C1 の `SELECT` は `OR tenant_id IS NULL`、書込は `tenant_id = app_tenant_id()`）。
- 採用・却下を `AuditLog` に記録（`F-010 AC-3`）。
- **完了の判定**: `F-010 AC-1`〜`AC-3` の結合テスト。
- **ブロッカーではないが確認中**: 🔴 **別名候補の採否を `OWNER` にも許すか** — `F-010 AC-1` は採用者を `ADMIN` / `SALES` と書いているが、`OWNER`（組織の全権）が辞書の採否だけできない状態は他のテナント設定の扱いと揃わない。[Issue #36](https://github.com/Festal-KM/SES-Platform/issues/36) で確認中で、**現状は `docs/02` の記述どおり `ADMIN` / `SALES` 限定で実装済み**である。🔴 **`tests/isolation/skill-dictionary.test.ts:301` が「`OWNER` は採否できない」という現状の挙動を固定しているため、既定 A（`OWNER` を追加）を採るときはテストごと更新する**（テストを残したまま実装だけ変えると赤になる）。決着期限は 🔴 **SP-06 の早いタスクで既定 A を実装する**（`docs/dev-plan.md` §9。SP-05 の完了確認までに回答が来なかったため、期限を SP-06 側へ送った）。
- ✅ **完了（2026-09-07、コミット `7692d67`）** — `GET /api/skills` / `GET /api/skill-aliases`（#23）/ `POST /api/skill-aliases/{id}/decide`（#24）と `S-009`（Tier 3）。🔴 **新語候補は `ADMIN` または `SALES` が明示的に採用するまで検索の正規化に使われず、パートナーは起票のみ**（`F-010 AC-1`）。🔴 **グローバル辞書（`Skill`）はテナントから編集できない**（`F-010 AC-2`）—— C1 の `SELECT` は `OR tenant_id IS NULL`、書込は `tenant_id = app_tenant_id()` であり、テナント固有の別名は他テナントに影響しない。採用・却下を `AuditLog` に記録（`AC-3`）。`tests/isolation/skill-dictionary.test.ts` が green。

### T-05-04 S3 直接アップロードとストレージ計測（M）

- **実装**: `POST /api/engineers/{id}/skill-sheets/upload-url`（#18）。`docs/05` §14.1（オブジェクトキー）/ §14.2（pre-signed URL）。
- 🔴 **ブラウザ → S3 への直接アップロード**（`docs/03` `program-design` 申し送り 23。Vercel のボディ上限 4.5 MB を経由させない）。
- 🔴 **1 バケット + テナント別プレフィックス**（`docs/03` `program-design` 申し送り 16。テナント別バケットは GuardDuty の保護バケット上限 25 で詰まる）。
- 🔴 **ストレージ上限を超過していたら署名付き URL を発行しない**（`docs/03` §4.5 / `docs/03` `program-design` 申し送り 25。発行してから失敗させると S3 とカウンタがずれる）。
- 🔴 **ストレージ使用量は `UsageCounter` のバイト数が正。** アップロード完了の確定時に加算、削除ジョブの S3 削除成功時に減算する。**S3 Inventory / Storage Lens は日次の検算であり正ではない**（`usage.storage-reconcile` は乖離を `A-005` に出すだけで**自動補正しない**。実装は SP-10 / SP-11）。
- **完了の判定**: 上限超過で URL が発行されない結合テスト。加算・減算の冪等性。
- ✅ **完了（2026-09-07、コミット `74b97e2`）** — `POST /api/engineers/{id}/skill-sheets/upload-url`（#18）。🔴 **ブラウザ → S3 への直接アップロード**（Vercel のボディ上限 4.5 MB を経由させない）と **1 バケット + テナント別プレフィックス**（GuardDuty の保護バケット上限 25 で詰まらせない）。🔴 **ストレージ上限を超過していたら署名付き URL を発行しない**（発行してから失敗させると S3 とカウンタがずれる。`docs/03` §4.5）。使用量は `UsageCounter` のバイト数を正とし、**アップロード完了の確定時に加算・削除ジョブの S3 削除成功時に減算する**（加算・減算は冪等）。S3 Inventory / Storage Lens は日次の検算であって正ではなく、`usage.storage-reconcile` は乖離を `A-005` に出すだけで自動補正しない（実装は SP-10 / SP-11）。

### T-05-05 ウイルススキャンのコネクタとジョブ（L）

- **実装**: `packages/connectors/src/scan/**` + `mock/**`。`POST /api/webhooks/guardduty`（EventBridge → API Destination。HMAC ヘッダを自前で検証）。ジョブ `scan.apply-result` / `scan.poll`。`FileScanResult`。
- 🔴 **スキャン結果の受信は at-least-once であり重複する**（`docs/03` `program-design` 申し送り 15）。`UNIQUE(objectKey, versionId)` を置く。
- 🔴 **`THREATS_FOUND` の後に `NO_THREATS_FOUND` が来ても `CLEAN` に戻さない**（順序逆転）。
- 🔴 **`UNSUPPORTED` / `ACCESS_DENIED` / `FAILED` を `CLEAN` として扱わない**（`BR-26`）。
- `scan.poll`（毎 5 分）が `SCAN_STALL_ALERT_MINUTES`（既定 10）を超えた `SCANNING` を照会し、不明なら `A-005`。
- 🔴 **E-13 の実測**（`docs/03` `pm` 申し送り 6 / `docs/05` TBD-7）: **設計は `SCAN_STALL_ALERT_MINUTES` で滞留を検知する形にし、目標値に依存させない**（T-05-05 で実装済み）。~~本タスクの実装時に GuardDuty のスキャン所要時間を実測する~~ → 🔴 **実測は AWS 環境の構築時（SP-12 前後）へ移した（2026-09-06）** —— GuardDuty Malware Protection for S3 を有効化した実 AWS アカウントと保護バケットが無いと計測できず、かつ**滞留の判定は設定値 1 つだけ**でコードにも状態機械にも所要時間の前提が無いため、実測の遅れが本スプリントの受け入れをブロックしない（`docs/03` §3.4.3-8 / `docs/05` §8.5.1 / `docs/dev-plan.md` §5 E-13）。`docs/02` 章 7.1 の「2 分以内」を満たせない場合に**目標値の見直しを人間に提起する**点は変わらない。🔴 **実測時期の変更は [Issue #37](https://github.com/Festal-KM/SES-Platform/issues/37) で確認中（`assumption`）。**
- **完了の判定**: 重複配信・順序逆転・4 種のステータスのフィクスチャテストが green（**実測は上記のとおり別扱い**）。
- ✅ **完了（2026-09-07、コミット `c3f3a30`）** — `packages/connectors/src/scan/**` + `mock/**`、`POST /api/webhooks/guardduty`（EventBridge → API Destination。HMAC ヘッダを自前で検証）、ジョブ `scan.apply-result` / `scan.poll`（毎 5 分）、`FileScanResult`。🔴 **受信は at-least-once であり重複するため `UNIQUE(objectKey, versionId)` で吸収し、`THREATS_FOUND` の後に `NO_THREATS_FOUND` が来ても `CLEAN` に戻さない**（順序逆転）。🔴 **`UNSUPPORTED` / `ACCESS_DENIED` / `FAILED` を `CLEAN` として扱わない**（`BR-26`）。滞留は `SCAN_STALL_ALERT_MINUTES`（既定 10）で検知し `A-005` に出す。🔴 **スキャン結果の適用は `app_scan_probe`（専用ロール）+ `SECURITY DEFINER` + 列レベル `GRANT` で `skill_sheets` のスキャン 3 列（`scan_status` / `scan_updated_at` / `is_latest`）だけを所有者に依らず書ける形にした**（migration 20260908000000。`docs/05` §8.5.1。[Issue #27](https://github.com/Festal-KM/SES-Platform/issues/27) ②の一部反映）—— テナント境界は関数本体の `app_tenant_id()` が課し、`app_tenant_id() IS NULL` は fail-closed で拒否する。🔴 **これを「ワーカーがパートナー所有行に触れるときの汎用の入口」として流用しないこと。** 🔴 **E-13（スキャン所要時間の実測）は SP-12 の T-12-09（AWS 環境の構築）へ移した**（設計は所要時間に依存しない。[Issue #37](https://github.com/Festal-KM/SES-Platform/issues/37)）。

### T-05-06 スキルシートの版管理と `CLEAN` ゲート（L）

- **実装**: `POST /api/engineers/{id}/skill-sheets`（#19）。画面は `S-008`（Tier 3）。
  - ✅ **実装時に API を 2 本足した**（`docs/05` §6.4 に #19b / #19c として追記済み。`CLAUDE.md` §8.7）: **`POST /api/skill-sheets/{id}/latest`（版の切替）** と **`DELETE /api/skill-sheets/{id}`（削除）**。理由は「`AC-4` が**版の切替と削除**の記録を要求しており、#19 が作る行は `SCANNING` で `is_latest` を立てられない（DB の CHECK が拒否する）」ため —— 切替は `CLEAN` になった後の明示操作でしかありえない。
  - ✅ **`skill_sheets.note`（版のメモ）の列を足した**（migration 20260909000000）。`F-011` の入力と #19 の request には最初から `note?` があったが `docs/05` §3.4 に保存先が無かった。
- 🔴 **`CLEAN` でないファイルについて、共有 URL の発行・提案への添付・チャットへの添付のいずれもできない。導線が存在しない**（`F-011 AC-1`）。**「無視して共有」を作らない。**
- **スキャン未完了は「検査中」と表示し、共有操作が選択できない**（`F-011 AC-2`）。
- **感染を検出したファイルは隔離し、以後どのロールからもダウンロードできない**（`F-011 AC-3`）。
- **`CLEAN` になった版のみ最新版フラグを持てる。**
- アップロード・版の切替・削除を `AuditLog` に記録（`F-011 AC-4`）。
- 🔴 **画像 PDF / 画像ファイルは「自動読み取りに対応していない」と明示する**（`docs/03` `ui-design` 申し送り 8）。**アップロード自体は受け付ける**が抽出は行わず手入力になる（抽出は SP-14）。
- **完了の判定**: `F-011 AC-1`〜`AC-4` の結合テスト。**共有導線が DOM に存在しないこと**の E2E。
- 🔴 **検証の割り当て（読み替えの固定。`docs/dev-plan.md` §8 の 2026-09-05 T-03-08 / 2026-09-06 SP-04 の前例と同じ扱い）**: 上の「**共有導線が DOM に存在しないこと**の E2E」の実体は **`apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.render.test.tsx`**（`CLEAN` でない版に共有・添付の導線が描かれないことを DOM で確認）+ **`tests/isolation/skill-sheets.test.ts`**（API 側で共有 URL の発行・提案添付・チャット添付のいずれも成立しないこと）である。**割り当ての出所は `docs/05` §17.4 の「実装」列**であり、**同じ検証を 2 箇所に書かない**（テストを新設して名前を計画に合わせるのではなく、実体への読み替えを本記録に固定する）。
- ✅ **完了（2026-09-07、コミット `901c186`）** — `POST /api/engineers/{id}/skill-sheets`（#19）に加え、**`POST /api/skill-sheets/{id}/latest`（版の切替）**と **`DELETE /api/skill-sheets/{id}`（削除）**を #19b / #19c として実装した（`AC-4` が切替と削除の記録を要求しており、#19 が作る行は `SCANNING` で `is_latest` を立てられないため。`docs/05` §6.4 に追記済み）。`skill_sheets.note`（版のメモ）の列を足した（migration 20260909000000）。画面は `S-008`（Tier 3）。🔴 **`CLEAN` でないファイルは共有 URL の発行・提案への添付・チャットへの添付のいずれもできず、導線そのものが存在しない**（`F-011 AC-1`。**「無視して共有」を作っていない**）。スキャン未完了は「検査中」と表示して共有操作を選択させず（`AC-2`）、感染を検出した版は隔離して以後どのロールからもダウンロードできない（`AC-3`）。**`CLEAN` になった版のみ最新版フラグを持てる。** アップロード・版の切替・削除を `AuditLog` に記録（`AC-4`）。画像 PDF / 画像ファイルは「自動読み取りに対応していない」と明示し、アップロードは受け付けるが抽出は行わない（抽出は SP-14）。

### T-05-07 🔴 閲覧・DL と監査ログ欠落 0 件（L）

- **実装**: `GET /api/skill-sheets/{id}/download-url`（#20）/ `GET /api/skill-sheets/{id}/preview`（#21）。`docs/05` §14.2 の `issueDownloadUrl`。
  - ✅ **`issueDownloadUrl` を `apps/web/lib/storage/download.ts` に置いた**（`docs/05` §14.2 に決着を追記済み）。**`ObjectStore.presignGet` を呼んでよいのはこの 1 ファイルだけ**であり、`tests/static/auth-db-callers.test.ts` の `ALLOWED_CALLERS` が固定する（契約書 #82 / 返却データ #78 も同じ関数を通すこと）。
  - ✅ **T-05-06 の申し送り（元ファイル名）を決着させた**: 🔴 **列を足さず、`Content-Disposition` を版番号で組み立てる**（`skill-sheet-v3.xlsx`）。ファイル名は氏名を含みうる PII であり、①保存すれば運営者 GRANT・監査・エクスポートの全経路で除外し続ける必要が生じ ②ダウンロード名は署名付き URL のクエリに載るため履歴・ログ・Sentry に氏名が現れる ③`docs/04` §S-008 の版一覧はそもそもファイル名を出さない。理由と規約は `docs/05` §14.1（`docs/05` §6.4 #19 の ⚠️ も打ち消し済み）。
  - ✅ **非 `CLEAN` の DL は 409 `FILE_NOT_CLEAN`**（`SKILL_SHEET_NOT_CLEAN`〔＝ 最新版にできない〕と畳まない。止めている操作も次の行動も違う）。
  - ✅ **`S-008` に「この版を開く」（#21）と「ダウンロード」（#20）の導線を足した**（`docs/04` §S-008 に追記済み。`CLAUDE.md` §8.7）。**閲覧は全ロール・全状態**、**DL は `CLEAN` かつ `VIEWER` 以外**にだけ描く。
  - ⚠️ **`docs/05` §14.2 の前提条件④「代理閲覧中でない」（`F-060 AC-3`）は未実装**（`ImpersonationSession` は Phase 2 で、ctx に代理閲覧中を表す値が無い）。動かせない分岐を先回りで書いていない。🔴 **実装が入るときの追加箇所は `issueDownloadUrl` の 1 箇所**である（発行経路がそこしかない）。
- 🔴 **`scanStatus='CLEAN'` かつ `AuditLog` の書き込みが成功した後にのみ署名付き URL を発行する**（`F-012 AC-2`）。**記録なしの閲覧が成立しない。**
- 🔴 **閲覧とダウンロードを個別に記録する**（`F-012 AC-1` / `BR-28`）。**デスクトップ・モバイル・共有 URL のいずれの経路でも**記録される（T-05-10 で証明）。
- 🔴 **`VIEWER` はダウンロードを実行できず、導線も表示されない。閲覧は可能**（`F-012 AC-3` / `BR-31`）。
- 🔴 **ホスト所属の利用者は、パートナー所属エンジニアのスキルシートに `Proposal` が作成される前は到達できない**（`F-012 AC-4` / `BR-59`）。SP-08 / SP-09 で経路 4 → 経路 2 の合流として検証する。
- **プレビューは本文を返さない**（`{ meta }` のみ）。
- **完了の判定**: `F-012 AC-1`〜`AC-4` の結合テスト + **監査ログの書き込みを失敗させる注入テストでファイルが返らないこと**。
  - ✅ `tests/isolation/skill-sheet-download.test.ts`（30 件）。注入は**実装に seam を作らず** `audit_logs` の `BEFORE INSERT` トリガで行う（作った seam はそのまま「記録を書かずに進める経路」になる）。🔴 **`raise`（例外）と `swallow`（静かに 0 行）の 2 通り**を試す —— 後者は `writeAuditLog` の `count !== 1` 判定だけが検出できる最も危険な壊れ方であり、ルート経由で `AUDIT_WRITE_FAILED`（500）になることまで固定した。
  - ✅ **`deviceKind` の 4 値すべて**（`desktop` / `mobile` / `tablet` / `api`）で記録されることを確かめる（`CLAUDE.md` §13.3）。画面 3 経路の E2E は T-05-10。
- ✅ **完了（2026-09-07、コミット `088bec0`）** — `GET /api/skill-sheets/{id}/download-url`（#20）/ `GET /api/skill-sheets/{id}/preview`（#21）と `issueDownloadUrl`（`apps/web/lib/storage/download.ts`）。🔴 **`ObjectStore.presignGet` を呼んでよいのはこの 1 ファイルだけ**であり、`tests/static/auth-db-callers.test.ts` の `ALLOWED_CALLERS` が固定する（契約書 #82 / 返却データ #78 も同じ関数を通す）。🔴 **`scanStatus='CLEAN'` かつ `AuditLog` の書き込みが成功した後にのみ署名付き URL を発行する** —— 記録なしの閲覧が成立しない（`F-012 AC-2`）。閲覧とダウンロードを個別に記録し（`AC-1` / `BR-28`）、`VIEWER` はダウンロードを実行できず導線も出ない（`AC-3` / `BR-31`）。ホストはパートナー所属エンジニアのスキルシートに `Proposal` 作成前は到達できない（`AC-4` / `BR-59`）。ダウンロード名は**列を足さず `Content-Disposition` を版番号で組み立てる**（`skill-sheet-v3.xlsx`。氏名は署名付き URL のクエリ・履歴・Sentry に現れない）。非 `CLEAN` の DL は 409 `FILE_NOT_CLEAN`（`SKILL_SHEET_NOT_CLEAN` と畳まない）。プレビューは本文を返さず `{ meta }` のみ。`tests/isolation/skill-sheet-download.test.ts`（30 件）が green —— 🔴 **監査書き込みの失敗注入は実装に seam を作らず `audit_logs` の `BEFORE INSERT` トリガで行い、`raise`（例外）と `swallow`（静かに 0 行）の 2 通りでファイルが返らない**（後者はルート経由で `AUDIT_WRITE_FAILED`（500）になることまで固定）。`deviceKind` の 4 値すべてで記録される。

### T-05-08 スキャン失敗・隔離の周知（M）

- **実装**: `F-011` 処理④。**Phase 1 の周知手段はアプリ内表示とメール送信**（`F-001` / `F-002` と同じ送信経路。Phase 2 以降は `F-039` に集約）。
  - ✅ **メールの経路は `email.dispatch`**（`EmailDispatch(templateKey='SKILL_SHEET_QUARANTINE')` を予約して enqueue）。🔴 **その前提として `email.dispatch` の payload に分類 2（パートナー所属利用者）を載せられるようにした**（`docs/05` §9.4 に追記済み。`CLAUDE.md` §8.7）—— 分類 2 を運べる運用メールの経路が無いと、**周知がホスト側にしか届かない**。`attempts: 3` の前提（**業務上の外部送信＝分類 3 / 4 が型として載らない** + `dedupeKey` の `UNIQUE`）は崩れておらず、これは `account.mail`（分類 1 / 2 を `attempts: 3` で運ぶ既存経路）と同じ根拠である。
  - 🔴 **「キューに載せてよい分類」と「`sandbox` で実送信してよい分類」を混同しない。** 後者（`HOST_OR_PLATFORM_RECIPIENT_CLASSES` = `isMockedDelivery` / `SandboxRecipientScopedEmailSender` の判定）は**一切変えていない** —— 変えると `sandbox` から取引先へ実メールが飛ぶ（`CLAUDE.md` §11.1）。
  - ✅ **周知は `scan.apply-result` と `scan.poll` の両方**が同じ関数（`notifyScanQuarantine`）を通す。Webhook 経路だけに実装すると、取りこぼした版の隔離が誰にも届かない。
  - ✅ **「担当者」の定義を決めた**（`docs/02` `F-011` 処理④ / `docs/05` §9.6.1 に追記済み）: 🔴 **所有側の管理ロール**（ホスト = `OWNER` / `ADMIN` / 取引先 = `PARTNER_ADMIN`）。**所有側を越えない**。
  - ✅ **所有側の引き当てに migration 20260910000000 を足した**（`app_scan_probe` に `skill_sheets.owner_partner_company_id` の `SELECT` を **1 列だけ** + `app_scan_quarantine_target()`）。`skill_sheets` は C3 OWNER_SCOPED でありジョブのホスト文脈から所有側を読めないため（T-05-05 と同型の問題・同型の解）。
- 🔴 **`sandbox` でのメールの扱いは宛先の分類で分かれる** — 担当者がホスト所属（分類 1）なら実送信、パートナー所属（分類 2）ならモック（`A-22`）。
- 🔴 **アプリ内表示は分類によらず必ず行う。** パートナーの担当者が隔離に気づけない状態にならない。
  - ✅ **実装は `S-003` / `S-004` の最上部の「共有できないスキルシート」ブロック**（`GET /api/home` の `HomeBlock` に `SCAN_QUARANTINE` を追加。`docs/04` §S-003 / §S-004 / §S-008 に追記済み）。`S-008` の状態バッジだけでは「そのエンジニアの画面を開かないと見えない」ため周知にならない。🔴 **氏名を出さない**（ホームは 60 秒ポーリングであり、出すと `engineer.view` が毎分積まれる。`BR-27`）。
- `F-059` の監視対象に載せる（画面は SP-11）。✅ **新しい監視項目は足していない** —— 隔離そのものは既存の `A-005`「ウイルススキャン失敗 / `SCANNING` 滞留」（`skill_sheets(tenantId, scanStatus, uploadedAt)`。T-05-05 の索引）で見え、周知の未達は `EmailDispatch` の `QUEUED` 滞留（`docs/05` §16.5 項目 16）に合流する。
- **完了の判定**: 分類 1 / 2 の両方で周知が成立することの結合テスト。
  - ~~MailHog + アプリ内表示~~ → ✅ **SES ポートの観測 + `EmailDispatch.status`（`SENT` / `MOCKED`）+ アプリ内表示**（**訂正済み（2026-09-06、T-05-08）。`CLAUDE.md` §8.7**）。理由は T-04-10 が `docs/05` §17.4 について下したのと**同じ**である: **`sandbox` の分類 1 は `SesEmailSender`（SES の HTTP API）を通る**（`resolveConnectorSelection('sandbox')` → `sandboxRecipientScoped` → `real`）。MailHog は `development` のローカル SMTP キャッチャであり、**この経路上に存在しない**（SMTP で送る実装はリポジトリに 1 つも無い）。実装は `tests/isolation/scan-quarantine-notice.test.ts`。
- ✅ **完了（2026-09-07、コミット `23b7c53`）** — `F-011` 処理④の周知を、**アプリ内表示（分類によらず必ず行う）+ メール（宛先分類に従う）**の 2 経路で実装した。メールは `email.dispatch`（`EmailDispatch(templateKey='SKILL_SHEET_QUARANTINE')`）を通し、🔴 **その前提として payload に分類 2（パートナー所属利用者）を載せられるようにした**（`docs/05` §9.4 に追記済み）—— 分類 2 を運べないと周知がホスト側にしか届かない。🔴 **「キューに載せてよい分類」と「`sandbox` で実送信してよい分類」は混同しておらず、後者（`isMockedDelivery` / `SandboxRecipientScopedEmailSender`）は一切変えていない**（変えると `sandbox` から取引先へ実メールが飛ぶ。`CLAUDE.md` §11.1）。周知は `scan.apply-result` と `scan.poll` の**両方**が同じ関数（`notifyScanQuarantine`）を通る（Webhook 経路だけに実装すると取りこぼした版の隔離が誰にも届かない）。**「担当者」は所有側の管理ロール**（ホスト = `OWNER` / `ADMIN` / 取引先 = `PARTNER_ADMIN`）と定め、**所有側を越えない**（`docs/02` `F-011` 処理④ / `docs/05` §9.6.1 に追記済み）。所有側の引き当てには migration 20260910000000（`app_scan_probe` に `skill_sheets.owner_partner_company_id` の `SELECT` を **1 列だけ** + `app_scan_quarantine_target()`）を足した。アプリ内表示は `S-003` / `S-004` 最上部の `SCAN_QUARANTINE` ブロックで、🔴 **氏名を出さない**（ホームは 60 秒ポーリングであり、出すと `engineer.view` が毎分積まれる。`BR-27`）。監視項目は増やしていない（既存の `A-005` と `EmailDispatch` の `QUEUED` 滞留に合流する）。`tests/isolation/scan-quarantine-notice.test.ts` と `apps/web/app/(main)/_home/home-sections.render.test.tsx` が green。

### T-05-09 エンジニア一覧の骨格（M）

- **実装**: `GET /api/engineers`（#15）の一覧部分。画面は `S-005`（Tier 2）。**検索条件の評価と決定的順序は SP-06 の T-06-04 で完成させる。**
- 🔴 **母集団は境界適用後のみ**（ホスト = 自社台帳 / パートナー = 自社台帳のみ）。`total` は同じ `where` の `COUNT`（`docs/05` §4.8）。
- **応答の型はロールで分ける**（`OwnEngineerView`。匿名候補の `AnonymousCandidateView` は SP-08 で追加）。
- 空状態・0 件・読込中の表示は `docs/04` §（画面別の状態表）に従う。
- **完了の判定**: `F-004 AC-3` の結合テスト（パートナーの一覧に他社のエンジニアが 0 件）。
- ✅ **完了（2026-09-07、コミット `9f851c0`）** — `GET /api/engineers`（#15）の一覧部分と `S-005`（Tier 2）。🔴 **母集団は境界適用後のみ**（ホスト = 自社台帳 / パートナー = 自社台帳のみ）で、**`total` も同じ `where` の `COUNT`** である（件数から他社の存在が推測できない。`docs/05` §4.8）。応答の型は `OwnEngineerView`（匿名候補の `AnonymousCandidateView` は SP-08 で追加する）。空状態・0 件・読込中の表示は `docs/04` の画面別の状態表に従う。**検索条件の評価と決定的順序は SP-06 の T-06-04 で完成させる**（本タスクの射程外）。`F-004 AC-3` の結合テストが green（パートナーの一覧に他社のエンジニアが 0 件）。

### T-05-10 K-7 の結合 / E2E（M）

- **実装**: `docs/dev-plan.md` §6.1 K-7 の証明。
- **検証**: ①デスクトップの閲覧 ②デスクトップの DL ③**モバイルビューポート**の閲覧・DL ④**共有 URL 経由**の DL — の 4 経路すべてで `AuditLog` が 1 件ずつ増える。🔴 **記録できない経路が存在しない**（`BR-28`。欠落 0 件）。
- 🔴 **モバイルだけ記録が漏れる実装にしない**（`CLAUDE.md` §13.3）。
- **完了の判定**: E2E が green。**このテストが無い / 赤のままスプリントを閉じない**（完了確認モードで無条件 NG）。
- ✅ **完了（2026-09-07、コミット `e13c1d8`）** — 🔴 **K-7 の 4 経路（①デスクトップの閲覧 ②デスクトップの DL ③モバイルビューポートの閲覧・DL ④共有 URL 経由の DL）で `AuditLog` が 1 件ずつ増えることを E2E で証明した。** 実体は **`tests/e2e/audit-k7.spec.ts`（3 ケース）+ `tests/e2e/audit-k7.mobile.spec.ts`（2 ケース）**である（モバイル経路のみ別ファイルに分けたのは、Playwright のプロジェクト単位でビューポートを切り替えるため。**モバイルだけ記録が漏れる実装になっていないこと**をこの 2 ファイルの対で固定する。`CLAUDE.md` §13.3）。🔴 **記録できない経路が存在しない**（`BR-28`。欠落 0 件）。**記録の経路は 2 本に閉じている** —— 業務トランザクション内の `writeAuditLog`（T-05-02）と `issueDownloadUrl`（T-05-07。`presignGet` の呼び出し元 1 ファイル固定）であり、`docs/dev-plan.md` §6.1 K-7 の行はこの実体に更新済み。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | オブジェクトキーの生成。スキャン結果の正規化と遷移規則（`CLEAN` へ戻さない）。辞書の正規化。 |
| **結合（DB + S3 + Redis）** | `F-008` / `F-010` / `F-011` / `F-012` の全 AC。所有パートナーの継承・freeze。ストレージ上限での URL 未発行。監査記録の先行と失敗時のロールバック。 |
| **E2E** | `S-005`〜`S-009` の主要導線。🔴 **T-05-10（4 経路の監査記録）**。`CLEAN` でないファイルの共有導線が DOM に存在しないこと。✅ **T-05-08 の隔離ブロックは `S-003` / `S-004` に出る**（描画は `apps/web/app/(main)/_home/home-sections.render.test.tsx`、周知の成立は `tests/isolation/scan-quarantine-notice.test.ts` が見る）。<br>🔴 **読み替え（2026-09-07 に固定。実体は §4 の完了記録にある。`docs/dev-plan.md` §8 の 2026-09-05 T-03-08 / 2026-09-06 SP-04 の前例と同じ扱い）**: ①**`CLEAN` でないファイルの共有導線が DOM に存在しないこと** = `apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.render.test.tsx` + `tests/isolation/skill-sheets.test.ts`（T-05-06）②**`S-005`〜`S-009` の主要導線** = 各画面の `*.render.test.tsx` + 対応する `tests/isolation/*` —— `S-005` = `apps/web/app/(main)/engineers/engineer-ledger-screen.render.test.tsx` + `tests/isolation/engineers.test.ts` / `S-006` = `tests/isolation/engineers.test.ts`（`F-008 AC-3` / `AC-4`。画面はサーバコンポーネントであり描画専用テストを持たない）/ `S-007` = `apps/web/app/(main)/engineers/_form/engineer-form.render.test.tsx` + `tests/isolation/engineers.test.ts` / `S-008` = `apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.render.test.tsx` + `tests/isolation/skill-sheets.test.ts` + `tests/isolation/skill-sheet-download.test.ts` / `S-009` = `apps/web/app/(main)/skills/skill-dictionary-screen.render.test.tsx` + `tests/isolation/skill-dictionary.test.ts`。**割り当ての出所は `docs/05` §17.4 の「実装」列**であり、**同じ検証を 2 箇所に書かない。** 🔴 **主要導線として E2E に実在するのは `S-005` のみ**である（`tests/e2e/isolation.spec.ts` の一覧境界 + `tests/e2e/settings.mobile.spec.ts` のモバイルスモーク。Tier 2 だが遮断しない）。`S-006` / `S-008` が E2E に現れるのは**別項目としてであり**、`S-006` は `isolation.spec.ts` の到達不能検証（`F-008 AC-3`）、`S-008` は T-05-10 の 4 経路（`tests/e2e/audit-k7.spec.ts` + `audit-k7.mobile.spec.ts`）である。 |
| **外部 API のモック方針** | 🔴 **S3 は `development` で MinIO の実コンテナ、ウイルススキャンは `packages/connectors/src/mock/**` と ClamAV コンテナを併用**（`docs/05` §17.5）。Webhook はフィクスチャ（`tests/fixtures/guardduty/*.json`）。**重複と順序逆転を必ずテストする。** 実データ由来のフィクスチャを置かない（`BR-47`）。 |

## 6. 完了判定

1. `F-008` / `F-010` / `F-011` / `F-012` の全 AC が結合テストで green。
2. 🔴 **K-7 の E2E（4 経路の監査記録）が green。** 監査ログの書き込み失敗でファイルが返らない。
3. 🔴 **`CLEAN` でないファイルの共有 URL・提案添付・チャット添付の導線が存在しない**（DOM にも API にも）。
4. 🔴 **`UNSUPPORTED` / `ACCESS_DENIED` / `FAILED` が `CLEAN` として扱われず、`THREATS_FOUND` 後の `NO_THREATS_FOUND` で `CLEAN` に戻らない。**
5. 所有パートナーが認証コンテキストから決まり、入力で偽装できない（アプリと DB トリガの二重）。
6. ストレージ上限超過で署名付き URL が発行されない。
7. **申し送り**: ~~E-13（GuardDuty のスキャン所要時間の実測結果）を `docs/dev-plan.md` §8 に追記する~~ → 🔴 **実測は AWS 環境の構築時へ移し、実行タスクを `SP-12` の `T-12-09` に具体化した（2026-09-06 に時期変更 / 2026-09-07 にタスク ID 付与。§4 T-05-05 の理由を参照）。本スプリントの完了判定には含めない（[Issue #37](https://github.com/Festal-KM/SES-Platform/issues/37) で確認中の `assumption`）。** 2 分を超えていれば `docs/02` 章 7.1 の目標値見直しを人間に提起する点は変わらない。

---

**SP-05 の状態（2026-09-07）**: T-05-01〜T-05-10 の**全 10 タスクが完了**（§4 の各タスクの ✅ 行）。コミットは T-05-01 `e782282`（2026-09-06）/ T-05-02 `1b405c0` / T-05-03 `7692d67` / T-05-04 `74b97e2` / T-05-05 `c3f3a30` / T-05-06 `901c186` / T-05-07 `088bec0` / T-05-08 `23b7c53` / T-05-09 `9f851c0` / T-05-10 `e13c1d8`（以上 2026-09-07）。**主な成果**は 7 つ — ①エンジニア台帳（登録・編集・詳細・一覧。🔴 **所有パートナーは認証コンテキストから確定し入力で偽装できない**）②スキル辞書・別名・新語候補（**明示採用まで正規化に使われない**）③S3 直接アップロードとストレージ計測（🔴 **上限超過なら署名付き URL を発行しない**）④GuardDuty スキャンの受信と**単調な遷移**（重複配信・順序逆転・4 種のステータスを吸収し `CLEAN` へ戻さない）+ `app_scan_probe` による**スキャン 3 列だけの最小権限書き込み**⑤スキルシートの版管理と 🔴 **`CLEAN` ゲート**（共有 URL・提案添付・チャット添付の導線が DOM にも API にも存在しない）⑥🔴 **K-7 の 4 経路の証明**（デスクトップ閲覧 / デスクトップ DL / モバイル / 共有 URL で `AuditLog` が 1 件ずつ増え、**記録の書き込みが失敗したらファイルが返らない**）⑦スキャン失敗・隔離の周知（アプリ内は分類によらず必ず、メールは宛先分類に従う）。

🔴 **テスト green の証跡（2026-09-07）**: **unit 134 files / 2645**、**isolation 38 files / 1001**、**E2E 26**（内訳: `isolation.spec.ts` 16 + `audit-k7.spec.ts` 3 + `home.mobile.spec.ts` 2 + `settings.mobile.spec.ts` 3 + `audit-k7.mobile.spec.ts` 2）、**startup 14**。**全コミットで CI green**（単一ジョブ直列。[Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の**運用 C の確認記録**として残す —— 機械的強制は未達であり「CI があるから守られている」と読み替えない。`docs/dev-plan.md` §6.4 R-05）。

本スプリントで生じた確認中の論点は 2 件で、いずれも**既定値で実装済み・ブロッカーではない** — [Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35)（経歴の保存先。既定 C = Phase 1 はスキルシートのみ・`EngineerSnapshot.careers` は空配列。T-05-01。🔴 **SP-09 の snapshot 凍結が依存する**）/ [Issue #36](https://github.com/Festal-KM/SES-Platform/issues/36)（`OWNER` の別名採否権限。既定 A = `OWNER` を追加。T-05-03 は `ADMIN` / `SALES` 限定で実装済みで、`tests/isolation/skill-dictionary.test.ts:301` が現状の挙動を固定している。🔴 **既定 A を実装するときはテストごと更新する**）。**`docs/dev-plan.md` §9 に対応表の行がある。** 後続へ引き継ぐ残件は ①**E-13（GuardDuty のスキャン所要時間の実測）は SP-12 の T-12-09** ②**[Issue #36](https://github.com/Festal-KM/SES-Platform/issues/36) の既定 A の実装は SP-06 の早いタスク（T-06-01 近傍）** ③**[Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) の決着は SP-09 着手前**の 3 件である。
