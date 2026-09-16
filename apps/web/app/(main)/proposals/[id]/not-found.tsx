// apps/web/app/(main)/proposals/[id]/not-found.tsx
// `S-023`（提案の詳細と履歴）の 404 境界。docs/05 §4.8「見えない ＝ 存在しない」。T-09-09。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他社が作成した提案 / 他テナント）と不存在を**区別しない**
//    （区別すると存在を教えることになる。`F-024 AC-3`）。したがって文言も 1 種類しか持たない。
// 🔴 `[id]/approve` / `[id]/edit` は自身の `not-found.tsx` を持つ（この境界はそれらを上書きしない）。
import { SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';
import { PROPOSALS_PATH } from '../../../../lib/proposals/hrefs';

export default function ProposalDetailNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.detail.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="proposal-detail-not-found">
        {t('proposals.detail.notFound')}
      </p>
      <a className={SECONDARY_LINK_STACKED_CLASSES} href={PROPOSALS_PATH}>
        {t('proposals.detail.breadcrumb.list')}
      </a>
    </main>
  );
}
