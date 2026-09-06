// apps/web/app/(main)/projects/[id]/project-detail-screen.render.test.tsx
// `ProjectDetailScreen`（`S-011`）の視点別描画テスト。T-06-02。
//
// 🔴 なぜこの粒度が要るか: `F-013 AC-2` / `F-014 AC-4` は「**描かれていないこと**」が要件であり、
//    API のテスト（応答の形）でも型テスト（フィールドの有無）でも示せない最後の 1 段がここにある
//    —— 型の上では無いフィールドでも、画面が別経路（props・定数・文言）で同じ値を出してしまえば
//    同じ事故になる。**取引先視点の HTML に商流情報の文字列が 1 つも現れないこと**を、
//    描画結果そのもので固定する（`engineer-ledger-screen.render.test.tsx` と同じ判断）。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RequirementKind } from '@ses/db';
import type {
  HostProjectDetailView,
  PartnerProjectDetailView,
  ProjectRequirementView,
} from '../../../../lib/projects/service';
import {
  ProjectDetailScreen,
  type ProjectDetailScreenMessages,
} from './project-detail-screen';

/** 🔴 取引先の HTML に 1 度も現れてはならない値。 */
const END_CLIENT_NAME = '架空エンド株式会社';
const INTERNAL_UNIT_PRICE = 987_654;
const PARTNER_A_NAME = '架空パートナー A';
const PARTNER_B_NAME = '架空パートナー B';

const REQUIREMENT_KINDS: readonly RequirementKind[] = ['MUST', 'NICE'];

const REQUIREMENTS: readonly ProjectRequirementView[] = [
  { kind: 'MUST', skillId: 'sk-1', skillName: 'Java', freeText: null, requiredYears: 3 },
  { kind: 'NICE', skillId: null, skillName: null, freeText: 'AWS の運用経験', requiredYears: null },
];

const SHARED = {
  id: '01930000-0000-7000-8000-0000000000a1',
  name: '合成案件（詳細）',
  status: 'OPEN',
  headcount: 2,
  startDate: '2026-10-01',
  unitPriceMin: 600_000,
  unitPriceMax: 800_000,
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  publicSummary: '公開用の概要（合成データ）',
  requirements: REQUIREMENTS,
} as const;

function hostView(overrides: Partial<HostProjectDetailView> = {}): HostProjectDetailView {
  return {
    ...SHARED,
    audience: 'HOST',
    endClientName: END_CLIENT_NAME,
    internalUnitPrice: INTERNAL_UNIT_PRICE,
    visibilities: [
      { partnerCompanyId: 'p-1', partnerCompanyName: PARTNER_A_NAME, publishedOn: '2026-08-01' },
      { partnerCompanyId: 'p-2', partnerCompanyName: PARTNER_B_NAME, publishedOn: '2026-08-02' },
    ],
    ...overrides,
  };
}

function partnerView(): PartnerProjectDetailView {
  return { ...SHARED, audience: 'PARTNER' };
}

const messages: ProjectDetailScreenMessages = {
  sectionRequirements: '要件',
  sectionConditions: '条件',
  sectionCommerce: '商流情報（内部用）',
  sectionPublicSummary: '外部公開用の記載',
  sectionVisibility: '公開範囲',
  sectionProposals: 'この案件への提案',
  requirementHeadings: { MUST: '必須要件', NICE: '尚可要件' },
  requirementNotes: { MUST: '必須の説明', NICE: '尚可の説明' },
  requirementEmpties: { MUST: '必須要件はありません', NICE: '尚可要件はありません' },
  requirementColumnRequirement: '要件',
  requirementColumnYears: '必要年数',
  publicSummaryEmpty: '—',
  commerceNotice: 'この情報は公開範囲の相手には表示されません。',
  visibilityEmpty: 'この案件はまだどの取引先にも公開されていません。',
  visibilityColumnPartner: '取引先',
  visibilityColumnPublishedOn: '公開日',
  visibilityProposalCountComingSoon: '提案数は後続のリリース。',
  visibilitySettingsComingSoon: '公開範囲の設定は後続のリリース。',
  partnerPublished: 'この案件は御社に公開されています。',
  proposalsEmpty: 'まだ提案はありません。',
  proposalsComingSoon: '提案の一覧は後続のリリース。',
  candidatesComingSoon: '候補の検索は後続のリリース。',
  edit: '編集',
  viewRecorded: 'この案件の閲覧は監査ログに記録されます。',
};

function render(
  view: HostProjectDetailView | PartnerProjectDetailView,
  canEdit = true,
): string {
  return renderToStaticMarkup(
    createElement(ProjectDetailScreen, {
      view,
      requirementKinds: REQUIREMENT_KINDS,
      canEdit,
      messages,
    }),
  );
}

describe('🔴 F-013 AC-2: 取引先の画面に商流情報が現れない', () => {
  it('エンド企業名・自社単価が HTML に 1 文字も無い', () => {
    const html = render(partnerView());

    expect(html).not.toContain(END_CLIENT_NAME);
    expect(html).not.toContain('987,654');
    expect(html).not.toContain(messages.sectionCommerce);
    expect(html).not.toContain(messages.commerceNotice);
    expect(html).not.toContain('project-detail-commerce');
  });

  it('ホストには同じ値が出る（対照。「そもそも描いていない」ではないことの確認）', () => {
    const html = render(hostView());

    expect(html).toContain(END_CLIENT_NAME);
    expect(html).toContain('987,654');
    expect(html).toContain('data-testid="project-detail-commerce-endClientName"');
  });
});

describe('🔴 F-014 AC-4 / BR-07: 取引先が他社の存在を知る手段が無い', () => {
  it('公開先の社名・件数・公開範囲セクションが HTML に無い', () => {
    const html = render(partnerView());

    expect(html).not.toContain(PARTNER_A_NAME);
    expect(html).not.toContain(PARTNER_B_NAME);
    expect(html).not.toContain(messages.sectionVisibility);
    expect(html).not.toContain('project-detail-visibility');
  });

  it('🔴 「他 N 社」「N 件中」に相当する数字を含まない（件数バッジ・示唆を作らない）', () => {
    const html = render(partnerView());

    // 公開先は 2 社あるが、取引先の HTML には社数を表す数字が現れない。
    expect(html).not.toContain('2 社');
    expect(html).not.toContain(String(SHARED.requirements.length) + ' 件');
  });

  it('ホストには公開先テーブルが出る（対照）', () => {
    const html = render(hostView());

    expect(html).toContain('data-testid="project-detail-visibility-table"');
    expect(html).toContain(PARTNER_A_NAME);
    expect(html).toContain(PARTNER_B_NAME);
  });
});

describe('🔴 F-014 AC-2: 公開先が 0 件のホストには警告が出る', () => {
  it('要件より前に警告が置かれる（設定を忘れると誰にも届かないため）', () => {
    const html = render(hostView({ visibilities: [] }));

    const warningIndex = html.indexOf('data-testid="project-detail-visibility-warning"');
    const requirementsIndex = html.indexOf('data-testid="project-detail-requirements"');
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(requirementsIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeLessThan(requirementsIndex);
  });

  it('🔴 取引先には警告を出さない（公開範囲はホストの関心事である）', () => {
    expect(render(partnerView())).not.toContain(messages.visibilityEmpty);
  });
});

describe('取引先の見え方（docs/04 §S-011 取引先セクション）', () => {
  it('公開されている旨の説明が出る', () => {
    const html = render(partnerView());

    expect(html).toContain('data-testid="project-detail-partner-published"');
    expect(html).toContain(messages.partnerPublished);
  });

  it('🔴 要件・条件・外部公開用の記載は取引先にも出る（判断材料を隠さない）', () => {
    const html = render(partnerView());

    expect(html).toContain('Java');
    expect(html).toContain('AWS の運用経験');
    // 外部公開用の単価レンジは出す（内部単価とは別の列である）。
    expect(html).toContain('600,000〜800,000');
    expect(html).toContain(SHARED.publicSummary);
  });

  it('🔴 編集への導線を出さない（`canEdit=false`）', () => {
    expect(render(partnerView(), false)).not.toContain('project-detail-edit-link');
  });
});

describe('共通', () => {
  it('🔴 見出しの 3 値は折りたたみの外にある（CLAUDE.md §13.3）', () => {
    for (const html of [render(hostView()), render(partnerView())]) {
      expect(html).toContain('data-testid="project-detail-headline-status"');
      expect(html).toContain('data-testid="project-detail-headline-headcount"');
      expect(html).toContain('data-testid="project-detail-headline-startDate"');
      // 折りたたみ要素（`<details>`）を使っていない ＝ 既定で隠れる項目が無い。
      expect(html).not.toContain('<details');
    }
  });

  it('必須 / 尚可の 2 ブロックが区分ごとに描かれる（`F-013 AC-1`）', () => {
    const html = render(hostView());

    expect(html).toContain('data-testid="project-detail-requirements-MUST"');
    expect(html).toContain('data-testid="project-detail-requirements-NICE"');
  });

  it('🔴 閲覧が記録される旨を出す（`BR-27` / `F-013 AC-3`）', () => {
    for (const html of [render(hostView()), render(partnerView())]) {
      expect(html).toContain(messages.viewRecorded);
    }
  });

  it('判別子が DOM に出る（E2E がホスト / 取引先の枝を取り違えないための目印）', () => {
    expect(render(hostView())).toContain('data-audience="HOST"');
    expect(render(partnerView())).toContain('data-audience="PARTNER"');
  });
});
