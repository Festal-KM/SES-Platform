// apps/web/app/admin/tenants/page.tsx
// `A-002` テナント一覧（docs/04 §A-002 / API-A2 / `F-056`）。T-03-09。
//
// 🔴 書き込み操作なし。画面タイトル右に「閲覧のみ」を常時表示する（docs/04 §A-002 / `BR-37`）。
// 🔴 異常度順の並び替えは Phase 1（SP-11。`docs/dev-plan.md` `PM-A-04`）。ここでは
//    決定的な `createdAt` 降順のみ。
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。エンジニア名・案件名・
//    提案本文・チャット本文への導線を持たない。
// 🔴 閲覧そのものが `AuditLog` に記録される（`listPlatformTenants` が `withPlatformRead` 経由。
//    `F-056 AC-4`）。
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listPlatformTenants } from '@ses/db/platform';
import { t } from '@ses/i18n';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../lib/auth/platform-session';
import { isTenantIdLike } from '../../../lib/admin-tenants/schemas';
import {
  TENANT_LIFECYCLE_STATE_MESSAGE_KEYS,
  tenantEnvironmentMessageKey,
} from './_lib/labels';
// 🔴 `_lib/labels` は上 2 つを `apps/web/lib/tenants/labels` から re-export している
//    （主平面の `S-035` と共有するため。管理平面のファイルを主平面から import させない）。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 50;

export default async function AdminTenantsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly cursor?: string }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const { cursor } = await searchParams;
  // 🔴 カーソルはテナント ID（uuid(7)）そのもの。改竄・破損した値をそのまま Prisma の
  //    カーソルへ渡すと `uuid` 型キャストの Postgres エラーで 500 になるため、不正な形状は
  //    DB に触れず「カーソル無し（先頭ページ）」として扱う（画面を壊さない。500 にしない）。
  const safeCursor = cursor !== undefined && isTenantIdLike(cursor) ? cursor : undefined;
  const meta = await readPlatformRequestMeta();
  const page = await listPlatformTenants(
    outcome.ctx,
    { cursor: safeCursor, limit: PAGE_LIMIT },
    { ipAddress: meta.ipAddress },
  );

  // 🔴 T-03-10: 開設（`A-014`）の導線は **`PLATFORM_OWNER` にのみ表示する**
  //    （docs/04 §A-002 空状態 / §A-014 権限差分。`F-001` の `PP` = `−`）。
  //    グレーアウトで見せない —— `PLATFORM_SUPPORT` には導線そのものが存在しない。
  const canProvision = outcome.ctx.platformRole === 'PLATFORM_OWNER';
  const provisionLink = canProvision ? (
    <Link
      className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
      href="/admin/tenants/new"
    >
      {t('admin.provisioning.link')}
    </Link>
  ) : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('admin.tenants.title')}</h1>
        <div className="flex items-center gap-3">
          {provisionLink}
          {/* 🔴 BR-37: 運営者コンソールは既定 read-only。書き込み操作なしを常時明示する。
              🔴 バッジの射程は「テナントの**業務データ**に対して閲覧のみ」である
              （docs/04 §4 の 4「read-only の明示」）。開設（`A-014`）は契約領域の操作であり、
              このバッジと共存する。 */}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {t('admin.readOnly.badge')}
          </span>
        </div>
      </div>

      {page.items.length === 0 ? (
        <p className="text-sm text-slate-600">{t('admin.tenants.empty')}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">{t('admin.tenants.column.name')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.tenants.column.lifecycleState')}
                  </th>
                  <th className="px-3 py-2 font-medium">{t('admin.tenants.column.environment')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.tenants.column.seats')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.tenants.column.partners')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.tenants.column.engineers')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.tenants.column.projects')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.tenants.column.lastActivity')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => {
                  const environmentKey = tenantEnvironmentMessageKey(item.environment);
                  return (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <Link
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                          href={`/admin/tenants/${item.id}`}
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[item.lifecycleState])}
                      </td>
                      <td className="px-3 py-2">
                        {environmentKey === null ? item.environment : t(environmentKey)}
                      </td>
                      <td className="px-3 py-2">{item.seatCount}</td>
                      <td className="px-3 py-2">{item.partnerCompanyCount}</td>
                      <td className="px-3 py-2">{item.engineerCount}</td>
                      <td className="px-3 py-2">{item.projectCount}</td>
                      <td className="px-3 py-2">
                        {item.lastActivityAt === null
                          ? t('admin.tenants.lastActivity.none')
                          : item.lastActivityAt}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {page.nextCursor === null ? null : (
            <Link
              className="mt-4 inline-block text-sm text-slate-600 underline-offset-2 hover:underline"
              href={`/admin/tenants?cursor=${encodeURIComponent(page.nextCursor)}`}
            >
              {t('admin.tenants.loadMore')}
            </Link>
          )}
        </>
      )}
    </main>
  );
}
