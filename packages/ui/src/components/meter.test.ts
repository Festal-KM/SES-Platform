// packages/ui/src/components/meter.test.ts
// `Meter`（`docs/04` §5-4 / §5-13 の 26 部品目。SP-22 段⑤ = `T-22-14`）の**実行時の壁**。
//
// 🔴 **何を担保するか**: 塗りの幅が 0〜100 に丸まること（**`percent` の側は丸めない**）。
//    旧 `apps/web/lib/usage/format.ts` の `clampPercent` の事例をそのまま移した
//    （125 → 100 / 65 → 65 / `NaN` → 0 / -3 → 0）。**移設で事例を 1 件も落としていない。**
//
// ⚠️ 描画そのもの（class 名・`role="progressbar"`・意味 → 色の写像）はここで見ない
//    （`packages/*/src/**/*.test.ts` は `.ts` だけであり JSX を書けない。`kpi-card.test.ts` と
//    同じ理由で、描画は `apps/web/app/_components/ui-display.render.test.tsx` が固定する）。
import { describe, expect, it } from 'vitest';
import { meterFillPercent } from './meter.js';

describe('meterFillPercent（塗りの幅）', () => {
  it('0〜100 に丸める（旧 `clampPercent` と同じ事例）', () => {
    expect(meterFillPercent(125)).toBe(100);
    expect(meterFillPercent(65)).toBe(65);
    expect(meterFillPercent(100)).toBe(100);
    expect(meterFillPercent(0)).toBe(0);
  });

  it('🔴 有限でない値・負の値は 0（表示で例外を出さない）', () => {
    expect(meterFillPercent(Number.NaN)).toBe(0);
    expect(meterFillPercent(-3)).toBe(0);
    expect(meterFillPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('小数は切り捨てる（`percentUsed` と同じ向き）', () => {
    expect(meterFillPercent(65.9)).toBe(65);
  });
});
