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
// | `flex items-center gap-2` `text-sm` `font-medium` `select-none` | 同じ | そのまま |
// | `leading-none` | `leading-snug` | `leading-none`（行高 1.0）は和文だと行が詰まりすぎる。upstream 自身も `field.tsx` の `FieldTitle` では `leading-snug` を使っており、**本リポジトリのラベルはすべて field の中にある**ためそちらに揃える |
// | `w-fit`（upstream の `FieldTitle` 側にある語） | 足す | 🔴 `<label htmlFor>` が幅いっぱいだと**文字の無い余白まで押下領域になる**（旧 `globals.css` の T-06-04 のチェックボックス例外と同じ事故） |
// | `peer-disabled:cursor-not-allowed` | 同じ | そのまま |
// | `peer-disabled:opacity-50` | `peer-disabled:opacity-60` | 既存 `Button` / `CONTROL_BASE_CLASSES` の `opacity-60` に合わせる |
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
  'flex w-fit items-center gap-2 text-sm leading-snug font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60';

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
