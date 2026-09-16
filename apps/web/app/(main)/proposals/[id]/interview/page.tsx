// apps/web/app/(main)/proposals/[id]/interview/page.tsx
// `S-024` 商談結果の記録。docs/04 §S-024 / `F-025` / docs/05 §6.5 #48「`S-024` の実装の決着（T-09-10）」。T-09-10。
// 🔴 **Tier 1（モバイル完結）。** 面談日程の確定・結果の記録は移動中のスマートフォンで発生する（`CLAUDE.md` §13.1）。
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8「見えない ＝ 存在しない」）。母集団を絞るのは `proposals` の RLS（C5）であり、この画面に
//    `where` を足さない。取引先は自社が作成した提案だけに到達する。
// 🔴 **判断材料は #46 と同じ 1 実装（`readProposalDetail`）から組む**（凍結側だけ。`F-019 AC-5`）。
// 🔴 **出す操作はサーバで決める**（`proposalInterviewRows` = 遷移表 × #48 の射程 × `canTransitionProposal`）。ロールで到達を止めない
//    （`docs/04` §S-024 の必要ロールは全ロール）。拒否の本体は #48 のガードと `transitionProposal`。
// 🔴 **`AuditLog` を書かない。** 商談の記録は #48 が業務トランザクション内で記録する（閲覧は `BR-27` の対象外）。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PROPOSAL_STATES, type ProposalState } from '@ses/domain';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { proposalStateLabel } from '../../../../../lib/proposals/editor-rows';
import { PROPOSALS_PATH, proposalDetailHref } from '../../../../../lib/proposals/hrefs';
import { readProposalInterview } from '../../../../../lib/proposals/interview';
import { PROPOSAL_INTERVIEW_MEMO_MAX_LENGTH } from '../../../../../lib/proposals/interview-note';
import { proposalInterviewRows } from '../../../../../lib/proposals/interview-rows';
import { proposalParamsSchema } from '../../../../../lib/proposals/schemas';
import { proposalInterviewNoteLabels, proposalInterviewScreenMessages } from './interview-props';
import { ProposalInterviewScreen } from './proposal-interview-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名・エンジニア名を入れない（ブラウザの履歴・タブに残る）。 */
export const metadata: Metadata = { title: t('proposals.interview.title') };

function stateLabels(): Readonly<Record<ProposalState, string>> {
  return Object.fromEntries(PROPOSAL_STATES.map((state) => [state, proposalStateLabel(state)])) as Readonly<Record<ProposalState, string>>;
}

export default async function ProposalInterviewPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と同じスキーマで検証する（UUID でなければ 404。存在を探らせない）。
  const parsed = proposalParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const now = new Date();
  const view = await readProposalInterview(ctx, parsed.data.id, { now }).catch((error: unknown) => {
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const rows = proposalInterviewRows(view.screen, ctx, view.subject, now);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は記録の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposals.interview.breadcrumb.home')} / <a href={PROPOSALS_PATH}>{t('proposals.interview.breadcrumb.list')}</a> /{' '}
        <a href={proposalDetailHref(rows.id)}>{t('proposals.interview.breadcrumb.detail')}</a> / {t('proposals.interview.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.interview.title')}</h1>
      <ProposalInterviewScreen
        proposalId={rows.id}
        rows={rows}
        isViewer={ctx.role === 'VIEWER'}
        denialMessage={denialKey === null ? null : t(denialKey)}
        noteLabels={proposalInterviewNoteLabels()}
        memoMaxLength={PROPOSAL_INTERVIEW_MEMO_MAX_LENGTH}
        stateLabels={stateLabels()}
        messages={proposalInterviewScreenMessages()}
      />
    </main>
  );
}
