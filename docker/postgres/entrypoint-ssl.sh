#!/usr/bin/env bash
# docker/postgres/entrypoint-ssl.sh
# T-01-05（docs/sprints/SP-01-bootstrap.md）: development でも DATABASE_URL /
# PLATFORM_DATABASE_URL に sslmode=require を要求する（docs/05 §4.2 / §13.4 規則 4 の
# development 例外解除）ため、ローカルの docker-compose PostgreSQL にも TLS を有効化する。
#
# 🔴 自己署名証明書をコンテナ起動のたびに生成する（openssl は postgres:17-bookworm に同梱済み。
#    新規依存の追加ではない）。秘密鍵をリポジトリに置かない。クライアント側は sslmode=require
#    （証明書検証なし・暗号化のみ）で接続するため、起動のたびにフィンガープリントが変わっても
#    問題にならない。
set -Eeuo pipefail

CERT_DIR=/var/lib/postgresql/certs
mkdir -p "$CERT_DIR"

# 🔴 ses_postgres_data ボリューム配下ではない（PGDATA と同じパスに証明書を置くと、
#    initdb が「空でないディレクトリ」として初期化を拒否する）。このディレクトリはコンテナの
#    書き込み可能レイヤーであり docker compose down で消えるが、自己署名証明書は
#    起動のたびに再生成すればよいため永続化しない（クライアントは検証しない）。
if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  openssl req -new -x509 -days 3650 -nodes -subj "/CN=localhost" \
    -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" 2>/dev/null
fi

# PostgreSQL は秘密鍵のパーミッションが緩いと起動を拒否する。
chmod 600 "$CERT_DIR/server.key"
chown -R postgres:postgres "$CERT_DIR"

# 🔴 ssl=on は「TLS を受け付け可能にする」だけであり、平文接続を禁止しない
#    （pg_hba.conf を hostssl に変えていないため）。既存のヘルスチェック（pg_isready）や
#    T-01-02 のスモークテスト（docker compose exec 経由の psql。ローカルソケット）は
#    影響を受けない。DATABASE_URL / PLATFORM_DATABASE_URL 側が sslmode=require を
#    指定することで、アプリからの接続だけが暗号化を要求する。
exec docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_cert_file="$CERT_DIR/server.crt" \
  -c ssl_key_file="$CERT_DIR/server.key"
