// packages/config/src/anonymize.test.ts
// T-08-01: 🔴 匿名共有の丸めの粒度が、**確定した規則（`docs/03` §4.13.1 = `docs/02` A-04 =
// `docs/04` U-06。[Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5) の回答、2026-09-10）**
// のとおりであることを固定する。
//
// 🔴 なぜ「定数を宣言しただけ」なのにテストを置くか: この 4 つの値は**再識別の防止線そのもの**
//    であり（`CLAUDE.md` §7 の「匿名候補の身元が提案の作成前にホストへ露出した件数 = 0 件」）、
//    表示上の都合で 1 つ緩めるだけで前提が変わる。値を変えるときに**このテストが必ず赤くなる**
//    ことで、`docs/03` §4.13.1 の改訂と再承認（`CLAUDE.md` §8.6 / §8.7）を経ずに変えられない。
import { describe, expect, it } from 'vitest';
import { ANONYMIZE_ROUNDING } from './anonymize.js';

describe('ANONYMIZE_ROUNDING（docs/02 A-04 の確定値）', () => {
  it('🔴 スキルは上位 8 件（スキルの組み合わせが指紋になるため）', () => {
    expect(ANONYMIZE_ROUNDING.maxSkills).toBe(8);
  });

  it('🔴 経験年数は 5 段階（境界は 1 / 3 / 5 / 10 年）', () => {
    expect(ANONYMIZE_ROUNDING.yearsBandBoundaries).toEqual([1, 3, 5, 10]);
    // 5 段階 ⇔ 境界 4 個。ここがずれると区分の数そのものが変わる。
    expect(ANONYMIZE_ROUNDING.yearsBandBoundaries).toHaveLength(4);
  });

  it('🔴 単価は 10 万円刻み・100 万円以上で打ち止め（単価 × 稼働可能時期が最も強く個人を特定する）', () => {
    expect(ANONYMIZE_ROUNDING.priceBucketYen).toBe(100_000);
    expect(ANONYMIZE_ROUNDING.priceCapYen).toBe(1_000_000);
    expect(ANONYMIZE_ROUNDING.priceCapYen % ANONYMIZE_ROUNDING.priceBucketYen).toBe(0);
  });

  it('🔴 粒度の項目が増減していない（項目が増えるときは丸め関数の引数の形も変わる）', () => {
    expect(Object.keys(ANONYMIZE_ROUNDING).sort()).toEqual([
      'maxSkills',
      'priceBucketYen',
      'priceCapYen',
      'yearsBandBoundaries',
    ]);
  });
});
