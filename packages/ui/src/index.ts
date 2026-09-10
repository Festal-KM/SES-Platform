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
//    `bg-card` / `text-destructive`）をそのまま写さない。** 本リポジトリは `@theme` を
//    宣言しておらず、Tailwind v4 の既定 theme にもこれらは無い（実測: `theme.css` に
//    `--color-input` / `--color-ring` / `--color-primary` / `--color-muted` /
//    `--color-destructive` / `--color-card` いずれも 0 件）。**写した語は CSS を 1 行も
//    生成せず、枠線・文字色・背景が無いまま出る。** slate / emerald / amber / red の実色に置く。
//    同じ理由で `border` は色付きの語（`border-slate-200` 等）と必ず対にする
//    （v4 の border 既定色は `currentColor`）。
//
// 🔴 **3. `dark:` を取り込まない。** `globals.css` が `color-scheme: light` を宣言しており、
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
// 🔴 **6. 依存を増やさない。** `class-variance-authority` / `tailwind-merge` / `radix-ui` /
//    `lucide-react` はいずれも入れていない（新規依存は承認事項）。バリアントは
//    `Readonly<Record<…, string>>` の対応表で表し、`asChild` とアイコンは取り込まない。
//    ⚠️ その結果 **`cn()` は競合するクラス名を解決しない** —— 呼び出し側が `className` で
//    上書きできるのは「競合しないユーティリティ」だけである。競合する上書きは prop として
//    ここに足す（`lib/cn.ts` の規律 / `Badge` の `variant` / `TableCell` の `whitespace`）。
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
export { Field, FieldDescription, FieldError, FieldLabel } from './components/field.js';
export type {
  FieldElement,
  FieldErrorElement,
  FieldErrorProps,
  FieldProps,
} from './components/field.js';
export { Input } from './components/input.js';
export type { InputProps } from './components/input.js';
export { Label } from './components/label.js';
export type { LabelProps } from './components/label.js';
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
  TableCellProps,
  TableCellWhitespace,
  TableHeadProps,
  TableProps,
} from './components/table.js';
export { Textarea } from './components/textarea.js';
export type { TextareaProps } from './components/textarea.js';
export { cn } from './lib/cn.js';
