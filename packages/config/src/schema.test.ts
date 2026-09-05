// packages/config/src/schema.test.ts
// docs/05 §13.4 / SP-01 T-01-03 完了判定:
//   1. production でモックが選ばれたら起動失敗
//   2. 非本番に本番の識別子（AWS アカウント ID 等）があれば起動失敗
//   3. APP_ENV の 5 値それぞれで妥当な入力が通ること
// に加え、検証エラーが全件列挙されること / 値を漏らさないことを確認する。

import { describe, expect, it } from 'vitest';
import { EnvValidationError } from './errors.js';
import { loadAppEnv } from './load-env.js';
import { allAppEnvKinds, buildValidEnv } from './testing/fixtures.js';

describe('envSchema / loadAppEnv — 正常系（APP_ENV の 5 値）', () => {
  for (const kind of allAppEnvKinds()) {
    it(`APP_ENV=${kind} の妥当な env を検証できる`, () => {
      const env = loadAppEnv(buildValidEnv(kind));
      expect(env.APP_ENV).toBe(kind);
    });
  }
});

describe('🔴 メール送信の上限（CLAUDE.md §3.4 / docs/05 §8.7 / F-027 AC-2）', () => {
  it('🔴 既定値は 1 テナント 1 日 500 通 / 1 分 30 通（ハードコードせず設定で持つ）', () => {
    const env = loadAppEnv(buildValidEnv('development'));
    expect(env.EMAIL_DAILY_LIMIT_PER_TENANT).toBe(500);
    expect(env.EMAIL_MINUTE_LIMIT_PER_TENANT).toBe(30);
  });

  it('プランごとの上書き（環境変数で別の値）を受け付ける', () => {
    const env = loadAppEnv(
      buildValidEnv('development', { EMAIL_DAILY_LIMIT_PER_TENANT: '1000' }),
    );
    expect(env.EMAIL_DAILY_LIMIT_PER_TENANT).toBe(1000);
  });
});

describe('🔴 SES のイベント通知トピック（T-04-03 / docs/05 §8.5）', () => {
  it('🔴 必須である（未設定を許すと「検証しない」fail-open になる）', () => {
    const input = buildValidEnv('development');
    delete input.SES_EVENT_TOPIC_ARN;
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it.each(['not-an-arn', 'arn:aws:sns:ap-northeast-1:12345:topic', 'arn:aws:sqs:ap-northeast-1:100000000001:q'])(
    'ARN の形が不正なら起動失敗（%s）',
    (value) => {
      expect(() => loadAppEnv(buildValidEnv('development', { SES_EVENT_TOPIC_ARN: value }))).toThrow(
        EnvValidationError,
      );
    },
  );
});

describe('🔴 production でモック実装が選ばれたら起動失敗（NFR-ENV-3 / F-022 AC-5）', () => {
  it('MALWARE_SCANNER=mock は production の型として選べず、パース自体が失敗する', () => {
    const input = buildValidEnv('production', { MALWARE_SCANNER: 'mock' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
    try {
      loadAppEnv(input);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.some((issue) => issue.variable === 'MALWARE_SCANNER')).toBe(true);
    }
  });

  it('「未設定ならモックにフォールバック」は存在しない: production で MALWARE_SCANNER を省略しても mock にならず失敗する', () => {
    const input = buildValidEnv('production', { MALWARE_SCANNER: undefined });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });
});

describe('🔴 非本番に本番の API キー・識別子があれば起動失敗（NFR-ENV-4）', () => {
  it('development の AWS_ACCOUNT_ID が本番アカウント ID と一致すると失敗する', () => {
    const input = buildValidEnv('development', { AWS_ACCOUNT_ID: '999999999999' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('staging の AWS_ACCOUNT_ID が本番アカウント ID と一致すると失敗する', () => {
    const input = buildValidEnv('staging', { AWS_ACCOUNT_ID: '999999999999' });
    let caught: unknown;
    try {
      loadAppEnv(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).issues.some((i) => i.variable === 'AWS_ACCOUNT_ID')).toBe(true);
  });

  it('production は自身の AWS_ACCOUNT_ID が期待値と一致していても失敗しない', () => {
    const env = loadAppEnv(buildValidEnv('production'));
    expect(env.AWS_ACCOUNT_ID).toBe(env.AWS_ACCOUNT_ID_EXPECTED_PRODUCTION);
  });

  it('非本番で STRIPE_SECRET_KEY が sk_live_ だと失敗する', () => {
    const input = buildValidEnv('staging', { STRIPE_SECRET_KEY: 'sk_live_abc123' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('非本番で STRIPE_SECRET_KEY が sk_test_ なら通る', () => {
    const env = loadAppEnv(buildValidEnv('staging', { STRIPE_SECRET_KEY: 'sk_test_abc123' }));
    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_abc123');
  });

  it('production で STRIPE_SECRET_KEY が sk_test_ だと失敗する', () => {
    const input = buildValidEnv('production', { STRIPE_SECRET_KEY: 'sk_test_abc123' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('非本番で DOCUSIGN_OAUTH_BASE_URL が本番エンドポイントだと失敗する', () => {
    const input = buildValidEnv('sandbox', { DOCUSIGN_OAUTH_BASE_URL: 'https://account.docusign.com' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('production で APP_URL が https:// でなければ失敗する', () => {
    const input = buildValidEnv('production', { APP_URL: 'http://app.example.com' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  // code-reviewer 指摘 1: production + ESIGN_PROVIDER_DEFAULT=mock が起動に成功していた
  // （修正前は commonShape の 'mock' を含む union がそのまま production 枝にも及んでいた）。
  it('production で ESIGN_PROVIDER_DEFAULT=mock は型として選べず失敗する', () => {
    const input = buildValidEnv('production', { ESIGN_PROVIDER_DEFAULT: 'mock' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
    try {
      loadAppEnv(input);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.some((issue) => issue.variable === 'ESIGN_PROVIDER_DEFAULT')).toBe(true);
    }
  });

  it('production で ESIGN_PROVIDER_DEFAULT を省略すると既定値 docusign になる（docs/03 §6.6）', () => {
    const env = loadAppEnv(buildValidEnv('production'));
    expect(env.ESIGN_PROVIDER_DEFAULT).toBe('docusign');
  });

  // code-reviewer 指摘 2: 非本番で ESIGN_API_BASE_URL に本番 DocuSign URL を設定しても素通りしていた。
  it('非本番で ESIGN_API_BASE_URL が本番 DocuSign のホスト（*.docusign.net）だと失敗する', () => {
    const input = buildValidEnv('staging', { ESIGN_API_BASE_URL: 'https://na3.docusign.net/restapi' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
    try {
      loadAppEnv(input);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.some((issue) => issue.variable === 'ESIGN_API_BASE_URL')).toBe(true);
    }
  });

  it('非本番で ESIGN_API_BASE_URL が apex ドメイン docusign.net だと失敗する', () => {
    const input = buildValidEnv('staging', { ESIGN_API_BASE_URL: 'https://docusign.net/restapi' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('非本番で ESIGN_API_BASE_URL が demo.docusign.net（サンドボックス）なら通る', () => {
    const env = loadAppEnv(buildValidEnv('staging', { ESIGN_API_BASE_URL: 'https://demo.docusign.net/restapi' }));
    expect(env.ESIGN_API_BASE_URL).toBe('https://demo.docusign.net/restapi');
  });

  it('production で ESIGN_API_BASE_URL が本番 DocuSign のホストでも失敗しない', () => {
    const env = loadAppEnv(buildValidEnv('production', { ESIGN_API_BASE_URL: 'https://na3.docusign.net/restapi' }));
    expect(env.ESIGN_API_BASE_URL).toBe('https://na3.docusign.net/restapi');
  });
});

describe('SCHEDULER_TIMEZONE は z.literal("Asia/Tokyo") で固定する', () => {
  it('Asia/Tokyo 以外の値は拒否する', () => {
    const input = buildValidEnv('development', { SCHEDULER_TIMEZONE: 'UTC' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('Asia/Tokyo は許可する', () => {
    const env = loadAppEnv(buildValidEnv('development'));
    expect(env.SCHEDULER_TIMEZONE).toBe('Asia/Tokyo');
  });
});

describe('development も他環境と同じ DB 接続の検証を受ける（T-01-05。docs/05 §4.2 / §13.4 規則 3・4 の development 例外解除）', () => {
  it('development は DATABASE_URL の sslmode=disable を拒否する（sslmode=require が必須）', () => {
    const input = buildValidEnv('development', {
      DATABASE_URL: 'postgresql://app_tenant:pw@localhost:5432/ses_platform?sslmode=disable',
    });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('development は sslmode=require の DATABASE_URL を許容する', () => {
    const env = loadAppEnv(buildValidEnv('development'));
    expect(env.DATABASE_URL).toContain('sslmode=require');
  });

  it('staging は sslmode=disable を拒否する（development と同じ規則）', () => {
    const input = buildValidEnv('staging', {
      DATABASE_URL: 'postgresql://ses:pw@staging-db.internal:5432/ses_platform?sslmode=disable',
    });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('development は PLATFORM_DATABASE_URL === DATABASE_URL を拒否する', () => {
    const env = buildValidEnv('development');
    const input = buildValidEnv('development', { PLATFORM_DATABASE_URL: env.DATABASE_URL });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('staging は PLATFORM_DATABASE_URL === DATABASE_URL を拒否する（development と同じ規則）', () => {
    const input = buildValidEnv('staging', {
      PLATFORM_DATABASE_URL: 'postgresql://ses:pw@staging-db.internal:5432/ses_platform?sslmode=require',
    });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('development / demo / sandbox / staging / production のいずれも実行時に MIGRATION_DATABASE_URL があると失敗する', () => {
    for (const kind of allAppEnvKinds()) {
      const input = buildValidEnv(kind, {
        MIGRATION_DATABASE_URL: 'postgresql://app_migrator:pw@db.internal:5432/ses_platform?sslmode=require',
      });
      expect(() => loadAppEnv(input), `APP_ENV=${kind}`).toThrow(EnvValidationError);
    }
  });

  it('development は MIGRATION_DATABASE_URL を省略すれば通る（未設定が既定）', () => {
    const env = loadAppEnv(buildValidEnv('development'));
    expect(env.MIGRATION_DATABASE_URL).toBeUndefined();
  });
});

describe('MALWARE_SCANNER=clamav のとき CLAMAV_HOST / CLAMAV_PORT が必須', () => {
  it('sandbox で clamav を選びつつ CLAMAV_HOST を省略すると失敗する', () => {
    const input = buildValidEnv('sandbox', { MALWARE_SCANNER: 'clamav', CLAMAV_HOST: undefined, CLAMAV_PORT: undefined });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('sandbox で clamav + CLAMAV_HOST/PORT を指定すれば通る', () => {
    const env = loadAppEnv(
      buildValidEnv('sandbox', { MALWARE_SCANNER: 'clamav', CLAMAV_HOST: 'clamav.internal', CLAMAV_PORT: '3310' }),
    );
    expect(env.MALWARE_SCANNER).toBe('clamav');
  });
});

describe('検証エラーの列挙と秘匿（docs/05 §13.4 規則 4 / 6）', () => {
  it('複数の問題があれば 1 件目で止めず全件 issues に列挙する', () => {
    // 🔴 意図的に crossFieldChecks（superRefine）側の違反を 2 つ同時に起こす。
    // フィールド単体の検証（AUTH_SECRET の形式など）が先に失敗すると、Zod は
    // superRefine 自体を実行しないため、crossFieldChecks が複数件を列挙できることを
    // 検証するにはフィールド単体では valid な入力のまま cross-field 違反を重ねる必要がある。
    const baseline = buildValidEnv('staging');
    const input = buildValidEnv('staging', {
      AWS_ACCOUNT_ID: '999999999999',
      AUTH_PLATFORM_SECRET: baseline.AUTH_SECRET,
    });
    let caught: unknown;
    try {
      loadAppEnv(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const variables = (caught as EnvValidationError).issues.map((issue) => issue.variable);
    expect(variables).toContain('AWS_ACCOUNT_ID');
    expect(variables).toContain('AUTH_PLATFORM_SECRET');
  });

  it('エラーメッセージに実際のシークレット値を含めない', () => {
    const secretValue = 'this-is-too-short-to-be-valid-base64-key';
    const input = buildValidEnv('development', { AUTH_SECRET: secretValue });
    let caught: unknown;
    try {
      loadAppEnv(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const message = (caught as EnvValidationError).message;
    expect(message).toContain('AUTH_SECRET');
    expect(message).not.toContain(secretValue);
  });
});

describe('AUTH_SECRET !== AUTH_PLATFORM_SECRET', () => {
  it('主平面と管理平面の署名鍵が同じ値だと失敗する', () => {
    const env = buildValidEnv('development');
    const input = buildValidEnv('development', { AUTH_PLATFORM_SECRET: env.AUTH_SECRET });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });
});

describe('SENTRY_ENVIRONMENT は APP_ENV と一致しなければならない', () => {
  it('不一致だと失敗する', () => {
    const input = buildValidEnv('staging', { SENTRY_ENVIRONMENT: 'production' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });
});

describe('S3 資格情報（MinIO 用）は staging / production では設定できない', () => {
  it('production で S3_ACCESS_KEY_ID を設定すると失敗する（IAM ロールで認証する）', () => {
    const input = buildValidEnv('production', { S3_ACCESS_KEY_ID: 'AKIAEXAMPLE' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });

  it('production で S3_FORCE_PATH_STYLE=true だと失敗する', () => {
    const input = buildValidEnv('production', { S3_FORCE_PATH_STYLE: 'true' });
    expect(() => loadAppEnv(input)).toThrow(EnvValidationError);
  });
});
