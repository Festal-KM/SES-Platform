// apps/web/app/(main)/proposals/[id]/approve/page.tsx
// `S-021` 提案の承認。docs/04 §S-021 / §6.1 / `F-021` `F-020` / docs/05 §6.5 #41 / #42 / #40 / §11.5。T-09-03。
// 🔴 **Tier 1（モバイル完結）。** 承認は移動中のスマートフォンで発生する（`CLAUDE.md` §13.1）。
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8「見えない ＝ 存在しない」）。母集団を絞るのは `proposals` の RLS（C5）であり、
//    この画面に `where` を足さない。取引先は自社が作成した提案だけに到達する（内容とゲート結果の確認まで。◐）。
// 🔴 **判断材料は凍結側（`EngineerSnapshot`）と `ReviewGate` の結果からだけ組む**（`readProposalApproval`）。
//    台帳の現在値を混ぜない（`F-019 AC-1` / `AC-2`）。
// 🔴 承認・却下の導線は「承認ロール（`PROPOSAL_APPROVAL_ROLES`。#41 / #42 と同じ定数）× ホスト所属 × テナントが実行可
//    × 状態が `APPROVAL_PENDING`」のときだけ描く（書き写さない。判定は `canApproveProposal` の 1 本）。
//    拒否の本体は API のガードと `approveProposalByUser` / `rejectProposal` である。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { readProposalApproval } from '../../../../../lib/proposals/approval';
import { proposalApprovalRows } from '../../../../../lib/proposals/approval-rows';
import { proposalSendingDomainRows } from '../../../../../lib/proposals/editor-rows';
import { proposalParamsSchema } from '../../../../../lib/proposals/schemas';
import { proposalSendingDomainFact } from '../../sending-domain';
import { PROPOSAL_APPROVAL_AUDIT_PATH, PROPOSAL_APPROVAL_HOME_PATH, proposalApprovalScreenMessages } from './approval-props';
import { ProposalApprovalScreen } from './proposal-approval-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名・エンジニア名を入れない（ブラウザの履歴・タブに残る）。 */
export const metadata: Metadata = { title: t('proposals.approval.title') };

/** 監査ログ（`S-041`）に到達できるロール（`GET /api/audit-logs` は `OWNER` / `ADMIN`）。 */
const AUDIT_LOG_ROLES = ['OWNER', 'ADMIN'] as const;

export default async function ProposalApprovalPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と同じスキーマで検証する（UUID でなければ 404。存在を探らせない）。
  const parsed = proposalParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const now = new Date();
  const view = await readProposalApproval(ctx, parsed.data.id, { now }).catch((error: unknown) => {
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const rows = proposalApprovalRows(view, now);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は承認・却下の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);
  const sendingDomain = proposalSendingDomainRows(await proposalSendingDomainFact(ctx));
  const auditHref =
    ctx.partnerCompanyId === null && (AUDIT_LOG_ROLES as readonly string[]).includes(ctx.role)
      ? PROPOSAL_APPROVAL_AUDIT_PATH
      : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposals.approval.breadcrumb.home')} / {t('proposals.approval.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.approval.title')}</h1>
      <ProposalApprovalScreen
        proposalId={rows.id}
        rows={rows}
        denialMessage={denialKey === null ? null : t(denialKey)}
        sendingDomain={sendingDomain}
        auditHref={auditHref}
        homeHref={PROPOSAL_APPROVAL_HOME_PATH}
        messages={proposalApprovalScreenMessages()}
      />
    </main>
  );
}
