#!/usr/bin/env bash
# docker/postgres/initdb/000-roles.sh
# T-01-05（docs/sprints/SP-01-bootstrap.md）: packages/db/prisma/sql/000_roles.sql
# （docs/05 §4.2 の 5 ロールの唯一の定義）を、ローカル docker-compose の初回起動時に適用する。
#
# 🔴 ロール名・属性はここに書かない。packages/db/prisma/sql/000_roles.sql が唯一の真実であり、
#    tests/isolation/support/postgres.ts（Testcontainers）も同じファイルを実行する。
#
# 🔴 ここで使うパスワードはローカル docker-compose 専用のダミー値であり、.env.example の
#    POSTGRES_PASSWORD / AUTH_SECRET と同じ扱い（ローカル docker ネットワークの外に出ない。
#    本番・sandbox・staging には流用しない）。.env で APP_*_PASSWORD を上書きできる。
#
# 公式 postgres イメージの docker-entrypoint-initdb.d は *.sql 未満のファイルを
# docker_process_init_files() 経由で実行する（*.sh は実行可能なら子プロセス、そうでなければ
# source される。source された場合に子プロセスへ環境変数を明示的に渡す必要はないが、
# psql 呼び出し自体は独立プロセスなので POSTGRES_USER / POSTGRES_DB をここで明示する）。
set -Eeuo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_migrator_password="${APP_MIGRATOR_PASSWORD:-app_migrator_dev_password}" \
  -v app_tenant_password="${APP_TENANT_PASSWORD:-app_tenant_dev_password}" \
  -v app_platform_password="${APP_PLATFORM_PASSWORD:-app_platform_dev_password}" \
  -v app_platform_write_password="${APP_PLATFORM_WRITE_PASSWORD:-app_platform_write_dev_password}" \
  -f /opt/ses/000_roles.sql
