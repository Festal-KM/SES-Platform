// apps/web/app/(main)/proposals/[id]/edit/not-found.tsx
// `S-020`（提案の編集）の 404 境界。docs/05 §4.8「見えない ＝ 存在しない」。T-09-01。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他社が作成した提案 / 他テナント）と不存在を
//    **区別しない**（区別すると存在を教えることになる。`F-019 AC-4`）。したがって文言も 1 種類しか持たない。
import { SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';

export default function ProposalEditNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.editor.title.edit')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="proposal-editor-not-found">
        {t('proposals.editor.notFound')}
      </p>
      <a className={SECONDARY_LINK_STACKED_CLASSES} href="/">
        {t('proposals.editor.breadcrumb.home')}
      </a>
    </main>
  );
}
