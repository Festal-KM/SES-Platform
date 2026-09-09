// tests/isolation/gate-hold-release.test.ts
// 🔴 T-07-10 の完了判定（docs/sprints/SP-07 §4 T-07-10 / docs/05 §17.3 の **E2E #23 の前半**）を
//    **実 DB（RLS 付き）+ 実 Redis（BullMQ）+ 実ワーカー**で通す:
//
//   上限到達中にレビュー依頼（#39）→ `gate.run` が **HELD**（`GATE_FAILED` にならない）
//     → 承認・送信の前提（`execution='DONE'` かつ 3 層 PASS）を満たさない
//     → 上限が解除される（JST の翌 0 時に日次の枠が変わる）
//     → `gate.hold-release` が**自動で**同じ payload・同じ `jobId` で積み直す
//     → ワーカーが実行して **DONE**（🔴 行は増えず、遷移は 1 回）
//
// 🔴 **上限は「テスト用の小さな値」で作らない。** 本番と同じ経路（`reserveAiCost`）で
//    その日の枠を予約して埋める —— 上限に当たる状況は「同じテナントの別の AI 呼び出しが
//    先に枠を使った」ときに起きるものであり、**本番に穴を開ける迂回路を用意しない**
//    （docs/05 §7.6 / SP-07 T-07-04）。解除も同じで、**日付を翌日に進める**だけである
//    （枠のリセットは `usagePeriodKey('DAY', now)` が決める暦そのもの）。
//
// 🔴 **実 Anthropic API に接続しない**（`createAiClient('mock', …)`。docs/05 §17.5）。
//    モックは `MockAnthropicClient` の 1 実装だけであり、テスト専用の別モックを書かない。
//
// 🔴 通す経路は本番と同じ 1 本である:
//    #39（実物の Route Handler）→ `@ses/connectors/bullmq` の `Queue`
//      → 実 `Worker` → `apps/worker` の `gate.run` ハンドラ → `@ses/db`（RLS + Prisma 拡張）
//    `gate.hold-release` も同じハンドラ実体（`apps/worker/src/jobs/gate-hold-release.ts`）を呼ぶ。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import { gateRunJobId } from '@ses/connectors';
import {
  createBullMqGateRunQueue,
  createBullMqGateRunWorker,
  type BullMqGateRunQueue,
  type BullMqGateRunWorker,
} from '@ses/connectors/bullmq';
import {
  configureTenantDb,
  disconnectTenantDb,
  findPassedReviewGate,
  reserveAiCost,
  systemTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import {
  createGateHoldReleaseHandler,
  GATE_HOLD_RELEASE_JOB,
  type GateHoldReleaseOutcome,
} from '../../apps/worker/src/jobs/gate-hold-release.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-09 12:00。 */
const NOW_DAY1 = new Date('2026-09-09T03:00:00.000Z');
/** 🔴 **翌日**（JST 2026-09-10 12:00）。日次の枠はここで新しい行になる ＝ 上限の解除。 */
const NOW_DAY2 = new Date('2026-09-10T03:00:00.000Z');

const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
/** テナントの 1 日の AI コスト上限（`packages/config` の既定値に相当する現実的な値）。 */
const AI_DAILY_LIMIT_USD = '5.000000';
/**
 * その日の枠をほぼ使い切る予約（$2/MTok × 2.49M ≒ $4.98）。
 * 🔴 残り $0.02 は `gate-inspector` 1 回ぶんの下限（出力 4,096 トークンだけで $0.04 を超える）に
 *    届かないため、次の呼び出しは**予約できない** = LLM を呼ばずに保留になる。
 */
const NEARLY_ALL_INPUT_TOKENS = 2_490_000;

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];

const HOST_SALES: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};

const TARGET_TYPE = 'PROPOSAL';

/** `gate-inspector` が「何も見つけなかった」ときの応答（スキーマ適合）。 */
const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => ({ deviceKind: 'api', ipAddress: '203.0.113.20' }) as const,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import(
  '../../apps/web/lib/jobs/gate-run-queue'
);

let database: IsolationDatabase;
let redis: IsolationRedis;
/** 🔴 前提づくりと事実確認だけに使う特権接続（検証のクエリには使わない）。 */
let admin: UnextendedClient;
let queue: BullMqGateRunQueue;
/** ワーカーが読む「現在時刻」。テストが日をまたぐので可変にする。 */
let workerNow: Date = NOW_DAY1;

const models = catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU });

// ---------------------------------------------------------------------------
// ヘルパ
// ---------------------------------------------------------------------------

function keyOf(targetId: string, contentHash: string) {
  return { targetType: TARGET_TYPE, targetId, contentHash } as const;
}

/** 応答の `jobId` から内容のハッシュを取り出す（テスト側でハッシュを再実装しない）。 */
function hashOfJobId(jobId: string): string {
  const parts = jobId.split('.');
  return parts[parts.length - 1] ?? '';
}

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function callRequestGate(ctx: AuthenticatedTenantCtx, proposalId: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.POST(new Request(`https://app.test/api/proposals/${proposalId}/gate`, { method: 'POST' }), {
    params: Promise.resolve({ id: proposalId }),
  });
}

async function callReadGate(ctx: AuthenticatedTenantCtx, proposalId: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.GET(new Request(`https://app.test/api/proposals/${proposalId}/gate`), {
    params: Promise.resolve({ id: proposalId }),
  });
}

/** レビュー依頼できる状態に整える（本文・凍結コピー・台帳の PII）。 */
async function prepareProposal(input: { readonly proposalId: string; readonly body: string }): Promise<void> {
  await admin.proposal.update({
    where: { id: input.proposalId },
    data: {
      state: 'DRAFT',
      subject: 'ご提案',
      body: input.body,
      contentHash: null,
      approvedAt: null,
      approvedBy: null,
      approvedBySystem: false,
      submittedAt: null,
    },
  });
  // 🔴 凍結コピーが無いと `gate.run` は `GateFactsUnavailableError` で落ちる（§11.10 ⑩-4）。
  //    スキルの主張を空にして、整合層が PASS になる状態にする（本タスクが見るのは保留と復帰である）。
  await admin.engineerSnapshot.upsert({
    where: { proposalId: input.proposalId },
    create: {
      id: randomUUID(),
      tenantId: TENANT_1.tenantId,
      proposalId: input.proposalId,
      displayName: '凍結された氏名',
      affiliationLabel: null,
      skills: [],
      careers: [],
      frozenAt: NOW_DAY1,
    },
    update: { skills: [] },
  });
  await admin.proposalEvent.deleteMany({ where: { proposalId: input.proposalId } });
  await admin.auditLog.deleteMany({ where: { targetId: input.proposalId } });
  await admin.reviewGate.deleteMany({ where: { targetId: input.proposalId } });
}

/**
 * 🔴 その日の AI 枠を**本番と同じ経路で**埋める（`reserveAiCost`）。
 *
 * 補正（`settleAiCost`）を行わないので、予約は「呼び出し中のもの」として残り続ける ——
 * これは docs/05 §7.12 ②が「当日中は解放しない」と決めた挙動そのものであり、
 * **翌 0 時（JST）に日付が変わることでのみ解ける**。
 */
async function reserveNearlyAllBudget(tenantId: string, at: Date): Promise<void> {
  const outcome = await reserveAiCost(systemTenantCtx(tenantId, { queue: 'gate.run', jobId: 'setup' }), {
    modelId: SONNET,
    estimatedInputTokens: NEARLY_ALL_INPUT_TOKENS,
    maxOutputTokens: 0,
    limitUsd: AI_DAILY_LIMIT_USD,
    now: at,
  });
  if (outcome.kind !== 'RESERVED') {
    throw new Error('前提の破綻: その日の枠を予約できませんでした。');
  }
}

async function proposalState(proposalId: string): Promise<string> {
  const row = await admin.proposal.findUniqueOrThrow({ where: { id: proposalId }, select: { state: true } });
  return row.state;
}

async function gateRow(targetId: string) {
  return admin.reviewGate.findFirst({ where: { targetId }, orderBy: { id: 'desc' } });
}

/** 🔴 承認 CAS と送信の事前判定が見るのと**同じ 1 実装**（docs/05 §11.11 ⑪-2）。 */
async function passedGate(targetId: string): Promise<{ id: string } | null> {
  const ctx = systemTenantCtx(TENANT_1.tenantId, { queue: 'gate.run', jobId: 'assert' });
  return withTenant(ctx, async (db) => findPassedReviewGate(db, { targetType: TARGET_TYPE, targetId }));
}

/** 🔴 待つのは「BullMQ の状態が変わること」だけ（時間ではなく状態を待つ）。 */
async function waitForJobState(key: ReturnType<typeof keyOf>, expected: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = await queue.jobState(key);
    if (state === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`ジョブの状態が ${expected} になりませんでした（現在: ${String(state)}）。`);
    }
    await delay(100);
  }
}

/** 🔴 待つのは「DB の事実が変わること」だけ（時間ではなく状態を待つ）。 */
async function waitForExecution(targetId: string, expected: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const row = await gateRow(targetId);
    if (row?.execution === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`ReviewGate.execution が ${expected} になりませんでした（現在: ${String(row?.execution)}）。`);
    }
    await delay(100);
  }
}

/**
 * 実ワーカー（`gate.run`）を起動して `fn` を実行し、必ず止める。
 *
 * 🔴 ハンドラは `apps/worker` の実体（`createGateRunHandler`）であり、
 *    キューの実体化は `@ses/connectors/bullmq` の 1 ファイルを通る（§17.2 #6 ⑤）。
 */
async function withGateWorker<T>(at: Date, fn: () => Promise<T>): Promise<T> {
  workerNow = at;
  const handler = createGateRunHandler({
    now: () => workerNow,
    aiClient: createAiClient('mock', { mock: { script: [{ kind: 'output', output: CLEAN_OUTPUT }] } }),
    models,
    aiDailyCostLimitUsd: AI_DAILY_LIMIT_USD,
  });
  const worker: BullMqGateRunWorker = createBullMqGateRunWorker({
    connection: { url: redis.url },
    handler,
  });
  try {
    return await fn();
  } finally {
    await worker.close();
  }
}

/** `gate.hold-release` を 1 回実行する（本番と同じハンドラ実体）。 */
async function runHoldRelease(tenantId: string, at: Date): Promise<GateHoldReleaseOutcome> {
  const handler = createGateHoldReleaseHandler({
    now: () => at,
    models,
    aiDailyCostLimitUsd: AI_DAILY_LIMIT_USD,
    enqueueGateRun: (job) => queue.enqueue(job),
  });
  return handler({ tenantId }, `${GATE_HOLD_RELEASE_JOB}:${at.toISOString()}`);
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW_DAY1,
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

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  configureGateRunJobQueue(queue);
  workerNow = NOW_DAY1;
  // 🔴 前のテストが積んだ枠・記録を持ち越さない（枠が残ると「上限に当たらない」で緑になる）。
  await admin.reviewGate.deleteMany({ where: { targetId: TENANT_1.hostProposalId } });
  await admin.reviewGate.deleteMany({ where: { targetId: TENANT_2.hostProposalId } });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_' } } });
});

describe('🔴 F-027 AC-5 / E2E #23 前半: AI の日次コスト上限による保留と自動復帰', () => {
  it(
    '上限到達中のレビュー依頼は HELD になり（GATE_FAILED にならない）、解除後に gate.hold-release が自動で DONE にする',
    async () => {
      const proposalId = TENANT_1.hostProposalId;
      await prepareProposal({ proposalId, body: '清潔な本文です。ご検討ください。' });
      await reserveNearlyAllBudget(TENANT_1.tenantId, NOW_DAY1);

      // ① レビュー依頼（#39）。上限に達していても**依頼そのものは通る**（202）。
      const ctx = await ctxOf(HOST_SALES, 'SALES');
      const response = await callRequestGate(ctx, proposalId);
      expect(response.status).toBe(202);
      const { jobId } = (await response.json()) as { jobId: string };
      const key = keyOf(proposalId, hashOfJobId(jobId));

      // ② ワーカーが実行 → 🔴 予約できないので LLM を呼ばず、保留として保存する。
      await withGateWorker(NOW_DAY1, () => waitForExecution(proposalId, 'HELD_AI_COST_LIMIT'));

      // 🔴 対象は `GATE_RUNNING` のまま。**`GATE_FAILED` にしない**（元データの欠陥ではない）。
      expect(await proposalState(proposalId)).toBe('GATE_RUNNING');
      const held = await gateRow(proposalId);
      expect(held).toMatchObject({
        execution: 'HELD_AI_COST_LIMIT',
        piiVerdict: null,
        commerceVerdict: null,
        // 🔴 整合層（機械的照合）は動いており、その結果は保持されている。
        consistencyVerdict: 'PASS',
        aiFailed: false,
      });
      expect(held?.heldSince).not.toBeNull();
      // 🔴 LLM を 1 回も呼んでいない（予約に失敗した時点で止まる）。
      expect(await admin.aiUsage.count({ where: { tenantId: TENANT_1.tenantId } })).toBe(0);
      // 🔴 ジョブは**正常終了**している（`removeOnComplete: true` で消える ＝ failed に残らない）。
      //    失敗ジョブ数（§16.5）にもゲート FAIL 率（`F-059`）にも計上されない。
      expect(await queue.jobState(key)).toBeNull();

      // 🔴 承認・送信の前提（`execution='DONE'` かつ 3 層 PASS）を満たさない
      //    ＝ SP-09 の承認 CAS も送信の事前判定も通らない（保留は共有の許可ではない）。
      expect(await passedGate(proposalId)).toBeNull();

      // #40 は保留を 3 値のまま返す（2 値に潰さない）。
      const view = (await (await callReadGate(ctx, proposalId)).json()) as {
        execution: string;
        layers: { pii: { state: string }; commerce: { state: string }; consistency: { state: string } };
        held?: { heldReasonKey: string; rerun: { auto: boolean } };
      };
      expect(view.execution).toBe('HELD_AI_COST_LIMIT');
      expect(view.layers.pii.state).toBe('HELD');
      expect(view.layers.commerce.state).toBe('HELD');
      expect(view.layers.consistency.state).toBe('PASS');
      expect(view.held?.rerun.auto).toBe(true);
      // 🔴 金額（USD）を 1 つも載せない（`F-027 AC-6`）。
      expect(JSON.stringify(view).toLowerCase()).not.toContain('usd');

      // ③ 🔴 上限が解除される前は、`gate.hold-release` は**何もしない**（往復させない）。
      expect(await runHoldRelease(TENANT_1.tenantId, NOW_DAY1)).toEqual({
        scanned: 0,
        requeued: 0,
        blockedByFailedJob: 0,
        capacity: 0,
      });
      expect(await queue.jobState(key)).toBeNull();
      expect(await proposalState(proposalId)).toBe('GATE_RUNNING');

      // ④ 翌日（JST の 0 時に日次の枠が変わる）→ 🔴 **自動で**積み直す。
      const released = await runHoldRelease(TENANT_1.tenantId, NOW_DAY2);
      expect(released).toMatchObject({ scanned: 1, requeued: 1 });
      expect(released.capacity).toBeGreaterThan(0);
      // 🔴 **同じ payload・同じ `jobId`**（#39 の手動再実行と同じ材料。3 段の重複排除が効く）。
      expect(await queue.jobState(key)).toBe('waiting');
      const queued = await queue.removeFailedJob(key);
      expect(queued).toBe('NOT_FAILED'); // 待機中なので消さない（走っているものを止めない）

      // ⑤ ワーカーが実行 → 保留していた**同じ行**を CAS で `DONE` に確定させる。
      await withGateWorker(NOW_DAY2, () => waitForExecution(proposalId, 'DONE'));

      const rows = await admin.reviewGate.findMany({ where: { targetId: proposalId } });
      // 🔴 行は増えない（`P-A-09` / 完了 CAS）。
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        execution: 'DONE',
        heldSince: null,
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        aiFailed: false,
        role: 'gate-inspector',
      });
      expect(await proposalState(proposalId)).toBe('APPROVAL_PENDING');
      // 🔴 ここで初めて承認・送信の前提が満たされる。
      expect(await passedGate(proposalId)).not.toBeNull();
      // 遷移は 2 回だけ（#39 の `DRAFT → GATE_RUNNING` と、結果の `GATE_RUNNING → APPROVAL_PENDING`）。
      expect(await admin.proposalEvent.count({ where: { proposalId } })).toBe(2);
      // 🔴 LLM の呼び出しは 1 回（保留中は 0 回、復帰後に 1 回）。
      expect(await admin.aiUsage.count({ where: { tenantId: TENANT_1.tenantId } })).toBe(1);

      // ⑥ 復帰後は保留行が無いので、次の実行は何もしない（空振りで積み続けない）。
      expect(await runHoldRelease(TENANT_1.tenantId, NOW_DAY2)).toMatchObject({ scanned: 0, requeued: 0 });
    },
    SETUP_TIMEOUT_MS,
  );

  it(
    '🔴 自動（gate.hold-release）と手動（#39）が同時に走ってもゲートの実行は 1 回・結果は 1 行・遷移は 1 回',
    async () => {
      const proposalId = TENANT_1.hostProposalId;
      await prepareProposal({ proposalId, body: '多重化しないことの確認です。' });
      await reserveNearlyAllBudget(TENANT_1.tenantId, NOW_DAY1);

      const ctx = await ctxOf(HOST_SALES, 'SALES');
      const first = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
      const key = keyOf(proposalId, hashOfJobId(first.jobId));
      await withGateWorker(NOW_DAY1, () => waitForExecution(proposalId, 'HELD_AI_COST_LIMIT'));

      // 🔴 上限解除後、**自動 2 回 + 手動 1 回**を、ワーカーを止めたまま重ねて起動する。
      await runHoldRelease(TENANT_1.tenantId, NOW_DAY2);
      await runHoldRelease(TENANT_1.tenantId, NOW_DAY2);
      const manual = await callRequestGate(ctx, proposalId);
      expect(manual.status).toBe(202);
      // 🔴 手動再実行も**保留行の内容**で積むので、`jobId` は自動と 1 バイトも違わない。
      expect(((await manual.json()) as { jobId: string }).jobId).toBe(gateRunJobId(key));
      expect(await queue.jobState(key)).toBe('waiting');

      await withGateWorker(NOW_DAY2, () => waitForExecution(proposalId, 'DONE'));

      // 🔴 3 回起動しても、実行は 1 回・結果は 1 行・遷移は 1 回である。
      //    ⚠️ この本文で独立に効いているのは **`jobId` の重複排除（1 段目）と完了 CAS（3 段目）**である
      //    （HELD 部分 UNIQUE は保留行が 2 行にならないことを DB 側で保証する制約であり、
      //    その成立は `tests/isolation/proposal-gate-constraints.test.ts` が直接見ている）。
      expect(await admin.aiUsage.count({ where: { tenantId: TENANT_1.tenantId } })).toBe(1);
      expect(await admin.reviewGate.count({ where: { targetId: proposalId } })).toBe(1);
      expect(await admin.proposalEvent.count({ where: { proposalId, kind: 'STATE' } })).toBe(2);
      expect(await proposalState(proposalId)).toBe('APPROVAL_PENDING');
    },
    SETUP_TIMEOUT_MS,
  );

  it(
    '🔴 保留中の再実行が失敗して failed 記録が残ると、自動では積めない（数えて返す）。逃げ道は #39 である',
    async () => {
      // 🔴 T-07-10 レビューで実 Redis で再現された**行き止まり**の回帰テストである:
      //    `gate.run` は `removeOnFail` を付けない（§9.1。failed は §16.5 の根拠）ため、
      //    **同じ `jobId` の failed 記録が残っている間、`add` は静かに無視される**。
      //    ①自動経路がそれを「積んだ」と数えると、10 分ごとに嘘の復帰報告を繰り返す
      //    ②#39 が保留の再開で failed 記録を消さないと、手動でも復帰できない
      //    （対象は `GATE_RUNNING` のまま ＝ `F-027 AC-5` が禁じている状態）。
      const proposalId = TENANT_1.hostProposalId;
      await prepareProposal({ proposalId, body: '失敗記録との行き止まりの確認です。' });
      await reserveNearlyAllBudget(TENANT_1.tenantId, NOW_DAY1);

      const ctx = await ctxOf(HOST_SALES, 'SALES');
      const first = (await (await callRequestGate(ctx, proposalId)).json()) as { jobId: string };
      const key = keyOf(proposalId, hashOfJobId(first.jobId));
      await withGateWorker(NOW_DAY1, () => waitForExecution(proposalId, 'HELD_AI_COST_LIMIT'));

      // ① 上限解除後に自動で積み直し、**その実行が失敗する**（`loadGateInput` の例外・単価未登録・
      //    DB / Redis の一時障害はいずれもここに落ちる）。必ず失敗するワーカーで再現する。
      expect(await runHoldRelease(TENANT_1.tenantId, NOW_DAY2)).toMatchObject({
        requeued: 1,
        blockedByFailedJob: 0,
      });
      const failing = createBullMqGateRunWorker({
        connection: { url: redis.url },
        handler: async () => {
          throw new Error('gate.run は失敗した（§16.5 の JOB_FAILED を作る）');
        },
      });
      try {
        await waitForJobState(key, 'failed');
      } finally {
        await failing.close();
      }
      // 🔴 失敗したハンドラは 1 行も書いていないので、保留行はそのまま残っている。
      expect((await gateRow(proposalId))?.execution).toBe('HELD_AI_COST_LIMIT');

      // ② 🔴 以後、自動経路は**積めない**。それを `requeued` に数えず、別の数として返す。
      expect(await runHoldRelease(TENANT_1.tenantId, NOW_DAY2)).toMatchObject({
        scanned: 1,
        requeued: 0,
        blockedByFailedJob: 1,
      });
      // 🔴 失敗記録を自動で消さない（§9.10 ①。消すと §16.5 の失敗ジョブ数から見えなくなる）。
      expect(await queue.jobState(key)).toBe('failed');
      expect(await proposalState(proposalId)).toBe('GATE_RUNNING');

      // ③ 🔴 逃げ道は利用者の再依頼（#39）である。**保留の再開でも failed 記録を消す**。
      const manual = await callRequestGate(ctx, proposalId);
      expect(manual.status).toBe(202);
      expect(((await manual.json()) as { jobId: string }).jobId).toBe(gateRunJobId(key));
      expect(await queue.jobState(key)).toBe('waiting');
      const audits = await admin.auditLog.findMany({
        where: { targetId: proposalId, action: 'proposal.update' },
        orderBy: { createdAt: 'asc' },
        select: { summary: true },
      });
      expect(audits[audits.length - 1]?.summary).toMatchObject({
        operation: 'GATE_RERUN',
        rerunReason: 'HELD_AI_COST_LIMIT',
        // 🔴 「失敗記録を消した」ことが監査に残る（`A-005` の滞留検知と突き合わせるため）。
        removedFailedJob: true,
      });

      // ④ そのまま実行されて復帰する（保留していた同じ行が `DONE` になる）。
      await withGateWorker(NOW_DAY2, () => waitForExecution(proposalId, 'DONE'));
      expect(await proposalState(proposalId)).toBe('APPROVAL_PENDING');
      expect(await admin.reviewGate.count({ where: { targetId: proposalId } })).toBe(1);
      expect(await passedGate(proposalId)).not.toBeNull();
    },
    SETUP_TIMEOUT_MS,
  );

  it('🔴 他テナントの保留は 1 件も走査されない（分離キーは payload ではなく ctx / RLS が決める）', async () => {
    // テナント 2 にだけ保留行を置く（テナント 1 には無い）。
    await admin.reviewGate.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT_2.tenantId,
        targetType: TARGET_TYPE,
        targetId: TENANT_2.hostProposalId,
        contentHash: 'cross-tenant-hold',
        execution: 'HELD_AI_COST_LIMIT',
        heldSince: NOW_DAY1,
        piiVerdict: null,
        commerceVerdict: null,
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        aiFailed: false,
      },
    });

    const enqueued: { tenantId: string; targetId: string }[] = [];
    const spyHandler = createGateHoldReleaseHandler({
      now: () => NOW_DAY2,
      models,
      aiDailyCostLimitUsd: AI_DAILY_LIMIT_USD,
      enqueueGateRun: async (job) => {
        enqueued.push({ tenantId: job.tenantId, targetId: job.targetId });
        return 'ENQUEUED';
      },
    });

    // テナント 1 の実行: 走査対象は 0 件（他テナントの保留は見えない）。
    expect(await spyHandler({ tenantId: TENANT_1.tenantId }, 'gate.hold-release:t1')).toMatchObject({
      scanned: 0,
      requeued: 0,
    });
    expect(enqueued).toEqual([]);

    // テナント 2 の実行: 自分の保留だけを、自分の `tenantId` で積む。
    expect(await spyHandler({ tenantId: TENANT_2.tenantId }, 'gate.hold-release:t2')).toMatchObject({
      scanned: 1,
      requeued: 1,
    });
    expect(enqueued).toEqual([{ tenantId: TENANT_2.tenantId, targetId: TENANT_2.hostProposalId }]);
  });
});
