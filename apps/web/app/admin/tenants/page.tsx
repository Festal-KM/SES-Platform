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
//
// 🔴 SP-22 T-22-08: 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。`A-002` は
//    **クラス A = 全幅**である（§7.1 の表の「管理平面 11 画面」）。**画面ファイルに `max-w-*` を
//    書かない**（検査 (c) / (k)）—— 旧 `max-w-6xl` は 1920px で 9 列を 1152px に絞っていた。
// 🔴 ヘッダ（タイトル / `A-014` の導線 / `閲覧のみ`）は `AdminTenantsHeader` に移した。
//    **`BR-44` のロール差分を render テストで固定するため**である（理由はあちらの冒頭）。
// 🔴 列表示切替（`?hide=`）の状態は URL だけが持ち、**API には渡さない**（表示の話であり、
//    取得する項目は変わらない）。
import { redirect } from 'next/navigation';
import { listPlatformTenants } from '@ses/db/platform';
import { PageBody } from '@ses/ui';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../lib/auth/platform-session';
import {
  parseHiddenTenantColumns,
  tenantColumnToggleHref,
} from '../../../lib/admin-tenants/list-href';
import { isTenantIdLike, parseTenantListSignal, parseTenantListSort } from '../../../lib/admin-tenants/schemas';
import { tenantHealthRuntime } from '../../../lib/db/bootstrap';
import { HIDDEN_COLUMNS_PARAM } from '../../../lib/ui/hidden-columns';
import {
  adminTenantsColumnToggleItems,
  adminTenantsHeaderMessages,
  adminTenantsMessages,
} from './_lib/messages';
import { AdminTenantsHeader } from './admin-tenants-header';
import { AdminTenantsList } from './admin-tenants-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 50;

export default async function AdminTenantsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly cursor?: string;
    readonly sort?: string;
    readonly signal?: string;
    /** 🔴 列表示切替（`?hide=projects`）。**表示の状態であり API には渡さない**（`T-22-08`）。 */
    readonly hide?: string | string[];
  }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const { cursor, sort: rawSort, signal: rawSignal, ...rest } = await searchParams;
  // 🔴 カーソルはテナント ID（uuid(7)）そのもの。不正な形状は DB に触れず「カーソル無し（先頭ページ）」
  //    として扱う（画面を壊さない。500 にしない）。`sort` の不正な値も既定（異常度順）に倒す。
  //    T-12-18 ③: `signal`（異常の要約チップの絞り込み）の不正な値は「絞り込み無し」に倒す。
  const safeCursor = cursor !== undefined && isTenantIdLike(cursor) ? cursor : undefined;
  const sort = parseTenantListSort(rawSort);
  const signal = parseTenantListSignal(rawSignal);
  const thresholds = tenantHealthRuntime();
  const meta = await readPlatformRequestMeta();
  const page = await listPlatformTenants(
    outcome.ctx,
    { cursor: safeCursor, limit: PAGE_LIMIT, sort, ...(signal === undefined ? {} : { signal }) },
    { ipAddress: meta.ipAddress, healthThresholds: thresholds },
  );

  // 🔴 列表示切替の状態は URL のクエリ（`?hide=`）だけが持つ（`T-22-08`。`docs/04` §7.1）。
  //    🔴 許可リスト外の値は捨てる（URL 直打ちで壊れない）。🔴 **API には渡さない**
  //       —— 上の `listPlatformTenants` の引数に `hide` は無い（取得する項目は変わらない）。
  const hiddenColumns = parseHiddenTenantColumns(rest[HIDDEN_COLUMNS_PARAM]);
  const columnToggleItems = adminTenantsColumnToggleItems({
    hidden: hiddenColumns,
    // 🔴 並び・絞り込み・**いま見ているページ**（`cursor`）を保つ（列を外して行を見失わない）。
    hrefOf: (columnId) =>
      tenantColumnToggleHref({
        sort,
        cursor: safeCursor ?? null,
        signal: signal ?? null,
        hidden: hiddenColumns,
        columnId,
      }),
  });

  return (
    <main className="py-6">
      <PageBody widthClass="full">
        {/* 🔴 `A-014` の導線のロール差分（`BR-44`）は `AdminTenantsHeader` の中で判定する
            （render テストで「`PLATFORM_SUPPORT` の DOM に導線が無い」ことを固定するため）。 */}
        <AdminTenantsHeader
          platformRole={outcome.ctx.platformRole}
          messages={adminTenantsHeaderMessages()}
        />

        <AdminTenantsList
          page={page}
          sort={sort}
          signal={signal ?? null}
          isFirstPage={safeCursor === undefined}
          thresholds={thresholds}
          columnToggleItems={columnToggleItems}
          messages={adminTenantsMessages()}
        />
      </PageBody>
    </main>
  );
}
