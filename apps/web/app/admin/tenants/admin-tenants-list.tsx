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
// 🔴 T-12-18 ③: セクション 1「異常の要約」（種別ごとの件数。クリックで `?signal=` の絞り込み）を**一覧の最上部**（集計日時の上）に置く
//    （docs/04 §A-002「閾値を割った件数を最上部の要約に出す」/ docs/05 §6.9 API-A2）。件数は API-A2 の `summary`（絞り込み前の母集団）
//    であり、0 件の種別も描く。絞り込み中は解除の導線を置き、絞り込み 0 件でも「テナントがまだありません」とは言わない。
//
// ============================================================================
// 🔴 SP-22 `T-22-08`（段② の一覧 ③）で変えたもの / 変えていないもの
// ============================================================================
// | 変えたもの | 一次資料 | 変えていないもの |
// |---|---|---|
// | ローカルの `<Table>` 組み立て → `@ses/ui` の **`DataTable`**（列定義） | `docs/04` §5-13 / `docs/05` §2.3.5 | 🔴 **9 列の集合・並び・値**（下の表） |
// | 帯 → **`Toolbar`** / ページ送り → **`Pagination`** / 空状態 → **`EmptyState`** | §5-13 / §10.4 | 🔴 **3 通りの空文言の出し分け**（初回空 / 絞込 0 / 範囲外カーソル） |
// | 実色（`text-slate-*` / `bg-emerald-*`）→ semantic トークン | §7.9 / 検査 (a) | 🔴 **異常の要約 → 集計日時 → 並び替え → 表 の順序** |
// | `text-sm` → `--text-body`（**実寸は同じ 14px**） | §7.9 / 検査 (g) | 🔴 **並び替えの 3 値**（`health` / `name` / `createdAt`。増やさない） |
// | 画面側の `hover:` を撤去（8 状態はプリミティブが持つ） | §7.10 / 検査 (j) | 🔴 **`閲覧のみ` と主体表示**（`admin-tenants-header.tsx` / 外枠） |
// | 幅 → `PageBody widthClass="full"`（`page.tsx`。旧 `max-w-6xl` を撤去） | §7.1 / `U-23` / 検査 (c)(k) | 🔴 **testid**（削除・改名 0 件。器への併記で残す） |
//
// 🔴 **9 列の集合と優先度**（`docs/04` §10.3 の `A-002` の行を写す。**増減させていない**）:
//
//   | # | 列 | `priority` | 根拠 |
//   |---|---|---|---|
//   | 1 | テナント名 | `always` | §10.3「切り詰める列 = テナント名」→ `NameCell` に委譲（`U-16`） |
//   | 2 | ライフサイクル状態 | `always` | 契約の状態。異常の読みに必須 |
//   | 3 | 環境 | `always` | 改訂 21 で 9 列に数えられた列（`Tenant.environment`） |
//   | 4 | 席数 | `sm` | §10.3「優先度の低い列: エンジニア数・案件数 → プラン → 席数」の**最後** |
//   | 5 | パートナー数 | `always` | 🔴 `NO_PARTNERS` の根拠そのもの（隠すと異常の理由が読めない） |
//   | 6 | エンジニア数 | `lg` | §10.3 の**先に隠す**側 |
//   | 7 | 案件数 | `lg` + **`hideable`** | 🔴 §10.3 改訂 21「**優先度が最も低い `案件数` を `hideable` にする**」（9 列目） |
//   | 8 | 最終アクティビティ | `always` | 🔴 `INACTIVE` の根拠そのもの |
//   | 9 | 異常の種別 | `always` | 🔴 本画面で**最も強調される列**（§5-8）。並び替えの主キー |
//
// 🔴 **列表示切替（`ColumnToggle`）を `Toolbar` に置く**（§7.1「9 列目以降は列表示切替に格納する」）。
//    状態は **URL のクエリ（`?hide=projects`）**が持ち、サーバが `hiddenColumnIds` を組む
//    （`lib/admin-tenants/list-href.ts`）。**この画面は `'use client'` を宣言しない** ——
//    クライアント境界は `ColumnToggle` の 1 ファイルだけである。
// 🔴 **`selection` を渡さない**（運営者コンソールに一括操作は無い。検査 (m)③）。
// 🔴 **`sortKey` を列に渡さない** —— 並びは `health` / `name` / `createdAt` の 3 値であり、
//    **列と 1 対 1 に対応しない**（`health` はスコア、`createdAt` は列に無い）。並び替えは従来どおり
//    独立した帯（`?sort=`）である。**3 値を増やさない**（docs/04 §A-002 改訂 13）。
// 🔴 横スクロールは `Table` の器の内側に閉じる（`overflow-x-auto`）。T3 だがモバイルで遮断しない（`CLAUDE.md` §13.3）。
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
  Alert,
  AlertDescription,
  Badge,
  DataTable,
  EmptyState,
  FOCUS_RING_CLASSES,
  Pagination,
  SECONDARY_LINK_CLASSES,
  Toolbar,
  cn,
  type DataTableColumn,
  type PaginationLinkProps,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
// 🔴 列表示切替はクライアント境界の内側にある（`@ses/ui/client` の `DropdownMenu`）。
//    **この画面は `'use client'` を宣言しない** —— 境界は `ColumnToggle` の 1 ファイルに閉じており、
//    行の描画（50 行 × 9 列）はサーバに残る（`app/_components/column-toggle.tsx` 冒頭）。
import { ColumnToggle, type ColumnToggleItem } from '../../_components/column-toggle';
// 🔴 URL の組み立ては `lib/admin-tenants/list-href.ts`（純粋関数。ユニットテストで固定した）。
import {
  TENANT_HIDEABLE_COLUMN_IDS,
  tenantListHref,
  type TenantHideableColumnId,
} from '../../../lib/admin-tenants/list-href';
import { TENANT_HEALTH_SIGNAL_BADGE_VARIANTS } from './_lib/labels';

// 🔴 **既存の import 元（`*.render.test.tsx`）を動かさないため、ここから re-export する**
//    （`docs/04` `U-22` / `SP-22` §3.2: 参照している名前を移動のついでに改名しない）。
export { tenantListHref };

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
  /** 🔴 T-22-08: `Pagination` の「前へ」（先頭ページへ戻る。`docs/04` §7.1）。 */
  readonly firstPage: string;
  /** 🔴 T-22-08: 列表示切替を開く語（§7.1「9 列目以降は列表示切替に格納する」）。 */
  readonly columnToggleTrigger: string;
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
  /**
   * 🔴 **列表示切替の対象**（`T-22-08`。`docs/04` §7.1 / §10.3 改訂 21）。
   *
   * 🔴 **どの列が隠れているかは URL が持ち、サーバがこの配列を組む**
   *    （`lib/admin-tenants/list-href.ts` の `parseHiddenTenantColumns` / `tenantColumnToggleHref`）。
   *    画面はここから `hiddenColumnIds` を導くだけで、**自分で状態を持たない**。
   * 🔴 **既定は空配列 = 切替を描かない**（`*.render.test.tsx` の既定もこれであり、
   *    「書き込み操作が 1 つも無い」を見ている既存の判定〔`<button>` が 0 件〕を動かさない）。
   */
  readonly columnToggleItems?: readonly ColumnToggleItem[];
  readonly messages: AdminTenantsListMessages;
};

/** 補助テキストの段（§7.3: 12px / `--color-fg-muted`）。 */
const META_CLASSES = 'mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted';
const SORT_BAR_CLASSES = 'mb-3 flex flex-wrap items-center gap-2 text-body';

/**
 * 並び替え / 絞り込みのチップ。
 * 🔴 §7.10 の 8 状態はプリミティブが持つので、画面側に `hover:` を書かない（検査 (j)）——
 *    フォーカスリングは `@ses/ui` の 1 語（`FOCUS_RING_CLASSES`）を使う。
 */
const CHIP_CLASSES = cn(
  'inline-flex items-center gap-1 rounded-sm border border-border-strong px-2 py-1 text-fg',
  FOCUS_RING_CLASSES,
);

/** 🔴 選択中（§7.10 の `selected`）。**太字だけで示さない**（面 + 文字色 + 枠）。 */
const CHIP_CURRENT_CLASSES =
  'inline-flex items-center gap-1 rounded-sm border border-brand bg-brand-bg px-2 py-1 font-medium text-brand';

/** `PURGED` / `CLOSING` はスコアの対象外（`@ses/domain` の層分け）。空欄ではなく「対象外」と出す。 */
function isScored(item: PlatformTenantListItemView): boolean {
  return item.lifecycleState !== 'PURGED' && item.lifecycleState !== 'CLOSING';
}

/** セクション 1「異常の要約」（種別ごとの件数。クリックで絞り込み。選択中は解除の導線）。0 件の種別も描く。 */
function HealthSummary({
  page,
  sort,
  signal,
  hiddenColumns,
  messages,
}: {
  readonly page: PlatformTenantListPage;
  readonly sort: TenantListSortKey;
  readonly signal: TenantHealthSignal | null;
  readonly hiddenColumns: readonly TenantHideableColumnId[];
  readonly messages: AdminTenantsListMessages;
}) {
  return (
    <nav
      className="mb-4 flex flex-wrap items-center gap-2 text-body"
      aria-label={messages.summary.label}
      data-testid="admin-tenants-summary"
    >
      <span className="text-fg-muted">{messages.summary.label}:</span>
      {TENANT_HEALTH_SIGNALS.map((key) => {
        const count = page.summary[key];
        const label = `${messages.signal[key]} ${count}${messages.summary.unit}`;
        return key === signal ? (
          <span
            key={key}
            className={CHIP_CURRENT_CLASSES}
            aria-current="true"
            data-testid={`admin-tenants-summary-${key}`}
            data-count={count}
          >
            {label}
          </span>
        ) : (
          <Link
            key={key}
            className={CHIP_CLASSES}
            // 🔴 絞り込みの切替はカーソルを捨てる（列の表示状態は保つ）。
            href={tenantListHref(sort, null, key, hiddenColumns)}
            data-testid={`admin-tenants-summary-${key}`}
            data-count={count}
          >
            {label}
          </Link>
        );
      })}
      {signal === null ? null : (
        <Link
          className={SECONDARY_LINK_CLASSES}
          href={tenantListHref(sort, null, null, hiddenColumns)}
          data-testid="admin-tenants-summary-clear"
        >
          {messages.summary.clear}
        </Link>
      )}
    </nav>
  );
}

const MUTED_CLASSES = 'text-xs text-fg-muted';

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

/**
 * ページ送りのリンク。🔴 **凍結済み testid の維持**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④）:
 * `Pagination` は `admin-tenants-pagination-next` を出すが、凍結されている値は
 * **`admin-tenants-load-more`** である（`ProjectPagingLink` と同じ形・同じ理由）。
 */
function TenantPagingLink({ href, className, children, 'data-testid': testId }: PaginationLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId !== undefined && testId.endsWith('-next') ? 'admin-tenants-load-more' : testId}
    >
      {children}
    </Link>
  );
}

/**
 * 列定義（🔴 **§10.3 の `A-002` の行をそのまま写す**。ファイル冒頭の表）。
 * 🔴 **画面に `hidden lg:table-cell` を書かない**（検査 (m)④）。
 * 🔴 **列を増やすことは `BR-40` / `CLAUDE.md` §10.5 に触れる**（運営者に見せるものを増やす）。
 */
function tenantColumns(
  messages: AdminTenantsListMessages,
): readonly DataTableColumn<PlatformTenantListItemView>[] {
  return [
    {
      id: 'name',
      header: messages.columns.name,
      priority: 'always',
      // 🔴 名称列の下限 10rem はどのブレークポイントでも維持する（`U-16`）。
      minWidth: '10rem',
      grow: true,
      // 🔴 `lg` 以上 = 切り詰め + `title` + 同じ行に `A-003` への導線 / `lg` 未満 = 折り返し（`U-16`）。
      nameCell: {
        name: (row) => row.name,
        href: (row) => `/admin/tenants/${row.id}`,
      },
    },
    {
      id: 'lifecycleState',
      header: messages.columns.lifecycleState,
      priority: 'always',
      minWidth: '8rem',
      cell: (row) => messages.lifecycleState[row.lifecycleState],
    },
    {
      id: 'environment',
      header: messages.columns.environment,
      priority: 'always',
      minWidth: '8rem',
      cell: (row) => messages.environment[row.environment as TenantEnvironment] ?? row.environment,
    },
    {
      id: 'seats',
      // ⚠️ 移行前は `<th>` の中で「席数」の下に小さく「利用中 / 有効」を出していた。`DataTable` の
      //    `header` は**解決済みの 1 文字列**であり（`docs/05` §2.3.5）2 行を持てないため、
      //    同じ 2 語を括弧でつないで**同じ情報を 1 行で出す**（🔴 表示項目を減らしていない。
      //    文言はどちらも `packages/i18n` の値であり、ここで作っているのは括弧だけである）。
      header: `${messages.columns.seats}（${messages.columns.seatsDetail}）`,
      // §10.3「優先度の低い列: エンジニア数・案件数 → プラン → 席数」の**最後**に隠れる列。
      priority: 'sm',
      minWidth: '6rem',
      cell: (row) => (
        // ⚠️ 凍結済み testid（`admin-tenants-seats-{id}`）は `<td>` からセルの中身へ移した
        //    （器〔`DataTable`〕は列ごとの testid を通さない。値も形も変えていない）。
        <span data-testid={`admin-tenants-seats-${row.id}`}>
          {row.activeMemberCount} / {row.seatCount}
        </span>
      ),
    },
    {
      id: 'partners',
      header: messages.columns.partners,
      // 🔴 `NO_PARTNERS`（異常の種別）の根拠そのものなので隠さない。
      priority: 'always',
      minWidth: '7rem',
      cell: (row) => row.partnerCompanyCount,
    },
    {
      id: 'engineers',
      header: messages.columns.engineers,
      priority: 'lg',
      minWidth: '7rem',
      cell: (row) => row.engineerCount,
    },
    {
      id: 'projects',
      header: messages.columns.projects,
      priority: 'lg',
      minWidth: '6rem',
      // 🔴 9 列目。§7.1「既定 8 列 + 操作列。9 列目以降は列表示切替に格納する」/ §10.3 改訂 21。
      hideable: true,
      cell: (row) => row.projectCount,
    },
    {
      id: 'lastActivity',
      header: messages.columns.lastActivity,
      // 🔴 `INACTIVE`（異常の種別）の根拠そのものなので隠さない。
      priority: 'always',
      minWidth: '10rem',
      cell: (row) =>
        row.lastActivityAt === null ? messages.lastActivityNone : formatDateTimeJst(row.lastActivityAt),
    },
    {
      id: 'health',
      header: messages.columns.health,
      // 🔴 本画面で最も強調される列（§5-8）。並び替えの主キーであり、どの幅でも隠さない。
      priority: 'always',
      minWidth: '10rem',
      whitespace: 'normal',
      cell: (row) => <HealthCell item={row} messages={messages} />,
    },
  ];
}

export function AdminTenantsList({
  page,
  sort,
  signal,
  isFirstPage,
  thresholds,
  columnToggleItems = [],
  messages,
}: AdminTenantsListProps) {
  // 🔴 「テナントがまだありません」は絞り込み無しの先頭ページでだけ言える（絞り込み 0 件は別の文言 + 要約 + 解除の導線）。
  if (page.items.length === 0 && isFirstPage && signal === null) {
    return (
      // ⚠️ 器の `data-testid` は凍結済みの `admin-tenants-empty` である（`U-22`）。
      <div data-testid="admin-tenants-empty">
        <EmptyState testIdPrefix="admin-tenants-empty-state-" description={messages.empty} />
      </div>
    );
  }

  const allClear =
    sort === 'health' && isFirstPage && signal === null && page.items.every((item) => item.health.signals.length === 0);
  // 🔴 隠す列は props の `hidden` から導く（画面に 2 つ目の出所を作らない）。
  //    🔴 並びは許可リストの順に正規化する（`lib/ui/hidden-columns.ts` と同じ規律）。
  const hiddenIds = new Set(columnToggleItems.filter((item) => item.hidden).map((item) => item.id));
  const hiddenColumns: readonly TenantHideableColumnId[] = TENANT_HIDEABLE_COLUMN_IDS.filter((id) =>
    hiddenIds.has(id),
  );
  // 🔴 ページ送りは並び・絞り込み・列の表示状態を保つ（次ページで隠した列が復活しない）。
  const nextPageHref = page.nextCursor === null ? null : tenantListHref(sort, page.nextCursor, signal, hiddenColumns);
  const firstPageHref = isFirstPage ? null : tenantListHref(sort, null, signal, hiddenColumns);

  return (
    <>
      {/* 🔴 §5-13 の `Toolbar`（一覧の上の帯）。**列表示切替の置き場所はここである**（§7.1 / `S-010` と同じ形）。
          ⚠️ `population`（§3.2-2 の #2）に渡すのは**この一覧の射程を述べる 1 行**である ——
             `A-002` に総件数は存在しない（API-A2 は `total` を返さない。§10.3 の `A-002` も件数を求めていない）。
             母集団の件数の代わりに「判定に使うのは件数・状態・日時だけ」を常時置く（`BR-40` の明示）。
          ⚠️ 凍結済み testid の併記（`U-22` / `SP-22` §3.2 の代替 ④）: `Toolbar` は
             `admin-tenants-toolbar-population` を出すが、凍結されているのは `admin-tenants-health-lead` である。 */}
      <div data-testid="admin-tenants-health-lead">
        <Toolbar
          testIdPrefix="admin-tenants-"
          population={messages.lead}
          className="mb-4"
          filters={
            columnToggleItems.length === 0 ? undefined : (
              <ColumnToggle
                columns={columnToggleItems}
                triggerLabel={messages.columnToggleTrigger}
                testIdPrefix="admin-tenants-column-toggle-"
              />
            )
          }
        />
      </div>
      <HealthSummary page={page} sort={sort} signal={signal} hiddenColumns={hiddenColumns} messages={messages} />
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
        <span className="text-fg-muted">{messages.sort.label}:</span>
        {TENANT_LIST_SORT_KEYS.map((key) =>
          key === sort ? (
            <span
              key={key}
              className={CHIP_CURRENT_CLASSES}
              aria-current="true"
              data-testid={`admin-tenants-sort-${key}`}
            >
              {messages.sort.byKey[key]}
            </span>
          ) : (
            <Link
              key={key}
              className={CHIP_CLASSES}
              // 🔴 並びの切替はカーソルを捨て、絞り込みと列の表示状態は保つ。
              href={tenantListHref(key, null, signal, hiddenColumns)}
              data-testid={`admin-tenants-sort-${key}`}
            >
              {messages.sort.byKey[key]}
            </Link>
          ),
        )}
      </nav>

      {allClear ? (
        // 🔴 成立の明示（§7.4 の「成果 = success」）。画面を空にしないための帯であり、異常の不在を述べる。
        <Alert variant="success" role="status" className="mb-3" data-testid="admin-tenants-all-clear">
          <AlertDescription>{messages.allClear}</AlertDescription>
        </Alert>
      ) : null}

      {/* 🔴 空状態は §10.4 の `EmptyState`。**絞込 0 と範囲外カーソルで別文言**である
          （どちらも「テナントがまだありません」とは言わない）。**アクションを置かない** ——
          0 件が正常な状態であり、次の一手は直上の絞り込みの解除である。 */}
      {page.items.length === 0 && signal !== null ? (
        <div data-testid="admin-tenants-summary-filtered-empty">
          <EmptyState
            testIdPrefix="admin-tenants-filtered-empty-state-"
            description={messages.summary.filteredEmpty}
          />
        </div>
      ) : page.items.length === 0 ? (
        // 🔴 低-3: 絞り込み無し（`signal === null`）でここに来るのは、先頭ページの 0 件（`isFirstPage` の早期
        //    return で処理済み）以外 —— すなわち範囲外カーソル（`isFirstPage === false`）だけである。
        //    表も文言も出ない画面を作らない（`CLAUDE.md` §13.3 の「破綻させない」）。
        <div data-testid="admin-tenants-out-of-range">
          <EmptyState
            testIdPrefix="admin-tenants-out-of-range-state-"
            description={messages.summary.outOfRange}
          />
        </div>
      ) : null}

      {page.items.length === 0 ? null : (
        <DataTable
          testIdPrefix="admin-tenants-"
          columns={tenantColumns(messages)}
          rows={page.items}
          rowKey={(row) => row.id}
          linkComponent={Link}
          // 🔴 利用者が外した列（`hideable` を持つ列だけが対象。`priority` とは別の仕組み）。
          //    値の出所は URL であり、既定（`?hide=` 無し）では**9 列すべてが出る**。
          hiddenColumnIds={hiddenColumns}
          // 🔴 器の空行は使わない。0 件の 3 通り（初回空 / 絞込 0 / 範囲外カーソル）は**文言が違い**、
          //    docs/04 §A-002 はそのとき**表そのものを出さない**と定めているため、判定は上の画面側に在る。
          empty={null}
        />
      )}

      {/* 🔴 カーソルページング（`docs/05` §6.1）。**「全 N ページ中 M ページ目」「他に N 件」を出さない**
          （API-A2 は総件数を返さない）。単一ページでは器そのものを描かない（`S-010` と同じ形）。 */}
      {nextPageHref === null && firstPageHref === null ? null : (
        <div className="mt-4">
          <Pagination
            testIdPrefix="admin-tenants-"
            nextHref={nextPageHref}
            nextLabel={messages.loadMore}
            prevHref={firstPageHref}
            prevLabel={messages.firstPage}
            linkComponent={TenantPagingLink}
          />
        </div>
      )}
    </>
  );
}
