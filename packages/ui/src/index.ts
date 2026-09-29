// packages/ui/src/index.ts — @ses/ui の公開 API。
// 🔴 取り込んだ shadcn/ui コンポーネントは、ここから export したものだけを `apps/*` が使う
//    （CLAUDE.md §2.1「共有 UI コンポーネント」/ docs/03 §2「取り込んだコンポーネントは
//    packages/ui に一元管理」）。
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
//
// 🔴 **5. 文言を持たない。** 日本語の固定文言を 1 つも置かない（CLAUDE.md §3.5 / BR-32）。
//    文字列は呼び出し側が `packages/i18n` から解決して渡す。
//
// 🔴 **6. 依存を増やさない（ただし 2 つは入った）。** 2026-09-29 に人間が `docs/04` §5-13 で
//    **`class-variance-authority`（バリアント）と `tailwind-merge`（クラスの合成）の追加を承認**した
//    （位置づけは「`CLAUDE.md` §2 が宣言している shadcn/ui を宣言どおりに入れる」）。T-22-01 で
//    入れたのはこの 2 つだけである。🔴 **`@radix-ui/*` と `lucide-react` はまだ入れていない**
//    （Phase 3b。`Dialog` / `Drawer` / `DropdownMenu` / `Tooltip` / `Tabs` / アイコンと同時に入る）
//    ので、`asChild`（`Slot`）とアイコンは取り込まない。
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
export { Badge } from './components/badge.js';
export type { BadgeProps, BadgeVariant } from './components/badge.js';
export { Button } from './components/button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/card.js';
export { Checkbox } from './components/checkbox.js';
export type { CheckboxProps } from './components/checkbox.js';
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
export { Radio } from './components/radio.js';
export type { RadioProps } from './components/radio.js';
export { Select } from './components/select.js';
export type { SelectProps } from './components/select.js';
export {
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
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
} from './lib/link-classes.js';
