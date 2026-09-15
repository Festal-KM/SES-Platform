// apps/worker/src/jobs/proposal-request-expire.ts
// 🔴 `proposal-request.expire`（毎日 03:20 JST。docs/05 §9.5 / `F-018` 処理⑤ / `CLAUDE.md` §4.2
//    `REQUESTED ──期限到来──> EXPIRED`）。T-08-07。
//
// ============================================================================
// 🔴 このジョブがやることは 1 つだけである
// ============================================================================
//   「期限を過ぎ、かつ未処理（`REQUESTED`）」の提案依頼を `EXPIRED` に確定する。本体は `packages/db` の
//   `expireProposalRequests`（遷移表の判定 + CAS + 監査）であり、**ワーカーは起動と配線だけ**を持つ
//   （`CLAUDE.md` §2.1「worker: 業務ロジックを持たない」）。
//
// 🔴 テナント横断のクエリを書かない: `runScheduled` → `fanOutToTenants`（`runtime.ts`）がテナントを列挙し、
//    本ハンドラは payload の `tenantId` から `systemTenantCtx` を組み立てて **1 テナント分**を処理する
//    （T-07-11 のパターン。母集団は `app_list_scheduler_tenants()` = `SANDBOX` / `ACTIVE`）。
// 🔴 冪等: 母集団が未処理条件で決まり、CAS が `state = 'REQUESTED'` を条件に含むため、再実行しても 2 度目は
//    0 件である（`attempts: 3` を許せる根拠。外部 API を呼ばない）。
// 🔴 `EXPIRED` は `DECLINED` / `WITHDRAWN_BY_HOST` と別の終端である（`F-018 AC-5`）。辞退や取り下げが直前に
//    確定していれば CAS が 0 件になり、上書きしない（docs/05 §15.3「状態を変えない」）。
import { expireProposalRequests, systemTenantCtx, type ExpireProposalRequestsOutcome } from '@ses/db';
import type { InternalJobName } from '@ses/connectors';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const PROPOSAL_REQUEST_EXPIRE_JOB = 'proposal-request.expire' satisfies InternalJobName;

/** 🔴 毎日 03:20 JST（docs/05 §9.5）。時刻の出所はここ 1 箇所。 */
export const PROPOSAL_REQUEST_EXPIRE_SCHEDULE = { cron: '20 3 * * *', timeZone: 'Asia/Tokyo' } as const;

export type ProposalRequestExpirePayload = { readonly tenantId: string };

export function parseProposalRequestExpirePayload(raw: unknown): ProposalRequestExpirePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(PROPOSAL_REQUEST_EXPIRE_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  // 🔴 分離キーは payload から来るが、それはスケジュール側（テナントのファンアウト）が確定させた値である
  //    （docs/05 §9.1「payload に tenantId を必ず含める」）。
  return { tenantId: requireUuid(PROPOSAL_REQUEST_EXPIRE_JOB, 'tenantId', record.tenantId) };
}

export type ProposalRequestExpireDeps = {
  /** 🔴 現在時刻の取得も注入する（期限の判定をテストで固定できるようにするため）。 */
  readonly now: () => Date;
  /** 1 回の実行で読む上限（省略時は `packages/db` の既定）。 */
  readonly expireScanLimit?: number;
};

export type ProposalRequestExpireOutcome = ExpireProposalRequestsOutcome;

export type ProposalRequestExpireHandler = (payload: unknown, jobId: string) => Promise<ProposalRequestExpireOutcome>;

export function createProposalRequestExpireHandler(deps: ProposalRequestExpireDeps): ProposalRequestExpireHandler {
  return async (payload, jobId) => {
    const job = parseProposalRequestExpirePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: PROPOSAL_REQUEST_EXPIRE_JOB, jobId });
    return expireProposalRequests(ctx, {
      now: deps.now(),
      ...(deps.expireScanLimit === undefined ? {} : { limit: deps.expireScanLimit }),
    });
  };
}
