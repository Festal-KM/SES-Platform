// apps/web/app/(main)/projects/project-list-screen.tsx
// `S-010` 案件一覧・検索 — 本体（docs/04 §S-010 / `F-015` / docs/05 §6.4 #25）。
// T-06-03 → **SP-22 `T-22-06`（一覧の適用 ①）**。
//
// ============================================================================
// 🔴 `T-22-06` で何が変わったか（**見せ方だけ**。`SP-22` §3.1）
// ============================================================================
// ローカルの `<Table>` → `@ses/ui` の **`DataTable`** / 帯 → **`Toolbar`** / ページ送り →
// **`Pagination`** / 空状態 → **`EmptyState`** / 幅 → **`PageBody widthClass="full"`**（クラス A）。
// 色と文字サイズは §7.9 の semantic トークンと 6 トークンへ寄せた。
// 🔴 **機能・API・並び順・権限差分・表示項目は 1 つも変えていない。**
//
// 🔴 **列を 1 つも増減させていない**（受け入れ基準 2）。`hidden lg:table-cell` の直書きを
//    列定義の `priority` に移しただけである（§10.3 の `S-010` の行 / §S-010「デバイス別」）:
//
//   | # | 列 | `priority` | 根拠 |
//   |---|---|---|---|
//   | 1 | 案件名 | `always` | モバイル 4 列に残る（`NameCell` に委譲。`U-16`） |
//   | 2 | 状態 | `always` | 同上（`募集中` / `充足` / `後任募集`） |
//   | 3 | 必須要件の要約 | `lg` | §10.3「切り詰める列」かつ補助列。余りを配分する列（`grow`） |
//   | 4 | 単価レンジ | `always` | モバイル 4 列に残る |
//   | 5 | 開始日 | `always` | 同上 |
//   | 6 | 勤務地・リモート | `sm` | §10.3「優先度の低い列: 募集人数 → 勤務地 → 更新日」 |
//   | 7 | 募集人数 | `lg` | 同上（最初に隠れる） |
//   | 8 | 更新日 | `sm` | 同上 |
//   | 9 | 公開先の設定状況 | `lg` + **`hideable`** | 🔴 **ホストのみ**（`F-014 AC-4` / `BR-07`）。§7.1「既定 8 列 + 操作列。**9 列目以降は列表示切替に格納する**」に従い `hideable` を付ける（既定では表示されたままで、**見え方は移行前と同じ**） |
//
// ============================================================================
// ✅ `T-22-06` の仕上げ: **列表示切替（`ColumnToggle`）を `Toolbar` に置いた**
// ============================================================================
// 🔴 `hideable` を付けただけでは**利用者が列を隠す手段が無く**、§7.1 の「9 列目以降は列表示切替に
//    格納する」が満たされていなかった（`hideable` は「切替に入る列」の宣言であって切替そのもの
//    ではない）。置き場所は §5-13 の `Toolbar`（検索の帯と同じ段）である。
// 🔴 **状態は URL のクエリ（`?hide=visibility`）が持ち、サーバが `hiddenColumnIds` を組む**
//    （`lib/ui/hidden-columns.ts` / `lib/projects/list-rows.ts`）。この画面は
//    **`'use client'` を宣言しない** —— クライアント境界は `ColumnToggle` の 1 ファイルだけである。
// 🔴 **列の集合・並び・既定の見え方は 1 つも変えていない**（既定では 9 列すべてが出る。受け入れ基準 2）。
// 🔴 **API には渡さない**（列の表示・非表示は表示の話であり、取得する項目は変わらない）。
//
// 🔴 **公開状況列は 3 値**（`未設定` / `N 社に公開中` / `公開を解除（検査）`）を維持する。値は
//    `lib/projects/list-rows.ts` が組み、**理由・原因の欄は一覧に出さない**（読むのは `S-011`）。
// 🔴 **`selection` を渡さない**（Phase 1 に一括操作は無い。検査 (m)③）。
// 🔴 **`sortKey` を渡さない** —— 並びは `後任募集 → 募集中 → 充足` → 更新日の降順でサーバが確定
//    させており（`docs/05` §6.4「#25 の実装の決着」）、**既存 API の決定的順序を変えない**。
// 🔴 **スコア・順位・重みに相当する表示項目を持たない**（Phase 1。`F-009 AC-2` と同じ規律）。
// 🔴 **「全 N ページ中 M ページ目」「他に N 件」を描かない**（docs/05 §4.8）。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// 🔴 検索は**同期**（`docs/04` §S-010 非同期処理の表現）。素の `<form method="get">` で送るので、
//    クライアント JavaScript を 1 バイトも要求しない（`'use client'` を宣言しない）。
// ⚠️ 自画面へのパス（`/projects` / `/projects/new` / `/projects/{id}`）はリテラルで書く
//    （`EngineerLedgerScreen` と同じ）。`lib/projects/list-rows.ts` の `PROJECT_LIST_PATH` を
//    import すると `@ses/i18n` / `@ses/config` が `*.render.test.tsx` の依存に入り、
//    「文言が無い状態の描画」を試せなくなる（`detail-props.ts` 冒頭と同じ理由）。
//    **検索条件つきのリンク（ページング）は props で受け取る** —— 組み立てはテストできる
//    場所（`projectListHref`）に置く。
import Link from 'next/link';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Pagination,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  Select,
  Toolbar,
  cn,
  type DataTableColumn,
  type PaginationLinkProps,
} from '@ses/ui';
import {
  FILTER_ACTIONS_CLASSES,
  FILTER_FORM_CLASSES,
} from '../_shared/filter-form-classes';
// 🔴 列表示切替はクライアント境界の内側にある（`@ses/ui/client` の `DropdownMenu`）。
//    **この画面は `'use client'` を宣言しない** —— 境界は `ColumnToggle` の 1 ファイルに閉じており、
//    行の描画（50 行 × 9 列）はサーバに残る（`_components/column-toggle.tsx` 冒頭）。
import { ColumnToggle, type ColumnToggleItem } from '../../_components/column-toggle';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';

/** 検索条件の選択肢 1 件（`value` は API の query に載る値そのもの）。 */
export type ProjectFilterOption = {
  readonly value: string;
  readonly label: string;
};

/** フォームに戻す現在の検索条件（未指定は空文字）。 */
export type ProjectListFilterValues = {
  readonly q: string;
  readonly status: string;
  readonly startFrom: string;
  readonly prefecture: string;
};

export type ProjectListScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  readonly searchComingSoon: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchStatus: string;
  readonly searchStartFrom: string;
  readonly searchPrefecture: string;
  readonly searchSubmit: string;
  readonly searchClear: string;
  readonly register: string;
  readonly readOnlyNote: string;
  readonly columnName: string;
  readonly columnStatus: string;
  readonly columnMustRequirements: string;
  readonly columnUnitPrice: string;
  readonly columnStartDate: string;
  readonly columnLocation: string;
  readonly columnHeadcount: string;
  readonly columnUpdatedOn: string;
  readonly columnVisibility: string;
  /** 🔴 列表示切替を開く語（`T-22-06`。§7.1 の「9 列目以降は列表示切替に格納する」）。 */
  readonly columnToggleTrigger: string;
  readonly emptyTitle: string;
  readonly emptyLead: string;
  readonly nextPage: string;
  readonly firstPage: string;
};

/**
 * ページ送りのリンク。🔴 **凍結済み testid の維持**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④）:
 * `Pagination` は `project-list-pagination-prev` / `…-next` を出すが、凍結されている値は
 * **`project-list-first` / `project-list-next`** である（`EngineerPagingLink` と同じ形・同じ理由）。
 */
function ProjectPagingLink({ href, className, children, 'data-testid': testId }: PaginationLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId === undefined || testId.endsWith('-prev') ? 'project-list-first' : 'project-list-next'}
    >
      {children}
    </Link>
  );
}

/**
 * 列定義（🔴 **§10.3 の `S-010` の行をそのまま写す**。ファイル冒頭の表）。
 * 🔴 **画面に `hidden lg:table-cell` を書かない**（検査 (m)④）。
 */
function projectColumns(
  messages: ProjectListScreenMessages,
  showVisibilityColumn: boolean,
): readonly DataTableColumn<ProjectListRowView>[] {
  return [
    {
      id: 'name',
      header: messages.columnName,
      priority: 'always',
      // 🔴 名称列の下限 10rem はどのブレークポイントでも維持する（`U-16`）。
      minWidth: '10rem',
      // 🔴 案件名セルは `NameCell` に委譲する（`lg` 以上 = 切り詰め + `title` + 同じ行に `S-011` への
      //    導線 / `lg` 未満 = 折り返し）。**閲覧の監査記録は遷移先が書く**（`BR-27`）。
      nameCell: {
        name: (row) => row.name,
        href: (row) => `/projects/${row.id}`,
      },
    },
    {
      id: 'status',
      header: messages.columnStatus,
      priority: 'always',
      minWidth: '5rem',
      cell: (row) => row.status,
    },
    {
      id: 'mustRequirements',
      header: messages.columnMustRequirements,
      priority: 'lg',
      minWidth: '10rem',
      // 🔴 余りはこの列に配分する（§7.1 の `2xl`「要件の要約」）。
      grow: true,
      whitespace: 'normal',
      cell: (row) => (
        <>
          {row.mustRequirements}
          {row.moreMustRequirements === null ? null : (
            <span
              className="ml-1 text-xs text-fg-muted"
              data-testid={`project-list-more-requirements-${row.id}`}
            >
              {row.moreMustRequirements}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'unitPrice',
      header: messages.columnUnitPrice,
      priority: 'always',
      // 🔴 単価は円単位・3 桁区切り（§10.3「大きい数値」）。値は `list-rows` が組む。
      minWidth: '10rem',
      cell: (row) => row.unitPrice,
    },
    {
      id: 'startDate',
      header: messages.columnStartDate,
      priority: 'always',
      minWidth: '8rem',
      cell: (row) => row.startDate,
    },
    {
      id: 'location',
      header: messages.columnLocation,
      priority: 'sm',
      minWidth: '9rem',
      cell: (row) => row.location,
    },
    {
      id: 'headcount',
      header: messages.columnHeadcount,
      priority: 'lg',
      minWidth: '5rem',
      cell: (row) => row.headcount,
    },
    {
      id: 'updatedOn',
      header: messages.columnUpdatedOn,
      priority: 'sm',
      minWidth: '7rem',
      cell: (row) => row.updatedOn,
    },
    // 🔴 取引先には公開先の列を出さない（`F-014 AC-4` / `BR-07`）。**DOM から取り除く**。
    ...(showVisibilityColumn
      ? [
          {
            id: 'visibility',
            header: messages.columnVisibility,
            priority: 'lg',
            minWidth: '8rem',
            // 🔴 9 列目は列表示切替に格納する列である（§7.1「既定 8 列 + 操作列」）。
            hideable: true,
            cell: (row: ProjectListRowView) => (
              <span data-testid={`project-list-visibility-${row.id}`}>{row.visibility}</span>
            ),
          } satisfies DataTableColumn<ProjectListRowView>,
        ]
      : []),
  ];
}

export function ProjectListScreen({
  rows,
  filters,
  statusOptions,
  prefectureOptions,
  showVisibilityColumn,
  canRegister,
  showClearFilters,
  nextPageHref,
  firstPageHref,
  columnToggleItems,
  messages,
}: {
  readonly rows: readonly ProjectListRowView[];
  readonly filters: ProjectListFilterValues;
  readonly statusOptions: readonly ProjectFilterOption[];
  readonly prefectureOptions: readonly ProjectFilterOption[];
  /**
   * 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。
   *    出所は `ctx.partnerCompanyId` であり、行の値ではない。
   */
  readonly showVisibilityColumn: boolean;
  readonly canRegister: boolean;
  /** 絞り込みが 1 つでも効いているとき（`docs/04` §10.1 `S-010` 絞込 0 の条件解除導線）。 */
  readonly showClearFilters: boolean;
  /** 次ページ（無ければ `null`）。検索条件を保った URL である。 */
  readonly nextPageHref: string | null;
  /** 2 ページ目以降でだけ「最初のページに戻る」を出す（無ければ `null`）。 */
  readonly firstPageHref: string | null;
  /**
   * 🔴 **列表示切替の対象**（`T-22-06`。`docs/04` §7.1「9 列目以降は列表示切替に格納する」）。
   *
   * 🔴 **どの列が隠れているかは URL が持ち、サーバがこの配列を組む**（`lib/projects/list-rows.ts` の
   *    `parseHiddenProjectColumns` / `projectColumnToggleHref`）。画面はここから
   *    `hiddenColumnIds` を導くだけで、**自分で状態を持たない**（持つと再読込・共有で消える）。
   * 🔴 **空配列 = 切替を描かない**（取引先には 9 列目そのものが無いため空で届く。
   *    `showVisibilityColumn` と同じ出所〔`ctx.partnerCompanyId`〕で決まる）。
   */
  readonly columnToggleItems: readonly ColumnToggleItem[];
  readonly messages: ProjectListScreenMessages;
}) {
  // 🔴 隠す列は props の `hidden` から導く（画面に 2 つ目の出所を作らない）。
  const hiddenColumnIds = columnToggleItems.filter((item) => item.hidden).map((item) => item.id);
  return (
    <div data-testid="project-list-screen">
      {/* 🔴 §5-13 の `Toolbar`: **母集団の 1 行（§3.2-2 の #2）と検索の帯の置き場所をここに固定する。**
          ⚠️ **凍結済み testid の併記**（`U-22` / `SP-22` §3.2 の代替 ④）: `Toolbar` は母集団の 1 行を
             `project-list-toolbar-population` として描くが、凍結されている値は
             **`project-list-population`** であり `tests/e2e/projects.mobile.spec.ts` が掴んでいる。 */}
      <div data-testid="project-list-population">
        <Toolbar
          testIdPrefix="project-list-"
          population={messages.populationLabel}
          filters={
            <>
            {/* 🔴 検索条件（docs/04 §S-010 セクション 1）。`method="get"` なので、実行した検索が
               そのまま URL になり、共有・再読込・戻るのいずれでも同じ結果に戻る。
               ⚠️ `mb-0` / `w-full` は帯の中に置いたための余白・幅の調整である（`cn()` の規律 1）。 */}
            <form
              className={cn(FILTER_FORM_CLASSES, 'mb-0 w-full')}
              method="get"
              action="/projects"
              data-testid="project-list-filters"
            >
              <fieldset className="contents">
                <legend className="sr-only">{messages.searchLegend}</legend>
                <Field label={messages.searchQ}>
                  <Input type="search" name="q" defaultValue={filters.q} data-testid="project-list-filter-q" />
                </Field>
                <Field label={messages.searchStatus}>
                  <Select name="status" defaultValue={filters.status} data-testid="project-list-filter-status">
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={messages.searchStartFrom}>
                  <Input
                    type="date"
                    name="startFrom"
                    defaultValue={filters.startFrom}
                    data-testid="project-list-filter-start-from"
                  />
                </Field>
                <Field label={messages.searchPrefecture}>
                  <Select
                    name="prefecture"
                    defaultValue={filters.prefecture}
                    data-testid="project-list-filter-prefecture"
                  >
                    {prefectureOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className={FILTER_ACTIONS_CLASSES}>
                  <Button type="submit" data-testid="project-list-search">
                    {messages.searchSubmit}
                  </Button>
                  {showClearFilters ? (
                    <Link className={SECONDARY_LINK_CLASSES} href="/projects" data-testid="project-list-clear">
                      {messages.searchClear}
                    </Link>
                  ) : null}
                </div>
              </fieldset>
            </form>
            {/* 🔴 **列表示切替の置き場所は `Toolbar` である**（`docs/04` §5-13 / §7.1。`T-22-06`）。
                §5-13 の `Toolbar` は「検索 + フィルタ + 一括操作」の**置き場所を固定する**部品であり、
                列の出し入れも一覧の上の帯に属する —— **画面ごとに位置が変わらないこと**が条文の趣旨で
                あるため、検索の帯と同じ段（`filters`）に並べる。
                🔴 9 列目が無い取引先には `columnToggleItems` が空で届き、**何も描かない**。 */}
            {columnToggleItems.length === 0 ? null : (
              <ColumnToggle
                columns={columnToggleItems}
                triggerLabel={messages.columnToggleTrigger}
                testIdPrefix="project-list-column-toggle-"
              />
            )}
            </>
          }
        />
      </div>

      {/* 🔴 まだ効かない条件を黙って描かない（`engineers.list.searchComingSoon` と同じ規律）。 */}
      <p className="mb-3 text-body text-fg-muted" data-testid="project-list-search-coming-soon">
        {messages.searchComingSoon}
      </p>

      {messages.partnerScopeNotice === null ? null : (
        // 🔴 §5-10 の「見える範囲の説明」はフィルタ帯の直下である。
        //    ⚠️ 凍結済み `project-list-partner-scope-notice` を維持するため、`Toolbar` の
        //       `scopeNote`（`…-toolbar-scope-note` を出す）ではなく画面側の 1 行に残す。
        <p className="mb-1 text-body text-fg-muted" data-testid="project-list-partner-scope-notice">
          {messages.partnerScopeNotice}
        </p>
      )}
      {/* 🔴 並び順の説明（docs/04 §S-010）。スコア・順位・重みの語を含めない。 */}
      <p className="mb-3 text-body text-fg-muted" data-testid="project-list-order-note">
        {messages.orderNote}
      </p>

      <div className="mb-4">
        {canRegister ? (
          <Link
            className={SECONDARY_LINK_STACKED_CLASSES}
            href="/projects/new"
            data-testid="project-list-register"
          >
            {messages.register}
          </Link>
        ) : (
          <p className="text-body text-fg-muted" data-testid="project-list-read-only-note">
            {messages.readOnlyNote}
          </p>
        )}
      </div>

      <DataTable
        testIdPrefix="project-list-"
        columns={projectColumns(messages, showVisibilityColumn)}
        rows={rows}
        rowKey={(row) => row.id}
        linkComponent={Link}
        // 🔴 利用者が外した列（`hideable` を持つ列だけが対象。`priority` とは別の仕組み）。
        //    値の出所は URL であり、既定（`?hide=` 無し）では**9 列すべてが出る**。
        hiddenColumnIds={hiddenColumnIds}
        empty={
          // 🔴 docs/04 §10.1 `S-010`: **初回空と絞込 0 で文言が違う**（呼び出し側が選ぶ）。
          //    取引先の初回空は「案件が無い」ではなく「公開されていない」である。
          //    ⚠️ 器の `data-testid` は凍結済みの `project-list-empty` である（`U-22`）。
          <div data-testid="project-list-empty">
            <EmptyState
              testIdPrefix="project-list-empty-state-"
              description={`${messages.emptyTitle}${messages.emptyLead}`}
            />
          </div>
        }
      />

      {/* 🔴 カーソルページング（docs/05 §6.1）。**「全 N ページ中 M ページ目」を出さない**。
          🔴 リンクは検索条件を保った URL である（`projectListHref`）。
          ⚠️ 器の `data-testid` は凍結済みの `project-list-paging` である（`U-22`）。 */}
      {nextPageHref === null && firstPageHref === null ? null : (
        <div className="mt-4" data-testid="project-list-paging">
          <Pagination
            testIdPrefix="project-list-"
            nextHref={nextPageHref}
            nextLabel={messages.nextPage}
            prevHref={firstPageHref}
            prevLabel={messages.firstPage}
            linkComponent={ProjectPagingLink}
          />
        </div>
      )}
    </div>
  );
}
