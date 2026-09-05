// apps/web/app/(main)/engineers/[id]/edit/not-found.tsx
// `S-007`（編集）の 404 境界。docs/04 §10.1 `S-007`「編集対象が削除済み → 一覧へ戻す」。T-05-01。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他パートナー所有 /
//    他テナント）と不存在（削除済み）を**区別しない**（docs/05 §4.8「見えない ＝ 存在しない」/
//    `F-008 AC-3`）。したがって文言も「見つかりませんでした」の 1 種類しか持たない ——
//    「他社の人材です」と書いた時点で、他社にその ID の人材が居ることを教えてしまう。
// 🔴 戻り先は `S-005`（一覧）だが T-05-09 まで存在しないため、暫定でホームへ戻す
//    （`ENGINEER_FORM_CANCEL_HREF` と同じ値を使い、2 箇所でずれないようにする）。
import { t } from '@ses/i18n';
import { ENGINEER_FORM_CANCEL_HREF } from '../../_form/form-props';

export default function EditEngineerNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('engineers.edit.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="engineer-not-found">
        {t('engineers.notFound')}
      </p>
      <a className="ses-secondary-link" href={ENGINEER_FORM_CANCEL_HREF}>
        {t('engineers.breadcrumb.home')}
      </a>
    </main>
  );
}
