// packages/ui/src/components/button.tsx
// shadcn/ui の Button を取り込み。ソースを一元管理する（docs/03 §2「UI」/ CLAUDE.md §2.1）。
// 🔴 `class-variance-authority` を使わない最小版（`cn.ts` 冒頭コメント参照）。
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'default' | 'sm';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
};

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
};

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'default', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        // 🔴 `whitespace-nowrap shrink-0` は shadcn/ui の Button の基底クラスにあるものであり、
        //    見た目の好みではなく**当たり判定の前提**である（T-21-01 の回帰調査で実測）。
        //    これを落とすと、狭い flex コンテナ（例: `S-008` の操作列。表のセルの中）で
        //    ①`min-width: auto` ＝ min-content が **「CJK 1 文字 + 左右パディング」= 38px** まで
        //    縮み ②ラベルが 1 文字ずつ折り返して 63〜64px 分の高さになる。
        //    `h-8` / `h-10` が高さを 32 / 40px に固定しているため、**ラベルがボタンの箱から
        //    はみ出し、隣のボタンと重なって見える**（実測: 幅 38px / 箱 32px / 内容 64px）。
        //    その状態でモバイルの `S-008` を叩くと「この版を開く」を押したつもりで
        //    「ダウンロード」が発火した（`audit-k7.mobile` が実際に落ちた）。
        // 🔴 **押せない・読めないボタンは「劣化」ではなく「遮断」である**（CLAUDE.md §13.3）。
        //    幅が伸びたぶんは、置き場所（`S-008` は `overflow-x-auto`）が横スクロールで受ける。
        'shrink-0 whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
});
