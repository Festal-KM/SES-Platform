#!/usr/bin/env node
// 初回の環境設定。秘密値を表示せず、認証・暗号鍵を更新時に再生成しない。
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { assertAccount, aws, ensureSecret, readSecret, stackOutputs, withJsonFile, ACCOUNT_ID, REGION, HOSTS } from './aws/common.mjs';
try {
  const [environment, ...rest] = process.argv.slice(2);
  if (!['demo', 'production'].includes(environment) || rest.length) throw new Error('使い方: node scripts/aws-runtime.mjs demo|production');
  assertAccount();
  const prefix = `ses-platform-${environment}`;
  const application = stackOutputs(`${prefix}-application`);
  const foundation = stackOutputs(`${prefix}-foundation`);
  const rolesArn = ensureSecret(`/${prefix}/roles`, () => Object.fromEntries(
    ['MIGRATOR', 'TENANT', 'PLATFORM', 'PLATFORM_WRITE'].map((role) => [`APP_${role}_PASSWORD`, randomBytes(24).toString('hex')])));
  const roles = readSecret(rolesArn);
  const existingArn = ensureSecret(`/${prefix}/runtime`, () => ({}));
  const existing = readSecret(existingArn);
  const defaults = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  const runtime = Object.fromEntries(Object.entries(defaults).filter(([key, value]) => value
    && !/^(POSTGRES_|APP_.*PASSWORD$|WIREFRAME_|OPENAI_|GEMINI_|S3MOCK_|MAILHOG_|SMTP_|CLAMAV_|S3_ENDPOINT$|S3_ACCESS_KEY_ID$|S3_SECRET_ACCESS_KEY$|REDIS_PORT$)/.test(key)));
  Object.assign(runtime, existing, {
    APP_ENV: environment, NODE_ENV: 'production', AWS_ISOLATION_MODE: 'resource', AWS_ACCOUNT_ID: ACCOUNT_ID,
    AWS_ACCOUNT_ID_EXPECTED_PRODUCTION: ACCOUNT_ID, AWS_REGION: REGION, S3_REGION: REGION,
    APP_URL: `https://${HOSTS[environment]}`, S3_BUCKET: foundation.FilesBucket,
    S3_KMS_KEY_ID: `arn:aws:kms:${REGION}:${ACCOUNT_ID}:alias/${prefix}-storage`, S3_FORCE_PATH_STYLE: 'false',
    SES_CONFIGURATION_SET: prefix, SES_EVENT_TOPIC_ARN: `arn:aws:sns:${REGION}:${ACCOUNT_ID}:${prefix}-events`,
    SES_DEFAULT_FROM_ADDRESS: 'no-reply@bizorch.com', SENTRY_ENVIRONMENT: environment, LOG_LEVEL: 'info',
    MALWARE_SCANNER: environment === 'demo' ? 'mock' : 'guardduty',
  });
  for (const key of ['AUTH_SECRET', 'AUTH_PLATFORM_SECRET', 'TOKEN_ENCRYPTION_KEY', 'ANON_REFERENCE_HMAC_SECRET', 'WEBHOOK_PATH_SECRET', 'GUARDDUTY_WEBHOOK_HMAC_SECRET']) {
    runtime[key] = existing[key] ?? randomBytes(32).toString('base64');
  }
  for (const [key, role, password] of [['DATABASE_URL', 'app_tenant', 'APP_TENANT_PASSWORD'], ['PLATFORM_DATABASE_URL', 'app_platform', 'APP_PLATFORM_PASSWORD'], ['PLATFORM_WRITE_DATABASE_URL', 'app_platform_write', 'APP_PLATFORM_WRITE_PASSWORD']]) {
    runtime[key] = `postgresql://${role}:${roles[password]}@${application.DatabaseHost}:5432/ses_platform?sslmode=require`;
  }
  runtime.REDIS_URL = `rediss://default:${readSecret(`/${prefix}/cache-token`).token}@${application.CacheHost}:6379`;
  if (environment === 'demo') {
    // DSNは公開の送信先識別子。共通プロジェクト内でenvironmentを分けて扱う。
    runtime.SENTRY_DSN = existing.SENTRY_DSN ?? readSecret('/ses-platform-production/external').SENTRY_DSN;
    runtime.ESIGN_PROVIDER_DEFAULT = 'mock'; runtime.ESIGN_ENABLED_PROVIDERS = 'mock';
    delete runtime.ANTHROPIC_API_KEY;
  } else {
    const external = readSecret('/ses-platform-production/external');
    for (const key of ['ANTHROPIC_API_KEY', 'SENTRY_DSN', 'SES_DEFAULT_FROM_ADDRESS']) {
      if (!external[key]) throw new Error(`本番の${key}が未設定です`);
      runtime[key] = external[key];
    }
    runtime.ESIGN_PROVIDER_DEFAULT = 'docusign'; runtime.ESIGN_ENABLED_PROVIDERS = 'docusign';
  }
  // 未使用のOpenAIキーと管理接続は実行タスクに渡さない。
  for (const key of Object.keys(runtime)) if (/PASSWORD|MIGRATION|SUPERUSER|SEED_DATABASE|^OPENAI_|^DB_ADMIN_/.test(key)) delete runtime[key];
  withJsonFile({ SecretId: existingArn, SecretString: JSON.stringify(runtime) }, (file) => aws(['secretsmanager', 'put-secret-value', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
  // 配備ロールにはキーの名前とARNだけ渡す。秘密値の取得はECS実行ロールに限定する。
  withJsonFile({ Name: `/ses-platform/${environment}/deployment`, Type: 'String', Overwrite: true,
    Value: JSON.stringify({ runtimeSecretArn: existingArn, runtimeKeys: Object.keys(runtime), rolesSecretArn: rolesArn, masterSecretArn: application.MasterSecretArn }) },
    (file) => aws(['ssm', 'put-parameter', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
  console.log(JSON.stringify({ environment, runtimeSecretArn: existingArn, rolesSecretArn: rolesArn, variableCount: Object.keys(runtime).length }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
