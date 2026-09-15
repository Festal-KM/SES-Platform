// apps/web/app/(main)/projects/[id]/candidates/page.tsx
// `S-016` 候補検索とマッチング候補（案件起点）。docs/04 §S-016 / `F-009` / `F-017` / docs/05 §6.5 #30。T-08-05。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-016 の必要ロールは全ロール）。取引先も `VIEWER` も到達してよい。
//    見えるものが変わるのはロール判定ではなく、`projects` の RLS（C4）・`engineers` の RLS（C3）と、
//    `listProjectCandidates` の「ホストだけが共有スコープを開く」分岐（`F-017 AC-5`）である。
// 🔴 **一覧はサーバコンポーネントから `listProjectCandidates` を直接読む**（自己 fetch しない。`S-005` と同じ）。
//    `GET /api/projects/{id}/candidates`（#30）と**同じ関数**を通るので、画面と API で母集団・並び・件数が
//    ずれない。閲覧の `AuditLog`（`project.view` / `CANDIDATES`）もその中で書かれる。
// 🔴 **検索条件が 1 つも無い（クエリ文字列のキーが 0 個）ときは案件の要件を初期値にする**
//    （`docs/04` §S-016 セクション 2。`PROJECT_DEFAULTS`）。キーが 1 つでもあれば（フォーム送信・
//    ページング・条件の解除）そのまま使う。
// 🔴 **境界外の ID は 404**（docs/05 §4.8）。取引先で公開が解除された案件だけは `S-011` と同じ断り方をする。
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ordersByFit } from '@ses/db';
import { t } from '@ses/i18n';
import { SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { NotFoundError, ProjectNotSharedError } from '../../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { listProjectCandidates } from '../../../../../lib/candidates/list';
import {
  activeCandidateFilters,
  candidateListRows,
  hasCandidateFilters,
  projectCandidatesHref,
  projectCandidatesPath,
} from '../../../../../lib/candidates/list-rows';
import {
  candidateProjectParamsSchema,
  projectCandidateListQuerySchema,
} from '../../../../../lib/candidates/schemas';
import { candidateReference } from '../../../../../lib/db/bootstrap';
import {
  projectConditionRows,
  projectHeadlineRows,
  projectRequirementRows,
} from '../../../../../lib/projects/detail';
import { listSkills } from '../../../../../lib/skills/service';
import {
  engineerAvailabilityFilterOptions,
  engineerPrefectureFilterOptions,
  engineerRemoteFilterOptions,
  engineerSkillModeOptions,
} from '../../../engineers/list-props';
import { PROJECT_FORM_CANCEL_HREF } from '../../_form/form-props';
import { candidateScreenMessages } from './candidate-props';
import { CandidateScreen } from './candidate-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに案件名を入れない（`S-011` と同じ規律。履歴・タブに残さない）。 */
export const metadata: Metadata = { title: t('candidates.title') };

/** `S-007`（人材の登録）。台帳が空のときの導線（`docs/04` §S-016 空状態）。 */
const REGISTER_HREF = '/engineers/new';

/** 🔴 公開が解除された取引先に出す画面（404 ページではない。`S-011` と同じ）。 */
function NotSharedNotice() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('candidates.title')}</h1>
      <p
        className="mb-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        data-testid="candidate-project-not-shared"
      >
        {t('projects.detail.notShared')}
      </p>
      <Link className={SECONDARY_LINK_STACKED_CLASSES} href={PROJECT_FORM_CANCEL_HREF}>
        {t('projects.breadcrumb.list')}
      </Link>
    </main>
  );
}

export default async function ProjectCandidatesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  const parsedParams = candidateProjectParamsSchema.safeParse(await params);
  if (!parsedParams.success) notFound();
  const projectId = parsedParams.data.id;
  const path = projectCandidatesPath(projectId);

  const rawSearch = await searchParams;
  // 🔴 API と**同じスキーマ**で検証する。壊れた条件は案件の要件（素の URL）へ戻す（`S-005` と同じ判断）。
  const parsed = projectCandidateListQuerySchema.safeParse(rawSearch);
  if (!parsed.success) redirect(path);
  const seedFromProject = Object.keys(rawSearch).length === 0;

  const meta = await readRequestMeta();
  const deps = {
    candidateRef: candidateReference(),
    now: () => new Date(),
    meta: { ipAddress: meta.ipAddress },
  };
  const view = await listProjectCandidates(
    ctx,
    projectId,
    seedFromProject
      ? { kind: 'PROJECT_DEFAULTS', limit: parsed.data.limit }
      : { kind: 'CRITERIA', query: parsed.data },
    deps,
  ).catch((error: unknown) => {
    if (error instanceof ProjectNotSharedError) return null;
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (view === null) return <NotSharedNotice />;

  // 🔴 効いた条件（`PROJECT_DEFAULTS` なら案件の要件から組んだ値）でフォームとページングの URL を作る。
  const query = view.query;
  // 🔴 スキルの選択肢は `#23` と同じ関数（`listSkills`）から引く（`S-005` / `S-007` と同じ方針）。
  const skills = await listSkills(ctx, {});
  const skillOptions = skills.items.map((skill) => ({ value: skill.id, label: skill.name }));
  const skillNames = new Map(skills.items.map((skill) => [skill.id, skill.name]));
  const filtered = hasCandidateFilters(query);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('projects.breadcrumb.home')} / {t('projects.breadcrumb.list')} /{' '}
        {t('candidates.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('candidates.title')}</h1>
      <CandidateScreen
        projectId={view.project.id}
        projectName={view.project.name}
        headlineRows={projectHeadlineRows(view.project)}
        conditionRows={projectConditionRows(view.project)}
        mustRows={projectRequirementRows(view.project.requirements, 'MUST')}
        niceRows={projectRequirementRows(view.project.requirements, 'NICE')}
        rows={candidateListRows(view.items)}
        filters={{
          q: query.q ?? '',
          skills: query.skills ?? [],
          skillMode: query.skillMode,
          yearsMin: query.yearsMin === undefined ? '' : String(query.yearsMin),
          priceMin: query.priceMin === undefined ? '' : String(query.priceMin),
          priceMax: query.priceMax === undefined ? '' : String(query.priceMax),
          availableBy: query.availableBy ?? '',
          prefecture: query.prefecture ?? '',
          remote: query.remote ?? '',
          availability: query.availability ?? '',
          onlyInTime: query.onlyInTime,
          onlyCommutable: query.onlyCommutable,
        }}
        skillOptions={skillOptions}
        skillModeOptions={engineerSkillModeOptions}
        prefectureOptions={engineerPrefectureFilterOptions}
        remoteOptions={engineerRemoteFilterOptions}
        availabilityOptions={engineerAvailabilityFilterOptions}
        activeFilters={activeCandidateFilters(projectId, query, skillNames)}
        // 🔴 取引先には種別列そのものを出さない（docs/04 §S-016 権限差分）。出所は ctx である。
        showKindColumn={ctx.partnerCompanyId === null}
        resetHref={path}
        registerHref={REGISTER_HREF}
        nextPageHref={
          view.nextCursor === null ? null : projectCandidatesHref(projectId, query, view.nextCursor)
        }
        firstPageHref={query.cursor === undefined ? null : projectCandidatesHref(projectId, query, null)}
        messages={candidateScreenMessages({
          partnerCompanyId: ctx.partnerCompanyId,
          total: view.total,
          filtered,
          // 🔴 並びの説明を切り替える判定は `engineerSearchPlan` と同じ関数（`ordersByFit`）。
          ordersByFit: ordersByFit(query),
          checkboxOn: query.onlyInTime || query.onlyCommutable,
        })}
      />
    </main>
  );
}
