// packages/ui/src/components/empty-state.tsx
// 🔴 空状態（`docs/04` §5-13 / §10.1 / §10.4）。SP-22 `T-22-04`。shadcn/ui の取り込みではなく
//    本リポジトリ固有（upstream に対応部品が無い）。
//
// ============================================================================
// 🔴 構造は 3 段に固定する（`docs/04` §5-13。改訂 16）
// ============================================================================
//   ① 説明 → ② Primary Action → ③ Secondary Action（テキストリンク）
//
// 🔴 **0 件が正常な画面ではアクションを置かない**（`S-022`「送信に失敗した提案はありません」）。
//    → `primary` / `secondary` は**任意**であり、**既定は「説明だけ」**である。空状態のたびに
//      「何か押すもの」を置くと、正常な 0 件が異常に見える。
// 🔴 **イラスト・大きなアイコンを置かない**（§5-13 / §7.5 の「引き続き使わない場所」）。
//    → **アイコンを受け取る prop を持たない**（持たせた時点で規約はコメントになる）。
// 🔴 **ナビゲーションの重複リンクを置かない**（§5-13）。
//    → `secondary` は**多くとも 1 本**である（配列を受け取らない）。サイドバーに在る導線を
//      ここに並べ直すと、空状態がナビの写しになる。
// 🔴 **初回空と絞り込み 0 件は別文言**（§10.1）。→ **文言はこの部品が持たない**（共通規約 5）。
//    どちらの文言を渡すかは画面の判断であり、§10.4 は「絞込 0 の Primary は**条件を外す**であって
//    新規作成ではない」と定めている（探し物が見つからない人に作成させない）。
//
// 🔴 説明文は **720px を超えて 1 行にしない**（`docs/04` §7.1 の 🔴。日本語は 1 行 40〜50 文字を
//    超えると行頭に戻れない）。寸法は `./page-body.tsx` の定数を import する ——
//    🔴 **任意寸法（`max-w-180`）が書かれているのは `page-body.tsx` だけ**である（`docs/05` §2.3.4）。
//
// 🔴 `'use client'` を付けない（`../index.ts` の共通規約 4）。`next/link` にも依存しない
//    （導線は `linkComponent` で受ける。`docs/05` §2.3.3）。
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { SECONDARY_LINK_CLASSES } from '../lib/link-classes.js';
import { PAGE_BODY_PROSE_MAX_WIDTH_CLASS } from './page-body.js';

/** 導線の部品が受け取る props（`next/link` の `Link` がそのまま満たす）。 */
export type EmptyStateLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
};

function DefaultLink({ href, className, children, ...rest }: EmptyStateLinkProps) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

export type EmptyStateProps = {
  /** ① 説明（`packages/i18n` で解決済み）。🔴 初回空と絞込 0 で**別の語**を渡す（§10.1）。 */
  readonly description: string;
  /**
   * ② Primary Action。🔴 **0 件が正常な画面では渡さない**（`S-022`）。
   * ⚠️ 要素で受け取るのは、ボタン / リンクのどちらかを §7.6 が画面ごとに決めるためである。
   */
  readonly primary?: ReactNode;
  /** ③ Secondary Action（テキストリンク）。🔴 **多くとも 1 本**（ナビの写しを作らない）。 */
  readonly secondary?: { readonly href: string; readonly label: string };
  /** `secondary` を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` を渡す。 */
  readonly linkComponent?: ComponentType<EmptyStateLinkProps>;
  /**
   * testid の接頭辞（例 `proposal-send-failures-empty-`）。
   * 🔴 **部品はローカルで値を作らない**（`tests/static/testid-inventory.test.ts` の
   *    「`packages/ui` の testid はリテラル / テンプレート / 素通しだけ」）。
   */
  readonly testIdPrefix: string;
  readonly className?: string;
};

/**
 * 空状態。描画の形:
 *
 *   <div data-testid="{prefix}root">
 *     <p>…説明…</p>
 *     …primary…            ← 渡されたときだけ
 *     <a>…secondary…</a>   ← 渡されたときだけ
 *   </div>
 */
export function EmptyState({
  description,
  primary,
  secondary,
  linkComponent: Link = DefaultLink,
  testIdPrefix,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-testid={`${testIdPrefix}root`}
      // 🔴 上下の余白は §7.9 の `--space-12`（48px。「空状態の上下」）。
      className={cn('flex flex-col items-start gap-4 py-12', PAGE_BODY_PROSE_MAX_WIDTH_CLASS, className)}
    >
      <p data-testid={`${testIdPrefix}description`} className="text-body text-fg">
        {description}
      </p>
      {primary === undefined ? null : <div data-testid={`${testIdPrefix}primary`}>{primary}</div>}
      {secondary === undefined ? null : (
        <Link href={secondary.href} className={SECONDARY_LINK_CLASSES} data-testid={`${testIdPrefix}secondary`}>
          {secondary.label}
        </Link>
      )}
    </div>
  );
}
