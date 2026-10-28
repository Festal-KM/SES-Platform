// 同一アカウントの承認によって、他環境のリソースへ接続できるようにならないことを検査する。
import { describe, expect, it } from 'vitest';
import { loadAppEnv } from './load-env.js';
import { EnvValidationError } from './errors.js';
import { buildValidEnv } from './testing/fixtures.js';

function sharedEnv(kind: 'development' | 'demo' | 'production') {
  const account = '999999999999';
  const region = 'ap-northeast-1';
  const prefix = `ses-platform-${kind}`;
  const host = kind === 'development' ? 'localhost' : `${prefix}-db.abcdefgh.${region}.rds.amazonaws.com`;
  return buildValidEnv(kind, {
    AWS_ISOLATION_MODE: 'resource', AWS_ACCOUNT_ID: account, AWS_ACCOUNT_ID_EXPECTED_PRODUCTION: account,
    AWS_REGION: region, S3_REGION: region,
    S3_BUCKET: `${prefix}-files-${account}-${region}`,
    S3_KMS_KEY_ID: `arn:aws:kms:${region}:${account}:alias/${prefix}-storage`,
    SES_EVENT_TOPIC_ARN: `arn:aws:sns:${region}:${account}:${prefix}-events`, SES_CONFIGURATION_SET: prefix,
    DATABASE_URL: `postgresql://app_tenant:dummy@${host}:5432/ses_platform?sslmode=require`,
    PLATFORM_DATABASE_URL: `postgresql://app_platform:dummy@${host}:5432/ses_platform?sslmode=require`,
    PLATFORM_WRITE_DATABASE_URL: `postgresql://app_platform_write:dummy@${host}:5432/ses_platform?sslmode=require`,
    REDIS_URL: kind === 'development' ? 'redis://localhost:6379' : `rediss://master.${prefix}-cache.abcdef.apne1.cache.amazonaws.com:6379`,
  });
}

function rejectedVariable(input: Record<string, string | undefined>, variable: string) {
  let caught: unknown;
  try { loadAppEnv(input); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(EnvValidationError);
  expect((caught as EnvValidationError).issues.map((issue) => issue.variable)).toContain(variable);
}

describe('同一AWSアカウントでも環境別の接続先を強制する', () => {
  it('AWS開発の公開HTTPS画面は固定資格情報なしで自環境S3に接続する', () => {
    const input = { ...sharedEnv('development'), APP_URL: 'https://dev-es.bizorch.com', S3_ENDPOINT: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined };
    expect(loadAppEnv(input).S3_ENDPOINT).toBeUndefined();
    rejectedVariable({ ...input, S3_ACCESS_KEY_ID: 'fixed-key' }, 'S3_ACCESS_KEY_ID');
    rejectedVariable({ ...input, APP_URL: 'http://dev-es.bizorch.com' }, 'APP_URL');
    rejectedVariable({ ...input, S3_BUCKET: sharedEnv('production').S3_BUCKET }, 'S3_BUCKET');
  });
  it('従来の開発環境のS3互換サービス設定は省略できない', () => {
    rejectedVariable(buildValidEnv('development', { S3_ENDPOINT: undefined }), 'S3_ENDPOINT');
  });
  it.each(['development', 'demo', 'production'] as const)('%sの専用リソースなら起動可能', (kind) => {
    expect(loadAppEnv(sharedEnv(kind)).AWS_ISOLATION_MODE).toBe('resource');
  });

  it('未指定時は従来のアカウント分離を維持し、本番ID一致を拒否する', () => {
    expect(loadAppEnv(buildValidEnv('development')).AWS_ISOLATION_MODE).toBe('account');
    rejectedVariable({ ...sharedEnv('development'), AWS_ISOLATION_MODE: undefined }, 'AWS_ACCOUNT_ID');
  });

  it.each([
    ['S3_BUCKET', 'ses-platform-production-files-999999999999-ap-northeast-1'],
    ['S3_KMS_KEY_ID', 'arn:aws:kms:ap-northeast-1:999999999999:alias/ses-platform-production-storage'],
    ['SES_EVENT_TOPIC_ARN', 'arn:aws:sns:ap-northeast-1:999999999999:ses-platform-production-events'],
    ['SES_CONFIGURATION_SET', 'ses-platform-production'],
    ['DATABASE_URL', 'postgresql://app_tenant:dummy@ses-platform-production-db.abc.ap-northeast-1.rds.amazonaws.com/ses_platform?sslmode=require'],
    ['PLATFORM_DATABASE_URL', 'postgresql://app_platform:dummy@ses-platform-production-db.abc.ap-northeast-1.rds.amazonaws.com/ses_platform?sslmode=require'],
    ['PLATFORM_WRITE_DATABASE_URL', 'postgresql://app_platform_write:dummy@ses-platform-production-db.abc.ap-northeast-1.rds.amazonaws.com/ses_platform?sslmode=require'],
    ['REDIS_URL', 'rediss://master.ses-platform-production-cache.abc.apne1.cache.amazonaws.com:6379'],
  ])('デモに本番の%sを混ぜると拒否', (variable, value) => {
    rejectedVariable({ ...sharedEnv('demo'), [variable]: value }, variable);
  });

  it.each([
    ['AWS_ACCOUNT_ID', '100000000002'], ['S3_REGION', 'us-east-1'],
    ['DATABASE_URL', 'postgresql://postgres:dummy@ses-platform-demo-db.abc.ap-northeast-1.rds.amazonaws.com/ses_platform?sslmode=require'],
    ['DATABASE_URL', 'postgresql://app_tenant:dummy@ses-platform-demo-db.attacker.invalid/ses_platform?sslmode=require'],
    ['DATABASE_URL', 'postgresql://app_tenant:dummy@localhost/ses_platform?sslmode=require'],
    ['REDIS_URL', 'redis://master.ses-platform-demo-cache.abc.apne1.cache.amazonaws.com:6379'],
    ['REDIS_URL', 'rediss://master.ses-platform-demo-cache.attacker.invalid:6379'],
    ['S3_ENDPOINT', 'https://s3.ap-northeast-1.amazonaws.com'],
    ['S3_ACCESS_KEY_ID', 'dummy'], ['S3_SECRET_ACCESS_KEY', 'dummy'],
    ['SEED_DATABASE_URL', 'postgresql://postgres:dummy@localhost/ses_platform?sslmode=require'],
    ['APP_URL', 'http://demo.example.com'],
  ])('混在・権限過剰・TLSなしを拒否: %s', (variable, value) => {
    rejectedVariable({ ...sharedEnv('demo'), [variable]: value }, variable);
  });

  it('開発のS3互換サービスを他環境へ向けられない', () => {
    rejectedVariable({ ...sharedEnv('development'), S3_ENDPOINT: 'http://production.example.com:9000' }, 'S3_ENDPOINT');
    rejectedVariable({ ...sharedEnv('development'), S3_ENDPOINT: 'file://localhost/objects' }, 'S3_ENDPOINT');
  });

  it('本番もデモの保存先を使えず、モックや本番以外の鍵も許可しない', () => {
    rejectedVariable({ ...sharedEnv('production'), S3_BUCKET: sharedEnv('demo').S3_BUCKET }, 'S3_BUCKET');
    rejectedVariable({ ...sharedEnv('production'), MALWARE_SCANNER: 'mock' }, 'MALWARE_SCANNER');
    rejectedVariable({ ...sharedEnv('demo'), STRIPE_SECRET_KEY: 'sk_live_test' }, 'STRIPE_SECRET_KEY');
  });

  it.each(['staging', 'sandbox'] as const)('未承認の%sはモード指定で迂回できない', (kind) => {
    rejectedVariable(buildValidEnv(kind, { AWS_ISOLATION_MODE: 'resource' }), 'AWS_ISOLATION_MODE');
  });

  it('不正URLでも通常の検証エラーにし、秘密値をエラーへ出さない', () => {
    const input = { ...sharedEnv('demo'), DATABASE_URL: 'invalid-private-password', REDIS_URL: 'invalid-redis-password' };
    try {
      loadAppEnv(input);
      throw new Error('起動してはいけない');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(JSON.stringify(error)).not.toContain('invalid-private-password');
      expect(JSON.stringify(error)).not.toContain('invalid-redis-password');
    }
  });
});
