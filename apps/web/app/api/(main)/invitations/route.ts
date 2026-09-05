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
// 🔴 T-04-07: 取引先の担当者を招くための**招待先の選択**は `targetPartnerCompanyId` で受ける
//    （`F-007`。キー名の決着の全文は `lib/api/isolation-keys.ts` の `TARGET_SELECTION_KEYS`）。
//    実行者のスコープはこれまでどおり ctx だけから決まり、指定された ID は
//    `issueInvitation` が **RLS の母集団に照合**してから使う（他テナントの ID を書けない）。
import { readRequestMeta } from '../../../../lib/auth/session';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { sendingDomainRuntime } from '../../../../lib/db/bootstrap';
import { issueInvitation } from '../../../../lib/invitations/service';
import { evaluateSendingDomain } from '../../../../lib/settings/sending-domains';
import { INVITATION_ISSUER_ROLES } from '../../../../lib/invitations/policy';
import { createInvitationBodySchema } from '../../../../lib/invitations/schemas';
import type { AccountMailDeliveryState } from '../../../../lib/jobs/account-mail';

// 🔴 Node ランタイム固定（Prisma / node:crypto は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * docs/05 §6.4 #14 の応答。
 * 🔴 `inviteUrl` はまだ返さない —— `APP_ENV='sandbox'` かつ**取引先の担当者宛**のときだけ返る値
 *    （`F-007 AC-4`）であり、`SandboxInvitationView` / `ProductionInvitationView` の
 *    **判別可能な合併**として実装するのは **T-04-08** である（docs/05 §6.4）。
 *    それまで**フィールドごと持たない**（`production` で誤って返さないための形）。
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
    // 🔴 `requireVerifiedSendingDomain` は**掛けない**（`F-007 AC-5`）。取引先宛でも
    //    「招待そのものは作成できるが、送達は検証完了後」であり、422 で拒否すると
    //    招待を作ることすらできなくなる。判定は同じ関数（`evaluateSendingDomain`）を
    //    `issueInvitation` が使い、応答の `deliveryState` に写像する（docs/05 §8.3）。
    // 🔴 関数のまま渡す ——自社メンバー宛（分類 1）では**1 度も呼ばれない**
    //    （`F-001 AC-5`「送信ドメインの検証状態に依存しない」）。
    const result = await issueInvitation(ctx, body, await readRequestMeta(), (invitationCtx) =>
      evaluateSendingDomain(invitationCtx, sendingDomainRuntime()),
    );
    const responseBody: CreateInvitationResponse = {
      id: result.id,
      deliveryState: result.deliveryState,
    };
    return Response.json(responseBody, { status: 201, headers: { 'cache-control': 'no-store' } });
  },
);
