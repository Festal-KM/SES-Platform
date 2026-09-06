// apps/web/app/(main)/projects/[id]/page.tsx
// `S-011` 案件詳細。docs/04 §S-011 / `F-013` / `F-014` / docs/05 §6.4 #27。T-06-02。
//
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-013 AC-3`）。記録は `readProjectDetail` の
//    業務トランザクションの内側で書かれ、**書けなければ内容が返らない**。画面と
//    `GET /api/projects/{id}`（#27）が同じ関数を通るので、**経路によって記録が漏れない**
//    （`CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」/ `BR-28` と同じ形）。
// 🔴 **境界外の ID は 404**（docs/05 §4.8）。母集団を絞るのは `projects` の RLS（C4）であり、
//    この画面に `where` を足さない。
// 🔴 **公開が解除された案件を取引先が開いた場合だけは 404 ページにしない**
//    （docs/04 §10.1 `S-011`「この案件は現在御社に公開されていません」。理由は「存在は既に
//    知っているため、404 は不正確」）。HTTP の状態としては 404 のままである
//    （`ProjectNotSharedError`。`lib/api/errors.ts` の注記）。
// 🔴 `VIEWER` は**到達できる**（閲覧のみ。`F-004 AC-6` / `BR-31`）。編集への導線だけを出さない。
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { REQUIREMENT_KINDS } from '@ses/db';
import { t } from '@ses/i18n';
import { NotFoundError, ProjectNotSharedError } from '../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { isProjectEditorRole } from '../../../../lib/projects/policy';
import { readProjectDetail } from '../../../../lib/projects/service';
import { PROJECT_FORM_CANCEL_HREF } from '../_form/form-props';
import { projectDetailScreenMessages } from './detail-props';
import { ProjectDetailScreen } from './project-detail-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 タイトルに案件名を入れない（ブラウザの履歴・タブ・共有時のプレビューに残るため。
 *    `S-006` と同じ規律。案件名は取引先にも見える値だが、**どの案件を見たか**は
 *    端末側の履歴に残す必要が無い）。
 */
export const metadata: Metadata = { title: t('projects.detail.title') };

/** 🔴 公開が解除された取引先に出す画面（404 ページではない。docs/04 §10.1 `S-011`）。 */
function NotSharedNotice() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('projects.detail.title')}</h1>
      <p
        className="mb-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        data-testid="project-detail-not-shared"
      >
        {t('projects.detail.notShared')}
      </p>
      {/* 🔴 T-06-03: 戻り先は `S-010`（案件一覧）である（`PROJECT_FORM_CANCEL_HREF` と共有）。
          公開が解除された取引先も、御社に公開されている**他の**案件へは戻れる。 */}
      <Link className="ses-secondary-link" href={PROJECT_FORM_CANCEL_HREF}>
        {t('projects.breadcrumb.list')}
      </Link>
    </main>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const { id } = await params;
  const meta = await readRequestMeta();

  const view = await readProjectDetail(outcome.ctx, id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 判定の順序が重要: `ProjectNotSharedError` は `NotFoundError` の派生なので先に見る。
      if (error instanceof ProjectNotSharedError) return null;
      // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );
  if (view === null) return <NotSharedNotice />;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('projects.breadcrumb.home')} / {t('projects.breadcrumb.list')}
      </p>
      <ProjectDetailScreen
        view={view}
        requirementKinds={REQUIREMENT_KINDS}
        // 🔴 `S-012` に到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
        //    取引先は `isProjectEditorRole` が偽になるため、導線そのものが描かれない。
        canEdit={isProjectEditorRole(outcome.ctx.role)}
        messages={projectDetailScreenMessages(view.audience)}
      />
    </main>
  );
}
