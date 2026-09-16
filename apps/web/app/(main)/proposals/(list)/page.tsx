// apps/web/app/(main)/proposals/(list)/page.tsx
// `S-019` 提案一覧。docs/04 §S-019 / `F-024 AC-2` `AC-3` / docs/05 §6.5 #45。T-09-09。
// 🔴 **Tier 2（モバイル閲覧可）。**
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-019 の必要ロールは全ロール）。ホストも取引先も `VIEWER` も到達してよい。見えるものが
//    変わるのはロール判定ではなく `proposals` の RLS（C5 PARTY。取引先は自社が作成した行だけ）と、`listProposals` の所属による
//    型の分岐（`HostProposalListItem` / `PartnerProposalListItem`）である（`F-024 AC-3`）。
// 🔴 **一覧はサーバコンポーネントから `listProposals` を直接読む**（自己 fetch しない。`S-017` / `S-022` と同じ）。
//    `GET /api/proposals`（#45）と**同じ関数**を通るので、画面と API で母集団・並び・型・`byState` がずれない。
// 🔴 **`AuditLog` を書かない。** 提案の一覧は `BR-27` の閲覧記録の対象ではない。
// 🔴 ルートグループ `(list)` に置く理由: `proposals/` 直下に `loading.tsx` / `error.tsx` を置くと `[id]` / `new` / `send-failures` まで
//    包んでしまう（`tests/static/route-boundaries.test.ts`。`projects/(list)` と同じ判断）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { PROPOSALS_PATH, proposalsHref } from '../../../../lib/proposals/hrefs';
import { listProposals } from '../../../../lib/proposals/list';
import {
  hostProposalListRows,
  isProposalListFiltered,
  partnerProposalListRows,
  proposalListSummary,
  proposalRequestStateChips,
  proposalStateChips,
} from '../../../../lib/proposals/list-rows';
import { proposalListQuerySchema } from '../../../../lib/proposals/schemas';
import { proposalListScreenMessages } from './list-props';
import { ProposalListScreen } from './proposal-list-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('proposals.list.title') };

/** `S-010`（案件一覧）。初回空の導線（`S-016` は案件起点なので、案件から入る）。 */
const PROJECTS_HREF = '/projects';
/** `S-017`（提案依頼の一覧）。提案依頼のブロックの導線。 */
const PROPOSAL_REQUESTS_HREF = '/proposal-requests';

export default async function ProposalListPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と**同じスキーマ**で検証する。壊れた条件は素の URL へ戻す（`S-017` と同じ判断）。
  const parsed = proposalListQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(PROPOSALS_PATH);
  const query = parsed.data;

  const now = new Date();
  const view = await listProposals(ctx, query);
  const rows = view.audience === 'HOST' ? hostProposalListRows(view.items, now) : partnerProposalListRows(view.items, now);
  const filtered = isProposalListFiltered(query);
  const hiddenFilters = [
    ...(query.projectId === undefined ? [] : [{ name: 'projectId' as const, value: query.projectId }]),
    ...(query.engineerId === undefined ? [] : [{ name: 'engineerId' as const, value: query.engineerId }]),
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposals.list.breadcrumb.home')} / {t('proposals.list.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposals.list.title')}</h1>
      <ProposalListScreen
        audience={view.audience}
        rows={rows}
        summary={proposalListSummary(view.audience, view.total, view.byState)}
        stateChips={proposalStateChips(view.byState, query.state)}
        requestChips={proposalRequestStateChips(view.requestsByState)}
        requestsHref={PROPOSAL_REQUESTS_HREF}
        qValue={query.q ?? ''}
        hiddenFilters={hiddenFilters}
        filtered={filtered}
        listHref={PROPOSALS_PATH}
        projectsHref={PROJECTS_HREF}
        nextPageHref={view.nextCursor === null ? null : proposalsHref(query, view.nextCursor)}
        firstPageHref={query.cursor === undefined ? null : proposalsHref(query, null)}
        messages={proposalListScreenMessages({ filtered })}
      />
    </main>
  );
}
