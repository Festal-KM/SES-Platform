// apps/web/lib/db/bootstrap.ts
// 🔴 DB クライアント・暗号鍵・キューの初期化（プロセスにつき 1 回）。
//    **環境変数の検証と外部連携の選択そのものは `@ses/config` の `initializeRuntimeConfig`
//    が唯一の経路であり、その最初の呼び出しは `apps/web/instrumentation.ts`（T-03-12）である。**
//    ここはその解決済みの結果（`RuntimeConfig`）を読むだけで、`loadAppEnv` を直接呼ばない
//    （docs/05 §13.1 / CLAUDE.md §11.1）。
//
// 🔴 `initializeRuntimeConfig` はプロセス内でキャッシュされるため、instrumentation が
//    先に走っていれば**ここで再検証も再ログも起きない**（多重初期化を作らない）。
//    逆に instrumentation を通らない実行経路（結合テストが `apps/web/lib/**` を直接呼ぶ場合）
//    でも、同じ 1 箇所を通って初期化される。
//
// 🔴 例外を握りつぶさない。検証に失敗したらそのまま throw する
//    （「未設定ならモックにフォールバック」を作らない。CLAUDE.md §11.1）。
// 🔴 リクエストごとに `APP_ENV` を分岐しない。差し替えの判断は `resolveConnectorSelection`
//    （`initializeRuntimeConfig` の内部）で既に終わっており、ここは結果を読むだけである。
import process from 'node:process';
import {
  GATE_FAIL_RATE_BASELINE_DAYS,
  GATE_FAIL_RATE_WINDOW_HOURS,
  initializeRuntimeConfig,
  SCHEDULER_HEARTBEAT_STALE_HOURS,
  type AppEnvKind,
} from '@ses/config';
import {
  createEmailSender,
  createObjectStore,
  type ConnectorImplementationKind,
  type EmailSender,
  type ObjectStore,
  type ProviderQuotaNearingMarker,
  type ProviderSendCounter,
} from '@ses/connectors';
// 🔴 T-05-04: AWS SDK に到達する唯一の公開経路（`@ses/connectors/aws`）。**このファイルが
//    `apps/web` の起動時 DI の実体**であり、ここ以外から import しない（`packages/connectors/src/aws.ts`）。
//    🔴 `instrumentation.ts` に置かない —— あちらは Next.js が **Edge ランタイム向けにも
//    コンパイルする**ため、Node 組み込みモジュールに依存する AWS SDK を持ち込むとビルドが落ちる
//    （同ファイル冒頭の注記と同じ理由）。Edge で動く `proxy.ts` は本ファイルを import しない。
import { createS3Api, createSesApi } from '@ses/connectors/aws';
// 🔴 T-07-08: BullMQ に触れる唯一のファイル（`packages/connectors/src/bullmq.ts`）への入口。
//    `@ses/connectors/aws` と同じく**サブパス**にしてあるのは、バレル（`@ses/connectors`）を
//    import しただけで BullMQ / ioredis が引きずり込まれないようにするためである。
import {
  createBullMqFailedJobsReader,
  createBullMqGateRunQueue,
  createBullMqSendProposalQueue,
  createRedisProviderQuotaNearingMarker,
  createRedisProviderSendCounter,
  type BullMqFailedJobsReader,
} from '@ses/connectors/bullmq';
import type { AiUnitMetric, TenantHealthThresholds } from '@ses/domain';
import {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  configureTenantDb,
  configureTokenEncryption,
  type TenantQuotaDefaults,
} from '@ses/db';
import type {
  MonitoringRuntime,
  MonitoringThresholds,
  ProviderSpendRuntime,
} from '../admin-monitoring/runtime';
import { createCandidateReference, type CandidateReference } from '../anonymize/reference';
import { configureAccountMailQueue, PendingAccountMailQueue } from '../jobs/account-mail';
import { configureDomainJobQueue, PendingDomainJobQueue } from '../jobs/domain-jobs';
import { configureGateRunJobQueue } from '../jobs/gate-run-queue';
import { configureSendProposalJobQueue } from '../jobs/send-proposal-queue';
import { resolveInviteUrlRuntime, type InviteUrlRuntime } from '../invitations/invite-link';
import {
  configureScanApplyResultQueue,
  configureWebhookProcessQueue,
  confirmSnsSubscription,
  fetchSigningCertificate,
  PendingScanApplyResultQueue,
  PendingWebhookProcessQueue,
} from '../webhooks/runtime';
import type { SigningCertificateLoader } from '../webhooks/sns';

let initialized = false;
/** 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8）が読む値。`ensureDbConfigured()` が 1 度だけ埋める。 */
let cachedAppEnv: AppEnvKind | null = null;
/**
 * 🔴 T-03-07: 管理平面の Auth.js インスタンスの署名鍵（docs/03 §4.9「主平面と管理平面で
 *    別の署名鍵」）。Auth.js は `AUTH_SECRET` しか自動で読まないため、管理平面のインスタンスには
 *    ここから明示的に渡す。**`process.env` を直接読まない**（CLAUDE.md §3.5）。
 */
let cachedPlatformAuthSecret: string | null = null;
/**
 * 🔴 T-03-10: `SANDBOX` で開設したテナントの試用期限（日数。docs/05 §6.9 API-A4 /
 *    `CLAUDE.md` §9-12「有効期間は 30 日」）。`packages/config` の `SANDBOX_TRIAL_DAYS` が唯一の出所。
 */
let cachedSandboxTrialDays: number | null = null;
/**
 * 🔴 T-10-06: `A-012`（API-A16）が `runSeed` に渡す合成データ投入専用の特権接続（`SEED_DATABASE_URL`。docs/05 §13.6）。
 *    `packages/config` が「`demo` / `development` 以外に設定されていたら起動失敗」を担保しており、ここは値を写すだけ。
 *    未設定（`null`）は「投入経路が未設定」であり、**他の接続文字列にフォールバックしない**。
 */
let cachedSeedDatabaseUrl: string | null = null;
/**
 * 🔴 T-04-03: `POST /api/webhooks/ses` が受け入れる SNS トピック（`SES_EVENT_TOPIC_ARN`）。
 *    署名検証は「Amazon が署名したこと」しか証明しないため、**受け入れるトピックを固定する**。
 */
let cachedSesEventTopicArn: string | null = null;
/**
 * 🔴 T-05-05: `POST /api/webhooks/guardduty` の HMAC 共有鍵（`GUARDDUTY_WEBHOOK_HMAC_SECRET` と、
 *    ローテーション中の旧鍵）。**空配列にならない**（`packages/config` が新鍵を必須にしている）。
 *    空になれば `verifyGuardDutySignature` は必ず false を返す（fail-closed）。
 */
let cachedGuardDutyWebhookSecrets: readonly string[] | null = null;
/**
 * 🔴 T-04-04: 送信ドメイン設定（#71 / #72）が要る起動時解決済みの値（docs/05 §8.3 / docs/03 §3.2.7）。
 *    ルートが `process.env` を読まない（`CLAUDE.md` §3.5）ための唯一の経路。
 */
let cachedSendingDomainRuntime: { readonly region: string; readonly verificationRequired: boolean } | null =
  null;
/**
 * 🔴 T-04-08: `#14` が招待リンク（平文トークン）を応答に載せてよいか（`F-007 AC-4`）。
 *    `sandbox` では取引先招待メールがモックになる（Issue #9 / #10）ため、画面で手渡すしかない。
 *    **判定はここ 1 箇所**であり、ルートにも画面にも `APP_ENV` の分岐を置かない（`CLAUDE.md` §11.1）。
 */
let cachedInviteUrlRuntime: InviteUrlRuntime | null = null;
/**
 * 🔴 T-05-04: ストレージの上限・署名の設定と、**選ばれた実装種別**（docs/05 §13.1 / §14.2）。
 *    `APP_ENV` の分岐は `resolveConnectorSelection` が起動時に済ませており、ここは結果を持つだけ。
 */
let cachedStorageRuntime: StorageRuntime | null = null;
/** 🔴 起動時に選ばれた実装から 1 度だけ組み立てる（リクエストごとに作らない）。 */
let cachedObjectStore: ObjectStore | null = null;
/**
 * 🔴 S3 クライアントの接続設定（資格情報を含む）。**export しない / `storageRuntime()` に載せない**
 *    —— 鍵の到達経路を `objectStore()` の内側 1 か所に閉じる（`CLAUDE.md` §3.5）。
 */
let cachedS3ClientEnv: Parameters<typeof createS3Api>[0] | null = null;
/**
 * 🔴 T-08-04: 匿名候補の案件スコープ参照子（`ANON_REFERENCE_HMAC_SECRET`。docs/05 §4.6）。
 *
 * 🔴 **保持するのは鍵ではなく「鍵を閉じ込めた関数」である。** 鍵そのものを返すアクセサを
 *    作らない（S3 の資格情報を `storageRuntime()` に載せず `objectStore()` の内側に閉じたのと
 *    同じ規律。`CLAUDE.md` §3.5「ログ・エラー・監査ログに絶対に出さない」）。
 */
let cachedCandidateReference: CandidateReference | null = null;
/**
 * 🔴 T-10-03: 利用量の上限（`S-038` #69 が残量を組み立てるために読む値。docs/02 `F-027` / docs/05 §5.8）。
 *    出所は `packages/config` だけ（プラン別の上書きが入るまでの既定値。docs/05 §7.12 ⑧）。
 *    🔴 `usage.limit-check`（`apps/worker/src/runtime.ts`）が**同じキー**から同じ値を渡す ——
 *    判定（ワーカー）と表示（主平面）で上限値がずれると「停止中なのに残量がある」表示になる。
 *    🔴 金額（`AI_DAILY_COST_LIMIT_USD_DEFAULT`）は**ここに載せない**（主平面は金額を読まない。`F-027 AC-6`）。
 */
let cachedUsageLimitsRuntime: UsageLimitsRuntime | null = null;
/**
 * 🔴 T-11-04: `A-005` 運用監視（API-A8）の閾値・上限（docs/05 §16.5 / §6.9 API-A8）。出所は `packages/config` だけ。
 *    🔴 `GATE_STALL_ALERT_MINUTES` は `listGateStalls`（`packages/db`）に**同じキー**から渡す。
 */
let cachedMonitoringThresholds: MonitoringThresholds | null = null;
/** 🔴 T-11-08 / T-11-04: 項目 17（環境全体の当月 AI 支出 / tier 上限）。`readProviderMonthlySpend` に渡す値。 */
let cachedProviderSpendRuntime: ProviderSpendRuntime | null = null;
/**
 * 🔴 T-11-02: `A-004` 利用量・クォータ管理（API-A6）が `readPlatformUsage` / `setTenantQuotaOverride` に渡す値。
 *    **金額（USD）を含む**（`AI_DAILY_COST_LIMIT_USD_DEFAULT` / `AI_MONTHLY_COST_CAP_USD_DEFAULT` / `ANTHROPIC_MONTHLY_SPEND_CAP_USD`）ため、
 *    `usageLimitsRuntime()`（主平面。金額を載せない）とは**別のアクセサ**にする。読み手は `apps/web/app/api/admin/**` と
 *    `apps/web/app/admin/**` だけである。既定値（件数 / 通数 / バイト数）は `usageLimitsRuntime()` と同じキーから読む
 *    （ワーカーの判定・主平面の表示・運営者の一覧で上限値がずれない）。
 */
let cachedAdminUsageRuntime: AdminUsageRuntime | null = null;
/**
 * 🔴 T-11-01: `A-002` テナント健全性（異常度スコア）の閾値 4 つ（`TENANT_HEALTH_*`。docs/05 §6.9 API-A2）。
 *    `listPlatformTenants` に**必ず**渡す（`packages/db` は既定値へフォールバックしない）。重みは `packages/domain` の定数。
 */
let cachedTenantHealthThresholds: TenantHealthThresholds | null = null;
/**
 * 🔴 T-11-04: 項目 13（送信基盤の 24h 枠）の**設定値**。`MAIL_PROVIDER_DAILY_QUOTA` / `MAIL_PROVIDER_QUOTA_WARN_RATIO`
 *    （`packages/config`。ワーカーの `send.hold-release` と同じキー）。
 */
let cachedMailProviderQuotaEnv: { readonly envLimit: number; readonly warnRatio: number } | null = null;
/**
 * 🔴 T-11-04: 項目 13 の `getQuota()` に使う `EmailSender`。**送信には使わない**（`apps/web` は運用メールを
 *    `account.mail` に積むだけで自分では送らない）。実装種別は起動時の `connectors.email` が決め、ここに分岐は無い。
 *    `development` / `demo` = モック（SES に出ない） / `sandbox` 以上 = SES の `GetAccount`（読み取り）。遅延生成。
 */
let cachedQuotaEmailSender: EmailSender | null = null;
let cachedSesEnv: {
  readonly region: string;
  readonly accountId: string;
  readonly defaultFromAddress: string;
  readonly configurationSet: string;
} | null = null;
/** 🔴 起動時に選ばれたメール送信の実装種別（`getQuota()` の `EmailSender` を遅延生成するときに渡す）。 */
let cachedEmailConnectorKind: ConnectorImplementationKind | null = null;
let cachedRedisUrl: string | null = null;
let cachedProviderSentCounter: ProviderSendCounter | null = null;
let cachedNearingMarker: ProviderQuotaNearingMarker | null = null;
let cachedFailedJobsReader: BullMqFailedJobsReader | null = null;

/**
 * DB クライアントを 1 度だけ初期化する。
 *
 * 🔴 `initialized` はモジュールスコープに置く（`initializeRuntimeConfig` のように
 *    `globalThis` へ逃がさない）。ここが守るのは「この Prisma クライアントを 1 度だけ作る」
 *    ことであり、バンドラがモジュールを複製した場合は**複製ごとに専用のクライアントが要る**
 *    （別インスタンスの `getBaseClient()` は未初期化のままになるため）。
 */
export function ensureDbConfigured(): void {
  if (initialized) return;
  // 🔴 起動時 DI の唯一の入口。instrumentation が先に呼んでいればキャッシュが返り、
  //    環境変数の再検証も起動ログの再出力も起きない（T-03-12）。
  const { env, connectors } = initializeRuntimeConfig(process.env, (line) => {
    process.stdout.write(`${line}\n`);
  });
  cachedAppEnv = env.APP_ENV;
  cachedPlatformAuthSecret = env.AUTH_PLATFORM_SECRET;
  cachedSandboxTrialDays = env.SANDBOX_TRIAL_DAYS;
  cachedSeedDatabaseUrl = env.SEED_DATABASE_URL ?? null;
  configureTenantDb({ datasourceUrl: env.DATABASE_URL });
  // 🔴 T-03-07: 管理平面は**別の接続プール・別の DB ロール**（docs/03 §4.3.3 / docs/05 §4.2）。
  //    主平面の DATABASE_URL を流用しない（流用すると運営者の資格情報へ主平面のロールから
  //    到達できてしまう。CLAUDE.md §10.5「権限昇格の事故経路を作らない」）。
  configurePlatformWriteDb({ datasourceUrl: env.PLATFORM_WRITE_DATABASE_URL });
  // 🔴 T-03-08: 管理平面の**読み取り専用**プール（`app_platform`。docs/05 §4.2 / §5.2）。
  //    `withPlatformRead` はこちらで接続する。読みと書きを 1 本のプールに混ぜない ——
  //    「read-only は DB 権限で担保する」（§5.2）が、同じ接続を使い回すと成立しない。
  configurePlatformReadDb({ datasourceUrl: env.PLATFORM_DATABASE_URL });
  // 🔴 T-03-02: 秘匿値の暗号鍵も同じ初期化経路で注入する（docs/05 §8.6 / docs/03 §4.4）。
  //    packages/db 側で `process.env` を読ませない（鍵の出所を packages/config に一本化する）。
  configureTokenEncryption({
    key: env.TOKEN_ENCRYPTION_KEY,
    keyId: env.TOKEN_ENCRYPTION_KEY_ID,
    previous: env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
  });
  // 🔴 T-03-03: `account.mail`（docs/05 §9.4）の enqueue 先を**起動時の 1 箇所**で決める。
  //    判断材料は `resolveConnectorSelection`（APP_ENV 分岐の唯一の場所。CLAUDE.md §11.1）が
  //    起動時に解決した `connectors` であり、ここで `APP_ENV` を自分で分岐しない。
  //    - email が `mock`（development / demo）→ 保留キュー（SP-04 のハンドラが処理するまで積むだけ）
  //    - それ以外（sandbox / staging / production）→ **登録しない**。BullMQ のキュー実装は SP-04 の
  //      範囲であり、未実装のまま「送ったつもり」にさせない（enqueue 時に例外 = 操作が成立しない）。
  if (connectors.email === 'mock') {
    configureAccountMailQueue(new PendingAccountMailQueue());
  }
  // 🔴 T-04-03: Webhook 受信の enqueue 先。判断材料は `account.mail` と同じ（`connectors.email`）。
  //    - email が `mock`（development / demo）→ 保留キュー（SP-07 のハンドラが処理するまで積むだけ）
  //    - それ以外（sandbox / staging / production）→ **登録しない**。BullMQ の配線は SP-07 であり、
  //      未実装のまま「受け取ったことにして捨てる」状態を作らない。受信時に例外 = 500 になり、
  //      SNS が再送を続けるので通知は失われない（`CLAUDE.md` §11.1）。
  if (connectors.email === 'mock') {
    configureWebhookProcessQueue(new PendingWebhookProcessQueue());
  }
  // 🔴 T-04-04: `domain.provision` / `domain.verify` の enqueue 先。判断材料は同じ（`connectors.email`）。
  //    BullMQ の配線は SP-07 であり、それまで `sandbox` / `staging` / `production` では
  //    **登録しない** = enqueue 時に例外になり、「登録したのに DNS レコードが出てこない」
  //    状態を成立させない（`CLAUDE.md` §11.1）。
  if (connectors.email === 'mock') {
    configureDomainJobQueue(new PendingDomainJobQueue());
  }
  // 🔴 T-05-05: `scan.apply-result` の enqueue 先。判断材料は上の 3 つと同じである
  //    （`connectors.email === 'mock'` = BullMQ の配線がまだ無い `development` / `demo`）。
  //    それ以外では**登録しない** = 受信時に例外 → 500 → 送信側が再送するので結果は失われない。
  //    「受け取ったことにして捨てる」状態を作らない（`CLAUDE.md` §11.1）。
  if (connectors.email === 'mock') {
    configureScanApplyResultQueue(new PendingScanApplyResultQueue());
  }
  // 🔴 T-07-08: `gate.run` の enqueue 先（docs/05 §9.3 / §9.10 / §11.10）。
  //    🔴 **環境で分岐しない。** 上の 4 つ（メール系・Webhook・スキャン）は「BullMQ の配線が
  //    まだ無い」ことを理由に `connectors.email === 'mock'` で保留キューを選んでいるが、
  //    ゲートにその選択肢は無い —— Redis は全環境で必須（`REDIS_URL`）であり、
  //    **積んだだけで誰も実行しないキュー**は「レビュー依頼したのに永久に結果が出ない」
  //    （対象が `GATE_RUNNING` のまま残る）という壊れ方そのものである（`CLAUDE.md` §11.1）。
  //    🔴 `Queue` の実体化は最初の enqueue まで遅延する（登録しただけで Redis へ繋ぎにいかない）。
  configureGateRunJobQueue(createBullMqGateRunQueue({ url: env.REDIS_URL }));
  // 🔴 T-09-06: `send.proposal` の enqueue 先（docs/05 §9.4 / §10.2）。`gate.run` と同じ判断で**環境で分岐しない** ——
  //    積んだだけで誰も送らないキューは「送信を受け付けたのに永久に送られない」（`APPROVED` のまま）という壊れ方であり、
  //    `CLAUDE.md` §11.1 そのものである。`Queue` の実体化は最初の enqueue まで遅延する。
  configureSendProposalJobQueue(createBullMqSendProposalQueue({ url: env.REDIS_URL }));
  cachedSesEventTopicArn = env.SES_EVENT_TOPIC_ARN;
  // 🔴 T-05-05: HMAC の鍵。旧鍵が設定されている間は**新旧どちらの署名も受理する**
  //    （無停止のローテーション。docs/05 §8.5）。分岐はここ 1 箇所である。
  cachedGuardDutyWebhookSecrets =
    env.GUARDDUTY_WEBHOOK_HMAC_SECRET_PREVIOUS === undefined
      ? [env.GUARDDUTY_WEBHOOK_HMAC_SECRET]
      : [env.GUARDDUTY_WEBHOOK_HMAC_SECRET, env.GUARDDUTY_WEBHOOK_HMAC_SECRET_PREVIOUS];
  // 🔴 `sandbox` / `demo` / `development` は共通ドメインで動く（`docs/03` §3.2.7-4 / -5）。
  //    **分岐はここ 1 箇所**であり、リクエストごとに `APP_ENV` を見ない（`CLAUDE.md` §11.1）。
  cachedSendingDomainRuntime = {
    region: env.AWS_REGION,
    verificationRequired: env.APP_ENV === 'staging' || env.APP_ENV === 'production',
  };
  // 🔴 T-04-08: 招待リンクの開示（`F-007 AC-4`）も**同じ 1 箇所**で決める。
  //    判定式そのものは `resolveInviteUrlRuntime`（`invite-link.ts`）が持つ ——
  //    結合テストが `buildValidEnv('sandbox')` から**同じ関数**で runtime を作れるようにするため
  //    （テスト専用のフックも、テスト側での判定の書き写しも作らない）。
  cachedInviteUrlRuntime = resolveInviteUrlRuntime(env);
  // 🔴 T-05-04: ストレージ（docs/05 §14.1 / §14.2 / docs/03 §4.5）。値の出所は `packages/config`
  //    だけであり、ルートも画面も `process.env` を読まない（`CLAUDE.md` §3.5）。
  //    🔴 実装種別（`connectors.objectStore`）もここで確定させる。**リクエストごとに
  //    `APP_ENV` を見ない**（`CLAUDE.md` §11.1 / docs/05 §13.1）。
  cachedStorageRuntime = {
    implementation: connectors.objectStore,
    bucket: env.S3_BUCKET,
    ...(env.S3_KMS_KEY_ID === undefined ? {} : { kmsKeyId: env.S3_KMS_KEY_ID }),
    presignedUrlTtlSeconds: env.S3_PRESIGNED_URL_TTL_SECONDS,
    uploadMaxBytes: env.UPLOAD_MAX_BYTES,
    // 🔴 プラン別の上書き（`Plan.storageLimitBytes`）が入るまでの既定値（`packages/config`）。
    //    判定関数は `limitBytes` を引数で受け取るため、上書きが入っても呼び出し側は変わらない。
    storageLimitBytes: BigInt(env.STORAGE_LIMIT_BYTES_PER_TENANT),
  };
  // 🔴 T-05-04: S3 クライアントの接続設定。**`storageRuntime()` には載せない** ——
  //    あちらはルート・画面が読む値であり、資格情報を混ぜると「設定を読むついでに鍵が読める」
  //    経路になる（`CLAUDE.md` §3.5）。ここだけが持ち、`objectStore()` 以外は参照しない。
  //    🔴 静的キーは `development` の MinIO でしか設定されない（`staging` / `production` で
  //    設定されていたら `packages/config` が起動を止める。docs/03 §6.5 / NFR-ENV-4）。
  cachedS3ClientEnv = {
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT === undefined ? {} : { endpoint: env.S3_ENDPOINT }),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    ...(env.S3_ACCESS_KEY_ID === undefined || env.S3_SECRET_ACCESS_KEY === undefined
      ? {}
      : {
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }),
  };
  // 🔴 T-08-04: 匿名候補の参照子（docs/05 §4.6 / `F-017 AC-2` / `BR-55`）。
  //    値の出所は `packages/config` の Zod スキーマ（`base64AtLeastBytes(32)`）だけであり、
  //    `apps/web` のどのルートも `process.env` を読まない（`CLAUDE.md` §3.5）。
  //    🔴 **未設定でのフォールバックを持たない** —— 鍵が無ければ `initializeRuntimeConfig` が
  //    起動時に落ちる。「既定の鍵で続行」は、参照子が全環境で同じ = 案件スコープの意味が
  //    消えた状態を本番へ持ち込む（`CLAUDE.md` §11.1 と同じ壊れ方）。
  cachedCandidateReference = createCandidateReference(env.ANON_REFERENCE_HMAC_SECRET);
  // 🔴 T-10-03: 上限値（金額を含まない）。ワーカーの `usageLimits` と同じキーから読む。
  cachedUsageLimitsRuntime = {
    warnPercent: env.QUOTA_WARNING_THRESHOLD_PERCENT,
    aiUnitQuotas: {
      AI_UNIT_SHEET_PARSE: env.AI_UNIT_QUOTA_SHEET_PARSE_DEFAULT,
      AI_UNIT_MATCH_RATIONALE: env.AI_UNIT_QUOTA_MATCH_RATIONALE_DEFAULT,
      AI_UNIT_PROPOSAL_DRAFT: env.AI_UNIT_QUOTA_PROPOSAL_DRAFT_DEFAULT,
      AI_UNIT_RENEWAL_SUMMARY: env.AI_UNIT_QUOTA_RENEWAL_SUMMARY_DEFAULT,
    },
    emailDailyLimit: env.EMAIL_DAILY_LIMIT_PER_TENANT,
    emailMinuteLimit: env.EMAIL_MINUTE_LIMIT_PER_TENANT,
    storageLimitBytes: BigInt(env.STORAGE_LIMIT_BYTES_PER_TENANT),
  };
  // 🔴 T-11-04: `A-005` の閾値・上限（`packages/config` が唯一の出所。ルートで `process.env` を読まない）。
  cachedMonitoringThresholds = {
    submittingStallMinutes: env.SUBMITTING_STALL_ALERT_MINUTES,
    gateStallMinutes: env.GATE_STALL_ALERT_MINUTES,
    mailDispatchStuckMinutes: env.MAIL_DISPATCH_STUCK_ALERT_MINUTES,
    scanStallMinutes: env.SCAN_STALL_ALERT_MINUTES,
    purgeGraceDays: env.TENANT_PURGE_GRACE_DAYS,
    schedulerStaleHours: SCHEDULER_HEARTBEAT_STALE_HOURS,
    gateFailRateWindowHours: GATE_FAIL_RATE_WINDOW_HOURS,
    gateFailRateBaselineDays: GATE_FAIL_RATE_BASELINE_DAYS,
  };
  cachedProviderSpendRuntime = {
    capUsd: env.ANTHROPIC_MONTHLY_SPEND_CAP_USD,
    warnPercent: env.QUOTA_WARNING_THRESHOLD_PERCENT,
  };
  // 🔴 T-11-02: `A-004`（API-A6）の材料。金額を含むので主平面の `usageLimitsRuntime()` には載せない。
  cachedAdminUsageRuntime = {
    warnPercent: env.QUOTA_WARNING_THRESHOLD_PERCENT,
    defaults: {
      aiUnitQuotas: cachedUsageLimitsRuntime.aiUnitQuotas,
      emailDailyLimit: cachedUsageLimitsRuntime.emailDailyLimit,
      storageLimitBytes: cachedUsageLimitsRuntime.storageLimitBytes,
    },
    aiDailyCostLimitUsd: env.AI_DAILY_COST_LIMIT_USD_DEFAULT,
    aiMonthlyCostCapUsd: env.AI_MONTHLY_COST_CAP_USD_DEFAULT,
    providerCapUsd: env.ANTHROPIC_MONTHLY_SPEND_CAP_USD,
  };
  // 🔴 T-11-01: `A-002` の異常度の閾値。出所は `packages/config` だけ（ルート・画面は `process.env` を読まない）。
  cachedTenantHealthThresholds = {
    inactiveDays: env.TENANT_HEALTH_INACTIVE_DAYS,
    noPartnersGraceDays: env.TENANT_HEALTH_NO_PARTNERS_GRACE_DAYS,
    seatUtilizationMinPercent: env.TENANT_HEALTH_SEAT_UTILIZATION_MIN_PERCENT,
    trialExpiringDays: env.TENANT_HEALTH_TRIAL_EXPIRING_DAYS,
  };
  cachedMailProviderQuotaEnv = {
    envLimit: env.MAIL_PROVIDER_DAILY_QUOTA,
    warnRatio: env.MAIL_PROVIDER_QUOTA_WARN_RATIO,
  };
  cachedSesEnv = {
    region: env.AWS_REGION,
    accountId: env.AWS_ACCOUNT_ID,
    defaultFromAddress: env.SES_DEFAULT_FROM_ADDRESS,
    configurationSet: env.SES_CONFIGURATION_SET,
  };
  cachedEmailConnectorKind = connectors.email;
  cachedRedisUrl = env.REDIS_URL;
  initialized = true;
}

function redisConnection(): { readonly url: string } {
  ensureDbConfigured();
  if (cachedRedisUrl === null) {
    throw new Error('REDIS_URL が解決されていません（bootstrap の不変条件違反）。');
  }
  return { url: cachedRedisUrl };
}

/**
 * 🔴 T-11-04: プロセス横断の 24h 送信カウンタ（Redis ZSET `mail:provider:sent24h`。docs/05 §8.3-Q ③）。
 *    `apps/web` は**読むだけ**（加算は `SesEmailSender.send` の内側 = ワーカー）。プロセス内カウンタへ倒さない
 *    （ワーカーが数えた値を web が見られない = 常に 0 に見える）。
 */
function providerSentCounter(): ProviderSendCounter {
  cachedProviderSentCounter ??= createRedisProviderSendCounter(redisConnection()).counter;
  return cachedProviderSentCounter;
}

function nearingMarker(): ProviderQuotaNearingMarker {
  cachedNearingMarker ??= createRedisProviderQuotaNearingMarker(redisConnection()).marker;
  return cachedNearingMarker;
}

/**
 * 🔴 `getQuota()` だけに使う `EmailSender`（項目 13）。`createEmailSender` は `apps/worker/src/runtime.ts` と**同じファクトリ**であり、
 *    web と worker で別の実装が選ばれることは無い。`APP_ENV` を見ない（`cachedEmailConnectorKind` は起動時の解決結果）。
 */
function quotaEmailSender(): EmailSender {
  ensureDbConfigured();
  if (cachedQuotaEmailSender === null) {
    if (cachedSesEnv === null || cachedEmailConnectorKind === null) {
      throw new Error('SES の接続設定が解決されていません（bootstrap の不変条件違反）。');
    }
    cachedQuotaEmailSender = createEmailSender(cachedEmailConnectorKind, {
      ses: {
        api: createSesApi({ region: cachedSesEnv.region, accountId: cachedSesEnv.accountId }),
        defaultFromAddress: cachedSesEnv.defaultFromAddress,
        configurationSet: cachedSesEnv.configurationSet,
        sentCounter: providerSentCounter(),
      },
    });
  }
  return cachedQuotaEmailSender;
}

/** 🔴 T-11-05 の申し送り ①: `listGateStalls` の閾値（`GATE_STALL_ALERT_MINUTES`）。 */
export function gateStallRuntime(): { readonly stallThresholdMinutes: number } {
  return { stallThresholdMinutes: monitoringThresholdsRuntime().gateStallMinutes };
}

/** 🔴 T-11-08 の申し送り ②: `readProviderMonthlySpend` の上限と閾値。 */
export function providerSpendRuntime(): ProviderSpendRuntime {
  ensureDbConfigured();
  if (cachedProviderSpendRuntime === null) {
    throw new Error('AI 支出の上限が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedProviderSpendRuntime;
}

export function monitoringThresholdsRuntime(): MonitoringThresholds {
  ensureDbConfigured();
  if (cachedMonitoringThresholds === null) {
    throw new Error('運用監視の閾値が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedMonitoringThresholds;
}

/**
 * 🔴 T-11-01: `A-002` / API-A2 が `listPlatformTenants` に渡す健全性の閾値（`TENANT_HEALTH_*`）。
 *    ルートと画面（`page.tsx`）の両方がここから受け取り、同じ値で並べる。
 */
export function tenantHealthRuntime(): TenantHealthThresholds {
  ensureDbConfigured();
  if (cachedTenantHealthThresholds === null) {
    throw new Error('テナント健全性の閾値が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedTenantHealthThresholds;
}

/**
 * 🔴 T-11-04: API-A8（`A-005`）が読む口をまとめて返す。ルートはこれ 1 つを受け取り、`process.env` にも Redis にも
 *    `@ses/connectors/bullmq` にも直接触れない（`tests/static/admin-no-gate-retry.test.ts` ①）。
 *
 * - `failedJobs` … BullMQ の failed セットを**読むだけ**（`createBullMqFailedJobsReader`。`Job` を外に出さない）
 * - `mailProvider` … `getQuota()`（取得失敗は throw のまま渡し、組み立て側が `available: false` に落とす）/
 *   手元の 24h カウンタ / 接近の目印
 * 🔴 どの口も最初の呼び出しまで Redis / SES へ繋ぎにいかない（起動時 DI はリクエストを処理しない経路でも走る）。
 */
export function monitoringRuntime(): MonitoringRuntime {
  const thresholds = monitoringThresholdsRuntime();
  if (cachedMailProviderQuotaEnv === null) {
    throw new Error('送信基盤の枠の設定が解決されていません（bootstrap の不変条件違反）。');
  }
  const mailEnv = cachedMailProviderQuotaEnv;
  return {
    thresholds,
    providerSpend: providerSpendRuntime(),
    mailProvider: {
      envLimit: mailEnv.envLimit,
      warnRatio: mailEnv.warnRatio,
      readQuota: () => quotaEmailSender().getQuota(),
      readLocalSent24h: (now) => providerSentCounter().countLast24h(now),
      observeNearing: (nearing, now) => nearingMarker().observe(nearing, now),
    },
    failedJobs: {
      list: () => {
        cachedFailedJobsReader ??= createBullMqFailedJobsReader(redisConnection());
        return cachedFailedJobsReader.list();
      },
    },
  };
}

/**
 * 🔴 T-05-04: ストレージの実行時設定（docs/05 §14.2）。
 *
 * `#18`（アップロード用署名の発行）と、後続の版管理・ダウンロード（T-05-06 / T-05-07）が読む。
 */
export type StorageRuntime = {
  readonly implementation: ConnectorImplementationKind;
  readonly bucket: string;
  readonly kmsKeyId?: string;
  readonly presignedUrlTtlSeconds: number;
  readonly uploadMaxBytes: number;
  readonly storageLimitBytes: bigint;
};

export function storageRuntime(): StorageRuntime {
  ensureDbConfigured();
  if (cachedStorageRuntime === null) {
    throw new Error('ストレージの実行時設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedStorageRuntime;
}

/**
 * 🔴 オブジェクトストレージの実装（docs/05 §8.1 / §13.1）。プロセスにつき 1 つ。
 *
 * 🔴 **`APP_ENV` を見ない。** 実装種別は起動時に `resolveConnectorSelection` が決めた値
 *    （`storageRuntime().implementation`）であり、ここは `createObjectStore` に渡すだけである。
 * 🔴 **未実装の区分をモックで代替しない**（`CLAUDE.md` §11.1）。`real`（MinIO / S3）は
 *    AWS SDK のアダプタ（`@ses/connectors/aws` の `createS3Api`）を必要とし、渡さなければ
 *    `ConnectorImplementationNotAvailableError` で失敗する。「未設定ならモック」に倒すと、
 *    **アップロードできたように見えてファイルがどこにも無い**という最悪の壊れ方になる。
 * 🔴 遅延生成にしているのは、**この区分だけ**を先に組み立てるためである（`createConnectors` は
 *    全 5 区分を一度に作るため、未登録の `malwareScanner`〔T-05-05〕で起動そのものが落ちる）。
 *    実装種別の決定は起動時のまま動かしていない。
 * 🔴 `S3Client` の生成はネットワークに出ない（資格情報の解決は最初の呼び出しまで遅延する）。
 *    したがって実装種別で分岐せずに常に組み立ててよく、`mock`（`demo`）でも副作用は無い ——
 *    **「この環境なら S3 を作る」という分岐をここに書かない**ことのほうが重要である。
 */
export function objectStore(): ObjectStore {
  const runtime = storageRuntime();
  if (cachedObjectStore === null) {
    if (cachedS3ClientEnv === null) {
      throw new Error('S3 の接続設定が解決されていません（bootstrap の不変条件違反）。');
    }
    cachedObjectStore = createObjectStore(runtime.implementation, {
      s3: {
        api: createS3Api(cachedS3ClientEnv),
        bucket: runtime.bucket,
        ...(runtime.kmsKeyId === undefined ? {} : { kmsKeyId: runtime.kmsKeyId }),
        presignedUrlTtlSeconds: runtime.presignedUrlTtlSeconds,
      },
    });
  }
  return cachedObjectStore;
}

/**
 * 🔴 T-08-04: 匿名候補の案件スコープ参照子を作る関数（docs/05 §4.6）。
 *
 * 🔴 **返すのは関数だけであり、鍵は返らない。** 呼び出し側（候補一覧 = T-08-05 /
 *    提案依頼の逆引き = T-08-06）が扱えるのは `(projectId, engineerId) => string` だけである。
 */
export function candidateReference(): CandidateReference {
  ensureDbConfigured();
  if (cachedCandidateReference === null) {
    throw new Error('匿名候補の参照子が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedCandidateReference;
}

/**
 * 🔴 `#14`（`POST /api/invitations`）と `S-014` が読む、起動時解決済みの開示設定（`F-007 AC-4`）。
 *    `NOT_DISCLOSED` の枝には `appUrl` が無いため、**呼び出し側は URL を組み立てられない**。
 */
export function inviteUrlRuntime(): InviteUrlRuntime {
  ensureDbConfigured();
  if (cachedInviteUrlRuntime === null) {
    throw new Error('招待リンクの実行時設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedInviteUrlRuntime;
}

/**
 * 🔴 `#71` / `#72` が使う起動時解決済みの値（docs/05 §8.3）。
 *    `verificationRequired === false` の環境では #72 が `{ state: 'NOT_REQUIRED' }` を返す。
 */
export function sendingDomainRuntime(): {
  readonly region: string;
  readonly verificationRequired: boolean;
} {
  ensureDbConfigured();
  if (cachedSendingDomainRuntime === null) {
    throw new Error('送信ドメインの実行時設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedSendingDomainRuntime;
}

/**
 * 🔴 `POST /api/webhooks/ses` が使う起動時解決済みの値（docs/05 §8.5）。
 *    ルートが `process.env` を読まない（`CLAUDE.md` §3.5）ための唯一の経路。
 */
export function sesWebhookRuntime(): {
  readonly topicArn: string;
  readonly loadCertificate: SigningCertificateLoader;
  readonly confirmSubscription: (subscribeUrl: string) => Promise<void>;
} {
  ensureDbConfigured();
  if (cachedSesEventTopicArn === null) {
    throw new Error('SES_EVENT_TOPIC_ARN が解決されていません（bootstrap の不変条件違反）。');
  }
  return {
    topicArn: cachedSesEventTopicArn,
    loadCertificate: fetchSigningCertificate,
    confirmSubscription: confirmSnsSubscription,
  };
}

/**
 * 🔴 `POST /api/webhooks/guardduty` が使う起動時解決済みの値（docs/05 §6.10 / §8.5）。T-05-05。
 *    ルートが `process.env` を読まない（`CLAUDE.md` §3.5）ための唯一の経路。
 *
 * 🔴 `bucket` は `storageRuntime()` と**同じ 1 つの値**である（別々に読むと、署名を出した
 *    バケットとスキャン結果を受け入れるバケットがずれる）。
 */
export function guardDutyWebhookRuntime(): {
  readonly secrets: readonly string[];
  readonly bucket: string;
} {
  const storage = storageRuntime();
  if (cachedGuardDutyWebhookSecrets === null) {
    throw new Error('GUARDDUTY_WEBHOOK_HMAC_SECRET が解決されていません（bootstrap の不変条件違反）。');
  }
  return { secrets: cachedGuardDutyWebhookSecrets, bucket: storage.bucket };
}

/**
 * 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8。T-03-06）が読む唯一の経路。
 *    `ensureDbConfigured()` と同じキャッシュを返す（`loadAppEnv` を二重に呼ばない）。
 */
export function currentAppEnv(): AppEnvKind {
  ensureDbConfigured();
  if (cachedAppEnv === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない
    // （不変条件違反。フォールバックせず、そのまま失敗させる。CLAUDE.md §11.1）。
    throw new Error('APP_ENV が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedAppEnv;
}

/**
 * 🔴 T-03-10: `A-014`（テナント開設）が `SANDBOX` の `sandboxExpiresAt` を計算するために読む。
 *    値の出所は `packages/config`（`SANDBOX_TRIAL_DAYS`。既定 30 日）だけであり、
 *    API ハンドラに日数をベタ書きしない。
 */
export function sandboxTrialDays(): number {
  ensureDbConfigured();
  if (cachedSandboxTrialDays === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない。
    throw new Error('SANDBOX_TRIAL_DAYS が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedSandboxTrialDays;
}

/**
 * 🔴 T-10-03: 利用量の上限（件数・通数・バイト数。金額を含まない）。`S-038` #69 が読む。
 *    `usage.limit-check`（ワーカー）と同じ `packages/config` のキーが出所であり、判定と表示で値がずれない。
 */
export type UsageLimitsRuntime = {
  readonly warnPercent: number;
  readonly aiUnitQuotas: Readonly<Record<AiUnitMetric, number>>;
  readonly emailDailyLimit: number;
  readonly emailMinuteLimit: number;
  readonly storageLimitBytes: bigint;
};

export function usageLimitsRuntime(): UsageLimitsRuntime {
  ensureDbConfigured();
  if (cachedUsageLimitsRuntime === null) {
    throw new Error('利用量の上限が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedUsageLimitsRuntime;
}

/**
 * 🔴 T-11-02: `A-004`（API-A6）が読む値。**金額（USD）を含む**ため管理平面（`apps/web/app/api/admin/**` /
 *    `apps/web/app/admin/**`）だけが呼ぶ。`defaults` は `usageLimitsRuntime()` と同じ `packages/config` のキーから読む。
 */
export type AdminUsageRuntime = {
  readonly warnPercent: number;
  readonly defaults: TenantQuotaDefaults;
  /** `AI_DAILY_COST_LIMIT_USD_DEFAULT`（テナントの 1 日の AI コスト上限。遮断器）。 */
  readonly aiDailyCostLimitUsd: number;
  /** `AI_MONTHLY_COST_CAP_USD_DEFAULT`（テナントの月間 AI 原価の上限。運営者の内部指標）。 */
  readonly aiMonthlyCostCapUsd: number;
  /** `ANTHROPIC_MONTHLY_SPEND_CAP_USD`（環境全体の tier 上限）。 */
  readonly providerCapUsd: number;
};

export function adminUsageRuntime(): AdminUsageRuntime {
  ensureDbConfigured();
  if (cachedAdminUsageRuntime === null) {
    throw new Error('利用量・クォータ管理の設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedAdminUsageRuntime;
}

/**
 * 🔴 管理平面の Auth.js インスタンス（`lib/auth/platform.ts`）だけが読む署名鍵。
 *    主平面の `AUTH_SECRET`（Auth.js が自動で読む）とは**別の値**であることを
 *    `packages/config` の起動時検証が保証している（同値なら起動に失敗する）。
 */
export function platformAuthSecret(): string {
  ensureDbConfigured();
  if (cachedPlatformAuthSecret === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない
    // （不変条件違反。フォールバックせず、そのまま失敗させる。CLAUDE.md §11.1）。
    throw new Error('AUTH_PLATFORM_SECRET が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedPlatformAuthSecret;
}

/**
 * 🔴 T-10-06: `A-012` / API-A16 が読む「合成データの投入経路」（docs/05 §13.6「T-10-06 の実装の決着」）。
 *
 * - `appEnv` … 導線と API の可否を決める材料。判定そのもの（`demo` / `development` のみ）は `packages/config` の
 *   `isSeedableAppEnv` が唯一の出所であり、ここでは環境名を写すだけ（`if (APP_ENV === 'demo')` を散らさない）。
 * - `databaseUrl` … `SEED_DATABASE_URL`。未設定は `null`（フォールバック無し）。
 * 🔴 ルート以外（主平面・ジョブ）から呼ばない。特権接続の文字列が主平面の経路に流れないよう、
 *    呼び出し元は API-A16 の 2 ルート（`apps/web/app/api/admin/demo/seed/route.ts` / ✅ T-10-07 `…/demo/reset/route.ts`）に固定する
 *    （`tests/static/auth-db-callers.test.ts` の `demoSeedRuntime` が機械的に固定する）。
 */
export function demoSeedRuntime(): { readonly appEnv: AppEnvKind; readonly databaseUrl: string | null } {
  ensureDbConfigured();
  return { appEnv: currentAppEnv(), databaseUrl: cachedSeedDatabaseUrl };
}
