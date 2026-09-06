// apps/web/app/(main)/projects/[id]/edit/not-found.tsx
// `S-012`（編集）の 404 境界。docs/04 §10.1 `S-012`「対象が削除済み → 一覧へ」。T-06-01。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他テナント）と
//    不存在（削除済み）を**区別しない**（docs/05 §4.8「見えない ＝ 存在しない」）。
//    したがって文言も 1 種類しか持たない。
// ⚠️ 戻り先は `PROJECT_FORM_CANCEL_HREF` と共有する（キャンセルと 404 でずれないように）。
//    `S-010`（案件一覧）が入る T-06-03 で 1 か所を差し替える。
import { t } from '@ses/i18n';
import { PROJECT_FORM_CANCEL_HREF } from '../../_form/form-props';

export default function EditProjectNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('projects.edit.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="project-not-found">
        {t('projects.notFound')}
      </p>
      <a className="ses-secondary-link" href={PROJECT_FORM_CANCEL_HREF}>
        {t('projects.breadcrumb.home')}
      </a>
    </main>
  );
}
