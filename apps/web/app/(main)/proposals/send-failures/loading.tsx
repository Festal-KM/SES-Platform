// apps/web/app/(main)/proposals/send-failures/loading.tsx
// `S-022` のローディング（docs/04 §10.1 `S-022` Load「テーブル骨格」/ 部分 Load「一覧を先に」）。T-09-08。
//
// 🔴 葉のセグメントに置く（境界はこの画面だけを包む。`tests/static/route-boundaries.test.ts`）。
// 🔴 **件数を書かない**（0 件と読み違えられる。`S-010` の loading と同じ判断）。画面全体を空にしない。
import { t } from '@ses/i18n';

/** docs/04 §10.1 の「テーブル骨格」。失敗は通常 0〜数件なので短い骨格でよい。 */
const SKELETON_ROWS = 4;

export default function SendFailuresLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8" aria-busy="true">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('sendFailures.title')}</h1>
      <p role="status" className="mb-4 text-sm text-slate-600" data-testid="send-failure-loading">
        {t('sendFailures.loading')}
      </p>
      <div data-testid="send-failure-skeleton">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="mb-3 h-4 rounded-sm bg-slate-200" />
        ))}
      </div>
    </main>
  );
}
