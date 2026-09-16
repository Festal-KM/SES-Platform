// packages/connectors/src/bullmq.ts
// 🔴 **BullMQ に触れる唯一のファイル**（docs/05 §9.1 / §17.2 #6 ⑤）。T-07-08。
//
// ============================================================================
// 🔴 なぜ `queues.ts` と分けるのか / なぜ `apps/worker` ではないのか
// ============================================================================
// ① `queues.ts` は「名前 + 既定ジョブオプション」の**素のデータ**であり、Redis 無しで
//    ユニットテスト・静的テスト（`tests/static/queue-attempts.test.ts`）から検査できることが
//    設計の担保そのものである（§9.1）。したがって BullMQ の import をあちらに持ち込まない。
// ② docs/05 §9.1 は当初「実体化は起動時に `apps/worker` が行う」と書いていた（T-04-01）。
//    **T-07-08 でこれを `packages/connectors` へ移す。** 理由は `gate.run` の enqueue 側が
//    `apps/web` にもあるからである（#39 と §9.10 の「failed の削除」）。`apps/worker` に置くと
//    `apps/web` → `apps/worker` の依存になり、`CLAUDE.md` §2.1（`apps/*` → `packages/*` の
//    一方向）を破る。決着は docs/05 §11.10 に記録した。
// 🔴 **実体化の箇所はこの 1 ファイルだけ**である（`QUEUE_CONSTRUCTION_ALLOWLIST` に
//    載っているのもここ 1 件）。2 件目を作らない。
//
// ============================================================================
// 🔴 このファイルが持ってよい判断は「BullMQ の API をどう呼ぶか」だけである
// ============================================================================
//   - `attempts` / `removeOnComplete` の**値**は `QUEUE_DEFINITIONS` からしか来ない
//     （ここで既定値を書かない。`.add()` の per-job オプションにも渡さない。§9.1 / §17.2 #6）。
//   - 「`failed` のときだけ消す」という**規則**は `shouldRemoveGateRunJob`（`queues.ts`）にある。
//     ここはその判定を呼ぶだけで、状態名を書き写さない。
import { DelayedError, Queue, Worker, type Job } from 'bullmq';
// 🔴 **Redis クライアントは我々が作って渡す**（`connection: { url }` を渡さない）。
//    BullMQ v6 は `ioredis` を optional peer にしており、接続設定だけを渡すと内部で
//    `require('ioredis')` を試みる。`apps/worker` は素の ESM で動くため `require` が無く、
//    **本番だけ「起動はするが最初の enqueue で落ちる」**という壊れ方になる（実測で確認した）。
//    インスタンスを渡す経路は CJS / ESM のどちらでも同じ 1 本である。
//    ⚠️ 名前付き import にしてある（`import Redis from 'ioredis'` は `module: NodeNext` の下で
//    **CJS モジュールの名前空間**に解決され、型として使えない）。実行時も Node の CJS 相互運用が
//    `Redis` を名前付き export として解決する（`packages/connectors` で実測）。
import { Redis } from 'ioredis';
import { RedisProviderSendCounter, type ProviderSendCounter } from './email/ses/counter.js';
import { RedisProviderQuotaNearingMarker, type ProviderQuotaNearingMarker } from './email/ses/nearing-marker.js';
import {
  gateRunJobId,
  isJobDeferral,
  queueDefinition,
  sendProposalJobId,
  shouldRemoveGateRunJob,
  steppedBackoffDelayMs,
  GATE_RUN_JOB,
  QUEUE_DEFINITIONS,
  SEND_PROPOSAL_JOB,
  type BackoffOptions,
  type GateRunEnqueueOutcome,
  type GateRunFailedJobRemoval,
  type GateRunJob,
  type GateRunJobKey,
  type GateRunJobQueue,
  type InternalQueueOptions,
  type QueueName,
  type SendJobEnqueueOutcome,
  type SendProposalJob,
  type SendProposalJobKey,
  type SendProposalJobQueue,
} from './queues.js';

/** 接続先（`packages/config` の `REDIS_URL`。**このファイルは `process.env` を読まない**）。 */
export type BullMqConnection = {
  readonly url: string;
};

/**
 * 🔴 BullMQ へ写像できない既定ジョブオプションが定義に現れた。
 *
 * **握り潰して近似しない。** 例えば `stepped` バックオフ（`email.dispatch` の 5s / 30s。§9.1）を
 * BullMQ の組み込み戦略に落とすと、設計値と実際の待ち時間が黙ってずれる。
 *
 * ✅ **T-07-10 で `stepped` は写像済み**（カスタム戦略 + `settings.backoffStrategy`）。
 *    この例外が残っているのは、**次に種別が増えたときに黙って近似されないようにする**ためであり、
 *    現在の `QUEUE_DEFINITIONS` からは到達しない（到達したら定義側の追加が写像されていない）。
 */
export class UnsupportedQueueOptionError extends Error {
  constructor(name: string, detail: string) {
    super(
      `キュー '${name}' の既定ジョブオプションを BullMQ に渡せません: ${detail}（docs/05 §9.1）。` +
        '近似せず、対応する配線を実装してください。',
    );
    this.name = 'UnsupportedQueueOptionError';
  }
}

/**
 * 🔴 `stepped` バックオフ（§9.1 / §9.4 の 5s / 30s）の**カスタム戦略の名前**。
 *
 * BullMQ は `backoff.type` が組み込み（`fixed` / `exponential`）以外のとき、
 * Worker の `settings.backoffStrategy` を `type` 付きで呼ぶ。**遅延の値はここに書かない** ——
 * 表（`delaysMs`）を持つのは `QUEUE_DEFINITIONS` だけであり、計算するのは
 * `steppedBackoffDelayMs`（純粋関数）だけである（§9.1 の 🔴「ワーカー側で待ち時間を計算し直さない」）。
 */
const STEPPED_BACKOFF_STRATEGY = 'stepped';

/**
 * キュー定義のバックオフを BullMQ の形に写す。
 *
 * 🔴 **値を作らない / 近似しない。** `fixed` / `exponential` は組み込みなのでそのまま渡し、
 *    `stepped` は**カスタム戦略の名前だけ**を渡す（実際の待ち時間は Worker 側の
 *    `backoffStrategy` が同じ定義から計算する。T-07-10 で配線した）。
 */
function toBullMqBackoff(name: string, backoff: BackoffOptions) {
  switch (backoff.type) {
    case 'fixed':
    case 'exponential':
      return { type: backoff.type, delay: backoff.delay };
    case 'stepped':
      // 🔴 `delay` を渡さない（BullMQ はカスタム戦略に `delay` を使わない）。表は定義側にある。
      return { type: STEPPED_BACKOFF_STRATEGY };
    default: {
      // 🔴 バックオフの種別が増えたらここでコンパイルエラーになる（黙って近似しない）。
      const exhaustive: never = backoff;
      throw new UnsupportedQueueOptionError(name, `未知のバックオフ種別: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * `QUEUE_DEFINITIONS` の既定ジョブオプションを BullMQ の形に写す。
 *
 * 🔴 **値を作らない。** 渡ってきた `attempts` / `removeOnComplete` をそのまま置くだけである。
 *
 * @internal ユニットテスト（`bullmq.test.ts`）が写像そのものを検査するために export する。
 *           業務経路が呼ぶことは無い（`createQueue` の内側だけで使う）。
 */
export function toBullMqJobOptions(name: string, options: InternalQueueOptions) {
  return {
    attempts: options.attempts,
    ...(options.backoff === undefined ? {} : { backoff: toBullMqBackoff(name, options.backoff) }),
    ...(options.removeOnComplete === undefined ? {} : { removeOnComplete: options.removeOnComplete }),
  };
}

/**
 * 🔴 Worker に渡すバックオフ戦略（§9.1「`backoffStrategy` に渡す関数はこの純粋関数だけ」）。
 *
 * 定義が `stepped` を持たないキューでも登録してよい —— BullMQ は
 * `backoff.type` がカスタム名のときしか呼ばないため、そのキューでは呼ばれない。
 * 🔴 万一呼ばれたら**握り潰さずに落とす**（0 を返すと即時再試行になり、設計値と実際の待ち時間が
 *    静かにずれる。§9.1 の「近似しない」）。
 *
 * @internal ユニットテストが「表どおりの待ち時間になる」ことを検査するために export する。
 */
export function bullMqBackoffStrategy(name: QueueName): (attemptsMade: number, type?: string) => number {
  const backoff: BackoffOptions | undefined = queueDefinition(name).defaultJobOptions.backoff;
  return (attemptsMade: number, type?: string): number => {
    if (backoff === undefined || backoff.type !== 'stepped') {
      throw new UnsupportedQueueOptionError(
        name,
        `カスタムのバックオフ戦略 '${String(type)}' を要求されましたが、キュー定義に stepped の表がありません`,
      );
    }
    return steppedBackoffDelayMs(attemptsMade, backoff.delaysMs);
  };
}

/**
 * Redis クライアント（`redis://` / `rediss://` の解釈は ioredis に任せる）。
 *
 * 🔴 `maxRetriesPerRequest: null` は BullMQ の要求である（ブロッキング読み出しを
 *    途中で諦めさせない）。**接続文字列は `packages/config` の `REDIS_URL` だけが出所**であり、
 *    このファイルは `process.env` を読まない。
 */
function createClient(connection: BullMqConnection): Redis {
  return new Redis(connection.url, { maxRetriesPerRequest: null });
}

/**
 * 定義どおりの `Queue` を 1 本作る。
 *
 * 🔴 `defaultJobOptions` は `QUEUE_DEFINITIONS` の値をそのまま渡す —— `gate.run` の
 *    `removeOnComplete: true`（§9.1）が実際に効くのはこの 1 行だけである。
 */
function createQueue(name: QueueName, client: Redis): Queue {
  const definition = queueDefinition(name);
  return new Queue(definition.name, {
    connection: client,
    defaultJobOptions: toBullMqJobOptions(definition.name, definition.defaultJobOptions),
  });
}

/**
 * BullMQ で実装した `gate.run` のキュー。
 *
 * 🔴 `jobState` / `close` は**ポート（`GateRunJobQueue`）に無い**。業務経路が使ってよいのは
 *    `enqueue` と `removeFailedJob` だけであり、状態の照会は結合テストと運用調査のためにある。
 */
export type BullMqGateRunQueue = GateRunJobQueue & {
  jobState(key: GateRunJobKey): Promise<string | null>;
  close(): Promise<void>;
};

/**
 * 🔴 `gate.run` の enqueue 先（docs/05 §9.3 / §9.10）。
 *
 * 🔴 **`Queue` は最初の呼び出しまで作らない。** 起動時 DI（`apps/web` の `bootstrap.ts`）は
 *    リクエストを 1 本も処理しない実行経路（結合テスト・ビルド）でも走るため、
 *    登録しただけで Redis へ接続しにいく実装にしない。
 */
export function createBullMqGateRunQueue(connection: BullMqConnection): BullMqGateRunQueue {
  let queue: Queue | null = null;
  let client: Redis | null = null;
  const resolve = (): Queue => {
    client ??= createClient(connection);
    queue ??= createQueue(GATE_RUN_JOB, client);
    return queue;
  };

  return {
    async enqueue(job: GateRunJob): Promise<GateRunEnqueueOutcome> {
      // 🔴 per-job オプションは `jobId` だけ（`attempts` / `backoff` を渡さない。§17.2 #6）。
      const added = await resolve().add(GATE_RUN_JOB, job, { jobId: gateRunJobId(job) });
      // 🔴 **BullMQ は同じ `jobId` が `failed` に残っている間、`add` を静かに無視して
      //    既存のジョブをそのまま返す**（例外を投げない。`removeOnFail` を付けていないため
      //    起こりうる。§9.1 / §9.10 ②）。戻り値を見ないと「積んだつもりで積まれていない」に
      //    なるため、**状態を 1 度だけ確かめて呼び出し側へ返す**。
      //    ⚠️ ここで失敗記録を消さない —— 消してよいのは §9.10 ② の運用操作（#39 / #28）だけである。
      return (await added.getState()) === 'failed' ? 'BLOCKED_BY_FAILED_JOB' : 'ENQUEUED';
    },
    async removeFailedJob(key: GateRunJobKey): Promise<GateRunFailedJobRemoval> {
      const job = await resolve().getJob(gateRunJobId(key));
      if (job === undefined) return 'NOT_FOUND';
      const state = await job.getState();
      // 🔴 規則は `queues.ts` にある（`waiting` / `active` を消さない）。
      if (!shouldRemoveGateRunJob(state)) return 'NOT_FAILED';
      await job.remove();
      return 'REMOVED';
    },
    async jobState(key: GateRunJobKey): Promise<string | null> {
      const job = await resolve().getJob(gateRunJobId(key));
      return job === undefined ? null : job.getState();
    },
    async close(): Promise<void> {
      // 🔴 クライアントは**我々が作ったので我々が閉じる**（BullMQ は渡された
      //    インスタンスを所有せず、`queue.close()` では切断しない）。
      if (queue !== null) await queue.close();
      if (client !== null) await client.quit();
      queue = null;
      client = null;
    },
  };
}

/**
 * BullMQ で実装した `send.proposal` のキュー（docs/05 §9.4 / §10.4。T-09-06）。
 *
 * 🔴 `jobState` / `close` は**ポート（`SendProposalJobQueue`）に無い**。業務経路が使ってよいのは `enqueue` だけであり、
 *    状態の照会は結合テストと運用調査のためにある（`BullMqGateRunQueue` と同じ整理）。
 */
export type BullMqSendProposalQueue = SendProposalJobQueue & {
  jobState(key: SendProposalJobKey): Promise<string | null>;
  close(): Promise<void>;
};

/**
 * 🔴 `send.proposal` の enqueue 先（`apps/web` の #43 / #44 と `apps/worker` の `send.hold-release` が使う）。
 *
 * 🔴 `Queue` は最初の呼び出しまで作らない（`createBullMqGateRunQueue` と同じ）。
 * 🔴 per-job オプションは `jobId` だけ（`attempts` / `backoff` / `delay` を渡さない。§17.2 #6）。既定ジョブオプション
 *    （`attempts: 1` / `removeOnComplete: true`）は `QUEUE_DEFINITIONS` の `externalSendQueue` から来る。
 */
export function createBullMqSendProposalQueue(connection: BullMqConnection): BullMqSendProposalQueue {
  let queue: Queue | null = null;
  let client: Redis | null = null;
  const resolve = (): Queue => {
    client ??= createClient(connection);
    queue ??= createQueue(SEND_PROPOSAL_JOB, client);
    return queue;
  };

  return {
    async enqueue(job: SendProposalJob): Promise<SendJobEnqueueOutcome> {
      const added = await resolve().add(SEND_PROPOSAL_JOB, job, { jobId: sendProposalJobId(job) });
      // 🔴 同じ `jobId` が `failed` に残っている間、BullMQ は `add` を静かに無視する（`removeOnFail` を付けていない）。
      //    「積んだつもりで積まれていない」を呼び出し側へ返す（`createBullMqGateRunQueue` と同じ）。
      return (await added.getState()) === 'failed' ? 'BLOCKED_BY_FAILED_JOB' : 'ENQUEUED';
    },
    async jobState(key: SendProposalJobKey): Promise<string | null> {
      const job = await resolve().getJob(sendProposalJobId(key));
      return job === undefined ? null : job.getState();
    },
    async close(): Promise<void> {
      if (queue !== null) await queue.close();
      if (client !== null) await client.quit();
      queue = null;
      client = null;
    },
  };
}

export type BullMqWorker = {
  close(): Promise<void>;
};

/** 後方互換の別名（T-07-08 で `gate.run` 専用として導入した型）。 */
export type BullMqGateRunWorker = BullMqWorker;

/**
 * 🔴 定義どおりの `Worker` を 1 本作る（`apps/worker` の起動配線と、結合テストが使う）。
 *
 * 🔴 **再試行は既定ジョブオプション（`QUEUE_DEFINITIONS`）が決める。** ここで `attempts` を
 *    上書きしない（`gate.run` の `attempts: 1` は LLM の再試行が `runRole` の内部で
 *    完結するからである。§9.3）。
 * 🔴 **待ち時間の計算をここに書かない。** `settings.backoffStrategy` に渡すのは
 *    `bullMqBackoffStrategy(queueName)`（中身は純粋関数 `steppedBackoffDelayMs`）だけであり、
 *    遅延の表は `QUEUE_DEFINITIONS` にしか無い（§9.1）。
 * 🔴 ハンドラは payload を検証してから使う（`parseGateRunPayload` など）。ここでは型を主張しない
 *    —— Redis から来た値は常に `unknown` である。
 * 🔴 T-09-06: ハンドラが `JobDeferral`（`deferJob`。docs/05 §10.5 の分次レートの**待機**）を返したら、
 *    **同じジョブ**を `retryAfterMs` 後の delayed に移す（`Job.moveToDelayed` + `DelayedError`。BullMQ の公式手順）。
 *    新しいジョブを `add` しない —— 同じ `jobId` が `active` の間は `add` が無視されるうえ、`attempts` を消費する
 *    再試行でもない。待機は `payload`（`attemptSeq` / `enqueuedAt`）を変えないので、遅延判定（②-a）は
 *    最初の enqueue 時刻から数え続ける。
 */
export function createBullMqWorker(options: {
  readonly queueName: QueueName;
  readonly connection: BullMqConnection;
  readonly handler: (payload: unknown, jobId: string) => Promise<unknown>;
  readonly concurrency?: number;
}): BullMqWorker {
  const client = createClient(options.connection);
  const worker = new Worker(
    queueDefinition(options.queueName).name,
    async (job: Job, token?: string) => {
      const result = await options.handler(job.data, job.id ?? '');
      if (isJobDeferral(result)) {
        await job.moveToDelayed(Date.now() + result.retryAfterMs, token);
        throw new DelayedError();
      }
      return result;
    },
    {
      connection: client,
      settings: { backoffStrategy: bullMqBackoffStrategy(options.queueName) },
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    },
  );
  return {
    async close(): Promise<void> {
      await worker.close();
      await client.quit();
    },
  };
}

/** 🔴 `gate.run` の実行側（T-07-08 からの呼び出し口をそのまま残す）。 */
export function createBullMqGateRunWorker(options: {
  readonly connection: BullMqConnection;
  readonly handler: (payload: unknown, jobId: string) => Promise<unknown>;
  readonly concurrency?: number;
}): BullMqGateRunWorker {
  return createBullMqWorker({ queueName: GATE_RUN_JOB, ...options });
}

// ============================================================================
// 🔴 T-07-11: スケジュール登録（Repeatable Job）と、内部ジョブの汎用 enqueue
// ============================================================================

/**
 * 内部ジョブを積む口（`gate.run` 以外の内部キュー用）。
 *
 * 🔴 **`attempts` / `backoff` を引数に取らない**（`GateRunJobQueue` と同じ理由。既定ジョブ
 *    オプションを決めるのは `QUEUE_DEFINITIONS` だけである。docs/05 §9.1 / §17.2 #6）。
 * 🔴 `gate.run` はこの口を使わない —— あちらは `jobId` を冪等キーに使い、`add` が静かに
 *    無視されたことを戻り値で返す必要がある（`GateRunEnqueueOutcome`）。**汎用の口に
 *    その意味を混ぜない**（混ぜると呼び出し側が戻り値を見なくなる）。
 */
export type BullMqJobEnqueuer<T> = {
  enqueue(payload: T): Promise<void>;
  close(): Promise<void>;
};

/**
 * 🔴 内部ジョブの enqueue 口を 1 本作る（`email.dispatch` / `account.mail` など）。
 *
 * 🔴 `Queue` は最初の enqueue まで作らない（`createBullMqGateRunQueue` と同じ。登録しただけで
 *    Redis へ接続しにいかない）。
 */
export function createBullMqJobEnqueuer<T>(options: {
  readonly queueName: QueueName;
  readonly connection: BullMqConnection;
}): BullMqJobEnqueuer<T> {
  let queue: Queue | null = null;
  let client: Redis | null = null;
  const resolve = (): Queue => {
    client ??= createClient(options.connection);
    queue ??= createQueue(options.queueName, client);
    return queue;
  };
  return {
    async enqueue(payload: T): Promise<void> {
      // 🔴 per-job オプションを渡さない（§17.2 #6 が `.add()` の第 3 引数に
      //    `attempts` / `backoff` が現れないことを走査で固定している）。
      await resolve().add(options.queueName, payload);
    },
    async close(): Promise<void> {
      if (queue !== null) await queue.close();
      if (client !== null) await client.quit();
      queue = null;
      client = null;
    },
  };
}

/**
 * スケジュール登録（BullMQ の Job Scheduler = Repeatable Job）。
 *
 * 🔴 **cron とタイムゾーンの出所はジョブ宣言（`SCHEDULED_JOBS`）だけ**であり、この関数は
 *    受け取った値をそのまま BullMQ に渡す（`Asia/Tokyo` を書き写さない。docs/05 §9.1）。
 * 🔴 **payload（テナント）を template に持たせない。** スケジューラが作るのは「そのキューの
 *    1 tick」であり、テナントのファンアウトは `apps/worker` 側が tick の中で行う
 *    （docs/05 §9.1 の決着。テナントを template に焼くと、増えたテナントが永久に走らない）。
 * 🔴 **`upsert` である**（同じ `schedulerId` で何度呼んでも 1 本に収束する）。ワーカーを
 *    複数プロセスで起動しても Repeatable Job は増えない。
 */
export type BullMqSchedule = {
  close(): Promise<void>;
};

export function createBullMqSchedule(options: {
  readonly queueName: QueueName;
  readonly connection: BullMqConnection;
  readonly cron: string;
  readonly timeZone: string;
}): BullMqSchedule & { readonly ready: Promise<void> } {
  const client = createClient(options.connection);
  const queue = createQueue(options.queueName, client);
  // 🔴 `schedulerId` はキュー名そのものにする（1 キュー = 1 スケジュール）。BullMQ が作る
  //    ジョブの `jobId` は `repeat:{schedulerId}:{発火予定ミリ秒}` であり、
  //    `apps/worker/src/scheduler.ts` はそこから slot を取り出して `SchedulerRun.runKey` にする。
  const ready = queue
    .upsertJobScheduler(
      options.queueName,
      { pattern: options.cron, tz: options.timeZone },
      { name: options.queueName },
    )
    .then(() => undefined);
  return {
    ready,
    async close(): Promise<void> {
      await queue.close();
      await client.quit();
    },
  };
}

/**
 * 🔴 登録済みの Job Scheduler を読む（**運用調査と結合テストのため**）。
 *
 * 🔴 業務経路はこれを呼ばない（`BullMqGateRunQueue.jobState` と同じ位置づけ）。
 *    「スケジュールを登録したのに Redis に無い」は起動ログだけでは絶対に気づけない形の壊れ方
 *    （`CLAUDE.md` §11.1）であり、それを外から確かめる手段がここである。
 */
export async function listBullMqJobSchedulers(options: {
  readonly queueName: QueueName;
  readonly connection: BullMqConnection;
}): Promise<readonly { readonly key: string; readonly pattern: string | null; readonly tz: string | null }[]> {
  const client = createClient(options.connection);
  const queue = createQueue(options.queueName, client);
  try {
    const schedulers = await queue.getJobSchedulers();
    return schedulers.map((scheduler) => ({
      key: String(scheduler.key ?? ''),
      pattern: scheduler.pattern ?? null,
      tz: scheduler.tz ?? null,
    }));
  } finally {
    await queue.close();
    await client.quit();
  }
}

// ============================================================================
// 🔴 T-11-04: failed セットの**読み取り専用**の照会（`A-005` 項目 3 / 項目 12。docs/05 §16.5）
// ============================================================================

/** `gate.run` の failed セットにあるジョブ 1 件の写し（payload の 3 つの ID と失敗時刻だけ）。 */
export type FailedGateRunJobRecord = {
  readonly tenantId: string;
  readonly targetType: string;
  readonly targetId: string;
  /** 失敗が確定した時刻（`Job.finishedOn`。無ければ `Job.timestamp` = enqueue 時刻）。 */
  readonly failedAt: Date;
};

export type FailedJobsByQueue = {
  readonly queueName: QueueName;
  readonly count: number;
  /** 最も新しい失敗の時刻。0 件なら `null`。 */
  readonly lastFailedAt: Date | null;
};

export type FailedJobsSnapshot = {
  /** 🔴 定義済みの**全キュー**（0 件も含む。「照合した」事実を画面が成立として示せるように）。 */
  readonly byQueue: readonly FailedJobsByQueue[];
  readonly total: number;
  /** `gate.run` の failed の写し（`listGateStalls` の `failedJobs` に渡す材料）。 */
  readonly gateRun: readonly FailedGateRunJobRecord[];
  /** `gateRun` が上限で切られたか（`byQueue` の件数と食い違う場合の目印）。 */
  readonly gateRunTruncated: boolean;
};

/**
 * 🔴 failed セットを読むだけの口。`Job` / `Queue` を外に出さず、`retry()` / `remove()` / `add()` に到達できる形を持たない
 *    （docs/05 §9.10 ① / Issue #16 / `tests/static/admin-no-gate-retry.test.ts`。運営者の retry 操作は作らない）。
 */
export type BullMqFailedJobsReader = {
  list(): Promise<FailedJobsSnapshot>;
  close(): Promise<void>;
};

/** `gate.run` の写しを 1 回に読む上限（`listGateStalls` の `rows` の上限と同じ 500）。 */
const FAILED_GATE_RUN_READ_LIMIT = 500;

function isGateRunJobData(value: unknown): value is Pick<GateRunJob, 'tenantId' | 'targetType' | 'targetId'> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GateRunJob>;
  return (
    typeof candidate.tenantId === 'string' &&
    typeof candidate.targetType === 'string' &&
    typeof candidate.targetId === 'string'
  );
}

function failedAtOf(job: Job): Date {
  return new Date(job.finishedOn ?? job.timestamp);
}

/**
 * 🔴 全キューの failed セットを**読むだけ**（`A-005` 項目 3「失敗ジョブ数」/ 項目 12 の `JOB_FAILED` の検知元）。
 *
 * - 件数は `getFailedCount()`、最終失敗時刻は `getFailed(0, 0)`（failed セットは失敗時刻の降順）の先頭から取る
 * - `gate.run` だけは payload の 3 つの ID を写す（`listGateStalls` が対象ごとに区別するため）。
 *   🔴 **他のキューの payload は読まない** —— `account.mail` の payload には平文トークンが載る（docs/05 §9.4）。
 *   件数と時刻以外を管理平面へ運ばない（`BR-40` / `CLAUDE.md` §3.4「トークンをログ・エラーに出さない」）
 * - 🔴 `gate.run` の payload が期待の形でない行は**黙って捨てず落とす**（Redis の中身が壊れている）
 * - `Queue` は最初の呼び出しまで作らない（`createBullMqGateRunQueue` と同じ。起動時 DI が Redis へ繋ぎにいかない）
 * - 読み取りに失敗したら throw する（呼び出し側が「失敗記録を照合できていません」に落とす。0 件で埋めない）
 */
export function createBullMqFailedJobsReader(connection: BullMqConnection): BullMqFailedJobsReader {
  let client: Redis | null = null;
  const queues = new Map<QueueName, Queue>();
  const resolve = (name: QueueName): Queue => {
    client ??= createClient(connection);
    let queue = queues.get(name);
    if (queue === undefined) {
      queue = createQueue(name, client);
      queues.set(name, queue);
    }
    return queue;
  };
  const names = Object.keys(QUEUE_DEFINITIONS) as QueueName[];

  return {
    async list(): Promise<FailedJobsSnapshot> {
      const byQueue: FailedJobsByQueue[] = [];
      let gateRun: FailedGateRunJobRecord[] = [];
      let gateRunTruncated = false;
      for (const name of names) {
        const queue = resolve(name);
        const count = await queue.getFailedCount();
        const latest = count > 0 ? await queue.getFailed(0, 0) : [];
        const lastFailedAt = latest[0] === undefined ? null : failedAtOf(latest[0]);
        byQueue.push({ queueName: name, count, lastFailedAt });
        if (name === GATE_RUN_JOB && count > 0) {
          const jobs = await queue.getFailed(0, FAILED_GATE_RUN_READ_LIMIT - 1);
          gateRunTruncated = count > jobs.length;
          gateRun = jobs.map((job) => {
            if (!isGateRunJobData(job.data)) {
              throw new Error(
                `${GATE_RUN_JOB} の failed ジョブ ${String(job.id)} の payload が GateRunJob の形ではありません（Redis の中身を確認してください）。`,
              );
            }
            return {
              tenantId: job.data.tenantId,
              targetType: job.data.targetType,
              targetId: job.data.targetId,
              failedAt: failedAtOf(job),
            };
          });
        }
      }
      return {
        byQueue,
        total: byQueue.reduce((sum, entry) => sum + entry.count, 0),
        gateRun,
        gateRunTruncated,
      };
    },
    async close(): Promise<void> {
      for (const queue of queues.values()) await queue.close();
      queues.clear();
      if (client !== null) await client.quit();
      client = null;
    },
  };
}

/**
 * 🔴 T-11-04: 接近の目印（`mail:provider:nearingSince`。docs/05 §16.5 項目 13 ③）の実体化。
 *    Redis クライアントを作ってよいのはこのファイルだけ（`createRedisProviderSendCounter` と同じ理由）。
 */
export function createRedisProviderQuotaNearingMarker(connection: BullMqConnection): {
  readonly marker: ProviderQuotaNearingMarker;
  close(): Promise<void>;
} {
  const client = createClient(connection);
  return {
    marker: new RedisProviderQuotaNearingMarker(client),
    async close(): Promise<void> {
      await client.quit();
    },
  };
}

/**
 * 🔴 プロセス横断の 24h 送信カウンタ（`RedisProviderSendCounter`）の実体化。
 *
 * 🔴 ここに置く理由: **Redis クライアントを作ってよいのはこのファイルだけ**である
 *    （`packages/connectors` は `ioredis` に依存するが、接続の生成は起動時 DI の 1 箇所に
 *    閉じる。`counter.ts` の `ProviderCounterRedis` は「ioredis と構造的に一致する最小集合」
 *    として宣言されており、その実体を与えるのがここである）。
 * 🔴 `InMemoryProviderSendCounter` へフォールバックしない —— プロセスを跨いで数えられない
 *    カウンタは「枠が空いていると誤認して二重に送る」側へ倒れる（`CLAUDE.md` §11.1）。
 */
export function createRedisProviderSendCounter(connection: BullMqConnection): {
  readonly counter: ProviderSendCounter;
  close(): Promise<void>;
} {
  const client = createClient(connection);
  return {
    counter: new RedisProviderSendCounter(client),
    async close(): Promise<void> {
      await client.quit();
    },
  };
}
