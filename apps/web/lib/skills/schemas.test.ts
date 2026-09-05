// apps/web/lib/skills/schemas.test.ts
// docs/05 §6.4 #23 / #24（`F-010` / `S-009`）の境界検証を固定する。T-05-03。
//
// 🔴 見るのは「入口で何を受け取らないか」である（`F-003 AC-1` / `F-004 AC-2`）。
//    「その入口が実際に境界を守っていること」は `tests/isolation/skill-dictionary.test.ts`
//    （DB + RLS 付き）が見る。両方が要る。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  skillAliasDecisionBodySchema,
  skillAliasListQuerySchema,
  skillAliasParamsSchema,
  skillListQuerySchema,
  type SkillAliasDecisionBody,
  type SkillAliasListQuery,
  type SkillListQuery,
} from './schemas';

const SCHEMAS = {
  skillListQuerySchema,
  skillAliasListQuerySchema,
  skillAliasParamsSchema,
  skillAliasDecisionBodySchema,
} as const;

describe('🔴 どのスキーマも分離キーを持たない（F-003 AC-1 / F-004 AC-2）', () => {
  it.each(Object.entries(SCHEMAS))('%s の shape に分離キーが 1 つも無い', (_label, schema) => {
    const keys = Object.keys(schema.shape);
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('skillListQuerySchema（#23 `GET /api/skills`）', () => {
  it('🔴 受け取るのは `q` だけである（`skills` に状態は無い）', () => {
    expectTypeOf<keyof SkillListQuery>().toEqualTypeOf<'q'>();
  });

  it('🔴 分離キーを混ぜても結果が変わらない（strip される）', () => {
    const clean = skillListQuerySchema.parse({ q: 'Java' });
    const polluted = skillListQuerySchema.parse({
      q: 'Java',
      tenantId: '01930000-0000-7000-8000-0000000000a2',
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
    });
    expect(polluted).toEqual(clean);
  });

  it('未指定でも通る（絞り込み無し）', () => {
    expect(skillListQuerySchema.parse({})).toEqual({});
  });
});

describe('skillAliasListQuerySchema（#23 `GET /api/skill-aliases`）', () => {
  it('受け取るのは `q` と `status` だけである（型テスト）', () => {
    expectTypeOf<keyof SkillAliasListQuery>().toEqualTypeOf<'q' | 'status'>();
  });

  it('status は DB の CHECK と同じ 3 値に縛られる（未知の値は 400）', () => {
    expect(skillAliasListQuerySchema.safeParse({ status: 'PROPOSED' }).success).toBe(true);
    expect(skillAliasListQuerySchema.safeParse({ status: 'ACCEPTED' }).success).toBe(true);
    expect(skillAliasListQuerySchema.safeParse({ status: 'REJECTED' }).success).toBe(true);
    expect(skillAliasListQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });
});

describe('skillAliasDecisionBodySchema（#24）', () => {
  it('受け取るのは `decision` と `skillId` だけである（型テスト）', () => {
    expectTypeOf<keyof SkillAliasDecisionBody>().toEqualTypeOf<'decision' | 'skillId'>();
  });

  it('decision は ACCEPT / REJECT の 2 値に縛られる', () => {
    expect(skillAliasDecisionBodySchema.safeParse({ decision: 'ACCEPT' }).success).toBe(true);
    expect(skillAliasDecisionBodySchema.safeParse({ decision: 'REJECT' }).success).toBe(true);
    expect(skillAliasDecisionBodySchema.safeParse({ decision: 'APPROVE' }).success).toBe(false);
    expect(skillAliasDecisionBodySchema.safeParse({}).success).toBe(false);
  });

  it('skillId の既定は null（未指定と「正規化先なし」を同じ形にする）', () => {
    expect(skillAliasDecisionBodySchema.parse({ decision: 'REJECT' })).toEqual({
      decision: 'REJECT',
      skillId: null,
    });
  });

  it('skillId は UUID でなければならない（辞書の ID）', () => {
    expect(
      skillAliasDecisionBodySchema.safeParse({ decision: 'ACCEPT', skillId: 'Java' }).success,
    ).toBe(false);
  });

  it('🔴 `status` を body から受け取らない（状態は #24 の decision だけが動かす）', () => {
    const parsed = skillAliasDecisionBodySchema.parse({
      decision: 'REJECT',
      status: 'ACCEPTED',
      tenantId: '01930000-0000-7000-8000-0000000000a2',
    });
    expect(parsed).toEqual({ decision: 'REJECT', skillId: null });
  });
});

describe('skillAliasParamsSchema（#24 の path params）', () => {
  it('id は UUID である', () => {
    expect(skillAliasParamsSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(
      skillAliasParamsSchema.safeParse({ id: '01930000-0000-7000-8000-0000000000b1' }).success,
    ).toBe(true);
  });
});
