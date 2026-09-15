// apps/web/app/(main)/proposals/[id]/edit/page.tsx
// `S-020` 提案の編集。docs/04 §S-020 改訂 10 / `F-019` `F-020` / docs/05 §6.5 #37 / #39 / #40「T-09-01 の決着」。T-09-01。
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8「見えない ＝ 存在しない」）。母集団を絞るのは `proposals` の RLS（C5）であり、
//    この画面に `where` を足さない。取引先は自社が作成した提案だけに到達する（`docs/04` §S-020 権限差分）。
// 🔴 **エンジニアの情報は凍結側（`EngineerSnapshot`）だけを描く**（`F-019 AC-1` / `AC-2`）。`readProposalEditor` は
//    台帳の現在値を view に入れない。
// 🔴 **提案先が未設定なら明示する**（`docs/04` §S-020 改訂 10）。経路 4 由来の `DRAFT` はここで埋める。
// 🔴 **`DRAFT` 以外は読み取り専用**（#37 は 422）。編集・レビュー依頼の導線は `canEditProposal`（作成者 / ホストの
//    営業・管理者）× テナントが実行可のときだけ活きる。`VIEWER` は閲覧のみ（到達はできる）。
// 🔴 開き方は 2 通り（`docs/04` §S-020 改訂 10）: #36 で作った提案は提案先が決まった状態、経路 4 由来（`S-018` の応諾）
//    は提案先が未設定の状態で開く。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { proposalEditRows, proposalSendingDomainRows } from '../../../../../lib/proposals/editor-rows';
import { proposalParamsSchema } from '../../../../../lib/proposals/schemas';
import { readProposalEditor } from '../../../../../lib/proposals/service';
import { proposalEditorMessages } from '../../_editor/editor-props';
import { ProposalEditor } from '../../_editor/proposal-editor';
import { proposalSendingDomainFact } from '../../sending-domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名・エンジニア名を入れない（ブラウザの履歴・タブに残る）。 */
export const metadata: Metadata = { title: t('proposals.editor.title.edit') };

export default async function EditProposalPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と同じスキーマで検証する（UUID でなければ 404。存在を探らせない）。
  const parsed = proposalParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const editor = await readProposalEditor(ctx, parsed.data.id).catch((error: unknown) => {
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const rows = proposalEditRows(editor);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は編集・レビュー依頼の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);
  const sendingDomain = proposalSendingDomainRows(await proposalSendingDomainFact(ctx));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposals.editor.breadcrumb.home')} / {t('proposals.editor.breadcrumb.edit')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.editor.title.edit')}</h1>
      <ProposalEditor
        mode="EDIT"
        proposalId={rows.id}
        create={null}
        state={rows.state}
        stateLabel={rows.stateLabel}
        target={rows.target}
        freeze={rows.freeze}
        attachment={rows.attachment}
        initial={rows.initial}
        recipientMissing={rows.recipientMissing}
        originNotice={rows.originNotice}
        readOnlyNotice={rows.readOnlyNotice}
        canEdit={rows.canEdit}
        denialMessage={denialKey === null ? null : t(denialKey)}
        sendingDomain={sendingDomain}
        cancelHref={rows.cancelHref}
        approveHref={rows.approveHref}
        approveLabel={t('proposals.editor.openApproval')}
        cancelLabel={rows.cancelLabel}
        messages={proposalEditorMessages()}
      />
    </main>
  );
}
