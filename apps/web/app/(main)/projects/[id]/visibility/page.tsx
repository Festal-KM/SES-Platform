// apps/web/app/(main)/projects/[id]/visibility/page.tsx
// `S-013` 案件の公開範囲設定。docs/04 §S-013 / `F-014` / `F-020` / docs/05 §6.4 #28。T-06-06。
//
// 🔴 **ホスト専用**（`docs/04` §S-013 権限差分「取引先・`VIEWER` は到達できない」）。
//    到達できるのは `PROJECT_EDITOR_ROLES`（`OWNER` / `ADMIN` / `SALES`）だけであり、
//    それ以外はホームへ戻す。⚠️ **画面で止めるのは補助**である —— 拒否の本体は `#28` の
//    `requireRole` / `requireExecutable` / `requireNotViewer` と、`updateProjectVisibility` の
//    `requireHost`、そして `project_visibilities` の RLS（C2。書込は `app_is_host()`）である
//    （`F-004 AC-9`「API を直接呼んでも拒否される」）。
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8）。母集団を絞るのは `projects` の RLS（C4）であり、
//    この画面に `where` を足さない。
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-013 AC-3`）。この画面は案件の要件・条件・
//    外部公開用の記載に加えて**商流情報**（混入の照合に使う）まで読むため、`S-012` の編集フォームと
//    同じ扱いにする（`summary.via = 'VISIBILITY'`）。記録は `readProjectDetail` の業務
//    トランザクションの内側にあり、**書けなければ内容は返らない**。
import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { executionDenialMessageKey } from '../../../../../lib/api/guards';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { isProjectEditorRole } from '../../../../../lib/projects/policy';
import { PROJECT_VIEW_VIA, readProjectDetail } from '../../../../../lib/projects/service';
import { listProjectVisibilityChoices } from '../../../../../lib/projects/visibility';
import { projectPublishPreview, projectVisibilityScreenMessages } from './visibility-props';
import { ProjectVisibilityScreen } from './visibility-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名を入れない（`S-011` と同じ規律。履歴・タブに残さない）。 */
export const metadata: Metadata = { title: t('projects.visibilitySettings.title') };

const HOME_PATH = '/';
/** `S-014`（取引先企業の一覧・招待）。取引先が 1 社も無いときの導線。 */
const PARTNER_COMPANIES_HREF = '/settings/partner-companies';

export default async function ProjectVisibilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (!isProjectEditorRole(outcome.ctx.role)) redirect(HOME_PATH);

  const { id } = await params;
  const meta = await readRequestMeta();

  const view = await readProjectDetail(
    outcome.ctx,
    id,
    { ipAddress: meta.ipAddress },
    PROJECT_VIEW_VIA.visibility,
  ).catch((error: unknown) => {
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  // 🔴 取引先の view はここに来ない（`PROJECT_EDITOR_ROLES` にパートナーロールが無い）。
  //    それでも枝を残すのは、**商流情報を持たない view でプレビューを作らせない**ためである
  //    （`projectPublishPreview` の引数は `HostProjectDetailView`）。
  if (view.audience !== 'HOST') notFound();

  const choices = await listProjectVisibilityChoices(outcome.ctx, view.id);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は公開操作の導線を出さず、理由を表示する。
  const denialKey = executionDenialMessageKey(outcome.ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('projects.breadcrumb.home')} / {t('projects.breadcrumb.list')} /{' '}
        {t('projects.visibilitySettings.breadcrumb')}
      </p>
      <ProjectVisibilityScreen
        projectId={view.id}
        projectName={view.name}
        choices={choices}
        preview={projectPublishPreview(view)}
        detailHref={`/projects/${view.id}`}
        editHref={`/projects/${view.id}/edit`}
        partnerCompaniesHref={PARTNER_COMPANIES_HREF}
        denialMessage={denialKey === null ? null : t(denialKey)}
        messages={projectVisibilityScreenMessages()}
      />
    </main>
  );
}
