// tests/e2e/global-setup.ts
// 🔴 docs/05 §17.6「E2E の直列化と globalSetup」の手順そのもの:
//    ①コンテナ起動 → ②ロールの作成（`000_roles.sql`）→ ③マイグレーション（`app_migrator`。
//    スキーマ + RLS + `GRANT`）→ ④`seed:isolation` の投入 → ⑤`APP_ENV=development` で
//    アプリを起動 → ⑥**外向きネットワークの遮断を確認** → ✅ T-09-11: ⑦`apps/worker` を**ハーネスのプロセス内で**起動する
//    （`harness/worker.ts`。`gate.run` / `send.proposal` がブラウザ経路で実際に走る。Issue #47 の既定値 = 選択肢 1）。
//
// 🔴 ④は `@ses/db/seed` の `runSeed` を呼ぶ（docs/05 §17.5「DB のフィクスチャは使わない。
//    `packages/db/seed` のプリセットを使う」）。E2E 専用の投入 SQL を書かない。
// 🔴 本ファイルは `@playwright/test` を import しない。ハーネス（コンテナ起動・アプリ起動・
//    遮断確認）を Playwright 無しでも実行・検証できる形に保つため。
import process from 'node:process';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { registerVerifiedSendingDomainForE2e, writeAdminDatabaseUrlEnv } from './harness/db-admin.js';
import { startE2eObjectStorage, writeObjectStorageOriginEnv } from './harness/object-storage.js';
import { startE2eDatabase } from './harness/postgres.js';
import { startE2eRedis } from './harness/redis.js';
import { E2E_VERIFIED_SENDING_DOMAIN } from './harness/sending-domain.js';
import { setHarness } from './harness/state.js';
import { resetTotpStore } from './harness/totp-store.js';
import { startWebServer } from './harness/web-server.js';
import { startE2eWorker } from './harness/worker.js';

export default async function globalSetup(): Promise<void> {
  const startedAt = Date.now();
  const log = (message: string): void => {
    process.stdout.write(`[e2e-setup +${Math.round((Date.now() - startedAt) / 1000)}s] ${message}\n`);
  };

  // 🔴 前回の実行で持ち越した TOTP シークレットを捨てる（DB を作り直すため必ず無効になる）。
  resetTotpStore();

  log('① PostgreSQL（TLS 有効）を起動し、②ロール ③マイグレーションを適用します');
  const database = await startE2eDatabase();
  // 🔴 T-05-10（K-7）: `harness/db-admin.ts` がスキャン結果の適用（apps/worker 不在）を
  //    代替するために使う特権接続。ワーカープロセスの起動より前に書けば、Playwright が
  //    spawn するテストのワーカープロセスにも引き継がれる（`harness/endpoint.ts` と同じ理屈）。
  writeAdminDatabaseUrlEnv(database.seedUrl);

  log('① MinIO を起動し、バケットの作成とバージョニングの有効化を行います（T-05-10）');
  const objectStorage = await startE2eObjectStorage();
  writeObjectStorageOriginEnv(objectStorage.endpoint);
  log(`   ${objectStorage.endpoint}（bucket=${objectStorage.bucket}）`);

  // 🔴 T-09-06 / T-09-11: `gate.run` / `send.proposal` の enqueue 先。⑦ で起動する worker が消費する。
  log('① Redis を起動します（gate.run / send.proposal のキュー。⑦ の worker が消費する）');
  const redis = await startE2eRedis();
  log(`   ${redis.url}`);

  log('④ seed:isolation（2 テナント × 2 パートナー）を投入します');
  const seeded = await runSeed({
    // 🔴 `development` 以外では `assertSeedableAppEnv` が投入前に拒否する（`F-053 AC-6`）。
    appEnv: 'development',
    databaseUrl: database.seedUrl,
    preset: 'isolation',
    reset: true,
  });
  log(`   テナント: ${seeded.tenantIds.join(', ')}`);

  // 🔴 T-09-11: テナント 1 の送信元ドメインを検証済みにする（送信ジョブの ①-d は環境で免除しない。行が無いと
  //    `DOMAIN_UNVERIFIED` の保留で止まる。T-09-06 の申し送り 4）。実経路（`domain.verify`）は SES の identity API を要求し
  //    `development` には無いため、E2E は「検証済みという事実」だけを作る（`harness/db-admin.ts` の注記。Issue #57）。
  //    🔴 テナント 2 は**未検証のまま**にする —— `proposal-cycle.spec.ts` シナリオ 3（E2E #9）が「未検証の保留 → 検証 → 自動復帰」を
  //    テナント 2 で通す。
  const tenant1 = ISOLATION_SEED_IDS.tenants[0];
  if (tenant1 === undefined) throw new Error('seed:isolation にテナント 1 がありません。');
  registerVerifiedSendingDomainForE2e(tenant1.tenantId, E2E_VERIFIED_SENDING_DOMAIN);
  log(`   テナント 1 の送信元ドメインを VERIFIED にしました（${E2E_VERIFIED_SENDING_DOMAIN}）`);

  log('⑤ APP_ENV=development でアプリを起動し、⑥ 外向きネットワークの遮断を確認します');
  const webServer = await startWebServer(database, objectStorage, redis);
  log(`   ${webServer.baseUrl} で待ち受け中（ログ: ${webServer.logPath}）`);

  log('⑦ apps/worker をハーネスのプロセス内で起動します（外向き遮断 → startWorkerRuntime。T-09-11）');
  const worker = await startE2eWorker(database, objectStorage, redis);
  log(`   待ち受け中のキュー: ${worker.queues.join(', ')}`);

  setHarness({ database, objectStorage, redis, webServer, worker });
}
