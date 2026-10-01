// apps/web/lib/home/blocks.transactions.test.ts
// 🔴 **ホームが 1 リクエストに開くトランザクションの本数を固定する**（T-22-09 受け入れ基準 2 /
//    docs/05 §6.11.1「平常時に増えるトランザクションは Phase 1 で +0 本」）。
//
// ============================================================================
// 🔴 なぜこれを機械で固定するのか
// ============================================================================
// ホームは**60 秒ごとに読み直される唯一の画面**である。ここに読み取りを 1 本足すと、
// 全利用者 × 1 分ごとに 1 本増える（`CLAUDE.md` §7 の p95 に直接効く）。
// `SummaryStrip`（件数 4 種）と `操作` 列の不能条件 ④（送信ドメイン）は
// **`readActionQueueWithSummary` の `withTenant` に相乗りしている**ので +0 本であり、
// それを「コメントに書いた」だけで終わらせない。
//
// 🔴 **作法は `tests/isolation/shell-header.test.ts` ⑤ と同じ**（`@ses/db` の
//    「1 トランザクションを開く関数」の呼び出し回数を数える）。ただし本体は Testcontainers を
//    要しないので、**ユニットテストとして毎回 CI で回る側**に置いた ——
//    `withTenant` の本体は `runInTenantTransaction(...)` 1 回だけであり、
//    **呼び出し 1 回 = トランザクション 1 本**である。
// ⚠️ 申し送り（F8）: 数えているのは `withTenant` だけである。Phase 2 で `withHostTenant` / `withPartnerScope` を
//    ホームが使うようになっても、その本数は**ここでは数えられず取り落とされる**。そのときは両関数もモックして
//    `CALLS.counts` に足し、合計を主張すること。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedTenantCtx } from '@ses/db';

/** 🔴 `vi.mock` の工場は静的 import の評価時に走るので `vi.hoisted` で宣言する。 */
const { CALLS, FAKE_DB } = vi.hoisted(() => {
  const counts = { withTenant: 0 };
  const queries: string[] = [];
  const count = (model: string) => async (args?: { readonly where?: unknown }) => {
    queries.push(`${model}.count:${JSON.stringify(args?.where ?? null)}`);
    return 0;
  };
  return {
    CALLS: { counts, queries },
    FAKE_DB: {
      project: { count: count('project') },
      engineer: { count: count('engineer') },
      proposal: { count: count('proposal'), findMany: async () => [] },
      engineerShare: { count: count('engineerShare') },
      tenantSendingDomain: { count: count('tenantSendingDomain') },
      proposalRequest: { findMany: async () => [] },
      skillSheet: { findMany: async () => [] },
    },
  };
});

vi.mock('@ses/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ses/db')>();
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T> => {
      CALLS.counts.withTenant += 1;
      return fn(FAKE_DB);
    },
  };
});

const { readHomeBlocks } = await import('./blocks');

function ctxOf(partnerCompanyId: string | null): AuthenticatedTenantCtx {
  return {
    tenantId: 't1',
    partnerCompanyId,
    userId: 'u1',
    role: partnerCompanyId === null ? 'SALES' : 'PARTNER_SALES',
    lifecycleState: 'ACTIVE',
    partnerSuspendedAt: null,
    deviceKind: 'desktop',
  } as unknown as AuthenticatedTenantCtx;
}

beforeEach(() => {
  CALLS.counts.withTenant = 0;
  CALLS.queries.length = 0;
});

describe('🔴 ホームが開くトランザクションの本数（docs/05 §6.11.1 / `./blocks.ts` 冒頭の表）', () => {
  it('ホスト所属: 2 本（隔離の周知 1 + 要対応キュー 1。`SUMMARY` は +0 本）', async () => {
    await readHomeBlocks(ctxOf(null), { sendingDomainVerificationRequired: true });
    expect(CALLS.counts.withTenant).toBe(2);
  });

  it('取引先所属: 2 本（同じ）', async () => {
    await readHomeBlocks(ctxOf('p1'), { sendingDomainVerificationRequired: true });
    expect(CALLS.counts.withTenant).toBe(2);
  });

  it('🔴 件数の読み取りはキューと同じトランザクションの中で起きている（`withTenant` が 2 本のまま）', async () => {
    await readHomeBlocks(ctxOf(null), { sendingDomainVerificationRequired: true });
    // ホストは 3 件数（案件 / 人材 / 進行中の提案）+ 送信ドメインの事実。
    expect(CALLS.queries.filter((query) => query.endsWith(':null'))).toEqual([
      'project.count:null',
      'engineer.count:null',
    ]);
    expect(CALLS.queries.some((query) => query.startsWith('tenantSendingDomain.count'))).toBe(true);
    expect(CALLS.counts.withTenant).toBe(2);
  });

  it('🔴 取引先は `engineer_shares` を 1 本増やさずに数える（同じトランザクション内）', async () => {
    await readHomeBlocks(ctxOf('p1'), { sendingDomainVerificationRequired: true });
    expect(CALLS.queries.some((query) => query.startsWith('engineerShare.count'))).toBe(true);
    // 🔴 取引先は送信ドメインを読まない（C2 HOST_ONLY。再送・送信の工程を持たない）。
    expect(CALLS.queries.some((query) => query.startsWith('tenantSendingDomain.count'))).toBe(false);
    expect(CALLS.counts.withTenant).toBe(2);
  });

  it('🔴 検証が要らない環境では送信ドメインを読まない（クエリ 1 本を節約する）', async () => {
    await readHomeBlocks(ctxOf(null), { sendingDomainVerificationRequired: false });
    expect(CALLS.queries.some((query) => query.startsWith('tenantSendingDomain.count'))).toBe(false);
    expect(CALLS.counts.withTenant).toBe(2);
  });

  it('🔴 `SUMMARY` は 0 件でも必ず返る（`items` を空配列にする分岐が無い）', async () => {
    const blocks = await readHomeBlocks(ctxOf(null), { sendingDomainVerificationRequired: true });
    const summary = blocks.find((block) => block.kind === 'SUMMARY');
    expect(summary).toBeDefined();
    expect(summary?.kind === 'SUMMARY' ? summary.items.length : 0).toBe(3);
    expect(summary?.kind === 'SUMMARY' ? summary.items.every((item) => item.count === 0) : false).toBe(true);
  });

  it('🔴 要対応キューも 0 件でも必ず返る（隔離の周知は 0 件なら出ない）', async () => {
    const blocks = await readHomeBlocks(ctxOf(null), { sendingDomainVerificationRequired: true });
    expect(blocks.map((block) => block.kind)).toEqual(['SUMMARY', 'ACTION_QUEUE']);
  });
});
