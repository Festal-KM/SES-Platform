// packages/domain/src/anonymize/rounding.test.ts
// T-08-01（`docs/sprints/SP-08-anonymous-share.md` §5）/ `F-017 AC-3` / `docs/02` A-04。
//
// 🔴 本テストが証明するのは 3 つである:
//   ①丸め規則どおりの粒度でのみ値が出ること（境界値を含む）
//   ②🔴 **丸める前の値が出力のどこにも現れないこと** —— 目視ではなく、出力オブジェクトを
//     **再帰的に走査**して機械的に検査する。将来フィールドが 1 つ増えたときに、
//     テストが自動で捕まえるため（開示項目の追加は人間の承認事項。`BR-54` / `CLAUDE.md` §8.6）
//   ③決定性 —— 同じ入力（基準日を含む）で必ず同じ出力。同じ候補の見え方が実行のたびに
//     変わると、営業判断の根拠にも監査の根拠にもならない
import { describe, expect, it } from 'vitest';
import {
  ANONYMIZED_AVAILABILITY_BANDS,
  ANONYMIZED_YEARS_BANDS,
  anonymizeEngineer,
  type AnonymizeContext,
  type AnonymizedAvailabilityBand,
  type AnonymizedPriceBand,
  type AnonymizedYearsBand,
  type AnonymizeEngineerInput,
  type AnonymizeRoundingConfig,
  type AnonymizeSkillInput,
} from './rounding.js';

/**
 * 🔴 `packages/config` の `ANONYMIZE_ROUNDING`（`docs/02` A-04 の確定値）と**同じ値**。
 *    `packages/domain` は `@ses/config` を import できない（`CLAUDE.md` §2.1）ため、
 *    ここに書き写している。両者が一致していることは
 *    `tests/static/anonymize-rounding-mirror.test.ts` が機械的に突合する。
 */
const A04: AnonymizeRoundingConfig = {
  maxSkills: 8,
  yearsBandBoundaries: [1, 3, 5, 10],
  priceBucketYen: 100_000,
  priceCapYen: 1_000_000,
};

const CONTEXT: AnonymizeContext = { referenceDate: '2026-09-10' };

/**
 * 🔴 **出力に現れてはならない値**を、それと分かる形で仕込んだ入力。
 *    `F-017 AC-3` の例（経験年数 7 年 / 単価 65 万円 / 勤務地「東京都渋谷区」/
 *    稼働開始日 2026-09-16）をそのまま使う。
 */
function baseInput(overrides: Partial<AnonymizeEngineerInput> = {}): AnonymizeEngineerInput {
  return {
    skills: [skill({ name: 'Java', yearsOfExperience: 7 })],
    unitPriceMinYen: 650_000,
    unitPriceMaxYen: 650_000,
    availableFrom: '2026-09-16',
    prefecture: '13',
    city: '渋谷区',
    remoteMode: 'PARTIAL_REMOTE',
    updatedOnJst: '2026-09-08',
    ...overrides,
  };
}

let skillSeq = 0;

function skill(overrides: Partial<AnonymizeSkillInput> = {}): AnonymizeSkillInput {
  skillSeq += 1;
  return {
    // 🔴 出力に載ってはならない値（辞書 ID / 並び順キー）は、桁数でも見分けが付く値にする。
    skillId: `skill-id-must-not-leak-${skillSeq}`,
    sortKey: 987_650 + skillSeq,
    name: `Skill${skillSeq}`,
    yearsOfExperience: 1,
    ...overrides,
  };
}

type Scalars = { readonly strings: string[]; readonly numbers: number[] };

/** 出力オブジェクトを再帰的に走査し、含まれるすべての文字列・数値を集める。 */
function collectScalars(value: unknown, acc: Scalars = { strings: [], numbers: [] }): Scalars {
  if (typeof value === 'string') acc.strings.push(value);
  else if (typeof value === 'number') acc.numbers.push(value);
  else if (typeof value === 'bigint') acc.numbers.push(Number(value));
  else if (Array.isArray(value)) for (const item of value) collectScalars(item, acc);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      // 🔴 キー名も検査対象にする（`city: null` のようにキーだけ増えても検知する）。
      acc.strings.push(key);
      collectScalars(item, acc);
    }
  }
  return acc;
}

describe('anonymizeEngineer — F-017 AC-3 の丸め規則（docs/02 A-04）', () => {
  it('経験年数 7 年 → 5〜10 年の区分 / 単価 65 万円 → 60〜70 万円 / 勤務地「東京都渋谷区」→ 東京都のみ', () => {
    const result = anonymizeEngineer(baseInput(), CONTEXT, A04);

    expect(result.yearsBand).toBe('Y5_10');
    expect(result.priceBand).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 70 });
    // 🔴 勤務地は都道府県コードのみ（`13` の表示名「東京都」は packages/i18n が持つ）。
    expect(result.prefecture).toBe('13');
    expect(result.remoteMode).toBe('PARTIAL_REMOTE');
    // 2026-09-16 は基準日（2026-09-10）と同月 → `当月中`。日付そのものは出さない。
    expect(result.availabilityBand).toBe('THIS_MONTH');
    expect(result.updatedOn).toBe('2026-09-08');
  });

  it('🔴 `7 年` / `65 万円` / `渋谷区` / 具体日付（2026-09-16）のいずれも出力に現れない', () => {
    const input = baseInput();
    const result = anonymizeEngineer(input, CONTEXT, A04);
    const { strings, numbers } = collectScalars(result);
    const serialized = JSON.stringify(result);

    // ① 生の年数（7）と生の金額（650000）が、数値としても文字列としても現れない。
    expect(numbers).not.toContain(7);
    expect(numbers).not.toContain(650_000);
    expect(serialized).not.toContain('650000');
    expect(serialized).not.toMatch(/7\s*年/);

    // ② 市区町村（および沿線・駅名の類）が現れない。
    const city = input.city ?? '';
    expect(city).not.toBe('');
    expect(serialized).not.toContain('渋谷区');
    for (const value of strings) expect(value).not.toContain(city);

    // ③ 具体的な稼働開始日が現れない。
    expect(serialized).not.toContain('2026-09-16');

    // ④ 辞書 ID・並び順キー（追跡に使えうる内部値）が現れない。
    for (const s of input.skills) {
      expect(serialized).not.toContain(s.skillId);
      expect(serialized).not.toContain(String(s.sortKey));
    }
  });

  it('🔴 汎用の禁止パターン: 生の金額の桁・時刻付きのタイムスタンプが出力に現れない（将来の項目追加を機械的に捕まえる）', () => {
    const result = anonymizeEngineer(baseInput(), CONTEXT, A04);
    const { strings, numbers } = collectScalars(result);

    for (const value of numbers) {
      // 🔴 出す数値は「万円」の刻みだけである。円単位の生の金額（5 桁以上）は出さない。
      expect(Math.abs(value)).toBeLessThan(1_000);
    }
    for (const value of strings) {
      // 🔴 5 桁以上連続する数字（円単位の金額・連番 ID の類）を含まない。
      //    `2026-09-08` の年（4 桁）は通る。
      expect(value).not.toMatch(/\d{5}/);
      // 🔴 時刻を含む ISO 日時（＝ 個人の活動時刻）を含まない（docs/03 §4.13.2-2）。
      expect(value).not.toMatch(/\d{2}:\d{2}/);
      expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('🔴 出力のキーが 5 項目 + 更新日に固定されている（項目が増えたら落ちる。BR-54 / CLAUDE.md §8.6）', () => {
    const result = anonymizeEngineer(baseInput(), CONTEXT, A04);

    expect(Object.keys(result).sort()).toEqual([
      'availabilityBand',
      'prefecture',
      'priceBand',
      'remoteMode',
      'skills',
      'updatedOn',
      'yearsBand',
    ]);
    // スキル 1 件が持つのは名称だけ（経験年数・辞書 ID を持たない）。
    for (const entry of result.skills) expect(Object.keys(entry)).toEqual(['name']);
  });
});

const YEARS_CASES: [number, AnonymizedYearsBand][] = [
  [0, 'LT_1Y'],
  [0.9, 'LT_1Y'],
  [1, 'Y1_3'],
  [2.9, 'Y1_3'],
  [3, 'Y3_5'],
  [4.9, 'Y3_5'],
  [5, 'Y5_10'],
  [7, 'Y5_10'],
  [9.9, 'Y5_10'],
  [10, 'GTE_10Y'],
  [30, 'GTE_10Y'],
];

describe('anonymizeEngineer — 経験年数の 5 段階（境界値）', () => {
  it.each(YEARS_CASES)('経験年数 %s 年 → %s', (years, band) => {
    const result = anonymizeEngineer(
      baseInput({ skills: [skill({ yearsOfExperience: years })] }),
      CONTEXT,
      A04,
    );
    expect(result.yearsBand).toBe(band);
  });

  it('🔴 集約は「登録スキルの経験年数の最大値」である（T-06-04 の決着。検索の yearsMin と同じ定義）', () => {
    const result = anonymizeEngineer(
      baseInput({
        skills: [
          skill({ yearsOfExperience: 1 }),
          skill({ yearsOfExperience: 7 }),
          skill({ yearsOfExperience: 2 }),
        ],
      }),
      CONTEXT,
      A04,
    );
    expect(result.yearsBand).toBe('Y5_10');
  });

  it('スキルが 0 件なら経験年数は未設定（`1 年未満` と偽らない）', () => {
    const result = anonymizeEngineer(baseInput({ skills: [] }), CONTEXT, A04);
    expect(result.yearsBand).toBeNull();
    expect(result.skills).toEqual([]);
  });

  it('区分は 5 つで、どの年数でもその 5 つのいずれかに収まる', () => {
    expect(ANONYMIZED_YEARS_BANDS).toHaveLength(5);
    for (const years of [0, 0.5, 1, 3, 5, 10, 50]) {
      const result = anonymizeEngineer(
        baseInput({ skills: [skill({ yearsOfExperience: years })] }),
        CONTEXT,
        A04,
      );
      expect(ANONYMIZED_YEARS_BANDS).toContain(result.yearsBand);
    }
  });
});

const PRICE_CASES: [number, number, AnonymizedPriceBand][] = [
  [600_000, 600_000, { kind: 'RANGE', fromManYen: 60, toManYen: 70 }],
  [650_000, 650_000, { kind: 'RANGE', fromManYen: 60, toManYen: 70 }],
  [699_999, 699_999, { kind: 'RANGE', fromManYen: 60, toManYen: 70 }],
  [700_000, 700_000, { kind: 'RANGE', fromManYen: 70, toManYen: 80 }],
  [0, 0, { kind: 'RANGE', fromManYen: 0, toManYen: 10 }],
  // レンジが複数の刻みにまたがる場合は、下端の床と上端の次の目盛りで挟む。
  [600_000, 750_000, { kind: 'RANGE', fromManYen: 60, toManYen: 80 }],
  // 🔴 打ち止め: 100 万円以上は 1 区分にまとめる。
  [1_000_000, 1_000_000, { kind: 'OPEN', fromManYen: 100 }],
  [1_500_000, 2_000_000, { kind: 'OPEN', fromManYen: 100 }],
  // 🔴 打ち止めをまたぐレンジは上端を偽らず「N 万円以上」にする。
  [950_000, 1_200_000, { kind: 'OPEN', fromManYen: 90 }],
];

describe('anonymizeEngineer — 単価の 10 万円刻み（境界値と打ち止め）', () => {
  it.each(PRICE_CASES)('単価 %s〜%s 円 → %o', (min, max, band) => {
    const result = anonymizeEngineer(
      baseInput({ unitPriceMinYen: min, unitPriceMaxYen: max }),
      CONTEXT,
      A04,
    );
    expect(result.priceBand).toEqual(band);
  });

  it('片側だけの登録は、その 1 点として丸める', () => {
    expect(
      anonymizeEngineer(
        baseInput({ unitPriceMinYen: 650_000, unitPriceMaxYen: null }),
        CONTEXT,
        A04,
      ).priceBand,
    ).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 70 });
    expect(
      anonymizeEngineer(
        baseInput({ unitPriceMinYen: null, unitPriceMaxYen: 650_000 }),
        CONTEXT,
        A04,
      ).priceBand,
    ).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 70 });
  });

  it('単価が未設定なら null（0 円に畳まない）', () => {
    const result = anonymizeEngineer(
      baseInput({ unitPriceMinYen: null, unitPriceMaxYen: null }),
      CONTEXT,
      A04,
    );
    expect(result.priceBand).toBeNull();
  });

  it('🔴 上下が逆転した行でも決定的に同じ帯を返す（台帳に CHECK が無いため）', () => {
    const forward = anonymizeEngineer(
      baseInput({ unitPriceMinYen: 600_000, unitPriceMaxYen: 750_000 }),
      CONTEXT,
      A04,
    );
    const reversed = anonymizeEngineer(
      baseInput({ unitPriceMinYen: 750_000, unitPriceMaxYen: 600_000 }),
      CONTEXT,
      A04,
    );
    expect(reversed.priceBand).toEqual(forward.priceBand);
  });
});

const AVAILABILITY_CASES: [string, AnonymizedAvailabilityBand][] = [
  ['2026-08-01', 'IMMEDIATE'], // 過去日
  ['2026-09-10', 'IMMEDIATE'], // 当日
  ['2026-09-11', 'THIS_MONTH'],
  ['2026-09-30', 'THIS_MONTH'],
  ['2026-10-01', 'NEXT_MONTH'],
  ['2026-10-31', 'NEXT_MONTH'],
  ['2026-11-01', 'MONTH_AFTER_NEXT'],
  ['2026-12-01', 'THREE_MONTHS_OR_LATER'],
  ['2027-03-01', 'THREE_MONTHS_OR_LATER'],
];

describe('anonymizeEngineer — 稼働可能時期の 5 段階（基準日は引数）', () => {
  it.each(AVAILABILITY_CASES)('基準日 2026-09-10 / 稼働可能 %s → %s', (availableFrom, band) => {
    const result = anonymizeEngineer(baseInput({ availableFrom }), CONTEXT, A04);
    expect(result.availabilityBand).toBe(band);
    expect(ANONYMIZED_AVAILABILITY_BANDS).toContain(result.availabilityBand);
  });

  it('年をまたぐ（12 月基準）場合も月数で判定する', () => {
    const context: AnonymizeContext = { referenceDate: '2026-12-20' };
    expect(
      anonymizeEngineer(baseInput({ availableFrom: '2027-01-05' }), context, A04)
        .availabilityBand,
    ).toBe('NEXT_MONTH');
    expect(
      anonymizeEngineer(baseInput({ availableFrom: '2027-02-05' }), context, A04)
        .availabilityBand,
    ).toBe('MONTH_AFTER_NEXT');
    expect(
      anonymizeEngineer(baseInput({ availableFrom: '2027-03-05' }), context, A04)
        .availabilityBand,
    ).toBe('THREE_MONTHS_OR_LATER');
  });

  it('稼働可能時期が未設定なら null', () => {
    const result = anonymizeEngineer(baseInput({ availableFrom: null }), CONTEXT, A04);
    expect(result.availabilityBand).toBeNull();
  });

  it('🔴 基準日が違えば区分は変わる（＝ 現在時刻を関数の中で取らないことの裏返し）', () => {
    const input = baseInput({ availableFrom: '2026-10-01' });
    expect(
      anonymizeEngineer(input, { referenceDate: '2026-09-10' }, A04).availabilityBand,
    ).toBe('NEXT_MONTH');
    expect(
      anonymizeEngineer(input, { referenceDate: '2026-10-01' }, A04).availabilityBand,
    ).toBe('IMMEDIATE');
  });
});

describe('anonymizeEngineer — スキルは辞書名の上位 8 件（A-04 ①）', () => {
  const many: readonly AnonymizeSkillInput[] = [
    skill({ name: 'S-01', yearsOfExperience: 10 }),
    skill({ name: 'S-02', yearsOfExperience: 9 }),
    skill({ name: 'S-03', yearsOfExperience: 8 }),
    skill({ name: 'S-04', yearsOfExperience: 7 }),
    skill({ name: 'S-05', yearsOfExperience: 6 }),
    skill({ name: 'S-06', yearsOfExperience: 5 }),
    skill({ name: 'S-07', yearsOfExperience: 4 }),
    skill({ name: 'S-08', yearsOfExperience: 3 }),
    skill({ name: 'S-09', yearsOfExperience: 2 }),
    skill({ name: 'S-10', yearsOfExperience: 1 }),
  ];

  it('9 件以上のスキルを持つ候補でも、経験年数の降順で上位 8 件だけが出る', () => {
    const result = anonymizeEngineer(baseInput({ skills: many }), CONTEXT, A04);

    expect(result.skills.map((s) => s.name)).toEqual([
      'S-01',
      'S-02',
      'S-03',
      'S-04',
      'S-05',
      'S-06',
      'S-07',
      'S-08',
    ]);
    // 🔴 上位 8 件に入らなかったスキル名が、出力のどこにも現れない（F-031 AC-3 の前提）。
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('S-09');
    expect(serialized).not.toContain('S-10');
  });

  it('🔴 同順は sortKey → skillId の決定的な順序で決まる（入力の並びに依存しない）', () => {
    const tied: readonly AnonymizeSkillInput[] = [
      { skillId: 'id-c', sortKey: 20, name: 'C', yearsOfExperience: 3 },
      { skillId: 'id-a', sortKey: 10, name: 'A', yearsOfExperience: 3 },
      { skillId: 'id-b', sortKey: 10, name: 'B', yearsOfExperience: 3 },
    ];
    const expected = ['A', 'B', 'C'];

    expect(
      anonymizeEngineer(baseInput({ skills: tied }), CONTEXT, A04).skills.map((s) => s.name),
    ).toEqual(expected);
    expect(
      anonymizeEngineer(baseInput({ skills: [...tied].reverse() }), CONTEXT, A04).skills.map(
        (s) => s.name,
      ),
    ).toEqual(expected);
  });

  it('入力の配列を破壊しない（呼び出し側の母集団を並べ替えない）', () => {
    const input = baseInput({ skills: many });
    const before = input.skills.map((s) => s.name);
    anonymizeEngineer(input, CONTEXT, A04);
    expect(input.skills.map((s) => s.name)).toEqual(before);
  });
});

describe('anonymizeEngineer — 決定性', () => {
  it('🔴 同じ入力（基準日を含む）で 10 回とも完全に同じ出力になる', () => {
    const input = baseInput({
      skills: [
        skill({ name: 'Java', yearsOfExperience: 7 }),
        skill({ name: 'AWS', yearsOfExperience: 7 }),
        skill({ name: 'TypeScript', yearsOfExperience: 3.5 }),
      ],
    });
    const first = JSON.stringify(anonymizeEngineer(input, CONTEXT, A04));
    for (let i = 0; i < 10; i += 1) {
      expect(JSON.stringify(anonymizeEngineer(input, CONTEXT, A04))).toBe(first);
    }
  });

  it('入力オブジェクトを共有していなくても、値が同じなら出力も同じ', () => {
    expect(anonymizeEngineer(baseInput(), CONTEXT, A04)).toEqual(
      anonymizeEngineer(baseInput(), CONTEXT, A04),
    );
  });
});

describe('anonymizeEngineer — 粒度は関数の外から差し替えられる（docs/05 TBD-2）', () => {
  it('スキルの上限・年数の境界・単価の刻みを変えると、丸め関数を書き換えずに粒度が変わる', () => {
    const coarser: AnonymizeRoundingConfig = {
      maxSkills: 2,
      yearsBandBoundaries: [2, 4, 8, 12],
      priceBucketYen: 200_000,
      priceCapYen: 1_200_000,
    };
    const result = anonymizeEngineer(
      baseInput({
        skills: [
          skill({ name: 'A', yearsOfExperience: 7 }),
          skill({ name: 'B', yearsOfExperience: 6 }),
          skill({ name: 'C', yearsOfExperience: 5 }),
        ],
      }),
      CONTEXT,
      coarser,
    );

    expect(result.skills.map((s) => s.name)).toEqual(['A', 'B']);
    // 🔴 7 年は境界 `[2, 4, 8, 12]` では上から 3 番目の帯（`4 <= 7 < 8`）に入る。
    //    区分の**識別子**（`Y3_5` 等）は A-04 の境界に由来する名前であり、境界を変えると
    //    名前と実体がずれる。**境界を変えるときは識別子と `packages/i18n` の表示名も同時に
    //    見直す**（＝ 粒度の変更は `docs/03` §4.13.1 の改訂事項であり、設定値の差し替えだけで
    //    完結しない。ここはその性質を固定するテストである）。
    expect(result.yearsBand).toBe('Y3_5');
    expect(result.priceBand).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 80 });
  });
});

describe('anonymizeEngineer — 不正な入力は握り潰さない', () => {
  it('🔴 updatedOnJst に時刻付きのタイムスタンプを渡すと RangeError（日単位の粒度の担保）', () => {
    expect(() =>
      anonymizeEngineer(baseInput({ updatedOnJst: '2026-09-08T00:15:00.000Z' }), CONTEXT, A04),
    ).toThrow(RangeError);
  });

  it('🔴 例外メッセージに、受け取った日時の値そのものを載せない（ログに活動時刻を残さない）', () => {
    expect(() =>
      anonymizeEngineer(baseInput({ updatedOnJst: '2026-09-08T00:15:00.000Z' }), CONTEXT, A04),
    ).toThrow(/^updatedOnJst は YYYY-MM-DD/);
  });

  it('availableFrom / referenceDate が日単位でなければ RangeError', () => {
    expect(() =>
      anonymizeEngineer(baseInput({ availableFrom: '2026-09-16T09:00:00Z' }), CONTEXT, A04),
    ).toThrow(RangeError);
    expect(() =>
      anonymizeEngineer(baseInput(), { referenceDate: '2026-9-10' }, A04),
    ).toThrow(RangeError);
  });

  it('負の経験年数・負の単価は RangeError', () => {
    expect(() =>
      anonymizeEngineer(
        baseInput({ skills: [skill({ yearsOfExperience: -1 })] }),
        CONTEXT,
        A04,
      ),
    ).toThrow(RangeError);
    expect(() =>
      anonymizeEngineer(baseInput({ unitPriceMinYen: -1 }), CONTEXT, A04),
    ).toThrow(RangeError);
  });

  it('🔴 粒度の設定値が壊れていたら既定値に落とさず RangeError（細かすぎる粒度で表示に出さない）', () => {
    expect(() => anonymizeEngineer(baseInput(), CONTEXT, { ...A04, maxSkills: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      anonymizeEngineer(baseInput(), CONTEXT, { ...A04, yearsBandBoundaries: [1, 3, 3, 10] }),
    ).toThrow(RangeError);
    expect(() => anonymizeEngineer(baseInput(), CONTEXT, { ...A04, priceBucketYen: 0 })).toThrow(
      RangeError,
    );
    // 打ち止めが刻みの上に乗っていない設定。
    expect(() => anonymizeEngineer(baseInput(), CONTEXT, { ...A04, priceCapYen: 950_000 })).toThrow(
      RangeError,
    );
  });
});
