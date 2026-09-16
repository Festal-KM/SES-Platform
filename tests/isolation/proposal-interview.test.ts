// tests/isolation/proposal-interview.test.ts
// 🔴 T-09-10（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-10 / §5）: 商談結果の記録（`S-024` → #48）を**実 DB（RLS 付き）+ 実 Route Handler**
//    で証明する。`F-025 AC-1`〜`AC-3` / `BR-23` / `CLAUDE.md` §4.2 / docs/05 §6.5「#48 の実装の決着」/「`S-024` の実装の決着（T-09-10）」/ §16.2。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 `F-025 AC-1`: ホストが `SUBMITTED → INTERVIEW_SCHEDULED → INTERVIEWED → RESULT_PENDING → WON` を **`S-024` が組む `note`**（面談日程 /
//      面談実施 / 結果: 決定）付きで順に記録し、`ProposalEvent(STATE, note)` が 4 行、`AuditLog(proposal.update, TRANSITION)` が 4 行残る。
//      🔴 監査の `summary` に `note`（自由入力）が載らない。#46 の履歴は `TRANSITION` の `note` としてそのまま返す（接頭辞の分類に吸われない）。
//   ② 🔴 取引先は自社提案に対して面談実施 / 結果待ち / 辞退（6 本）だけ。`SUBMITTED → INTERVIEW_SCHEDULED`（面談日程の確定）と
//      `RESULT_PENDING → WON` / `LOST`（結果の確定）は **403 `PROPOSAL_TRANSITION_FORBIDDEN`**（状態不変・履歴なし）。`S-024` の読み取り
//      （`readProposalInterview` + `proposalInterviewRows`）でも同じ 3 本のボタンが**候補に無い** —— 画面と API が同じ判定から出ている。
//   ③ 🔴 `F-025 AC-3`: #45 の `byState` で `LOST` が `SUBMIT_FAILED` / `GATE_FAILED` と別のキーに数えられ、`DECLINED` は `byState` に**キーとして無い**
//      （`requestsByState` の側）。T-09-09 の実装を変えずに、本タスクの結合テストでも 1 件固定する。
//   ④ 🔴 終端（`WON` / `LOST` / `WITHDRAWN`）からは手動遷移先 7 値のどれにも進めない（422 `INVALID_STATE_TRANSITION`。状態不変・
//      `state.invalid_transition` が記録される）。`S-024` の読み取りでも操作は 0 個で終端の注記だけ。
//   ⑤ 境界: 他社（A2）・他テナントは `S-024` の読み取りも #48 も 404。`VIEWER` は 403。
//   ⑥ 🔴 `WON` の確定で `assignments` が増えない（`F-025 AC-2`。Phase 1 は記録のみ。`Assignment` の生成は Phase 2 `F-042`）。
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）だけ。DB・RLS・Route Handler・ガード・トランザクションはすべて実物である。
//    「自動で `LOST` / `WON` になる経路が無い」は `tests/static/proposal-outcome-human-only.test.ts` が構造として固定する。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
// 🔴 `@ses/domain` はルートの devDependencies に無いため相対参照（`proposal-transition.test.ts` と同じ）。
import { PROPOSAL_STATES, PROPOSAL_MANUAL_TRANSITION_TARGET_STATES, type ProposalState } from '../../packages/domain/src/state/proposal.js';
import { PROPOSAL_REQUEST_STATES } from '../../packages/domain/src/state/proposalRequest.js';
import { t } from '../../packages/i18n/src/index.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'mobile', ipAddress: '203.0.113.24' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const transitionRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/transition/route');
const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const { readProposalInterview } = await import('../../apps/web/lib/proposals/interview');
const { proposalInterviewRows } = await import('../../apps/web/lib/proposals/interview-rows');
const { buildProposalInterviewNote, PROPOSAL_INTERVIEW_OPERATION_KINDS } = await import('../../apps/web/lib/proposals/interview-note');
const { NotFoundError } = await import('../../apps/web/lib/api/errors');

const AUDIT_ACTIONS = ['proposal.update', 'state.invalid_transition'];
/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_ID = '01930000-0000-7000-8000-0000000fff24';

/** 🔴 `S-024` が #48 の `note` を組む語（`interview-props.ts` と同じ出所 = `packages/i18n`）。 */
const NOTE_LABELS = {
  scheduled: t('proposals.interview.note.scheduled'),
  interviewed: t('proposals.interview.note.interviewed'),
  won: t('proposals.interview.note.won'),
  lost: t('proposals.interview.note.lost'),
  withdrawn: t('proposals.interview.note.withdrawn'),
  separator: t('proposals.interview.note.separator'),
  reasonOpen: t('proposals.interview.note.reasonOpen'),
  reasonClose: t('proposals.interview.note.reasonClose'),
};
const MEMO_INTERVIEWED = 'T0910 技術面は好評。単価は要相談';
const MEMO_WON = 'T0910 11 月開始で合意';

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostSales: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA1Admin: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string };
type StateBody = { readonly state: string };
type ListBody = { readonly byState: Record<string, number>; readonly requestsByState: Record<string, number> };
type DetailBody = {
  readonly state: string;
  readonly events: readonly { readonly kind: string; readonly fromState: string | null; readonly toState: string | null; readonly entry: { readonly kind: string; readonly note?: string | null } }[];
};

/** 🔴 本テストが作る提案（実 #36 で作る = 凍結〔`engineer_snapshots`〕は本物。`beforeAll` で 1 度だけ作り、`afterAll` で消す）。 */
const created = { host: '', p1: '' };

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function transition(ctx: AuthenticatedTenantCtx, id: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return transitionRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    segment(id),
  );
}

async function createProposal(ctx: AuthenticatedTenantCtx, body: Record<string, unknown>): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.POST(
    new Request('https://app.test/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function list(ctx: AuthenticatedTenantCtx): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.GET(new Request('https://app.test/api/proposals'));
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function detail(ctx: AuthenticatedTenantCtx, id: string): Promise<DetailBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalRoute.GET(new Request(`https://app.test/api/proposals/${id}`), segment(id));
  expect(response.status).toBe(200);
  return (await response.json()) as DetailBody;
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

/** `S-024` の読み取り（ページと同じ経路）→ 操作の候補。 */
async function interviewOperations(ctx: AuthenticatedTenantCtx, id: string): Promise<{ readonly phase: string; readonly kinds: string[]; readonly closedNotice: string | null; readonly assignmentNote: string | null }> {
  const view = await readProposalInterview(ctx, id, { now: NOW });
  const rows = proposalInterviewRows(view.screen, ctx, view.subject, NOW);
  return { phase: rows.phase, kinds: rows.operations.map((operation) => operation.kind), closedNotice: rows.closedNotice, assignmentNote: rows.assignmentNote };
}

/** 前提づくり（特権接続）。`APPROVED` / `SUBMITTING` の CHECK（承認記録・ハッシュ）を満たす値を入れる。 */
async function setState(id: string, state: ProposalState): Promise<void> {
  const needsApproval = state === 'APPROVED' || state === 'SUBMITTING';
  const afterSend = ['SUBMITTED', 'SUBMIT_FAILED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN'].includes(state);
  await admin.proposal.update({
    where: { id },
    data: {
      state,
      contentHash: needsApproval || afterSend ? 't0910-hash' : null,
      approvedAt: needsApproval || afterSend ? NOW : null,
      approvedBy: needsApproval || afterSend ? USER_A_HOST : null,
      approvedBySystem: false,
      submittedAt: afterSend && state !== 'SUBMIT_FAILED' ? NOW : null,
      updatedAt: NOW,
    },
  });
}

async function stateOf(id: string): Promise<string> {
  return (await admin.proposal.findUniqueOrThrow({ where: { id }, select: { state: true } })).state;
}

async function events(id: string) {
  return admin.proposalEvent.findMany({
    where: { proposalId: id },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, fromState: true, toState: true, actorUserId: true, note: true },
  });
}

async function audits(id: string, action: string) {
  return admin.auditLog.findMany({
    where: { targetId: id, action },
    orderBy: { createdAt: 'asc' },
    select: { actorKind: true, actorId: true, targetType: true, summary: true, deviceKind: true },
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA1Admin = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_ADMIN' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  // 材料（実 #36 で作る = 凍結〔`S-024` の判断材料の出所〕は本物）。ホスト作成 1 件 / 取引先 A1 作成 1 件。
  // A2 は `PROJECT_A_PUBLISHED` に公開されていないため #36 が 404 になる —— GATE_FAILED の材料は seed の静的な行 `PROPOSAL_A_P2` を使う（S-024 の読み取りには使わない）。
  const recipient = { recipientCompanyName: 'T0910 架空エンド株式会社', recipientEmail: 't0910@example.test' };
  created.host = await createProposal(hostSales, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_HOST, subject: 'ご提案', body: 'T0910 本文', offeredUnitPrice: 720000, ...recipient });
  created.p1 = await createProposal(partnerA1, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, subject: 'ご提案', body: 'T0910 本文', offeredUnitPrice: 680000, ...recipient });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  const ids = Object.values(created).filter((id) => id !== '');
  if (ids.length > 0) {
    await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
    await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
    await admin.proposal.deleteMany({ where: { id: { in: ids } } });
    await admin.auditLog.deleteMany({ where: { action: 'proposal.create' } });
  }
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  for (const id of [created.host, created.p1, PROPOSAL_A_P2]) {
    await setState(id, 'DRAFT');
    // 🔴 履歴は毎回空にする（#36 が書いた作成の行も含む。各テストは「そのテストが書いた行」だけを数える）。
    await admin.proposalEvent.deleteMany({ where: { proposalId: id } });
  }
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

afterEach(async () => {
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ① F-025 AC-1: ホストが S-024 の note 付きで WON まで記録する
// ---------------------------------------------------------------------------

describe('① 🔴 F-025 AC-1 / AC-2: ホストが SUBMITTED → … → WON を S-024 の note 付きで記録し、ProposalEvent と AuditLog が残る', () => {
  it('4 段の記録。note は ProposalEvent にそのまま入り、監査の summary には載らない。assignments は増えない', async () => {
    const id = created.host;
    await setState(id, 'SUBMITTED');
    const assignmentsBefore = await admin.assignment.count({ where: { tenantId: TENANT_A } });

    const empty = { scheduledAt: '', interviewedOn: '', memo: '' };
    const steps = [
      { to: 'INTERVIEW_SCHEDULED', note: buildProposalInterviewNote('SCHEDULE', { ...empty, scheduledAt: '2026-10-01T14:00' }, NOTE_LABELS) },
      { to: 'INTERVIEWED', note: buildProposalInterviewNote('INTERVIEWED', { ...empty, interviewedOn: '2026-10-01', memo: MEMO_INTERVIEWED }, NOTE_LABELS) },
      { to: 'RESULT_PENDING', note: buildProposalInterviewNote('RESULT_PENDING', empty, NOTE_LABELS) },
      { to: 'WON', note: buildProposalInterviewNote('WON', { ...empty, memo: MEMO_WON }, NOTE_LABELS) },
    ] as const;
    expect(steps[0].note).toBe('面談日程: 2026-10-01 14:00');
    expect(steps[2].note).toBeUndefined();
    expect(steps[3].note).toBe(`結果: 決定（${MEMO_WON}）`);

    // 🔴 S-024 の読み取り: SUBMITTED では 日程 + 辞退 だけが候補。
    expect(await interviewOperations(hostSales, id)).toMatchObject({ phase: 'RECORDABLE', kinds: ['SCHEDULE', 'WITHDRAWN'] });

    for (const step of steps) {
      const response = await transition(hostSales, id, step.note === undefined ? { to: step.to } : { to: step.to, note: step.note });
      expect(response.status, step.to).toBe(200);
      expect((await response.json()) as StateBody).toEqual({ state: step.to });
      expect(await stateOf(id)).toBe(step.to);
    }

    const rows = await events(id);
    expect(rows.map((row) => [row.kind, row.fromState, row.toState, row.note])).toEqual([
      ['STATE', 'SUBMITTED', 'INTERVIEW_SCHEDULED', '面談日程: 2026-10-01 14:00'],
      ['STATE', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', `面談実施: 2026-10-01 / ${MEMO_INTERVIEWED}`],
      ['STATE', 'INTERVIEWED', 'RESULT_PENDING', null],
      ['STATE', 'RESULT_PENDING', 'WON', `結果: 決定（${MEMO_WON}）`],
    ]);
    expect(rows.every((row) => row.actorUserId === USER_A_HOST)).toBe(true);

    const logs = await audits(id, 'proposal.update');
    expect(logs.map((row) => row.summary)).toEqual([
      { operation: 'TRANSITION', fromState: 'SUBMITTED', toState: 'INTERVIEW_SCHEDULED' },
      { operation: 'TRANSITION', fromState: 'INTERVIEW_SCHEDULED', toState: 'INTERVIEWED' },
      { operation: 'TRANSITION', fromState: 'INTERVIEWED', toState: 'RESULT_PENDING' },
      { operation: 'TRANSITION', fromState: 'RESULT_PENDING', toState: 'WON' },
    ]);
    for (const row of logs) {
      expect(row.actorKind).toBe('USER');
      expect(row.actorId).toBe(USER_A_HOST);
      expect(row.targetType).toBe('Proposal');
      expect(row.deviceKind).toBe('mobile');
      // 🔴 自由入力（要点・理由）も、画面が組んだ語も監査には載らない（§16.2）。
      const json = JSON.stringify(row.summary);
      expect(json).not.toContain('T0910');
      expect(json).not.toContain('面談');
      expect(json).not.toContain('結果:');
    }
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);

    // 🔴 #46 の履歴: S-024 の note は接頭辞の分類に吸われず、TRANSITION の note としてそのまま返る。
    const view = await detail(hostSales, id);
    expect(view.state).toBe('WON');
    const transitions = view.events.filter((event) => event.kind === 'STATE' && event.fromState !== null);
    expect(transitions.map((event) => [event.entry.kind, event.entry.note ?? null])).toEqual([
      ['TRANSITION', '面談日程: 2026-10-01 14:00'],
      ['TRANSITION', `面談実施: 2026-10-01 / ${MEMO_INTERVIEWED}`],
      ['TRANSITION', null],
      ['TRANSITION', `結果: 決定（${MEMO_WON}）`],
    ]);

    // 🔴 F-025 AC-2: WON は Phase 1 では記録のみ。Assignment は生成されない（Phase 2 F-042）。S-024 は注記だけを出す。
    expect(await admin.assignment.count({ where: { tenantId: TENANT_A } })).toBe(assignmentsBefore);
    expect(await interviewOperations(hostSales, id)).toEqual({
      phase: 'CLOSED',
      kinds: [],
      closedNotice: t('proposals.interview.closed.WON'),
      assignmentNote: t('proposals.interview.closed.WON.assignmentNote'),
    });
  });

  it('見送り（LOST）と辞退（WITHDRAWN）も S-024 の note 付きで記録でき、互いに別の状態として残る', async () => {
    await setState(created.host, 'RESULT_PENDING');
    await setState(created.p1, 'INTERVIEWED');
    const lost = buildProposalInterviewNote('LOST', { scheduledAt: '', interviewedOn: '', memo: '単価' }, NOTE_LABELS);
    const withdrawn = buildProposalInterviewNote('WITHDRAWN', { scheduledAt: '', interviewedOn: '', memo: '' }, NOTE_LABELS);
    expect((await transition(hostSales, created.host, { to: 'LOST', note: lost })).status).toBe(200);
    expect((await transition(hostSales, created.p1, { to: 'WITHDRAWN', note: withdrawn })).status).toBe(200);
    expect(await stateOf(created.host)).toBe('LOST');
    expect(await stateOf(created.p1)).toBe('WITHDRAWN');
    expect((await events(created.host))[0]?.note).toBe('結果: 見送り（単価）');
    expect((await events(created.p1))[0]?.note).toBe('辞退');
    expect(await interviewOperations(hostSales, created.host)).toMatchObject({ phase: 'CLOSED', kinds: [], closedNotice: t('proposals.interview.closed.LOST'), assignmentNote: null });
    expect(await interviewOperations(hostSales, created.p1)).toMatchObject({ phase: 'CLOSED', kinds: [], closedNotice: t('proposals.interview.closed.WITHDRAWN'), assignmentNote: null });
  });
});

// ---------------------------------------------------------------------------
// ② 取引先は 6 本だけ（面談日程の確定・結果の確定は 403）
// ---------------------------------------------------------------------------

describe('② 🔴 取引先は自社提案の面談実施 / 結果待ち / 辞退だけ。日程の確定と結果の確定は 403（docs/04 §S-024 権限差分）', () => {
  it('SUBMITTED → INTERVIEW_SCHEDULED は 403 PROPOSAL_TRANSITION_FORBIDDEN。S-024 の候補にも SCHEDULE が無い', async () => {
    const id = created.p1;
    await setState(id, 'SUBMITTED');
    for (const ctx of [partnerA1, partnerA1Admin]) {
      expect(await interviewOperations(ctx, id)).toMatchObject({ phase: 'RECORDABLE', kinds: ['WITHDRAWN'] });
      const error = await errorOf(await transition(ctx, id, { to: 'INTERVIEW_SCHEDULED', note: '面談日程: 2026-10-01 14:00' }), 403);
      expect(error.code).toBe('PROPOSAL_TRANSITION_FORBIDDEN');
    }
    expect(await stateOf(id)).toBe('SUBMITTED');
    expect(await events(id)).toHaveLength(0);
    expect(await audits(id, 'proposal.update')).toHaveLength(0);
    // 🔴 立場の問題であり、不正な遷移としては数えない（第 3 段は第 1 段の後）。
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
  });

  it('INTERVIEW_SCHEDULED → INTERVIEWED → RESULT_PENDING は取引先が記録できる（200。note 付き）', async () => {
    const id = created.p1;
    await setState(id, 'INTERVIEW_SCHEDULED');
    expect(await interviewOperations(partnerA1, id)).toMatchObject({ kinds: ['INTERVIEWED', 'WITHDRAWN'] });
    const note = buildProposalInterviewNote('INTERVIEWED', { scheduledAt: '', interviewedOn: '2026-10-01', memo: MEMO_INTERVIEWED }, NOTE_LABELS);
    expect((await transition(partnerA1, id, { to: 'INTERVIEWED', note })).status).toBe(200);
    expect(await interviewOperations(partnerA1, id)).toMatchObject({ kinds: ['RESULT_PENDING', 'WITHDRAWN'] });
    expect((await transition(partnerA1, id, { to: 'RESULT_PENDING' })).status).toBe(200);
    expect(await stateOf(id)).toBe('RESULT_PENDING');
    const rows = await events(id);
    expect(rows.map((row) => [row.toState, row.actorUserId, row.note])).toEqual([
      ['INTERVIEWED', USER_A_PARTNER, `面談実施: 2026-10-01 / ${MEMO_INTERVIEWED}`],
      ['RESULT_PENDING', USER_A_PARTNER, null],
    ]);
  });

  it.each(['WON', 'LOST'] as const)('🔴 RESULT_PENDING → %s は取引先から 403。S-024 の候補は辞退だけ', async (to) => {
    const id = created.p1;
    await setState(id, 'RESULT_PENDING');
    expect(await interviewOperations(partnerA1, id)).toMatchObject({ phase: 'RECORDABLE', kinds: ['WITHDRAWN'] });
    const error = await errorOf(await transition(partnerA1, id, { to }), 403);
    expect(error.code).toBe('PROPOSAL_TRANSITION_FORBIDDEN');
    expect(await stateOf(id)).toBe('RESULT_PENDING');
    expect(await events(id)).toHaveLength(0);
    // 同じ提案をホストは確定できる。
    expect((await transition(hostSales, id, { to })).status).toBe(200);
    expect(await stateOf(id)).toBe(to);
  });

  it('取引先の候補の総数は 6（4 状態の和）。S-024 の出し分けと #48 の 403 が同じ判定から出ている', async () => {
    const id = created.p1;
    const commercial: readonly ProposalState[] = ['SUBMITTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING'];
    const offered: string[] = [];
    let allowed = 0;
    let forbidden = 0;
    for (const from of commercial) {
      await setState(id, from);
      const { kinds } = await interviewOperations(partnerA1, id);
      offered.push(...kinds);
      for (const kind of PROPOSAL_INTERVIEW_OPERATION_KINDS) {
        const to = { SCHEDULE: 'INTERVIEW_SCHEDULED', INTERVIEWED: 'INTERVIEWED', RESULT_PENDING: 'RESULT_PENDING', WON: 'WON', LOST: 'LOST', WITHDRAWN: 'WITHDRAWN' }[kind];
        await setState(id, from);
        const response = await transition(partnerA1, id, { to });
        if (response.status === 200) {
          allowed += 1;
          expect(kinds, `${from} -> ${to}`).toContain(kind);
        } else if (response.status === 403) {
          forbidden += 1;
          expect(kinds, `${from} -> ${to}`).not.toContain(kind);
        } else {
          // 遷移表に無い組（422）は候補にも無い。
          expect(response.status, `${from} -> ${to}`).toBe(422);
          expect(kinds, `${from} -> ${to}`).not.toContain(kind);
        }
      }
    }
    expect(offered).toHaveLength(6);
    expect(allowed).toBe(6);
    // SUBMITTED → INTERVIEW_SCHEDULED / RESULT_PENDING → WON / → LOST の 3 本。
    expect(forbidden).toBe(3);
    expect(offered).not.toContain('SCHEDULE');
    expect(offered).not.toContain('WON');
    expect(offered).not.toContain('LOST');
  });
});

// ---------------------------------------------------------------------------
// ③ F-025 AC-3: LOST は別に集計される
// ---------------------------------------------------------------------------

describe('③ 🔴 F-025 AC-3 / BR-23: LOST は SUBMIT_FAILED / GATE_FAILED / DECLINED と別のキーで集計される（#45 byState）', () => {
  it('byState は 14 キーで、LOST / SUBMIT_FAILED / GATE_FAILED が独立に数えられ、DECLINED は byState にキーとして無い', async () => {
    await setState(created.host, 'RESULT_PENDING');
    // 🔴 見送りは S-024 の操作（#48）で確定する（前提づくりでも人間の経路を通す）。
    expect((await transition(hostSales, created.host, { to: 'LOST', note: buildProposalInterviewNote('LOST', { scheduledAt: '', interviewedOn: '', memo: '' }, NOTE_LABELS) })).status).toBe(200);
    await setState(created.p1, 'SUBMIT_FAILED');
    // 🔴 GATE_FAILED の材料は seed の静的な行（取引先 A2 の提案。S-024 の読み取りには使わない）。
    await setState(PROPOSAL_A_P2, 'GATE_FAILED');

    const body = await list(hostSales);
    expect(Object.keys(body.byState).sort()).toEqual([...PROPOSAL_STATES].sort());
    expect(body.byState['LOST']).toBe(1);
    expect(body.byState['SUBMIT_FAILED']).toBe(1);
    expect(body.byState['GATE_FAILED']).toBe(1);
    expect(body.byState).not.toHaveProperty('DECLINED');
    expect(Object.keys(body.requestsByState).sort()).toEqual([...PROPOSAL_REQUEST_STATES].sort());
    expect(body.requestsByState).toHaveProperty('DECLINED');

    // 取引先 A1 の byState は自社分（SUBMIT_FAILED = 1）だけで、ホストの LOST は数えられない（境界適用後。§4.8）。
    const partner = await list(partnerA1);
    expect(partner.byState['SUBMIT_FAILED']).toBe(1);
    expect(partner.byState['LOST']).toBe(0);
    expect(partner.byState['GATE_FAILED']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 終端からは進めない
// ---------------------------------------------------------------------------

describe('④ 🔴 終端（WON / LOST / WITHDRAWN）からは手動遷移先 7 値のどれにも進めない（422。状態不変・記録あり）', () => {
  it.each(['WON', 'LOST', 'WITHDRAWN'] as const)('%s からの 7 値はすべて 422 INVALID_STATE_TRANSITION。S-024 の候補は 0 個', async (from) => {
    const id = created.host;
    for (const to of PROPOSAL_MANUAL_TRANSITION_TARGET_STATES) {
      await setState(id, from);
      await admin.auditLog.deleteMany({ where: { targetId: id } });
      const error = await errorOf(await transition(hostSales, id, { to }), 422);
      expect(error.code, `${from} -> ${to}`).toBe('INVALID_STATE_TRANSITION');
      expect(await stateOf(id)).toBe(from);
      expect(await events(id)).toHaveLength(0);
      const logs = await audits(id, 'state.invalid_transition');
      expect(logs).toHaveLength(1);
      expect(logs[0]?.summary).toEqual({ entity: 'Proposal', from, to });
    }
    expect(await interviewOperations(hostSales, id)).toMatchObject({ phase: 'CLOSED', kinds: [] });
  });
});

// ---------------------------------------------------------------------------
// ⑤ 境界と VIEWER
// ---------------------------------------------------------------------------

describe('⑤ 境界: 他社 / 他テナント / 不存在は S-024 の読み取りも #48 も 404。VIEWER は 403', () => {
  it('取引先 A2 / テナント B / 不存在の ID: readProposalInterview は NotFoundError、#48 は 404（本文まで同じ）', async () => {
    await setState(created.p1, 'INTERVIEW_SCHEDULED');
    const absent = await transition(hostSales, ABSENT_ID, { to: 'INTERVIEWED' });
    expect(absent.status).toBe(404);
    const absentText = await absent.text();
    for (const [ctx, id] of [
      [partnerA2, created.p1],
      [hostB, created.p1],
      [hostSales, ABSENT_ID],
    ] as const) {
      await expect(readProposalInterview(ctx, id, { now: NOW })).rejects.toBeInstanceOf(NotFoundError);
      const response = await transition(ctx, id, { to: 'INTERVIEWED' });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(absentText);
    }
    expect(await stateOf(created.p1)).toBe('INTERVIEW_SCHEDULED');
    expect(await events(created.p1)).toHaveLength(0);
  });

  it('VIEWER は S-024 の候補が 0 個で、#48 は 403（状態不変）', async () => {
    const id = created.host;
    await setState(id, 'SUBMITTED');
    expect(await interviewOperations(hostViewer, id)).toMatchObject({ phase: 'RECORDABLE', kinds: [] });
    expect((await transition(hostViewer, id, { to: 'INTERVIEW_SCHEDULED' })).status).toBe(403);
    expect(await stateOf(id)).toBe('SUBMITTED');
    expect(await events(id)).toHaveLength(0);
  });
});
