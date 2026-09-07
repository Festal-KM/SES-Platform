// apps/web/lib/engineers/search.test.ts
// `GET /api/engineers`（#15）の**検索条件 → 述語**と**決定的順序のキー**（`lib/engineers/search.ts`）。
// T-06-04。
//
// 🔴 ここで固定するのは 5 点である:
//   ①`where` に**境界の条件（`tenantId` / `partnerCompanyId` / `ownerPartnerCompanyId`）が
//     1 つも無い**こと（`CLAUDE.md` §3.1 / `F-009 AC-3`。母集団を決めるのは RLS の C3 だけ）
//   ②検索条件が指定されたときだけ述語が増えること（`F-009` の入力）
//   ③**単価レンジの「重なり」**と **NULL の扱い**（`#25` と共有する定義。docs/05 §6.4）
//   ④🔴 **絞り込みチェックボックスが既定オフ**であり、オフのときソフト条件が
//     **母集団ではなく並び**に効くこと（`F-009 AC-5` / `docs/02` A-03）
//   ⑤🔴 **`fit` と `miss` が母集団を過不足なく 2 分する**こと（＝ どちらにも入らない行が
//     生じない ＝ チェックボックスがオフなら 1 件も消えない）。**述語の形**をここで、
//     **実データでの件数**を `tests/isolation/engineers.test.ts` で固定する。
// 🔴 実 DB での並びと `total` の母集団は `tests/isolation/engineers.test.ts` が固定する。
//    **述語だけを見るテストで「越境しない」を証明したことにしない。**
import { describe, expect, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  ENGINEER_LIST_ORDER_BY,
  engineerPriceConditions,
  engineerSearchPlan,
  engineerSkillConditions,
} from './search';
import { ENGINEER_SKILL_MODE_DEFAULT, type EngineerListQuery } from './schemas';

const SKILL_JAVA = '01930000-0000-7000-8000-0000000000a1';
const SKILL_AWS = '01930000-0000-7000-8000-0000000000a2';

function query(overrides: Partial<EngineerListQuery> = {}): EngineerListQuery {
  return {
    limit: 50,
    skillMode: ENGINEER_SKILL_MODE_DEFAULT,
    onlyInTime: false,
    onlyCommutable: false,
    ...overrides,
  };
}

/** 計画全体を素の JSON にして「何が入っているか」を文字列として数える。 */
function planJson(overrides: Partial<EngineerListQuery> = {}): string {
  return JSON.stringify(engineerSearchPlan(query(overrides)));
}

describe('🔴 F-009 AC-3: 述語に境界の条件を 1 つも書かない（母集団は RLS の C3 が決める）', () => {
  it('条件が 1 つも無ければ `where` は空で、適合の分割も無い（＝ 母集団そのもの）', () => {
    expect(engineerSearchPlan(query())).toEqual({ where: {}, fit: null, miss: null });
  });

  it.each([...ISOLATION_KEYS, 'ownerPartnerCompanyId', 'owner_partner_company_id'])(
    '🔴 `%s` が述語に現れない（条件を全部指定しても）',
    (key) => {
      const json = planJson({
        skills: [SKILL_JAVA, SKILL_AWS],
        skillMode: 'OR',
        yearsMin: 5,
        priceMin: 600_000,
        priceMax: 800_000,
        availableBy: '2026-11-01',
        prefecture: '13',
        remote: 'FULL_REMOTE',
        availability: 'STANDBY',
        q: '架空',
      });
      expect(json).not.toContain(key);
    },
  );

  it('🔴 所属区分（`ownership`）を条件として持たない（query にキーが無い ＝ 述語も生じない）', () => {
    // C3 により母集団の所属区分は実行者の文脈と必ず一致するため、この条件は
    // 「全件」か「0 件」しか返さない（docs/05 §6.4「#15 の実装の決着（T-06-04）」）。
    expect(planJson({ availability: 'WORKING' })).not.toContain('ownership');
  });

  it('🔴 画面が出さない PII（連絡先・生年月日・現所属会社名）を検索対象にしない', () => {
    const json = planJson({ q: '架空' });
    expect(json).not.toContain('contactEmail');
    expect(json).not.toContain('contactPhone');
    expect(json).not.toContain('birthDate');
    expect(json).not.toContain('affiliationLabel');
  });
});

describe('スキルと経験年数（`F-009` の入力 / 集約の定義）', () => {
  it('スキルも経験年数も未指定なら述語が生じない', () => {
    expect(engineerSkillConditions(query())).toEqual([]);
  });

  it('🔴 経験年数だけの指定は「いずれかのスキルがその年数以上」＝ 最大値の下限である', () => {
    expect(engineerSkillConditions(query({ yearsMin: 5 }))).toEqual([
      { engineerSkills: { some: { yearsOfExperience: { gte: 5 } } } },
    ]);
  });

  it('🔴 AND はスキルごとに述語を重ねる（COBOL 20 年で Java 5 年以上に一致させない）', () => {
    expect(
      engineerSkillConditions(query({ skills: [SKILL_JAVA, SKILL_AWS], yearsMin: 5 })),
    ).toEqual([
      { engineerSkills: { some: { skillId: SKILL_JAVA, yearsOfExperience: { gte: 5 } } } },
      { engineerSkills: { some: { skillId: SKILL_AWS, yearsOfExperience: { gte: 5 } } } },
    ]);
  });

  it('OR は指定したスキルのいずれかで判定する（述語は 1 本）', () => {
    expect(
      engineerSkillConditions(query({ skills: [SKILL_JAVA, SKILL_AWS], skillMode: 'OR', yearsMin: 5 })),
    ).toEqual([
      {
        engineerSkills: {
          some: { skillId: { in: [SKILL_JAVA, SKILL_AWS] }, yearsOfExperience: { gte: 5 } },
        },
      },
    ]);
  });

  it('経験年数を指定しなければ、年数の条件は述語に現れない', () => {
    expect(engineerSkillConditions(query({ skills: [SKILL_JAVA] }))).toEqual([
      { engineerSkills: { some: { skillId: SKILL_JAVA } } },
    ]);
  });

  it('既定の組み合わせは AND である（`docs/02` `F-009` / `docs/04` §S-005 の並び）', () => {
    expect(ENGINEER_SKILL_MODE_DEFAULT).toBe('AND');
  });
});

describe('🔴 単価レンジの「重なり」（`#25` と共有する定義。docs/05 §6.4）', () => {
  it('上限の指定は「台帳の下限がそれ以下」で絞る', () => {
    expect(engineerPriceConditions(query({ priceMax: 800_000 }))).toEqual([
      { OR: [{ unitPriceMin: null }, { unitPriceMin: { lte: 800_000 } }] },
    ]);
  });

  it('下限の指定は「台帳の上限がそれ以上」で絞る', () => {
    expect(engineerPriceConditions(query({ priceMin: 600_000 }))).toEqual([
      { OR: [{ unitPriceMax: null }, { unitPriceMax: { gte: 600_000 } }] },
    ]);
  });

  it('🔴 レンジの端が未設定（NULL）の人材は、単価で絞っても消えない（制約なしとして扱う）', () => {
    // `docs/01` §1.1-2「見えていない候補が増える」の再発を防ぐための向きである。
    for (const condition of engineerPriceConditions(query({ priceMin: 600_000, priceMax: 800_000 }))) {
      expect(JSON.stringify(condition)).toContain('null');
    }
  });

  it('両方の指定は独立した 2 つの述語になる（大小関係を検証しない）', () => {
    expect(engineerPriceConditions(query({ priceMin: 900_000, priceMax: 100_000 }))).toHaveLength(2);
  });
});

describe('🔴 F-009 AC-5: 絞り込みチェックボックスは既定オフ（`docs/02` A-03）', () => {
  it('稼働可能時期はオフなら母集団を絞らず、適合（並び）に効く', () => {
    const plan = engineerSearchPlan(query({ availableBy: '2026-11-01' }));

    // 🔴 母集団には条件が入っていない（＝ 開始日が遅い候補も一覧に出る）。
    expect(plan.where).toEqual({});
    expect(plan.fit).toEqual({ AND: [{ availableFrom: { lte: new Date('2026-11-01T00:00:00.000Z') } }] });
  });

  it('稼働可能時期はオンなら母集団を絞り、適合の分割は無くなる', () => {
    const plan = engineerSearchPlan(query({ availableBy: '2026-11-01', onlyInTime: true }));

    expect(plan.fit).toBeNull();
    expect(JSON.stringify(plan.where)).toContain('availableFrom');
  });

  it('勤務地はオフなら母集団を絞らず、適合（並び）に効く', () => {
    const plan = engineerSearchPlan(query({ prefecture: '13' }));

    expect(plan.where).toEqual({});
    // 🔴 「通勤可能」= 勤務地の一致**または**フルリモート可。
    expect(plan.fit).toEqual({
      AND: [{ OR: [{ prefecture: '13' }, { remoteMode: 'FULL_REMOTE' }] }],
    });
  });

  it('勤務地はオンなら母集団を絞る', () => {
    const plan = engineerSearchPlan(query({ prefecture: '13', onlyCommutable: true }));

    expect(plan.fit).toBeNull();
    expect(JSON.stringify(plan.where)).toContain('FULL_REMOTE');
  });

  it('🔴 2 つの条件を「どちらも満たす」だけで 1 ビットに畳む（条件間に順位を作らない）', () => {
    const plan = engineerSearchPlan(query({ availableBy: '2026-11-01', prefecture: '13' }));

    // 適合 = AND（すべて満たす）/ 不適合 = OR（どれか 1 つを満たさない）。
    expect(plan.fit === null ? [] : Object.keys(plan.fit)).toEqual(['AND']);
    expect(plan.miss === null ? [] : Object.keys(plan.miss)).toEqual(['OR']);
    expect(plan.fit === null ? 0 : (plan.fit.AND ?? []).length).toBe(2);
  });

  it('🔴 適合の判定にスコア・順位・重みが現れない（`F-009 AC-1` / `AC-2`）', () => {
    const json = planJson({ availableBy: '2026-11-01', prefecture: '13' });
    for (const word of ['score', 'rank', 'weight', '_count']) {
      expect(json, `${word} が述語に現れている`).not.toContain(word);
    }
  });
});

describe('🔴 `fit` と `miss` が母集団を過不足なく 2 分する（1 件も消えない）', () => {
  it('稼働可能時期: NULL は `miss` 側で明示的に拾う（`NOT` で消えない）', () => {
    const plan = engineerSearchPlan(query({ availableBy: '2026-11-01' }));

    expect(plan.miss).toEqual({
      OR: [
        { OR: [{ availableFrom: null }, { availableFrom: { gt: new Date('2026-11-01T00:00:00.000Z') } }] },
      ],
    });
  });

  it('勤務地: 勤務地 NULL / リモート NULL の行も `miss` 側で拾う', () => {
    const plan = engineerSearchPlan(query({ prefecture: '13' }));

    expect(plan.miss).toEqual({
      OR: [
        {
          AND: [
            { OR: [{ prefecture: null }, { prefecture: { not: '13' } }] },
            { OR: [{ remoteMode: null }, { remoteMode: { not: 'FULL_REMOTE' } }] },
          ],
        },
      ],
    });
  });

  it('🔴 `miss` を `NOT` で組み立てない（三値論理で NULL の行が両バケットから消えるため）', () => {
    expect(planJson({ availableBy: '2026-11-01', prefecture: '13' })).not.toContain('"NOT"');
  });
});

describe('その他の条件（ハード条件）', () => {
  it('稼働状況は等値で絞る', () => {
    expect(engineerSearchPlan(query({ availability: 'STANDBY' })).where).toEqual({
      availability: 'STANDBY',
    });
  });

  it('🔴 リモート可否はハード条件である（勤務地の救済とは役割が違う）', () => {
    const plan = engineerSearchPlan(query({ remote: 'FULL_REMOTE' }));
    expect(plan.where).toEqual({ remoteMode: 'FULL_REMOTE' });
    expect(plan.fit).toBeNull();
  });

  it('フリーワードは氏名と希望条件の 2 列だけを見る', () => {
    expect(engineerSearchPlan(query({ q: '架空' })).where).toEqual({
      AND: [
        {
          OR: [
            { displayName: { contains: '架空', mode: 'insensitive' } },
            { preferenceNote: { contains: '架空', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });
});

describe('🔴 F-009 AC-1: 並びのキーが決定的である', () => {
  it('並びは 更新日時 → id の 2 段である（第 1 キーの「適合」は述語で表す）', () => {
    expect(ENGINEER_LIST_ORDER_BY).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
  });

  it('🔴 `ORDER BY` に「全体件数」「順位」「スコア」を持ち込まない（docs/05 §4.8）', () => {
    const json = JSON.stringify(ENGINEER_LIST_ORDER_BY);
    expect(json).not.toContain('_count');
    expect(json).not.toContain('score');
    expect(json).not.toContain('rank');
  });
});
