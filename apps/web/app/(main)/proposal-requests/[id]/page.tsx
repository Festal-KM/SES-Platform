// apps/web/app/(main)/proposal-requests/[id]/page.tsx
// `S-018` 提案依頼の詳細と応諾・辞退（取引先）。docs/04 §S-018 / `F-018` `F-019` / docs/05 §6.5 #33 / #34。T-08-07。
//
// 🔴 **取引先専用の画面である**（`docs/04` §S-018 権限差分「ホスト側ロールはこの画面に到達しない」）。
//    ホスト文脈は `readPartnerProposalRequestDetail` の `assertPartnerContext` が 404 にする（403 と区別しない。
//    docs/05 §4.8）。**ロールで隠すのではなく所属で決める**（取引先の `VIEWER` は閲覧のみで到達できる）。
// 🔴 **境界外の ID は 404**（docs/05 §4.8）。母集団を絞るのは `proposal_requests` の RLS（C5）であり、
//    この画面に `where` を足さない。
// 🔴 案件の共通部分を読んだ記録（`project.view` / `via='PROPOSAL_REQUEST'`）は `readPartnerProposalRequestDetail` の
//    業務トランザクションの内側で書かれる（`BR-27`）。自社に公開されていない案件は読めず、記録も無い。
// 🔴 応諾・辞退の導線は「応答ロール（`PROPOSAL_REQUEST_RESPONDER_ROLES`。#33 / #34 と同じ定数）× テナントが実行可
//    × 状態が `REQUESTED`（× 応諾は案件が公開されている）」のときだけ描く。書き写さない。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../lib/api/guards';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { proposalRequestDetailRows } from '../../../../lib/proposal-requests/detail-rows';
import { isProposalRequestResponderRole } from '../../../../lib/proposal-requests/policy';
import { proposalRequestParamsSchema } from '../../../../lib/proposal-requests/schemas';
import { readPartnerProposalRequestDetail } from '../../../../lib/proposal-requests/service';
import { ProposalRequestRespondScreen } from './proposal-request-respond-screen';
import { proposalRequestRespondScreenMessages } from './respond-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名・エンジニア名を入れない（ブラウザの履歴・タブに残る。`S-011` と同じ規律）。 */
export const metadata: Metadata = { title: t('proposalRequests.respond.title') };

export default async function ProposalRequestRespondPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と同じスキーマで検証する（UUID でなければ 404。存在を探らせない）。
  const parsed = proposalRequestParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const meta = await readRequestMeta();
  const view = await readPartnerProposalRequestDetail(ctx, parsed.data.id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 境界外・不存在・ホスト文脈のどれも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は応諾・辞退の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposalRequests.breadcrumb.home')} / {t('proposalRequests.respond.breadcrumb.list')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposalRequests.respond.title')}</h1>
      <ProposalRequestRespondScreen
        rows={proposalRequestDetailRows(view)}
        canRespond={isProposalRequestResponderRole(ctx.role)}
        denialMessage={denialKey === null ? null : t(denialKey)}
        nowMs={Date.now()}
        messages={proposalRequestRespondScreenMessages()}
      />
    </main>
  );
}
