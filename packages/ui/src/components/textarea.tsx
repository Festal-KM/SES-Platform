// packages/ui/src/components/textarea.tsx
// shadcn/ui の `Textarea` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
// 🔴 基底クラスの upstream との突き合わせは `../lib/control-classes.ts` に 1 語ずつ書いてある。
//    ここに書くのは **`Textarea` 固有の差分だけ**である。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/textarea.json`。
// upstream の基底（原文、`Input` と重なる語は省略せずに全部）:
//   flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent
//   px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none
//   placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px]
//   focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50
//   aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm
//   dark:bg-input/30 dark:aria-invalid:ring-destructive/40
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `flex` | 同じ | **落とさない。** `<textarea>` を block のままにすると行末に inline 由来の隙間が出る |
// | `field-sizing-content` | 同じ | 入力量に応じて高さが伸びる。未対応ブラウザでは無効になるだけで、`min-h-*` と `rows` の既定に劣化する（`CLAUDE.md` §13.3「劣化はさせても遮断はしない」） |
// | `min-h-16` | `min-h-20` | 16（64px）は和文 2 行に足りない。旧 style の `min-h-[80px]` に相当する既定スケール値を使う（任意値を持ち込まないため `min-h-20`） |
// | `py-2` | 同じ | `Input`（`py-1` + `h-10`）と違い高さ固定を持たないため upstream のまま |
// | 🔴 `min-w-0` | **upstream に無いが足す** | `<textarea>` も `cols` 既定 20 由来の min-content 幅を持ち、flex の中で `Input` と**同じ理由**でコンテナを押し広げる。upstream は `Input` にだけ入れているが、原因は同じであり片方だけ直っている状態を持ち込まない（T-21-01 の教訓） |
// | `disabled:pointer-events-none` | **upstream に無いが入る** | `CONTROL_BASE_CLASSES` を `Input` / `Select` と共有しているため。無効時に何も起きない点は同じで、害は無い |
// | `border-input` / `ring-ring` / `text-muted-foreground` / `dark:*` | 実色へ置換 / 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { CONTROL_BASE_CLASSES } from '../lib/control-classes.js';

export type TextareaProps = ComponentProps<'textarea'>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(CONTROL_BASE_CLASSES, 'flex field-sizing-content min-h-20 py-2', className)}
      {...props}
    />
  );
}
