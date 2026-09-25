# Dockerfile — `demo` 環境（Railway）用の単一イメージ。
#
# 🔴 web と worker は**同じイメージ**を使い、起動時に `SES_RAILWAY_ROLE` で役割を分ける
#    （`scripts/railway-start.mjs`）。ビルド成果物を 2 回作らないため、および Railway の
#    サービスごとのビルド設定を画面で触らずに済ませるため（`docs/DEPLOY-DEMO-RAILWAY.md`）。
#
# 🔴 なぜ Dockerfile なのか: Railway の既定ビルダー（Railpack）はモノレポの起動コマンドを
#    自動検出できず、`railway.json` の `deploy.startCommand` も prepare 段階では読まれなかった
#    （2026-09-25 の実測。`railpack prepare exited with an error: No start command detected`）。
#    ビルダーの検出に依存せず、Node のバージョン・pnpm・psql を明示的に固定する。
#
# 🔴 psql は `scripts/railway-predeploy.mjs` が `packages/db/prisma/sql/000_roles.sql` を
#    そのまま実行するために要る（あの SQL は psql の `-v` 変数と `\gexec` を使う唯一のロール定義であり、
#    別の手段で書き写さない）。
#
# 🔴 本番（`production`）は設計どおり AWS であり、この Dockerfile は `demo` 専用である
#    （`docs/dev-plan.md` §8 の 2026-09-25 / `CLAUDE.md` §11）。

FROM node:24-bookworm-slim

# - postgresql-client: 000_roles.sql の適用（pre-deploy）
# - openssl:           Prisma のクエリエンジンが要求する
# - ca-certificates:   PostgreSQL への TLS 接続（`sslmode=require` は全環境で必須）
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# 🔴 依存の解決に必要なファイルを先に入れてレイヤを効かせる（ソース変更だけの再デプロイでは
#    `pnpm install` をやり直さない）。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/ai/package.json ./packages/ai/
COPY packages/config/package.json ./packages/config/
COPY packages/connectors/package.json ./packages/connectors/
COPY packages/db/package.json ./packages/db/
COPY packages/domain/package.json ./packages/domain/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/ui/package.json ./packages/ui/

# 🔴 `--prod=false`: イメージの NODE_ENV が production でも devDependencies を落とさない
#    （`tsc` / `prisma` / `next` はビルドに要る）。
RUN pnpm install --frozen-lockfile --prod=false

COPY . .

# 🔴 `@ses/db` → `@ses/worker` → `@ses/web` の順（`...` で依存パッケージも含めて作る）。
#    `next build` は起動時検証（`packages/config`）を走らせないので、ビルド時にアプリの環境変数は要らない。
RUN pnpm --filter '@ses/db...' --filter '@ses/worker...' --filter '@ses/web...' run build

ENV NODE_ENV=production

# 起動は `SES_RAILWAY_ROLE` で分岐する（web = next start / worker = dist/main.js）。
# 🔴 未設定・不正値では起動を失敗させる（既定で web に倒さない）。
CMD ["node", "scripts/railway-start.mjs"]
