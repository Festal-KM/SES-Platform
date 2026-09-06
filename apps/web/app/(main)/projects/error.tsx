'use client';

// apps/web/app/(main)/projects/error.tsx
// `S-010` の取得失敗（docs/04 §10.1 `S-010` Err「検索失敗 + 条件保持の再試行」）。T-06-03。
//
// 🔴 **条件を保持したまま再試行する。** `reset()` は同じ URL（＝ 同じ検索条件と `?cursor=`）で
//    セグメントを再描画する。ここでホームへ戻したり URL を捨てたりしない —— 利用者が
//    組み立てた条件が失われる（`S-005` の error と同じ規律）。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
import { t } from '@ses/i18n';

export default function ProjectListError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('projects.list.title')}</h1>
      <p role="alert" className="mb-1 text-sm font-semibold text-red-700" data-testid="project-list-error">
        {t('projects.list.error.title')}
      </p>
      <p className="mb-4 text-sm text-slate-700">{t('projects.list.error.lead')}</p>
      <button
        type="button"
        className="ses-submit w-auto px-4"
        onClick={() => reset()}
        data-testid="project-list-retry"
      >
        {t('projects.list.error.retry')}
      </button>
    </main>
  );
}
