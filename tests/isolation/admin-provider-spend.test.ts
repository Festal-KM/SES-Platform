// tests/isolation/admin-provider-spend.test.ts
// `A-005` 項目 17「組織全体の月間 Anthropic 支出 / tier 上限」の材料 = `readProviderMonthlySpend`
// （`@ses/db/platform`。docs/03 §8.2 / §4.5 / docs/02 `F-057` / `F-059` / docs/05 §7.6 / §16.5）。T-11-08。
//
// 🔴 ここで実証するのは「Start tier の頭打ちを事前に検知できる」ことである（`admin-sending-domains.test.ts` の作法。
//    **実 DB（RLS 付き）**。実 Anthropic API には接続しない —— `ai_usage` の行を直接置く）:
//   ① 2 テナントの `AiUsage` を仕込むと、当月（JST 暦月）の**全テナント合計**と `byRole` が正しく、
//      前月・翌月の行は含まない（境界 = JST 1 日 00:00 の行は含む）。失敗した呼び出し（`succeeded=false`）の原価も含む
//   ② `capUsd` に対して 80% 未満 = `BELOW` / 80% 以上 = `NEARING` / 100% 以上 = `REACHED`（`capUsd` を引数で変えて）
//   ③ `PLATFORM_SUPPORT` でも読める（応答は `PLATFORM_OWNER` と同一）
//   ④ 読み取りが `AuditLog(admin.monitoring.view)` に横断（`tenant_id IS NULL`）で記録され、書き込みは監査行以外に無い
//   ⑤ 🔴 DTO のキー集合が固定（`tenantId` / 対象（`target_*`）/ 内容のキーが無い）
//   ⑥ 🔴 `AI_UNIT_*` の件数を数え直していない（`usage_counters` を動かしても応答が変わらない。金額だけ）
//   ⑦ 第 1 層（列 GRANT）: `app_platform` の `ai_usage` は許可リストの列だけ・読み取りだけ
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePlatformReadDb,
  disconnectPlatformReadDb,
  resolvePlatformCtx,
  type AuthenticatedPlatformCtx,
} from '@ses/db';
import { readProviderMonthlySpend, type ProviderMonthlySpend } from '@ses/db/platform';
import {
  createUnextendedClient,
  hasColumnPrivilege,
  hasTablePrivilege,
  readTableColumns,
  type UnextendedClient,
} from '@ses/db/testing';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。他の isolation テストと同じ）。
import { ROLE_PURPOSE, type AiRole } from '../../packages/domain/src/ai/roles.js';
import { usagePeriodKey } from '../../packages/domain/src/usage/period-key.js';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { PLATFORM_READ_COLUMN_ALLOWLIST } from './support/platform-grants.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 現在時刻は注入する（期間キーを決定的にする）。JST 2026-09-16 18:00。 */
const NOW = new Date('2026-09-16T09:00:00.000Z');
const PERIOD = '2026-09';
/** JST 2026-09-01 00:00:00.000 = 当月の先頭（含む）。その 1 ms 前は前月。 */
const MONTH_START = new Date('2026-08-31T15:00:00.000Z');
const PREV_MONTH_LAST_MS = new Date(MONTH_START.getTime() - 1);
/** JST 2026-10-01 00:00:00.000 = 翌月の先頭（含まない）。 */
const NEXT_MONTH_START = new Date('2026-09-30T15:00:00.000Z');

const OWNER_USER_ID = '01930000-0000-7000-8000-0000000000ca';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-0000000000cb';

const WARN_PERCENT = 80;
const META_BASE = { ipAddress: '203.0.113.31', now: NOW, warnPercent: WARN_PERCENT } as const;

/** 当月の合計（下記 `seedUsage` の行の和）。 */
const EXPECTED_SPENT_USD = '410.000000';

/** 🔴 応答に 1 バイトも現れてはならない値（対象エンティティの ID・モデル・プロンプト版・用途）。 */
const TARGET_ID = '01930000-0000-7000-8000-0000000017f1';
const MODEL_ID = 'claude-sonnet-5-t1108';
const PROMPT_VERSION = 'sheet-parser.v9-t1108';
const FORBIDDEN_STRINGS = [TARGET_ID, MODEL_ID, PROMPT_VERSION, 'SkillSheet', TENANT_A, TENANT_B] as const;

/** 🔴 DTO のキー集合（固定）。増やすときは docs/05 §16.5 項目 17 と T-11-02 / T-11-04 の画面を同時に見直す。 */
const DTO_KEYS = [
  'byRole',
  'capUsd',
  'consumptionRate',
  'level',
  'observedAt',
  'periodKey',
  'spentUsd',
  'tenantCount',
] as const;

const ALL_ROLES: readonly AiRole[] = [
  'sheet-parser',
  'skill-normalizer',
  'match-explainer',
  'gate-inspector',
  'proposal-drafter',
  'renewal-advisor',
];

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

async function insertUsage(input: {
  readonly tenantId: string;
  readonly role: AiRole;
  readonly costUsd: string;
  readonly startedAt: Date;
  readonly succeeded?: boolean;
  readonly failureKind?: 'TIMEOUT' | 'SPEND_CAP';
}): Promise<void> {
  const purpose = ROLE_PURPOSE[input.role];
  await superuser.$executeRaw`
    INSERT INTO ai_usage
      (id, tenant_id, role, model_id, purpose, prompt_version, target_type, target_id,
       input_tokens, output_tokens, estimated_cost_usd, succeeded, failure_kind, started_at, finished_at)
    VALUES (gen_random_uuid(), ${input.tenantId}::uuid, ${input.role}, ${MODEL_ID}, ${purpose}, ${PROMPT_VERSION},
            'SkillSheet', ${TARGET_ID}::uuid,
            1000, 200, ${input.costUsd}::numeric, ${input.succeeded ?? true}, ${input.failureKind ?? null},
            ${input.startedAt}, ${new Date(input.startedAt.getTime() + 1_000)})`;
}

async function readSpend(ctx: AuthenticatedPlatformCtx, capUsd: number): Promise<ProviderMonthlySpend> {
  return readProviderMonthlySpend(ctx, { ...META_BASE, capUsd });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // 対照: 注入した NOW の期間キーは固定値と一致する（暦の出所は domain の 1 つ）。
  expect(usagePeriodKey('MONTH', NOW)).toBe(PERIOD);

  // --- 当月（含む）。テナント A: 120 + 50.25 + 0.000001 / テナント B: 229.75 + 9.999999 = 410.000000 ---
  await insertUsage({ tenantId: TENANT_A, role: 'sheet-parser', costUsd: '100.000000', startedAt: new Date('2026-09-02T01:00:00.000Z') });
  await insertUsage({ tenantId: TENANT_A, role: 'sheet-parser', costUsd: '20.000000', startedAt: new Date('2026-09-10T02:00:00.000Z') });
  await insertUsage({ tenantId: TENANT_A, role: 'gate-inspector', costUsd: '50.250000', startedAt: new Date('2026-09-15T03:00:00.000Z') });
  // 🔴 境界: JST 9/1 00:00:00.000 ちょうどは当月。
  await insertUsage({ tenantId: TENANT_A, role: 'skill-normalizer', costUsd: '0.000001', startedAt: MONTH_START });
  await insertUsage({ tenantId: TENANT_B, role: 'proposal-drafter', costUsd: '229.750000', startedAt: new Date('2026-09-16T08:59:00.000Z') });
  // 🔴 失敗した呼び出し（`succeeded=false`。TIMEOUT）でもトークンは消費され支出になる → 含む。
  await insertUsage({ tenantId: TENANT_B, role: 'gate-inspector', costUsd: '9.999999', startedAt: new Date('2026-09-05T04:00:00.000Z'), succeeded: false, failureKind: 'TIMEOUT' });

  // --- 前月（含まない）: 境界の 1 ms 前と、8 月中旬 ---
  await insertUsage({ tenantId: TENANT_A, role: 'renewal-advisor', costUsd: '1000.000000', startedAt: PREV_MONTH_LAST_MS });
  await insertUsage({ tenantId: TENANT_B, role: 'match-explainer', costUsd: '1000.000000', startedAt: new Date('2026-08-15T00:00:00.000Z') });
  // --- 翌月（含まない）: 境界ちょうど ---
  await insertUsage({ tenantId: TENANT_B, role: 'match-explainer', costUsd: '1000.000000', startedAt: NEXT_MONTH_START });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectPlatformReadDb();
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 当月（JST 暦月）の全テナント合計とロール別内訳', () => {
  it('🔴 合計 410.000000 / 2 テナント。前月・翌月の 3,000 USD は含まない。境界（JST 1 日 00:00）の行は含む', async () => {
    const result = await readSpend(ownerCtx, 1000);
    expect(result.periodKey).toBe(PERIOD);
    expect(result.spentUsd).toBe(EXPECTED_SPENT_USD);
    expect(result.tenantCount).toBe(2);
    expect(result.observedAt).toEqual(NOW);
    expect(result.capUsd).toBe('1000.000000');
  });

  it('byRole は 6 ロール固定で、失敗した呼び出しの原価（gate-inspector 9.999999）も含む', async () => {
    const { byRole } = await readSpend(ownerCtx, 1000);
    expect(Object.keys(byRole).sort()).toEqual([...ALL_ROLES].sort());
    expect(byRole).toEqual({
      'sheet-parser': '120.000000',
      'skill-normalizer': '0.000001',
      'match-explainer': '0.000000',
      'gate-inspector': '60.249999',
      'proposal-drafter': '229.750000',
      'renewal-advisor': '0.000000',
    });
  });

  it('対照: DB には前月・翌月の行が実在する（除外の検査が空振りでない）', async () => {
    const rows = await superuser.$queryRaw<Array<{ total: string; n: bigint }>>`
      SELECT SUM(estimated_cost_usd)::text AS total, count(*) AS n FROM ai_usage`;
    expect(rows[0]?.total).toBe('3410.000000');
    expect(Number(rows[0]?.n)).toBe(9);
  });
});

describe('② 水準: capUsd に対して 80% 未満 = BELOW / 80% 以上 = NEARING / 100% 以上 = REACHED', () => {
  it('cap $1,000（Build tier 相当）: 41% → BELOW', async () => {
    const result = await readSpend(ownerCtx, 1000);
    expect(result.level).toBe('BELOW');
    expect(result.consumptionRate).toBeCloseTo(0.41, 12);
  });

  it('cap $513: 79.92% → BELOW（80% の直下）', async () => {
    const result = await readSpend(ownerCtx, 513);
    expect(result.level).toBe('BELOW');
    expect(result.consumptionRate).toBeLessThan(0.8);
  });

  it('🔴 cap $512.5: 80% ちょうど → NEARING（`F-027 AC-4` と同じ「達した時点で」）', async () => {
    const result = await readSpend(ownerCtx, 512.5);
    expect(result.level).toBe('NEARING');
    expect(result.consumptionRate).toBeCloseTo(0.8, 12);
  });

  it('🔴 cap $500（Start tier）: 82% → NEARING。運営者への警告の材料', async () => {
    const result = await readSpend(ownerCtx, 500);
    expect(result.level).toBe('NEARING');
    expect(result.consumptionRate).toBeCloseTo(0.82, 12);
    expect(result.capUsd).toBe('500.000000');
  });

  it('🔴 cap $410: 100% ちょうど → REACHED。cap $400: 超過（102.5%）→ REACHED で消費率は 1 を超える', async () => {
    const exact = await readSpend(ownerCtx, 410);
    expect(exact.level).toBe('REACHED');
    expect(exact.consumptionRate).toBe(1);
    const over = await readSpend(ownerCtx, 400);
    expect(over.level).toBe('REACHED');
    expect(over.consumptionRate).toBeCloseTo(1.025, 12);
  });

  it('不正な上限（0 / 負 / NaN）は監査行を残さずに落ちる', async () => {
    const before = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    for (const capUsd of [0, -500, Number.NaN]) {
      await expect(readSpend(ownerCtx, capUsd)).rejects.toThrow(RangeError);
    }
    const after = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});

describe('③ / ④: PLATFORM_SUPPORT でも読め、読み取りが admin.monitoring.view に横断で記録される', () => {
  it('PLATFORM_SUPPORT の応答は PLATFORM_OWNER と同一', async () => {
    const [owner, support] = await Promise.all([readSpend(ownerCtx, 500), readSpend(supportCtx, 500)]);
    expect(support).toEqual(owner);
  });

  it('🔴 監査ログ: actor = 運営者、tenant_id IS NULL（横断）、platformRole が summary に載る。書き込みは監査行以外に無い', async () => {
    const before = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    const usageBefore = await superuser.$queryRaw<Array<{ n: bigint; total: string }>>`
      SELECT count(*) AS n, SUM(estimated_cost_usd)::text AS total FROM ai_usage`;

    await readSpend(supportCtx, 500);

    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; actor_kind: string; actor_id: string; ip_address: string | null; summary: Record<string, unknown> }>
    >`
      SELECT tenant_id, actor_kind, actor_id, ip_address, summary
        FROM audit_logs WHERE action = 'admin.monitoring.view' ORDER BY created_at DESC, id DESC LIMIT 1`;
    const after = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    expect(Number(after[0]?.count) - Number(before[0]?.count)).toBe(1);
    expect(rows[0]).toEqual({
      tenant_id: null,
      actor_kind: 'PLATFORM_USER',
      actor_id: SUPPORT_USER_ID,
      ip_address: '203.0.113.31',
      summary: { platformRole: 'PLATFORM_SUPPORT' },
    });
    const usageAfter = await superuser.$queryRaw<Array<{ n: bigint; total: string }>>`
      SELECT count(*) AS n, SUM(estimated_cost_usd)::text AS total FROM ai_usage`;
    expect(usageAfter[0]).toEqual(usageBefore[0]);
  });
});

describe('⑤ 🔴 DTO のキー集合が固定（tenantId / 対象 / 内容のキーが無い。BR-40）', () => {
  it('キー集合が宣言どおりで、環境全体（tenantId を持たない）', async () => {
    const result = await readSpend(ownerCtx, 500);
    expect(Object.keys(result).sort()).toEqual([...DTO_KEYS]);
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('items');
  });

  it('🔴 対象エンティティの ID / モデル / プロンプト版 / 用途 / テナント ID が JSON に 1 バイトも現れない', async () => {
    const result = await readSpend(ownerCtx, 500);
    const json = JSON.stringify(result);
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(json, `応答に「${forbidden}」が含まれている`).not.toContain(forbidden);
    }
    // 対照: 検査対象の値は DB の行に実在する（検査が空振りでない）。
    const stored = await superuser.$queryRaw<Array<{ target_id: string; model_id: string; prompt_version: string }>>`
      SELECT target_id, model_id, prompt_version FROM ai_usage LIMIT 1`;
    expect(stored[0]).toEqual({ target_id: TARGET_ID, model_id: MODEL_ID, prompt_version: PROMPT_VERSION });
  });
});

describe('⑥ 🔴 AI_UNIT_* の件数を数え直していない（金額だけ）', () => {
  it('usage_counters の AI_UNIT_* を大きく動かしても応答は 1 バイトも変わらない', async () => {
    const before = await readSpend(ownerCtx, 500);
    await superuser.$executeRaw`
      INSERT INTO usage_counters (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
      VALUES (gen_random_uuid(), ${TENANT_A}::uuid, 'MONTH', ${PERIOD}, 'AI_UNIT_SHEET_PARSE', 999999, 0, ${NOW}),
             (gen_random_uuid(), ${TENANT_B}::uuid, 'MONTH', ${PERIOD}, 'AI_UNIT_PROPOSAL_DRAFT', 999999, 0, ${NOW})
      ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE SET value = EXCLUDED.value`;
    try {
      const after = await readSpend(ownerCtx, 500);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(JSON.stringify(after)).not.toContain('999999');
    } finally {
      await superuser.$executeRaw`
        DELETE FROM usage_counters WHERE period_kind = 'MONTH' AND period_key = ${PERIOD}
           AND metric IN ('AI_UNIT_SHEET_PARSE', 'AI_UNIT_PROPOSAL_DRAFT') AND value = 999999`;
    }
  });
});

describe('⑦ 第 1 層（列 GRANT）: app_platform の ai_usage は許可リストの列だけ・読み取りだけ', () => {
  it('SELECT できる列の集合が許可リストと一致し、集計に要る 4 列（tenant_id / role / estimated_cost_usd / started_at）を含む', async () => {
    const columns = await readTableColumns(superuser, 'ai_usage');
    const selectable: string[] = [];
    for (const column of columns) {
      if (await hasColumnPrivilege(superuser, 'app_platform', 'ai_usage', column, 'SELECT')) {
        selectable.push(column);
      }
    }
    expect(selectable.sort()).toEqual([...PLATFORM_READ_COLUMN_ALLOWLIST.ai_usage!].sort());
    for (const required of ['tenant_id', 'role', 'estimated_cost_usd', 'started_at']) {
      expect(selectable).toContain(required);
    }
  });

  it('INSERT / UPDATE / DELETE の権限が 0 件（read-only。CLAUDE.md §10.5）', async () => {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      expect(
        await hasTablePrivilege(superuser, 'app_platform', 'ai_usage', privilege),
        `app_platform に ai_usage の ${privilege} がある`,
      ).toBe(false);
    }
  });
});
