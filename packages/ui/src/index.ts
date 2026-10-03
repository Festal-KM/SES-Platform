// packages/ui/src/index.ts — @ses/ui の公開 API（**サーバのまま描ける部品だけ**）。
// 🔴 取り込んだ shadcn/ui コンポーネントは、ここから export したものだけを `apps/*` が使う
//    （CLAUDE.md §2.1「共有 UI コンポーネント」/ docs/03 §2「取り込んだコンポーネントは
//    packages/ui に一元管理」）。
//
// 🔴 **バレルは 2 つある（T-22-03。`docs/05` §2.3.1）。** `package.json` の `exports` は
//    **`"."`（本ファイル）と `"./client"`（`./index.client.ts`）の 2 つだけ**である
//    （`packages/connectors` の `"."` / `"./aws"` と同じ形）。overlay 6 部品
//    （`Dialog` / `Drawer` / `DropdownMenu` / `Tooltip` / `Tabs` / `Toast`）は `./client` 側に在り、
//    🔴 **本ファイルからは export しない** —— 載せると、`Button` を 1 つ使うだけの
//    サーバコンポーネントが Radix と `'use client'` の塊をバンドルへ引き込む。
//
// ============================================================================
// 取り込みの共通規約（SP-21 T-21-02。各ファイルの表と併せて読む）
// ============================================================================
// 🔴 **1. upstream と 1 語ずつ突き合わせ、落とした語・置き換えた語を必ずファイルに書く。**
//    `docs/03` §69 が「shadcn/ui は取り込み後のアップデートが手動」をリスクに挙げており、
//    T-21-01 で `Button` が `whitespace-nowrap` / `shrink-0` の 2 語を落としていたために
//    **6 文字のラベルが 1 文字ずつ 6 行に折り返して隣のボタンと重なる**実害が出た。
//    照合元は `https://ui.shadcn.com/r/styles/new-york-v4/{name}.json`（`components.json` の
//    `style` が `new-york`）。**照合日を書く。**
//
// 🔴 **2. テーマ変数（`bg-primary` / `border-input` / `text-muted-foreground` / `ring-ring` /
//    `bg-card` / `text-destructive`）をそのまま写さない。** upstream の名前は本リポジトリに
//    存在せず（実測: Tailwind v4 の `theme.css` に `--color-input` / `--color-ring` /
//    `--color-primary` / `--color-muted` / `--color-destructive` / `--color-card` いずれも 0 件）、
//    **写した語は CSS を 1 行も生成せず、枠線・文字色・背景が無いまま出る。**
//    ⚠️ **T-22-01 で置き換え先が変わった**: T-21-02 は実色（`border-slate-300` 等）に置いていたが、
//    いまは **`docs/04` §7.9 の semantic トークン**（`border-border-strong` / `text-fg-muted` /
//    `bg-brand` / `text-danger` …）に置く。**値は同一**で、所在が `apps/web/app/tailwind.css` の
//    `@theme` 1 箇所になった。🔴 **実色（`text-slate-500` 等）を新しく書かない**
//    （primitive 層はアプリコードから直接使わない。§7.9 / `tests/static/design-tokens.test.ts`）。
//    同じ理由で `border` は色付きの語（`border-border` 等）と必ず対にする
//    （v4 の border 既定色は `currentColor`）。
//
// 🔴 **3. `dark:` を取り込まない。** `tailwind.css` が `color-scheme: light` を宣言しており、
//    ダークモードを持たない。効かない語を増やさない。
//
// 🔴 **4. `'use client'` を付けない。** ここにある 10 個はいずれも状態・イベントハンドラ・
//    フックを持たない。付けると、それを描いていたサーバコンポーネントの画面が丸ごと
//    クライアントバンドルへ移る（T-21-02 の受け入れ基準 ③）。**フックが要る設計に
//    なったら、まず「フックを使わずに書けないか」を疑うこと**（`field.tsx` の `FieldError`
//    は upstream の `useMemo` を落とすことでサーバのままにしている）。
//    ⚠️ **T-22-03 で例外の置き場所ができた**が、規約は変わっていない: `'use client'` を書けるのは
//    **`./index.client.ts` が export する overlay 6 部品のファイルだけ**であり、🔴 **本バレルと
//    ここから export されるファイルには 1 つも書かない**（`docs/05` §2.3.1 の 🔴）。
//    検査は `tests/static/ui-overlay-contract.test.ts`。
//
// 🔴 **5. 文言を持たない。** 日本語の固定文言を 1 つも置かない（CLAUDE.md §3.5 / BR-32）。
//    文字列は呼び出し側が `packages/i18n` から解決して渡す。
//
// 🔴 **6. 依存を増やさない（ただし 2 つは入った）。** 2026-09-29 に人間が `docs/04` §5-13 で
//    **`class-variance-authority`（バリアント）と `tailwind-merge`（クラスの合成）の追加を承認**した
//    （位置づけは「`CLAUDE.md` §2 が宣言している shadcn/ui を宣言どおりに入れる」）。T-22-01 で
//    入れたのはこの 2 つだけである。
//    ⚠️ **T-22-03 で `@radix-ui/react-{dialog,dropdown-menu,tooltip,tabs}` の 4 つが入った**
//    （同じ §5-13 の承認の範囲。`Dialog` / `Drawer`〔Dialog 派生〕/ `DropdownMenu` / `Tooltip` /
//    `Tabs` の 5 部品が使う。`Toast` は Radix を使わない ——
//    `@radix-ui/react-toast` は承認の列挙に無い。`components/toast.tsx` の冒頭）。
//    🔴 **`@radix-ui/*` の import は `./components/**` だけ**であり、**本バレル側の 15 部品は
//    1 つも Radix を使わない**（`tests/static/ui-primitive-single-impl.test.ts` (b)②）。
//    🔴 **`lucide-react` はまだ入れていない**（`T-22-05`）ので、アイコンは取り込まない。
//    ⚠️ **`cn()` は競合するクラス名を後勝ちで解決するようになった**（`lib/cn.ts` に経緯）。
//    それでも**色・サイズ・状態は `variant` / `size` として prop に置く** —— 理由は競合解決の
//    有無ではなく、§7.4 の意味の割り当てを 1 箇所に閉じるためである。
//
// 🔴 **7. 色・文字サイズ・余白・radius は `docs/04` §7.9 のトークンで書く。**
//    実装先は `apps/web/app/tailwind.css` の `@theme` 1 本であり、**`packages/ui` 側に 2 本目の
//    宣言（CSS ファイル・色変数）を作らない**。トークンを足したいときは §7.9 の改訂（= 人間の
//    判断。`CLAUDE.md` §8.6）を経る。⚠️ **`@theme` が読まれるのは `apps/web` の CSS 入口**
//    なので、`packages/ui` のクラスが生成 CSS に載るには `tailwind.css` の
//    `@source '../../../packages/ui/src'` が要る（その 1 行を消すと**テストが緑のまま見た目だけ
//    消える**。同ファイル冒頭の実測）。
//
// 🔴 **8. §7.10 の 8 状態はプリミティブが持つ（画面側で `hover:` を書かせない）。**
//    共通語は `lib/state-classes.ts`（`FOCUS_RING_CLASSES` / `DISABLED_CLASSES` /
//    `SELECTED_CLASSES` / `TRANSITION_CLASSES`）。**状態を取りうるプリミティブは、ファイル先頭に
//    「8 状態のうちどれを取り、どれを取らないか」を書く**（**取らないことにも理由がある** ——
//    例えば `Badge` は表示であって操作ではないので hover を持たない）。現に書いてあるのは
//    `components/button.tsx` / `components/badge.tsx` / `components/checkbox.tsx` /
//    `components/table.tsx` と、入力系 3 つを束ねる `lib/control-classes.ts` である
//    （`Card` / `Alert` / `Label` / `EnvironmentBanner` のように **default しか取らない**
//    部品には書かない —— 全ファイルに同じ表を貼ると、読む価値のある差分が埋もれる）。
//    🔴 **`disabled` で権限・代理閲覧の不能を表さない**（`docs/04` `U-10`）。**描画せず、その位置に
//    理由テキストを置く**（CSS で隠すのではなく DOM から取り除く）。
export { Alert, AlertDescription, AlertTitle } from './components/alert.js';
export type { AlertProps, AlertVariant } from './components/alert.js';
// 🔴 T-22-05: 主平面の外枠 4 部品（`docs/05` §2.3.1 の 1〜4）。**いずれもサーバのまま描ける**
//    （`'use client'` を宣言しない。開閉は `<details>` と `<input type="checkbox">` + CSS）。
export { AppShell } from './components/app-shell.js';
export type { AppShellLabels, AppShellProps, BottomTab } from './components/app-shell.js';
export { PageHeader } from './components/page-header.js';
export type { PageHeaderAction, PageHeaderCrumb, PageHeaderProps } from './components/page-header.js';
export { Sidebar, SidebarDefaultLink, SidebarNavList, isCurrentNavPath } from './components/sidebar.js';
// 🔴 2026-10-03（人間の明示指示 + モックアップ）: サイドバーを 6 項目のフラットに畳んだぶんの
//    **第 2 階層**（`components/nav-panel.tsx` の冒頭に「なぜ `Tabs` ではないのか」がある）。
//    🔴 **いずれもサーバのまま描ける**（`'use client'` を宣言しない）。
export { NavIndex, SectionNav } from './components/nav-panel.js';
export type {
  NavIndexItem,
  NavIndexProps,
  SectionNavItem,
  SectionNavProps,
} from './components/nav-panel.js';
export type {
  SidebarBadge,
  SidebarGroup,
  SidebarItem,
  SidebarLabels,
  SidebarLinkProps,
  SidebarNavListProps,
  SidebarProps,
  SidebarReach,
  SidebarVariant,
} from './components/sidebar.js';
export { TopBar } from './components/top-bar.js';
export type { TopBarProps, TopBarScope, TopBarUsage, TopBarUsageState } from './components/top-bar.js';
// 🔴 T-22-05: アイコンの唯一の入口（`docs/05` §17.7.1 (i)①）。**写像に無い名前は型エラー**になる。
//    画面と `lib/shell/nav.ts` が扱うのは `IconName`（文字列リテラル型）だけである。
export { ICON_CLASSES, ICON_NAMES, ICONS, Icon } from './icons.js';
export type { IconName, IconProps, IconSize } from './icons.js';
// 🔴 2026-10-02（人間のブリーフ）: **共通フレームの部品**（複数人が別の画面を担当しても
//    1 つの SaaS に見えるための器）。いずれも **文字列と配列だけを受け取る** ——
//    🔴 `children` / `ReactNode` の prop を 1 つも持たない（`components/drawer.tsx` と同じ理由。
//    任意の JSX を入れられる器は、規約がコメントだけになる）。
// 🔴 **面・影・余白・色の決定はこれらの部品の中にしか無い**（画面側に `rounded-md border …` を
//    書かせない）。検査は `tests/static/ui-shadow-and-size.test.ts` と
//    `tests/static/ui-primitive-single-impl.test.ts`（単一実装）。
export { Avatar, AVATAR_MAX_INITIALS } from './components/avatar.js';
export type { AvatarProps } from './components/avatar.js';
export { GlobalSearchBox } from './components/global-search-box.js';
export type { GlobalSearchBoxProps } from './components/global-search-box.js';
// 🔴 `KpiCard` は `docs/04` §7.9 / §7.3 改訂 23 の `MetricCard` と**同一物**である
//    （名前の食い違いは `docs/04` 側の訂正事項）。**`--text-metric`（24px）を使ってよい唯一の部品。**
export {
  KPI_CARD_ROW_MAX_ITEMS,
  KPI_CARD_ROW_MIN_ITEMS,
  KpiCard,
  KpiCardRow,
} from './components/kpi-card.js';
export type { KpiCardItem, KpiCardProps, KpiCardRowProps } from './components/kpi-card.js';
// 🔴 挨拶は**時計を持たない**（`greetingSlotOf` で区分だけを決め、語と日付は呼び出し側が
//    サーバで解決する。`components/page-greeting.tsx` の 🔴）。
export { GREETING_SLOTS, PageGreeting, greetingSlotOf } from './components/page-greeting.js';
export type { GreetingSlot, PageGreetingProps } from './components/page-greeting.js';
// 🔴 右レールの 3 部品は**同じ面（`RailFrame`）を共有する 1 ファイル**に在る
//    （`children` を取る器を作らないため。`components/rail-card.tsx` 冒頭）。
export { RailCard, RankedList, Timeline } from './components/rail-card.js';
export type {
  RailCardLink,
  RailCardProps,
  RankedListItem,
  RankedListProps,
  TimelineEntry,
  TimelineProps,
} from './components/rail-card.js';
export { SectionHeader } from './components/section-header.js';
export type { SectionHeaderLink, SectionHeaderProps } from './components/section-header.js';
export { Badge, STATUS_BADGE_APPEARANCES, StatusBadge } from './components/badge.js';
export type {
  BadgeProps,
  BadgeShape,
  BadgeVariant,
  StatusBadgeAppearance,
  StatusBadgeEntity,
  StatusBadgeProps,
  StatusBadgeState,
} from './components/badge.js';
// 🔴 T-22-04: `IconButton` は `Button` の**バリアント**である（別ファイルを起こさない。docs/04 §5-13）。
//    アイコンの要素は呼び出し側から受ける（`lucide-react` は T-22-05。`components/button.tsx` の 🔴）。
// 🔴 T-22-05: `ICON_CONTROL_CLASSES` は「`<button>` にできない操作」（サイドバーの開閉トグル =
//    `<label>` + `<input type="checkbox">`）に `IconButton` と同じ見た目を当てるための語である
//    （同じ見た目のローカル実装を 2 つ作らない。`components/button.tsx` の 🔴）。
export { Button, ICON_CONTROL_CLASSES, IconButton } from './components/button.js';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './components/button.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/card.js';
export { Checkbox } from './components/checkbox.js';
export type { CheckboxProps } from './components/checkbox.js';
// 🔴 T-22-04: 一覧の器（**サーバコンポーネント**）。行の描画をクライアントへ移さない
//    （50 行 × 8 列は §7 の p95 に効く）。並び替え / 列表示切替 / 行選択の 3 部品は
//    `./index.client.ts` 側に在る（docs/05 §2.3.1 の 6b）。
export {
  DATA_TABLE_HEADER_CLASSES,
  DATA_TABLE_MAX_VISIBLE_COLUMNS,
  DATA_TABLE_NAME_COLUMN_MIN_REM,
  DataTable,
} from './components/data-table.js';
export type {
  ColumnPriority,
  DataTableColumn,
  DataTableNameCell,
  DataTableProps,
  DataTableRowAttributes,
} from './components/data-table.js';
// 🔴 並び / 行選択の**型**は器の prop の型であり、部品（`./index.client.ts`）とは別に要る。
export type {
  DataTableSort,
  DataTableSortDirection,
  DataTableSortIndicators,
} from './components/data-table-sort-link.js';
export type { DataTableSelection } from './components/data-table-selection.js';
// 🔴 T-22-04: 空状態（docs/04 §10.4 の `初回空` / `絞込 0`）。構造は 説明 → Primary → Secondary。
export { EmptyState } from './components/empty-state.js';
export type { EmptyStateLinkProps, EmptyStateProps } from './components/empty-state.js';
// 🔴 T-10-05: `F-028` 非本番環境バナー。shadcn/ui の取り込みではなく本リポジトリ固有
//    （docs/05 §13.5）。`APP_ENV` の分岐を持つ唯一の UI 部品であり、文言は持たない。
export { EnvironmentBanner } from './components/environment-banner.js';
export type {
  EnvironmentBannerEnv,
  EnvironmentBannerMessages,
  EnvironmentBannerProps,
  EnvironmentBannerVisibleEnv,
} from './components/environment-banner.js';
// 🔴 T-12-14 ③: docs/04 §10.3「多数行（履歴・展開リスト）」の共通規約（直近 10 行 + 「すべて表示」）。shadcn/ui の
//    取り込みではなく本リポジトリ固有。`<details>` に展開の状態を持たせ、フックを持たない（規約 4）。文言を持たない（規約 5）。
export { FOLDED_LIST_DEFAULT_VISIBLE_COUNT, FoldedList } from './components/folded-list.js';
export type { FoldedListProps } from './components/folded-list.js';
export { Field, FieldDescription, FieldError, FieldLabel } from './components/field.js';
export type {
  FieldElement,
  FieldErrorElement,
  FieldErrorProps,
  FieldProps,
  FieldWidth,
} from './components/field.js';
export { Input } from './components/input.js';
export type { InputProps } from './components/input.js';
export { Label } from './components/label.js';
export type { LabelProps } from './components/label.js';
// 🔴 SP-22 段⑤（`T-22-14`）: 使用量メーター（`docs/04` §5-4 / **§5-13 の 26 部品目**）。
//    🔴 **塗りの幅はデータ由来の割合**であり、クラスでは表せない（`components/meter.tsx` 冒頭）。
//    `S-038`（テナント）と `A-004`（運営者）の**両方がこの 1 実装を使う** ——
//    2 つ目の実装が生えないことは `tests/static/ui-primitive-single-impl.test.ts` が固定する。
//    🔴 色は `state`（意味）から部品が決める。`children` / 色の prop を持たない。
export { Meter, meterFillPercent } from './components/meter.js';
export type { MeterProps, MeterState } from './components/meter.js';
// 🔴 T-11-12: 一覧の名称セル（docs/04 §10.3「長い名称」のブレークポイント別規約）。shadcn/ui の取り込みではなく
//    本リポジトリ固有。文言を持たず、`next/link` にも依存しない（`linkComponent` で受ける）。
export {
  NAME_CELL_ACTION_CLASSES,
  NAME_CELL_LINK_CLASSES,
  NAME_CELL_MAX_WIDTH_CLASS,
  NAME_CELL_MIN_WIDTH_CLASS,
  NAME_CELL_TEXT_CLASSES,
  NAME_CELL_TEXT_WRAP_CLASSES,
  NameCell,
} from './components/name-cell.js';
export type { NameCellLinkProps, NameCellNameProps, NameCellProps } from './components/name-cell.js';
// 🔴 T-22-04: 幅 3 クラス（docs/04 §7.1）。**本体カラムの幅を決める唯一の場所**であり、
//    任意寸法（`w-90` / `max-w-180`）が書かれているのもこのファイルだけである（docs/05 §2.3.4）。
//    🔴 60 画面の割り当ては `docs/04` §7.1 の表が唯一の出所であり、ここに写さない。
export {
  PAGE_BODY_ASIDE_ROW_CLASSES_BY_FROM,
  PAGE_BODY_ASIDE_WIDTH_CLASSES,
  PAGE_BODY_ASIDE_WIDTH_CLASSES_BY_FROM,
  PAGE_BODY_ASIDE_WIDTH_CLASSES_FROM_2XL,
  PAGE_BODY_GUTTER_CLASS,
  PAGE_BODY_PROSE_MAX_WIDTH_CLASS,
  PageBody,
} from './components/page-body.js';
export type { PageBodyAsideFrom, PageBodyProps, PageWidthClass } from './components/page-body.js';
// 🔴 T-22-04: カーソル方式のページ送り。🔴 オフセット・総件数・無限スクロールの prop を持たない。
export { Pagination } from './components/pagination.js';
export type { PaginationLinkProps, PaginationProps } from './components/pagination.js';
export { Radio } from './components/radio.js';
export type { RadioProps } from './components/radio.js';
export { Select } from './components/select.js';
export type { SelectProps } from './components/select.js';
// 🔴 T-22-04: ローディングの骨格。🔴 行数・列数は呼び出し側（`DataTable`）が決める（跳ねない）。
export { Skeleton } from './components/skeleton.js';
export type { SkeletonHeight, SkeletonProps, SkeletonWidth } from './components/skeleton.js';
// 🔴 T-22-04: 1 行の密な指標ストリップ。🔴 カードにしない / グラフを置かない / 0 件のとき描かない。
export { SUMMARY_STRIP_MAX_ITEMS, SUMMARY_STRIP_MIN_ITEMS, SummaryStrip } from './components/summary-strip.js';
export type {
  SummaryStripItem,
  SummaryStripLinkProps,
  SummaryStripProps,
} from './components/summary-strip.js';
export {
  TABLE_OVERFLOW_INDICATOR_CLASS,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './components/table.js';
export type {
  TableCellAlign,
  TableCellPadding,
  TableCellProps,
  TableCellWhitespace,
  TableHeadProps,
  TableProps,
  TableRowProps,
} from './components/table.js';
export { Textarea } from './components/textarea.js';
export type { TextareaProps } from './components/textarea.js';
// 🔴 T-22-04: 一覧の上の帯。**母集団の 1 行（§3.2-2）と §5-10 の説明ブロックの置き場所を固定する。**
export { Toolbar } from './components/toolbar.js';
export type { ToolbarProps } from './components/toolbar.js';
export { cn } from './lib/cn.js';
// 🔴 T-22-01: `docs/04` §7.10 の 8 状態の共通語（規約 8）。**画面側でこれを組み直さない**
//    （`hover:` / `focus-visible:` を画面に書くと、画面ごとに違う状態表現が生まれる）。
export {
  DISABLED_CLASSES,
  DISABLED_TOGGLE_CLASSES,
  FOCUS_RING_CLASSES,
  SELECTED_CLASSES,
  SELECTED_ROW_CLASSES,
  TRANSITION_CLASSES,
} from './lib/state-classes.js';
export {
  PRIMARY_LINK_CLASSES,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
} from './lib/link-classes.js';
// 🔴 SP-22 段⑤（`T-22-14`）: 「画面の幅ではない実寸」2 つ（認証カード / QR の図版）。
//    🔴 **`PageWidthClass` の 4 つ目ではない**（型は 3 値のまま。`lib/fixed-width-classes.ts` 冒頭）。
//    `apps/web/app/**` に `max-w-*` を書けない（検査 (c)）ため、寸法を持てる唯一の層へ移した。
export { AUTH_CARD_WIDTH_CLASSES, QR_FIGURE_CLASSES } from './lib/fixed-width-classes.js';
