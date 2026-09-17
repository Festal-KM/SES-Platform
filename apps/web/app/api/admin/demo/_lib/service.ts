// apps/web/app/api/admin/demo/_lib/service.ts
// API-A16（`POST /api/admin/demo/seed` / `GET`）と `A-012` の読み取りの実体（docs/05 §6.9 API-A16 / §13.6 / `F-053`）。T-10-06。
//
// 🔴 なぜ `app/api/admin/**/_lib` に置くか: `@ses/db/platform`（`readDemoSeedStatus`）を import できるのは管理平面の 2 区画
//    （`app/admin/**` / `app/api/admin/**`）だけである（ESLint の ADMIN_PLANE_ZONE）。`A-005` の `readers.ts` と同じ置き方。
// 🔴 `@ses/db/seed`（`runSeed`。特権接続で合成データを書く）の呼び出し元も**このファイル 1 本**に固定する。
//    主平面・ジョブ・他の管理平面のルートから `runSeed` を呼ぶ経路を作らない。
//
// ============================================================================
// 🔴 二重の環境ガード（`F-053 AC-6` / docs/05 §13.6「`packages/config` とミドルウェアの二重で拒否」）
// ============================================================================
//   1 枚目（ミドルウェア層 = ここ）: `assertDemoSeedAvailable` が `APP_ENV ∈ {demo, development}` 以外を **403** で止める。
//     判定関数は `packages/config` の `isSeedableAppEnv`（唯一の出所。ここで環境名の比較を書き直さない）。
//   2 枚目（`packages/config` 層）: `runSeed` の先頭の `assertSeedableAppEnv` と、`SEED_DATABASE_URL` が `demo` / `development`
//     以外に設定されていたら**起動時に落ちる**検証（`crossFieldChecks`）。1 枚目を迂回しても投入に到達しない。
// 🔴 `reset`（`F-053 AC-2` / `AC-4`〜`AC-6`）は **T-10-07**。本ファイルは `runSeedReset` を import しない。
import { isSeedableAppEnv, type AppEnvKind } from '@ses/config';
import type { AuthenticatedPlatformCtx } from '@ses/db';
import { readDemoSeedStatus } from '@ses/db/platform';
import { DEMO_SEED_IDS, runSeed, SeedIncompleteError } from '@ses/db/seed';
import {
  DemoSeedIncompleteError,
  DemoSeedNotAvailableError,
  DemoSeedNotConfiguredError,
} from '../../../../../lib/api/errors';
import type { DemoSeedOutcome, DemoSeedResponseView } from '../../../../../lib/admin-demo/view';

/** 「満了が近い稼働」の閾値（日）。`assignment.expiry-scan` の起票条件（満了 60 日前）に合わせる（`CLAUDE.md` §4.2）。 */
export const DEMO_SEED_EXPIRING_WITHIN_DAYS = 60;

/** `demo` プリセットの 2 テナント（`@ses/db/seed` が唯一の出所）。 */
const DEMO_TENANT_IDS: readonly string[] = DEMO_SEED_IDS.tenants.map((tenant) => tenant.tenantId);

export type DemoSeedRuntime = {
  readonly appEnv: AppEnvKind;
  /** `SEED_DATABASE_URL`。未設定は `null`（フォールバック無し）。 */
  readonly databaseUrl: string | null;
};

export type DemoSeedRequestMeta = {
  readonly ipAddress: string | null;
  readonly now: () => Date;
};

/** API-A16 の応答（`GET` / `POST` 共通）。形は `apps/web/lib/admin-demo/view.ts`（client 側と共有する純粋な型）。 */
export type DemoSeedResponse = DemoSeedResponseView;

/**
 * 🔴 1 枚目のガード。`demo` / `development` 以外は 403（`DemoSeedNotAvailableError`）。
 *    導線（`A-012` のタブ / 管理ホームのリンク）も同じ判定で消す（`apps/web/app/admin/page.tsx`）。
 */
export function assertDemoSeedAvailable(appEnv: AppEnvKind): void {
  if (!isSeedableAppEnv(appEnv)) throw new DemoSeedNotAvailableError();
}

function statusQuery() {
  return { tenantIds: DEMO_TENANT_IDS, expiringWithinDays: DEMO_SEED_EXPIRING_WITHIN_DAYS } as const;
}

/** `GET /api/admin/demo/seed`（`A-012` の投入状況）。閲覧そのものが `AuditLog(admin.demo.view)` に残る。 */
export async function readDemoSeedForAdmin(
  ctx: AuthenticatedPlatformCtx,
  runtime: DemoSeedRuntime,
  meta: DemoSeedRequestMeta,
): Promise<DemoSeedResponse> {
  assertDemoSeedAvailable(runtime.appEnv);
  const status = await readDemoSeedStatus(ctx, statusQuery(), {
    action: 'admin.demo.view',
    ipAddress: meta.ipAddress,
    now: meta.now(),
  });
  return { appEnv: runtime.appEnv, available: true, configured: runtime.databaseUrl !== null, outcome: null, status };
}

/**
 * `POST /api/admin/demo/seed`（合成データの投入）。
 *
 * 手順: ① 環境ガード（403）② 投入経路の有無（503）③ 🔴 **監査の先行**（`readDemoSeedStatus(action='admin.demo.seed', phase='REQUESTED')` =
 * `withPlatformRead` が `fn` の前に `AuditLog` を書く。docs/05 §5.3。ここで既に投入済みなら `runSeed` を開かず `ALREADY_SEEDED`）
 * ④ `runSeed`（`reset: false`。途中で止まっていれば 409）⑤ 投入直後の状況を `phase='COMPLETED'` + 帰結で記録しながら読み返す。
 * 🔴 投入の前後の 2 行が残る —— 途中で失敗しても「誰がいつ投入を要求したか」は残る（`CLAUDE.md` §10.5「運営者の全操作を記録」）。
 * 🔴 `PLATFORM_OWNER` / `PLATFORM_SUPPORT` のどちらも実行できる（docs/04 §A-012 権限差分 / docs/02 章 4.4 `F-053` の `PP` = ●）。
 *    対象が合成データに閉じているため、`BR-44`（契約・停止は `PO` のみ）とは衝突しない。
 */
export async function runDemoSeedForAdmin(
  ctx: AuthenticatedPlatformCtx,
  runtime: DemoSeedRuntime,
  meta: DemoSeedRequestMeta,
): Promise<DemoSeedResponse> {
  assertDemoSeedAvailable(runtime.appEnv);
  if (runtime.databaseUrl === null) throw new DemoSeedNotConfiguredError();

  const now = meta.now();
  // ③ 🔴 監査の先行。何も書く前に「投入を要求した」を残す（失敗しても記録が残る）。投入済みなら特権接続を開かずに返す。
  const before = await readDemoSeedStatus(ctx, statusQuery(), {
    action: 'admin.demo.seed',
    phase: 'REQUESTED',
    ipAddress: meta.ipAddress,
    now,
  });
  if (before.seeded) {
    const status = await readDemoSeedStatus(ctx, statusQuery(), {
      action: 'admin.demo.seed',
      phase: 'COMPLETED',
      outcome: 'ALREADY_SEEDED',
      ipAddress: meta.ipAddress,
      now,
    });
    return { appEnv: runtime.appEnv, available: true, configured: true, outcome: 'ALREADY_SEEDED', status };
  }

  let outcome: DemoSeedOutcome;
  try {
    const result = await runSeed({
      appEnv: runtime.appEnv,
      databaseUrl: runtime.databaseUrl,
      preset: 'demo',
      // 🔴 API-A16 の `seed` は削除を伴わない（`reset` は T-10-07 の別ルート）。二重投入は `runSeed` が止める。
      reset: false,
      now,
    });
    outcome = result.outcome === 'ALREADY_SEEDED' ? 'ALREADY_SEEDED' : 'SEEDED';
  } catch (error) {
    if (error instanceof SeedIncompleteError) throw new DemoSeedIncompleteError();
    throw error;
  }

  // ⑤ 帰結の記録（同じ action。`phase='COMPLETED'` と `outcome` で区別する）。
  const status = await readDemoSeedStatus(ctx, statusQuery(), {
    action: 'admin.demo.seed',
    phase: 'COMPLETED',
    outcome,
    ipAddress: meta.ipAddress,
    now,
  });
  return { appEnv: runtime.appEnv, available: true, configured: true, outcome, status };
}
