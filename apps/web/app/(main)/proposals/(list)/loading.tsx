// apps/web/app/(main)/proposals/(list)/loading.tsx
// `S-019` のローディング（docs/04 §10.1「テーブル骨格」）。T-09-09。
//
// 🔴 ルートグループ `(list)` の葉に置く（`[id]` / `new` / `send-failures` を包まない。`tests/static/route-boundaries.test.ts`）。
// 🔴 **件数を書かない**（0 件と読み違えられる。`S-022` の loading と同じ判断）。
// 🔴 T-22-06: 骨格は `@ses/ui` の `Skeleton` が描く（§10.4 の `Load` の行）。幅は
//    `PageBody widthClass="full"`（`S-019` はクラス A）であり、画面に `max-w-*` を書かない。
import { t } from '@ses/i18n';
import { PageBody, Skeleton } from '@ses/ui';

const SKELETON_ROWS = 6;

export default function ProposalListLoading() {
  return (
    <main className="py-6" aria-busy="true">
      <PageBody widthClass="full">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('proposals.list.title')}</h1>
        <p role="status" className="mb-4 text-body text-fg-muted" data-testid="proposal-list-loading">
          {t('proposals.list.loading')}
        </p>
        <div data-testid="proposal-list-skeleton">
          <Skeleton height="body" lines={SKELETON_ROWS} />
        </div>
      </PageBody>
    </main>
  );
}
