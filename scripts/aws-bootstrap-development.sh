#!/usr/bin/env bash
# AWS開発VMだけで実行。初期化済みデータと鍵は再生成しない。
set -euo pipefail
cd /workspaces/ses-platform
test "$(pwd -P)" = /workspaces/ses-platform
umask 077
export COMPOSE_PROGRESS=quiet
initialize=${1:-}
# 前回のソースにだけ存在するファイルを除去する。環境設定・DB・依存・キャッシュは対象外。
needs_initialize=$(python3 - <<'PY'
import json, pathlib
root = pathlib.Path('/workspaces/ses-platform').resolve()
current = json.loads((root / '.aws-source-manifest.json').read_text())
previous_file = root / '.aws-source-manifest.previous.json'
previous = json.loads(previous_file.read_text()) if previous_file.exists() else {}
for name in previous.keys() - current.keys():
    path = (root / name).resolve()
    if root not in path.parents or name.startswith('.env') or '/node_modules/' in name or '/.next/' in name:
        raise ValueError('Invalid source cleanup path')
    if path.is_file(): path.unlink()
changed = [name for name, digest in current.items() if previous.get(name) != digest]
print('yes' if not previous or any(name.startswith(('packages/', 'apps/worker/')) or name in ['package.json', 'pnpm-lock.yaml', 'scripts/aws-development-initialize.mjs'] for name in changed) else 'no')
PY
)
if [ ! -x /usr/local/lib/docker/cli-plugins/docker-compose ]; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL https://github.com/docker/compose/releases/download/v5.6.1/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
  printf '%s  %s\n' 47737f4236e6d3ccea7291995203f8f018058783b4c3a9469119811a0b5db8c0 /usr/local/lib/docker/cli-plugins/docker-compose | sha256sum -c -
  chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose
fi
if [ ! -f .env ]; then
  python3 - <<'PY'
import base64, pathlib, secrets
values = {}
for line in pathlib.Path('.env.example').read_text().splitlines():
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if value:
        values[key] = value
for key in ['AUTH_SECRET', 'AUTH_PLATFORM_SECRET', 'TOKEN_ENCRYPTION_KEY', 'ANON_REFERENCE_HMAC_SECRET', 'WEBHOOK_PATH_SECRET', 'GUARDDUTY_WEBHOOK_HMAC_SECRET']:
    values[key] = base64.b64encode(secrets.token_bytes(32)).decode()
for key in ['POSTGRES_PASSWORD', 'APP_MIGRATOR_PASSWORD', 'APP_TENANT_PASSWORD', 'APP_PLATFORM_PASSWORD', 'APP_PLATFORM_WRITE_PASSWORD']:
    values[key] = secrets.token_hex(24)
values.update(APP_ENV='development', NODE_ENV='development', AWS_ISOLATION_MODE='resource', AWS_ACCOUNT_ID='117425831827', AWS_ACCOUNT_ID_EXPECTED_PRODUCTION='117425831827', AWS_REGION='ap-northeast-1', S3_REGION='ap-northeast-1', S3_BUCKET='ses-platform-development-files-117425831827-ap-northeast-1', S3_KMS_KEY_ID='arn:aws:kms:ap-northeast-1:117425831827:alias/ses-platform-development-storage', SES_EVENT_TOPIC_ARN='arn:aws:sns:ap-northeast-1:117425831827:ses-platform-development-events', SES_CONFIGURATION_SET='ses-platform-development', SES_DEFAULT_FROM_ADDRESS='no-reply@bizorch.com', APP_URL='http://localhost:3000')
for key, role, password in [('DATABASE_URL','app_tenant','APP_TENANT_PASSWORD'), ('PLATFORM_DATABASE_URL','app_platform','APP_PLATFORM_PASSWORD'), ('PLATFORM_WRITE_DATABASE_URL','app_platform_write','APP_PLATFORM_WRITE_PASSWORD')]:
    values[key] = 'postgresql://%s:%s@127.0.0.1:5432/ses_platform?sslmode=require' % (role, values[password])
pathlib.Path('.env').write_text(''.join('%s=%s\n' % item for item in values.items()))
PY
fi
touch .runtime.env
chmod 600 .env .runtime.env
compose=(docker compose -f docker-compose.yml -f infra/aws/development.compose.yml)
"${compose[@]}" up -d postgres redis s3mock s3mock-init mailhog clamav
for attempt in $(seq 1 60); do
  if docker exec ses-postgres pg_isready -U ses >/dev/null 2>&1; then break; fi
  sleep 2
done
if [ "$initialize" = --initialize ] || [ "$needs_initialize" = yes ] || [ ! -d node_modules ]; then
  "${compose[@]}" stop web worker || true
  "${compose[@]}" --profile tools run --rm tools bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends postgresql-client >/dev/null && node scripts/aws-development-initialize.mjs'
fi
# Webコンテナの利用者だけにビルドキャッシュの書込みを許す。管理用.envはroot所有のまま保つ。
mkdir -p apps/web/.next
chown -R 1000:1000 apps/web/.next
"${compose[@]}" up -d web worker
echo 'AWS開発アプリを起動しました。SSMで3000番と9000番を転送して確認してください。'
