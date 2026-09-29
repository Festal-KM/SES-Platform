// packages/ui/src/components/alert.tsx
// shadcn/ui の `Alert` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02 / SP-22 T-22-01。
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
// ⚠️ **「ここ」の列は T-22-01（デザイントークン）で更新した。判断の記録は 1 行も消していない。**
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `relative w-full border px-4 py-3` | 同じ（`border` の色はバリアントが持つ） | v4 の border 既定色は `currentColor`。色を書かないと文字色の枠が出る（`./table.tsx` の表に同じ）。`px-4`（16px）/ `py-3`（12px）は `docs/04` §7.9 の spacing 7 段に一致する |
// | `rounded-lg`（8px） | **`rounded-md`**（6px） | T-22-01。§7.9 の radius は 2 段だけで、告知の箱はパネルの段（6px）である |
// | `text-sm`（14px） | **`text-body`**（14px。**実寸は同じ**） | T-22-01。§7.9 は 6 トークン以外の文字サイズを画面ごとに作らないことを求めており、本文は役割名 `--text-body` で参照する。行間が 1.6 になる（§7.3 の本文の行間） |
// | `role="alert"` を `{...props}` の**前**に置く | 同じ | 呼び出し側が `role` を上書きできる並び。既存画面は `<p role="alert">` を自分で書いており、**その挙動を変えないため**に上書きできる形を保つ |
// | 🔴 `grid` `grid-cols-[0_1fr]` `items-start` `gap-y-0.5` `col-start-2` | **取り込まない** | これはアイコン列を作るための格子であり、アイコンが無いとき 1 列目は幅 0 になる。`col-start-2` を持つ `AlertTitle` / `AlertDescription` 以外の子（＝**素のテキスト**）は**幅 0 の 1 列目に落ちて潰れる**。本リポジトリの旧 `.ses-notice` は素のテキストしか渡しておらず、そのまま写すと壊れる。アイコンを入れる日に格子ごと取り込むこと |
// | `has-[>svg]:*` `[&>svg]:*` | 取り込まない | アイコン（`lucide-react`）は Phase 3b。§7.5 は告知の箱にアイコンを要求していない |
// | 🔴 `line-clamp-1`（`AlertTitle`） | **取り込まない** | 1 行を超える見出しを黙って切り落とす。`CLAUDE.md` §13.3「狭い画面を理由に判断材料を隠さない」に反する（和文の見出しは容易に 1 行を超える） |
// | `min-h-4 font-medium tracking-tight`（`AlertTitle`） | 同じ + **`mb-1`**（4px） | 格子の `gap-y-0.5`（2px）を落としたぶんの間隔を見出し側に持たせる。T-22-01 で `mb-0.5` から `mb-1` にした —— `docs/04` §7.9 の spacing は **7 段（4 / 8 / 12 / 16 / 24 / 32 / 48）** であり、2px はどの段でもない（「これ以外の値を使わない」）。最小の段が 4px である |
// | `text-muted-foreground`（`AlertDescription`） | 取り込まない | 文字色はバリアント（箱側）から継承させる。ここで灰色を固定すると `danger` の説明文だけ赤くならない |
// | `grid justify-items-start gap-1 [&_p]:leading-relaxed`（`AlertDescription`） | 同じ | 説明文の中に複数要素を積む用途はそのまま使える |
// | バリアント `default` / `destructive` | `neutral` / `info` / `success` / `warning` / `danger` | 状態を色で示す用途に合わせる（`./badge.tsx` と**同じ名前で同じ意味**。🔴 2 つのプリミティブで色の意味を変えない） |
// | `data-slot="alert-*"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
//
// ============================================================================
// 🔴 T-22-01 で `info` の色が変わった（無彩色 → 青）。`neutral` を新設した
// ============================================================================
// T-21-02 の `info` は `border-slate-200 bg-slate-50 text-slate-700`（**無彩色**）だった。
// これは旧 `.ses-notice` の見た目をそのまま引き継いだものだが、**名前（`info`）と色（無彩色）が
// `docs/04` §7.4 の割り当てと食い違っていた**（§7.4 の 情報（青）= `SANDBOX` / 環境バナー /
// お知らせ帯）。§7.9 は「semantic の名前は §7.4 の意味と 1 対 1」を要求しているため、
//   - `info` … 青（`--color-info-*`）。**環境・運営からの連絡**
//   - `neutral` … 無彩色（旧 `info` と同じ見た目）。**それ以外の説明の箱**
// に分けた。⚠️ **既存の呼び出し 20 件はいずれも `warning` / `danger` / `success` であり
// （`variant="info"` と variant 省略は 0 件。実測）、この変更で見た目が変わる画面は無い。**
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

const alertVariants = cva('relative w-full rounded-md border px-4 py-3 text-body', {
  variants: {
    /** 🔴 枠線色・背景色・文字色はすべてバリアントが持つ（基底に置かない。§7.4 の 6 系統）。 */
    variant: {
      neutral: 'border-border bg-bg-subtle text-fg',
      info: 'border-info-border bg-info-bg text-info',
      success: 'border-success-border bg-success-bg text-success',
      warning: 'border-warning-border bg-warning-bg text-warning',
      danger: 'border-danger-border bg-danger-bg text-danger',
    },
  },
  defaultVariants: { variant: 'info' },
});

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

export type AlertProps = ComponentProps<'div'> & {
  readonly variant?: AlertVariant;
};

export function Alert({ className, variant = 'info', ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-1 min-h-4 font-medium tracking-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid justify-items-start gap-1 text-body [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
