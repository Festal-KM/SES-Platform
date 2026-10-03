// apps/web/app/(main)/proposals/[id]/interview/not-found.tsx
// `S-024`（商談結果の記録）の 404 境界。docs/05 §4.8「見えない ＝ 存在しない」。T-09-10。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他社が作成した提案 / 他テナント）と不存在を**区別しない**
//    （区別すると存在を教えることになる。`F-024 AC-3`）。したがって文言も 1 種類しか持たない。
import { PageBody, SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';
import { PROPOSALS_PATH } from '../../../../../lib/proposals/hrefs';

export default function ProposalInterviewNotFound() {
  return (
    // 🔴 幅は `PageBody` が決める（`docs/04` §7.1 / `U-23`）。404 は 1 文の読み物なのでクラス C。
    <main className="py-6">
      <PageBody widthClass="prose">
        <h1 className="mb-4 text-title font-semibold text-fg">{t('proposals.interview.title')}</h1>
        <p className="mb-4 text-body text-fg" data-testid="proposal-interview-not-found">
          {t('proposals.interview.notFound')}
        </p>
        <a className={SECONDARY_LINK_STACKED_CLASSES} href={PROPOSALS_PATH}>
          {t('proposals.interview.breadcrumb.list')}
        </a>
      </PageBody>
    </main>
  );
}
