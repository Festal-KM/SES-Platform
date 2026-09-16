// apps/web/app/admin/tenants/page.tsx
// `A-002` テナント一覧（docs/04 §A-002 / API-A2 / `F-056`）。T-03-09。
//
// 🔴 書き込み操作なし。画面タイトル右に「閲覧のみ」を常時表示する（docs/04 §A-002 / `BR-37`）。
// 🔴 T-11-01: 既定の並びは**異常度の高い順**（`F-056 AC-2`）。`?sort=health|name|createdAt` で切り替える。
//    並び・スコアは API-A2 と同じ `listPlatformTenants`（閾値は `tenantHealthRuntime()`）で得るため、
//    画面と API で順序がずれない。描画は `AdminTenantsList`（純粋。`*.render.test.tsx` が固定）。
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。エンジニア名・案件名・
//    提案本文・チャット本文への導線を持たない。
// 🔴 閲覧そのものが `AuditLog` に記録される（`listPlatformTenants` が `withPlatformRead` 経由。
//    `F-056 AC-4`）。
//
// 🔴 T-21-05: 表とバッジを `@ses/ui`（`Table` / `Badge`）へ移した。**表示する列の集合も
//    値も 1 つも変えていない**（`BR-40` / `CLAUDE.md` §10.5。運営者に要るのは件数・状態・
//    エラーであって内容ではない）。T-11-01 で足したのは「利用中の席」と「異常の種別」の列だけである。
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listPlatformTenants } from '@ses/db/platform';
import { t } from '@ses/i18n';
import { Badge } from '@ses/ui';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../lib/auth/platform-session';
import { isTenantIdLike, parseTenantListSort } from '../../../lib/admin-tenants/schemas';
import { tenantHealthRuntime } from '../../../lib/db/bootstrap';
import { adminTenantsMessages } from './_lib/messages';
import { AdminTenantsList } from './admin-tenants-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 50;

export default async function AdminTenantsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly cursor?: string; readonly sort?: string }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const { cursor, sort: rawSort } = await searchParams;
  // 🔴 カーソルはテナント ID（uuid(7)）そのもの。不正な形状は DB に触れず「カーソル無し（先頭ページ）」
  //    として扱う（画面を壊さない。500 にしない）。`sort` の不正な値も既定（異常度順）に倒す。
  const safeCursor = cursor !== undefined && isTenantIdLike(cursor) ? cursor : undefined;
  const sort = parseTenantListSort(rawSort);
  const thresholds = tenantHealthRuntime();
  const meta = await readPlatformRequestMeta();
  const page = await listPlatformTenants(
    outcome.ctx,
    { cursor: safeCursor, limit: PAGE_LIMIT, sort },
    { ipAddress: meta.ipAddress, healthThresholds: thresholds },
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
    <main className="mx-auto max-w-6xl px-4 py-8">
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

      <AdminTenantsList
        page={page}
        sort={sort}
        isFirstPage={safeCursor === undefined}
        thresholds={thresholds}
        messages={adminTenantsMessages()}
      />
    </main>
  );
}
