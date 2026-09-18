// apps/web/lib/proposals/approval-rows.test.ts
// `S-021` の表示値（`proposalApprovalRows`）を固定する。T-09-03。
//
// 🔴 ここで固定するもの（`F-021 AC-4` / `BR-49` / `docs/04` §S-021 / `docs/02` `ui-design` 申し送り 5）:
//   ① 判断ヘッダに **提案先 / エンジニア / 案件 / 単価 / 開始日 / 作成者 / 経過時間** が必ず入る（`APPROVAL_HEADER_REQUIRED_FIELDS`）。
//      値はすべて凍結側（`snapshot`）と提案の内容から組まれ、台帳の現在値は入力に無い
//   ② 🔴 **不合格の指摘（`findings`）と警告（`aiWarnings`）が別のリストに分かれる。** 警告だけの結果は `allPassed` であり、
//      承認の状態（`PENDING`）を変えない（警告のみでは止めない）
//   ③ 🔴 状態ごとの画面の形: `APPROVAL_PENDING` だけが `PENDING`。`GATE_FAILED` / `GATE_RUNNING` / `DRAFT` / `APPROVED` /
//      その他は承認アクションを描かない形になる
//   ④ プレビューのハイライトは欄内オフセットから組まれ、`null` オフセットは除外される。`BLOCK` と `WARN` を区別する
//   ⑤ 承認者欄: 人間は表示名 + 日時、システムは「システム（全層 PASS のため自動承認）」+ 日時
import { describe, expect, it } from 'vitest';
import type { GateFinding, GateResultView, SendHoldReasonKey } from '@ses/domain';
import { t } from '@ses/i18n';
import type { ProposalApprovalView } from './approval';
import { APPROVAL_HEADER_REQUIRED_FIELDS, formatElapsed, isAwaitingSendSettlement, proposalApprovalRows } from './approval-rows';
import type { HostProposalView, PartnerProposalView, ProposalSendAttemptView } from './views';

const NOW = new Date('2026-09-16T03:00:00.000Z');
const PROPOSAL_ID = '01930000-0000-7000-8000-000000000301';

const HOST_VIEW: HostProposalView = {
  audience: 'HOST',
  owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' },
  sendHold: null,
  id: PROPOSAL_ID,
  state: 'APPROVAL_PENDING',
  origin: 'OWN',
  project: { id: 'p-1', name: '基幹刷新' },
  recipient: { companyName: '架空エンド株式会社', email: 'recipient@example.test' },
  terms: { offeredUnitPrice: 650000, offeredStartDate: '2026-11-01', workStyle: 'REMOTE' },
  content: { subject: 'ご提案', body: 'ご提案します。Kotlin の経験が 6 年あります。', bodyOrigin: 'MANUAL' },
  snapshot: {
    frozenAt: '2026-09-15T00:00:00.000Z',
    displayName: '佐藤 花子',
    affiliationLabel: null,
    skills: [{ skillId: 's-1', name: 'Kotlin', years: 6, level: 4 }],
    careerCount: 2,
    unitPriceMin: 600000,
    unitPriceMax: 700000,
    availableFrom: '2026-10-01',
    prefecture: '13',
    remoteMode: 'FULL_REMOTE',
  },
  attachment: { skillSheetId: '01930000-0000-7000-8000-000000000501' },
  contentHash: 'h'.repeat(64),
  createdAt: '2026-09-15T01:00:00.000Z',
  updatedAt: '2026-09-15T02:00:00.000Z',
};

const PASS_GATE: GateResultView = {
  execution: 'DONE',
  layers: {
    pii: { state: 'PASS', findings: [] },
    commerce: { state: 'PASS', findings: [] },
    consistency: { state: 'PASS', findings: [] },
  },
  aiWarnings: [],
  aiFailed: false,
  contentHash: 'h'.repeat(64),
};

const WARNING: GateFinding = {
  layer: 'CONSISTENCY',
  kind: 'SKILL_SHEET_MISMATCH',
  field: 'body',
  offsetStart: 15,
  offsetEnd: 22,
  excerpt: '経験が 6 年',
  severity: 'WARN',
};

const BLOCKER: GateFinding = {
  layer: 'PII',
  kind: 'FULL_NAME',
  field: 'body',
  offsetStart: 0,
  offsetEnd: 5,
  excerpt: 'ご提案し',
  severity: 'BLOCK',
};

function view(overrides: Partial<ProposalApprovalView> = {}): ProposalApprovalView {
  return {
    view: HOST_VIEW,
    gate: PASS_GATE,
    approval: { kind: 'NONE' },
    createdByName: 'Partner A1',
    canApprove: true,
    canSubmit: true,
    submittedAt: null,
    sendAttempts: [],
    ...overrides,
  };
}

/** T-12-13 ⑤: 送信試行 1 件（`status` 以外は判定に使わない）。 */
function attempt(attemptSeq: number, status: string): ProposalSendAttemptView {
  return { attemptSeq, status, failureKind: null, startedAt: '2026-09-16T00:00:00.000Z', settledAt: null, externalId: null };
}

describe('🔴 T-12-13 ⑤: APPROVED のまま送信の確定を待っているか（isAwaitingSendSettlement / rows.awaitingSendSettlement）', () => {
  const approved = { ...HOST_VIEW, state: 'APPROVED' } as const;

  it('試行の末尾が未確定（RESERVED）なら true。確定済み（SUCCEEDED / FAILED / UNKNOWN）だけなら false', () => {
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: null, sendAttempts: [attempt(1, 'RESERVED')] })).toBe(true);
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: null, sendAttempts: [attempt(1, 'FAILED'), attempt(2, 'RESERVED')] })).toBe(true);
    for (const status of ['SUCCEEDED', 'FAILED', 'UNKNOWN']) {
      expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: null, sendAttempts: [attempt(1, status)] }), status).toBe(false);
    }
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: null, sendAttempts: [] })).toBe(false);
  });

  it('🔴 APPROVED で試行の末尾が確定済み（#44 の CAS 後、seq N+1 の行がまだ無い形）は false —— 送信中と断定しない', () => {
    // 🔴 レビュー指摘（2026-09-18）: `APPROVED` + 末尾 `UNKNOWN`（`last_failure_reason` が前回の失敗のまま残る）は「#44 の受け付け直後」
    //    にも「enqueue が 409 `SEND_JOB_BLOCKED` で止まった」「seq 2 のジョブが ③ CAS より前に落ちた（failed job）」にも見える。
    //    後者で「送信中」を恒久的に出すと `S-021` / `S-022` / `S-023` のどこにも復帰導線が無い行き止まりになるので、ここは **`false`**
    //    にして「送信する」が戻ること。前者（受け付け直後の窓）は `S-022` が残すセッションの印（`submit-intent.ts`）が埋める。
    //    `last_failure_reason` は入力に無い（根拠にしない）。
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: null, sendAttempts: [attempt(1, 'UNKNOWN')] })).toBe(false);
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: null, sendAttempts: [attempt(1, 'FAILED')] })).toBe(false);
    // 確定後（SUBMITTED / SUBMIT_FAILED は APPROVED ではない）。
    expect(isAwaitingSendSettlement({ state: 'SUBMITTED', sendHold: null, sendAttempts: [attempt(1, 'UNKNOWN'), attempt(2, 'SUCCEEDED')] })).toBe(false);
    expect(isAwaitingSendSettlement({ state: 'SUBMIT_FAILED', sendHold: null, sendAttempts: [attempt(1, 'UNKNOWN'), attempt(2, 'FAILED')] })).toBe(false);
  });

  it('🔴 APPROVED 以外・保留中（sendHold が非 null）は false（保留は別の枠で描き、GATE_STALE の「送信する」を消さない）', () => {
    for (const state of ['APPROVAL_PENDING', 'SUBMITTING', 'GATE_FAILED', 'DRAFT', 'WON'] as const) {
      expect(isAwaitingSendSettlement({ state, sendHold: null, sendAttempts: [attempt(1, 'RESERVED')] }), state).toBe(false);
    }
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: { reasonKey: 'GATE_STALE' }, sendAttempts: [] })).toBe(false);
    expect(isAwaitingSendSettlement({ state: 'APPROVED', sendHold: { reasonKey: 'RATE_LIMIT' }, sendAttempts: [attempt(1, 'RESERVED')] })).toBe(false);
  });

  it('rows.awaitingSendSettlement: ホストの view の試行だけから導かれ、取引先の view は常に false（試行が型に無い）', () => {
    const settledOnly = proposalApprovalRows(view({ view: approved, sendAttempts: [attempt(1, 'UNKNOWN')] }), NOW);
    expect(settledOnly.awaitingSendSettlement).toBe(false);
    expect(settledOnly.sendHold).toBeNull();
    const reserved = proposalApprovalRows(view({ view: approved, sendAttempts: [attempt(1, 'RESERVED')] }), NOW);
    expect(reserved.awaitingSendSettlement).toBe(true);
    const idle = proposalApprovalRows(view({ view: approved }), NOW);
    expect(idle.awaitingSendSettlement).toBe(false);
    const held = proposalApprovalRows(
      view({ view: { ...approved, sendHold: { reasonKey: 'GATE_STALE', since: '2026-09-16T00:00:00.000Z' } }, sendAttempts: [attempt(1, 'RESERVED')] }),
      NOW,
    );
    expect(held.awaitingSendSettlement).toBe(false);
    expect(held.sendHold?.reasonKey).toBe('GATE_STALE');
    const partnerView = { ...approved, audience: 'PARTNER' } as unknown as PartnerProposalView;
    const partner = proposalApprovalRows(view({ view: partnerView, canApprove: false, canSubmit: false }), NOW);
    expect(partner.awaitingSendSettlement).toBe(false);
  });
});

describe('🔴 T-09-06: 送信の保留と送信後の状態（docs/05 §10.4 / §10.5 / F-059 AC-7）', () => {
  const since = '2026-09-16T00:00:00.000Z';
  function heldView(reasonKey: SendHoldReasonKey) {
    return view({ view: { ...HOST_VIEW, state: 'APPROVED', sendHold: { reasonKey, since } }, approval: { kind: 'USER', approverName: '山田', approvedAt: since } });
  }

  it('PROVIDER_QUOTA: 文言は「送信基盤の混雑により保留中…」で、S-038 への導線が無く、自動復帰する', () => {
    const rows = proposalApprovalRows(heldView('PROVIDER_QUOTA'), NOW);
    expect(rows.sendHold).not.toBeNull();
    expect(rows.sendHold?.message).toBe(t('sendHold.PROVIDER_QUOTA'));
    expect(rows.sendHold?.message).toContain('お客様側の設定では解消しません');
    expect(rows.sendHold?.settingsLink).toBeNull();
    expect(rows.sendHold?.autoRelease).toBe(true);
    expect(JSON.stringify(rows.sendHold)).not.toContain('/settings/usage');
  });

  it('RATE_LIMIT: テナントの上限なので S-038 への導線がある（PROVIDER_QUOTA と別の文言）', () => {
    const rows = proposalApprovalRows(heldView('RATE_LIMIT'), NOW);
    expect(rows.sendHold?.message).toBe(t('sendHold.RATE_LIMIT'));
    expect(rows.sendHold?.message).not.toBe(t('sendHold.PROVIDER_QUOTA'));
    expect(rows.sendHold?.settingsLink).toEqual({ href: '/settings/usage', label: t('proposals.approval.sendHold.openUsage') });
    expect(rows.sendHold?.autoRelease).toBe(true);
  });

  it('DOMAIN_UNVERIFIED: S-036 への導線がある', () => {
    const rows = proposalApprovalRows(heldView('DOMAIN_UNVERIFIED'), NOW);
    expect(rows.sendHold?.settingsLink?.href).toBe('/settings/sending-domains');
  });

  it('🔴 GATE_STALE: 自動復帰しない旨（あらためて送信）で、設定導線は無い', () => {
    const rows = proposalApprovalRows(heldView('GATE_STALE'), NOW);
    expect(rows.sendHold?.autoRelease).toBe(false);
    expect(rows.sendHold?.message).toBe(t('sendHold.GATE_STALE'));
    expect(rows.sendHold?.message).toContain('あらためて送信');
    expect(rows.sendHold?.settingsLink).toBeNull();
  });

  it('7 値すべてに文言があり、互いに異なる', () => {
    const keys = ['RATE_LIMIT', 'DOMAIN_UNVERIFIED', 'ESIGN_DISCONNECTED', 'TENANT_SUSPENDED', 'GATE_STALE', 'AI_COST_LIMIT', 'PROVIDER_QUOTA'] as const;
    const messages = keys.map((key) => proposalApprovalRows(heldView(key), NOW).sendHold?.message);
    expect(new Set(messages).size).toBe(7);
    for (const message of messages) expect(message ?? '').not.toBe('');
  });

  it('SUBMITTING / SUBMITTED / SUBMIT_FAILED は別々の形で描かれる（失敗と送信中・送信済みを混ぜない）', () => {
    const submitting = proposalApprovalRows(view({ view: { ...HOST_VIEW, state: 'SUBMITTING' } }), NOW);
    const submitted = proposalApprovalRows(view({ view: { ...HOST_VIEW, state: 'SUBMITTED' }, submittedAt: since }), NOW);
    const failed = proposalApprovalRows(view({ view: { ...HOST_VIEW, state: 'SUBMIT_FAILED' } }), NOW);
    expect(submitting.disposition.kind).toBe('SUBMITTING');
    expect(submitted.disposition.kind).toBe('SUBMITTED');
    expect(failed.disposition.kind).toBe('SUBMIT_FAILED');
    expect(submitted.disposition.kind === 'SUBMITTED' && submitted.disposition.notice).toContain(t('proposals.approval.state.submitted.prefix'));
    expect(failed.disposition.kind === 'SUBMIT_FAILED' && failed.disposition.notice).toContain('自動では再送しません');
    // 保留が無いので sendHold は null。canSubmit は立場の値をそのまま写す。
    expect(submitted.sendHold).toBeNull();
    expect(submitted.canSubmit).toBe(true);
  });
});

describe('proposalApprovalRows: 判断ヘッダ（F-021 AC-4）', () => {
  it('🔴 提案先・エンジニア・案件・単価・開始日・作成者・経過時間が必ず含まれる', () => {
    const rows = proposalApprovalRows(view(), NOW);
    const fields = rows.header.map((row) => row.field);
    for (const required of APPROVAL_HEADER_REQUIRED_FIELDS) expect(fields).toContain(required);
    const byField = new Map(rows.header.map((row) => [row.field, row.value]));
    expect(byField.get('recipient')).toBe('架空エンド株式会社 / recipient@example.test');
    expect(byField.get('engineer')).toContain('佐藤 花子');
    expect(byField.get('project')).toBe('基幹刷新');
    expect(byField.get('unit-price')).toBe('650,000');
    expect(byField.get('start-date')).toBe('2026-11-01');
    expect(byField.get('created-by')).toBe('Partner A1');
    expect(byField.get('owner')).toBe('Partner A1');
    expect(byField.get('elapsed')).toBe('1 日');
    expect(byField.get('career-count')).toBe('2 行');
    expect(byField.get('skills')).toBe('Kotlin');
  });

  it('🔴 単価と提案先が未設定なら「未設定」を強調して出す（無言で空にしない）', () => {
    const rows = proposalApprovalRows(
      view({ view: { ...HOST_VIEW, recipient: null, terms: { ...HOST_VIEW.terms, offeredUnitPrice: null } } }),
      NOW,
    );
    const price = rows.header.find((row) => row.field === 'unit-price');
    const recipient = rows.header.find((row) => row.field === 'recipient');
    expect(price?.emphasis).toBe('ATTENTION');
    expect(price?.value).not.toBe('');
    expect(recipient?.emphasis).toBe('ATTENTION');
  });

  it('凍結時点の注記が出る（台帳の現在値ではないことを利用者に示す）', () => {
    const rows = proposalApprovalRows(view(), NOW);
    expect(rows.frozenNotice).toContain('2026-09-15 09:00 JST');
  });

  it('取引先向け view では作成した会社の行が無く、取引先向けの注記が付く', () => {
    const partnerView: PartnerProposalView = { ...HOST_VIEW, audience: 'PARTNER' } as PartnerProposalView;
    const rows = proposalApprovalRows(view({ view: partnerView, canApprove: false }), NOW);
    expect(rows.header.map((row) => row.field)).not.toContain('owner');
    expect(rows.audienceNotice).not.toBeNull();
    expect(rows.canApprove).toBe(false);
  });
});

describe('proposalApprovalRows: ゲート結果（不合格と警告は別物）', () => {
  it('全層 PASS で警告なし: findings / warnings とも空、allPassed、PENDING', () => {
    const rows = proposalApprovalRows(view(), NOW);
    expect(rows.gate.findings).toEqual([]);
    expect(rows.gate.warnings).toEqual([]);
    expect(rows.gate.allPassed).toBe(true);
    expect(rows.gate.failed).toBe(false);
    expect(rows.disposition.kind).toBe('PENDING');
  });

  it('🔴 警告のみ: warnings に入り findings には入らない。層は PASS のままで承認の形（PENDING）を変えない', () => {
    const rows = proposalApprovalRows(view({ gate: { ...PASS_GATE, aiWarnings: [WARNING] } }), NOW);
    expect(rows.gate.findings).toEqual([]);
    expect(rows.gate.warnings).toHaveLength(1);
    expect(rows.gate.warnings[0]).toMatchObject({ kind: 'SKILL_SHEET_MISMATCH', locationNote: null });
    expect(rows.gate.allPassed).toBe(true);
    expect(rows.gate.failed).toBe(false);
    expect(rows.disposition.kind).toBe('PENDING');
    // ハイライトは WARN として本文に載る（BLOCK ではない）。
    expect(rows.preview.bodyHighlights).toEqual([{ start: 15, end: 22, severity: 'WARN', kind: 'SKILL_SHEET_MISMATCH' }]);
  });

  it('🔴 1 層 FAIL: findings に入り、層のブロックが FAIL、failed。警告と混ざらない', () => {
    const gate: GateResultView = {
      ...PASS_GATE,
      layers: { ...PASS_GATE.layers, pii: { state: 'FAIL', findings: [BLOCKER] } },
      aiWarnings: [WARNING],
    };
    const rows = proposalApprovalRows(view({ view: { ...HOST_VIEW, state: 'GATE_FAILED' }, gate }), NOW);
    expect(rows.gate.findings.map((row) => row.kind)).toEqual(['FULL_NAME']);
    expect(rows.gate.warnings.map((row) => row.kind)).toEqual(['SKILL_SHEET_MISMATCH']);
    expect(rows.gate.layers.find((layer) => layer.key === 'pii')?.state).toBe('FAIL');
    expect(rows.gate.failed).toBe(true);
    expect(rows.disposition.kind).toBe('GATE_FAILED');
    expect(rows.preview.bodyHighlights.map((h) => h.severity)).toEqual(['BLOCK', 'WARN']);
  });

  it('箇所を特定できない指摘は locationNote を持ち、ハイライトには載らない（docs/05 §11.7）', () => {
    const unknown: GateFinding = { ...BLOCKER, offsetStart: null, offsetEnd: null };
    const gate: GateResultView = {
      ...PASS_GATE,
      layers: { ...PASS_GATE.layers, pii: { state: 'FAIL', findings: [unknown] } },
    };
    const rows = proposalApprovalRows(view({ view: { ...HOST_VIEW, state: 'GATE_FAILED' }, gate }), NOW);
    expect(rows.gate.findings[0]?.locationNote).not.toBeNull();
    expect(rows.preview.bodyHighlights).toEqual([]);
  });

  it('HELD: 層は「検査中」の語、リセット時刻が出る（失敗として描かない）', () => {
    const gate: GateResultView = {
      execution: 'HELD_AI_COST_LIMIT',
      layers: {
        pii: { state: 'HELD', findings: [] },
        commerce: { state: 'HELD', findings: [] },
        consistency: { state: 'PASS', findings: [] },
      },
      aiWarnings: [],
      aiFailed: false,
      contentHash: 'h'.repeat(64),
      held: {
        heldReasonKey: 'gate.held.aiCostLimit',
        heldSince: '2026-09-16T00:00:00.000Z',
        resetAt: '2026-09-16T15:00:00.000Z',
        limitRaise: 'PLATFORM_OPERATOR',
        rerun: { auto: true, manual: 'POST /api/proposals/{id}/gate' },
      },
    };
    const rows = proposalApprovalRows(view({ view: { ...HOST_VIEW, state: 'GATE_RUNNING' }, gate }), NOW);
    expect(rows.gate.heldResetAt).toBe('2026-09-17 00:00 JST');
    expect(rows.gate.layers.find((layer) => layer.key === 'pii')?.verdictLabel).toBe('検査中');
    expect(rows.gate.layers.find((layer) => layer.key === 'consistency')?.verdictLabel).toBe('合格');
    expect(rows.gate.failed).toBe(false);
    expect(rows.disposition.kind).toBe('GATE_RUNNING');
  });
});

describe('proposalApprovalRows: 状態ごとの形（docs/04 §S-021「APPROVAL_PENDING 以外では承認アクションを描画しない」）', () => {
  it.each([
    ['DRAFT', 'DRAFT'],
    ['GATE_RUNNING', 'GATE_RUNNING'],
    ['GATE_FAILED', 'GATE_FAILED'],
    ['APPROVAL_PENDING', 'PENDING'],
    ['APPROVED', 'APPROVED'],
    // 🔴 T-09-06: 送信中 / 送信済み / 送信失敗は別々の形（OTHER に畳まない）。
    ['SUBMITTING', 'SUBMITTING'],
    ['SUBMITTED', 'SUBMITTED'],
    ['SUBMIT_FAILED', 'SUBMIT_FAILED'],
    ['WON', 'OTHER'],
  ] as const)('%s → %s', (state, kind) => {
    const rows = proposalApprovalRows(view({ view: { ...HOST_VIEW, state } }), NOW);
    expect(rows.disposition.kind).toBe(kind);
    if (kind !== 'PENDING') expect((rows.disposition as { notice: string }).notice.length).toBeGreaterThan(0);
  });

  it('承認済み（人間）: 承認者欄に表示名と日時、案内文にも同じ値', () => {
    const rows = proposalApprovalRows(
      view({
        view: { ...HOST_VIEW, state: 'APPROVED' },
        approval: { kind: 'USER', approverName: 'Host A', approvedAt: '2026-09-16T01:00:00.000Z' },
      }),
      NOW,
    );
    expect(rows.approver).toBe('Host A / 2026-09-16 10:00 JST');
    expect(rows.disposition).toMatchObject({ kind: 'APPROVED' });
    expect((rows.disposition as { notice: string }).notice).toContain('Host A');
  });

  it('🔴 F-021 AC-5: 自動承認は「システム（全層 PASS のため自動承認）」と表示される', () => {
    const rows = proposalApprovalRows(
      view({ view: { ...HOST_VIEW, state: 'APPROVED' }, approval: { kind: 'SYSTEM', approvedAt: '2026-09-16T01:00:00.000Z' } }),
      NOW,
    );
    expect(rows.approver).toContain('システム');
    expect(rows.approver).toContain('自動承認');
  });
});

describe('formatElapsed', () => {
  it('分 / 時間 / 日の 3 段で丸める', () => {
    expect(formatElapsed('2026-09-16T02:59:30.000Z', NOW)).toBe('1 分未満');
    expect(formatElapsed('2026-09-16T02:15:00.000Z', NOW)).toBe('45 分');
    expect(formatElapsed('2026-09-15T20:00:00.000Z', NOW)).toBe('7 時間');
    expect(formatElapsed('2026-09-10T03:00:00.000Z', NOW)).toBe('6 日');
  });

  it('未来（時計のずれ）は 0 に丸め、解析できない値は「—」', () => {
    expect(formatElapsed('2026-09-17T03:00:00.000Z', NOW)).toBe('1 分未満');
    expect(formatElapsed('not-a-date', NOW)).toBe('—');
  });
});
