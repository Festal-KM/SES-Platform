// apps/worker/src/runtime.ts
// 🔴 ワーカーの実行時配線（docs/05 §9.1 / §9.3 / §13.1）。T-07-11。
//
// ============================================================================
// 🔴 このファイルの位置づけ
// ============================================================================
// `main.ts` が `bootstrapWorker()`（= `initializeRuntimeConfig`）で解決した `RuntimeConfig` を
// 受け取り、**キュー・ワーカー・スケジュールを 1 回だけ組み立てる**。
// 🔴 `process.env` を読まない（docs/05 §13.1。値の出所は `packages/config` の 1 箇所）。
// 🔴 `APP_ENV` で外部連携の実装を選び直さない（選択は `resolveConnectorSelection` が済ませており、
//    ここが見るのは `connectors.*`（`real` / `mock` / `sandboxRecipientScoped`）だけである）。
//    唯一の例外が `resolveMockAiOptions`（下記。**モックの応答内容**の決定であり、実装種別の
//    選択ではない。`apps/web` の `resolveInviteUrlRuntime` と同じ位置づけ）。
//
// ============================================================================
// 🔴 遅延生成にしている理由（`development` で起動できることが受け入れ基準①）
// ============================================================================
// `development` の `malwareScanner` は **ClamAV（未登録）** である（docs/05 §13.1 の表 /
// §8.5.1 の ⚠️）。`createConnectors`（5 区分を一度に作る）を起動時に呼ぶと、
// **ワーカーそのものが起動しなくなる**。したがって区分単位のファクトリ
// （`createEmailSender` / `createMalwareScanner`）を **getter で遅延**させ、
// 未登録の区分に触れるジョブ（`scan.poll`）だけが実行時に失敗するようにしてある。
// 🔴 **モックへフォールバックしない**（`CLAUDE.md` §11.1）。落ちるのが正しい。
//
// ============================================================================
// 🔴 本タスクで配線するのは「`gate.run` の Worker」と「スケジュール 5 本」だけである
// ============================================================================
// イベント起動のキュー（`email.dispatch` / `account.mail` / `webhook.process` /
// `scan.apply-result` / `domain.provision` / `domain.verify`）の Worker は**まだ無い**。
// 積まれたジョブは Redis に残り続ける（失われない）が、消費されるのは各キューの配線を行う
// 後続タスクの後である。**持ち主を docs/05 §13.1 の一覧に書いてある**（無主にしない）。

import {
  catalogRoleModelResolver,
  createAiClient,
  createAnthropicMessagesApi,
  DEMO_MOCK_ANTHROPIC_SCRIPT,
  type AiClientRuntimeOptions,
  type MockAnthropicClientOptions,
  type RoleModelResolver,
} from '@ses/ai';
import {
  INVITATION_TTL_MS,
  SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS,
  type AppEnvKind,
  type RuntimeConfig,
} from '@ses/config';
import {
  createEmailSender,
  createMalwareScanner,
  isQueueName,
  type AccountMailJob,
  type EmailSender,
  type MalwareScanner,
  type OperationalMailDispatch,
  type ProviderSendCounter,
  type QueueName,
  type SesIdentityApi,
} from '@ses/connectors';
import { createObjectTagApi, createSesApi } from '@ses/connectors/aws';
import {
  createBullMqGateRunQueue,
  createBullMqJobEnqueuer,
  createBullMqSchedule,
  createBullMqWorker,
  createRedisProviderSendCounter,
  type BullMqConnection,
} from '@ses/connectors/bullmq';
import { configureTenantDb, configureTokenEncryption, listSchedulerFanoutTenants } from '@ses/db';
import {
  createAccountMailReissue,
  createGateRunHandler,
  GATE_RUN_JOB,
  SCHEDULED_JOBS,
  type ScheduledJobDeps,
  type SendHoldRelease,
} from './jobs/index.js';
import { runScheduled, type SchedulerRunDetail } from './scheduler.js';

/** 停止できるもの（`close()` を 1 本にまとめるための最小の形）。 */
type Closable = { close(): Promise<void> };

export type WorkerRuntime = {
  /** スケジュール（Repeatable Job）の登録が Redis に届くまで。起動ログの前に待つ。 */
  readonly ready: Promise<void>;
  /** 配線したキュー名（起動ログに出す。何が待ち受けているかを運用が確認できるように）。 */
  readonly queues: readonly string[];
  close(): Promise<void>;
};

/**
 * 🔴 `MockAnthropicClient` の既定応答（Issue #44 / `Q-07-2` の回答 ①。docs/05 §13.2）。
 *
 *   - **`demo` は常時 PASS**（営業が実演する環境。合成データしか入らない）
 *   - 🔴 **`development` は未設定のまま**（`MockAnthropicNotConfiguredError`）。
 *     「ゲートが実質的に無効な環境」を最小限に留めるのがこの決定の趣旨である。
 *     **ここに `development` の枝を足さないこと**（足すと決定が覆る）。
 *   - `sandbox` / `staging` / `production` は `ai: 'real'` であり、この関数の結果は使われない。
 *
 * 🔴 判断を 1 箇所に閉じるために関数にしてある（`apps/web` の `resolveInviteUrlRuntime` と同型）。
 *    呼び出し側に `if (APP_ENV === 'demo')` を書かせない。
 */
export function resolveMockAiOptions(appEnv: AppEnvKind): MockAnthropicClientOptions {
  return appEnv === 'demo' ? { script: DEMO_MOCK_ANTHROPIC_SCRIPT } : {};
}

/**
 * 🔴 `send.*`（`Proposal` / `Contract`）の保留を復帰させる seam の**未実装版**（SP-09 T-09-06）。
 *
 * 🔴 「0 件復帰させた」は**現時点では事実**である —— `sendHoldReasonKey` を**書くコードが
 *    リポジトリに 1 つも無い**（`tests/static/send-hold-seam.test.ts` が 0 件であることを固定し、
 *    SP-09 が書いた瞬間に落ちる）。したがってこれは「配ったつもりで配れていない」ではなく
 *    「配る対象がまだ存在しない」である。
 * 🔴 SP-09 T-09-06 がここに実装を挿すまで、この関数を消さないこと（消すと `send.hold-release` の
 *    deps が欠けてコンパイルが通らなくなる = 気づける形が壊れる）。
 */
export const sendHoldReleaseNotImplemented: SendHoldRelease = () => Promise.resolve(0);

/**
 * 🔴 ワーカーを起動する（プロセスにつき 1 回。`main.ts` からのみ呼ぶ）。
 *
 * @param config `bootstrapWorker()` が返した値。**ここで `process.env` を読み直さない。**
 */
export function startWorkerRuntime(config: RuntimeConfig): WorkerRuntime {
  const { env, connectors } = config;

  // --------------------------------------------------------------------------
  // 0. DB クライアントと暗号鍵（`apps/web/lib/db/bootstrap.ts` と同じ位置づけ）
  // --------------------------------------------------------------------------
  // 🔴 **これが無いとジョブは 1 つも DB に触れない**（`getBaseClient()` が例外になる）。
  //    値の出所は `packages/config` だけであり、`packages/db` に `process.env` を読ませない。
  // 🔴 管理平面のプール（`PLATFORM_*`）は**組み立てない**。ワーカーは運営者の操作を行わない
  //    （`CLAUDE.md` §10.5。持たせると分離バイパスの経路がジョブ側にも開く）。
  configureTenantDb({ datasourceUrl: env.DATABASE_URL });
  configureTokenEncryption({
    key: env.TOKEN_ENCRYPTION_KEY,
    keyId: env.TOKEN_ENCRYPTION_KEY_ID,
    previous: env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
  });

  const connection: BullMqConnection = { url: env.REDIS_URL };
  const closables: Closable[] = [];
  const track = <T extends Closable>(closable: T): T => {
    closables.push(closable);
    return closable;
  };

  // --------------------------------------------------------------------------
  // 1. AI 層（`gate.run` が使う 3 つ。起動時に 1 回だけ組み立てる。docs/05 §7.12 ⑤）
  // --------------------------------------------------------------------------
  const aiOptions: AiClientRuntimeOptions =
    connectors.ai === 'real'
      ? {
          // 🔴 `ANTHROPIC_API_KEY` は `real` の環境でスキーマ上必須である（`packages/config`）。
          //    未設定なら**起動時に**落ちており、ここへは来ない（モックへ倒さない）。
          messagesApi: createAnthropicMessagesApiFrom(env.ANTHROPIC_API_KEY),
        }
      : { mock: resolveMockAiOptions(env.APP_ENV) };
  const aiClient = createAiClient(connectors.ai, aiOptions);
  const models: RoleModelResolver = catalogRoleModelResolver({
    DEFAULT: env.ANTHROPIC_MODEL_DEFAULT,
    CHEAP: env.ANTHROPIC_MODEL_CHEAP,
  });
  // 🔴 十進文字列で持つ（金額は整数演算で扱う。docs/05 §7.11 / §7.12 ⑥）。
  const aiDailyCostLimitUsd = String(env.AI_DAILY_COST_LIMIT_USD_DEFAULT);

  // --------------------------------------------------------------------------
  // 2. キュー（enqueue 側）
  // --------------------------------------------------------------------------
  const gateRunQueue = track(createBullMqGateRunQueue(connection));
  const emailDispatchQueue = track(
    createBullMqJobEnqueuer<OperationalMailDispatch>({ queueName: 'email.dispatch', connection }),
  );
  const accountMailQueue = track(
    createBullMqJobEnqueuer<AccountMailJob>({ queueName: 'account.mail', connection }),
  );

  // --------------------------------------------------------------------------
  // 3. 外部連携（🔴 遅延。未登録の区分に触れたジョブだけが失敗する）
  // --------------------------------------------------------------------------
  let emailSender: EmailSender | null = null;
  let malwareScanner: MalwareScanner | null = null;
  let sentCounter: ProviderSendCounter | null = null;
  let identityApi: SesIdentityApi | null = null;

  const resolveSentCounter = (): ProviderSendCounter => {
    if (sentCounter === null) {
      // 🔴 プロセス横断のカウンタ（docs/05 §8.3-Q ③）。プロセス内カウンタへ倒さない ——
      //    枠を過小評価して「空いている」と誤認し、上限を超えて送る側へ倒れる。
      const created = track(createRedisProviderSendCounter(connection));
      sentCounter = created.counter;
    }
    return sentCounter;
  };
  const resolveEmailSender = (): EmailSender => {
    emailSender ??= createEmailSender(connectors.email, {
      ses: {
        api: createSesApi({ region: env.AWS_REGION, accountId: env.AWS_ACCOUNT_ID }),
        defaultFromAddress: env.SES_DEFAULT_FROM_ADDRESS,
        configurationSet: env.SES_CONFIGURATION_SET,
        sentCounter: resolveSentCounter(),
      },
    });
    return emailSender;
  };
  const resolveMalwareScanner = (): MalwareScanner => {
    malwareScanner ??= createMalwareScanner(connectors.malwareScanner, {
      scan: {
        provider: env.MALWARE_SCANNER === 'clamav' ? 'clamav' : 'guardduty',
        api: createObjectTagApi(s3ApiOptionsOf(env)),
        bucket: env.S3_BUCKET,
      },
    });
    return malwareScanner;
  };
  const resolveIdentityApi = (): SesIdentityApi => {
    // 🔴 `email` がモックの環境（`development` / `demo`）では **SES を作らない**。
    //    作ると、非本番から AWS の実 API（`GetEmailIdentity`）へ出ていく経路ができる
    //    （`CLAUDE.md` §11.1。読み取りであっても「非本番から実 API」は作らない）。
    if (connectors.email === 'mock') {
      throw new Error(
        'domain.recheck は SES の identity API を要求しますが、この環境の email はモックです' +
          '（SesIdentityApi のモック実装は未登録。docs/05 §13.2）。モックへ倒さず停止します。',
      );
    }
    identityApi ??= createSesApi({ region: env.AWS_REGION, accountId: env.AWS_ACCOUNT_ID });
    return identityApi;
  };

  // --------------------------------------------------------------------------
  // 4. スケジュールジョブの deps（🔴 交差型。1 つでも欠けたらコンパイルエラー）
  // --------------------------------------------------------------------------
  const now = (): Date => new Date();
  const deps: ScheduledJobDeps = {
    now,
    // usage.seat-snapshot
    countPartnerSeats: SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS,
    // domain.recheck
    get identityApi(): SesIdentityApi {
      return resolveIdentityApi();
    },
    // send.hold-release
    get emailSender(): Pick<EmailSender, 'getQuota'> {
      return resolveEmailSender();
    },
    providerDailyQuota: env.MAIL_PROVIDER_DAILY_QUOTA,
    providerQuotaWarnRatio: env.MAIL_PROVIDER_QUOTA_WARN_RATIO,
    get providerSentCounter(): ProviderSendCounter {
      return resolveSentCounter();
    },
    enqueueEmailDispatch: (job: OperationalMailDispatch) => emailDispatchQueue.enqueue(job),
    reissueAccountMail: createAccountMailReissue({
      enqueueAccountMail: (job: AccountMailJob) => accountMailQueue.enqueue(job),
      invitationTtlMs: INVITATION_TTL_MS,
      now,
    }),
    releaseSendHolds: sendHoldReleaseNotImplemented,
    // scan.poll
    get malwareScanner(): MalwareScanner {
      return resolveMalwareScanner();
    },
    stallAlertMinutes: env.SCAN_STALL_ALERT_MINUTES,
    // gate.hold-release
    models,
    aiDailyCostLimitUsd,
    enqueueGateRun: (job) => gateRunQueue.enqueue(job),
  };

  // --------------------------------------------------------------------------
  // 5. `gate.run` の Worker（イベント起動。スケジュールではない）
  // --------------------------------------------------------------------------
  const gateRunHandler = createGateRunHandler({ now, aiClient, models, aiDailyCostLimitUsd });
  track(
    createBullMqWorker({
      queueName: GATE_RUN_JOB,
      connection,
      handler: (payload, jobId) => gateRunHandler(payload, jobId),
    }),
  );

  // --------------------------------------------------------------------------
  // 6. スケジュール 5 本（🔴 宣言（`SCHEDULED_JOBS`）を舐めるだけ。ここに名前を書き写さない）
  // --------------------------------------------------------------------------
  const ready: Promise<void>[] = [];
  for (const declaration of SCHEDULED_JOBS) {
    // 🔴 宣言（`SCHEDULED_JOBS`）とキュー定義（`QUEUE_DEFINITIONS`）は別々に管理されている。
    //    片方だけに存在する名前は**起動時に落とす**（`requireQueueName` の 🔴）。
    const queueName = requireQueueName(declaration.name);
    const handler = declaration.createHandler(deps);
    track(
      createBullMqWorker({
        queueName,
        connection,
        handler: async (_payload, jobId) =>
          runScheduled({
            jobName: declaration.name,
            jobId,
            now,
            handler: () => fanOutToTenants(declaration.name, jobId, handler),
          }),
      }),
    );
    const schedule = track(
      createBullMqSchedule({
        queueName,
        connection,
        cron: declaration.cron,
        timeZone: declaration.timeZone,
      }),
    );
    ready.push(schedule.ready);
  }

  return {
    ready: Promise.all(ready).then(() => undefined),
    queues: [GATE_RUN_JOB, ...SCHEDULED_JOBS.map((declaration) => declaration.name)],
    async close(): Promise<void> {
      // 🔴 逆順に閉じる（Worker → スケジュール → キュー）。閉じ損ねを黙って飲まない。
      // 🔴 **DB クライアントはここで切らない** —— Prisma クライアントはプロセスに 1 つであり
      //    （`configureTenantDb`）、実行時ランタイムの所有物ではない。切ると、同一プロセスで
      //    別のランタイムが動いている場合にそちらの DB まで落とすことになる。
      for (const closable of [...closables].reverse()) await closable.close();
    },
  };
}

/**
 * 🔴 宣言されたジョブ名に対応するキュー定義があることを、**起動時に**確かめる。
 *
 * 🔴 実際に起きた見落としを塞ぐためにある —— `usage.seat-snapshot` は T-03-10 で
 *    `SCHEDULED_JOBS` にだけ置かれ、`QUEUE_DEFINITIONS` には無いまま T-07-11 まで残った
 *    （配線が無かったので誰も気づかなかった）。定義が無いまま `Queue` を作ろうとすると
 *    BullMQ の内側で意味の分からない TypeError になる。**ここで名指しで落とす。**
 */
function requireQueueName(name: string): QueueName {
  if (!isQueueName(name)) {
    throw new Error(
      `スケジュール宣言 '${name}' に対応するキュー定義がありません` +
        '（packages/connectors/src/queues.ts の QUEUE_DEFINITIONS に追加してください。docs/05 §9.1）。',
    );
  }
  return name;
}

/**
 * 🔴 テナントのファンアウト（docs/05 §9.1「payload に `tenantId` を必ず含める」）。
 *
 * 🔴 **母集団を決めるのは DB 側**（`app_list_scheduler_tenants()`。`SANDBOX` / `ACTIVE` のみ）。
 *    ここで `where` を書き足さない —— 条件が 2 箇所に分かれると片方だけが古くなる。
 *    判断とその理由は migration 20260915000000 の判断事項 3 / docs/05 §9.1 にある。
 * 🔴 **1 テナントの失敗で他のテナントを止めない。** 止めると、1 社の設定不備で全社の
 *    満了アラートやゲート復帰が落ちる。失敗は数えて `SchedulerRun.detail` に残し、
 *    **1 件でも失敗したら最後に throw する**（BullMQ の失敗ジョブとして `A-005` に出す）。
 * 🔴 直列に回す。並列にすると LLM のレート制御とコスト予約が同時に走り、
 *    上限の判定がテナントをまたいで揺れる（`gate.hold-release`）。
 */
export async function fanOutToTenants(
  jobName: string,
  jobId: string,
  handler: (payload: unknown, jobId: string) => Promise<unknown>,
): Promise<SchedulerRunDetail> {
  const tenantIds = await listSchedulerFanoutTenants();
  let succeeded = 0;
  let failed = 0;
  let lastError: unknown = null;
  for (const tenantId of tenantIds) {
    try {
      await handler({ tenantId }, jobId);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      lastError = error;
    }
  }
  if (failed > 0) {
    throw new SchedulerFanOutError(jobName, { tenants: tenantIds.length, succeeded, failed }, lastError);
  }
  return { tenants: tenantIds.length, succeeded, failed };
}

/** 🔴 ファンアウト中に 1 件以上のテナントで失敗した（件数だけを持つ。対象の値を載せない）。 */
export class SchedulerFanOutError extends Error {
  constructor(
    jobName: string,
    readonly counts: { readonly tenants: number; readonly succeeded: number; readonly failed: number },
    override readonly cause: unknown,
  ) {
    super(
      `${jobName}: ${counts.failed}/${counts.tenants} 件のテナントで失敗しました` +
        '（docs/05 §9.1。1 テナントの失敗で他を止めない設計です）',
    );
    this.name = 'SchedulerFanOutError';
  }
}

/** `@ses/connectors/aws` の S3 クライアント設定（`apps/web` の `bootstrap.ts` と同じ形）。 */
function s3ApiOptionsOf(env: RuntimeConfig['env']): Parameters<typeof createObjectTagApi>[0] {
  return {
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
}

/**
 * 🔴 SDK アダプタの生成（`ai: 'real'` のときだけ通る）。
 *
 * `packages/config` は `real` の環境で `ANTHROPIC_API_KEY` を必須にしているため、ここが
 * `undefined` を受け取ることは無い。**それでも黙ってモックへ倒さない**（`CLAUDE.md` §11.1）。
 */
function createAnthropicMessagesApiFrom(apiKey: string | undefined): AiClientRuntimeOptions['messagesApi'] {
  if (apiKey === undefined) {
    throw new Error(
      'ANTHROPIC_API_KEY が設定されていません（ai=real の環境では必須です。docs/05 §13.4）。',
    );
  }
  return createAnthropicMessagesApi({ apiKey });
}
