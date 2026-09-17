// apps/web/app/api/admin/demo/seed/route.ts
// docs/05 §6.9 API-A16 `GET` / `POST /api/admin/demo/seed`（`F-053` / `A-012`）。T-10-06。
//
// 🔴 **`APP_ENV ∈ {demo, development}` 以外は 403**（`F-053 AC-6`。1 枚目のガード = `assertDemoSeedAvailable`。判定は
//    `packages/config` の `isSeedableAppEnv` が唯一の出所）。2 枚目は `runSeed` の先頭（`assertSeedableAppEnv`）と
//    `SEED_DATABASE_URL` の起動時検証（`packages/config`）。**認証・認可の後、投入に到達する前**にこの順で止める。
// 🔴 認可: `PLATFORM_OWNER` / `PLATFORM_SUPPORT` とも可（docs/04 §A-012 権限差分。対象は `demo` プリセットの**合成データ**だけであり、
//    テナントの業務データへの書き込みではない。`BR-37` / `CLAUDE.md` §10.5 / docs/02 章 4.4 の注記）。
// 🔴 書き込みの実体は `runSeed`（`@ses/db/seed`。特権接続）であり `withPlatformWrite` の 7 ドメインの外にある。運営者の操作としては
//    `readDemoSeedStatus(action='admin.demo.seed')` が **同じ要求の中で** `AuditLog` に残す（`GET` は `admin.demo.view`）。
// ✅ T-10-07: `reset`（`POST /api/admin/demo/reset`）は `../reset/route.ts`（別ルート。削除と投入は別操作）。
// 🔴 応答は件数・状態・日時と合成の商号だけ（`CLAUDE.md` §10.5）。エンジニアの氏名・提案の本文・単価は型として存在しない。
import { errorResponse } from '../../../../../lib/api/errors';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../../lib/auth/platform-session';
import { demoSeedRuntime } from '../../../../../lib/db/bootstrap';
import { assertDemoSeedAvailable, readDemoSeedForAdmin, runDemoSeedForAdmin } from '../_lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  try {
    // 🔴 認証・認可が先（未認証の呼び出しに環境の可否を教えない）。
    const ctx = await requirePlatformCtx();
    const runtime = demoSeedRuntime();
    // 🔴 1 枚目のガード（403）。サービス側でも同じ関数を通す（ルートを迂回した呼び出しにも効く）。
    assertDemoSeedAvailable(runtime.appEnv);
    const meta = await readPlatformRequestMeta();
    const body = await readDemoSeedForAdmin(ctx, runtime, { ipAddress: meta.ipAddress, now: () => new Date() });
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** API-A16 `seed`。request は空である（データセットは `seed:demo` の 1 つだけ。「本番からコピー」に相当する入力は存在しない。`BR-47`）。 */
export async function POST(): Promise<Response> {
  try {
    const ctx = await requirePlatformCtx();
    const runtime = demoSeedRuntime();
    assertDemoSeedAvailable(runtime.appEnv);
    const meta = await readPlatformRequestMeta();
    const body = await runDemoSeedForAdmin(ctx, runtime, { ipAddress: meta.ipAddress, now: () => new Date() });
    return Response.json(body, { status: body.outcome === 'SEEDED' ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
