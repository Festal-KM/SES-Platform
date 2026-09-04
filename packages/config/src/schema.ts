// packages/config/src/schema.ts
// docs/03 §6.1〜§6.10 の環境変数表を入力とする Zod スキーマ。
// docs/05 §13.4「環境変数の検証」の設計（discriminatedUnion('APP_ENV', [...]) + superRefine）に従う。
//
// 🔴 規則（docs/05 §13.4 / docs/03 §6.10）:
//   1. production でモック実装が型として選べない（'mock' がその枝の union に無い）
//   2. 非本番で本番の識別子（AWS アカウント ID 一致 / sk_live_ / DocuSign 本番 URL 等）を検出したら失敗
//   3. 実行時（development を含む全環境）に MIGRATION_DATABASE_URL が設定されていたら失敗
//      （T-01-05 でロールが実在するようになったため development 例外を解除した。docs/05 §4.2 / §13.4 規則 3）
//   4. 検証エラーは「どの変数が、なぜ不正か」を全件列挙する（1 件目で止めない）
//   5. 検証結果に環境変数の値そのものを含めない
//
// 🔴 development の MALWARE_SCANNER は 'clamav' に固定する（'mock' は選ばせない）。
//    docs/03 §3.4-6「development / CI では ClamAV のコンテナを使う」が正（SP-01 T-01-03 申し送り 1）。

import { z } from 'zod';
import {
  base64AtLeastBytes,
  base64ExactBytes,
  csvOf,
  envBoolean,
  hasSslModeRequire,
  isDocusignProductionBaseUrl,
} from './primitives.js';

const ESIGN_PROVIDERS = ['docusign', 'cloudsign', 'gmosign', 'mock'] as const;
const ESIGN_PROVIDERS_NO_MOCK = ['docusign', 'cloudsign'] as const;

const meterEventNamesSchema = z.object({
  sheetParse: z.string().max(100),
  matchRationale: z.string().max(100),
  proposalDraft: z.string().max(100),
  renewalSummary: z.string().max(100),
});

/** JSON 文字列で渡される STRIPE_METER_EVENT_NAMES（Phase 3。未設定なら undefined のまま）。 */
const stripeMeterEventNames = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'JSON として解析できません' });
      return z.NEVER;
    }
  })
  .pipe(meterEventNamesSchema.optional());

// --- §6 共通項目（環境ごとの差分は各ブランチの .extend() で上書きする）--------------------

const commonShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_URL: z.string().url(),

  // §6.1 基盤
  DATABASE_URL: z.string().url(),
  PLATFORM_DATABASE_URL: z.string().url(),
  /**
   * 🔴 `app_platform_write` ロールの接続文字列（docs/05 §4.2 の「使う接続文字列」欄）。
   *    T-03-07（運営者認証）と T-03-08（`withPlatformWrite`）が使う。
   *    必須項目にする —— 未設定を許すと「管理平面が黙って動かない」状態が本番まで残る。
   */
  PLATFORM_WRITE_DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  // §6.2 認証・暗号
  AUTH_SECRET: base64AtLeastBytes(32),
  AUTH_PLATFORM_SECRET: base64AtLeastBytes(32),
  TOKEN_ENCRYPTION_KEY: base64ExactBytes(32),
  TOKEN_ENCRYPTION_KEY_ID: z.string().regex(/^k[0-9]+$/),
  TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().regex(/^k[0-9]+:.+$/).optional(),
  ANON_REFERENCE_HMAC_SECRET: base64AtLeastBytes(32),
  WEBHOOK_PATH_SECRET: base64AtLeastBytes(32),

  // §6.3 AI（Anthropic）— ANTHROPIC_API_KEY は環境ごとに必須/任意が変わるため各ブランチで定義
  ANTHROPIC_MODEL_DEFAULT: z.string().min(1).default('claude-sonnet-5'),
  ANTHROPIC_MODEL_CHEAP: z.string().min(1).default('claude-haiku-4-5-20251001'),
  ANTHROPIC_MONTHLY_SPEND_CAP_USD: z.coerce.number().positive(),
  AI_DAILY_COST_LIMIT_USD_DEFAULT: z.coerce.number().positive(),

  // §6.4 メール（Amazon SES）
  AWS_REGION: z.string().min(1).default('ap-northeast-1'),
  AWS_ACCOUNT_ID: z.string().regex(/^\d{12}$/),
  AWS_ACCOUNT_ID_EXPECTED_PRODUCTION: z.string().regex(/^\d{12}$/),
  SES_DEFAULT_FROM_ADDRESS: z.string().email(),
  SES_CONFIGURATION_SET: z.string().max(64),
  EMAIL_DAILY_LIMIT_PER_TENANT: z.coerce.number().int().positive().default(500),
  EMAIL_MINUTE_LIMIT_PER_TENANT: z.coerce.number().int().positive().default(30),
  SES_GLOBAL_RATE_PER_SECOND: z.coerce.number().int().positive(),
  // development 専用（MailHog）。他環境では未設定のまま
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),

  // §6.5 ストレージ・スキャン
  S3_BUCKET: z.string().min(1),
  S3_KMS_KEY_ID: z.string().optional(),
  S3_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  SCAN_STALL_ALERT_MINUTES: z.coerce.number().int().positive().default(10),
  S3_REGION: z.string().min(1),
  S3_FORCE_PATH_STYLE: envBoolean(false),
  // development 専用（MinIO）。staging / production では設定できない（crossFieldChecks で検証）
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // §6.6 電子署名（Phase 3。現時点では未使用のため任意項目として置く）
  ESIGN_PROVIDER_DEFAULT: z.enum(ESIGN_PROVIDERS).optional(),
  ESIGN_ENABLED_PROVIDERS: csvOf(ESIGN_PROVIDERS),
  DOCUSIGN_INTEGRATION_KEY: z.string().uuid().optional(),
  DOCUSIGN_SECRET_KEY: z.string().min(1).optional(),
  DOCUSIGN_OAUTH_BASE_URL: z.enum(['https://account-d.docusign.com', 'https://account.docusign.com']).optional(),
  DOCUSIGN_REDIRECT_URI: z.string().url().optional(),
  DOCUSIGN_CONNECT_HMAC_ROTATION_ENABLED: envBoolean(true),
  ESIGN_API_BASE_URL: z.string().url().optional(),

  // §6.7 課金（Stripe。Phase 3。現時点では未使用のため任意項目として置く）
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  STRIPE_API_VERSION: z.string().optional(),
  STRIPE_METER_EVENT_NAMES: stripeMeterEventNames,

  // §6.8 監視・ログ
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // §6.9 スケジュール・上限
  SCHEDULER_TIMEZONE: z.literal('Asia/Tokyo'),
  EXPIRY_ALERT_DAYS_BEFORE: z.coerce.number().int().positive().default(60),
  PII_RETENTION_YEARS: z.coerce.number().int().positive().default(3),
  SANDBOX_TRIAL_DAYS: z.coerce.number().int().positive().default(30),
  TENANT_PURGE_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  QUOTA_WARNING_THRESHOLD_PERCENT: z.coerce.number().int().min(1).max(99).default(80),

  // docs/05 §13.4: 送信基盤全体の 24h 枠（宛先分類に依存しないグローバル上限）
  MAIL_PROVIDER_QUOTA_WARN_RATIO: z.coerce.number().min(0).max(1).default(0.8),
};

const base = z.object(commonShape);

const envUnion = z.discriminatedUnion('APP_ENV', [
    // --- development: ローカル docker-compose（T-01-02）。実装系は ClamAV 固定、送信系は mock ---
    base.extend({
      APP_ENV: z.literal('development'),
      ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
      MALWARE_SCANNER: z.literal('clamav'),
      CLAMAV_HOST: z.string().min(1),
      CLAMAV_PORT: z.coerce.number().int().positive(),
      SMTP_HOST: z.string().min(1),
      SMTP_PORT: z.coerce.number().int().positive(),
      S3_ENDPOINT: z.string().url(),
      S3_ACCESS_KEY_ID: z.string().min(1),
      S3_SECRET_ACCESS_KEY: z.string().min(1),
      MAIL_PROVIDER_DAILY_QUOTA: z.coerce.number().int().positive().default(200),
    }),

    // --- demo: 営業デモ専用。合成データのみ。すべて mock ---
    base.extend({
      APP_ENV: z.literal('demo'),
      ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
      MALWARE_SCANNER: z.literal('mock'),
      CLAMAV_HOST: z.string().optional(),
      CLAMAV_PORT: z.coerce.number().int().positive().optional(),
      SENTRY_DSN: z.string().url(),
      MAIL_PROVIDER_DAILY_QUOTA: z.coerce.number().int().positive().default(200),
    }),

    // --- sandbox: 見込み客の実データ。送信系は宛先分類で分岐（実装は packages/connectors 側） ---
    base.extend({
      APP_ENV: z.literal('sandbox'),
      ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
      MALWARE_SCANNER: z.enum(['guardduty', 'clamav']),
      CLAMAV_HOST: z.string().optional(),
      CLAMAV_PORT: z.coerce.number().int().positive().optional(),
      SENTRY_DSN: z.string().url(),
      S3_KMS_KEY_ID: z.string().min(1),
      // SES サンドボックス状態の 200 通 / 24h（docs/03 §3.2.4）
      MAIL_PROVIDER_DAILY_QUOTA: z.coerce.number().int().positive().default(200),
    }),

    // --- staging: リリース前検証。各サービスの sandbox / test モード ---
    base.extend({
      APP_ENV: z.literal('staging'),
      ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
      MALWARE_SCANNER: z.enum(['guardduty']),
      CLAMAV_HOST: z.string().optional(),
      CLAMAV_PORT: z.coerce.number().int().positive().optional(),
      SENTRY_DSN: z.string().url(),
      MAIL_PROVIDER_DAILY_QUOTA: z.coerce.number().int().positive(),
    }),

    // --- production: 🔴 モックを型として選べない ---
    base.extend({
      APP_ENV: z.literal('production'),
      ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
      MALWARE_SCANNER: z.enum(['guardduty']),
      CLAMAV_HOST: z.string().optional(),
      CLAMAV_PORT: z.coerce.number().int().positive().optional(),
      SENTRY_DSN: z.string().url(),
      S3_KMS_KEY_ID: z.string().min(1),
      // 🔴 production では 'mock' を型として選べない（docs/03 §6.6 の既定 'docusign' に倒す）。
      ESIGN_PROVIDER_DEFAULT: z.enum(ESIGN_PROVIDERS_NO_MOCK).default('docusign'),
      ESIGN_ENABLED_PROVIDERS: csvOf(ESIGN_PROVIDERS_NO_MOCK),
      DOCUSIGN_OAUTH_BASE_URL: z.literal('https://account.docusign.com').optional(),
      STRIPE_SECRET_KEY: z.string().startsWith('sk_live_').optional(),
      MAIL_PROVIDER_DAILY_QUOTA: z.coerce.number().int().positive(),
    }),
]);

type EnvUnionData = z.infer<typeof envUnion>;

/** `superRefine` のコールバックに渡される `ctx`（`addIssue` のみ使う）の正確な型。 */
type IssueSink = z.core.$RefinementCtx<EnvUnionData>;

function addIssue(ctx: IssueSink, variable: string, message: string): void {
  ctx.addIssue({ code: 'custom', path: [variable], message });
}

/**
 * discriminatedUnion の各ブランチだけでは表現できない、フィールド間の相互制約。
 * docs/05 §13.4 の `assertNonProdHasNoProdSecrets` に相当する（NFR-ENV-4 が中心）。
 * 🔴 途中で return せず、検出できたものは全件 addIssue する（規則 4）。
 */
function crossFieldChecks(data: EnvUnionData, ctx: IssueSink): void {
  const isProduction = data.APP_ENV === 'production';

  if (isProduction && !data.APP_URL.startsWith('https://')) {
    addIssue(ctx, 'APP_URL', 'production では https:// で始まる必要があります');
  }

  // NFR-ENV-4: 非本番に本番の識別子が紛れ込んでいないか
  if (!isProduction && data.AWS_ACCOUNT_ID === data.AWS_ACCOUNT_ID_EXPECTED_PRODUCTION) {
    addIssue(ctx, 'AWS_ACCOUNT_ID', '本番の AWS アカウント ID（AWS_ACCOUNT_ID_EXPECTED_PRODUCTION）と一致しています');
  }
  if (!isProduction && data.DOCUSIGN_OAUTH_BASE_URL === 'https://account.docusign.com') {
    addIssue(ctx, 'DOCUSIGN_OAUTH_BASE_URL', '本番の DocuSign エンドポイントは非本番環境で使用できません');
  }
  if (!isProduction && data.ESIGN_API_BASE_URL !== undefined && isDocusignProductionBaseUrl(data.ESIGN_API_BASE_URL)) {
    addIssue(
      ctx,
      'ESIGN_API_BASE_URL',
      '本番の DocuSign API ベース URL（*.docusign.net）は非本番環境で使用できません（demo.docusign.net のみ許可）',
    );
  }
  if (data.STRIPE_SECRET_KEY !== undefined) {
    const expectedPrefix = isProduction ? 'sk_live_' : 'sk_test_';
    if (!data.STRIPE_SECRET_KEY.startsWith(expectedPrefix)) {
      addIssue(ctx, 'STRIPE_SECRET_KEY', `${data.APP_ENV} では ${expectedPrefix} で始まる必要があります`);
    }
  }

  if (data.SENTRY_ENVIRONMENT !== data.APP_ENV) {
    addIssue(ctx, 'SENTRY_ENVIRONMENT', `APP_ENV（${data.APP_ENV}）と一致している必要があります`);
  }

  if (data.AUTH_SECRET === data.AUTH_PLATFORM_SECRET) {
    addIssue(ctx, 'AUTH_PLATFORM_SECRET', 'AUTH_SECRET と同じ値は使用できません（主平面 / 管理平面で別の鍵にする）');
  }

  // 🔴 T-01-05 でロールが実在するようになったため、development も他環境と同じ検証を受ける
  // （docs/05 §4.2 / §13.4 規則 3・4。development 例外の解除）。
  if (data.MIGRATION_DATABASE_URL !== undefined) {
    addIssue(ctx, 'MIGRATION_DATABASE_URL', '実行時環境には設定できません（app_migrator 専用。マイグレーション実行時のみ一時的に指定する）');
  }
  if (data.DATABASE_URL === data.PLATFORM_DATABASE_URL) {
    addIssue(ctx, 'PLATFORM_DATABASE_URL', 'DATABASE_URL と同じ値は使用できません');
  }
  // 🔴 T-03-07: 3 本ともロールが違う（app_tenant / app_platform / app_platform_write）。
  //    同じ値が入っていたら、意図した権限より広い接続でアプリが動くことになる。
  if (data.DATABASE_URL === data.PLATFORM_WRITE_DATABASE_URL) {
    addIssue(ctx, 'PLATFORM_WRITE_DATABASE_URL', 'DATABASE_URL と同じ値は使用できません');
  }
  if (data.PLATFORM_DATABASE_URL === data.PLATFORM_WRITE_DATABASE_URL) {
    addIssue(ctx, 'PLATFORM_WRITE_DATABASE_URL', 'PLATFORM_DATABASE_URL と同じ値は使用できません');
  }
  if (!hasSslModeRequire(data.DATABASE_URL)) {
    addIssue(ctx, 'DATABASE_URL', 'sslmode=require を含める必要があります');
  }
  if (!hasSslModeRequire(data.PLATFORM_DATABASE_URL)) {
    addIssue(ctx, 'PLATFORM_DATABASE_URL', 'sslmode=require を含める必要があります');
  }
  if (!hasSslModeRequire(data.PLATFORM_WRITE_DATABASE_URL)) {
    addIssue(ctx, 'PLATFORM_WRITE_DATABASE_URL', 'sslmode=require を含める必要があります');
  }

  if ((data.APP_ENV === 'staging' || isProduction) && (data.S3_ACCESS_KEY_ID !== undefined || data.S3_SECRET_ACCESS_KEY !== undefined)) {
    addIssue(ctx, 'S3_ACCESS_KEY_ID', 'staging / production では設定できません（IAM ロールで認証する。docs/03 §6.5）');
  }
  if (isProduction && data.S3_FORCE_PATH_STYLE === true) {
    addIssue(ctx, 'S3_FORCE_PATH_STYLE', 'production では true にできません（AWS S3 はバーチャルホスト形式）');
  }

  if (data.MALWARE_SCANNER === 'clamav' && (data.CLAMAV_HOST === undefined || data.CLAMAV_PORT === undefined)) {
    addIssue(ctx, 'CLAMAV_HOST', 'MALWARE_SCANNER=clamav のとき CLAMAV_HOST / CLAMAV_PORT の両方が必須です');
  }

  if (data.ESIGN_PROVIDER_DEFAULT !== undefined && data.ESIGN_ENABLED_PROVIDERS !== undefined) {
    // 🔴 型注釈での widening（`as` キャストではない）: production は ESIGN_ENABLED_PROVIDERS が
    // ('docusign'|'cloudsign')[]、他ブランチは 'mock' 等も含む広い literal union になるため、
    // 分岐をまたいだ union 型のまま `.includes()` を呼ぶと TS が引数型を積の側に狭めてしまう
    // （production 側の狭い要素型を要求し、他ブランチの値を渡せなくなる）。
    const enabledProviders: readonly string[] = data.ESIGN_ENABLED_PROVIDERS;
    if (!enabledProviders.includes(data.ESIGN_PROVIDER_DEFAULT)) {
      addIssue(ctx, 'ESIGN_ENABLED_PROVIDERS', 'ESIGN_PROVIDER_DEFAULT を含める必要があります');
    }
  }
}

export const envSchema = envUnion.superRefine(crossFieldChecks);

export type AppEnv = z.infer<typeof envSchema>;
