// apps/web/app/(main)/proposals/send-failures/loading.tsx
// `S-022` のローディング（docs/04 §10.1 `S-022` Load「テーブル骨格」/ 部分 Load「一覧を先に」）。T-09-08。
//
// 🔴 葉のセグメントに置く（境界はこの画面だけを包む。`tests/static/route-boundaries.test.ts`）。
// 🔴 **件数を書かない**（0 件と読み違えられる。`S-010` の loading と同じ判断）。画面全体を空にしない。
// 🔴 SP-22 段④: 骨格は `@ses/ui` の `Skeleton` が描く（§10.4 の `Load` の行）。幅は
//    `PageBody widthClass="split"`（🔴 **改訂 26（2026-10-03）で `S-022` はクラス B になった。**
//    `aside` は渡さない —— 読み込み中は副カラムの中身が無いため。`projects/(list)/loading.tsx` と
//    同じ形）であり、画面に `max-w-*` を書かない。
// 🔴 **`page.tsx` と同じクラスにする**（境界だけ別のクラスだと本体幅が読み込み中と表示中で動く）。
import { t } from '@ses/i18n';
import { PageBody, Skeleton } from '@ses/ui';

/** docs/04 §10.1 の「テーブル骨格」。失敗は通常 0〜数件なので短い骨格でよい。 */
const SKELETON_ROWS = 4;

export default function SendFailuresLoading() {
  return (
    <main className="py-6" aria-busy="true">
      <PageBody widthClass="split">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('sendFailures.title')}</h1>
        <p role="status" className="mb-4 text-body text-fg-muted" data-testid="send-failure-loading">
          {t('sendFailures.loading')}
        </p>
        <div data-testid="send-failure-skeleton">
          <Skeleton height="body" lines={SKELETON_ROWS} />
        </div>
      </PageBody>
    </main>
  );
}
