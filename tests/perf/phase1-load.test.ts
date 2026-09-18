// tests/perf/phase1-load.test.ts
// 🔴 T-12-02（`docs/sprints/SP-12-phase1-hardening.md` §4 T-12-02）: **負荷テスト（R-2）**。
//    `CLAUDE.md` §7（エンジニア 1 万件 / 案件 1 万件での複合検索 p95 1 秒以内）/ `F-009 AC-4` / `F-015 AC-2` /
//    `docs/02` 章 7.1（`gate.run` p95 30 秒 / `send.proposal` p95 60 秒）/ `docs/03` §3.7.2「検証方法」/ `docs/05` §17.3 #20。
//
// ---------------------------------------------------------------------------
// 🔴 何を測るか
// ---------------------------------------------------------------------------
//   測定 1（`F-009`）: 最大テナント（`perfSeedIds(1)`。エンジニア 3,000 = ホスト 750 + 取引先 2,250、匿名共有 2,000）の
//     ホスト `SALES` で `GET /api/engineers`（#15）を **API 境界と同じ経路**（`withApiRoute` → `listEngineers` /
//     `listProjectCandidates` → `withTenant` + RLS。`projectId` ありは共有スコープ + 自社スコープの 2 本 + アプリ層マージ）で
//     条件の組ごとに N 回直列に叩き、p50 / p95 / p99 を採る。**匿名候補 2,000 件が母集団に入っていること**を、
//     `projectId` あり / なしの `total` の差（= 共有スコープの行数）で確かめる。
//   測定 2（`F-015`）: `GET /api/projects`（#25）を同様に。
//   測定 3 / 4: 実 Redis + 実 BullMQ Worker（`createBullMqWorker` = 本番と同じ配線）+ **モック AI / モックメール**で、
//     `DRAFT` → #39 → `gate.run` 確定（`APPROVAL_PENDING`）と、`APPROVAL_PENDING` → #41 → #43 → `send.proposal` →
//     `SUBMITTED` の所要時間を、30 テナントそれぞれの提案 1 件ずつで採る。
//     🔴 **これは「ジョブの起動〜確定のオーバーヘッド」の測定であり、実 API（Anthropic / SES）のレイテンシは含まれない**
//        （非本番はすべてモック。`CLAUDE.md` §11.1）。実 API を含めた値は本番の `A-005` の滞留監視で見る。
//
// ---------------------------------------------------------------------------
// 🔴 判定
// ---------------------------------------------------------------------------
//   条件の組ごとに `p95 <= PERF_P95_BUDGET_MS`（`tests/perf/budget.ts`。**値を上げない**）を `expect.soft` で固定する
//   （1 組が未達でも全組を測り切って表に出す。未達の組は `docs/dev-plan.md` §8 に記録して人間に提起する材料にする）。
//   ⚠️ 2026-09-18 の実測では `projectId` あり（匿名候補混在）の 2 組が p95 2.3 秒 / 3.9 秒で未達であり、本スイートは
//      その是正（docs/05 §17.3「T-12-02 の実測の決着」の (a)〜(d)）が入るまで赤である。**予算を上げて緑にしない。**
//
// 🔴 モックは `requireTenantCtx` / `readRequestMeta`（ctx の出所）と `lib/db/bootstrap`（起動時 DI の 2 値）だけ。
//    DB・RLS・Route Handler・検索・共有スコープ・キュー・Worker はすべて実物である。実 API に接続しない。
// 🔴 `tests/perf/**` は ESLint の CATCH_ALL ゾーン（`@ses/db/testing` と生 SQL が禁止）。母集団の確認は seed の戻り値
//    （`counts`）と API の応答（`total`）で行い、特権接続を持たない。
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient, DEMO_MOCK_ANTHROPIC_SCRIPT } from '@ses/ai';
import {
  createConnectors,
  GATE_RUN_JOB,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  SEND_PROPOSAL_JOB,
  type Connectors,
} from '@ses/connectors';
import {
  createBullMqGateRunQueue,
  createBullMqSendProposalQueue,
  createBullMqWorker,
  type BullMqGateRunQueue,
  type BullMqSendProposalQueue,
  type BullMqWorker,
} from '@ses/connectors/bullmq';
import { configureTenantDb, disconnectTenantDb, type AuthenticatedTenantCtx } from '@ses/db';
import {
  GLOBAL_SKILL_IDS,
  PERF_SEED_PROFILES,
  PERF_SEED_TOTALS,
  perfSeedIds,
  runSeed,
  type RunSeedResult,
} from '@ses/db/seed';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import {
  createSendProposalHandler,
  resolveProposalSendingDomainFromDb,
} from '../../apps/worker/src/jobs/send-proposal.js';
import { startIsolationDatabase, type IsolationDatabase } from '../isolation/support/postgres.js';
import { quotaDefaultsWith } from '../isolation/support/quota-defaults.js';
import { startIsolationRedis, type IsolationRedis } from '../isolation/support/redis.js';
import {
  GATE_RUN_P95_BUDGET_MS,
  JOB_SAMPLE_COUNT,
  PERF_P95_BUDGET_MS,
  SEARCH_SAMPLE_COUNT,
  SEARCH_WARMUP_COUNT,
  SEND_PROPOSAL_P95_BUDGET_MS,
} from './budget.js';
import { measure, renderReport, summarize, type ReportRow } from './support/stats.js';

const SETUP_TIMEOUT_MS = 900_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.120' } as const;
/** 「実行日 = T」。seed の相対日（案件の `start_date` = `T-60`〜`T+120` 等）の基準。 */
const NOW = new Date();
/** `startFrom`（`F-015`）に使う T の暦日（UTC）。 */
const TODAY = NOW.toISOString().slice(0, 10);
/** ポーリング間隔（ジョブの確定を API で読む）。所要時間の分解能はこの値になる。 */
const POLL_INTERVAL_MS = 25;
const JOB_SETTLE_TIMEOUT_MS = 120_000;
/** 🔴 `docker` の Postgres イメージ（`tests/isolation/support/postgres.ts` の `POSTGRES_IMAGE` と同じ値。報告用のラベル）。 */
const POSTGRES_LABEL = 'PostgreSQL 17 (postgres:17-bookworm / Testcontainers)';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

/** 🔴 テスト専用の HMAC 鍵（`project-candidates.test.ts` と同じ理由で `bootstrap` を通さない）。 */
const TEST_SECRET = 'B'.repeat(43) + '=';
const { createCandidateReference } = await import('../../apps/web/lib/anonymize/reference');
const candidateRef = createCandidateReference(TEST_SECRET);

/**
 * 🔴 起動時 DI の値。`sendingDomainRuntime` は検証必須（`production` 相当）にし、#43 が seed の `VERIFIED` 行を
 *    `evaluateSendingDomain` で読む本番と同じ経路を通す。
 */
const sendingDomainRuntime = { region: 'ap-northeast-1', verificationRequired: true };
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  candidateReference: () => candidateRef,
  sendingDomainRuntime: () => sendingDomainRuntime,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const engineersRoute = await import('../../apps/web/app/api/(main)/engineers/route');
const projectsRoute = await import('../../apps/web/app/api/(main)/projects/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const submitRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/submit/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');
const { configureSendProposalJobQueue, resetSendProposalJobQueue } = await import(
  '../../apps/web/lib/jobs/send-proposal-queue'
);

const LARGEST = perfSeedIds(PERF_SEED_TOTALS.largestTenantIndex);
const LARGEST_PROFILE = PERF_SEED_PROFILES[0]!;
/** 最大テナントのホスト所属エンジニア数（配分表: 3,000 − 取引先所属 2,250）。 */
const LARGEST_HOST_ENGINEERS = LARGEST_PROFILE.engineers - LARGEST_PROFILE.partnerEngineers;
const SKILL_JAVA = GLOBAL_SKILL_IDS.Java as string;
const SKILL_AWS = GLOBAL_SKILL_IDS.AWS as string;

let database: IsolationDatabase;
let redis: IsolationRedis;
let seedRun: RunSeedResult;
let seedDurationMs: number;
let hostSales: AuthenticatedTenantCtx;
let gateQueue: BullMqGateRunQueue;
let sendQueue: BullMqSendProposalQueue;
let gateWorker: BullMqWorker;
let sendWorker: BullMqWorker;
let mockConnectors: Connectors;
/** Worker の中で測ったハンドラ本体の所要時間（キュー待ちを含まない内訳）。 */
const gateHandlerMs: number[] = [];
const sendHandlerMs: number[] = [];
/** 最後に `docs/dev-plan.md` §8 へ貼る表。 */
const reports: string[] = [];

type ListBody = { readonly items: readonly Record<string, unknown>[]; readonly total: number; readonly nextCursor: string | null };
type ProposalBody = { readonly id: string; readonly state: string };

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function ctxOf(tenantIndex: number): Promise<AuthenticatedTenantCtx> {
  const ids = perfSeedIds(tenantIndex);
  const ctx = await buildTenantCtx(
    { tenantId: ids.tenantId, partnerCompanyId: null, userId: ids.hostSalesUserIds[0], twoFactorVerified: true },
    { deviceKind: 'api' },
  );
  if (ctx === null) throw new Error(`テナント ${String(tenantIndex)} のホスト SALES の ctx を作れません（seed の前提の破綻）。`);
  return ctx;
}

/** #15 / #25 を API 境界と同じ経路で 1 回叩き、JSON まで読む（応答の直列化を含めた所要時間を測る）。 */
async function getList(route: { GET: (request: Request) => Promise<Response> }, path: string, query: string): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(hostSales);
  const response = await route.GET(new Request(`https://app.test${path}${query === '' ? '' : `?${query}`}`));
  if (response.status !== 200) throw new Error(`${path}?${query} → ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as ListBody;
}

async function readProposalState(ctx: AuthenticatedTenantCtx, id: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalRoute.GET(new Request(`https://app.test/api/proposals/${id}`), segment(id));
  if (response.status !== 200) throw new Error(`GET /api/proposals/${id} → ${String(response.status)}`);
  return ((await response.json()) as ProposalBody).state;
}

/** 状態が `pending` のいずれでもなくなるまで API で読み続け、確定までの所要時間を返す。 */
async function waitForSettled(
  ctx: AuthenticatedTenantCtx,
  id: string,
  pending: readonly string[],
  startedAt: number,
): Promise<{ readonly state: string; readonly elapsedMs: number }> {
  for (;;) {
    const state = await readProposalState(ctx, id);
    if (!pending.includes(state)) return { state, elapsedMs: performance.now() - startedAt };
    if (performance.now() - startedAt > JOB_SETTLE_TIMEOUT_MS) {
      throw new Error(`提案 ${id} が ${String(JOB_SETTLE_TIMEOUT_MS)} ms 経っても確定しません（state=${state}）。`);
    }
    await delay(POLL_INTERVAL_MS);
  }
}

function environmentLabel(): string {
  const cpu = os.cpus()[0]?.model.trim() ?? 'unknown CPU';
  const memoryGb = (os.totalmem() / 1024 ** 3).toFixed(1);
  return `${cpu} / ${String(os.cpus().length)} threads / ${memoryGb} GB / node ${process.version} / ${os.platform()} ${os.release()} / ${POSTGRES_LABEL}`;
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  redis = await startIsolationRedis();
  // 🔴 `seed --preset=perf`。フレッシュなコンテナなので毎回 `SEEDED`（既に投入済みの DB に向けたときは
  //    `ALREADY_SEEDED` で 2 秒に終わり、何も書かない = `reset: false` の契約。`tests/isolation/seed-perf.test.ts` ⑤）。
  const seedStartedAt = performance.now();
  seedRun = await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'perf', reset: false, now: NOW });
  seedDurationMs = performance.now() - seedStartedAt;

  configureTenantDb({ datasourceUrl: database.tenantUrl });
  hostSales = await ctxOf(PERF_SEED_TOTALS.largestTenantIndex);

  // 🔴 本番と同じ配線（`createBullMq*Queue` を Route Handler の enqueue 先に、`createBullMqWorker` を消費側に）。
  gateQueue = createBullMqGateRunQueue({ url: redis.url });
  sendQueue = createBullMqSendProposalQueue({ url: redis.url });
  configureGateRunJobQueue(gateQueue);
  configureSendProposalJobQueue(sendQueue);
  mockConnectors = createConnectors({ email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });

  const gateHandler = createGateRunHandler({
    now: () => new Date(),
    // 🔴 モック AI（`demo` の既定応答 = 全層 PASS。機械的照合は実物）。
    aiClient: createAiClient('mock', { mock: { script: [...DEMO_MOCK_ANTHROPIC_SCRIPT] } }),
    models: catalogRoleModelResolver({ DEFAULT: 'claude-sonnet-5', CHEAP: 'claude-haiku-4-5-20251001' }),
    aiDailyCostLimitUsd: '5.000000',
  });
  gateWorker = createBullMqWorker({
    queueName: GATE_RUN_JOB,
    connection: { url: redis.url },
    handler: async (payload, jobId) => {
      const startedAt = performance.now();
      try {
        return await gateHandler(payload, jobId);
      } finally {
        gateHandlerMs.push(performance.now() - startedAt);
      }
    },
  });
  const sendHandler = createSendProposalHandler({
    emailSender: mockConnectors.email,
    emailImplementationKind: 'mock',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    quotaDefaults: quotaDefaultsWith({ emailDailyLimit: 500 }),
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: resolveProposalSendingDomainFromDb,
    staleThresholdMinutes: 30,
    now: () => new Date(),
  });
  sendWorker = createBullMqWorker({
    queueName: SEND_PROPOSAL_JOB,
    connection: { url: redis.url },
    handler: async (payload, jobId) => {
      const startedAt = performance.now();
      try {
        return await sendHandler(payload, jobId);
      } finally {
        sendHandlerMs.push(performance.now() - startedAt);
      }
    },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  // 計測結果は `docs/dev-plan.md` §8 に転記するため標準出力へ出す。
  console.info(
    [
      '',
      `## T-12-02 負荷測定（${NOW.toISOString()}）`,
      `- 環境: ${environmentLabel()}`,
      `- シード: perf v1（${seedRun?.outcome ?? '-'}。${Math.round(seedDurationMs ?? 0)} ms）。engineers ${String(seedRun?.counts.engineers ?? '-')} / projects ${String(seedRun?.counts.projects ?? '-')} / engineer_shares ${String(seedRun?.counts.engineer_shares ?? '-')}`,
      `- 予算: 検索 p95 ${String(PERF_P95_BUDGET_MS)} ms / gate.run p95 ${String(GATE_RUN_P95_BUDGET_MS)} ms / send.proposal p95 ${String(SEND_PROPOSAL_P95_BUDGET_MS)} ms`,
      '',
      ...reports,
      '',
    ].join('\n'),
  );
  resetGateRunJobQueue();
  resetSendProposalJobQueue();
  await gateWorker?.close();
  await sendWorker?.close();
  await gateQueue?.close();
  await sendQueue?.close();
  await disconnectTenantDb();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// 母集団
// ---------------------------------------------------------------------------

describe('母集団（docs/03 §3.7.2 の分布）', () => {
  it('🔴 seed:perf が 1 万 / 1 万 / 匿名共有 2,000 を投入している（黙って少なくなっていない）', () => {
    expect(seedRun.outcome).toBe('SEEDED');
    expect(seedRun.counts.engineers).toBe(PERF_SEED_TOTALS.engineers);
    expect(seedRun.counts.projects).toBe(PERF_SEED_TOTALS.projects);
    expect(seedRun.counts.engineer_shares).toBe(PERF_SEED_TOTALS.engineerShares);
    expect(seedRun.counts.tenants).toBe(PERF_SEED_TOTALS.tenants);
  });

  it('🔴 匿名候補 2,000 件が最大テナントのホストの母集団に入っている（projectId あり / なしの total の差 = 共有スコープの行数）', async () => {
    const own = await getList(engineersRoute, '/api/engineers', '');
    const mixed = await getList(engineersRoute, '/api/engineers', `projectId=${LARGEST.projectId(1)}`);
    expect(own.total).toBe(LARGEST_HOST_ENGINEERS);
    expect(mixed.total - own.total).toBe(PERF_SEED_TOTALS.engineerShares);
    expect(mixed.total).toBe(LARGEST_HOST_ENGINEERS + PERF_SEED_TOTALS.engineerShares);
    // 自社スコープには匿名候補が 1 件も混ざらず、混在側の 1 ページ目は 50 件で次ページがある。
    expect(own.items.some((item) => 'candidateRef' in item)).toBe(false);
    expect(mixed.items).toHaveLength(50);
    expect(mixed.nextCursor).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 測定 1: GET /api/engineers（F-009）
// ---------------------------------------------------------------------------

type SearchCase = { readonly label: string; readonly query: string };

const ENGINEER_CASES: readonly SearchCase[] = [
  { label: '絞り込みなし', query: '' },
  { label: 'スキル 1 つ（Java）', query: `skills=${SKILL_JAVA}` },
  { label: 'スキル 2 つ OR（Java / AWS）', query: `skills=${SKILL_JAVA}&skills=${SKILL_AWS}&skillMode=OR` },
  { label: 'スキル + 経験年数 + 単価', query: `skills=${SKILL_JAVA}&yearsMin=3&priceMin=600000&priceMax=800000` },
  { label: '都道府県 + リモート（ソフト条件 = 2 バケット）', query: 'prefecture=13&remote=FULL_REMOTE' },
  { label: 'フリーワード q', query: `q=${encodeURIComponent('フルリモート')}` },
  {
    label: '全部盛り',
    query: `skills=${SKILL_JAVA}&yearsMin=3&priceMin=600000&priceMax=800000&prefecture=13&remote=FULL_REMOTE&availability=STANDBY&availableBy=${TODAY}&q=${encodeURIComponent('フルリモート')}`,
  },
  { label: 'projectId あり（匿名候補混在 #15）絞り込みなし', query: `projectId=${LARGEST.projectId(1)}` },
  {
    label: 'projectId あり（匿名候補混在 #15）全部盛り',
    query: `projectId=${LARGEST.projectId(1)}&skills=${SKILL_JAVA}&yearsMin=3&priceMin=600000&priceMax=800000&prefecture=13&remote=FULL_REMOTE&q=${encodeURIComponent('フルリモート')}`,
  },
];

const PROJECT_CASES: readonly SearchCase[] = [
  { label: '絞り込みなし', query: '' },
  { label: '状態（OPEN）', query: 'status=OPEN' },
  { label: '開始日（T 以降）', query: `startFrom=${TODAY}` },
  { label: '都道府県（東京）', query: 'prefecture=13' },
  { label: 'フリーワード q（受発注）', query: `q=${encodeURIComponent('受発注')}` },
  { label: '全部盛り', query: `status=OPEN&startFrom=${TODAY}&prefecture=13&q=${encodeURIComponent('受発注')}` },
];

async function measureSearch(
  title: string,
  route: { GET: (request: Request) => Promise<Response> },
  path: string,
  cases: readonly SearchCase[],
): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  for (const searchCase of cases) {
    let total = -1;
    let anonymousOnPage = 0;
    const durations = await measure(
      async () => {
        const body = await getList(route, path, searchCase.query);
        total = body.total;
        anonymousOnPage = body.items.filter((item) => 'candidateRef' in item).length;
      },
      { samples: SEARCH_SAMPLE_COUNT, warmup: SEARCH_WARMUP_COUNT },
    );
    const anonymousNote = searchCase.query.includes('projectId=') ? ` / 1 ページ目の匿名候補 ${String(anonymousOnPage)} 件` : '';
    rows.push({
      label: searchCase.label,
      summary: summarize(durations),
      budgetMs: PERF_P95_BUDGET_MS,
      note: `total ${String(total)} 件${anonymousNote}`,
    });
  }
  reports.push(renderReport(title, rows));
  return rows;
}

describe('測定 1: F-009 複合検索（GET /api/engineers。最大テナントのホスト SALES）', () => {
  it(`🔴 条件の組 ${String(ENGINEER_CASES.length)} 通り × N = ${String(SEARCH_SAMPLE_COUNT)} で p95 <= ${String(PERF_P95_BUDGET_MS)} ms（F-009 AC-4）`, async () => {
    const rows = await measureSearch(
      `測定 1: GET /api/engineers（F-009。N = ${String(SEARCH_SAMPLE_COUNT)}、ウォームアップ ${String(SEARCH_WARMUP_COUNT)} 回を除く）`,
      engineersRoute,
      '/api/engineers',
      ENGINEER_CASES,
    );
    expect(rows).toHaveLength(ENGINEER_CASES.length);
    for (const row of rows) {
      // 🔴 条件が当たっていること（0 件の検索を速いと言わない）。
      expect.soft(row.note, row.label).not.toMatch(/^total (-1|0) 件/);
      expect.soft(row.summary.p95, `${row.label}: p95 ${row.summary.p95.toFixed(1)} ms`).toBeLessThanOrEqual(PERF_P95_BUDGET_MS);
    }
  });
});

// ---------------------------------------------------------------------------
// 測定 2: GET /api/projects（F-015）
// ---------------------------------------------------------------------------

describe('測定 2: F-015 案件検索（GET /api/projects。最大テナントのホスト SALES）', () => {
  it(`🔴 条件の組 ${String(PROJECT_CASES.length)} 通り × N = ${String(SEARCH_SAMPLE_COUNT)} で p95 <= ${String(PERF_P95_BUDGET_MS)} ms（F-015 AC-2）`, async () => {
    const rows = await measureSearch(
      `測定 2: GET /api/projects（F-015。N = ${String(SEARCH_SAMPLE_COUNT)}、ウォームアップ ${String(SEARCH_WARMUP_COUNT)} 回を除く）`,
      projectsRoute,
      '/api/projects',
      PROJECT_CASES,
    );
    expect(rows).toHaveLength(PROJECT_CASES.length);
    for (const row of rows) {
      expect.soft(row.note, row.label).not.toMatch(/^total (-1|0) 件/);
      expect.soft(row.summary.p95, `${row.label}: p95 ${row.summary.p95.toFixed(1)} ms`).toBeLessThanOrEqual(PERF_P95_BUDGET_MS);
    }
  });
});

// ---------------------------------------------------------------------------
// 測定 3 / 4: gate.run / send.proposal（実 Redis + 実 Worker + モック AI / モックメール）
// ---------------------------------------------------------------------------

describe('測定 3 / 4: gate.run と send.proposal（実 BullMQ Worker。モック AI / モックメール = 起動〜確定のオーバーヘッド）', () => {
  it(`🔴 測定 3: DRAFT → #39 → gate.run 確定（APPROVAL_PENDING）が N = ${String(JOB_SAMPLE_COUNT)} で p95 <= ${String(GATE_RUN_P95_BUDGET_MS)} ms`, async () => {
    const durations: number[] = [];
    for (let tenantIndex = 1; tenantIndex <= JOB_SAMPLE_COUNT; tenantIndex += 1) {
      const ids = perfSeedIds(tenantIndex);
      const ctx = await ctxOf(tenantIndex);
      const proposalId = ids.proposalId(1);
      expect(await readProposalState(ctx, proposalId)).toBe('DRAFT');
      requireTenantCtxMock.mockResolvedValue(ctx);
      const startedAt = performance.now();
      const accepted = await gateRoute.POST(new Request(`https://app.test/api/proposals/${proposalId}/gate`, { method: 'POST' }), segment(proposalId));
      expect(accepted.status, await accepted.clone().text()).toBe(202);
      const settled = await waitForSettled(ctx, proposalId, ['DRAFT', 'GATE_RUNNING'], startedAt);
      // 🔴 全層 PASS で `APPROVAL_PENDING`（seed の DRAFT が実物のパイプラインと整合している）。FAIL / HELD は計測値として数えない。
      expect(settled.state, `tenant ${String(tenantIndex)}`).toBe('APPROVAL_PENDING');
      durations.push(settled.elapsedMs);
    }
    const summary = summarize(durations);
    const handler = summarize(gateHandlerMs);
    reports.push(
      renderReport(`測定 3: gate.run（N = ${String(JOB_SAMPLE_COUNT)}。各テナントの DRAFT 1 件ずつ。モック AI）`, [
        { label: '#39 202 → APPROVAL_PENDING（API で確定を観測。分解能 25 ms）', summary, budgetMs: GATE_RUN_P95_BUDGET_MS, note: '起動〜確定のオーバーヘッド。実 Anthropic API のレイテンシを含まない' },
        { label: '内訳: Worker 内のハンドラ本体', summary: handler, budgetMs: GATE_RUN_P95_BUDGET_MS, note: `AI 呼び出しはモック（${String(gateHandlerMs.length)} 回）` },
      ]),
    );
    expect(gateHandlerMs).toHaveLength(JOB_SAMPLE_COUNT);
    expect(summary.p95).toBeLessThanOrEqual(GATE_RUN_P95_BUDGET_MS);
  });

  it(`🔴 測定 4: APPROVAL_PENDING → #41 → #43 → send.proposal → SUBMITTED が N = ${String(JOB_SAMPLE_COUNT)} で p95 <= ${String(SEND_PROPOSAL_P95_BUDGET_MS)} ms`, async () => {
    const callsBefore = mockConnectors.email.callCount();
    const durations: number[] = [];
    for (let tenantIndex = 1; tenantIndex <= JOB_SAMPLE_COUNT; tenantIndex += 1) {
      const ids = perfSeedIds(tenantIndex);
      const ctx = await ctxOf(tenantIndex);
      const proposalId = ids.proposalId(2);
      expect(await readProposalState(ctx, proposalId)).toBe('APPROVAL_PENDING');
      requireTenantCtxMock.mockResolvedValue(ctx);
      const approved = await approveRoute.POST(new Request(`https://app.test/api/proposals/${proposalId}/approve`, { method: 'POST' }), segment(proposalId));
      expect(approved.status, await approved.clone().text()).toBe(200);
      requireTenantCtxMock.mockResolvedValue(ctx);
      const startedAt = performance.now();
      const accepted = await submitRoute.POST(new Request(`https://app.test/api/proposals/${proposalId}/submit`, { method: 'POST' }), segment(proposalId));
      expect(accepted.status, await accepted.clone().text()).toBe(202);
      const body = (await accepted.json()) as { readonly outcome: string; readonly attemptSeq: number };
      // 🔴 seed の送信ドメインは `VERIFIED` なので保留にならず enqueue される（`HELD` は計測値として数えない）。
      expect(body, `tenant ${String(tenantIndex)}`).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1 });
      const settled = await waitForSettled(ctx, proposalId, ['APPROVED', 'SUBMITTING'], startedAt);
      expect(settled.state, `tenant ${String(tenantIndex)}`).toBe('SUBMITTED');
      durations.push(settled.elapsedMs);
    }
    const summary = summarize(durations);
    const handler = summarize(sendHandlerMs);
    reports.push(
      renderReport(`測定 4: send.proposal（N = ${String(JOB_SAMPLE_COUNT)}。各テナントの APPROVAL_PENDING 1 件ずつを承認して送信。モックメール）`, [
        { label: '#43 202 → SUBMITTED（API で確定を観測。分解能 25 ms）', summary, budgetMs: SEND_PROPOSAL_P95_BUDGET_MS, note: '起動〜確定のオーバーヘッド。実 SES のレイテンシを含まない' },
        { label: '内訳: Worker 内のハンドラ本体', summary: handler, budgetMs: SEND_PROPOSAL_P95_BUDGET_MS, note: `外部送信はモック sink（${String(sendHandlerMs.length)} 回）` },
      ]),
    );
    // 🔴 外部送信は提案ごとにちょうど 1 回（二重送信 0 件。`F-022 AC-1`）。
    expect(mockConnectors.email.callCount()).toBe(callsBefore + JOB_SAMPLE_COUNT);
    expect(sendHandlerMs).toHaveLength(JOB_SAMPLE_COUNT);
    expect(summary.p95).toBeLessThanOrEqual(SEND_PROPOSAL_P95_BUDGET_MS);
  });
});
