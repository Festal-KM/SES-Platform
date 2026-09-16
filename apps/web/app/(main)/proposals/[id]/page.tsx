// apps/web/app/(main)/proposals/[id]/page.tsx
// `S-023` 提案の詳細と履歴。docs/04 §S-023 / `F-024` `F-025` `F-019 AC-5` / docs/05 §6.5 #46 / #47。T-09-09。
// 🔴 **Tier 2（モバイル閲覧可）。**
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8「見えない ＝ 存在しない」）。母集団を絞るのは `proposals` の RLS（C5）であり、この画面に
//    `where` を足さない。取引先は自社が作成した提案だけに到達する（`F-024 AC-3`）。
// 🔴 **判断材料は凍結側（`EngineerSnapshot`）と `ReviewGate` の結果からだけ組む**（`readProposalDetail`。`GET /api/proposals/{id}` と
//    同じ関数）。台帳の現在値を混ぜない（`F-019 AC-1` / `AC-5`）。
// 🔴 **ロールで到達を止めない**（`docs/04` §S-023 の必要ロールは全ロール）。メモの導線だけ `canAddNote`（立場）× 実行可 × 非 `VIEWER` で
//    出し分ける。拒否の本体は #47 のガードと `createProposalNote`。
// 🔴 **`AuditLog` を書かない。** 提案詳細の閲覧は `BR-27` の閲覧記録の対象ではない（スキルシートの閲覧・DL は `S-008` 側で記録される）。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { readProposalDetail } from '../../../../lib/proposals/detail';
import { proposalDetailRows } from '../../../../lib/proposals/detail-rows';
import { PROPOSALS_PATH } from '../../../../lib/proposals/hrefs';
import { PROPOSAL_NOTE_MAX_LENGTH, proposalParamsSchema } from '../../../../lib/proposals/schemas';
import { proposalDetailScreenMessages } from './detail-props';
import { ProposalDetailScreen } from './proposal-detail-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名・エンジニア名を入れない（ブラウザの履歴・タブに残る）。 */
export const metadata: Metadata = { title: t('proposals.detail.title') };

export default async function ProposalDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と同じスキーマで検証する（UUID でなければ 404。存在を探らせない）。
  const parsed = proposalParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const now = new Date();
  const screen = await readProposalDetail(ctx, parsed.data.id, { now }).catch((error: unknown) => {
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const rows = proposalDetailRows(screen, now);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中はメモの追加を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposals.detail.breadcrumb.home')} / {t('proposals.detail.breadcrumb.list')} / {t('proposals.detail.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.detail.title')}</h1>
      <ProposalDetailScreen
        proposalId={rows.id}
        rows={rows}
        isViewer={ctx.role === 'VIEWER'}
        denialMessage={denialKey === null ? null : t(denialKey)}
        listHref={PROPOSALS_PATH}
        noteMaxLength={PROPOSAL_NOTE_MAX_LENGTH}
        messages={proposalDetailScreenMessages()}
      />
    </main>
  );
}
