// tests/isolation/proposal-gate-api.test.ts
// 🔴 T-07-08 の完了判定を **実 DB（RLS 付き）+ 実 Redis（BullMQ）** で実証する
//    （`docs/sprints/SP-07` §4 T-07-08 / `docs/05` §6.5 #39 / #40 / §9.10 / §11.5 / §11.7）:
//
//   ① `DRAFT → GATE_RUNNING` の CAS と `gate.run` の enqueue（`jobId` は `gateRunJobId`）
//   ② 🔴 **`docs/05` §9.10 の再実行 5 手順**（Issue #16）
//        ①入口は #39 だけ ②failed の同 `jobId` だけを削除 ③`DONE` 行があれば 422
//        ④同じ payload・同じ `jobId` で enqueue ⑤`Proposal` は `GATE_RUNNING` のまま
//   ③ `F-027 AC-5`（HELD の手動再開。状態を `GATE_FAILED` にしない）
//   ④ 🔴 `F-020 AC-2`（`force` / `override` の API が存在しない）
//
// 🔴 通す経路は本番と同じ 1 本である: 実物の Route Handler（`withApiRoute` が組み立てたもの）
//    → ガード → `lib/proposals/gate.ts` → `@ses/db`（RLS + Prisma 拡張）→ `@ses/connectors/bullmq`。
//    差し替えるのは `requireTenantCtx`（T-03-01 が置いた seam）だけで、その戻り値も
//    **`buildTenantCtx` が実 DB から確定した ctx** である。
//
// 🔴 **実 Anthropic API にも実 SES にも接続しない。** 本ファイルはゲートの入口だけを検証し、
//    ゲート本体（`gate.run` のハンドラ）は動かさない（あちらは `tests/isolation/gate-run.test.ts`）。
//    §9.10 ② の「失敗したジョブ」は、**必ず失敗するハンドラ**を付けた実ワーカーで作る ——
//    「failed の記録が残っていると同じ `jobId` の `add` が捨てられる」という BullMQ の仕様が
//    手順の前提であり、偽のキューでは前提そのものを検証できないからである。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateRunJobId } from '@ses/connectors';
import {
  createBullMqGateRunQueue,
  createBullMqGateRunWorker,
  type BullMqGateRunQueue,
  type BullMqGateRunWorker,
} from '@ses/connectors/bullmq';
import {
  completeReviewGate,
  configureTenantDb,
  disconnectTenantDb,
  listReviewGateResults,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-08T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.20' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
// ✅ T-12-14 ②: #40b（履歴）。境界は #40 と同じ結合で固定する（docs/05 §6.5「#40b と `S-023` セクション 4 の設計」検証 ①〜⑤）。
const gateResultsRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate-results/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import(
  '../../apps/web/lib/jobs/gate-run-queue'
);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

const HOST_SALES: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_1_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};
const PARTNER_2_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_2.partnerCompanyId,
  userId: PARTNER_1_2.userId,
};

/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_ID = '01930000-0000-7000-8000-0000000fffff';

const TARGET_TYPE = 'PROPOSAL';

let database: IsolationDatabase;
let redis: IsolationRedis;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let queue: BullMqGateRunQueue;

type ErrorBody = { readonly error: { readonly code: string } };

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
}

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function callRequestGate(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  query = '',
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.POST(
    new Request(`https://app.test/api/proposals/${proposalId}/gate${query}`, { method: 'POST' }),
    segment(proposalId),
  );
}

async function callReadGate(ctx: AuthenticatedTenantCtx, proposalId: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.GET(
    new Request(`https://app.test/api/proposals/${proposalId}/gate`),
    segment(proposalId),
  );
}

/** #40b `GET /api/proposals/{id}/gate-results`（T-12-14 ②）。`query` は「未知のクエリが結果を変えない」の対照に使う。 */
async function callReadGateResults(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  query = '',
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateResultsRoute.GET(
    new Request(`https://app.test/api/proposals/${proposalId}/gate-results${query}`),
    segment(proposalId),
  );
}

/**
 * 応答の `jobId` から内容のハッシュを取り出す（テスト側でハッシュを再実装しない）。
 * 🔴 区切りは `.`（`:` は BullMQ が受け付けない。docs/05 §11.10）。**本番経路はパースしない。**
 */
function hashOfJobId(jobId: string): string {
  const parts = jobId.split('.');
  return parts[parts.length - 1] ?? '';
}

function keyOf(proposalId: string, contentHash: string) {
  return { targetType: TARGET_TYPE, targetId: proposalId, contentHash } as const;
}

async function proposalRow(id: string) {
  return admin.proposal.findUniqueOrThrow({
    where: { id },
    select: { state: true, contentHash: true },
  });
}

async function countEvents(proposalId: string): Promise<number> {
  return admin.proposalEvent.count({ where: { proposalId } });
}

async function auditSummaries(proposalId: string): Promise<Record<string, unknown>[]> {
  const rows = await admin.auditLog.findMany({
    where: { targetId: proposalId, action: 'proposal.update' },
    orderBy: { createdAt: 'asc' },
    select: { summary: true, actorKind: true, actorId: true },
  });
  return rows.map((row) => ({
    ...(row.summary as Record<string, unknown>),
    actorKind: row.actorKind,
    actorId: row.actorId,
  }));
}

/** 対象の提案を「レビュー依頼できる状態」に整える（本文で内容のハッシュを一意にする）。 */
async function prepareProposal(input: {
  readonly id: string;
  readonly state: string;
  readonly body: string;
}): Promise<void> {
  await admin.proposal.update({
    where: { id: input.id },
    data: {
      state: input.state,
      subject: 'ご提案',
      body: input.body,
      contentHash: null,
      approvedAt: null,
      approvedBy: null,
      approvedBySystem: false,
      submittedAt: null,
    },
  });
  await admin.proposalEvent.deleteMany({ where: { proposalId: input.id } });
  await admin.auditLog.deleteMany({ where: { targetId: input.id } });
  await admin.reviewGate.deleteMany({ where: { targetId: input.id } });
}

/** 🔴 待つのは「BullMQ の状態が変わること」だけ（時間ではなく状態を待つ）。 */
async function waitForJobState(
  key: { targetType: string; targetId: string; contentHash: string },
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await queue.jobState(key);
    if (state === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`ジョブの状態が ${expected} になりませんでした（現在: ${String(state)}）。`);
    }
    await delay(100);
  }
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  queue = createBullMqGateRunQueue({ url: redis.url });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  resetGateRunJobQueue();
  await queue?.close();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  configureGateRunJobQueue(queue);
});

afterEach(async () => {
  await setRole(HOST_SALES, 'SALES');
  await setRole(PARTNER_1_USER, 'PARTNER_SALES');
  await setRole(PARTNER_2_USER, 'PARTNER_SALES');
});

describe('#39 レビュー依頼（DRAFT → GATE_RUNNING）', () => {
  it('202 で jobId を返し、状態と内容のハッシュを 1 つのトランザクションで確定させ、gate.run を積む', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'draft-happy-path' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const response = await callRequestGate(ctx, proposalId);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };

    // 🔴 `jobId` は `gateRunJobId`（`@ses/connectors`）が組み立てた形と 1 バイトも違わない。
    const contentHash = hashOfJobId(jobId);
    expect(jobId).toBe(gateRunJobId(keyOf(proposalId, contentHash)));

    const row = await proposalRow(proposalId);
    expect(row.state).toBe('GATE_RUNNING');
    // 🔴 §11.5 手順 1・3: 承認 CAS が突き合わせる列に、検査を依頼した内容が残る。
    expect(row.contentHash).toBe(contentHash);

    // 🔴 状態遷移は `ProposalEvent` に残る（`actorUserId` は依頼した本人）。
    const events = await admin.proposalEvent.findMany({ where: { proposalId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'STATE',
      fromState: 'DRAFT',
      toState: 'GATE_RUNNING',
      actorUserId: TENANT_1.hostUserId,
    });

    // 🔴 監査は `proposal.update` に畳む（独自 action を作らない。docs/05 §16.1）。
    const audits = await auditSummaries(proposalId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      operation: 'GATE_REQUEST',
      contentHash,
      actorKind: 'USER',
      actorId: TENANT_1.hostUserId,
    });

    // 🔴 キューには同じ `jobId` のジョブが待機している。
    expect(await queue.jobState(keyOf(proposalId, contentHash))).toBe('waiting');
  });

  it('🔴 凍結コピー（EngineerSnapshot）が変われば内容のハッシュが変わる（§11.5 の材料）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'draft-snapshot' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const before = hashOfJobId(
      ((await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string }).jobId,
    );

    await admin.engineerSnapshot.create({
      data: {
        tenantId: TENANT_1.tenantId,
        proposalId,
        displayName: '山田 太郎',
        affiliationLabel: null,
        skills: [{ skillId: 's-1', name: 'TypeScript', years: 3, level: 4 }],
        careers: [],
        frozenAt: NOW,
      },
    });
    await admin.proposal.update({ where: { id: proposalId }, data: { state: 'DRAFT' } });

    const after = hashOfJobId(
      ((await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string }).jobId,
    );
    expect(after).not.toBe(before);

    await admin.engineerSnapshot.deleteMany({ where: { proposalId } });
  });
});

describe('🔴 docs/05 §9.10 失敗した gate.run の再実行（5 手順）', () => {
  it('failed の同 jobId を削除してから、同じ payload・同じ jobId で積み直す（状態は GATE_RUNNING のまま）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'draft-job-failed' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const first = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
    const contentHash = hashOfJobId(first.jobId);
    const key = keyOf(proposalId, contentHash);

    // 🔴 実ワーカーで失敗させる（`attempts: 1` なので 1 回で failed に落ちる）。
    const worker: BullMqGateRunWorker = createBullMqGateRunWorker({
      connection: { url: redis.url },
      handler: async () => {
        throw new Error('gate.run は失敗した（§16.5 の JOB_FAILED を作る）');
      },
    });
    try {
      await waitForJobState(key, 'failed');
    } finally {
      await worker.close();
    }

    const eventsBefore = await countEvents(proposalId);

    // ① 入口はテナント利用者の #39 だけ（運営者の retry 操作は存在しない）。
    const response = await callRequestGate(ctx, proposalId);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };

    // ④ 同じ payload・同じ `jobId`。
    expect(jobId).toBe(first.jobId);
    // ② failed を削除したので、同じ `jobId` の `add` が通っている（消さなければ
    //    BullMQ が握り潰し、状態は `failed` のまま = 対象が永久に取り残される）。
    expect(await queue.jobState(key)).toBe('waiting');

    // ⑤ `Proposal` は `GATE_RUNNING` のまま（状態を足さない・遷移も起こさない）。
    const row = await proposalRow(proposalId);
    expect(row.state).toBe('GATE_RUNNING');
    expect(row.contentHash).toBe(contentHash);
    expect(await countEvents(proposalId)).toBe(eventsBefore);

    // 監査には「再実行」であることと理由が残る（`A-005` の滞留検知と突き合わせるため）。
    const audits = await auditSummaries(proposalId);
    expect(audits[audits.length - 1]).toMatchObject({
      operation: 'GATE_RERUN',
      rerunReason: 'JOB_FAILED',
      removedFailedJob: true,
      contentHash,
    });
  });

  it('🔴 waiting / active のジョブは削除しない（走っているものを止めない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'draft-waiting-job' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const first = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
    const key = keyOf(proposalId, hashOfJobId(first.jobId));
    expect(await queue.jobState(key)).toBe('waiting');

    // §9.10 ② の判定そのもの: `waiting` は削除対象ではない。
    expect(await queue.removeFailedJob(key)).toBe('NOT_FAILED');

    // 再依頼しても状態は変わらず、ジョブは 1 本のまま（`jobId` の重複排除で no-op）。
    const again = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
    expect(again.jobId).toBe(first.jobId);
    expect(await queue.jobState(key)).toBe('waiting');
    expect((await proposalRow(proposalId)).state).toBe('GATE_RUNNING');
  });

  it('🔴 同じ内容の DONE 行があれば 422 で、ジョブを積まない（P-A-09。行き止まりを作らない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'draft-done-row' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    // 内容のハッシュだけ先に得る（依頼して状態を進め、そのハッシュで DONE 行を作る）。
    const first = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
    const contentHash = hashOfJobId(first.jobId);
    const key = keyOf(proposalId, contentHash);

    await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: proposalId,
        contentHash,
        execution: 'DONE',
        piiVerdict: 'FAIL',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        aiFailed: false,
        executedAt: NOW,
      },
    });

    const response = await callRequestGate(ctx, proposalId);
    expect(response.status).toBe(422);
    expect(((await response.json()) as ErrorBody).error.code).toBe('GATE_ALREADY_COMPLETED');

    // 🔴 状態は動かない。
    expect((await proposalRow(proposalId)).state).toBe('GATE_RUNNING');

    // 🔴 直前の依頼で積んだジョブを消してから、もう一度 422 を出しても積み直されないことを見る。
    await queue.removeFailedJob(key); // waiting なので消えない（前提の確認）
    const stateBefore = await queue.jobState(key);
    const second = await callRequestGate(ctx, proposalId);
    expect(second.status).toBe(422);
    expect(await queue.jobState(key)).toBe(stateBefore);
  });
});

describe('🔴 F-027 AC-5 AI 上限で保留（HELD）したゲートの手動再実行', () => {
  async function holdGate(proposalId: string, contentHash: string): Promise<void> {
    await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: proposalId,
        contentHash,
        execution: 'HELD_AI_COST_LIMIT',
        heldSince: NOW,
        piiVerdict: null,
        commerceVerdict: null,
        // 🔴 整合層は保留中でも確定している（機械的照合のみで決まる）。
        consistencyVerdict: 'FAIL',
        findings: [
          {
            layer: 'CONSISTENCY',
            kind: 'MUST_REQUIREMENT_MISMATCH',
            field: 'snapshot',
            offsetStart: null,
            offsetEnd: null,
            excerpt: 'TypeScript -/3.0',
            severity: 'BLOCK',
          },
        ],
        aiWarnings: [],
        aiFailed: false,
      },
    });
  }

  it('保留行の内容で同じ jobId を積み直し、Proposal は GATE_RUNNING のまま（GATE_FAILED にしない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'GATE_RUNNING', body: 'held-rerun' });
    const heldHash = 'held-content-hash-1';
    await holdGate(proposalId, heldHash);
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const response = await callRequestGate(ctx, proposalId);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };

    // 🔴 `gate.hold-release`（自動）と**同じ payload・同じ jobId**（3 段の重複排除が効く）。
    expect(jobId).toBe(gateRunJobId(keyOf(proposalId, heldHash)));
    expect(await queue.jobState(keyOf(proposalId, heldHash))).toBe('waiting');

    // 🔴 状態は `GATE_RUNNING` のまま。`GATE_FAILED` にしない（保留は元データの欠陥ではない）。
    expect((await proposalRow(proposalId)).state).toBe('GATE_RUNNING');
    expect(await countEvents(proposalId)).toBe(0);

    const audits = await auditSummaries(proposalId);
    expect(audits[audits.length - 1]).toMatchObject({
      operation: 'GATE_RERUN',
      rerunReason: 'HELD_AI_COST_LIMIT',
      contentHash: heldHash,
    });
    // 🔴 保留の再開では失敗ジョブの削除を行わない（消す対象が無い）。
    expect(audits[audits.length - 1]).not.toHaveProperty('removedFailedJob');
  });

  it('#40 は HELD を 3 値のまま返し、再開時刻と保持済みの整合層の結果を返す（2 値に潰さない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'GATE_RUNNING', body: 'held-view' });
    await holdGate(proposalId, 'held-content-hash-2');
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const response = await callReadGate(ctx, proposalId);
    expect(response.status).toBe(200);
    const view = (await response.json()) as {
      execution: string;
      layers: { pii: { state: string }; commerce: { state: string }; consistency: { state: string; findings: unknown[] } };
      held?: { heldReasonKey: string; heldSince: string; resetAt: string; limitRaise: string; rerun: { auto: boolean; manual: string } };
      contentHash: string;
    };

    expect(view.execution).toBe('HELD_AI_COST_LIMIT');
    // 🔴 PII / 商流は未実行（`HELD`）。`PASS` にも `FAIL` にも倒れていない。
    expect(view.layers.pii.state).toBe('HELD');
    expect(view.layers.commerce.state).toBe('HELD');
    // 🔴 整合層は確定しており、指摘も保持されている（上限解除後の再実行に使われる）。
    expect(view.layers.consistency.state).toBe('FAIL');
    expect(view.layers.consistency.findings).toHaveLength(1);
    expect(view.contentHash).toBe('held-content-hash-2');

    expect(view.held?.heldReasonKey).toBe('gate.held.aiCostLimit');
    expect(view.held?.limitRaise).toBe('PLATFORM_OPERATOR');
    expect(view.held?.rerun).toEqual({ auto: true, manual: 'POST /api/proposals/{id}/gate' });
    // 🔴 `heldSince` は**最初に保留した時刻**（再保留で上書きしない。`A-005` の滞留検知の根拠）。
    expect(view.held?.heldSince).toBe(NOW.toISOString());
    // 🔴 リセットは JST の翌 0 時（`usagePeriodResetAt`。UTC では 15:00）。まだ来ていない。
    expect(view.held?.resetAt.endsWith('T15:00:00.000Z')).toBe(true);
    expect(new Date(view.held?.resetAt ?? 0).getTime()).toBeGreaterThan(Date.now());
    // 🔴 金額（USD）を 1 つも載せない（`F-027 AC-6`）。
    expect(JSON.stringify(view).toLowerCase()).not.toContain('usd');
  });
});

describe('#40 ゲート結果の読み出し', () => {
  it('行がまだ無ければ RUNNING と現在の内容のハッシュを返す（行の非存在がそのまま RUNNING）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'view-running' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const view = (await (await callReadGate(ctx, proposalId)).json()) as {
      execution: string;
      layers: { pii: { state: string } };
      contentHash: string;
    };
    expect(view.execution).toBe('RUNNING');
    expect(view.layers.pii.state).toBe('RUNNING');

    // 依頼したときの `jobId` のハッシュと一致する（同じ 1 実装から出ている）。
    const { jobId } = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
    expect(hashOfJobId(jobId)).toBe(view.contentHash);
  });

  it('確定した結果は層ごとに返る（F-020 AC-7）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'GATE_FAILED', body: 'view-done' });
    await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: proposalId,
        contentHash: 'done-content-hash',
        execution: 'DONE',
        piiVerdict: 'FAIL',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [
          {
            layer: 'PII',
            kind: 'PII_NAME',
            field: 'body',
            offsetStart: 0,
            offsetEnd: 5,
            excerpt: '[名前]',
            severity: 'BLOCK',
          },
        ],
        aiWarnings: [
          {
            layer: 'CONSISTENCY',
            kind: 'AI_WARNING',
            field: 'body',
            offsetStart: null,
            offsetEnd: null,
            excerpt: '要確認',
            severity: 'WARN',
          },
        ],
        aiFailed: false,
        executedAt: NOW,
      },
    });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const view = (await (await callReadGate(ctx, proposalId)).json()) as {
      execution: string;
      layers: { pii: { state: string; findings: unknown[] }; commerce: { state: string }; consistency: { state: string } };
      aiWarnings: unknown[];
      held?: unknown;
    };
    expect(view.execution).toBe('DONE');
    expect(view.layers.pii.state).toBe('FAIL');
    expect(view.layers.pii.findings).toHaveLength(1);
    expect(view.layers.commerce.state).toBe('PASS');
    expect(view.layers.consistency.state).toBe('PASS');
    // 🔴 警告は指摘と別のフィールドに載る（合否に効かない）。
    expect(view.aiWarnings).toHaveLength(1);
    expect(view.held).toBeUndefined();
  });
});

describe('🔴 状態と認可（docs/05 §6.5 #39 / §9.10 ①）', () => {
  it.each(['GATE_FAILED', 'APPROVAL_PENDING', 'WON'])(
    '%s からはレビュー依頼できない（422。遷移表に無い）',
    async (state) => {
      const proposalId = TENANT_1.hostProposalId;
      await prepareProposal({ id: proposalId, state, body: `state-${state}` });
      const ctx = await ctxOf(HOST_SALES, 'SALES');

      const response = await callRequestGate(ctx, proposalId);
      expect(response.status).toBe(422);
      expect(((await response.json()) as ErrorBody).error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await proposalRow(proposalId)).state).toBe(state);
    },
  );

  it('🔴 F-020 AC-2: `?force=true` を付けても結果は 1 バイトも変わらない（入力が存在しない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'GATE_FAILED', body: 'force-ignored' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const plain = await callRequestGate(ctx, proposalId);
    const forced = await callRequestGate(ctx, proposalId, '?force=true&override=1');
    expect(forced.status).toBe(plain.status);
    expect(await forced.text()).toBe(await plain.text());
    expect((await proposalRow(proposalId)).state).toBe('GATE_FAILED');
  });

  it('🔴 VIEWER は実行できない（BR-31 / F-004 AC-6）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'viewer' });
    const ctx = await ctxOf(HOST_SALES, 'VIEWER');

    const response = await callRequestGate(ctx, proposalId);
    expect(response.status).toBe(403);
    expect((await proposalRow(proposalId)).state).toBe('DRAFT');
  });

  it('🔴 取引先の非作成者は 403、作成者は 202（入口は「作成者 / ホストの営業・管理者」）', async () => {
    const proposalId = PARTNER_1_1.wonProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'partner-created' });

    // 同じ取引先の別の担当者に見立てて、作成者を別人にする。
    await admin.proposal.update({
      where: { id: proposalId },
      data: { createdBy: TENANT_1.hostUserId },
    });
    const partnerCtx = await ctxOf(PARTNER_1_USER, 'PARTNER_SALES');
    const denied = await callRequestGate(partnerCtx, proposalId);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as ErrorBody).error.code).toBe('PROPOSAL_GATE_FORBIDDEN');

    // 作成者に戻すと同じ利用者が依頼できる。
    await admin.proposal.update({
      where: { id: proposalId },
      data: { createdBy: PARTNER_1_1.userId },
    });
    const allowed = await callRequestGate(partnerCtx, proposalId);
    expect(allowed.status).toBe(202);
    expect((await proposalRow(proposalId)).state).toBe('GATE_RUNNING');
  });

  it('🔴 他社・他テナントの提案は「存在しない」と同じ 404（§4.8）', async () => {
    const partner2Ctx = await ctxOf(PARTNER_2_USER, 'PARTNER_SALES');
    const hostCtx = await ctxOf(HOST_SALES, 'SALES');

    // ① 同一テナント内の他社の提案（第二境界）
    const crossPartner = await callRequestGate(partner2Ctx, PARTNER_1_1.wonProposalId);
    // ② 他テナントの提案（第一境界）
    const crossTenant = await callRequestGate(hostCtx, TENANT_2.hostProposalId);
    // ③ 実在しない ID
    const absent = await callRequestGate(hostCtx, ABSENT_ID);

    expect(crossPartner.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(absent.status).toBe(404);
    // 🔴 本文まで 1 バイト同じ（応答の差から存在を推測させない）。
    const absentBody = await absent.text();
    expect(await crossPartner.text()).toBe(absentBody);
    expect(await crossTenant.text()).toBe(absentBody);

    // #40（読み取り）も同じ（ゲート結果の有無から存在を推測させない）。
    const readCross = await callReadGate(partner2Ctx, PARTNER_1_1.wonProposalId);
    const readAbsent = await callReadGate(partner2Ctx, ABSENT_ID);
    expect(readCross.status).toBe(404);
    expect(await readCross.text()).toBe(await readAbsent.text());
  });
});

describe('🔴 #40b ゲート結果の履歴（T-12-14 ②。docs/05 §6.5「#40b と S-023 セクション 4 の設計」検証 ①〜⑤ / F-020 AC-7）', () => {
  type HistoryItem = {
    reviewGateId: string;
    execution: string;
    executedAt: string | null;
    heldSince: string | null;
    matchesCurrentContent: boolean;
    contentHash: string;
    layers: Record<'pii' | 'commerce' | 'consistency', { state: string; findings: unknown[] }>;
    aiWarnings: unknown[];
    aiFailed: boolean;
    held?: { heldReasonKey: string; heldSince: string; resetAt: string; limitRaise: string; rerun: { auto: boolean; manual: string } };
  };
  type HistoryBody = { items: HistoryItem[] };

  /**
   * 🔴 確定行は **`gate.run` が結果を書くのと同じ関数**（`completeReviewGate`。`SystemTenantCtx`）で作る。
   *    ゲート本体（AI）は動かさないが、書き込み側の 1 実装を通すことで「履歴の行の形」を本番経路と同じにする。
   */
  async function completeGate(input: {
    readonly proposalId: string;
    readonly contentHash: string;
    readonly executedAt: Date;
    readonly piiVerdict?: 'PASS' | 'FAIL';
    readonly aiFailed?: boolean;
  }): Promise<string> {
    const outcome = await completeReviewGate(
      systemTenantCtx(TENANT_1.tenantId, { queue: 'gate.run', jobId: `t1214-${input.contentHash}` }),
      {
        targetType: TARGET_TYPE,
        targetId: input.proposalId,
        contentHash: input.contentHash,
        piiVerdict: input.piiVerdict ?? 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings:
          input.piiVerdict === 'FAIL'
            ? [{ layer: 'PII', kind: 'FULL_NAME', field: 'body', offsetStart: 0, offsetEnd: 5, excerpt: '[名前]', severity: 'BLOCK' }]
            : [],
        aiWarnings: [
          { layer: 'CONSISTENCY', kind: 'SKILL_SHEET_MISMATCH', field: 'body', offsetStart: null, offsetEnd: null, excerpt: '要確認', severity: 'WARN' },
        ],
        aiFailed: input.aiFailed ?? false,
        role: 'gate-inspector',
        promptVersion: 'v1',
        modelId: 'mock',
        aiUsageId: null,
        executedAt: input.executedAt,
      },
    );
    if (outcome.kind === 'RACED') throw new Error('前提の破綻: 保留行が無いのに RACED になりました。');
    return outcome.id;
  }

  async function readHistory(ctx: AuthenticatedTenantCtx, proposalId: string): Promise<HistoryBody> {
    const response = await callReadGateResults(ctx, proposalId);
    expect(response.status).toBe(200);
    return (await response.json()) as HistoryBody;
  }

  it('① 内容を変えて 2 回実行すると 2 行が降順で返り、新しい行だけ matchesCurrentContent、古い行の contentHash が残る（上書きしない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'history-two-runs' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    // 現在の内容のハッシュ（#39 の `jobId` から。#40 が `RUNNING` のときに返す値と同じ 1 実装）。
    const { jobId } = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
    const currentHash = hashOfJobId(jobId);
    // 以前の内容のハッシュ（値は任意。現在の内容と一致しないことだけが要件）。
    const olderHash = 'history-two-runs-older-content';

    // 1 回目 = 以前の内容（PII で FAIL）。2 回目 = 現在の内容（PASS）。
    const olderId = await completeGate({ proposalId, contentHash: olderHash, executedAt: new Date(NOW.getTime() - 60 * 60 * 1000), piiVerdict: 'FAIL' });
    const newerId = await completeGate({ proposalId, contentHash: currentHash, executedAt: NOW });
    expect(newerId).not.toBe(olderId);

    const { items } = await readHistory(ctx, proposalId);
    expect(items).toHaveLength(2);
    // 🔴 降順（新しい実行が先）。
    expect(items.map((item) => item.reviewGateId)).toEqual([newerId, olderId]);
    expect(items[0]).toMatchObject({ execution: 'DONE', executedAt: NOW.toISOString(), heldSince: null, matchesCurrentContent: true, contentHash: currentHash });
    // 🔴 古い行は上書きされず、`contentHash` も層別の結果も**そのまま**残る（`F-020 AC-7`）。
    expect(items[1]).toMatchObject({ execution: 'DONE', heldSince: null, matchesCurrentContent: false, contentHash: olderHash });
    expect(items[1]?.layers.pii.state).toBe('FAIL');
    expect(items[1]?.layers.pii.findings).toHaveLength(1);
    expect(items[0]?.layers.pii.state).toBe('PASS');
    // 🔴 警告は指摘と別のフィールド（合否に効かない）。`held` は DONE 行に無い。
    expect(items[0]?.aiWarnings).toHaveLength(1);
    expect(items[0]?.held).toBeUndefined();
    expect(items[1]?.held).toBeUndefined();

    // #40（最新 1 件）と #40b の先頭は同じ行 = 母集団が 1 実装であることの対照。
    const latest = (await (await callReadGate(ctx, proposalId)).json()) as { execution: string; contentHash: string };
    expect(latest).toMatchObject({ execution: 'DONE', contentHash: currentHash });

    // 🔴 応答に主体・提案先・`GateInput` の材料（本文・件名）のキーが無い（§11.14。指摘の `field: "body"` は欄の名前であり本文ではない）。
    const text = JSON.stringify(items);
    expect(text).not.toMatch(/"(owner|recipient|actor|createdBy|subject|body)":/);
    expect(text.toLowerCase()).not.toContain('usd');
  });

  it('② HELD 行がある提案は先頭が HELD_AI_COST_LIMIT + held、DONE 行の held は undefined', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'GATE_RUNNING', body: 'history-held' });
    // 以前の内容の確定行（1 時間前）+ 現在の内容で保留中（上限到達）。
    const doneId = await completeGate({ proposalId, contentHash: 'history-held-old', executedAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
    const held = await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: proposalId,
        contentHash: 'history-held-current',
        execution: 'HELD_AI_COST_LIMIT',
        heldSince: NOW,
        piiVerdict: null,
        commerceVerdict: null,
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        aiFailed: false,
      },
      select: { id: true },
    });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const { items } = await readHistory(ctx, proposalId);
    expect(items.map((item) => item.reviewGateId)).toEqual([held.id, doneId]);
    expect(items[0]).toMatchObject({
      execution: 'HELD_AI_COST_LIMIT',
      executedAt: null,
      heldSince: NOW.toISOString(),
      layers: { pii: { state: 'HELD' }, commerce: { state: 'HELD' }, consistency: { state: 'PASS' } },
    });
    // 🔴 `held` は #40 と同じ `GateHeldView`（金額は無い）。
    expect(items[0]?.held).toMatchObject({ heldReasonKey: 'gate.held.aiCostLimit', heldSince: NOW.toISOString(), limitRaise: 'PLATFORM_OPERATOR', rerun: { auto: true, manual: 'POST /api/proposals/{id}/gate' } });
    expect(items[0]?.held?.resetAt.endsWith('T15:00:00.000Z')).toBe(true);
    expect(items[1]).toMatchObject({ execution: 'DONE', heldSince: null });
    expect(items[1]?.held).toBeUndefined();
    expect(JSON.stringify(items).toLowerCase()).not.toContain('usd');
  });

  it('🔴 ③ 取引先 A1 が他社（A2）の提案 / テナント B の提案 / 不存在 ID で叩くと同じ 404（本文まで #40 と同一）。自社提案は 200', async () => {
    // 他社（A2）の提案にも履歴の行を置く（「行が無いから 404」ではなく「見えないから 404」であることの対照）。
    await prepareProposal({ id: PARTNER_1_2.wonProposalId, state: 'GATE_FAILED', body: 'history-boundary-a2' });
    await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: PARTNER_1_2.wonProposalId,
        contentHash: 'history-boundary-a2',
        execution: 'DONE',
        piiVerdict: 'FAIL',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        aiFailed: false,
        executedAt: NOW,
      },
    });
    // 自社（A1）の提案（作成者は A1 の利用者。seed のまま）。
    await prepareProposal({ id: PARTNER_1_1.wonProposalId, state: 'GATE_FAILED', body: 'history-boundary-a1' });
    await admin.proposal.update({ where: { id: PARTNER_1_1.wonProposalId }, data: { createdBy: PARTNER_1_1.userId } });
    await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: PARTNER_1_1.wonProposalId,
        contentHash: 'history-boundary-a1',
        execution: 'DONE',
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        aiFailed: false,
        executedAt: NOW,
      },
    });
    const partner1Ctx = await ctxOf(PARTNER_1_USER, 'PARTNER_SALES');

    const crossPartner = await callReadGateResults(partner1Ctx, PARTNER_1_2.wonProposalId);
    const crossTenant = await callReadGateResults(partner1Ctx, TENANT_2.hostProposalId);
    const absent = await callReadGateResults(partner1Ctx, ABSENT_ID);
    expect(crossPartner.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(absent.status).toBe(404);
    // 🔴 本文まで 1 バイト同じ（応答の差から存在を推測させない）。#40 の 404 とも同一。
    const absentBody = await absent.text();
    expect(await crossPartner.text()).toBe(absentBody);
    expect(await crossTenant.text()).toBe(absentBody);
    expect(await (await callReadGate(partner1Ctx, ABSENT_ID)).text()).toBe(absentBody);
    expect(await (await callReadGate(partner1Ctx, PARTNER_1_2.wonProposalId)).text()).toBe(absentBody);
    // 🔴 他社の行の `contentHash` が 1 バイトも現れない（404 の本文にも）。
    expect(absentBody).not.toContain('history-boundary-a2');

    // 自社の提案は 200 で、自社の行だけ（他社の行が混ざらない）。
    const own = await readHistory(partner1Ctx, PARTNER_1_1.wonProposalId);
    expect(own.items).toHaveLength(1);
    expect(own.items[0]?.contentHash).toBe('history-boundary-a1');
    expect(JSON.stringify(own)).not.toContain('history-boundary-a2');

    // 🔴 VIEWER も読める（#40 の GET と同じガード。読み取りに `requireNotViewer` を掛けない）。
    const viewerCtx = await ctxOf(HOST_SALES, 'VIEWER');
    expect((await callReadGateResults(viewerCtx, PARTNER_1_1.wonProposalId)).status).toBe(200);
  });

  it('🔴 [中] アクセサ自身の境界: listReviewGateResults はテナント B の ctx では他テナントの行を返さない（loadTarget を経由せず直接呼ぶ。第 2 防御）', async () => {
    // 🔴 `loadTarget` の 404 に頼らず、アクセサ自身に述語が効いていることを直接確認する
    //    （HTTP 経由の境界テストは `loadTarget` が先に 404 を返すため、この関数の `where` が
    //    空でも全テストが通ってしまう）。
    await admin.reviewGate.create({
      data: {
        tenantId: TENANT_1.tenantId,
        targetType: TARGET_TYPE,
        targetId: TENANT_1.hostProposalId,
        contentHash: 'history-accessor-boundary-tenant',
        execution: 'DONE',
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        aiFailed: false,
        executedAt: NOW,
      },
    });
    // 🔴 既定のロール（seed の `SALES`）のまま ctx を作る。役割を書き換えないので afterEach の
    //    リセット対象（HOST_SALES / PARTNER_1_USER / PARTNER_2_USER）に加える必要が無い。
    const tenant2Ctx = await ctxOf(
      { tenantId: TENANT_2.tenantId, partnerCompanyId: null, userId: TENANT_2.hostUserId },
      'SALES',
    );

    const rows = await listReviewGateResults(tenant2Ctx, {
      targetType: TARGET_TYPE,
      targetId: TENANT_1.hostProposalId,
    });
    expect(rows).toEqual([]);
  });

  it('🔴 [中] アクセサ自身の境界: listReviewGateResults は取引先 A1 の ctx では他社（A2）の行を返さない（loadTarget を経由せず直接呼ぶ。第 2 防御）', async () => {
    // 検証 ③ で PARTNER_1_2（A2）の提案に作った行（contentHash: 'history-boundary-a2'）をそのまま使う。
    const partner1Ctx = await ctxOf(PARTNER_1_USER, 'PARTNER_SALES');

    const rows = await listReviewGateResults(partner1Ctx, {
      targetType: TARGET_TYPE,
      targetId: PARTNER_1_2.wonProposalId,
    });
    expect(rows).toEqual([]);
  });

  it('④ 一度も依頼していない DRAFT は items: []（404 にしない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'DRAFT', body: 'history-never' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const { items } = await readHistory(ctx, proposalId);
    expect(items).toEqual([]);
    // 対照: #40 は同じ提案で `RUNNING`（行の非存在 = 実行中）。
    expect(((await (await callReadGate(ctx, proposalId)).json()) as { execution: string }).execution).toBe('RUNNING');
  });

  it('🔴 ⑤ `?force=true` 等の未知のクエリが 1 バイトも結果を変えない（入力が存在しない）', async () => {
    const proposalId = TENANT_1.hostProposalId;
    await prepareProposal({ id: proposalId, state: 'GATE_FAILED', body: 'history-query' });
    await completeGate({ proposalId, contentHash: 'history-query-1', executedAt: NOW, piiVerdict: 'FAIL' });
    const ctx = await ctxOf(HOST_SALES, 'SALES');

    const plain = await callReadGateResults(ctx, proposalId);
    const forced = await callReadGateResults(ctx, proposalId, '?force=true&override=1&history=0&limit=0');
    expect(plain.status).toBe(200);
    expect(forced.status).toBe(200);
    expect(await forced.text()).toBe(await plain.text());
  });

  it('履歴のルートが export するのは GET だけ（履歴を書き換える経路が無い。F-020 AC-7）', () => {
    const exported = Object.keys(gateResultsRoute).filter((name) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(name));
    expect(exported).toEqual(['GET']);
  });
});

describe('🔴 F-020 AC-2 / docs/05 §6.8「作らないもの」', () => {
  const gateDir = path.join(repoRoot, 'apps', 'web', 'app', 'api', '(main)', 'proposals');

  it('proposals 配下に override / force のルートが 1 つも存在しない', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/^route\.tsx?$/.test(entry.name)) found.push(path.relative(repoRoot, full));
      }
    };
    walk(gateDir);

    expect(found.length).toBeGreaterThan(0);
    for (const file of found) {
      expect(file.toLowerCase()).not.toContain('override');
      expect(file.toLowerCase()).not.toContain('force');
    }
  });

  it('ゲートのルートが export するのは POST と GET だけ（PUT / PATCH / DELETE を持たない）', () => {
    const exported = Object.keys(gateRoute).filter((name) =>
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(name),
    );
    expect(exported.sort()).toEqual(['GET', 'POST']);
  });
});
