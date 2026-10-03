// apps/web/lib/proposals/send-failures.test.ts
// 🔴 **`S-022` の並びの向きと、件数バーの並び順の説明の整合**（`docs/04` §S-022 / `docs/05` §6.5 #44）。
//    SP-22 段④（提案まわり）の `code-reviewer` 指摘への対処。2026-10-03。
//
// ============================================================================
// 🔴 なぜこのテストが要るのか（**実害が検出されずに入っていた**）
// ============================================================================
// `sendFailures.orderNote` の値が「**最終更新の新しい順**に表示しています。」で、実装
// （`listProposals(…, { order: 'UPDATED_ASC' })` = `updated_at` 昇順 = **失敗が古い順**）と
// **逆向き**だった。`S-022` の目的は「`SUBMIT_FAILED` を放置させない」であり、
// 🔴 **最上行が「最も古い = 最も長く放置されていて最も危ない」**ことが唯一の読み方なので、
// 逆を書くと**優先順位の読みが反転する**。
//
// 🔴 **検出されなかった理由**: `send-failure-screen.render.test.tsx` のフィクスチャが
//    **同じ誤った文字列**を持っていた。すなわち「文字列を比較するだけの検査」は、
//    実装と文言が揃って誤っている状態を永久に緑で通す。
//
// 🔴 **したがってここでは文言の実体を比較しない。** 検査するのは次の 2 つの従属関係である。
//
//   ① `listProposalSendFailures` が `listProposals` に渡す並びが `SEND_FAILURE_LIST_ORDER` であること
//      （リテラルの二重管理が無い = 期待値に `'UPDATED_ASC'` を書き写さない）
//   ② その並びが**意味として「古い順」**であること —— `order` を忠実に反映するスタブを通し、
//      **最上行が最も古い失敗になる**ことで示す（文字列ではなく順序そのものを見る）
//
// 文言キー側の従属（`SEND_FAILURE_ORDER_NOTE_KEYS[SEND_FAILURE_LIST_ORDER]`）は
// `send-failure-rows.test.ts` の「並び順の説明」の describe が持つ。
//
// 🔴 `./list` は `@ses/db`（`withTenant`）経由で実 DB を触るのでスタブに差し替える（`CLAUDE.md` の
//    「外部 I/O はユニットテストでは必ずモックする」）。🔴 **ただし `order` を無視するスタブにはしない** ——
//    無視させると ② が「スタブが返した順」を見るだけの空振りになる。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposalListOrder } from './list';

const { listProposalsStub } = vi.hoisted(() => ({ listProposalsStub: vi.fn() }));
vi.mock('./list', () => ({ listProposals: listProposalsStub }));

const { listProposalSendFailures, SEND_FAILURE_LIST_LIMIT, SEND_FAILURE_LIST_ORDER } = await import('./send-failures');

/** 検証用の `AuthenticatedTenantCtx`（`listProposals` はスタブなので中身は使われない）。 */
const CTX = { tenantId: 'tenant-1' } as never;

const OLDEST = '01930000-0000-7000-8000-0000000000a1';
const MIDDLE = '01930000-0000-7000-8000-0000000000a2';
const NEWEST = '01930000-0000-7000-8000-0000000000a3';

/** `updated_at` の値（昇順 = 古い順に並べたときの期待）。 */
const UPDATED_AT: Readonly<Record<string, string>> = {
  [OLDEST]: '2026-09-10T00:00:00.000Z',
  [MIDDLE]: '2026-09-14T00:00:00.000Z',
  [NEWEST]: '2026-09-16T00:00:00.000Z',
};

function hostItem(id: string) {
  return {
    id,
    state: 'SUBMIT_FAILED' as const,
    recipient: { companyName: '架空エンド株式会社', email: 'to@example.co.jp' },
    project: { id: 'project-1', name: '基幹刷新' },
    engineerDisplayName: '佐藤 花子',
    offeredUnitPrice: 650000,
    lastFailureReason: 'PERMANENT:MessageRejected',
    updatedAt: UPDATED_AT[id],
    sendAttempts: [],
  };
}

/**
 * 🔴 **`order` を忠実に反映するスタブ**（Prisma の `orderBy` の立場）。
 *    `UPDATED_ASC` なら `updatedAt` 昇順、`UPDATED_DESC` なら降順で返す。
 *    これにより ② は「実装がどちら向きを要求したか」を**順序として**観測できる。
 */
function stubListProposals(): void {
  listProposalsStub.mockImplementation(
    (_ctx: unknown, _query: unknown, options?: { readonly order?: ProposalListOrder }) => {
      const order = options?.order ?? 'UPDATED_DESC';
      const items = [MIDDLE, NEWEST, OLDEST]
        .map(hostItem)
        .sort((a, b) =>
          order === 'UPDATED_ASC' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt),
        );
      return Promise.resolve({ audience: 'HOST' as const, items, byState: {}, requestsByState: {}, nextCursor: null });
    },
  );
}

beforeEach(() => {
  listProposalsStub.mockReset();
  stubListProposals();
});

describe('🔴 S-022 の並び（docs/05 §6.5 #44。2026-10-03 のレビュー指摘）', () => {
  it('① `listProposals` に渡す並びは `SEND_FAILURE_LIST_ORDER` そのもの（リテラルを 2 度書いていない）', async () => {
    await listProposalSendFailures(CTX);

    expect(listProposalsStub).toHaveBeenCalledTimes(1);
    const [, query, options] = listProposalsStub.mock.calls[0] as [unknown, Record<string, unknown>, { order?: string }];
    // 🔴 期待値に 'UPDATED_ASC' を書き写さない —— 定数と実引数が同一であることだけを見る。
    expect(options.order).toBe(SEND_FAILURE_LIST_ORDER);
    // 🔴 状態の条件は `SUBMIT_FAILED` の 1 つだけ（`F-024 AC-2` の 4 区分を混ぜない。母集団の明示にも使う）。
    expect(query.state).toEqual(['SUBMIT_FAILED']);
    expect(query.limit).toBe(SEND_FAILURE_LIST_LIMIT);
  });

  it('🔴 ② 並びは意味として「失敗が古い順」—— 最上行が最も古く、最終行が最も新しい', async () => {
    const view = await listProposalSendFailures(CTX);

    // 🔴 文字列（文言）ではなく**順序そのもの**を見る。`UPDATED_DESC` に変えればここが落ちる。
    expect(view.items.map((row) => row.id)).toEqual([OLDEST, MIDDLE, NEWEST]);
    expect(view.items[0]?.failedAt).toBe(UPDATED_AT[OLDEST]);
    expect(view.items.at(-1)?.failedAt).toBe(UPDATED_AT[NEWEST]);
  });

  it('🔴 ② の対照: スタブは `order` を無視していない（空振りでないことを示す）', async () => {
    // 逆向きを渡したときに逆順で返ることを、同じスタブで確かめる。
    const reversed = (await listProposalsStub(CTX, {}, { order: 'UPDATED_DESC' })) as {
      readonly items: readonly { readonly id: string }[];
    };
    expect(reversed.items.map((row) => row.id)).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it('🔴 ③ 写像は並びを変えない（`listProposalSendFailures` が独自に並べ替えていない）', async () => {
    // サーバが返した順をそのまま出す（`sendFailureRows` も入力順を保つ）。並びの責任を 2 箇所に持たない。
    listProposalsStub.mockImplementation(() =>
      Promise.resolve({
        audience: 'HOST' as const,
        items: [NEWEST, OLDEST, MIDDLE].map(hostItem),
        byState: {},
        requestsByState: {},
        nextCursor: null,
      }),
    );
    const view = await listProposalSendFailures(CTX);
    expect(view.items.map((row) => row.id)).toEqual([NEWEST, OLDEST, MIDDLE]);
  });
});
