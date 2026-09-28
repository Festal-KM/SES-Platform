// tests/isolation/shell-header.test.ts
// 🔴 共通外枠（`app/(main)/layout.tsx`）のヘッダが読む 2 つの材料を**実 DB（RLS 付き）**で固定する
//    （T-12-20 の code-reviewer 指摘 #2）。docs/04 §3.2（第二境界の表現）/ §3.3（ヘッダの表）/ `F-027 AC-1` / `BR-04`。
//
//   ① `readShellIdentity`（ホスト）: 組織名が**自テナント**の名前で、`partnerCompanyName` は `null`
//   ② 🔴 `readShellIdentity`（取引先）: `partnerCompanyName` が**自社名だけ**である。
//      **同一テナントに取引先を 2 社置いた母集団**で、他社の社名がどの経路でも返らないことを見る ——
//      ヘッダは第二境界（`CLAUDE.md` §3.1）を**常時**表現している要素であり、ここが漏れると
//      「全画面で他社名が見えている」ことになる。本ファイルの主眼はこの 1 点である。
//   ③ 🔴 `readShellUsageIndicator`（取引先）: 返るのは `NONE` / `STOPPED` の 2 種類だけで、
//      **残量（`metric`）が付かない**（`F-027 AC-1`「取引先には停止の事実と理由だけ」）
//   ④ `readShellUsageIndicator`（ホスト）: 全単位が閾値未満なら `NONE`（平常時は何も出さない）、
//      AI の 1 日コスト上限で停止中なら `STOPPED`
//   ⑤ 🔴 外枠が 1 リクエストに足す**トランザクションの本数**（`app/(main)/layout.tsx` 冒頭の表）。
//      外枠は主平面の**全ページ**に乗るため、1 本の追加が全画面の p95（`CLAUDE.md` §7）に効く。
//
// 🔴 母集団は `seed:isolation`（2 テナント × 2 パートナー）を使う（docs/05 §17.5。固定 SQL を使わない）。
// 🔴 実 Anthropic API にも実 SES にも接続しない。描画（HTML）の検査は
//    `apps/web/app/(main)/_shell/app-shell.render.test.tsx` の担当であり、ここは**読み取りの結果**だけを見る。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, isolationSeedCompanyNames, runSeed } from '@ses/db/seed';
import { usagePeriodKey } from '../../packages/domain/src/usage/period-key.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const GB = 1024n * 1024n * 1024n;

const NOW = new Date();
const DAY = usagePeriodKey('DAY', NOW);

/** 🔴 起動時 DI（`packages/config`）の値。`usage-screen.test.ts` と同じ形で渡す（金額を含まない）。 */
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

/** AI の 1 日コスト上限（ワーカーだけが持つ内部指標。利用者には件数しか出さない）。 */
const AI_DAILY_COST_LIMIT_USD = '5.000000';

/**
 * 🔴 ⑤ の計測器: **1 トランザクションを開く `@ses/db` の関数**の呼び出し回数を数える。
 *
 * なぜ関数呼び出しを数えるのか: `packages/db` の該当関数はいずれも本体が
 * `runInTenantTransaction(...)` 1 回だけであり（`usage-limits.ts` / `quota-overrides.ts` /
 * `with-tenant.ts`）、**呼び出し 1 回 = トランザクション 1 本**である。PostgreSQL の
 * `pg_stat_database.xact_commit` は各バックエンドが遅延フラッシュするため、短時間の差分を
 * 正確に読めない（アイドル 10 秒でしか確定しない）。呼び出しを数えるほうが決定的である。
 */
// 🔴 `vi.hoisted` で宣言する。`vi.mock` の工場は**静的 import の評価時**に走るため、
//    普通の `const` に置くと初期化前（TDZ）に触れて落ちる。
const { TX_CALLS } = vi.hoisted(() => ({
  TX_CALLS: {
    /** `readShellIdentity` が使う（テナント + 利用者 + 自社を 1 トランザクションで読む）。 */
    withTenant: 0,
    /** ctx の解決（`buildTenantCtx`）。🔴 外枠の本数には含めない（`cache()` でページと共有する）。 */
    loadTenantMembership: 0,
    /** `readUsageView` の 3 本。 */
    readTenantUsageSnapshot: 0,
    readAiStopNotice: 0,
    resolveTenantQuotas: 0,
  } as Record<
    'withTenant' | 'loadTenantMembership' | 'readTenantUsageSnapshot' | 'readAiStopNotice' | 'resolveTenantQuotas',
    number
  >,
}));

function resetTxCalls(): void {
  for (const key of Object.keys(TX_CALLS) as (keyof typeof TX_CALLS)[]) TX_CALLS[key] = 0;
}

/** 外枠が足す本数（ctx の解決を除く。`app/(main)/layout.tsx` 冒頭の表と同じ定義）。 */
function shellTransactions(): number {
  return (
    TX_CALLS.withTenant +
    TX_CALLS.readTenantUsageSnapshot +
    TX_CALLS.readAiStopNotice +
    TX_CALLS.resolveTenantQuotas
  );
}

vi.mock('@ses/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ses/db')>();
  const counted = <A extends unknown[], R>(name: keyof typeof TX_CALLS, fn: (...args: A) => R) =>
    (...args: A): R => {
      TX_CALLS[name] += 1;
      return fn(...args);
    };
  return {
    ...actual,
    withTenant: counted('withTenant', actual.withTenant),
    loadTenantMembership: counted('loadTenantMembership', actual.loadTenantMembership),
    readTenantUsageSnapshot: counted('readTenantUsageSnapshot', actual.readTenantUsageSnapshot),
    readAiStopNotice: counted('readAiStopNotice', actual.readAiStopNotice),
    resolveTenantQuotas: counted('resolveTenantQuotas', actual.resolveTenantQuotas),
  };
});

vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  usageLimitsRuntime: () => ({
    warnPercent: LIMITS.warnPercent,
    aiUnitQuotas: LIMITS.aiUnitQuotas,
    emailDailyLimit: LIMITS.emailDailyLimit,
    storageLimitBytes: LIMITS.storageLimitBytes,
    emailMinuteLimit: LIMITS.emailMinuteLimit,
  }),
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { readShellIdentity } = await import('../../apps/web/lib/shell/identity');
const { readShellUsageIndicator } = await import('../../apps/web/lib/shell/usage-indicator');
const { createUsageLimitCheckHandler, USAGE_LIMIT_CHECK_JOB } = await import(
  '../../apps/worker/src/jobs/usage-limit-check.js'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

/** 🔴 母集団の社名（シードが使う唯一の出所。テスト側で別の文字列を作らない）。 */
const NAMES_1 = isolationSeedCompanyNames(1);
const NAMES_2 = isolationSeedCompanyNames(2);

const HOST_USER: TenantIdentity = {
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

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function upsertCounter(metric: string, value: string, reservedValue = '0'): Promise<void> {
  await admin.$executeRawUnsafe(
    `INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
     VALUES (gen_random_uuid(), $1::uuid, 'DAY', $2, $3, $4::numeric, $5::numeric, now())
     ON CONFLICT (tenant_id, period_kind, period_key, metric)
     DO UPDATE SET value = EXCLUDED.value, reserved_value = EXCLUDED.reserved_value`,
    TENANT_1.tenantId,
    DAY,
    metric,
    value,
    reservedValue,
  );
}

/** AI の 1 日コスト上限に到達させ、`usage_limit_states` に停止を確定させる（`S-038` と同じ経路）。 */
async function arrangeAiDailyStop(): Promise<void> {
  await upsertCounter('AI_COST_USD', AI_DAILY_COST_LIMIT_USD);
  const handler = createUsageLimitCheckHandler({
    now: () => NOW,
    models: { resolve: async () => 'claude-sonnet-5' },
    aiDailyCostLimitUsd: AI_DAILY_COST_LIMIT_USD,
    usageLimits: LIMITS,
    enqueueEmailDispatch: async () => {},
  });
  await handler({ tenantId: TENANT_1.tenantId }, `repeat:${USAGE_LIMIT_CHECK_JOB}:shell-header`);
}

async function resetTenant(): Promise<void> {
  await admin.$executeRawUnsafe(`DELETE FROM usage_limit_states WHERE tenant_id = $1::uuid`, TENANT_1.tenantId);
  await admin.$executeRawUnsafe(`DELETE FROM usage_counters WHERE tenant_id = $1::uuid`, TENANT_1.tenantId);
  await admin.$executeRawUnsafe(
    `DELETE FROM email_dispatches WHERE tenant_id = $1::uuid AND template_key LIKE 'USAGE_LIMIT_%'`,
    TENANT_1.tenantId,
  );
  await admin.$executeRawUnsafe(
    `DELETE FROM audit_logs WHERE tenant_id = $1::uuid AND action LIKE 'usage.limit_%'`,
    TENANT_1.tenantId,
  );
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
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await resetTenant();
  resetTxCalls();
});

describe('① readShellIdentity（ホスト所属）', () => {
  it('組織名は自テナントの名前で、自社名の行を持たない（1 段のスコープ表示）', async () => {
    const ctx = await ctxOf(HOST_USER, 'SALES');
    const identity = await readShellIdentity(ctx);

    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_1.tenantId } });
    const user = await admin.user.findUniqueOrThrow({ where: { id: TENANT_1.hostUserId } });
    expect(identity).toEqual({
      organizationName: tenant.name,
      partnerCompanyName: null,
      userName: user.displayName,
    });
    expect(identity.organizationName).toBe(NAMES_1.host);
  });

  it('🔴 他テナントの組織名を返さない（第一境界）', async () => {
    const identity = await readShellIdentity(await ctxOf(HOST_USER, 'SALES'));
    const otherTenant = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_2.tenantId } });
    expect(identity.organizationName).not.toBe(otherTenant.name);
    expect(identity.organizationName).not.toBe(NAMES_2.host);
  });
});

describe('🔴 ② readShellIdentity（取引先所属）—— 自社名だけが返る（第二境界の常時表現）', () => {
  it('対照: 同一テナントに取引先が 2 社実在し、社名が相異なる（走査が空振りしていない）', async () => {
    const companies = await admin.partnerCompany.findMany({
      where: { tenantId: TENANT_1.tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(companies).toHaveLength(2);
    expect(new Set(companies.map((company) => company.name)).size).toBe(2);
    expect([...NAMES_1.partners].sort()).toEqual(companies.map((company) => company.name).sort());
  });

  it('🔴 1 社目の利用者には 1 社目の社名だけが返り、2 社目の社名はどのフィールドにも現れない', async () => {
    const identity = await readShellIdentity(await ctxOf(PARTNER_1_USER, 'PARTNER_SALES'));

    expect(identity.partnerCompanyName).toBe(NAMES_1.partners[0]);
    expect(identity.organizationName).toBe(NAMES_1.host);
    // 🔴 他社名が「別のフィールドに紛れている」ことも許さない（値の全走査）。
    const values = Object.values(identity);
    expect(values).not.toContain(NAMES_1.partners[1]);
    expect(JSON.stringify(identity)).not.toContain(NAMES_1.partners[1]);
  });

  it('🔴 2 社目の利用者には 2 社目の社名だけが返る（対称。どちらから見ても他社が消える）', async () => {
    const identity = await readShellIdentity(await ctxOf(PARTNER_2_USER, 'PARTNER_SALES'));

    expect(identity.partnerCompanyName).toBe(NAMES_1.partners[1]);
    expect(JSON.stringify(identity)).not.toContain(NAMES_1.partners[0]);
  });

  it('自分の表示名は自分の行から来る（他社の利用者名が混じらない）', async () => {
    const identity = await readShellIdentity(await ctxOf(PARTNER_1_USER, 'PARTNER_SALES'));
    const me = await admin.user.findUniqueOrThrow({ where: { id: PARTNER_1_1.userId } });
    const other = await admin.user.findUniqueOrThrow({ where: { id: PARTNER_1_2.userId } });
    expect(identity.userName).toBe(me.displayName);
    if (me.displayName !== other.displayName) expect(identity.userName).not.toBe(other.displayName);
  });
});

describe('🔴 ③ readShellUsageIndicator（取引先所属）—— 停止の事実と理由だけ（F-027 AC-1）', () => {
  it('平常時は NONE（残量のキーを持たない）', async () => {
    const indicator = await readShellUsageIndicator(await ctxOf(PARTNER_1_USER, 'PARTNER_SALES'), NOW);
    expect(indicator).toEqual({ kind: 'NONE' });
  });

  it('🔴 AI が停止中でも STOPPED だけで、残量（metric）が付かない', async () => {
    await arrangeAiDailyStop();
    const indicator = await readShellUsageIndicator(await ctxOf(PARTNER_1_USER, 'PARTNER_SALES'), NOW);
    expect(indicator).toEqual({ kind: 'STOPPED' });
    expect(Object.keys(indicator)).toEqual(['kind']);
    expect('metric' in indicator).toBe(false);
  });

  it('🔴 上限に接近する使用量があっても、取引先には NEARING が出ない（残量を持たせない）', async () => {
    // ホスト側では NEARING になる量（提案ドラフト 83% / メール 96%）を入れる。
    await admin.$executeRawUnsafe(
      `INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
       VALUES (gen_random_uuid(), $1::uuid, 'MONTH', $2, 'AI_UNIT_PROPOSAL_DRAFT', 150, 0, now())`,
      TENANT_1.tenantId,
      usagePeriodKey('MONTH', NOW),
    );
    await upsertCounter('EMAIL_COUNT', '480');

    const indicator = await readShellUsageIndicator(await ctxOf(PARTNER_1_USER, 'PARTNER_SALES'), NOW);
    expect(indicator.kind).not.toBe('NEARING');
    expect(indicator).toEqual({ kind: 'NONE' });
  });
});

describe('④ readShellUsageIndicator（ホスト所属）', () => {
  it('全単位が閾値未満なら NONE（平常時の常時警告を作らない）', async () => {
    const indicator = await readShellUsageIndicator(await ctxOf(HOST_USER, 'SALES'), NOW);
    expect(indicator).toEqual({ kind: 'NONE' });
  });

  it('🔴 AI の 1 日コスト上限で停止中なら STOPPED（残量ではなく停止を出す）', async () => {
    await arrangeAiDailyStop();
    const indicator = await readShellUsageIndicator(await ctxOf(HOST_USER, 'SALES'), NOW);
    expect(indicator).toEqual({ kind: 'STOPPED' });
  });
});

describe('🔴 ⑤ 外枠が 1 リクエストに足すトランザクションの本数（app/(main)/layout.tsx 冒頭の表）', () => {
  /**
   * 🔴 この数が増えたら、**主平面の全ページ**が同じだけ遅くなる（`CLAUDE.md` §7 の p95）。
   *    外枠に読み取りを足すときは、この期待値と `app/(main)/layout.tsx` の表を必ず一緒に直すこと。
   */
  it('ホスト所属: 4 本（identity 1 + usage 3）', async () => {
    const ctx = await ctxOf(HOST_USER, 'SALES');
    resetTxCalls();

    await Promise.all([readShellIdentity(ctx), readShellUsageIndicator(ctx, NOW)]);

    expect(shellTransactions()).toBe(4);
    expect(TX_CALLS.withTenant).toBe(1);
    expect(TX_CALLS.readTenantUsageSnapshot).toBe(1);
    expect(TX_CALLS.readAiStopNotice).toBe(1);
    expect(TX_CALLS.resolveTenantQuotas).toBe(1);
    // 🔴 ctx の解決は外枠の本数に含めない（`cache()` でページと共有される）。
    expect(TX_CALLS.loadTenantMembership).toBe(0);
  });

  it('取引先所属: 2 本（identity 1 + 停止の事実 1）', async () => {
    const ctx = await ctxOf(PARTNER_1_USER, 'PARTNER_SALES');
    resetTxCalls();

    await Promise.all([readShellIdentity(ctx), readShellUsageIndicator(ctx, NOW)]);

    expect(shellTransactions()).toBe(2);
    expect(TX_CALLS.withTenant).toBe(1);
    expect(TX_CALLS.readAiStopNotice).toBe(1);
    // 🔴 取引先は残量も上限も読まない（読む経路が存在しない）。
    expect(TX_CALLS.readTenantUsageSnapshot).toBe(0);
    expect(TX_CALLS.resolveTenantQuotas).toBe(0);
  });

  it('対照: ctx の解決は 1 回で 1 本である（外枠とページで 2 本にならないことの根拠）', async () => {
    resetTxCalls();
    await buildTenantCtx({ ...HOST_USER, twoFactorVerified: true }, { deviceKind: 'api' });
    expect(TX_CALLS.loadTenantMembership).toBe(1);
  });
});
