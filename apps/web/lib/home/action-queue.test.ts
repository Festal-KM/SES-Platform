// apps/web/lib/home/action-queue.test.ts
// 要対応キューの組み立て（`lib/home/action-queue.ts`。docs/04 §S-003 セクション 1 / §S-004 セクション 1・2 / docs/05 §10.4 /
// `F-024 AC-2` / `BR-23` / `BR-60`）。T-12-15。DB 無し（母集団の境界は `tests/isolation/home-action-queue.test.ts`）。
import { describe, expect, it } from 'vitest';
import { SEND_HOLD_REASON_KEYS, type SendHoldReasonKey } from '@ses/domain';
import type { HostProposalRequestView, PartnerProposalRequestView } from '../proposal-requests/views';
import type { HostProposalListItem, PartnerProposalListItem } from '../proposals/views';
import {
  ACTION_QUEUE_SEND_HOLD_REASONS,
  buildActionQueueBlock,
  CHANGED_SINCE_SAFETY_MARGIN_MS,
  HOST_ACTION_QUEUE_KIND_ORDER,
  isActionQueueSendHoldReason,
  PARTNER_ACTION_QUEUE_KIND_ORDER,
  sortActionQueueRows,
  toHostRequestActionRow,
  toPartnerRequestActionRow,
  toProposalActionRow,
} from './action-queue';
import type { ActionQueueRow } from './types';

const PROJECT = { id: '01930000-0000-7000-8000-0000000000f1', name: 'Project A Published' };

function hostItem(overrides: Partial<HostProposalListItem> & { readonly id: string }): HostProposalListItem {
  return {
    audience: 'HOST',
    owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' },
    sendHold: null,
    lastFailureReason: null,
    sendAttempts: [],
    state: 'DRAFT',
    origin: 'OWN',
    project: PROJECT,
    recipient: { companyName: 'Client Co', email: 'client@example.test' },
    engineerDisplayName: 'Frozen Name',
    offeredUnitPrice: 700000,
    createdByName: 'Host A',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T01:00:00.000Z',
    ...overrides,
  };
}

function partnerItem(overrides: Partial<PartnerProposalListItem> & { readonly id: string }): PartnerProposalListItem {
  return {
    audience: 'PARTNER',
    state: 'DRAFT',
    origin: 'OWN',
    project: PROJECT,
    recipient: { companyName: 'Client Co', email: 'client@example.test' },
    engineerDisplayName: 'Frozen Name',
    offeredUnitPrice: 700000,
    createdByName: 'Partner A1',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T01:00:00.000Z',
    ...overrides,
  };
}

function hostRequest(overrides: Partial<HostProposalRequestView> & { readonly id: string }): HostProposalRequestView {
  return {
    project: PROJECT,
    state: 'REQUESTED',
    message: 'm',
    expiresAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-15T00:00:00.000Z',
    respondedAt: null,
    ...overrides,
  };
}

function partnerRequest(overrides: Partial<PartnerProposalRequestView> & { readonly id: string }): PartnerProposalRequestView {
  return {
    ...hostRequest({ id: overrides.id }),
    engineer: { id: 'e-1', displayName: 'Own Engineer' },
    ...overrides,
  };
}

describe('toProposalActionRow — 4 つの「うまくいかなかった」を混同しない（F-024 AC-2 / BR-23）', () => {
  it('SUBMIT_FAILED → SEND_FAILED（S-022）/ APPROVAL_PENDING → S-021 / GATE_FAILED → S-020', () => {
    expect(toProposalActionRow(hostItem({ id: 'p1', state: 'SUBMIT_FAILED' }))).toMatchObject({
      kind: 'SEND_FAILED',
      href: '/proposals/send-failures',
    });
    expect(toProposalActionRow(hostItem({ id: 'p2', state: 'APPROVAL_PENDING' }))).toMatchObject({
      kind: 'APPROVAL_PENDING',
      href: '/proposals/p2/approve',
    });
    expect(toProposalActionRow(hostItem({ id: 'p3', state: 'GATE_FAILED' }))).toMatchObject({
      kind: 'GATE_FAILED',
      href: '/proposals/p3/edit',
    });
  });

  it('🔴 LOST / WITHDRAWN / SUBMITTED / DRAFT / 保留していない APPROVED は載らない（終端・進行中は「対応が要るもの」ではない）', () => {
    for (const state of ['LOST', 'WITHDRAWN', 'SUBMITTED', 'DRAFT', 'APPROVED', 'GATE_RUNNING', 'SUBMITTING', 'WON'] as const) {
      expect(toProposalActionRow(hostItem({ id: `p-${state}`, state })), state).toBeNull();
    }
  });

  it('🔴 SEND_HELD は DOMAIN_UNVERIFIED / GATE_STALE の保留だけ。PROVIDER_QUOTA ほか自動復帰する保留は載らない（F-059 AC-7 / §10.4）', () => {
    const since = '2026-09-16T01:00:00.000Z';
    for (const reasonKey of SEND_HOLD_REASON_KEYS) {
      const row = toProposalActionRow(hostItem({ id: `h-${reasonKey}`, state: 'APPROVED', sendHold: { reasonKey, since } }));
      if ((ACTION_QUEUE_SEND_HOLD_REASONS as readonly SendHoldReasonKey[]).includes(reasonKey)) {
        expect(row, reasonKey).toMatchObject({ kind: 'SEND_HELD', href: '/proposals?state=APPROVED' });
      } else {
        expect(row, reasonKey).toBeNull();
      }
    }
    expect(isActionQueueSendHoldReason('PROVIDER_QUOTA')).toBe(false);
    expect(isActionQueueSendHoldReason('RATE_LIMIT')).toBe(false);
    expect(ACTION_QUEUE_SEND_HOLD_REASONS).toEqual(['DOMAIN_UNVERIFIED', 'GATE_STALE']);
  });

  it('🔴 SEND_HELD の遷移先は S-019（APPROVED フィルタ）であり S-022（送信失敗）ではない（保留は失敗ではない）', () => {
    const held = toProposalActionRow(
      hostItem({ id: 'h1', state: 'APPROVED', sendHold: { reasonKey: 'DOMAIN_UNVERIFIED', since: '2026-09-16T01:00:00.000Z' } }),
    );
    const failed = toProposalActionRow(hostItem({ id: 'f1', state: 'SUBMIT_FAILED' }));
    expect(held?.kind).not.toBe(failed?.kind);
    expect(held?.href).not.toBe(failed?.href);
  });

  it('対象 = 案件名 + 凍結側のエンジニア名 / 相手 = 提案先 / since・rowVersion = updatedAt', () => {
    const row = toProposalActionRow(hostItem({ id: 'p1', state: 'APPROVAL_PENDING' }));
    expect(row).toEqual({
      kind: 'APPROVAL_PENDING',
      targetId: 'p1',
      subjectLabel: 'Project A Published / Frozen Name',
      counterpartyLabel: 'Client Co',
      since: '2026-09-16T01:00:00.000Z',
      deadline: null,
      rowVersion: Date.parse('2026-09-16T01:00:00.000Z'),
      href: '/proposals/p1/approve',
    });
  });

  it('案件名を出せない / 凍結が無い / 提案先が未設定でも行は落とさず、代替の語で埋める', () => {
    const row = toProposalActionRow(hostItem({ id: 'p1', state: 'GATE_FAILED', project: null, engineerDisplayName: null, recipient: null }));
    expect(row?.subjectLabel).toBe('（案件名は公開されていません） / （凍結情報なし）');
    expect(row?.counterpartyLabel).toBeNull();
  });

  it('🔴 取引先の行（PartnerProposalListItem）は sendHold を型として持たないので、APPROVED から SEND_HELD は生まれない', () => {
    expect(toProposalActionRow(partnerItem({ id: 'q1', state: 'APPROVED' }))).toBeNull();
    expect(toProposalActionRow(partnerItem({ id: 'q2', state: 'GATE_FAILED' }))?.kind).toBe('GATE_FAILED');
  });
});

describe('提案依頼の行 — REQUESTED だけ。DECLINED / EXPIRED / WITHDRAWN_BY_HOST / ACCEPTED は「返答待ち」に残さない（BR-60）', () => {
  it('🔴 ホストの行は案件名 + 「共有候補（匿名）」。エンジニア名・engineerId・依頼先の社名を持たない（経路 4）', () => {
    const row = toHostRequestActionRow(hostRequest({ id: 'r1' }));
    expect(row).toEqual({
      kind: 'PROPOSAL_REQUEST_PENDING',
      targetId: 'r1',
      subjectLabel: 'Project A Published / 共有候補（匿名）',
      counterpartyLabel: null,
      since: '2026-09-15T00:00:00.000Z',
      deadline: '2026-09-20T00:00:00.000Z',
      rowVersion: Date.parse('2026-09-15T00:00:00.000Z'),
      href: '/proposal-requests',
    });
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['counterpartyLabel', 'deadline', 'href', 'kind', 'rowVersion', 'since', 'subjectLabel', 'targetId'],
    );
  });

  it('取引先の行は案件名 + 自社の台帳の表示名（自社の情報）。遷移先は S-018', () => {
    const row = toPartnerRequestActionRow(partnerRequest({ id: 'r2' }));
    expect(row).toMatchObject({
      kind: 'PROPOSAL_REQUEST_PENDING',
      subjectLabel: 'Project A Published / Own Engineer',
      counterpartyLabel: null,
      href: '/proposal-requests/r2',
    });
    // 自社に公開されていない案件はその旨。
    expect(toPartnerRequestActionRow(partnerRequest({ id: 'r3', project: null }))?.subjectLabel).toBe(
      '（案件名は公開されていません） / Own Engineer',
    );
  });

  it('🔴 REQUESTED 以外は null（ホスト・取引先とも）', () => {
    for (const state of ['ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN_BY_HOST'] as const) {
      expect(toHostRequestActionRow(hostRequest({ id: `h-${state}`, state })), state).toBeNull();
      expect(toPartnerRequestActionRow(partnerRequest({ id: `p-${state}`, state })), state).toBeNull();
    }
  });
});

function rowOf(kind: ActionQueueRow['kind'], targetId: string, since: string, deadline: string | null = null): ActionQueueRow {
  return { kind, targetId, subjectLabel: 's', counterpartyLabel: null, since, deadline, rowVersion: Date.parse(since), href: '/' };
}

describe('sortActionQueueRows — 「放置時間 × 取り返しのつかなさ」（docs/04 §S-003）', () => {
  it('ホスト: SEND_FAILED → APPROVAL_PENDING → GATE_FAILED → SEND_HELD → PROPOSAL_REQUEST_PENDING。種別の中は放置が長い順、依頼は期限昇順', () => {
    const rows = [
      rowOf('PROPOSAL_REQUEST_PENDING', 'r-late', '2026-09-10T00:00:00.000Z', '2026-09-25T00:00:00.000Z'),
      rowOf('GATE_FAILED', 'g-new', '2026-09-16T00:00:00.000Z'),
      rowOf('SEND_HELD', 'h1', '2026-09-16T00:00:00.000Z'),
      rowOf('APPROVAL_PENDING', 'a1', '2026-09-16T00:00:00.000Z'),
      rowOf('PROPOSAL_REQUEST_PENDING', 'r-soon', '2026-09-16T00:00:00.000Z', '2026-09-18T00:00:00.000Z'),
      rowOf('GATE_FAILED', 'g-old', '2026-09-01T00:00:00.000Z'),
      rowOf('SEND_FAILED', 's1', '2026-09-16T00:00:00.000Z'),
    ];
    expect(sortActionQueueRows(rows, 'HOST').map((row) => row.targetId)).toEqual(['s1', 'a1', 'g-old', 'g-new', 'h1', 'r-soon', 'r-late']);
    expect(HOST_ACTION_QUEUE_KIND_ORDER).toEqual(['SEND_FAILED', 'APPROVAL_PENDING', 'GATE_FAILED', 'SEND_HELD', 'PROPOSAL_REQUEST_PENDING']);
  });

  it('取引先: 依頼（時間切れが最も痛い。§S-004 セクション 1）→ GATE_FAILED（セクション 2）', () => {
    const rows = [rowOf('GATE_FAILED', 'g1', '2026-09-01T00:00:00.000Z'), rowOf('PROPOSAL_REQUEST_PENDING', 'r1', '2026-09-16T00:00:00.000Z', '2026-09-18T00:00:00.000Z')];
    expect(sortActionQueueRows(rows, 'PARTNER').map((row) => row.targetId)).toEqual(['r1', 'g1']);
    expect(PARTNER_ACTION_QUEUE_KIND_ORDER).toEqual(['PROPOSAL_REQUEST_PENDING', 'GATE_FAILED']);
  });

  it('決定的（同じ入力で同じ並び。同時刻は targetId で固定）で、入力を破壊しない', () => {
    const rows = [rowOf('GATE_FAILED', 'b', '2026-09-16T00:00:00.000Z'), rowOf('GATE_FAILED', 'a', '2026-09-16T00:00:00.000Z')];
    const first = sortActionQueueRows(rows, 'HOST');
    expect(first.map((row) => row.targetId)).toEqual(['a', 'b']);
    expect(sortActionQueueRows(rows, 'HOST')).toEqual(first);
    expect(rows.map((row) => row.targetId)).toEqual(['b', 'a']);
  });
});

describe('buildActionQueueBlock — changedSince の差分（docs/05 §6.3 #9 の rowVersion）', () => {
  const sorted = [
    rowOf('SEND_FAILED', 's1', '2026-09-16T00:00:00.000Z'),
    rowOf('APPROVAL_PENDING', 'a1', '2026-09-16T00:05:00.000Z'),
    rowOf('GATE_FAILED', 'g1', '2026-09-16T00:10:00.000Z'),
  ];

  it('changedSince 無し = 全行。targetIds は表示順の全件', () => {
    const block = buildActionQueueBlock(sorted, null);
    expect(block.kind).toBe('ACTION_QUEUE');
    expect(block.targetIds).toEqual(['s1', 'a1', 'g1']);
    expect(block.items).toEqual(sorted);
  });

  it('🔴 changedSince あり = rowVersion >= changedSince の行だけ（変わっていない行は返さない）。targetIds は全件のまま', () => {
    const block = buildActionQueueBlock(sorted, new Date('2026-09-16T00:05:00.000Z'));
    expect(block.targetIds).toEqual(['s1', 'a1', 'g1']);
    expect(block.items.map((row) => row.targetId)).toEqual(['a1', 'g1']);
    expect(buildActionQueueBlock(sorted, new Date('2026-09-16T01:00:00.000Z')).items).toEqual([]);
  });

  it('🔴 種別ごとの件数を 1 つの合計に丸めるフィールドが無い', () => {
    expect(Object.keys(buildActionQueueBlock(sorted, null)).sort()).toEqual(['items', 'kind', 'targetIds']);
  });
});

describe('CHANGED_SINCE_SAFETY_MARGIN_MS — 応答の changedSince に持たせる安全マージン（T-12-15 指摘 4）', () => {
  it('5 秒（`updated_at` の採番とコミットの間の読み取り窓を吸収する値。`getHomeView` が使う）', () => {
    expect(CHANGED_SINCE_SAFETY_MARGIN_MS).toBe(5_000);
  });
});
