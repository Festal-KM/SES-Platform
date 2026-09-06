// apps/web/app/(main)/projects/[id]/not-found.tsx
// `S-011`（案件詳細）の 404 境界。docs/05 §4.8「見えない ＝ 存在しない」。T-06-02。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他テナント / 一度も
//    公開されていない案件）と不存在（削除済み）を**区別しない**（区別すると存在を教えることになる）。
//    したがって文言も 1 種類しか持たない。
// ⚠️ **取引先が「以前は見えていた案件」を開いた場合はここに来ない**（`page.tsx` の
//    `ProjectNotSharedError` の枝が「この案件は現在御社に公開されていません」を出す。
//    docs/04 §10.1 `S-011`）。
// ⚠️ 戻り先は `PROJECT_FORM_CANCEL_HREF` と共有する。`S-010`（案件一覧）が入る T-06-03 で
//    1 か所を差し替える。
import { t } from '@ses/i18n';
import { PROJECT_FORM_CANCEL_HREF } from '../_form/form-props';

export default function ProjectDetailNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('projects.detail.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="project-not-found">
        {t('projects.notFound')}
      </p>
      <a className="ses-secondary-link" href={PROJECT_FORM_CANCEL_HREF}>
        {t('projects.breadcrumb.home')}
      </a>
    </main>
  );
}
