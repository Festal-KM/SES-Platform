// packages/ui/src/components/alert.tsx
// shadcn/ui の `Alert` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
// 枠で囲む告知（旧 `globals.css` の `.ses-notice` と、既存画面の
// `rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`（8 箇所）の置き場）。
//
// ⚠️ **入力欄の脇に出す 1 行のエラー**（旧 `.ses-error` と `<p role="alert" className="text-sm
//    text-red-700">`。合わせて 25 箇所以上）は `Alert` ではなく `FieldError`
//    （`./field.tsx`）である。upstream も同じ 2 本立てであり、混ぜない
//    （**枠付きの箱をフォームの全項目に出すと、本当の警告が埋もれる**）。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/alert.json`。
// upstream の基底（原文）:
//   relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3
//   text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3
//   [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current
//   AlertTitle      : col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight
//   AlertDescription: col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground
//                     [&_p]:leading-relaxed
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `relative w-full rounded-lg border px-4 py-3 text-sm` | 同じ（`border` の色はバリアントが持つ） | v4 の border 既定色は `currentColor`。色を書かないと文字色の枠が出る（`./table.tsx` の表に同じ） |
// | `role="alert"` を `{...props}` の**前**に置く | 同じ | 呼び出し側が `role` を上書きできる並び。既存画面は `<p role="alert">` を自分で書いており、**その挙動を変えないため**に上書きできる形を保つ |
// | 🔴 `grid` `grid-cols-[0_1fr]` `items-start` `gap-y-0.5` `col-start-2` | **取り込まない** | これはアイコン列を作るための格子であり、アイコンが無いとき 1 列目は幅 0 になる。`col-start-2` を持つ `AlertTitle` / `AlertDescription` 以外の子（＝**素のテキスト**）は**幅 0 の 1 列目に落ちて潰れる**。本リポジトリの旧 `.ses-notice` は素のテキストしか渡しておらず、そのまま写すと壊れる。アイコンを入れる日に格子ごと取り込むこと |
// | `has-[>svg]:*` `[&>svg]:*` | 取り込まない | アイコン（`lucide-react`）を持たない |
// | 🔴 `line-clamp-1`（`AlertTitle`） | **取り込まない** | 1 行を超える見出しを黙って切り落とす。`CLAUDE.md` §13.3「狭い画面を理由に判断材料を隠さない」に反する（和文の見出しは容易に 1 行を超える） |
// | `min-h-4 font-medium tracking-tight`（`AlertTitle`） | 同じ + `mb-0.5` | 格子の `gap-y-0.5` を落としたぶんの間隔を見出し側に持たせる |
// | `text-muted-foreground`（`AlertDescription`） | 取り込まない | 文字色はバリアント（箱側）から継承させる。ここで灰色を固定すると `danger` の説明文だけ赤くならない |
// | `grid justify-items-start gap-1 [&_p]:leading-relaxed`（`AlertDescription`） | 同じ | 説明文の中に複数要素を積む用途はそのまま使える |
// | バリアント `default` / `destructive` | `info` / `success` / `warning` / `danger` | 状態を色で示す用途に合わせる（`./badge.tsx` と同じ 4 色。**2 つのプリミティブで色の意味を変えない**） |
// | `data-slot="alert-*"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

/** 🔴 枠線色・背景色・文字色はすべてバリアントが持つ（基底に置かない。`../lib/cn.ts`）。 */
const VARIANT_CLASSES: Readonly<Record<AlertVariant, string>> = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
};

export type AlertProps = ComponentProps<'div'> & {
  readonly variant?: AlertVariant;
};

export function Alert({ className, variant = 'info', ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'relative w-full rounded-lg border px-4 py-3 text-sm',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-0.5 min-h-4 font-medium tracking-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
