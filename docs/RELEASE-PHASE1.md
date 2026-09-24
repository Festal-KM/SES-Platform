# RELEASE-PHASE1 — 第 1 回リリース（Phase 1 完了 = SP-12 の後）の実行手順書

> **成果物の持ち主**: `docs/sprints/SP-12-phase1-hardening.md` `### T-12-11`（第 1 回リリースの準備）。**受け入れ基準 ①〜⑨ の当日分を、人間がなぞるだけで済む形にしたものである。**
> **この文書は設計書ではない。** `docs/01`〜`docs/05` の設計チェーンには入らない（`docs/RUNBOOK.md` / `docs/GETTING-STARTED.md` / `docs/README.md` と同じ「番号なしの運用文書」）。
> 🔴 **障害対応は `docs/RUNBOOK.md` が持つ。本書はそこに書いてあることを繰り返さず、参照する。** 本書 = リリース当日にやること / RUNBOOK = 動き出した後に見るもの。
> 🔴 **ここに書いた手順・コマンド・画面・変数は、すべて既存の設計と実装に実在するものだけである。** 決まっていないものは「**未定**」と明示し、誰がいつ決めるかを §6 に一覧した。**出典の無い手順は 1 つも書かない。**
> **最終更新**: 2026-09-24（新規作成）

---

## 目次

| § | 内容 |
|---|---|
| [0](#0-この文書の読み方) | この文書の読み方（`docs/RUNBOOK.md` との分担） |
| [1](#1-前提これが揃うまで着手できない) | 🔴 前提（これが揃うまで着手できない）。**無いとどう壊れるか** |
| [2](#2-リリース当日の手順) | 🔴 リリース当日の手順（順序が意味を持つ）。**失敗したらどうするか** |
| [3](#3-リリース後-24-時間に見るもの) | リリース後 24 時間に見るもの |
| [4](#4-この時点で自動化されていないこと) | 🔴 この時点で自動化されていないこと（利用者に説明が要る） |
| [5](#5-判定の記録欄) | 判定の記録欄（受け入れ基準 ①〜⑨ / `MODE: REVIEW`） |
| [6](#6-未定の一覧誰がいつ) | 未定の一覧（誰が・いつ） |
| [付録 A](#付録-a-production-の環境変数一覧) | 🔴 **`production` の環境変数一覧**（`packages/config` の Zod スキーマからの機械抽出） |
| [付録 B](#付録-b-画面-id-と-url-の対応) | 画面 ID と URL の対応 |

---

## 0. この文書の読み方

**リリースは 3 回ある**（2026-09-10 に人間が決定。[Issue #46](https://github.com/Festal-KM/SES-Platform/issues/46)）。**そのうち本番環境をゼロから立てるのは第 1 回だけであり、本書はその 1 回のためのものである。** 第 2 回（`T-16-11`）/ 第 3 回（`T-20-11`）は差分リリース（マイグレーションの適用・後方互換・告知）であり、**本書の手順を複製しない**（`docs/dev-plan.md` §2.2 / §6.4 R-15）。

| 文書 | 射程 |
|---|---|
| **本書** | リリース当日までにやること。前提の確認 → migration → 起動時検証 → スモーク → 監視の確認 → 判定 |
| **`docs/RUNBOOK.md`** | **動き出した後**の運用。日次監視（§2）/ Sentry（§3）/ `SUBMIT_FAILED` からの復帰（§4）/ `gate.run` の再実行（§5）/ バックアップとリストア（§6）/ 手動請求（§7）/ やってはいけないこと（§8）/ 埋めるべき空欄（§9） |

🔴 **重複を書かない。** 本書が「失敗したらどうするか」で挙げる対処は、ほぼすべて `docs/RUNBOOK.md` の該当節への参照である。**本書を読んで RUNBOOK を読んでいない状態でリリース当日を迎えない。**

🔴 **`production` が初めての実接続である**（`staging` も `sandbox` も無い。§4 の `RL-11` / `RL-12`）。したがって本書の手順は「動くはずだから流す」ではなく「**1 つずつ、動いたことを確かめてから次に進む**」形にしてある。

**出典**: `docs/sprints/SP-12-phase1-hardening.md` §4 `T-12-11` / `docs/dev-plan.md` §2.2 / §6.4 R-15 / R-16 / `docs/RUNBOOK.md` §0。

---

## 1. 前提（これが揃うまで着手できない）

### 1.1 外部依存（`docs/dev-plan.md` §5）

🔴 **4 つすべてが揃うまで、§2 の当日手順に着手しない。** 1 つでも欠けた状態で始めると、途中で止まったときに「設定の誤りなのか、前提が無いのか」を切り分けられない。

| # | 前提 | 🔴 無いとどう壊れるか | 確認する場所 |
|---|---|---|---|
| **E-1** | **Amazon SES の本番アクセス承認** | 🔴 **取引先へのメールが本番で 1 通も出ず、`F-022`（提案の送信）が成立しない。** 提案は `APPROVED` まで進むが外に出ない ——「使えるのに送れない」状態で顧客に渡すことになる | `docs/dev-plan.md` §5 E-1 / §5.1 の SP-01 行（2026-09-02 提出 → 一次判定 `DENIED` → 再審査中）。🔴 **未承認のままリリースしない**（`T-12-11` ① / `docs/dev-plan.md` §6.4 R-02） |
| **E-3** | **Anthropic API キー** | 🔴 **`production` ではワーカーの起動自体に失敗する。** `packages/ai` は未設定時に fail-closed で例外を投げる設計であり（「未設定なら黙ってモックへ」は `CLAUDE.md` §11.1 が禁じている）、`packages/config` の `production` 枝も `ANTHROPIC_API_KEY` を必須にしている。**品質ゲートが動かない = 提案が 1 件も送れない** | `docs/dev-plan.md` §5 E-3 / [Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19)。**取得はユーザー作業である** |
| **E-2** | **本番 / 非本番の AWS アカウント分離**（実施は `T-12-09`） | 🔴 **非本番の認証情報で本番リソースへ到達できる状態が残る**（`CLAUDE.md` §11.1）。加えて `AWS_ACCOUNT_ID_EXPECTED_PRODUCTION` に入れる値が確定しないため、**非本番側の「本番の識別子が紛れ込んでいないか」の検査が空回りする**（付録 A.4 の規則 2 が機能しない） | `T-12-09` の完了記録（アカウント ID の対応表・拒否の確認記録）が `docs/dev-plan.md` §5 E-2 / §8 にあること。🔴 **本タスクで作業を重複させない**（`T-12-11` ①） |
| **E-16** | **`production` 環境の構築**（Vercel 本番プロジェクト / ワーカーのコンテナ基盤 / 本番 RDS + RDS Proxy / Redis / 本番 S3 + GuardDuty / Sentry / DNS・TLS / シークレット投入） | 🔴 **デプロイ先そのものが無い。** リリース日が環境構築に食われる（`docs/dev-plan.md` §6.4 R-14 がまさにこれを避けるために新設された行である）。**SP-10〜SP-11 のうちに着手し、`T-12-11` の着手前に完了していること** | `docs/dev-plan.md` §5 E-16 |

### 1.2 リリース判定に要るもの（外部依存ではないが、当日より前に済んでいること）

| # | 前提 | 🔴 無いとどう壊れるか | 確認する場所 |
|---|---|---|---|
| a | **送信ドメイン検証の実装**（`T-04-05` / `T-04-06`） | テナント独自ドメインが未検証のままでは取引先へ 1 通も出せない（`A-005` 項目 11 に即日現れる）。E-1 が承認されていても**テナント単位で送れない** | `T-12-11` ①。当日は §2.2 S-6 で実際に検証まで通す |
| b | **`SP-21`（UI 基盤 = Tailwind CSS + shadcn/ui）の完了** | 素の CSS のまま顧客が触る画面が出る（[Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43)） | ✅ 2026-09-11 完了（7 / 7）。`docs/sprints/SP-21-ui-foundation.md` §8 + CI run `34553246355`。🔴 **申し送り 2 件（`T-08-10` / `T-08-11`）の消化も併せて確認する**（`T-12-11` ⑦） |
| c | **`docs/RUNBOOK.md` §9 の #1 / #5 / #6 / #7 / #9 / #12 が埋まっていること** | 🔴 **障害が起きた瞬間に手順書が機能しない**（誰が受けて、誰に上げて、何で止めるかが空欄） | `docs/RUNBOOK.md` §9 の 🔴 行がそのまま判定基準である |
| d | **E2E / 負荷の実行ログ**（`T-12-03` / `T-12-02` / `T-12-19`） | Phase 1 の成功条件を「証跡つきで」示せない → `MODE: REVIEW` が `PHASE_INCOMPLETE` になる | `docs/sprints/SP-12-phase1-hardening.md` §6.1 表 A / 表 B。🔴 **当日は再実行しない**（記録の確認である） |

### 1.3 🔴 前提のうち「実装された経路が無い」もの —— **未定**

🔴 **本番の最初の `PlatformUser`（`PLATFORM_OWNER`）を作る経路が実装されていない。** ここが空だと §2.2 のスモークが 1 歩目（`/admin/signin`）から進まないため、**当日より前に手段を決めておく**。

事実として分かっていること（推測を混ぜない）:

- **`platform_users` への `INSERT` 権限を持つアプリのロールが 1 つも無い。** `app_platform_write` に与えてあるのは 7 列の `SELECT` と `last_login_at` の `UPDATE` だけで、`INSERT` は無い（migration `20260904000000_platform_auth/migration.sql`）。`app_platform` は `platform_users` に一切の `GRANT` を持たない。
- **合成データの投入（`pnpm seed` / `A-012`）は `production` で実行できない。** `SEEDABLE_APP_ENVS = ['development','demo']`（`packages/config/src/seed-guard.ts`）であり、API は 403、`SEED_DATABASE_URL` を設定すると起動時検証が失敗する。
- **パスワードのハッシュは Argon2id**（`apps/web/lib/auth/password.ts` の `hashPassword`。パラメータはそこが唯一の出所）。**行を直接作る場合、ハッシュを生成する手段が実装の外に無い。**
- **2 要素認証の設定（enrollment）の入口は実装されている**（`POST /api/admin/auth/2fa/setup`。一次認証済みで実行でき、新設された運営者が管理平面へ入れる）。**つまり足りないのは「行を作ること」だけである。**

🔴 **したがって「誰が、どの経路で最初の `PlatformUser` を作るか」は未定である**（§6 の #1）。**人間が `T-12-11` の完了までに決める。**

**出典**: `docs/dev-plan.md` §5（E-1 / E-2 / E-3 / E-16）/ §5.1 / §6.4（R-02 / R-14 / R-16）/ `docs/sprints/SP-12-phase1-hardening.md` `T-12-11` ①②⑦ / §6 / §6.1 / `docs/RUNBOOK.md` §0.3 / §9 / `CLAUDE.md` §11.1 / `packages/db/prisma/migrations/20260904000000_platform_auth/migration.sql` / `packages/config/src/seed-guard.ts` / `apps/web/lib/auth/password.ts` / `apps/web/app/api/admin/auth/2fa/setup/route.ts`。

---

## 2. リリース当日の手順

### 2.0 始める前に固定すること

| 項目 | 内容 |
|---|---|
| **コードの点** | 🔴 **リリースする commit を 1 つに固定する**（`git rev-parse HEAD` を記録欄 §5 に書く）。手順の途中で HEAD を動かさない |
| **作業者** | 一次受け / 技術エスカレーション（`docs/RUNBOOK.md` §1.2。🔴 **未定**）。**手順 1〜8 は技術側、9〜11 は事業側も同席する** |
| **時刻** | すべて JST（`SCHEDULER_TIMEZONE` は `Asia/Tokyo` 固定であり、組織別に持たない） |
| **記録** | 各手順の実施時刻と判定を §5 に書く。🔴 **`A-005` は最終更新時刻を秒単位で表示するので、その値を控える**（`docs/RUNBOOK.md` §1.1 ②） |

🔴 **本番 DB は空の状態から始まる。** 稼働中の顧客データに対してマイグレーションを適用するのは**第 2 回リリースが初めて**である（`docs/dev-plan.md` §6.4 R-15）。当日は「全 migration を初回適用する」ことになる。

### 2.1 手順（この順序で。番号は意味を持つ）

| # | 手順 | コマンド / 画面 | 成功の判定 | 🔴 失敗したらどうするか |
|---|---|---|---|---|
| **1** | **ビルドする** | `pnpm build`（= `pnpm -r run build`。`@ses/db` の `prisma generate` → 各パッケージ → `apps/web` の `next build` / `apps/worker` の `tsc`） | exit 0 | 止まる。**環境構築の問題ではなくコードの問題**である。リリースを延期する |
| **2** | 🔴 **本番 DB に DB ロールを作る** | `psql "<本番 RDS のマスターユーザー接続>" -v app_migrator_password=... -v app_tenant_password=... -v app_platform_password=... -v app_platform_write_password=... -f packages/db/prisma/sql/000_roles.sql` | `LOGIN` 4 ロール（`app_migrator` / `app_tenant` / `app_platform` / `app_platform_write`）+ `NOLOGIN` の probe 6 ロールが存在する | 🔴 **手で `CREATE ROLE` しない**（`000_roles.sql` が唯一の真実。`docs/RUNBOOK.md` §6.3 #2）。このファイルは冪等なので再実行してよい。⚠️ **マネージド PostgreSQL のマスターユーザーでこの手順が通ることの実地確認は `T-12-09` の範囲であり、本書の時点では未確認**（§6 の #2） |
| **3** | **migration を適用する** | `MIGRATION_DATABASE_URL=<app_migrator の接続> pnpm --filter @ses/db run migrate:deploy` → `... run migrate:status` | `migrate:status` が「未適用 0 件」。`_prisma_migrations` の最終行が、デプロイするコードが期待する最終 migration と一致する | 🔴 **手順 2 を飛ばしていると必ず失敗する**（37 migration のうち 33 が `GRANT` を含み、ロールが無いと適用できない）。🔴 **`MIGRATION_DATABASE_URL` はこのコマンドの直前にだけ渡す。アプリの実行時環境に残さない**（全環境で起動時検証が失敗する。付録 A.4 規則 3） |
| **4** | 🔴 **分離機構が「有効であること自体」を確かめる** | `docs/RUNBOOK.md` §6.3 の **#2〜#8**（カタログ照会）をそのまま実行する | 🔴 **`BYPASSRLS` が全ロールで `false`** / 全業務テーブルで RLS が有効かつ `FORCE`（射程外は `platform_users` / `plans` / `subscriptions` / `skills` / `_prisma_migrations` の 5 つのみ）/ 全表にポリシーが 1 つ以上 / probe ロールの列 `GRANT` が仕様どおりの行数 / オーナー列・当事者列のトリガが存在 | 🔴 **1 つでも違えばアプリを起動しない**（RLS が無効化されていても、GRANT が欠けていても、**アプリは正常に動く**。`docs/05` §4.7）。🔴 **本番 DB に対して `tests/isolation/**` をそのまま流さない**（テストは書き込みを伴う。`docs/RUNBOOK.md` §6.3 の 🔴） |
| **5** | 🔴 **環境変数を投入し、起動時検証を通す（ワーカー側で先に）** | `pnpm --filter @ses/worker run verify-config`（= `node dist/main.js --verify-config`） | 標準出力に **`[ses:startup] APP_ENV=production connectors: email=real objectStore=real malwareScanner=real esign=real billing=real ai=real`** と **`[ses:worker] 設定の検証のみを行い、ワーカーは起動しませんでした。`** が出て **exit 0** | 失敗すると **exit 1** で `[ses:startup] 起動時の設定検証に失敗しました。プロセスを終了します: …` が出る。🔴 **メッセージは「どの変数が、なぜ不正か」を全件列挙する**（1 件目で止めない）。付録 A.1 / A.4 と突き合わせて直す。🔴 **値はログに出ない**ので、値の誤りは自分で照合する |
| **6** | 🔴 **モック実装が選ばれていないことを確認する** | 手順 5 の起動ログ 1 行 | 🔴 **`=mock` が 0 件**（6 区分すべて `real`） | 🔴 **1 つでも `mock` があれば起動しない**（`assertNoMockInProduction` が throw する）。**止まったことを「回避」しない**（`docs/RUNBOOK.md` §8-1）。`production` 枝はスキーマ上も `mock` を選べないため、ここに `mock` が出るのはコードの退行である |
| **7** | 🔴 **seed が投入されないことを確認する** | ①`SEED_DATABASE_URL` が web / worker の実行時環境に**無い**こと ②`GET /api/admin/demo/seed` が **403** ③`/admin/demo` に投入導線が無い | ①は手順 5 が通っていること自体が証明である（設定されていれば起動時検証が失敗する）②③が上記のとおり | 🔴 **`production` に合成データを入れる経路を作らない**（`CLAUDE.md` §11.1 / `F-053 AC-6`）。判定の唯一の出所は `packages/config` の **`isSeedableAppEnv`**（`SEEDABLE_APP_ENVS = ['development','demo']`）であり、**起動時検証・API のガード（`assertDemoSeedAvailable`）・CLI（`assertSeedableAppEnv`）がすべて同じ関数を通る**。②が 403 以外を返したら止めて調べる |
| **8** | **ワーカーを起動する** | コンテナ基盤で `node dist/main.js`（`pnpm --filter @ses/worker start`） | 起動ログ 1 行（手順 5 と同じ）の後に **`[ses:worker] queues: …`** が出る。**スケジュール登録が Redis に届いてから**この行が出る（届かなければ「起動した」とは名乗らない） | `REDIS_URL` / ネットワーク / Redis の疎通を見る。🔴 **`[ses:worker] queues:` が出ないまま Running のコンテナを放置しない** —— 「起動したが何も待ち受けていない」状態である |
| **9** | 🔴 **スモーク（§2.2）** | §2.2 の S-1〜S-11 を**その順序で** | 各行の判定欄 | 各行の「失敗したら」欄 |
| **10** | 🔴 **監視が成立していることを確認する** | `A-005` = **`/admin/monitoring`** | 🔴 **15 項目すべてが `ok: true`**（`GET /api/admin/monitoring` の `items` は `MONITORING_KINDS` の順で常に全項目を含む） | `ok: false` の項目は `errorKind` を見る: **`DB_READ_FAILED`**（`PLATFORM_DATABASE_URL` / 権限）/ **`QUEUE_READ_FAILED`**（Redis）/ **`PROVIDER_READ_FAILED`**（送信基盤のカウンタ = Redis）。🔴 **`ok: false` は「0 件」ではなく「取得できませんでした」である。0 件と読み替えない** |
| **11** | 🔴 **リリース判定** | `pm` を **`MODE: REVIEW` / `TARGET: Phase 1`** で起動する | **`## PHASE_COMPLETE`** | 🔴 **`## PHASE_COMPLETE` が返らない限りリリースしない。** 🔴 **別のリリース手順を作らない**（手順が 2 つあると片方だけ通してリリースする経路ができる。`docs/dev-plan.md` §7） |

🔴 **手順 10 の `ok: true` は「材料が読めた」であって「異常が無い」ではない。** 特に **スケジューラ行は、最初のスケジュール実行が 1 本走るまで `stalled: true`（`lastRunAt: null`）である**（`readSchedulerHeartbeat` は `lastRunAt === null` を停止の疑いと判定する）。最も頻度の高い `scan.poll` が 5 分周期なので、**ワーカー起動から 5 分待って再読み込みし、`lastRunAt` が入ることを確かめる**。入らなければ手順 8 に戻る。

🔴 **項目 13（メール送信基盤）と項目 17（AI 支出）だけは 0 件が正常ではない**（消費率で成立を示す。`docs/RUNBOOK.md` §2.1）。

### 2.2 スモーク（S-1 → S-11。順序を変えない）

🔴 **S-4 以降は実際に外部へメールが飛ぶ。** `production` の送信系は `real` であり、モックは 1 つも無い。**`CLAUDE.md` §7 の「提案メール・契約書の二重送信 / 誤送信 = 0 件（許容しない）」はリリース当日から適用される。**

🔴 **スモークの宛先は、自社が管理しているアドレスだけにする。** 取引先企業・エンド企業・エンジニア本人のアドレスを 1 件も使わない。⚠️ **スモークに使うテナント（および取引先企業）を本番に作るのか、作った場合に後でどう片付けるのか（`CLOSING` → `PURGED` に流すのか）は未定**（§6 の #3）。

| # | 確かめること | 画面 / URL | 判定 | 🔴 失敗したら |
|---|---|---|---|---|
| **S-1** | 運営者が管理平面に入れる | `A-001` = `/admin/signin` → パスワード → 2FA | `/admin`（管理平面のホーム）に入れ、`A-002` = `/admin/tenants` でテナント一覧が読める（この時点では 0 件） | §1.3（`PlatformUser` 行が無い）/ `AUTH_PLATFORM_SECRET` / `PLATFORM_WRITE_DATABASE_URL`（認証経路は `app_platform_write` を使う）を疑う。2FA 未設定なら `POST /api/admin/auth/2fa/setup` が入口 |
| **S-2** | 監視画面が開く | `A-005` = `/admin/monitoring` | 15 項目が並ぶ（この時点では 0 件が並ぶのが正常） | 手順 10 と同じ切り分け |
| **S-3** | 🔴 **最初のテナントを開設できる** | `A-014` = `/admin/tenants/new`（開設先の環境の表示 → 企業情報 → 契約の初期状態 → プラン → 初期 `OWNER` 1 名 → **送信ドメインの登録** → 開設後の既定値の明示 → 確認） | `A-002` の一覧に 1 件増える。送信ドメインの状態が **`未登録` / `登録のみ`** であり、**`A-005` 項目 11 に現れる**（= 取引先へ 1 通も送れない状態であることが可視化されている） | `app_platform_write` の `tenants` / `invitations` / `tenant_sending_domains` への `INSERT` 権限（手順 4）を疑う。🔴 **開設後の既定が危険側でないことを画面で読む**（自動承認 = 無効 / AI ロールの承認モード = すべて都度承認 / 公開範囲 = 誰にも公開されない） |
| **S-4** | 🔴 **初期 `OWNER` へ招待メールが実際に届く**（= 本番で最初の実送信） | 受信箱 | 届く | 🔴 **ここが E-1 / 送信ドメイン / SES 設定のどれかが欠けている最初の兆候になる。** `A-005` の**項目 16**（`QUEUED` 滞留 = 送信済み未記録の疑い）と**項目 13 / 14**（保留）を見る。🔴 **再送しない**（`docs/RUNBOOK.md` §2.2 項目 16）。宛先が自社アドレスであることを先に確かめておく |
| **S-5** | `OWNER` が受諾してテナントに入れる | 招待リンク → パスワード設定 → TOTP 設定 → `S-003` | ダッシュボードが出る。🔴 **`production` では環境バナーが出ない**（非本番だけに出る） | パスワード長（12 文字）・招待の有効期限（7 日）を確認する |
| **S-6** | 🔴 **送信ドメインが検証済みになる** | `S-036` = `/settings/sending-domains`（DNS に DKIM / MAIL FROM のレコードを入れる → 検証） | 状態が **`検証済み`** になり、**`A-005` 項目 11 から消える** | 🔴 **運営者は代行しない**（レコードは顧客の DNS に入れるもの）。`DNS の反映待ち` は待つ。`DNS レコードが確認できません` は画面の失敗理由（DKIM / MAIL FROM / identity のどれが未検証か）を読む。🔴 **ここが済むまで取引先へは 1 通も出ない**（`F-001 AC-4` / `BR-71`） |
| **S-7** | 取引先企業を招待できる | `/settings/partner-companies` → 取引先の担当者が受諾 | 取引先の担当者がログインでき、**自社が持ち込んだ情報しか見えない** | 🔴 **宛先は取引先（パートナー所属）であり、`production` では実送信である。** S-7 の宛先も自社管理のアドレスにする |
| **S-8** | 🔴 **中核ループが本番で 1 周する** | エンジニア 1 名（`S-007`）→ 案件 1 件（`S-012`）→ 公開（`S-013`。`PROJECT_PUBLISH` のゲートが走る）→ 取引先が提案（`S-016` → `S-020`）→ ゲート（`gate.run`）→ ホストが承認・送信（`S-021`）→ 結果記録（`S-024`） | `SUBMITTED` に到達し、**提案メールが届く**。`send_attempts` が **1 行** | 🔴 **`gate.run` が `GATE_RUNNING` のまま滞留したら `docs/RUNBOOK.md` §5**（入口は API #39 だけ）。🔴 **`SUBMIT_FAILED` になったら `docs/RUNBOOK.md` §4**（復帰は人間の明示操作のみ。自動リトライしない）。🔴 **ゲート FAIL を回避して送る導線は無い。作らない**（`docs/RUNBOOK.md` §8-3） |
| **S-9** | 🔴 **スキルシートのスキャンが成立する** | `S-008` にファイルを 1 件アップロード → スキャン結果を待つ | `CLEAN` になってから共有 URL が発行できる。`A-005` 項目 4 に出ない | 🔴 **`CLEAN` になるまで共有 URL は発行されない**（`CLAUDE.md` §3.4 / `BR-26`）。`SCANNING` のまま滞留するなら `SCAN_STALL_ALERT_MINUTES`（既定 10 分）と GuardDuty 側（`T-12-09` ④ の実測）を見る。Webhook の HMAC（`GUARDDUTY_WEBHOOK_HMAC_SECRET`）が転送処理側と一致しているかを確かめる |
| **S-10** | 🔴 **手動請求の算出根拠が画面から取れる**（`T-12-11` ④） | `A-004` = `/admin/usage`（席数 / AI の 4 単位の件数 / **AI 金額 USD** / メール通数 / ストレージ）+ `A-003` = `/admin/tenants/{id}`（契約状態） | 値が出て、**集計時刻が画面に明示される** | 手順は `docs/RUNBOOK.md` §7。🔴 **利用者側（`S-038` = `/settings/usage`）に金額が 1 つも無いことを併せて確かめる**（件数のみ。`CLAUDE.md` §2 / [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。**この区別を崩さない** |
| **S-11** | 監査ログが残っている | `A-006` = `/admin/audit-logs` / テナント側は `S-041` = `/audit-logs` | S-1〜S-10 の操作（ログイン・作成・公開範囲の変更・提案の送信・承認・スキルシートの閲覧 / DL）が残っている。🔴 **運営者の閲覧も残る** | 🔴 **スキルシートの閲覧・DL の記録が無いのは機能欠損である**（`CLAUDE.md` §7 の「0 件」指標）。記録の失敗時はファイルを返さない設計（`AUDIT_WRITE_FAILED` / 500）なので、**欠落は「500 が出た」として現れる** |

⚠️ **`pnpm test:smoke` は本番のスモークではない。** あれは `docker compose up -d` 済みのローカル 5 サービスへの疎通確認（`vitest.smoke.config.ts`）であり、**本番に対して実行しない。**

### 2.3 途中で止めるとき

| 状況 | 判断 |
|---|---|
| 手順 1〜8 のいずれかで失敗 | **公開しない。** 顧客はまだ誰も入っていないので、直して最初からやり直せる |
| **S-4 より前**で失敗 | 同上。外部へは 1 通も出ていない |
| **S-4 以降**で失敗 | 🔴 **すでに外部へメールが出ている可能性がある。** `docs/RUNBOOK.md` §1.1 の順序（**まず止める → 記録する → 連絡する**）に従う。止める手段は 3 つしかない（テナントの停止 = `PLATFORM_OWNER` のみ / ワーカーの停止 / 利用者への依頼）。🔴 **DB を直接 `UPDATE` して状態を戻さない**（`docs/RUNBOOK.md` §8-5） |
| 手順 11 で `PHASE_INCOMPLETE` | 🔴 **リリースしない。** 指摘された項目を潰してから再判定する。**判定を緩めて通さない** |

**出典**: `packages/db/prisma/sql/000_roles.sql`（ロール定義の唯一の真実 / `-v` 変数 / 冪等）/ `packages/db/package.json`（`migrate:deploy` / `migrate:status`）/ `packages/db/prisma/migrations/**`（37 migration。33 が `GRANT` を含む）/ `packages/config/src/startup.ts`（`initializeRuntimeConfig` / `formatStartupLine` / `STARTUP_LINE_PREFIX` / `formatStartupFailureLine`）/ `packages/config/src/connector-selection.ts`（`productionSelection` / `assertNoMockInProduction`）/ `packages/config/src/seed-guard.ts` / `apps/worker/src/main.ts`（`--verify-config` / `VERIFY_CONFIG_OK_LINE` / `[ses:worker] queues:`）/ `apps/web/instrumentation.ts`（検証失敗で `process.exit(1)`）/ `apps/web/lib/admin-monitoring/view.ts`（`MONITORING_KINDS` = 15 / `MONITORING_ERROR_KINDS` = 3）/ `packages/db/src/platform/queries/monitoring.ts`（`readSchedulerHeartbeat`）/ `apps/worker/src/jobs/scan-poll.ts`（`*/5 * * * *`）/ `apps/web/app/api/admin/demo/_lib/service.ts`（`assertDemoSeedAvailable` → 403）/ `docs/05` §4.2 / §4.7 / §13.1 / §13.4 / §13.6 / §16.5 / `docs/04` §A-014 / §A-005 / `docs/dev-plan.md` §6.4 R-15 / §7 / `docs/RUNBOOK.md` §1.1 / §2 / §4 / §5 / §6.3 / §7 / §8 / `CLAUDE.md` §3.4 / §7 / §11.1 / `vitest.smoke.config.ts`。

---

## 3. リリース後 24 時間に見るもの

🔴 **日次監視の手順は `docs/RUNBOOK.md` §2 が持つ。ここでは「リリース直後だけ厚くする 4 項目」に絞る。** `staging` も `sandbox` も無く `production` が初めての実接続であるため、`docs/dev-plan.md` §6.4 R-16 ② と `T-12-11` ⑧ は**リリース後しばらく日次で人が見る**ことを求めている。

| 優先 | 見るもの（`A-005` の項目番号は `docs/RUNBOOK.md` §2.2 と同じ） | リリース直後に特に見る理由 |
|---|---|---|
| **1** | **項目 3 失敗ジョブ**（キュー別の件数と最終失敗日時） | 🔴 **本番の外部エンドポイント構成が初めて動く。** `send.*` / `gate.run` は `attempts: 1` なので 1 回の失敗がそのまま failed になる |
| **2** | **項目 2 `SUBMITTING` の滞留** | 🔴 **片道の状態**。確定していないものは二重送信の疑いに直結する。閾値（既定 30 分）+ 最大 10 分で `send.settle-unknown` が確定させる。**それを超えて残るならジョブが動いていない** |
| **3** | **項目 14 送信保留（理由別内訳）** | 🔴 **保留は失敗ではない**（外部へ 1 回も試みていない）。本番初日は `送信ドメイン未検証` / `送信基盤の環境クォータ` が出やすく、**失敗と混ぜると原因を取り違える** |
| **4** | **項目 16 運用メールの `QUEUED` 滞留** | 🔴 **「外部へ 1 通出たかもしれないのに、その事実を DB に書けなかった」ことの唯一のシグナル。** ジョブは正常終了するので項目 3 には現れない。🔴 **再送しない** |
| 併せて | **スケジューラの生存** | 🔴 **最も広く効く障害。** 止まると項目 2 の確定・保留の自動復帰・削除予告・計測がすべて止まる |

🔴 **0 件だった日も記録する**（見ていない日と区別するため）。🔴 **「何日間 / 誰が / 何時に」見るかは未定**（`docs/RUNBOOK.md` §9 の #9）。

**出典**: `docs/RUNBOOK.md` §2.2 / §2.3 / §2.4 / §9 #9 / `docs/dev-plan.md` §6.4 R-16 / §2.2 RL-12 / `docs/sprints/SP-12-phase1-hardening.md` `T-12-11` ⑧ / `docs/05` §9.10 / §16.5 / `CLAUDE.md` §4.2。

---

## 4. この時点で自動化されていないこと

🔴 **利用者に説明し、合意しておくこと**（`T-12-11` ⑤ ⑥ ⑧ ⑧b。原案は `docs/dev-plan.md` §2.2 の `RL-1`〜`RL-5` / `RL-11` / `RL-12`）。**実装が無いことを説明できない状態でリリースすると、穴がそのまま「不具合」として返ってくる。**

| # | 無いもの | リリース時点の運用 | いつ解消されるか |
|---|---|---|---|
| **RL-1** | 🔴 **⑤ 契約が手作業** | **契約書はメール添付で運用し、進行をプラットフォーム上で追跡しない。** 🔴 **プラットフォーム外でやり取りされる契約書に品質ゲートは効かない** ——「契約書もゲートを通る」は `CLAUDE.md` §3.3 の要求だが、**その対象物がまだプロダクト内に無い**。運用でカバーする範囲として合意する | **第 3 回リリース**（SP-17 / 電子署名は SP-18） |
| **RL-2** | 🔴 **課金が手動請求** | 算出根拠は管理平面から取る（`A-004` / `A-003`。手順は `docs/RUNBOOK.md` §7）。**計測そのものは Phase 1 で完成している**（後から遡って計測できないため先に入れてある）。🔴 **席単価は未回答**（E-5 / [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)） | **第 3 回リリース**（SP-20。🔴 移行月に手動請求と Stripe 請求の両方が飛ばないことが `T-20-11` の受け入れ基準） |
| **RL-3** | 🔴 **⑥ → ① の還流がまだ無い** —— **`CLAUDE.md` §1.3 が「このプロダクトの中核」と定める部分である** | **顧客が手にするのは「① 集める 〜 ④ 商談・決定」までであり、ループは閉じていない。** 🔴 **「営業の入口だけを置き換える段階」であることを明示的に説明し、満了管理を当面 Excel に残したまま使ってもらう前提で合意する**（`docs/dev-plan.md` §6.4 R-12） | 🔴 **第 2 回リリース**（SP-16。**告知の主題はこれの解消になる**） |
| **RL-4** | マッチングスコア・AI スキルシート取込・チャット・通知 / タスクが無い | 複合検索（`F-009`。決定的順序）と匿名共有（経路 4）は Phase 1 にあるため**候補探索は成立する**。スコア順表示・根拠文・自動抽出が無い | **第 2 回リリース**（SP-13 / SP-14 / SP-15） |
| **RL-5** | 経路 5（取引先への開示）が無い | 稼働の参照（`F-065`）は Phase 2、契約の参照（`F-066`）は Phase 3。**当事者列は Phase 0 で入れてあるため、後から穴が開くことはない** | 稼働 = **第 2 回**（SP-16）/ 契約 = **第 3 回**（SP-19） |
| 🔴 **RL-11** | 🔴 **`sandbox` が無い**（見込み客が自分の実データで試す導線が無い） | Phase 1 で立てる環境は **`development` + `demo` + `production` の 3 つ**（[Issue #20](https://github.com/Festal-KM/SES-Platform/issues/20)）。**営業ができるのは `demo`（合成データ）での実演までである。** 🔴 **`demo` に見込み客の実データを入れて代替しない**（`CLAUDE.md` §11.1「`demo` と `sandbox` を兼ねない」。**実演中に実在の取引先名が画面に出る事故につながる**）。🔴 **実データで試したい見込み客は「本契約で迎える」か「Phase 2 まで待つ」の二択になる** —— **この判断を営業・事業側と合意する**（`T-12-11` ⑧b） | **第 2 回リリース**（SP-13 の `T-13-11` + 持ち越しの `T-10-08`） |
| 🔴 **RL-12** | 🔴 **`staging` も無い —— `production` が初めての実接続になる** | 🔴 **代替できていない範囲を正直に列挙する**: ①**本番と同じ外部エンドポイント構成での事前検証が無い** ②**実データを入れた試用の実績が無い**（`demo` の合成データまでしか通っていない）。代替に使ったのは `T-12-03`（E2E 20 シナリオ）/ `T-12-04`（環境分離の総合検証）/ `demo` である。🔴 **その代償として §3 の監視を厚くする** | **第 2 回リリース**（SP-13 の `T-13-09`） |

**出典**: `docs/dev-plan.md` §2.2（RL-1〜RL-5 / RL-11 / RL-12 / RL-8 / RL-9）/ §6.4（R-12 / R-15 / R-16）/ `docs/sprints/SP-12-phase1-hardening.md` `T-12-11` ④⑤⑥⑧⑧b / `docs/RUNBOOK.md` §0.1 / §7 / `CLAUDE.md` §1.3 / §3.3 / §5 / §11.1。

---

## 5. 判定の記録欄

🔴 **空欄のまま残してリリースしない。** 完了の判定は「①〜⑨ のすべてに証跡（記録・文書のパス・確認日）があること」であり、**1 つでも欠けたらリリースしない**（`T-12-11` の完了の判定）。

**固定した情報**

| 項目 | 記入 |
|---|---|
| リリース対象の commit（`git rev-parse HEAD`） | |
| 実施日（JST） | |
| 実施者（技術 / 事業） | |

**受け入れ基準 ①〜⑨**（`docs/sprints/SP-12-phase1-hardening.md` `### T-12-11`）

| # | 基準（要約。正文は `T-12-11`） | 証跡（パス / Issue / 記録の場所） | 確認者 | 確認日 | 判定 |
|---|---|---|---|---|---|
| ① | **本番環境の構築が済んでいる**（`T-12-09` の完了記録 = アカウント ID の対応表・拒否の確認記録が `docs/dev-plan.md` §5 E-2 / §8 にある。E-1 の承認と送信ドメイン検証も「済んでいることの確認」） | | | | |
| ② | **`production` の環境変数一式が揃い、起動時検証を通る** + **`APP_ENV=production` でモック実装が選ばれたら起動が失敗すること**を実環境で 1 回確認した（本書 §2.1 手順 5 / 6。付録 A） | | | | |
| ③ | **障害時の運用手順が文書として存在する**（Sentry 宛先 / `A-005` の項目 / `SUBMIT_FAILED` は人間のみ / `gate.run` の 5 手順 / バックアップとリストア / 連絡経路） | `docs/RUNBOOK.md`（§1〜§6）。🔴 **§9 の #1 / #5 / #6 / #7 / #9 / #12 が埋まっていること** | | | |
| ④ | **手動請求の算出根拠が管理平面の画面から取れる**（席数 / AI 件数・金額がテナント × 月で読め、締め日時点の値を後から再現できる）+ **実務手順が ③ の文書にある** | 本書 §2.2 S-10 / `docs/RUNBOOK.md` §7 | | | |
| ⑤ | **契約書はメール添付で運用することを利用者向けの制約として明記した**（ゲートが効かないことを含む） | 本書 §4 `RL-1` | | | |
| ⑥ | **利用者向けの制約説明（`RL-1`〜`RL-5`）が用意されている**。特に **`RL-3`（⑥ → ① の還流が無い）** をリリース時に合意した | 本書 §4 | | | |
| ⑦ | **`SP-21`（UI 基盤）が完了している** + 申し送り 2 件（`T-08-10` / `T-08-11`）が消化済み | `docs/sprints/SP-21-ui-foundation.md` §8 / `docs/sprints/SP-08-anonymous-share.md` §7 の 9 / 10 / CI run `34553246355` | | | |
| ⑧ | **`staging` / `sandbox` が後になることの扱いを明記した**（代替できていない 2 点の列挙 + リリース直後の日次監視の手順） | 本書 §4 `RL-12` / §3 / `docs/RUNBOOK.md` §2.3 | | | |
| ⑧b | **「見込み客が自分の実データで試す」導線が無いことを営業・事業側と合意した**（`demo` で代替しない） | 本書 §4 `RL-11` | | | |
| ⑨ | **リリース判定を `MODE: REVIEW` / `TARGET: Phase 1` で行い `## PHASE_COMPLETE` を得た** | 下記 | | | |

**⑨ の判定結果**

| 項目 | 記入 |
|---|---|
| 実行した日時（JST） | |
| 実行者 | |
| 返った終端文字列（`## PHASE_COMPLETE` / `## PHASE_INCOMPLETE: N 件`） | |
| `PHASE_INCOMPLETE` だった場合の指摘と対処 | |
| 再判定の日時と結果 | |

🔴 **実施日・確認結果・本書のパスを `docs/dev-plan.md` §8 の意思決定ログに追記する**（`T-12-11` の指示）。🔴 **洗い出しの結果として受け入れ基準に項目が増えたら、`docs/dev-plan.md` §2.2 / §8 にも記録する**（`CLAUDE.md` §8.7。**チェックリストが担当者の頭の中にしか無い状態を作らない**）。

**出典**: `docs/sprints/SP-12-phase1-hardening.md` `### T-12-11`（受け入れ基準 ①〜⑨ / 完了の判定）/ §6 の 12・13 行 / `docs/dev-plan.md` §7 / §8 / `CLAUDE.md` §8.4 / §8.5 / §8.7。

---

## 6. 未定の一覧（誰が・いつ）

🔴 **本書で「未定」と書いたものをここに集約した。** `docs/RUNBOOK.md` §9 と**重複しない**（あちらは障害対応の空欄。埋めたら両方を直す。`CLAUDE.md` §8.7）。

| # | 未定の項目 | 本文の場所 | 誰が | いつまでに |
|---|---|---|---|---|
| 1 | 🔴 **本番の最初の `PlatformUser`（`PLATFORM_OWNER`）を作る経路**。アプリのどのロールにも `platform_users` への `INSERT` が無く、seed は `production` で実行できず、Argon2id ハッシュを生成する経路が実装の外に無い | §1.3 | 人間（実装を伴う場合はタスク化が要る） | 🔴 **`T-12-11` の完了まで。ここが空だとスモークが 1 歩目から進まない** |
| 2 | **マネージド PostgreSQL（RDS / Aurora）のマスターユーザーで `000_roles.sql` が通ることの実地確認**、および 4 ロールのパスワードの生成・保管方法 | §2.1 手順 2 | `T-12-09`（AWS 環境） | `T-12-09` の完了時 |
| 3 | **スモーク用のテナント / 取引先を本番に作るか、作った場合の片付け方**（`CLOSING` → `PURGED` に流すか） | §2.2 前文 | 人間（事業判断） | `T-12-11` の完了まで |
| 4 | **リリース直後の日次監視を「何日間 / 誰が / 何時に」続けるか** | §3 | 人間（運用体制） | `T-12-11` の完了まで（= `docs/RUNBOOK.md` §9 の #9 と同一。**片方だけ埋めない**） |
| 5 | **席単価**（手動請求の金額が決まらない） | §4 `RL-2` | 人間（事業判断。`CLAUDE.md` §8.6） | 初回請求まで。`T-12-07` が [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12) を再提起する |

⚠️ **`docs/RUNBOOK.md` §9 の 13 項目は本書の前提である**（§1.2 c）。**そちらの #1 / #5 / #6 / #7 / #9 / #12 が空のままリリースしない。**

**出典**: `docs/RUNBOOK.md` §9 / `docs/dev-plan.md` §5 E-5 / `docs/sprints/SP-12-phase1-hardening.md` `T-12-09` / `T-12-11` / `CLAUDE.md` §8.6 / §8.7。

---

## 付録 A. `production` の環境変数一覧

> 🔴 **本付録は `packages/config` の Zod スキーマから機械的に抽出した**（手で列挙していない。取りこぼすと起動失敗の原因になる）。抽出方法と再現手順は **A.7**。
> 🔴 **値は 1 つも書いていない。** 「値の出所」欄はプレースホルダである。**シークレットの実例も書かない**（`CLAUDE.md` §3.5）。
> **内訳**: スキーマに宣言されている変数 **85** = **必須（既定値なし）31** + **既定値があるもの 33** + **任意 / `production` では設定しないもの 21**。

### A.1 🔴 `production` で必須（既定値が無い = 未設定なら起動しない）31 件

| 変数 | 用途 | 値の出所 |
|---|---|---|
| `APP_ENV` | 環境の識別。**外部連携の差し替えの唯一の分岐キー** | 固定値 `production`（デプロイ基盤の環境変数） |
| `NODE_ENV` | Node の実行モード。**`APP_ENV` と混同しない** | 固定値 `production` |
| `APP_URL` | 主平面の公開 URL（招待リンク・Webhook URL の生成に使う）。🔴 **`https://` 必須** | `<本番の公開ホスト名。DNS / TLS の設定と一致させる>` |
| `DATABASE_URL` | 主平面の DB 接続（ロール `app_tenant`）。🔴 `sslmode=require` 必須 | `<本番 RDS のエンドポイント + app_tenant のパスワード（§2.1 手順 2 で渡した値）>` |
| `PLATFORM_DATABASE_URL` | 管理平面の読み取り接続（ロール `app_platform`）。🔴 `DATABASE_URL` と別値 + `sslmode=require` | `<同上。app_platform>` |
| `PLATFORM_WRITE_DATABASE_URL` | 管理平面の書き込み接続（ロール `app_platform_write`）。運営者認証もこれを使う。🔴 上 2 本と別値 + `sslmode=require` | `<同上。app_platform_write>` |
| `REDIS_URL` | BullMQ / キャッシュ / トークンバケット | `<マネージド Redis のエンドポイント>` |
| `AUTH_SECRET` | Auth.js（主平面）のセッション署名鍵。base64 で 32 バイト以上 | `<自分で生成（例: openssl rand -base64 32）>` |
| `AUTH_PLATFORM_SECRET` | Auth.js（管理平面）の署名鍵。🔴 **`AUTH_SECRET` と別値** | `<自分で生成。AUTH_SECRET と必ず別の値>` |
| `TOKEN_ENCRYPTION_KEY` | 外部サービストークン等の AES-256-GCM 鍵。🔴 **base64 で正確に 32 バイト** | `<自分で生成>` |
| `TOKEN_ENCRYPTION_KEY_ID` | 現行鍵の識別子（ローテーション用）。`k` + 数字 | `<自分で決める（例: k1）>` |
| `ANON_REFERENCE_HMAC_SECRET` | 🔴 **匿名候補の参照子の HMAC 鍵**（案件をまたいだ突合を不可能にする）。base64 32 バイト以上 | `<自分で生成>` |
| `WEBHOOK_PATH_SECRET` | Webhook 受信 URL のパスに埋めるシークレット。base64 32 バイト以上 | `<自分で生成>` |
| `GUARDDUTY_WEBHOOK_HMAC_SECRET` | 🔴 **`POST /api/webhooks/guardduty` の HMAC 共有鍵**（必須。未設定を許すと fail-open になり、誰でも `NO_THREATS_FOUND` を流し込める）。🔴 **`WEBHOOK_PATH_SECRET` と別値** | `<自分で生成。転送処理側に同じ値を設定する>` |
| `ANTHROPIC_API_KEY` | Claude API のキー。`sk-ant-` 始まり | `<Anthropic Console（E-3）>` |
| `ANTHROPIC_MONTHLY_SPEND_CAP_USD` | 組織全体の月間支出上限（tier の上限。80% で運営者に警告） | `<Anthropic の tier に合わせて決める（事業判断）>` |
| `AI_DAILY_COST_LIMIT_USD_DEFAULT` | テナント 1 日の AI コスト上限の既定値（プランで上書き） | `<方針値。docs/03 §7.6.2>` |
| `AWS_ACCOUNT_ID` | 実行中の環境の AWS アカウント ID（12 桁） | `<本番 AWS アカウント ID（T-12-09 の対応表）>` |
| `AWS_ACCOUNT_ID_EXPECTED_PRODUCTION` | 本番の AWS アカウント ID（照合用の定数） | `<同じ値。⚠️ A.5 の 1 行目を読むこと>` |
| `SES_DEFAULT_FROM_ADDRESS` | 共通ドメインの送信元（テナント所属利用者・運営者宛） | `<SES で検証済みの共通ドメインのアドレス>` |
| `SES_CONFIGURATION_SET` | イベント発行用の configuration set 名（64 文字以内） | `<SES コンソールで作成>` |
| `SES_EVENT_TOPIC_ARN` | バウンス・苦情を受ける SNS トピックの ARN。🔴 **必須**（未設定を許すと「Amazon が署名した任意のトピック」を通してしまう） | `<本番アカウントの SNS トピック ARN>` |
| `SES_GLOBAL_RATE_PER_SECOND` | 全テナント合計の送信レート（グローバルトークンバケット） | `<SES の本番クォータ（承認後に付与された送信レート）以下の値>` |
| `MAIL_PROVIDER_DAILY_QUOTA` | 🔴 **送信基盤（SES アカウント）全体の 24h 枠**。`production` / `staging` は**既定なし**（未設定なら起動失敗）。🔴 テナント単位の日次上限とは**別の枠** | `<SES の本番アクセス承認後に付与された 24h 送信枠>` |
| `MALWARE_SCANNER` | スキャナの実装選択 | 固定値 `guardduty`（`production` では他を選べない） |
| `S3_BUCKET` | スキルシート・契約書・添付の格納先 | `<本番 S3 バケット名（T-12-09）>` |
| `S3_KMS_KEY_ID` | SSE-KMS の鍵。🔴 **ARN 形式で設定する**（A.5 の 3 行目） | `<本番アカウントの KMS キー ARN>` |
| `S3_REGION` | S3 クライアントのリージョン | `<AWS_REGION と同じ値>` |
| `SENTRY_DSN` | Sentry の送信先。`development` 以外で必須 | `<Sentry のプロジェクト設定>`。⚠️ **`.env.example` に無い**（A.6） |
| `SENTRY_ENVIRONMENT` | Sentry 上の環境名。🔴 **`APP_ENV` と一致すること** | 固定値 `production` |
| `SCHEDULER_TIMEZONE` | ジョブの判定タイムゾーン | 固定値 `Asia/Tokyo`（他の値は起動失敗。組織別に持たない） |

### A.2 既定値があるもの（未設定でも起動する）33 件

🔴 **既定値は `packages/config/src/schema.ts` のリテラルであり、設定ファイルではない。** 変えたいときだけ環境変数に置く。**値の出所はすべて「方針値 / 運用で調整する値」であり、外部サービスから取得するものは無い。**

| 変数 | 既定値 | 用途 |
|---|---|---|
| `AWS_REGION` | `ap-northeast-1` | SES / S3 / GuardDuty のリージョン |
| `ANTHROPIC_MODEL_DEFAULT` | `claude-sonnet-5` | 既定モデル。**ロール別設定の既定値**であり、テナント × ロールの設定が優先される |
| `ANTHROPIC_MODEL_CHEAP` | `claude-haiku-4-5-20251001` | 定型処理のモデル（同上） |
| `AI_MONTHLY_COST_CAP_USD_DEFAULT` | `40` | テナントの月間 AI 原価の上限（**運営者の内部指標**。`A-004` の分母。🔴 利用者に出さない。判定にも使わない） |
| `AI_UNIT_QUOTA_SHEET_PARSE_DEFAULT` | `180` | 利用者に見せる月次件数クォータ（スキルシート解析） |
| `AI_UNIT_QUOTA_MATCH_RATIONALE_DEFAULT` | `6200` | 同（根拠文） |
| `AI_UNIT_QUOTA_PROPOSAL_DRAFT_DEFAULT` | `180` | 同（提案ドラフト） |
| `AI_UNIT_QUOTA_RENEWAL_SUMMARY_DEFAULT` | `20` | 同（延長確認の整理）。🔴 `gate-inspector` の件数クォータは**存在しない** |
| `EMAIL_DAILY_LIMIT_PER_TENANT` | `500` | テナント 1 日のメール上限 |
| `EMAIL_MINUTE_LIMIT_PER_TENANT` | `30` | テナント 1 分のメール上限 |
| `MAIL_PROVIDER_QUOTA_WARN_RATIO` | `0.8` | 送信基盤の枠への「接近」の閾値（到達＝保留とは別物。送信は止まらない） |
| `SEND_STALE_THRESHOLD_MINUTES` | `30` | 送信ジョブの遅延保留の閾値（超えたら送らず `GATE_STALE` で待つ。自動復帰しない） |
| `S3_PRESIGNED_URL_TTL_SECONDS` | `300` | 署名付き URL の有効期限（60〜3600） |
| `UPLOAD_MAX_BYTES` | `20971520` | アップロード上限 |
| `STORAGE_LIMIT_BYTES_PER_TENANT` | `53687091200` | テナントあたりのストレージ上限（超過なら署名付き URL を発行しない） |
| `S3_FORCE_PATH_STYLE` | `false` | MinIO 向けのパススタイル。🔴 **`production` で `true` は起動失敗** |
| `SCAN_STALL_ALERT_MINUTES` | `10` | `SCANNING` 滞留の検知閾値。🔴 **GuardDuty の所要時間の実測（E-13）で調整するのはこの 1 つだけ** |
| `LOG_LEVEL` | `info` | pino のレベル |
| `EXPIRY_ALERT_DAYS_BEFORE` | `60` | 満了アラートの日数（Phase 2 で効く） |
| `PII_RETENTION_YEARS` | `3` | 個人情報の保持期間 |
| `SANDBOX_TRIAL_DAYS` | `30` | `sandbox` の有効期間（Phase 2） |
| `TENANT_PURGE_GRACE_DAYS` | `30` | `CLOSING` → `PURGED` の猶予。🔴 **`production` / `sandbox` / `staging` では 30 に固定**（他の値は起動失敗） |
| `QUOTA_WARNING_THRESHOLD_PERCENT` | `80` | 上限接近の通知閾値（1〜99） |
| `GATE_STALL_ALERT_MINUTES` | `30` | `GATE_RUNNING` を「応答不明」と判断するまでの分数（`A-005` 項目 12） |
| `SUBMITTING_STALL_ALERT_MINUTES` | `30` | `SUBMITTING` 滞留を `A-005` 項目 2 に載せるまでの分数 |
| `MAIL_DISPATCH_STUCK_ALERT_MINUTES` | `15` | `email_dispatches(QUEUED)` 滞留を `A-005` 項目 16 に載せるまでの分数。🔴 **短くしすぎると正常な再試行待ちが「送ったのに書けなかった」に見える** |
| `PURGE_RUN_STALL_ALERT_MINUTES` | `30` | `tenant_purge_runs(RUNNING)` 滞留を `A-005` 項目 7' に載せるまでの分数 |
| `TENANT_HEALTH_INACTIVE_DAYS` | `14` | `A-002` の異常度: 最終アクティビティの停滞 / 席の利用判定の窓 |
| `TENANT_HEALTH_NO_PARTNERS_GRACE_DAYS` | `7` | 同: パートナー数 0 を異常と数え始めるまでの日数 |
| `TENANT_HEALTH_SEAT_UTILIZATION_MIN_PERCENT` | `30` | 同: 席の利用率の下限 |
| `TENANT_HEALTH_TRIAL_EXPIRING_DAYS` | `7` | 同: トライアル期限の接近 |
| `ESIGN_PROVIDER_DEFAULT` | `docusign` | 新規接続で提示する既定プロバイダ（Phase 3 で効く）。🔴 `production` では `mock` / `gmosign` を選べない |
| `DOCUSIGN_CONNECT_HMAC_ROTATION_ENABLED` | `true` | 複数 HMAC キーの受理（Phase 3） |

### A.3 任意 / `production` では設定しないもの 21 件

| 変数 | `production` での扱い |
|---|---|
| `MIGRATION_DATABASE_URL` | 🔴 **設定すると起動しない**（全環境共通）。§2.1 手順 3 のコマンドの直前にだけ渡す |
| `SEED_DATABASE_URL` | 🔴 **設定すると起動しない**（`development` / `demo` のみ可） |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 🔴 **設定すると起動しない**（`staging` / `production` は IAM ロールで認証する） |
| `S3_ENDPOINT` | **設定しない**（AWS S3 は既定のリージョンエンドポイント）。⚠️ 起動時検証では止まらない（A.5） |
| `SMTP_HOST` / `SMTP_PORT` | **設定しない**（`development` の MailHog 用）。⚠️ 起動時検証では止まらない |
| `CLAMAV_HOST` / `CLAMAV_PORT` | **設定しない**（`MALWARE_SCANNER=clamav` のときだけ要る。`production` は `guardduty` 固定）。⚠️ 起動時検証では止まらない |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | ローテーション中のみ。形式は `{key_id}:{base64}`（形式違反は起動失敗）。**入れ替え後は必ず外す** |
| `GUARDDUTY_WEBHOOK_HMAC_SECRET_PREVIOUS` | ローテーション中のみ（新旧どちらの署名も受理）。🔴 **新鍵と同値なら起動失敗** |
| `ESIGN_ENABLED_PROVIDERS` | Phase 3。🔴 `production` では `mock` / `gmosign` を含められず、`ESIGN_PROVIDER_DEFAULT`（既定 `docusign`）を含まなければ起動失敗 |
| `DOCUSIGN_INTEGRATION_KEY` / `DOCUSIGN_SECRET_KEY` / `DOCUSIGN_REDIRECT_URI` / `ESIGN_API_BASE_URL` | Phase 3（`SP-18`）。**第 1 回リリースでは設定しない**。🔴 テナントの資格情報は環境変数に置かない（DB に暗号化して保存する） |
| `DOCUSIGN_OAUTH_BASE_URL` | Phase 3。🔴 `production` では `https://account.docusign.com` 以外は起動失敗 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_API_VERSION` / `STRIPE_METER_EVENT_NAMES` | Phase 3（`SP-20`）。**第 1 回リリースでは設定しない**（課金は手動請求。§4 `RL-2`）。🔴 設定するなら `production` は `sk_live_` 始まり（`sk_test_` は起動失敗） |

### A.4 🔴 起動が失敗する条件（実装に実在するものだけ）

**すべて実測で確認した**（A.7 の再現手順）。失敗時は `EnvValidationError` が「**どの変数が、なぜ不正か**」を全件列挙し、**値は出さない**。web は `process.exit(1)`、worker も exit 1 で落ちる。

**(a) `production` の枝そのもので落ちるもの（型）**

| 条件 | 落ちる変数 |
|---|---|
| 🔴 **モック実装を選んだ** | `MALWARE_SCANNER`（`guardduty` のみ。`mock` も `clamav` も不可）/ `ESIGN_PROVIDER_DEFAULT`（`mock` / `gmosign` 不可）/ `ESIGN_ENABLED_PROVIDERS`（`mock` / `gmosign` 不可） |
| `ANTHROPIC_API_KEY` が未設定 / `sk-ant-` 以外 | `ANTHROPIC_API_KEY` |
| `SENTRY_DSN` / `S3_KMS_KEY_ID` / `MAIL_PROVIDER_DAILY_QUOTA` が未設定 | 各変数（`production` では既定値が無い） |
| `STRIPE_SECRET_KEY` が `sk_live_` 以外 | `STRIPE_SECRET_KEY` |
| `DOCUSIGN_OAUTH_BASE_URL` が `https://account-d.docusign.com`（demo） | `DOCUSIGN_OAUTH_BASE_URL` |
| `SCHEDULER_TIMEZONE` が `Asia/Tokyo` 以外 / `LOG_LEVEL` が列挙外 / `TOKEN_ENCRYPTION_KEY` が 32 バイトでない / `SES_EVENT_TOPIC_ARN` が ARN 形式でない / `S3_PRESIGNED_URL_TTL_SECONDS` が 60〜3600 外 / `QUOTA_WARNING_THRESHOLD_PERCENT` が 1〜99 外 / `STRIPE_WEBHOOK_SECRET` が `whsec_` 以外 | 各変数 |

**(b) フィールド間の相互制約（`crossFieldChecks`）**

| # | 条件 | 対象 |
|---|---|---|
| 1 | 🔴 **`production` で `APP_URL` が `https://` で始まらない** | `APP_URL` |
| 2 | 🔴 **非本番に本番の識別子がある** —— `AWS_ACCOUNT_ID` が `AWS_ACCOUNT_ID_EXPECTED_PRODUCTION` と一致 / **`SES_EVENT_TOPIC_ARN` / `S3_KMS_KEY_ID` の ARN に埋め込まれたアカウント ID が本番と一致** / `DOCUSIGN_OAUTH_BASE_URL` が本番 / `ESIGN_API_BASE_URL` が `*.docusign.net`（`demo.docusign.net` のみ許可） | 各変数。**`production` では検査されない**（非本番側の取り違え防止） |
| 3 | 🔴 **`MIGRATION_DATABASE_URL` が実行時環境に設定されている**（`development` を含む全環境） | `MIGRATION_DATABASE_URL` |
| 4 | 🔴 **`SEED_DATABASE_URL` が `development` / `demo` 以外に設定されている**。`development` / `demo` でも、他の 3 本と同値 / `sslmode=require` 無しなら失敗 | `SEED_DATABASE_URL` |
| 5 | 🔴 **`TENANT_PURGE_GRACE_DAYS` が `production` / `sandbox` / `staging` で 30 以外** | `TENANT_PURGE_GRACE_DAYS` |
| 6 | `SENTRY_ENVIRONMENT` が `APP_ENV` と一致しない | `SENTRY_ENVIRONMENT` |
| 7 | `AUTH_SECRET` と `AUTH_PLATFORM_SECRET` が同値 | `AUTH_PLATFORM_SECRET` |
| 8 | `DATABASE_URL` / `PLATFORM_DATABASE_URL` / `PLATFORM_WRITE_DATABASE_URL` のいずれかが同値、またはいずれかに `sslmode=require` が無い | 各変数 |
| 9 | 🔴 **`staging` / `production` で `S3_ACCESS_KEY_ID` または `S3_SECRET_ACCESS_KEY` が設定されている** | `S3_ACCESS_KEY_ID` |
| 10 | 🔴 **`production` で `S3_FORCE_PATH_STYLE=true`** | `S3_FORCE_PATH_STYLE` |
| 11 | `MALWARE_SCANNER=clamav` なのに `CLAMAV_HOST` / `CLAMAV_PORT` が欠けている | `CLAMAV_HOST` |
| 12 | `GUARDDUTY_WEBHOOK_HMAC_SECRET_PREVIOUS` が新鍵と同値 / `GUARDDUTY_WEBHOOK_HMAC_SECRET` が `WEBHOOK_PATH_SECRET` と同値 | 各変数 |
| 13 | `ESIGN_ENABLED_PROVIDERS` が `ESIGN_PROVIDER_DEFAULT` を含まない | `ESIGN_ENABLED_PROVIDERS` |

**(c) 検証を通った後の二重防御（実行時）**

- 🔴 **`assertNoMockInProduction`**: `production` で 6 区分（`email` / `objectStore` / `malwareScanner` / `esign` / `billing` / `ai`）のいずれかに `mock` が選ばれていたら throw する。**型が唯一の防御にならないようにするための 2 枚目**である。
- 🔴 **`packages/ai` の fail-closed**: API キーが無ければ `AiClientNotAvailableError`。**「未設定なら黙ってモックへ」を作らない。**

### A.5 ⚠️ 起動時検証では止まらないもの（手で確かめる）

🔴 **ここは「スキーマが守ってくれない」ことを明示するための節である。§2.1 手順 5 が通っても、以下は誰も見ていない。**

| # | 見落としうる設定 | 何が起きるか | 当日どう確かめるか |
|---|---|---|---|
| 1 | **`production` で `AWS_ACCOUNT_ID` と `AWS_ACCOUNT_ID_EXPECTED_PRODUCTION` が一致していない** | 🔴 **起動する。** 一致の検査は**非本番でのみ**行われる（`!isProduction` の条件下）。本番側のタイプミスは起動時に捕まらず、**非本番側の「本番の識別子が紛れ込んでいないか」の検査が空回りする** | 2 つの値を目で突き合わせる。`T-12-09` のアカウント ID 対応表と照合する |
| 2 | **`NODE_ENV` が `production` 以外**（例: `development`） | 🔴 **起動する。** `APP_ENV` との一致は検査されない | 目で確認する |
| 3 | **`S3_KMS_KEY_ID` が ARN 形式でない**（素のキー ID / `alias/…`） | 🔴 **起動する。** ただし**非本番での「本番の鍵が紛れ込んでいないか」の判定ができなくなる**（アカウント ID を取り出せない） | 🔴 **ARN 形式で設定する**（`docs/05` §13.4 規則 2 が「`T-12-11` のリリース手順で ARN 形式に固定する」と名指ししている要求である） |
| 4 | **`S3_ENDPOINT` / `SMTP_HOST` / `SMTP_PORT` / `CLAMAV_HOST` / `CLAMAV_PORT` が `production` に残っている** | 🔴 **起動する**（いずれも任意項目のため） | 投入する環境変数の一覧から**消してあること**を確認する（A.3） |

### A.6 `.env.example` との差分

| 区分 | 変数 |
|---|---|
| 🔴 **`production` で必須なのに `.env.example` に `KEY=` 行が無い**（= 最も忘れやすい 2 件） | **`SENTRY_DSN`** / **`S3_KMS_KEY_ID`**（どちらも `development` では不要なため `.env.example` に無い） |
| **`production` では設定しない（`.env.example` にあるのはローカル用）** | `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`（MinIO）/ `SMTP_HOST` / `SMTP_PORT`（MailHog）/ `CLAMAV_HOST` / `CLAMAV_PORT`（ClamAV） |
| **`.env.example` にあるがアプリのスキーマ外**（docker-compose / ワイヤーフレーム生成スクリプト用。`production` には不要） | `POSTGRES_*` / `APP_*_PASSWORD`（`000_roles.sql` に渡す値。§2.1 手順 2）/ `REDIS_PORT` / `MINIO_*` / `MAILHOG_*` / `WIREFRAME_*` / `OPENAI_API_KEY` / `GEMINI_API_KEY` |
| **スキーマにあるが `.env.example` に `KEY=` 行が無く、`production` でも任意**（Phase 3 / ローテーション / 既定値で足りるもの） | `DOCUSIGN_*` / `ESIGN_*` / `STRIPE_*` / `TOKEN_ENCRYPTION_KEY_PREVIOUS` / `GUARDDUTY_WEBHOOK_HMAC_SECRET_PREVIOUS` / `MIGRATION_DATABASE_URL` / `EMAIL_DAILY_LIMIT_PER_TENANT` / `EMAIL_MINUTE_LIMIT_PER_TENANT` / `EXPIRY_ALERT_DAYS_BEFORE` / `PII_RETENTION_YEARS` / `SANDBOX_TRIAL_DAYS` / `TENANT_PURGE_GRACE_DAYS` / `QUOTA_WARNING_THRESHOLD_PERCENT` / `S3_PRESIGNED_URL_TTL_SECONDS` / `UPLOAD_MAX_BYTES` |

⚠️ **`docs/03` §6.11 の SMS（Amazon SNS）の変数は、まだ `packages/config` のスキーマに無い。** 2 要素認証への SMS 追加は **Phase 2（`T-13-10`）** であり、**第 1 回リリースでは投入しない**（`SMS_SENDER_ID` は正式名称〔E-10〕に依存する。`docs/dev-plan.md` §5 E-10 / E-17）。🔴 **管理権限ロールは TOTP 必須のままなので、SMS が無くても `CLAUDE.md` §3.5 の 2FA 要件は満たされている**（`docs/dev-plan.md` §5 E-17）。

### A.7 抽出方法（再現手順）

**手で列挙していないことを後から確かめられるように、手順を残す。**

1. `pnpm --filter @ses/config run build`
2. **必須（既定値なし）**: `envSchema.safeParse({ APP_ENV: 'production' })` が返す issue の `path` を重ねなく集める → **30 件**（+ 判別子の `APP_ENV` = **31 件**）。
3. **既定値があるもの**: 2 で得た 31 件だけを与えて `safeParse` し、**入力に無いのに出力にあるキー**を集める → **33 件**。
4. **残り**: `packages/config/src/schema.ts` を正規表現（`^\s{2,}([A-Z][A-Z0-9_]{2,}):\s`）で走査して宣言を拾う → **85 件**。`85 − 31 − 33 = 21`（A.3）。🔴 **突合の結果、「宣言にあって分類に無い」「分類にあって宣言に無い」はいずれも 0 件**。
5. **起動が失敗する条件（A.4）**: 上記 31 件の正当な入力を基準に、1 項目ずつ変えて `safeParse` の結果を確かめる（`production` / `demo` の 2 系統で計 43 ケース）。
6. **回帰の担保**: `npx vitest run packages/config --maxWorkers=1`（**6 files / 156 tests green**。2026-09-24 実測）。

🔴 **スキーマを変えたら本付録も直す**（`CLAUDE.md` §8.7。**片方だけ直さない**）。**変数の追加・削除は上記 2〜4 をやり直せば機械的に検出できる。**

**出典**: `packages/config/src/schema.ts`（`commonShape` / `envUnion` の 5 枝 / `crossFieldChecks` / `TENANT_PURGE_GRACE_DAYS_FIXED`）/ `packages/config/src/primitives.ts`（`base64AtLeastBytes` / `base64ExactBytes` / `envBoolean` / `csvOf` / `arnAccountId` / `hasSslModeRequire` / `isDocusignProductionBaseUrl`）/ `packages/config/src/seed-guard.ts` / `packages/config/src/load-env.ts` / `packages/config/src/errors.ts` / `packages/config/src/connector-selection.ts` / `packages/config/src/startup.ts` / `.env.example` / `docs/05` §13.1 / §13.4（規則 1〜8）/ `docs/03` §6.1〜§6.11 / `docs/dev-plan.md` §5 E-3 / E-10 / E-17 / `CLAUDE.md` §2 / §3.4 / §3.5 / §11.1。

---

## 付録 B. 画面 ID と URL の対応

**本書の本文で参照したもの。**（`docs/RUNBOOK.md` 付録と重複する 4 件は、そちらと同じ値である。）

| ID | 画面 | URL |
|---|---|---|
| `A-001` | 運営者サインイン | `/admin/signin` |
| — | 管理平面のホーム | `/admin` |
| `A-002` | テナント一覧 | `/admin/tenants` |
| `A-003` | テナント詳細 | `/admin/tenants/{id}` |
| `A-004` | 利用量・クォータ管理 | `/admin/usage` |
| `A-005` | **運用監視** | `/admin/monitoring` |
| `A-006` | 監査ログ横断検索 | `/admin/audit-logs` |
| `A-010` | 契約管理（削除完了の確認） | `/admin/tenants/{id}/contract` |
| `A-012` | デモ環境の合成データ管理 | `/admin/demo`（🔴 `production` では API が 403） |
| `A-014` | **テナントの開設** | `/admin/tenants/new` |
| `S-003` | ホーム（ダッシュボード） | `/` |
| `S-022` | 送信失敗の一覧 | `/proposals/send-failures` |
| `S-036` | **送信ドメインの設定** | `/settings/sending-domains` |
| `S-038` | 利用量（テナント側。🔴 金額は無い） | `/settings/usage` |
| `S-041` | 監査ログ（テナント側） | `/audit-logs` |
