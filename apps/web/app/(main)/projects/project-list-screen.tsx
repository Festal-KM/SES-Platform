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
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  DISCLOSURE_SUMMARY_CLASSES,
  EmptyState,
  FOCUS_RING_CLASSES,
  Field,
  Icon,
  Input,
  // ✅✅ 2026-10-16: 複数選択をポップアップで選び、選んだものをバッジで見せるための 3 定数
  //    （人間の明示指示。見た目の決定は `@ses/ui` に 1 つだけ置く）。
  MULTI_SELECT_OPTION_CLASSES,
  MULTI_SELECT_PANEL_CLASSES,
  MULTI_SELECT_TRIGGER_CLASSES,
  Pagination,
  SECONDARY_BUTTON_LINK_CLASSES,
  Select,
  StatusBadge,
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
// ✅ 2026-10-16: `ColumnToggle` の描画はやめた（人間の明示指示）。型だけ残る ——
//    `columnToggleItems` の prop そのものは `page.tsx` が組み立てており、`?hide=` の
//    query を受け取れる状態は保っている（共有された URL を壊さない）。
import type { ColumnToggleItem } from '../../_components/column-toggle';
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
  /**
   * ⚠️ **2026-10-16: 検索パネルから外した 4 つ**（案件区分 / 勤務地 / 開始時期 / 並行可否）と
   *    「募集中のみ」の値は、**型には残してある** —— query は従来どおり受け取り、
   *    **共有済みの URL が別の結果を出さない**ようにしている（描く欄が無いだけである）。
   *    🔴 消すと `(list)/page.tsx` が「復元すべき値」を組めなくなり、戻すときに作り直しになる。
   */
  readonly startFrom: string;
  readonly prefecture: string;
  /** ✅ 2026-10-15: 単価レンジ（月額・円）。人材一覧（`S-005`）と**同じ名前・同じ単位**である。 */
  readonly priceMin: string;
  readonly priceMax: string;
  /** ✅ 2026-10-16: 稼働形態（`RemoteMode` の 3 値。空文字 = すべて）。 */
  readonly remoteMode: string;
  /** ✅ 2026-10-16（受領モック + Issue #113）: カテゴリ / 案件区分 / 並行可否 / 開始時期。 */
  readonly category: string;
  readonly sourceKind: string;
  /** `'1'`（可） / `'0'`（不可） / 空文字（すべて）。 */
  readonly parallelOk: string;
  readonly startWithin: string;
  /** ✅ 2026-10-16: 「募集中のみ」。`'1'` のときだけチェック済みで描く。 */
  readonly recruitingOnly: string;
  /**
   * ✅✅ **2026-10-16: スキル（複数選択 / OR）**（人間の明示指示の 6 項目目）。
   *
   * 🔴 **これだけが配列である** —— `<select multiple>` の選択状態は複数の値であり、
   *    1 つの文字列には畳めない（畳むと「選び直したときに前の選択が残る」形になる）。
   * 🔴 **値は辞書（`Skill`）の ID** であり、`skillOptions` の `value` と同じ集合である。
   */
  readonly skills: readonly string[];
};

export type ProjectListScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  /** ✅ 2026-10-03: 表が器に収まらない幅での 1 行（`Table` の `overflowNote`）。 */
  readonly overflowNote: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchStatus: string;
  readonly searchPriceMin: string;
  readonly searchPriceMax: string;
  /** ✅ 2026-10-15: 受領画像の検索欄のプレースホルダ。 */
  readonly searchQPlaceholder: string;
  /** ✅ 2026-10-15: 単価レンジの**塊**のラベル（`単価（月額）`）。 */
  readonly searchPrice: string;
  readonly searchPriceMinPlaceholder: string;
  readonly searchPriceMaxPlaceholder: string;
  /** 下限と上限の間の記号（`〜`）。🔴 画面で文字を組まない（`CLAUDE.md` §3.5）。 */
  readonly searchPriceRangeSeparator: string;
  /** 単価の単位（**円**。画像の `万円` にしていない理由は本体の 🔴）。 */
  readonly searchPriceUnit: string;
  /** ✅ 2026-10-16: 稼働形態 / 単価の逆転エラー（人間の明示指示）。 */
  readonly searchRemoteMode: string;
  readonly searchCategory: string;
  /**
   * ✅✅ **2026-10-16: スキル（複数選択 / OR）**（人間の明示指示の 6 項目目）。
   * 🔴 `searchSkillHint` は**操作の仕方と OR であること**を書く 1 行である
   *    （`<select multiple>` は見た目からどちらも分からない）。
   */
  readonly searchSkill: string;
  /** 1 つも選んでいないときの引き金の語（空の引き金を置かない）。 */
  readonly searchSkillAll: string;
  readonly searchSkillHint: string;
  readonly searchSkillEmpty: string;
  readonly searchPriceInverted: string;
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
  /**
   * ✅✅ **2026-10-16: 行を開く URL**（人間の明示指示「列をクリックしたら右側エリアに
   * 表示されるようにする」）。🔴 **`showVisibilityColumn` と入れ替わった** ——
   * 公開先の列が無くなり、代わりに行全体の遷移先が要るようになった。
   */
  selectHrefOf: (projectId: string) => string,
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
      cell: (row) => <StatusBadge entity="project" state={row.statusState} label={row.status} />,
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
  rows,
  filters,
  statusOptions,
  remoteModeOptions,
  categoryOptions,
  skillOptions,
  priceInverted,
  canRegister,
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
  /**
   * ✅ **2026-10-16（人間の明示指示「稼働形態」）。**
   * 🔴 **選択肢の出所は `@ses/db` の `REMOTE_MODES`（3 値）である**（ページが語を解決して渡す）。
   *    指示は 4 値だったが、列の値集合は 3 値であり、4 値に割るのは DB の値集合の変更
   *    （[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）。
   *    **画面に無い選択肢を作らない**ほうを採った。
   */
  readonly remoteModeOptions: readonly ProjectFilterOption[];
  /**
   * ✅ **2026-10-16（受領モックの絞り込み）: カテゴリ。**
   * 🔴 **値の出所は `@ses/db` の値集合である**（カテゴリ 7 値）。ページが語を解決して渡す。
   * ⚠️ **案件区分 / 並行可否 / 開始時期 / 勤務地の 4 つは props ごと外した**（人間の明示指示の
   *    6 項目に無い）。🔴 **query と述語は残してある**ので、共有済みの URL は従来どおり効く
   *    —— **受け取って使わない props を残さない**（呼び手が「渡せば効く」と誤解する）。
   */
  readonly categoryOptions: readonly ProjectFilterOption[];
  /**
   * ✅✅ **2026-10-16: スキル（複数選択 / OR）**（人間の明示指示「スキル（リストから
   *    複数選択できる、or 検索）」）。
   *
   * 🔴 **「すべて」の選択肢を含まない** —— `<select multiple>` では**何も選んでいない状態が
   *    「すべて」**である（`projectSkillFilterOptions` の 🔴）。
   * 🔴 **語は辞書の `name` であり `packages/i18n` に無い**（辞書はデータであって文言ではない）。
   * 🔴 **空配列のときは `<select>` を描かず、その旨を 1 行で書く**（選択肢の無い選択欄を
   *    黙って置かない）。
   */
  readonly skillOptions: readonly ProjectFilterOption[];
  /**
   * ✅ **2026-10-16: 単価の下限 > 上限**（人間の明示指示）。`true` のとき、単価の欄に
   * エラーを出し、**表の領域は検索を実行していないことを示す空状態**にする（`page.tsx` が
   * 問い合わせ自体を行わない）。判定は `@ses/db` の `isUnitPriceRangeInverted` の 1 本である。
   */
  readonly priceInverted: boolean;
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
  // ✅✅ 2026-10-16: 選ばれているスキル（バッジで見せる分）。
  // 🔴 **並びは選択肢の順（辞書の `sortKey`）である** —— URL に並んだ順にすると、
  //    同じ条件でもバッジの並びが変わる（`PROJECT_LIST_ORDER_BY` と同じ「決定的に」の規律）。
  // 🔴 **選択肢に無い ID は描かない**（URL 直打ちで未知の ID を指されても、バッジが増えない）。
  const selectedSkills = skillOptions.filter((option) => filters.skills.includes(option.value));
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
            <Card className="w-full">
              {/* `CardContent` は `p-4 pt-0`。見出しを持たないカードなので上の余白を戻す
                  （`cn()` = `tailwind-merge` が `pt-0` を落とす）。 */}
              {/* ✅✅ **2026-10-16（人間の明示指示「検索エリアはアコーディオンにして閉じることも
                  できるようにして（案件リストを大きく見れるようにしたいときに使う）」）。**
                  🔴 **`<details>` / `<summary>` の素の HTML で作る** —— この画面は
                     `'use client'` を 1 つも宣言しておらず（サーバで描く）、**開閉のために
                     JS を持ち込まない**。水和の前から開閉でき、キーボードでも操作できる。
                  🔴 **既定は開いている**（`open`）—— 条件が見えない状態で開くと、
                     いま何で絞られているのかが分からない。
                  ⚠️ **開閉の状態は保存していない**（URL にもセッションにも持たない）。
                     保存するなら query か保存済み条件の機能に載せる話であり、
                     「閉じられる」という指示の範囲を越える。 */}
              <CardContent className="pt-0 pb-3">
                <details open className="group">
                  {/* 🔴 **見出しそのものが開閉の当たり判定である**（別にボタンを置かない）。
                      🔴 **太字にしない**（人間の明示指示「ボールドが多すぎる」）。 */}
                  <summary className={cn(DISCLOSURE_SUMMARY_CLASSES, FOCUS_RING_CLASSES)}>
                    <Icon
                      name="search"
                      className="shrink-0 text-fg-muted transition-transform group-open:rotate-0"
                    />
                    {messages.searchLegend}
                  </summary>
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
                  // ✅ 2026-10-16（人間の明示指示「エリア自体の縦幅を小さくしたい」）:
                  //    行間を `gap-4`（16px）→ `gap-x-4 gap-y-3`（縦 12px）に詰める。
                  //    🔴 **横の間隔は詰めない**（4 列が窮屈になると読み違えが増える）。
                  className={cn(FILTER_FORM_CLASSES, 'mb-0 w-full gap-y-3')}
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
                    {/* ✅ **2026-10-15（2 回目。人間の指示「この画像ファイルをよく確認して、検索
                        フィルター部分を修正してください」）: 虫眼鏡 + プレースホルダ**（受領画像の
                        1 行目「案件名・企業名・キーワードで検索」）。
                        🔴 **プレースホルダに「企業名」と書かない** —— `#25` の `q` が見るのは
                           案件名と外部公開用の記載であり、**できないことを書くと嘘になる**
                           （同じカードの中で「スキル要件・リモート可否は後続」と断っているのと
                           同じ規律）。
                        🔴 **ラベルは消さない。** 画像にはラベルが無いが、読み上げで欄の用途が
                           消える（`CLAUDE.md` §13.3 の「劣化はさせても遮断しない」と同じ判断）。
                           語だけ短くして、詳しい説明はプレースホルダに移した。
                        ⚠️ `pl-8` は左の虫眼鏡（`left-3` + 16px）を避けるための内側の余白であり、
                           §7.9 の 7 段の中の値である（`ui-spacing-scale` の許容段）。 */}
                    {/* ✅✅ **2026-10-16（人間の明示指示「これちゃんと参考にして、検索部分
                        修正してよ」+ 受領モック）: 1 行目を全幅にした。** モックのキーワード欄は
                        帯の幅いっぱいで、2 行目から 4 列の選択肢が始まる。
                        🔴 **`col-span-full` にする**（`sm:col-span-2` は 4 列のうち 2 列だった）。 */}
                    {/* 🔴 **ラベルは読み上げのために残す**（モックには文字が無いが、消すと欄の
                        用途がスクリーンリーダから失われる）。**見た目だけ隠す**ので、
                        画面はモックと同じ「虫眼鏡 + プレースホルダだけ」になる
                        （`CLAUDE.md` §13.3「劣化はさせても遮断しない」と同じ判断）。 */}
                    <Field className="col-span-full" label={messages.searchQ} labelClassName="sr-only">
                      <div className="relative">
                        <Icon
                          name="search"
                          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
                        />
                        <Input
                          type="search"
                          name="q"
                          className="pl-8"
                          placeholder={messages.searchQPlaceholder}
                          defaultValue={filters.q}
                          data-testid="project-list-filter-q"
                        />
                      </div>
                    </Field>
                    {/* ========================================================================
                        ✅✅ **2026-10-16: 受領モックの並びに作り直した**
                        （人間の明示指示「これちゃんと参考にして、検索部分修正してよ」。
                         一次資料 `デザインモック/自社案件管理_案件一覧.png`）
                        ========================================================================
                        モックの 2 行目 = ステータス / 案件区分 / カテゴリ / 稼働形態
                        モックの 3 行目 = 単価（月額）/ 勤務地 / 開始時期 / 並行可否
                        🔴 **カテゴリ / 案件区分 / 並行可否は列ごと足した**
                           （[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)
                            「設計から改訂して」が承認である。migration 20261016030000）。
                           **押しても絞れない選択肢を先に並べない**という規律は守っている ——
                           足したのは「実際に絞れる条件」だけである。 */}
                    <Field label={messages.searchStatus}>
                      <Select name="status" defaultValue={filters.status} data-testid="project-list-filter-status">
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* ⚠️ **2026-10-16: `案件区分` の欄を外した**（人間の明示指示の 6 項目に無い）。
                        🔴 **query（`sourceKind`）と述語は残してある** —— 共有済みの URL が
                           別の結果を出すようにしない（`recruitingOnly` と同じ判断）。 */}
                    <Field label={messages.searchCategory}>
                      <Select
                        name="category"
                        defaultValue={filters.category}
                        data-testid="project-list-filter-category"
                      >
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* ========================================================================
                        ✅✅ **2026-10-16: スキル（複数選択 / OR）**
                        （人間の明示指示「スキル（リストから複数選択できる、or 検索）」）
                        ========================================================================
                        🔴 **`<select multiple>` の素の HTML で作る** —— この画面は
                           `'use client'` を 1 つも宣言しておらず（サーバで描く）、**複数選択の
                           ために JS を持ち込まない**。水和の前から選べ、キーボードでも操作できる。
                           ⚠️ タグ入力（チップが並ぶ形）にはクライアントの島が要る。
                        🔴 **「すべて」の選択肢を置かない** —— **何も選んでいない状態が「すべて」**
                           である。番兵を置くと「すべて」を選んだまま 1 つ足した状態が作れる。
                        🔴 **`size` を 3 にする** —— 人間の明示指示「エリア自体の縦幅を小さくしたい」
                           に反しない高さにする（既定の `size` は 4 で、`multiple` だと器が
                           さらに伸びる）。スクロールで残りが見える。
                        🔴 **選択肢が 0 件なら `<select>` を描かない**（押しても何も選べない欄を
                           置かない。`columnToggleItems` が空のとき切替を描かないのと同じ規律）。
                        🔴 **語は辞書の `name`** であり `packages/i18n` に無い（辞書はデータである）。 */}
                    <Field as="div" label={messages.searchSkill}>
                      {skillOptions.length === 0 ? (
                        <p
                          className="m-0 text-body text-fg-muted"
                          data-testid="project-list-filter-skills-empty"
                        >
                          {messages.searchSkillEmpty}
                        </p>
                      ) : (
                        // 🔴 `relative` はポップアップ（`absolute`）の基準点である（§7.9 の
                        //    段から外れる値ではなく、重なりの基準を作るだけの 1 語）。
                        <details className="group/skills relative">
                          <summary
                            className={cn(MULTI_SELECT_TRIGGER_CLASSES, FOCUS_RING_CLASSES)}
                            data-testid="project-list-filter-skills"
                          >
                            {/* 🔴 **選んだものはバッジで見せる**（人間の明示指示
                                「表示させるのはバッチ風の表示にするのがいい」）。
                                🔴 1 つも選んでいないときは「すべて」と書く —— 空の引き金は
                                   「壊れている」と「何も選んでいない」の区別が付かない。 */}
                            {selectedSkills.length === 0 ? (
                              <span className="text-fg-placeholder">{messages.searchSkillAll}</span>
                            ) : (
                              selectedSkills.map((option) => (
                                // 🔴 色は意味を持たない（選んだ事実を示すだけ）。状態の色
                                //    （`StatusBadge`）と取り違えないよう `neutral` に固定する。
                                <Badge key={option.value} variant="neutral">
                                  {option.label}
                                </Badge>
                              ))
                            )}
                            {/* 🔴 印であって意味ではない（開閉は `<details>` が持つ）。 */}
                            <Icon
                              name="chevron-down"
                              className="ml-auto shrink-0 text-fg-muted transition-transform group-open/skills:rotate-180"
                            />
                          </summary>
                          {/* 🔴 **ポップアップは重ねる**（`absolute`）—— 開いても帯の高さが
                              変わらないので、選んでいる間に下の条件や表が動かない。
                              🔴 **中身はチェックボックスである** —— 同じ `name` の
                                 チェックボックスは選んだぶんだけ `skills=A&skills=B` を送る
                                 （`<select multiple>` と**まったく同じ形**で届くので、
                                 query も述語も 1 文字も変えていない）。
                              🔴 **クライアントの島を持ち込んでいない**（水和の前から選べる）。 */}
                          <div
                            className={MULTI_SELECT_PANEL_CLASSES}
                            data-testid="project-list-filter-skills-panel"
                          >
                            {skillOptions.map((option) => (
                              <label key={option.value} className={MULTI_SELECT_OPTION_CLASSES}>
                                <Checkbox
                                  name="skills"
                                  value={option.value}
                                  defaultChecked={filters.skills.includes(option.value)}
                                />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </details>
                      )}
                    </Field>
                    {/* 🔴 **一覧の `稼働形態` 列と同じ語を使う**（`columnRemoteMode` と同じ
                        `projects.remoteMode.*`）—— 絞り込みと列で語が違うと、選んだ値がどの列に
                        効いたのか分からない。
                        ⚠️ モックの選択肢は 4 つ（フルリモート / リモート中心 / ハイブリッド / 常駐）
                        だが、列の値集合は 3 値である。4 値に割るのは `engineers.remote_mode` と
                        共有している値集合の変更であり、人材側の画面・検索・Badge に同時に波及する
                        （[Issue #113] の続きとして別に行う）。 */}
                    <Field label={messages.searchRemoteMode}>
                      <Select
                        name="remoteMode"
                        defaultValue={filters.remoteMode}
                        data-testid="project-list-filter-remote-mode"
                      >
                        {remoteModeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* ✅ **2026-10-15: 単価レンジ**（定義書 §1.6 の Filter Panel の 1 行。人間の
                        指示「自社案件管理ページはこれを参照してアップデートして」）。
                        🔴 **述語（レンジの重なり）は `packages/db/src/search/unit-price-range.ts` の
                           1 本**である（人材検索と共有。T-06-03 の申し送りの決着）。
                        ✅ **2026-10-15（2 回目）: 受領画像どおり「`単価（月額）` ＋ 下限 ＋ 〜 ＋ 上限
                           ＋ 単位」の 1 つの欄に組み直した**（旧: `単価（下限）` / `単価（上限）` の
                           2 ラベル）。🔴 **`name` も `step` も値の単位も変えていない** ——
                           送るのは従来どおり `priceMin` / `priceMax`（**円**）である。
                        🔴 **単位は「円」である（画像の「万円」にしていない）。** 入力を万円にすると
                           送信値も万円になり、`#25` の query（円）と `S-005` 人材一覧の同名の条件と
                           食い違う。**画面だけで単位を変えられない**ので、万円にするなら
                           query の仕様から直す（[Issue #115](https://github.com/Festal-KM/SES-Platform/issues/115)）。
                        ⚠️ 人材一覧（`S-005`）はまだ 2 ラベルの形である（人間の指示が
                           「案件管理から修正していきましょう」であり、順に直す）。 */}
                    {/* ✅ **2026-10-16（人間の明示指示「下限 > 上限 の場合はバリデーション
                        エラーを表示し検索を実行しない」）。**
                        🔴 **判定は `@ses/db` の `isUnitPriceRangeInverted` の 1 本**である
                           （述語〔重なり〕と同じファイルに置いた。人材一覧も同じ関数を使える）。
                        🔴 **検索そのものを実行していない**のはページ側である（`page.tsx`）——
                           逆転したレンジは重なりが空で、述語としては素通りして 0 件になる。
                           0 件は「条件に合う案件が無い」と**見分けが付かない**ので、
                           入力の誤りとしてその場で言う（`docs/04` §S-010）。 */}
                    {/* ✅✅ **2026-10-16: 2 列ぶん → 1 列にした**（受領モックの 3 行目は
                        `単価 / 勤務地 / 開始時期 / 並行可否` の 4 つが 1 行に収まっている）。
                        🔴 **中身は変えていない**（下限 / 〜 / 上限 / 単位の 4 つ）。欄が狭くなるが、
                           入るのは 6〜7 桁の数値であり、モックの欄も同じ幅である。 */}
                    <Field
                      as="div"
                      label={messages.searchPrice}
                      error={priceInverted ? messages.searchPriceInverted : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          name="priceMin"
                          min={0}
                          step={10000}
                          placeholder={messages.searchPriceMinPlaceholder}
                          defaultValue={filters.priceMin}
                          // 🔴 欄ごとの読み上げの語（ラベルは塊に 1 つしか無い）。
                          aria-label={messages.searchPriceMin}
                          data-testid="project-list-filter-price-min"
                        />
                        <span aria-hidden="true" className="shrink-0 text-body text-fg-muted">
                          {messages.searchPriceRangeSeparator}
                        </span>
                        <Input
                          type="number"
                          name="priceMax"
                          min={0}
                          step={10000}
                          placeholder={messages.searchPriceMaxPlaceholder}
                          defaultValue={filters.priceMax}
                          aria-label={messages.searchPriceMax}
                          data-testid="project-list-filter-price-max"
                        />
                        <span className="shrink-0 text-body text-fg-muted">
                          {messages.searchPriceUnit}
                        </span>
                      </div>
                    </Field>
                    {/* ⚠️ **2026-10-16: `勤務地` の欄を外した**（人間の明示指示の 6 項目に無い）。
                        🔴 **query（`prefecture`）と述語、一覧の `勤務地` 列はそのまま**である。 */}
                    {/* ⚠️ **2026-10-16: `開始時期` と `並行可否` の欄を外した**（人間の明示指示の
                        6 項目に無い）。🔴 **query（`startWithin` / `parallelOk` / 旧 `startFrom`）と
                           述語、一覧の `開始日` 列はそのまま**である ——
                           **共有済みの URL が別の結果を出すようにしない。** */}
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
                        {/* ✅✅ **2026-10-16: 「募集中のみ」のチェックボックスを外した**
                            （人間の明示指示「募集中のみのチェックボックスと表示する列ボタンは無くす」）。
                            🔴 **`recruitingOnly` の query と述語は残してある** —— URL を共有した人が
                               居る可能性があり、受け取れなくなると「共有したリンクが別の結果を出す」
                               になる。画面から外しただけであり、`ステータス = 募集中` で同じ絞り込みができる。 */}
                        {/* ✅✅ **2026-10-16: 「スキル要件での絞り込みは後続のリリースで行えます」を
                            外した**（人間の明示指示でスキルの絞り込みを**実装した**ため）。
                            🔴 **できるようになったものを「できない」と書き続けると画面が嘘をつく**
                               （同じ日に「リモート可否」を外したのと同じ理由）。
                            🔴 **代わりに置いたのはスキル欄の操作説明である** —— `<select multiple>` は
                               「複数選べる」ことも「OR である」ことも見た目から分からず、
                               書かないと、選んだのに 0 件になった利用者が不具合と区別できない。
                            ⚠️ 凍結済み testid（`project-list-search-coming-soon`）は
                               `tests/static/support/testid-baseline.ts` から理由つきで外した。 */}
                        <p className="text-xs text-fg-muted" data-testid="project-list-search-skill-hint">
                          {messages.searchSkillHint}
                        </p>
                        {/* ✅✅ **2026-10-16: 「表示する列」のボタンを外した**（人間の明示指示）。
                            🔴 **既定で隠している列が 1 つも無くなった**ので、戻す入口も要らない
                               （`PROJECT_DEFAULT_HIDDEN_COLUMN_IDS` は空である）。
                            🔴 **`?hide=` の query は受け取れるまま残す**（共有された URL を壊さない）。
                            ⚠️ **この画面はこれで `'use client'` の島を 1 つも持たなくなった**
                               （`ColumnToggle` が唯一の境界だった）。 */}
                      </div>
                      <div className="flex items-center gap-4">
                        {/* ✅ **2026-10-15: 文字リンク → 輪郭ボタン**（受領画像のフッタは
                            `条件をクリア`（白地 + 枠）と `検索`（primary）の 2 つのボタンである）。
                            🔴 **`Button` では描けない**（遷移なのでリンクである）。面と hover を
                               画面側で組まず、`@ses/ui` の `SECONDARY_BUTTON_LINK_CLASSES` を使う。
                            🔴 **出す条件は変えていない**（絞り込みが 1 つでも効いているときだけ。
                               押しても何も起きないボタンを常設しない）。 */}
                        {/* ✅✅ **2026-10-16: 常時出すようにした**（受領モックのフッタは
                            `条件をクリア` と `検索` が常に並んでいる）。
                            ⚠️ **以前は「絞り込みが 1 つでも効いているときだけ」だった** ——
                            「押しても何も起きないボタンを常設しない」という規律による。
                            🔴 **その規律を曲げた理由**: 絞り込みの帯が 3 行になり、
                            **どこまでが条件なのかが一目で分からなくなった**。クリアが常に
                            同じ位置に在ることのほうが、空振りの 1 クリックより価値が高い
                            （押した結果は「条件なしの一覧」であり、壊れる操作ではない）。 */}
                        <Link
                          className={SECONDARY_BUTTON_LINK_CLASSES}
                          href="/projects"
                          data-testid="project-list-clear"
                        >
                          {messages.searchClear}
                        </Link>
                        <Button type="submit" data-testid="project-list-search">
                          {messages.searchSubmit}
                        </Button>
                      </div>
                    </div>
                  </fieldset>
                </form>
                </details>
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
        columns={projectColumns(messages, selectHrefOf)}
        rows={rows}
        rowKey={(row) => row.id}
        linkComponent={Link}
        // 🔴 利用者が外した列（`hideable` を持つ列だけが対象。`priority` とは別の仕組み）。
        //    値の出所は URL であり、既定（`?hide=` 無し）では**9 列すべてが出る**。
        hiddenColumnIds={hiddenColumnIds}
        // 🔴 副カラムで開いている行の印（`data-selected`）。**選択（一括操作）ではない**ので
        //    `selection`（チェックボックス）は渡さない —— Phase 1 に一括操作は 1 つも無い。
        rowAttributes={(row) => ({ 'data-selected': row.id === selectedId ? 'true' : undefined })}
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
