// apps/web/app/(main)/proposals/new/page.tsx
// `S-020` 提案の作成（新規）。docs/04 §S-020 改訂 10 / `F-019` / docs/05 §6.5 #36「T-09-01 の決着」。T-09-01。
//
// 🔴 **案件・エンジニア・提案先が決まった状態で作成する**（`docs/04` §S-020 改訂 10「#36 は提案先を必須入力に含める」）。
//    案件とエンジニアは query（`S-016` の「提案を作成」から）で指定し、母集団は `projects` の C4 / `engineers` の C3 が
//    決める。**どちらか一方でも見えなければ 404**（docs/05 §4.8。取引先が他社のエンジニアを、ホストが取引先の
//    エンジニアを指定できない）。
// 🔴 到達できるのは `PROPOSAL_EDITOR_ROLES`（#36 と同じ定数）。画面で止めるのは補助であり、拒否の本体は #36 の
//    `requireRole` / `requireNotViewer` / `requireExecutable` である（`F-004 AC-9`）。
// 🔴 凍結の予告（経験内容の行数。0 行なら注意）を作成前に出す。**0 行でも作成をブロックしない**（`F-008 AC-5`）。
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { NotFoundError } from '../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { proposalCreateRows, proposalSendingDomainRows } from '../../../../lib/proposals/editor-rows';
import { isProposalEditorRole } from '../../../../lib/proposals/policy';
import { newProposalQuerySchema } from '../../../../lib/proposals/schemas';
import { readProposalCreationTarget } from '../../../../lib/proposals/service';
import { proposalEditorMessages, PROPOSAL_EDITOR_HOME_PATH } from '../_editor/editor-props';
import { ProposalEditor } from '../_editor/proposal-editor';
import { proposalSendingDomainFact } from '../sending-domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名・エンジニア名を入れない（ブラウザの履歴・タブに残る。`S-011` と同じ規律）。 */
export const metadata: Metadata = { title: t('proposals.editor.title.new') };

/** 🔴 対象が指定されていない（`S-016` を経由していない）。存在を探る入力ではないので 404 ではなく案内を出す。 */
function TargetMissingNotice() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.editor.title.new')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="proposal-editor-target-missing">
        {t('proposals.editor.newTargetMissing')}
      </p>
      <Link className={SECONDARY_LINK_STACKED_CLASSES} href="/projects">
        {t('projects.breadcrumb.list')}
      </Link>
    </main>
  );
}

export default async function NewProposalPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;
  if (!isProposalEditorRole(ctx.role)) redirect(PROPOSAL_EDITOR_HOME_PATH);

  const raw = await searchParams;
  if (raw.projectId === undefined && raw.engineerId === undefined) return <TargetMissingNotice />;
  // 🔴 API と同じスキーマで検証する（UUID でなければ 404。存在を探らせない）。
  const parsed = newProposalQuerySchema.safeParse(raw);
  if (!parsed.success) notFound();

  const target = await readProposalCreationTarget(ctx, parsed.data).catch((error: unknown) => {
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const rows = proposalCreateRows(target);
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);
  const sendingDomain = proposalSendingDomainRows(await proposalSendingDomainFact(ctx));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposals.editor.breadcrumb.home')} / {t('proposals.editor.breadcrumb.new')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.editor.title.new')}</h1>
      <ProposalEditor
        mode="CREATE"
        proposalId={null}
        create={{ projectId: rows.projectId, engineerId: rows.engineerId, editHrefPattern: rows.editHrefPattern }}
        state={null}
        stateLabel={null}
        target={rows.target}
        freeze={rows.freeze}
        attachment={rows.attachment}
        initial={rows.initial}
        recipientMissing={false}
        originNotice={null}
        readOnlyNotice={null}
        canEdit={true}
        denialMessage={denialKey === null ? null : t(denialKey)}
        sendingDomain={sendingDomain}
        cancelHref={rows.cancelHref}
        cancelLabel={t('proposals.editor.cancel')}
        messages={proposalEditorMessages()}
      />
    </main>
  );
}
