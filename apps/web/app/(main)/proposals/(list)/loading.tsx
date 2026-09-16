// apps/web/app/(main)/proposals/(list)/loading.tsx
// `S-019` のローディング（docs/04 §10.1「テーブル骨格」）。T-09-09。
//
// 🔴 ルートグループ `(list)` の葉に置く（`[id]` / `new` / `send-failures` を包まない。`tests/static/route-boundaries.test.ts`）。
// 🔴 **件数を書かない**（0 件と読み違えられる。`S-022` の loading と同じ判断）。
import { t } from '@ses/i18n';

const SKELETON_ROWS = 6;

export default function ProposalListLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8" aria-busy="true">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('proposals.list.title')}</h1>
      <p role="status" className="mb-4 text-sm text-slate-600" data-testid="proposal-list-loading">
        {t('proposals.list.loading')}
      </p>
      <div data-testid="proposal-list-skeleton">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="mb-3 h-4 rounded-sm bg-slate-200" />
        ))}
      </div>
    </main>
  );
}
