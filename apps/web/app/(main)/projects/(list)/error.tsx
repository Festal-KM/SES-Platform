'use client';

// apps/web/app/(main)/projects/(list)/error.tsx
// 🔴 `(list)` ルートグループに置く理由は、同ディレクトリの `loading.tsx` 冒頭
//    （T-06-04 Iteration 3）。ここを `projects/` 直下に戻すと、`/projects/new` の失敗に
//    「検索を実行できませんでした」が出るうえ、子ルートの `redirect()` が 307 でなくなる。
// `S-010` の取得失敗（docs/04 §10.1 `S-010` Err「検索失敗 + 条件保持の再試行」）。T-06-03。
//
// 🔴 **条件を保持したまま再試行する。** `reset()` は同じ URL（＝ 同じ検索条件と `?cursor=`）で
//    セグメントを再描画する。ここでホームへ戻したり URL を捨てたりしない —— 利用者が
//    組み立てた条件が失われる（`S-005` の error と同じ規律）。
// 🔴 **失敗の理由を画面に出さない**（docs/05 §15.2）。`error.message` には内部の情報が入りうる。
// 🔴 T-22-06: 色は §7.9 の semantic トークン（失敗は `--color-danger`）。幅は
//    `PageBody widthClass="full"`（`S-010` はクラス A）であり、画面に `max-w-*` を書かない。
import { Button, PageBody } from '@ses/ui';
import { t } from '@ses/i18n';

export default function ProjectListError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="py-6">
      <PageBody widthClass="full">
        <h1 className="mb-6 text-title font-semibold text-fg">{t('projects.list.title')}</h1>
        <p role="alert" className="mb-1 text-body font-semibold text-danger" data-testid="project-list-error">
          {t('projects.list.error.title')}
        </p>
        <p className="mb-4 text-body text-fg">{t('projects.list.error.lead')}</p>
        <Button type="button" onClick={() => reset()} data-testid="project-list-retry">
          {t('projects.list.error.retry')}
        </Button>
      </PageBody>
    </main>
  );
}
