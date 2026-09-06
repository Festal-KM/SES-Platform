// tests/e2e/harness/state.ts
// globalSetup と globalTeardown は Playwright のメインプロセスで実行され、モジュールレジストリを
// 共有する。停止に必要なハンドルをここに置いて受け渡す。
//
// 🔴 ハンドルを見失っても後始末が破綻しないよう、Testcontainers の Ryuk（リソースリーパ）が
//    セッション終了時にコンテナを回収する。ここは「素直に片付ける」経路である。
import type { E2eObjectStorage } from './object-storage.js';
import type { E2eDatabase } from './postgres.js';
import type { WebServer } from './web-server.js';

type HarnessState = {
  database: E2eDatabase | null;
  objectStorage: E2eObjectStorage | null;
  webServer: WebServer | null;
};

const state: HarnessState = { database: null, objectStorage: null, webServer: null };

export function setHarness(value: {
  database: E2eDatabase;
  objectStorage: E2eObjectStorage;
  webServer: WebServer;
}): void {
  state.database = value.database;
  state.objectStorage = value.objectStorage;
  state.webServer = value.webServer;
}

export function takeHarness(): HarnessState {
  const taken = {
    database: state.database,
    objectStorage: state.objectStorage,
    webServer: state.webServer,
  };
  state.database = null;
  state.objectStorage = null;
  state.webServer = null;
  return taken;
}
