// apps/web/app/(main)/proposal-requests/page.tsx
// `S-017` 提案依頼の一覧。docs/04 §S-017 / `F-018` / docs/05 §6.5 #32 / #35。T-08-06。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-017 の必要ロールは全ロール）。ホストも取引先も `VIEWER` も
//    到達してよい。見えるものが変わるのはロール判定ではなく `proposal_requests` の RLS（C5 PARTY。取引先は
//    依頼先 = 自社の行だけ）と、`listProposalRequests` の所属による型の分岐（`HostProposalRequestView` /
//    `PartnerProposalRequestView`）である。
// 🔴 **一覧はサーバコンポーネントから `listProposalRequests` を直接読む**（自己 fetch しない。`S-005` / `S-016`
//    と同じ）。`GET /api/proposal-requests`（#32）と**同じ関数**を通るので、画面と API で母集団・並び・型が
//    ずれない。
// 🔴 **`AuditLog` を書かない。** 依頼の一覧は `BR-27` の閲覧記録の対象（エンジニア詳細・スキルシート・案件詳細）
//    ではない。記録するのは発行（`proposal_request.create`）と取り下げ（`proposal_request.update`）であり、
//    それぞれ業務トランザクション内で書かれる。
// 🔴 取り下げの導線は `PROPOSAL_REQUEST_ISSUER_ROLES`（`#35` と同じ定数）× テナントが実行可のときだけ描く。
//    書き写さない —— 画面と API で食い違うと「押せるのに 403」/「押せないのに API は通る」になる。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { executionDenialMessageKey } from '../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import {
  hostProposalRequestRows,
  partnerProposalRequestRows,
  proposalRequestsHref,
  proposalRequestStateOptions,
  PROPOSAL_REQUESTS_PATH,
} from '../../../lib/proposal-requests/list-rows';
import { isProposalRequestIssuerRole } from '../../../lib/proposal-requests/policy';
import { proposalRequestListQuerySchema } from '../../../lib/proposal-requests/schemas';
import { listProposalRequests } from '../../../lib/proposal-requests/service';
import { ProposalRequestScreen } from './proposal-request-screen';
import { proposalRequestScreenMessages } from './request-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('proposalRequests.title') };

/** `S-010`（案件一覧）。ホストの初回空の導線（`S-016` は案件起点なので、案件から入る）。 */
const PROJECTS_HREF = '/projects';

export default async function ProposalRequestsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 API と**同じスキーマ**で検証する。壊れた条件は素の URL へ戻す（`S-005` と同じ判断）。
  const parsed = proposalRequestListQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(PROPOSAL_REQUESTS_PATH);
  const query = parsed.data;

  const view = await listProposalRequests(ctx, query);
  const rows =
    view.audience === 'HOST' ? hostProposalRequestRows(view.items) : partnerProposalRequestRows(view.items);
  const filtered = query.state !== undefined;
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は取り下げの操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('proposalRequests.breadcrumb.home')} / {t('proposalRequests.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('proposalRequests.title')}</h1>
      <ProposalRequestScreen
        rows={rows}
        stateOptions={proposalRequestStateOptions()}
        stateValue={query.state ?? ''}
        filtered={filtered}
        // 🔴 取り下げの可否はロール（`#35` と同じ定数）。所属の軸は `listProposalRequests` の型分岐が持つ。
        canAct={view.audience === 'HOST' && isProposalRequestIssuerRole(ctx.role)}
        denialMessage={denialKey === null ? null : t(denialKey)}
        nowMs={Date.now()}
        projectsHref={PROJECTS_HREF}
        nextPageHref={view.nextCursor === null ? null : proposalRequestsHref(query, view.nextCursor)}
        firstPageHref={query.cursor === undefined ? null : proposalRequestsHref(query, null)}
        messages={proposalRequestScreenMessages({ audience: view.audience, filtered })}
      />
    </main>
  );
}
