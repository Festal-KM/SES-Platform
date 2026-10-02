// packages/ui/src/components/kpi-card.test.ts
// 🔴 **実行時の壁（枚数の上限・下限と「0 枚なら描かない」）を固定する。** 2026-10-02 のブリーフ。
//
// なぜ要るか: `docs/04` §7.2 の禁止の本体は **「朝一番に目に入るものが、行動の変わらない数値で
// あること」**を避けることである。KPI カードはその禁止のすぐ隣に在るので、**枚数が増える経路**
// （5 枚目・1 枚だけ・0 枚の空の箱）を壁として塞いだ。🔴 **壁はコメントではなく例外で表す** ——
// `SummaryStrip` / `DropdownMenu` / `Tabs` と同じ形である。
//
// ⚠️ 描画そのもの（class 名・DOM）はここで見ない（`packages/*/src/**/*.test.ts` は
//    `vitest.config.ts` の include で `.ts` だけであり、JSX の描画は
//    `apps/web/app/_components/*.render.test.tsx` の役目である）。
import { describe, expect, it } from 'vitest';
import {
  KPI_CARD_ROW_MAX_ITEMS,
  KPI_CARD_ROW_MIN_ITEMS,
  KpiCardRow,
  type KpiCardItem,
} from './kpi-card.js';

function items(count: number): readonly KpiCardItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `k${String(index)}`,
    icon: 'briefcase' as const,
    label: `指標 ${String(index)}`,
    value: '12',
    unit: '件',
    delta: null,
  }));
}

describe('KpiCardRow の壁（docs/04 §7.2）', () => {
  it('🔴 上限は 4 枚である（5 枚目は落とす）', () => {
    expect(KPI_CARD_ROW_MAX_ITEMS).toBe(4);
    expect(() => KpiCardRow({ items: items(5), testIdPrefix: 'home-host-kpi-' })).toThrow(/4 枚まで/);
  });

  it('🔴 下限は 2 枚である（1 枚は「ただの大きな数字」なので落とす）', () => {
    expect(KPI_CARD_ROW_MIN_ITEMS).toBe(2);
    expect(() => KpiCardRow({ items: items(1), testIdPrefix: 'home-host-kpi-' })).toThrow(/2 枚以上/);
  });

  it('🔴 0 枚は「描かない」であって違反ではない（空の箱を出さない）', () => {
    expect(KpiCardRow({ items: [], testIdPrefix: 'home-host-kpi-' })).toBeNull();
  });

  it('2〜4 枚は通る（壁が通常の枚数を塞いでいない）', () => {
    for (const count of [2, 3, 4]) {
      expect(() => KpiCardRow({ items: items(count), testIdPrefix: 'home-host-kpi-' })).not.toThrow();
    }
  });
});
