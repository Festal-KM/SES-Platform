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
// 🔴 T-12-18 ③: セクション 1「異常の要約」（種別ごとの件数。クリックで `?signal=` の絞り込み）を**一覧の最上部**（集計日時の上）に置く
//    （docs/04 §A-002「閾値を割った件数を最上部の要約に出す」/ docs/05 §6.9 API-A2）。件数は API-A2 の `summary`（絞り込み前の母集団）
//    であり、0 件の種別も描く。絞り込み中は解除の導線を置き、絞り込み 0 件でも「テナントがまだありません」とは言わない。
import Link from 'next/link';
import type { PlatformTenantListItemView, PlatformTenantListPage } from '@ses/db/platform';
import {
  TENANT_HEALTH_SIGNALS,
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
  /** T-12-18 ③: セクション 1「異常の要約」。 */
  readonly summary: {
    readonly label: string;
    readonly unit: string;
    readonly clear: string;
    readonly filteredEmpty: string;
    /** 🔴 低-3: 絞り込み無し + 範囲外カーソル（0 件・先頭ページでない）。`filteredEmpty` とは別文言。 */
    readonly outOfRange: string;
  };
};

export type AdminTenantsListProps = {
  readonly page: PlatformTenantListPage;
  readonly sort: TenantListSortKey;
  /** T-12-18 ③: 絞り込み中の異常の種別（`?signal=`）。`null` = 絞り込み無し。 */
  readonly signal: TenantHealthSignal | null;
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
const SUMMARY_BAR_CLASSES = 'mb-4 flex flex-wrap items-center gap-2 text-sm';
const SUMMARY_CHIP_CLASSES = 'inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-slate-700 underline-offset-2 hover:underline';
const SUMMARY_CHIP_CURRENT_CLASSES = 'inline-flex items-center gap-1 rounded border border-slate-900 bg-slate-900 px-2 py-1 font-medium text-white';
const SUMMARY_CLEAR_CLASSES = 'text-slate-700 underline underline-offset-2';

/** `PURGED` / `CLOSING` はスコアの対象外（`@ses/domain` の層分け）。空欄ではなく「対象外」と出す。 */
function isScored(item: PlatformTenantListItemView): boolean {
  return item.lifecycleState !== 'PURGED' && item.lifecycleState !== 'CLOSING';
}

/**
 * 🔴 並び替え・絞り込み・カーソルの URL。並びの切替と絞り込みの切替はカーソルを捨てる（呼び出し側が `null` を渡す）。
 *    既定値（`health` / 絞り込み無し）はクエリに出さない。
 */
export function tenantListHref(
  sort: TenantListSortKey,
  cursor: string | null,
  signal: TenantHealthSignal | null = null,
): string {
  const params = new URLSearchParams();
  if (sort !== 'health') params.set('sort', sort);
  if (signal !== null) params.set('signal', signal);
  if (cursor !== null) params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? '/admin/tenants' : `/admin/tenants?${query}`;
}

/** セクション 1「異常の要約」（種別ごとの件数。クリックで絞り込み。選択中は解除の導線）。0 件の種別も描く。 */
function HealthSummary({
  page,
  sort,
  signal,
  messages,
}: {
  readonly page: PlatformTenantListPage;
  readonly sort: TenantListSortKey;
  readonly signal: TenantHealthSignal | null;
  readonly messages: AdminTenantsListMessages;
}) {
  return (
    <nav className={SUMMARY_BAR_CLASSES} aria-label={messages.summary.label} data-testid="admin-tenants-summary">
      <span className="text-slate-600">{messages.summary.label}:</span>
      {TENANT_HEALTH_SIGNALS.map((key) => {
        const count = page.summary[key];
        const label = `${messages.signal[key]} ${count}${messages.summary.unit}`;
        return key === signal ? (
          <span
            key={key}
            className={SUMMARY_CHIP_CURRENT_CLASSES}
            aria-current="true"
            data-testid={`admin-tenants-summary-${key}`}
            data-count={count}
          >
            {label}
          </span>
        ) : (
          <Link
            key={key}
            className={SUMMARY_CHIP_CLASSES}
            href={tenantListHref(sort, null, key)}
            data-testid={`admin-tenants-summary-${key}`}
            data-count={count}
          >
            {label}
          </Link>
        );
      })}
      {signal === null ? null : (
        <Link className={SUMMARY_CLEAR_CLASSES} href={tenantListHref(sort, null)} data-testid="admin-tenants-summary-clear">
          {messages.summary.clear}
        </Link>
      )}
    </nav>
  );
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
  signal,
  isFirstPage,
  thresholds,
  messages,
}: AdminTenantsListProps) {
  // 🔴 「テナントがまだありません」は絞り込み無しの先頭ページでだけ言える（絞り込み 0 件は別の文言 + 要約 + 解除の導線）。
  if (page.items.length === 0 && isFirstPage && signal === null) {
    return (
      <p className="text-sm text-slate-600" data-testid="admin-tenants-empty">
        {messages.empty}
      </p>
    );
  }

  const allClear =
    sort === 'health' && isFirstPage && signal === null && page.items.every((item) => item.health.signals.length === 0);

  return (
    <>
      <p className={LEAD_CLASSES} data-testid="admin-tenants-health-lead">{messages.lead}</p>
      <HealthSummary page={page} sort={sort} signal={signal} messages={messages} />
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
              href={tenantListHref(key, null, signal)}
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

      {page.items.length === 0 && signal !== null ? (
        <p className="text-sm text-slate-600" data-testid="admin-tenants-summary-filtered-empty">
          {messages.summary.filteredEmpty}
        </p>
      ) : page.items.length === 0 ? (
        // 🔴 低-3: 絞り込み無し（`signal === null`）でここに来るのは、先頭ページの 0 件（`isFirstPage` の早期
        //    return で処理済み）以外 —— すなわち範囲外カーソル（`isFirstPage === false`）だけである。
        //    表も文言も出ない画面を作らない（`CLAUDE.md` §13.3 の「破綻させない」）。
        <p className="text-sm text-slate-600" data-testid="admin-tenants-out-of-range">
          {messages.summary.outOfRange}
        </p>
      ) : null}

      {page.items.length === 0 ? null : (
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
      )}
      {page.nextCursor === null ? null : (
        <Link
          className={SECONDARY_LINK_STACKED_CLASSES}
          href={tenantListHref(sort, page.nextCursor, signal)}
          data-testid="admin-tenants-load-more"
        >
          {messages.loadMore}
        </Link>
      )}
    </>
  );
}
