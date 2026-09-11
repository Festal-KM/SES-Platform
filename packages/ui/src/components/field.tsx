// packages/ui/src/components/field.tsx
// 「ラベル + 入力 + 説明 + エラー」の組（SP-21 T-21-02 の受け入れ基準 ①）。
// 旧 `globals.css` の `.ses-field`（78 箇所）と、既存画面の
// `<label className="mb-2 block text-sm"><span className="mb-1 block text-slate-700">…</span>`
// の置き場である。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/field.json`。
// upstream の `field.tsx` は 10 個のコンポーネント（`FieldSet` / `FieldLegend` / `FieldGroup` /
// `Field` / `FieldContent` / `FieldLabel` / `FieldTitle` / `FieldDescription` /
// `FieldSeparator` / `FieldError`）と、`orientation`（vertical / horizontal / responsive）、
// `data-invalid` / `data-disabled` の伝播、コンテナクエリ（`@md/field-group:`）から成る体系である。
// 🔴 **体系ごと取り込まない。** 取り込むのは本リポジトリの 20 画面が現に使っている縦積み
// （ラベルが上、入力が下）だけであり、残りは効かない語になる。**取り込んだ 4 つは
// upstream の同名コンポーネントと同じ役割を保つ**（後から差分を足せるようにするため）。
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `Field` = `<div role="group">` | `<label>`（既定） / `<div>` / `<p>` を `as` で選ぶ | 🔴 本リポジトリの 20 画面は**ラベルが入力を包む**形（移行前は `<label className="ses-field">`）であり、`htmlFor` を使っている箇所は 0 件である。`role="group"` の `<div>` に変えると **`id` を発番して `htmlFor` で結び直す**ことになり、SP-21 の「`id` / `aria-*` を変えない」に反する。`<p>` / `<div>` は移行前にあった形（旧 `.ses-field` は `<p>` 2 箇所・`<div>` 1 箇所でも使われていた） |
// | `flex w-full` + vertical の `flex-col` | 同じ | そのまま |
// | `gap-3` | `gap-1.5` | 12px はラベルと入力の間隔として広い。移行前（`.ses-field > span { margin-bottom: 0.25rem }`）に近い 6px にする |
// | 🔴 `[&>*]:w-full`（vertical バリアント） | **取り込まない** | 旧 `globals.css` の T-06-04 が `.ses-field input[type='checkbox'] { width: auto }` を**例外として明示的に入れていた**（「伸びると押下領域が帯全体になり誤操作を招く」）。器が子を一律に伸ばすと、この事故がそのまま戻る。**幅は `Input` / `Select` / `Textarea` 側の `w-full` が持つ** |
// | `[&>.sr-only]:w-auto` | 取り込まない | 上の語の打ち消しであり、上を取らないなら不要 |
// | `data-[invalid=true]:text-destructive` `group/field` `group-data-[disabled=true]/field:*` | 取り込まない | `data-invalid` / `data-disabled` を立てる仕組み（upstream の `FieldSet` と react-hook-form 連携）を取り込んでいないため、常に効かない |
// | `orientation`（horizontal / responsive） | 取り込まない | 横並びのフィールドが 20 画面に無い。コンテナクエリ前提の語も持ち込まない |
// | `FieldLabel` = `Label`（`<label>`） | `<span>` | 🔴 `Field` 自身が `<label>` であるため、**`<label>` の入れ子になる**（不正な HTML であり、クリックの転送先が曖昧になる）。移行前の `.ses-field > span` と同じ形にする。見た目は `Label` と**同じクラス定数を共有**する（`./label.tsx` の `LABEL_CLASSES`） |
// | `FieldError` の `errors` prop（`useMemo` で配列を畳む） | 取り込まない | 🔴 `useMemo` はクライアント専用フックであり、これを持つと **`'use client'` が必要になる**（T-21-02 の受け入れ基準 ③「状態・イベントハンドラを持たないものはサーバコンポーネントのままにする」）。本リポジトリのエラーは `{error ? <p …>{error}</p> : null}` の 1 本であり、配列を畳む必要が無い |
// | `FieldError` の `role="alert"` / 中身が空なら `null` を返す | 同じ | 現況の `<p role="alert" …>` と条件描画を保つ |
// | `FieldError` の `text-destructive` | `text-red-700` | テーマ変数が無いため実色に置換。既存画面の `text-sm text-red-700`（25 箇所以上）に合わせる |
// | `FieldDescription` の `text-muted-foreground` | `text-slate-500` | 同上 |
// | `FieldDescription` の `last:mt-0 nth-last-2:-mt-1 [[data-variant=legend]+&]:-mt-1.5` `group-has-[[data-orientation=horizontal]]/field:text-balance` | 取り込まない | `FieldLegend` / `FieldGroup` / horizontal の体系に属する語 |
// | `data-slot="field-*"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
//
// 🔴 **`Field` は下マージンを持たない。** 旧 `.ses-field` は `margin-bottom: 1rem` を持つ一方で
//    `.ses-filter-form .ses-field { margin-bottom: 0 }` という打ち消しが実在した ——
//    つまり**間隔は置かれる文脈が決める**。基底に入れると `cn()` では打ち消せない
//    （`../lib/cn.ts` の規律 1）。呼び出し側が `mb-4` を渡すか、親が `gap-*` を持つこと。
//
// 🔴 **幅は `width` prop で選ぶ（`className` で上書きしない）。** T-21-04 で判明した実害:
//    旧 `.ses-field` は `display:block` であり、**flex コンテナ（`.ses-filter-form` /
//    `S-007` のスキル追加行）の中では内容幅に縮んで横に並んでいた**。upstream どおりの
//    `w-full` を基底に固定すると、その並びが**1 行 1 項目**に化ける。`className="w-auto"` で
//    直したように見えても、`cn()` は `tailwind-merge` ではないため **`class` 属性の並び順は
//    勝敗を決めない**（勝つのは生成 CSS の順）。したがって競合する語は prop にする
//    （`../lib/cn.ts` の規律 2 / `Badge` の `variant` / `TableCell` の `whitespace` と同じ）。
//
// ⚠️ `as="p"` で使うときは `description` / `error` を渡さない（`<p>` の入れ子になる）。
// 🔴 **`as="label"`（既定）でも `description` / `error` を使わない。** `<label>` の中に `<p>` が
//    入るのは内容モデル違反であり、**説明文とエラー文が入力欄のアクセシブル名に畳み込まれる**。
//    本リポジトリの `role="alert"` はすべてフォーム単位・セクション単位で `<label>` の外にある
//    （SP-21 の「`aria-*` / 要素の並びを変えない」）。`FieldError` を `Field` の外に置くこと。
import type { LabelHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { LABEL_CLASSES } from './label.js';

/** `Field` が描く要素。移行前（旧 `.ses-field`）にあった 3 つだけを許す。 */
export type FieldElement = 'label' | 'div' | 'p';

/**
 * field の幅。🔴 `className` では基底に勝てないため prop にする（ファイル冒頭の 🔴）。
 * - `full` … 縦積みのフォーム（`S-007` / `S-012` / `S-035` ほか）。既定。
 * - `auto` … 横に並べる帯（旧 `.ses-filter-form` 相当 / 追加行）。内容幅に縮む。
 */
export type FieldWidth = 'full' | 'auto';

const WIDTH_CLASSES: Readonly<Record<FieldWidth, string>> = {
  full: 'w-full',
  auto: 'w-auto',
};

export type FieldProps = Omit<LabelHTMLAttributes<HTMLLabelElement>, 'children'> & {
  readonly as?: FieldElement;
  readonly width?: FieldWidth;
  /** ラベル文字。🔴 文字列は呼び出し側が `packages/i18n` から渡す（CLAUDE.md §3.5）。 */
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly labelClassName?: string;
  readonly children?: ReactNode;
};

export function Field({
  as = 'label',
  width = 'full',
  className,
  label,
  description,
  error,
  labelClassName,
  children,
  ...props
}: FieldProps) {
  // `as` は 3 つの union に縛られているため、実体は必ず label / div / p のいずれかである。
  // JSX の属性型を 1 つに固定するためのキャストであり、値は変換していない。
  const Element = as as 'label';
  return (
    <Element className={cn('flex flex-col gap-1.5', WIDTH_CLASSES[width], className)} {...props}>
      {label === undefined ? null : <FieldLabel className={labelClassName}>{label}</FieldLabel>}
      {children}
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Element>
  );
}

/**
 * field の中のラベル文字。
 * 🔴 `<span>` である（`Field` が `<label>` のとき `<label>` の入れ子を作らないため）。
 *    見た目は `Label` と同じ定数を共有する（同じ見た目の実装を 2 つ作らない）。
 */
export function FieldLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn(LABEL_CLASSES, className)} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'text-sm leading-normal font-normal text-slate-500 [&>a]:underline [&>a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  );
}

/** `FieldError` が描く要素。既存画面には `<p role="alert">` と `<span role="alert">` の両方がある。 */
export type FieldErrorElement = 'p' | 'span' | 'div';

export type FieldErrorProps = Omit<ComponentProps<'p'>, 'children'> & {
  readonly as?: FieldErrorElement;
  readonly children?: ReactNode;
};

/**
 * 入力欄の脇に出す 1 行のエラー（旧 `.ses-error` と `<p role="alert" className="text-sm
 * text-red-700">` の置き場）。
 * 🔴 中身が空のときは**何も描かない**（upstream と同じ。現況の条件描画を保つ）。
 */
export function FieldError({ as = 'p', className, children, ...props }: FieldErrorProps) {
  if (children === undefined || children === null || children === false || children === '') {
    return null;
  }
  // `as` の union を JSX の属性型 1 つに固定するためのキャスト（`Field` と同じ）。
  const Element = as as 'p';
  return (
    <Element role="alert" className={cn('text-sm font-normal text-red-700', className)} {...props}>
      {children}
    </Element>
  );
}
