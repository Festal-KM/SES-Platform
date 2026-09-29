// packages/ui/src/components/checkbox.tsx
// 絞り込み・選択のチェックボックス（`S-005` の 2 種 / `S-013` の公開先の選択）。SP-21 T-21-04。
//
// ============================================================================
// 🔴 これは upstream の `Checkbox` の取り込みではない —— **意図的に別物である**
// ============================================================================
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/checkbox.json`。
// upstream の `Checkbox` は `radix-ui`（`CheckboxPrimitive.Root` / `.Indicator`）と
// `lucide-react`（`CheckIcon`）に依存し、`appearance-none` の `<button role="checkbox">` に
// チェックの図形を自前で描く実装である。取り込まない理由は `./select.tsx` と同一:
//
//   1. 🔴 **新規依存が 2 つ増える**（`radix-ui` / `lucide-react`）。依存追加は承認事項であり、
//      「整形」であるはずの SP-21 の射程を超える（`../index.ts` の共通規約 6）。
//   2. 🔴 **ネイティブの `<input type="checkbox">` はフォーム送信に載る。** `S-005` の絞り込みは
//      `<form method="get">` の素の送信であり（クライアント JavaScript を 1 バイトも要求しない）、
//      `<button role="checkbox">` に置き換えると **JavaScript 無しでは検索条件が送れなくなる**。
//   3. SP-21 は挙動を変えないスプリントである（`docs/sprints/SP-21` §5 冒頭）。
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `peer` | 同じ | `Label` / `FieldLabel` の `peer-disabled:*` が効くように残す |
// | `size-4` `shrink-0` | 同じ | 16px 角。`shrink-0` は横並び（`flex items-center gap-2`）で潰れないため |
// | `border` `border-input` `rounded-[4px]` `shadow-xs` `dark:bg-input/30` | **取り込まない** | 🔴 `appearance-none` を採らない以上、枠線・角丸・影は UA の描画に**上書きされて効かない**。効かない語を増やさない（`../index.ts` の共通規約 3 と同じ理由） |
// | `data-[state=checked]:bg-primary` `data-[state=checked]:text-primary-foreground` `data-[state=checked]:border-primary` | **`accent-brand`** | 🔴 `data-state` は Radix が立てる属性でありネイティブでは存在しない。**チェック時の色はネイティブの `accent-color` で与える**。T-21-02 は実色（`accent-slate-900`）だったが、T-22-01 で `docs/04` §7.4 のブランド藍（primary と同じ意味）を指す形にした —— upstream も `bg-primary` である |
// | `focus-visible:border-ring` `focus-visible:ring-ring/50` `focus-visible:ring-[3px]` | **`FOCUS_RING_CLASSES`** | 実色へ置換し、**リングの形を `Button` / `Input` と同一にする**（同じ画面で 2 種類のフォーカス表現を出さない）。T-22-01 で全プリミティブ共通の 1 定数にした（`docs/04` §7.10） |
// | `outline-none` | 同じ（`FOCUS_RING_CLASSES` が対で持つ） | そのまま |
// | `transition-shadow` | **`transition-colors`** | T-22-01。§7.9 は遷移の対象を background-color / border-color / color / opacity に限る（影を遷移させない） |
// | `disabled:cursor-not-allowed` | 同じ | そのまま |
// | `disabled:opacity-50` | `disabled:opacity-60`（`DISABLED_TOGGLE_CLASSES`） | 既存 `Button` に合わせた数値差。🔴 **T-22-01 でも opacity のまま残す**（他のプリミティブは §7.10 の 2 色の組に移した）。理由は `../lib/state-classes.ts` の `DISABLED_TOGGLE_CLASSES` に書いた —— **チェックボックスの箱は UA が描くので `bg-*` / `text-*` が届かない** |
// | `aria-invalid:*` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ（テーマ変数前提） |
// | `data-slot="checkbox"` | 取り込まない | 同上 |
//
// 🔴 **`w-full` を持たせない。** 旧 `globals.css` の T-06-04 が
//    `.ses-field input[type='checkbox'] { width: auto }` を例外として明示的に入れていた
//    （「伸びると押下領域が帯全体になり誤操作を招く」）。その事故を戻さない。
// 🔴 **`Input` を流用しない**（`./input.tsx` 冒頭の 🔴 と対）。
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import {
  DISABLED_TOGGLE_CLASSES,
  FOCUS_RING_CLASSES,
  TRANSITION_CLASSES,
} from '../lib/state-classes.js';

/**
 * ネイティブの切り替え入力（`<input type="checkbox">` / `<input type="radio">`）の見た目。
 *
 * 🔴 **定数にして `./radio.tsx` と共有する**（SP-21 T-21-05）。同じ画面に checkbox と radio が
 *    並んだときに**片方だけ色やフォーカスリングが違う**状態を作らないためであり、
 *    「同じ見た目のローカル実装を 2 つ作らない」（T-21-02 ①）そのものである。
 *    ⚠️ 上の表の判断（`accent-color` / リングの形 / `opacity-60`）は radio にもそのまま効く。
 *
 * ⚠️ §7.10 の 8 状態のうちここが取るのは default / focus-visible / disabled である。
 *    hover / active（背景を 1 段暗く）は**箱を UA が描くため当てられない**。selected に当たるのは
 *    チェック状態そのもの（`accent-color`）であり、`SELECTED_CLASSES`（行・ナビ・タブ用）ではない。
 */
export const TOGGLE_CONTROL_CLASSES = cn(
  'peer size-4 shrink-0 accent-brand',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
  DISABLED_TOGGLE_CLASSES,
);

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return <input type="checkbox" className={cn(TOGGLE_CONTROL_CLASSES, className)} {...props} />;
}
