// apps/web/app/(main)/projects/loading.tsx
// `S-010` のローディング（docs/04 §10.1 `S-010` Load「テーブル骨格」/ 部分 Load「件数を先に」）。
// T-06-03。
//
// 🔴 **画面全体を空にしない。** 何が出てくるのかが分かる形（テーブルの骨格）で待たせる。
// ⚠️ docs/04 §10.1 の部分 Load は「件数を先に」だが、件数（`total`）は一覧と**同じ `where` の
//    `COUNT`**（docs/05 §4.8）であり、行より先に確定する経路が無い。ここに**件数を書かない**
//    （0 件と読み違えられる。`S-005` の loading と同じ判断）。
import { t } from '@ses/i18n';

/** docs/04 §10.1 `S-005` / `S-010` の「テーブル骨格 12 行」。 */
const SKELETON_ROWS = 12;

export default function ProjectListLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8" aria-busy="true">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('projects.list.title')}</h1>
      <p role="status" className="mb-4 text-sm text-slate-600" data-testid="project-list-loading">
        {t('projects.list.loading')}
      </p>
      <div data-testid="project-list-skeleton">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="ses-skeleton-line" />
        ))}
      </div>
    </main>
  );
}
