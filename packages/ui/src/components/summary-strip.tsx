// packages/ui/src/components/summary-strip.tsx
// 🔴 1 行の密な指標ストリップ（`docs/04` §5-13 / §7.2 の改訂 16 / §6.11.1）。SP-22 `T-22-04`。
//    shadcn/ui の取り込みではなく本リポジトリ固有。
//
// ============================================================================
// 🔴 なぜ「カードにしない」が本体なのか（`docs/04` §7.2 の表）
// ============================================================================
// §7.2 は **「KPI カード 4 枚 → グラフ → 最近のアクティビティ → テーブル」の型を採らない**と
// 定めており、改訂 16（人間の決定）はストリップを `PageHeader` の直下に**認めた**。
// 🔴 **禁止は捨てていない —— 守り方を「配置」から「視覚的な強さ」に移した**（§7.2 の 🔴）。
// 防ぎたいのは「朝一番に目に入るものが、行動の変わらない数値であること」であり、それを決めるのは
// 位置ではなく**視覚的な強さ**である（位置が下でも、巨大な数字が 4 つあればそこを見る）。
//
// | 🔴 引き続き禁止 | この部品での守り方 |
// |---|---|
// | KPI カードを 4 枚横並びにする / カードで囲む / カードの入れ子 | **`Card` を使わない。** 背景・枠線・影を持たない（区切り線だけ） |
// | グラフ・スパークライン・前月比・達成率 | **受け取る prop が無い**（`{ label, value, href? }` の 3 項目だけ） |
// | 件数を要対応キューより視覚的に強くする（**これが禁止の本体**） | 文字は **`text-xs`**（12px）+ **`--color-fg-muted`**、背景なし（§7.3 の「補助テキスト」の段。§10.3 の「大きい数値」の整形は**呼び出し側**が済ませた文字列を渡す） |
// | 0 が並ぶストリップを出す | 🔴 **0 件のときは描かない**（`items` が空なら `null`）。データが無いときは `EmptyState` に倒す |
//
// 🔴 **モバイルは 2 行 × 2〜3 列のグリッドで、横スクロールにしない**（§5-13）——
//    横スクロールにすると、画面外の指標に気づけないまま「全部見た」と思う。
//    実装: `grid grid-cols-2` → `sm:grid-cols-3` → `lg:flex`（1 行に収まる幅から初めて 1 行になる）。
//
// 🔴 `'use client'` を付けない（`../index.ts` の共通規約 4）。🔴 文言を持たない（共通規約 5）——
//    ラベルも値も**解決済みの文字列**を受け取る。`next/link` にも依存しない（`linkComponent`）。
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_CLASSES } from '../lib/state-classes.js';

/** 上限（`docs/04` §5-13「3〜5 件」）。🔴 これを超えたら実行時に落とす（下の壁）。 */
export const SUMMARY_STRIP_MAX_ITEMS = 5;
/**
 * 下限（同 3〜5 件）。🔴 **0 件は「描かない」であって違反ではない**（§7.2 の表）。
 * 🔴 **1〜2 件は落とす**（下の壁）。`docs/05` §6.11.1 は Phase 1 でホスト 3 件 / 取引先 4 件、
 *    Phase 2 で両方 5 件と定めており、**個々の 0 で項目を間引かない**（並びが日によって変わると
 *    走査の記憶が効かない）。件数が 3 を割るのは「0 の指標を間引いた」ときだけである。
 */
export const SUMMARY_STRIP_MIN_ITEMS = 3;

export type SummaryStripItem = {
  /** 指標の名前（解決済み）。 */
  readonly label: string;
  /** 🔴 **件数だけ**（整形済みの文字列）。§7.2: 売上・率・前月比を渡さない。 */
  readonly value: string;
  /** 該当一覧への導線。省略すると文字のまま（遷移しない指標もある）。 */
  readonly href?: string;
};

/** 導線の部品が受け取る props（`next/link` の `Link` がそのまま満たす）。 */
export type SummaryStripLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
};

function DefaultLink({ href, className, children, ...rest }: SummaryStripLinkProps) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

export type SummaryStripProps = {
  /**
   * 3〜5 件。🔴 **空なら描かない**（§7.2「0 が並ぶストリップを出さない」）。
   * ⚠️ タプル型にしない理由: 0 件を型で禁じると、呼び出し側が「0 件のときに `EmptyState` へ倒す」
   *    判断をする前に型エラーになり、**空配列を無理に 3 件に埋める**方向へ倒れる。
   */
  readonly items: readonly SummaryStripItem[];
  readonly linkComponent?: ComponentType<SummaryStripLinkProps>;
  /** testid の接頭辞（例 `home-host-summary-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  readonly className?: string;
};

/**
 * 🔴 **補助テキストの強さ**（§7.3 の「補助テキスト」= 12px / 400 / `--color-fg-muted`）。
 *    値だけ `font-medium` にする（ラベルと値の区別はそれで足りる）。**サイズを上げない。**
 */
const LABEL_CLASSES = 'text-xs text-fg-muted';
const VALUE_CLASSES = 'text-xs font-medium text-fg-muted';

export function SummaryStrip({
  items,
  linkComponent: Link = DefaultLink,
  testIdPrefix,
  className,
}: SummaryStripProps) {
  // 🔴 0 件は描かない（§7.2 の表）。`EmptyState` に倒すのは呼び出し側の判断である。
  if (items.length === 0) return null;
  // 🔴 実行時の壁（`./dropdown-menu.tsx` / `./tabs.tsx` と同じ形）。上限を超えた入力を黙って描かない ——
  //    6 件以上になった時点で「1 行の密なストリップ」ではなく KPI カードの並びになる。
  if (items.length > SUMMARY_STRIP_MAX_ITEMS) {
    throw new Error(
      `SummaryStrip: 指標は ${String(SUMMARY_STRIP_MAX_ITEMS)} 件までです（docs/04 §5-13「3〜5 件」）。${String(items.length)} 件渡されました。`,
    );
  }
  // 🔴 1〜2 件は「0 の指標を間引いた」ことの徴候である（`docs/05` §6.11.1 の 🔴）。
  //    間引きを許すと、同じ画面の並びが日によって変わる。
  if (items.length < SUMMARY_STRIP_MIN_ITEMS) {
    throw new Error(
      `SummaryStrip: 指標は ${String(SUMMARY_STRIP_MIN_ITEMS)} 件以上です（docs/04 §5-13 / docs/05 §6.11.1「個々の 0 で項目を間引かない」）。${String(items.length)} 件渡されました。全部 0 のときは描かない（空配列を渡す）でください。`,
    );
  }
  return (
    <div
      data-testid={`${testIdPrefix}root`}
      data-item-count={items.length}
      // 🔴 背景・枠線・影を持たない（カードにしない）。🔴 横スクロールにしない（`grid` → `flex`）。
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:gap-4', className)}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          data-testid={`${testIdPrefix}item-${index}`}
          className={cn(
            'flex items-baseline gap-2',
            // 区切り線は `lg` で 1 行になったときだけ（グリッドでは行の折り返しに掛かって読めない）。
            index === 0 ? null : 'lg:border-l lg:border-border lg:pl-4',
          )}
        >
          <span className={LABEL_CLASSES}>{item.label}</span>
          {item.href === undefined ? (
            <span className={VALUE_CLASSES}>{item.value}</span>
          ) : (
            <Link
              href={item.href}
              className={cn(VALUE_CLASSES, 'underline', FOCUS_RING_CLASSES)}
              data-testid={`${testIdPrefix}link-${index}`}
            >
              {item.value}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
