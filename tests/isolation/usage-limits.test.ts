// tests/isolation/usage-limits.test.ts
// 🔴 T-10-03 の完了判定 = `F-027 AC-1` / `AC-2` / `AC-4` と処理⑤の結合テスト（docs/02 章 7.5 / docs/05 §5.8 /
//    §16.1 / migration 20260920000000。**実 DB（RLS 付き）**。実 Anthropic API にも実 SES にも接続しない）:
//
//   ① 🔴 **3 種の挙動差**: AI コスト上限 = 停止（`STOP_AI`）/ AI 件数クォータ = 従量（`METERED`）/
//      ストレージ = アップロード停止（`STOP_UPLOAD`）が、同じ実行の評価・監査・応答で**別の効果**として現れる
//   ② `AC-1`: AI の日次コスト上限に到達すると `usage.limit-check` が `REACHED` を記録し、
//      ホストの `GET /api/usage` に「停止中・理由・再開時刻・止まった機能（品質ゲート）」が出る
//   ③ 🔴 `AC-1` / `BR-04`: パートナーは `GET /api/usage` を呼べず（403）、`GET /api/usage/blocked-notice` は
//      **停止の事実と理由だけ**（残量・上限・リセット時刻のキーが無い）。停止していなければ RLS により 0 行
//   ④ 🔴 `AC-6`: ホストの応答に金額（USD）の項目が無い。`gate-inspector` のキーが残量に無い（`AC-7`）
//   ⑤ 🔴 `AC-4`: 80% で管理者（`OWNER`。分類 1）宛の `EmailDispatch` が作られ、**同じ日に 2 通目は作られない**。
//      監査ログ（`usage.limit_nearing` / `usage.limit_reached` / `usage.limit_released`）は**状態が変わったときだけ**
//   ⑥ `AC-2`: メールの日次（停止 = `BLOCK`）と分次（待機 = `DEFER`）が応答で区別される
//   ⑦ テナント境界: 他テナントの水準・通知・監査ログに 1 行も混ざらない
//
// 🔴 通す経路は本番と同じ 1 本である: 実物の Route Handler（`withApiRoute`）→ ガード → `lib/usage/view.ts` →
//    `@ses/db`（RLS + Prisma 拡張）。差し替えるのは `requireTenantCtx`（T-03-01 の seam）と
//    `usageLimitsRuntime`（起動時 DI の値）だけである。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configurePlatformReadDb,
  configureTenantDb,
  disconnectTenantDb,
  resolvePlatformCtx,
  USAGE_LIMIT_AUDIT_ACTIONS,
  type AuthenticatedPlatformCtx,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { listUsageLimitAlerts } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, isolationSeedEmails, runSeed } from '@ses/db/seed';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。他の isolation テストと同じ）。
import { usagePeriodKey } from '../../packages/domain/src/usage/period-key.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.20' } as const;
const GB = 1024n * 1024n * 1024n;

/** 🔴 ルートは `new Date()` を使うため、ジョブも同じ実時刻で走らせる（期間キーが一致する）。 */
const NOW = new Date();
const DAY = usagePeriodKey('DAY', NOW);
const MONTH = usagePeriodKey('MONTH', NOW);

/** 🔴 起動時 DI（`packages/config`）の値。ワーカーと主平面に**同じ値**を渡す。金額を含まない。 */
const LIMITS = {
  warnPercent: 80,
  aiUnitQuotas: {
    AI_UNIT_SHEET_PARSE: 180,
    AI_UNIT_MATCH_RATIONALE: 6_200,
    AI_UNIT_PROPOSAL_DRAFT: 180,
    AI_UNIT_RENEWAL_SUMMARY: 20,
  },
  emailDailyLimit: 500,
  emailMinuteLimit: 30,
  storageLimitBytes: 50n * GB,
} as const;
/** 🔴 金額はワーカーだけが持つ（`AI_DAILY_COST_LIMIT_USD_DEFAULT`）。主平面のモックには無い。 */
const AI_DAILY_COST_LIMIT_USD = '5.000000';
const PLATFORM_USER_ID = '01930000-0000-7000-8000-0000000000aa';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  usageLimitsRuntime: () => ({
    warnPercent: LIMITS.warnPercent,
    aiUnitQuotas: LIMITS.aiUnitQuotas,
    emailDailyLimit: LIMITS.emailDailyLimit,
    emailMinuteLimit: LIMITS.emailMinuteLimit,
    storageLimitBytes: LIMITS.storageLimitBytes,
  }),
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const usageRoute = await import('../../apps/web/app/api/(main)/usage/route');
const blockedNoticeRoute = await import('../../apps/web/app/api/(main)/usage/blocked-notice/route');
const { createUsageLimitCheckHandler, USAGE_LIMIT_CHECK_JOB } = await import(
  '../../apps/worker/src/jobs/usage-limit-check.js'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];
const OWNER_EMAIL = isolationSeedEmails(1).hostOwner;

const HOST_SALES: TenantIdentity = { tenantId: TENANT_1.tenantId, partnerCompanyId: null, userId: TENANT_1.hostUserId };
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
const TENANT_2_HOST: TenantIdentity = { tenantId: TENANT_2.tenantId, partnerCompanyId: null, userId: TENANT_2.hostUserId };

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
/** 🔴 素の `app_tenant` 接続（RLS の実挙動を見る）。 */
let rawTenant: UnextendedClient;
let platformCtx: AuthenticatedPlatformCtx;

type ErrorBody = { readonly error: { readonly code: string } };

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await admin.membership.updateMany({ where: { tenantId: identity.tenantId, userId: identity.userId }, data: { role } });
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function callUsage(ctx: AuthenticatedTenantCtx): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return usageRoute.GET(new Request('https://app.test/api/usage'));
}

async function callBlockedNotice(ctx: AuthenticatedTenantCtx): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return blockedNoticeRoute.GET(new Request('https://app.test/api/usage/blocked-notice'));
}

async function upsertCounter(
  tenantId: string,
  periodKind: 'DAY' | 'MONTH',
  periodKey: string,
  metric: string,
  value: string,
  reservedValue = '0',
): Promise<void> {
  await admin.$executeRawUnsafe(
    `INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5::numeric, $6::numeric, now())
     ON CONFLICT (tenant_id, period_kind, period_key, metric)
     DO UPDATE SET value = EXCLUDED.value, reserved_value = EXCLUDED.reserved_value`,
    tenantId,
    periodKind,
    periodKey,
    metric,
    value,
    reservedValue,
  );
}

function makeHandler() {
  const enqueued: unknown[] = [];
  const handler = createUsageLimitCheckHandler({
    now: () => NOW,
    models: { resolve: async () => 'claude-sonnet-5' },
    aiDailyCostLimitUsd: AI_DAILY_COST_LIMIT_USD,
    usageLimits: LIMITS,
    enqueueEmailDispatch: async (job) => {
      enqueued.push(job);
    },
  });
  return { run: (tenantId: string) => handler({ tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:1`), enqueued };
}

async function states(tenantId: string) {
  const rows = await admin.usageLimitState.findMany({ where: { tenantId }, orderBy: { metric: 'asc' } });
  return Object.fromEntries(rows.map((row) => [row.metric, { level: row.level, notifiedLevel: row.notifiedLevel, notifiedOn: row.notifiedOn }]));
}

type AuditRow = Record<string, unknown> & {
  readonly action: string;
  readonly actorKind: string;
  readonly actorId: string | null;
};

async function audits(tenantId: string): Promise<AuditRow[]> {
  const rows = await admin.auditLog.findMany({
    where: { tenantId, action: { startsWith: 'usage.limit_' } },
    orderBy: { createdAt: 'asc' },
    select: { action: true, actorKind: true, actorId: true, summary: true },
  });
  return rows.map((row) => ({
    ...(row.summary as Record<string, unknown>),
    action: row.action,
    actorKind: row.actorKind,
    actorId: row.actorId,
  }));
}

async function dispatches(tenantId: string) {
  const rows = await admin.emailDispatch.findMany({
    where: { tenantId, templateKey: { startsWith: 'USAGE_LIMIT_' } },
    orderBy: { dedupeKey: 'asc' },
    select: { templateKey: true, dedupeKey: true, recipientClass: true, recipientEmail: true, status: true },
  });
  return rows;
}

/** 🔴 素の `app_tenant` 接続で、指定した文脈から `usage_limit_states` を読む（RLS の実挙動）。 */
async function rawStates(identity: TenantIdentity): Promise<Array<{ metric: string; level: string }>> {
  return rawTenant.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.tenant_id', $1, true),
              set_config('app.partner_company_id', $2, true),
              set_config('app.actor_user_id', $3, true),
              set_config('app.shared_scope', 'off', true)`,
      identity.tenantId,
      identity.partnerCompanyId ?? '',
      identity.userId,
    );
    return tx.$queryRawUnsafe<Array<{ metric: string; level: string }>>(
      `SELECT metric, level FROM usage_limit_states ORDER BY metric`,
    );
  });
}

async function resetTenant(tenantId: string): Promise<void> {
  await admin.$executeRawUnsafe(`DELETE FROM usage_limit_states WHERE tenant_id = $1::uuid`, tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM usage_counters WHERE tenant_id = $1::uuid`, tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM email_dispatches WHERE tenant_id = $1::uuid AND template_key LIKE 'USAGE_LIMIT_%'`, tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = $1::uuid AND action LIKE 'usage.limit_%'`, tenantId);
}

function deepKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => deepKeys(item, prefix));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [`${prefix}${key}`, ...deepKeys(child, `${prefix}${key}.`)]);
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
  admin = createUnextendedClient(database.superuserUrl);
  rawTenant = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  platformCtx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await rawTenant?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await resetTenant(TENANT_1.tenantId);
  await resetTenant(TENANT_2.tenantId);
});

describe('① 3 種の挙動差 + ⑤ 監査は状態が変わったときだけ', () => {
  it('🔴 同じ実行で AI コスト = 停止 / 件数 = 従量 / ストレージ = アップロード停止 が別の効果として記録される', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', AI_DAILY_COST_LIMIT_USD); // 上限ちょうど = 1 回ぶんも入らない
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '180'); // 使い切り
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'STORAGE_BYTES', (50n * GB).toString());

    const { run, enqueued } = makeHandler();
    const first = await run(TENANT_1.tenantId);
    expect(first.aiStopped).toBe(true);
    expect(first.changed).toBe(3);
    expect(first.audited).toBe(3);

    const recorded = await states(TENANT_1.tenantId);
    expect(recorded.AI_COST_USD?.level).toBe('REACHED');
    expect(recorded.AI_UNIT_SHEET_PARSE?.level).toBe('REACHED');

    // 🔴 F-057（運営者の監視）への通知 = 管理平面の読み取り（`app_platform` の列 GRANT + platform_read ポリシー）から
    //    到達・接近が見える。テナント ID と計測・水準・期間だけで、金額も名前も無い。
    const alerts = await listUsageLimitAlerts(platformCtx);
    expect(alerts.countsByLevel).toEqual({ NEARING: 0, REACHED: 3 });
    expect(alerts.items.map((item) => [item.tenantId, item.metric, item.level]).sort()).toEqual([
      [TENANT_1.tenantId, 'AI_COST_USD', 'REACHED'],
      [TENANT_1.tenantId, 'AI_UNIT_SHEET_PARSE', 'REACHED'],
      [TENANT_1.tenantId, 'STORAGE_BYTES', 'REACHED'],
    ]);
    expect(deepKeys(alerts).filter((key) => /usd|cost|price|amount|name|email/i.test(key))).toEqual([]);
    expect(recorded.STORAGE_BYTES?.level).toBe('REACHED');
    expect(recorded.EMAIL_COUNT?.level).toBe('BELOW');

    // 🔴 同一トランザクションの 3 行は `created_at` が同値になる（`now()` はトランザクション開始時刻）ため、計測名で並べる。
    const log = (await audits(TENANT_1.tenantId)).sort((left, right) => String(left.metric).localeCompare(String(right.metric)));
    expect(log.map((row) => [row.action, row.metric, row.effect, row.actorKind, row.actorId])).toEqual([
      [USAGE_LIMIT_AUDIT_ACTIONS.REACHED, 'AI_COST_USD', 'STOP_AI', 'SYSTEM', null],
      [USAGE_LIMIT_AUDIT_ACTIONS.REACHED, 'AI_UNIT_SHEET_PARSE', 'METERED', 'SYSTEM', null],
      [USAGE_LIMIT_AUDIT_ACTIONS.REACHED, 'STORAGE_BYTES', 'STOP_UPLOAD', 'SYSTEM', null],
    ]);
    // 🔴 監査ログの summary に金額が無い（種別・水準・期間・効果・ジョブ名だけ）。
    for (const row of log) {
      expect(Object.keys(row).sort()).toEqual(['action', 'actorId', 'actorKind', 'effect', 'from', 'job', 'metric', 'periodKey', 'periodKind', 'to']);
      expect(row.job).toBe(USAGE_LIMIT_CHECK_JOB);
    }
    // 到達の通知（3 種すべて。管理者 = OWNER 1 人）。
    expect(enqueued).toHaveLength(3);

    // 🔴 同じ状態で再評価しても、監査ログも通知も増えない（状態が変わったときだけ）。
    const second = await run(TENANT_1.tenantId);
    expect(second).toEqual({ changed: 0, audited: 0, notices: 0, queued: 0, quotaNoticesQueued: 0, aiStopped: true });
    expect(await audits(TENANT_1.tenantId)).toHaveLength(3);
    expect(await dispatches(TENANT_1.tenantId)).toHaveLength(3);
  });

  it('🔴 解除は REACHED から下がったときだけ記録される（翌日のリセット相当 = カウンタ 0）', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', AI_DAILY_COST_LIMIT_USD);
    const { run } = makeHandler();
    await run(TENANT_1.tenantId);
    expect((await states(TENANT_1.tenantId)).AI_COST_USD?.level).toBe('REACHED');

    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', '0');
    const released = await run(TENANT_1.tenantId);
    expect(released.aiStopped).toBe(false);
    expect(released.changed).toBe(1);
    expect((await states(TENANT_1.tenantId)).AI_COST_USD?.level).toBe('BELOW');
    const log = await audits(TENANT_1.tenantId);
    expect(log.map((row) => [row.action, row.from, row.to])).toEqual([
      [USAGE_LIMIT_AUDIT_ACTIONS.REACHED, 'BELOW', 'REACHED'],
      [USAGE_LIMIT_AUDIT_ACTIONS.RELEASED, 'REACHED', 'BELOW'],
    ]);
  });
});

describe('② AC-1 ホストの応答 / ④ AC-6 金額の不在 / AC-7', () => {
  it('🔴 停止中: aiDailyStop に理由・再開時刻・止まった機能（品質ゲート）が出る。残量は件数、金額のキーは無い', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', AI_DAILY_COST_LIMIT_USD);
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '118');
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_RENEWAL_SUMMARY', '25'); // 超過中（従量）
    await makeHandler().run(TENANT_1.tenantId);

    const response = await callUsage(await ctxOf(HOST_SALES, 'SALES'));
    expect(response.status).toBe(200);
    const view = (await response.json()) as Record<string, unknown>;

    expect(view.aiDailyStop).toEqual({
      stopped: true,
      reasonKey: 'quota.aiDaily',
      since: expect.any(String),
      resetAt: expect.any(String),
      stoppedFeatures: ['reviewGate'],
    });
    // 再開時刻は JST の翌 0 時（= UTC 15:00）。
    expect(new Date((view.aiDailyStop as { resetAt: string }).resetAt).getUTCHours()).toBe(15);

    const aiUnits = view.aiUnits as Record<string, Record<string, unknown>>;
    expect(aiUnits.sheetParse).toEqual({ used: 118, quota: 180, remaining: 62, overageCount: 0, level: 'BELOW', onExceed: 'METERED' });
    expect(aiUnits.renewalSummary).toEqual({ used: 25, quota: 20, remaining: 0, overageCount: 5, level: 'REACHED', onExceed: 'METERED' });
    expect(Object.keys(aiUnits).sort()).toEqual(['matchRationale', 'proposalDraft', 'renewalSummary', 'sheetParse']);
    expect((view.storage as Record<string, unknown>).onExceed).toBe('STOP_UPLOAD');
    expect((view.email as Record<string, unknown>).onExceed).toBe('STOP_DAILY_DEFER_MINUTE');
    // 🔴 唯一の金額は請求見込みであり、Phase 1 は算出できない（0 と偽らない）。
    expect(view.overageEstimateJpy).toBeNull();

    // 🔴 AC-6: 金額（USD）の項目が 1 つも無い。AC-7: gate-inspector のキーが無い。
    const keys = deepKeys(view);
    expect(keys.filter((key) => /usd|cost|price|amount/i.test(key))).toEqual([]);
    expect(keys.filter((key) => /gate|inspector/i.test(key))).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(AI_DAILY_COST_LIMIT_USD);
  });

  it('停止していなければ aiDailyStop.stopped = false（ジョブが評価していないテナントも同じ）', async () => {
    const response = await callUsage(await ctxOf(HOST_SALES, 'SALES'));
    expect(response.status).toBe(200);
    const view = (await response.json()) as { aiDailyStop: unknown; seats: unknown };
    expect(view.aiDailyStop).toEqual({ stopped: false });
    expect(view.seats).toEqual({ used: 0, limit: null });
  });

  it('🔴 VIEWER も残量を閲覧できる（ホストロール。閲覧のみ）', async () => {
    const response = await callUsage(await ctxOf(HOST_SALES, 'VIEWER'));
    expect(response.status).toBe(200);
  });
});

describe('③ AC-1 / BR-04: パートナーには停止の事実と理由だけ', () => {
  it('🔴 GET /api/usage はパートナー所属ロールに 403（残量・上限値はテナントの契約情報）', async () => {
    for (const role of ['PARTNER_SALES', 'PARTNER_ADMIN'] as const) {
      const response = await callUsage(await ctxOf(PARTNER_1_USER, role));
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
    }
  });

  it('🔴 停止中: blocked-notice は { blocked: true, reasonKey } だけ（残量・上限・リセット時刻のキーが無い）', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', AI_DAILY_COST_LIMIT_USD);
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'STORAGE_BYTES', (45n * GB).toString()); // 90%（接近）
    await makeHandler().run(TENANT_1.tenantId);

    for (const identity of [PARTNER_1_USER, PARTNER_2_USER]) {
      const response = await callBlockedNotice(await ctxOf(identity, 'PARTNER_SALES'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ blocked: true, reasonKey: 'quota.aiDaily' });
      expect(Object.keys(body).sort()).toEqual(['blocked', 'reasonKey']);
    }
    // 🔴 RLS: パートナー文脈から見える行は「AI が停止中」の 1 行だけ（接近中のストレージの行は見えない）。
    expect(await rawStates(PARTNER_1_USER)).toEqual([{ metric: 'AI_COST_USD', level: 'REACHED' }]);
    // ホストは全行。
    const hostRows = await rawStates(HOST_SALES);
    expect(hostRows.find((row) => row.metric === 'STORAGE_BYTES')?.level).toBe('NEARING');
    expect(hostRows).toHaveLength(7);
    // ホスト側の応答にも同じ事実が出る（同じ経路 #70 は全ロールで同じ形）。
    const host = await callBlockedNotice(await ctxOf(HOST_SALES, 'SALES'));
    expect(await host.json()).toEqual({ blocked: true, reasonKey: 'quota.aiDaily' });
  });

  it('🔴 停止していない（接近中を含む）: パートナーからは 0 行 = blocked: false', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', '4.500000'); // 90% だが 1 回ぶんは入る
    await makeHandler().run(TENANT_1.tenantId);
    expect((await states(TENANT_1.tenantId)).AI_COST_USD?.level).toBe('NEARING');

    const response = await callBlockedNotice(await ctxOf(PARTNER_1_USER, 'PARTNER_ADMIN'));
    expect(await response.json()).toEqual({ blocked: false, reasonKey: null });
    expect(await rawStates(PARTNER_1_USER)).toEqual([]);
  });
});

describe('⑤ AC-4: 80% の通知は管理者宛・1 日 1 回', () => {
  it('🔴 80% で OWNER（分類 1）宛の EmailDispatch が 1 通。再評価しても 2 通目は作られない。到達で別の 1 通', async () => {
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '144'); // 80% ちょうど
    const { run, enqueued } = makeHandler();

    const first = await run(TENANT_1.tenantId);
    expect(first.notices).toBe(1);
    expect(first.queued).toBe(1);
    let rows = await dispatches(TENANT_1.tenantId);
    expect(rows).toEqual([
      {
        templateKey: 'USAGE_LIMIT_NEARING',
        dedupeKey: expect.stringMatching(new RegExp(`^USAGE_LIMIT_NEARING:AI_UNIT_SHEET_PARSE#NEARING#${DAY}:[0-9a-f]{16}$`)),
        recipientClass: 'HOST_MEMBER',
        recipientEmail: OWNER_EMAIL,
        status: 'QUEUED',
      },
    ]);
    expect(enqueued).toEqual([{ dispatchId: expect.any(String), tenantId: TENANT_1.tenantId, recipientClass: 'HOST_MEMBER' }]);
    expect((await audits(TENANT_1.tenantId)).map((row) => row.action)).toEqual([USAGE_LIMIT_AUDIT_ACTIONS.NEARING]);

    // 同じ日・同じ水準 → 何も増えない。
    const second = await run(TENANT_1.tenantId);
    expect(second).toEqual({ changed: 0, audited: 0, notices: 0, queued: 0, quotaNoticesQueued: 0, aiStopped: false });
    expect(await dispatches(TENANT_1.tenantId)).toHaveLength(1);

    // 🔴 接近 → 下回る → 同じ日にまた接近: 通知は増えない（1 日 1 回）。監査も増えない（接近は上がったときだけ）。
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '100');
    await run(TENANT_1.tenantId);
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '150');
    const again = await run(TENANT_1.tenantId);
    expect(again.notices).toBe(0);
    expect(again.queued).toBe(0);
    expect(await dispatches(TENANT_1.tenantId)).toHaveLength(1);
    expect((await audits(TENANT_1.tenantId)).map((row) => row.action)).toEqual([USAGE_LIMIT_AUDIT_ACTIONS.NEARING]);

    // 到達（従量へ移行）は別の水準 → 1 通（REACHED）+ 監査 1 件。
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '180');
    const reached = await run(TENANT_1.tenantId);
    expect(reached.notices).toBe(1);
    rows = await dispatches(TENANT_1.tenantId);
    expect(rows.map((row) => row.templateKey)).toEqual(['USAGE_LIMIT_NEARING', 'USAGE_LIMIT_REACHED']);
    expect((await audits(TENANT_1.tenantId)).map((row) => [row.action, row.effect])).toEqual([
      [USAGE_LIMIT_AUDIT_ACTIONS.NEARING, 'METERED'],
      [USAGE_LIMIT_AUDIT_ACTIONS.REACHED, 'METERED'],
    ]);
    // 🔴 宛先にパートナー所属・SALES は居ない（OWNER / ADMIN のみ）。
    expect(rows.every((row) => row.recipientEmail === OWNER_EMAIL && row.recipientClass === 'HOST_MEMBER')).toBe(true);
  });

  it('🔴 AI コスト上限の接近（80%）はテナントへ通知しない（メーターを見せない上限）。到達だけ通知する', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', '4.500000'); // 90%
    const { run } = makeHandler();
    const nearing = await run(TENANT_1.tenantId);
    expect((await states(TENANT_1.tenantId)).AI_COST_USD?.level).toBe('NEARING');
    expect(nearing.notices).toBe(0);
    expect(await dispatches(TENANT_1.tenantId)).toEqual([]);
    // 運営者の監視のためには記録される（監査ログ。金額は無い）。
    expect((await audits(TENANT_1.tenantId)).map((row) => [row.action, row.metric])).toEqual([
      [USAGE_LIMIT_AUDIT_ACTIONS.NEARING, 'AI_COST_USD'],
    ]);

    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', AI_DAILY_COST_LIMIT_USD);
    const reached = await run(TENANT_1.tenantId);
    expect(reached.notices).toBe(1);
    expect((await dispatches(TENANT_1.tenantId)).map((row) => row.templateKey)).toEqual(['USAGE_LIMIT_REACHED']);
  });
});

describe('⑥ AC-2: メールの日次（停止）と分次（待機）を区別して返す', () => {
  it('日次 500 通で state = BLOCK / level = REACHED、直近 1 分 30 通で state = DEFER（日次は BELOW のまま）', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'EMAIL_COUNT', '500');
    let view = (await (await callUsage(await ctxOf(HOST_SALES, 'SALES'))).json()) as { email: Record<string, unknown> };
    expect(view.email).toEqual({
      usedToday: 500,
      dailyLimit: 500,
      usedLastMinute: 0,
      minuteLimit: 30,
      level: 'REACHED',
      state: 'BLOCK',
      onExceed: 'STOP_DAILY_DEFER_MINUTE',
    });

    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'EMAIL_COUNT', '30');
    for (let index = 0; index < 30; index += 1) {
      await admin.$executeRawUnsafe(
        `INSERT INTO email_dispatches (id, tenant_id, recipient_class, recipient_email, template_key, dedupe_key, status, sent_at)
         VALUES (gen_random_uuid(), $1::uuid, 'HOST_MEMBER', $2, 'SKILL_SHEET_QUARANTINE', $3, 'SENT', now())`,
        TENANT_1.tenantId,
        OWNER_EMAIL,
        `SKILL_SHEET_QUARANTINE:minute-${index}:${Date.now()}`,
      );
    }
    view = (await (await callUsage(await ctxOf(HOST_SALES, 'SALES'))).json()) as { email: Record<string, unknown> };
    expect(view.email.usedLastMinute).toBe(30);
    expect(view.email.state).toBe('DEFER');
    expect(view.email.level).toBe('BELOW');
  });
});

describe('⑦ テナント境界', () => {
  it('🔴 他テナントの水準・通知・監査ログに 1 行も混ざらない。他テナントの停止は見えない', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', DAY, 'AI_COST_USD', AI_DAILY_COST_LIMIT_USD);
    await upsertCounter(TENANT_1.tenantId, 'MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '144');
    await makeHandler().run(TENANT_1.tenantId);

    expect(await states(TENANT_2.tenantId)).toEqual({});
    expect(await dispatches(TENANT_2.tenantId)).toEqual([]);
    expect(await audits(TENANT_2.tenantId)).toEqual([]);

    const other = await callBlockedNotice(await ctxOf(TENANT_2_HOST, 'SALES'));
    expect(await other.json()).toEqual({ blocked: false, reasonKey: null });
    const otherView = (await (await callUsage(await ctxOf(TENANT_2_HOST, 'SALES'))).json()) as { aiDailyStop: unknown };
    expect(otherView.aiDailyStop).toEqual({ stopped: false });
    expect(await rawStates(TENANT_2_HOST)).toEqual([]);

    // テナント 2 のジョブはテナント 2 の行だけを作る（ジョブ文脈の RLS が母集団を決める）。
    const outcome = await makeHandler().run(TENANT_2.tenantId);
    expect(outcome.aiStopped).toBe(false);
    expect(Object.keys(await states(TENANT_2.tenantId))).toHaveLength(7);
    expect((await states(TENANT_1.tenantId)).AI_COST_USD?.level).toBe('REACHED');
  });

  it('🔴 ジョブ文脈（ホスト相当）だけが usage_limit_states を書ける。パートナー文脈からは INSERT できない', async () => {
    await expect(
      rawTenant.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true),
                  set_config('app.partner_company_id', $2, true),
                  set_config('app.actor_user_id', $3, true),
                  set_config('app.shared_scope', 'off', true)`,
          TENANT_1.tenantId,
          PARTNER_1_1.partnerCompanyId,
          PARTNER_1_1.userId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO usage_limit_states (id, tenant_id, metric, level, level_since, period_kind, period_key, evaluated_at)
           VALUES (gen_random_uuid(), $1::uuid, 'AI_COST_USD', 'REACHED', now(), 'DAY', $2, now())`,
          TENANT_1.tenantId,
          DAY,
        );
      }),
    ).rejects.toThrow(/row-level security/i);
    // 対照: ジョブ文脈（`systemTenantCtx` = ホスト相当）は書ける（上の it 群がそれで成立している）。
  });
});
