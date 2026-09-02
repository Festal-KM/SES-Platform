# SP-03 auth-audit-admin0 — 認証 2 系統・監査ログ・管理平面 Phase 0

> **Phase**: 0（基盤） / **前提**: SP-02（全 56 表・RLS・分離テスト） / **後続**: SP-04 / SP-05 / SP-07
> **一次資料**: `docs/02` `F-001`〜`F-006` / `F-055` / `F-056` / `F-026` / `docs/04` `S-001`〜`S-003` `S-035` `S-041` / `A-001`〜`A-003` `A-014` / `docs/05` §5 / §6.2 / §6.3 / §6.9 / §16.1 / `CLAUDE.md` §5 / §10.6
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-03` → 続けて `TARGET: Phase 0`
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-001`〜`S-003` / `S-035` / `S-041` / `A-001`〜`A-003` / `A-014`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**85 枚中 3 枚のみ生成済み**であり、無ければ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

テナント平面と管理平面の**別テーブル・別認証**を立ち上げ、監査ログと役割別ホーム（Phase 0 は空のダッシュボード）を通す。管理平面はテナント一覧・詳細・**テナント開設**まで。`UsageCounter` のテーブルは SP-02 で作ったので、本スプリントでは**計測フック**を置く（`CLAUDE.md` §10.6）。

🔴 **本スプリントの最終タスク（T-03-11）で `CLAUDE.md` §5 の Phase 0 成功条件を E2E で証明する。** ここが green にならない限り Phase 0 は閉じない。

## 2. 対応機能 ID

`F-001`（Phase 0 分: テナント作成 + 初期 `OWNER` 招待。**送信ドメイン検証は SP-04**）/ `F-002` / `F-003` / `F-004`（API 側の担保）/ `F-005` / `F-006` / `F-026`（計測フックのみ）/ `F-055` / `F-056`（一覧・詳細。**健全性の異常順は SP-11**）

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-03-01 | テナント認証と `resolveTenantCtx` | 入力に `tenantId` を含めても参照範囲が変わらない | `F-003 AC-1` `AC-3` | L |
| T-03-02 | 2 要素認証（`OWNER` / `ADMIN` 必須） | 未設定の `OWNER` / `ADMIN` は**業務データを 1 件も取得できない** | `F-003 AC-2` / `BR-30` | M |
| T-03-03 | 招待の発行・受諾とパスワード再設定 | 受諾は 1 回限り。存在有無を返さない。行由来コンテキストで実装 | `F-002 AC-1` `AC-4` | L |
| T-03-04 | `withApiRoute` の共通ガードと Zod 境界 | 分離キーを Zod スキーマに持たない。ガードの呼び順が固定 | `F-004 AC-2` `AC-6`〜`AC-9` | L |
| T-03-05 | 監査ログの記録（`F-005`）と `S-041` | 🔴 **記録に失敗したら操作を成立させない**。編集・削除できない | `BR-27` `BR-28` / K-7 | L |
| T-03-06 | 役割別ホームと `/api/me`（Phase 0 = 空） | パートナーのホームの全件数が自社由来のみ。**説明文が他社を示唆しない** | `F-006 AC-1`〜`AC-3` | M |
| T-03-07 | 運営者認証（`F-055`）と `A-001` | テナントの `User` に運営者フラグが存在しない。相互に到達不能 | `BR-36` / `F-055 AC-1`〜`AC-4` | M |
| T-03-08 | `withPlatform` と管理平面ミドルウェア | 🔴 **`AuditLog` の書き込み成功後でないとクエリを実行しない** | `BR-37` `BR-41` | L |
| T-03-09 | テナント一覧・詳細（`A-002` / `A-003`） | 詳細に氏名・スキルシート・提案本文・チャット本文が現れず導線も無い | `F-056 AC-1` `AC-3` `AC-4` | M |
| T-03-10 | テナント開設（`A-014`）と `UsageCounter` 計測フック | API-A4 と A5 が分離。席数の日次スナップショットが動く | `F-001 AC-1` `AC-3` / `F-026` | L |
| T-03-11 | 🔴 **Phase 0 成功条件の E2E** | 2 テナント × 2 パートナーで URL 直打ち・API 直叩きのいずれでも 0 件 | `CLAUDE.md` §5 | L |

## 4. タスク詳細

### T-03-01 テナント認証と `resolveTenantCtx`（L）

- **実装**: Auth.js（Credentials）+ `POST /api/auth/signin`（#1）/ `signout`（#4）。`resolveTenantCtx` が **テナント・パートナー所属・ロールを認証コンテキストに確定**する。画面は `S-001`。
- 🔴 **`tenantId` / `partnerCompanyId` をリクエストの body / query / path から受け取らない**（`BR-03` / `F-003 AC-1`）。Zod スキーマにそのキーを持たない。
- 🔴 **サインイン時のメール照合は `withAuthLookup(email)`（`docs/05` §4.4.2）で該当 1 行のみ可視にする。** テナント確定前に全件を舐める経路を作らない。
- **監査**: ログイン・ログアウト・認証失敗を `AuditLog` に記録（`F-003 AC-3`）。
- **完了の判定**: `F-003 AC-1` の結合テスト（入力を改変しても結果が変わらない）。`F-004 AC-2`。

### T-03-02 2 要素認証（M）

- **実装**: `POST /api/auth/2fa/setup`（#3）/ `verify`（#2）。TOTP + リカバリコード。`TwoFactorCredential`（暗号化・ハッシュ）。
- 🔴 **`OWNER` / `ADMIN` の 2FA 必須は `resolveTenantCtx` で強制する**（middleware ではなく。`docs/05` §6.2）。`TwoFactorCredential.confirmedAt IS NULL` かつ `role ∈ {OWNER, ADMIN}` のとき `TwoFactorRequiredError`（403）を throw し、**`AuthenticatedTenantCtx` が生成されず `withTenant` に到達できない = 業務データを 1 件も取得できない**。
- middleware（Edge）は画面遷移（`/settings/security` へ 302）だけを担う。**データ境界の強制をそこに依存しない**（Edge から DB を読めない）。
- **完了の判定**: `F-003 AC-2` の結合テスト（未設定の `OWNER` が API を直叩きしても業務データが 0 件）。

### T-03-03 招待の発行・受諾とパスワード再設定（L）

- **実装**: `POST /api/invitations`（#14。Phase 0 は**ホストロール宛のみ**。取引先招待は SP-04）/ `GET /api/invitations/{token}`（#6）/ `POST /api/invitations/{token}/accept`（#7）/ `POST /api/auth/password-reset`（#5）/ `confirm`（#5b）。画面は `S-002`。
- 🔴 **未認証経路は `docs/05` §4.4.2 の「行由来コンテキスト」3 関数で書く**（`withInvitationToken` / `withInvitationAccept` / `withPasswordReset*`）。**`systemTenantCtx` を `apps/web` に開放しない**（HTTP 経路が認証を迂回できるため）。分離キーは常に**トークン照合で得た DB 行**から取る。
- 🔴 **受諾は `acceptedAt` の CAS で 1 回限り**。2 回目は失敗する。パスワード再設定は **存在有無を返さない**（常に 204）。
- 🔴 **`Invitation` を別テーブルにしている理由**（`docs/05` §3.2）: 受諾前のレコードが `Membership` として存在すると席数（`UsageCounter`）を汚すため。**`Membership` の列にしない。**
- **メール送信は SP-04 の単一経路に載せる。** 本タスクでは `account.mail` ジョブの enqueue までを実装し、**送信自体はモック**（`APP_ENV=development`）。
- **完了の判定**: `F-002 AC-1`（パートナーロールはパートナー企業必須）/ `AC-3`（監査）/ `AC-4`（`PARTNER_ADMIN` は自社配下のみ）の結合テスト。

### T-03-04 `withApiRoute` の共通ガードと Zod 境界（L）

- **実装**: `apps/web/lib/api/withApiRoute.ts` と `guards.ts`（`docs/05` §6.1 / §6.2）。
  - 🔴 **すべて Route Handler。Server Actions を使わない**（`P-A-04`。「API を直接呼んでも拒否される」をテストで証明するには経路が 1 本でなければならない）。
  - ガードの呼び順: `requireRole` → `requireExecutable` → `requireNotViewer` → `requireVerifiedSendingDomain`（SP-04）→ `requireEsignConnection`（SP-17）。
  - 🔴 **`requireExecutable` は `F-004` と同じ経路に置く**（`docs/02` `program-design` 申し送り 11-①）。ロールごとの分岐に散らすと `SUSPENDED` の抜け穴になる。**Phase 0 で判定するのは `CLOSING` / `PURGED`**（`SUSPENDED` への遷移が成立するのは Phase 3）。🔴 **`SUSPENDED` の追加は SP-20 の T-20-05 で行う。本スプリントの完了判定には `F-004 AC-7` を含めない**（§6-1 の注記）。
  - 🔴 **「見えない = 存在しない」の API 契約**（`docs/05` §4.8）: 境界外の ID は **404**（403 と区別しない）。`total` は境界適用後の `COUNT`。並び順に「全体件数」「順位」を持ち込まない。
  - `VIEWER` の実行系（承認 / 送信 / DL / エクスポート）を 403（`F-004 AC-6` / `BR-31`）。
  - ページングはカーソル方式（既定 50 / 最大 200）。
  - エラーは `docs/05` §15 の共通フォーマット。`InvalidStateTransitionError` は **422**。
- **静的テスト**: `execute-guard.test.ts`（実行系ルート一覧の全ファイルが `requireExecutable` を呼ぶことを AST で検査。`docs/05` §17.2 #7）。**実行系ルートが増えるたびにこのテストが効く。**
- **完了の判定**: `F-004 AC-2` / `AC-6` / `AC-8` / `AC-9` の結合テスト + 静的テスト。

### T-03-05 監査ログの記録と `S-041`（L）

- **実装**: `withApiRoute` の `audit` オプション（`docs/05` §6.1 / §16.1）。`GET /api/audit-logs`（#10。🔴 **期間必須**）。画面は `S-041`。
- 🔴 **`audit` を指定した経路は、ハンドラ本体の前に `AuditLog` を書く**（`F-005` / `F-012 AC-2`）。**記録に失敗したら対象操作を成立させない。**
- 🔴 **`BR-27` の 11 種**をフック箇所として `docs/05` §16.1 の表どおりに登録する。Phase 0 で発生するのはログイン・ログアウト・作成・更新・削除・権限変更・運営者の全操作。**残りは各機能のスプリントで追加する**（`F-012` は SP-05、公開範囲は SP-06、送信・承認は SP-09）。
- 🔴 **`AuditLog` は利用者・運営者のいずれからも編集・削除できない**（`F-005 AC-3`）。`app_tenant` に `UPDATE` / `DELETE` を `REVOKE`（SP-02 の C1 / C2 で実装済み。本タスクで検証する）。
- `system` が主体の操作は `actorKind='SYSTEM'` として記録（`F-005 AC-4`）。
- **完了の判定**: `F-005 AC-1`〜`AC-4` の結合テスト。**記録に失敗させた注入テストで操作がロールバックされること。**

### T-03-06 役割別ホームと `/api/me`（M）

- **実装**: `GET /api/me`（#8）/ `GET /api/home`（#9）。画面は `S-003`（ホスト）/ `S-004`（取引先。**Phase 1 で本格化するが枠は Phase 0 で作る**）。
- 🔴 **ロールで応答の型が違う**（`HostHomeView` / `PartnerHomeView`）。`docs/05` §4.8 のとおり、**「他にも提案があります」「あなたは N 番目」に相当するフィールドを型に持たない**。
- 🔴 **Phase 0 は空のダッシュボード**（`CLAUDE.md` §5）。承認待ち・送信失敗・公開案件・提案依頼は Phase 1、`満了間近` は Phase 2 から表示される。**ブロックが未実装であることを理由に、境界の適用（②）と説明（③）を省略しない**（`F-006` 処理）。
- 🔴 **パートナーのホームに「自社に見えない情報が存在すること」の説明文を常時表示する。その説明文自体が他社の件数・存在を含まない**（`F-006 AC-2` / `F-004 AC-4`）。
- `#9` の応答に `changedSince` と各行の `rowVersion` を含める（`docs/04` `program-design` 申し送り 6。60 秒ポーリングの差分描画）。
- **Tier**: `S-003` / `S-004` は **T1（モバイル完結）**（`docs/04`）。
- **完了の判定**: `F-006 AC-1`〜`AC-3` の結合テスト + モバイルビューポートのスモーク。

### T-03-07 運営者認証（M）

- **実装**: `POST /api/admin/auth/signin` / `2fa/verify`（API-A1）。画面は `A-001`。`PlatformUser`（`PLATFORM_OWNER` / `PLATFORM_SUPPORT`）。
- 🔴 **テナントの `User` とは別テーブル・別認証・別セッション**（`BR-36`）。**「運営者フラグ」に相当する属性・ロール・権限を `users` に作らない**（`docs/05` §17.2 #13 が列名を走査する）。
- 🔴 **2FA を設定するまで管理平面のいずれの画面にも到達できない**（`F-055 AC-3`）。
- **完了の判定**: `F-055 AC-1`〜`AC-4`。**テナント利用者の認証情報で `/admin` に到達できず、逆も成立しない**ことの結合テスト。

### T-03-08 `withPlatform` と管理平面ミドルウェア（L）

- **実装**: `docs/05` §5.1 / §5.2 / §5.3。
  - 🔴 **専用 DB ロール `app_platform` / `app_platform_write` + 専用接続プール（`PLATFORM_DATABASE_URL`）+ 専用 Prisma インスタンス**の 3 点セット。
  - 🔴 **`withPlatform` は操作者・理由・対象を必須引数に取り、`AuditLog` の書き込みが成功した後でないとクエリを実行しない**（`BR-41` / `docs/05` §5.3）。**記録されない管理平面アクセスを型として作れない**構造にする。
  - 🔴 **主平面のコードから `withPlatform` を import できないことを ESLint で担保する**（`docs/03` `program-design` 申し送り 2）。
  - `/admin` は**別ルート・別ミドルウェア**で認可する（`CLAUDE.md` §10.5）。
  - `PlatformReadDb` に書き込みメソッドを持たせない（型で担保）。
- 🔴 **運営者に非開示のものは列レベル `GRANT` で外す**（`docs/05` §5.5 / §5.7。`BR-40`）。S3 も `s3:GetObject` を付与しない。
- **完了の判定**: `platform-grants.test.ts` / `platform-write-scope.test.ts`（SP-02 で書いた走査テスト）が green。`withPlatform` の監査失敗時にクエリが実行されないことの結合テスト。

### T-03-09 テナント一覧・詳細（M）

- **実装**: `GET /api/admin/tenants`（API-A2）/ `GET /api/admin/tenants/{id}`（API-A3）。画面は `A-002` / `A-003`。**Phase 0 は一覧・詳細まで。異常順（健全性）は SP-11**（`docs/02` §1.3）。
- 🔴 **表示するのは件数・状態・日時のみ。** エンジニアの氏名・スキルシートの内容・案件の内容・提案の本文・チャット本文が**表示されず、到達する導線も存在しない**（`F-056 AC-1` / `BR-40`）。
- 🔴 **`PURGED` のテナントはライフサイクル状態のみ返し、削除件数を含めない**（削除完了の確認は API-A12 の 1 本のみ。`docs/04` `program-design` 申し送り 15）。
- 🔴 **運営者はテナントの業務データを作成・更新・削除できない**（`F-056 AC-3` / `BR-37`）。
- 閲覧を `AuditLog` に記録（`F-056 AC-4`）。
- **完了の判定**: `F-056 AC-1` / `AC-3` / `AC-4` の結合テスト。E2E #15 の一部（運営者に非開示のものが応答に現れない）。

### T-03-10 テナント開設と `UsageCounter` 計測フック（L）

- **実装**:
  - `POST /api/admin/tenants`（API-A4）— 🔴 **`PLATFORM_OWNER` のみ。`PLATFORM_SUPPORT` はルート自体が 403**。body に `sendingDomain?` を取り、`tenant_sending_domains` に `state='REGISTERED'` で **INSERT するだけ**（DNS 提示と検証は SP-04 の `S-036`）。未入力でも開設できる。
  - `POST /api/admin/tenants/{id}/owner-invitation`（API-A5）— 🔴 **API-A4 と分離する**（`docs/04` `program-design` 申し送り 14。招待失敗でテナントを作り直させない）。
  - 画面は `A-014`。
  - **テナント既定値**（`F-001 AC-1`）: 自動承認 = 無効 / AI ロール承認モード = すべて都度承認 / 案件の公開範囲 = **誰にも公開されない** / 送信ドメインの検証状態 = 未検証。
  - `GET/PATCH /api/settings/organization`（#64）と `S-035`。🔴 **`lifecycleState` は読み取り専用**（テナント側のどのロールからも変更できない。`F-004` 関連ロール）。
  - 🔴 **`UsageCounter` の計測フック**（`CLAUDE.md` §10.6 / `F-026`）: `usage.seat-snapshot`（毎日 01:00 JST。`Membership` の有効行数を `UsageCounter(DAY,'SEAT_COUNT')` に記録）と、`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` による原子的加算のヘルパ。🔴 **AI / メール / ストレージの実計測は SP-07 / SP-10 だが、加算経路（ヘルパ）とテーブルは Phase 0 で用意する** — 後から遡って計測できないため。
  - 🔴 **`usage.seat-snapshot` の集計関数は `countPartnerSeats: boolean` を引数で持つ**（`docs/05` TBD-19。席単価と課金対象は未決。**決め打ちしない**）。
- **ブロッカーではないが確認中**: [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)（席単価 / 取引先の席を課金対象に含めるか）。既定は `countPartnerSeats` を設定値とし、値を決め打ちしない（`docs/dev-plan.md` §9）。
- **完了の判定**: `F-001 AC-1` / `AC-3` の結合テスト。API-A4 が `PLATFORM_SUPPORT` に 403。`usage.seat-snapshot` の冪等性テスト（同日 2 回で 1 行）。

### T-03-11 🔴 Phase 0 成功条件の E2E（L）

- **実装**: `tests/e2e/isolation.spec.ts`（`docs/05` §17.3 #1 / #2 / #15）。
- **シナリオ**（`CLAUDE.md` §5 の成功条件をそのまま）:
  1. `seed:isolation`（2 テナント × 2 パートナー）を投入する。
  2. テナント A の `OWNER` でログインし、**URL 直打ち**でテナント B のリソース ID にアクセス → **404**（403 と区別しない）。
  3. 同じ認証で **API 直叩き**（`GET /api/engineers/{B の ID}` ほか）→ **404 / 0 件**。一覧の `total` が変わらない。
  4. パートナー A1 の `PARTNER_SALES` でログインし、パートナー A2 の `Engineer` / `Proposal` / `Message` / 匿名候補 / **当事者レコード**が画面・一覧・検索結果・集計・通知のいずれにも 1 件も現れない。**件数バッジ・並び順の変化・「他 N 件」も無い**（`F-004 AC-3` / `AC-4`）。
  5. 運営者でログインし、`A-002` / `A-003` の応答に**スキルシート本文・氏名・チャット本文・トークン平文が現れない**（`BR-40`）。
- 🔴 **`globalSetup`**（`docs/05` §17.6）: コンテナ起動 → マイグレーション（`app_migrator`）→ ロールと `GRANT` の適用 → `seed:isolation` → `APP_ENV=development` でアプリ起動 → **外向きネットワークの遮断を確認**。
- 🔴 **分離検証のシナリオは直列（`workers: 1`）**。RLS の設定漏れは他テストの副作用で偽陽性・偽陰性になる。
- **完了の判定**: 上記 5 つが green。CI（T-01-08）に E2E ステージを追加する。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | ガードの単体（`requireRole` / `requireExecutable` / `requireNotViewer`）。`HostHomeView` / `PartnerHomeView` の型テスト。Zod スキーマが分離キーを持たないことの型テスト。 |
| **結合（DB あり）** | `F-002` / `F-003` / **`F-004`（`AC-7` の `SUSPENDED` を除く。SP-20 の T-20-05）** / `F-005` / `F-006` / `F-055` / `F-056` / `F-001` の各 AC。`withPlatform` の監査先行。招待受諾の CAS。`usage.seat-snapshot` の冪等性。 |
| **静的テスト** | `execute-guard.test.ts`（#7）/ `platform-user-no-flag.test.ts`（#13）/ `no-restricted-imports`（`withPlatform` / `systemTenantCtx` の import 制限）。 |
| **E2E** | 🔴 **T-03-11 の 5 シナリオ**（`docs/05` §17.3 #1 / #2 / #15）。モバイルビューポートで `S-003` / `S-004` が破綻しないスモーク。 |
| **外部 API のモック方針** | 🔴 **招待メールとパスワード再設定メールは `packages/connectors/src/mock/**` を使う**（`APP_ENV=development`）。`account.mail` ジョブは enqueue され、モックの `callCount()` で検証する。**実送信の単一経路と宛先分類は SP-04**。テスト専用の別モックを書かない。 |

## 6. 完了判定（= Phase 0 の完了判定）

1. `F-001`（Phase 0 分）/ `F-002` / `F-003` / **`F-004`（`AC-7` の `SUSPENDED` を除く）** / `F-005` / `F-006` / `F-055` / `F-056`（一覧・詳細）の全 AC が結合テストで green。
   - 🔴 **`F-004 AC-7`（`SUSPENDED` のテナントで実行系が拒否される）は本スプリントでは判定しない。** 本ファイル §4 の T-03-04 のとおり、**Phase 0 で判定するのは `CLOSING` / `PURGED`** であり、**`ACTIVE` → `SUSPENDED` の遷移が成立するのは Phase 3**（`F-062`。停止は `PLATFORM_OWNER` のみで、その管理平面の操作自体が Phase 3 にある）。**完成させるのは `T-20-05`**（`requireExecutable` に `SUSPENDED` を追加）。
   - **本スプリントで担保するのは「`requireExecutable` が `F-004` と同じ経路に置かれ、状態を 1 つ足すだけで拒否が全実行系ルートに効く構造になっていること」**（`execute-guard.test.ts` が全実行系ルートを AST で走査する）。**この構造が無いと T-20-05 が「ロールごとの分岐に散らす」形になり、`SUSPENDED` の抜け穴が生まれる。**
   - **到達不能な条件を完了判定に書かない**（`MODE: REVIEW` は 1 件でも NG なら `PHASE_INCOMPLETE` とするため、書くとこのスプリント＝ Phase 0 が永久に閉じない）。
2. 🔴 **T-03-11 の E2E が green** — 2 テナント × 2 パートナーを seed した状態で、**URL 直打ち・API 直叩きのいずれでも他テナント / 他パートナーのデータが 1 件も取得できない**（`CLAUDE.md` §5 Phase 0 の成功条件そのまま）。
3. SP-02 のカタログ走査 13 本 + 二重防御 10 件が CI で毎回 green。
4. `OWNER` / `ADMIN` が 2FA 未設定のまま業務データを取得できない。
5. 運営者の全操作（閲覧を含む）が `AuditLog` に記録され、記録に失敗すると操作が成立しない。
6. `UsageCounter` のテーブルと計測フック（席数の日次スナップショット + 原子的加算ヘルパ）が動作している（`CLAUDE.md` §10.6）。
7. **次フェーズの前提**: `docs/dev-plan.md` §5 の E-1（SES 本番アクセス申請）の状況を確認し、未承認なら R-02 として明示的に記録する。
