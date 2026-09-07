// apps/web/app/(main)/projects/(list)/loading.tsx
// `S-010` のローディング（docs/04 §10.1 `S-010` Load「テーブル骨格」/ 部分 Load「件数を先に」）。
// T-06-03 →（🔴 T-06-04 Iteration 3 で `(list)` ルートグループへ移動）。
//
// ============================================================================
// 🔴 **なぜ `(list)` ルートグループの中に置くか**（T-06-04 Iteration 3。戻さないこと）
// ============================================================================
// `loading.tsx` / `error.tsx` は**そのセグメントと、その配下のすべてのルート**を Suspense /
// エラー境界で包む。これを `projects/` の直下に置いていたため、次の 2 つが同時に壊れていた:
//   ①`/projects/new`（`S-012`）や `/projects/{id}`（`S-011`）を開くと、**別画面である
//     `S-010` の骨格**（「案件一覧を読み込んでいます…」）が出ていた。
//   ②🔴 **子ルートの `redirect()` が HTTP 307 にならなくなっていた。** 境界があると Next は
//     シェルを先に flush するため、その後で投げられた `redirect()` は
//     `NEXT_REDIRECT` の**ストリーム中のエラー digest**として届き、実際の遷移は
//     **クライアントのハイドレーション後**になる（サーバの応答は 200 + シェル）。
//     `/projects/new` に到達したパートナーがホームへ戻される（`docs/04` §S-012 権限差分）
//     という挙動が **JS の到着待ちになり**、E2E（`tests/e2e/isolation.spec.ts` の
//     「ホスト専用の画面 / API に到達できない」）が実測で落ちた。
//     ⚠️ 認可そのものは破れていない（フォームは 1 度も描画されず、拒否の本体は `#26` の
//     `requireRole` と `projects` の RLS = C2 である。`F-004 AC-9`）。壊れていたのは
//     **「画面もホームへ戻す」という補助の挙動**である。
// 🔴 したがって**境界は「その画面だけを包む」位置に置く**。`(list)` は URL に現れない
//    ルートグループなので、`/projects` はそのままで、`new/` と `[id]/` は境界の外に出る。
//    この不変条件は `tests/static/route-boundaries.test.ts` が機械的に守る。
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
