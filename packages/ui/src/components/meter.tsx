// packages/ui/src/components/meter.tsx
// 使用量メーター（`docs/04` §5-4「使用量メーター」）。SP-22 段⑤（`T-22-14`）。
//
// ============================================================================
// 🔴 なぜ `packages/ui` に部品として置くのか（段④ が外せなかった 1 件の回収）
// ============================================================================
// 塗りの幅は **データ由来の割合**であり、実行時にしか決まらない（`style={{ width: '42%' }}`）。
// つまり `max-w-*` のような「画面が幅を決めている」事例とは別種であり、検査 (c)②
// （`tests/static/ui-screen-width.test.ts` の `style` の `width`）の射程が
// **`apps/web/app/**` だけ**で `packages/ui` を除いているのは、まさに
// 「寸法を持てるのは部品だけ」という規律のためである（`components/page-body.tsx` 冒頭と同じ構え）。
// したがって塗り幅を持てる場所はここしかない。
//
// 🔴 **これが `docs/04` §5-13 の 26 部品目である**（25 → 26）。条文の追随は人間が行う。
//
// ============================================================================
// 🔴 この部品が受け取るもの / 受け取らないもの（`UI_GUIDELINES.md` §8）
// ============================================================================
// - 受け取るのは **割合（`percent`）と意味（`state`）と語（`label`）だけ**である。
// - 🔴 **`children` / `ReactNode` の prop を持たない**（任意の JSX が入ると規約の外の
//   スタイルがここから入り込む）。
// - 🔴 **色を渡せる prop を持たない。** 色は `state` から部品が決める（§7.4 の意味の
//   割り当てを 1 箇所に閉じる。`StatusBadge` と同じ理由）。
// - 🔴 **金額の口を持たない。** 利用者に見せる残量は件数単位であり（`CLAUDE.md` §2 課金 /
//   `F-027 AC-6`）、この部品は単位も通貨も知らない（`percent` と語を受けるだけ）。
//   検査は `tests/static/tenant-usage-no-money.test.ts`（走査根に
//   `packages/ui/src/components` が入っている）。
// - 🔴 **`data-testid` を受け取らない。** 掴むのは呼び出し側の包み要素であり、値は
//   文字列リテラルで書かれる（`tests/static/testid-inventory.test.ts` が凍結できる形）。
// - 🔴 **余白を基底に入れない**（`lib/link-classes.ts` の「打ち消せない値を基底に入れない」）。
//   直前の要素との間隔は `className` で呼び出し側が与える。
//
// ============================================================================
// 🔴 なぜ `percent` を受け取り、`value` / `max` から自分で割らないのか
// ============================================================================
// 消費率の算出は `apps/web/lib/usage/format.ts` の `percentUsed`（**`bigint` の厳密な整数
// 演算**。ストレージはバイト数で `Number` の安全整数を超えうる）に在り、API の応答と
// 管理平面の表も同じ値を使う。ここで `value / max` を再計算すると、**同じ画面の中で
// 丸め方が 2 通りになる**（§17.4「同じ計算を 2 箇所に書かない」）。
//
// 🔴 **`percent` は 100 を超えてよい**（件数クォータは超過分が従量に移る = 「300%」と
//    読めるほうが正しい）。**塗りだけを 100% で止める**（バーが器から飛び出さない）。
//
// 🔴 radius は §7.9 の 2 段のうち `rounded-sm`（4px）である ——
//    `rounded-full` は §7.9 が「アバターとカウンタのみ」と定めており
//    （`tests/static/design-tokens.test.ts` の `CIRCLE_ALLOWANCES`）、増やすには改訂が要る。
// 🔴 `'use client'` を宣言しない（状態もイベントハンドラも持たない）。
// 🔴 §7.10 の 8 状態のうち **1 つも取らない** —— メーターは表示であって操作対象ではない
//    （`Badge` と同じ理由。hover で動くと「押せる」と読める）。
import { cn } from '../lib/cn.js';

/**
 * メーターの意味（🔴 **色ではなく意味**。§7.4 の割り当ては下の `METER_FILL_CLASSES` 1 箇所）。
 *
 * | 値 | 意味 | 色 |
 * |---|---|---|
 * | `normal` | 平常。消費していること自体は正常であり**警告ではない** | 無彩（`--color-fg-muted`） |
 * | `warning` | 上限に接近している（§7.4「期限が近い・要注意」） | 橙（`--color-warning`） |
 * | `over` | 上限に到達した（これ以上は止まるか従量に移る） | 赤（`--color-danger`） |
 *
 * 🔴 **4 つ目を作らない。** 増やすと「目立たせたい何か」に使われ、§7.4 の 6 系統が崩れる。
 */
export type MeterState = 'normal' | 'warning' | 'over';

export type MeterProps = {
  /**
   * 消費率（%）。🔴 **100 を超える値を渡してよい**（従量に移行したクォータ）。
   * 塗りは 100% で止まるが、添える数値は渡された値のまま出す。
   */
  readonly percent: number;
  /** 🔴 意味だけを受け取る（色は部品が決める）。 */
  readonly state: MeterState;
  /** 見える語と読み上げの `aria-label`（🔴 文言は呼び出し側が `packages/i18n` から解決する）。 */
  readonly label: string;
  /** 🔴 **余白・幅の調整だけ**（`lib/cn.ts` の規律 1）。色・文字サイズを渡さない。 */
  readonly className?: string;
};

/** 軌道（空の部分）。🔴 地は `--color-bg-inset`（面 = `--color-surface` は部品の面の話であり別物）。 */
const METER_TRACK_CLASSES = 'h-2 w-full overflow-hidden rounded-sm bg-bg-inset';

/** 塗り。🔴 **ここが「意味 → 色」の唯一の写像である**（画面側で階調を選ばせない）。 */
const METER_FILL_CLASSES: Readonly<Record<MeterState, string>> = {
  normal: 'h-2 rounded-sm bg-fg-muted',
  warning: 'h-2 rounded-sm bg-warning',
  over: 'h-2 rounded-sm bg-danger',
};

/** 塗りの幅（0〜100）。🔴 `percent` の側は丸めない（上の 🔴）。 */
export function meterFillPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  return percent > 100 ? 100 : Math.trunc(percent);
}

export function Meter({ percent, state, label, className }: MeterProps) {
  const filled = meterFillPercent(percent);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={filled}
        className={METER_TRACK_CLASSES}
      >
        {/* 🔴 データ由来の割合であり、クラスでは表せない（このファイル冒頭）。 */}
        <div className={METER_FILL_CLASSES[state]} style={{ width: `${String(filled)}%` }} />
      </div>
      <span className="shrink-0 text-xs text-fg-muted">
        {label} {percent}%
      </span>
    </div>
  );
}
