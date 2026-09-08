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
import { Queue, Worker, type Job } from 'bullmq';
// 🔴 **Redis クライアントは我々が作って渡す**（`connection: { url }` を渡さない）。
//    BullMQ v6 は `ioredis` を optional peer にしており、接続設定だけを渡すと内部で
//    `require('ioredis')` を試みる。`apps/worker` は素の ESM で動くため `require` が無く、
//    **本番だけ「起動はするが最初の enqueue で落ちる」**という壊れ方になる（実測で確認した）。
//    インスタンスを渡す経路は CJS / ESM のどちらでも同じ 1 本である。
//    ⚠️ 名前付き import にしてある（`import Redis from 'ioredis'` は `module: NodeNext` の下で
//    **CJS モジュールの名前空間**に解決され、型として使えない）。実行時も Node の CJS 相互運用が
//    `Redis` を名前付き export として解決する（`packages/connectors` で実測）。
import { Redis } from 'ioredis';
import {
  gateRunJobId,
  queueDefinition,
  shouldRemoveGateRunJob,
  GATE_RUN_JOB,
  type GateRunFailedJobRemoval,
  type GateRunJob,
  type GateRunJobKey,
  type GateRunJobQueue,
  type InternalQueueOptions,
  type QueueName,
} from './queues.js';

/** 接続先（`packages/config` の `REDIS_URL`。**このファイルは `process.env` を読まない**）。 */
export type BullMqConnection = {
  readonly url: string;
};

/**
 * 🔴 まだ BullMQ へ写像できない既定ジョブオプションが定義に現れた。
 *
 * **握り潰して近似しない。** 例えば `stepped` バックオフ（`email.dispatch` の 5s / 30s。§9.1）を
 * BullMQ の組み込み戦略に落とすと、設計値と実際の待ち時間が黙ってずれる。ワーカー側の
 * `settings.backoffStrategy` を配線するタスクが、この例外を消す形で対応すること。
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
 * `QUEUE_DEFINITIONS` の既定ジョブオプションを BullMQ の形に写す。
 *
 * 🔴 **値を作らない。** 渡ってきた `attempts` / `removeOnComplete` をそのまま置くだけである。
 * 🔴 `stepped` バックオフはカスタム戦略（`settings.backoffStrategy`）の配線とセットでなければ
 *    正しく動かないため、写像せずに例外にする（上記）。
 */
function toBullMqJobOptions(name: string, options: InternalQueueOptions) {
  if (options.backoff !== undefined && options.backoff.type === 'stepped') {
    throw new UnsupportedQueueOptionError(
      name,
      'stepped バックオフはワーカーの settings.backoffStrategy の配線を要する',
    );
  }
  return {
    attempts: options.attempts,
    ...(options.backoff === undefined ? {} : { backoff: options.backoff }),
    ...(options.removeOnComplete === undefined ? {} : { removeOnComplete: options.removeOnComplete }),
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
    async enqueue(job: GateRunJob): Promise<void> {
      // 🔴 per-job オプションは `jobId` だけ（`attempts` / `backoff` を渡さない。§17.2 #6）。
      await resolve().add(GATE_RUN_JOB, job, { jobId: gateRunJobId(job) });
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

export type BullMqGateRunWorker = {
  close(): Promise<void>;
};

/**
 * 🔴 `gate.run` の実行側（`apps/worker` の起動配線と、結合テストが使う）。
 *
 * 🔴 **再試行は既定ジョブオプション（`attempts: 1`）が決める。** ここで `attempts` を
 *    上書きしない（LLM の再試行は `runRole` の内部で完結する。§9.3）。
 * 🔴 ハンドラは payload を検証してから使う（`parseGateRunPayload`）。ここでは型を主張しない
 *    —— Redis から来た値は常に `unknown` である。
 */
export function createBullMqGateRunWorker(options: {
  readonly connection: BullMqConnection;
  readonly handler: (payload: unknown, jobId: string) => Promise<unknown>;
  readonly concurrency?: number;
}): BullMqGateRunWorker {
  const client = createClient(options.connection);
  const worker = new Worker(
    GATE_RUN_JOB,
    async (job: Job) => options.handler(job.data, job.id ?? ''),
    {
      connection: client,
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
