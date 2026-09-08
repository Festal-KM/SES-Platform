// tests/isolation/ai-usage.test.ts
// 🔴 T-07-03（docs/sprints/SP-07-ai-layer-gate.md）の完了判定を **DB + RLS 付きで**実証する:
//
//   ① 🔴 `F-026 AC-1` **呼び出し 1 回につき `AiUsage` が 1 件**（再試行は `attemptNo` を増やして
//      別の行。失敗した試行も 1 行）
//   ② 🔴 `F-026 AC-2` **ロール識別子が必ず入り、ロール別に原価を集計できる**。誤記は DB の
//      CHECK が弾く（アプリを迂回しても入らない）
//   ③ 🔴 `F-026 AC-6` **件数のカウンタが金額と独立**である。`skill-normalizer` と
//      `gate-inspector` は件数に入らない（記録はされる）。根拠文は候補数で数える
//   ④ 🔴 **標準原価（単価）が違っても件数は変わらない** —— 件数を金額から割り戻していないことの
//      実測（docs/03 §7.6.3-1。1 件あたり標準原価を見直しても過去の残量が動かない根拠）
//   ⑤ 🔴 **テナント境界**（CLAUDE.md §3.1 / `F-004 AC-1`）と、`ai_usage` が C2 HOST_ONLY で
//      あること（パートナー文脈からは自テナントの行も 1 件も見えない）
//   ⑥ 🔴 単価が引けないモデルでは **1 行も書かれない**（0 円で記録しない。`F-027` の上限が
//      無効化されない）
//
// 🔴 `packages/db` の関数を直接呼ぶ。`runRole` 側の手順（試行ごとに `record`、成功 1 回につき
//    `countUnit` 1 度）は `packages/ai/src/run.test.ts` が、両者の配線は
//    `apps/worker/src/ai/usage-recorder.test.ts` が見る。ここで見たいのは **DB の実挙動**である。
//
// 🔴 母集団は固定フィクスチャで足りる（`ai_usage` は業務行に依存せず、必要なのはテナントと
//    利用者だけである）。`usage-counters.test.ts`（T-03-10）と同じ選択。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  countAiUnit,
  disconnectTenantDb,
  recordAiUsage,
  resolveTenantCtx,
  systemTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, runUnextended, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-08 01:00 → 月キーは 2026-09。 */
const STARTED_AT = new Date('2026-09-07T16:00:00.000Z');
const FINISHED_AT = new Date('2026-09-07T16:00:03.000Z');
const MONTH_KEY = '2026-09';

const JOB = { queue: 'gate.run', jobId: 'gate.run:PROPOSAL:1:hash' } as const;
const TARGET_ID = '01930000-0000-7000-8000-000000000201';

const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';

let database: IsolationDatabase;
/** 🔴 前提づくりと「保存されている生の値」の確認だけに使う特権接続。 */
let admin: UnextendedClient;
/** 🔴 素の `app_tenant` 接続（RLS の実挙動を拡張なしで見る）。 */
let rawTenant: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;
let ctxAHost: AuthenticatedTenantCtx;
let ctxAPartner: AuthenticatedTenantCtx;
let ctxBHost: AuthenticatedTenantCtx;

type UsageValues = Parameters<typeof recordAiUsage>[1];

function usage(overrides: Partial<UsageValues> = {}): UsageValues {
  return {
    role: 'gate-inspector',
    purpose: 'gate',
    modelId: SONNET,
    promptVersion: 'gate-inspector.v1',
    targetType: 'PROPOSAL',
    targetId: TARGET_ID,
    tokens: { inputTokens: 5_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    attemptNo: 1,
    succeeded: true,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    ...overrides,
  };
}

async function readUnitCounters(tenantId: string): Promise<Array<{ metric: string; periodKind: string; periodKey: string; value: string }>> {
  const rows = await admin.usageCounter.findMany({
    where: { tenantId, metric: { startsWith: 'AI_UNIT_' } },
    orderBy: { metric: 'asc' },
    select: { metric: true, periodKind: true, periodKey: true, value: true },
  });
  return rows.map((row) => ({
    metric: row.metric,
    periodKind: row.periodKind,
    periodKey: row.periodKey,
    value: row.value.toString(),
  }));
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  rawTenant = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, JOB);
  ctxB = systemTenantCtx(TENANT_B, JOB);
  ctxAHost = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'ADMIN',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  ctxAPartner = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'NOT_ENROLLED',
    },
    { deviceKind: 'api' },
  );
  ctxBHost = await resolveTenantCtx(
    {
      tenantId: TENANT_B,
      partnerCompanyId: null,
      userId: USER_B_HOST,
      role: 'ADMIN',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  // 🔴 各テストを独立させる（このスイートが作る行だけを消す）。
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_UNIT_' } } });
});

afterAll(async () => {
  await disconnectTenantDb();
  await rawTenant?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 呼び出し 1 回につき AiUsage 1 件（F-026 AC-1 / docs/05 §7.3 手順 6）', () => {
  it('試行 1 回につき 1 行になり、再試行は attemptNo を増やした別の行になる', async () => {
    const ids = [
      await recordAiUsage(ctxA, usage({ attemptNo: 1, succeeded: false, failureKind: 'SCHEMA' })),
      await recordAiUsage(ctxA, usage({ attemptNo: 2, succeeded: false, failureKind: 'TIMEOUT' })),
      await recordAiUsage(ctxA, usage({ attemptNo: 3, succeeded: true })),
    ];

    expect(new Set(ids).size).toBe(3);
    const rows = await admin.aiUsage.findMany({
      where: { tenantId: TENANT_A },
      orderBy: { attemptNo: 'asc' },
      select: { id: true, attemptNo: true, succeeded: true, failureKind: true },
    });
    expect(rows).toEqual([
      { id: ids[0], attemptNo: 1, succeeded: false, failureKind: 'SCHEMA' },
      { id: ids[1], attemptNo: 2, succeeded: false, failureKind: 'TIMEOUT' },
      { id: ids[2], attemptNo: 3, succeeded: true, failureKind: null },
    ]);
  });

  it('🔴 attemptNo が 1 未満・非整数なら記録せず例外にする（試行番号の欠けた行を作らない）', async () => {
    await expect(recordAiUsage(ctxA, usage({ attemptNo: 0 }))).rejects.toThrow(RangeError);
    expect(await admin.aiUsage.count()).toBe(0);
  });

  it('🔴 成否と失敗種別が食い違う行は書かない（失敗率と原価分解の両方が汚れる）', async () => {
    await expect(
      recordAiUsage(ctxA, usage({ succeeded: true, failureKind: 'SCHEMA' })),
    ).rejects.toThrow(RangeError);
    await expect(recordAiUsage(ctxA, usage({ succeeded: false }))).rejects.toThrow(RangeError);
    expect(await admin.aiUsage.count()).toBe(0);
  });
});

describe('🔴 記録項目とロール識別子（F-026 AC-2 / docs/05 §3.8）', () => {
  it('F-026 の入力（ロール / モデル / 用途 / 入出力トークン / 推定コスト / 対象）がすべて入る', async () => {
    const id = await recordAiUsage(
      ctxA,
      usage({
        tokens: {
          inputTokens: 5_000,
          outputTokens: 1_000,
          cacheReadTokens: 700,
          cacheWriteTokens: 300,
        },
      }),
    );
    const row = await admin.aiUsage.findUniqueOrThrow({ where: { id } });

    expect(row.tenantId).toBe(TENANT_A);
    expect(row.role).toBe('gate-inspector');
    expect(row.purpose).toBe('gate');
    expect(row.modelId).toBe(SONNET);
    expect(row.promptVersion).toBe('gate-inspector.v1');
    expect(row.targetType).toBe('PROPOSAL');
    expect(row.targetId).toBe(TARGET_ID);
    expect(row.inputTokens).toBe(5_000);
    expect(row.outputTokens).toBe(1_000);
    expect(row.cacheReadTokens).toBe(700);
    expect(row.cacheWriteTokens).toBe(300);
    expect(row.startedAt.toISOString()).toBe(STARTED_AT.toISOString());
    expect(row.finishedAt.toISOString()).toBe(FINISHED_AT.toISOString());
  });

  it('推定コストが docs/03 §3.3.1 の単価どおりに算出される（キャッシュは別単価）', async () => {
    // 5,000 × $2 + 1,000 × $10 + 700 × $0.20 + 300 × $2.50 = $0.020 + $0.00014 + $0.00075
    const id = await recordAiUsage(
      ctxA,
      usage({
        tokens: {
          inputTokens: 5_000,
          outputTokens: 1_000,
          cacheReadTokens: 700,
          cacheWriteTokens: 300,
        },
      }),
    );
    const row = await admin.aiUsage.findUniqueOrThrow({ where: { id } });
    expect(row.estimatedCostUsd.toString()).toBe('0.02089');
  });

  it('6 ロールすべてを記録でき、ロール別に集計できる（F-063 の前提）', async () => {
    const roles = [
      ['sheet-parser', 'sheet_parse'],
      ['skill-normalizer', 'skill_normalize'],
      ['match-explainer', 'match_rationale'],
      ['gate-inspector', 'gate'],
      ['proposal-drafter', 'proposal_draft'],
      ['renewal-advisor', 'renewal_summary'],
    ] as const;
    for (const [role, purpose] of roles) {
      await recordAiUsage(ctxA, usage({ role, purpose }));
    }

    const grouped = await admin.aiUsage.groupBy({
      by: ['role'],
      where: { tenantId: TENANT_A },
      _count: { _all: true },
    });
    expect(grouped).toHaveLength(6);
    expect(grouped.every((group) => group._count._all === 1)).toBe(true);
  });

  it('🔴 ロール識別子の誤記はアプリを迂回しても DB の CHECK が弾く（ai_usage_role_check）', async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO ai_usage (id, tenant_id, role, model_id, purpose, prompt_version,
           input_tokens, output_tokens, estimated_cost_usd, succeeded, started_at, finished_at)
         VALUES (gen_random_uuid(), '${TENANT_A}'::uuid, 'gpt-inspector', 'x', 'gate', 'v1',
           1, 1, 0, true, now(), now())`,
      ),
    ).rejects.toThrow(/ai_usage_role_check/);
  });

  it('🔴 単価が引けないモデルでは 1 行も書かれない（0 円で記録しない）', async () => {
    await expect(recordAiUsage(ctxA, usage({ modelId: 'gpt-4o' }))).rejects.toThrow(/単価が未登録/);
    expect(await admin.aiUsage.count()).toBe(0);
  });

  it('🔴 パターン検出による追加マスキングの要約が残り、一致した文字列は残らない（docs/03 §4.2）', async () => {
    const id = await recordAiUsage(
      ctxA,
      usage({
        maskHits: [
          { category: 'NAME', method: 'KNOWN_VALUE', count: 4 },
          { category: 'EMAIL', method: 'PATTERN', count: 2 },
          { category: 'PHONE', method: 'PATTERN', count: 1 },
        ],
      }),
    );
    const row = await admin.aiUsage.findUniqueOrThrow({ where: { id } });
    expect(row.maskPatternHits).toEqual({ EMAIL: 2, PHONE: 1 });
  });

  it('マスキング要約を渡さなければ空オブジェクト（NULL にしない = 欠測と区別できる）', async () => {
    const id = await recordAiUsage(ctxA, usage());
    const row = await admin.aiUsage.findUniqueOrThrow({ where: { id } });
    expect(row.maskPatternHits).toEqual({});
  });
});

describe('🔴 利用者向け件数の加算（P-A-18 / docs/03 §7.6.1）', () => {
  it('スキルシート解析は sheet-parser の 1 回 = 1 件（月次のカウンタ）', async () => {
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });

    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_SHEET_PARSE', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '1' },
    ]);
  });

  it('🔴 skill-normalizer は 1 件と数えない（同じ解析が辞書のヒット状況で 1 件にも 2 件にも見えない）', async () => {
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });
    const result = await countAiUnit(ctxA, {
      role: 'skill-normalizer',
      output: { results: [] },
      occurredAt: FINISHED_AT,
    });

    expect(result).toBeNull();
    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_SHEET_PARSE', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '1' },
    ]);
  });

  it('🔴 gate-inspector は AiUsage に記録されるが件数には入らない（F-026 AC-6 / F-027 AC-7）', async () => {
    await recordAiUsage(ctxA, usage({ role: 'gate-inspector', purpose: 'gate' }));
    const result = await countAiUnit(ctxA, {
      role: 'gate-inspector',
      output: { pii: { verdict: 'PASS' } },
      occurredAt: FINISHED_AT,
    });

    expect(result).toBeNull();
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(1);
    expect(await readUnitCounters(TENANT_A)).toEqual([]);
  });

  it('🔴 根拠文は候補数で数える（10 候補を 1 リクエストにまとめても 10 件）', async () => {
    await countAiUnit(ctxA, {
      role: 'match-explainer',
      output: { rationales: Array.from({ length: 10 }, (_, i) => ({ ref: `c${i}` })) },
      occurredAt: FINISHED_AT,
    });

    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_MATCH_RATIONALE', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '10' },
    ]);
  });

  it('根拠文が 0 件ならカウンタの行を作らない', async () => {
    const result = await countAiUnit(ctxA, {
      role: 'match-explainer',
      output: { rationales: [] },
      occurredAt: FINISHED_AT,
    });
    expect(result).toBeNull();
    expect(await readUnitCounters(TENANT_A)).toEqual([]);
  });

  it('🔴 出力の形が読めなければ 0 件で通さず例外にする（請求できない消費を静かに積まない）', async () => {
    await expect(
      countAiUnit(ctxA, { role: 'match-explainer', output: {}, occurredAt: FINISHED_AT }),
    ).rejects.toThrow(TypeError);
  });

  it('利用者の再生成操作（新しい呼び出し）は 1 件として加算される', async () => {
    await countAiUnit(ctxA, { role: 'proposal-drafter', output: {}, occurredAt: FINISHED_AT });
    await countAiUnit(ctxA, { role: 'proposal-drafter', output: {}, occurredAt: FINISHED_AT });

    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_PROPOSAL_DRAFT', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '2' },
    ]);
  });
});

describe('🔴 件数は金額から割り戻さない（F-026 AC-6 / docs/03 §7.6.3-1）', () => {
  it('単価もトークン数も違う 2 回の呼び出しが、同じ 1 件ずつとして数えられる', async () => {
    await recordAiUsage(
      ctxA,
      usage({
        role: 'sheet-parser',
        purpose: 'sheet_parse',
        modelId: SONNET,
        tokens: { inputTokens: 8_000, outputTokens: 1_500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    );
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });
    await recordAiUsage(
      ctxA,
      usage({
        role: 'sheet-parser',
        purpose: 'sheet_parse',
        modelId: HAIKU,
        tokens: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    );
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });

    // 🔴 金額は 2 行で大きく違う（記録されている）
    const costs = await admin.aiUsage.findMany({
      where: { tenantId: TENANT_A },
      select: { estimatedCostUsd: true },
      orderBy: { estimatedCostUsd: 'desc' },
    });
    expect(costs.map((row) => row.estimatedCostUsd.toString())).toEqual(['0.031', '0.00015']);

    // 🔴 それでも件数は 2 件ちょうど（金額から割り戻していない）
    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_SHEET_PARSE', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '2' },
    ]);
  });

  it('🔴 件数の加算は金額のカウンタ（AI_COST_USD）を動かさない（2 つは独立している）', async () => {
    await countAiUnit(ctxA, { role: 'renewal-advisor', output: {}, occurredAt: FINISHED_AT });

    const cost = await admin.usageCounter.findFirst({
      where: { tenantId: TENANT_A, metric: 'AI_COST_USD' },
    });
    expect(cost).toBeNull();
    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_RENEWAL_SUMMARY', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '1' },
    ]);
  });

  it('🔴 UsageCounter の件数を ai_usage の行数から数え直していない（再試行が混入しない）', async () => {
    // 3 試行（= ai_usage 3 行）だが、成功 1 回につき 1 度しか数えない。
    await recordAiUsage(ctxA, usage({ role: 'sheet-parser', purpose: 'sheet_parse', attemptNo: 1, succeeded: false, failureKind: 'SCHEMA' }));
    await recordAiUsage(ctxA, usage({ role: 'sheet-parser', purpose: 'sheet_parse', attemptNo: 2, succeeded: false, failureKind: 'SCHEMA' }));
    await recordAiUsage(ctxA, usage({ role: 'sheet-parser', purpose: 'sheet_parse', attemptNo: 3, succeeded: true }));
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });

    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(3);
    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_SHEET_PARSE', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '1' },
    ]);
  });
});

describe('🔴 テナント境界とホスト限定（CLAUDE.md §3.1 / docs/05 §4.4 C2）', () => {
  it('他テナントの AiUsage は 1 件も見えない', async () => {
    await recordAiUsage(ctxA, usage());
    await recordAiUsage(ctxB, usage());

    const seenByB = await withTenant(ctxBHost, (db) =>
      db.aiUsage.findMany({ select: { tenantId: true } }),
    );
    expect(seenByB.map((row) => row.tenantId)).toEqual([TENANT_B]);
  });

  it('🔴 Prisma 拡張を外した素の接続でも、他テナントの行は RLS が止める', async () => {
    await recordAiUsage(ctxA, usage());
    await recordAiUsage(ctxB, usage());

    const rows = await runUnextended(
      rawTenant,
      { tenantId: TENANT_B, partnerCompanyId: null, actorUserId: USER_B_HOST },
      (tx) => tx.aiUsage.findMany({ select: { tenantId: true } }),
    );
    expect(rows.map((row) => row.tenantId)).toEqual([TENANT_B]);
  });

  it('🔴 パートナー文脈からは自テナントの AiUsage も見えない（運営指標はホストの数字である）', async () => {
    await recordAiUsage(ctxA, usage());

    expect(await withTenant(ctxAPartner, (db) => db.aiUsage.findMany())).toHaveLength(0);
    expect(await withTenant(ctxAHost, (db) => db.aiUsage.findMany())).toHaveLength(1);
  });

  it('🔴 件数カウンタも他テナントに混ざらない', async () => {
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });
    await countAiUnit(ctxB, { role: 'proposal-drafter', output: {}, occurredAt: FINISHED_AT });

    expect(await readUnitCounters(TENANT_A)).toEqual([
      { metric: 'AI_UNIT_SHEET_PARSE', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '1' },
    ]);
    expect(await readUnitCounters(TENANT_B)).toEqual([
      { metric: 'AI_UNIT_PROPOSAL_DRAFT', periodKind: 'MONTH', periodKey: MONTH_KEY, value: '1' },
    ]);
  });

  it('🔴 パートナー文脈からは AI_UNIT_* のカウンタも見えない（C2。STORAGE_BYTES だけが例外）', async () => {
    await countAiUnit(ctxA, { role: 'sheet-parser', output: {}, occurredAt: FINISHED_AT });

    const seen = await withTenant(ctxAPartner, (db) =>
      db.usageCounter.findMany({ where: { metric: { startsWith: 'AI_UNIT_' } } }),
    );
    expect(seen).toHaveLength(0);
  });
});
