// tests/isolation/ai-cost-guard.test.ts
// 🔴 T-07-04（docs/sprints/SP-07-ai-layer-gate.md）の完了判定を **DB + RLS 付きで**実証する:
//
//   ① 🔴 `F-027` **呼び出しの前に予約し、予約できなければ呼ばない** —— 上限を超える見積りは
//      その日の最初の 1 回でも通らない（行が無いときも上限が効く）
//   ② 🔴 **境界値** —— 上限ちょうどは通り、1 micro-USD 超えたら止まる
//   ③ 🔴 **並行実行で上限を破らない**（docs/03 §4.5 の競合状態）。10 並列でも予約の総和は
//      上限を超えない。「判定 → 呼び出し → 記録」では防げない部分がここである
//   ④ 予約 → 補正（`settle`）で `reserved_value` が戻り、実コストが `value` に積まれる
//   ⑤ 🔴 **予約の TTL は暦日**（docs/05 §7.12）。補正されずに残った予約は翌日の判定に
//      影響しない（＝ 清掃ジョブを必要としない）
//   ⑥ 🔴 **日をまたいだ呼び出しは予約した日の行に補正される**（予約と補正が必ず対になる）
//   ⑦ 🔴 単価が引けないモデルは**予約の前**に落ち、行が 1 つも書かれない（原価だけが出ない）
//   ⑧ 🔴 テナント境界（`CLAUDE.md` §3.1 / `F-004 AC-1`）
//
// 🔴 `packages/db` の関数を直接呼ぶ。ここで見たいのは **DB の実挙動**である。
//
// 🔴 「予約に失敗したら外部呼び出しが 0 回」（T-07-04 の完了判定）は**3 つの継ぎ目**で押さえてある。
//    どれか 1 つが欠けると鎖が切れるので、まとめて記す:
//      ① ここ … 実 DB が上限到達で `LIMIT_REACHED` を返す（並行実行でも破れない）
//      ② `apps/worker/src/ai/cost-guard.test.ts` … `LIMIT_REACHED` → `AiCostLimitExceededError`
//      ③ `packages/ai/src/run.test.ts` … 予約が例外を投げたら `MockAnthropicClient` の
//         `callCount()` が 0 で `AiUsage` も 0 行（＝ 呼ばずに保留。`F-027 AC-5`）
//    ③を実 DB と繋いだ通しの結合テストは**書けない**（`apps/worker` は `zod` に依存せず
//    `RoleSpec` を組み立てられない / `MockAnthropicClient` はバレルから出ていない）。
//    依存を足してまで 1 本にする価値より、継ぎ目ごとに固定する方を採った。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  readAiDailyCost,
  reserveAiCost,
  settleAiCost,
  systemTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-08 01:00。 */
const NOW = new Date('2026-09-07T16:00:00.000Z');
const PERIOD_KEY = '2026-09-08';
/** 同じ JST 日の 23:59:59（UTC 14:59:59）。日またぎの検証に使う。 */
const LATE_TODAY = new Date('2026-09-08T14:59:59.000Z');
/** その 1 秒後 = JST 翌日 00:00:00。🔴 当日の枠がリセットされる時刻そのものである。 */
const JUST_AFTER_MIDNIGHT = new Date('2026-09-08T15:00:00.000Z');
const RESET_AT = JUST_AFTER_MIDNIGHT;
const NEXT_PERIOD_KEY = '2026-09-09';

const JOB = { queue: 'gate.run', jobId: 'gate.run:PROPOSAL:1:hash' } as const;
const SONNET = 'claude-sonnet-5';

/**
 * 1 回の見積り = $0.04。
 * 入力 10,000 tok × $2/MTok = $0.02 ＋ 出力（上限）2,000 tok × $10/MTok = $0.02。
 */
const ESTIMATE_INPUT_TOKENS = 10_000;
const ESTIMATE_MAX_OUTPUT_TOKENS = 2_000;
const ESTIMATE_USD = '0.040000';
/** 🔴 2 回ぶんは通り、3 回目は通らない上限（$0.04 × 2 = $0.08 ≤ $0.10 < $0.12）。 */
const LIMIT_USD = '0.100000';

let database: IsolationDatabase;
/** 🔴 前提づくりと「保存されている生の値」の確認だけに使う特権接続。 */
let admin: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;

function reserve(
  ctx: SystemTenantCtx,
  overrides: Partial<Parameters<typeof reserveAiCost>[1]> = {},
): ReturnType<typeof reserveAiCost> {
  return reserveAiCost(ctx, {
    modelId: SONNET,
    estimatedInputTokens: ESTIMATE_INPUT_TOKENS,
    maxOutputTokens: ESTIMATE_MAX_OUTPUT_TOKENS,
    limitUsd: LIMIT_USD,
    now: NOW,
    ...overrides,
  });
}

async function readCounter(
  tenantId: string,
  periodKey: string,
): Promise<{ value: string; reservedValue: string } | null> {
  const row = await admin.usageCounter.findFirst({
    where: { tenantId, periodKind: 'DAY', periodKey, metric: 'AI_COST_USD' },
    select: { value: true, reservedValue: true },
  });
  return row === null
    ? null
    : { value: row.value.toString(), reservedValue: row.reservedValue.toString() };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, JOB);
  ctxB = systemTenantCtx(TENANT_B, JOB);
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  await admin.usageCounter.deleteMany({ where: { metric: 'AI_COST_USD' } });
});

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 呼び出しの前に予約する（F-027 / docs/03 §4.5）', () => {
  it('予約できたら証と見積り額を返し、reserved_value にだけ積む（value は動かない）', async () => {
    const outcome = await reserve(ctxA);

    expect(outcome).toEqual({
      kind: 'RESERVED',
      handle: `v1:${PERIOD_KEY}:40000`,
      reservedUsd: ESTIMATE_USD,
      periodKey: PERIOD_KEY,
    });
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({
      value: '0',
      reservedValue: '0.04',
    });
  });

  it('🔴 上限に達したら LIMIT_REACHED を返す（呼び出し側は LLM を呼ばない）', async () => {
    await reserve(ctxA);
    await reserve(ctxA);
    const third = await reserve(ctxA);

    expect(third.kind).toBe('LIMIT_REACHED');
    if (third.kind !== 'LIMIT_REACHED') throw new Error('unreachable');
    expect(third.limitUsd).toBe(LIMIT_USD);
    // 残り枠は $0.10 − $0.08 = $0.02（次の $0.04 は入らない）。
    expect(third.headroomUsd).toBe('0.020000');
    // 🔴 リセットは JST の翌 0 時（利用者に見せてよい唯一の値。`F-027 AC-6`）。
    expect(third.resetAt.toISOString()).toBe('2026-09-08T15:00:00.000Z');
    // 🔴 弾かれた予約は 1 micro も積まれない。
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({ value: '0', reservedValue: '0.08' });
  });

  it('🔴 1 回の見積りが上限を超えるなら、その日の最初の 1 回でも通らず行も作らない', async () => {
    const outcome = await reserve(ctxA, { limitUsd: '0.010000' });

    expect(outcome.kind).toBe('LIMIT_REACHED');
    // 🔴 素の `INSERT ... ON CONFLICT` だと最初の 1 回だけ上限を無視して通る（`DO UPDATE ... WHERE`
    //    は衝突時にしか効かない）。行が無いことがその実装になっていないことの証拠である。
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toBeNull();
  });

  it('境界値: 上限ちょうどは通り、1 micro-USD 超えると止まる', async () => {
    const exact = await reserve(ctxA, { limitUsd: ESTIMATE_USD });
    expect(exact.kind).toBe('RESERVED');

    await admin.usageCounter.deleteMany({ where: { metric: 'AI_COST_USD' } });
    const overByOneMicro = await reserve(ctxA, { limitUsd: '0.039999' });
    expect(overByOneMicro.kind).toBe('LIMIT_REACHED');
  });

  it('🔴 実コスト（value）も判定に入る —— 補正済みの分を無視しない', async () => {
    const reserved = await reserve(ctxA);
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');
    // 実コストが見積りどおり出たとして補正する（reserved は 0 に戻り value が $0.04 になる）。
    await settleAiCost(ctxA, {
      handle: reserved.handle,
      attempts: [
        {
          modelId: SONNET,
          tokens: {
            inputTokens: ESTIMATE_INPUT_TOKENS,
            outputTokens: ESTIMATE_MAX_OUTPUT_TOKENS,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        },
      ],
      now: NOW,
    });

    await reserve(ctxA);
    const third = await reserve(ctxA);
    expect(third.kind).toBe('LIMIT_REACHED');
  });

  it('🔴 上限が 0 以下なら例外にする（「上限なし」を静かに作らない）', async () => {
    await expect(reserve(ctxA, { limitUsd: '0' })).rejects.toThrow(RangeError);
  });
});

describe('🔴 並行実行で上限を破らない（docs/03 §4.5 の競合状態）', () => {
  it('10 並列で予約しても、通るのは枠に収まる 2 件だけ', async () => {
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => reserve(ctxA)));

    const reserved = outcomes.filter((outcome) => outcome.kind === 'RESERVED');
    expect(reserved).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome.kind === 'LIMIT_REACHED')).toHaveLength(8);

    const counter = await readCounter(TENANT_A, PERIOD_KEY);
    expect(counter).toEqual({ value: '0', reservedValue: '0.08' });
    // 🔴 「予約の総和 ≤ 上限」が破れていないこと（この 1 行が本テストの核心）。
    expect(Number(counter?.reservedValue)).toBeLessThanOrEqual(Number(LIMIT_USD));
  });

  it('🔴 証は予約ごとに同じ内容でよいが、枠は 1 件につき 1 回だけ消費される', async () => {
    const outcomes = await Promise.all([reserve(ctxA), reserve(ctxA)]);
    for (const outcome of outcomes) {
      expect(outcome.kind).toBe('RESERVED');
    }
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({ value: '0', reservedValue: '0.08' });
  });
});

describe('🔴 補正（settle）', () => {
  it('予約を戻し、実コストを value に積む（1 文で同時に行う）', async () => {
    const reserved = await reserve(ctxA);
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');

    const settlement = await settleAiCost(ctxA, {
      handle: reserved.handle,
      attempts: [
        {
          modelId: SONNET,
          // $0.02 + 500 × $10/MTok = $0.005 → $0.025
          tokens: {
            inputTokens: 10_000,
            outputTokens: 500,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        },
      ],
      now: NOW,
    });

    expect(settlement.actualUsd).toBe('0.025000');
    expect(settlement.periodKey).toBe(PERIOD_KEY);
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({
      value: '0.025',
      reservedValue: '0',
    });
  });

  it('🔴 失敗した試行の原価も積む（呼んだ分は発生している。docs/05 §7.4）', async () => {
    const reserved = await reserve(ctxA);
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');

    // 3 試行（うち 2 回はスキーマ違反で出力が短い）。
    await settleAiCost(ctxA, {
      handle: reserved.handle,
      attempts: [
        { modelId: SONNET, tokens: { inputTokens: 10_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        { modelId: SONNET, tokens: { inputTokens: 10_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        { modelId: SONNET, tokens: { inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      ],
      now: NOW,
    });

    // ($0.02 + $0.001) × 2 + ($0.02 + $0.005) = $0.067
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({ value: '0.067', reservedValue: '0' });
  });

  it('🔴 実コストが見積りを超えても、その分は value に積まれる（次の予約が弾く）', async () => {
    const reserved = await reserve(ctxA);
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');
    await settleAiCost(ctxA, {
      handle: reserved.handle,
      attempts: [
        { modelId: SONNET, tokens: { inputTokens: 50_000, outputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      ],
      now: NOW,
    });

    // $0.10 + $0.02 = $0.12 > 上限 $0.10。以後の予約は通らない。
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({ value: '0.12', reservedValue: '0' });
    expect((await reserve(ctxA)).kind).toBe('LIMIT_REACHED');
  });

  it('🔴 予約残高は負にならない（二重に補正しても実体の無い枠を作らない）', async () => {
    const reserved = await reserve(ctxA);
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');
    const attempts = [
      { modelId: SONNET, tokens: { inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ];
    await settleAiCost(ctxA, { handle: reserved.handle, attempts, now: NOW });
    await settleAiCost(ctxA, { handle: reserved.handle, attempts, now: NOW });

    const counter = await readCounter(TENANT_A, PERIOD_KEY);
    expect(counter?.reservedValue).toBe('0');
    // 🔴 `value` は冪等ではない（呼んだ回数だけ積まれる）。だからこそ呼び出し元は
    //    `runRole` の手順 7 の 1 箇所に限る。ここではその性質を明示的に固定する。
    expect(counter?.value).toBe('0.05');
  });

  it('🔴 予約していない行を補正しようとしたら例外にする（0 件を成功に畳まない）', async () => {
    await expect(
      settleAiCost(ctxA, {
        handle: `v1:${PERIOD_KEY}:40000`,
        attempts: [],
        now: NOW,
      }),
    ).rejects.toThrow(/予約を補正できませんでした/);
  });

  it('🔴 壊れた証では補正しない（別の行を触らせない）', async () => {
    await expect(
      settleAiCost(ctxA, { handle: 'v1:not-a-date:40000', attempts: [], now: NOW }),
    ).rejects.toThrow(RangeError);
  });
});

describe('🔴 予約の TTL は暦日（docs/05 §7.12）', () => {
  it('補正されずに残った予約は、翌日の判定に影響しない（清掃ジョブが要らない）', async () => {
    // 当日の枠を予約だけして使い切る（`settle` が走らなかった状態 = 記録失敗・想定外例外）。
    await reserve(ctxA);
    await reserve(ctxA);
    expect((await reserve(ctxA)).kind).toBe('LIMIT_REACHED');

    // 🔴 JST の翌 0 時を過ぎると、判定が読むのは新しい行（reserved_value = 0）である。
    const nextDay = await reserve(ctxA, { now: JUST_AFTER_MIDNIGHT });
    expect(nextDay.kind).toBe('RESERVED');
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({ value: '0', reservedValue: '0.08' });
    expect(await readCounter(TENANT_A, NEXT_PERIOD_KEY)).toEqual({
      value: '0',
      reservedValue: '0.04',
    });
  });

  it('🔴 残留予約は「上限に厳しい側」にしか働かない（当日は枠が空かない）', async () => {
    await reserve(ctxA);
    await reserve(ctxA);
    // 当日中は解放しない —— 予約が残るのは「実際に使った額がどこにも記録されていない」
    // ときであり、戻すと上限が緩む（docs/05 §7.12-2）。
    expect((await reserve(ctxA)).kind).toBe('LIMIT_REACHED');
  });

  it('🔴 日をまたいだ呼び出しは、予約した日の行に補正される', async () => {
    const reserved = await reserve(ctxA, { now: LATE_TODAY });
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');
    expect(reserved.periodKey).toBe(PERIOD_KEY);

    // 応答が返ったのは日付が変わった後（JST 00:00:00）。
    const settlement = await settleAiCost(ctxA, {
      handle: reserved.handle,
      attempts: [
        { modelId: SONNET, tokens: { inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      ],
      now: JUST_AFTER_MIDNIGHT,
    });

    expect(settlement.periodKey).toBe(PERIOD_KEY);
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toEqual({ value: '0.025', reservedValue: '0' });
    // 🔴 翌日の行を作らない（作ると、昨日の予約が永久に残り、今日の枠が実コストで削られる）。
    expect(await readCounter(TENANT_A, NEXT_PERIOD_KEY)).toBeNull();
  });
});

describe('🔴 単価が引けないモデル（docs/05 §7.11 ⑤）', () => {
  it('予約の前に落ち、カウンタの行が 1 つも書かれない（原価だけが出ることはない）', async () => {
    await expect(reserve(ctxA, { modelId: 'claude-unregistered-9' })).rejects.toThrow(
      /単価が未登録/,
    );
    expect(await readCounter(TENANT_A, PERIOD_KEY)).toBeNull();
  });

  it('応答側のスナップショット ID（`-YYYYMMDD`）でも補正できる', async () => {
    const reserved = await reserve(ctxA);
    if (reserved.kind !== 'RESERVED') throw new Error('unreachable');
    const settlement = await settleAiCost(ctxA, {
      handle: reserved.handle,
      attempts: [
        {
          modelId: 'claude-sonnet-5-20260514',
          tokens: { inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      ],
      now: NOW,
    });
    expect(settlement.actualUsd).toBe('0.025000');
  });
});

describe('🔴 テナント境界（CLAUDE.md §3.1 / F-004 AC-1）', () => {
  it('あるテナントが上限に達しても、別のテナントは予約できる', async () => {
    await reserve(ctxA);
    await reserve(ctxA);
    expect((await reserve(ctxA)).kind).toBe('LIMIT_REACHED');

    expect((await reserve(ctxB)).kind).toBe('RESERVED');
    expect(await readCounter(TENANT_B, PERIOD_KEY)).toEqual({ value: '0', reservedValue: '0.04' });
  });

  it('読み取りも自テナントの行だけを見る', async () => {
    await reserve(ctxA);

    expect(await readAiDailyCost(ctxA, NOW)).toEqual({
      periodKey: PERIOD_KEY,
      usedUsd: '0.000000',
      reservedUsd: '0.040000',
      resetAt: RESET_AT,
    });
    // 🔴 B からは A の消費が 1 micro も見えない（RLS C2 + 明示述語の二重）。
    expect(await readAiDailyCost(ctxB, NOW)).toEqual({
      periodKey: PERIOD_KEY,
      usedUsd: '0.000000',
      reservedUsd: '0.000000',
      resetAt: RESET_AT,
    });
  });

  it('まだ 1 回も呼んでいない日は 0 を返す（欠測ではないので例外にしない）', async () => {
    expect(await readAiDailyCost(ctxA, NOW)).toEqual({
      periodKey: PERIOD_KEY,
      usedUsd: '0.000000',
      reservedUsd: '0.000000',
      resetAt: RESET_AT,
    });
  });
});
