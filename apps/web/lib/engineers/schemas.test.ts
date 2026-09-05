// apps/web/lib/engineers/schemas.test.ts
// docs/05 §6.4 #16（`F-008` / `S-007`）の境界検証を固定する。T-05-01。
//
// 🔴 ここで見るのは「入口で何を受け取らないか」である（`F-008 AC-1` / `AC-2`）。
//    「その入口が実際に境界を守っていること」（＝ 入力で他社を指定しても所有パートナーが
//    変わらないこと）は `tests/isolation/engineers.test.ts`（DB + RLS + トリガ付き）が見る。
//    両方が要る —— スキーマだけでは DB 側の担保を、DB だけでは「そもそも受け取らない」ことを
//    証明できない。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  createEngineerBodySchema,
  engineerParamsSchema,
  engineerSkillInputSchema,
  updateEngineerBodySchema,
  type CreateEngineerBody,
} from './schemas';

const SCHEMAS = {
  createEngineerBodySchema,
  updateEngineerBodySchema,
  engineerParamsSchema,
} as const;

const SKILL_ID = '01930000-0000-7000-8000-0000000000e1';

describe('🔴 どのスキーマも分離キーを持たない（F-008 AC-2 / CLAUDE.md §3.1）', () => {
  it.each(Object.entries(SCHEMAS))('%s の shape に分離キーが 1 つも無い', (_label, schema) => {
    const keys = Object.keys(schema.shape);
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('🔴 `ownerPartnerCompanyId` を body に混ぜても strip され、結果が変わらない', () => {
    const clean = createEngineerBodySchema.parse({ displayName: '架空 太郎' });
    const polluted = createEngineerBodySchema.parse({
      displayName: '架空 太郎',
      ownerPartnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
      owner_partner_company_id: '01930000-0000-7000-8000-0000000000c2',
      tenantId: '01930000-0000-7000-8000-0000000000a2',
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
    });
    expect(polluted).toEqual(clean);
    expect(polluted).not.toHaveProperty('ownerPartnerCompanyId');
  });

  it('🔴 PATCH でも同じ（更新経路から所有パートナーを触れない）', () => {
    const parsed = updateEngineerBodySchema.parse({
      displayName: '架空 花子',
      ownerPartnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
    });
    expect(parsed).toEqual({ displayName: '架空 花子' });
  });

  it('型の上でも分離キーを持てない（`AssertNoIsolationKeys` の空振り防止）', () => {
    expectTypeOf<CreateEngineerBody>().not.toBeNever();
    expectTypeOf<CreateEngineerBody>().not.toHaveProperty('ownerPartnerCompanyId');
  });
});

/**
 * 🔴 `F-008 AC-1` / `BR-52`: 本籍・家族構成・健康情報・信条にあたる入力項目が
 *    **既定の入力項目としても存在しない**。キー名で機械的に照合する。
 *    `birthDate`（生年月日）も本タスクの入力には含めない（`docs/04` §S-007 に欄が無い）。
 */
const FORBIDDEN_INPUT_KEYS = [
  'domicile',
  'registeredDomicile',
  'honseki',
  'family',
  'familyStructure',
  'maritalStatus',
  'dependents',
  'health',
  'healthCondition',
  'medicalHistory',
  'disability',
  'creed',
  'religion',
  'politics',
  'nationality',
  'gender',
  'birthDate',
  'birthday',
] as const;

describe('🔴 F-008 AC-1 / BR-52: 営業判断に不要な項目を入力欄として持たない', () => {
  it.each(Object.entries(SCHEMAS))('%s の shape に禁止キーが 1 つも無い', (_label, schema) => {
    const keys = Object.keys(schema.shape);
    for (const forbidden of FORBIDDEN_INPUT_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('🔴 混入させても strip される（受け取らないことが構造で担保されている）', () => {
    const parsed = createEngineerBodySchema.parse({
      displayName: '架空 太郎',
      birthDate: '1990-01-01',
      healthCondition: '良好',
      familyStructure: '既婚',
    });
    expect(parsed).not.toHaveProperty('birthDate');
    expect(parsed).not.toHaveProperty('healthCondition');
    expect(parsed).not.toHaveProperty('familyStructure');
  });

  it('入力できる項目は BR-52 の範囲だけである（一覧そのものを固定する）', () => {
    expect(Object.keys(createEngineerBodySchema.shape).sort()).toEqual(
      [
        'availability',
        'availableFrom',
        'contactEmail',
        'contactPhone',
        'displayName',
        'newSkillLabels',
        'preferenceNote',
        'prefecture',
        'remoteMode',
        'skills',
        'unitPriceMax',
        'unitPriceMin',
      ].sort(),
    );
  });
});

describe('createEngineerBodySchema（#16 POST）', () => {
  it('氏名だけで登録でき、既定値が入る（`docs/04` §S-007「新規は空フォーム（既定値入り）」）', () => {
    expect(createEngineerBodySchema.parse({ displayName: ' 架空 太郎 ' })).toEqual({
      displayName: '架空 太郎',
      availability: 'WORKING',
      availableFrom: null,
      unitPriceMin: null,
      unitPriceMax: null,
      prefecture: null,
      remoteMode: null,
      preferenceNote: null,
      contactEmail: null,
      contactPhone: null,
      skills: [],
      newSkillLabels: [],
    });
  });

  it('氏名は必須（空文字は 400）', () => {
    expect(createEngineerBodySchema.safeParse({}).success).toBe(false);
    expect(createEngineerBodySchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });

  it('稼働状況・リモート可否・都道府県は値集合に縛られる', () => {
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', availability: 'RETIRED' }).success,
    ).toBe(false);
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', remoteMode: 'HYBRID' }).success,
    ).toBe(false);
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', prefecture: '99' }).success,
    ).toBe(false);
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', prefecture: '13' }).success,
    ).toBe(true);
  });

  it('稼働可能時期は `YYYY-MM-DD`（日時を受け取らない）', () => {
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', availableFrom: '2026-10-01' }).success,
    ).toBe(true);
    expect(
      createEngineerBodySchema.safeParse({
        displayName: 'a',
        availableFrom: '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('連絡先は形式を検証する（必要最小限であることは項目数で担保する）', () => {
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', contactEmail: 'not-an-email' }).success,
    ).toBe(false);
    expect(
      createEngineerBodySchema.parse({ displayName: 'a', contactEmail: ' Foo@Example.TEST ' })
        .contactEmail,
    ).toBe('foo@example.test');
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', contactPhone: '03-1234-5678' }).success,
    ).toBe(true);
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', contactPhone: '内線あり' }).success,
    ).toBe(false);
  });
});

describe('🔴 F-010 AC-2: スキルは辞書の ID でしか指定できない', () => {
  it('`skillId` は UUID（名前でスキルを作れる経路が入口に無い）', () => {
    expect(
      engineerSkillInputSchema.safeParse({ skillId: SKILL_ID, yearsOfExperience: 3, level: null })
        .success,
    ).toBe(true);
    expect(
      engineerSkillInputSchema.safeParse({ skillId: 'Java', yearsOfExperience: 3, level: null })
        .success,
    ).toBe(false);
  });

  it('スキル 1 件の shape は skillId / yearsOfExperience / level だけ（名前を受け取らない）', () => {
    expect(Object.keys(engineerSkillInputSchema.shape).sort()).toEqual([
      'level',
      'skillId',
      'yearsOfExperience',
    ]);
  });

  it('レベルは 1..5 または null', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      expect(
        engineerSkillInputSchema.safeParse({ skillId: SKILL_ID, yearsOfExperience: 1, level })
          .success,
      ).toBe(true);
    }
    expect(
      engineerSkillInputSchema.safeParse({ skillId: SKILL_ID, yearsOfExperience: 1, level: 0 })
        .success,
    ).toBe(false);
    expect(
      engineerSkillInputSchema.safeParse({ skillId: SKILL_ID, yearsOfExperience: 1, level: 6 })
        .success,
    ).toBe(false);
  });

  it('新語候補は文字列の配列（辞書への追加ではない）', () => {
    expect(
      createEngineerBodySchema.parse({ displayName: 'a', newSkillLabels: [' Java8 ', 'JavaSE'] })
        .newSkillLabels,
    ).toEqual(['Java8', 'JavaSE']);
    expect(
      createEngineerBodySchema.safeParse({ displayName: 'a', newSkillLabels: [''] }).success,
    ).toBe(false);
  });
});

describe('updateEngineerBodySchema（#16 PATCH）', () => {
  it('🔴 未指定 = 変更しない（空オブジェクトが通る）', () => {
    expect(updateEngineerBodySchema.parse({})).toEqual({});
  });

  it('`null` 指定は「値を消す」として通る（未指定と区別する）', () => {
    expect(updateEngineerBodySchema.parse({ contactEmail: null })).toEqual({ contactEmail: null });
  });

  it('制約は POST と同じ（片方だけ緩まない）', () => {
    expect(updateEngineerBodySchema.safeParse({ prefecture: '99' }).success).toBe(false);
    expect(updateEngineerBodySchema.safeParse({ displayName: '' }).success).toBe(false);
  });
});

describe('engineerParamsSchema', () => {
  it('id は UUID（対象の指定であって実行者のスコープではない）', () => {
    expect(engineerParamsSchema.safeParse({ id: SKILL_ID }).success).toBe(true);
    expect(engineerParamsSchema.safeParse({ id: 'not-uuid' }).success).toBe(false);
  });
});
