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
import type { ReactNode } from 'react';
import {
  Badge,
  DataTable,
  cn,
  EmptyState,
  // ⚠️ **2026-10-19: 複数選択の 4 定数の import はここから消えた。** 引き金・面・行・`×` を
  //    組むのは `./skill-filter-select.tsx`（クライアントの島）に移っており、
  //    **見た目の決定は従来どおり `@ses/ui` の 1 箇所にある**（定数そのものは増えた）。
  Card,
  PAGE_BODY_ASIDE_ROW_CLASSES_BY_FROM,
  PAGE_BODY_SPLIT_MAIN_CLASSES_BY_FROM,
  PAGE_BODY_ASIDE_WIDTH_CLASSES,
  DETAIL_PANE_VIEWPORT_CLASSES,
  StatusBadge,
  Toolbar,
  type DataTableColumn,
} from '@ses/ui';
// ⚠️ **2026-10-19: 絞り込みの器のクラス（`_shared/filter-form-classes`）はここでは使わない。**
//    検索エリアは `_search/` の島に移り、格子は器の幅で決まる（`FILTER_GRID_CLASSES`）。
//    🔴 **定数そのものは残す** —— 人材一覧（`S-005`）など 3 画面が使っている。
// 🔴 列表示切替はクライアント境界の内側にある（`@ses/ui/client` の `DropdownMenu`）。
//    **この画面は `'use client'` を宣言しない** —— 境界は `ColumnToggle` の 1 ファイルに閉じており、
//    行の描画（50 行 × 9 列）はサーバに残る（`_components/column-toggle.tsx` 冒頭）。
// ✅ 2026-10-16: `ColumnToggle` の描画はやめた（人間の明示指示）。型だけ残る ——
//    `columnToggleItems` の prop そのものは `page.tsx` が組み立てており、`?hide=` の
//    query を受け取れる状態は保っている（共有された URL を壊さない）。
import type { ColumnToggleItem } from '../../_components/column-toggle';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';
// ✅✅ **2026-10-19: スキル条件（複数選択）だけがクライアント境界の内側にある。**
// 🔴 **この画面は `'use client'` を宣言しない** —— 境界は `SkillFilterSelect` の 1 ファイルに
//    閉じており、行の描画（50 行 × 9 列）も他の 5 条件もサーバに残る
//    （`_components/column-toggle.tsx` が担っていたのと同じ形）。
import { SearchPanel, type SearchPanelMessages } from './_search/search-panel';
import { ProjectPagination } from './project-pagination';
import type { ProjectPaginationModel } from '../../../lib/projects/pagination';
import { ProjectStatusControl, type ProjectStatusControlMessages } from './project-status-control';
import type { ProjectSearchDraft } from './_search/filters';
import type { SearchFilterFormOptions } from './_search/search-filter-form';

/** 検索条件の選択肢 1 件（`value` は API の query に載る値そのもの）。 */
export type ProjectFilterOption = {
  readonly value: string;
  readonly label: string;
};

// ⚠️ **2026-10-19: `ProjectListFilterValues` を削除した。**
//    条件の型は `_search/filters.ts` の `ProjectSearchDraft`（指示書 §3 の 8 項目）に移った。
// 🔴 **残すと矛盾する** —— 旧型は `parallelOk` を持っており、「この画面から並行可否を
//    外した」今回の変更と反対のことを書いたままになる。この画面が繰り返し
//    規律にしている「受け取って使わない props を残さない」を型にも適用する。

export type ProjectListScreenMessages = {
  readonly statusControl: ProjectStatusControlMessages;
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  /** ✅ 2026-10-03: 表が器に収まらない幅での 1 行（`Table` の `overflowNote`）。 */
  readonly overflowNote: string;
  // ⚠️ **2026-10-19: 検索条件の語はここに無い。**
  //    検索エリアは `_search/search-panel.tsx` の島に移り、語は
  //    `searchMessages`（`SearchPanelMessages`）として**別の prop** で届く。
  // 🔴 **文言キーは 1 つも消していない**（`packages/i18n` の凍結。`U-22`）——
  //    組み立てる場所が `list-props.ts` の別の関数に移っただけである。
  readonly register: string;
  readonly readOnlyNote: string;
  readonly columnName: string;
  readonly columnStatus: string;
  readonly columnMustRequirements: string;
  readonly columnUnitPrice: string;
  readonly columnPurchaseUnitPrice: string;
  readonly columnStartDate: string;
  readonly columnLocation: string;
  /** ✅ 2026-10-15: 稼働形態（`#101` の C で `勤務地・リモート` を 2 列に分けた）。 */
  readonly columnRemoteMode: string;
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
/**
 * 列定義（🔴 **§10.3 の `S-010` の行をそのまま写す**。ファイル冒頭の表）。
 * 🔴 **画面に `hidden lg:table-cell` を書かない**（検査 (m)④）。
 */
function projectColumns(
  messages: ProjectListScreenMessages,
  /**
   * ✅✅ **2026-10-16: 行を開く URL**（人間の明示指示「列をクリックしたら右側エリアに
   * 表示されるようにする」）。🔴 **`showVisibilityColumn` と入れ替わった** ——
   * 公開先の列が無くなり、代わりに行全体の遷移先が要るようになった。
   */
  selectHrefOf: (projectId: string) => string,
  showPurchasePrice: boolean,
  canEditStatus: boolean,
): readonly DataTableColumn<ProjectListRowView>[] {
  return [
    {
      id: 'name',
      header: messages.columnName,
      priority: 'always',
      // ✅✅ **2026-10-16（人間の明示指示「『案件名』列の幅が狭くて改行されている」）:
      //    **余りをこの列が受けるようにした**（`grow`。旧: `必須要件の要約`）。**
      // 🔴 **折り返していた原因は下限ではなく `grow` の位置だった** —— 余りを
      //    `必須要件の要約` が全部受けていたので、案件名は下限 10rem に張り付いたままだった
      //    （同じ指示の「必須要件の要約が列幅広すぎない？」と**同じ 1 つの原因**である）。
      // 🔴🔴 **下限は 10rem のままにする。** 一度 16rem にしたが、それだと表の min-content が
      //    256px 増え、**1600px でも案件サマリが表の右に並ばなくなった**（`PageBody` の
      //    `asideFrom="main-min"` は「主カラムが下限を保てるときだけ」並置する）。
      //    下限は `U-16` の「どのブレークポイントでも割らない値」であって「この幅にする値」ではない。
      minWidth: '10rem',
      grow: true,
      // 🔴 案件名セルは `NameCell` に委譲する（`lg` 以上 = 切り詰め + `title` + 同じ行に `S-011` への
      //    導線 / `lg` 未満 = 折り返し）。**閲覧の監査記録は遷移先が書く**（`BR-27`）。
      nameCell: {
        // ✅✅ **2026-10-16（人間の明示指示「操作列もいらない。列をクリックしたら右側エリアに
        //    表示されるようにする。案件タイトルもリンクにしない。列クリック→右側で詳細を
        //    クリックで詳細画面に行く動線」）。**
        // 🔴 **遷移先が `S-011` から「右パネルを開く URL」に変わった。** 詳細画面へは右パネルの
        //    `詳細` から行く（**閲覧の監査記録はその遷移先が書く**。`F-013 AC-3`）。
        // 🔴 **行いっぱいの当たり判定にする**（`stretch`）—— `<a>` は行に 1 つだけで、
        //    クライアント JS は 0 行である（`@ses/ui` の `NAME_CELL_ROW_LINK_CLASSES` の 🔴）。
        // 🔴 **下線を引かない**（指示「案件タイトルもリンクにしない」）。見た目は素の文字で、
        //    実体は行を開くリンクである。
        name: (row) => row.name,
        href: (row) => selectHrefOf(row.id),
        stretch: true,
        // ✅✅ **2026-10-16: 状態の点（`StatusDot`）を外した**（人間の明示指示
        //    「案件名の左に〇があるけどこれはいらないね」）。
        // 🔴 **状態は隣の列の `StatusBadge` が語で出している** —— 点はその重複であり、
        //    外しても読み取れる情報は 1 つも減らない（むしろ案件名の左端が揃う）。
        // ⚠️ `StatusDot` 自体は `@ses/ui` に残る（他の画面が使う）。ここで渡さないだけである。
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
      cell: (row) => canEditStatus
        ? <ProjectStatusControl key={row.id} id={row.id} status={row.statusState} messages={messages.statusControl} inList />
        : <StatusBadge entity="project" state={row.statusState} label={row.status} />,
    },
    {
      id: 'mustRequirements',
      header: messages.columnMustRequirements,
      priority: 'lg',
      // ✅✅ **2026-10-16（人間の明示指示「必須要件の要約が列幅広すぎない？」）:
      //    **余りの配分を外した**（`grow` を `案件名` に移した）。**
      // 🔴 **この列が持つのは上位 3 件の要約である**（全量は `S-011`）。余りを全部受けると、
      //    一覧で最初に読む `案件名` より広くなり、要約のほうが主役に見える。
      // 🔴🔴 **下限は 10rem のままにする。** 一度 8rem まで詰めたが、`TypeScript 2 年以上` が
      //    2 行に折り返した（`whitespace: 'normal'` なので幅が足りないと割れる）——
      //    **広すぎるのを直して、今度は狭すぎて折り返す**のでは意味が無い。
      minWidth: '10rem',
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
    ...(showPurchasePrice ? [{
      id: 'purchaseUnitPrice',
      header: messages.columnPurchaseUnitPrice,
      hideable: true,
      priority: 'always',
      minWidth: '6rem',
      cell: (row: ProjectListRowView) => row.purchaseUnitPrice,
    }] satisfies readonly DataTableColumn<ProjectListRowView>[] : []),
    {
      id: 'unitPrice',
      header: messages.columnUnitPrice,
      priority: 'always',
      // ✅ **2026-10-15: 一覧の表だけ万円表記にした**（`#101` の C。`660,000〜750,000 円`
      //    160px → `66〜75 万円` 約 80px）。値は `list-rows` が組む。
      minWidth: '6rem',
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
      // ✅ **2026-10-15: リモート可否を別の列に出したので下限を詰めた**
      //    （`神奈川県` は約 60px。[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101) の C）。
      minWidth: '5rem',
      cell: (row) => row.location,
    },
    {
      // ✅ **2026-10-15: 稼働形態（`#101` の C「勤務地と稼働形態を分けて `埼玉` + Badge」）**。
      // 🔴 **無彩色の Badge である**（`variant` を渡さない = 既定の `neutral`）—— §7.4 の
      //    6 系統は**業務上の意味**に割り当てており、稼働形態は状態ではない。
      //    色を付けると「この案件は赤い」のような誤読を生む（受領画像は色付きだが採らない）。
      // 🔴 **未設定は何も描かない**（空の Badge を置かない。`formatProjectRemoteMode` が `null`）。
      id: 'remoteMode',
      header: messages.columnRemoteMode,
      priority: 'sm',
      minWidth: '6rem',
      cell: (row) => (row.remoteMode === null ? null : <Badge>{row.remoteMode}</Badge>),
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
    // ✅✅ **2026-10-16: `公開先の設定状況` の列を外した**（人間の明示指示
    //    「案件リストの『公開先の設定状況』列はいらない」）。
    // 🔴 **情報そのものは失っていない** —— 右の案件の要点パネルが公開先を出す。
    //    表から外したのは**横スクロールを無くすため**でもある（人間の明示指示
    //    「案件一覧のリストは横スクロールなしで表示できるようにしてください」）。
  ];
}

export function ProjectListScreen({
  pagination,
  summaryPanel,
  rows,
  applied,
  searchOptions,
  passThroughParams,
  storageTenantId,
  storageUserId,
  defaultExpanded,
  searchMessages,
  canRegister,
  columnToggleItems,
  selectedId,
  selectHrefOf,
  messages,
}: {
  readonly pagination: ProjectPaginationModel;
  readonly summaryPanel?: ReactNode;
  readonly rows: readonly ProjectListRowView[];
  // ====================================================================
  // ✅✅ **2026-10-19: 検索エリアの props**（人間の改修指示書）
  // ====================================================================
  /**
   * 🔴 **いま一覧に効いている条件**（`appliedFilters`。指示書 §6）。
   *
   * 🔴 **出所は URL である** —— `page.tsx` が `projectListQuerySchema` で解釈した結果を
   *    この形に整えて渡す。編集中の条件（`draftFilters`）は島の中にしか無い。
   * 🔴 **`並行可否` のキーが無い**（指示書 §3 で除外した）。
   */
  readonly applied: ProjectSearchDraft;
  /** 8 項目の選択肢（状態 / カテゴリ / 稼働形態 / 勤務地 / 開始時期 / スキル）。 */
  readonly searchOptions: SearchFilterFormOptions;
  /**
   * 🔴 **画面に欄を持たないが URL には在る値**（`sourceKind` / `recruitingOnly` /
   *    `startFrom` と、表示の状態 `hide` / `selected` / `panelTab`）。
   *    検索を 1 回押しただけでこれらが黙って消えないように素通しする。
   */
  readonly passThroughParams: readonly { readonly name: string; readonly value: string }[];
  /** 🔴 保存条件の置き場所を**会社×ユーザー**で分ける（指示書 §5）。 */
  readonly storageTenantId: string;
  readonly storageUserId: string;
  /** 🔴 折りたたみの初期値（cookie 。**再訪時に復元**するため。指示書 §4）。 */
  readonly defaultExpanded: boolean;
  readonly searchMessages: SearchPanelMessages;
  /**
   * 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。
   *    出所は `ctx.partnerCompanyId` であり、行の値ではない。
   */
  // ✅ 2026-10-16: `公開先の設定状況` の列ごと外したので prop も外した（人間の明示指示）。
  //    🔴 **取引先に出さない判断は消えていない** —— 列そのものが無い。
  readonly canRegister: boolean;
  /** 絞り込みが 1 つでも効いているとき（`docs/04` §10.1 `S-010` 絞込 0 の条件解除導線）。 */
  // ✅ 2026-10-16: `showClearFilters` を外した（「条件をクリア」は常時表示になった）。
  //    🔴 **受け取って使わない props を残さない** —— 呼び手が「渡せば効く」と誤解する。
  /** 次ページ（無ければ `null`）。検索条件を保った URL である。 */

  /** 2 ページ目以降でだけ「最初のページに戻る」を出す（無ければ `null`）。 */

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
    <div className={cn(PAGE_BODY_ASIDE_ROW_CLASSES_BY_FROM.lg, 'gap-4 lg:items-start')} data-testid="project-list-screen">
      <div className={cn(PAGE_BODY_SPLIT_MAIN_CLASSES_BY_FROM.lg,'flex flex-col gap-4')}>
      {/* 🔴 §5-13 の `Toolbar`: **母集団の 1 行（§3.2-2 の #2）と検索の帯の置き場所をここに固定する。**
          ⚠️ **凍結済み testid の併記**（`U-22` / `SP-22` §3.2 の代替 ④）: `Toolbar` は母集団の 1 行を
             `project-list-toolbar-population` として描くが、凍結されている値は
             **`project-list-population`** であり `tests/e2e/projects.mobile.spec.ts` が掴んでいる。
          ✅ **SP-22 段④**: 絞り込みを `Card`（白い面）に入れ、並び順の説明を母集団と同じ行
             （件数バー）の右端へ移した（ワイヤーフレームの「絞り込みカード」+「件数バー」）。
             🔴 **条件の集合・`name` 属性・送り先は 1 つも変えていない。** */}
      <div data-testid="project-list-population">
        {/* 並び順の常時説明は外すが、凍結済みの検査IDは一覧のメタ情報に保持する。 */}
        <div data-testid="project-list-order-note">
        <Toolbar
          testIdPrefix="project-list-"
          // ✅✅ **2026-10-16（人間の明示指示「『自社案件 6 件』と『後任募集 → 募集中 → 充足 の順に、
          //    同じ状態のなかでは更新日の新しい順に表示しています。』はいらない」）。**
          // 🔴 **母集団の説明は取引先にだけ残す**（`partnerScopeNotice`）—— あちらは
          //    「なぜこの件数なのか」が公開範囲で決まる側であり、消すと**見えない理由が消える**
          //    （`F-006 AC-2`）。ホストは自社の全件なので説明が要らない。
          // ⚠️ **並び順の注記も外した。** `docs/04` §S-010 は「並び順の説明は 1 行で常時出す」と
          //    定めているが、人間の明示指示が優先する（設計書の追随は別途）。
          //    🔴 **並び自体は変えていない**（`PROJECT_LIST_ORDER_BY`。決定的なまま）。
          population={messages.partnerScopeNotice ?? ''}
          note={null}
          filters={
            // 🔴 絞り込みは**白い面のカード**に入れる（ページ地は `--color-bg-subtle` なので、
            //    面を持たないと入力欄の群が地に溶ける。`Table` の器と同じ判断）。
            //    🔴 面・余白・radius は `Card` の中にしか無い（画面に `rounded-md border …` を書かない）。
            // ====================================================================
            // ✅✅ **2026-10-19: 検索エリアを `_search/` の島にまるごと出した**
            //    （人間の改修指示書 `BizOrch_SearchArea_ClaudeCode.md`）
            // ====================================================================
            // 🔴 **指示書が求めるものは、サーバだけでは書けない**:
            //    ・`draftFilters`（編集中）と `appliedFilters`（適用済み）の分離と「未適用」の印
            //    ・バッジが欄幅を超えたときの「＋N」（**実幅の測定**が要る）
            //    ・検索条件の保存・再適用・上書き・削除
            //    ・本文の折りたたみを**再訪時に復元**する
            // 🔴 **一覧（50 行 × 9 列）と案件サマリはサーバのままである** ——
            //    境界は検索エリアのファイル群に閉じている。
            // 🔴 **検索の経路は 1 文字も変わっていない**（素の `<form method="get" action="/projects">`）。
            <SearchPanel
              applied={applied}
              options={searchOptions}
              passThroughParams={passThroughParams}
              storageTenantId={storageTenantId}
              storageUserId={storageUserId}
              defaultExpanded={defaultExpanded}
              messages={searchMessages}
            />
          }
        />
        </div>
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

          <Card className="overflow-hidden" data-testid="project-list-table-card">
          <DataTable
            containerClassName="rounded-none border-x-0"
            className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border-row [&_td]:py-3 [&_thead]:bg-bg"
            testIdPrefix="project-list-"
            // 🔴 ✅ 2026-10-03: **9 列の表は 1280px の器に収まらない**（実測: 内容 1,313px）。
            //    §7.1 は「列を削らないことが先」なので列は減らさず、**切れ目を示して語で伝える**。
            //    器の側の印（`overflow-indicator-x`）は `Table` が常に持つ（CSS で、
            //    スクロールできるときにだけ出る）。
            overflowNote={messages.overflowNote}
            columns={projectColumns(messages, selectHrefOf, messages.partnerScopeNotice === null, canRegister)}
            rows={rows}
            rowKey={(row) => row.id}
            linkComponent={Link}
            // 🔴 利用者が外した列（`hideable` を持つ列だけが対象。`priority` とは別の仕組み）。
            //    値の出所は URL であり、既定（`?hide=` 無し）では**9 列すべてが出る**。
            hiddenColumnIds={hiddenColumnIds}
            // 🔴 副カラムで開いている行の印（`data-selected`）。**選択（一括操作）ではない**ので
            //    `selection`（チェックボックス）は渡さない —— Phase 1 に一括操作は 1 つも無い。
            rowAttributes={(row) => ({
              'data-selected': row.id === selectedId ? 'true' : undefined,
              'data-state': row.id === selectedId ? 'selected' : undefined,
            })}
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

          <ProjectPagination model={pagination} />
          </Card>
        </div>
        {summaryPanel === undefined ? null : (
          <aside className={cn(PAGE_BODY_ASIDE_WIDTH_CLASSES, DETAIL_PANE_VIEWPORT_CLASSES, 'bg-bg-subtle')}>{summaryPanel}</aside>
        )}
    </div>
  );
}
