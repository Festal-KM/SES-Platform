// apps/web/lib/home/service.ts
// `GET /api/me`（docs/05 §6.3 #8）/ `GET /api/home`（#9）の実装本体。T-03-06。
import type { AppEnvKind } from '@ses/config';
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { CHANGED_SINCE_SAFETY_MARGIN_MS } from './action-queue';
import { deriveMainCapabilities } from './capabilities';
import type { HomeBlock, HomeView, MeView } from './types';

/**
 * `GET /api/home`（`F-006`）。
 *
 * 🔴 承認待ち・送信失敗・公開案件・提案依頼は Phase 1、満了間近は Phase 2 が
 *    ブロックを追加する。**ブロックが未実装であることを理由に、境界の適用（②）と
 *    説明（③）を省略しない**（`F-006` 処理）。
 * 🔴 **純粋関数のままにしてある**（DB を読まない）。応答の**型**はロールと所属だけで決まり、
 *    中身（`blocks`）は呼び出し側が `readHomeBlocks` で読んで渡す。
 *    🔴 `blocks` に既定値（`[]`）を置かない —— 置くと「読むのを忘れたホーム」が
 *    **正常に空として**描かれ、隔離の周知（`F-011` 処理④）が黙って消える。
 * 🔴 T-12-15: `readAt` は **`readHomeBlocks` を呼ぶ前**に取った時刻を渡す（`changedSince` の基準）。応答を組む時刻にすると、
 *    読み取りと応答の間に更新された行が次回の差分（`rowVersion >= changedSince`）から漏れる。未指定なら現在時刻（Phase 0 の呼び方）。
 * 🔴 T-12-15 指摘 4: `changedSince` は `readAt` そのものではなく `readAt - CHANGED_SINCE_SAFETY_MARGIN_MS`（`updated_at` が
 *    コミット前に採番される窓を吸収する。`action-queue.ts` のコメント参照。`>=` の重複は無害なので安全側に丸めてよい）。
 */
export function getHomeView(
  ctx: AuthenticatedTenantCtx,
  blocks: readonly HomeBlock[],
  readAt: Date = new Date(),
): HomeView {
  const changedSince = new Date(readAt.getTime() - CHANGED_SINCE_SAFETY_MARGIN_MS).toISOString();
  if (ctx.partnerCompanyId === null) {
    return { audience: 'HOST', blocks, changedSince };
  }
  return {
    audience: 'PARTNER',
    blocks,
    changedSince,
    // 🔴 F-006 AC-2: 固定文言のみ（他社の件数・存在を含まない）。
    visibilityNotice: { messageKey: 'home.partner.visibilityNotice' },
  };
}

/** `GET /api/me`（`F-006`）。`appEnv` は起動時に確定した値を呼び出し側から渡す。 */
export async function getMeView(
  ctx: AuthenticatedTenantCtx,
  params: { readonly appEnv: AppEnvKind },
): Promise<MeView> {
  const row = requireFound(
    await withTenant(ctx, (db) =>
      db.user.findFirst({
        where: { id: ctx.userId },
        select: { id: true, displayName: true, email: true },
      }),
    ),
  );
  return {
    user: row,
    role: ctx.role,
    partnerCompanyId: ctx.partnerCompanyId,
    capabilities: deriveMainCapabilities(ctx.role),
    tenantState: ctx.lifecycleState,
    env: params.appEnv,
  };
}
