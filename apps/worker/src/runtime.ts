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
//    選択ではない。`apps/web` の `resolveInviteUrlRuntime` と同じ位置づけ）。メールのモックの台本
//    （`WorkerRuntimeOptions.mockEmailScript` / `mockEmailScriptByRecipientDomain`。T-09-07 / T-09-11）と AI のモックの台本
//    （`mockAnthropicScript`。T-09-11。E2E ハーネスが `demo` 相当を明示的に配る）も同じ性質だが、`APP_ENV` を見ずに
//    **呼び出し側（テスト）**が渡す。
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
// 🔴 配線するのは「`gate.run` の Worker」「`send.proposal` の Worker（T-09-06）」と「スケジュール」である
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
  MockAnthropicScriptNotApplicableError,
  type AiClientRuntimeOptions,
  type MockAnthropicClientOptions,
  type MockAnthropicStep,
  type RoleModelResolver,
} from '@ses/ai';
import {
  INVITATION_TTL_MS,
  SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS,
  USAGE_GAP_CHECK_LOOKBACK_DAYS,
  type AppEnvKind,
  type RuntimeConfig,
} from '@ses/config';
import {
  createEmailSender,
  createMalwareScanner,
  createObjectStore,
  InMemoryMinuteWindowCounter,
  isQueueName,
  MockEmailScriptNotApplicableError,
  type AccountMailJob,
  type EmailSender,
  type MalwareScanner,
  type MinuteWindowCounter,
  type MockEmailStep,
  type ObjectStore,
  type OperationalMailDispatch,
  type ProviderSendCounter,
  type QueueName,
  type SesIdentityApi,
} from '@ses/connectors';
import { createObjectTagApi, createS3Api, createSesApi } from '@ses/connectors/aws';
import { PRICING_RULESET_V1 } from '@ses/domain';
import {
  createBullMqGateRunQueue,
  createBullMqJobEnqueuer,
  createBullMqSchedule,
  createBullMqSendProposalQueue,
  createBullMqWorker,
  createRedisProviderSendCounter,
  type BullMqConnection,
} from '@ses/connectors/bullmq';
import {
  configureTenantDb,
  configureTokenEncryption,
  listSchedulerFanoutTenants,
  type SchedulerFanoutPopulation,
} from '@ses/db';
import {
  billingTermsNotRecorded,
  createAccountMailReissue,
  createGateRunHandler,
  createSendProposalHandler,
  GATE_RUN_JOB,
  resolveEmailTenantsBillingPolicy,
  resolveProposalSendingDomainFromDb,
  SCHEDULED_JOBS,
  SEND_PROPOSAL_JOB,
  type ScheduledJobDeps,
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
 * 🔴 T-09-07: 起動時に渡せる**テスト用の注入**（E2E ハーネス = T-09-11 / 結合テスト）。`main.ts` は渡さない。
 *
 * - `mockEmailScript` … モックの `EmailSender` の台本（`@ses/connectors` の `MockEmailStep[]`。応答不明 / ネットワーク断 /
 *   明示的拒否の再現）。`MockAnthropicClient` の `script`（`resolveMockAiOptions`）と同型の口である。
 *   🔴 `connectors.email === 'real'` の環境で渡すと**起動時に**落ちる（`createEmailSender` の
 *   `MockEmailScriptNotApplicableError`。ここでも先に検査し、遅延生成で最初の送信まで気づかない形にしない）。
 *   台本の有無で実装種別を選び直すことはない（選択は `resolveConnectorSelection` の 1 箇所）。
 * - `mockEmailScriptByRecipientDomain` … 🔴 T-09-11: 宛先ドメイン別・試行番号で引く台本（`MockEmailRuntimeOptions` の
 *   同名項目）。E2E ハーネスは 1 プロセスの worker を全 spec で共有するため、呼び出し順の台本では「何番目が応答不明か」が
 *   実行順に依存する。`real` の検査は `mockEmailScript` と同じ（どちらか 1 つでも渡されていれば起動時に落とす）。
 * - `mockAnthropicScript` … 🔴 T-09-11: `MockAnthropicClient` の台本（`@ses/ai` の `MockAnthropicStep[]`）。E2E ハーネスが
 *   `demo` 相当の応答（`DEMO_MOCK_ANTHROPIC_SCRIPT`）を**明示的に**配るための口（Issue #47 の既定値 = 選択肢 1）。
 *   🔴 `development` の既定応答は置かない（Issue #44 の決定。`resolveMockAiOptions` に `development` の枝を足すのではなく、
 *   呼び出し側〔ハーネス〕が渡す）。🔴 `connectors.ai === 'real'` に渡すと**起動時に**落ちる（`@ses/ai` の
 *   `MockAnthropicScriptNotApplicableError`。`createAiClient` も同じ検査を持つ）。
 */
export type WorkerRuntimeOptions = {
  readonly mockEmailScript?: readonly MockEmailStep[];
  readonly mockEmailScriptByRecipientDomain?: Readonly<Record<string, readonly MockEmailStep[]>>;
  readonly mockAnthropicScript?: readonly MockAnthropicStep[];
};

/**
 * 🔴 ワーカーを起動する（プロセスにつき 1 回。`main.ts` からのみ呼ぶ）。
 *
 * @param config `bootstrapWorker()` が返した値。**ここで `process.env` を読み直さない。**
 * @param options テスト用の注入（T-09-07 / T-09-11）。本番の起動経路（`main.ts`）は渡さない。
 */
export function startWorkerRuntime(config: RuntimeConfig, options: WorkerRuntimeOptions = {}): WorkerRuntime {
  const { env, connectors } = config;
  // 🔴 T-09-07: モックの台本は `real` に適用できない。遅延生成（`resolveEmailSender`）に任せず起動時に落とす。
  const hasMockEmailOptions =
    options.mockEmailScript !== undefined || options.mockEmailScriptByRecipientDomain !== undefined;
  if (hasMockEmailOptions && connectors.email === 'real') {
    throw new MockEmailScriptNotApplicableError(connectors.email);
  }
  // 🔴 T-09-11: AI の台本も同じ規律（`ai: 'real'` = `sandbox` 以上に渡されたら起動を止める）。
  if (options.mockAnthropicScript !== undefined && connectors.ai === 'real') {
    throw new MockAnthropicScriptNotApplicableError(connectors.ai);
  }
  const mockEmail = hasMockEmailOptions
    ? {
        mockEmail: {
          script: options.mockEmailScript ?? [],
          ...(options.mockEmailScriptByRecipientDomain === undefined
            ? {}
            : { scriptByRecipientDomain: options.mockEmailScriptByRecipientDomain }),
        },
      }
    : {};

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
      : {
          // 🔴 T-09-11: 明示的に渡された台本（E2E ハーネス）が既定（`resolveMockAiOptions`）に優先する。`development` の
          //    既定は空のまま（Issue #44）。
          mock:
            options.mockAnthropicScript === undefined
              ? resolveMockAiOptions(env.APP_ENV)
              : { script: options.mockAnthropicScript },
        };
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
  // 🔴 T-09-06: `send.proposal` の enqueue 口（`send.hold-release` が同じ `attemptSeq` で再 enqueue する。docs/05 §9.4）。
  //    `jobId` は実装が組み立てる（`sendProposalJobId`）。`attempts` を渡す口は無い。
  const sendProposalQueue = track(createBullMqSendProposalQueue(connection));

  // --------------------------------------------------------------------------
  // 3. 外部連携（🔴 遅延。未登録の区分に触れたジョブだけが失敗する）
  // --------------------------------------------------------------------------
  let emailSender: EmailSender | null = null;
  let malwareScanner: MalwareScanner | null = null;
  let sentCounter: ProviderSendCounter | null = null;
  let identityApi: SesIdentityApi | null = null;
  let objectStore: ObjectStore | null = null;

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
      ...mockEmail,
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
  // 🔴 T-10-02: `usage.storage-reconcile` の検算に使うオブジェクトストア。`apps/web/lib/db/bootstrap.ts` の
  //    `objectStore()` と同じ組み立て（`development` = MinIO の `real` / `demo` = モック）。ここに環境分岐は無く、
  //    実装種別は起動時に `resolveConnectorSelection` が決めた `connectors.objectStore` だけを見る。
  const resolveObjectStore = (): ObjectStore => {
    objectStore ??= createObjectStore(connectors.objectStore, {
      s3: {
        api: createS3Api(s3ApiOptionsOf(env)),
        bucket: env.S3_BUCKET,
        ...(env.S3_KMS_KEY_ID === undefined ? {} : { kmsKeyId: env.S3_KMS_KEY_ID }),
        presignedUrlTtlSeconds: env.S3_PRESIGNED_URL_TTL_SECONDS,
      },
    });
    return objectStore;
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
    // 🔴 T-09-06: `Proposal` の保留の復帰（docs/05 §9.4 / §10.4）。`RATE_LIMIT` の解消判定は送信ジョブの ①-e と
    //    **同じキー**（`EMAIL_DAILY_LIMIT_PER_TENANT`）から読む。
    enqueueSendProposal: (job) => sendProposalQueue.enqueue(job),
    emailDailyLimit: env.EMAIL_DAILY_LIMIT_PER_TENANT,
    // scan.poll
    get malwareScanner(): MalwareScanner {
      return resolveMalwareScanner();
    },
    stallAlertMinutes: env.SCAN_STALL_ALERT_MINUTES,
    // gate.hold-release
    models,
    aiDailyCostLimitUsd,
    enqueueGateRun: (job) => gateRunQueue.enqueue(job),
    // 🔴 T-10-02: usage.gap-check / usage.storage-reconcile / cost.monthly-rollup（docs/05 §9.8）
    gapCheckLookbackDays: USAGE_GAP_CHECK_LOOKBACK_DAYS,
    get objectStore(): Pick<ObjectStore, 'measureTenantUsage'> {
      return resolveObjectStore();
    },
    // 🔴 契約条件は Phase 3（`A-010` / `planAccess.ts`）まで記録されない = 売上 0（seam。`cost-monthly-rollup.ts`）。
    billingTerms: billingTermsNotRecorded,
    // 🔴 SES Tenants 課金の環境判定は**ここで 1 回**（docs/05 §8.8 / §13.1）。ジョブは `APP_ENV` を読まない。
    emailTenantsBillingPolicy: resolveEmailTenantsBillingPolicy(env.APP_ENV),
    pricingRuleset: PRICING_RULESET_V1,
    // 🔴 T-10-03: usage.limit-check（docs/02 F-027）。上限値の出所は `packages/config` だけ（プラン別の上書きが
    //    入るまでの既定値。docs/05 §7.12 ⑧）。`GET /api/usage`（#69）が同じ値を `usageLimitsRuntime()` から読む。
    usageLimits: {
      warnPercent: env.QUOTA_WARNING_THRESHOLD_PERCENT,
      aiUnitQuotas: {
        AI_UNIT_SHEET_PARSE: env.AI_UNIT_QUOTA_SHEET_PARSE_DEFAULT,
        AI_UNIT_MATCH_RATIONALE: env.AI_UNIT_QUOTA_MATCH_RATIONALE_DEFAULT,
        AI_UNIT_PROPOSAL_DRAFT: env.AI_UNIT_QUOTA_PROPOSAL_DRAFT_DEFAULT,
        AI_UNIT_RENEWAL_SUMMARY: env.AI_UNIT_QUOTA_RENEWAL_SUMMARY_DEFAULT,
      },
      emailDailyLimit: env.EMAIL_DAILY_LIMIT_PER_TENANT,
      storageLimitBytes: BigInt(env.STORAGE_LIMIT_BYTES_PER_TENANT),
    },
    // 🔴 T-09-07: send.settle-unknown（docs/05 §10.6）。閾値は `A-005` 項目 2（`readSubmittingStalls`）と同じキー。
    submittingStallMinutes: env.SUBMITTING_STALL_ALERT_MINUTES,
    // 🔴 T-10-12: tenant.closing-notify（docs/05 §9.7）。削除予定日 = `closing_entered_at + TENANT_PURGE_GRACE_DAYS`。
    //    `A-005` 項目 15（`readPurgeNoticePending` の `graceDays`）と同じキーから読む。
    purgeGraceDays: env.TENANT_PURGE_GRACE_DAYS,
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
  // 5b. `send.proposal` の Worker（T-09-06。イベント起動。docs/05 §10.2 / §9.4）
  // --------------------------------------------------------------------------
  // 🔴 `attempts: 1`（`QUEUE_DEFINITIONS`）。外部呼び出しの後に再試行しない（`BR-22`）。分次レートの待機（`DEFER`）は
  //    ハンドラが `deferJob` を返し、`createBullMqWorker` が同じジョブを delayed に移す（新しいジョブを積まない）。
  // 🔴 分次ウィンドウはプロセス内（`InMemoryMinuteWindowCounter`）。ワーカーは現時点で単一プロセスであり、
  //    複数プロセスにするときは Redis 版に差し替える（差し替えはこの 1 箇所。docs/05 §8.7 / T-09-06 の申し送り）。
  const minuteWindow: MinuteWindowCounter = new InMemoryMinuteWindowCounter();
  const sendProposalHandler = createSendProposalHandler({
    get emailSender(): EmailSender {
      return resolveEmailSender();
    },
    emailImplementationKind: connectors.email,
    minuteWindow,
    dailyLimit: env.EMAIL_DAILY_LIMIT_PER_TENANT,
    minuteLimit: env.EMAIL_MINUTE_LIMIT_PER_TENANT,
    providerDailyQuota: env.MAIL_PROVIDER_DAILY_QUOTA,
    get providerSentCounter(): ProviderSendCounter {
      return resolveSentCounter();
    },
    resolveSendingDomain: resolveProposalSendingDomainFromDb,
    staleThresholdMinutes: env.SEND_STALE_THRESHOLD_MINUTES,
    now,
  });
  track(
    createBullMqWorker({
      queueName: SEND_PROPOSAL_JOB,
      connection,
      handler: (payload, jobId) => sendProposalHandler(payload, jobId),
    }),
  );

  // --------------------------------------------------------------------------
  // 6. スケジュール（🔴 宣言（`SCHEDULED_JOBS`）を舐めるだけ。ここに名前を書き写さない。本数は宣言が決める
  //    —— T-07-11 で 5 本、T-08-07 で `proposal-request.expire`、T-10-02 で計測 4 本、T-10-03 で `usage.limit-check`、
  //    T-09-07 で `send.settle-unknown`、T-10-12 で `tenant.closing-notify` が加わり 13 本）
  // --------------------------------------------------------------------------
  const ready: Promise<void>[] = [];
  for (const declaration of SCHEDULED_JOBS) {
    // 🔴 宣言（`SCHEDULED_JOBS`）とキュー定義（`QUEUE_DEFINITIONS`）は別々に管理されている。
    //    片方だけに存在する名前は**起動時に落とす**（`requireQueueName` の 🔴）。
    const queueName = requireQueueName(declaration.name);
    const handler = declaration.createHandler(deps);
    // 🔴 T-10-12: 母集団は宣言が選ぶ（省略 = `LIVE`）。ここで `if (name === ...)` を書かない。
    const population = declaration.population;
    track(
      createBullMqWorker({
        queueName,
        connection,
        handler: async (_payload, jobId) =>
          runScheduled({
            jobName: declaration.name,
            jobId,
            now,
            handler: () => fanOutToTenants(declaration.name, jobId, handler, population),
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
    queues: [GATE_RUN_JOB, SEND_PROPOSAL_JOB, ...SCHEDULED_JOBS.map((declaration) => declaration.name)],
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
 * 🔴 **母集団を決めるのは DB 側**（`app_list_scheduler_tenants(population)`。既定 `LIVE` = `SANDBOX` / `ACTIVE`）。
 *    ここで `where` を書き足さない —— 条件が 2 箇所に分かれると片方だけが古くなる。
 *    判断とその理由は migration 20260915000000 の判断事項 3 / 20260926000000 / docs/05 §9.1 にある。
 * 🔴 T-10-12: `population` は宣言（`ScheduledJobDeclaration.population`）から来る。`CLOSING` を渡すのは解約手続き中の
 *    テナントだけを対象にするジョブ（`tenant.closing-notify`）であり、省略すれば従来どおり。
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
  population: SchedulerFanoutPopulation = 'LIVE',
): Promise<SchedulerRunDetail> {
  const tenantIds = await listSchedulerFanoutTenants(population);
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
