// apps/web/app/(main)/engineers/[id]/not-found.tsx
// `S-006`（詳細）の 404 境界。docs/04 §S-006「空 / ローディング / エラー」。T-05-02。
//
// 🔴 到達経路は `page.tsx` の `notFound()` の 1 本だけである。境界外（他パートナー所有 /
//    他テナント）と不存在（削除済み）を**区別しない**（docs/05 §4.8「見えない ＝ 存在しない」/
//    `F-008 AC-3`）。文言も `S-007` の 404 と同じ 1 種類しか持たない —— 「他社の人材です」と
//    書いた時点で、他社にその ID の人材が居ることを教えてしまう。
// ⚠️ docs/04 §S-006 の「保持期間を過ぎて削除されました」（`F-046 AC-2`）は**別の状態**であり、
//    保持期間の削除ジョブと同じ SP-16（T-16-06）で足す。ジョブが無い Phase 1 では到達しない
//    状態のために、ここに文言だけを置かない。
import { t } from '@ses/i18n';
import { ENGINEER_FORM_CANCEL_HREF } from '../_form/form-props';

export default function EngineerDetailNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('engineers.detail.title')}</h1>
      <p className="mb-4 text-sm text-slate-700" data-testid="engineer-not-found">
        {t('engineers.notFound')}
      </p>
      {/* 🔴 T-05-09: 戻り先を `S-005`（一覧）にした（`ENGINEER_FORM_CANCEL_HREF` と共有）。 */}
      <a className="ses-secondary-link" href={ENGINEER_FORM_CANCEL_HREF}>
        {t('engineers.breadcrumb.list')}
      </a>
    </main>
  );
}
