// apps/web/app/admin/usage/page.tsx
// `A-004` 利用量・クォータ管理（docs/04 §A-004 / API-A6 / `F-057` / `F-063 AC-5` / `BR-44`）。T3 / Phase 1。T-11-02。
//
// 🔴 運営者向けは**件数と金額（USD）の両方**を同一画面に出す（`CLAUDE.md` §2 課金 / docs/03 §7.6.3-2）。テナント側の `S-038` には
//    金額が 1 つも無い（`F-027 AC-6`）。ここが金額で見られる唯一の場所である。
// 🔴 書き込みが許される画面（クォータ。docs/04 §4 の 4「read-only の明示」の対象外）なので「閲覧のみ」バッジは出さない。
//    ただし書けるのは `PLATFORM_OWNER` だけで、**`PLATFORM_SUPPORT` にはフォームも行の操作導線も描かれない**（`F-057 AC-2`）。
//    判定は `platformRole`（DB で確定した値。`resolvePlatformCtxOutcome`）から行い、クライアントへは真偽値だけ渡す。
// 🔴 このページ自身は DB を読まない（材料は API-A6 が 1 回の `withPlatformRead` で読み、その読み取りが `admin.usage.view` として記録される）。
// 🔴 文言は `packages/i18n` から引いてクライアントへ props で渡す（`CLAUDE.md` §3.5）。今日（JST）もサーバで決めて渡す。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { QUOTA_OVERRIDE_METRICS, usagePeriodKey } from '@ses/domain';
import { t } from '@ses/i18n';
import { parseAdminUsageFilter, parseTargetTenantId } from '../../../lib/admin-usage/schemas';
import { resolvePlatformCtxOutcome } from '../../../lib/auth/platform-session';
import { AdminUsageView } from './admin-usage-view';
import { adminUsageMessages } from './_lib/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('admin.usage.title') };

/** API-A6 の URL（docs/05 §6.9）。 */
const USAGE_ENDPOINT = '/api/admin/usage';
/** `PUT /api/admin/tenants/{id}/quota`（API-A6）の起点。クライアントが `/{id}/quota` を足す（関数は Client Component に渡せない）。 */
const TENANTS_ENDPOINT = '/api/admin/tenants';

export default async function AdminUsagePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly filter?: string; readonly targetTenantId?: string }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const params = await searchParams;
  // 🔴 不正な値は既定に倒す（画面は 400 を返せない）。
  const filter = parseAdminUsageFilter(params.filter);
  const targetTenantId = parseTargetTenantId(params.targetTenantId);
  // 🔴 `PLATFORM_OWNER` だけがクォータを変更できる（`BR-44`）。SUPPORT にはフォームが存在しない。
  const canEditQuota = outcome.ctx.platformRole === 'PLATFORM_OWNER';

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('admin.usage.title')}</h1>
      </div>
      <AdminUsageView
        messages={adminUsageMessages()}
        endpoint={USAGE_ENDPOINT}
        tenantsEndpoint={TENANTS_ENDPOINT}
        canEditQuota={canEditQuota}
        initialFilter={filter}
        {...(targetTenantId === undefined ? {} : { targetTenantId })}
        today={usagePeriodKey('DAY', new Date())}
        metrics={QUOTA_OVERRIDE_METRICS}
      />
    </main>
  );
}
