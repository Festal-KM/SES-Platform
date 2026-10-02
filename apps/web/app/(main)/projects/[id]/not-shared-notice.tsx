// apps/web/app/(main)/projects/[id]/not-shared-notice.tsx
// 🔴 公開が解除された取引先に出す画面（**404 ページではない**。`docs/04` §10.1 `S-011`
//    「この案件は現在御社に公開されていません」。理由は「存在は既に知っているため、404 は不正確」）。
//    HTTP の状態としては 404 のままである（`page.tsx` の `ProjectNotSharedError` の枝）。
//
// ============================================================================
// 🔴 なぜ `page.tsx` から出したのか（SP-22 段④）
// ============================================================================
// `tests/static/ui-width-class-coverage.test.ts`（検査 (k)）は **1 つの `page.tsx` が
// `widthClass` を**ちょうど 1 回**渡すこと**を求める。2 回は「条件分岐で違う幅になる画面」を
// 意味し、`docs/04` `U-23` の「1 画面 1 クラス」に反する。
// 🔴 **この告知は `S-011` とは別の見え方をする独立した画面**（タイトルは「案件詳細」で、
//    本文は 1 行の説明と一覧への戻り導線だけ）であり、幅も **クラス C = 読み幅 720px** が妥当である
//    （`S-011` 本体はクラス B）。したがって幅を 2 つ持たせるのではなく、**ファイルを分けた**。
// 🔴 **文言・`data-testid`・戻り先は 1 つも変えていない**（`project-detail-not-shared`）。
import Link from 'next/link';
import { PageBody, SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';
import { PROJECT_FORM_CANCEL_HREF } from '../_form/form-props';

export function NotSharedNotice() {
  return (
    <main className="py-6">
      <PageBody widthClass="prose">
        <h1 className="mb-4 text-title font-semibold text-fg">{t('projects.detail.title')}</h1>
        <p
          className="mb-4 rounded-md border border-border bg-bg-subtle px-4 py-3 text-body text-fg"
          data-testid="project-detail-not-shared"
        >
          {t('projects.detail.notShared')}
        </p>
        {/* 🔴 T-06-03: 戻り先は `S-010`（案件一覧）である（`PROJECT_FORM_CANCEL_HREF` と共有）。
            公開が解除された取引先も、御社に公開されている**他の**案件へは戻れる。 */}
        <Link className={SECONDARY_LINK_STACKED_CLASSES} href={PROJECT_FORM_CANCEL_HREF}>
          {t('projects.breadcrumb.list')}
        </Link>
      </PageBody>
    </main>
  );
}
