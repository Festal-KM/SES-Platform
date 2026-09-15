// tests/isolation/proposal-transition.test.ts
// 🔴 T-09-02（`docs/sprints/SP-09-proposal-flow.md` §5）: 提案の状態遷移（#48）を**実 DB（RLS 付き）+ 実 Route Handler**
//    で証明する。`F-024 AC-1` / `F-025 AC-1` / `BR-33` / `CLAUDE.md` §4.2 / §3.3 / docs/05 §6.5「#48 の実装の決着」/ §15.3 / §4.8。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 `F-024 AC-1`: `CLAUDE.md` §4.2 に無い遷移は **422 `INVALID_STATE_TRANSITION`**。**状態は変化せず**、
//      `ProposalEvent` も `proposal.update` も増えず、`state.invalid_transition`（`{ entity, from, to }`）が記録される
//      （サイレントに無視しない）。終端（`WON` / `LOST` / `WITHDRAWN`）からも同じ。
//   ② 🔴 #48 の射程: 遷移表に**ある**が #48 の専有でない `APPROVAL_PENDING → DRAFT`（#42 却下の専有）は
//      **422 `PROPOSAL_TRANSITION_RESERVED`**（状態不変・記録なし）。`to: 'APPROVED'` / `'SUBMITTED'` / `'GATE_RUNNING'` は
//      入力面に存在しない（**400**。承認・送信・ゲート結果を汎用 API で書けない）。
//   ③ 商談進行の連鎖（`SUBMITTED → INTERVIEW_SCHEDULED → INTERVIEWED → RESULT_PENDING → WON`）と辞退（`→ WITHDRAWN`）、
//      修正のための差し戻し（`GATE_FAILED → DRAFT`）が、それぞれ CAS + `ProposalEvent(STATE, note)` + `proposal.update`
//      （`summary` に `note` を載せない）で成立する。
//   ④ 🔴 権限: ホストの `SALES` / `OWNER` は全部、取引先は自社提案の面談実施・辞退だけ（面談日程の確定・結果の確定は
//      **403 `PROPOSAL_TRANSITION_FORBIDDEN`**）、`VIEWER` は 403、他社（A2）・他テナントは 404、`SUSPENDED` は 409。
//   ⑤ 🔴 #39 の統一（T-09-02）: 遷移表に無い状態からのレビュー依頼も `state.invalid_transition` に記録される。
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と、#39 の検証で「呼ばれてはならない」ゲートキューの stub だけ。
//    DB・RLS・Route Handler・ガード・トランザクションはすべて実物である。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateRunJobQueue } from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  PARTNER_A2,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
// 🔴 `@ses/domain` はルートの devDependencies に無いため相対参照（`proposal-request-outcomes.test.ts` と同じ）。
import { PROPOSAL_STATES, type ProposalState } from '../../packages/domain/src/state/proposal.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'mobile', ipAddress: '203.0.113.92' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const transitionRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/transition/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');

const AUDIT_ACTIONS = ['proposal.update', 'state.invalid_transition'];
const NOTE = 'T0902-note-先方都合により見送り';
/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_ID = '01930000-0000-7000-8000-0000000fffff';

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostSales: AuthenticatedTenantCtx;
let hostOwner: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let hostSuspended: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA1Viewer: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type StateBody = { readonly state: string };

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

async function requestGate(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

/** 前提づくり（特権接続）。`APPROVED` / `SUBMITTING` の CHECK（承認記録・ハッシュ）を満たす値を入れる。 */
async function setState(id: string, state: ProposalState): Promise<void> {
  const needsApproval = state === 'APPROVED' || state === 'SUBMITTING';
  await admin.proposal.update({
    where: { id },
    data: {
      state,
      contentHash: needsApproval ? 't0902-hash' : null,
      approvedAt: needsApproval ? NOW : null,
      approvedBy: needsApproval ? USER_A_HOST : null,
      approvedBySystem: false,
      submittedAt: null,
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
    select: { kind: true, fromState: true, toState: true, actorUserId: true, note: true, ownerPartnerCompanyId: true },
  });
}

async function audits(id: string, action: string) {
  return admin.auditLog.findMany({
    where: { targetId: id, action },
    orderBy: { createdAt: 'asc' },
    select: { actorKind: true, actorId: true, targetType: true, summary: true, deviceKind: true, ipAddress: true },
  });
}

/** 🔴 「何も起きていない」の 3 点セット（状態・履歴・監査）。 */
async function expectUntouched(id: string, state: string, eventCount = 0): Promise<void> {
  expect(await stateOf(id)).toBe(state);
  expect(await events(id)).toHaveLength(eventCount);
  expect(await audits(id, 'proposal.update')).toHaveLength(0);
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostOwner = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'OWNER', twoFactor: 'VERIFIED' },
    DEVICE,
  );
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  hostSuspended = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'SUSPENDED' },
    DEVICE,
  );
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA1Viewer = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'VIEWER' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  resetGateRunJobQueue();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  for (const id of [PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2]) {
    await setState(id, 'DRAFT');
    await admin.proposalEvent.deleteMany({ where: { proposalId: id } });
  }
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

afterEach(async () => {
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ③ 商談進行の連鎖・辞退・差し戻し（成立する遷移）
// ---------------------------------------------------------------------------

describe('③ 人間の明示操作による遷移が CAS + ProposalEvent + 監査で成立する（F-025 / docs/05 §6.5 #48）', () => {
  it('ホストの SALES: SUBMITTED → INTERVIEW_SCHEDULED → INTERVIEWED → RESULT_PENDING → WON（各段が 200 { state }）', async () => {
    const id = PROPOSAL_A_HOST;
    await setState(id, 'SUBMITTED');

    const chain: readonly ProposalState[] = ['INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON'];
    let from: ProposalState = 'SUBMITTED';
    for (const to of chain) {
      const response = await transition(hostSales, id, to === 'WON' ? { to, note: NOTE } : { to });
      expect(response.status, `${from} -> ${to}`).toBe(200);
      expect((await response.json()) as StateBody).toEqual({ state: to });
      expect(await stateOf(id)).toBe(to);
      from = to;
    }

    const rows = await events(id);
    expect(rows.map((row) => [row.kind, row.fromState, row.toState])).toEqual([
      ['STATE', 'SUBMITTED', 'INTERVIEW_SCHEDULED'],
      ['STATE', 'INTERVIEW_SCHEDULED', 'INTERVIEWED'],
      ['STATE', 'INTERVIEWED', 'RESULT_PENDING'],
      ['STATE', 'RESULT_PENDING', 'WON'],
    ]);
    expect(rows.every((row) => row.actorUserId === USER_A_HOST)).toBe(true);
    expect(rows.map((row) => row.note)).toEqual([null, null, null, NOTE]);
    // ホスト作成の提案なので所有会社は null（継承トリガ）。
    expect(rows.every((row) => row.ownerPartnerCompanyId === null)).toBe(true);

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
      expect(row.ipAddress).toBe(META.ipAddress);
      // 🔴 自由入力のメモを監査に載せない（§16.2）。
      expect(JSON.stringify(row.summary)).not.toContain('T0902-note');
    }
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
  });

  it('RESULT_PENDING → LOST（見送り）も人間の操作で確定し、WON とは別の状態として残る', async () => {
    const id = PROPOSAL_A_HOST;
    await setState(id, 'RESULT_PENDING');
    const response = await transition(hostOwner, id, { to: 'LOST' });
    expect(response.status).toBe(200);
    expect(await stateOf(id)).toBe('LOST');
    expect((await events(id)).map((row) => row.toState)).toEqual(['LOST']);
  });

  it.each(['SUBMITTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING'] as const)(
    '%s → WITHDRAWN（辞退）はホストからも取引先（自社提案）からも記録できる',
    async (from) => {
      await setState(PROPOSAL_A_HOST, from);
      await setState(PROPOSAL_A_P1, from);

      const byHost = await transition(hostSales, PROPOSAL_A_HOST, { to: 'WITHDRAWN' });
      expect(byHost.status).toBe(200);
      expect(await stateOf(PROPOSAL_A_HOST)).toBe('WITHDRAWN');

      const byPartner = await transition(partnerA1, PROPOSAL_A_P1, { to: 'WITHDRAWN', note: NOTE });
      expect(byPartner.status).toBe(200);
      expect(await stateOf(PROPOSAL_A_P1)).toBe('WITHDRAWN');
      const rows = await events(PROPOSAL_A_P1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorUserId).toBe(USER_A_PARTNER);
      expect(rows[0]?.note).toBe(NOTE);
      // 🔴 取引先の書いた履歴行は取引先の所有（継承トリガ。C5 で他社からは見えない）。
      expect(rows[0]?.ownerPartnerCompanyId).toBe(PARTNER_A1);
      const logs = await audits(PROPOSAL_A_P1, 'proposal.update');
      expect(logs).toHaveLength(1);
      expect(logs[0]?.summary).toEqual({ operation: 'TRANSITION', fromState: from, toState: 'WITHDRAWN' });
    },
  );

  it('GATE_FAILED → DRAFT（修正のための差し戻し）: 作成者の取引先も、ホストの SALES も戻せる', async () => {
    await setState(PROPOSAL_A_P1, 'GATE_FAILED');
    const byCreator = await transition(partnerA1, PROPOSAL_A_P1, { to: 'DRAFT' });
    expect(byCreator.status).toBe(200);
    expect(await stateOf(PROPOSAL_A_P1)).toBe('DRAFT');

    await setState(PROPOSAL_A_P1, 'GATE_FAILED');
    const byHost = await transition(hostSales, PROPOSAL_A_P1, { to: 'DRAFT' });
    expect(byHost.status).toBe(200);
    expect(await stateOf(PROPOSAL_A_P1)).toBe('DRAFT');
    expect((await events(PROPOSAL_A_P1)).map((row) => [row.fromState, row.toState, row.actorUserId])).toEqual([
      ['GATE_FAILED', 'DRAFT', USER_A_PARTNER],
      ['GATE_FAILED', 'DRAFT', USER_A_HOST],
    ]);
  });
});

// ---------------------------------------------------------------------------
// ① F-024 AC-1: 遷移表に無い遷移は 422。状態は変化せずエラーが記録される
// ---------------------------------------------------------------------------

describe('① 🔴 F-024 AC-1 / BR-33: CLAUDE.md §4.2 に無い遷移は 422 で、状態は変化せず state.invalid_transition が記録される', () => {
  it.each([
    ['DRAFT', 'WON'],
    ['DRAFT', 'WITHDRAWN'],
    ['SUBMITTED', 'WON'],
    ['SUBMITTED', 'RESULT_PENDING'],
    ['INTERVIEW_SCHEDULED', 'RESULT_PENDING'],
    ['APPROVED', 'WITHDRAWN'],
    ['GATE_RUNNING', 'DRAFT'],
    ['SUBMITTING', 'WITHDRAWN'],
    ['SUBMIT_FAILED', 'WITHDRAWN'],
    ['WON', 'LOST'],
    ['LOST', 'WON'],
    ['WITHDRAWN', 'INTERVIEWED'],
  ] as const)('%s → %s は 422 INVALID_STATE_TRANSITION（状態不変・履歴なし・state.invalid_transition が 1 行）', async (from, to) => {
    const id = PROPOSAL_A_HOST;
    await setState(id, from);

    const error = await errorOf(await transition(hostSales, id, { to }), 422);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    await expectUntouched(id, from);

    const logs = await audits(id, 'state.invalid_transition');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.summary).toEqual({ entity: 'Proposal', from, to });
    expect(logs[0]?.actorKind).toBe('USER');
    expect(logs[0]?.actorId).toBe(USER_A_HOST);
    expect(logs[0]?.targetType).toBe('Proposal');
    expect(logs[0]?.deviceKind).toBe('mobile');
  });

  it('🔴 全 14 状態 × 手動遷移先 7 値のうち、遷移表に無い組はすべて 422 で状態が変わらない（専有の 1 組と MANUAL の 10 組を除く）', async () => {
    const id = PROPOSAL_A_HOST;
    const targets = ['DRAFT', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN'] as const;
    let invalid = 0;
    let manual = 0;
    let reserved = 0;
    for (const from of PROPOSAL_STATES) {
      for (const to of targets) {
        await setState(id, from);
        await admin.proposalEvent.deleteMany({ where: { proposalId: id } });
        await admin.auditLog.deleteMany({ where: { targetId: id } });
        const response = await transition(hostSales, id, { to });
        if (response.status === 200) {
          manual += 1;
          expect(await stateOf(id), `${from} -> ${to}`).toBe(to);
          continue;
        }
        const error = await errorOf(response, 422);
        expect(await stateOf(id), `${from} -> ${to}`).toBe(from);
        expect(await events(id), `${from} -> ${to}`).toHaveLength(0);
        if (error.code === 'PROPOSAL_TRANSITION_RESERVED') {
          reserved += 1;
          expect(`${from}->${to}`).toBe('APPROVAL_PENDING->DRAFT');
          expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
        } else {
          invalid += 1;
          expect(error.code, `${from} -> ${to}`).toBe('INVALID_STATE_TRANSITION');
          expect(await audits(id, 'state.invalid_transition'), `${from} -> ${to}`).toHaveLength(1);
        }
      }
    }
    expect(manual).toBe(10);
    expect(reserved).toBe(1);
    expect(invalid).toBe(14 * 7 - 10 - 1);
  });

  it('同じ遷移を 2 回要求すると、2 回目は現在の状態からの 422 として記録される（CAS の後始末と同じ形）', async () => {
    const id = PROPOSAL_A_HOST;
    await setState(id, 'SUBMITTED');
    expect((await transition(hostSales, id, { to: 'INTERVIEW_SCHEDULED' })).status).toBe(200);
    const error = await errorOf(await transition(hostSales, id, { to: 'INTERVIEW_SCHEDULED' }), 422);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await stateOf(id)).toBe('INTERVIEW_SCHEDULED');
    expect(await events(id)).toHaveLength(1);
    const logs = await audits(id, 'state.invalid_transition');
    expect(logs.map((row) => row.summary)).toEqual([
      { entity: 'Proposal', from: 'INTERVIEW_SCHEDULED', to: 'INTERVIEW_SCHEDULED' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// ② #48 の射程（専有の遷移は #48 から起こせない）
// ---------------------------------------------------------------------------

describe('② 🔴 #48 の射程: 専有の遷移は起こせない（docs/05 §6.5「#48 の実装の決着」/ CLAUDE.md §3.3 / §3.4）', () => {
  it('APPROVAL_PENDING → DRAFT（#42 却下の専有）は 422 PROPOSAL_TRANSITION_RESERVED。状態不変・履歴なし・監査なし', async () => {
    const id = PROPOSAL_A_HOST;
    await setState(id, 'APPROVAL_PENDING');
    for (const ctx of [hostSales, hostOwner]) {
      const error = await errorOf(await transition(ctx, id, { to: 'DRAFT' }), 422);
      expect(error.code).toBe('PROPOSAL_TRANSITION_RESERVED');
    }
    await expectUntouched(id, 'APPROVAL_PENDING');
    // 🔴 遷移表にはある組なので、不正な遷移としては数えない。
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
  });

  it.each([
    ['APPROVAL_PENDING', 'APPROVED'],
    ['DRAFT', 'GATE_RUNNING'],
    ['GATE_RUNNING', 'GATE_FAILED'],
    ['GATE_RUNNING', 'APPROVAL_PENDING'],
    ['APPROVED', 'SUBMITTING'],
    ['SUBMITTING', 'SUBMITTED'],
    ['SUBMITTING', 'SUBMIT_FAILED'],
    ['SUBMIT_FAILED', 'APPROVED'],
  ] as const)('🔴 %s → %s（#39 / ゲートジョブ / #41 / 送信ジョブ / #44 の専有）は入力面に存在しない（400。状態不変・記録なし）', async (from, to) => {
    const id = PROPOSAL_A_HOST;
    await setState(id, from);
    const error = await errorOf(await transition(hostOwner, id, { to }), 400);
    expect(error.code).toBe('VALIDATION');
    await expectUntouched(id, from);
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
  });

  it('🔴 SUBMIT_FAILED からは #48 で APPROVED に戻せない（人間の再実行は #44 の専有）し、他のどの手動遷移先にも進めない', async () => {
    const id = PROPOSAL_A_HOST;
    await setState(id, 'SUBMIT_FAILED');
    expect((await transition(hostOwner, id, { to: 'APPROVED' })).status).toBe(400);
    for (const to of ['DRAFT', 'INTERVIEW_SCHEDULED', 'WITHDRAWN', 'WON'] as const) {
      const error = await errorOf(await transition(hostOwner, id, { to }), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');
    }
    expect(await stateOf(id)).toBe('SUBMIT_FAILED');
    expect(await events(id)).toHaveLength(0);
  });

  it('未知の to / 空の body は 400', async () => {
    const id = PROPOSAL_A_HOST;
    await setState(id, 'SUBMITTED');
    expect((await transition(hostSales, id, { to: 'NOPE' })).status).toBe(400);
    expect((await transition(hostSales, id, {})).status).toBe(400);
    expect((await transition(hostSales, id, { to: 'WITHDRAWN', note: '   ' })).status).toBe(400);
    await expectUntouched(id, 'SUBMITTED');
  });
});

// ---------------------------------------------------------------------------
// ④ 権限と境界
// ---------------------------------------------------------------------------

describe('④ 🔴 権限と境界（docs/02 章 4.2 F-024 F-025 / docs/04 §S-024 権限差分 / §4.8）', () => {
  it('取引先は自社提案の面談実施（INTERVIEW_SCHEDULED → INTERVIEWED → RESULT_PENDING）を記録でき、面談日程の確定と結果の確定は 403', async () => {
    const id = PROPOSAL_A_P1;
    await setState(id, 'SUBMITTED');

    // 面談日程の確定はホストの操作（F-041 の PA / PS = −）。
    const schedule = await errorOf(await transition(partnerA1, id, { to: 'INTERVIEW_SCHEDULED' }), 403);
    expect(schedule.code).toBe('PROPOSAL_TRANSITION_FORBIDDEN');
    await expectUntouched(id, 'SUBMITTED');
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);

    expect((await transition(hostSales, id, { to: 'INTERVIEW_SCHEDULED' })).status).toBe(200);
    expect((await transition(partnerA1, id, { to: 'INTERVIEWED' })).status).toBe(200);
    expect((await transition(partnerA1, id, { to: 'RESULT_PENDING' })).status).toBe(200);
    expect(await stateOf(id)).toBe('RESULT_PENDING');

    // 結果の確定は提案先からホストに届く事実。
    for (const to of ['WON', 'LOST'] as const) {
      const error = await errorOf(await transition(partnerA1, id, { to }), 403);
      expect(error.code).toBe('PROPOSAL_TRANSITION_FORBIDDEN');
    }
    expect(await stateOf(id)).toBe('RESULT_PENDING');
    expect((await events(id)).map((row) => [row.toState, row.actorUserId])).toEqual([
      ['INTERVIEW_SCHEDULED', USER_A_HOST],
      ['INTERVIEWED', USER_A_PARTNER],
      ['RESULT_PENDING', USER_A_PARTNER],
    ]);

    expect((await transition(hostSales, id, { to: 'WON', note: NOTE })).status).toBe(200);
    expect(await stateOf(id)).toBe('WON');
  });

  it('🔴 VIEWER（ホスト / 取引先）は 1 本も実行できない（BR-31。状態不変・記録なし）', async () => {
    await setState(PROPOSAL_A_HOST, 'SUBMITTED');
    await setState(PROPOSAL_A_P1, 'INTERVIEW_SCHEDULED');
    expect((await transition(hostViewer, PROPOSAL_A_HOST, { to: 'WITHDRAWN' })).status).toBe(403);
    expect((await transition(partnerA1Viewer, PROPOSAL_A_P1, { to: 'INTERVIEWED' })).status).toBe(403);
    await expectUntouched(PROPOSAL_A_HOST, 'SUBMITTED');
    await expectUntouched(PROPOSAL_A_P1, 'INTERVIEW_SCHEDULED');
    expect(await admin.auditLog.count({ where: { action: 'state.invalid_transition' } })).toBe(0);
  });

  it('🔴 他社（A2）・他テナント（B）・実在しない ID は「存在しない」と同じ 404（本文まで同一。§4.8）', async () => {
    await setState(PROPOSAL_A_P1, 'SUBMITTED');
    const crossPartner = await transition(partnerA2, PROPOSAL_A_P1, { to: 'WITHDRAWN' });
    const crossTenant = await transition(hostB, PROPOSAL_A_HOST, { to: 'WITHDRAWN' });
    const absent = await transition(hostSales, ABSENT_ID, { to: 'WITHDRAWN' });
    expect(crossPartner.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(absent.status).toBe(404);
    const absentBody = await absent.text();
    expect(await crossPartner.text()).toBe(absentBody);
    expect(await crossTenant.text()).toBe(absentBody);
    await expectUntouched(PROPOSAL_A_P1, 'SUBMITTED');
    await expectUntouched(PROPOSAL_A_HOST, 'DRAFT');
    expect(await admin.auditLog.count({ where: { action: { in: AUDIT_ACTIONS } } })).toBe(0);
  });

  it('🔴 SUSPENDED のテナントでは実行できない（409。F-004 AC-7。状態不変）', async () => {
    await setState(PROPOSAL_A_HOST, 'SUBMITTED');
    const error = await errorOf(await transition(hostSuspended, PROPOSAL_A_HOST, { to: 'WITHDRAWN' }), 409);
    expect(error.code).toBe('TENANT_NOT_EXECUTABLE');
    await expectUntouched(PROPOSAL_A_HOST, 'SUBMITTED');
  });

  it('取引先は他社の提案の履歴・監査に到達できない（自社の記録だけが C5 で見える）', async () => {
    await setState(PROPOSAL_A_P1, 'SUBMITTED');
    await setState(PROPOSAL_A_P2, 'SUBMITTED');
    expect((await transition(partnerA1, PROPOSAL_A_P1, { to: 'WITHDRAWN' })).status).toBe(200);
    expect((await transition(partnerA2, PROPOSAL_A_P2, { to: 'WITHDRAWN' })).status).toBe(200);
    // A1 の事実（特権接続）: 2 社の履歴はそれぞれの所有会社を持つ。
    expect((await events(PROPOSAL_A_P1)).map((row) => row.ownerPartnerCompanyId)).toEqual([PARTNER_A1]);
    expect((await events(PROPOSAL_A_P2)).map((row) => row.ownerPartnerCompanyId)).toEqual([PARTNER_A2]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ #39 の統一（遷移表に無い状態からのレビュー依頼も記録される）
// ---------------------------------------------------------------------------

describe('⑤ 🔴 #39 の統一: 遷移表に無い状態からのレビュー依頼も state.invalid_transition に記録される（F-024 AC-1）', () => {
  const untouchableQueue: GateRunJobQueue = {
    enqueue: async () => {
      throw new Error('422 の経路でキューに触れてはならない');
    },
    removeFailedJob: async () => {
      throw new Error('422 の経路でキューに触れてはならない');
    },
  };

  beforeEach(() => {
    configureGateRunJobQueue(untouchableQueue);
  });

  afterEach(() => {
    resetGateRunJobQueue();
  });

  it.each(['GATE_FAILED', 'APPROVAL_PENDING', 'SUBMITTED', 'WON'] as const)(
    '%s からのレビュー依頼は 422 で、状態不変・state.invalid_transition が { Proposal, %s, GATE_RUNNING } で 1 行',
    async (from) => {
      const id = PROPOSAL_A_HOST;
      await setState(id, from);
      const error = await errorOf(await requestGate(hostSales, id), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');
      await expectUntouched(id, from);
      const logs = await audits(id, 'state.invalid_transition');
      expect(logs).toHaveLength(1);
      expect(logs[0]?.summary).toEqual({ entity: 'Proposal', from, to: 'GATE_RUNNING' });
      expect(logs[0]?.targetType).toBe('Proposal');
    },
  );
});
