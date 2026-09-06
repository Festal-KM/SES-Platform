// packages/config/src/testing/fixtures.ts
// テスト専用のダミー値（実際のシークレットではない）。packages/config 自身のユニットテストに加え、
// 将来 packages/connectors 等が「妥当な AppEnv」を必要とするテストを書くときにも再利用できるよう
// `@ses/config/testing` サブパスからのみ取得する（`index.ts` からは export しない。package.json の
// `exports` で隔離し、本番相当の値をアプリコードが組み立てられる経路にしない）。
// docs/05 §13.2「E2E が使うモックと同一実装」と同じ発想 — 妥当な env の組み立て方を複数箇所で書き直さない。

import { APP_ENV_KINDS, type AppEnvKind } from '../app-env.js';

// openssl / node crypto で生成したダミー値。実運用のシークレットではない。
const FIXTURE_AUTH_SECRET = 'XVI+WLnVyA4kDrMxLUAVXo893KM2xHSvXs/IZxSVB9c=';
const FIXTURE_AUTH_PLATFORM_SECRET = '+MMLc5P8ZQVPbXPXK8y+1HFpOKUXKo9mvlibAdUoN9o=';
const FIXTURE_TOKEN_ENCRYPTION_KEY = '8vXOfnnxRTHs5rgc9Yhe/9V5TaZ3q5p2JNYBoPUlSPM=';
const FIXTURE_ANON_REFERENCE_HMAC_SECRET = '3vOoeLD86dnx8pKPyB4Svp5ulhm9aM3W9ZM5aLzow3E=';
const FIXTURE_WEBHOOK_PATH_SECRET = 'kUYTwo7tc6u07HTEAUbUBk4s+h+QpAa1NUHeK5E+Y4Y=';
const FIXTURE_GUARDDUTY_WEBHOOK_HMAC_SECRET = 'aFEbwtLtjA7iVuwT7yE4ZbEqmuUYJDRPXFwbSCzsO2A=';

const FIXTURE_AWS_ACCOUNT_ID_EXPECTED_PRODUCTION = '999999999999';

type EnvRecord = Record<string, string>;

const common: EnvRecord = {
  REDIS_URL: 'redis://localhost:6379',

  AUTH_SECRET: FIXTURE_AUTH_SECRET,
  AUTH_PLATFORM_SECRET: FIXTURE_AUTH_PLATFORM_SECRET,
  TOKEN_ENCRYPTION_KEY: FIXTURE_TOKEN_ENCRYPTION_KEY,
  TOKEN_ENCRYPTION_KEY_ID: 'k1',
  ANON_REFERENCE_HMAC_SECRET: FIXTURE_ANON_REFERENCE_HMAC_SECRET,
  WEBHOOK_PATH_SECRET: FIXTURE_WEBHOOK_PATH_SECRET,
  GUARDDUTY_WEBHOOK_HMAC_SECRET: FIXTURE_GUARDDUTY_WEBHOOK_HMAC_SECRET,

  ANTHROPIC_MONTHLY_SPEND_CAP_USD: '100',
  AI_DAILY_COST_LIMIT_USD_DEFAULT: '5',

  AWS_REGION: 'ap-northeast-1',
  AWS_ACCOUNT_ID_EXPECTED_PRODUCTION: FIXTURE_AWS_ACCOUNT_ID_EXPECTED_PRODUCTION,
  SES_DEFAULT_FROM_ADDRESS: 'no-reply@example.com',
  SES_CONFIGURATION_SET: 'ses-platform-test',
  SES_EVENT_TOPIC_ARN: 'arn:aws:sns:ap-northeast-1:100000000001:ses-platform-test-events',
  SES_GLOBAL_RATE_PER_SECOND: '14',

  S3_BUCKET: 'ses-platform-test',
  S3_REGION: 'ap-northeast-1',

  SCHEDULER_TIMEZONE: 'Asia/Tokyo',
};

const perKind: Record<AppEnvKind, EnvRecord> = {
  development: {
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'development',
    // T-01-05: development も他環境と同じ検証を受ける（docs/05 §4.2 / §13.4 規則 3・4 の
    // development 例外解除）。ロール別に別値・sslmode=require・MIGRATION_DATABASE_URL 未設定。
    DATABASE_URL: 'postgresql://app_tenant:pw@localhost:5432/ses_platform?sslmode=require',
    PLATFORM_DATABASE_URL: 'postgresql://app_platform:pw@localhost:5432/ses_platform?sslmode=require',
    // 🔴 T-03-07: 管理平面の書き込みロール（docs/05 §4.2）。3 本ともロール別に別値。
    PLATFORM_WRITE_DATABASE_URL:
      'postgresql://app_platform_write:pw@localhost:5432/ses_platform?sslmode=require',
    AWS_ACCOUNT_ID: '100000000001',
    MALWARE_SCANNER: 'clamav',
    CLAMAV_HOST: 'localhost',
    CLAMAV_PORT: '3310',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'ses_dev_minio',
    S3_SECRET_ACCESS_KEY: 'ses_dev_minio_secret',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: 'true',
    SENTRY_ENVIRONMENT: 'development',
  },
  demo: {
    APP_URL: 'https://demo.example.com',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://ses:pw@demo-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_DATABASE_URL: 'postgresql://ses_platform:pw@demo-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_WRITE_DATABASE_URL:
      'postgresql://ses_platform_write:pw@demo-db.internal:5432/ses_platform?sslmode=require',
    AWS_ACCOUNT_ID: '100000000002',
    MALWARE_SCANNER: 'mock',
    SENTRY_DSN: 'https://example@o0.ingest.sentry.io/1',
    SENTRY_ENVIRONMENT: 'demo',
    MAIL_PROVIDER_DAILY_QUOTA: '200',
  },
  sandbox: {
    APP_URL: 'https://sandbox.example.com',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://ses:pw@sandbox-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_DATABASE_URL: 'postgresql://ses_platform:pw@sandbox-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_WRITE_DATABASE_URL:
      'postgresql://ses_platform_write:pw@sandbox-db.internal:5432/ses_platform?sslmode=require',
    AWS_ACCOUNT_ID: '100000000003',
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    MALWARE_SCANNER: 'guardduty',
    SENTRY_DSN: 'https://example@o0.ingest.sentry.io/2',
    SENTRY_ENVIRONMENT: 'sandbox',
    S3_KMS_KEY_ID: 'arn:aws:kms:ap-northeast-1:100000000003:key/test',
    MAIL_PROVIDER_DAILY_QUOTA: '200',
  },
  staging: {
    APP_URL: 'https://staging.example.com',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://ses:pw@staging-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_DATABASE_URL: 'postgresql://ses_platform:pw@staging-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_WRITE_DATABASE_URL:
      'postgresql://ses_platform_write:pw@staging-db.internal:5432/ses_platform?sslmode=require',
    AWS_ACCOUNT_ID: '100000000004',
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    MALWARE_SCANNER: 'guardduty',
    SENTRY_DSN: 'https://example@o0.ingest.sentry.io/3',
    SENTRY_ENVIRONMENT: 'staging',
    MAIL_PROVIDER_DAILY_QUOTA: '10000',
  },
  production: {
    APP_URL: 'https://app.example.com',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://ses:pw@prod-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_DATABASE_URL: 'postgresql://ses_platform:pw@prod-db.internal:5432/ses_platform?sslmode=require',
    PLATFORM_WRITE_DATABASE_URL:
      'postgresql://ses_platform_write:pw@prod-db.internal:5432/ses_platform?sslmode=require',
    AWS_ACCOUNT_ID: FIXTURE_AWS_ACCOUNT_ID_EXPECTED_PRODUCTION,
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    MALWARE_SCANNER: 'guardduty',
    SENTRY_DSN: 'https://example@o0.ingest.sentry.io/4',
    SENTRY_ENVIRONMENT: 'production',
    S3_KMS_KEY_ID: 'arn:aws:kms:ap-northeast-1:999999999999:key/test',
    MAIL_PROVIDER_DAILY_QUOTA: '10000',
  },
};

/**
 * `APP_ENV=kind` のときに envSchema を必ず通過する最小限の env を組み立てる。
 * `overrides` で個別のフィールドを上書き・削除（`undefined` を渡す）してテストケースを作る。
 */
export function buildValidEnv(
  kind: AppEnvKind,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: kind,
    ...common,
    ...perKind[kind],
    ...overrides,
  };
}

export function allAppEnvKinds(): readonly AppEnvKind[] {
  return APP_ENV_KINDS;
}
