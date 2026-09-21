// apps/web/lib/proposals/detail-rows.test.ts
// 🔴 `S-023` の表示値（履歴の描き分け / 自動承認の主体 / 却下由来の DRAFT の導線 / 取引先の行の欠落）。T-09-09。
import { describe, expect, it } from 'vitest';
import type { GateResultHistoryItem, GateResultView } from '@ses/domain';
import { t } from '@ses/i18n';
import type { ProposalDetailScreenView } from './detail';
import { isRejectedDraft, proposalDetailRows, proposalGateHistoryRows, proposalTimelineRow, PROPOSAL_FAILURE_STATE_LABELS } from './detail-rows';
import type { HostProposalDetailView, PartnerProposalDetailView, ProposalEventView } from './views';

const NOW = new Date('2026-09-16T03:00:00.000Z');
const ID = '01930000-0000-7000-8000-000000000a01';

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

const CREATED = event({ id: 'e1' });
const DRAFT_UPDATED = event({ id: 'e2', kind: 'NOTE', fromState: 'DRAFT', toState: 'DRAFT', entry: { kind: 'DRAFT_UPDATED', fields: ['subject', 'body'] } });
const GATE_REQUESTED = event({ id: 'e3', fromState: 'DRAFT', toState: 'GATE_RUNNING' });
const GATE_PASSED = event({ id: 'e4', fromState: 'GATE_RUNNING', toState: 'APPROVAL_PENDING', actor: { kind: 'SYSTEM' } });
const AUTO_APPROVED = event({ id: 'e5', fromState: 'APPROVAL_PENDING', toState: 'APPROVED', actor: { kind: 'SYSTEM' }, entry: { kind: 'APPROVAL', reviewGateId: 'gate-1' } });
const SEND_FAILED = event({ id: 'e6', fromState: 'SUBMITTING', toState: 'SUBMIT_FAILED', actor: { kind: 'SYSTEM' }, entry: { kind: 'SEND_FAILURE', failureKind: 'UNKNOWN:TimeoutError' } });
const RESENT = event({ id: 'e7', fromState: 'SUBMIT_FAILED', toState: 'APPROVED', entry: { kind: 'RESEND', reason: '電話で未着を確認' } });
const NOTE = event({ id: 'e8', kind: 'NOTE', fromState: 'APPROVED', toState: 'APPROVED', entry: { kind: 'NOTE', note: '先方に電話済み' } });
const REJECTED = event({ id: 'e9', fromState: 'APPROVAL_PENDING', toState: 'DRAFT', actor: { kind: 'USER', displayName: '承認 花子' }, entry: { kind: 'TRANSITION', note: '単価を見直してください' } });

const GATE: GateResultView = {
  execution: 'RUNNING',
  layers: {
    pii: { state: 'RUNNING', findings: [] },
    commerce: { state: 'RUNNING', findings: [] },
    consistency: { state: 'RUNNING', findings: [] },
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
    state: 'APPROVAL_PENDING',
    origin: 'OWN',
    project: { id: '01930000-0000-7000-8000-0000000000f1', name: '基幹刷新' },
    recipient: { companyName: '架空エンド株式会社', email: 'to@example.test' },
    terms: { offeredUnitPrice: 650000, offeredStartDate: '2026-11-01', workStyle: '常駐' },
    content: { subject: 'ご提案', body: '本文', bodyOrigin: 'MANUAL' },
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
    events: [CREATED, DRAFT_UPDATED, GATE_REQUESTED, GATE_PASSED],
    createdByName: '担当 太郎',
    submittedAt: null,
    approval: { kind: 'NONE' },
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

function screen(detail: HostProposalDetailView | PartnerProposalDetailView, canAddNote = true): ProposalDetailScreenView {
  return { detail, gate: GATE, canAddNote };
}

describe('🔴 履歴の描き分け（docs/04 §S-023 セクション 2）', () => {
  it('作成 / 下書きの更新（項目名）/ 遷移 / 承認（検査 #）/ 送信失敗（種別）/ 再送（理由）/ メモ / 却下（理由）が別の kind・別の語', () => {
    const rows = [CREATED, DRAFT_UPDATED, GATE_REQUESTED, AUTO_APPROVED, SEND_FAILED, RESENT, NOTE, REJECTED].map(proposalTimelineRow);
    expect(rows.map((row) => row.kind)).toEqual(['CREATED', 'DRAFT_UPDATED', 'TRANSITION', 'APPROVAL', 'SEND_FAILURE', 'RESEND', 'NOTE', 'REJECT']);
    expect(new Set(rows.map((row) => row.title)).size).toBe(8);
    expect(rows[1]?.detail).toBe(`${t('proposals.detail.timeline.draftUpdated.fieldsPrefix')}${t('proposals.editor.field.subject')} / ${t('proposals.editor.field.body')}`);
    expect(rows[2]?.transition).toBe(`${t('proposals.state.DRAFT')}${t('proposals.detail.timeline.transition.arrow')}${t('proposals.state.GATE_RUNNING')}`);
    expect(rows[3]?.detail).toBe(`${t('proposals.detail.timeline.approval.gatePrefix')}gate-1`);
    expect(rows[4]?.detail).toBe(`${t('proposals.detail.timeline.sendFailure.kindPrefix')}UNKNOWN:TimeoutError`);
    expect(rows[5]?.detail).toBe(`${t('proposals.detail.timeline.resend.reasonPrefix')}電話で未着を確認`);
    expect(rows[6]?.detail).toBe('先方に電話済み');
    expect(rows[7]?.detail).toBe('単価を見直してください');
    expect(rows[7]?.actor).toBe('承認 花子');
  });

  it('🔴 F-021 AC-5: 自動承認の主体は「システム（全層 PASS のため）」。他のシステム行は「システム」', () => {
    expect(proposalTimelineRow(AUTO_APPROVED).actor).toBe(t('proposals.detail.timeline.actor.systemAutoApprove'));
    expect(proposalTimelineRow(GATE_PASSED).actor).toBe(t('proposals.detail.timeline.actor.system'));
    expect(proposalTimelineRow(AUTO_APPROVED).actorKind).toBe('SYSTEM');
  });

  it('取引先向けに伏せられた再送の理由 / 失敗の種別（null）は detail を出さない。表示名の無い人間は「（不明な利用者）」', () => {
    expect(proposalTimelineRow({ ...RESENT, entry: { kind: 'RESEND', reason: null } }).detail).toBeNull();
    expect(proposalTimelineRow({ ...SEND_FAILED, entry: { kind: 'SEND_FAILURE', failureKind: null } }).detail).toBeNull();
    expect(proposalTimelineRow({ ...NOTE, actor: { kind: 'USER', displayName: null } }).actor).toBe(t('proposals.detail.timeline.actor.unknownUser'));
    expect(proposalTimelineRow({ ...NOTE, attachmentKey: 'sheet-1' }).attachment).toBe(`${t('proposals.detail.timeline.attachmentPrefix')}sheet-1`);
  });
});

describe('🔴 T-09-03 の申し送り: 却下由来の DRAFT の導線は「内容を変更してからレビューに出してください」', () => {
  it('isRejectedDraft は直近の DRAFT への戻りが APPROVAL_PENDING からのときだけ true', () => {
    expect(isRejectedDraft('DRAFT', [CREATED, GATE_REQUESTED, GATE_PASSED, REJECTED])).toBe(true);
    expect(isRejectedDraft('DRAFT', [CREATED])).toBe(false);
    expect(isRejectedDraft('DRAFT', [CREATED, event({ id: 'x', fromState: 'GATE_FAILED', toState: 'DRAFT' })])).toBe(false);
    expect(isRejectedDraft('APPROVAL_PENDING', [CREATED, REJECTED])).toBe(false);
    // 却下の後に下書きを更新（NOTE）しても、直近の STATE の戻りが却下なら true。
    expect(isRejectedDraft('DRAFT', [CREATED, REJECTED, DRAFT_UPDATED])).toBe(true);
  });

  it('DRAFT（却下由来）は S-020 への導線に rejectedLead。素の DRAFT は lead なし。GATE_FAILED は gateFailedLead', () => {
    const rejected = proposalDetailRows(screen(hostDetail({ state: 'DRAFT', events: [CREATED, GATE_REQUESTED, GATE_PASSED, REJECTED] })), NOW);
    expect(rejected.actions).toEqual([{ key: 'EDITOR', href: `/proposals/${ID}/edit`, label: t('proposals.detail.action.openEditor'), lead: t('proposals.detail.action.rejectedLead') }]);
    expect(t('proposals.detail.action.rejectedLead')).toContain('内容を変更してから');
    const plain = proposalDetailRows(screen(hostDetail({ state: 'DRAFT', events: [CREATED] })), NOW);
    expect(plain.actions[0]?.lead).toBeNull();
    const gateFailed = proposalDetailRows(screen(hostDetail({ state: 'GATE_FAILED' })), NOW);
    expect(gateFailed.actions[0]).toMatchObject({ key: 'EDITOR', lead: t('proposals.detail.action.gateFailedLead') });
  });

  it('状態に応じた導線: APPROVAL_PENDING → S-021 / APPROVED → S-021「送信する」(ホスト) / SUBMIT_FAILED → S-022 (ホストだけ) / 商談中 → S-024 / 終端は無し', () => {
    expect(proposalDetailRows(screen(hostDetail({ state: 'APPROVAL_PENDING' })), NOW).actions.map((a) => a.key)).toEqual(['APPROVAL']);
    expect(proposalDetailRows(screen(hostDetail({ state: 'APPROVED' })), NOW).actions[0]).toMatchObject({ key: 'SUBMIT', href: `/proposals/${ID}/approve` });
    expect(proposalDetailRows(screen(partnerDetail({ state: 'APPROVED' })), NOW).actions[0]).toMatchObject({ key: 'APPROVAL' });
    expect(proposalDetailRows(screen(hostDetail({ state: 'SUBMIT_FAILED' })), NOW).actions[0]).toMatchObject({ key: 'SEND_FAILURES', href: '/proposals/send-failures' });
    expect(proposalDetailRows(screen(partnerDetail({ state: 'SUBMIT_FAILED' })), NOW).actions).toEqual([]);
    for (const state of ['SUBMITTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING'] as const) {
      expect(proposalDetailRows(screen(hostDetail({ state })), NOW).actions[0]).toMatchObject({ key: 'INTERVIEW', href: `/proposals/${ID}/interview` });
    }
    for (const state of ['WON', 'LOST', 'WITHDRAWN'] as const) {
      const rows = proposalDetailRows(screen(hostDetail({ state })), NOW);
      expect(rows.actions).toEqual([]);
      expect(rows.actionsEmpty).toBe(t('proposals.detail.action.none'));
    }
  });
});

describe('🔴 取引先の行に承認者・送信試行・保留・作成会社が無い（F-037 AC-1 / §4.8）', () => {
  it('partner: approver / sendHold / sendAttempts / lastFailureReason が null、audienceNotice あり。header に作成会社の行が無い', () => {
    const rows = proposalDetailRows(screen(partnerDetail()), NOW);
    expect(rows).toMatchObject({ approver: null, sendHold: null, sendAttempts: null, lastFailureReason: null });
    expect(rows.audienceNotice).toBe(t('proposals.detail.partnerNotice'));
    expect(rows.header.map((row) => row.field)).not.toContain('owner');
    expect(JSON.stringify(rows)).not.toContain('duplicate');
  });

  it('host: 承認者 / 送信試行の要約 / 保留 / 作成会社の行 / 最終失敗理由を持つ', () => {
    const rows = proposalDetailRows(
      screen(
        hostDetail({
          state: 'SUBMIT_FAILED',
          approval: { kind: 'USER', approverName: '承認 花子', approvedAt: '2026-09-16T01:00:00.000Z' },
          sendHold: null,
          sendAttempts: [
            { attemptSeq: 1, status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', startedAt: '2026-09-16T01:30:00.000Z', settledAt: '2026-09-16T01:31:00.000Z', externalId: null },
          ],
          lastFailureReason: 'UNKNOWN:TimeoutError',
        }),
      ),
      NOW,
    );
    expect(rows.approver).toContain('承認 花子');
    expect(rows.sendAttempts?.count).toBe(`1${t('proposals.detail.sendAttempts.countSuffix')}`);
    expect(rows.sendAttempts?.last).toBe(`${t('proposals.detail.sendAttempts.lastPrefix')}${t('proposals.detail.attemptStatus.UNKNOWN')}（UNKNOWN:TimeoutError）`);
    expect(rows.sendAttempts?.items[0]).toMatchObject({ attemptSeq: 1, status: 'UNKNOWN', statusLabel: t('proposals.detail.attemptStatus.UNKNOWN') });
    expect(rows.lastFailureReason).toBe('UNKNOWN:TimeoutError');
    expect(rows.header.map((row) => row.field)).toContain('owner');
    expect(rows.failureKind).toBe('SUBMIT_FAILED');
    const held = proposalDetailRows(screen(hostDetail({ state: 'APPROVED', sendHold: { reasonKey: 'RATE_LIMIT', since: '2026-09-16T00:00:00.000Z' } })), NOW);
    expect(held.sendHold).toMatchObject({ reasonKey: 'RATE_LIMIT', autoRelease: true });
    expect(held.failureKind).toBeNull();
    const systemApproved = proposalDetailRows(screen(hostDetail({ approval: { kind: 'SYSTEM', approvedAt: '2026-09-16T01:00:00.000Z' } })), NOW);
    expect(systemApproved.approver).toContain(t('proposals.approval.approver.system'));
  });
});

describe('凍結内容と概要', () => {
  it('経歴の見出しに凍結日時が付き、行は 4 列。0 行なら空の文言。概要は S-021 と同じ必須欄を含む', () => {
    const rows = proposalDetailRows(screen(hostDetail()), NOW);
    expect(rows.frozen.careersTitle).toContain('2026-09-15');
    expect(rows.frozen.careersTitle).toContain(`1${t('proposals.detail.frozen.careers.suffix')}`);
    expect(rows.frozen.careers).toEqual([{ key: 'career-0', period: `2024-04〜${t('engineers.careers.ongoing')}`, role: 'PL', description: '基幹刷新', technologies: 'Java' }]);
    expect(rows.frozen.careersEmpty).toBeNull();
    const empty = proposalDetailRows(screen(hostDetail({ snapshot: { ...hostDetail().snapshot, careers: [], careerCount: 0 } })), NOW);
    expect(empty.frozen.careersEmpty).toBe(t('proposals.detail.frozen.careers.empty'));
    for (const field of ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'created-by', 'elapsed']) {
      expect(rows.header.map((row) => row.field)).toContain(field);
    }
    expect(rows.fixed).toEqual({ recipient: '架空エンド株式会社', unitPrice: '650,000' });
    expect(rows.frozen.attachment).toBe(t('proposals.detail.frozen.attachment.none'));
  });

  it('3 区分の語は互いに異なる（GATE_FAILED / SUBMIT_FAILED / LOST）', () => {
    const labels = Object.values(PROPOSAL_FAILURE_STATE_LABELS());
    expect(new Set(labels).size).toBe(3);
  });
});

describe('✅ T-12-14 ③ 履歴タイムラインは新しい順（docs/04 §10.3「履歴 = 新しい順」/ §S-023 改訂 13）', () => {
  it('#46 の events（古い順）を反転し、最新行が先頭に来る（最新の「検査中」/「送信中」が直近 10 行の先頭 = 折りたたみの外）', () => {
    const rows = proposalDetailRows(screen(hostDetail({ events: [CREATED, GATE_REQUESTED, GATE_PASSED, AUTO_APPROVED] })), NOW);
    expect(rows.timeline.map((row) => row.id)).toEqual(['e5', 'e4', 'e3', 'e1']);
    expect(rows.timeline[0]?.kind).toBe('APPROVAL');
  });
});

describe('✅ T-12-14 ② セクション 4「ゲート結果の履歴」の表示値（proposalGateHistoryRows）', () => {
  const DONE_ITEM: GateResultHistoryItem = {
    reviewGateId: 'gate-2',
    execution: 'DONE',
    executedAt: '2026-09-16T00:30:00.000Z',
    heldSince: null,
    matchesCurrentContent: true,
    layers: {
      pii: { state: 'PASS', findings: [] },
      commerce: { state: 'PASS', findings: [] },
      consistency: {
        state: 'FAIL',
        findings: [{ layer: 'CONSISTENCY', kind: 'MUST_REQUIREMENT_MISMATCH', field: 'snapshot', offsetStart: null, offsetEnd: null, excerpt: 'TypeScript -/3.0', severity: 'BLOCK' }],
      },
    },
    aiWarnings: [{ layer: 'CONSISTENCY', kind: 'SKILL_SHEET_MISMATCH', field: 'body', offsetStart: null, offsetEnd: null, excerpt: '要確認', severity: 'WARN' }],
    aiFailed: false,
    contentHash: 'h-current',
  };
  const HELD_ITEM: GateResultHistoryItem = {
    reviewGateId: 'gate-3',
    execution: 'HELD_AI_COST_LIMIT',
    executedAt: null,
    heldSince: '2026-09-16T01:00:00.000Z',
    matchesCurrentContent: false,
    layers: {
      pii: { state: 'HELD', findings: [] },
      commerce: { state: 'HELD', findings: [] },
      consistency: { state: 'PASS', findings: [] },
    },
    aiWarnings: [],
    aiFailed: false,
    contentHash: 'h-old',
    held: {
      heldReasonKey: 'gate.held.aiCostLimit',
      heldSince: '2026-09-16T01:00:00.000Z',
      resetAt: '2026-09-16T15:00:00.000Z',
      limitRaise: 'PLATFORM_OPERATOR',
      rerun: { auto: true, manual: 'POST /api/proposals/{id}/gate' },
    },
  };

  it('1 実行 = 1 行。DONE は「実行日時: …」、HELD は「上限到達で未実行（保留開始: …）」。現在 / 以前の内容の印。並びは #40b のまま', () => {
    const rows = proposalGateHistoryRows({ items: [HELD_ITEM, DONE_ITEM] });
    expect(rows.empty).toBeNull();
    expect(rows.items.map((item) => item.reviewGateId)).toEqual(['gate-3', 'gate-2']);
    expect(rows.items[0]?.title).toBe(`${t('proposals.detail.gateHistory.held.prefix')}2026-09-16 10:00 JST${t('proposals.detail.gateHistory.held.suffix')}`);
    expect(rows.items[0]?.contentNote).toBe(t('proposals.detail.gateHistory.previousContent'));
    expect(rows.items[1]?.title).toBe(`${t('proposals.detail.gateHistory.executedAt.prefix')}2026-09-16 09:30 JST`);
    expect(rows.items[1]?.contentNote).toBe(t('proposals.detail.gateHistory.matchesCurrent'));
  });

  it('🔴 層別結果は approvalGateRows と同じ形（不合格の指摘と AI の警告が別のリスト。HELD は再開予定を持つ）', () => {
    const rows = proposalGateHistoryRows({ items: [HELD_ITEM, DONE_ITEM] });
    const done = rows.items[1]?.gate;
    expect(done?.execution).toBe('DONE');
    expect(done?.layers.map((layer) => [layer.key, layer.state])).toEqual([['pii', 'PASS'], ['commerce', 'PASS'], ['consistency', 'FAIL']]);
    expect(done?.findings.map((finding) => finding.excerpt)).toEqual(['TypeScript -/3.0']);
    expect(done?.warnings.map((warning) => warning.excerpt)).toEqual(['要確認']);
    expect(done?.failed).toBe(true);
    const held = rows.items[0]?.gate;
    expect(held?.execution).toBe('HELD_AI_COST_LIMIT');
    expect(held?.layers.map((layer) => layer.state)).toEqual(['HELD', 'HELD', 'PASS']);
    expect(held?.heldResetAt).toBe('2026-09-17 00:00 JST');
    expect(held?.failed).toBe(false);
  });

  it('0 件は empty の文言（現在の結果と同じ「まだレビューに出されていません」）', () => {
    const rows = proposalGateHistoryRows({ items: [] });
    expect(rows.items).toEqual([]);
    expect(rows.empty).toBe(t('proposals.approval.gate.notRequested'));
  });
});
