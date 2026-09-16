// apps/web/app/admin/tenants/admin-tenants-list.tsx
// `A-002` テナント一覧 — 一覧部分の**純粋な描画**（docs/04 §A-002 / API-A2 / `F-056 AC-2`。T3）。T-11-01。
//
// 🔴 状態を持たない（`'use client'` を宣言しない）。`page.tsx`（サーバ）が API-A2 と同じ `listPlatformTenants` を
//    呼び、結果と文言をここへ渡す。`*.render.test.tsx` はこの部品を状態ごとに描いて固定する
//    （docs/04 §A-002 の状態表: 異常 0 件 → 「異常が検知されているテナントはありません」+ 一覧は表示 / 0 件 → 空状態）。
// 🔴 既定の並びは異常度の高い順（`sort=health`）。並び替えはリンク（`?sort=`）で切り替える。切り替えるとカーソルは捨てる。
// 🔴 「異常の種別」列が最も強調される要素である（docs/04 §5-8）。シグナルは `Badge` で、色は `TENANT_HEALTH_SIGNAL_BADGE_VARIANTS`。
//    表示するのは列挙値の文言だけで、理由の自由文・内容（氏名・本文・単価）は載らない（`BR-40`）。
// 🔴 集計日時（`observedAt`）を明示する（docs/04 §A-002「リアルタイムに見えて実は日次、という状態を作らない」の逆 ——
//    本実装は**都度集計**であり、その時刻を出す）。閾値も併記して「なぜ異常か」を読めるようにする。
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1`）。行から遷移できるのは `A-003` だけ。書き込み操作は無い（`BR-37`）。
// 🔴 横スクロールは `Table` の器の内側に閉じる。T3 だがモバイルで列を `hidden` にしない（`CLAUDE.md` §13.3）。
import Link from 'next/link';
import type { PlatformTenantListItemView, PlatformTenantListPage } from '@ses/db/platform';
import {
  TENANT_LIST_SORT_KEYS,
  type TenantEnvironment,
  type TenantHealthSignal,
  type TenantHealthThresholds,
  type TenantLifecycleState,
  type TenantListSortKey,
} from '@ses/domain';
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
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { TENANT_HEALTH_SIGNAL_BADGE_VARIANTS } from './_lib/labels';

export type AdminTenantsListMessages = {
  readonly columns: {
    readonly name: string;
    readonly lifecycleState: string;
    readonly environment: string;
    readonly seats: string;
    readonly seatsDetail: string;
    readonly partners: string;
    readonly engineers: string;
    readonly projects: string;
    readonly lastActivity: string;
    readonly health: string;
  };
  readonly lifecycleState: Readonly<Record<TenantLifecycleState, string>>;
  readonly environment: Readonly<Record<TenantEnvironment, string>>;
  readonly signal: Readonly<Record<TenantHealthSignal, string>>;
  readonly sort: { readonly label: string; readonly byKey: Readonly<Record<TenantListSortKey, string>> };
  readonly healthNone: string;
  readonly healthNotScored: string;
  readonly allClear: string;
  readonly lead: string;
  readonly observedAt: string;
  readonly thresholds: {
    readonly label: string;
    readonly inactive: string;
    readonly seats: string;
    readonly partners: string;
    readonly trial: string;
    readonly daysOrMore: string;
    readonly daysAfter: string;
    readonly percentBelow: string;
    readonly daysWithin: string;
  };
  readonly lastActivityNone: string;
  readonly loadMore: string;
  readonly empty: string;
};

export type AdminTenantsListProps = {
  readonly page: PlatformTenantListPage;
  readonly sort: TenantListSortKey;
  /** カーソル無しの先頭ページか。異常 0 件の表示は先頭ページ（= 最上位の並び）でだけ判断できる。 */
  readonly isFirstPage: boolean;
  readonly thresholds: TenantHealthThresholds;
  readonly messages: AdminTenantsListMessages;
};

const LEAD_CLASSES = 'mb-2 text-sm text-slate-700';
const META_CLASSES = 'mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600';
const SORT_BAR_CLASSES = 'mb-3 flex flex-wrap items-center gap-2 text-sm';
const SORT_LINK_CLASSES = 'rounded border border-slate-300 px-2 py-1 text-slate-700 underline-offset-2 hover:underline';
const SORT_CURRENT_CLASSES = 'rounded border border-slate-900 bg-slate-900 px-2 py-1 font-medium text-white';
const ALL_CLEAR_CLASSES = 'mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800';

/** `PURGED` / `CLOSING` はスコアの対象外（`@ses/domain` の層分け）。空欄ではなく「対象外」と出す。 */
function isScored(item: PlatformTenantListItemView): boolean {
  return item.lifecycleState !== 'PURGED' && item.lifecycleState !== 'CLOSING';
}

export function tenantListHref(sort: TenantListSortKey, cursor: string | null): string {
  const params = new URLSearchParams();
  if (sort !== 'health') params.set('sort', sort);
  if (cursor !== null) params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? '/admin/tenants' : `/admin/tenants?${query}`;
}

const MUTED_CLASSES = 'text-xs text-slate-500';

function HealthCell({
  item,
  messages,
}: {
  readonly item: PlatformTenantListItemView;
  readonly messages: AdminTenantsListMessages;
}) {
  if (!isScored(item)) {
    return (
      <span className={MUTED_CLASSES} data-testid="admin-tenants-health-not-scored">
        {messages.healthNotScored}
      </span>
    );
  }
  if (item.health.signals.length === 0) {
    return (
      <span className={MUTED_CLASSES} data-testid="admin-tenants-health-none">
        {messages.healthNone}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1" data-testid="admin-tenants-health-signals">
      {item.health.signals.map((signal) => (
        <Badge
          key={signal}
          variant={TENANT_HEALTH_SIGNAL_BADGE_VARIANTS[signal]}
          data-testid={`admin-tenants-health-signal-${signal}`}
        >
          {messages.signal[signal]}
        </Badge>
      ))}
    </span>
  );
}

export function AdminTenantsList({
  page,
  sort,
  isFirstPage,
  thresholds,
  messages,
}: AdminTenantsListProps) {
  if (page.items.length === 0 && isFirstPage) {
    return (
      <p className="text-sm text-slate-600" data-testid="admin-tenants-empty">
        {messages.empty}
      </p>
    );
  }

  const allClear =
    sort === 'health' && isFirstPage && page.items.every((item) => item.health.signals.length === 0);

  return (
    <>
      <p className={LEAD_CLASSES} data-testid="admin-tenants-health-lead">{messages.lead}</p>
      <div className={META_CLASSES}>
        <span data-testid="admin-tenants-observed-at">
          {messages.observedAt}: {formatDateTimeJst(page.observedAt)}
        </span>
        <span data-testid="admin-tenants-thresholds">
          {messages.thresholds.label}: {messages.thresholds.inactive} {thresholds.inactiveDays}
          {messages.thresholds.daysOrMore} / {messages.thresholds.seats} {thresholds.seatUtilizationMinPercent}
          {messages.thresholds.percentBelow} / {messages.thresholds.partners} {thresholds.noPartnersGraceDays}
          {messages.thresholds.daysAfter} / {messages.thresholds.trial} {thresholds.trialExpiringDays}
          {messages.thresholds.daysWithin}
        </span>
      </div>

      <nav className={SORT_BAR_CLASSES} aria-label={messages.sort.label} data-testid="admin-tenants-sort">
        <span className="text-slate-600">{messages.sort.label}:</span>
        {TENANT_LIST_SORT_KEYS.map((key) =>
          key === sort ? (
            <span
              key={key}
              className={SORT_CURRENT_CLASSES}
              aria-current="true"
              data-testid={`admin-tenants-sort-${key}`}
            >
              {messages.sort.byKey[key]}
            </span>
          ) : (
            <Link
              key={key}
              className={SORT_LINK_CLASSES}
              href={tenantListHref(key, null)}
              data-testid={`admin-tenants-sort-${key}`}
            >
              {messages.sort.byKey[key]}
            </Link>
          ),
        )}
      </nav>

      {allClear ? (
        <p className={ALL_CLEAR_CLASSES} role="status" data-testid="admin-tenants-all-clear">
          {messages.allClear}
        </p>
      ) : null}

      <Table data-testid="admin-tenants-table">
        <TableHeader>
          <TableRow>
            <TableHead>{messages.columns.name}</TableHead>
            <TableHead>{messages.columns.lifecycleState}</TableHead>
            <TableHead>{messages.columns.environment}</TableHead>
            <TableHead>
              {messages.columns.seats}
              <span className="block text-xs font-normal text-slate-500">{messages.columns.seatsDetail}</span>
            </TableHead>
            <TableHead>{messages.columns.partners}</TableHead>
            <TableHead>{messages.columns.engineers}</TableHead>
            <TableHead>{messages.columns.projects}</TableHead>
            <TableHead>{messages.columns.lastActivity}</TableHead>
            <TableHead>{messages.columns.health}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.map((item) => (
            <TableRow key={item.id} data-testid={`admin-tenants-row-${item.id}`}>
              <TableCell>
                <Link
                  className="font-medium text-slate-900 underline-offset-2 hover:underline"
                  href={`/admin/tenants/${item.id}`}
                >
                  {item.name}
                </Link>
              </TableCell>
              <TableCell>{messages.lifecycleState[item.lifecycleState]}</TableCell>
              <TableCell>
                {messages.environment[item.environment as TenantEnvironment] ?? item.environment}
              </TableCell>
              <TableCell data-testid={`admin-tenants-seats-${item.id}`}>
                {item.activeMemberCount} / {item.seatCount}
              </TableCell>
              <TableCell>{item.partnerCompanyCount}</TableCell>
              <TableCell>{item.engineerCount}</TableCell>
              <TableCell>{item.projectCount}</TableCell>
              <TableCell>
                {item.lastActivityAt === null
                  ? messages.lastActivityNone
                  : formatDateTimeJst(item.lastActivityAt)}
              </TableCell>
              <TableCell>
                <HealthCell item={item} messages={messages} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {page.nextCursor === null ? null : (
        <Link
          className={SECONDARY_LINK_STACKED_CLASSES}
          href={tenantListHref(sort, page.nextCursor)}
          data-testid="admin-tenants-load-more"
        >
          {messages.loadMore}
        </Link>
      )}
    </>
  );
}
