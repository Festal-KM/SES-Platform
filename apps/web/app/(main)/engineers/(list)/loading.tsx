// apps/web/app/(main)/engineers/(list)/loading.tsx
//
// 🔴 **`(list)` ルートグループの中に置く理由は `projects/(list)/loading.tsx` 冒頭と同一である**
//    （T-06-04 Iteration 3）。`engineers/` の直下に置くと、`/engineers/new`（`S-007`）や
//    `/engineers/{id}`（`S-006`）にこの骨格が出るうえ、**それらのルートの `redirect()` が
//    HTTP 307 ではなくハイドレーション後のクライアント遷移になる**（`VIEWER` を
//    `/engineers/new` からホームへ戻す挙動が JS 依存になる）。
//    不変条件は `tests/static/route-boundaries.test.ts` が守る。
//
// `S-005` のローディング（docs/04 §10.1 `S-005` Load「テーブル骨格 12 行」）。T-05-09。
//
// 🔴 **画面全体を空にしない。** 何が出てくるのかが分かる形（テーブルの骨格）で待たせる
//    （`S-002` の骨格 1 行と同じ判断）。件数と行の内容は読めて初めて出せるため、
//    ここには**件数を書かない**（0 件と読み違えられる）。
// 🔴 T-22-06: 骨格は `@ses/ui` の `Skeleton` が描く（§10.4 の `Load` の行）。**画面が
//    `bg-slate-200` の `<div>` を並べない**（色は §7.9 の semantic トークンだけ）。幅は
//    `PageBody widthClass="full"`（`S-005` はクラス A）であり、画面に `max-w-*` を書かない。
import { t } from '@ses/i18n';
import { PageBody, Skeleton } from '@ses/ui';

/** docs/04 §10.1 `S-005`「テーブル骨格 12 行」。 */
const SKELETON_ROWS = 12;

export default function EngineerLedgerLoading() {
  return (
    <main className="py-6" aria-busy="true">
      <PageBody widthClass="full">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('engineers.list.title')}</h1>
        <p role="status" className="mb-4 text-body text-fg-muted" data-testid="engineer-list-loading">
          {t('engineers.list.loading')}
        </p>
        <div data-testid="engineer-list-skeleton">
          <Skeleton height="body" lines={SKELETON_ROWS} />
        </div>
      </PageBody>
    </main>
  );
}
