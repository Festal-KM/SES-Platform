// packages/ui/src/components/badge.tsx
// shadcn/ui の `Badge` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02 / SP-22 T-22-01。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/badge.json`。
// upstream の基底（原文）:
//   inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full
//   border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap
//   transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px]
//   focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20
//   dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3
//
// ⚠️ **「ここ」の列は T-22-01（デザイントークン）で更新した。判断の記録は 1 行も消していない。**
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `inline-flex` `items-center` `justify-center` `gap-1` `px-2` | 同じ | `gap-1`（4px）/ `px-2`（8px）は `docs/04` §7.9 の spacing 7 段のうち「バッジの内側」に一致する |
// | 🔴 `w-fit` `shrink-0` `whitespace-nowrap` `overflow-hidden` | 同じ | **1 語も落とさない。** T-21-01 で `Button` からこの 2 語（`shrink-0` / `whitespace-nowrap`）が落ちていたために、狭い flex コンテナで**ラベルが 1 文字ずつ折り返して隣の要素と重なる**実害が出た。バッジは表のセルと flex 行の中にしか置かれないため、同じ壊れ方をする位置にある |
// | `rounded-full` | **`rounded-sm`**（4px） | 🔴 T-22-01。§7.9: radius は **2 段だけ**で、**円形（`rounded-full`）はアバターとカウンタのみ**。バッジは 4px の段（入力欄 / ボタン / バッジ / セル）である。**状態バッジは「色 + 形状 + 語」の 3 点で区別する**（§5-1）ので、形状が円形から角丸に変わっても弁別の要素は減らない |
// | `py-0.5`（2px） | **`py-1`**（4px） | T-22-01。§7.9 の spacing は 7 段（4 / 8 / 12 / 16 / 24 / 32 / 48）であり、2px はどの段でもない。「バッジの内側（縦）」に当たるのは `--space-1` = 4px である |
// | `text-xs`（12px） | **`text-micro`**（11px） | T-22-01。§7.3 の最下段「最小（バッジ内・`Phase N`・カウンタ）= 11px / 500」。🔴 **11px を本文に使わない**（バッジの中だけ） |
// | `font-medium` | 同じ（**T-22-01 で `font-semibold` から戻した**） | T-21-02 は既存 3 箇所（`sending-domain-status.tsx` / 管理平面 2 画面）の `font-semibold` に合わせていた。§7.3 が最小段の weight を **500** と定めたため upstream と同じ `font-medium` に戻る（トークン表が既存実装より上位である） |
// | `border border-transparent` | `border` のみを基底に置き、**色はバリアント側**が持つ | ⚠️ T-21-02 の時点では「`cn()` が競合解決をしないため両方載せるとどちらが勝つか読めない」という理由だった。**`tailwind-merge` を入れた T-22-01 以降は後勝ちで解決される**が、**色をバリアント 1 箇所に集める**という理由（§5-13 / §7.4）は変わらないので構成は同じである |
// | `transition-[color,box-shadow]` | `transition-colors` | 影を変えるバリアントが無い。§7.9 も遷移の対象を background-color / border-color / color / opacity に限っている |
// | `focus-visible:*` `aria-invalid:*` `dark:*` | 取り込まない | 本リポジトリのバッジは状態表示であり、フォーカスを受けない（§7.10 の 8 状態のうちバッジが取るのは default だけ。下の表）。`dark:` はダークテーマ非対応（`Q-04-3` 既定 ①） |
// | `[&>svg]:pointer-events-none` `[&>svg]:size-3` | 取り込まない | 🔴 **状態バッジにアイコンを付けない**（§7.5 / §5-1。`Phase N` の Badge も同じ）。`lucide-react` は Phase 3b |
// | `asChild`（`radix-ui` の `Slot`） | 取り込まない | リンクとして使いたくなったら `<a>` の中にバッジを置く |
// | バリアント名 `default` / `secondary` / `destructive` / `outline` / `ghost` / `link` | `neutral` / `brand` / `info` / `success` / `warning` / `danger` / `outline` | 🔴 本リポジトリのバッジは**状態**を色で示す用途しかなく、upstream の `default`（primary 色）に対応するものが無い。**名前は `docs/04` §7.4 の 6 系統と 1 対 1** である（下の表） |
//
// ============================================================================
// 🔴 `docs/04` §7.4 の 6 系統との対応（**意味を入れ替えない**）
// ============================================================================
// | バリアント | §7.4 の系統 | 割り当てられた意味（この列を画面側で解釈し直さない） |
// |---|---|---|
// | `brand` | ブランド藍 | **いま進行中・次はあなたの番**（`APPROVAL_PENDING` / `SUBMITTING` / `REQUESTED`） |
// | `danger` | 障害（赤） | 🔴 **`SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` のみ**（赤を乱用すると本当に危ない 3 状態が埋もれる） |
// | `warning` | 注意（橙） | `GATE_FAILED` / `EXTENSION_REVIEW` / `CLOSING` / 上限 80% 到達（**直せば / 動けば進む**もの） |
// | `success` | 成果（緑） | `WON` / `SUBMITTED` / `ACTIVE` / `EXECUTED` / `ACCEPTED`（**多用しない**） |
// | `info` | 情報（青） | `SANDBOX` / 環境バナー / お知らせ帯。**業務の状態色と混ぜない** |
// | `neutral` / `outline` | 無彩色 | 🔴 **終わったもの・確定したものは色を持たない**（`DRAFT` / `LOST` / `DECLINED` / `WITHDRAWN` / `EXPIRED` / `ENDED` / `PURGED`）/ `Phase N` |
//
// 🔴 **`brand` と `info` は T-22-01 で新設した**（§7.4 の実装漏れの記録: ブランド藍・成果（緑）・
//    情報（青）は実装に 0 箇所だった）。**使う画面は Phase 4 以降**であり、ここでは色の所在だけを作る。
// 🔴 **`StatusBadge` を別部品として作らない**（§5-13）。§5-1 の 36 状態 + 公開の状態 4 値 +
//    `Phase N` は **`Badge` のバリアント**として Phase 3b で足す（状態名から表示を導出し、
//    画面側で色を指定させない）。
//
// ⚠️ §7.10 の 8 状態のうち `Badge` が取るのは **default だけ**である。バッジは表示であって
//    操作ではなく、hover / active / focus-visible / disabled / loading / error を持たない
//    （持たせると「押せるもの」に見える）。
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { TRANSITION_CLASSES } from '../lib/state-classes.js';

const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-2 py-1 text-micro font-medium whitespace-nowrap',
    TRANSITION_CLASSES,
  ),
  {
    variants: {
      /** 🔴 枠線色・背景色・文字色は**すべてここが持つ**（基底に置かない。上の表 / §7.4）。 */
      variant: {
        neutral: 'border-transparent bg-neutral-bg text-fg',
        brand: 'border-transparent bg-brand-bg text-brand',
        info: 'border-transparent bg-info-bg text-info',
        success: 'border-transparent bg-success-bg text-success',
        warning: 'border-transparent bg-warning-bg text-warning',
        danger: 'border-transparent bg-danger-bg text-danger',
        outline: 'border-neutral-border bg-transparent text-fg',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export type BadgeProps = ComponentProps<'span'> & {
  readonly variant?: BadgeVariant;
};

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
