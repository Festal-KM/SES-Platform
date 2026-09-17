// apps/web/app/api/admin/demo/reset/route.ts
// docs/05 §6.9 API-A16 `POST /api/admin/demo/reset`（`F-053 AC-2` / `AC-6` / `A-012`）。T-10-07。
//
// 🔴 **`APP_ENV ∈ {demo, development}` 以外は 403**（`F-053 AC-6`。1 枚目のガード = `assertDemoSeedAvailable`。判定は
//    `packages/config` の `isSeedableAppEnv` が唯一の出所）。2 枚目は `runSeedReset` の先頭（`assertSeedableAppEnv`）と
//    `SEED_DATABASE_URL` の起動時検証（`packages/config`）。3 枚目は確認入力の環境名（サービス側。400）。
//    **認証の後、body を読む前**に 1 枚目で止める（非対象環境では body の形すら読まない）。
// 🔴 リセットは対象テナントの全業務データの削除にあたるため、環境ガードを実装の注意ではなく**実行前の判定**として持つ
//    （`F-053 AC-6`）。順序: 認証（`requirePlatformCtx` = `PLATFORM_OWNER` / `PLATFORM_SUPPORT`）→ 環境ガード（403）→ 書式（400
//    `VALIDATION`）→ 確認入力の照合（400 `DEMO_RESET_CONFIRMATION_MISMATCH`）→ 監査の先行（`admin.demo.reset` / `REQUESTED`）→
//    `runSeedReset` → 監査（`COMPLETED` + 帰結）。
// 🔴 認可: `PLATFORM_OWNER` / `PLATFORM_SUPPORT` とも可（docs/04 §A-012 権限差分。対象は `demo` プリセットの**合成データ**だけであり、
//    テナントの業務データへの書き込みではない。`BR-37` / `CLAUDE.md` §10.5 / docs/02 章 4.4 の注記）。
// 🔴 body に `tenantId` は無い。対象は `demo` プリセットの `tenantIds` に閉じる（任意のテナントを消せる API にしない）。
// 🔴 応答は件数・状態・日時と合成の商号だけ（`CLAUDE.md` §10.5）。直後の `status` は `seeded: false`。
// 🔴 リセット後に自動で再投入しない（削除と投入は別操作。実演者が「空の状態」を見せたいこともある）。
import { errorResponse, ValidationError } from '../../../../../lib/api/errors';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../../lib/auth/platform-session';
import { demoSeedRuntime } from '../../../../../lib/db/bootstrap';
import { assertDemoSeedAvailable, parseDemoResetBody, runDemoResetForAdmin } from '../_lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function POST(request: Request): Promise<Response> {
  try {
    // 🔴 認証が先（未認証の呼び出しに環境の可否・body の形を教えない）。
    const ctx = await requirePlatformCtx();
    const runtime = demoSeedRuntime();
    // 🔴 1 枚目のガード（403）。サービス側でも同じ関数を通す（ルートを迂回した呼び出しにも効く）。
    assertDemoSeedAvailable(runtime.appEnv);
    const parsed = parseDemoResetBody(await request.json().catch(() => null));
    if (!parsed.ok) return errorResponse(new ValidationError(parsed.issues));
    const meta = await readPlatformRequestMeta();
    const body = await runDemoResetForAdmin(ctx, runtime, parsed.value, { ipAddress: meta.ipAddress, now: () => new Date() });
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
