// apps/web/lib/projects/schemas.test.ts
// docs/05 §6.4 #26（`F-013` / `S-012`）の境界検証を固定する。T-06-01。
//
// 🔴 ここで見るのは「入口で何を受け取り、何を受け取らないか」である。
//    「その入口が実際に境界と区分を守っていること」（＝ 必須 / 尚可が区分ごとに取得できること）は
//    `tests/isolation/projects.test.ts`（DB + RLS 付き）が見る。両方が要る ——
//    スキーマだけでは DB 側の担保を、DB だけでは「そもそも受け取らない」ことを証明できない。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  createProjectBodySchema,
  projectListQuerySchema,
  projectParamsSchema,
  projectRequirementInputSchema,
  updateProjectBodySchema,
  type CreateProjectBody,
} from './schemas';

const SCHEMAS = {
  createProjectBodySchema,
  updateProjectBodySchema,
  projectParamsSchema,
} as const;

const SKILL_ID = '01930000-0000-7000-8000-0000000000e1';
const ASSIGNMENT_ID = '01930000-0000-7000-8000-000000000f01';

describe('🔴 どのスキーマも分離キーを持たない（CLAUDE.md §3.1 / BR-03）', () => {
  it.each(Object.entries(SCHEMAS))('%s の shape に分離キーが 1 つも無い', (_label, schema) => {
    const keys = Object.keys(schema.shape);
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('🔴 分離キーを body に混ぜても strip され、結果が変わらない', () => {
    const clean = createProjectBodySchema.parse({ name: '架空案件' });
    const polluted = createProjectBodySchema.parse({
      name: '架空案件',
      tenantId: '01930000-0000-7000-8000-0000000000a2',
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
      ownerPartnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
    });
    expect(polluted).toEqual(clean);
    expect(polluted).not.toHaveProperty('tenantId');
  });

  it('型の上でも分離キーを持てない（`AssertNoIsolationKeys` の空振り防止）', () => {
    expectTypeOf<CreateProjectBody>().not.toBeNever();
    expectTypeOf<CreateProjectBody>().not.toHaveProperty('tenantId');
  });
});

describe('🔴 `originAssignmentId` は入力に無い（docs/05 §6.4「#26 の実装の決着」）', () => {
  it.each(Object.entries(SCHEMAS))('%s の shape に `originAssignmentId` が無い', (_label, schema) => {
    expect(Object.keys(schema.shape)).not.toContain('originAssignmentId');
  });

  it('🔴 body に混ぜても strip され、`data` へ渡る値に現れない', () => {
    const parsed = createProjectBodySchema.parse({
      name: '架空案件',
      originAssignmentId: ASSIGNMENT_ID,
    });
    expect(parsed).not.toHaveProperty('originAssignmentId');
  });

  it('🔴 PATCH でも同じ（人手の編集で生成元を書き換えられない）', () => {
    const parsed = updateProjectBodySchema.parse({
      name: '架空案件（改）',
      originAssignmentId: ASSIGNMENT_ID,
    });
    expect(parsed).toEqual({ name: '架空案件（改）' });
  });
});

describe('案件の既定値（docs/04 §S-012「新規は空フォーム」/ DB の @default と一致）', () => {
  it('status は OPEN、headcount は 1、要件は空配列', () => {
    const parsed = createProjectBodySchema.parse({ name: '架空案件' });
    expect(parsed.status).toBe('OPEN');
    expect(parsed.headcount).toBe(1);
    expect(parsed.requirements).toEqual([]);
    expect(parsed.endClientName).toBeNull();
    expect(parsed.internalUnitPrice).toBeNull();
    expect(parsed.publicSummary).toBeNull();
  });

  // ✅✅ **2026-10-16（[Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98) の回答
  //    「募集中と終了の二つだけでよい」）: 値集合が `OPEN` / `CLOSED` の 2 値になった。**
  // 🔴 **旧 `SUCCESSOR_WANTED` / `FILLED` は API で 400 になる** —— 値集合の出所は
  //    `@ses/db` の `PROJECT_STATUSES` 1 箇所であり、migration で DB 側も 2 値に移送済みである。
  it('🔴 「終了」（CLOSED）を受け付ける（`@ses/db` の値集合と同じ）', () => {
    const parsed = createProjectBodySchema.parse({
      name: '架空案件',
      status: 'CLOSED',
    });
    expect(parsed.status).toBe('CLOSED');
  });

  it('値集合に無い状態は 400（スキーマで落ちる）', () => {
    // 🔴 旧 3 値の綴りもここで落ちる（移送後に API が受け付けたら CHECK 違反になる）。
    for (const status of ['SUCCESSOR_WANTED', 'FILLED', 'ARCHIVED']) {
      expect(
        createProjectBodySchema.safeParse({ name: '架空案件', status }).success,
        status,
      ).toBe(false);
    }
  });

  it('募集人数 0 は受け付けない（0 人の募集は案件ではない）', () => {
    expect(createProjectBodySchema.safeParse({ name: '架空案件', headcount: 0 }).success).toBe(
      false,
    );
  });

  it('案件名は必須（空文字も不可）', () => {
    expect(createProjectBodySchema.safeParse({}).success).toBe(false);
    expect(createProjectBodySchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('🔴 F-013 AC-1: 要件は kind（MUST / NICE）を 1 件ずつ持つ', () => {
  it('MUST と NICE の両方を同じ配列で受け取り、区分がそのまま残る', () => {
    const parsed = createProjectBodySchema.parse({
      name: '架空案件',
      requirements: [
        { kind: 'MUST', skillId: SKILL_ID, freeText: null, requiredYears: 3 },
        { kind: 'NICE', skillId: null, freeText: 'AWS の運用経験', requiredYears: null },
      ],
    });
    expect(parsed.requirements.map((requirement) => requirement.kind)).toEqual(['MUST', 'NICE']);
  });

  it('🔴 kind に MUST / NICE 以外を入れられない（区分が 2 つであることを入口で固定する）', () => {
    expect(
      projectRequirementInputSchema.safeParse({
        kind: 'OPTIONAL',
        skillId: null,
        freeText: 'x',
        requiredYears: null,
      }).success,
    ).toBe(false);
  });

  it('🔴 kind の省略を許さない（既定値を置くと「どちらでもない要件」が生まれる）', () => {
    expect(
      projectRequirementInputSchema.safeParse({
        skillId: SKILL_ID,
        freeText: null,
        requiredYears: null,
      }).success,
    ).toBe(false);
  });

  it('skillId は UUID でなければならない（辞書の ID 以外を受けない）', () => {
    expect(
      projectRequirementInputSchema.safeParse({
        kind: 'MUST',
        skillId: 'Java',
        freeText: null,
        requiredYears: null,
      }).success,
    ).toBe(false);
  });
});

describe('PATCH は「未指定 = 変更しない」', () => {
  it('指定しなかったキーは結果に現れない', () => {
    const parsed = updateProjectBodySchema.parse({ name: '架空案件（改）' });
    expect(parsed).toEqual({ name: '架空案件（改）' });
  });

  it('🔴 null を明示すれば「値を消す」として通る（未指定と区別する）', () => {
    const parsed = updateProjectBodySchema.parse({ endClientName: null });
    expect(parsed).toEqual({ endClientName: null });
    expect(Object.keys(parsed)).toContain('endClientName');
  });
});

// ============================================================================
// 🔴 T-22-06: 表示の状態（列表示切替）は API の query に混ざらない
// ============================================================================
// `S-010` は隠している列を URL の `?hide=` で持つ（`lib/ui/hidden-columns.ts`）。
// 🔴 **列の表示・非表示は表示の話であり、取得する項目は変わらない** ——
//    したがって `GET /api/projects`（#25）の query にキーを足さない。
// 🔴 それでも画面（`app/(main)/projects/(list)/page.tsx`）は**同じスキーマで検証している**ので、
//    「未知のキーが来ると壊れた条件として素の一覧へ戻される」形だと `?hide=` を付けた URL が
//    毎回書き換えられてしまう。**strip されて success になること**をここで固定する。
describe('🔴 GET /api/projects の query は表示の状態を受け取らない（#25）', () => {
  it('`hide` はスキーマのキーに無い', () => {
    expect(Object.keys(projectListQuerySchema.shape)).not.toContain('hide');
  });

  it('🔴 `?hide=` が付いていても検証は成功し、値はハンドラに届かない（Zod の strip）', () => {
    const parsed = projectListQuerySchema.safeParse({ q: '基幹', hide: 'visibility' });
    expect(parsed.success).toBe(true);
    expect(parsed.success ? Object.keys(parsed.data) : []).not.toContain('hide');
  });
});

describe('案件の追加検索条件', () => {
  it('グループを正規化し、入力途中の空語を検索条件にしない', () => {
    const parsed = projectListQuerySchema.parse({ keywordGroups: JSON.stringify([[' Java ', '', 'Springboot'], []]), developmentPhases: ['BASIC_DESIGN', 'DETAIL_DESIGN'], developmentMethod: 'AGILE', utilizationMin: '60', utilizationMax: '80', searchInternalRemarks: true });
    expect(parsed.keywordGroups).toBe(JSON.stringify([{ mode: 'OR', terms: ['Java', 'Springboot'] }]));
    expect(parsed.developmentPhases).toEqual(['BASIC_DESIGN', 'DETAIL_DESIGN']);
    expect(parsed.utilizationMin).toBe(60);
    expect(parsed).not.toHaveProperty('searchInternalRemarks');
  });
  it('壊れた条件・上限を超える条件・未定義の値を拒否する', () => {
    for (const input of [{ keywordGroups: '{' }, { keywordGroups: JSON.stringify(Array.from({length:11}, () => ['Java'])) }, { developmentPhases: ['UNKNOWN'] }, { developmentMethod: 'UNKNOWN' }, { utilizationMin: '101' }, { utilizationMax: '0' }]) expect(projectListQuerySchema.safeParse(input).success).toBe(false);
  });
});
