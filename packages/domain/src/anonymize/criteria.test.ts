// packages/domain/src/anonymize/criteria.test.ts
// T-08-05: 匿名候補への検索条件は丸めた後の区分に対して評価する（`docs/05` §4.6 線引き表 #8）。
//
// 🔴 中心の性質は「**帯の内側で生値をどう動かしても判定が変わらない**」ことである。
//    生値 7 年と 9 年は同じ帯（`Y5_10`）に落ちるので、`yearsMin` をどう刻んでも
//    2 人の当たり方が分かれてはならない（分かれれば、当たり方から生値が復元できる）。
import { describe, expect, it } from 'vitest';
import {
  anonymousMayCommute,
  anonymousSkillsInclude,
  availabilityBandMayBeBy,
  priceBandMayOverlap,
  yearsBandMayReach,
} from './criteria.js';
import { anonymizeEngineer, type AnonymizeRoundingConfig } from './rounding.js';

const CONFIG: AnonymizeRoundingConfig = {
  maxSkills: 8,
  yearsBandBoundaries: [1, 3, 5, 10],
  priceBucketYen: 100_000,
  priceCapYen: 1_000_000,
};
const REFERENCE_DATE = '2026-09-14';

function rounded(input: {
  years?: number;
  priceMinYen?: number | null;
  priceMaxYen?: number | null;
  availableFrom?: string | null;
}) {
  return anonymizeEngineer(
    {
      skills:
        input.years === undefined
          ? []
          : [{ skillId: 's1', sortKey: 1, name: 'Java', yearsOfExperience: input.years }],
      unitPriceMinYen: input.priceMinYen ?? null,
      unitPriceMaxYen: input.priceMaxYen ?? null,
      availableFrom: input.availableFrom ?? null,
      prefecture: '13',
      city: null,
      remoteMode: 'ONSITE_ONLY',
      updatedOnJst: '2026-09-10',
    },
    { referenceDate: REFERENCE_DATE },
    CONFIG,
  );
}

describe('yearsBandMayReach（経験年数の帯 × yearsMin）', () => {
  it('帯の上限が yearsMin より大きければ満たしうる（Y5_10 は 5〜9.9 のどの yearsMin でも同じ判定）', () => {
    for (const yearsMin of [5, 6, 7, 8, 9, 9.5]) {
      expect(yearsBandMayReach('Y5_10', yearsMin, CONFIG.yearsBandBoundaries)).toBe(true);
    }
    expect(yearsBandMayReach('Y5_10', 10, CONFIG.yearsBandBoundaries)).toBe(false);
    expect(yearsBandMayReach('Y5_10', 12, CONFIG.yearsBandBoundaries)).toBe(false);
  });

  it('🔴 帯の内側で生値を動かしても当たり方が分かれない（7 年と 9 年は yearsMin=8 で同じ判定）', () => {
    const seven = rounded({ years: 7 });
    const nine = rounded({ years: 9 });
    expect(seven.yearsBand).toBe(nine.yearsBand);
    for (const yearsMin of [0, 5, 7, 7.5, 8, 9, 9.9, 10]) {
      expect(yearsBandMayReach(seven.yearsBand, yearsMin, CONFIG.yearsBandBoundaries)).toBe(
        yearsBandMayReach(nine.yearsBand, yearsMin, CONFIG.yearsBandBoundaries),
      );
    }
  });

  it('GTE_10Y は上限が無いので常に満たしうる / LT_1Y は 1 未満だけ', () => {
    expect(yearsBandMayReach('GTE_10Y', 30, CONFIG.yearsBandBoundaries)).toBe(true);
    expect(yearsBandMayReach('LT_1Y', 0.5, CONFIG.yearsBandBoundaries)).toBe(true);
    expect(yearsBandMayReach('LT_1Y', 1, CONFIG.yearsBandBoundaries)).toBe(false);
  });

  it('スキル 0 件（null）は満たさない（自社側の `engineerSkills.some` と同じ向き）', () => {
    expect(yearsBandMayReach(null, 1, CONFIG.yearsBandBoundaries)).toBe(false);
  });
});

describe('priceBandMayOverlap（単価の帯 × 検索レンジ）', () => {
  it('60〜70 万円の帯は priceMax が 60 万円以上なら重なりうる（帯の内側の刻みで変わらない）', () => {
    const band = rounded({ priceMinYen: 650_000, priceMaxYen: 650_000 }).priceBand;
    expect(band).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 70 });
    for (const priceMax of [600_000, 640_000, 650_000, 660_000, 699_999, 900_000]) {
      expect(priceBandMayOverlap(band, undefined, priceMax)).toBe(true);
    }
    expect(priceBandMayOverlap(band, undefined, 599_999)).toBe(false);
  });

  it('priceMin は帯の上限（未満）と比べる（70 万円ちょうどは重ならない）', () => {
    const band = rounded({ priceMinYen: 650_000, priceMaxYen: 650_000 }).priceBand;
    expect(priceBandMayOverlap(band, 699_999, undefined)).toBe(true);
    expect(priceBandMayOverlap(band, 700_000, undefined)).toBe(false);
  });

  it('🔴 65 万円と 68 万円は同じ帯なので、どのレンジでも当たり方が分かれない', () => {
    const a = rounded({ priceMinYen: 650_000, priceMaxYen: 650_000 }).priceBand;
    const b = rounded({ priceMinYen: 680_000, priceMaxYen: 680_000 }).priceBand;
    for (const [min, max] of [
      [undefined, 660_000],
      [660_000, undefined],
      [670_000, 670_000],
      [600_000, 700_000],
    ] as const) {
      expect(priceBandMayOverlap(a, min, max)).toBe(priceBandMayOverlap(b, min, max));
    }
  });

  it('OPEN（100 万円以上）は priceMin では外れず、priceMax が下限未満なら外れる', () => {
    const band = rounded({ priceMinYen: 1_200_000, priceMaxYen: 1_200_000 }).priceBand;
    expect(band).toEqual({ kind: 'OPEN', fromManYen: 100 });
    expect(priceBandMayOverlap(band, 5_000_000, undefined)).toBe(true);
    expect(priceBandMayOverlap(band, undefined, 999_999)).toBe(false);
    expect(priceBandMayOverlap(band, undefined, 1_000_000)).toBe(true);
  });

  it('単価未設定（null）は制約なしとして重なる', () => {
    expect(priceBandMayOverlap(null, 1, 2)).toBe(true);
  });
});

describe('availabilityBandMayBeBy（稼働可能時期の帯 × availableBy）', () => {
  it('IMMEDIATE は常に / THIS_MONTH は基準日より後 / NEXT_MONTH は翌月初以降', () => {
    expect(availabilityBandMayBeBy('IMMEDIATE', '2026-01-01', REFERENCE_DATE)).toBe(true);
    expect(availabilityBandMayBeBy('THIS_MONTH', REFERENCE_DATE, REFERENCE_DATE)).toBe(false);
    expect(availabilityBandMayBeBy('THIS_MONTH', '2026-09-15', REFERENCE_DATE)).toBe(true);
    expect(availabilityBandMayBeBy('NEXT_MONTH', '2026-09-30', REFERENCE_DATE)).toBe(false);
    expect(availabilityBandMayBeBy('NEXT_MONTH', '2026-10-01', REFERENCE_DATE)).toBe(true);
    expect(availabilityBandMayBeBy('MONTH_AFTER_NEXT', '2026-10-31', REFERENCE_DATE)).toBe(false);
    expect(availabilityBandMayBeBy('MONTH_AFTER_NEXT', '2026-11-01', REFERENCE_DATE)).toBe(true);
    expect(availabilityBandMayBeBy('THREE_MONTHS_OR_LATER', '2026-11-30', REFERENCE_DATE)).toBe(
      false,
    );
    expect(availabilityBandMayBeBy('THREE_MONTHS_OR_LATER', '2026-12-01', REFERENCE_DATE)).toBe(
      true,
    );
  });

  it('年をまたぐ月初の計算（12 月基準の翌月は翌年 1 月）', () => {
    expect(availabilityBandMayBeBy('NEXT_MONTH', '2026-12-31', '2026-12-05')).toBe(false);
    expect(availabilityBandMayBeBy('NEXT_MONTH', '2027-01-01', '2026-12-05')).toBe(true);
    expect(availabilityBandMayBeBy('THREE_MONTHS_OR_LATER', '2027-03-01', '2026-12-05')).toBe(true);
    expect(availabilityBandMayBeBy('THREE_MONTHS_OR_LATER', '2027-02-28', '2026-12-05')).toBe(false);
  });

  it('🔴 翌月の 1 日と 25 日は同じ帯なので、availableBy を 1 日刻みで動かしても当たり方が分かれない', () => {
    const early = rounded({ availableFrom: '2026-10-01' }).availabilityBand;
    const late = rounded({ availableFrom: '2026-10-25' }).availabilityBand;
    expect(early).toBe('NEXT_MONTH');
    expect(late).toBe('NEXT_MONTH');
    for (const day of ['2026-09-30', '2026-10-01', '2026-10-10', '2026-10-24', '2026-10-25', '2026-10-26']) {
      expect(availabilityBandMayBeBy(early, day, REFERENCE_DATE)).toBe(
        availabilityBandMayBeBy(late, day, REFERENCE_DATE),
      );
    }
  });

  it('未設定（null）は満たさない（自社側の `inTimeCondition` と同じ向き）', () => {
    expect(availabilityBandMayBeBy(null, '2099-12-31', REFERENCE_DATE)).toBe(false);
  });

  it('時刻付きの日付は RangeError（値はメッセージに載らない）', () => {
    expect(() =>
      availabilityBandMayBeBy('IMMEDIATE', '2026-10-01T00:00:00.000Z', REFERENCE_DATE),
    ).toThrow(RangeError);
    try {
      availabilityBandMayBeBy('IMMEDIATE', '2026-10-01', '2026-09-14T09:00:00Z');
    } catch (error) {
      expect((error as Error).message).not.toContain('09:00');
    }
  });
});

describe('anonymousMayCommute / anonymousSkillsInclude', () => {
  it('勤務地の一致またはフルリモート可で通勤可能', () => {
    expect(anonymousMayCommute({ prefecture: '13', remoteMode: 'ONSITE_ONLY' }, '13')).toBe(true);
    expect(anonymousMayCommute({ prefecture: '27', remoteMode: 'ONSITE_ONLY' }, '13')).toBe(false);
    expect(anonymousMayCommute({ prefecture: '27', remoteMode: 'FULL_REMOTE' }, '13')).toBe(true);
    expect(anonymousMayCommute({ prefecture: null, remoteMode: 'PARTIAL_REMOTE' }, '13')).toBe(false);
  });

  it('スキルは表示される名称に対してだけ照合する（AND / OR）', () => {
    const skills = [{ name: 'Java' }, { name: 'AWS' }];
    expect(anonymousSkillsInclude(skills, [], 'AND')).toBe(true);
    expect(anonymousSkillsInclude(skills, ['Java', 'AWS'], 'AND')).toBe(true);
    expect(anonymousSkillsInclude(skills, ['Java', 'Go'], 'AND')).toBe(false);
    expect(anonymousSkillsInclude(skills, ['Java', 'Go'], 'OR')).toBe(true);
    expect(anonymousSkillsInclude(skills, ['Go'], 'OR')).toBe(false);
  });

  it('🔴 9 件目以降のスキル（表示されない）は当たらない', () => {
    const view = anonymizeEngineer(
      {
        skills: Array.from({ length: 9 }, (_, i) => ({
          skillId: `s${i}`,
          sortKey: i,
          name: `Skill${i}`,
          yearsOfExperience: 9 - i,
        })),
        unitPriceMinYen: null,
        unitPriceMaxYen: null,
        availableFrom: null,
        prefecture: null,
        city: null,
        remoteMode: null,
        updatedOnJst: '2026-09-10',
      },
      { referenceDate: REFERENCE_DATE },
      CONFIG,
    );
    expect(view.skills).toHaveLength(8);
    expect(anonymousSkillsInclude(view.skills, ['Skill7'], 'AND')).toBe(true);
    expect(anonymousSkillsInclude(view.skills, ['Skill8'], 'AND')).toBe(false);
  });
});
