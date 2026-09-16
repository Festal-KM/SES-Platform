// apps/web/lib/proposals/interview-rows.test.ts
// 🔴 `S-024` の「次に記録できる操作」の出し分け（T-09-10。docs/04 §S-024 / `F-025 AC-1`〜`AC-3` / docs/05 §6.5「`S-024` の実装の決着」）。
//
// 固定するもの:
//   ① 状態ごとに出る操作（ホスト）: SUBMITTED = 日程 + 辞退 / INTERVIEW_SCHEDULED = 実施 + 辞退 / INTERVIEWED = 結果待ち + 辞退 /
//      RESULT_PENDING = 決定 + 見送り + 辞退。終端・未送信は 0 個
//   ② 🔴 取引先（自社提案）: 6 本だけ（面談実施 / 結果待ち + 4 状態からの辞退。`PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS` と同数）。`SCHEDULE` / `WON` / `LOST` のボタンが**無い**（#48 の 403 と同じ判定 `canTransitionProposal`）
//   ③ `VIEWER` は 0 個
//   ④ 出し分けが遷移表と #48 の射程から導かれている（`PROPOSAL_STATES` × 全操作で `canTransition` と一致する）
//   ⑤ 終端（WON / LOST / WITHDRAWN）は `terminal` + 確認の説明を持つ
//   ⑥ 段階（RECORDABLE / CLOSED / NOT_YET_SUBMITTED）と注記（`WON` だけ `Assignment` の Phase 2 注記）
//   ⑦ 判断材料（提案先 / エンジニア / 案件 / 単価 / 開始日）と直近の履歴 3 件（新しい順）
import { describe, expect, it } from 'vitest';
import { PROPOSAL_STATES, proposalMachine, type GateResultView, type ProposalState } from '@ses/domain';
import { t } from '@ses/i18n';
import type { ProposalDetailScreenView } from './detail';
import { PROPOSAL_INTERVIEW_OPERATION_KINDS, type ProposalInterviewOperationKind } from './interview-note';
import {
  INTERVIEW_RECENT_EVENT_COUNT,
  proposalInterviewOperations,
  proposalInterviewPhase,
  proposalInterviewRows,
  PROPOSAL_INTERVIEW_OPERATION_TARGETS,
} from './interview-rows';
import { PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS, type ProposalTransitionActor } from './policy';
import type { HostProposalDetailView, PartnerProposalDetailView, ProposalEventView } from './views';

const NOW = new Date('2026-09-16T03:00:00.000Z');
const ID = '01930000-0000-7000-8000-000000000a10';
const HOST_USER = '01930000-0000-7000-8000-0000000000a1';
const PARTNER_USER = '01930000-0000-7000-8000-0000000000a2';
const PARTNER_COMPANY = '01930000-0000-7000-8000-0000000000c1';

const hostSales: ProposalTransitionActor = { userId: HOST_USER, role: 'SALES', partnerCompanyId: null };
const hostOwner: ProposalTransitionActor = { userId: HOST_USER, role: 'OWNER', partnerCompanyId: null };
const hostViewer: ProposalTransitionActor = { userId: HOST_USER, role: 'VIEWER', partnerCompanyId: null };
const partnerSales: ProposalTransitionActor = { userId: PARTNER_USER, role: 'PARTNER_SALES', partnerCompanyId: PARTNER_COMPANY };
const partnerAdmin: ProposalTransitionActor = { userId: PARTNER_USER, role: 'PARTNER_ADMIN', partnerCompanyId: PARTNER_COMPANY };
const partnerViewer: ProposalTransitionActor = { userId: PARTNER_USER, role: 'VIEWER', partnerCompanyId: PARTNER_COMPANY };

const hostSubject = { createdBy: HOST_USER };
const partnerSubject = { createdBy: PARTNER_USER };

function event(overrides: Partial<ProposalEventView> & Pick<ProposalEventView, 'id'>): ProposalEventView {
  return {
    occurredAt: '2026-09-15T01:00:00.000Z',
    actor: { kind: 'USER', displayName: '担当 太郎' },
    kind: 'STATE',
    fromState: null,
    toState: 'DRAFT',
    entry: { kind: 'TRANSITION', note: null },
    attachmentKey: null,
    ...overrides,
  };
}

const EVENTS: readonly ProposalEventView[] = [
  event({ id: 'e1' }),
  event({ id: 'e2', fromState: 'DRAFT', toState: 'GATE_RUNNING' }),
  event({ id: 'e3', fromState: 'GATE_RUNNING', toState: 'APPROVAL_PENDING', actor: { kind: 'SYSTEM' } }),
  event({ id: 'e4', fromState: 'APPROVAL_PENDING', toState: 'APPROVED', entry: { kind: 'APPROVAL', reviewGateId: 'gate-1' } }),
  event({ id: 'e5', fromState: 'APPROVED', toState: 'SUBMITTING', actor: { kind: 'SYSTEM' } }),
  event({ id: 'e6', fromState: 'SUBMITTING', toState: 'SUBMITTED', actor: { kind: 'SYSTEM' } }),
  event({ id: 'e7', fromState: 'SUBMITTED', toState: 'INTERVIEW_SCHEDULED', entry: { kind: 'TRANSITION', note: '面談日程: 2026-10-01 14:00' } }),
];

const GATE: GateResultView = {
  execution: 'DONE',
  layers: {
    pii: { state: 'PASS', findings: [] },
    commerce: { state: 'PASS', findings: [] },
    consistency: { state: 'PASS', findings: [] },
  },
  aiWarnings: [],
  aiFailed: false,
  contentHash: 'h',
};

function hostDetail(overrides: Partial<HostProposalDetailView> = {}): HostProposalDetailView {
  return {
    audience: 'HOST',
    owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' },
    sendHold: null,
    id: ID,
    state: 'INTERVIEW_SCHEDULED',
    origin: 'OWN',
    project: { id: '01930000-0000-7000-8000-0000000000f1', name: '基幹刷新' },
    recipient: { companyName: '架空エンド株式会社', email: 'to@example.test' },
    terms: { offeredUnitPrice: 650000, offeredStartDate: '2026-11-01', workStyle: '常駐' },
    content: { subject: 'ご提案', body: '本文（機微）', bodyOrigin: 'MANUAL' },
    snapshot: {
      frozenAt: '2026-09-15T01:00:00.000Z',
      displayName: '佐藤 花子',
      affiliationLabel: '株式会社パートナー',
      skills: [{ skillId: 's1', name: 'Java', years: 5, level: 4 }],
      careerCount: 1,
      careers: [{ periodFrom: '2024-04', periodTo: null, role: 'PL', description: '基幹刷新', technologies: 'Java' }],
      unitPriceMin: 600000,
      unitPriceMax: null,
      availableFrom: '2026-11-01',
      prefecture: '13',
      remoteMode: 'HYBRID',
    },
    attachment: { skillSheetId: null },
    contentHash: 'h',
    createdAt: '2026-09-15T01:00:00.000Z',
    updatedAt: '2026-09-16T02:00:00.000Z',
    events: EVENTS,
    createdByName: '担当 太郎',
    submittedAt: '2026-09-15T03:00:00.000Z',
    approval: { kind: 'USER', approverName: '承認 花子', approvedAt: '2026-09-15T02:00:00.000Z' },
    sendAttempts: [],
    lastFailureReason: null,
    ...overrides,
  };
}

function partnerDetail(overrides: Partial<PartnerProposalDetailView> = {}): PartnerProposalDetailView {
  const base = hostDetail();
  return {
    audience: 'PARTNER',
    id: base.id,
    state: base.state,
    origin: base.origin,
    project: base.project,
    recipient: base.recipient,
    terms: base.terms,
    content: base.content,
    snapshot: base.snapshot,
    attachment: base.attachment,
    contentHash: base.contentHash,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    events: base.events,
    createdByName: base.createdByName,
    submittedAt: base.submittedAt,
    ...overrides,
  };
}

function screen(detail: HostProposalDetailView | PartnerProposalDetailView): ProposalDetailScreenView {
  return { detail, gate: GATE, canAddNote: true };
}

function kinds(actor: ProposalTransitionActor, subject: { createdBy: string }, state: ProposalState): ProposalInterviewOperationKind[] {
  return proposalInterviewOperations(actor, subject, state).map((operation) => operation.kind);
}

const COMMERCIAL_STATES = ['SUBMITTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING'] as const;

describe('① ホストは状態ごとに「次に記録できる遷移」だけを得る（docs/04 §S-024）', () => {
  it.each([
    ['SUBMITTED', ['SCHEDULE', 'WITHDRAWN']],
    ['INTERVIEW_SCHEDULED', ['INTERVIEWED', 'WITHDRAWN']],
    ['INTERVIEWED', ['RESULT_PENDING', 'WITHDRAWN']],
    ['RESULT_PENDING', ['WON', 'LOST', 'WITHDRAWN']],
  ] as const)('%s → %j', (state, expected) => {
    expect(kinds(hostSales, hostSubject, state)).toEqual(expected);
    expect(kinds(hostOwner, partnerSubject, state)).toEqual(expected);
  });

  it('終端と未送信の状態では 0 個（S-024 から動かせる遷移が無い）', () => {
    for (const state of PROPOSAL_STATES) {
      if ((COMMERCIAL_STATES as readonly string[]).includes(state)) continue;
      expect(kinds(hostSales, hostSubject, state), state).toEqual([]);
    }
  });
});

describe('② 🔴 取引先は自社提案に対して 6 本だけ（2 + 4）（F-025 関連ロール / docs/04 §S-024 権限差分）', () => {
  it('SUBMITTED: 辞退だけ（面談日程の確定は無い）', () => {
    expect(kinds(partnerSales, partnerSubject, 'SUBMITTED')).toEqual(['WITHDRAWN']);
    expect(kinds(partnerAdmin, partnerSubject, 'SUBMITTED')).toEqual(['WITHDRAWN']);
  });

  it('INTERVIEW_SCHEDULED / INTERVIEWED: 面談実施 / 結果待ち + 辞退（ホストと同じ）', () => {
    expect(kinds(partnerSales, partnerSubject, 'INTERVIEW_SCHEDULED')).toEqual(['INTERVIEWED', 'WITHDRAWN']);
    expect(kinds(partnerSales, partnerSubject, 'INTERVIEWED')).toEqual(['RESULT_PENDING', 'WITHDRAWN']);
  });

  it('🔴 RESULT_PENDING: 辞退だけ（決定 / 見送りのボタンは描かれない = API の 403 と同じ判定）', () => {
    expect(kinds(partnerSales, partnerSubject, 'RESULT_PENDING')).toEqual(['WITHDRAWN']);
    const all = COMMERCIAL_STATES.flatMap((state) => kinds(partnerSales, partnerSubject, state));
    expect(all).not.toContain('SCHEDULE');
    expect(all).not.toContain('WON');
    expect(all).not.toContain('LOST');
    expect(all).toHaveLength(6);
    // 🔴 `policy.ts` の `PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS`（#48 の第 3 段）と同数 —— 画面の出し分けと API の 403 が同じ判定から出ている。
    expect(all).toHaveLength(PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS.length);
  });

  it('③ VIEWER（ホスト / 取引先）は 0 個', () => {
    for (const state of COMMERCIAL_STATES) {
      expect(kinds(hostViewer, hostSubject, state)).toEqual([]);
      expect(kinds(partnerViewer, partnerSubject, state)).toEqual([]);
    }
  });
});

describe('④ 出し分けは遷移表（CLAUDE.md §4.2）から導かれている', () => {
  it('ホストの操作の集合 = 全操作のうち proposalMachine.canTransition(state, to) が真のもの（状態の列挙を書き写していない）', () => {
    for (const state of PROPOSAL_STATES) {
      const expected = PROPOSAL_INTERVIEW_OPERATION_KINDS.filter((kind) =>
        proposalMachine.canTransition(state, PROPOSAL_INTERVIEW_OPERATION_TARGETS[kind]),
      );
      expect(kinds(hostSales, hostSubject, state), state).toEqual(expected);
    }
  });

  it('操作 → to の対応は 6 本で、`DRAFT`（GATE_FAILED → DRAFT は S-020 の範囲）を含まない', () => {
    expect(Object.values(PROPOSAL_INTERVIEW_OPERATION_TARGETS)).toEqual(['INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN']);
    expect(Object.values(PROPOSAL_INTERVIEW_OPERATION_TARGETS)).not.toContain('DRAFT');
  });
});

describe('⑤ 終端の操作は確認ステップを持つ', () => {
  it('WON / LOST / WITHDRAWN は terminal + confirmLead。進行の 3 本は確認なし', () => {
    const ops = [...proposalInterviewOperations(hostSales, hostSubject, 'RESULT_PENDING'), ...proposalInterviewOperations(hostSales, hostSubject, 'SUBMITTED')];
    const byKind = new Map(ops.map((operation) => [operation.kind, operation]));
    for (const kind of ['WON', 'LOST', 'WITHDRAWN'] as const) {
      expect(byKind.get(kind)?.terminal).toBe(true);
      expect(byKind.get(kind)?.confirmLead).toBe(t(`proposals.interview.confirm.lead.${kind}`));
    }
    expect(byKind.get('SCHEDULE')?.terminal).toBe(false);
    expect(byKind.get('SCHEDULE')?.confirmLead).toBeNull();
    // 入力欄: 日程は日時、実施は日付。結果 / 辞退は理由の欄。
    expect(byKind.get('SCHEDULE')?.inputs).toEqual({ scheduledAt: true, interviewedOn: false, memo: 'MEMO' });
    expect(byKind.get('WON')?.inputs).toEqual({ scheduledAt: false, interviewedOn: false, memo: 'REASON' });
  });

  it('🔴 見送り（LOST）と辞退（WITHDRAWN）は別の語・別の操作（F-025 AC-3 / BR-23）', () => {
    const ops = proposalInterviewOperations(hostSales, hostSubject, 'RESULT_PENDING');
    const labels = ops.map((operation) => operation.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain(t('proposals.interview.operation.LOST'));
    expect(labels).toContain(t('proposals.interview.operation.WITHDRAWN'));
  });
});

describe('⑥ 段階と注記', () => {
  it('RECORDABLE = 商談中の 4 状態 / CLOSED = 終端 3 状態 / NOT_YET_SUBMITTED = それ以外', () => {
    for (const state of PROPOSAL_STATES) {
      const expected = (COMMERCIAL_STATES as readonly string[]).includes(state)
        ? 'RECORDABLE'
        : proposalMachine.isTerminal(state)
          ? 'CLOSED'
          : 'NOT_YET_SUBMITTED';
      expect(proposalInterviewPhase(state), state).toBe(expected);
    }
  });

  it('🔴 WON だけ「稼働の登録は Phase 2」の注記を持ち、Assignment に相当する値は無い（F-025 AC-2）', () => {
    const won = proposalInterviewRows(screen(hostDetail({ state: 'WON' })), hostSales, hostSubject, NOW);
    expect(won.phase).toBe('CLOSED');
    expect(won.operations).toEqual([]);
    expect(won.closedNotice).toBe(t('proposals.interview.closed.WON'));
    expect(won.assignmentNote).toBe(t('proposals.interview.closed.WON.assignmentNote'));
    expect(Object.keys(won)).not.toContain('assignment');

    const lost = proposalInterviewRows(screen(hostDetail({ state: 'LOST' })), hostSales, hostSubject, NOW);
    expect(lost.closedNotice).toBe(t('proposals.interview.closed.LOST'));
    expect(lost.assignmentNote).toBeNull();

    const draft = proposalInterviewRows(screen(hostDetail({ state: 'DRAFT' })), hostSales, hostSubject, NOW);
    expect(draft.phase).toBe('NOT_YET_SUBMITTED');
    expect(draft.notRecordableNotice).toBe(t('proposals.interview.notRecordable'));
    expect(draft.operations).toEqual([]);
  });
});

describe('⑦ 判断材料と直近の履歴', () => {
  it('ヘッダは提案先 / エンジニア / 作成会社 / 案件 / 単価 / 開始日（S-021 と同じ関数の部分集合）。本文は載らない', () => {
    const rows = proposalInterviewRows(screen(hostDetail()), hostSales, hostSubject, NOW);
    expect(rows.header.map((row) => row.field)).toEqual(['recipient', 'engineer', 'owner', 'project', 'unit-price', 'start-date']);
    expect(rows.header.find((row) => row.field === 'unit-price')?.value).toBe('650,000');
    expect(rows.header.find((row) => row.field === 'recipient')?.value).toContain('架空エンド株式会社');
    expect(JSON.stringify(rows)).not.toContain('本文（機微）');
    expect(rows.audienceNotice).toBeNull();
    expect(rows.detailHref).toBe(`/proposals/${ID}`);
  });

  it('直近の履歴は新しい順に 3 件。TRANSITION の note（#48 のメモ）は detail としてそのまま描かれる', () => {
    const rows = proposalInterviewRows(screen(hostDetail()), hostSales, hostSubject, NOW);
    expect(INTERVIEW_RECENT_EVENT_COUNT).toBe(3);
    expect(rows.recent.map((row) => row.id)).toEqual(['e7', 'e6', 'e5']);
    expect(rows.recent[0]?.kind).toBe('TRANSITION');
    expect(rows.recent[0]?.detail).toBe('面談日程: 2026-10-01 14:00');
  });

  it('取引先の rows: 注記が付き、操作は自社提案の 6 本の範囲、作成会社の欄は無い（型に無い）', () => {
    const rows = proposalInterviewRows(screen(partnerDetail({ state: 'RESULT_PENDING' })), partnerSales, partnerSubject, NOW);
    expect(rows.audience).toBe('PARTNER');
    expect(rows.audienceNotice).toBe(t('proposals.interview.partnerNotice'));
    expect(rows.operations.map((operation) => operation.kind)).toEqual(['WITHDRAWN']);
    expect(rows.header.map((row) => row.field)).not.toContain('owner');
  });
});
