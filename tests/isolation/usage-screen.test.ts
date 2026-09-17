// tests/isolation/usage-screen.test.ts
// 🔴 T-10-04（`S-038` 利用量と上限）の完了判定 = `F-027 AC-6` / `AC-7` の結合テスト（docs/02 章 7.5 / docs/04 §S-038 /
//    docs/05 §5.8.1 ⑥ / §6.7 #69 #70 / §17.2 #18）。**実 DB（RLS 付き）**。実 Anthropic API にも実 SES にも接続しない。
//
//   ① 🔴 `AC-6`: **AI の原価（USD）を fixture に仕込んだうえで**、ホストの `GET /api/usage`（`S-038` が読む唯一の応答）の
//      JSON に金額のキー（`usd` / `cost` / `price` / `$` / `ドル`）も、仕込んだ金額の値も現れない。残量は件数 4 単位・通数・
//      バイト数・席数の数値だけ。請求見込みは `null`（算出できない。0 円と偽らない）
//   ② 🔴 `AC-7` / `AC-1`: 停止中の応答は `aiDailyStop` に `stoppedFeatures = ['reviewGate']`（止まった理由としての品質ゲート）と
//      `resetAt`（ホストだけに載る再開時刻）を持ち、残量のブロック（`aiUnits`）のキーに `gate` / `inspector` が無い
//      （品質ゲートは残量ではなく理由としてだけ現れる）
//   ③ 🔴 `AC-1` / `BR-04`: パートナーが `S-038` を開いたときに読む #70 は `{ blocked, reasonKey }` の 2 キーだけで、
//      停止時刻・再開時刻・残量・上限値・数値を 1 つも含まない。`GET /api/usage` はパートナーに 403
//
// 🔴 `tests/isolation/usage-limits.test.ts`（T-10-03）が判定・監査・通知を固定するのに対し、ここは **`S-038` が画面に出す
//    応答の「無いこと」**を、原価の fixture を対照に置いて固定する（fixture が無ければ「金額が出ない」は自明に真になる）。
// 🔴 描画（HTML）の検査は `apps/web/app/(main)/settings/usage/usage-screen.render.test.tsx`（同じ `UsageView` 型を入力にする）。
//    本ファイルは JSX を含む部品を import しない（`vitest.isolation.config.ts` / `tsconfig.tests.json` は JSX を構成していない）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { usagePeriodKey } from '../../packages/domain/src/usage/period-key.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.21' } as const;
const GB = 1024n * 1024n * 1024n;

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

/**
 * 🔴 対照に使う金額（USD）。**すべて桁の並びが他の数値（件数・バイト数・上限）と偶然一致しない値**にする。
 *    - 日次上限（ワーカーだけが持つ） / 当日の消費（カウンタ） / 予約中 / `ai_usage` 各行の推定原価
 */
const AI_DAILY_COST_LIMIT_USD = '5.000000';
const AI_COST_TODAY_USD = '5.000000';
const AI_COST_RESERVED_USD = '0.123456';
const AI_USAGE_ROW_COSTS_USD = ['1.234567', '0.987654', '2.777888'] as const;
const MONEY_DIGITS = [AI_DAILY_COST_LIMIT_USD, AI_COST_RESERVED_USD, ...AI_USAGE_ROW_COSTS_USD].map((value) =>
  value.replace(/^0\./, '.'),
);

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
const { AI_UNIT_KEYS, AI_STOPPED_FEATURES } = await import('../../apps/web/lib/usage/view');
const { createUsageLimitCheckHandler, USAGE_LIMIT_CHECK_JOB } = await import(
  '../../apps/worker/src/jobs/usage-limit-check.js'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const PARTNER_1_1 = TENANT_1.partners[0];

const HOST_USER: TenantIdentity = { tenantId: TENANT_1.tenantId, partnerCompanyId: null, userId: TENANT_1.hostUserId };
const PARTNER_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

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
    TENANT_1.tenantId,
    periodKind,
    periodKey,
    metric,
    value,
    reservedValue,
  );
}

/** 🔴 fixture: AI の原価（USD）を `ai_usage` に実データとして置く（`gate-inspector` の実行として）。 */
async function insertAiUsageCosts(): Promise<void> {
  for (const cost of AI_USAGE_ROW_COSTS_USD) {
    await admin.$executeRawUnsafe(
      `INSERT INTO ai_usage (id, tenant_id, role, model_id, purpose, prompt_version, input_tokens, output_tokens,
                             estimated_cost_usd, succeeded, started_at, finished_at)
       VALUES (gen_random_uuid(), $1::uuid, 'gate-inspector', 'claude-haiku-4-5-20251001', 'gate', 'gate-inspector.v1',
               1200, 300, $2::numeric, true, now(), now())`,
      TENANT_1.tenantId,
      cost,
    );
  }
}

function runLimitCheck(): Promise<unknown> {
  const handler = createUsageLimitCheckHandler({
    now: () => NOW,
    models: { resolve: async () => 'claude-sonnet-5' },
    aiDailyCostLimitUsd: AI_DAILY_COST_LIMIT_USD,
    usageLimits: LIMITS,
    enqueueEmailDispatch: async () => {},
  });
  return handler({ tenantId: TENANT_1.tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:screen`);
}

function deepKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => deepKeys(item, prefix));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [`${prefix}${key}`, ...deepKeys(child, `${prefix}${key}.`)]);
}

function deepValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(deepValues);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(deepValues);
  return [value];
}

const MONEY_KEY = /usd|cost|price|amount|\$|ドル/i;

async function resetTenant(): Promise<void> {
  await admin.$executeRawUnsafe(`DELETE FROM usage_limit_states WHERE tenant_id = $1::uuid`, TENANT_1.tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM usage_counters WHERE tenant_id = $1::uuid`, TENANT_1.tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM ai_usage WHERE tenant_id = $1::uuid`, TENANT_1.tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM email_dispatches WHERE tenant_id = $1::uuid AND template_key LIKE 'USAGE_LIMIT_%'`, TENANT_1.tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = $1::uuid AND action LIKE 'usage.limit_%'`, TENANT_1.tenantId);
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await resetTenant();
});

/** 停止中 + 原価あり + 各上限に使用量ありの状態を作る（`S-038` の全セクションが埋まる fixture）。 */
async function arrangeStoppedTenantWithCosts(): Promise<void> {
  await insertAiUsageCosts();
  await upsertCounter('DAY', DAY, 'AI_COST_USD', AI_COST_TODAY_USD, AI_COST_RESERVED_USD); // 上限ちょうど = 1 回ぶんも入らない
  await upsertCounter('MONTH', MONTH, 'AI_UNIT_SHEET_PARSE', '118');
  await upsertCounter('MONTH', MONTH, 'AI_UNIT_MATCH_RATIONALE', '4900'); // 79% = 平常
  await upsertCounter('MONTH', MONTH, 'AI_UNIT_PROPOSAL_DRAFT', '150'); // 83% = 接近
  await upsertCounter('MONTH', MONTH, 'AI_UNIT_RENEWAL_SUMMARY', '25'); // 超過（従量）
  await upsertCounter('MONTH', MONTH, 'STORAGE_BYTES', (12n * GB).toString());
  await upsertCounter('DAY', DAY, 'EMAIL_COUNT', '118');
  await upsertCounter('DAY', DAY, 'SEAT_COUNT', '7');
  await runLimitCheck();

  // 対照: 原価は実際に DB にある（無ければ「金額が出ない」は自明に真）。
  const rows = await admin.aiUsage.findMany({ where: { tenantId: TENANT_1.tenantId }, select: { estimatedCostUsd: true } });
  expect(rows.map((row) => row.estimatedCostUsd.toFixed(6)).sort()).toEqual([...AI_USAGE_ROW_COSTS_USD].sort());
}

describe('① AC-6: ホストの GET /api/usage に金額のキーも値も無い（原価の fixture を対照に）', () => {
  it('🔴 金額のキー（usd / cost / price / amount / $ / ドル）が 0 件。仕込んだ USD の桁が JSON のどこにも無い。残量は件数だけ', async () => {
    await arrangeStoppedTenantWithCosts();

    const response = await callUsage(await ctxOf(HOST_USER, 'SALES'));
    expect(response.status).toBe(200);
    const view = (await response.json()) as Record<string, unknown>;
    const text = JSON.stringify(view);

    expect(deepKeys(view).filter((key) => MONEY_KEY.test(key))).toEqual([]);
    expect(text).not.toMatch(/usd|cost|price|\$|ドル|円/i);
    for (const digits of MONEY_DIGITS) expect(text, `金額 ${digits} が応答に混じっている`).not.toContain(digits);

    // 🔴 残量は件数（整数）。4 単位が `S-038` の並びで揃っている（`AI_UNIT_KEYS` の値そのもの）。
    const aiUnits = view.aiUnits as Record<string, Record<string, unknown>>;
    expect(Object.keys(aiUnits).sort()).toEqual([...Object.values(AI_UNIT_KEYS)].sort());
    expect(aiUnits.sheetParse).toEqual({ used: 118, quota: 180, remaining: 62, overageCount: 0, level: 'BELOW', onExceed: 'METERED' });
    expect(aiUnits.matchRationale).toEqual({ used: 4900, quota: 6200, remaining: 1300, overageCount: 0, level: 'BELOW', onExceed: 'METERED' });
    expect(aiUnits.proposalDraft).toEqual({ used: 150, quota: 180, remaining: 30, overageCount: 0, level: 'NEARING', onExceed: 'METERED' });
    expect(aiUnits.renewalSummary).toEqual({ used: 25, quota: 20, remaining: 0, overageCount: 5, level: 'REACHED', onExceed: 'METERED' });
    for (const unit of Object.values(aiUnits)) {
      for (const key of ['used', 'quota', 'remaining', 'overageCount']) expect(Number.isInteger(unit[key])).toBe(true);
    }
    expect(view.storage).toEqual({ usedBytes: (12n * GB).toString(), limitBytes: (50n * GB).toString(), level: 'BELOW', onExceed: 'STOP_UPLOAD' });
    expect((view.email as Record<string, unknown>).usedToday).toBe(118);
    expect(view.seats).toEqual({ used: 7, limit: null });
    // 🔴 唯一の金額（請求見込み）は算出できないので null（0 円と偽らない。docs/05 §5.8.1 ⑥）。
    expect(view.overageEstimateJpy).toBeNull();
    // 🔴 数値の値はすべて件数・バイト数・席数・閾値のいずれかで、小数（金額の形）が 1 つも無い。
    const numbers = deepValues(view).filter((value): value is number => typeof value === 'number');
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.filter((value) => !Number.isInteger(value))).toEqual([]);
  });

  it('VIEWER（ホスト）も同じ応答を読める（閲覧のみ。S-038 は 4 ロールに開く）', async () => {
    await arrangeStoppedTenantWithCosts();
    const response = await callUsage(await ctxOf(HOST_USER, 'VIEWER'));
    expect(response.status).toBe(200);
    const view = (await response.json()) as Record<string, unknown>;
    expect(deepKeys(view).filter((key) => MONEY_KEY.test(key))).toEqual([]);
  });
});

describe('② AC-7 / AC-1: 停止中の応答 —— 品質ゲートは止まった理由としてだけ現れ、残量には無い', () => {
  it('🔴 aiDailyStop に stoppedFeatures = [reviewGate] と resetAt がある。aiUnits のキーに gate / inspector が無い', async () => {
    await arrangeStoppedTenantWithCosts();

    // 🔴 `OWNER` / `ADMIN` は 2FA 必須（`BR-30`）でシードの利用者は未登録のため、ホストの閲覧は `SALES` で通す（`usage-limits.test.ts` と同じ）。
    const view = (await (await callUsage(await ctxOf(HOST_USER, 'SALES'))).json()) as Record<string, unknown>;
    expect(view.aiDailyStop).toEqual({
      stopped: true,
      reasonKey: 'quota.aiDaily',
      since: expect.any(String),
      resetAt: expect.any(String),
      stoppedFeatures: [...AI_STOPPED_FEATURES],
    });
    expect((view.aiDailyStop as { stoppedFeatures: string[] }).stoppedFeatures).toEqual(['reviewGate']);
    const resetAt = new Date((view.aiDailyStop as { resetAt: string }).resetAt);
    expect(Number.isNaN(resetAt.getTime())).toBe(false);
    expect(resetAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(resetAt.getUTCHours()).toBe(15); // JST の翌 0 時

    // 🔴 残量のブロックに gate が無い（品質ゲートの残量メーターが存在しない = AC-7）。
    expect(deepKeys(view.aiUnits).filter((key) => /gate|inspector/i.test(key))).toEqual([]);
    expect(Object.keys(view.aiUnits as object)).toHaveLength(4);
    // gate が現れるのは aiDailyStop.stoppedFeatures の**値**としてだけ（キーには無い）。
    expect(deepKeys(view).filter((key) => /gate|inspector/i.test(key))).toEqual([]);
    const gateValues = deepValues(view).filter((value) => typeof value === 'string' && /gate|inspector/i.test(value));
    expect(gateValues).toEqual(['reviewGate']);
  });

  it('停止していないときは aiDailyStop = { stopped: false }（バナーの材料が無い）。原価があっても同じ', async () => {
    await insertAiUsageCosts();
    await upsertCounter('DAY', DAY, 'AI_COST_USD', '1.500000');
    await runLimitCheck();
    const view = (await (await callUsage(await ctxOf(HOST_USER, 'SALES'))).json()) as Record<string, unknown>;
    expect(view.aiDailyStop).toEqual({ stopped: false });
    expect(JSON.stringify(view)).not.toMatch(/usd|cost|1\.500000|1\.234567/i);
  });
});

describe('③ AC-1 / BR-04: パートナーが S-038 を開いたときに読めるのは #70 の 2 キーだけ', () => {
  it('🔴 停止中: { blocked: true, reasonKey } だけ。時刻・数値・残量・上限のキーが無い。GET /api/usage は 403', async () => {
    await arrangeStoppedTenantWithCosts();

    for (const role of ['PARTNER_SALES', 'PARTNER_ADMIN'] as const) {
      const ctx = await ctxOf(PARTNER_USER, role);
      const notice = await callBlockedNotice(ctx);
      expect(notice.status).toBe(200);
      const body = (await notice.json()) as Record<string, unknown>;
      expect(body).toEqual({ blocked: true, reasonKey: 'quota.aiDaily' });
      expect(Object.keys(body).sort()).toEqual(['blocked', 'reasonKey']);
      expect(deepValues(body).filter((value) => typeof value === 'number')).toEqual([]);
      expect(JSON.stringify(body)).not.toMatch(/resetAt|since|remaining|limit|usd|cost|\d/i);

      const usage = await callUsage(ctx);
      expect(usage.status).toBe(403);
      expect(((await usage.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
    }
  });

  it('停止していない: { blocked: false, reasonKey: null }（接近中でも同じ。接近の事実は漏れない）', async () => {
    await insertAiUsageCosts();
    await upsertCounter('DAY', DAY, 'AI_COST_USD', '4.500000'); // 90%（接近）だが 1 回ぶんは入る
    await upsertCounter('MONTH', MONTH, 'STORAGE_BYTES', (45n * GB).toString()); // 90%（接近）
    await runLimitCheck();
    const body = await (await callBlockedNotice(await ctxOf(PARTNER_USER, 'PARTNER_SALES'))).json();
    expect(body).toEqual({ blocked: false, reasonKey: null });
  });
});
