// apps/web/app/(main)/projects/page.tsx
// `S-010` 案件一覧・検索。docs/04 §S-010 / `F-015` / docs/05 §6.4 #25。T-06-03。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-010 の必要ロールは全ロール）。取引先も `VIEWER` も
//    この画面に到達してよい —— 見えるものが変わるのはロール判定ではなく `projects` の
//    RLS（C4 VISIBILITY）である。ロールで分けるのは「案件を登録」の導線だけ。
// 🔴 **一覧はサーバコンポーネントから `listProjects` を直接読む**（自己 fetch しない。
//    `S-005` / `S-011` と同じ方針）。`GET /api/projects`（#25）と**同じ関数**を通るので、
//    画面と API で母集団・並び順・件数がずれない。
// 🔴 **監査ログを書かない。** `BR-27` / `F-013 AC-3` の記録対象は「案件**詳細**の閲覧」であり、
//    docs/04 §S-010 も記録を行クリック（→ `S-011`）に置いている
//    （理由は `lib/projects/list.ts` 冒頭 / docs/05 §6.4「#25 の実装の決着」）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { listProjects } from '../../../lib/projects/list';
import {
  hasProjectListFilters,
  projectListHref,
  projectListRows,
  projectPopulationLabel,
  PROJECT_LIST_PATH,
} from '../../../lib/projects/list-rows';
import { isProjectEditorRole } from '../../../lib/projects/policy';
import { projectListQuerySchema } from '../../../lib/projects/schemas';
import {
  projectListScreenMessages,
  projectPrefectureFilterOptions,
  projectStatusFilterOptions,
} from './list-props';
import { ProjectListScreen } from './project-list-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('projects.list.title') };

export default async function ProjectListPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  // 🔴 API と**同じスキーマ**で検証する（不正なカーソル・未知の状態が Prisma に届かない）。
  //    画面では 400 を出す先が無いので、壊れた条件は素の一覧へ戻す（URL も揃える）——
  //    黙って無視すると、URL には残っているのに効いていない状態になる。
  const parsed = projectListQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(PROJECT_LIST_PATH);

  const query = parsed.data;
  const view = await listProjects(ctx, query);
  const isPartner = ctx.partnerCompanyId !== null;
  const filtered = hasProjectListFilters(query);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('projects.breadcrumb.home')} / {t('projects.breadcrumb.list')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('projects.list.title')}</h1>
      <ProjectListScreen
        rows={projectListRows(view.items)}
        filters={{
          q: query.q ?? '',
          status: query.status ?? '',
          startFrom: query.startFrom ?? '',
          prefecture: query.prefecture ?? '',
        }}
        statusOptions={projectStatusFilterOptions}
        prefectureOptions={projectPrefectureFilterOptions}
        // 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。出所は ctx である。
        showVisibilityColumn={!isPartner}
        // 🔴 `S-012` に到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
        //    押しても戻されるだけの導線を描かない。拒否の本体は `#26` のガードと
        //    `S-012` のリダイレクトである。
        canRegister={isProjectEditorRole(ctx.role)}
        showClearFilters={filtered}
        // 🔴 ページングのリンクは**検索条件を保つ**（`projectListHref`）。
        nextPageHref={view.nextCursor === null ? null : projectListHref(query, view.nextCursor)}
        firstPageHref={query.cursor === undefined ? null : projectListHref(query, null)}
        messages={projectListScreenMessages({
          populationLabel: projectPopulationLabel(ctx.partnerCompanyId, view.total),
          isPartner,
          filtered,
        })}
      />
    </main>
  );
}
