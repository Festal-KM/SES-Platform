// apps/web/lib/home/service.ts
// `GET /api/me`（docs/05 §6.3 #8）/ `GET /api/home`（#9）の実装本体。T-03-06。
import type { AppEnvKind } from '@ses/config';
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { deriveMainCapabilities } from './capabilities';
import type { HomeView, MeView } from './types';

/**
 * `GET /api/home`（`F-006`）。
 *
 * 🔴 Phase 0 は空のダッシュボード（CLAUDE.md §5）。承認待ち・送信失敗・公開案件・提案依頼は
 *    Phase 1、満了間近は Phase 2 が中身を追加する。**ブロックが未実装であることを理由に、
 *    境界の適用（②）と説明（③）を省略しない**（`F-006` 処理）。
 * 🔴 純粋関数（DB を読まない）。ロールと所属だけで型・中身が決まるため、`withTenant` を
 *    開く必要が無い（Phase 1 が実データを足す時点でここに `withTenant` が入る）。
 */
export function getHomeView(ctx: AuthenticatedTenantCtx): HomeView {
  const changedSince = new Date().toISOString();
  if (ctx.partnerCompanyId === null) {
    return { audience: 'HOST', blocks: [], changedSince };
  }
  return {
    audience: 'PARTNER',
    blocks: [],
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
