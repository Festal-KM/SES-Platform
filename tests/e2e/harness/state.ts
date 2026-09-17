// tests/e2e/harness/state.ts
// globalSetup と globalTeardown は Playwright のメインプロセスで実行され、モジュールレジストリを
// 共有する。停止に必要なハンドルをここに置いて受け渡す。
//
// 🔴 ハンドルを見失っても後始末が破綻しないよう、Testcontainers の Ryuk（リソースリーパ）が
//    セッション終了時にコンテナを回収する。ここは「素直に片付ける」経路である。
import type { E2eObjectStorage } from './object-storage.js';
import type { E2eDatabase } from './postgres.js';
import type { E2eRedis } from './redis.js';
import type { WebServer } from './web-server.js';
import type { E2eWorker } from './worker.js';

type HarnessState = {
  database: E2eDatabase | null;
  objectStorage: E2eObjectStorage | null;
  /** T-09-06: `send.proposal` の enqueue 先（BullMQ）。✅ T-09-11: `worker` が消費する。 */
  redis: E2eRedis | null;
  webServer: WebServer | null;
  /** ✅ T-09-11: ハーネスのプロセス内で動く `apps/worker`（`harness/worker.ts`）。 */
  worker: E2eWorker | null;
};

const state: HarnessState = { database: null, objectStorage: null, redis: null, webServer: null, worker: null };

export function setHarness(value: {
  database: E2eDatabase;
  objectStorage: E2eObjectStorage;
  redis: E2eRedis;
  webServer: WebServer;
  worker: E2eWorker;
}): void {
  state.database = value.database;
  state.objectStorage = value.objectStorage;
  state.redis = value.redis;
  state.webServer = value.webServer;
  state.worker = value.worker;
}

export function takeHarness(): HarnessState {
  const taken = {
    database: state.database,
    objectStorage: state.objectStorage,
    redis: state.redis,
    webServer: state.webServer,
    worker: state.worker,
  };
  state.database = null;
  state.objectStorage = null;
  state.redis = null;
  state.webServer = null;
  state.worker = null;
  return taken;
}
