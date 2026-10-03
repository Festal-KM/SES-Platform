// apps/web/app/(main)/engineers/engineer-ledger-screen.tsx
// `S-005` エンジニア台帳（一覧）— 本体（docs/04 §S-005 / `F-009` / docs/05 §6.4 #15）。
// T-05-09 → T-06-04（検索条件）→ **SP-22 `T-22-06`（一覧の適用 ①）** → **SP-22 段④（ワイヤー
// フレームへの刷新。人間の「SES Hub社内外向け人材管理ダッシュボード.png」左＝社内用）**。
//
// ============================================================================
// 🔴 SP-22 段④ で何が変わったか（**見せ方だけ**。`S-010` と同じ作法に揃えた）
// ============================================================================
// | 変えたもの | 一次資料 | 🔴 変えていないもの |
// |---|---|---|
// | 絞り込みを **`Card`（白い面）**に入れた（ページ地は `--color-bg-subtle`） | §7.9 / `S-010` の判断 | 🔴 **条件の集合・`name`・送り先・`method="get"`** |
// | 並び順の説明を **件数バーの右端**（`Toolbar` の `note`）へ | ワイヤーフレーム「件数バー」/ §5-13 | 🔴 **選べる形にしない**（`?sort=` は `#15` に無い） |
// | 登録の導線を **帯の primary** へ（`engineerListPrimaryAction`） | §S-005 / §7.6 / §3.1 | 🔴 **testid `engineer-list-register`** / `VIEWER` には描かない |
// | 「できないこと」の 2 行を絞り込みカードの中へ | — | 🔴 **文言と testid**（`…-search-coming-soon` / `…-experience-coming-soon`） |
//
// 🔴 **API / 取得経路 / 権限判定 / URL / 列の集合・並び・間引きの境界は 1 つも変えていない。**
// 🔴 **ワイヤーフレーム（左＝社内用）から意図して落としたもの**:
//    - タブ `候補者一覧` / `タレントプール` / `対応履歴` / `スキル分析` —— 🔴 **`候補者一覧` /
//      `共有の設定` は外枠（`SectionNav`。`docs/04` §7.8 改訂 24）が既に出している。**残り 3 つは
//      画面も API も存在しない**（中身の無いタブを置かない。§10.3「増えるならフィルタかセクション」）。
//    - 列 `性別` / `年齢` / `カテゴリ` / `PR ポイント` / `最寄` / `並行状況` —— **DB にも `#15` の
//      射影にも無い**（`性別` / `年齢` は `BR-52` が収集しないと定めた項目であり、足すのは人間の承認事項）。
//    - 件数バーの `表示項目`（列表示切替）—— 🔴 **`hideable` を持つ列が 1 つも無い**（9 列目は未実装。
//      下の 🔴）。切替だけ置いても外せる列が無い。
//    - 件数バーの `エクスポート` —— **エンジニアの書き出し API が存在しない**（`/api/data-exports` は
//      `S-042` の解約時のテナント返却であって台帳の CSV ではない）。
//    - 行のチェックボックス —— 🔴 **Phase 1 に一括操作が 1 つも無い**（`selection` を渡す画面 0 件）。
//    - 操作列 —— 行の名称セルが `S-006` への導線であり、`S-005` はクラス A（副カラムを持たない。
//      §7.1 の表）。**同じ行き先の導線を 2 本置かない**。
//
// ============================================================================
// 🔴 `T-22-06` で何が変わったか（**見せ方だけ**。`SP-22` §3.1）
// ============================================================================
// | 変えたもの | 一次資料 | 変えていないもの |
// |---|---|---|
// | ローカルの `<Table>` → **`@ses/ui` の `DataTable`**（列の優先度・sticky ヘッダ・空状態の器） | `docs/04` §5-13 / `docs/05` §2.3.5 | 🔴 **列の集合・並び・表示項目**（下の表。`engineer-ledger-screen.render.test.tsx` の「列の契約」が固定する） |
// | 母集団の 1 行と検索の帯 → **`Toolbar`** | §5-13 / §3.2-2 | 🔴 母集団の文言と件数の出所（`view.total`） |
// | ページ送り → **`Pagination`**（カーソル方式） | §5-13 / §7.1 | 🔴 `nextPageHref` / `firstPageHref` の組み立て（`engineerListHref`） |
// | 空状態 → **`EmptyState`** | §10.1 / §10.4 | 🔴 初回空と絞込 0 で**文言も導線も別**（選び分けは `list-props.ts`） |
// | 幅 → 画面の `max-w-*` を撤去し `PageBody widthClass="full"`（`(list)/page.tsx`） | §7.1 / `U-23` | — |
// | 色・文字サイズ → §7.9 の semantic トークン / 6 トークン | §7.9 | — |
//
// 🔴 **列を 1 つも増減させていない**（`T-22-06` 受け入れ基準 2）。ブレークポイントごとの見え方も
//    同じであり、**`hidden lg:table-cell` の直書きを列定義の `priority` に移しただけ**である
//    （§10.3 の `S-005` の行が一次資料。`tests/static/datatable-column-contract.test.ts` (m)④）:
//
//   | # | 列 | `priority` | §10.3 / §S-005 デバイス別 |
//   |---|---|---|---|
//   | 1 | 氏名 | `always` | モバイル 3 列に残る（`NameCell` に委譲。`U-16`） |
//   | 2 | 所属区分 | `lg` | 「`lg` 未満で 所属区分・勤務地・更新日」。🔴 取引先には**列そのものを描かない** |
//   | 3 | 主要スキル | `always` | モバイル 3 列に残る（上位 3 + `+N` はどの幅でも同じ） |
//   | 4 | 単価レンジ | `sm` | 「`sm` 未満で 単価レンジ・稼働状況」 |
//   | 5 | 稼働可能時期 | `always` | モバイル 3 列に残る（「いつ空くか」が候補探索の軸） |
//   | 6 | 勤務地・リモート | `lg` | 同上 |
//   | 7 | 稼働状況 | `sm` | 同上 |
//   | 8 | 更新日 | `lg` | 同上 |
//
// 🔴 **`hideable` を持つ列が 1 つも無い**（9 列目〔希望条件・登録日・担当〕は未実装であり、
//    **列表示切替は後続のリリース**である旨を画面に書いている = `searchComingSoon`）。
//    切替の部品（`DataTableColumnToggle`）はハンドラを要求する = クライアント部品なので、
//    **この画面に `'use client'` を持ち込まないためにも置かない**（受け入れ基準: `'use client'` を増やさない）。
// 🔴 **`selection` を渡さない**（Phase 1 に一括操作は 1 つも無い。`docs/05` §6.11.4 / 検査 (m)③）。
// 🔴 **`sortKey` を渡さない** —— 並びはサーバが `updated_at` 降順 → `id` 降順で確定させており
//    （`docs/05` §6.4「#15 の実装の決着」）、**既存 API の決定的順序を変えない**のがこのタスクの制約である。
//    列ヘッダに並び替えリンクを付けると `?sort=` を受ける API が要る（= 機能の追加）。
//
// 🔴 **スコア・順位・重みに相当する表示項目を持たない**（`F-009 AC-2`。Phase 1）。
//    並び順の説明は 1 行で常時出す（docs/04 §S-005）。**重み設定を置かない**（`F-030 AC-4`）。
// 🔴 **絞り込みチェックボックス 2 種は既定オフ**（`F-009 AC-5` / `docs/02` A-03）。
//    `defaultChecked` は query の値をそのまま反映し、**画面側で既定を作らない**。
// 🔴 検索は**同期**（docs/04 §S-005）。素の `<form method="get">` で送るので、クライアント
//    JavaScript を 1 バイトも要求しない（`'use client'` を宣言しない）。実行した検索がそのまま URL に
//    なり、共有・再読込・戻るのいずれでも同じ結果に戻る。
// 🔴 **検索条件はモバイルでも全項目を提供する**（省略しない）。間引くのは結果テーブルの列だけである。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// ⚠️ 自画面へのパス（`/engineers` / `/engineers/new` / `/engineers/{id}`）はリテラルで書く
//    （`ProjectListScreen` と同じ）。`lib/engineers/list-rows.ts` の `ENGINEER_LIST_PATH` を
//    import すると `@ses/i18n` / `@ses/config` が `*.render.test.tsx` の依存に入り、
//    「文言が無い状態の描画」を試せなくなる。**検索条件つきのリンク（ページング・条件の解除）は
//    props で受け取る** —— 組み立てはテストできる場所（`engineerListHref`）に置く。
import Link from 'next/link';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  Pagination,
  SECONDARY_LINK_CLASSES,
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
import { SkillBadges } from '../_shared/skill-badges';
import type {
  EngineerActiveFilterView,
  EngineerListRowView,
} from '../../../lib/engineers/list-rows';

/** 検索条件の選択肢 1 件（`value` は API の query に載る値そのもの）。 */
export type EngineerFilterOption = {
  readonly value: string;
  readonly label: string;
};

/** フォームに戻す現在の検索条件（未指定は空文字 / チェックボックスは真偽）。 */
export type EngineerListFilterValues = {
  readonly q: string;
  readonly skills: readonly string[];
  readonly skillMode: string;
  readonly yearsMin: string;
  readonly priceMin: string;
  readonly priceMax: string;
  readonly availableBy: string;
  readonly prefecture: string;
  readonly remote: string;
  readonly availability: string;
  readonly onlyInTime: boolean;
  readonly onlyCommutable: boolean;
};

export type EngineerLedgerScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  readonly searchComingSoon: string;
  readonly experienceComingSoon: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchSkills: string;
  readonly searchSkillsHint: string;
  readonly searchSkillMode: string;
  readonly searchYearsMin: string;
  readonly searchPriceMin: string;
  readonly searchPriceMax: string;
  readonly searchAvailableBy: string;
  readonly searchPrefecture: string;
  readonly searchRemote: string;
  readonly searchAvailability: string;
  readonly searchOnlyInTime: string;
  readonly searchOnlyCommutable: string;
  readonly searchCheckboxNote: string;
  readonly searchSubmit: string;
  readonly searchClear: string;
  readonly activeFiltersTitle: string;
  /** 「スキル: Java **を外す**」の接尾辞。 */
  readonly removeFilterSuffix: string;
  readonly register: string;
  readonly readOnlyNote: string;
  readonly columnName: string;
  readonly columnOwnership: string;
  readonly columnSkills: string;
  readonly columnUnitPrice: string;
  readonly columnAvailableFrom: string;
  readonly columnLocation: string;
  readonly columnAvailability: string;
  readonly columnUpdatedOn: string;
  readonly emptyTitle: string;
  readonly emptyLead: string;
  /** 🔴 絞り込みチェックボックスがオンで 0 件のときだけ（`docs/04` §10.1 `S-005`）。 */
  readonly emptyCheckboxNotice: string | null;
  readonly nextPage: string;
  readonly firstPage: string;
  /** 未設定（`docs/04` §S-006 と同じく、空欄にせず `—` を置く）。 */
  readonly valueNone: string;
};

/**
 * ページ送りのリンク（`@ses/ui` の `Pagination` に `next/link` を渡す）。
 *
 * 🔴 **凍結済み testid の維持**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④「旧キーの併記」）:
 *    `Pagination` は `engineer-list-pagination-prev` / `…-next` を出すが、2026-09-30 に凍結された
 *    値は **`engineer-list-first`（最初のページに戻る）/ `engineer-list-next`（次のページ）**である。
 *    **同じ 2 本のリンクに、同じ意味のまま**付け直している（改名ではない —— 凍結値を DOM に残す）。
 * ⚠️ 三項で書くのは、静的抽出器（`tests/static/support/testid-extract.ts`）が**枝のリテラル**を
 *    拾って凍結を検査できる形にするためである（識別子に逃がすと凍結できない）。
 */
function EngineerPagingLink({ href, className, children, 'data-testid': testId }: PaginationLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId === undefined || testId.endsWith('-prev') ? 'engineer-list-first' : 'engineer-list-next'}
    >
      {children}
    </Link>
  );
}

/**
 * 列定義（🔴 **§10.3 の `S-005` の行をそのまま写す**。ファイル冒頭の表）。
 * 🔴 **画面に `hidden lg:table-cell` を書かない**（検査 (m)④）。落とす順序は `priority` が持つ。
 */
function engineerColumns(
  messages: EngineerLedgerScreenMessages,
  showOwnershipColumn: boolean,
): readonly DataTableColumn<EngineerListRowView>[] {
  return [
    {
      id: 'name',
      header: messages.columnName,
      priority: 'always',
      // 🔴 名称列の下限 10rem はどのブレークポイントでも維持する（`U-16` / `1a1e7f8`）。
      minWidth: '10rem',
      // 🔴 氏名セルは `NameCell` に委譲する（`lg` 以上 = 切り詰め + `title` + 同じ行に `S-006` への
      //    導線 / `lg` 未満 = 折り返し）。**閲覧の監査記録は遷移先が書く**（`BR-27`）。
      nameCell: {
        name: (row) => row.displayName,
        href: (row) => `/engineers/${row.id}`,
      },
    },
    // 🔴 取引先には所属区分の列を出さない（全件が自社であるため意味がない）。**DOM から取り除く**。
    ...(showOwnershipColumn
      ? [
          {
            id: 'ownership',
            header: messages.columnOwnership,
            priority: 'lg',
            minWidth: '5rem',
            cell: (row: EngineerListRowView) => row.ownership,
          } satisfies DataTableColumn<EngineerListRowView>,
        ]
      : []),
    {
      id: 'skills',
      header: messages.columnSkills,
      priority: 'always',
      minWidth: '10rem',
      // 🔴 余りはこの列に配分する（§7.1 の `2xl`「列幅のゆとりに使う」）。
      grow: true,
      whitespace: 'normal',
      // ========================================================================
      // 🔴 ✅ 2026-10-03: **1 行固定**（`S-016` と同じ 1 実装 = `_shared/skill-badges.tsx`）
      // ========================================================================
      // **何が起きていたか（デモ環境の実測。1280px）**: スキル列は約 150px しか無く、
      // バッジ 3 件が 2 段に折り返して **10 行中 4 行だけ行の高さが 70px（他は 42px）** だった。
      // 🔴 `docs/04` §10.3 の共通規約は **「行の高さは揃う（1 万件規模の走査性）」**と定めており、
      //    §7.1 の「50 行を縦に走査する」はその前提である。
      // 🔴 **`S-016` では `T-22-07` で既に 1 段固定に直っていた**（`HANDOFF.md` §6-1）。
      //    同じ写像の消費者がここだけ取り残されていたので、**同じ 1 実装に合流させる**
      //    （`HANDOFF.md` §6-14「1 箇所直したら、同じ写像の他の消費者を grep で全部洗う」）。
      // 🔴 **`+N` の上限（上位 3 件）は変えていない**（`lib/engineers/list-rows.ts`）。
      //    変わったのは「幅が足りないときに**折り返す**」が「**件数を減らして `+N` に載せる**」に
      //    なったことだけで、**到達できなくなる情報は無い**（全件は `S-006` で読める）。
      cell: (row) => (
        <SkillBadges
          skills={row.skills}
          skillCount={row.skillCount}
          valueNone={messages.valueNone}
          // ⚠️ 凍結済みの testid（`U-22`）。合成後の値は移設前と同じである。
          testIdPrefix="engineer-list-"
          rowKey={row.id}
        />
      ),
    },
    {
      id: 'unitPrice',
      header: messages.columnUnitPrice,
      priority: 'sm',
      // 🔴 単価は円単位・3 桁区切り（`650,000〜750,000 円`。§10.3「大きい数値」）。値は `list-rows` が組む。
      minWidth: '10rem',
      cell: (row) => row.unitPrice,
    },
    {
      id: 'availableFrom',
      header: messages.columnAvailableFrom,
      priority: 'always',
      minWidth: '8rem',
      cell: (row) => row.availableFrom,
    },
    {
      id: 'location',
      header: messages.columnLocation,
      priority: 'lg',
      minWidth: '9rem',
      cell: (row) => row.location,
    },
    {
      id: 'availability',
      header: messages.columnAvailability,
      priority: 'sm',
      minWidth: '6rem',
      cell: (row) => row.availability,
    },
    {
      id: 'updatedOn',
      header: messages.columnUpdatedOn,
      priority: 'lg',
      minWidth: '7rem',
      cell: (row) => row.updatedOn,
    },
  ];
}

export function EngineerLedgerScreen({
  rows,
  filters,
  skillOptions,
  skillModeOptions,
  prefectureOptions,
  remoteOptions,
  availabilityOptions,
  activeFilters,
  showOwnershipColumn,
  canRegister,
  nextPageHref,
  firstPageHref,
  messages,
}: {
  readonly rows: readonly EngineerListRowView[];
  readonly filters: EngineerListFilterValues;
  /** スキル辞書（`F-010`。値は `Skill.id`）。 */
  readonly skillOptions: readonly EngineerFilterOption[];
  readonly skillModeOptions: readonly EngineerFilterOption[];
  readonly prefectureOptions: readonly EngineerFilterOption[];
  readonly remoteOptions: readonly EngineerFilterOption[];
  readonly availabilityOptions: readonly EngineerFilterOption[];
  /**
   * 🔴 いま効いている条件（`docs/04` §10.1 `S-005`「効いている条件を列挙して 1 つずつ外せる
   *    導線」）。空配列なら絞り込みが効いていない。
   */
  readonly activeFilters: readonly EngineerActiveFilterView[];
  /**
   * 🔴 取引先には所属区分の列を出さない（docs/04 §S-005 権限差分「全件が自社であるため
   *    意味がない」）。判定の出所は `ctx.partnerCompanyId` であり、行の値ではない。
   */
  readonly showOwnershipColumn: boolean;
  readonly canRegister: boolean;
  /** 次ページ（無ければ `null`）。🔴 検索条件を保った URL である（`engineerListHref`）。 */
  readonly nextPageHref: string | null;
  /** 2 ページ目以降でだけ「最初のページに戻る」を出す（無ければ `null`）。 */
  readonly firstPageHref: string | null;
  readonly messages: EngineerLedgerScreenMessages;
}) {
  return (
    <div data-testid="engineer-ledger-screen">
      {/* 🔴 §5-13 の `Toolbar`: **母集団の 1 行（§3.2-2 の #2）と検索の帯の置き場所をここに固定する。**
          画面ごとに位置が変わると、取引先が「自社分だけか」を毎画面で探すことになる。

          ⚠️ **凍結済み testid の併記**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④）:
             `Toolbar` は母集団の 1 行を `engineer-list-toolbar-population` として描くが、
             2026-09-30 に凍結されている値は **`engineer-list-population`** であり、
             `tests/e2e/settings.mobile.spec.ts` がそれを掴んでいる。**改名は不可**なので、
             母集団の 1 行を含む帯の器にその値を残す（部品の testid は `testIdPrefix` が決め、
             画面から上書きできない）。 */}
      <div data-testid="engineer-list-population">
        <Toolbar
          testIdPrefix="engineer-list-"
          population={messages.populationLabel}
          note={
            /* 🔴 並び順の説明（docs/04 §S-005「並び順の説明を一覧の上部に 1 行で書く」）。
               スコア・順位・重み・一致度の語を含めない（`F-009 AC-2`）。
               🔴 **選べる形にしない** —— `#15` の query に `?sort=` が無い（`HANDOFF.md` §5）。
               ⚠️ 器の `data-testid` は凍結済みの `engineer-list-order-note` である（`U-22`）。 */
            <p className="text-xs text-fg-muted" data-testid="engineer-list-order-note">
              {messages.orderNote}
            </p>
          }
          filters={
            // 🔴 絞り込みは**白い面のカード**に入れる（ページ地は `--color-bg-subtle` なので、
            //    面を持たないと入力欄の群が地に溶ける。`S-010` と同じ判断）。
            //    🔴 面・余白・radius は `Card` の中にしか無い（画面に `rounded-md border …` を書かない）。
            <Card className="w-full">
              {/* `CardContent` は `p-4 pt-0`。見出しを持たないカードなので上の余白を戻す
                  （`cn()` = `tailwind-merge` が `pt-0` を落とす）。 */}
              <CardContent className="pt-4">
                {/* 🔴 検索条件（docs/04 §S-005 セクション 1）。`method="get"` なので、実行した検索が
                    そのまま URL になり、共有・再読込・戻るのいずれでも同じ結果に戻る。
                    ⚠️ `mb-0` / `w-full` は帯の中に置いたための余白・幅の調整である（`cn()` の規律 1）。
                       `FILTER_FORM_CLASSES` の `mb-6` は帯の外に置く 3 画面がまだ使っている。 */}
                <form
                  className={cn(FILTER_FORM_CLASSES, 'mb-0 w-full')}
                  method="get"
                  action="/engineers"
                  data-testid="engineer-list-filters"
                >
                  <fieldset className="contents">
                    <legend className="sr-only">{messages.searchLegend}</legend>
                    {/* 🔴 フリーワードは**全幅**（ワイヤーフレームの検索欄。`S-010` と同じ）。最も使う
                        条件を 1 行目に単独で置く —— 他の条件と同じ幅に並べると、入力できる語数が
                        画面幅で変わる。 */}
                    <Field className="sm:col-span-2 lg:col-span-3 xl:col-span-4" label={messages.searchQ}>
                      <Input
                        type="search"
                        name="q"
                        defaultValue={filters.q}
                        data-testid="engineer-list-filter-q"
                      />
                    </Field>
                    <Field label={messages.searchSkills}>
                      {/* 🔴 辞書からの選択のみ（自由入力は別名候補の起票であり `S-007` の責務。
                          `F-010 AC-1`「採用されるまで検索の正規化に使われない」）。 */}
                      <Select
                        name="skills"
                        multiple
                        size={5}
                        defaultValue={[...filters.skills]}
                        data-testid="engineer-list-filter-skills"
                      >
                        {skillOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                      {/* 🔴 `FieldDescription`（`<p>`）にしない —— `<label>` の中に `<p>` を入れると
                          説明文が入力欄のアクセシブル名に畳み込まれる（`@ses/ui` の `field.tsx` 冒頭）。 */}
                      <span className="text-xs text-fg-muted">{messages.searchSkillsHint}</span>
                    </Field>
                    <Field label={messages.searchSkillMode}>
                      <Select
                        name="skillMode"
                        defaultValue={filters.skillMode}
                        data-testid="engineer-list-filter-skill-mode"
                      >
                        {skillModeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={messages.searchYearsMin}>
                      <Input
                        type="number"
                        name="yearsMin"
                        min={0}
                        step={0.5}
                        defaultValue={filters.yearsMin}
                        data-testid="engineer-list-filter-years-min"
                      />
                    </Field>
                    <Field label={messages.searchPriceMin}>
                      <Input
                        type="number"
                        name="priceMin"
                        min={0}
                        step={10000}
                        defaultValue={filters.priceMin}
                        data-testid="engineer-list-filter-price-min"
                      />
                    </Field>
                    <Field label={messages.searchPriceMax}>
                      <Input
                        type="number"
                        name="priceMax"
                        min={0}
                        step={10000}
                        defaultValue={filters.priceMax}
                        data-testid="engineer-list-filter-price-max"
                      />
                    </Field>
                    <Field label={messages.searchAvailableBy}>
                      <Input
                        type="date"
                        name="availableBy"
                        defaultValue={filters.availableBy}
                        data-testid="engineer-list-filter-available-by"
                      />
                    </Field>
                    <Field label={messages.searchPrefecture}>
                      <Select
                        name="prefecture"
                        defaultValue={filters.prefecture}
                        data-testid="engineer-list-filter-prefecture"
                      >
                        {prefectureOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={messages.searchRemote}>
                      <Select
                        name="remote"
                        defaultValue={filters.remote}
                        data-testid="engineer-list-filter-remote"
                      >
                        {remoteOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={messages.searchAvailability}>
                      <Select
                        name="availability"
                        defaultValue={filters.availability}
                        data-testid="engineer-list-filter-availability"
                      >
                        {availabilityOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* 🔴 絞り込みチェックボックス 2 種（docs/04 §S-005 セクション 2）。**既定オフ**であり、
                        オフのときに何が起きるかを直下に書く（`F-009 AC-5` / `docs/02` A-03）。 */}
                    <Field as="div">
                      <label className="flex items-center gap-2 text-body">
                        <Checkbox
                          name="onlyInTime"
                          value="1"
                          defaultChecked={filters.onlyInTime}
                          data-testid="engineer-list-filter-only-in-time"
                        />
                        <span>{messages.searchOnlyInTime}</span>
                      </label>
                      <label className="flex items-center gap-2 text-body">
                        <Checkbox
                          name="onlyCommutable"
                          value="1"
                          defaultChecked={filters.onlyCommutable}
                          data-testid="engineer-list-filter-only-commutable"
                        />
                        <span>{messages.searchOnlyCommutable}</span>
                      </label>
                      <span className="text-xs text-fg-muted" data-testid="engineer-list-checkbox-note">
                        {messages.searchCheckboxNote}
                      </span>
                    </Field>
                    {/* 🔴 送信と「条件をクリア」は必ず 1 行を占める（列の途中に紛れると押せる場所が
                        毎回変わる）。`justify-end` はカードの中で右に寄せるための配置の調整であり、
                        共有定数（`FILTER_ACTIONS_CLASSES`）は変えていない。 */}
                    <div className={cn(FILTER_ACTIONS_CLASSES, 'justify-end')}>
                      {activeFilters.length === 0 ? null : (
                        <Link
                          className={SECONDARY_LINK_CLASSES}
                          href="/engineers"
                          data-testid="engineer-list-clear"
                        >
                          {messages.searchClear}
                        </Link>
                      )}
                      <Button type="submit" data-testid="engineer-list-search">
                        {messages.searchSubmit}
                      </Button>
                    </div>
                  </fieldset>
                </form>

                {/* 🔴 まだ無い機能を黙って消さない（`engineers.careers.comingSoon` と同じ規律）。
                    押しても効かない検索欄を描くより、いま何ができないのかを書く。
                    ✅ SP-22 段④: 場所を絞り込みカードの中へ移した（**どの条件が無いのか**は
                       条件の群の隣で読むものであり、一覧の上の独立した行ではない）。 */}
                <p className="mt-3 text-xs text-fg-muted" data-testid="engineer-list-search-coming-soon">
                  {messages.searchComingSoon}
                </p>
                <p className="mt-1 text-xs text-fg-muted" data-testid="engineer-list-experience-coming-soon">
                  {messages.experienceComingSoon}
                </p>
              </CardContent>
            </Card>
          }
        />
      </div>
      {messages.partnerScopeNotice === null ? null : (
        // 🔴 §5-10 の「見える範囲の説明」は**フィルタ帯の直下**である（`Toolbar` の直後）。
        //    ⚠️ 凍結済み `engineer-list-partner-scope-notice` を維持するため、`Toolbar` の
        //       `scopeNote`（`…-toolbar-scope-note` を出す）ではなく画面側の 1 行に残す。
        <p className="mb-1 text-xs text-fg-muted" data-testid="engineer-list-partner-scope-notice">
          {messages.partnerScopeNotice}
        </p>
      )}
      {/* 🔴 §7.6: 操作できないときは `disabled` で表さず、**その位置に理由テキストを置く**。
          ✅ SP-22 段④: 登録の導線そのものは**帯の primary** へ移した
             （`engineerListPrimaryAction`。`docs/04` §S-005 操作「『人材を登録』（primary）」/
             §7.6「primary は大きく」）。testid（`engineer-list-register`）は帯が引き継いでいる。 */}
      {canRegister ? null : (
        <p className="mb-3 text-body text-fg-muted" data-testid="engineer-list-read-only-note">
          {messages.readOnlyNote}
        </p>
      )}

      <DataTable
        testIdPrefix="engineer-list-"
        columns={engineerColumns(messages, showOwnershipColumn)}
        rows={rows}
        rowKey={(row) => row.id}
        linkComponent={Link}
        empty={
          // 🔴 docs/04 §10.1 `S-005`: **初回空と絞込 0 件は文言も導線も別物**である
          //    （文言の選び分けは `engineerLedgerScreenMessages`）。絞込 0 件のときは
          //    **効いている条件を 1 つずつ外せる導線**（§10.4 の「Primary は条件を外す」）と、
          //    チェックボックスの注意を添える。
          //    ⚠️ 器の `data-testid` は凍結済みの `engineer-list-empty` である（`U-22`）。
          <div data-testid="engineer-list-empty">
            <EmptyState
              testIdPrefix="engineer-list-empty-state-"
              description={`${messages.emptyTitle}${messages.emptyLead}`}
              primary={
                activeFilters.length === 0 ? undefined : (
                  <div data-testid="engineer-list-active-filters">
                    <p className="mb-1 text-body font-semibold text-fg">{messages.activeFiltersTitle}</p>
                    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                      {activeFilters.map((filter) => (
                        <li key={filter.key}>
                          <Link
                            className={SECONDARY_LINK_CLASSES}
                            href={filter.href}
                            data-testid={`engineer-list-remove-filter-${filter.key}`}
                          >
                            {filter.label} {messages.removeFilterSuffix}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              }
            />
            {messages.emptyCheckboxNotice === null ? null : (
              <p className="text-body text-fg" data-testid="engineer-list-empty-checkbox-notice">
                {messages.emptyCheckboxNotice}
              </p>
            )}
          </div>
        }
      />

      {/* 🔴 カーソルページング（docs/05 §6.1）。**「全 N ページ中 M ページ目」を出さない** ——
          ページ番号は境界外の行を含む全体件数を前提にした概念であり、§4.8 の「順位」に当たる。
          🔴 リンクは**検索条件を保った URL** である（`engineerListHref`）。
          ⚠️ 1 ページに収まるとき（次も前も無い）は領域ごと描かない。器の `data-testid` は
             凍結済みの `engineer-list-paging` である（`U-22`）。 */}
      {nextPageHref === null && firstPageHref === null ? null : (
        <div className="mt-4" data-testid="engineer-list-paging">
          <Pagination
            testIdPrefix="engineer-list-"
            nextHref={nextPageHref}
            nextLabel={messages.nextPage}
            // 🔴 `null` = 「前へは在るが今は先頭にいる」（`Pagination` は要素を消さない。§5-13）。
            prevHref={firstPageHref}
            prevLabel={messages.firstPage}
            linkComponent={EngineerPagingLink}
          />
        </div>
      )}
    </div>
  );
}
