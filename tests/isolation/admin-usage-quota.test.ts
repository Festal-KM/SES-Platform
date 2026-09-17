// tests/isolation/admin-usage-quota.test.ts
// 🔴 T-11-02 の完了判定 = `F-057 AC-1`〜`AC-5`（利用量・クォータ管理。docs/05 §6.9 API-A6 / §5.2 / `A-004` / `BR-44` /
//    `CLAUDE.md` §10.1 / §10.5「クォータ」/ migration 20260924000000）。**実 DB（RLS 付き）**。実 Anthropic API / 実 SES には接続しない。
//
//   ① `AC-5` / `F-063 AC-5`: `readPlatformUsage` に**件数と金額（USD）の両方**・消費率・2 つの倍率が出る。環境全体の行はテナント行と別
//   ② `AC-1`: 低消化（すべて 20% 未満）と張り付き（いずれか 80% 以上）をそれぞれ抽出できる
//   ③ 🔴 `AC-2` / `BR-44`: `PLATFORM_SUPPORT` の書き込みは拒否され（→ 403）、行も監査行も増えない
//   ④ 🔴 `AC-3`: 引き下げは当日 / 過去 / 通知なしのいずれも拒否（→ 400）。翌日以降 + 通知で受理され、`usage.limit-check` が
//      テナント管理者（OWNER / ADMIN のみ）宛の `EmailDispatch(QUEUED)` を 1 行作る（2 回目は作らない）。`AC-4` の監査行
//   ⑤ 引き上げは当日から適用できる
//   ⑥ `resolveTenantQuotas` は適用日前は既定値・適用日以降は上書き値を返し、`decideAiUnitQuota` の判定が変わる（判定式は不変）
//   ⑦ 🔴 DB 権限: `app_platform_write` は `tenant_quota_overrides` に INSERT だけ（UPDATE / DELETE は permission denied）。
//      RLS の WITH CHECK が当日適用の引き下げ・他人名義・対象外テナントの行を止める
//   ⑧ 応答に PII（利用者名・メール）・業務データが無い。主平面の `GET /api/usage` 相当（`readUsageView` の入力 = `resolveTenantQuotas`）に金額が無い
//
// 🔴 現在時刻は**実時刻**を使う。DB のポリシーが `now()`（Asia/Tokyo の暦日）で適用日を検査するため、固定日時だと DB の今日とずれる。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  configureTenantDb,
  disconnectTenantDb,
  PlatformRoleNotAllowedError,
  requirePlatformOwner,
  resolvePlatformCtx,
  resolveTenantQuotas,
  systemTenantCtx,
  type AuthenticatedPlatformCtx,
  type PlatformOwnerCtx,
} from '@ses/db';
import { readPlatformUsage, setTenantQuotaOverride, type PlatformUsageSnapshot } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, isolationSeedEmails, runSeed } from '@ses/db/seed';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。他の isolation テストと同じ）。
import { ROLE_PURPOSE, type AiRole } from '../../packages/domain/src/ai/roles.js';
import { decideAiUnitQuota } from '../../packages/domain/src/quota/ai-unit.js';
import { shiftDayKey } from '../../packages/domain/src/usage/day-keys.js';
import { usagePeriodKey } from '../../packages/domain/src/usage/period-key.js';
import { parseQuotaChangeBody } from '../../apps/web/lib/admin-usage/schemas';
import { applyUsageFilter } from '../../apps/web/lib/admin-usage/view';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const GB = 1024n * 1024n * 1024n;

const NOW = new Date();
const TODAY = usagePeriodKey('DAY', NOW);
const TOMORROW = shiftDayKey(TODAY, 1);
const YESTERDAY = shiftDayKey(TODAY, -1);
const MONTH = usagePeriodKey('MONTH', NOW);

const OWNER_USER_ID = '01930000-0000-7000-8000-00000011020a';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-00000011020b';

const DEFAULTS = {
  aiUnitQuotas: { AI_UNIT_SHEET_PARSE: 180, AI_UNIT_MATCH_RATIONALE: 6_200, AI_UNIT_PROPOSAL_DRAFT: 180, AI_UNIT_RENEWAL_SUMMARY: 20 },
  emailDailyLimit: 500,
  storageLimitBytes: 50n * GB,
};
const META = {
  ipAddress: '203.0.113.42',
  now: NOW,
  warnPercent: 80,
  defaults: DEFAULTS,
  aiDailyCostLimitUsd: 5,
  aiMonthlyCostCapUsd: 40,
  providerCapUsd: 500,
} as const;

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const OWNER_EMAIL = isolationSeedEmails(1).hostOwner;
const SALES_EMAIL = isolationSeedEmails(1).hostSales;
const PARTNER_EMAIL = isolationSeedEmails(1).partner1;

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
/** 🔴 素の `app_platform_write` 接続（GRANT / ポリシーの実挙動を見る）。 */
let rawPlatformWrite: UnextendedClient;
let ownerCtx: PlatformOwnerCtx;
let supportCtx: AuthenticatedPlatformCtx;

async function upsertCounter(tenantId: string, periodKind: 'DAY' | 'MONTH', metric: string, value: string, reserved = '0'): Promise<void> {
  const periodKey = periodKind === 'DAY' ? TODAY : MONTH;
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
    reserved,
  );
}

/** 🔴 応答に 1 バイトも現れてはならない値（対象・モデル・プロンプト版。T-11-08 の申し送り ⑥）。 */
const MODEL_ID = 'claude-sonnet-5-t1102';
const PROMPT_VERSION = 'role.v9-t1102';

async function insertAiUsage(tenantId: string, role: AiRole, costUsd: string): Promise<void> {
  await admin.$executeRaw`
    INSERT INTO ai_usage
      (id, tenant_id, role, model_id, purpose, prompt_version, target_type, target_id,
       input_tokens, output_tokens, estimated_cost_usd, succeeded, started_at, finished_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${role}, ${MODEL_ID}, ${ROLE_PURPOSE[role]}, ${PROMPT_VERSION},
            'Proposal', gen_random_uuid(), 1000, 200, ${costUsd}::numeric, true, ${NOW}, ${NOW})`;
}

async function overrides(tenantId: string) {
  return admin.tenantQuotaOverride.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
}

async function quotaAudits(tenantId: string) {
  const rows = await admin.auditLog.findMany({
    where: { tenantId, action: 'admin.quota.change' },
    orderBy: { createdAt: 'asc' },
    select: { actorKind: true, actorId: true, targetType: true, targetId: true, summary: true },
  });
  return rows;
}

async function quotaDispatches(tenantId: string) {
  return admin.emailDispatch.findMany({
    where: { tenantId, templateKey: 'QUOTA_LOWERED' },
    orderBy: { dedupeKey: 'asc' },
    select: { dedupeKey: true, recipientClass: true, recipientEmail: true, status: true },
  });
}

function tenantRow(snapshot: PlatformUsageSnapshot, tenantId: string) {
  const row = snapshot.tenants.find((item) => item.tenantId === tenantId);
  if (row === undefined) throw new Error(`tenant ${tenantId} が応答に無い`);
  return row;
}

async function resetAll(): Promise<void> {
  await admin.$executeRawUnsafe(`DELETE FROM tenant_quota_overrides`);
  await admin.$executeRawUnsafe(`DELETE FROM usage_counters`);
  await admin.$executeRawUnsafe(`DELETE FROM usage_limit_states`);
  await admin.$executeRawUnsafe(`DELETE FROM ai_usage`);
  await admin.$executeRawUnsafe(`DELETE FROM email_dispatches WHERE template_key IN ('QUOTA_LOWERED', 'USAGE_LIMIT_NEARING', 'USAGE_LIMIT_REACHED')`);
  await admin.$executeRawUnsafe(`DELETE FROM audit_logs WHERE action IN ('admin.quota.change', 'admin.usage.view') OR action LIKE 'usage.limit_%'`);
}

function makeLimitCheckHandler() {
  const enqueued: unknown[] = [];
  const handler = createUsageLimitCheckHandler({
    now: () => NOW,
    models: { resolve: async () => 'claude-sonnet-5' },
    aiDailyCostLimitUsd: '5.000000',
    usageLimits: { warnPercent: 80, ...DEFAULTS },
    enqueueEmailDispatch: async (job) => {
      enqueued.push(job);
    },
  });
  return { run: (tenantId: string) => handler({ tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:1`), enqueued };
}

const { createUsageLimitCheckHandler, USAGE_LIMIT_CHECK_JOB } = await import('../../apps/worker/src/jobs/usage-limit-check.js');

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
  admin = createUnextendedClient(database.superuserUrl);
  rawPlatformWrite = createUnextendedClient(database.platformWriteUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  const owner = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  requirePlatformOwner(owner);
  ownerCtx = owner;
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await rawPlatformWrite?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await resetAll();
});

describe('① 件数と金額の両方 + 消費率 + 倍率。環境全体の行は別（F-057 AC-5 / F-063 AC-5 / docs/03 §7.6.3-2）', () => {
  it('🔴 テナント行に件数（4 単位）・当日 AI コスト（USD）・当月 AI 原価（USD。ロール別）・標準原価比・基準ユニット比が同時に載る', async () => {
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_SHEET_PARSE', '60');
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_MATCH_RATIONALE', '2000');
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_PROPOSAL_DRAFT', '60');
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_RENEWAL_SUMMARY', '8');
    await upsertCounter(TENANT_1.tenantId, 'DAY', 'AI_COST_USD', '1.000000', '0.250000');
    await upsertCounter(TENANT_1.tenantId, 'DAY', 'EMAIL_COUNT', '400');
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'STORAGE_BYTES', (10n * GB).toString());
    await upsertCounter(TENANT_1.tenantId, 'DAY', 'SEAT_COUNT', '3');
    await insertAiUsage(TENANT_1.tenantId, 'sheet-parser', '1.620000');
    await insertAiUsage(TENANT_1.tenantId, 'skill-normalizer', '0.360000');
    await insertAiUsage(TENANT_1.tenantId, 'match-explainer', '8.000000');
    await insertAiUsage(TENANT_1.tenantId, 'proposal-drafter', '1.260000');
    await insertAiUsage(TENANT_1.tenantId, 'renewal-advisor', '0.136000');
    await insertAiUsage(TENANT_1.tenantId, 'gate-inspector', '1.440000');
    await insertAiUsage(TENANT_2.tenantId, 'gate-inspector', '100.000000');

    const snapshot = await readPlatformUsage(supportCtx, META);
    const row = tenantRow(snapshot, TENANT_1.tenantId);
    // 件数と上限（既定値）と消化率。
    expect(row.aiUnits.AI_UNIT_SHEET_PARSE).toMatchObject({ used: 60, limit: 180, consumptionPercent: 33, standardCostUsd: '0.033' });
    expect(row.aiUnits.AI_UNIT_MATCH_RATIONALE).toMatchObject({ used: 2000, limit: 6200, consumptionPercent: 32 });
    expect(row.email).toMatchObject({ used: 400, limit: 500, consumptionPercent: 80 });
    expect(row.storage).toMatchObject({ usedBytes: (10n * GB).toString(), limitBytes: (50n * GB).toString(), consumptionPercent: 20 });
    expect(row.seatsUsed).toBe(3);
    // 金額（USD）。当日 = used + reserved / 上限。当月 = ai_usage の合計 / 金額上限。
    expect(row.aiDaily).toMatchObject({ costUsd: '1.250000', limitUsd: '5.000000', consumptionPercent: 25 });
    expect(row.aiMonthly).toMatchObject({ costUsd: '12.816000', capUsd: '40.000000', consumptionPercent: 32, standardCostUsd: '11.376000', unitCostRatio: 1 });
    expect(row.aiMonthly.byRole['gate-inspector']).toBe('1.440000');
    expect(row.aiMonthly.baselineRatio).toBeCloseTo(12.816 / 12.82, 4);
    // 🔴 環境全体の行は別集計（全テナントの合計 112.816 / tier 上限 500）。テナント行の値ではない。
    expect(snapshot.environment.spentUsd).toBe('112.816000');
    expect(snapshot.environment.capUsd).toBe('500.000000');
    expect(snapshot.environment.level).toBe('BELOW');
    expect(snapshot.environment.tenantCount).toBe(2);
    expect(Object.keys(snapshot.environment.byRole)).toHaveLength(6);
    expect(tenantRow(snapshot, TENANT_2.tenantId).aiMonthly.costUsd).toBe('100.000000');
    expect(tenantRow(snapshot, TENANT_2.tenantId).aiMonthly.unitCostRatio).toBeNull();
  });

  it('読み取り 1 回につき監査行は 1 本（admin.usage.view。横断 = tenant_id IS NULL）。PLATFORM_SUPPORT でも読める', async () => {
    await readPlatformUsage(supportCtx, META);
    const rows = await admin.auditLog.findMany({ where: { action: 'admin.usage.view' }, select: { tenantId: true, actorId: true, actorKind: true } });
    expect(rows).toEqual([{ tenantId: null, actorId: SUPPORT_USER_ID, actorKind: 'PLATFORM_USER' }]);
  });

  it('usage_limit_states の水準（ワーカーの評価）が行に写る。未評価は null', async () => {
    await upsertCounter(TENANT_1.tenantId, 'DAY', 'EMAIL_COUNT', '500');
    const { run } = makeLimitCheckHandler();
    await run(TENANT_1.tenantId);
    const snapshot = await readPlatformUsage(ownerCtx, META);
    expect(tenantRow(snapshot, TENANT_1.tenantId).email.level).toBe('REACHED');
    expect(tenantRow(snapshot, TENANT_2.tenantId).email.level).toBeNull();
  });
});

describe('② 抽出（F-057 AC-1）', () => {
  it('🔴 低消化（すべて 20% 未満）と張り付き（いずれか 80% 以上）をそれぞれ抽出できる。抽出 all は全件', async () => {
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_RENEWAL_SUMMARY', '19'); // 95% → HIGH
    await upsertCounter(TENANT_2.tenantId, 'DAY', 'EMAIL_COUNT', '10'); // 2% → LOW
    const snapshot = await readPlatformUsage(supportCtx, META);
    expect(tenantRow(snapshot, TENANT_1.tenantId).band).toBe('HIGH');
    expect(tenantRow(snapshot, TENANT_2.tenantId).band).toBe('LOW');
    expect(applyUsageFilter(snapshot.tenants, 'high').map((row) => row.tenantId)).toEqual([TENANT_1.tenantId]);
    expect(applyUsageFilter(snapshot.tenants, 'low').map((row) => row.tenantId)).toEqual([TENANT_2.tenantId]);
    expect(applyUsageFilter(snapshot.tenants, 'all')).toHaveLength(snapshot.tenants.length);
    // 並びは張り付いている順。
    expect(snapshot.tenants[0]?.tenantId).toBe(TENANT_1.tenantId);
    expect(snapshot.lowPercent).toBe(20);
    expect(snapshot.warnPercent).toBe(80);
  });

  it('50% は MID（どちらの抽出にも入らない）', async () => {
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_SHEET_PARSE', '90');
    const snapshot = await readPlatformUsage(supportCtx, META);
    expect(tenantRow(snapshot, TENANT_1.tenantId).band).toBe('MID');
    expect(applyUsageFilter(snapshot.tenants, 'high').map((row) => row.tenantId)).not.toContain(TENANT_1.tenantId);
    expect(applyUsageFilter(snapshot.tenants, 'low').map((row) => row.tenantId)).not.toContain(TENANT_1.tenantId);
  });
});

const RAISE = { metric: 'AI_UNIT_SHEET_PARSE', limit: 300n, effectiveFrom: TODAY, notifyTenantAdmins: false, reason: 'テスト: 引き上げ' } as const;

describe('③ PLATFORM_SUPPORT はクォータを変更できない（F-057 AC-2 / BR-44）', () => {
  it('🔴 型を破って呼んでも PlatformRoleNotAllowedError（→ 403）。行も監査行も増えない', async () => {
    await expect(
      setTenantQuotaOverride(supportCtx as PlatformOwnerCtx, { tenantId: TENANT_1.tenantId, ...RAISE }, { now: NOW, defaults: DEFAULTS }),
    ).rejects.toThrow(PlatformRoleNotAllowedError);
    expect(await overrides(TENANT_1.tenantId)).toEqual([]);
    expect(await quotaAudits(TENANT_1.tenantId)).toEqual([]);
    expect(await admin.auditLog.count({ where: { action: 'admin.usage.view' } })).toBe(0);
  });
});

describe('④ 引き下げは翌日以降 + 通知が必須（F-057 AC-3 / AC-4）', () => {
  const LOWER = { metric: 'AI_UNIT_SHEET_PARSE', limit: 100n, reason: 'テスト: プラン見直しによる引き下げ' } as const;

  it('🔴 当日適用 / 過去 / 通知なし は 400（QuotaChangeRejectedError）。行は増えない', async () => {
    const meta = { now: NOW, defaults: DEFAULTS };
    await expect(
      setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...LOWER, effectiveFrom: TODAY, notifyTenantAdmins: true }, meta),
    ).rejects.toThrow(expect.objectContaining({ name: 'QuotaChangeRejectedError', reason: 'LOWERING_NOT_DEFERRED' }));
    await expect(
      setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...LOWER, effectiveFrom: YESTERDAY, notifyTenantAdmins: true }, meta),
    ).rejects.toThrow(expect.objectContaining({ reason: 'EFFECTIVE_FROM_PAST' }));
    await expect(
      setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...LOWER, effectiveFrom: TOMORROW, notifyTenantAdmins: false }, meta),
    ).rejects.toThrow(expect.objectContaining({ name: 'QuotaChangeRejectedError', reason: 'LOWERING_NOTICE_REQUIRED' }));
    expect(await overrides(TENANT_1.tenantId)).toEqual([]);
    expect(await quotaAudits(TENANT_1.tenantId)).toEqual([]);
  });

  it('🔴 翌日以降 + 通知で受理。usage.limit-check が OWNER / ADMIN 宛にだけ QUOTA_LOWERED を 1 行作り、2 回目は作らない。監査行に from / to / 適用日', async () => {
    const result = await setTenantQuotaOverride(
      ownerCtx,
      { tenantId: TENANT_1.tenantId, ...LOWER, effectiveFrom: TOMORROW, notifyTenantAdmins: true },
      { now: NOW, defaults: DEFAULTS, ipAddress: '203.0.113.42' },
    );
    expect(result.decision).toEqual({
      kind: 'LOWER',
      metric: 'AI_UNIT_SHEET_PARSE',
      from: 180n,
      to: 100n,
      effectiveFrom: TOMORROW,
      notifyTenantAdmins: true,
    });

    const rows = await overrides(TENANT_1.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.overrideId,
      metric: 'AI_UNIT_SHEET_PARSE',
      limit: 100n,
      previousLimit: 180n,
      setByPlatformUserId: OWNER_USER_ID,
      reason: LOWER.reason,
    });
    expect(rows[0]?.effectiveFrom.toISOString().slice(0, 10)).toBe(TOMORROW);

    // AC-4: 実施者・対象・変更前後の値・適用日。理由の本文は載らない（長さだけ）。
    const audits = await quotaAudits(TENANT_1.tenantId);
    expect(audits).toHaveLength(1);
    const summary = audits[0]?.summary as Record<string, unknown>;
    expect(audits[0]).toMatchObject({ actorKind: 'PLATFORM_USER', actorId: OWNER_USER_ID, targetType: 'TenantQuotaOverride', targetId: result.overrideId });
    expect(summary).toMatchObject({
      metric: 'AI_UNIT_SHEET_PARSE',
      from: '180',
      to: '100',
      effectiveFrom: TOMORROW,
      kind: 'LOWER',
      notifyTenantAdmins: true,
      reasonLength: LOWER.reason.length,
      domain: 'QUOTA',
      platformRole: 'PLATFORM_OWNER',
    });
    expect(JSON.stringify(summary)).not.toContain(LOWER.reason);

    // 🔴 通知はワーカーの単一経路（email.dispatch）。宛先は OWNER / ADMIN（分類 1）だけ。SALES / パートナーには送らない。
    const { run, enqueued } = makeLimitCheckHandler();
    const first = await run(TENANT_1.tenantId);
    expect(first.quotaNoticesQueued).toBe(1);
    const dispatches = await quotaDispatches(TENANT_1.tenantId);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({ recipientClass: 'HOST_MEMBER', recipientEmail: OWNER_EMAIL, status: 'QUEUED' });
    expect(dispatches[0]?.dedupeKey.startsWith(`QUOTA_LOWERED:${result.overrideId}:`)).toBe(true);
    expect(dispatches.map((row) => row.recipientEmail)).not.toContain(SALES_EMAIL);
    expect(dispatches.map((row) => row.recipientEmail)).not.toContain(PARTNER_EMAIL);
    expect(enqueued).toHaveLength(1);

    // 🔴 10 分後の再実行でも 2 通目は作られない（dedupeKey = 上書き行 ID）。
    const second = await run(TENANT_1.tenantId);
    expect(second.quotaNoticesQueued).toBeLessThanOrEqual(1); // 既存の QUEUED 行を積み直すことはある（送信側の CAS が止める）
    expect(await quotaDispatches(TENANT_1.tenantId)).toHaveLength(1);
    // 他テナントには何も起きない。
    expect(await quotaDispatches(TENANT_2.tenantId)).toEqual([]);
    expect(await overrides(TENANT_2.tenantId)).toEqual([]);
  });

  it('引き下げの「現在値」は適用日に効いているはずの上限で判定する（予定された引き上げより低ければ引き下げ）', async () => {
    const meta = { now: NOW, defaults: DEFAULTS };
    // 予定: 明日から 300（引き上げ）。
    await setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...RAISE, effectiveFrom: TOMORROW }, meta);
    // 明後日から 200: 既定 180 より大きいが、明後日に効いているはずの 300 より小さい = 引き下げ → 通知なしは拒否。
    await expect(
      setTenantQuotaOverride(
        ownerCtx,
        { tenantId: TENANT_1.tenantId, metric: 'AI_UNIT_SHEET_PARSE', limit: 200n, effectiveFrom: shiftDayKey(TODAY, 2), notifyTenantAdmins: false, reason: 'x' },
        meta,
      ),
    ).rejects.toThrow(expect.objectContaining({ reason: 'LOWERING_NOTICE_REQUIRED' }));
    const accepted = await setTenantQuotaOverride(
      ownerCtx,
      { tenantId: TENANT_1.tenantId, metric: 'AI_UNIT_SHEET_PARSE', limit: 200n, effectiveFrom: shiftDayKey(TODAY, 2), notifyTenantAdmins: true, reason: 'x' },
      meta,
    );
    expect(accepted.decision.kind).toBe('LOWER');
    expect(accepted.decision.from).toBe(300n);
  });
});

describe('⑤ 引き上げは当日から適用できる', () => {
  it('kind=RAISE。行は effective_from = 今日、previous_limit = 既定値。監査行も 1 本', async () => {
    const result = await setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...RAISE }, { now: NOW, defaults: DEFAULTS });
    expect(result.decision.kind).toBe('RAISE');
    expect(result.decision.notifyTenantAdmins).toBe(false);
    const rows = await overrides(TENANT_1.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.effectiveFrom.toISOString().slice(0, 10)).toBe(TODAY);
    expect(rows[0]?.previousLimit).toBe(180n);
    expect(await quotaAudits(TENANT_1.tenantId)).toHaveLength(1);

    // A-004 の行に出所 = OVERRIDE と値が反映される。
    const snapshot = await readPlatformUsage(ownerCtx, META);
    expect(tenantRow(snapshot, TENANT_1.tenantId).aiUnits.AI_UNIT_SHEET_PARSE).toMatchObject({
      limit: 300,
      quota: { source: 'OVERRIDE', effectiveFrom: TODAY, pending: null },
    });
    expect(tenantRow(snapshot, TENANT_2.tenantId).aiUnits.AI_UNIT_SHEET_PARSE.quota.source).toBe('DEFAULT');
  });

  it('存在しないテナント ID は QuotaOverrideTenantNotFoundError（→ 404）。行も監査行（書き込み）も無い', async () => {
    await expect(
      setTenantQuotaOverride(ownerCtx, { tenantId: '01930000-0000-7000-8000-00000000dead', ...RAISE }, { now: NOW, defaults: DEFAULTS }),
    ).rejects.toThrow(expect.objectContaining({ name: 'QuotaOverrideTenantNotFoundError' }));
    expect(await admin.tenantQuotaOverride.count()).toBe(0);
    expect(await admin.auditLog.count({ where: { action: 'admin.quota.change' } })).toBe(0);
  });
});

describe('⑥ resolveTenantQuotas: 適用日前は既定値・以降は上書き値。判定（decideAiUnitQuota）が変わる', () => {
  it('🔴 明日から 10 件の上書き: 今日は 180（ALLOW）、明日は 10（monthCount 30 で ALLOW_OVERAGE）', async () => {
    await setTenantQuotaOverride(
      ownerCtx,
      { tenantId: TENANT_1.tenantId, metric: 'AI_UNIT_SHEET_PARSE', limit: 10n, effectiveFrom: TOMORROW, notifyTenantAdmins: true, reason: 'x' },
      { now: NOW, defaults: DEFAULTS },
    );
    const ctx = systemTenantCtx(TENANT_1.tenantId, { queue: 'usage.limit-check', jobId: 'test' });
    const today = await resolveTenantQuotas(ctx, { now: NOW, defaults: DEFAULTS });
    expect(today.aiUnitQuotas.AI_UNIT_SHEET_PARSE).toBe(180);
    expect(today.sources.AI_UNIT_SHEET_PARSE).toBe('DEFAULT');
    expect(decideAiUnitQuota({ metric: 'AI_UNIT_SHEET_PARSE', monthCount: 30, quota: today.aiUnitQuotas.AI_UNIT_SHEET_PARSE }).kind).toBe('ALLOW');

    const tomorrow = await resolveTenantQuotas(ctx, { now: new Date(NOW.getTime() + 86_400_000), defaults: DEFAULTS });
    expect(tomorrow.aiUnitQuotas.AI_UNIT_SHEET_PARSE).toBe(10);
    expect(tomorrow.sources.AI_UNIT_SHEET_PARSE).toBe('OVERRIDE');
    expect(decideAiUnitQuota({ metric: 'AI_UNIT_SHEET_PARSE', monthCount: 30, quota: tomorrow.aiUnitQuotas.AI_UNIT_SHEET_PARSE }).kind).toBe('ALLOW_OVERAGE');
    // 他の計測・他テナントは既定値のまま（AI 単位の上書きに引きずられない）。
    expect(tomorrow.emailDailyLimit).toBe(500);
    expect(tomorrow.storageLimitBytes).toBe(50n * GB);
    expect(today.sources.EMAIL_COUNT).toBe('DEFAULT');
    expect(today.sources.STORAGE_BYTES).toBe('DEFAULT');
    expect(tomorrow.sources.EMAIL_COUNT).toBe('DEFAULT');
    expect(tomorrow.sources.STORAGE_BYTES).toBe('DEFAULT');
    const other = await resolveTenantQuotas(systemTenantCtx(TENANT_2.tenantId, { queue: 'usage.limit-check', jobId: 'test' }), {
      now: new Date(NOW.getTime() + 86_400_000),
      defaults: DEFAULTS,
    });
    expect(other.aiUnitQuotas.AI_UNIT_SHEET_PARSE).toBe(180);
  });

  it('🔴 T-12-12: PUT の metric は 6 計測（EMAIL_COUNT / STORAGE_BYTES を受ける。金額 AI_COST_USD は 400）。EMAIL_COUNT / STORAGE_BYTES の上書きが resolveTenantQuotas と A-004 の両方に同じ値で写る', async () => {
    const base = { limit: '900', effectiveFrom: TOMORROW, notifyTenantAdmins: true, reason: 'テスト' };
    expect(parseQuotaChangeBody({ ...base, metric: 'EMAIL_COUNT' }).ok).toBe(true);
    expect(parseQuotaChangeBody({ ...base, metric: 'STORAGE_BYTES' }).ok).toBe(true);
    expect(parseQuotaChangeBody({ ...base, metric: 'AI_COST_USD' })).toEqual({ ok: false, issues: ['metric'] });

    await setTenantQuotaOverride(
      ownerCtx,
      { tenantId: TENANT_1.tenantId, metric: 'EMAIL_COUNT', limit: 900n, effectiveFrom: TODAY, notifyTenantAdmins: false, reason: 'x' },
      { now: NOW, defaults: DEFAULTS },
    );
    await setTenantQuotaOverride(
      ownerCtx,
      { tenantId: TENANT_1.tenantId, metric: 'STORAGE_BYTES', limit: 100n * GB, effectiveFrom: TODAY, notifyTenantAdmins: false, reason: 'x' },
      { now: NOW, defaults: DEFAULTS },
    );
    const ctx = systemTenantCtx(TENANT_1.tenantId, { queue: 'usage.limit-check', jobId: 'test' });
    const resolved = await resolveTenantQuotas(ctx, { now: NOW, defaults: DEFAULTS });
    expect(resolved.emailDailyLimit).toBe(900);
    expect(resolved.storageLimitBytes).toBe(100n * GB);
    expect(resolved.sources.EMAIL_COUNT).toBe('OVERRIDE');
    expect(resolved.sources.STORAGE_BYTES).toBe('OVERRIDE');
    // A-004（API-A6）も同じ resolveQuotaLimit で解く。
    const row = tenantRow(await readPlatformUsage(supportCtx, META), TENANT_1.tenantId);
    expect(row.email).toMatchObject({ limit: 900, quota: { source: 'OVERRIDE', effectiveFrom: TODAY } });
    expect(row.storage).toMatchObject({ limitBytes: (100n * GB).toString(), quota: { source: 'OVERRIDE', effectiveFrom: TODAY } });
    // 監査行の from は既定値（500 / 50 GiB）。
    const audits = await quotaAudits(TENANT_1.tenantId);
    expect(audits.map((audit) => [(audit.summary as { metric: string }).metric, (audit.summary as { from: string }).from])).toEqual([
      ['EMAIL_COUNT', '500'],
      ['STORAGE_BYTES', (50n * GB).toString()],
    ]);
  });

  it('usage.limit-check が上書き後の上限で評価する（当日適用の引き上げ 1,000 件で、900 件は BELOW = 既定 180 なら REACHED）', async () => {
    await upsertCounter(TENANT_1.tenantId, 'MONTH', 'AI_UNIT_SHEET_PARSE', '900');
    await setTenantQuotaOverride(
      ownerCtx,
      { tenantId: TENANT_1.tenantId, metric: 'AI_UNIT_SHEET_PARSE', limit: 1000n, effectiveFrom: TODAY, notifyTenantAdmins: false, reason: 'x' },
      { now: NOW, defaults: DEFAULTS },
    );
    const { run } = makeLimitCheckHandler();
    await run(TENANT_1.tenantId);
    const state = await admin.usageLimitState.findFirst({ where: { tenantId: TENANT_1.tenantId, metric: 'AI_UNIT_SHEET_PARSE' } });
    expect(state?.level).toBe('NEARING'); // 900 / 1000 = 90% ≥ 80%（既定 180 なら REACHED）
  });
});

describe('⑦ DB 権限とポリシー（migration 20260924000000）', () => {
  async function asPlatformWrite<T>(fn: (tx: UnextendedClient) => Promise<T>, target = TENANT_1.tenantId): Promise<T> {
    return rawPlatformWrite.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.platform_user_id', $1, true), set_config('app.target_tenant_id', $2, true),
                set_config('app.platform_auth_email', '', true), set_config('app.platform_auth_subject_id', '', true)`,
        OWNER_USER_ID,
        target,
      );
      return fn(tx as unknown as UnextendedClient);
    });
  }

  it('🔴 app_platform_write は INSERT だけ。UPDATE / DELETE は permission denied（行を書き換える経路が無い）', async () => {
    await setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...RAISE }, { now: NOW, defaults: DEFAULTS });
    await expect(
      asPlatformWrite((tx) => tx.$executeRawUnsafe(`UPDATE tenant_quota_overrides SET "limit" = 1 WHERE tenant_id = $1::uuid`, TENANT_1.tenantId)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asPlatformWrite((tx) => tx.$executeRawUnsafe(`DELETE FROM tenant_quota_overrides WHERE tenant_id = $1::uuid`, TENANT_1.tenantId)),
    ).rejects.toThrow(/permission denied/);
    // SELECT も無い（読み返すのは app_platform 側）。
    await expect(asPlatformWrite((tx) => tx.$queryRawUnsafe(`SELECT 1 FROM tenant_quota_overrides`))).rejects.toThrow(/permission denied/);
    expect(await overrides(TENANT_1.tenantId)).toHaveLength(1);
  });

  it('🔴 WITH CHECK: 当日適用の引き下げ / 他人名義 / 対象外テナント / 過去の適用日 の INSERT はポリシー違反で入らない', async () => {
    const insert = (over: { readonly limit: number; readonly previous: number; readonly effectiveFrom: string; readonly setBy?: string; readonly tenantId?: string }) =>
      asPlatformWrite(
        (tx) =>
          tx.$executeRawUnsafe(
            // 🔴 T-11-02 NG-1: 上書きできる metric は AI 4 単位のみ（CHECK が EMAIL_COUNT / STORAGE_BYTES を拒む）。
            `INSERT INTO tenant_quota_overrides (id, tenant_id, metric, "limit", previous_limit, effective_from, set_by_platform_user_id, reason)
             VALUES (gen_random_uuid(), $1::uuid, 'AI_UNIT_SHEET_PARSE', $2, $3, $4::date, $5::uuid, 'raw')`,
            over.tenantId ?? TENANT_1.tenantId,
            over.limit,
            over.previous,
            over.effectiveFrom,
            over.setBy ?? OWNER_USER_ID,
          ),
        TENANT_1.tenantId,
      );
    // 引き下げを当日に（F-057 AC-3 の DB 側の担保）。
    await expect(insert({ limit: 100, previous: 500, effectiveFrom: TODAY })).rejects.toThrow(/row-level security/);
    // 過去の適用日。
    await expect(insert({ limit: 900, previous: 500, effectiveFrom: YESTERDAY })).rejects.toThrow(/row-level security/);
    // 他人名義。
    await expect(insert({ limit: 900, previous: 500, effectiveFrom: TODAY, setBy: SUPPORT_USER_ID })).rejects.toThrow(/row-level security/);
    // 対象外テナント（app.target_tenant_id と不一致）。
    await expect(insert({ limit: 900, previous: 500, effectiveFrom: TODAY, tenantId: TENANT_2.tenantId })).rejects.toThrow(/row-level security/);
    // 対照: 当日の引き上げ / 明日の引き下げ は入る。
    await insert({ limit: 900, previous: 500, effectiveFrom: TODAY });
    await insert({ limit: 100, previous: 500, effectiveFrom: TOMORROW });
    expect(await overrides(TENANT_1.tenantId)).toHaveLength(2);
    expect(await overrides(TENANT_2.tenantId)).toHaveLength(0);
  });

  it('app_tenant: ホスト文脈は自テナントの行を読める。パートナー文脈は AI 単位の行が 0 行（C2。開くのは STORAGE_BYTES だけ。T-12-12 / F-027 AC-1）。他テナントは 0 行。reason / set_by_platform_user_id は列 GRANT で permission denied。INSERT は permission denied', async () => {
    await setTenantQuotaOverride(ownerCtx, { tenantId: TENANT_1.tenantId, ...RAISE }, { now: NOW, defaults: DEFAULTS });
    const rawTenant = createUnextendedClient(database.tenantUrl);
    try {
      const read = (partnerCompanyId: string, tenantId = TENANT_1.tenantId, columns = 'metric') =>
        rawTenant.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.tenant_id', $1, true), set_config('app.partner_company_id', $2, true),
                    set_config('app.actor_user_id', $3, true), set_config('app.shared_scope', 'off', true)`,
            tenantId,
            partnerCompanyId,
            TENANT_1.hostUserId,
          );
          return tx.$queryRawUnsafe<Array<{ metric: string }>>(`SELECT ${columns} FROM tenant_quota_overrides`);
        });
      expect(await read('')).toHaveLength(1);
      // 🔴 T-12-12: パートナー文脈に開くのは `STORAGE_BYTES` の行だけ（migration 20260928000000 判断事項 2）。AI 単位の上書きは 0 行
      //    （`F-027 AC-1`。上限値はホスト所属ロールにのみ表示する）。ストレージ側は `quota-override-enforcement.test.ts` ③。
      expect(await read(TENANT_1.partners[0].partnerCompanyId)).toHaveLength(0);
      expect(await read('', TENANT_2.tenantId)).toHaveLength(0);
      expect(await read(TENANT_1.partners[0].partnerCompanyId, TENANT_2.tenantId)).toHaveLength(0);
      // 🔴 運営者の記述・識別子は業務ロールから読めない（ホスト文脈でも）。
      for (const partner of ['', TENANT_1.partners[0].partnerCompanyId]) {
        await expect(read(partner, TENANT_1.tenantId, 'reason')).rejects.toThrow(/permission denied/);
        await expect(read(partner, TENANT_1.tenantId, 'set_by_platform_user_id')).rejects.toThrow(/permission denied/);
        await expect(read(partner, TENANT_1.tenantId, '*')).rejects.toThrow(/permission denied/);
      }
      await expect(
        rawTenant.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true), set_config('app.partner_company_id', '', true), set_config('app.actor_user_id', $2, true)`, TENANT_1.tenantId, TENANT_1.hostUserId);
          await tx.$executeRawUnsafe(
            `INSERT INTO tenant_quota_overrides (id, tenant_id, metric, "limit", previous_limit, effective_from, set_by_platform_user_id, reason)
             VALUES (gen_random_uuid(), $1::uuid, 'AI_UNIT_SHEET_PARSE', 900, 500, current_date, $2::uuid, 'raw')`,
            TENANT_1.tenantId,
            OWNER_USER_ID,
          );
        }),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await rawTenant.$disconnect();
    }
  });
});

describe('⑧ 応答に PII・業務データが無い（BR-40）。主平面には金額が渡らない', () => {
  it('readPlatformUsage の JSON に利用者名・メール・エンジニア名・提案本文が無い', async () => {
    await insertAiUsage(TENANT_1.tenantId, 'gate-inspector', '1.000000');
    const snapshot = await readPlatformUsage(supportCtx, META);
    const json = JSON.stringify(snapshot, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    // 🔴 `purpose`（'gate'）はロール名 `gate-inspector` の部分文字列なのでキー名で見る（`purpose` のキーが無い）。
    expect(json).not.toContain('"purpose"');
    for (const forbidden of [OWNER_EMAIL, SALES_EMAIL, PARTNER_EMAIL, 'seed-forbidden', MODEL_ID, PROMPT_VERSION, '"targetId"', '"modelId"']) {
      expect(json).not.toContain(forbidden);
    }
    // テナント名は出す（運営者が対処する相手を特定するため）。
    expect(json).toContain(tenantRow(snapshot, TENANT_1.tenantId).name);
  });

  it('🔴 主平面が受け取る解決済みの上限（resolveTenantQuotas）に金額（USD）のキーが無い', async () => {
    const ctx = systemTenantCtx(TENANT_1.tenantId, { queue: 'usage.limit-check', jobId: 'test' });
    const resolved = await resolveTenantQuotas(ctx, { now: NOW, defaults: DEFAULTS });
    const keys = JSON.stringify(resolved, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    expect(keys).not.toMatch(/usd|cost|price|cap/i);
    expect(Object.keys(resolved).sort()).toEqual(['aiUnitQuotas', 'dayKey', 'emailDailyLimit', 'sources', 'storageLimitBytes']);
  });
});
