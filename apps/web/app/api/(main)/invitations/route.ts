// apps/web/app/api/(main)/invitations/route.ts
// docs/05 §6.4 #14 `POST /api/invitations`（`F-002` / `S-035` / `S-014`）。
//
// 🔴 Route Handler である（Server Actions を使わない。docs/05 §6.1 / P-A-04）。
// 🔴 認可は `OWNER` / `ADMIN`（ホスト）。`PARTNER_ADMIN` は自社 + パートナーロールのみだが、
//    Phase 0 はホストロール宛だけなので 422 で拒否される（`lib/invitations/policy.ts` と
//    `PartnerInvitationNotAvailableError` の説明を参照）。
// 🔴 body に `tenantId` / `partnerCompanyId` を受け付けない（`F-003 AC-1` / `F-004 AC-2`）。
//    所属は `requireTenantCtx()`（＝セッション + DB）からのみ決まる。
//
// ⚠️ T-03-04 への申し送り: 本ルートは実行系（外部へメールが出る）である。
//    `withApiRoute` が入ったら **`requireExecutable`（テナント状態ゲート）を必ず通す**こと
//    （docs/05 §6.2。`execute-guard.test.ts` の走査対象になる）。T-03-03 の時点では
//    ガードの実装そのものが存在しないため、ここには置いていない。
import { errorResponse } from '../../../../lib/api/errors';
import { readRequestMeta, requireTenantCtx } from '../../../../lib/auth/session';
import { ValidationError } from '../../../../lib/api/errors';
import { issueInvitation } from '../../../../lib/invitations/service';
import { createInvitationBodySchema } from '../../../../lib/invitations/schemas';
import type { AccountMailDeliveryState } from '../../../../lib/jobs/account-mail';

// 🔴 Node ランタイム固定（Prisma / node:crypto は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * docs/05 §6.4 #14 の応答。
 * 🔴 `inviteUrl` は返さない —— `APP_ENV='sandbox'` かつ**取引先の担当者宛**のときだけ返る値であり
 *    （`F-007 AC-4`）、Phase 0 のホストロール宛では定義上到達しない。**フィールドごと持たない。**
 */
export type CreateInvitationResponse = {
  readonly id: string;
  readonly deliveryState: AccountMailDeliveryState;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireTenantCtx();
    const raw: unknown = await request.json().catch(() => null);
    const parsed = createInvitationBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    const result = await issueInvitation(ctx, parsed.data, await readRequestMeta());
    const body: CreateInvitationResponse = {
      id: result.id,
      deliveryState: result.deliveryState,
    };
    return Response.json(body, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
