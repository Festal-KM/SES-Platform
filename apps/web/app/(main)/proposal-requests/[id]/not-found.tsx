// apps/web/app/(main)/proposal-requests/[id]/not-found.tsx
// `S-018`（提案依頼の詳細）の 404 境界。docs/05 §4.8「見えない ＝ 存在しない」。T-08-07。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他社宛の依頼 / ホスト文脈）と
//    不存在を**区別しない**（区別すると存在を教えることになる）。したがって文言も 1 種類しか持たない。
import { SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';
import { PROPOSAL_REQUESTS_PATH } from '../../../../lib/proposal-requests/list-rows';

export default function ProposalRequestRespondNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposalRequests.respond.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="proposal-request-respond-not-found">
        {t('proposalRequests.respond.notFound')}
      </p>
      <a className={SECONDARY_LINK_STACKED_CLASSES} href={PROPOSAL_REQUESTS_PATH}>
        {t('proposalRequests.respond.backToList')}
      </a>
    </main>
  );
}
