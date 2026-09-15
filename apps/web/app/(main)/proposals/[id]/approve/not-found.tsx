// apps/web/app/(main)/proposals/[id]/approve/not-found.tsx
// `S-021`（提案の承認）の 404 境界。docs/05 §4.8「見えない ＝ 存在しない」。T-09-03。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他社が作成した提案 / 他テナント）と不存在を
//    **区別しない**（区別すると存在を教えることになる。`F-019 AC-4`）。したがって文言も 1 種類しか持たない。
import { SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';

export default function ProposalApprovalNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.approval.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="proposal-approval-not-found">
        {t('proposals.approval.notFound')}
      </p>
      <a className={SECONDARY_LINK_STACKED_CLASSES} href="/">
        {t('proposals.approval.breadcrumb.home')}
      </a>
    </main>
  );
}
