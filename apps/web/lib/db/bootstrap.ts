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
import {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  configureTenantDb,
  configureTokenEncryption,
} from '@ses/db';
import { configureAccountMailQueue, PendingAccountMailQueue } from '../jobs/account-mail';

let initialized = false;
/** 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8）が読む値。`ensureDbConfigured()` が 1 度だけ埋める。 */
let cachedAppEnv: AppEnvKind | null = null;
/**
 * 🔴 T-03-07: 管理平面の Auth.js インスタンスの署名鍵（docs/03 §4.9「主平面と管理平面で
 *    別の署名鍵」）。Auth.js は `AUTH_SECRET` しか自動で読まないため、管理平面のインスタンスには
 *    ここから明示的に渡す。**`process.env` を直接読まない**（CLAUDE.md §3.5）。
 */
let cachedPlatformAuthSecret: string | null = null;
/**
 * 🔴 T-03-10: `SANDBOX` で開設したテナントの試用期限（日数。docs/05 §6.9 API-A4 /
 *    `CLAUDE.md` §9-12「有効期間は 30 日」）。`packages/config` の `SANDBOX_TRIAL_DAYS` が唯一の出所。
 */
let cachedSandboxTrialDays: number | null = null;

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
  cachedPlatformAuthSecret = env.AUTH_PLATFORM_SECRET;
  cachedSandboxTrialDays = env.SANDBOX_TRIAL_DAYS;
  configureTenantDb({ datasourceUrl: env.DATABASE_URL });
  // 🔴 T-03-07: 管理平面は**別の接続プール・別の DB ロール**（docs/03 §4.3.3 / docs/05 §4.2）。
  //    主平面の DATABASE_URL を流用しない（流用すると運営者の資格情報へ主平面のロールから
  //    到達できてしまう。CLAUDE.md §10.5「権限昇格の事故経路を作らない」）。
  configurePlatformWriteDb({ datasourceUrl: env.PLATFORM_WRITE_DATABASE_URL });
  // 🔴 T-03-08: 管理平面の**読み取り専用**プール（`app_platform`。docs/05 §4.2 / §5.2）。
  //    `withPlatformRead` はこちらで接続する。読みと書きを 1 本のプールに混ぜない ——
  //    「read-only は DB 権限で担保する」（§5.2）が、同じ接続を使い回すと成立しない。
  configurePlatformReadDb({ datasourceUrl: env.PLATFORM_DATABASE_URL });
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

/**
 * 🔴 T-03-10: `A-014`（テナント開設）が `SANDBOX` の `sandboxExpiresAt` を計算するために読む。
 *    値の出所は `packages/config`（`SANDBOX_TRIAL_DAYS`。既定 30 日）だけであり、
 *    API ハンドラに日数をベタ書きしない。
 */
export function sandboxTrialDays(): number {
  ensureDbConfigured();
  if (cachedSandboxTrialDays === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない。
    throw new Error('SANDBOX_TRIAL_DAYS が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedSandboxTrialDays;
}

/**
 * 🔴 管理平面の Auth.js インスタンス（`lib/auth/platform.ts`）だけが読む署名鍵。
 *    主平面の `AUTH_SECRET`（Auth.js が自動で読む）とは**別の値**であることを
 *    `packages/config` の起動時検証が保証している（同値なら起動に失敗する）。
 */
export function platformAuthSecret(): string {
  ensureDbConfigured();
  if (cachedPlatformAuthSecret === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない
    // （不変条件違反。フォールバックせず、そのまま失敗させる。CLAUDE.md §11.1）。
    throw new Error('AUTH_PLATFORM_SECRET が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedPlatformAuthSecret;
}
