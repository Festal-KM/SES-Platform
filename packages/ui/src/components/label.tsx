// packages/ui/src/components/label.tsx
// shadcn/ui の `Label` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/label.json`。
// upstream の基底（原文）:
//   flex items-center gap-2 text-sm leading-none font-medium select-none
//   group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50
//   peer-disabled:cursor-not-allowed peer-disabled:opacity-50
//
// | upstream | ここ | 判断と理由 |
// |---|---|---|
// | `@radix-ui/react-label`（`LabelPrimitive.Root`）を描く | 素の `<label>` を描く | 🔴 **新規依存を増やさない**（承認事項）。Radix Label が素の `<label>` に足しているのは「ダブルクリックでラベル文字が選択されないこと」だけで、それは `select-none` で同じ結果になる。**`htmlFor` による関連付けはネイティブの機能である** |
// | `"use client"` | **付けない** | 🔴 Radix を使わないためフックもイベントも無い。付けると、これを描いていた**サーバコンポーネントの画面が丸ごとクライアントバンドルへ移る**（SP-21 T-21-02 の受け入れ基準 ③） |
// | `flex items-center gap-2` `font-medium` `select-none` | 同じ | そのまま。`gap-2`（8px）は `docs/04` §7.9 の spacing 7 段に一致する |
// | `text-sm`（14px） | **`text-body`**（14px。**実寸は同じ**） | T-22-01。§7.9 の 6 トークンで参照する（`text-sm` を直接書かない）。行間は §7.3 の本文の 1.6 になるが、下の `leading-snug` が上書きする |
// | `leading-none` | `leading-snug` | `leading-none`（行高 1.0）は和文だと行が詰まりすぎる。upstream 自身も `field.tsx` の `FieldTitle` では `leading-snug` を使っており、**本リポジトリのラベルはすべて field の中にある**ためそちらに揃える |
// | `w-fit`（upstream の `FieldTitle` 側にある語） | 足す | 🔴 `<label htmlFor>` が幅いっぱいだと**文字の無い余白まで押下領域になる**（旧 `globals.css` の T-06-04 のチェックボックス例外と同じ事故） |
// | `peer-disabled:cursor-not-allowed` | 同じ | そのまま |
// | `peer-disabled:opacity-50` | **`peer-disabled:text-fg-placeholder`** | T-21-02 は既存 `Button` に合わせて `peer-disabled:opacity-60` にしていた。T-22-01 で `docs/04` §7.10 の disabled（**文字 `--color-fg-placeholder`**）に置き換えた。🔴 **背景（`--color-bg-inset`）はラベルには当てない** —— ラベルは帯の中の文字であって入力の箱ではなく、背景を塗ると無効な行が「もう 1 つの入力欄」に見える |
// | `group-data-[disabled=true]:*` | 取り込まない | upstream の `Field` が立てる `data-disabled` の体系に属する語。その体系（`FieldSet` / `FieldGroup` / `data-disabled` の伝播）を取り込んでいないため、常に効かない死んだ語になる |
// | `data-slot="label"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/**
 * ラベル文字の見た目。
 *
 * 🔴 `Label`（`<label htmlFor>`）と `FieldLabel`（field の中の `<span>`）が**同じ見た目を
 *    2 つ持たない**ようにここで共有する（SP-21 T-21-02 の受け入れ基準 ①
 *    「同じ見た目のローカル実装を 2 つ作らない」）。
 */
export const LABEL_CLASSES =
  'flex w-fit items-center gap-2 text-body leading-snug font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:text-fg-placeholder';

export type LabelProps = ComponentProps<'label'>;

/**
 * `htmlFor` で入力に結び付けるラベル。
 *
 * ⚠️ 入力を**包む**書き方（`<label><span>…</span><input /></label>`。本リポジトリの
 *    20 画面はすべてこの形）には `Field` を使う。`Field` の中のラベル文字は
 *    `<label>` の入れ子を作らないよう `FieldLabel`（`<span>`）である。
 */
export function Label({ className, ...props }: LabelProps) {
  return <label className={cn(LABEL_CLASSES, className)} {...props} />;
}
