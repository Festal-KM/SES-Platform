// apps/web/app/(main)/projects/[id]/edit/page.tsx
// `S-012` 案件の編集。docs/04 §S-012 / `F-013` / docs/05 §6.4 #26。T-06-01。
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8「見えない ＝ 存在しない」）。母集団を絞るのは
//    `projects` の RLS（C4）であり、この画面に `where` を足さない。
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-013 AC-3`）。この画面は詳細と同じ内容
//    （要件・条件・**商流情報**）を出すため、記録できないなら**内容を返さない**
//    （記録は `readProjectForEdit` の業務トランザクションの内側にある）。
// 🔴 到達できるのは `OWNER` / `ADMIN` / `SALES` だけ（`new/page.tsx` と同じ判定を使う）。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { isProjectEditorRole } from '../../../../../lib/projects/policy';
import { readProjectForEdit } from '../../../../../lib/projects/service';
import { listSkills } from '../../../../../lib/skills/service';
import { ProjectForm } from '../../_form/project-form';
// 🔴 `new/page.tsx` と同じ出所（`'use client'` のモジュールから値 import しない）。
import { PROJECT_CREATED_HREF_PATTERN } from '../../../../../lib/projects/created-href';
import {
  PROJECT_FORM_CANCEL_HREF,
  projectFormMessages,
  projectPrefectureOptions,
  projectRemoteModeOptions,
  projectRequirementKinds,
  projectStatusOptions,
  toProjectFormValues,
} from '../../_form/form-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('projects.edit.title') };

const HOME_PATH = '/';

export default async function EditProjectPage({
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

  const view = await readProjectForEdit(outcome.ctx, id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  const skillDictionary = (await listSkills(outcome.ctx, {})).items;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('projects.breadcrumb.home')} / {t('projects.breadcrumb.list')} /{' '}
        {t('projects.breadcrumb.edit')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('projects.edit.title')}</h1>
      <ProjectForm
        mode="EDIT"
        projectId={view.id}
        initial={toProjectFormValues(view)}
        skillDictionary={skillDictionary}
        statusOptions={projectStatusOptions}
        remoteModeOptions={projectRemoteModeOptions}
        prefectureOptions={projectPrefectureOptions}
        requirementKinds={projectRequirementKinds}
        cancelHref={PROJECT_FORM_CANCEL_HREF}
        createdHrefPattern={PROJECT_CREATED_HREF_PATTERN}
        messages={projectFormMessages()}
      />
    </main>
  );
}
