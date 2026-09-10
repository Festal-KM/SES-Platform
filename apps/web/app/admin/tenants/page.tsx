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
//
// 🔴 T-21-05: 表とバッジを `@ses/ui`（`Table` / `Badge`）へ移した。**表示する列の集合も
//    値も 1 つも変えていない**（`BR-40` / `CLAUDE.md` §10.5。運営者に要るのは件数・状態・
//    エラーであって内容ではない）。
// 🔴 横スクロールは `Table` が内蔵する器（`relative w-full overflow-x-auto`）の**内側**に
//    閉じる。T3 だがモバイルで遮断しない（`CLAUDE.md` §13.3。列を `hidden` にしない ——
//    間引くと運営者が異常を検知できる列を失う）。
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listPlatformTenants } from '@ses/db/platform';
import { t } from '@ses/i18n';
import {
  Badge,
  SECONDARY_LINK_STACKED_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';
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
          <Badge>{t('admin.readOnly.badge')}</Badge>
        </div>
      </div>

      {page.items.length === 0 ? (
        <p className="text-sm text-slate-600">{t('admin.tenants.empty')}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.tenants.column.name')}</TableHead>
                <TableHead>{t('admin.tenants.column.lifecycleState')}</TableHead>
                <TableHead>{t('admin.tenants.column.environment')}</TableHead>
                <TableHead>{t('admin.tenants.column.seats')}</TableHead>
                <TableHead>{t('admin.tenants.column.partners')}</TableHead>
                <TableHead>{t('admin.tenants.column.engineers')}</TableHead>
                <TableHead>{t('admin.tenants.column.projects')}</TableHead>
                <TableHead>{t('admin.tenants.column.lastActivity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((item) => {
                const environmentKey = tenantEnvironmentMessageKey(item.environment);
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        href={`/admin/tenants/${item.id}`}
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[item.lifecycleState])}
                    </TableCell>
                    <TableCell>
                      {environmentKey === null ? item.environment : t(environmentKey)}
                    </TableCell>
                    <TableCell>{item.seatCount}</TableCell>
                    <TableCell>{item.partnerCompanyCount}</TableCell>
                    <TableCell>{item.engineerCount}</TableCell>
                    <TableCell>{item.projectCount}</TableCell>
                    <TableCell>
                      {item.lastActivityAt === null
                        ? t('admin.tenants.lastActivity.none')
                        : item.lastActivityAt}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {page.nextCursor === null ? null : (
            <Link
              className={SECONDARY_LINK_STACKED_CLASSES}
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
