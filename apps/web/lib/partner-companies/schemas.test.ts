// apps/web/lib/partner-companies/schemas.test.ts
// docs/05 §6.4 #11 / #12 / #13（`F-007` / `S-014`）の境界検証を固定する。T-04-07。
//
// 🔴 見るのは「入口で何を受け取らないか」である（`F-003 AC-1` / `F-004 AC-2`）。
//    「その入口が実際に境界を守っていること」は `tests/isolation/partner-companies.test.ts`
//    （DB + RLS 付き）が見る。両方が要る。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  createPartnerCompanyBodySchema,
  partnerCompanyListQuerySchema,
  partnerCompanyParamsSchema,
  partnerCompanySuspensionBodySchema,
  PARTNER_COMPANY_STATUSES,
  type CreatePartnerCompanyBody,
  type PartnerCompanyListQuery,
} from './schemas';

const SCHEMAS = {
  partnerCompanyListQuerySchema,
  createPartnerCompanyBodySchema,
  partnerCompanyParamsSchema,
  partnerCompanySuspensionBodySchema,
} as const;

describe('🔴 どのスキーマも分離キーを持たない（F-003 AC-1 / F-004 AC-2）', () => {
  it.each(Object.entries(SCHEMAS))('%s の shape に分離キーが 1 つも無い', (_label, schema) => {
    const keys = Object.keys(schema.shape);
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('partnerCompanyListQuerySchema（#11）', () => {
  it('出力の型は q / status だけ（型テスト）', () => {
    expectTypeOf<keyof PartnerCompanyListQuery>().toEqualTypeOf<'q' | 'status'>();
  });

  it('🔴 分離キーを混ぜても結果が変わらない（strip される。F-004 AC-2）', () => {
    const clean = partnerCompanyListQuerySchema.parse({ q: 'テック' });
    const polluted = partnerCompanyListQuerySchema.parse({
      q: 'テック',
      tenantId: '01930000-0000-7000-8000-0000000000a2',
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
    });
    expect(polluted).toEqual(clean);
  });

  it('status は 2 値に縛られる（未知の値は 400）', () => {
    for (const status of PARTNER_COMPANY_STATUSES) {
      expect(partnerCompanyListQuerySchema.safeParse({ status }).success).toBe(true);
    }
    expect(partnerCompanyListQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });

  it('未指定でも通る（絞り込みは任意）', () => {
    expect(partnerCompanyListQuerySchema.parse({})).toEqual({});
  });
});

describe('createPartnerCompanyBodySchema（#12）', () => {
  it('出力の型は name / contactName / contactEmail だけ（型テスト）', () => {
    expectTypeOf<keyof CreatePartnerCompanyBody>().toEqualTypeOf<
      'name' | 'contactName' | 'contactEmail'
    >();
  });

  it('🔴 suspendedAt を受け取らない（停止・再開は #13 の専用経路だけが行う）', () => {
    const parsed = createPartnerCompanyBodySchema.parse({
      name: '架空テック株式会社',
      suspendedAt: '2026-09-05T00:00:00.000Z',
    });
    expect(Object.keys(parsed)).toEqual(['name']);
  });

  it('企業名が空の body は受け付けない', () => {
    expect(createPartnerCompanyBodySchema.safeParse({ name: '  ' }).success).toBe(false);
  });

  it('担当者メールは小文字化され、形式不正は 400 になる', () => {
    expect(
      createPartnerCompanyBodySchema.parse({ name: 'A社', contactEmail: 'Sato@Example.test' })
        .contactEmail,
    ).toBe('sato@example.test');
    expect(
      createPartnerCompanyBodySchema.safeParse({ name: 'A社', contactEmail: 'nope' }).success,
    ).toBe(false);
  });
});

describe('partnerCompanyParamsSchema / partnerCompanySuspensionBodySchema（#13）', () => {
  it('id は UUID でなければ 400 になる', () => {
    expect(partnerCompanyParamsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(
      partnerCompanyParamsSchema.safeParse({ id: '01930000-0000-7000-8000-0000000000c1' }).success,
    ).toBe(true);
  });

  it('🔴 理由は任意である（入力を強制すると「止めたいのに止められない」導線ができる）', () => {
    expect(partnerCompanySuspensionBodySchema.parse({})).toEqual({});
    expect(partnerCompanySuspensionBodySchema.parse({ reason: '契約終了' }).reason).toBe('契約終了');
  });
});
