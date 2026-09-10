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
// | `data-[state=checked]:bg-primary` `data-[state=checked]:text-primary-foreground` `data-[state=checked]:border-primary` | `accent-slate-900` | 🔴 `data-state` は Radix が立てる属性でありネイティブでは存在しない。**チェック時の色はネイティブの `accent-color` で与える**（`bg-slate-900` と同じ実色。テーマ変数は本リポジトリに無い） |
// | `focus-visible:border-ring` `focus-visible:ring-ring/50` `focus-visible:ring-[3px]` | `focus-visible:ring-2` `focus-visible:ring-slate-400` `focus-visible:ring-offset-2` | 実色へ置換し、**リングの形を `Button` / `Input` と同一にする**（同じ画面で 2 種類のフォーカス表現を出さない。`../lib/control-classes.ts` と同じ判断） |
// | `outline-none` `transition-shadow` | 同じ | そのまま |
// | `disabled:cursor-not-allowed` | 同じ | そのまま |
// | `disabled:opacity-50` | `disabled:opacity-60` | 既存 `Button` / `CONTROL_BASE_CLASSES` に合わせる（数値のみの差） |
// | `aria-invalid:*` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ（テーマ変数前提） |
// | `data-slot="checkbox"` | 取り込まない | 同上 |
//
// 🔴 **`w-full` を持たせない。** `globals.css` の T-06-04 が
//    `.ses-field input[type='checkbox'] { width: auto }` を例外として明示的に入れていた
//    （「伸びると押下領域が帯全体になり誤操作を招く」）。その事故を戻さない。
// 🔴 **`Input` を流用しない**（`./input.tsx` 冒頭の 🔴 と対）。
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/**
 * ネイティブの切り替え入力（`<input type="checkbox">` / `<input type="radio">`）の見た目。
 *
 * 🔴 **定数にして `./radio.tsx` と共有する**（SP-21 T-21-05）。同じ画面に checkbox と radio が
 *    並んだときに**片方だけ色やフォーカスリングが違う**状態を作らないためであり、
 *    「同じ見た目のローカル実装を 2 つ作らない」（T-21-02 ①）そのものである。
 *    ⚠️ 上の表の判断（`accent-color` / リングの形 / `opacity-60`）は radio にもそのまま効く。
 */
export const TOGGLE_CONTROL_CLASSES = [
  'peer size-4 shrink-0 accent-slate-900 outline-none transition-shadow',
  'focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-60',
].join(' ');

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return <input type="checkbox" className={cn(TOGGLE_CONTROL_CLASSES, className)} {...props} />;
}
