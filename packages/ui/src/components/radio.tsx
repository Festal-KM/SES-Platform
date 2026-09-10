// packages/ui/src/components/radio.tsx
// 排他選択のラジオボタン（`A-014` の「契約の初期状態」= `SANDBOX` / `ACTIVE`）。SP-21 T-21-05。
//
// ============================================================================
// 🔴 upstream の `radio-group` の取り込みではない —— **意図的に別物である**
// ============================================================================
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/radio-group.json`。
// upstream の `RadioGroup` / `RadioGroupItem` は `radix-ui`（`RadioGroupPrimitive`）と
// `lucide-react`（`CircleIcon`）に依存し、`appearance-none` の `<button role="radio">` に
// 図形を自前で描く。取り込まない理由は `./checkbox.tsx` と完全に同一である:
//
//   1. 🔴 **新規依存が 2 つ増える**（`radix-ui` / `lucide-react`）。依存追加は承認事項であり、
//      「整形」であるはずの SP-21 の射程を超える（`../index.ts` の共通規約 6）。
//   2. 🔴 **ネイティブの `<input type="radio">` は `name` による排他とフォーム送信に載る。**
//      `<button role="radio">` に置き換えると、JavaScript 無しでは選択が送れなくなる。
//   3. SP-21 は挙動を変えないスプリントである（`docs/sprints/SP-21` §5 冒頭）。
//
// 🔴 **見た目は `Checkbox` と同じ定数（`TOGGLE_CONTROL_CLASSES`）を共有する。**
//    同じ画面に checkbox と radio が並んだときに、チェック色とフォーカスリングが**片方だけ
//    違う**状態を作らない（T-21-02 ①「同じ見た目のローカル実装を 2 つ作らない」）。
//    個々の語をどう選んだかの判断は `./checkbox.tsx` の表に書いてある（1 箇所にまとめる）。
//
// 🔴 **`w-full` を持たせない。** 旧 `globals.css` の `.ses-field input { width: 100% }` は
//    `input[type='checkbox']` だけを例外にしており、**ラジオは幅いっぱいに引き伸ばされていた**
//    （`A-014` の実測。押下領域が帯全体になり、隣の選択肢を誤って選べる状態だった）。
//    移行でこれを引き継がない —— これは見た目の好みではなく誤操作の除去である。
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { TOGGLE_CONTROL_CLASSES } from './checkbox.js';

export type RadioProps = Omit<ComponentProps<'input'>, 'type'>;

export function Radio({ className, ...props }: RadioProps) {
  return <input type="radio" className={cn(TOGGLE_CONTROL_CLASSES, className)} {...props} />;
}
