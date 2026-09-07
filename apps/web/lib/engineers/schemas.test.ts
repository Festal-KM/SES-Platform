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
  engineerListQuerySchema,
  engineerParamsSchema,
  engineerSkillInputSchema,
  updateEngineerBodySchema,
  type CreateEngineerBody,
} from './schemas';

const SCHEMAS = {
  createEngineerBodySchema,
  updateEngineerBodySchema,
  engineerParamsSchema,
  engineerListQuerySchema,
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

// ============================================================================
// `GET /api/engineers`（#15）の query（`F-009` / `S-005`）。T-06-04。
// ============================================================================

describe('engineerListQuerySchema（#15 の検索条件）', () => {
  const SKILL_A = '01930000-0000-7000-8000-0000000000a1';
  const SKILL_B = '01930000-0000-7000-8000-0000000000a2';

  it('🔴 絞り込みチェックボックス 2 種の既定はオフである（`F-009 AC-5` / `docs/02` A-03）', () => {
    const parsed = engineerListQuerySchema.parse({});
    expect(parsed.onlyInTime).toBe(false);
    expect(parsed.onlyCommutable).toBe(false);
  });

  it('チェックボックスはブラウザが送る値でオンになる', () => {
    expect(engineerListQuerySchema.parse({ onlyInTime: 'on' }).onlyInTime).toBe(true);
    expect(engineerListQuerySchema.parse({ onlyCommutable: '1' }).onlyCommutable).toBe(true);
  });

  it('🔴 未知の値・空文字はオフに倒す（400 にしない ＝ 候補が消える側へ倒さない）', () => {
    expect(engineerListQuerySchema.parse({ onlyInTime: '' }).onlyInTime).toBe(false);
    expect(engineerListQuerySchema.parse({ onlyInTime: 'yes' }).onlyInTime).toBe(false);
  });

  it('🔴 条件を 1 つも入れずに送信された空文字の束が 400 にならない（素の GET フォーム）', () => {
    const parsed = engineerListQuerySchema.safeParse({
      q: '',
      skills: '',
      skillMode: '',
      yearsMin: '',
      priceMin: '',
      priceMax: '',
      availableBy: '',
      prefecture: '',
      remote: '',
      availability: '',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.yearsMin).toBeUndefined();
    // 🔴 `Number('')` は 0 なので、畳まないと「経験年数 0 年以上」が指定されたことになる。
    expect(parsed.success && parsed.data.priceMin).toBeUndefined();
    expect(parsed.success && parsed.data.skills).toBeUndefined();
    // 未指定でも組み合わせの既定は決まっている。
    expect(parsed.success && parsed.data.skillMode).toBe('AND');
  });

  it('スキルは 1 件でも複数でも配列になる（`searchParamsToObject` の形の差を吸収する）', () => {
    expect(engineerListQuerySchema.parse({ skills: SKILL_A }).skills).toEqual([SKILL_A]);
    expect(engineerListQuerySchema.parse({ skills: [SKILL_A, SKILL_B] }).skills).toEqual([
      SKILL_A,
      SKILL_B,
    ]);
  });

  it('スキルは辞書の ID（UUID）でなければ 400', () => {
    expect(engineerListQuerySchema.safeParse({ skills: ['Java'] }).success).toBe(false);
  });

  it('値集合の外の値は 400（黙って無視しない）', () => {
    expect(engineerListQuerySchema.safeParse({ prefecture: '99' }).success).toBe(false);
    expect(engineerListQuerySchema.safeParse({ remote: 'HYBRID' }).success).toBe(false);
    expect(engineerListQuerySchema.safeParse({ availability: 'BUSY' }).success).toBe(false);
    expect(engineerListQuerySchema.safeParse({ skillMode: 'NOT' }).success).toBe(false);
    expect(engineerListQuerySchema.safeParse({ availableBy: '2026-13-01' }).success).toBe(false);
  });

  it('数値の条件は文字列から変換される（クエリ文字列は常に文字列で届く）', () => {
    const parsed = engineerListQuerySchema.parse({
      yearsMin: '5.5',
      priceMin: '600000',
      priceMax: '800000',
    });
    expect(parsed.yearsMin).toBe(5.5);
    expect(parsed.priceMin).toBe(600_000);
    expect(parsed.priceMax).toBe(800_000);
  });

  it('🔴 `ownership` を受け取らない（C3 により母集団の所属区分は ctx と必ず一致する）', () => {
    expect(Object.keys(engineerListQuerySchema.shape)).not.toContain('ownership');
    // strip されるだけで 400 にはしない（未知キーの有無で応答を変えない）。
    expect(engineerListQuerySchema.safeParse({ ownership: 'PARTNER' }).success).toBe(true);
  });

  it('🔴 `cursor` は UUID（Prisma の `cursor: { id }` に届かせない）', () => {
    expect(engineerListQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success).toBe(false);
  });
});
