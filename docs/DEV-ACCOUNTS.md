# 開発環境（`APP_ENV=development`）の起動手順とテストアカウント

**画面を触って確認するための文書。** ここに載っている資格情報は**合成データ専用**であり、シークレットではない。

> 🔴 **この資格情報が通るのは `development` / `demo` だけである。**
> シードは `packages/config/src/seed-guard.ts` の `isSeedableAppEnv` により **`production` / `sandbox` / `staging` には投入できない**（CLI も API も 403）。したがってこのパスワードで本番のデータに到達する経路は存在しない。
> 🔴 **それでもこのパスワードを本番・`sandbox` に流用してはならない。** 本番の初期 `OWNER` は `A-014`（テナント開設）の招待フローで作る。
>
> 出典: `packages/db/seed/presets/demo.ts`（`DEMO_SEED_PASSWORD`）/ `presets/isolation.ts`（`ISOLATION_SEED_PASSWORD` / `ISOLATION_SEED_PLATFORM_USERS`）/ `CLAUDE.md` §11

---

## 1. URL

| 何 | URL | 備考 |
|---|---|---|
| **主平面**（テナント利用者の画面） | **http://localhost:3000** | 未ログインなら `/signin` へ飛ぶ |
| **管理平面**（運営者コンソール） | **http://localhost:3000/admin** | **別認証**（`PlatformUser`）。テナントのアカウントでは入れない |
| **MailHog**（送信されたメールの確認） | http://localhost:8025 | `development` は全モック。実送信は 1 通も出ない |
| **MinIO コンソール**（S3 互換） | http://localhost:9001 | スキルシートの実体の確認用 |

画面の上部に「**開発環境 — 外部送信はすべてモックです**」の帯が常時出る（`F-028`）。これが出ていない画面があれば不具合。

---

## 2. 起動手順

### 2.1 初回だけ

```bash
# 1) 開発用の環境変数ファイルを作る（.env.example が開発既定値の唯一の出所）
#    🔴 ローカルの 5432 に別の PostgreSQL が常駐しているため、この環境では 5433 に逃がしている
sed -e 's/^POSTGRES_PORT=5432$/POSTGRES_PORT=5433/' \
    -e 's#@localhost:5432/#@localhost:5433/#g' \
    .env.example > .env.development.local
#    （5432 が空いているなら `cp .env.example .env.development.local` でよい）

# 2) コンテナを起動（PostgreSQL / Redis / MinIO / MailHog / ClamAV）
set -a; . ./.env.development.local; set +a
docker compose up -d

# 3) マイグレーションを適用（app_migrator で流す）
export DATABASE_URL="${DATABASE_URL/app_tenant:app_tenant_dev_password/app_migrator:app_migrator_dev_password}"
pnpm --filter @ses/db run build
pnpm --filter @ses/db run migrate:deploy

# 4) 合成データを投入（demo = 主平面 / isolation = 管理平面のアカウントを含む）
export SEED_DATABASE_URL="postgresql://ses:${POSTGRES_PASSWORD}@localhost:5433/ses_platform?sslmode=require"
pnpm --filter @ses/db run seed --preset=demo
pnpm --filter @ses/db run seed --preset=isolation
```

🔴 **`.env.development.local` はコミットしない**（`.gitignore` の `.env.*.local` で除外済み）。中身は `.env.example` から機械的に作れるので、リポジトリに置く必要がない。

### 2.2 毎回

```bash
set -a; . ./.env.development.local; set +a
docker compose up -d
pnpm --filter @ses/web run dev     # → http://localhost:3000
```

### 2.3 ジョブ（ゲート実行・送信・通知）も動かしたいとき

提案のレビュー依頼（`gate.run`）や送信（`send.proposal`）を画面から通すにはワーカーが要る。**別のターミナル**で:

```bash
set -a; . ./.env.development.local; set +a
pnpm --filter @ses/worker run build
pnpm --filter @ses/worker run start
```

ワーカーを起動しない場合、提案は `GATE_RUNNING`（検査中）のまま止まる。**それは不具合ではない。**

### 2.4 データを作り直したいとき

```bash
set -a; . ./.env.development.local; set +a
export SEED_DATABASE_URL="postgresql://ses:${POSTGRES_PASSWORD}@localhost:5433/ses_platform?sslmode=require"
pnpm --filter @ses/db run seed --preset=demo --reset
```

---

## 3. テストアカウント

### 3.1 パスワード

| プリセット | パスワード |
|---|---|
| `demo`（下の 20 名） | **`seed-demo-password-1`** |
| `isolation`（運営者 2 名） | **`seed-isolation-password-1`** |

### 3.2 🔴 2 要素認証について（最初に読む）

**`OWNER` / `ADMIN` と運営者（`PlatformUser`）は 2 要素認証が必須**（`CLAUDE.md` §3.5）。シードは TOTP の資格情報を**作らない**ので、**初回サインイン時に登録ウィザードが出る**。画面に QR と `otpauth://` の文字列が表示されるので、任意の認証アプリ（Google Authenticator / 1Password / Authy など）に登録すればそのまま進める。リカバリコードも画面に出る。

> シードで TOTP を作らない理由: シークレットの平文をリポジトリに置かないため（`presets/isolation.ts` の注記）。

**画面をさっと見たいだけなら、2 要素認証が不要な `SALES` から入るのが速い。**

| 目的 | 最初に使うアカウント |
|---|---|
| **とりあえず画面を見る** | `sales-1@demo-alpha.example`（2FA なし。案件・エンジニア・提案が一通り入っている） |
| 取引先側の見え方を確かめる | `partner-1-sales@demo-alpha.example`（2FA なし） |
| 管理者向けの設定画面を見る | `admin@demo-alpha.example`（**2FA の登録が要る**） |
| 運営者コンソールを見る | `platform-owner@seed-isolation.test`（**2FA の登録が要る**） |

### 3.3 主平面 — テナント 1「株式会社サンプルアルファ」（取引先 5 社 / エンジニア 10 名）

| メールアドレス | ロール | 2FA | 見えるもの |
|---|---|---|---|
| `owner@demo-alpha.example` | `OWNER` | 要 | 全権。契約者・支払者 |
| `admin@demo-alpha.example` | `ADMIN` | 要 | メンバー管理・取引先の招待・公開範囲ポリシー・設定 |
| **`sales-1@demo-alpha.example`** | `SALES` | 不要 | **案件・エンジニア・提案の作成と編集、承認、チャット** |
| `sales-2@demo-alpha.example` | `SALES` | 不要 | 同上（担当の違いを見るための 2 人目） |
| `partner-1-admin@demo-alpha.example` | `PARTNER_ADMIN` | 不要 | 取引先 1 社目の管理者。**自社が持ち込んだ情報しか見えない** |
| `partner-2-admin@demo-alpha.example` | `PARTNER_ADMIN` | 不要 | 取引先 2 社目 |
| `partner-3-admin@demo-alpha.example` | `PARTNER_ADMIN` | 不要 | 取引先 3 社目 |
| `partner-4-admin@demo-alpha.example` | `PARTNER_ADMIN` | 不要 | 取引先 4 社目 |
| `partner-5-admin@demo-alpha.example` | `PARTNER_ADMIN` | 不要 | 取引先 5 社目 |
| `partner-1-sales@demo-alpha.example` | `PARTNER_SALES` | 不要 | 取引先 1 社目の営業 |
| `partner-2-sales@demo-alpha.example` | `PARTNER_SALES` | 不要 | 取引先 2 社目の営業 |
| `partner-3-sales@demo-alpha.example` | `PARTNER_SALES` | 不要 | 取引先 3 社目の営業 |
| `partner-4-sales@demo-alpha.example` | `PARTNER_SALES` | 不要 | 取引先 4 社目の営業 |
| `partner-5-sales@demo-alpha.example` | `PARTNER_SALES` | 不要 | 取引先 5 社目の営業 |

### 3.4 主平面 — テナント 2「株式会社サンプルブラボー」（取引先 1 社 / エンジニア 4 名）

**テナント分離の確認用。** 同じ画面でテナント 1 のデータが 1 件も出ないことを確かめられる。

| メールアドレス | ロール | 2FA |
|---|---|---|
| `owner@demo-beta.example` | `OWNER` | 要 |
| `admin@demo-beta.example` | `ADMIN` | 要 |
| `sales-1@demo-beta.example` | `SALES` | 不要 |
| `sales-2@demo-beta.example` | `SALES` | 不要 |
| `partner-1-admin@demo-beta.example` | `PARTNER_ADMIN` | 不要 |
| `partner-1-sales@demo-beta.example` | `PARTNER_SALES` | 不要 |

### 3.5 管理平面（運営者コンソール `/admin`）

パスワードは **`seed-isolation-password-1`**（上の 20 名とは別）。

| メールアドレス | ロール | 2FA | 権限 |
|---|---|---|---|
| `platform-owner@seed-isolation.test` | `PLATFORM_OWNER` | 要 | 全権（テナントの停止・クォータ変更ができる唯一のロール） |
| `platform-support@seed-isolation.test` | `PLATFORM_SUPPORT` | 要 | 監視・調査・サポート。**課金設定とテナント停止は不可** |

🔴 **運営者に見えないもの**（意図された設計。不具合ではない）: スキルシートの原本と本文 / エンジニアの氏名・生年月日・連絡先 / チャットの本文 / 外部サービスのトークン平文。運営者に必要なのは「件数・状態・エラー」であって「内容」ではない（`CLAUDE.md` §10.5）。

### 3.6 シードに**無い**ロール

`VIEWER` / `PARTNER_VIEWER` のアカウントは `demo` プリセットに無い。画面を確認したい場合は `admin@demo-alpha.example` でメンバーを招待してロールを付けてほしい（`PARTNER_VIEWER` の実装は `T-16-12` = Phase 2）。

---

## 4. 見どころ（おすすめの巡回順）

`sales-1@demo-alpha.example` で入ってから:

1. **ホーム（`S-003`）** — 要対応キュー。承認待ち・送信保留・期限が 1 画面に出る
2. **案件一覧 → 詳細（`S-010` / `S-011`）** — 公開範囲と公開の状態（**公開後に公開欄を直すと再検査が走り、商流情報が入っていれば自動で公開解除される**）
3. **エンジニア検索（`S-005`）** — 複合検索。`?projectId=` 付きの候補一覧（`S-016`）では**取引先の匿名候補が混ざる**（スキル / 経験年数 / 単価レンジ / 稼働可能時期 / 勤務地の 5 項目だけ。実名は提案が作られるまで出ない）
4. **提案の作成 → レビュー依頼 → 承認（`S-020` / `S-021`）** — 品質ゲート。**FAIL を無視して送る導線は存在しない**。ワーカーを起動していないと検査中で止まる
5. **提案詳細（`S-023`）** — 履歴タイムラインと**ゲート結果の履歴**（再実行しても上書きされない）
6. **設定 → 監査ログ（`S-041`）** — 誰が・いつ・何を見たか。CSV エクスポートあり
7. 別ブラウザ（またはシークレットウィンドウ）で `partner-1-sales@demo-alpha.example` — **同じ案件が取引先からどう見えるか**。他社の提案の存在・件数・単価が 1 つも出ないことが設計の要点

---

## 5. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| `docker compose up` で 5432 のポートエラー | ローカルに別の PostgreSQL が常駐している。上の手順どおり `POSTGRES_PORT=5433` にする |
| Prisma が `Environment variable not found: DATABASE_URL` | `set -a; . ./.env.development.local; set +a` を忘れている（Prisma CLI はリポジトリ直下の `.env` を自動で読まない） |
| `server does not support TLS` | コンテナが古い。`docker compose down && docker compose up -d` で作り直す（`sslmode=require` は開発でも必須。`docs/05` §13.4 規則 4） |
| シードが `row violates row-level security policy` | `SEED_DATABASE_URL`（`ses` ロール）を設定せずに `DATABASE_URL`（`app_tenant`）で流している。RLS が正しく効いている証拠 |
| 提案が「検査中」で止まる | ワーカーが動いていない（§2.3） |
| メールが届かない | `development` は全モック。MailHog（http://localhost:8025）で見る |
| ログイン後に 2FA を求められる | `OWNER` / `ADMIN` / 運営者は必須（§3.2）。`SALES` なら不要 |

---

**出典**: `packages/db/seed/presets/{demo,isolation}.ts` / `packages/config/src/seed-guard.ts` / `docker-compose.yml` / `.env.example` / `docs/05` §13.4・§13.6 / `CLAUDE.md` §3.5・§10.5・§11
