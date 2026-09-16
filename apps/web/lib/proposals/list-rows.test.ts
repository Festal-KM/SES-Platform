// apps/web/lib/proposals/list-rows.test.ts
// 🔴 `S-019` の表示値（`F-024 AC-2` の 4 区分 / docs/05 §10.4 の保留の別表示 / `docs/04` §S-019）。T-09-09。
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_STATES, PROPOSAL_STATES, type ProposalRequestState, type ProposalState } from '@ses/domain';
import { t } from '@ses/i18n';
import {
  hostProposalListRows,
  isProposalListFiltered,
  partnerProposalListRows,
  PROPOSAL_FAILURE_STATES,
  proposalFailureKindOf,
  proposalListSummary,
  proposalRequestStateChips,
  proposalRequestStateLabelInRequestsScreen,
  proposalStateChips,
  SUBMITTING_STUCK_MINUTES,
} from './list-rows';
import type { HostProposalListItem, PartnerProposalListItem, ProposalCountByState, ProposalRequestCountByState } from './views';

const NOW = new Date('2026-09-16T03:00:00.000Z');

function host(overrides: Partial<HostProposalListItem> = {}): HostProposalListItem {
  return {
    audience: 'HOST',
    owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' },
    sendHold: null,
    lastFailureReason: null,
    sendAttempts: [],
    id: '01930000-0000-7000-8000-000000000a01',
    state: 'APPROVAL_PENDING',
    origin: 'OWN',
    project: { id: '01930000-0000-7000-8000-0000000000f1', name: '基幹刷新' },
    recipient: { companyName: '架空エンド株式会社', email: 'to@example.test' },
    engineerDisplayName: '佐藤 花子',
    offeredUnitPrice: 650000,
    createdByName: '担当 太郎',
    createdAt: '2026-09-15T01:00:00.000Z',
    updatedAt: '2026-09-16T02:00:00.000Z',
    ...overrides,
  };
}

function partner(overrides: Partial<PartnerProposalListItem> = {}): PartnerProposalListItem {
  const base = host();
  return {
    audience: 'PARTNER',
    id: base.id,
    state: base.state,
    origin: base.origin,
    project: base.project,
    recipient: base.recipient,
    engineerDisplayName: base.engineerDisplayName,
    offeredUnitPrice: base.offeredUnitPrice,
    createdByName: base.createdByName,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    ...overrides,
  };
}

function counts(partial: Partial<Record<ProposalState, number>> = {}): ProposalCountByState {
  return Object.fromEntries(PROPOSAL_STATES.map((state) => [state, partial[state] ?? 0])) as ProposalCountByState;
}

function requestCounts(partial: Partial<Record<ProposalRequestState, number>> = {}): ProposalRequestCountByState {
  return Object.fromEntries(PROPOSAL_REQUEST_STATES.map((state) => [state, partial[state] ?? 0])) as ProposalRequestCountByState;
}

describe('🔴 F-024 AC-2: 4 つの「うまくいかなかった」は別のチップ・別の語・別の区分', () => {
  it('状態チップは 14 状態がそれぞれ独立に 1 つ。GATE_FAILED / SUBMIT_FAILED / LOST は failureKind が別値、他は null', () => {
    const chips = proposalStateChips(counts({ GATE_FAILED: 1, SUBMIT_FAILED: 2, LOST: 3, APPROVED: 4 }), ['SUBMIT_FAILED']);
    expect(chips.map((chip) => chip.state)).toEqual([...PROPOSAL_STATES]);
    expect(new Set(chips.map((chip) => chip.label)).size).toBe(PROPOSAL_STATES.length);
    const byState = new Map(chips.map((chip) => [chip.state, chip]));
    expect(byState.get('GATE_FAILED')).toMatchObject({ count: 1, failureKind: 'GATE_FAILED', indicator: 'GATE_FAILURE', checked: false });
    expect(byState.get('SUBMIT_FAILED')).toMatchObject({ count: 2, failureKind: 'SUBMIT_FAILED', indicator: 'DELIVERY_FAILURE', checked: true });
    expect(byState.get('LOST')).toMatchObject({ count: 3, failureKind: 'LOST', indicator: 'CONVERSION', checked: false });
    expect(byState.get('APPROVED')).toMatchObject({ count: 4, failureKind: null, indicator: 'IN_PROGRESS' });
    expect(byState.get('WITHDRAWN')?.failureKind).toBeNull();
    // 3 区分の語は互いに異なる。
    const labels = PROPOSAL_FAILURE_STATES.map((state) => byState.get(state)?.label);
    expect(new Set(labels).size).toBe(3);
  });

  it('🔴 提案依頼の DECLINED は別ブロック（S-017 への導線）。語は「依頼を辞退」で、Proposal の WITHDRAWN（辞退）と別', () => {
    const chips = proposalRequestStateChips(requestCounts({ DECLINED: 2, REQUESTED: 1 }));
    expect(chips.map((chip) => chip.state)).toEqual([...PROPOSAL_REQUEST_STATES]);
    const declined = chips.find((chip) => chip.state === 'DECLINED');
    expect(declined).toMatchObject({ count: 2, href: '/proposal-requests?state=DECLINED' });
    expect(declined?.label).toBe(t('proposals.list.requestState.DECLINED'));
    expect(declined?.label).not.toBe(t('proposals.state.WITHDRAWN'));
    expect(declined?.label).not.toBe(t('proposals.state.LOST'));
    expect(declined?.label).not.toBe(t('proposals.state.SUBMIT_FAILED'));
    expect(declined?.label).not.toBe(t('proposals.state.GATE_FAILED'));
    // 提案依頼側の他 4 語は S-017 と同じ。DECLINED だけ S-019 では「依頼を」を添える（Proposal の語と並ぶため）。
    for (const state of PROPOSAL_REQUEST_STATES) {
      const chip = chips.find((candidate) => candidate.state === state);
      if (state === 'DECLINED') expect(chip?.label).not.toBe(proposalRequestStateLabelInRequestsScreen(state));
      else expect(chip?.label).toBe(proposalRequestStateLabelInRequestsScreen(state));
    }
  });

  it('proposalFailureKindOf は 3 状態だけ非 null（ProposalRequest の状態は引数の型が受け付けない）', () => {
    for (const state of PROPOSAL_STATES) {
      expect(proposalFailureKindOf(state)).toBe((PROPOSAL_FAILURE_STATES as readonly string[]).includes(state) ? state : null);
    }
  });
});

describe('🔴 docs/05 §10.4: 保留は SUBMIT_FAILED と別の印', () => {
  it('保留中の APPROVED の行は状態バッジが承認済みのまま hold を持ち、failureKind は null', () => {
    const [row] = hostProposalListRows(
      [host({ state: 'APPROVED', sendHold: { reasonKey: 'DOMAIN_UNVERIFIED', since: '2026-09-16T00:00:00.000Z' } })],
      NOW,
    );
    expect(row).toMatchObject({ state: 'APPROVED', stateLabel: t('proposals.state.APPROVED'), failureKind: null, tone: 'success' });
    expect(row?.hold).toEqual({ label: t('proposals.list.hold.badge'), message: t('sendHold.DOMAIN_UNVERIFIED') });
    expect(row?.hold?.label).not.toBe(t('proposals.state.SUBMIT_FAILED'));
  });

  it('SUBMIT_FAILED の行は failureKind = SUBMIT_FAILED で hold は null。ホストの行は作成会社を持つ', () => {
    const [row] = hostProposalListRows([host({ state: 'SUBMIT_FAILED', lastFailureReason: 'UNKNOWN:TimeoutError' })], NOW);
    expect(row).toMatchObject({ failureKind: 'SUBMIT_FAILED', hold: null, tone: 'danger', owner: 'Partner A1' });
    expect(hostProposalListRows([host({ owner: { kind: 'HOST' } })], NOW)[0]?.owner).toBe(t('proposals.list.owner.host'));
  });

  it('取引先の行は owner / hold が常に null（入力の型に無い）', () => {
    const [row] = partnerProposalListRows([partner({ state: 'SUBMITTED' })], NOW);
    expect(row).toMatchObject({ owner: null, hold: null, state: 'SUBMITTED', failureKind: null });
  });
});

describe('行の表示値', () => {
  it('提案先未設定 / 案件非公開 / 凍結なし / 作成者不明 の語。単価は 3 桁区切り。href は S-023', () => {
    const [row] = partnerProposalListRows([partner({ recipient: null, project: null, engineerDisplayName: null, createdByName: null, offeredUnitPrice: null })], NOW);
    expect(row).toMatchObject({
      recipient: t('proposals.list.recipient.unset'),
      project: t('proposals.list.project.notShared'),
      engineer: t('proposals.list.engineer.unknown'),
      createdBy: t('proposals.list.createdBy.unknown'),
      unitPrice: t('proposals.list.valueNone'),
      href: `/proposals/${host().id}`,
    });
    expect(hostProposalListRows([host()], NOW)[0]?.unitPrice).toBe('650,000');
  });

  it('GATE_RUNNING / SUBMITTING は進行中。SUBMITTING が 30 分以上なら注記', () => {
    const fresh = hostProposalListRows([host({ state: 'SUBMITTING', updatedAt: '2026-09-16T02:50:00.000Z' })], NOW)[0];
    expect(fresh).toMatchObject({ inProgress: true, stuckSubmitting: false });
    const old = new Date(NOW.getTime() - SUBMITTING_STUCK_MINUTES * 60_000).toISOString();
    expect(hostProposalListRows([host({ state: 'SUBMITTING', updatedAt: old })], NOW)[0]?.stuckSubmitting).toBe(true);
    expect(hostProposalListRows([host({ state: 'GATE_RUNNING' })], NOW)[0]).toMatchObject({ inProgress: true, stuckSubmitting: false });
    expect(hostProposalListRows([host({ state: 'DRAFT' })], NOW)[0]?.inProgress).toBe(false);
  });
});

describe('ヘッダと導線', () => {
  it('S-022 への導線は「ホスト × SUBMIT_FAILED が 1 件以上」のときだけ', () => {
    expect(proposalListSummary('HOST', 3, counts({ SUBMIT_FAILED: 1 })).sendFailuresHref).toBe('/proposals/send-failures');
    expect(proposalListSummary('HOST', 3, counts({ APPROVED: 5 })).sendFailuresHref).toBeNull();
    expect(proposalListSummary('PARTNER', 3, counts({ SUBMIT_FAILED: 1 })).sendFailuresHref).toBeNull();
    expect(proposalListSummary('PARTNER', 24, counts()).lead).toBe(t('proposals.list.lead.partner'));
    expect(proposalListSummary('HOST', 1234, counts()).total).toContain('1,234');
  });

  it('絞り込みの判定（state / projectId / engineerId / q のいずれか）', () => {
    const base = { limit: 50, cursor: undefined, state: undefined, projectId: undefined, engineerId: undefined, q: undefined };
    expect(isProposalListFiltered(base)).toBe(false);
    expect(isProposalListFiltered({ ...base, state: ['LOST'] })).toBe(true);
    expect(isProposalListFiltered({ ...base, q: 'x' })).toBe(true);
    expect(isProposalListFiltered({ ...base, projectId: '01930000-0000-7000-8000-0000000000f1' })).toBe(true);
  });
});
