// packages/ui/src/components/input.tsx
// shadcn/ui の `Input` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
// 🔴 基底クラスの upstream との突き合わせは `../lib/control-classes.ts` に 1 語ずつ書いてある。
//    ここに書くのは **`Input` 固有の差分だけ**である。
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `h-9` `py-1` | `h-10` `py-1` | 高さの理由は `CONTROL_FIELD_SIZE_CLASSES` 参照 |
// | `file:inline-flex` `file:h-7` `file:border-0` `file:bg-transparent` `file:font-medium` | 同じ | **落とさない。** `S-008`（スキルシート取込）が `<input type="file">` を持つ |
// | `file:text-sm` | **`file:text-body`**（実寸は同じ 14px） | T-22-01。`docs/04` §7.9 の 6 トークンで参照する（`text-sm` を直接書かない） |
// | `file:text-foreground` | **`file:text-fg`** | テーマ変数が無いため T-21-02 は実色（`file:text-slate-900`）に置換した。T-22-01 で §7.9 の `--color-fg`（同値）を指す形にした |
// | `type` を明示的に取り出して `<input type={type}>` へ渡す | 取り込まない | `{...props}` で同じ結果になる（upstream の書き方は `data-slot` の位置合わせのため） |
//
// 🔴 **チェックボックス / ラジオにこのコンポーネントを使わない。** `w-full` と `h-10` が
//    押下領域を帯の幅いっぱいに広げ、旧 `globals.css` の
//    `.ses-field input[type='checkbox'] { width: auto }`（T-06-04 が「伸びると押下領域が
//    帯全体になり誤操作を招く」として入れた例外）が防いでいた誤操作を再発させる。
//    必要になったら `Checkbox` を別のプリミティブとして足すこと。
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { CONTROL_BASE_CLASSES, CONTROL_FIELD_SIZE_CLASSES } from '../lib/control-classes.js';

export type InputProps = ComponentProps<'input'>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        CONTROL_BASE_CLASSES,
        CONTROL_FIELD_SIZE_CLASSES,
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-fg',
        className,
      )}
      {...props}
    />
  );
}
