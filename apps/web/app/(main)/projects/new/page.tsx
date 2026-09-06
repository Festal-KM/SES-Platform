// apps/web/app/(main)/projects/new/page.tsx
// `S-012` 案件の登録（新規）。docs/04 §S-012 / `F-013` / `F-010` / docs/05 §6.4 #26。T-06-01。
//
// 🔴 **到達できるのは `OWNER` / `ADMIN` / `SALES` だけ**（docs/04 §S-012 権限差分
//    「取引先・`VIEWER` は到達できない」）。判定は `isProjectEditorRole` の 1 か所で、
//    **API の `requireRole` と同じ定数**（`PROJECT_EDITOR_ROLES`）を見る。
//    画面で止めるのは補助であり、拒否の本体は `#26` の `requireRole` / `requireNotViewer` と
//    `projects` の RLS（C2 の `app_is_host()`）である（`F-004 AC-9`）。
// 🔴 スキル辞書はサーバコンポーネントから直接読む（自己 fetch しない。`S-007` と同じ方針）。
//    読み取りは `#23`（`GET /api/skills`）と**同じ関数**を通す —— 画面用に別の読み取りを
//    書くと、並び順と絞り込みが API と画面でずれる。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { isProjectEditorRole } from '../../../../lib/projects/policy';
import { listSkills } from '../../../../lib/skills/service';
import { ProjectForm } from '../_form/project-form';
// 🔴 登録直後の遷移先はサーバ / クライアントの共有モジュールから読む
//    （`'use client'` のモジュールから値 import しない。`lib/projects/created-href.ts` 冒頭）。
import { PROJECT_CREATED_HREF_PATTERN } from '../../../../lib/projects/created-href';
import {
  EMPTY_PROJECT_FORM_VALUES,
  PROJECT_FORM_CANCEL_HREF,
  projectFormMessages,
  projectPrefectureOptions,
  projectRemoteModeOptions,
  projectRequirementKinds,
  projectStatusOptions,
} from '../_form/form-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('projects.new.title') };

const HOME_PATH = '/';

export default async function NewProjectPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (!isProjectEditorRole(outcome.ctx.role)) redirect(HOME_PATH);

  const skillDictionary = (await listSkills(outcome.ctx, {})).items;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* ⚠️ 「案件」は T-06-03（`S-010`）までリンクにしない（存在しない画面へ送らない）。 */}
      <p className="mb-1 text-sm text-slate-500">
        {t('projects.breadcrumb.home')} / {t('projects.breadcrumb.list')} /{' '}
        {t('projects.breadcrumb.new')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('projects.new.title')}</h1>
      <ProjectForm
        mode="CREATE"
        projectId={null}
        initial={EMPTY_PROJECT_FORM_VALUES}
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
