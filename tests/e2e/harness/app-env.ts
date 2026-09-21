// tests/e2e/harness/app-env.ts
// 🔴 E2E のアプリ（`apps/web`）とワーカー（`apps/worker`）に渡す**同じ 1 組の環境変数**（T-09-11）。
//
// 🔴 なぜ 1 箇所にするか: web は #43 で `send.proposal` を積み、worker がそれを消費する。両者が別々に env を組むと、
//    `REDIS_URL` / `DATABASE_URL` / `EMAIL_DAILY_LIMIT_PER_TENANT` / `SEND_STALE_THRESHOLD_MINUTES` のどれか 1 つが
//    食い違っただけで「積んだのに拾われない」「web の判定と worker の判定が違う」という追いにくい壊れ方になる。
//    値の出所を 1 関数に閉じ、web-server.ts / worker.ts はそれぞれの起動形態に固有の値（`PORT` / `NODE_OPTIONS`）だけを足す。
//
// 🔴 土台は `@ses/config/testing` の `buildValidEnv('development')`（「妥当な env の組み立て方」を E2E 用に書き直さない。
//    `packages/config/src/testing/fixtures.ts` 冒頭の意図）。上書きするのは**この実行でしか決まらない値**だけである。
// 🔴 `APP_ENV` を `development` 以外にしない。全コネクタがモックに解決される唯一の環境であり、E2E はここでしか回さない
//    （`CLAUDE.md` §11 / docs/03 §4.17）。
// 🔴 `@ses/config/testing` をパッケージ名で import しない（`web-server.ts` の注記と同じ理由。実装は同じファイル）。
import { buildValidEnv } from '../../../packages/config/src/testing/fixtures.js';
import { E2E_BASE_URL } from './endpoint.js';
import type { E2eObjectStorage } from './object-storage.js';
import type { E2eDatabase } from './postgres.js';
import type { E2eRedis } from './redis.js';

export type E2eAppEnv = ReturnType<typeof buildValidEnv>;

/**
 * ✅ T-12-14 ⑤: `ai-limit.spec.ts` のシーム（`reachAiDailyCostLimitForE2e`）が「上限値」に置く値。
 * 🔴 web / worker と**同じ 1 組の env**（`buildE2eAppEnv` = `buildValidEnv('development', …)`）から読む。`buildE2eAppEnv` はこのキーを
 *    上書きしないので、`buildValidEnv('development')` の値がそのまま worker の `AI_DAILY_COST_LIMIT_USD_DEFAULT` である。
 *    spec に数値を書き写さない（写すと worker の上限と spec の「上限値」が別々に変わる）。
 */
export function e2eAiDailyCostLimitUsd(): string {
  const value = buildValidEnv('development').AI_DAILY_COST_LIMIT_USD_DEFAULT;
  if (value === undefined || value === '') {
    throw new Error('[e2e] AI_DAILY_COST_LIMIT_USD_DEFAULT が E2E の env に無い（buildValidEnv の fixture が変わった？）。');
  }
  return value;
}

export function buildE2eAppEnv(database: E2eDatabase, objectStorage: E2eObjectStorage, redis: E2eRedis): E2eAppEnv {
  return buildValidEnv('development', {
    APP_URL: E2E_BASE_URL,
    DATABASE_URL: database.tenantUrl,
    // 🔴 T-09-06 / T-09-11: #43 が `send.proposal` を積む先 = worker が待ち受ける先（E2E 専用の使い捨て Redis。ホストの 6379 を使わない）。
    REDIS_URL: redis.url,
    PLATFORM_DATABASE_URL: database.platformUrl,
    PLATFORM_WRITE_DATABASE_URL: database.platformWriteUrl,
    // 🔴 `next start` は本番モードのビルドを配信する。`APP_ENV` は `development` のまま
    //    （`NODE_ENV` と `APP_ENV` は別物であり、`packages/config` も両者を結び付けていない）。
    NODE_ENV: 'production',
    // 🔴 T-05-10（K-7）: `objectStore` は development で `real`（`connector-selection.ts`
    //    `developmentSelection()`）であり、モックにフォールバックしない（`CLAUDE.md` §11.1）。
    //    `docker-compose.yml` 既定の固定ポート（9000）ではなく、`harness/object-storage.ts` が
    //    起動した E2E 専用の使い捨て MinIO インスタンスを指す（`docker compose up -d` の実行を
    //    前提にしない。PostgreSQL と同じ方針）。
    S3_ENDPOINT: objectStorage.endpoint,
    S3_ACCESS_KEY_ID: objectStorage.accessKeyId,
    S3_SECRET_ACCESS_KEY: objectStorage.secretAccessKey,
    S3_BUCKET: objectStorage.bucket,
    S3_REGION: objectStorage.region,
    S3_FORCE_PATH_STYLE: 'true',
  });
}
