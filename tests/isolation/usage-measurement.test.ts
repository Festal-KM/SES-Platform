// tests/isolation/usage-measurement.test.ts
// 🔴 T-10-02 の完了判定 = `F-026 AC-3`〜`AC-5` の結合テスト（docs/05 §9.8 / §5.9 / §16.5。実 DB）。
//
//   ① AC-3 `usage.daily-rollup`: `AI_COST_USD`（DAY）が `AiUsage` の合計に揃う（冪等 / `reserved_value` は残す）。
//      🔴 **`AI_UNIT_*`（件数）は数え直されない**（`AiUsage` に行があっても件数カウンタは動かない）
//   ② AC-4 `usage.gap-check`: **欠測を作ると `usage_measurement_findings` に現れ、管理平面の読み取り
//      （`A-005` の材料）から見える**。欠測を埋めて再検査すると `resolved_at` が立つ（行は消えない）
//   ③ `usage.storage-reconcile`: 乖離が検知結果に出るだけで、**カウンタは 1 バイトも変わらない**
//   ④ AC-5 `cost.monthly-rollup`: テナント × 月 × **ロール別**に分解して保持される。**月末を過ぎた月は確定し、
//      以後書き換わらない**（アプリの `WHERE` と DB のトリガの二重。`meter_diff_jpy` だけは書ける。DELETE は権限で拒否）
//   ⑤ テナント境界: 他テナントの計測・検知結果に 1 行も混ざらない
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkUsageGaps,
  configurePlatformReadDb,
  configureTenantDb,
  disconnectTenantDb,
  listMonthsToRollup,
  recordAiUsage,
  reconcileTenantStorage,
  resolvePlatformCtx,
  rollupAiCostDay,
  rollupEmailMonth,
  rollupTenantMonthlyCost,
  snapshotSeatCount,
  systemTenantCtx,
  type AuthenticatedPlatformCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { listOpenUsageMeasurementFindings } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。他の isolation テストと同じ）。
import { AI_ROLES } from '../../packages/domain/src/ai/roles.js';
import { PRICING_RULESET_V1 } from '../../packages/domain/src/usage/pricing-ruleset.js';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-16 01:10。 */
const NOW = new Date('2026-09-15T16:10:00.000Z');
const YESTERDAY = '2026-09-15';
const PLATFORM_USER_ID = '01930000-0000-7000-8000-0000000000aa';
const SONNET = 'claude-sonnet-5';

/** JST の暦日の 12:00（その日の中の任意の時刻）。 */
function jstNoon(dayKey: string): Date {
  return new Date(`${dayKey}T03:00:00.000Z`);
}

let database: IsolationDatabase;
/** 🔴 前提づくりと「保存されている生の値」の確認だけに使う特権接続。 */
let admin: UnextendedClient;
/** 🔴 素の `app_tenant` 接続（権限の実挙動を見る）。 */
let rawTenant: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;
let platformCtx: AuthenticatedPlatformCtx;

async function insertAiUsage(ctx: SystemTenantCtx, role: (typeof AI_ROLES)[number], startedAt: Date): Promise<string> {
  return recordAiUsage(ctx, {
    role,
    purpose:
      role === 'gate-inspector'
        ? 'gate'
        : role === 'sheet-parser'
          ? 'sheet_parse'
          : role === 'match-explainer'
            ? 'match_rationale'
            : role === 'proposal-drafter'
              ? 'proposal_draft'
              : role === 'renewal-advisor'
                ? 'renewal_summary'
                : 'skill_normalize',
    modelId: SONNET,
    promptVersion: `${role}.v1`,
    // 5,000 in / 1,000 out × Sonnet 5（$2 / $10 per MTok）= $0.020000
    tokens: { inputTokens: 5_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    attemptNo: 1,
    succeeded: true,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 3_000),
  });
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

async function readCounter(tenantId: string, periodKind: string, periodKey: string, metric: string) {
  const row = await admin.usageCounter.findFirst({
    where: { tenantId, periodKind, periodKey, metric },
    select: { value: true, reservedValue: true },
  });
  return row === null ? null : { value: row.value.toString(), reservedValue: row.reservedValue.toString() };
}

async function readFindings(tenantId: string) {
  const rows = await admin.usageMeasurementFinding.findMany({
    where: { tenantId },
    orderBy: [{ kind: 'asc' }, { metric: 'asc' }, { periodKey: 'asc' }],
  });
  return rows.map((row) => ({
    kind: row.kind,
    metric: row.metric,
    periodKind: row.periodKind,
    periodKey: row.periodKey,
    expected: row.expected?.toString() ?? null,
    observed: row.observed?.toString() ?? null,
    resolved: row.resolvedAt !== null,
  }));
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  rawTenant = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  ctxA = systemTenantCtx(TENANT_A, { queue: 'usage.daily-rollup', jobId: 'repeat:usage.daily-rollup:1' });
  ctxB = systemTenantCtx(TENANT_B, { queue: 'usage.daily-rollup', jobId: 'repeat:usage.daily-rollup:1' });
  platformCtx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  // 🔴 固定フィクスチャのテナントは `created_at = now()`（実時刻）。検査の窓は作成日で下限が決まるため、
  //    「実行日 = T」より前に作られたことにする。
  await admin.$executeRawUnsafe(`UPDATE tenants SET created_at = '2026-01-01T00:00:00Z' WHERE id IN ($1::uuid, $2::uuid)`, TENANT_A, TENANT_B);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await rawTenant?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① AC-3 usage.daily-rollup: AI_COST_USD（DAY）を AiUsage の合計に揃える', () => {
  it('🔴 乖離を確定値で上書きし、reserved_value は残す。AI_UNIT_* は数え直されない', async () => {
    // 昨日の AiUsage 2 行（$0.02 × 2 = $0.04）。金額カウンタは予約の残骸を含む「ずれた」値にしておく。
    await insertAiUsage(ctxA, 'gate-inspector', jstNoon(YESTERDAY));
    await insertAiUsage(ctxA, 'sheet-parser', new Date(`${YESTERDAY}T14:59:59.000Z`)); // 23:59:59 JST
    await upsertCounter(TENANT_A, 'DAY', YESTERDAY, 'AI_COST_USD', '0.030000', '0.500000');
    // 🔴 件数カウンタは `AiUsage` の行数（2）と関係なく 1 のまま（`countAiUnit` の 1 回分）。
    await upsertCounter(TENANT_A, 'MONTH', '2026-09', 'AI_UNIT_SHEET_PARSE', '1');
    // 他テナントの同じ日のカウンタ（境界の対照）。
    await upsertCounter(TENANT_B, 'DAY', YESTERDAY, 'AI_COST_USD', '9.000000');

    const first = await rollupAiCostDay(ctxA, { periodKey: YESTERDAY, now: NOW });
    expect(first).toEqual({
      periodKey: YESTERDAY,
      expectedUsd: '0.040000',
      previousUsd: '0.030000',
      valueUsd: '0.040000',
      corrected: true,
    });
    expect(await readCounter(TENANT_A, 'DAY', YESTERDAY, 'AI_COST_USD')).toEqual({ value: '0.04', reservedValue: '0.5' });

    // 冪等: 2 度目は乖離なし。
    const second = await rollupAiCostDay(ctxA, { periodKey: YESTERDAY, now: NOW });
    expect(second.corrected).toBe(false);
    expect(second.valueUsd).toBe('0.040000');

    // 🔴 AI_UNIT_* は動かない（`F-026 AC-6` / docs/05 §9.8）。
    expect(await readCounter(TENANT_A, 'MONTH', '2026-09', 'AI_UNIT_SHEET_PARSE')).toEqual({ value: '1', reservedValue: '0' });
    // ⑤ 境界: 他テナントの行は変わらない。
    expect(await readCounter(TENANT_B, 'DAY', YESTERDAY, 'AI_COST_USD')).toEqual({ value: '9', reservedValue: '0' });
  });

  it('AiUsage もカウンタも無い日は行を作らない（使わなかった日を 0 で埋めない）', async () => {
    const outcome = await rollupAiCostDay(ctxA, { periodKey: '2026-09-10', now: NOW });
    expect(outcome).toMatchObject({ corrected: false, previousUsd: null, valueUsd: '0.000000' });
    expect(await readCounter(TENANT_A, 'DAY', '2026-09-10', 'AI_COST_USD')).toBeNull();
  });

  it('EMAIL_COUNT の MONTH 行は DAY 行の合計（数え直しではなく畳み込み）', async () => {
    await upsertCounter(TENANT_A, 'DAY', '2026-09-14', 'EMAIL_COUNT', '3');
    await upsertCounter(TENANT_A, 'DAY', YESTERDAY, 'EMAIL_COUNT', '4');
    await upsertCounter(TENANT_B, 'DAY', YESTERDAY, 'EMAIL_COUNT', '100');
    expect(await rollupEmailMonth(ctxA, { periodKey: '2026-09', now: NOW })).toEqual({ periodKey: '2026-09', total: 7, written: true });
    expect(await readCounter(TENANT_A, 'MONTH', '2026-09', 'EMAIL_COUNT')).toEqual({ value: '7', reservedValue: '0' });
    expect(await readCounter(TENANT_B, 'MONTH', '2026-09', 'EMAIL_COUNT')).toBeNull();
    // DAY 行が無い月は書かない。
    expect(await rollupEmailMonth(ctxA, { periodKey: '2026-07', now: NOW })).toEqual({ periodKey: '2026-07', total: 0, written: false });
  });
});

describe('② AC-4 usage.gap-check: 欠測を作ると A-005 の材料に現れ、埋めると解消する', () => {
  it('🔴 SEAT_COUNT の抜けた日と、AiUsage があるのにカウンタが無い日が GAP_MISSING になる', async () => {
    // 窓 = [09-13, 09-15]。09-14 の席数スナップショットだけ欠かす。
    for (const day of ['2026-09-13', '2026-09-15']) {
      await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: jstNoon(day) });
    }
    // 09-13 に AiUsage があるがカウンタが無い（rollup が走らなかった状況）。
    await insertAiUsage(ctxA, 'match-explainer', jstNoon('2026-09-13'));

    const outcome = await checkUsageGaps(ctxA, { now: NOW, lookbackDays: 3 });
    expect(outcome.checkedDays).toEqual(['2026-09-13', '2026-09-14', '2026-09-15']);
    expect(outcome.findings).toEqual([
      { kind: 'GAP_MISSING', metric: 'AI_COST_USD', periodKey: '2026-09-13', expected: '0.020000', observed: null },
      { kind: 'GAP_MISSING', metric: 'SEAT_COUNT', periodKey: '2026-09-14', expected: null, observed: null },
    ]);
    expect(outcome).toMatchObject({ detected: 2, opened: 2, resolved: 0 });

    // 🔴 A-005 の材料（管理平面の読み取り）に現れる。
    const open = await listOpenUsageMeasurementFindings(platformCtx);
    expect(open.countsByKind).toEqual({ GAP_MISSING: 2, GAP_MISMATCH: 0, STORAGE_DIVERGENCE: 0 });
    expect(open.items.map((item) => [item.tenantId, item.kind, item.metric, item.periodKey])).toEqual(
      expect.arrayContaining([
        [TENANT_A, 'GAP_MISSING', 'AI_COST_USD', '2026-09-13'],
        [TENANT_A, 'GAP_MISSING', 'SEAT_COUNT', '2026-09-14'],
      ]),
    );
    // ⑤ 境界: テナント B には検知結果が無い（B は席数スナップショットを一度も取っていないが、検査もしていない）。
    expect(await readFindings(TENANT_B)).toEqual([]);
  });

  it('🔴 値の食い違いは GAP_MISMATCH（行はあるが AiUsage の合計と違う）', async () => {
    await upsertCounter(TENANT_A, 'DAY', '2026-09-13', 'AI_COST_USD', '0.010000');
    const outcome = await checkUsageGaps(ctxA, { now: new Date(NOW.getTime() + 1_000), lookbackDays: 3 });
    expect(outcome.findings).toContainEqual({
      kind: 'GAP_MISMATCH',
      metric: 'AI_COST_USD',
      periodKey: '2026-09-13',
      expected: '0.020000',
      observed: '0.010000',
    });
    // 🔴 前回の GAP_MISSING（AI_COST_USD 09-13）は「行ができた」ので解消し、行は残る。
    const findings = await readFindings(TENANT_A);
    expect(findings).toContainEqual({
      kind: 'GAP_MISSING',
      metric: 'AI_COST_USD',
      periodKind: 'DAY',
      periodKey: '2026-09-13',
      expected: '0.02',
      observed: null,
      resolved: true,
    });
  });

  it('🔴 欠測を埋めて再検査すると resolved_at が立ち、再発すると再開する（消さない）', async () => {
    // 09-13 の乖離を daily-rollup で直し、09-14 の席数を取る。
    await rollupAiCostDay(ctxA, { periodKey: '2026-09-13', now: NOW });
    await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: jstNoon('2026-09-14') });

    const outcome = await checkUsageGaps(ctxA, { now: new Date(NOW.getTime() + 2_000), lookbackDays: 3 });
    expect(outcome.findings).toEqual([]);
    expect(outcome.resolved).toBe(2); // GAP_MISMATCH(09-13) と GAP_MISSING(SEAT_COUNT 09-14)
    expect((await readFindings(TENANT_A)).every((finding) => finding.resolved)).toBe(true);
    expect((await listOpenUsageMeasurementFindings(platformCtx)).countsByKind).toEqual({
      GAP_MISSING: 0,
      GAP_MISMATCH: 0,
      STORAGE_DIVERGENCE: 0,
    });

    // 再発: 09-14 の席数行を消すと同じ行が再開する（行数は増えない）。
    await admin.usageCounter.deleteMany({ where: { tenantId: TENANT_A, periodKind: 'DAY', periodKey: '2026-09-14', metric: 'SEAT_COUNT' } });
    const before = (await readFindings(TENANT_A)).length;
    const reopened = await checkUsageGaps(ctxA, { now: new Date(NOW.getTime() + 3_000), lookbackDays: 3 });
    expect(reopened).toMatchObject({ detected: 1, opened: 1, resolved: 0 });
    expect((await readFindings(TENANT_A)).length).toBe(before);
    expect(await readFindings(TENANT_A)).toContainEqual({
      kind: 'GAP_MISSING',
      metric: 'SEAT_COUNT',
      periodKind: 'DAY',
      periodKey: '2026-09-14',
      expected: null,
      observed: null,
      resolved: false,
    });
  });

  it('🔴 テナント作成日の SEAT_COUNT は期待しない（01:00 JST 以降に開設されたテナントが永久に欠測にならない。レビュー指摘）', async () => {
    // B を 2026-09-14 15:00 JST（= 06:00Z）に開設したことにする。その日の usage.seat-snapshot（01:00 JST）は
    // 開設前に走っているので、作成日 09-14 の SEAT_COUNT 行は原理的に存在しない。
    await admin.$executeRawUnsafe(`UPDATE tenants SET created_at = '2026-09-14T06:00:00Z' WHERE id = $1::uuid`, TENANT_B);
    try {
      // 翌日 01:00 JST（= 09-14 16:00Z）のスナップショットだけがある。
      await snapshotSeatCount(ctxB, { countPartnerSeats: true, observedAt: new Date('2026-09-14T16:00:00.000Z') });
      // 09-15 01:20 JST（= 09-15 16:20Z）の検査。窓は [作成日 + 1 = 09-15, 昨日 = 09-15]。
      const outcome = await checkUsageGaps(ctxB, { now: new Date('2026-09-15T16:20:00.000Z'), lookbackDays: 7 });
      expect(outcome.checkedDays).toEqual(['2026-09-15']);
      expect(outcome.findings).toEqual([]);
      expect(await readFindings(TENANT_B)).toEqual([]);
      // 🔴 A-005 の材料に B の欠測が 1 件も無い（A の再発 1 件はそのまま）。
      const open = await listOpenUsageMeasurementFindings(platformCtx);
      expect(open.items.filter((item) => item.tenantId === TENANT_B)).toEqual([]);
    } finally {
      await admin.$executeRawUnsafe(`UPDATE tenants SET created_at = '2026-01-01T00:00:00Z' WHERE id = $1::uuid`, TENANT_B);
      await admin.usageCounter.deleteMany({ where: { tenantId: TENANT_B, periodKind: 'DAY', periodKey: '2026-09-15', metric: 'SEAT_COUNT' } });
    }
  });
});

describe('③ usage.storage-reconcile: 乖離は検知結果に出るだけで、カウンタは変わらない', () => {
  it('🔴 実測がカウンタと違えば STORAGE_DIVERGENCE。一致すれば解消。カウンタは 1 バイトも動かない', async () => {
    await upsertCounter(TENANT_A, 'MONTH', '2026-09', 'STORAGE_BYTES', '1000');

    const divergent = await reconcileTenantStorage(ctxA, { measuredBytes: 1200n, now: NOW });
    expect(divergent).toMatchObject({
      periodKey: '2026-09',
      counterBytes: 1000n,
      measuredBytes: 1200n,
      decision: { kind: 'DIVERGENCE', deltaBytes: 200n },
      detected: 1,
      opened: 1,
    });
    expect(await readCounter(TENANT_A, 'MONTH', '2026-09', 'STORAGE_BYTES')).toEqual({ value: '1000', reservedValue: '0' });
    expect(await readFindings(TENANT_A)).toContainEqual({
      kind: 'STORAGE_DIVERGENCE',
      metric: 'STORAGE_BYTES',
      periodKind: 'MONTH',
      periodKey: '2026-09',
      expected: '1200',
      observed: '1000',
      resolved: false,
    });
    expect((await listOpenUsageMeasurementFindings(platformCtx)).countsByKind.STORAGE_DIVERGENCE).toBe(1);

    const matched = await reconcileTenantStorage(ctxA, { measuredBytes: 1000n, now: new Date(NOW.getTime() + 1_000) });
    expect(matched).toMatchObject({ decision: { kind: 'MATCH' }, detected: 0, resolved: 1 });
    expect(await readCounter(TENANT_A, 'MONTH', '2026-09', 'STORAGE_BYTES')).toEqual({ value: '1000', reservedValue: '0' });
  });

  it('🔴 T-12-17 ⑩: 月末日に開いた行は翌月 1 日の一致で閉じる（前月キーが解消スコープに入る。カウンタは動かない）', async () => {
    // 月末日（2026-09-30 01:30 JST = 09-29 16:30 UTC）に乖離 → `2026-09` の行が開く。
    const endOfMonth = new Date('2026-09-29T16:30:00.000Z');
    await upsertCounter(TENANT_B, 'MONTH', '2026-09', 'STORAGE_BYTES', '5000');
    const divergent = await reconcileTenantStorage(ctxB, { measuredBytes: 5300n, now: endOfMonth });
    expect(divergent).toMatchObject({ periodKey: '2026-09', decision: { kind: 'DIVERGENCE', deltaBytes: 300n }, opened: 1 });
    expect(await readFindings(TENANT_B)).toContainEqual(
      expect.objectContaining({ kind: 'STORAGE_DIVERGENCE', periodKey: '2026-09', resolved: false }),
    );

    // 翌月 1 日（2026-10-01 01:30 JST）に一致 → 当月キーは `2026-10` だが、前月 `2026-09` の行が閉じる。
    const firstOfNextMonth = new Date('2026-09-30T16:30:00.000Z');
    await upsertCounter(TENANT_B, 'MONTH', '2026-10', 'STORAGE_BYTES', '5300');
    const matched = await reconcileTenantStorage(ctxB, { measuredBytes: 5300n, now: firstOfNextMonth });
    expect(matched).toMatchObject({ periodKey: '2026-10', decision: { kind: 'MATCH' }, detected: 0, resolved: 1 });
    expect(await readFindings(TENANT_B)).toContainEqual(
      expect.objectContaining({ kind: 'STORAGE_DIVERGENCE', periodKey: '2026-09', resolved: true }),
    );
    expect(await readFindings(TENANT_B)).not.toContainEqual(
      expect.objectContaining({ kind: 'STORAGE_DIVERGENCE', periodKey: '2026-10' }),
    );
    // 🔴 `usage_counters` は 1 バイトも動かない（前月・当月とも）。
    expect(await readCounter(TENANT_B, 'MONTH', '2026-09', 'STORAGE_BYTES')).toEqual({ value: '5000', reservedValue: '0' });
    expect(await readCounter(TENANT_B, 'MONTH', '2026-10', 'STORAGE_BYTES')).toEqual({ value: '5300', reservedValue: '0' });
  });
});

describe('④ AC-5 cost.monthly-rollup: テナント × 月 × ロール別に保持し、月末を過ぎた月は書き換わらない', () => {
  const AUGUST = '2026-08';
  const TERMS = {
    monthlySeatPriceJpy: '3000.00',
    overageUnitPricesJpy: {
      AI_UNIT_SHEET_PARSE: '50',
      AI_UNIT_MATCH_RATIONALE: '6',
      AI_UNIT_PROPOSAL_DRAFT: '32',
      AI_UNIT_RENEWAL_SUMMARY: '26',
    },
    unitQuotas: { AI_UNIT_SHEET_PARSE: 70, AI_UNIT_MATCH_RATIONALE: 2300, AI_UNIT_PROPOSAL_DRAFT: 70, AI_UNIT_RENEWAL_SUMMARY: 10 },
    aiCostCapUsd: '40.00',
  } as const;

  async function readMonthlyCost(tenantId: string, periodMonth: string) {
    return admin.tenantMonthlyCost.findUnique({ where: { tenantId_periodMonth: { tenantId, periodMonth } } });
  }

  it('🔴 先月（月末を過ぎた月）は FINALIZED になり、原価がロール別に分解される', async () => {
    // 8 月の AiUsage: sheet-parser × 2、gate-inspector × 1（各 $0.02）。
    await insertAiUsage(ctxA, 'sheet-parser', jstNoon('2026-08-03'));
    await insertAiUsage(ctxA, 'sheet-parser', jstNoon('2026-08-20'));
    await insertAiUsage(ctxA, 'gate-inspector', new Date('2026-08-31T14:00:00.000Z')); // 8/31 23:00 JST
    await insertAiUsage(ctxB, 'renewal-advisor', jstNoon('2026-08-10')); // 境界の対照
    // 件数（利用者向け）は独立のカウンタ。sheetParse 80 件 → クォータ 70 を 10 件超過。
    await upsertCounter(TENANT_A, 'MONTH', AUGUST, 'AI_UNIT_SHEET_PARSE', '80');
    // メール: DAY 行 → MONTH 行（daily-rollup が畳む）。
    await upsertCounter(TENANT_A, 'DAY', '2026-08-05', 'EMAIL_COUNT', '400');
    await upsertCounter(TENANT_A, 'DAY', '2026-08-31', 'EMAIL_COUNT', '10');
    await rollupEmailMonth(ctxA, { periodKey: AUGUST, now: NOW });
    // 席数: 8 月の日次スナップショットの最大値。
    await upsertCounter(TENANT_A, 'DAY', '2026-08-01', 'SEAT_COUNT', '28');
    await upsertCounter(TENANT_A, 'DAY', '2026-08-15', 'SEAT_COUNT', '30');
    // ストレージ: 8 月末の値（月キーの累積ゲージ）。
    await upsertCounter(TENANT_A, 'MONTH', AUGUST, 'STORAGE_BYTES', '1610612736'); // 1.5 GiB

    const outcome = await rollupTenantMonthlyCost(ctxA, {
      periodMonth: AUGUST,
      now: NOW,
      billingTerms: TERMS,
      emailTenantsBilling: 'APPLIES',
      ruleset: PRICING_RULESET_V1,
    });
    expect(outcome.kind).toBe('FINALIZED');
    if (outcome.kind !== 'FINALIZED') return;
    expect(outcome.storageBytesAtMonthEnd).toBe(1610612736n);
    expect(outcome.breakdown.costAiByRoleUsd).toEqual({
      'sheet-parser': '0.040000',
      'skill-normalizer': '0.000000',
      'match-explainer': '0.000000',
      'gate-inspector': '0.020000',
      'proposal-drafter': '0.000000',
      'renewal-advisor': '0.000000',
    });
    expect(outcome.breakdown.costAiUsd).toBe('0.060000');
    expect(outcome.breakdown.revenueSeatJpy).toBe('90000.00');
    expect(outcome.breakdown.revenueOverageJpy).toBe('500.00');
    // 410 通 × APPLIES = $0.072650（docs/05 §5.9 の式）
    expect(outcome.breakdown.costEmailUsd).toBe('0.072650');
    expect(outcome.breakdown.costStorageUsd).toBe('0.037500');

    const row = await readMonthlyCost(TENANT_A, AUGUST);
    expect(row?.finalizedAt).not.toBeNull();
    expect(row?.pricingRulesetVersion).toBe('v1');
    expect(row?.storageBytesAtMonthEnd).toBe(1610612736n);
    expect(Object.keys(row?.costAiByRole as Record<string, string>).sort()).toEqual([...AI_ROLES].sort());
    expect(row?.costAiUsd.toString()).toBe('0.06');
    expect(row?.grossMarginRate?.toString()).toBe('0.9997');
    // ⑤ 境界: テナント B の 8 月は集計していない。
    expect(await readMonthlyCost(TENANT_B, AUGUST)).toBeNull();
  });

  it('🔴 確定後の再実行は ALREADY_FINALIZED で何も書かない（材料が変わっても行は動かない）', async () => {
    await insertAiUsage(ctxA, 'proposal-drafter', jstNoon('2026-08-25')); // 遅れて届いた行
    const before = await readMonthlyCost(TENANT_A, AUGUST);
    const again = await rollupTenantMonthlyCost(ctxA, {
      periodMonth: AUGUST,
      now: new Date(NOW.getTime() + 60_000),
      billingTerms: null,
      emailTenantsBilling: 'NOT_APPLICABLE',
      ruleset: PRICING_RULESET_V1,
    });
    expect(again).toEqual({ kind: 'ALREADY_FINALIZED' });
    expect(await readMonthlyCost(TENANT_A, AUGUST)).toEqual(before);
  });

  it('🔴 DB 側でも確定行は書き換えられない（トリガ）。meter_diff_jpy だけは書ける。app_tenant は DELETE できない', async () => {
    await expect(
      admin.$executeRawUnsafe(`UPDATE tenant_monthly_costs SET cost_ai_usd = 999 WHERE tenant_id = $1::uuid AND period_month = $2`, TENANT_A, AUGUST),
    ).rejects.toThrow(/確定済み/);
    await expect(
      admin.$executeRawUnsafe(`UPDATE tenant_monthly_costs SET finalized_at = NULL WHERE tenant_id = $1::uuid AND period_month = $2`, TENANT_A, AUGUST),
    ).rejects.toThrow(/確定済み/);
    expect(
      await admin.$executeRawUnsafe(`UPDATE tenant_monthly_costs SET meter_diff_jpy = 12.5, updated_at = now() WHERE tenant_id = $1::uuid AND period_month = $2`, TENANT_A, AUGUST),
    ).toBe(1);
    expect((await readMonthlyCost(TENANT_A, AUGUST))?.meterDiffJpy?.toString()).toBe('12.5');
    // 🔴 DELETE → 再 INSERT の書き換え経路を権限で塞ぐ（migration 20260919000000 判断事項 4）。
    await expect(rawTenant.$executeRawUnsafe(`DELETE FROM tenant_monthly_costs`)).rejects.toThrow(/permission denied/);
  });

  it('当月は PROVISIONAL で毎回上書きされ、確定しない', async () => {
    const first = await rollupTenantMonthlyCost(ctxA, {
      periodMonth: '2026-09',
      now: NOW,
      billingTerms: null,
      emailTenantsBilling: 'NOT_APPLICABLE',
      ruleset: PRICING_RULESET_V1,
    });
    expect(first.kind).toBe('PROVISIONAL');
    expect((await readMonthlyCost(TENANT_A, '2026-09'))?.finalizedAt).toBeNull();
    // 売上 0（契約未記録）→ 粗利率 null（0% と偽らない）。
    expect((await readMonthlyCost(TENANT_A, '2026-09'))?.grossMarginRate).toBeNull();

    await insertAiUsage(ctxA, 'renewal-advisor', jstNoon('2026-09-16'));
    const second = await rollupTenantMonthlyCost(ctxA, {
      periodMonth: '2026-09',
      now: new Date(NOW.getTime() + 60_000),
      billingTerms: null,
      emailTenantsBilling: 'NOT_APPLICABLE',
      ruleset: PRICING_RULESET_V1,
    });
    expect(second.kind).toBe('PROVISIONAL');
    if (second.kind !== 'PROVISIONAL') return;
    expect(second.breakdown.costAiByRoleUsd['renewal-advisor']).toBe('0.020000');
    expect((await readMonthlyCost(TENANT_A, '2026-09'))?.finalizedAt).toBeNull();
  });

  it('listMonthsToRollup は当月 + 先月 + 未確定の古い月（昇順）', async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO tenant_monthly_costs (tenant_id, period_month, revenue_seat_jpy, revenue_overage_jpy, cost_ai_usd, cost_ai_by_role,
         cost_email_usd, cost_storage_usd, cost_esign_usd, pricing_ruleset_version, updated_at)
       VALUES ($1::uuid, '2026-06', 0, 0, 0, '{}'::jsonb, 0, 0, 0, 'v1', now())`,
      TENANT_A,
    );
    expect(await listMonthsToRollup(ctxA, NOW)).toEqual(['2026-06', '2026-08', '2026-09']);
    expect(await listMonthsToRollup(ctxB, NOW)).toEqual(['2026-08', '2026-09']);
    // 未来の月は集計できない。
    await expect(
      rollupTenantMonthlyCost(ctxA, { periodMonth: '2026-10', now: NOW, billingTerms: null, emailTenantsBilling: 'NOT_APPLICABLE', ruleset: PRICING_RULESET_V1 }),
    ).rejects.toThrow(RangeError);
  });
});
