// packages/db/seed/rng.ts
// 🔴 固定シード値の疑似乱数（docs/05 §13.6 / docs/03 §4.19「TypeScript のシードスクリプト +
//    固定シード値の疑似乱数（seedrandom）」）。**同じ入力から同じデータ**（F-053 AC-2）。
//
// 🔴 `Math.random()` を使わない。使うと `reset()` → `seed()` の再生成で別のデータになり、
//    「冪等に再生成できる」（F-053 AC-2）が成立しなくなる。
import seedrandom from 'seedrandom';

export type SeedRng = {
  /** [0, 1) の疑似乱数。 */
  next(): number;
  /** [minInclusive, maxInclusive] の整数。 */
  int(minInclusive: number, maxInclusive: number): number;
  /** 配列から 1 つ選ぶ（空配列は例外）。 */
  pick<T>(values: readonly T[]): T;
};

/**
 * 🔴 プリセットごとに固定のシード文字列を渡す（`ses-isolation-v1` など）。
 *    バージョン接尾辞を付けるのは、生成内容を意図的に変えたときに「前と違う」ことを
 *    シード名で表明できるようにするため。
 */
export function createSeedRng(seed: string): SeedRng {
  const random = seedrandom(seed);
  const next = (): number => random();
  return {
    next,
    int(minInclusive: number, maxInclusive: number): number {
      if (maxInclusive < minInclusive) {
        throw new Error(`int(${minInclusive}, ${maxInclusive}): 範囲が逆転しています。`);
      }
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new Error('pick(): 空配列からは選べません。');
      return values[Math.floor(next() * values.length)] as T;
    },
  };
}
