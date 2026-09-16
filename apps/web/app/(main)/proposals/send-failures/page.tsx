// apps/web/app/(main)/proposals/send-failures/page.tsx
// `S-022` 送信失敗一覧と再送。docs/04 §S-022 / `F-023` / docs/05 §6.5 #44 / §10.6 / §12.5。T-09-08。
// 🔴 **Tier 2（モバイル閲覧可）。** 1 件ずつの再送はモバイルでも可能（送信失敗の滞留は商機の損失に直結する）。
//
// 🔴 **到達できるのはホストの `OWNER` / `ADMIN` / `SALES` / `VIEWER` だけ**（`docs/04` §S-022 必要ロール。`canViewSendFailures`）。
//    取引先はこの画面に到達しない（送信はホストが行う。`F-022` の `PA` / `PS` = `−`）。ホームへ戻す。
// 🔴 **一覧はサーバコンポーネントから `listProposalSendFailures` を直接読む**（自己 fetch しない。`S-017` と同じ）。
//    `SUBMIT_FAILED` 専用であり、保留中の `APPROVED` / `GATE_FAILED` / `LOST` / `DECLINED` は含まれない（`F-024 AC-2`）。
// 🔴 **`AuditLog` を書かない。** 一覧の閲覧は `BR-27` の記録対象ではない。記録するのは再送（`proposal.resend` / `proposal.submit`）
//    であり、#44 の業務トランザクションの中で書かれる。
// 🔴 再送の導線は `PROPOSAL_RESEND_ROLES`（#44 と同じ定数）× テナントが実行可のときだけ描く。書き写さない ——
//    画面と API で食い違うと「押せるのに 403」/「押せないのに API は通る」になる。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { executionDenialMessageKey } from '../../../../lib/api/guards';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { proposalApproveHref } from '../../../../lib/proposals/hrefs';
import { canResendProposal, canViewSendFailures } from '../../../../lib/proposals/policy';
import { sendFailureRows, sendFailureSummary } from '../../../../lib/proposals/send-failure-rows';
import { listProposalSendFailures } from '../../../../lib/proposals/send-failures';
import { sendFailureScreenMessages } from './failure-props';
import { SendFailureScreen } from './send-failure-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('sendFailures.title') };

const HOME_PATH = '/';

/** 202 の後の遷移先（`S-021`）。`{id}` を置き換える（サーバ → クライアントへ関数は渡せない。`lib/proposals/hrefs.ts` の雛形と同じ理由）。 */
const APPROVE_HREF_PATTERN = proposalApproveHref('{id}');

export default async function SendFailuresPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;
  // 🔴 取引先は到達しない（`docs/04` §S-022 権限差分）。拒否の本体は #44 のガードと `proposals` の RLS。
  if (!canViewSendFailures(ctx)) redirect(HOME_PATH);

  const now = new Date();
  const list = await listProposalSendFailures(ctx);
  const rows = sendFailureRows(list.items, now);
  const summary = sendFailureSummary(list.items, now);
  // 🔴 `F-004 AC-7`: 停止中・解約手続き中は再送の操作を出さず、理由を表示する（閲覧は可能）。
  const denialKey = executionDenialMessageKey(ctx.lifecycleState);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('sendFailures.breadcrumb.home')} / {t('sendFailures.breadcrumb.current')}
      </p>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('sendFailures.title')}</h1>
      <SendFailureScreen
        rows={rows}
        summary={summary}
        canResend={canResendProposal(ctx)}
        denialMessage={denialKey === null ? null : t(denialKey)}
        approveHrefPattern={APPROVE_HREF_PATTERN}
        messages={sendFailureScreenMessages()}
      />
    </main>
  );
}
