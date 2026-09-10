// tests/isolation/worker-runtime.test.ts
// 🔴 T-07-11 の受け入れ基準 ①④⑤ を**実 DB + 実 Redis**で通す（docs/05 §9.1 / §13.1）:
//
//   ① `development` でワーカーが起動し、`gate.run` の Worker が**実際に待ち受ける**
//      （enqueue した仕事を消費して完了させるところまで見る。「Worker を作った」では足りない）
//   ② 宣言済みの 5 本が **Redis に Repeatable Job として登録される**（cron と TZ まで一致）
//      —— 「配線したのに登録されていない」は起動ログでは絶対に気づけない（`CLAUDE.md` §11.1）
//
// 🔴 `startWorkerRuntime` を**そのまま**呼ぶ（配線を書き写さない）。書き写すと、
//    `main.ts` の配線が壊れてもこのテストだけが緑になる（T-03-12 が塞いだ穴の再発）。
// 🔴 `initializeRuntimeConfig` は使わない —— あれはプロセス内に 1 回だけのキャッシュを持ち
//    （docs/05 §13.1）、他のテストと `APP_ENV` を取り合う。同じ 2 関数
//    （`loadAppEnv` / `resolveConnectorSelection`）から `RuntimeConfig` を組み立てる。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// 🔴 `@ses/config` をパッケージ名で import しない（ルートの package.json は依存に持たない。
//    `tests/startup/startup-di.test.ts` と同じ扱い）。実装のソースを相対 import する。
import { resolveConnectorSelection } from '../../packages/config/src/connector-selection.js';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import type { RuntimeConfig } from '../../packages/config/src/startup.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import { GATE_RUN_JOB } from '@ses/connectors';
import {
  createBullMqGateRunQueue,
  listBullMqJobSchedulers,
  type BullMqGateRunQueue,
} from '@ses/connectors/bullmq';
import { configureTenantDb, disconnectTenantDb } from '@ses/db';
import { SCHEDULED_JOBS } from '../../apps/worker/src/jobs/index.js';
import { startWorkerRuntime, type WorkerRuntime } from '../../apps/worker/src/runtime.js';
import { TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;

let database: IsolationDatabase;
let redis: IsolationRedis;
let runtime: WorkerRuntime;
let gateRunQueue: BullMqGateRunQueue;

beforeAll(async () => {
  [database, redis] = await Promise.all([startIsolationDatabase(), startIsolationRedis()]);

  // 🔴 `DATABASE_URL` はフィクスチャの値のまま渡す（`packages/config` は全環境で
  //    `sslmode=require` を要求するが、Testcontainers の Postgres は TLS を張らない）。
  //    `startWorkerRuntime` は `configureTenantDb(env.DATABASE_URL)` を通る（本番と同じ経路）が、
  //    **Prisma の接続は遅延**なのでここでは何も起きない。直後にコンテナへ差し替える。
  const env = loadAppEnv(buildValidEnv('development', { REDIS_URL: redis.url }));
  const config: RuntimeConfig = { env, connectors: resolveConnectorSelection(env) };

  runtime = startWorkerRuntime(config);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  await runtime.ready;
  gateRunQueue = createBullMqGateRunQueue({ url: redis.url });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await gateRunQueue?.close();
  await runtime?.close();
  await disconnectTenantDb();
  await Promise.all([redis?.stop(), database?.stop()]);
}, SETUP_TIMEOUT_MS);

describe('🔴 受け入れ基準 ①: development でワーカーが起動し gate.run が待ち受ける', () => {
  it('配線したキューの一覧に gate.run と宣言済み 5 本がすべて含まれる', () => {
    expect(runtime.queues).toEqual([
      GATE_RUN_JOB,
      ...SCHEDULED_JOBS.map((declaration) => declaration.name),
    ]);
    expect(runtime.queues).toHaveLength(6);
  });

  it('🔴 enqueue した gate.run が実際に消費される（対象が無い提案は TARGET_NOT_FOUND で完了する）', async () => {
    const key = { targetType: 'PROPOSAL', targetId: randomUUID(), contentHash: randomUUID() };
    // 🔴 テスト用の入口を作らない。本番と同じ `GateRunJobQueue.enqueue` を通す。
    expect(await gateRunQueue.enqueue({ tenantId: TENANT_A, ...key })).toBe('ENQUEUED');

    // `removeOnComplete: true`（docs/05 §9.1）なので、完了したジョブは Redis から消える。
    // 🔴 つまり `jobState` が `null` になることが「Worker が拾って完了させた」ことの証拠である。
    let state: string | null = 'waiting';
    for (let attempt = 0; attempt < 100 && state !== null; attempt += 1) {
      await delay(100);
      state = await gateRunQueue.jobState(key);
    }

    expect(state, 'gate.run の Worker がジョブを消費していない（配線されていない）').toBeNull();
  });
});

describe('🔴 受け入れ基準 ②: 宣言済み 5 本が Repeatable Job として登録される', () => {
  it.each(SCHEDULED_JOBS.map((declaration) => [declaration.name, declaration] as const))(
    '%s が cron / TZ どおりに 1 本だけ登録されている',
    async (_name, declaration) => {
      const schedulers = await listBullMqJobSchedulers({
        queueName: declaration.name as Parameters<typeof listBullMqJobSchedulers>[0]['queueName'],
        connection: { url: redis.url },
      });

      // 🔴 1 本だけ（`upsertJobScheduler` なので、複数プロセスで起動しても増えない）。
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]?.pattern).toBe(declaration.cron);
      expect(schedulers[0]?.tz).toBe(declaration.timeZone);
    },
  );

  it('🔴 gate.hold-release は 10 分ごと・Asia/Tokyo である（`F-027 AC-5` の自動復帰の周期）', async () => {
    const schedulers = await listBullMqJobSchedulers({
      queueName: 'gate.hold-release',
      connection: { url: redis.url },
    });

    expect(schedulers[0]?.pattern).toBe('*/10 * * * *');
    expect(schedulers[0]?.tz).toBe('Asia/Tokyo');
  });

  it('🔴 gate.run にスケジュールは登録されない（イベント起動である。docs/05 §9.3）', async () => {
    expect(
      await listBullMqJobSchedulers({ queueName: GATE_RUN_JOB, connection: { url: redis.url } }),
    ).toEqual([]);
  });

  it('🔴 二重起動してもスケジュールは 1 本のまま（upsert である）', async () => {
    const env = loadAppEnv(buildValidEnv('development', { REDIS_URL: redis.url }));
    const second = startWorkerRuntime({ env, connectors: resolveConnectorSelection(env) });
    // 🔴 2 つ目のランタイムも `configureTenantDb` を通る（プロセスに 1 つの Prisma クライアントを
    //    差し替える）。コンテナへ戻しておかないと、以降のテストが到達しない DB を見る。
    configureTenantDb({ datasourceUrl: database.tenantUrl });
    await second.ready;
    try {
      const schedulers = await listBullMqJobSchedulers({
        queueName: 'gate.hold-release',
        connection: { url: redis.url },
      });
      expect(schedulers).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
});
