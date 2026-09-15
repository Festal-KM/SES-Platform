// packages/db/src/proposal-request-expiry.ts
// 🔴 提案依頼の期限切れ（`REQUESTED` → `EXPIRED`。docs/05 §9.5 `proposal-request.expire` / §6.5
//    「#33 / #34 と `proposal-request.expire` の実装の決着」/ `F-018` 処理⑤ / `CLAUDE.md` §4.2）。T-08-07。
//
// ============================================================================
// 🔴 このファイルが持つもの
// ============================================================================
//   ① 母集団: **`state = 'REQUESTED' AND expires_at <= now`**（「期限を過ぎ、かつ未処理」。日付一致にしない。
//      docs/05 §9.1「起票条件」）。母集団を決めるのは呼び出し側の ctx が立てる RLS（テナント 1 件分）であり、
//      **テナント横断のクエリを書かない**（ファンアウトは `apps/worker/src/runtime.ts`）。
//   ② 遷移: `proposalRequestMachine.transition('REQUESTED', 'EXPIRED')` の 1 か所（状態をここに列挙しない）。
//      🔴 **CAS**（`WHERE state = 'REQUESTED'`）で確定する —— 読んでから書くまでの間に応諾・辞退・取り下げが
//      確定していれば 0 件になり、**何もしない**（終端を `EXPIRED` で上書きすることは DB レベルで起こり得ない。
//      `docs/05` §15.3「状態を変えない」）。
//   ③ 監査: `AuditLog(proposal_request.update, operation='EXPIRE', actorKind='SYSTEM')` を同じトランザクションで
//      書く（docs/05 §9.1「状態を変えるジョブは `AuditLog` を書く」）。🔴 `summary` に `engineer_id` / 依頼先 /
//      本文を載せない（運営者が横断検索する。`CLAUDE.md` §10.5）。
//
// 🔴 冪等: 2 度走っても 2 度目は母集団が 0 件（未処理条件）。`attempts: 3` を許せる根拠でもある。
// 🔴 `responded_at = now` / `responded_by = NULL`（#35 の決着の解釈「`REQUESTED` を離れた時刻と主体」。
//    期限切れの主体は system なので NULL）。
import { proposalRequestMachine } from '@ses/domain';
import { writeAuditLog } from './audit.js';
import type { SystemTenantCtx } from './context.js';
import { withTenant } from './with-tenant.js';

/**
 * docs/05 §16.1 の `*.update`。🔴 **`apps/web`（取り下げ / 応諾 / 辞退）と同じ action**であり、区別は
 * `summary.operation` だけに置く（独自 action を作らない —— `S-041` の操作種別フィルタは接尾辞一致）。
 * 発行（`proposal_request.create`）は `shared-candidate.ts` の `PROPOSAL_REQUEST_AUDIT_ACTION_CREATE`。
 */
export const PROPOSAL_REQUEST_AUDIT_ACTION_UPDATE = 'proposal_request.update';

/** `AuditLog.summary.operation`（期限切れ）。 */
export const PROPOSAL_REQUEST_EXPIRE_OPERATION = 'EXPIRE';

/** 1 回の実行で読む上限の既定（残りは翌日の実行が拾う。DB を舐め続けない）。 */
export const PROPOSAL_REQUEST_EXPIRE_DEFAULT_LIMIT = 500;

export type ExpireProposalRequestsInput = {
  /** 🔴 判定の基準時刻（呼び出し側が渡す。`packages/domain` と同じ規律で `new Date()` をここで呼ばない）。 */
  readonly now: Date;
  readonly limit?: number;
};

export type ExpireProposalRequestsOutcome = {
  /** 母集団として読んだ行数（`limit` で切った後）。 */
  readonly scanned: number;
  /** 🔴 実際に `EXPIRED` へ確定した行数（CAS が 0 件だったものは含まない）。 */
  readonly expired: number;
};

/**
 * 🔴 期限を過ぎた `REQUESTED` を `EXPIRED` に確定する（ジョブ文脈。1 テナント分）。
 *
 * @param ctx `systemTenantCtx`（ホスト相当。`proposal_requests` の C5 はホストに全行を見せる）。
 */
export async function expireProposalRequests(
  ctx: SystemTenantCtx,
  input: ExpireProposalRequestsInput,
): Promise<ExpireProposalRequestsOutcome> {
  const limit = input.limit ?? PROPOSAL_REQUEST_EXPIRE_DEFAULT_LIMIT;
  return withTenant(ctx, async (db) => {
    // 🔴 母集団（未処理条件）。`tenant_id` は書かない（RLS + Prisma 拡張が決める）。
    const rows = await db.proposalRequest.findMany({
      where: { state: 'REQUESTED', expiresAt: { lte: input.now } },
      select: { id: true, state: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    let expired = 0;
    for (const row of rows) {
      if (!proposalRequestMachine.isState(row.state)) continue; // DB の CHECK が保証する（到達しない）
      // 🔴 遷移表の判定はここ 1 か所（`REQUESTED` 以外を読むことは無いが、判定を省かない）。
      const to = proposalRequestMachine.transition('REQUESTED', 'EXPIRED');
      const updated = await db.proposalRequest.updateMany({
        where: { id: row.id, state: 'REQUESTED' },
        data: { state: to, respondedAt: input.now, respondedBy: null },
      });
      // 🔴 0 件 = 読んでから今までに別の遷移が確定した。上書きしない・記録もしない（起きなかった操作）。
      if (updated.count !== 1) continue;

      await writeAuditLog(db, {
        action: PROPOSAL_REQUEST_AUDIT_ACTION_UPDATE,
        actorKind: 'SYSTEM',
        actorId: null,
        targetType: 'ProposalRequest',
        targetId: row.id,
        summary: {
          operation: PROPOSAL_REQUEST_EXPIRE_OPERATION,
          fromState: 'REQUESTED',
          toState: to,
          // 🔴 どのジョブが書いたか（docs/05 §9.2 `JobIdentity`）。値は件数・ID の類だけ。
          jobQueue: ctx.job.queue,
          jobId: ctx.job.jobId,
        },
        ipAddress: null,
        deviceKind: ctx.deviceKind,
      });
      expired += 1;
    }

    return { scanned: rows.length, expired };
  });
}
