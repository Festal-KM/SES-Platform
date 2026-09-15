// apps/web/lib/proposal-requests/detail-rows.test.ts
// `S-018` の表示値の組み立て（`proposalRequestDetailRows`）のユニットテスト。T-08-07。
//
// 🔴 ここで固定するもの（DB 無し）:
//   ① 判断材料（案件の見出し・条件・必須/尚可要件・依頼メッセージ・期限・開示される 3 項目）が組み立てられる
//   ② 🔴 案件が公開されていない（`project: null`）ときは `canAccept` が偽で、`canDecline` は真のまま（辞退の自由。`BR-57`）
//   ③ 状態が `REQUESTED` 以外なら応諾も辞退もできず、状態ごとの専用文言が付く（`F-018 AC-5`。別々の語）
//   ④ `declineReason` は自社の記録としてそのまま出る（ホスト向けの型には存在しない —— `views.types.test.ts`）
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_STATES, type ProposalRequestState } from '@ses/domain';
import { disclosureItems, proposalRequestDetailRows } from './detail-rows';
import type { PartnerProposalRequestDetailView } from './views';

const REQUEST_ID = '01930000-0000-7000-8000-000000000201';
const PROJECT_ID = '01930000-0000-7000-8000-0000000000f1';
const ENGINEER_ID = '01930000-0000-7000-8000-0000000000e2';

const VIEW: PartnerProposalRequestDetailView = {
  id: REQUEST_ID,
  project: {
    id: PROJECT_ID,
    name: '架空案件',
    status: 'OPEN',
    headcount: 2,
    startDate: '2026-11-01',
    unitPriceMin: 600000,
    unitPriceMax: 700000,
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    publicSummary: '公開用の概要',
    requirements: [
      { kind: 'MUST', skillId: 's-1', skillName: 'TypeScript', freeText: null, requiredYears: 3 },
      { kind: 'NICE', skillId: null, skillName: null, freeText: 'AWS の運用経験', requiredYears: null },
    ],
  },
  engineer: { id: ENGINEER_ID, displayName: '山田 太郎' },
  state: 'REQUESTED',
  message: '11 月開始を希望します。',
  expiresAt: '2026-09-22T14:59:59.000Z',
  createdAt: '2026-09-15T01:00:00.000Z',
  respondedAt: null,
  declineReason: null,
  proposalId: null,
};

describe('🔴 S-018 の判断材料が省略されない（CLAUDE.md §13.3 / docs/04 §S-018）', () => {
  it('案件名・見出し 3 行・条件 3 行・必須 / 尚可要件・依頼メッセージ・期限・開示 3 項目が組み立てられる', () => {
    const rows = proposalRequestDetailRows(VIEW);
    expect(rows.project?.name).toBe('架空案件');
    expect(rows.project?.headline.map((row) => row.key)).toEqual(['status', 'headcount', 'startDate']);
    expect(rows.project?.conditions.map((row) => row.key)).toEqual(['unitPrice', 'prefecture', 'remoteMode']);
    expect(rows.project?.mustRequirements.map((row) => row.requirement)).toEqual(['TypeScript']);
    expect(rows.project?.niceRequirements.map((row) => row.requirement)).toEqual(['AWS の運用経験']);
    expect(rows.project?.href).toBe(`/projects/${PROJECT_ID}`);
    expect(rows.message).toBe('11 月開始を希望します。');
    expect(rows.expiresAtIso).toBe('2026-09-22T14:59:59.000Z');
    expect(rows.expiresAt).toContain('2026-09-22');
    expect(rows.engineer).toEqual({ id: ENGINEER_ID, displayName: '山田 太郎', href: `/engineers/${ENGINEER_ID}` });
    expect(rows.canAccept).toBe(true);
    expect(rows.canDecline).toBe(true);
    expect(rows.closedNotice).toBeNull();
    expect(rows.listHref).toBe('/proposal-requests');
    // 🔴 `F-018 AC-3`: 開示される項目は 3 つ（氏名 / 貴社名 / スキルシート）。増やさない。
    expect(disclosureItems()).toHaveLength(3);
  });

  it('🔴 案件が公開されていない（project: null）ときは応諾できず、辞退はできる（BR-57）', () => {
    const rows = proposalRequestDetailRows({ ...VIEW, project: null });
    expect(rows.project).toBeNull();
    expect(rows.canAccept).toBe(false);
    expect(rows.canDecline).toBe(true);
    expect(rows.closedNotice).toBeNull();
  });

  it.each(
    PROPOSAL_REQUEST_STATES.filter((state): state is Exclude<ProposalRequestState, 'REQUESTED'> => state !== 'REQUESTED'),
  )('🔴 %s では応諾も辞退もできず、専用の文言が付く（F-018 AC-5: 状態ごとに別の語）', (state) => {
    const rows = proposalRequestDetailRows({ ...VIEW, state, respondedAt: '2026-09-16T02:00:00.000Z' });
    expect(rows.canAccept).toBe(false);
    expect(rows.canDecline).toBe(false);
    expect(rows.closedNotice).not.toBeNull();
    expect(rows.respondedAt).toContain('2026-09-16');
  });

  it('終端 4 状態の専用文言はすべて異なる（「失効」に畳まない）', () => {
    const notices = (['ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN_BY_HOST'] as const).map(
      (state) => proposalRequestDetailRows({ ...VIEW, state }).closedNotice,
    );
    expect(new Set(notices).size).toBe(4);
  });

  it('辞退の理由と下書き ID は自社の記録としてそのまま出る', () => {
    expect(proposalRequestDetailRows({ ...VIEW, state: 'DECLINED', declineReason: '社内都合' }).declineReason).toBe('社内都合');
    expect(
      proposalRequestDetailRows({ ...VIEW, state: 'ACCEPTED', proposalId: '01930000-0000-7000-8000-000000000301' }).proposalId,
    ).toBe('01930000-0000-7000-8000-000000000301');
  });

  it('台帳の行が消えた競合では engineer が null（落とさない）', () => {
    expect(proposalRequestDetailRows({ ...VIEW, engineer: null }).engineer).toBeNull();
  });
});
