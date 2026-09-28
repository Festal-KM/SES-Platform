// apps/web/lib/shell/proposal-request-due.ts
// サイドバーの「③ 提案依頼（`S-017`）」に添える**期限バッジ**の材料
// （docs/04 §3.1 のサイドバーの表・取引先列「提案依頼（`S-017`）※期限バッジ付き」）。T-12-21。
//
// ============================================================================
// 🔴 なぜ「期限」で、「件数」ではないのか
// ============================================================================
// 🔴 **件数を出さない。** 取引先に見えるのは自社宛の依頼だけだが、外枠に件数を出すと
//    「他社にも同じ案件の依頼が出ているのか」を推測する材料になりうる（`CLAUDE.md` §3.1 の
//    🔴「パートナー同士が相互に参照できる経路を 1 つも作らない」/ `F-004 AC-4` の
//    「件数バッジ・並び順の変化・間接的な示唆も作らない」）。docs/04 §3.1 が**期限**バッジと
//    書いているのはこの理由である。返す値も**最も近い 1 件の期限だけ**にしてある
//    （個数を数えない・返さない。型の上で件数を持たない）。
// 🔴 取引先が気づかないと `EXPIRED` で商談機会が消える（`F-018`）。バッジは「期限が近い依頼が
//    ある」ことだけを伝え、内訳は `S-017` で見る。
//
// ============================================================================
// 🔴 境界
// ============================================================================
// 🔴 母集団は RLS が決める（`proposal_requests` は C5 PARTY）。`where` に `tenantId` /
//    `partnerCompanyId` を書かない（`lib/home/action-queue-read.ts` と同じ規律）。ここが書くのは
//    業務上の絞り込み（`state = 'REQUESTED'` = まだ返答していないもの）だけである。
// 🔴 監査ログを書かない（一覧の取得は `BR-27` の対象ではない。`S-017` / `S-019` と同じ線引き）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';

/** 最も近い返答期限。依頼が無ければ `null`（バッジを描かない）。 */
export type ProposalRequestDue = {
  /** ISO 8601。表示は `lib/proposal-requests/remaining.ts` の `formatRemaining` が 1 実装で行う。 */
  readonly expiresAtIso: string;
};

/**
 * 未返答（`REQUESTED`）の提案依頼のうち、**最も近い返答期限 1 件**を読む。
 *
 * 🔴 `findFirst` + `orderBy` であり `count` を使わない —— 件数を取得しない（上の 🔴）。
 * 🔴 期限を過ぎた行も返す（`EXPIRED` への確定はジョブが行うため、それまでは「期限を過ぎました」を
 *    出す。`formatRemaining` が同じ判断をしている）。
 */
export async function readProposalRequestDue(ctx: AuthenticatedTenantCtx): Promise<ProposalRequestDue | null> {
  return withTenant(ctx, async (db) => {
    const row = await db.proposalRequest.findFirst({
      where: { state: 'REQUESTED' },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { expiresAt: true },
    });
    return row === null ? null : { expiresAtIso: row.expiresAt.toISOString() };
  });
}
