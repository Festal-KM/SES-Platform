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
import { loadAppEnv, resolveConnectorSelection, type AppEnvKind } from '@ses/config';
import { configureTenantDb, configureTokenEncryption } from '@ses/db';
import { configureAccountMailQueue, PendingAccountMailQueue } from '../jobs/account-mail';

let initialized = false;
/** 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8）が読む値。`ensureDbConfigured()` が 1 度だけ埋める。 */
let cachedAppEnv: AppEnvKind | null = null;

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
  cachedAppEnv = env.APP_ENV;
  configureTenantDb({ datasourceUrl: env.DATABASE_URL });
  // 🔴 T-03-02: 秘匿値の暗号鍵も同じ初期化経路で注入する（docs/05 §8.6 / docs/03 §4.4）。
  //    packages/db 側で `process.env` を読ませない（鍵の出所を packages/config に一本化する）。
  configureTokenEncryption({
    key: env.TOKEN_ENCRYPTION_KEY,
    keyId: env.TOKEN_ENCRYPTION_KEY_ID,
    previous: env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
  });
  // 🔴 T-03-03: `account.mail`（docs/05 §9.4）の enqueue 先を**起動時の 1 箇所**で決める。
  //    判断材料は `resolveConnectorSelection`（APP_ENV 分岐の唯一の場所。CLAUDE.md §11.1）であり、
  //    ここで `APP_ENV` を自分で分岐しない。
  //    - email が `mock`（development / demo）→ 保留キュー（SP-04 のハンドラが処理するまで積むだけ）
  //    - それ以外（sandbox / staging / production）→ **登録しない**。BullMQ のキュー実装は SP-04 の
  //      範囲であり、未実装のまま「送ったつもり」にさせない（enqueue 時に例外 = 操作が成立しない）。
  if (resolveConnectorSelection(env).email === 'mock') {
    configureAccountMailQueue(new PendingAccountMailQueue());
  }
  initialized = true;
}

/**
 * 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8。T-03-06）が読む唯一の経路。
 *    `ensureDbConfigured()` と同じキャッシュを返す（`loadAppEnv` を二重に呼ばない）。
 */
export function currentAppEnv(): AppEnvKind {
  ensureDbConfigured();
  if (cachedAppEnv === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない
    // （不変条件違反。フォールバックせず、そのまま失敗させる。CLAUDE.md §11.1）。
    throw new Error('APP_ENV が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedAppEnv;
}
