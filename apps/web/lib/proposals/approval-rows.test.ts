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
import type { GateFinding, GateResultView } from '@ses/domain';
import type { ProposalApprovalView } from './approval';
import { APPROVAL_HEADER_REQUIRED_FIELDS, formatElapsed, proposalApprovalRows } from './approval-rows';
import type { HostProposalView, PartnerProposalView } from './views';

const NOW = new Date('2026-09-16T03:00:00.000Z');
const PROPOSAL_ID = '01930000-0000-7000-8000-000000000301';

const HOST_VIEW: HostProposalView = {
  audience: 'HOST',
  owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' },
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
    ...overrides,
  };
}

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
    ['SUBMITTING', 'OTHER'],
    ['SUBMITTED', 'OTHER'],
    ['SUBMIT_FAILED', 'OTHER'],
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
