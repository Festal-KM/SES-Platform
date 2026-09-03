// apps/web/app/api/(main)/invitations/route.ts
// docs/05 §6.4 #14 `POST /api/invitations`（`F-002` / `S-035` / `S-014`）。
//
// 🔴 Route Handler である（Server Actions を使わない。docs/05 §6.1 / P-A-04）。
// 🔴 T-03-04: `withApiRoute` に載せ替え、**実行系のテナント状態ゲート（`requireExecutable`）を
//    装着した**（T-03-03 の申し送り）。招待は外部へメールが出る実行系であり、
//    `CLOSING` / `PURGED` のテナントでは実行できない（`F-004 AC-8`）。
//    `tests/static/execute-guard.test.ts` が全ルートを走査し、この装着漏れを検知する。
// 🔴 body に `tenantId` / `partnerCompanyId` を受け付けない（`F-003 AC-1` / `F-004 AC-2`）。
//    所属は `withApiRoute` が解決する認証コンテキストからのみ決まる
//    （スキーマが分離キーを持てば `withApiRoute` の構築時に落ちる）。
import { readRequestMeta } from '../../../../lib/auth/session';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { issueInvitation } from '../../../../lib/invitations/service';
import { INVITATION_ISSUER_ROLES } from '../../../../lib/invitations/policy';
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

export const POST = withApiRoute(
  {
    label: 'POST /api/invitations',
    // 🔴 並び順ではなく `withApiRoute` が docs/05 §6.2 の順（role → executable → notViewer）で実行する。
    guards: [
      // 粗いロールゲート。宛先まで含めた可否は `decideInvitation`（`F-002 AC-1` / `AC-4`）。
      requireRole(INVITATION_ISSUER_ROLES),
      requireExecutable(),
      // 🔴 `requireRole` と重なるが二重に掛ける: 許可ロール一覧を将来広げたときに
      //    `VIEWER` が滑り込まないため（`BR-31` は「承認・送信・DL を一切できない」）。
      requireNotViewer(),
    ],
    body: createInvitationBodySchema,
  },
  async ({ ctx, body }) => {
    const result = await issueInvitation(ctx, body, await readRequestMeta());
    const responseBody: CreateInvitationResponse = {
      id: result.id,
      deliveryState: result.deliveryState,
    };
    return Response.json(responseBody, { status: 201, headers: { 'cache-control': 'no-store' } });
  },
);
