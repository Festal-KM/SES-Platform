// apps/web/lib/proposal-requests/list-rows.test.ts
// `S-017` の行の組み立て（docs/04 §S-017 / `F-018 AC-1` / `AC-5`）。T-08-06。
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_STATES } from '@ses/domain';
import {
  hostProposalRequestRows,
  partnerProposalRequestRows,
  PROPOSAL_REQUEST_STATE_MESSAGE_KEYS,
  proposalRequestsHref,
  proposalRequestStateOptions,
  type ProposalRequestRowView,
} from './list-rows';
import type { HostProposalRequestView, PartnerProposalRequestView } from './views';

const HOST_ITEM: HostProposalRequestView = {
  id: '01930000-0000-7000-8000-000000000201',
  project: { id: '01930000-0000-7000-8000-0000000000f1', name: 'Project A' },
  state: 'REQUESTED',
  message: '11 月開始を希望します。',
  expiresAt: '2026-09-22T14:59:59.000Z',
  createdAt: '2026-09-15T01:00:00.000Z',
  respondedAt: null,
};

describe('🔴 ホストの行: 候補列は「共有候補（匿名）」の一語で、依頼先・engineer_id・辞退理由の欄が無い', () => {
  it('REQUESTED は取り下げ可、他の 4 状態は不可（別々の状態バッジになる。F-018 AC-5）', () => {
    const rows = hostProposalRequestRows(
      PROPOSAL_REQUEST_STATES.map((state, index) => ({
        ...HOST_ITEM,
        id: `${HOST_ITEM.id.slice(0, -1)}${index}`,
        state,
        respondedAt: state === 'REQUESTED' ? null : '2026-09-16T02:00:00.000Z',
      })),
    );
    expect(rows.map((row) => row.state)).toEqual([...PROPOSAL_REQUEST_STATES]);
    expect(rows.map((row) => row.canWithdraw)).toEqual([true, false, false, false, false]);
    // 🔴 5 状態の文言が相異なる（「失効」に畳まれていない）。
    expect(new Set(rows.map((row) => row.stateLabel)).size).toBe(5);
    // 候補列は一語。
    for (const row of rows) expect(row.candidate).toBe('共有候補（匿名）');
    // 最終更新は respondedAt ?? createdAt。
    expect(rows[0]?.updatedAt).toBe('2026-09-15 10:00 JST');
    expect(rows[1]?.updatedAt).toBe('2026-09-16 11:00 JST');
  });

  it('🔴 行のキー集合に依頼先・engineer_id・辞退理由・応答者が無い', () => {
    const [row] = hostProposalRequestRows([HOST_ITEM]);
    const keys = Object.keys(row as ProposalRequestRowView).sort();
    expect(keys).toEqual(
      [
        'canWithdraw',
        'candidate',
        'createdAt',
        'expiresAt',
        'expiresAtIso',
        'id',
        'message',
        'projectId',
        'projectName',
        'respondHref',
        'state',
        'stateLabel',
        'updatedAt',
      ].sort(),
    );
    for (const forbidden of ['partnerCompanyId', 'partnerCompanyName', 'engineerId', 'declineReason', 'respondedBy']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('案件が読めないとき（削除競合）は案件名の代わりの文言になり、導線が無い', () => {
    const [row] = hostProposalRequestRows([{ ...HOST_ITEM, project: null }]);
    expect(row?.projectId).toBeNull();
    expect(row?.projectName).toBe('（案件名は公開されていません）');
  });
});

describe('取引先の行: 自社の台帳の表示名を出し、取り下げの導線は無い', () => {
  const item: PartnerProposalRequestView = {
    ...HOST_ITEM,
    engineer: { id: '01930000-0000-7000-8000-0000000000e2', displayName: '山田 太郎' },
  };

  it('自社エンジニアの実名（自社の情報）と、公開されていない案件の断り方', () => {
    const [shared, notShared] = partnerProposalRequestRows([item, { ...item, project: null }]);
    expect(shared?.candidate).toBe('山田 太郎');
    expect(shared?.canWithdraw).toBe(false);
    // 🔴 T-08-07: 取引先の行だけが `S-018` への導線を持つ（ホストの行は null。`S-018` に到達しない）。
    expect(shared?.respondHref).toBe(`/proposal-requests/${item.id}`);
    expect(hostProposalRequestRows([HOST_ITEM])[0]?.respondHref).toBeNull();
    expect(shared?.projectName).toBe('Project A');
    expect(notShared?.projectName).toBe('（案件名は公開されていません）');
    expect(notShared?.projectId).toBeNull();
  });

  it('台帳の行が消えた競合では `—`（落とさない）', () => {
    const [row] = partnerProposalRequestRows([{ ...item, engineer: null }]);
    expect(row?.candidate).toBe('—');
  });
});

describe('状態フィルタと URL', () => {
  it('選択肢は「すべて」+ 5 状態で、文言キーは Record が全状態を持つ', () => {
    const options = proposalRequestStateOptions();
    expect(options.map((option) => option.value)).toEqual(['', ...PROPOSAL_REQUEST_STATES]);
    expect(Object.keys(PROPOSAL_REQUEST_STATE_MESSAGE_KEYS).sort()).toEqual([...PROPOSAL_REQUEST_STATES].sort());
  });

  it('URL は状態とカーソルだけを載せる（limit を載せない）', () => {
    expect(proposalRequestsHref({ state: undefined }, null)).toBe('/proposal-requests');
    expect(proposalRequestsHref({ state: 'DECLINED' }, null)).toBe('/proposal-requests?state=DECLINED');
    expect(proposalRequestsHref({ state: 'REQUESTED' }, HOST_ITEM.id)).toBe(
      `/proposal-requests?state=REQUESTED&cursor=${HOST_ITEM.id}`,
    );
  });
});
