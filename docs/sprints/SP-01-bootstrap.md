# SP-01 bootstrap — モノレポ基盤と二重防御の実証

> **Phase**: 0（基盤） / **前提スプリント**: なし（最初のスプリント） / **後続**: SP-02
> **一次資料**: `CLAUDE.md` §2 / §2.1 / §3.1 / §11 / `docs/03` §4.3 / §4.14 / §5 / §6 / `docs/05` §1 / §2 / §4.2 / §4.3 / §13
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-01`
> 🔴 **前提条件（本スプリントには画面が無いためブロッカーではないが、SP-03 以降のブロッカーになる）**: **ワイヤーフレーム画像 85 枚のうち 3 枚のみ生成済みであり、残り 82 枚は [Issue #17](https://github.com/Festal-KM/SES-Platform/issues/17)（`S-032` の停止通知の種別が `docs/04` に無い。回答待ち）の決着後に生成する**（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**ワイヤーフレームは `programmer` の入力である**ため、T-01-09 の外部手続きと同じタイミングで Issue #17 を督促する。

---

## 1. 目的

pnpm workspaces のモノレポとローカル開発環境を立ち上げ、🔴 **「Prisma Client Extension + PostgreSQL RLS の二重防御が成立すること」を最初に実証する**（`docs/03` `pm` 申し送り 4）。ここが成立しないと `CLAUDE.md` §3.1 の前提が崩れ、以降すべてのスプリントの土台が無い。あわせて **リードタイムのある外部手続き（Amazon SES の本番アクセス申請ほか）を初日に着手する**（`CLAUDE.md` §5 の例外 / `docs/dev-plan.md` §5 の E-1〜E-3 / E-12）。

## 2. 対応機能 ID

`F-004`（二重の情報境界の強制）の**土台**。本スプリントは単独では機能 ID を完了させない — `F-004` は SP-02 で全 56 表に適用され、SP-03 の E2E で成功条件を満たす。

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-01-01 | モノレポ骨格と依存方向の ESLint | `pnpm -r build` が通る。`packages/domain` から I/O を import すると lint が落ちる | `CLAUDE.md` §2.1 | S |
| T-01-02 | ローカル開発コンテナと DB 拡張の可否検証 | `docker compose up` で 5 サービスが起動。`pg_trgm` が有効。`pg_bigm` / `pgroonga` の可否を記録 | E-12 / TBD-8 | M |
| T-01-03 | `packages/config` の Zod スキーマと `APP_ENV` 起動時検証 | `production` でモックが選ばれたら起動失敗。非本番に本番キーがあれば起動失敗 | NFR-ENV-2〜4 | M |
| T-01-04 | 🔴 **Prisma 拡張 + RLS の二重防御の実証**（最小 2 表） | 片方を落としても他方が 0 件に止めることを 3 ケースで証明 | `F-004` 土台 | L |
| T-01-05 | DB ロールと `GRANT` の適用（5 ロール） | 5 ロールが `BYPASSRLS` を持たない。`app_platform` に業務表の書込権限が無い | `docs/05` §4.2 | M |
| T-01-06 | `withTenant` の契約と `AuthenticatedTenantCtx` のブランド型 | `resolveTenantCtx` 以外が ctx を生成できない。生 `PrismaClient` の import が lint で落ちる | `BR-03` | L |
| T-01-07 | `packages/domain` の骨格と純粋性テスト | `Date` 直接参照・`process.env`・I/O import が 0 件 | `docs/05` §17.2 #14 | S |
| T-01-08 | CI パイプライン（lint / typecheck / unit / isolation） | 🔴 **分離テストが毎回走る**。1 件でも落ちたら merge 不可 | R-05 | M |
| T-01-09 | 🔴 **外部依存の着手**（AWS / SES / Anthropic） | SES のドメイン検証完了 → 本番アクセス申請の提出記録が残る | E-1 / E-2 / E-3 | M |

## 4. タスク詳細

### T-01-01 モノレポ骨格と依存方向の ESLint（S）

- **何を実装するか**: `CLAUDE.md` §2.1 / `docs/05` §2.1 のディレクトリツリーどおりに `apps/web` `apps/worker` `packages/{domain,db,ai,connectors,config,ui,i18n}` `prompts/` `scripts/` `tests/e2e/` を作る。`pnpm-workspace.yaml` / ルート `tsconfig.json`（`strict: true`）/ `.eslintrc`。
- **参照**: `docs/05` §2.1（責務）/ §2.2（依存方向のルール）/ `CLAUDE.md` §2.1。
- **ESLint の `no-restricted-imports`**: ①`packages/*` から `apps/*` を import しない ②`packages/domain` から他パッケージ・Node の I/O を import しない ③`packages/db` / `ai` / `connectors` が相互に import しない ④`@anthropic-ai/sdk` の import は `packages/ai/src/client.ts` のみ。
- **完了の判定**: `pnpm -r build` と `pnpm lint` が green。**違反コードをわざと置いた fixture で lint が落ちる**ユニットテスト（`docs/05` §17.2 #3）。
- ✅ **完了（2026-09-02、コミット `97e8d23`）**

### T-01-02 ローカル開発コンテナと DB 拡張の可否検証（M）

- **何を実装するか**: `docker-compose.yml` に PostgreSQL / Redis / MinIO / MailHog / ClamAV を定義する。`APP_ENV=development` の既定接続先にする。
- **あわせて検証する**（E-12 / `docs/05` TBD-8）: 採用予定のマネージド PostgreSQL で `pg_trgm` / `pg_bigm` / `pgroonga` が使えるかを確認し、**結果を `docs/03` §3.7.2 に追記する**（`CLAUDE.md` §8.7。ドキュメントを先に直す）。
- **既定値で進める**: `pg_bigm` / `pgroonga` が使えない場合は `pg_trgm` の GIN で代替する。日本語全文検索の実装は SP-06 で `packages/db/src/search/*.ts` の 1 箇所に閉じる。
- **完了の判定**: `docker compose up -d` 後に 5 サービスへ疎通するスモークテストが green。`SELECT extname FROM pg_extension` に `pg_trgm` が含まれる。
- ✅ **完了（2026-09-02、コミット `fea6e1c`）**

### T-01-03 `packages/config` の Zod スキーマと `APP_ENV` 起動時検証（M）

- **何を実装するか**: `docs/03` §6.1〜§6.10 の環境変数を Zod スキーマにする。`docs/05` §13.1 の**起動時 DI（ファクトリ 1 箇所）**と §13.4 の検証を実装する。
- 🔴 **必ず満たすこと**（`CLAUDE.md` §11.1 / `docs/02` 章 7.6）:
  - `APP_ENV=production` で**モック実装が選択されたら起動を失敗させる**（`F-022 AC-5`）。「未設定ならモックにフォールバック」を作らない。
  - **非本番に本番の API キーが設定されていたら起動を失敗させる**（NFR-ENV-4）。
  - `SCHEDULER_TIMEZONE` は `z.literal('Asia/Tokyo')`。
  - 差し替えは**リクエストごとの `if` 分岐にしない**。起動時の 1 箇所。
- **完了の判定**: 上記 2 つの起動失敗ケースを再現するユニットテスト。`APP_ENV` の 5 値それぞれでファクトリが返す実装のスナップショットテスト。
- ✅ **完了（2026-09-02、コミット `6bb7538`）**
- 🔴 **申し送り（2026-09-03）**: 本タスクが実装したのは**関数と検証**であり、**`apps/web` / `apps/worker` からの呼び出し側が存在しない。** そのため `production` でモック実装が選択されても**実行時にプロセスが止まらない**（`CLAUDE.md` §11.1 の 🔴 が空振りする）。呼び出し側は **SP-03 の `T-03-12`** で実装する（`docs/dev-plan.md` §8 の 2026-09-03 の行）。

### T-01-04 🔴 Prisma Client Extension + RLS の二重防御の実証（L）

- **何を実装するか**: 検証用に最小 2 表（`tenants` / 検証用の業務表 1 つ）を作り、**`docs/03` §4.3.1 / `docs/05` §4.3 の構成が実際に成立することを証明する**。
  - `withTenant` は必ず `$transaction` を開き、**その先頭で `SET LOCAL app.tenant_id` / `app.partner_company_id` / `app.shared_scope='off'` を発行する**。🔴 **トランザクション外の `SET` を書かない**（コネクションプールで他リクエストに漏れる）。
  - Prisma クライアント拡張が全モデルの `where` に `tenantId` を注入する。
- **証明する 3 ケース**（`docs/05` §4.7 の二重防御テスト #1〜#3）:
  1. Prisma 拡張を無効化した素のクライアント（`app_tenant` ロール）で他テナントの行を取る → **0 件**（RLS が止める）
  2. `SET LOCAL app.tenant_id` を発行せずにクエリする → **0 件または例外**
  3. RLS を一時的に `DISABLE` した DB で拡張越しに他テナントを取る → **0 件**（拡張の `where` が止める）
- 🔴 **このタスクが green にならない限り SP-02 に進まない。** 二重防御が成立しないなら設計に戻る（`docs/03` `pm` 申し送り 4）。
- **完了の判定**: `tests/isolation/double-defense.test.ts` の 3 ケースが Testcontainers 上で green。
- ✅ **完了（2026-09-02、コミット `6eba20c`）**

### T-01-05 DB ロールと `GRANT` の適用（M）

- **何を実装するか**: `docs/05` §4.2 / §5.2 のロールをマイグレーションで作る。
  - `app_migrator`（マイグレーション専用。アプリは使わない）
  - `app_tenant`（主平面。🔴 `BYPASSRLS` を持たない）
  - `app_platform`（管理平面の読み取り。業務表に `INSERT/UPDATE/DELETE` を**持たない**）
  - `app_platform_write`（`tenants` / `invitations` / `tenant_sending_domains` の `INSERT` と、契約・クォータ・機能フラグ・お知らせのみ）
  - `app_share_probe`（`engineer_shares` の 3 列の `SELECT` のみ。SP-08 の経路 4 で使う）
- **接続文字列は `packages/config` の 1 箇所**（`DATABASE_URL` / `PLATFORM_DATABASE_URL`）。専用接続プール・専用 Prisma インスタンスにする。
- 🔴 **`packages/config` の `development` 例外を解除する**（code-reviewer 指摘。`docs/05` §4.2 / §13.4 規則 3・4）。ロールが実在するようになった時点で、`development` も他環境と同様に ①`DATABASE_URL !== PLATFORM_DATABASE_URL` ②`DATABASE_URL` / `PLATFORM_DATABASE_URL` の `sslmode=require` ③実行時に `MIGRATION_DATABASE_URL` が未設定であること、を検証する（`crossFieldChecks` の `isDevelopment` 分岐を削除し、`.env.example` のローカル docker-compose 用の値も分離済みロールの接続文字列に更新する）。
- **完了の判定**: `tests/isolation/roles.test.ts` — ①5 ロールすべてが `pg_roles.rolbypassrls = false` ②`app_platform` が業務テーブルに書込権限を 0 件 ③`app_platform_write` の書込先が許可リストと一致（`docs/05` §17.2 #5）。④ `packages/config` の `development` 例外を解除した後も `schema.test.ts` が green（`development` を他環境と同じ検証に通しても既存の development フィクスチャが通ること）。
- ✅ **完了（2026-09-02、コミット `5d926a9`）**

### T-01-06 `withTenant` の契約とブランド型（L）

- **何を実装するか**: `packages/db/src/context.ts` / `index.ts`。
  - `AuthenticatedTenantCtx` を**ブランド型**にし、`resolveTenantCtx` 以外が生成できないようにする（`docs/05` §1.4 / §4.3）。
  - 🔴 **`tenantId` / `partnerCompanyId` は認証コンテキストからのみ取る**（`BR-03` / `F-003 AC-1`）。関数シグネチャがリクエスト入力を受け取れない形にする。
  - `withTenant(ctx, fn)` / `withHostTenant(ctx, fn)` の 2 本と、`TenantDb` / `HostTenantDb` の型。
  - ESLint で `@ses/db` の生 `PrismaClient` と `$executeRaw` / `$queryRaw` の import・呼び出しを禁止する（`CLAUDE.md` §3.1）。
- **完了の判定**: ①型テスト（`expectTypeOf`）で ctx を手で組み立てられないこと ②lint fixture が落ちること ③T-01-04 の 3 ケースが `withTenant` 経由でも green。
- ✅ **完了（2026-09-03、コミット `b3e20ee`）**

### T-01-07 `packages/domain` の骨格と純粋性テスト（S）

- **何を実装するか**: `packages/domain` に状態機械の型置き場（SP-02 以降で中身を入れる）と、🔴 **純粋性を機械検証するテスト**（`docs/05` §17.2 #14）を置く。`Date` の直接参照・`process.env`・I/O の import が **0 件**であることを AST で走査する。
- **理由**: マッチングスコアの決定性（`BR-14`）と、状態遷移のテスト可能性がここに依存する。**後から純粋性を回復するのは高い。**
- **完了の判定**: `domain-purity.test.ts` が green。違反コードを置いた fixture で落ちる。
- ✅ **完了（2026-09-03、コミット `e8bfb20`）**

### T-01-08 CI パイプライン（M）

- **何を実装するか**: `lint` → `typecheck` → `unit`（Vitest）→ **`isolation`（Testcontainers）** の 4 段。🔴 **分離テストを毎回走らせる**（`docs/dev-plan.md` §6.4 R-05）。
- **E2E は SP-03 から追加**（この時点では画面が無い）。
- **完了の判定**: PR で 4 段すべてが走り、`tests/isolation/**` が 1 件でも落ちたら merge できないこと。
- 🔴 **注記（2026-09-03）: 「1 件でも落ちたら merge できない」の機械的強制は [Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の決定待ちである。** GitHub Free の非公開リポジトリではブランチ保護（ルールセット）を設定できず、CI green を merge の前提として強制できない。**暫定は運用 C — CI を run 単位で毎回実行し、green を確認してから次タスクへ進む。** 4 段のワークフロー自体（lint / typecheck / unit / isolation が毎回走ること）は充足しており、**未達なのは「落ちたときに merge を止める」部分のみ**である。`docs/dev-plan.md` §6.4 R-05 の脚注 / §8 の 2026-09-03 の行を参照。🔴 **「CI があるから守られている」と読み替えない。**
- ✅ **完了（2026-09-03、コミット `14ec7ed`）** — ただし上記のとおり merge の機械的強制のみ Issue #25 の決定待ち（暫定は運用 C）。

### T-01-09 🔴 外部依存の着手（M・非コードタスク）

- **何を行うか**（`docs/dev-plan.md` §5）:
  1. **E-2 AWS アカウントの整備** — 🔴 **本番と `sandbox` を別アカウントにする**（`docs/03` §3.2.8 / `docs/03` `program-design` 申し送り 6）。S3 は **1 バケット + テナント別プレフィックス**（GuardDuty の保護バケット上限 25 のため。`docs/03` `program-design` 申し送り 16）。
  2. 🔴 **E-1 Amazon SES** — ①運用用の共通ドメインを 1 本決める（**PM-Q-2 のブロッカー。ブランド名の確定を待たない**）②**ドメイン検証（Easy DKIM の CNAME 3 本 + Custom MAIL FROM）を先に完了させる** ③そのうえで**本番アクセス申請を提出する**（`docs/03` §3.2.6。検証済みだと承認が早いと公式に明記。初回応答 24 時間）。
  3. **E-3 Anthropic** — API キーを取得し、現在の tier（Start / Build / Scale）と月次上限を記録する。
  4. **E-12** — T-01-02 の拡張可否の検証結果を `docs/03` に反映する。
- 🔴 **本タスクはコードを伴わないが、スプリントのタスクとして扱う。** 申請の提出日・受付番号・応答期限を `docs/dev-plan.md` §8 の意思決定ログに追記する。
- **完了の判定**: SES の本番アクセス申請の提出記録（日付 + ケース番号）が残り、ドメイン検証が `VERIFIED` になっていること。**承認の完了は本タスクの完了条件にしない**（応答待ちのため）。ただし **SP-04 の開始時点で未承認なら、`docs/dev-plan.md` §5 のリスク R-02 として明示的に再確認する**。
- 🔴 **状態（2026-09-02 時点）**: 提出記録・ドメイン検証（`VERIFIED` 相当）とも充足済みで完了条件は満たすが、**承認自体は未確定**。本番アクセス申請は一次判定 `DENIED`（原因: CLI 提出時の日本語 use case 文字化け）となり、AWS Support ケース `178832016000877` への訂正返信で再審査依頼中（返信送信はユーザー操作待ち）。詳細は `docs/dev-plan.md` §8（2026-09-02 の行）を参照。
- 🔴 **残件（2026-09-03）**: ①**E-2 の本番 / `sandbox` の別アカウント分離は未実施**（開発用の単一アカウントのみ整備済み）— 実行タスクは **SP-12 の `T-12-09`**（Phase 1 リリース前）②**E-3 Anthropic API キーは未着手（ユーザー作業）** — **SP-07 の着手条件**（`docs/dev-plan.md` §5 E-2 / E-3）。
- ✅ **完了（2026-09-03、コミット `16af2c2`）** — 完了条件（提出記録 + ドメイン検証）は充足。上記残件は後続スプリントのタスク / 着手条件として引き継ぐ。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット（Vitest）** | `packages/config` の Zod スキーマ（起動失敗 2 ケース + `APP_ENV` 5 値の DI スナップショット）。`domain-purity` / `no-restricted-imports` の AST 走査。 |
| **結合（Testcontainers + PostgreSQL）** | 🔴 **T-01-04 の二重防御 3 ケース**（`tests/isolation/double-defense.test.ts`）。T-01-05 のロールと `GRANT` の走査（`tests/isolation/roles.test.ts`）。 |
| **E2E** | 本スプリントでは作らない（画面が無い）。SP-03 から。 |
| **外部 API のモック方針** | 本スプリントでは外部 API を叩かない。T-01-03 の DI で `APP_ENV=development` がモックを選ぶことを**スナップショットで固定**するのみ。実装は SP-04 / SP-05。🔴 **テスト専用の別モックを書かない**（`docs/05` §17.5）。 |

## 6. 完了判定

次をすべて満たしたとき、SP-01 を完了とする。

1. `pnpm -r build` / `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` / `pnpm test:isolation` が CI で green。
2. 🔴 **T-01-04 の二重防御 3 ケースが green**（片方の防御を落としても他方が 0 件に止める）。
3. `packages/config` が `production` でのモック選択と、非本番での本番キー設定の両方で**起動に失敗する**。
4. 5 つの DB ロールが `BYPASSRLS` を持たず、`app_platform` が業務テーブルに書込権限を持たない。
5. `docker compose up` で `development` の 5 サービスが起動し、疎通スモークが green。
6. 🔴 **T-01-09 の外部手続きが提出済み**で、提出記録が `docs/dev-plan.md` §8 に追記されている。

🔴 **注記（2026-09-03）**: **1 の「CI で green」は充足しているが、CI が落ちたときに merge を止める機械的強制は未達である**（T-01-08 の注記 / [Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25)）。**暫定は運用 C（run 単位で毎回実行し、green を確認してから次タスクへ進む）。** 決定が入るまでは、この完了判定は「CI が毎回走り green である」ことまでを意味し、「赤いまま merge され得ない」ことは意味しない。

**SP-01 の状態（2026-09-03）**: T-01-01〜T-01-09 のすべてが完了（§4 の各タスクの ✅ 行）。後続へ引き継ぐ残件は 3 件 — ①**起動時 DI の呼び出し側**（T-01-03 の申し送り → **SP-03 の T-03-12**）②**E-2 の本番 / `sandbox` アカウント分離**（→ **SP-12 の T-12-09**）③**E-3 Anthropic API キー**（→ **SP-07 の着手条件**）。
