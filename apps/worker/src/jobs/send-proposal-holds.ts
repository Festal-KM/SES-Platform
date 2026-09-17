// apps/worker/src/jobs/send-proposal-holds.ts
// 🔴 `send.hold-release`（docs/05 §9.4 / §10.4 / §12.6）の **`Proposal` 側**。T-09-06。
//
// `send-hold-release.ts` が `email_dispatches` 側と**同じ実行の中で**呼ぶ（別ジョブにしない）。ここに置くのは
// 「保留の理由ごとに、解消したかをどう判定するか」と「1 件を復帰させる手順」だけであり、枠（`headroom`）の配分は
// 呼び出し側が `EmailDispatch(HELD_PROVIDER_QUOTA)` と**古い順に混ぜて**行う（§8.3-Q ⑥）。
//
// ============================================================================
// 🔴 復帰の規律
// ============================================================================
//   - 🔴 **`GATE_STALE` は対象外**（§10.5。`listHeldProposalSends` がそもそも返さない）。人間が `S-021` / `S-022` から選ぶ。
//   - 復帰 = 保留列を NULL に戻して **同じ `attemptSeq` で再 enqueue**。試行番号は人間が採番した値をそのまま復元する
//     （`resolveProposalSendResumeOrigin`。ジョブは採番しない。§10.6）。
//   - 🔴 復帰したジョブは §10.2 の ①②③ を**最初から通る**。ここで「解消した」と判定するのは再 enqueue の可否であり、
//     送ってよいかの最終判定ではない（判定はジョブ側の 1 入口にしか無い）。
//   - 🔴 外部 API を呼ばない（deps に `send` の口が無い）。
import type { SendProposalJobQueue } from '@ses/connectors';
import {
  clearProposalSendHold,
  holdProposalSend,
  resolveProposalSendResumeOrigin,
  type HeldProposalSendRow,
  type SystemTenantCtx,
} from '@ses/db';
import type { SendHoldReasonKey } from '@ses/domain';

export type ProposalHoldReleaseDeps = {
  /** 🔴 `send.proposal` の enqueue 口（`jobId` は実装が組み立てる。`attempts` を渡す口は無い）。 */
  readonly enqueueSendProposal: SendProposalJobQueue['enqueue'];
  readonly now: () => Date;
};

/** 保留が解消したかを判定するための、この実行で 1 回だけ読んだ事実。 */
export type ProposalHoldFacts = {
  /** 送信元ドメインが検証済みか（`resolveVerifiedSendingDomain !== null`）。 */
  readonly domainVerified: boolean;
  /** テナントが実行可（`SANDBOX` / `ACTIVE`）か。`tenants` から読んだ値。 */
  readonly tenantExecutable: boolean;
  /** テナントの日次上限に余地があるか（`readEmailDailyCount < resolveTenantQuotas(...).emailDailyLimit`。T-12-12）。 */
  readonly dailyQuotaHasRoom: boolean;
};

/**
 * 🔴 `PROVIDER_QUOTA` 以外の保留が解消したか（`PROVIDER_QUOTA` は枠の配分で決めるためここでは扱わない）。
 *
 * - `DOMAIN_UNVERIFIED` … ドメインが検証済みになった
 * - `RATE_LIMIT` … 日次上限に余地が戻った（暦日が変わった / 上限が引き上げられた）
 * - `TENANT_SUSPENDED` … テナントが実行可に戻った
 * - `ESIGN_DISCONNECTED` / `AI_COST_LIMIT` … 🔴 契約書（Phase 3）の理由であり提案には立たない。立っていたら
 *   実装バグなので**触らない**（黙って復帰させない）
 * - `GATE_STALE` … 自動復帰しない（到達しないが、列挙の網羅のため `false`）
 */
export function isProposalHoldResolved(reasonKey: SendHoldReasonKey, facts: ProposalHoldFacts): boolean {
  switch (reasonKey) {
    case 'DOMAIN_UNVERIFIED':
      return facts.domainVerified;
    case 'RATE_LIMIT':
      return facts.dailyQuotaHasRoom;
    case 'TENANT_SUSPENDED':
      return facts.tenantExecutable;
    case 'PROVIDER_QUOTA':
    case 'GATE_STALE':
    case 'ESIGN_DISCONNECTED':
    case 'AI_COST_LIMIT':
      return false;
  }
}

export type ProposalHoldReleaseResult =
  /** 保留を解き、同じ `attemptSeq` で再 enqueue した。 */
  | 'RELEASED'
  /** CAS が 0 件（他の実行が処理済み / 別の理由で再保留）。正常系。 */
  | 'SKIPPED'
  /** 🔴 同じ `jobId` の `failed` 記録が残っていて enqueue が無視された。保留を元に戻した（次回も同じ結果になる。運用が失敗記録を消す）。 */
  | 'BLOCKED';

/**
 * 保留中の提案 1 件を復帰させる（docs/05 §9.4 の復帰手順の `Proposal` 版）。
 *
 * 手順: ①復帰する試行の由来を復元 → ②保留列を NULL に戻す CAS（0 件なら終了）→ ③同じ `attemptSeq` で再 enqueue
 * → ④enqueue が `failed` 記録に阻まれたら保留を**元に戻す**（「復帰させた」と数えない。積んだつもりで積まれていない
 * 状態を作らない）。
 */
export async function releaseProposalSendHold(
  ctx: SystemTenantCtx,
  deps: ProposalHoldReleaseDeps,
  row: HeldProposalSendRow,
): Promise<ProposalHoldReleaseResult> {
  const now = deps.now();
  const resume = await resolveProposalSendResumeOrigin(ctx, row.proposalId);
  if (!(await clearProposalSendHold(ctx, { proposalId: row.proposalId, reasonKey: row.reasonKey, now }))) {
    return 'SKIPPED';
  }
  const outcome = await deps.enqueueSendProposal({
    tenantId: ctx.tenantId,
    proposalId: row.proposalId,
    attemptSeq: resume.attemptSeq,
    requestedBy: resume.origin.kind === 'RESEND' ? resume.origin.requestedBy : null,
    enqueuedAt: now.toISOString(),
  });
  if (outcome === 'BLOCKED_BY_FAILED_JOB') {
    await holdProposalSend(ctx, { proposalId: row.proposalId, reasonKey: row.reasonKey, now });
    return 'BLOCKED';
  }
  return 'RELEASED';
}
