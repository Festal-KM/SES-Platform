// apps/web/lib/projects/detail.test.ts
// `S-011`（案件詳細）の表示値の組み立て（docs/04 §S-011）。T-06-02。
//
// 🔴 ここで固定するのは「判断材料を落とさないこと」と「区分が保たれること」である:
//    片側だけの単価レンジを畳まない、未設定と 0 を混同しない、必須と尚可を取り違えない。
// 🔴 **`F-013 AC-2` の担保は型にある**（`detail-view.types.test.ts`）。ここでは
//    「商流情報の行を作る関数が、取引先の view を受け取れない」ことを補助的に確かめる。
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import {
  formatProjectUnitPriceRange,
  projectCommerceRows,
  projectConditionRows,
  projectHeadlineRows,
  projectRequirementRows,
  projectVisibilityRows,
} from './detail';
import type {
  HostProjectDetailView,
  PartnerProjectDetailView,
  ProjectRequirementView,
} from './service';

const NONE = t('projects.detail.valueNone');

const SHARED = {
  id: '01930000-0000-7000-8000-0000000000a1',
  name: '合成案件',
  status: 'OPEN',
  headcount: 2,
  startDate: '2026-10-01',
  unitPriceMin: 600_000,
  unitPriceMax: 800_000,
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  publicSummary: '公開用の概要',
  requirements: [],
} as const;

function hostView(overrides: Partial<HostProjectDetailView> = {}): HostProjectDetailView {
  return {
    ...SHARED,
    audience: 'HOST',
    endClientName: '架空エンド株式会社',
    internalUnitPrice: 900_000,
    visibilities: [],
    ...overrides,
  };
}

function partnerView(overrides: Partial<PartnerProjectDetailView> = {}): PartnerProjectDetailView {
  return { ...SHARED, audience: 'PARTNER', ...overrides };
}

function requirement(overrides: Partial<ProjectRequirementView> = {}): ProjectRequirementView {
  return { kind: 'MUST', skillId: null, skillName: null, freeText: null, requiredYears: null, ...overrides };
}

describe('formatProjectUnitPriceRange（🔴 片側だけの登録を畳まない）', () => {
  it('両端がある', () => {
    expect(formatProjectUnitPriceRange(600_000, 800_000)).toBe(
      `600,000〜800,000 ${t('projects.unitPrice.unit')}`,
    );
  });

  it('下限だけ / 上限だけ', () => {
    expect(formatProjectUnitPriceRange(600_000, null)).toBe(
      `600,000 ${t('projects.detail.unitPrice.orMore')}`,
    );
    expect(formatProjectUnitPriceRange(null, 800_000)).toBe(
      `800,000 ${t('projects.detail.unitPrice.orLess')}`,
    );
  });

  it('未設定は記号（0 と混同しない）', () => {
    expect(formatProjectUnitPriceRange(null, null)).toBe(NONE);
    expect(formatProjectUnitPriceRange(0, 0)).toBe(`0〜0 ${t('projects.unitPrice.unit')}`);
  });

  // ⚠️ 「人材（`engineers.*`）の語を使っていない」は**現時点では表示文字列で区別できない**
  //    （どちらも「円以上」であり、値が同じだからこそキーを分けている）。担保はキーの側にあり、
  //    `formatProjectUnitPriceRange` が引くのは `projects.detail.unitPrice.*` だけである
  //    （上の 2 件のアサーションがそのキーの値と厳密一致で比べている）。
});

describe('🔴 見出し（T2。折りたたみの外に置く 3 値。CLAUDE.md §13.3）', () => {
  it('状態・募集人数・開始日の 3 行', () => {
    expect(projectHeadlineRows(hostView()).map((row) => row.key)).toEqual([
      'status',
      'headcount',
      'startDate',
    ]);
  });

  it('🔴 ホストと取引先で同じ 3 行になる（見出しは権限差分を持たない）', () => {
    expect(projectHeadlineRows(partnerView())).toEqual(projectHeadlineRows(hostView()));
  });

  it('開始日が未設定でも空欄にしない', () => {
    expect(projectHeadlineRows(hostView({ startDate: null }))[2]?.value).toBe(NONE);
  });
});

describe('条件（`docs/04` §S-011 セクション 3）', () => {
  it('単価レンジ・勤務地・リモートの 3 行', () => {
    expect(projectConditionRows(hostView()).map((row) => row.key)).toEqual([
      'unitPrice',
      'prefecture',
      'remoteMode',
    ]);
  });

  it('🔴 取引先でも同じ 3 行が出る（外部公開用の単価レンジは隠さない）', () => {
    const rows = projectConditionRows(partnerView());
    expect(rows).toEqual(projectConditionRows(hostView()));
    expect(rows[0]?.value).toBe(`600,000〜800,000 ${t('projects.unitPrice.unit')}`);
  });

  it('🔴 条件の行に商流情報の値が 1 文字も現れない', () => {
    const serialized = JSON.stringify(projectConditionRows(hostView()));
    expect(serialized).not.toContain('架空エンド株式会社');
    expect(serialized).not.toContain('900,000');
  });

  it('未設定の勤務地・リモートは記号になる', () => {
    const rows = projectConditionRows(hostView({ prefecture: null, remoteMode: null }));
    expect(rows[1]?.value).toBe(NONE);
    expect(rows[2]?.value).toBe(NONE);
  });
});

describe('🔴 商流情報（ホストのみ）', () => {
  it('エンド企業名と自社単価の 2 行', () => {
    const rows = projectCommerceRows(hostView());
    expect(rows.map((row) => row.key)).toEqual(['endClientName', 'internalUnitPrice']);
    expect(rows[0]?.value).toBe('架空エンド株式会社');
    expect(rows[1]?.value).toBe(`900,000 ${t('projects.unitPrice.unit')}`);
  });

  it('未設定は記号（空欄にしない）', () => {
    const rows = projectCommerceRows(hostView({ endClientName: null, internalUnitPrice: null }));
    expect(rows[0]?.value).toBe(NONE);
    expect(rows[1]?.value).toBe(NONE);
  });

  it('🔴 取引先の view は引数として受け付けない（型で拒否される）', () => {
    // @ts-expect-error 🔴 `PartnerProjectDetailView` には商流情報が無い（`F-013 AC-2`）。
    //    「中身を見て出し分ける」形にしないための最後の 1 枚。
    expect(() => projectCommerceRows(partnerView())).toBeDefined();
  });
});

describe('🔴 F-013 AC-1: 要件は区分ごとに取り出せる', () => {
  const requirements = [
    requirement({ kind: 'MUST', skillId: 'sk-1', skillName: 'Java', requiredYears: 3 }),
    requirement({ kind: 'MUST', freeText: '要件定義の経験' }),
    requirement({ kind: 'NICE', skillId: 'sk-2', skillName: 'AWS', requiredYears: 1 }),
  ];

  it('必須だけを取り出す', () => {
    const rows = projectRequirementRows(requirements, 'MUST');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.requirement).toBe('Java');
    expect(rows[0]?.years).toBe(`3 ${t('projects.requirements.years.unit')}`);
    // 🔴 自由記述だけの要件も落とさない（辞書で表せない条件が消えると足切りが変わる）。
    expect(rows[1]?.requirement).toBe('要件定義の経験');
    expect(rows[1]?.years).toBe(NONE);
  });

  it('尚可だけを取り出す（必須が混ざらない）', () => {
    const rows = projectRequirementRows(requirements, 'NICE');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requirement).toBe('AWS');
  });

  it('🔴 区分ごとの行キーが衝突しない（必須と尚可で同じ添字を使っても別キーになる）', () => {
    const must = projectRequirementRows(requirements, 'MUST').map((row) => row.key);
    const nice = projectRequirementRows(requirements, 'NICE').map((row) => row.key);
    expect(new Set([...must, ...nice]).size).toBe(must.length + nice.length);
  });

  it('🔴 件数が多くても間引かない（要件は判断材料であり折りたたまない）', () => {
    const many = Array.from({ length: 25 }, (_unused, index) =>
      requirement({ kind: 'MUST', freeText: `条件 ${String(index)}` }),
    );
    expect(projectRequirementRows(many, 'MUST')).toHaveLength(25);
  });
});

describe('公開範囲（ホストのみ）', () => {
  it('会社名と公開日だけを持つ（提案数・他社の件数を持たない）', () => {
    const rows = projectVisibilityRows([
      { partnerCompanyId: 'p-1', partnerCompanyName: '架空パートナー A', publishedOn: '2026-08-01' },
    ]);
    expect(rows).toEqual([
      { key: 'p-1', partnerCompanyName: '架空パートナー A', publishedOn: '2026-08-01' },
    ]);
  });

  it('公開先が 0 件なら空配列（画面が警告を出す根拠になる）', () => {
    expect(projectVisibilityRows([])).toEqual([]);
  });
});
