// tests/isolation/seed-demo.test.ts
// 🔴 T-10-06（`docs/sprints/SP-10-usage-env-sandbox.md` §4 T-10-06）: **`seed:demo`（合成データ一式）と API-A16 / `A-012`** を
//    **実 DB（RLS 付き）+ 実 Route Handler（#25 / #39 / #41 / #48 / API-A16）+ 実 `gate.run` ハンドラ（`MockAnthropicClient` の
//    `demo` 既定応答）** で証明する。docs/05 §13.6 / §6.9 API-A16 / docs/02 `F-053 AC-1` `AC-3` `AC-6` / `BR-45` / `BR-47` / `BR-63`。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 `F-053 AC-1`: 投入された全行の氏名・商号・エンド企業名が接頭辞規則（`DEMO_SEED_NAME_RULES`）に従う。メールは `.example`。
//      スキルシートの原本（`skill_sheets`）は 0 行
//   ② 🔴 決定性（`F-053 AC-2` の前提）: 同じ `now` で `reset` → `seed` を 2 回実行すると、同じ ID・同じ件数になる
//   ③ 🔴 `F-053 AC-3`（投入直後の実演の成立）:
//      - C4: 公開済み案件が取引先から見え（#25）、未公開・他社だけに公開した案件は見えない
//      - 匿名候補（`S-016` 相当の `listSharedEngineers`）に共有中の取引先エンジニアだけが匿名 5 項目で出る
//      - `GATE_FAILED` の提案は #41 で 422、`APPROVAL_PENDING` の提案は #41 で 200 → `castProposalToSubmitting` が 1 件
//      - `WON` の提案に `Assignment(ACTIVE, end = T+55)` の行がある
//      - 🔴 seed の `DRAFT` に対して**実物**の #39 → `gate.run`（モック AI = `demo` 既定応答）が全層 PASS で `APPROVAL_PENDING` にする
//        （seed が作った台帳・要件・凍結が実物のパイプラインと整合している）
//      - 🔴 seed の `GATE_FAILED` を #48 で `DRAFT` に戻し、同じ内容の再依頼は 422（seed の FAIL 行が実物の確定結果として効く）、
//        本文を修正しても氏名を残せば #39 → `gate.run` の**機械的照合**が PII 層 `FULL_NAME` で FAIL にする（実物と同じ判定で再現する）
//   ④ 🔴 API-A16 の冪等性: 投入済みの状態で `POST` しても二重投入せず `ALREADY_SEEDED`（件数が増えない）
//   ⑤ 🔴 `F-053 AC-6`: `APP_ENV=production` 相当では `GET` / `POST` とも 403 で、`runSeed` に到達しない
//   ⑥ `PLATFORM_SUPPORT` でも `GET` / `POST` が通る（docs/04 §A-012 権限差分）。閲覧・投入が `AuditLog` に残る
//   ⑦ ✅ T-10-07（`POST /api/admin/demo/reset`。`F-053 AC-2` / `AC-6`。docs/05 §13.6「T-10-07 の実装の決着」）:
//      - 🔴 `AC-6`: `production` / `sandbox` / `staging` 相当では **403** で、`AuditLog` は 0 行増え、`tenants` 行が消えない
//        （`runSeedReset` に到達しない。`readSeedPresence` = `PRESENT` のまま）
//      - 🔴 確認入力（環境名 + テナント名）の不一致は **400** で、何も消えず監査行も残らない（DB に触れる前で止まる）。`tenantId` を
//        載せた body は 400 `VALIDATION`（射程を広げる入力の存在を型で否定する）
//      - 🔴 `AC-2`: 商談で増えた行（`Proposal(DRAFT)` / `ProposalEvent` / `ChatThread` / `Message`）も seed の行も **0 件**になり、
//        **同居する `isolation` プリセットのテナントの行数は 1 行も変わらない**（`deleteTenantData` が `preset.tenantIds` に閉じる）
//      - 🔴 冪等: `reset` を 2 回 → 2 回目は `NOTHING_TO_RESET`（200。エラーにしない）
//      - 🔴 `SeedIncompleteError`（409）からの回復: テナント 1 件だけ残した状態 → `reset` → `seed` で `SEEDED`（件数は初回と同じ）
//      - `PLATFORM_SUPPORT` でも `reset` が通り、`REQUESTED` → `COMPLETED` の 2 行が `AuditLog(admin.demo.reset)` に残る
//
// 🔴 モックは `requireTenantCtx` / `requirePlatformCtx`（ctx の出所）/ `demoSeedRuntime`（起動時 DI の値）/ `MockAnthropicClient` /
//    `gate.run` の enqueue 先（捕捉するだけのキュー）だけ。実 API に接続しない。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient, DEMO_MOCK_ANTHROPIC_SCRIPT } from '@ses/ai';
import { gateRunJobId, type GateRunJob, type GateRunJobQueue } from '@ses/connectors';
import {
  castProposalToSubmitting,
  configurePlatformReadDb,
  configurePlatformWriteDb,
  configureTenantDb,
  disconnectTenantDb,
  resolvePlatformCtx,
  systemTenantCtx,
  withSharedCandidateScope,
  type AuthenticatedPlatformCtx,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  countTenantRows,
  DEMO_SEED_DOMAINS,
  DEMO_SEED_IDS,
  DEMO_SEED_NAME_RULES,
  demoSeedCompanyNames,
  ISOLATION_SEED_IDS,
  readSeedPresence,
  runSeed,
  getSeedPreset,
  type RunSeedResult,
} from '@ses/db/seed';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 「実行日 = T」。相対日の検証（満了 `T+55`）に固定値が要る。 */
const NOW = new Date('2026-09-17T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.106' } as const;
const PLATFORM_OWNER_ID = '01930000-0000-7000-8000-00000010060a';
const PLATFORM_SUPPORT_ID = '01930000-0000-7000-8000-00000010060b';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const requirePlatformCtxMock = vi.fn<() => Promise<AuthenticatedPlatformCtx>>();
vi.mock('../../apps/web/lib/auth/platform-session', () => ({
  requirePlatformCtx: () => requirePlatformCtxMock(),
  readPlatformRequestMeta: async () => META,
}));

/** 🔴 起動時 DI の値（`SEED_DATABASE_URL` と `APP_ENV`）。テストが環境を切り替える唯一の口。 */
const demoSeedRuntimeMock = vi.fn<() => { appEnv: string; databaseUrl: string | null }>();
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  demoSeedRuntime: () => demoSeedRuntimeMock(),
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const projectsRoute = await import('../../apps/web/app/api/(main)/projects/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const transitionRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/transition/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const demoSeedRoute = await import('../../apps/web/app/api/admin/demo/seed/route');
const demoResetRoute = await import('../../apps/web/app/api/admin/demo/reset/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');

const ALPHA = DEMO_SEED_IDS.tenants[0];
const BETA = DEMO_SEED_IDS.tenants[1];
const ALPHA_PARTNER_1 = ALPHA.partners[0]!;
const ALPHA_PARTNER_2 = ALPHA.partners[1]!;

const HOST_SALES: TenantIdentity = { tenantId: ALPHA.tenantId, partnerCompanyId: null, userId: ALPHA.hostSalesUserIds[0] };
const PARTNER_1_SALES: TenantIdentity = {
  tenantId: ALPHA.tenantId,
  partnerCompanyId: ALPHA_PARTNER_1.partnerCompanyId,
  userId: ALPHA_PARTNER_1.salesUserId,
};
const PARTNER_2_SALES: TenantIdentity = {
  tenantId: ALPHA.tenantId,
  partnerCompanyId: ALPHA_PARTNER_2.partnerCompanyId,
  userId: ALPHA_PARTNER_2.salesUserId,
};

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;
let firstRun: RunSeedResult;
/** #39 が積んだ `gate.run` の payload（実ハンドラに渡す）。 */
const enqueuedGateJobs: GateRunJob[] = [];

const capturingGateQueue: GateRunJobQueue = {
  async enqueue(job) {
    enqueuedGateJobs.push(job);
    return 'ENQUEUED';
  },
  async removeFailedJob() {
    return 'NOT_FOUND';
  },
};

function seedOptions(reset: boolean) {
  return { appEnv: 'demo', databaseUrl: database.superuserUrl, preset: 'demo' as const, reset, now: NOW };
}

async function ctxOf(identity: TenantIdentity): Promise<AuthenticatedTenantCtx> {
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（seed の前提の破綻）。');
  return ctx;
}

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function listProjects(ctx: AuthenticatedTenantCtx): Promise<string[]> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await projectsRoute.GET(new Request('https://app.test/api/projects?limit=50'));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly items: readonly { readonly id: string }[] };
  return body.items.map((item) => item.id);
}

async function approve(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return approveRoute.POST(new Request(`https://app.test/api/proposals/${id}/approve`, { method: 'POST' }), segment(id));
}

async function requestGate(ctx: AuthenticatedTenantCtx, id: string): Promise<GateRunJob> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const before = enqueuedGateJobs.length;
  const response = await gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
  expect(response.status, await response.clone().text()).toBe(202);
  const job = enqueuedGateJobs[before];
  if (job === undefined) throw new Error('#39 が gate.run を積んでいません。');
  return job;
}

/** #39 の生の応答（422 を期待する場面用）。 */
async function requestGate2(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
}

/** 🔴 実物の `gate.run`。AI は `demo` の既定応答（全層 PASS。Issue #44）。 */
async function runGate(job: GateRunJob) {
  const handler = createGateRunHandler({
    now: () => NOW,
    aiClient: createAiClient('mock', { mock: { script: [...DEMO_MOCK_ANTHROPIC_SCRIPT] } }),
    models: catalogRoleModelResolver({ DEFAULT: 'claude-sonnet-5', CHEAP: 'claude-haiku-4-5-20251001' }),
    aiDailyCostLimitUsd: '5.000000',
  });
  return handler(job, gateRunJobId({ targetType: job.targetType, targetId: job.targetId, contentHash: job.contentHash }));
}

async function transition(ctx: AuthenticatedTenantCtx, id: string, to: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return transitionRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to }),
    }),
    segment(id),
  );
}

/** #37（内容の更新。`DRAFT` のみ）。修正 → 再検査の「修正」。 */
async function patchBody(ctx: AuthenticatedTenantCtx, id: string, body: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return proposalRoute.PATCH(
    new Request(`https://app.test/api/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    }),
    segment(id),
  );
}

async function adminGet(ctx: AuthenticatedPlatformCtx): Promise<Response> {
  requirePlatformCtxMock.mockResolvedValue(ctx);
  return demoSeedRoute.GET();
}

async function adminPost(ctx: AuthenticatedPlatformCtx): Promise<Response> {
  requirePlatformCtxMock.mockResolvedValue(ctx);
  return demoSeedRoute.POST();
}

/** ✅ T-10-07: `POST /api/admin/demo/reset`（body は JSON。`unknown` を渡せるのは書式違反の再現のため）。 */
async function adminReset(ctx: AuthenticatedPlatformCtx, body: unknown): Promise<Response> {
  requirePlatformCtxMock.mockResolvedValue(ctx);
  return demoResetRoute.POST(
    new Request('https://app.test/api/admin/demo/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** 正しい確認入力（環境名 = 起動時 DI の `APP_ENV` / テナント名 = `demo` プリセットの 1 テナント目の商号）。 */
function resetConfirmation(over: Partial<{ confirmEnv: string; confirmTenantName: string }> = {}) {
  return { confirmEnv: 'demo', confirmTenantName: demoSeedCompanyNames(1).host, ...over };
}

type AdminResetBody = {
  readonly appEnv: string;
  readonly available: true;
  readonly configured: boolean;
  readonly outcome: 'RESET' | 'NOTHING_TO_RESET';
  readonly status: AdminBody['status'];
};

async function countResetAudits(): Promise<number> {
  return admin.auditLog.count({ where: { action: 'admin.demo.reset' } });
}

/** `demo` プリセットの 2 テナントで絞った全業務テーブルの行数（`tenants` を含む）。 */
async function demoRowCounts(): Promise<Record<string, number>> {
  return countTenantRows(admin, DEMO_TENANT_IDS);
}

function totalRows(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

type AdminBody = {
  readonly appEnv: string;
  readonly configured: boolean;
  readonly outcome: 'SEEDED' | 'ALREADY_SEEDED' | null;
  readonly status:
    | { readonly seeded: false }
    | {
        readonly seeded: true;
        readonly seededAt: string;
        readonly tenants: readonly {
          readonly tenantId: string;
          readonly name: string;
          readonly partnerCompanyCount: number;
          readonly engineerCount: number;
          readonly proposalInProgressCount: number;
          readonly assignmentExpiringCount: number;
          readonly gateFailedProposalCount: number;
          readonly sharedEngineerCount: number;
        }[];
      };
};

const DEMO_TENANT_IDS = [ALPHA.tenantId, BETA.tenantId];

function matchesAnyPrefix(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isRulePersonName(value: string): boolean {
  const [family, given, ...rest] = value.split(' ');
  return (
    rest.length === 0 &&
    family !== undefined &&
    given !== undefined &&
    (DEMO_SEED_NAME_RULES.familyNames as readonly string[]).includes(family) &&
    (DEMO_SEED_NAME_RULES.givenNames as readonly string[]).includes(given)
  );
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  firstRun = await runSeed(seedOptions(true));
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_OWNER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_SUPPORT_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  configureGateRunJobQueue(capturingGateQueue);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  resetGateRunJobQueue();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  requirePlatformCtxMock.mockReset();
  demoSeedRuntimeMock.mockReset();
  demoSeedRuntimeMock.mockReturnValue({ appEnv: 'demo', databaseUrl: database.superuserUrl });
});

// ---------------------------------------------------------------------------
// ① F-053 AC-1: 合成データのみ
// ---------------------------------------------------------------------------

describe('① 🔴 F-053 AC-1 / BR-47: 投入された全行が架空であることが語から分かる規則に従う', () => {
  it('テナント・取引先の商号は接頭辞規則（株式会社サンプル / 株式会社ダミー）に従い、投入時の式と一致する', async () => {
    const tenants = await admin.tenant.findMany({ where: { id: { in: DEMO_TENANT_IDS } }, select: { id: true, name: true, environment: true, lifecycleState: true } });
    expect(tenants).toHaveLength(2);
    for (const tenant of tenants) {
      expect(matchesAnyPrefix(tenant.name, DEMO_SEED_NAME_RULES.companyPrefixes), tenant.name).toBe(true);
      expect(tenant.environment).toBe('demo');
      expect(tenant.lifecycleState).toBe('ACTIVE');
    }
    expect(tenants.find((t) => t.id === ALPHA.tenantId)?.name).toBe(demoSeedCompanyNames(1).host);
    expect(tenants.find((t) => t.id === BETA.tenantId)?.name).toBe(demoSeedCompanyNames(2).host);

    const partners = await admin.partnerCompany.findMany({ where: { tenantId: { in: DEMO_TENANT_IDS } }, select: { tenantId: true, name: true, contactName: true } });
    expect(partners.filter((p) => p.tenantId === ALPHA.tenantId)).toHaveLength(5);
    expect(partners.filter((p) => p.tenantId === BETA.tenantId)).toHaveLength(1);
    for (const partner of partners) {
      expect(partner.name.startsWith(DEMO_SEED_NAME_RULES.partnerCompanyPrefix), partner.name).toBe(true);
      expect(isRulePersonName(partner.contactName ?? ''), partner.contactName ?? '').toBe(true);
    }
  });

  it('🔴 エンジニア・利用者の氏名はすべて「規則の姓 + 空白 + 規則の名」であり、現所属会社名も架空の商号だけ', async () => {
    const engineers = await admin.engineer.findMany({
      where: { tenantId: { in: DEMO_TENANT_IDS } },
      select: { tenantId: true, displayName: true, affiliationLabel: true, contactEmail: true, contactPhone: true, birthDate: true },
    });
    // 数十人規模（F-053 入力）。alpha 10 + 5×4 = 30 / beta 4 + 4 = 8。
    expect(engineers.filter((e) => e.tenantId === ALPHA.tenantId)).toHaveLength(30);
    expect(engineers.filter((e) => e.tenantId === BETA.tenantId)).toHaveLength(8);
    for (const engineer of engineers) {
      expect(isRulePersonName(engineer.displayName), engineer.displayName).toBe(true);
      if (engineer.affiliationLabel !== null) {
        expect(engineer.affiliationLabel.startsWith(DEMO_SEED_NAME_RULES.partnerCompanyPrefix), engineer.affiliationLabel).toBe(true);
      }
      expect(engineer.contactEmail?.endsWith('.example'), engineer.contactEmail ?? '').toBe(true);
      // 🔴 実在しうる電話番号・生年月日を置かない。
      expect(engineer.contactPhone).toBeNull();
      expect(engineer.birthDate).toBeNull();
    }
    const users = await admin.user.findMany({ where: { tenantId: { in: DEMO_TENANT_IDS } }, select: { displayName: true, email: true } });
    expect(users.length).toBeGreaterThan(10);
    for (const user of users) {
      expect(isRulePersonName(user.displayName), user.displayName).toBe(true);
      expect(user.email.endsWith('.example'), user.email).toBe(true);
    }
  });

  it('エンド企業名（projects.end_client_name / proposals.recipient_company_name / 契約先）は「架空〜株式会社」だけ', async () => {
    const projects = await admin.project.findMany({ where: { tenantId: { in: DEMO_TENANT_IDS } }, select: { endClientName: true } });
    expect(projects).toHaveLength(12);
    for (const project of projects) {
      expect(project.endClientName?.startsWith(DEMO_SEED_NAME_RULES.endClientPrefix), project.endClientName ?? '').toBe(true);
    }
    const proposals = await admin.proposal.findMany({ where: { tenantId: { in: DEMO_TENANT_IDS } }, select: { recipientCompanyName: true, recipientEmail: true } });
    expect(proposals).toHaveLength(16);
    for (const proposal of proposals) {
      expect(proposal.recipientCompanyName.startsWith(DEMO_SEED_NAME_RULES.endClientPrefix), proposal.recipientCompanyName).toBe(true);
      expect(proposal.recipientEmail.endsWith('.example'), proposal.recipientEmail).toBe(true);
    }
  });

  it('🔴 スキルシートの原本は 1 行も無く、送信ドメインは合成（.example）の VERIFIED 行だけ（Issue #57 の暫定対応）', async () => {
    expect(await admin.skillSheet.count({ where: { tenantId: { in: DEMO_TENANT_IDS } } })).toBe(0);
    const domains = await admin.tenantSendingDomain.findMany({ where: { tenantId: { in: DEMO_TENANT_IDS } }, select: { domain: true, state: true, mailFromDomain: true, verifiedAt: true } });
    expect(domains.map((d) => d.domain).sort()).toEqual([...DEMO_SEED_DOMAINS].sort());
    for (const domain of domains) {
      expect(domain.state).toBe('VERIFIED');
      expect(domain.verifiedAt).not.toBeNull();
      expect(domain.mailFromDomain).toBe(`mail.${domain.domain}`);
    }
  });
});

// ---------------------------------------------------------------------------
// ② 決定性
// ---------------------------------------------------------------------------

describe('② 🔴 決定性: 同じ now で reset → seed を繰り返しても同じ ID・同じ件数（F-053 AC-2 の前提）', () => {
  it('2 回目の投入が 1 回目と同じ件数になり、主要な行の ID と値が一致する', async () => {
    const snapshotBefore = await admin.proposal.findMany({
      where: { tenantId: ALPHA.tenantId },
      select: { id: true, state: true, contentHash: true, engineerId: true, submittedAt: true },
      orderBy: [{ id: 'asc' }],
    });
    const namesBefore = await admin.engineer.findMany({ where: { tenantId: ALPHA.tenantId }, select: { id: true, displayName: true }, orderBy: [{ id: 'asc' }] });

    const secondRun = await runSeed(seedOptions(true));
    expect(secondRun.outcome).toBe('SEEDED');
    expect(secondRun.tenantIds).toEqual(firstRun.tenantIds);
    expect(secondRun.counts).toEqual(firstRun.counts);

    const snapshotAfter = await admin.proposal.findMany({
      where: { tenantId: ALPHA.tenantId },
      select: { id: true, state: true, contentHash: true, engineerId: true, submittedAt: true },
      orderBy: [{ id: 'asc' }],
    });
    expect(snapshotAfter).toEqual(snapshotBefore);
    const namesAfter = await admin.engineer.findMany({ where: { tenantId: ALPHA.tenantId }, select: { id: true, displayName: true }, orderBy: [{ id: 'asc' }] });
    expect(namesAfter).toEqual(namesBefore);
    // 8 状態がすべて揃っている（docs/sprints/SP-10 T-10-06 の列挙）。
    expect(snapshotAfter.map((row) => row.state).sort()).toEqual(
      ['APPROVAL_PENDING', 'APPROVED', 'DRAFT', 'GATE_FAILED', 'INTERVIEW_SCHEDULED', 'LOST', 'SUBMITTED', 'WON'].sort(),
    );
  });

  it('相対日: 送信は T-7 / T-5、ゲート FAIL は T-3、稼働の満了は T+55（docs/05 §13.6）', async () => {
    const submitted = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.interviewScheduled }, select: { submittedAt: true } });
    expect(submitted.submittedAt?.getTime()).toBe(NOW.getTime() - 7 * DAY_MS);
    const submitted2 = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.submitted }, select: { submittedAt: true } });
    expect(submitted2.submittedAt?.getTime()).toBe(NOW.getTime() - 5 * DAY_MS);
    const failedGate = await admin.reviewGate.findFirstOrThrow({
      where: { targetType: 'PROPOSAL', targetId: ALPHA.proposals.gateFailed },
      select: { executedAt: true, piiVerdict: true, findings: true },
    });
    expect(failedGate.executedAt?.getTime()).toBe(NOW.getTime() - 3 * DAY_MS);
    expect(failedGate.piiVerdict).toBe('FAIL');
    expect(failedGate.findings).toEqual([expect.objectContaining({ layer: 'PII', kind: 'FULL_NAME', field: 'body', severity: 'BLOCK', excerpt: '[名前]' })]);
    const assignment = await admin.assignment.findUniqueOrThrow({ where: { id: ALPHA.assignmentId }, select: { state: true, endDate: true, proposalId: true } });
    expect(assignment.state).toBe('ACTIVE');
    expect(assignment.proposalId).toBe(ALPHA.proposals.won);
    expect(assignment.endDate.toISOString().slice(0, 10)).toBe(new Date(NOW.getTime() + 55 * DAY_MS).toISOString().slice(0, 10));
  });

  it('提案依頼は REQUESTED / ACCEPTED / DECLINED が 1 件ずつあり、ACCEPTED から APPROVAL_PENDING の提案が生まれている', async () => {
    const requests = await admin.proposalRequest.findMany({ where: { tenantId: ALPHA.tenantId }, select: { id: true, state: true, declineReason: true }, orderBy: [{ id: 'asc' }] });
    expect(requests.map((r) => [r.id, r.state])).toEqual([
      [ALPHA.proposalRequests.requested, 'REQUESTED'],
      [ALPHA.proposalRequests.accepted, 'ACCEPTED'],
      [ALPHA.proposalRequests.declined, 'DECLINED'],
    ]);
    const pending = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.approvalPending }, select: { proposalRequestId: true, state: true } });
    expect(pending.proposalRequestId).toBe(ALPHA.proposalRequests.accepted);
    expect(pending.state).toBe('APPROVAL_PENDING');
  });

  it('凍結と現在値がずれている組が 1 件ある（SUBMITTED の提案。台帳の経歴が凍結後に 1 行増えている。docs/05 §13.6）', async () => {
    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: ALPHA.proposals.submitted }, select: { careers: true } });
    const proposal = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.submitted }, select: { engineerId: true } });
    const ledger = await admin.engineerCareer.count({ where: { engineerId: proposal.engineerId } });
    expect(Array.isArray(snapshot.careers)).toBe(true);
    expect((snapshot.careers as unknown[]).length).toBe(ledger - 1);
    // 経歴 0 行のエンジニアも混在している（F-008 AC-5 の母集団）。
    const withoutCareers = await admin.engineer.findMany({ where: { tenantId: ALPHA.tenantId, engineerCareers: { none: {} } }, select: { id: true } });
    expect(withoutCareers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ③ F-053 AC-3: 投入直後に実演が成立する
// ---------------------------------------------------------------------------

describe('③ 🔴 F-053 AC-3: 投入直後の demo で 2 本の実演が成立する', () => {
  it('C4: 取引先 1 社目には自社に公開された案件だけが見え、未公開・他社だけに公開した案件は見えない（#25）', async () => {
    const partner1 = await listProjects(await ctxOf(PARTNER_1_SALES));
    expect(partner1.sort()).toEqual([ALPHA.projects.published3, ALPHA.projects.publishedAll, ALPHA.projects.filled].sort());
    // 取引先 2 社目には publishedOne（B にだけ公開）も見える。
    const partner2 = await listProjects(await ctxOf(PARTNER_2_SALES));
    expect(partner2).toContain(ALPHA.projects.publishedOne);
    expect(partner2).not.toContain(ALPHA.projects.unpublishedReady);
    expect(partner2).not.toContain(ALPHA.projects.unpublishedCandidates);
    // ホストは 6 件すべて。
    const host = await listProjects(await ctxOf(HOST_SALES));
    expect(host).toHaveLength(6);
  });

  it('🔴 匿名候補（S-016 相当）に共有中の取引先エンジニア 10 名（5 社 × e1 / e2）だけが匿名 5 項目で出る（シナリオ B の開始地点）', async () => {
    const host = await ctxOf(HOST_SALES);
    const rows = await withSharedCandidateScope(host, ALPHA.projects.unpublishedCandidates, (db) => db.listSharedEngineers());
    const shared = ALPHA.partners.flatMap((partner) => partner.engineerIds.slice(0, 2));
    expect(rows.map((row) => row.engineerId).sort()).toEqual([...shared].sort());
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['availableFrom', 'engineerId', 'prefecture', 'remoteMode', 'skills', 'unitPriceMax', 'unitPriceMin', 'updatedAt']);
    }
    // 🔴 氏名が 1 つも混ざらない（JSON 化して照合）。
    const serialized = JSON.stringify(rows);
    for (const family of DEMO_SEED_NAME_RULES.familyNames) expect(serialized).not.toContain(`${family} `);
  });

  it('🔴 GATE_FAILED の提案は #41 で 422、APPROVAL_PENDING の提案は #41 で 200 → castProposalToSubmitting が 1 件', async () => {
    const host = await ctxOf(HOST_SALES);
    const failed = await approve(host, ALPHA.proposals.gateFailed);
    expect(failed.status).toBe(422);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('INVALID_STATE_TRANSITION');

    const ok = await approve(host, ALPHA.proposals.approvalPending);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as { state: string }).state).toBe('APPROVED');

    // 送信 CAS（送信ジョブの ③）。seed の content_hash / review_gates が三つ巴で一致しているので 1 件更新になる。
    const cast = await castProposalToSubmitting(systemTenantCtx(ALPHA.tenantId, { queue: 'send.proposal', jobId: 'seed-demo-test' }), {
      proposalId: ALPHA.proposals.approvalPending,
      now: NOW,
    });
    expect(cast.kind).toBe('SUBMITTING');
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.approvalPending }, select: { state: true } });
    expect(row.state).toBe('SUBMITTING');
  });

  it('seed の APPROVED の提案も送信 CAS を通る（承認記録とゲート結果が実物の述語を満たす）', async () => {
    const cast = await castProposalToSubmitting(systemTenantCtx(ALPHA.tenantId, { queue: 'send.proposal', jobId: 'seed-demo-test-2' }), {
      proposalId: ALPHA.proposals.approved,
      now: NOW,
    });
    expect(cast.kind).toBe('SUBMITTING');
  });

  it('🔴 seed の DRAFT に対して実物の #39 → gate.run（モック AI = demo 既定応答）が全層 PASS で APPROVAL_PENDING にする', async () => {
    const partner = await ctxOf(PARTNER_1_SALES);
    const job = await requestGate(partner, ALPHA.proposals.draft);
    expect(job.tenantId).toBe(ALPHA.tenantId);
    const outcome = await runGate(job);
    expect(outcome.kind).toBe('COMPLETED');
    if (outcome.kind === 'COMPLETED') {
      expect(outcome.overall).toBe('PASS');
      expect(outcome.aiFailed).toBe(false);
      expect(outcome.transitioned).toBe(true);
    }
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.draft }, select: { state: true } });
    expect(row.state).toBe('APPROVAL_PENDING');
    // そのままホストが #41 で承認できる（実演シナリオ A の「承認」）。
    expect((await approve(await ctxOf(HOST_SALES), ALPHA.proposals.draft)).status).toBe(200);
  });

  it('🔴 seed の GATE_FAILED を #48 で DRAFT に戻し、氏名を消さずに修正して再検査すると機械的照合が PII 層で FAIL にする（実物と同じ判定）', async () => {
    const partner2 = await ctxOf(PARTNER_2_SALES);
    const reopened = await transition(partner2, ALPHA.proposals.gateFailed, 'DRAFT');
    expect(reopened.status, await reopened.clone().text()).toBe(200);
    // 🔴 同じ内容には再依頼できない（#39 は同じハッシュの確定結果があると 422 `GATE_ALREADY_COMPLETED`。P-A-09）。
    //    これは seed の FAIL 行が「実物の確定結果」として扱われている証拠でもある。実演どおり本文を**修正**してから出し直す。
    const same = await requestGate2(partner2, ALPHA.proposals.gateFailed);
    expect(same.status).toBe(422);
    expect(((await same.json()) as { error: { code: string } }).error.code).toBe('GATE_ALREADY_COMPLETED');
    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: ALPHA.proposals.gateFailed }, select: { displayName: true } });
    const patched = await patchBody(partner2, ALPHA.proposals.gateFailed, `${snapshot.displayName} を改めてご提案します。Java での開発経験が 3 年以上あります。`);
    expect(patched.status, await patched.clone().text()).toBe(200);
    const job = await requestGate(partner2, ALPHA.proposals.gateFailed);
    const outcome = await runGate(job);
    expect(outcome.kind).toBe('COMPLETED');
    if (outcome.kind === 'COMPLETED') {
      expect(outcome.overall).toBe('FAIL');
      expect(outcome.aiFailed).toBe(false);
    }
    const gate = await admin.reviewGate.findFirstOrThrow({
      where: { targetType: 'PROPOSAL', targetId: ALPHA.proposals.gateFailed, contentHash: job.contentHash, role: { not: null } },
      select: { piiVerdict: true, findings: true },
    });
    expect(gate.piiVerdict).toBe('FAIL');
    expect(gate.findings).toEqual([expect.objectContaining({ layer: 'PII', kind: 'FULL_NAME', field: 'body', severity: 'BLOCK' })]);
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.gateFailed }, select: { state: true } });
    expect(row.state).toBe('GATE_FAILED');
  });

  it('WON の提案に Assignment（ACTIVE）の行があり、LOST は終端のまま', async () => {
    const assignment = await admin.assignment.findUnique({ where: { proposalId: ALPHA.proposals.won }, select: { state: true } });
    expect(assignment?.state).toBe('ACTIVE');
    const lost = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.lost }, select: { state: true } });
    expect(lost.state).toBe('LOST');
    // SUBMITTED / INTERVIEW_SCHEDULED / WON / LOST には SendAttempt（SUCCEEDED, seq 1）が 1 行ずつある（T-09-05 の規律）。
    const attempts = await admin.sendAttempt.findMany({ where: { tenantId: ALPHA.tenantId, entityType: 'PROPOSAL' }, select: { entityId: true, status: true, attemptSeq: true } });
    expect(attempts.map((a) => a.entityId).sort()).toEqual(
      [ALPHA.proposals.submitted, ALPHA.proposals.interviewScheduled, ALPHA.proposals.won, ALPHA.proposals.lost].sort(),
    );
    for (const attempt of attempts) {
      expect(attempt.status).toBe('SUCCEEDED');
      expect(attempt.attemptSeq).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// ④⑤⑥ API-A16
// ---------------------------------------------------------------------------

describe('④⑤⑥ API-A16（GET / POST /api/admin/demo/seed）', () => {
  it('GET は投入済みの状況（件数・状態・日時・合成の商号だけ）を返し、閲覧が AuditLog(admin.demo.view) に残る', async () => {
    const before = await admin.auditLog.count({ where: { action: 'admin.demo.view' } });
    const response = await adminGet(supportCtx);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as AdminBody;
    expect(body.appEnv).toBe('demo');
    expect(body.configured).toBe(true);
    expect(body.outcome).toBeNull();
    expect(body.status.seeded).toBe(true);
    if (body.status.seeded) {
      expect(body.status.seededAt).toBe(NOW.toISOString());
      expect(body.status.tenants.map((t) => t.tenantId)).toEqual([ALPHA.tenantId, BETA.tenantId]);
      const alpha = body.status.tenants[0]!;
      expect(alpha.name).toBe(demoSeedCompanyNames(1).host);
      expect(alpha.partnerCompanyCount).toBe(5);
      expect(alpha.engineerCount).toBe(30);
      expect(alpha.sharedEngineerCount).toBe(10);
      expect(alpha.assignmentExpiringCount).toBe(1);
      expect(alpha.gateFailedProposalCount).toBe(1);
    }
    // 🔴 応答に氏名・本文・単価が無い。
    const serialized = JSON.stringify(body);
    for (const family of DEMO_SEED_NAME_RULES.familyNames) expect(serialized).not.toContain(`${family} `);
    expect(serialized).not.toContain('offeredUnitPrice');
    expect(await admin.auditLog.count({ where: { action: 'admin.demo.view' } })).toBe(before + 1);
  });

  it('🔴 ④ 投入済みの状態で POST しても二重投入せず ALREADY_SEEDED（件数が増えない。前回の T を返す）', async () => {
    const before = await admin.engineer.count({ where: { tenantId: { in: DEMO_TENANT_IDS } } });
    const response = await adminPost(ownerCtx);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as AdminBody;
    expect(body.outcome).toBe('ALREADY_SEEDED');
    expect(body.status.seeded && body.status.seededAt).toBe(NOW.toISOString());
    expect(await admin.engineer.count({ where: { tenantId: { in: DEMO_TENANT_IDS } } })).toBe(before);
    // 🔴 投入の操作が運営者の記録として**前後の 2 行**残る（REQUESTED = 監査の先行 / COMPLETED = 帰結 ALREADY_SEEDED）。
    const audits = await admin.auditLog.findMany({
      where: { action: 'admin.demo.seed', actorId: PLATFORM_OWNER_ID },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { actorKind: true, summary: true },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const row of audits) expect(row.actorKind).toBe('PLATFORM_USER');
    const phases = audits.map((row) => (row.summary as { phase?: string; outcome?: string }));
    expect(phases.at(-2)).toEqual(expect.objectContaining({ preset: 'demo', phase: 'REQUESTED' }));
    expect(phases.at(-1)).toEqual(expect.objectContaining({ preset: 'demo', phase: 'COMPLETED', outcome: 'ALREADY_SEEDED' }));
  });

  it('⑥ PLATFORM_SUPPORT でも POST できる（docs/04 §A-012 権限差分）', async () => {
    const response = await adminPost(supportCtx);
    expect(response.status).toBe(200);
    expect(((await response.json()) as AdminBody).outcome).toBe('ALREADY_SEEDED');
  });

  it('🔴 ⑤ F-053 AC-6: APP_ENV=production 相当では GET / POST とも 403 で、runSeed に到達しない', async () => {
    for (const appEnv of ['production', 'sandbox', 'staging']) {
      demoSeedRuntimeMock.mockReturnValue({ appEnv, databaseUrl: database.superuserUrl });
      const get = await adminGet(ownerCtx);
      expect(get.status, appEnv).toBe(403);
      expect(((await get.json()) as { error: { code: string } }).error.code).toBe('DEMO_SEED_NOT_AVAILABLE');
      const post = await adminPost(ownerCtx);
      expect(post.status, appEnv).toBe(403);
    }
    // 403 の呼び出しは AuditLog にも投入にも到達していない（監査行が増えない = withPlatformRead の前で止まっている）。
    const views = await admin.auditLog.count({ where: { action: { in: ['admin.demo.view', 'admin.demo.seed'] } } });
    demoSeedRuntimeMock.mockReturnValue({ appEnv: 'demo', databaseUrl: database.superuserUrl });
    await adminGet(ownerCtx);
    expect(await admin.auditLog.count({ where: { action: { in: ['admin.demo.view', 'admin.demo.seed'] } } })).toBe(views + 1);
  });

  it('投入経路（SEED_DATABASE_URL）が無ければ GET は configured=false、POST は 503（他の接続へフォールバックしない）', async () => {
    demoSeedRuntimeMock.mockReturnValue({ appEnv: 'development', databaseUrl: null });
    const get = await adminGet(ownerCtx);
    expect(get.status).toBe(200);
    expect(((await get.json()) as AdminBody).configured).toBe(false);
    const post = await adminPost(ownerCtx);
    expect(post.status).toBe(503);
    expect(((await post.json()) as { error: { code: string } }).error.code).toBe('DEMO_SEED_NOT_CONFIGURED');
  });

  it('🔴 未投入の状態からの POST は投入して SEEDED（201）を返し、GET が seeded=false → true に変わる', async () => {
    // 前提: いったん消す（T-10-07 の reset 相当。ここでは特権接続の runSeed の reset 経路を使う）。
    const { runSeedReset } = await import('@ses/db/seed');
    await runSeedReset({ appEnv: 'demo', databaseUrl: database.superuserUrl, preset: 'demo' });
    const empty = await adminGet(ownerCtx);
    expect(((await empty.json()) as AdminBody).status.seeded).toBe(false);

    const response = await adminPost(ownerCtx);
    expect(response.status, await response.clone().text()).toBe(201);
    const body = (await response.json()) as AdminBody;
    expect(body.outcome).toBe('SEEDED');
    expect(body.status.seeded).toBe(true);
    expect(await admin.engineer.count({ where: { tenantId: { in: DEMO_TENANT_IDS } } })).toBe(38);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// ⑦ ✅ T-10-07: API-A16 `POST /api/admin/demo/reset`（F-053 AC-2 / AC-6。docs/05 §13.6「T-10-07 の実装の決着」）
// ---------------------------------------------------------------------------
// 🔴 前提: ⑥ の最後で投入済み（SEEDED）に戻っている。以下は順に実行される（vitest はファイル内の it を直列に走らせる）。

describe('⑦ ✅ T-10-07: API-A16 reset（POST /api/admin/demo/reset）', () => {
  const ISOLATION_TENANT_IDS = ISOLATION_SEED_IDS.tenants.map((tenant) => tenant.tenantId);
  /** 商談で増えた行の ID（`AC-2` の検証対象）。 */
  const ADDED_PROPOSAL_ID = '01930000-0000-7000-8000-00000010070a';
  const ADDED_THREAD_ID = '01930000-0000-7000-8000-00000010070b';

  it('🔴 F-053 AC-6: APP_ENV=production / sandbox / staging 相当では reset が 403 で、AuditLog は 0 行増え、tenants 行が消えない（runSeedReset に到達しない）', async () => {
    const auditsBefore = await countResetAudits();
    const rowsBefore = await demoRowCounts();
    expect(rowsBefore.tenants).toBe(2);
    for (const appEnv of ['production', 'sandbox', 'staging']) {
      demoSeedRuntimeMock.mockReturnValue({ appEnv, databaseUrl: database.superuserUrl });
      // 🔴 確認入力を「その環境の名前」で正しく揃えても通らない（環境ガードは確認入力より前にある）。
      const response = await adminReset(ownerCtx, resetConfirmation({ confirmEnv: appEnv }));
      expect(response.status, appEnv).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('DEMO_SEED_NOT_AVAILABLE');
    }
    expect(await countResetAudits()).toBe(auditsBefore);
    // ⑥ の最後の投入は API 経由（T = 現在時刻）なので `seededAt` は固定値ではない。見るのは「揃っている（PRESENT）」こと。
    expect((await readSeedPresence(admin, getSeedPreset('demo'))).kind).toBe('PRESENT');
    expect(await demoRowCounts()).toEqual(rowsBefore);
  });

  it('🔴 確認入力の不一致は 400 DEMO_RESET_CONFIRMATION_MISMATCH で、何も消えず監査行も残らない（DB に触れる前で止まる）', async () => {
    const auditsBefore = await countResetAudits();
    const rowsBefore = await demoRowCounts();
    const mismatches = [
      resetConfirmation({ confirmEnv: 'production' }), // 別の環境名
      resetConfirmation({ confirmEnv: 'development' }), // 対象環境の名前でも接続先（demo）と違えば止まる
      resetConfirmation({ confirmEnv: 'DEMO' }), // 大文字小文字を寄せない
      resetConfirmation({ confirmTenantName: '株式会社サンプル' }), // 部分一致
      resetConfirmation({ confirmTenantName: demoSeedCompanyNames(1).partners[0] ?? '' }), // 取引先の商号（テナントではない）
      resetConfirmation({ confirmTenantName: 'Tenant A' }), // isolation プリセットのテナント名
    ];
    for (const body of mismatches) {
      const response = await adminReset(ownerCtx, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('DEMO_RESET_CONFIRMATION_MISMATCH');
    }
    // 書式違反（空文字 / 欠落 / 🔴 `tenantId` を載せた = 射程を広げる入力）は 400 VALIDATION。
    for (const body of [
      { confirmEnv: '', confirmTenantName: demoSeedCompanyNames(1).host },
      { confirmEnv: 'demo' },
      { ...resetConfirmation(), tenantId: ISOLATION_TENANT_IDS[0] },
      null,
    ]) {
      const response = await adminReset(ownerCtx, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('VALIDATION');
    }
    expect(await countResetAudits()).toBe(auditsBefore);
    expect(await demoRowCounts()).toEqual(rowsBefore);
  });

  it('投入経路（SEED_DATABASE_URL）が無ければ reset は 503 で、監査行も残らない', async () => {
    const auditsBefore = await countResetAudits();
    demoSeedRuntimeMock.mockReturnValue({ appEnv: 'development', databaseUrl: null });
    const response = await adminReset(ownerCtx, resetConfirmation({ confirmEnv: 'development' }));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('DEMO_SEED_NOT_CONFIGURED');
    expect(await countResetAudits()).toBe(auditsBefore);
    expect((await demoRowCounts()).tenants).toBe(2);
  });

  it('🔴 F-053 AC-2: 商談で増えた提案・履歴・チャットも seed の行も 0 件になり、同居する isolation プリセットの行は 1 行も消えない（PLATFORM_SUPPORT で実行）', async () => {
    // 前提 1: 「前の商談」で増えた行。seed の DRAFT を複製した提案 + その履歴 + 取引先とのスレッド + メッセージ。
    const draft = await admin.proposal.findUniqueOrThrow({ where: { id: ALPHA.proposals.draft } });
    await admin.proposal.create({ data: { ...draft, id: ADDED_PROPOSAL_ID } });
    await admin.proposalEvent.create({
      data: {
        tenantId: ALPHA.tenantId,
        ownerPartnerCompanyId: draft.ownerPartnerCompanyId,
        proposalId: ADDED_PROPOSAL_ID,
        kind: 'NOTE',
        note: '商談メモ（合成）',
      },
    });
    await admin.chatThread.create({
      data: { id: ADDED_THREAD_ID, tenantId: ALPHA.tenantId, kind: 'COMPANY', partnerCompanyId: ALPHA_PARTNER_1.partnerCompanyId },
    });
    await admin.message.create({
      data: {
        tenantId: ALPHA.tenantId,
        ownerPartnerCompanyId: ALPHA_PARTNER_1.partnerCompanyId,
        threadId: ADDED_THREAD_ID,
        senderUserId: ALPHA_PARTNER_1.salesUserId,
        senderPartnerCompanyId: ALPHA_PARTNER_1.partnerCompanyId,
        body: '商談中のやり取り（合成）',
      },
    });
    expect(await admin.proposal.count({ where: { id: ADDED_PROPOSAL_ID } })).toBe(1);
    expect(await admin.message.count({ where: { threadId: ADDED_THREAD_ID } })).toBe(1);

    // 前提 2: 🔴 他のテナント（isolation プリセット）を同居させ、行数を控える。
    await runSeed({ appEnv: 'demo', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
    const isolationBefore = await countTenantRows(admin, ISOLATION_TENANT_IDS);
    expect(isolationBefore.tenants).toBe(2);
    expect(totalRows(isolationBefore)).toBeGreaterThan(50);
    const demoBefore = await demoRowCounts();
    expect(totalRows(demoBefore)).toBeGreaterThan(100);

    // 実行（PLATFORM_SUPPORT。docs/04 §A-012 権限差分）。
    const auditsBefore = await countResetAudits();
    demoSeedRuntimeMock.mockReturnValue({ appEnv: 'demo', databaseUrl: database.superuserUrl });
    const response = await adminReset(supportCtx, resetConfirmation({ confirmTenantName: demoSeedCompanyNames(2).host }));
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as AdminResetBody;
    expect(body.outcome).toBe('RESET');
    expect(body.available).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.status.seeded).toBe(false);

    // 🔴 増えた行も seed の行も 0 件（テーブルを列挙せず、tenant_id を持つ全表の実測で見る）。
    expect(await admin.proposal.count({ where: { id: ADDED_PROPOSAL_ID } })).toBe(0);
    expect(await admin.proposalEvent.count({ where: { proposalId: ADDED_PROPOSAL_ID } })).toBe(0);
    expect(await admin.chatThread.count({ where: { id: ADDED_THREAD_ID } })).toBe(0);
    expect(await admin.message.count({ where: { threadId: ADDED_THREAD_ID } })).toBe(0);
    const demoAfter = await demoRowCounts();
    expect(totalRows(demoAfter)).toBe(0);
    expect(demoAfter).toEqual({ tenants: 0 });
    // 🔴 他テナント（isolation）の行数は 1 行も変わらない（`deleteTenantData` が `preset.tenantIds` に閉じる）。
    expect(await countTenantRows(admin, ISOLATION_TENANT_IDS)).toEqual(isolationBefore);

    // GET は seeded=false に戻る（readSeedPresence と同じ判定）。
    const get = await adminGet(ownerCtx);
    expect(((await get.json()) as AdminBody).status.seeded).toBe(false);

    // 🔴 監査: REQUESTED（削除の前）→ COMPLETED（outcome=RESET）の 2 行が PLATFORM_SUPPORT の操作として残る。
    expect(await countResetAudits()).toBe(auditsBefore + 2);
    const audits = await admin.auditLog.findMany({
      where: { action: 'admin.demo.reset', actorId: PLATFORM_SUPPORT_ID },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { actorKind: true, summary: true },
    });
    expect(audits).toHaveLength(2);
    for (const row of audits) expect(row.actorKind).toBe('PLATFORM_USER');
    expect(audits[0]?.summary).toEqual(expect.objectContaining({ preset: 'demo', phase: 'REQUESTED' }));
    expect(audits[1]?.summary).toEqual(expect.objectContaining({ preset: 'demo', phase: 'COMPLETED', outcome: 'RESET' }));
    // 応答に氏名・本文・単価が無い。
    const serialized = JSON.stringify(body);
    for (const family of DEMO_SEED_NAME_RULES.familyNames) expect(serialized).not.toContain(`${family} `);
    expect(serialized).not.toContain('商談');
  }, 180_000);

  it('🔴 冪等: reset を 2 回目に実行しても 200 NOTHING_TO_RESET で、エラーにならず他テナントも変わらない', async () => {
    const isolationBefore = await countTenantRows(admin, ISOLATION_TENANT_IDS);
    const auditsBefore = await countResetAudits();
    const response = await adminReset(ownerCtx, resetConfirmation());
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as AdminResetBody;
    expect(body.outcome).toBe('NOTHING_TO_RESET');
    expect(body.status.seeded).toBe(false);
    expect(await demoRowCounts()).toEqual({ tenants: 0 });
    expect(await countTenantRows(admin, ISOLATION_TENANT_IDS)).toEqual(isolationBefore);
    expect(await countResetAudits()).toBe(auditsBefore + 2);
    const last = await admin.auditLog.findFirst({
      where: { action: 'admin.demo.reset' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { summary: true },
    });
    expect(last?.summary).toEqual(expect.objectContaining({ phase: 'COMPLETED', outcome: 'NOTHING_TO_RESET' }));
  });

  it('🔴 SeedIncompleteError（409）からの回復: テナント 1 件だけ残した状態 → seed は 409 → reset（孤児行も消える）→ seed で SEEDED（件数は初回と同じ）', async () => {
    // 投入し直す（201 SEEDED）。
    const seeded = await adminPost(ownerCtx);
    expect(seeded.status, await seeded.clone().text()).toBe(201);
    expect(totalRows(await demoRowCounts())).toBeGreaterThan(100);

    // 「前回の投入が途中で止まった」相当を作る: beta の tenants 行だけを消す（子の行は残る = 孤児）。
    // 🔴 FK とトリガをこのトランザクションの中だけ外す（`deleteTenantData` と同じ手法。テスト前提づくりの特権接続）。
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM tenants WHERE id = ${BETA.tenantId}::uuid`;
    });
    expect(await readSeedPresence(admin, getSeedPreset('demo'))).toEqual({ kind: 'INCOMPLETE', presentTenantIds: [ALPHA.tenantId] });
    expect(await admin.engineer.count({ where: { tenantId: BETA.tenantId } })).toBe(8);

    // seed は 409（黙って上書きも追記もしない）。GET は seeded=false（揃っていない）。
    const conflict = await adminPost(ownerCtx);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe('DEMO_SEED_INCOMPLETE');
    expect(((await (await adminGet(ownerCtx)).json()) as AdminBody).status.seeded).toBe(false);

    // 回復手段はリセットだけ。テナント名は alpha / beta のどちらでも通る（対象は 2 テナントの組）。
    const reset = await adminReset(ownerCtx, resetConfirmation({ confirmTenantName: demoSeedCompanyNames(2).host }));
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect(((await reset.json()) as AdminResetBody).outcome).toBe('RESET');
    // 🔴 孤児行（tenants 行の無い beta の子）も含めて 0 件。
    expect(await demoRowCounts()).toEqual({ tenants: 0 });
    expect(await admin.engineer.count({ where: { tenantId: BETA.tenantId } })).toBe(0);

    // 投入 → SEEDED。決定的なので件数は初回（beforeAll の runSeed）と一致する。
    const reseeded = await adminPost(ownerCtx);
    expect(reseeded.status, await reseeded.clone().text()).toBe(201);
    expect(((await reseeded.json()) as AdminBody).outcome).toBe('SEEDED');
    expect(await demoRowCounts()).toEqual(firstRun.counts);
    expect(((await (await adminGet(ownerCtx)).json()) as AdminBody).status.seeded).toBe(true);
  }, 240_000);
});
