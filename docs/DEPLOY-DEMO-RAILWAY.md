# DEPLOY-DEMO-RAILWAY — `demo` 環境（`APP_ENV=demo`）を Railway に立てる

> **この文書は設計書ではない。** `docs/01`〜`docs/05` の設計チェーンには入らない（`docs/GETTING-STARTED.md` / `docs/RUNBOOK.md` と同じ「番号なしの運用文書」）。
> **成果物**: `railway.json` / `scripts/railway-predeploy.mjs` / `scripts/railway-start.mjs` の運用手順。
> **最終更新**: 2026-09-25（新規作成）

---

## 0. 🔴 この環境の性質（読む前に必ず）

| 事項 | 内容 |
|---|---|
| 🔴 **合成データ専用** | `demo` は営業が実演する環境であり、**見込み客の実データを入れてはならない**（`CLAUDE.md` §11.1「`demo` と `sandbox` を兼ねない」）。見込み客が自分のデータで試す場は `sandbox`（Phase 2 / SP-13）であり、`demo` で代替しない |
| 🔴 **外部送信は全モック** | `resolveConnectorSelection('demo')` は email / objectStore / malwareScanner / esign / billing / ai の**全区分が `mock`**（`packages/config/src/connector-selection.ts`）。したがって **S3・ClamAV・SMTP・DocuSign・Stripe・Anthropic の実エンドポイントは 1 つも要らない**。実在の取引先へメールが飛ぶ経路は存在しない |
| **シード可能な環境である** | `isSeedableAppEnv` の対象は `development` / `demo` の 2 つだけ（`packages/config/src/seed-guard.ts`）。`production` / `sandbox` / `staging` では CLI も API も拒否される |
| **テストアカウント** | `docs/DEV-ACCOUNTS.md`（`demo` / `isolation` プリセットの資格情報。合成データ専用でありシークレットではない） |
| **画面の表示** | 全画面の最上部に「デモ環境 — 送信は行われません」相当の帯が常時出る（`F-028`。`CLAUDE.md` §11.1） |

---

## 1. 構成

```
Railway project: ses-platform-demo
│
├── Postgres  （Railway の PostgreSQL。🔴 内部ネットワーク専用 = postgres.railway.internal。公開 TCP プロキシ無し）
│     └─ ロール: postgres（スーパーユーザー。ブートストラップ専用）
│        app_migrator / app_tenant / app_platform / app_platform_write  ← 000_roles.sql が作る
│
├── Redis     （BullMQ のキュー。内部ネットワーク = redis.railway.internal）
│
├── web       （SES_RAILWAY_ROLE=web / SES_DB_BOOTSTRAP=1）
│     ├─ pre-deploy: TLS 確認 → DB ロール → prisma migrate deploy → シード
│     └─ start: apps/web で next start（$PORT）
│
└── worker    （SES_RAILWAY_ROLE=worker）
      ├─ pre-deploy: 何もしない（SES_DB_BOOTSTRAP が無いため即 exit 0）
      └─ start: node apps/worker/dist/main.js（BullMQ の常駐ワーカー）

要らないもの: S3 / MinIO / ClamAV / SMTP / DocuSign / Stripe / Anthropic
（demo は全区分 mock。§0 参照）
```

🔴 **Postgres が内部ネットワーク専用であることが、この構成の形を決めている。** ローカルから `prisma migrate deploy` を流せないため、マイグレーションとシードは**コンテナの中**（Railway の Pre-Deploy Command）で実行する。`psql` は `NIXPACKS_APT_PKGS=postgresql-client` でイメージに入れる。

---

## 2. サービスごとの環境変数

🔴 **本節の必須 / 既定値ありの区分は、`packages/config` の `envSchema` を機械的に洗って得た結果である**（洗い方は §8）。**値は書かない。出所だけを書く。**

表記:
- `${{Postgres.PGHOST}}` … Railway の**参照変数**。サービス名が `Postgres` / `Redis` でない場合は読み替える
- 「生成」… オーケストレーターが生成して Railway の変数に投入する（`openssl rand -base64 32` 相当）
- 「固定値」… ここに書いた文字列そのもの

### 2.1 必須（28 件。1 つでも欠けると起動時検証が失敗する）

`APP_ENV` を含む 28 件。web / worker の**両方**に設定する（ワーカーも同じ `envSchema` を通る）。

#### ① 環境と URL

| 変数 | 出所 | 🔴 注意 |
|---|---|---|
| `APP_ENV` | 固定値 `demo` | これが `demo` でないと全モックにならない |
| `NODE_ENV` | 固定値 `production` | `development` / `production` / `test` のいずれか |
| `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}`（web サービスの公開ドメイン） | worker にも同じ値を置く（通知メールのリンク生成に使う） |
| `SENTRY_ENVIRONMENT` | 固定値 `demo` | 🔴 `APP_ENV` と一致していないと起動失敗 |
| `SCHEDULER_TIMEZONE` | 固定値 `Asia/Tokyo` | 既定値を持たない（常に明示する） |

#### ② DB / Redis

| 変数 | 出所 | 🔴 注意 |
|---|---|---|
| `DATABASE_URL` | 組み立て: `postgresql://app_tenant:<APP_TENANT_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}?sslmode=require` | 🔴 **`postgres` スーパーユーザーで接続してはならない（RLS を素通りする）**。🔴 `sslmode=require` 必須 |
| `PLATFORM_DATABASE_URL` | 同上（ロールを `app_platform` に） | 🔴 `DATABASE_URL` と別値であること |
| `PLATFORM_WRITE_DATABASE_URL` | 同上（ロールを `app_platform_write` に） | 🔴 上の 2 本のいずれとも別値であること |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | 🔴 内部ホスト（`*.railway.internal`）を指す変数を使う。公開プロキシ経由にしない |

#### ③ 認証・暗号（すべて生成）

| 変数 | 出所 | 🔴 注意 |
|---|---|---|
| `AUTH_SECRET` | 生成（base64 / 32 バイト以上） | |
| `AUTH_PLATFORM_SECRET` | 生成 | 🔴 `AUTH_SECRET` と**別値**（主平面 / 管理平面で鍵を分ける） |
| `TOKEN_ENCRYPTION_KEY` | 生成（base64 / **正確に 32 バイト**） | 長さが違うと起動失敗 |
| `TOKEN_ENCRYPTION_KEY_ID` | 固定値 `k1` | 鍵の識別子。シークレットではない（`k` + 数字） |
| `ANON_REFERENCE_HMAC_SECRET` | 生成 | 匿名候補の参照 ID（経路 4） |
| `WEBHOOK_PATH_SECRET` | 生成 | |
| `GUARDDUTY_WEBHOOK_HMAC_SECRET` | 生成 | 🔴 `WEBHOOK_PATH_SECRET` と**別値** |

#### ④ AI（`demo` は `ai: 'mock'`。キーは不要だが上限値はスキーマ上必須）

| 変数 | 出所 | 🔴 注意 |
|---|---|---|
| `ANTHROPIC_MONTHLY_SPEND_CAP_USD` | 固定値（正の数。例: `10`） | mock でも設定が要る |
| `AI_DAILY_COST_LIMIT_USD_DEFAULT` | 固定値（正の数。例: `5`） | 同上 |

#### ⑤ AWS / Amazon SES（`demo` は `email: 'mock'` / `objectStore: 'mock'`。**ダミー値**を置く）

| 変数 | 出所 | 🔴 注意 |
|---|---|---|
| `AWS_ACCOUNT_ID` | ダミーの 12 桁 | 🔴 `AWS_ACCOUNT_ID_EXPECTED_PRODUCTION` と**同値だと起動失敗**（非本番に本番識別子を置かせない） |
| `AWS_ACCOUNT_ID_EXPECTED_PRODUCTION` | **本番の** AWS アカウント ID（12 桁。シークレットではない） | 突き合わせ用。ここが正しくないと上の検出が効かない |
| `SES_DEFAULT_FROM_ADDRESS` | ダミーのメールアドレス | |
| `SES_CONFIGURATION_SET` | 任意の名前（例: `ses-platform-demo`） | |
| `SES_EVENT_TOPIC_ARN` | ダミー ARN（`arn:aws:sns:<region>:<AWS_ACCOUNT_ID>:...`） | 🔴 **本番アカウント ID を含む ARN は起動失敗** |
| `SES_GLOBAL_RATE_PER_SECOND` | 固定値（正の整数。例: `14`） | |
| `S3_BUCKET` | ダミーのバケット名 | 実在しなくてよい（mock） |
| `S3_REGION` | 固定値（例: `ap-northeast-1`） | |

#### ⑥ 監視・スキャン

| 変数 | 出所 | 🔴 注意 |
|---|---|---|
| `SENTRY_DSN` | Sentry の `demo` プロジェクトから取得 | 🔴 **`demo` では必須**（`development` と違い任意ではない） |
| `MALWARE_SCANNER` | 固定値 `mock` | 🔴 `demo` では `mock` 以外を選べない |

### 2.2 既定値があるもの（33 件。`demo` では触らなくてよい）

未設定なら `packages/config` の既定値が入る。**設定しなくても起動する**ことを機械確認済み（§8）。

```
AI_MONTHLY_COST_CAP_USD_DEFAULT            AI_UNIT_QUOTA_MATCH_RATIONALE_DEFAULT
AI_UNIT_QUOTA_PROPOSAL_DRAFT_DEFAULT       AI_UNIT_QUOTA_RENEWAL_SUMMARY_DEFAULT
AI_UNIT_QUOTA_SHEET_PARSE_DEFAULT          ANTHROPIC_MODEL_CHEAP
ANTHROPIC_MODEL_DEFAULT                    AWS_REGION
DOCUSIGN_CONNECT_HMAC_ROTATION_ENABLED     EMAIL_DAILY_LIMIT_PER_TENANT
EMAIL_MINUTE_LIMIT_PER_TENANT              EXPIRY_ALERT_DAYS_BEFORE
GATE_STALL_ALERT_MINUTES                   LOG_LEVEL
MAIL_DISPATCH_STUCK_ALERT_MINUTES          MAIL_PROVIDER_DAILY_QUOTA
MAIL_PROVIDER_QUOTA_WARN_RATIO             PII_RETENTION_YEARS
PURGE_RUN_STALL_ALERT_MINUTES              QUOTA_WARNING_THRESHOLD_PERCENT
S3_FORCE_PATH_STYLE                        S3_PRESIGNED_URL_TTL_SECONDS
SANDBOX_TRIAL_DAYS                         SCAN_STALL_ALERT_MINUTES
SEND_STALE_THRESHOLD_MINUTES               STORAGE_LIMIT_BYTES_PER_TENANT
SUBMITTING_STALL_ALERT_MINUTES             TENANT_HEALTH_INACTIVE_DAYS
TENANT_HEALTH_NO_PARTNERS_GRACE_DAYS       TENANT_HEALTH_SEAT_UTILIZATION_MIN_PERCENT
TENANT_HEALTH_TRIAL_EXPIRING_DAYS          TENANT_PURGE_GRACE_DAYS
UPLOAD_MAX_BYTES
```

🔴 **`MAIL_PROVIDER_DAILY_QUOTA` が既定値ありの側にあるのは `demo` だから**である（既定 200 = SES サンドボックス状態の枠）。`production` / `staging` では既定を持たず、未設定なら起動しない（`docs/RELEASE-PHASE1.md` 付録 A.1）。

`demo` で設定を検討するのは `LOG_LEVEL` だけでよい（実演時のログ量。既定 `info`）。

### 2.3 任意 / `demo` では設定しないもの（24 件）

内訳: (b) の 22 件 + (a) の `MIGRATION_DATABASE_URL` + (c) の `SEED_DATABASE_URL` = 24 件。**(a) は「値によって失敗する条件」の一覧であり、変数としては (b) と重なる。**

#### (a) 🔴 設定すると起動時検証が失敗する（実際に `safeParse` して確認済み。§8）

| 変数 / 条件 | 失敗する理由 |
|---|---|
| `MIGRATION_DATABASE_URL` | 🔴 **実行時環境には置けない**（`docs/05` §13.4 規則 3）。マイグレーション用の接続はこのリポジトリでは `SES_MIGRATION_DATABASE_URL`（スキーマ外の別名）で渡す。§2.4 参照 |
| `STRIPE_SECRET_KEY` に `sk_live_` | 非本番では `sk_test_` のみ |
| `DOCUSIGN_OAUTH_BASE_URL` に `https://account.docusign.com` | 本番エンドポイントは非本番で使えない |
| `ESIGN_API_BASE_URL` に `*.docusign.net` | 同上（`demo.docusign.net` のみ許可） |
| `S3_KMS_KEY_ID` に本番アカウント ID を含む ARN | 非本番に本番識別子（`SES_EVENT_TOPIC_ARN` も同じ判定） |

#### (b) スキーマは通るが設定しない（`demo` は全モック。置くと「実サービスに向いているように見える」設定が残る）

```
ANTHROPIC_API_KEY                        CLAMAV_HOST / CLAMAV_PORT
S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_KMS_KEY_ID
SMTP_HOST / SMTP_PORT                    DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_SECRET_KEY
DOCUSIGN_REDIRECT_URI / DOCUSIGN_OAUTH_BASE_URL / ESIGN_API_BASE_URL
ESIGN_PROVIDER_DEFAULT / ESIGN_ENABLED_PROVIDERS
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_API_VERSION / STRIPE_METER_EVENT_NAMES
TOKEN_ENCRYPTION_KEY_PREVIOUS            GUARDDUTY_WEBHOOK_HMAC_SECRET_PREVIOUS
```

#### (c) `demo` で設定してよい唯一の任意項目

| 変数 | 設定する場合 |
|---|---|
| `SEED_DATABASE_URL` | 🔴 **運営者コンソールの `A-012`（合成データ管理）から再投入したい場合だけ。**`${{Postgres.DATABASE_URL}}` に `?sslmode=require` を足した値（スーパーユーザー）。🔴 `sslmode=require` が無い、または `DATABASE_URL` / `PLATFORM_DATABASE_URL` / `PLATFORM_WRITE_DATABASE_URL` のいずれかと同値だと起動失敗。未設定なら `A-012` は「投入経路が未設定」と表示し API は 503（正常な挙動）。`demo` / `development` 以外に設定すると起動失敗（`docs/05` §13.6） |

### 2.4 デプロイ専用の変数（`envSchema` の対象外）

`packages/config` は見ない。`railway.json` の 2 スクリプトだけが読む。

| 変数 | web | worker | 出所 / 値 |
|---|---|---|---|
| `SES_RAILWAY_ROLE` | `web` | `worker` | 🔴 固定値。未設定・未知なら**起動しない**（§3） |
| `SES_DB_BOOTSTRAP` | `1` | **設定しない** | 🔴 立てたサービスだけが DB ブートストラップを実行する（§3） |
| `SES_POSTGRES_SUPERUSER_URL` | 必要 | 不要 | `${{Postgres.DATABASE_URL}}`（`postgres` スーパーユーザー）。ロール作成とシードに使う |
| `SES_MIGRATION_DATABASE_URL` | 必要 | 不要 | 組み立て: `postgresql://app_migrator:<APP_MIGRATOR_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `APP_MIGRATOR_PASSWORD` | 必要 | 不要 | 生成。`000_roles.sql` の `-v app_migrator_password` に渡る |
| `APP_TENANT_PASSWORD` | 必要 | 不要 | 生成。`DATABASE_URL` に埋めた値と**同じ**にする |
| `APP_PLATFORM_PASSWORD` | 必要 | 不要 | 生成。`PLATFORM_DATABASE_URL` と同じ値 |
| `APP_PLATFORM_WRITE_PASSWORD` | 必要 | 不要 | 生成。`PLATFORM_WRITE_DATABASE_URL` と同じ値 |
| `SES_SEED_PRESETS` | 任意 | 不要 | 既定 `demo,isolation`。**空文字にすると 1 件も投入しない** |
| `NIXPACKS_APT_PKGS` | `postgresql-client` | 不要 | 🔴 これが無いと pre-deploy の `psql` が見つからず失敗する（ビルド時に効く変数） |
| `NIXPACKS_NODE_VERSION` | 任意 | 任意 | `engines.node` は `>=20`。Node のメジャーを固定したいときだけ（例: `22`） |

🔴 **`SES_POSTGRES_SUPERUSER_URL` / `SES_MIGRATION_DATABASE_URL` / `APP_*_PASSWORD` を worker に置かない。** worker は DB ブートストラップをしないため、持たせる意味がなく、特権接続の露出面が広がるだけである。

### 2.5 オーケストレーターが投入するもの / Railway の参照変数で済むもの

| 区分 | 変数 |
|---|---|
| **参照変数で済む**（Railway 画面で `${{...}}` を書くだけ） | `REDIS_URL`、`APP_URL`（`${{RAILWAY_PUBLIC_DOMAIN}}`）、`SES_POSTGRES_SUPERUSER_URL`（`${{Postgres.DATABASE_URL}}`） |
| **参照変数 + 生成値の組み立て** | `DATABASE_URL` / `PLATFORM_DATABASE_URL` / `PLATFORM_WRITE_DATABASE_URL` / `SES_MIGRATION_DATABASE_URL`（ホスト・ポート・DB 名は `${{Postgres.*}}`、ロール名とパスワードは自前） |
| **生成が必要**（🔴 値はリポジトリに書かない） | `AUTH_SECRET` / `AUTH_PLATFORM_SECRET` / `TOKEN_ENCRYPTION_KEY` / `ANON_REFERENCE_HMAC_SECRET` / `WEBHOOK_PATH_SECRET` / `GUARDDUTY_WEBHOOK_HMAC_SECRET` / `APP_MIGRATOR_PASSWORD` / `APP_TENANT_PASSWORD` / `APP_PLATFORM_PASSWORD` / `APP_PLATFORM_WRITE_PASSWORD` |
| **外部から取得** | `SENTRY_DSN`（Sentry の `demo` プロジェクト）、`AWS_ACCOUNT_ID_EXPECTED_PRODUCTION`（本番アカウント ID） |
| **固定値 / ダミー値** | §2.1 の「固定値」「ダミー」と、§2.4 の `SES_RAILWAY_ROLE` / `SES_DB_BOOTSTRAP` / `NIXPACKS_APT_PKGS` |

---

## 3. `railway.json` を 1 ファイルで共有する理由

`railway.json` はリポジトリ直下の 1 ファイルで、**web と worker の両サービスが同じものを読む**。

| なぜ | 内容 |
|---|---|
| **設定がリポジトリに残る** | ビルド・起動コマンドを Railway の画面で per-service に設定すると、**何がどう動いているかがリポジトリから読めなくなる**（レビューもできない）。config-as-code に寄せる |
| **2 サービスが同じ成果物を持つ** | `buildCommand` は `@ses/db` → `@ses/worker` → `@ses/web` の依存閉包をまとめてビルドする。web だけ / worker だけをビルドする形に分けると、サービスごとに別の設定ファイルが必要になり、上の利点が消える。ビルド時間は増えるが**設定の二重管理より安い** |
| **差分を環境変数 2 つに閉じる** | 役割の差は `SES_RAILWAY_ROLE`（何を起動するか）と `SES_DB_BOOTSTRAP`（DB ブートストラップをするか）だけ。ロジックの分岐はスクリプトの中の 1 箇所に集まる |

### `SES_RAILWAY_ROLE`

`scripts/railway-start.mjs` が読む。`web` なら `apps/web` で `next start`（`$PORT`）、`worker` なら `apps/worker/dist/main.js`。

🔴 **未設定・未知の値なら起動を失敗させる（既定で `web` に倒さない）。** 既定を置くと「worker を増やしたつもりが web が 2 つ動いていて、スケジュールジョブが 1 つも走っていない」という**成功したように見える壊れ方**になる。

### `SES_DB_BOOTSTRAP`

`scripts/railway-predeploy.mjs` が読む。`1` のときだけ DB ブートストラップを実行し、それ以外は何もせず exit 0。

🔴 **web にだけ立てる。** 両サービスが同じ `preDeployCommand` を持つため、ガードが無いと 1 回のリリースで同じ処理が 2 回流れる（処理自体は冪等なので壊れないが、リリース時間が伸び、失敗箇所の切り分けが難しくなる）。

### `healthcheckPath` を置かない理由

worker は HTTP を持たない。共有設定にヘルスチェックを書くと **worker のデプロイが必ず失敗する**。web だけにヘルスチェックを付けたい場合は Railway 画面の per-service 設定で足す（§3 の方針の唯一の例外として、理由をここに追記すること）。

---

## 4. デプロイの流れ

```
① build（Nixpacks / ビルダーのコンテナ。DB には到達できない）
     pnpm install --frozen-lockfile --prod=false
     pnpm --filter '@ses/db...' --filter '@ses/worker...' --filter '@ses/web...' run build
        → prisma generate / tsc / next build

② pre-deploy（🔴 サービスのコンテナの中 = 内部ネットワークに居る）
     node scripts/railway-predeploy.mjs
       SES_DB_BOOTSTRAP=1 でなければ即 exit 0
       1/4 TLS 確認          … psql で sslmode=require + SELECT 1
       2/4 DB ロール          … psql -f packages/db/prisma/sql/000_roles.sql（冪等）
       3/4 マイグレーション   … pnpm --filter @ses/db run migrate:deploy（app_migrator）
       4/4 シード            … node packages/db/dist/seed/cli.js --preset=<name>（--reset を付けない）

③ start
     node scripts/railway-start.mjs
       web    → apps/web/node_modules/.bin/next start --port $PORT
       worker → node apps/worker/dist/main.js
```

補足:

- **`pnpm install` を `buildCommand` の先頭に置いている理由**: Nixpacks のインストール段階が `NODE_ENV=production` の影響で devDependencies を落とすと、`tsc` / `prisma` / `next` が無くビルドできない。`--prod=false` を明示して、ビルドに要る devDependencies が必ず入る状態にする。
- **`preDeployTimeoutSeconds: 900`**: マイグレーション 37 本 + シード 2 プリセットの初回実行を見込んだ値。
- **pre-deploy は冪等である**: ロール作成は `WHERE NOT EXISTS` + `\gexec`、`migrate deploy` は未適用分だけ、シードは**投入済みなら `ALREADY_SEEDED` で何も書かない**（`packages/db/seed/index.ts` の `readSeedPresence`。`F-053 AC-2` / `API-A16`）。したがって再デプロイのたびに流れても安全で、データは増えない。

---

## 5. 再デプロイ・再シード

### 5.1 再デプロイ

push するだけでよい（pre-deploy は冪等。§4）。マイグレーションを追加した場合も pre-deploy が自動で適用する。

### 5.2 合成データを**作り直す**（🔴 業務データを消す操作）

pre-deploy は `--reset` を**絶対に付けない**（再デプロイのたびにデータが消えるため）。作り直しは明示操作で行う。

**方法 A: 運営者コンソール `A-012`（推奨）**
`SEED_DATABASE_URL` を web に設定してある場合のみ（§2.3 (c)）。画面から投入・リセットができ、操作が `AuditLog` に残る。

**方法 B: web サービスのシェルから**

```bash
# 🔴 対象プリセットのテナントの業務データを削除してから投入し直す
APP_ENV=demo \
SEED_DATABASE_URL="postgresql://postgres:<pw>@postgres.railway.internal:5432/railway?sslmode=require" \
  node packages/db/dist/seed/cli.js --preset=demo --reset
```

- `--reset-only` なら削除だけ。`--preset` は既定値を持たない（必ず明示する）。
- 🔴 `APP_ENV` が `demo` / `development` 以外なら CLI が実行前に拒否する（`assertSeedableAppEnv`）。

### 5.3 ロールのパスワードを変えたい

`000_roles.sql` はロールが既にあれば**何もしない**（パスワードを更新しない）。変更する場合は、スーパーユーザーで `ALTER ROLE <role> PASSWORD ...` を実行し、`DATABASE_URL` 等の変数を同時に更新する（片方だけ変えると `password authentication failed` で起動しなくなる）。

---

## 6. ログの見方

| 接頭辞 | 出所 | 意味 |
|---|---|---|
| `[ses:railway:predeploy]` | `scripts/railway-predeploy.mjs` | `1/4` 〜 `4/4` の**開始と完了が 1 行ずつ**出る。どの段階で止まったかがここで分かる |
| `[ses:railway:start]` | `scripts/railway-start.mjs` | どちらの役割で起動したか（`web（next start / port=…）` / `worker（node dist/main.js）`） |
| `[ses:startup]` | `@ses/config` の `initializeRuntimeConfig` | 起動時 DI の解決結果（**プロセスにつき 1 行**） |
| `[ses:worker]` | `apps/worker/src/main.ts` | `queues: …`（待ち受けているキュー） |

🔴 **接続文字列・パスワードはどのログにも出ない。** 出るのはホスト名とロール名だけである（`CLAUDE.md` §3.5）。ログにこれらが見えたら不具合として扱う。

---

## 7. よくある失敗

| 症状 | 原因 | 対処 |
|---|---|---|
| `1/4 TLS 確認: 失敗。Railway の Postgres が TLS 非対応である可能性が高い。` | Railway の Postgres が TLS を提供していない | 🔴 **`sslmode` を `prefer` / `disable` に落として先に進めてはならない**（`packages/config` は全環境で `sslmode=require` を要求する）。TLS を有効にした Postgres（自己署名でよい。`require` は証明書検証をしない）に差し替えるか、TLS を終端するプロキシを挟む |
| `psql が見つかりません。…NIXPACKS_APT_PKGS=postgresql-client が設定されていない` | ビルド時の変数が無い / ビルダーが NIXPACKS でない | web サービスに `NIXPACKS_APT_PKGS=postgresql-client` を設定して**再ビルド**（変数の変更だけでは既存イメージは変わらない） |
| 起動直後に `password authentication failed for user "app_tenant"` | ロールが未作成（`2/4` が流れていない / 失敗した）か、`APP_TENANT_PASSWORD` と `DATABASE_URL` のパスワードが食い違っている | pre-deploy のログで `2/4 DB ロール: 完了` を確認。食い違いなら §5.3 |
| `permission denied for schema public` / `CREATE EXTENSION` で失敗 | `SES_POSTGRES_SUPERUSER_URL` がスーパーユーザーでない | `${{Postgres.DATABASE_URL}}`（`postgres` ロール）を使う。`000_roles.sql` は `ALTER SCHEMA public OWNER` と `GRANT CREATE ON DATABASE` を実行する |
| ビルドで `tsc: not found` / `prisma: not found` | devDependencies が落ちている | `buildCommand` の `--prod=false` が消えていないか確認 |
| 起動時検証が `MIGRATION_DATABASE_URL` で失敗 | 実行時環境に `MIGRATION_DATABASE_URL` を設定した | 変数名を `SES_MIGRATION_DATABASE_URL` にする（§2.3 / §2.4） |
| 起動時検証が `SENTRY_DSN` で失敗 | `demo` では**必須**（`development` と違う） | Sentry の `demo` プロジェクトの DSN を設定 |
| 起動時検証が `SEED_DATABASE_URL` で失敗 | `sslmode=require` が無い / 他の 3 本と同値 | `?sslmode=require` を付ける。スーパーユーザーの別接続にする（§2.3 (c)） |
| pre-deploy が worker のデプロイでも流れる | worker に `SES_DB_BOOTSTRAP=1` を付けた | worker では外す（処理は冪等なのでデータは壊れないが、無駄に 2 回流れる） |
| `SES_RAILWAY_ROLE が web \| worker のいずれでもありません` | 変数の設定漏れ | 各サービスに設定する。🔴 既定で `web` には倒さない（意図的な設計） |

---

## 8. §2 の表の出所（機械的に洗った手順）

`packages/config` の `envSchema` そのものに問い合わせて区分した。**環境変数表を手で写していない。**
🔴 **手順は `docs/RELEASE-PHASE1.md` 付録 A.7（`production` の一覧）と同一であり、`APP_ENV` を `demo` に替えただけである**（2 つの文書で分類の定義を揃えるため）。

1. `pnpm --filter @ses/config run build`
2. **必須（既定値なし）**: `envSchema.safeParse({ APP_ENV: 'demo' })` が返す issue の `path` を重複なく集める → **27 件**（+ 判別子の `APP_ENV` = **28 件**）
3. **既定値があるもの**: 2 の 28 件だけを与えて `safeParse` し、**入力に無いのに出力にあるキー**を集める → **33 件**
4. **残り**: `packages/config/src/schema.ts` を正規表現（`^\s{2,}([A-Z][A-Z0-9_]{2,}):\s`）で走査して宣言を拾う → **85 件**。`85 − 28 − 33 = 24`（§2.3）。🔴 突合の結果、「宣言にあって分類に無い」「分類にあって宣言に無い」はいずれも **0 件**
5. **設定すると失敗するもの（§2.3 (a)）**: 2 の正当な入力を基準に 1 項目ずつ足して `safeParse` の結果を確かめる

結果: **必須 28 件（`APP_ENV` 含む）/ 既定値あり 33 件 / 任意・`demo` では設定しない 24 件 = 宣言 85 件**。

`production` との突合（`docs/RELEASE-PHASE1.md` 付録 A）:

| | `demo` | `production` | 差 |
|---|---|---|---|
| 必須 | **28** | **31** | `ANTHROPIC_API_KEY` / `MAIL_PROVIDER_DAILY_QUOTA` / `S3_KMS_KEY_ID` の 3 件が `production` でだけ必須（`demo` は AI もストレージもモックであり、メール枠は既定 200 を持つ） |
| 既定値あり | **33** | **33** | 集合は同一ではない（`demo` は `MAIL_PROVIDER_DAILY_QUOTA` を含み、`production` は `ESIGN_PROVIDER_DEFAULT` を含む） |
| 任意 / 設定しない | **24** | **21** | 上の 3 件の分だけ増える |
| 宣言 | **85** | **85** | 同一 |

🔴 **`envSchema` を変更したら、この手順をやり直して §2 と `docs/RELEASE-PHASE1.md` 付録 A の**両方**を更新すること。** 表を手で保守すると必ず実態から乖離する（`CLAUDE.md` §8.7。**片方だけ直さない**）。
