// apps/web/lib/db/bootstrap.ts
// 🔴 T-03-01 の暫定版。**起動時 DI の本体は T-03-12（`instrumentation.ts`）が実装する**
//    （docs/sprints/SP-03 §4 T-03-12 / docs/05 §13.1 / CLAUDE.md §11.1）。
//
// 本タスクの範囲では「DB クライアントが未初期化のまま認証経路が動く」ことだけを防ぐ:
//   - `loadAppEnv(process.env)` は環境変数の Zod 検証の唯一の入口（packages/config）。
//   - `configureTenantDb` はプロセスにつき 1 回だけ呼ぶ（多重初期化を作らない）。
//
// 🔴 例外を握りつぶさない。検証に失敗したらそのまま throw する
//    （「未設定ならモックにフォールバック」を作らない。CLAUDE.md §11.1）。
// 🔴 リクエストごとに `APP_ENV` を分岐しない。ここは初期化の 1 箇所であり、
//    外部連携の差し替え（`resolveConnectorSelection`）は T-03-12 が同じ初期化経路に載せる。
import process from 'node:process';
import { loadAppEnv } from '@ses/config';
import { configureTenantDb } from '@ses/db';

let initialized = false;

/**
 * DB クライアントを 1 度だけ初期化する。
 *
 * 🔴 `instrumentation.ts`（T-03-12）が入ったあとは、そこから 1 回呼ばれた時点で
 *    `initialized` が立ち、以降のリクエストでは何もしない。呼び出しが二重になっても
 *    接続プールが増えない構造にしておく。
 */
export function ensureDbConfigured(): void {
  if (initialized) return;
  const env = loadAppEnv(process.env);
  configureTenantDb({ datasourceUrl: env.DATABASE_URL });
  initialized = true;
}
