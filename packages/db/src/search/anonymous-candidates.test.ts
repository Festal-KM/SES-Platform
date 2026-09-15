// packages/db/src/search/anonymous-candidates.test.ts
// T-08-05: 匿名候補への検索条件は丸め後の区分に対して評価する（docs/05 §4.6 線引き表 #8）。
//
// 🔴 固定する性質:
//   ① `q` / `availability`（開示していない属性）を**読まない**（ソースを文字列で走査する）
//   ② ソフト条件の有効判定が自社側（`engineerSearchPlan(criteria).buckets`）と一致する
//   ③ 帯の内側で生値を動かしても `matches` / `bucketOf` が変わらない
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { anonymizeEngineer, type AnonymizeRoundingConfig } from '@ses/domain';
import { anonymousCandidateSearchPlan } from './anonymous-candidates.js';
import { engineerSearchPlan, type EngineerSearchCriteria } from './engineers.js';

const ROUNDING: AnonymizeRoundingConfig = {
  maxSkills: 8,
  yearsBandBoundaries: [1, 3, 5, 10],
  priceBucketYen: 100_000,
  priceCapYen: 1_000_000,
};
const REFERENCE_DATE = '2026-09-14';
const SKILL_JAVA = '01930000-0000-7000-8000-0000000000a1';
const SKILL_AWS = '01930000-0000-7000-8000-0000000000a2';
const SKILL_NAMES = new Map([
  [SKILL_JAVA, 'Java'],
  [SKILL_AWS, 'AWS'],
]);

const BASE: EngineerSearchCriteria = { skillMode: 'AND', onlyInTime: false, onlyCommutable: false };

function attributes(input: {
  years?: number;
  extraSkills?: readonly string[];
  priceYen?: number | null;
  availableFrom?: string | null;
  prefecture?: '13' | '27' | null;
  remoteMode?: 'FULL_REMOTE' | 'PARTIAL_REMOTE' | 'ONSITE_ONLY' | null;
}) {
  return anonymizeEngineer(
    {
      skills: [
        ...(input.years === undefined
          ? []
          : [{ skillId: SKILL_JAVA, sortKey: 1, name: 'Java', yearsOfExperience: input.years }]),
        ...(input.extraSkills ?? []).map((name, index) => ({
          skillId: `x${index}`,
          sortKey: 100 + index,
          name,
          yearsOfExperience: 1,
        })),
      ],
      unitPriceMinYen: input.priceYen ?? null,
      unitPriceMaxYen: input.priceYen ?? null,
      availableFrom: input.availableFrom ?? null,
      prefecture: input.prefecture ?? null,
      city: null,
      remoteMode: input.remoteMode ?? null,
      updatedOnJst: '2026-09-10',
    },
    { referenceDate: REFERENCE_DATE },
    ROUNDING,
  );
}

function plan(criteria: Partial<EngineerSearchCriteria>) {
  return anonymousCandidateSearchPlan(
    { ...BASE, ...criteria },
    { skillNames: SKILL_NAMES, referenceDate: REFERENCE_DATE, rounding: ROUNDING },
  );
}

describe('🔴 開示していない属性を読まない（q / availability）', () => {
  it('ソースに `criteria.q` / `criteria.availability` が現れない', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'anonymous-candidates.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.split('//')[0] ?? '')
      .join('\n');
    expect(source).not.toMatch(/criteria\.q\b/);
    expect(source).not.toMatch(/criteria\.availability\b/);
    // 対照: 開示 5 項目に関する条件は読んでいる。
    expect(source).toMatch(/criteria\.yearsMin\b/);
    expect(source).toMatch(/criteria\.remote\b/);
  });

  it('`q` / `availability` を指定しても匿名候補の判定は変わらない', () => {
    const a = attributes({ years: 7, priceYen: 650_000, availableFrom: '2026-10-01', prefecture: '13' });
    expect(plan({}).matches(a)).toBe(true);
    expect(plan({ q: '山田' }).matches(a)).toBe(true);
    expect(plan({ availability: 'STANDBY' }).matches(a)).toBe(true);
    expect(plan({ availability: 'WORKING' }).matches(a)).toBe(true);
  });
});

describe('ハード条件（母集団）', () => {
  it('スキル AND / OR は表示される名称に対して照合し、辞書に無い ID はどの候補にも当たらない', () => {
    const a = attributes({ years: 7, extraSkills: ['AWS'] });
    expect(plan({ skills: [SKILL_JAVA, SKILL_AWS], skillMode: 'AND' }).matches(a)).toBe(true);
    expect(plan({ skills: [SKILL_JAVA, '01930000-0000-7000-8000-00000000ffff'], skillMode: 'AND' }).matches(a)).toBe(false);
    expect(plan({ skills: [SKILL_JAVA, '01930000-0000-7000-8000-00000000ffff'], skillMode: 'OR' }).matches(a)).toBe(true);
    expect(plan({ skills: ['01930000-0000-7000-8000-00000000ffff'], skillMode: 'OR' }).matches(a)).toBe(false);
  });

  it('🔴 経験年数は帯で判定する（7 年と 9 年は yearsMin=8 でも同じ結果）', () => {
    const seven = attributes({ years: 7 });
    const nine = attributes({ years: 9 });
    for (const yearsMin of [5, 7, 8, 9, 10, 12]) {
      expect(plan({ yearsMin }).matches(seven)).toBe(plan({ yearsMin }).matches(nine));
    }
    expect(plan({ yearsMin: 9 }).matches(seven)).toBe(true);
    expect(plan({ yearsMin: 10 }).matches(seven)).toBe(false);
  });

  it('🔴 単価は帯で判定する（65 万円と 68 万円はどのレンジでも同じ結果）', () => {
    const a = attributes({ priceYen: 650_000 });
    const b = attributes({ priceYen: 680_000 });
    for (const [priceMin, priceMax] of [
      [undefined, 660_000],
      [660_000, undefined],
      [670_000, 670_000],
      [undefined, 590_000],
      [700_000, undefined],
    ] as const) {
      expect(plan({ priceMin, priceMax }).matches(a)).toBe(plan({ priceMin, priceMax }).matches(b));
    }
    expect(plan({ priceMax: 590_000 }).matches(a)).toBe(false);
    expect(plan({ priceMin: 700_000 }).matches(a)).toBe(false);
  });

  it('リモート可否はハード条件（開示値そのまま。未設定は一致しない）', () => {
    expect(plan({ remote: 'FULL_REMOTE' }).matches(attributes({ remoteMode: 'FULL_REMOTE' }))).toBe(true);
    expect(plan({ remote: 'FULL_REMOTE' }).matches(attributes({ remoteMode: 'ONSITE_ONLY' }))).toBe(false);
    expect(plan({ remote: 'FULL_REMOTE' }).matches(attributes({ remoteMode: null }))).toBe(false);
  });

  it('チェックボックスがオンなら稼働可能時期・勤務地が母集団を絞る（帯で判定）', () => {
    const nextMonth = attributes({ availableFrom: '2026-10-20', prefecture: '27', remoteMode: 'ONSITE_ONLY' });
    expect(plan({ availableBy: '2026-09-30', onlyInTime: true }).matches(nextMonth)).toBe(false);
    // 🔴 翌月の帯は「10 月 1 日から稼働できるかもしれない」ので 10 月 5 日までなら重なりうる。
    expect(plan({ availableBy: '2026-10-05', onlyInTime: true }).matches(nextMonth)).toBe(true);
    expect(plan({ prefecture: '13', onlyCommutable: true }).matches(nextMonth)).toBe(false);
    expect(plan({ prefecture: '27', onlyCommutable: true }).matches(nextMonth)).toBe(true);
    // オフなら母集団には残る（並びで後ろに回るだけ）。
    expect(plan({ availableBy: '2026-09-30', prefecture: '13' }).matches(nextMonth)).toBe(true);
  });
});

describe('ソフト条件（バケット）— 自社側の分割と一致する', () => {
  const cases: readonly Partial<EngineerSearchCriteria>[] = [
    {},
    { availableBy: '2026-09-30' },
    { prefecture: '13' },
    { availableBy: '2026-09-30', prefecture: '13' },
    { availableBy: '2026-09-30', onlyInTime: true },
    { prefecture: '13', onlyCommutable: true },
    { availableBy: '2026-09-30', prefecture: '13', onlyInTime: true, onlyCommutable: true },
  ];

  it.each(cases)('%j: 分割の有無が engineerSearchPlan(criteria).buckets.length と一致する', (criteria) => {
    const full = { ...BASE, ...criteria };
    const splits = engineerSearchPlan(full).buckets.length > 1;
    const anonymous = plan(criteria);
    const fit = attributes({ availableFrom: '2026-09-01', prefecture: '13', remoteMode: 'ONSITE_ONLY' });
    const miss = attributes({ availableFrom: '2026-12-01', prefecture: '27', remoteMode: 'ONSITE_ONLY' });
    expect(anonymous.bucketOf(fit)).toBe(0);
    expect(anonymous.bucketOf(miss)).toBe(splits ? 1 : 0);
  });

  it('適合は「有効なソフト条件をすべて満たす」の 1 ビット（片方だけ満たす候補も不適合側）', () => {
    const p = plan({ availableBy: '2026-09-30', prefecture: '13' });
    expect(p.bucketOf(attributes({ availableFrom: '2026-09-01', prefecture: '27', remoteMode: 'ONSITE_ONLY' }))).toBe(1);
    expect(p.bucketOf(attributes({ availableFrom: '2026-12-01', prefecture: '13' }))).toBe(1);
    expect(p.bucketOf(attributes({ availableFrom: '2026-09-01', prefecture: '27', remoteMode: 'FULL_REMOTE' }))).toBe(0);
  });

  it('稼働可能時期が未設定（null）は不適合側（自社側の inTimeCondition と同じ向き）', () => {
    expect(plan({ availableBy: '2026-12-31' }).bucketOf(attributes({ availableFrom: null }))).toBe(1);
  });
});
