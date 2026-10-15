// apps/web/app/(main)/projects/project-list-screen.tsx
// `S-010` 案件一覧・検索 — 本体（docs/04 §S-010 / `F-015` / docs/05 §6.4 #25）。
// T-06-03 → **SP-22 `T-22-06`（一覧の適用 ①）** → **SP-22 段④（ワイヤーフレームへの刷新）**。
//
// ============================================================================
// 🔴 SP-22 段④ で何が変わったか（**見せ方だけ**。人間のワイヤーフレーム）
// ============================================================================
// | 変えたもの | 一次資料 | 🔴 変えていないもの |
// |---|---|---|
// | 絞り込みを **`Card`（白い面）**に入れた（ページ地は `--color-bg-subtle`） | §7.9 / `Table` の器と同じ判断 | 🔴 **条件の集合・`name`・送り先・`method="get"`** |
// | 並び順の説明を **件数バーの右端**（`Toolbar` の `note`）へ | ワイヤーフレーム「件数バー」/ §5-13 | 🔴 **選べる形にしない**（`?sort=` は既存 API に無い。`HANDOFF.md` §5） |
// | 登録の導線を **帯の primary** へ（`projectListPrimaryAction`） | §S-010 / §7.6 | 🔴 **testid `project-list-register`** / 閲覧専用ロールには描かない |
// | **操作列**（`内容を見る`）で副カラムを開く | §7.1「8 列 + 操作列」/ §7.8 の統一語 | 🔴 **名称セルは `S-011` へ遷移**（閲覧の監査記録は遷移先が書く） |
// | 「効かない条件」の 1 行を絞り込みカードの中へ | — | 🔴 **文言と testid**（`project-list-search-coming-soon`） |
//
// 🔴 **API / 取得経路 / 権限判定 / URL / 列の集合・並び・間引きの境界は 1 つも変えていない。**
// 🔴 **ワイヤーフレームから意図して落としたもの**: 行のチェックボックス（Phase 1 に一括操作が
//    1 つも無い。押せるのに何も起きない UI を作らない）/ `案件をインポート`（案件の取込は
//    画面も API も存在しない）/ `案件区分` `カテゴリ` `稼働形態` `単価` `並行可否` `募集中のみ`
//    （既存 query〔`#25`〕に無い条件は描かない）/ `表示件数` のセレクト（`?limit=` は API に
//    在るが、動く控制にするには client JS か件数バー内の送信ボタンが要る。§7.1 の既定 50 行のまま）。
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
  Card,
  CardContent,
  DataTable,
  EmptyState,
  Field,
  Input,
  Pagination,
  SECONDARY_LINK_CLASSES,
  Select,
  StatusBadge,
  StatusDot,
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
  /** ✅ 2026-10-15: 単価レンジ（月額・円）。人材一覧（`S-005`）と**同じ名前・同じ単位**である。 */
  readonly priceMin: string;
  readonly priceMax: string;
};

export type ProjectListScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  /** ✅ 2026-10-03: 表が器に収まらない幅での 1 行（`Table` の `overflowNote`）。 */
  readonly overflowNote: string;
  readonly searchComingSoon: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchStatus: string;
  readonly searchStartFrom: string;
  readonly searchPrefecture: string;
  readonly searchPriceMin: string;
  readonly searchPriceMax: string;
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
  /** 操作列の列ヘッダ（SP-22 段④。`docs/04` §7.1「既定 8 列 + 操作列」）。 */
  readonly columnAction: string;
  /** 行から副カラムを開く語（§7.8 の統一語 `内容を見る`）。 */
  readonly panelOpen: string;
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
        // ✅ **2026-10-15: 状態の点**（人間が提示した案件一覧の画像。案件名の左）。
        // 🔴 **色は `StatusBadge` と同じ 1 つの表から決まる**（`StatusDot` は `entity` /
        //    `state` しか受け取らない。`docs/04` §5-13）。画面は色を選べない。
        // 🔴 **点に語を持たせない** —— 同じ行の Badge が語を出しており、読み上げでは
        //    `aria-hidden` で重複を避けている。
        leading: (row) => <StatusDot entity="project" state={row.statusState} />,
      },
    },
    {
      id: 'status',
      header: messages.columnStatus,
      priority: 'always',
      minWidth: '5rem',
      // ✅ **2026-10-14: 素のテキストから `StatusBadge` にした**（人間の定義書
      //    `docs/design-system-projects.md` §1.7「ステータス 100 Badge」）。
      // 🔴 **色は渡していない** —— `entity="project"` と**状態名**だけを渡し、色と形状は
      //    `@ses/ui` の `STATUS_BADGE_APPEARANCES` が決める（`docs/04` §5-13）。
      //    割り当ては [Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98)（既定 A）。
      // 🔴 **語は `packages/i18n` 由来のまま**（`row.status`）。部品に日本語を持たせない。
      cell: (row) => <StatusBadge entity="project" state={row.statusState} label={row.status} />,
    },
    {
      id: 'mustRequirements',
      header: messages.columnMustRequirements,
      priority: 'lg',
      minWidth: '10rem',
      // 🔴 余りはこの列に配分する（§7.1 の `2xl`「要件の要約」）。
      grow: true,
      // ✅ **2026-10-15: 切替に格納できる列にした**（既定は非表示。人間の決定）。
      //    🔴 **列を消していない** —— 1 クリックで戻せる（`PROJECT_DEFAULT_HIDDEN_COLUMN_IDS` の 🔴）。
      hideable: true,
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
      // ✅ 2026-10-15: 下限を実測に合わせて詰めた（`2026-11-11` は約 86px。右の案件詳細パネルを
      //    横に並べるため、表の min-content を 1,059 → 約 995px にする）。
      minWidth: '6rem',
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
      // ✅ 2026-10-15: 下限を実測に合わせて詰めた（`1 名` は約 40px。右の案件詳細パネルを
      //    横に並べるため、表の min-content を 1,059 → 約 995px にする）。
      minWidth: '4rem',
      cell: (row) => row.headcount,
    },
    {
      id: 'updatedOn',
      header: messages.columnUpdatedOn,
      priority: 'sm',
      // ✅ 2026-10-15: 下限を実測に合わせて詰めた（同上。右の案件詳細パネルを
      //    横に並べるため、表の min-content を 1,059 → 約 995px にする）。
      minWidth: '6rem',
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
  selectedId,
  selectHrefOf,
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
  /**
   * 🔴 **副カラム（案件の要点パネル）で開いている行の ID**（SP-22 段④）。
   *
   * 🔴 **出所は URL（`?selected=`）であり、画面は状態を持たない**（`selectedProjectId`。
   *    持つと再読込・共有・戻るで消え、`'use client'` が要る）。1 件も無いページでは `null`。
   * 🔴 **これは「選択」（一括操作の対象）ではない** —— Phase 1 に一括操作は 1 つも無く、
   *    `DataTable` の `selection`（チェックボックス）は渡さない。
   */
  readonly selectedId: string | null;
  /** その行を副カラムで開く URL（`projectSelectHref`。検索条件とページの位置を保つ）。 */
  readonly selectHrefOf: (projectId: string) => string;
  readonly messages: ProjectListScreenMessages;
}) {
  // 🔴 隠す列は props の `hidden` から導く（画面に 2 つ目の出所を作らない）。
  const hiddenColumnIds = columnToggleItems.filter((item) => item.hidden).map((item) => item.id);
  return (
    <div data-testid="project-list-screen">
      {/* 🔴 §5-13 の `Toolbar`: **母集団の 1 行（§3.2-2 の #2）と検索の帯の置き場所をここに固定する。**
          ⚠️ **凍結済み testid の併記**（`U-22` / `SP-22` §3.2 の代替 ④）: `Toolbar` は母集団の 1 行を
             `project-list-toolbar-population` として描くが、凍結されている値は
             **`project-list-population`** であり `tests/e2e/projects.mobile.spec.ts` が掴んでいる。
          ✅ **SP-22 段④**: 絞り込みを `Card`（白い面）に入れ、並び順の説明を母集団と同じ行
             （件数バー）の右端へ移した（ワイヤーフレームの「絞り込みカード」+「件数バー」）。
             🔴 **条件の集合・`name` 属性・送り先は 1 つも変えていない。** */}
      <div data-testid="project-list-population">
        <Toolbar
          testIdPrefix="project-list-"
          population={messages.populationLabel}
          note={
            // 🔴 並び順の説明（docs/04 §S-010「並び順の説明は 1 行で常時出す」）。
            //    スコア・順位・重みの語を含めない。
            // 🔴 **選べる形にしない** —— 既存 API に `?sort=` が無い（`HANDOFF.md` §5）。
            //    動かないセレクトを置かず、サーバが確定させた並びを文で述べる。
            //    ⚠️ 器の `data-testid` は凍結済みの `project-list-order-note` である（`U-22`）。
            <p className="text-xs text-fg-muted" data-testid="project-list-order-note">
              {messages.orderNote}
            </p>
          }
          filters={
            // 🔴 絞り込みは**白い面のカード**に入れる（ページ地は `--color-bg-subtle` なので、
            //    面を持たないと入力欄の群が地に溶ける。`Table` の器と同じ判断）。
            //    🔴 面・余白・radius は `Card` の中にしか無い（画面に `rounded-md border …` を書かない）。
            <Card className="w-full">
              {/* `CardContent` は `p-4 pt-0`。見出しを持たないカードなので上の余白を戻す
                  （`cn()` = `tailwind-merge` が `pt-0` を落とす）。 */}
              <CardContent className="pt-4">
                {/* 🔴 検索条件（docs/04 §S-010 セクション 1）。`method="get"` なので、実行した検索が
                   そのまま URL になり、共有・再読込・戻るのいずれでも同じ結果に戻る。
                   🔴 **既存 API（`#25`）に在る条件だけを描く**（`q` / `status` / `startFrom` /
                      `prefecture` / ✅ 2026-10-15 で足した `priceMin` / `priceMax`）。
                      **スキル要件とリモート可否**は query に無いので**入力欄を描かず**、
                      下の 1 行で「できないこと」を書く。
                   🔴 **条件の個数を文章に数字で書かない**（増減のたびに文章が古くなる。
                      `HANDOFF.md` §6-15）。
                   ⚠️ `mb-0` / `w-full` は帯の中に置いたための余白・幅の調整である（`cn()` の規律 1）。 */}
                <form
                  className={cn(FILTER_FORM_CLASSES, 'mb-0 w-full')}
                  method="get"
                  action="/projects"
                  data-testid="project-list-filters"
                >
                  <fieldset className="contents">
                    <legend className="sr-only">{messages.searchLegend}</legend>
                    {/* 🔴 フリーワードは**全幅**（ワイヤーフレームの検索欄）。最も使う条件を
                        1 行目に単独で置く —— 他の 3 条件と同じ幅に並べると、入力できる語数が
                        画面幅で変わる。 */}
                    {/* ✅ **2026-10-15: 全幅 → 2 列ぶん**（定義書 §1.6 の「検索 Input 420×36」+
                        受領した画像）。🔴 **帯が 1 行ぶん縮む** —— 行の高さを 45px に上げた
                        ぶん、一覧の「ファーストビューに 12 行以上」（`docs/04` §7.1）を
                        ここで取り戻す。**条件は 1 つも減っていない。** */}
                    <Field className="sm:col-span-2" label={messages.searchQ}>
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
                    {/* ✅ **2026-10-15: 単価レンジ**（定義書 §1.6 の Filter Panel の 1 行。人間の
                        指示「自社案件管理ページはこれを参照してアップデートして」）。
                        🔴 **人材一覧（`S-005`）と同じ形にした** —— `type="number"` / `step=10000` /
                           `名前は priceMin / priceMax` / 単位は円。定義書 §1.4 自身が
                           「人材管理 §2.10 を継承」と定めており、**2 画面で単価の入れ方を変えない**。
                           ⚠️ 定義書 §1.6 は「下限 ＋ 〜 ＋ 上限 ＋ 単位」を 1 つの欄に組む形だが、
                           それは人材一覧にも同じ改修が要る話であり、**片方だけ別の形にしない**。
                        🔴 **述語（レンジの重なり）は `packages/db/src/search/unit-price-range.ts` の
                           1 本**である（人材検索と共有。T-06-03 の申し送りの決着）。 */}
                    {/* 🔴 **下限と上限を 1 つの塊にする**（列の折り返しで 2 欄が別の行に分かれると、
                        `単価（上限）` が単独の条件に見える）。定義書 §1.6 も単価レンジを
                        **独立した 1 行**として組んでいる。⚠️ 2 列に割るだけの器であり、
                        **欄そのものは人材一覧と同じ 2 つの `Field`** のままである。 */}
                    <div className="grid grid-cols-2 items-end gap-4 sm:col-span-2">
                      <Field label={messages.searchPriceMin}>
                        <Input
                          type="number"
                          name="priceMin"
                          min={0}
                          step={10000}
                          defaultValue={filters.priceMin}
                          data-testid="project-list-filter-price-min"
                        />
                      </Field>
                      <Field label={messages.searchPriceMax}>
                        <Input
                          type="number"
                          name="priceMax"
                          min={0}
                          step={10000}
                          defaultValue={filters.priceMax}
                          data-testid="project-list-filter-price-max"
                        />
                      </Field>
                    </div>
                    {/* 🔴 送信と「条件をクリア」は必ず 1 行を占める（列の途中に紛れると
                        押せる場所が毎回変わる）。`justify-end` はカードの中で右に寄せるための
                        配置の調整であり、共有定数（`FILTER_ACTIONS_CLASSES`）は変えていない。 */}
                    {/* ✅ **2026-10-15: フッタ 1 行にまとめた**（人間が提示した画像 + 定義書 §1.6
                        「フッタ行（Checkbox 左 / Secondary + Primary 右）」）。**左に「できないこと」
                        と「表示する列」、右に クリア / 検索**。
                        🔴 **一覧は「ファーストビューに 12 行以上」**（`docs/04` §7.1）であり、
                           絞り込みの帯が縦に伸びるほど表が押し下げられる —— 実測で帯は 286px
                           あり、3 行ぶんの行を食っていた。行の高さを定義書の 45h に上げる
                           ぶん、**ここで取り戻す**。 */}
                    <div className={cn(FILTER_ACTIONS_CLASSES, 'justify-between gap-y-2')}>
                      <div className="flex flex-wrap items-center gap-3">
                        {/* 🔴 まだ効かない条件を黙って描かない（`engineers.list.searchComingSoon` と同じ規律）。 */}
                        <p className="text-xs text-fg-muted" data-testid="project-list-search-coming-soon">
                          {messages.searchComingSoon}
                        </p>
                        {/* 🔴 **列表示切替の置き場所は帯である**（`docs/04` §5-13 / §7.1。`T-22-06`）。
                            ✅ 2026-10-15: 既定で 2 列を格納したので、**ここが「戻す」唯一の入口**になった。 */}
                        {columnToggleItems.length === 0 ? null : (
                          <ColumnToggle
                            columns={columnToggleItems}
                            triggerLabel={messages.columnToggleTrigger}
                            testIdPrefix="project-list-column-toggle-"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {showClearFilters ? (
                          <Link className={SECONDARY_LINK_CLASSES} href="/projects" data-testid="project-list-clear">
                            {messages.searchClear}
                          </Link>
                        ) : null}
                        <Button type="submit" data-testid="project-list-search">
                          {messages.searchSubmit}
                        </Button>
                      </div>
                    </div>
                  </fieldset>
                </form>

              </CardContent>
            </Card>
          }
        />
      </div>

      {messages.partnerScopeNotice === null ? null : (
        // 🔴 §5-10 の「見える範囲の説明」はフィルタ帯の直下である。
        //    ⚠️ 凍結済み `project-list-partner-scope-notice` を維持するため、`Toolbar` の
        //       `scopeNote`（`…-toolbar-scope-note` を出す）ではなく画面側の 1 行に残す。
        <p className="mb-1 text-xs text-fg-muted" data-testid="project-list-partner-scope-notice">
          {messages.partnerScopeNotice}
        </p>
      )}

      {/* 🔴 §7.6: 操作できないときは `disabled` で表さず、**その位置に理由テキストを置く**。
          ✅ SP-22 段④: 登録の導線そのものは**帯の primary** へ移した
             （`projectListPrimaryAction`。`docs/04` §S-010「案件を登録（primary、ホストのみ）」/
             §7.6「primary は大きく」）。testid（`project-list-register`）は帯が引き継いでいる。 */}
      {canRegister ? null : (
        <p className="mb-3 text-body text-fg-muted" data-testid="project-list-read-only-note">
          {messages.readOnlyNote}
        </p>
      )}

      <DataTable
        testIdPrefix="project-list-"
        // 🔴 ✅ 2026-10-03: **9 列の表は 1280px の器に収まらない**（実測: 内容 1,313px）。
        //    §7.1 は「列を削らないことが先」なので列は減らさず、**切れ目を示して語で伝える**。
        //    器の側の印（`overflow-indicator-x`）は `Table` が常に持つ（CSS で、
        //    スクロールできるときにだけ出る）。
        overflowNote={messages.overflowNote}
        columns={projectColumns(messages, showVisibilityColumn)}
        rows={rows}
        rowKey={(row) => row.id}
        linkComponent={Link}
        // 🔴 利用者が外した列（`hideable` を持つ列だけが対象。`priority` とは別の仕組み）。
        //    値の出所は URL であり、既定（`?hide=` 無し）では**9 列すべてが出る**。
        hiddenColumnIds={hiddenColumnIds}
        // 🔴 副カラムで開いている行の印（`data-selected`）。**選択（一括操作）ではない**ので
        //    `selection`（チェックボックス）は渡さない —— Phase 1 に一括操作は 1 つも無い。
        rowAttributes={(row) => ({ 'data-selected': row.id === selectedId ? 'true' : undefined })}
        // 🔴 操作列（1 行につき 1 つ。`docs/04` §7.1「既定 8 列 + 操作列」）。
        //    行の名称セルは `S-011` へ遷移する（`docs/04` §S-010「行クリック → `S-011`」。
        //    **閲覧の監査記録は遷移先が書く**）。ここは**副カラムを開くだけ**の導線であり、
        //    語は §7.8 の統一語（`内容を見る`）である。
        rowActionHeader={messages.columnAction}
        rowAction={(row) => (
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={selectHrefOf(row.id)}
            data-testid={`project-list-panel-open-${row.id}`}
            // 🔴 同じ語のリンクが 50 行に並ぶので、読み上げでは案件名で区別できるようにする。
            aria-label={`${messages.panelOpen}: ${row.name}`}
          >
            {messages.panelOpen}
          </Link>
        )}
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
