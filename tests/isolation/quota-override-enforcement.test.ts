// tests/isolation/quota-override-enforcement.test.ts
// 🔴 T-12-12 の完了判定 = メール / ストレージのクォータ上書き（`tenant_quota_overrides`。`EMAIL_COUNT` / `STORAGE_BYTES`）が
//    **表示（`A-004` / `S-038`）・判定（`usage.limit-check`）だけでなく、実際の執行点で効く**こと（T-11-02 NG-1 の解消。
//    docs/02 `F-027` / `F-057` / docs/05 §5.2 / §5.8.1 ⑧ / §6.9 API-A6 / `CLAUDE.md` §3.1 第二境界 / §3.4 / §10.5）。
//    **実 DB（RLS 付き）+ 実 Redis（BullMQ）+ 実ワーカー（`performEmailSend` / `send.hold-release` / `usage.limit-check`）+
//    モックメール（`packages/connectors/src/mock` = `development` / `demo` / E2E と同一実装）**。実 SES / 実 Anthropic には接続しない。
//
//   ① `EMAIL_COUNT` の上書きが `email.dispatch` の執行点（`performEmailSend` の `decideEmailRate` / `reserveEmailDailyQuota`）で効く。
//      引き上げは当日から（既定 1 通 → 2 通: 3 通目が `RATE_LIMITED`）、引き下げは翌日から（既定 500 → 2: 今日は通り、明日は 3 通目が止まる）
//   ② `STORAGE_BYTES` の上書きが `issueSkillSheetUploadUrl`（`decideStorageUpload`）で効く。🔴 **ホスト文脈とパートナー文脈の両方**
//      （取引先のアップロードも同じテナントの枠を消費する。migration 20260928000000 判断事項 2）
//   ③ 🔴 パートナー文脈からの読み取り（第二境界。`F-027 AC-1`「上限値はホスト所属ロールにのみ表示」）: `resolveTenantStorageQuota` は
//      ホストの `resolveTenantQuotas().storageLimitBytes` と一致し、6 計測の `resolveTenantQuotas` はパートナー文脈では**型で呼べない**。
//      素の `app_tenant` 接続はパートナー文脈で **`STORAGE_BYTES` の行だけ**（`EMAIL_COUNT` を上書きしても 0 行）、ホストは全計測。
//      `reason` / `set_by_platform_user_id` は列 GRANT で permission denied（両文脈）。他テナントの行は 0
//   ④ 🔴 3 者一致: 上書き後に `usage.limit-check` の水準・`S-038`（`readUsageView`）・`A-004`（`readPlatformUsage`）・実際の執行
//      （`performEmailSend` / `issueSkillSheetUploadUrl`）が**同じ上限値**を見る（既定値なら判定が変わる値で対照）
//   ⑤ `send.hold-release` が、上限の引き上げ後に `RATE_LIMIT` の保留を解除し、同じ `attemptSeq` で `send.proposal` を再 enqueue する
//
// 🔴 現在時刻は**実時刻**を使う（`admin-usage-quota.test.ts` と同じ。DB の `WITH CHECK` が `now()` の暦日で適用日を検査するため）。
//    「明日」は `NOW + 24h` で作り、期間キー（日 / 月）は `usagePeriodKey` で同じ規則から導く。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectors,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
} from '@ses/connectors';
import { createBullMqSendProposalQueue, type BullMqSendProposalQueue } from '@ses/connectors/bullmq';
import {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  configureTenantDb,
  disconnectTenantDb,
  emailDispatchDedupeKey,
  readEmailDispatch,
  requireHost,
  requirePlatformOwner,
  reserveEmailDispatch,
  resolvePlatformCtx,
  resolveTenantQuotas,
  resolveTenantStorageQuota,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type PlatformOwnerCtx,
  type SystemTenantCtx,
  type TenantIdentity,
  type TenantQuotaDefaults,
} from '@ses/db';
import { readPlatformUsage, setTenantQuotaOverride } from '@ses/db/platform';
import { createObjectStore, type ObjectStore } from '@ses/connectors';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { shiftDayKey } from '../../packages/domain/src/usage/day-keys.js';
import { usagePeriodKey } from '../../packages/domain/src/usage/period-key.js';
import { performEmailSend, type EmailSendDeps } from '../../apps/worker/src/jobs/email-send.js';
import { createSendHoldReleaseHandler } from '../../apps/worker/src/jobs/send-hold-release.js';
import { createUsageLimitCheckHandler, USAGE_LIMIT_CHECK_JOB } from '../../apps/worker/src/jobs/usage-limit-check.js';
import { StorageLimitExceededError } from '../../apps/web/lib/api/errors';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { quotaDefaultsWith, TEST_QUOTA_DEFAULTS } from './support/quota-defaults.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const GB = 1024n * 1024n * 1024n;
const MB = 1024n * 1024n;

const NOW = new Date();
const TOMORROW_AT = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
const TODAY = usagePeriodKey('DAY', NOW);
const TOMORROW = shiftDayKey(TODAY, 1);

const OWNER_USER_ID = '01930000-0000-7000-8000-00000012120a';
const META = { deviceKind: 'api', ipAddress: '203.0.113.212' } as const;
const JOB = { queue: 'email.dispatch', jobId: 'email.dispatch:t1212' } as const;

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];

const HOST_1: TenantIdentity = { tenantId: TENANT_1.tenantId, partnerCompanyId: null, userId: TENANT_1.hostUserId };
const PARTNER_USER_1_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 🔴 `S-038` の表示側が読む起動時 DI の値（`packages/config`）。ワーカー・執行点に渡す既定値と同じ。金額を含まない。 */
const LIMITS = {
  warnPercent: 80,
  ...TEST_QUOTA_DEFAULTS,
  emailMinuteLimit: 30,
};

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  usageLimitsRuntime: () => LIMITS,
  tenantQuotaDefaults: () => TEST_QUOTA_DEFAULTS,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { issueSkillSheetUploadUrl } = await import('../../apps/web/lib/skill-sheets/service');
const { readUsageView } = await import('../../apps/web/lib/usage/view');

const UPLOAD_BODY = {
  fileName: 'skill-sheet.xlsx',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  byteSize: Number(3n * MB / 2n), // 1.5 MB
} as const;

let database: IsolationDatabase;
let redis: IsolationRedis;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let ownerCtx: PlatformOwnerCtx;
let connectors: Connectors;
let store: ObjectStore;
let sendQueue: BullMqSendProposalQueue;
let hostCtx: AuthenticatedTenantCtx;
let partnerCtx: AuthenticatedTenantCtx;
let jobCtx: SystemTenantCtx;

// ---------------------------------------------------------------------------
// 仕込み
// ---------------------------------------------------------------------------

async function override(
  metric: 'EMAIL_COUNT' | 'STORAGE_BYTES',
  limit: bigint,
  effectiveFrom: string,
  defaults: TenantQuotaDefaults = TEST_QUOTA_DEFAULTS,
  tenantId = TENANT_1.tenantId,
): Promise<void> {
  // 🔴 実 API-A6 の書き込み経路（`app_platform_write` の INSERT + WITH CHECK）。引き下げは翌日以降 + 通知が必須。
  const lowering = limit < (metric === 'EMAIL_COUNT' ? BigInt(defaults.emailDailyLimit) : defaults.storageLimitBytes);
  await setTenantQuotaOverride(
    ownerCtx,
    { tenantId, metric, limit, effectiveFrom, notifyTenantAdmins: lowering, reason: `T-12-12 ${metric}` },
    { now: NOW, defaults },
  );
}

async function upsertCounter(tenantId: string, periodKind: 'DAY' | 'MONTH', at: Date, metric: string, value: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5::numeric, 0, now())
     ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE SET value = EXCLUDED.value`,
    tenantId,
    periodKind,
    usagePeriodKey(periodKind, at),
    metric,
    value,
  );
}

function emailDeps(defaults: TenantQuotaDefaults, now: Date): EmailSendDeps {
  return {
    emailSender: connectors.email,
    emailImplementationKind: 'mock',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    quotaDefaults: defaults,
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: async () => null,
    now: () => now,
  };
}

/** 運用メール（分類 1）を 1 通予約して送る（`email.dispatch` の 1 手順そのもの）。 */
async function sendOne(ctx: SystemTenantCtx, targetId: string, deps: EmailSendDeps) {
  const reservation = await reserveEmailDispatch(ctx, {
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.co.jp',
    templateKey: 'TENANT_CLOSING_NOTICE',
    dedupeKey: emailDispatchDedupeKey({ templateKey: 'TENANT_CLOSING_NOTICE', targetId, recipientEmail: 'owner@example.co.jp' }),
    observedAt: deps.now(),
  });
  const dispatch = await readEmailDispatch(ctx, reservation.dispatchId);
  if (dispatch === null) throw new Error('予約した行が読めない（前提の破綻）。');
  const outcome = await performEmailSend(deps, { ctx, dispatch, params: {} });
  const row = await admin.emailDispatch.findUniqueOrThrow({ where: { id: reservation.dispatchId }, select: { status: true } });
  return { outcome, status: row.status };
}

function uploadDeps(defaults: TenantQuotaDefaults, now: Date) {
  return { objectStore: store, uploadMaxBytes: 20 * 1024 * 1024, quotaDefaults: defaults, now: () => now };
}

function limitCheck(now: Date) {
  return createUsageLimitCheckHandler({
    now: () => now,
    models: { resolve: async () => 'claude-sonnet-5' },
    aiDailyCostLimitUsd: '5.000000',
    usageLimits: { warnPercent: 80, ...TEST_QUOTA_DEFAULTS },
    enqueueEmailDispatch: async () => undefined,
  });
}

async function limitLevel(metric: string): Promise<string | null> {
  const row = await admin.usageLimitState.findFirst({ where: { tenantId: TENANT_1.tenantId, metric }, select: { level: true } });
  return row?.level ?? null;
}

async function ctxOf(identity: TenantIdentity): Promise<AuthenticatedTenantCtx> {
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function resetAll(): Promise<void> {
  await admin.$executeRawUnsafe(`DELETE FROM tenant_quota_overrides`);
  await admin.$executeRawUnsafe(`DELETE FROM usage_counters WHERE metric IN ('EMAIL_COUNT', 'STORAGE_BYTES')`);
  await admin.$executeRawUnsafe(`DELETE FROM usage_limit_states`);
  await admin.$executeRawUnsafe(`DELETE FROM email_dispatches`);
  await admin.$executeRawUnsafe(`DELETE FROM audit_logs WHERE action IN ('admin.quota.change', 'admin.usage.view') OR action LIKE 'usage.limit_%'`);
  // 到達回数を 0 から数える（モックはプロセス内の計数器。E2E / demo と同一実装）。
  connectors = createConnectors({ email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });
  store = createObjectStore('mock');
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  const owner = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  requirePlatformOwner(owner);
  ownerCtx = owner;
  // 🔴 E2E / demo と同一のモック実装（docs/05 §13.2 / §17.5）。
  store = createObjectStore('mock');
  sendQueue = createBullMqSendProposalQueue({ url: redis.url });
  hostCtx = await ctxOf(HOST_1);
  partnerCtx = await ctxOf(PARTNER_USER_1_1);
  jobCtx = systemTenantCtx(TENANT_1.tenantId, JOB);
  connectors = createConnectors({ email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await sendQueue?.close();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await resetAll();
});

// ---------------------------------------------------------------------------
// ① EMAIL_COUNT の上書きが送信の執行点で効く
// ---------------------------------------------------------------------------

describe('① EMAIL_COUNT の上書きが email.dispatch の執行点（decideEmailRate / reserveEmailDailyQuota）で効く', () => {
  it('🔴 引き上げは当日から: 既定 1 通のテナントを 2 通に上書き → 1・2 通目は送られ、3 通目は RATE_LIMITED（外部到達 2 回）', async () => {
    const defaults = quotaDefaultsWith({ emailDailyLimit: 1 });
    await override('EMAIL_COUNT', 2n, TODAY, defaults);
    const deps = emailDeps(defaults, NOW);

    expect((await sendOne(jobCtx, 'raise-1', deps)).outcome.kind).toBe('MOCKED');
    expect((await sendOne(jobCtx, 'raise-2', deps)).outcome.kind).toBe('MOCKED');
    const third = await sendOne(jobCtx, 'raise-3', deps);
    expect(third.outcome).toEqual({ kind: 'RATE_LIMITED', dailyLimit: 2 });
    expect(third.status).toBe('SUPPRESSED');
    expect(connectors.email.callCount()).toBe(2);
  });

  it('🔴 引き下げは翌日から: 既定 500 → 2（適用日 = 明日）。今日は 3 通とも送られ、明日は 3 通目が止まる。resolveTenantQuotas も同じ日付で切り替わる', async () => {
    await override('EMAIL_COUNT', 2n, TOMORROW);
    const today = emailDeps(TEST_QUOTA_DEFAULTS, NOW);
    for (const target of ['lower-today-1', 'lower-today-2', 'lower-today-3']) {
      expect((await sendOne(jobCtx, target, today)).outcome.kind).toBe('MOCKED');
    }
    expect(connectors.email.callCount()).toBe(3);

    const tomorrow = emailDeps(TEST_QUOTA_DEFAULTS, TOMORROW_AT);
    expect((await sendOne(jobCtx, 'lower-tomorrow-1', tomorrow)).outcome.kind).toBe('MOCKED');
    expect((await sendOne(jobCtx, 'lower-tomorrow-2', tomorrow)).outcome.kind).toBe('MOCKED');
    expect((await sendOne(jobCtx, 'lower-tomorrow-3', tomorrow)).outcome).toEqual({ kind: 'RATE_LIMITED', dailyLimit: 2 });
    expect(connectors.email.callCount()).toBe(5);

    const resolvedToday = await resolveTenantQuotas(jobCtx, { now: NOW, defaults: TEST_QUOTA_DEFAULTS });
    const resolvedTomorrow = await resolveTenantQuotas(jobCtx, { now: TOMORROW_AT, defaults: TEST_QUOTA_DEFAULTS });
    expect([resolvedToday.emailDailyLimit, resolvedToday.sources.EMAIL_COUNT]).toEqual([500, 'DEFAULT']);
    expect([resolvedTomorrow.emailDailyLimit, resolvedTomorrow.sources.EMAIL_COUNT]).toEqual([2, 'OVERRIDE']);
  });

  it('他テナントの上書きは効かない（テナント 2 に 2 通の上書き → テナント 1 は既定のまま）', async () => {
    await override('EMAIL_COUNT', 2n, TODAY, quotaDefaultsWith({ emailDailyLimit: 1 }), TENANT_2.tenantId);
    const resolved = await resolveTenantQuotas(jobCtx, { now: NOW, defaults: quotaDefaultsWith({ emailDailyLimit: 1 }) });
    expect([resolved.emailDailyLimit, resolved.sources.EMAIL_COUNT]).toEqual([1, 'DEFAULT']);
    const deps = emailDeps(quotaDefaultsWith({ emailDailyLimit: 1 }), NOW);
    expect((await sendOne(jobCtx, 'other-1', deps)).outcome.kind).toBe('MOCKED');
    expect((await sendOne(jobCtx, 'other-2', deps)).outcome).toEqual({ kind: 'RATE_LIMITED', dailyLimit: 1 });
  });
});

// ---------------------------------------------------------------------------
// ② STORAGE_BYTES の上書きが署名発行の執行点で効く（ホスト / パートナー）
// ---------------------------------------------------------------------------

describe('② STORAGE_BYTES の上書きが issueSkillSheetUploadUrl（decideStorageUpload）で効く。ホスト文脈とパートナー文脈の両方', () => {
  it('🔴 引き上げは当日から: 既定 1 MB では 1.5 MB のアップロードが拒否され、100 MB に上書きすると発行される（ホスト / パートナー）', async () => {
    const defaults = quotaDefaultsWith({ storageLimitBytes: 1n * MB });
    await expect(issueSkillSheetUploadUrl(hostCtx, TENANT_1.hostEngineerId, UPLOAD_BODY, uploadDeps(defaults, NOW))).rejects.toBeInstanceOf(
      StorageLimitExceededError,
    );
    await expect(issueSkillSheetUploadUrl(partnerCtx, PARTNER_1_1.engineerId, UPLOAD_BODY, uploadDeps(defaults, NOW))).rejects.toBeInstanceOf(
      StorageLimitExceededError,
    );
    expect(store.callCount()).toBe(0);

    await override('STORAGE_BYTES', 100n * MB, TODAY, defaults);
    const host = await issueSkillSheetUploadUrl(hostCtx, TENANT_1.hostEngineerId, UPLOAD_BODY, uploadDeps(defaults, NOW));
    expect(host.objectKey.startsWith(`t/${TENANT_1.tenantId}/skill-sheets/`)).toBe(true);
    // 🔴 パートナー文脈でも同じ上書きが効く（取引先のアップロードも同じ枠を消費する）。
    const partner = await issueSkillSheetUploadUrl(partnerCtx, PARTNER_1_1.engineerId, UPLOAD_BODY, uploadDeps(defaults, NOW));
    expect(partner.objectKey.startsWith(`t/${TENANT_1.tenantId}/skill-sheets/`)).toBe(true);
    expect(store.callCount()).toBe(2);
  });

  it('🔴 引き下げは翌日から: 既定 50 GB → 1 MB（適用日 = 明日）。今日は両文脈とも発行され、明日は両文脈とも拒否される', async () => {
    await override('STORAGE_BYTES', 1n * MB, TOMORROW);
    await issueSkillSheetUploadUrl(hostCtx, TENANT_1.hostEngineerId, UPLOAD_BODY, uploadDeps(TEST_QUOTA_DEFAULTS, NOW));
    await issueSkillSheetUploadUrl(partnerCtx, PARTNER_1_1.engineerId, UPLOAD_BODY, uploadDeps(TEST_QUOTA_DEFAULTS, NOW));
    await expect(
      issueSkillSheetUploadUrl(hostCtx, TENANT_1.hostEngineerId, UPLOAD_BODY, uploadDeps(TEST_QUOTA_DEFAULTS, TOMORROW_AT)),
    ).rejects.toBeInstanceOf(StorageLimitExceededError);
    await expect(
      issueSkillSheetUploadUrl(partnerCtx, PARTNER_1_1.engineerId, UPLOAD_BODY, uploadDeps(TEST_QUOTA_DEFAULTS, TOMORROW_AT)),
    ).rejects.toBeInstanceOf(StorageLimitExceededError);
    // 拒否は署名の前（発行してから失敗させない）。
    expect(store.callCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ③ パートナー文脈からの読み取り（第二境界 + 運営者の記述・識別子の非開示）
// ---------------------------------------------------------------------------

describe('③ 🔴 パートナー文脈からの読み取り: 開くのは STORAGE_BYTES の行だけ（F-027 AC-1）。reason / set_by_platform_user_id は列 GRANT で読めない。他テナントは 0 行', () => {
  it('resolveTenantStorageQuota はパートナー文脈でもホストの resolveTenantQuotas().storageLimitBytes と一致し、戻り値に reason / 運営者 ID / 他の計測のキーが無い', async () => {
    await override('EMAIL_COUNT', 900n, TODAY);
    await override('STORAGE_BYTES', 100n * GB, TODAY);
    // 🔴 6 計測を解けるのはホスト文脈だけ（`HostTenantCtx` へのアサーション。パートナー文脈なら throw）。
    requireHost(hostCtx);
    const host = await resolveTenantQuotas(hostCtx, { now: NOW, defaults: TEST_QUOTA_DEFAULTS });
    const partner = await resolveTenantStorageQuota(partnerCtx, { now: NOW, defaults: TEST_QUOTA_DEFAULTS });
    const hostStorage = await resolveTenantStorageQuota(hostCtx, { now: NOW, defaults: TEST_QUOTA_DEFAULTS });
    expect(host.storageLimitBytes).toBe(100n * GB);
    expect(host.sources.STORAGE_BYTES).toBe('OVERRIDE');
    expect(partner).toEqual({ dayKey: host.dayKey, storageLimitBytes: 100n * GB, source: 'OVERRIDE' });
    expect(hostStorage).toEqual(partner);
    // 🔴 パートナー文脈の戻り値は STORAGE_BYTES 1 計測だけ（メール / AI の上限値のキーが無い = F-027 AC-1）。
    expect(Object.keys(partner).sort()).toEqual(['dayKey', 'source', 'storageLimitBytes']);
    const json = JSON.stringify(partner, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    expect(json).not.toMatch(/reason|setBy|platformUser|usd|cost|email|aiUnit/i);
    expect(json).not.toContain(OWNER_USER_ID);
  });

  it('🔴 6 計測の resolveTenantQuotas はパートナー文脈では型で呼べない（HostTenantCtx。「読めたように見えて既定値が返る」を tsc が止める）', () => {
    // 🔴 `@ts-expect-error` は「その行にエラーが**出ること**」を要求する。引数が `AuthenticatedTenantCtx` に広がった瞬間に
    //    `tsc -p tsconfig.tests.json` が落ちる装置である。実行はしない（型だけの検査）。
    const neverCalled = (): unknown =>
      // @ts-expect-error F-027 AC-1: パートナー文脈（AuthenticatedTenantCtx）で 6 計測の上限は解けない（HostTenantCtx 限定）
      resolveTenantQuotas(partnerCtx, { now: NOW, defaults: TEST_QUOTA_DEFAULTS });
    expect(typeof neverCalled).toBe('function');
  });

  it('🔴 素の app_tenant 接続: パートナー文脈は STORAGE_BYTES の行だけ（EMAIL_COUNT を上書きしても 0 行）、ホストは両方。reason / set_by_platform_user_id / * は両文脈で permission denied、他テナントは 0 行', async () => {
    const rawTenant = createUnextendedClient(database.tenantUrl);
    try {
      const read = (partnerCompanyId: string, tenantId: string, columns: string) =>
        rawTenant.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.tenant_id', $1, true), set_config('app.partner_company_id', $2, true),
                    set_config('app.actor_user_id', $3, true), set_config('app.shared_scope', 'off', true)`,
            tenantId,
            partnerCompanyId,
            partnerCompanyId === '' ? TENANT_1.hostUserId : PARTNER_1_1.userId,
          );
          return tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT ${columns} FROM tenant_quota_overrides ORDER BY metric`);
        });
      const PARTNER = PARTNER_1_1.partnerCompanyId;
      const HOST = '';
      const VISIBLE = 'metric, "limit"::text AS limit, effective_from::text AS effective_from';

      // (a) EMAIL_COUNT だけ上書き → パートナー文脈は 0 行（メールの上限値は取引先に見せない）。ホストは 1 行。
      await override('EMAIL_COUNT', 900n, TODAY);
      expect(await read(PARTNER, TENANT_1.tenantId, VISIBLE)).toEqual([]);
      expect(await read(HOST, TENANT_1.tenantId, VISIBLE)).toEqual([{ metric: 'EMAIL_COUNT', limit: '900', effective_from: TODAY }]);

      // (b) STORAGE_BYTES も上書き → パートナー文脈は STORAGE_BYTES の 1 行だけ。ホストは 2 行。
      await override('STORAGE_BYTES', 100n * GB, TODAY);
      expect(await read(PARTNER, TENANT_1.tenantId, VISIBLE)).toEqual([
        { metric: 'STORAGE_BYTES', limit: (100n * GB).toString(), effective_from: TODAY },
      ]);
      expect(await read(HOST, TENANT_1.tenantId, VISIBLE)).toEqual([
        { metric: 'EMAIL_COUNT', limit: '900', effective_from: TODAY },
        { metric: 'STORAGE_BYTES', limit: (100n * GB).toString(), effective_from: TODAY },
      ]);

      for (const partner of [PARTNER, HOST]) {
        // (c) 列 GRANT は不変（ポリシーが通す行でも、運営者の記述・識別子の列は両文脈で読めない）。
        await expect(read(partner, TENANT_1.tenantId, 'reason')).rejects.toThrow(/permission denied/);
        await expect(read(partner, TENANT_1.tenantId, 'set_by_platform_user_id')).rejects.toThrow(/permission denied/);
        await expect(read(partner, TENANT_1.tenantId, '*')).rejects.toThrow(/permission denied/);
        // (d) 他テナント（分離キーはセッション変数から。テナント 2 の文脈ではテナント 1 の行が見えない）。
        expect(await read(partner, TENANT_2.tenantId, 'metric')).toEqual([]);
      }
    } finally {
      await rawTenant.$disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 3 者一致（判定 / 表示 / 執行）
// ---------------------------------------------------------------------------

describe('④ 🔴 3 者一致: usage.limit-check の水準・S-038・A-004・実際の執行が同じ上限値を見る', () => {
  it('EMAIL_COUNT: 既定 1 通 → 10 通に上書き。3 通送信済み = 判定 BELOW / 表示 10 通 / 実際に 4 通目が送れる（既定なら REACHED・停止）', async () => {
    const defaults = quotaDefaultsWith({ emailDailyLimit: 1 });
    await override('EMAIL_COUNT', 10n, TODAY, defaults);
    await upsertCounter(TENANT_1.tenantId, 'DAY', NOW, 'EMAIL_COUNT', '3');

    // 判定（ワーカー）。既定値の 1 通なら 300% = REACHED になる値。
    await createUsageLimitCheckHandler({
      now: () => NOW,
      models: { resolve: async () => 'claude-sonnet-5' },
      aiDailyCostLimitUsd: '5.000000',
      usageLimits: { warnPercent: 80, ...defaults },
      enqueueEmailDispatch: async () => undefined,
    })({ tenantId: TENANT_1.tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:1`);
    expect(await limitLevel('EMAIL_COUNT')).toBe('BELOW');

    // 表示（`A-004`。運営者）。
    const platform = await readPlatformUsage(ownerCtx, {
      ipAddress: META.ipAddress,
      now: NOW,
      warnPercent: 80,
      defaults,
      aiDailyCostLimitUsd: 5,
      aiMonthlyCostCapUsd: 40,
      providerCapUsd: 500,
    });
    const row = platform.tenants.find((item) => item.tenantId === TENANT_1.tenantId);
    expect(row?.email).toMatchObject({ used: 3, limit: 10, consumptionPercent: 30, level: 'BELOW', quota: { source: 'OVERRIDE', effectiveFrom: TODAY } });

    // 執行（4 通目が送れる。既定 1 通なら止まる）。
    const deps = emailDeps(defaults, NOW);
    expect((await sendOne(jobCtx, 'agree-4', deps)).outcome.kind).toBe('MOCKED');

    // 到達させる（10 通）→ 判定 REACHED / 執行は RATE_LIMITED（上限値 10）で一致。
    await upsertCounter(TENANT_1.tenantId, 'DAY', NOW, 'EMAIL_COUNT', '10');
    await limitCheckWithDefaults(defaults);
    expect(await limitLevel('EMAIL_COUNT')).toBe('REACHED');
    expect((await sendOne(jobCtx, 'agree-11', deps)).outcome).toEqual({ kind: 'RATE_LIMITED', dailyLimit: 10 });
  });

  it('STORAGE_BYTES: 既定 50 GB → 4 MB（適用日 = 明日）。明日の判定 NEARING / S-038 の上限 4 MB / A-004 の上限 4 MB / 1.5 MB の署名が拒否（既定なら BELOW・発行）', async () => {
    await override('STORAGE_BYTES', 4n * MB, TOMORROW);
    await upsertCounter(TENANT_1.tenantId, 'MONTH', TOMORROW_AT, 'STORAGE_BYTES', (7n * MB / 2n).toString());
    const body = UPLOAD_BODY; // 1.5 MB（`UPLOAD_MAX_BYTES` 20 MB の内側）

    // 今日: 既定 50 GB。判定 BELOW / 発行される。
    await limitCheck(NOW)({ tenantId: TENANT_1.tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:today`);
    expect(await limitLevel('STORAGE_BYTES')).toBe('BELOW');
    await upsertCounter(TENANT_1.tenantId, 'MONTH', NOW, 'STORAGE_BYTES', (7n * MB / 2n).toString());
    await issueSkillSheetUploadUrl(hostCtx, TENANT_1.hostEngineerId, body, uploadDeps(TEST_QUOTA_DEFAULTS, NOW));

    // 明日: 上書き 4 MB。判定 NEARING（87%）/ S-038 / A-004 / 執行（3.5 + 1.5 > 4 で拒否）が一致。
    await limitCheck(TOMORROW_AT)({ tenantId: TENANT_1.tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:tomorrow`);
    expect(await limitLevel('STORAGE_BYTES')).toBe('NEARING');

    const view = await readUsageView(hostCtx, TOMORROW_AT);
    expect(view.storage).toMatchObject({ usedBytes: (7n * MB / 2n).toString(), limitBytes: (4n * MB).toString(), level: 'NEARING' });

    const platform = await readPlatformUsage(ownerCtx, {
      ipAddress: META.ipAddress,
      now: TOMORROW_AT,
      warnPercent: 80,
      defaults: TEST_QUOTA_DEFAULTS,
      aiDailyCostLimitUsd: 5,
      aiMonthlyCostCapUsd: 40,
      providerCapUsd: 500,
    });
    const row = platform.tenants.find((item) => item.tenantId === TENANT_1.tenantId);
    expect(row?.storage).toMatchObject({ limitBytes: (4n * MB).toString(), consumptionPercent: 87, quota: { source: 'OVERRIDE', effectiveFrom: TOMORROW } });

    await expect(
      issueSkillSheetUploadUrl(hostCtx, TENANT_1.hostEngineerId, body, uploadDeps(TEST_QUOTA_DEFAULTS, TOMORROW_AT)),
    ).rejects.toBeInstanceOf(StorageLimitExceededError);
    await expect(
      issueSkillSheetUploadUrl(partnerCtx, PARTNER_1_1.engineerId, body, uploadDeps(TEST_QUOTA_DEFAULTS, TOMORROW_AT)),
    ).rejects.toBeInstanceOf(StorageLimitExceededError);
  });

  async function limitCheckWithDefaults(defaults: TenantQuotaDefaults): Promise<void> {
    await createUsageLimitCheckHandler({
      now: () => NOW,
      models: { resolve: async () => 'claude-sonnet-5' },
      aiDailyCostLimitUsd: '5.000000',
      usageLimits: { warnPercent: 80, ...defaults },
      enqueueEmailDispatch: async () => undefined,
    })({ tenantId: TENANT_1.tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:2`);
  }
});

// ---------------------------------------------------------------------------
// ⑤ send.hold-release が上限の引き上げ後に RATE_LIMIT の保留を解除する
// ---------------------------------------------------------------------------

describe('⑤ send.hold-release: RATE_LIMIT の保留は、上限の引き上げ（上書き）で同じ暦日のうちに解除され、同じ attemptSeq で再 enqueue される', () => {
  const proposalId = PARTNER_1_1.gateFailedProposalId;

  function holdRelease(now: Date) {
    const handler = createSendHoldReleaseHandler({
      emailSender: connectors.email,
      providerDailyQuota: 200,
      providerQuotaWarnRatio: 0.8,
      providerSentCounter: new InMemoryProviderSendCounter(),
      quotaDefaults: TEST_QUOTA_DEFAULTS,
      enqueueEmailDispatch: async () => {
        throw new Error('本テストは運用メールの保留を作らない');
      },
      reissueAccountMail: async () => {
        throw new Error('本テストは account.mail 由来の保留を作らない');
      },
      enqueueSendProposal: (job) => sendQueue.enqueue(job),
      now: () => now,
    });
    return () => handler({ tenantId: TENANT_1.tenantId }, 'job-hold-release-t1212');
  }

  it('🔴 既定 500 通に到達している間は保留のまま。EMAIL_COUNT を 1,000 通に上書きすると復帰し、send.proposal が waiting になる', async () => {
    // API を通らない経路の模擬: 送信ジョブが ①-e で立てた `RATE_LIMIT` の保留（`APPROVED` のまま保留列だけが立つ）。
    await admin.$executeRawUnsafe(
      `UPDATE proposals SET state = 'APPROVED', approved_at = $2, approved_by = $3::uuid, content_hash = 't1212-hash', send_hold_reason_key = 'RATE_LIMIT', send_hold_since = $2 WHERE id = $1::uuid`,
      proposalId,
      NOW,
      TENANT_1.hostUserId,
    );
    await upsertCounter(TENANT_1.tenantId, 'DAY', NOW, 'EMAIL_COUNT', '500');

    const run = holdRelease(NOW);
    expect((await run()).sendHoldsReleased).toBe(0);
    expect(await admin.proposal.findUniqueOrThrow({ where: { id: proposalId }, select: { sendHoldReasonKey: true } })).toEqual({
      sendHoldReasonKey: 'RATE_LIMIT',
    });

    await override('EMAIL_COUNT', 1000n, TODAY);
    expect((await run()).sendHoldsReleased).toBe(1);
    expect(await admin.proposal.findUniqueOrThrow({ where: { id: proposalId }, select: { state: true, sendHoldReasonKey: true, sendHoldSince: true } })).toEqual({
      state: 'APPROVED',
      sendHoldReasonKey: null,
      sendHoldSince: null,
    });
    // 🔴 実 Redis: 同じ attemptSeq（1 = INITIAL）で `send.proposal` に積まれている（消費するワーカーは本テストに無い）。
    expect(await sendQueue.jobState({ proposalId, attemptSeq: 1 })).toBe('waiting');
  });
});
