// apps/web/lib/proposals/resend.ts
// 送信失敗からの人手再送（docs/05 §6.5 #44 / §10.6 / §12.5 / `F-023 AC-1`〜`AC-3` / `S-022` / `CLAUDE.md` §3.4 / §4.2）。T-09-08。
//
// ============================================================================
// 🔴 ここが `SUBMIT_FAILED → APPROVED` を起こす**唯一の場所**である（所有者 `RESEND`）
// ============================================================================
//   `CLAUDE.md` §4.2「`SUBMIT_FAILED` からの復帰は人間の操作に限る」/ docs/05 §10.6「`SUBMIT_FAILED` から `APPROVED` への
//   遷移を呼ぶコードが `resend/route.ts` 以外に無い」。`tests/static/proposal-resend-human-only.test.ts` が、この遷移を
//   起こすコードが本ファイルと `app/api/(main)/proposals/[id]/resend/route.ts` 以外（特に `apps/worker/**`）に無いことを
//   AST で固定する。**再送を自動的に起動する仕組み・設定・ジョブは存在しない**（`F-023 AC-1` / docs/05 §6.8）。
//
// ============================================================================
// 🔴 手順（docs/05 §6.5「#44 と `S-022` の実装の決着」）
// ============================================================================
//   ⓪ `acknowledged !== true` → 400 `RESEND_NOT_ACKNOWLEDGED`（`F-023 AC-2`。行を読む前に落とす。状態に触れない）
//   ① `nextSendAttemptSeq`（採番。読むだけ。🔴 人間の文脈でしか呼べない = ジョブは採番しない）
//   ② **1 トランザクション**（`withTenant`）: 行を読む（C5。見えなければ 404）→ 3 段（`assertOwnedTransition`）→
//      `SUBMIT_FAILED → APPROVED` の CAS（`WHERE state = 'SUBMIT_FAILED'`。0 件なら現在の状態で 422 + 記録）→
//      `ProposalEvent(STATE, SUBMIT_FAILED → APPROVED, actorUserId = 人間, note = 'RESEND:<reason>')` →
//      `AuditLog(proposal.resend, USER, summary = { operation, attemptSeq, previousFailureKind, reasonLength, fromState, toState })`
//   ③ tx の後: `enqueueProposalSend`（#43 と共有の尾部。ドメイン未検証は 202 + `DOMAIN_UNVERIFIED` の保留 / 監査
//      `proposal.submit`(SUBMIT_REQUEST) / enqueue。`BLOCKED_BY_FAILED_JOB` は 409）
//
// 🔴 **`ProposalEvent.actorUserId` に人間を必ず書く**（T-09-06 の申し送り 2）—— `send.hold-release` が seq ≥ 2 の保留を
//    復帰させるとき、`resolveProposalSendResumeOrigin` はこの記録から `requestedBy` を復元する（無ければ復帰しない）。
// 🔴 `note` / `summary` に本文・宛先・単価・氏名を載せない（docs/05 §16.2）。`reason` は再送を指示した人間の自由入力であり
//    PII を含みうるため、`AuditLog.summary` には**文字数（`reasonLength`）だけ**を載せる（`F-023` 処理④「再送の指示者・
//    日時・理由を監査ログに記録する」は全文が残る `ProposalEvent.note` で満たす）。
// 🔴 3 段の断り方は #41 / #43 / #48 と同じ順序: ①遷移表に無い組（`SUBMIT_FAILED` 以外 → `APPROVED`）→ 422
//    `INVALID_STATE_TRANSITION` + `state.invalid_transition` の記録 ②所有者が `RESEND` でない組（`APPROVAL_PENDING → APPROVED`
//    = `APPROVE`）→ 422 `PROPOSAL_TRANSITION_RESERVED`（#44 から承認を迂回させない）③立場（`canResendProposal`）→ 403。
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5。見えなければ 404。取引先は `requireRole` で先に 403。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できるようにする）。
import {
  nextSendAttemptSeq,
  PROPOSAL_AUDIT_TARGET_TYPE,
  PROPOSAL_SEND_ENTITY_TYPE,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  InvalidStateTransitionError as DomainInvalidStateTransitionError,
  proposalMachine,
  proposalTransitionOwner,
  type ProposalState,
  type ProposalTransitionOwner,
} from '@ses/domain';
import {
  InternalError,
  NotFoundError,
  ProposalResendForbiddenError,
  ProposalTransitionReservedError,
  ResendNotAcknowledgedError,
} from '../api/errors';
import { rethrowWithInvalidTransitionAudit } from '../state/invalid-transition';
import { canResendProposal } from './policy';
import type { ResendProposalBody } from './schemas';
import { asHumanCtx, enqueueProposalSend, type ProposalSubmitDeps, type ProposalSubmitView } from './submit';

/** docs/05 §16.1 の `proposal.resend`（#44）。`S-041` の `PROPOSAL_SUBMIT` カテゴリが `proposal.submit` と並べて拾う。 */
export const PROPOSAL_AUDIT_ACTION_RESEND = 'proposal.resend';

/** `AuditLog.summary.operation`（#44）。 */
export const PROPOSAL_RESEND_OPERATION = 'RESEND';

/** `ProposalEvent.note` の印（`S-023` の履歴が「再送（理由）」として描く。T-09-09）。 */
export const PROPOSAL_RESEND_NOTE_PREFIX = 'RESEND:';

/**
 * 🔴 本経路が動かす遷移と、その所有者（`PROPOSAL_TRANSITION_OWNERS`。T-09-02）。
 *    `resend.test.ts` が `proposalTransitionOwner()` の実値と突き合わせて固定する —— 遷移表側で所有者を付け替えたら、
 *    ここが**実行時にも**ずれて 422 になり、静かに通り抜けない。
 */
export const PROPOSAL_RESEND_TRANSITION = {
  from: 'SUBMIT_FAILED',
  to: 'APPROVED',
  owner: 'RESEND',
} as const satisfies { from: ProposalState; to: ProposalState; owner: ProposalTransitionOwner };

/** #44 の依存（#43 と同じ形。enqueue 先・ドメイン判定は起動時 DI）。 */
export type ProposalResendDeps = ProposalSubmitDeps;

/** #44 の応答。#43 と同じ形（`{ attemptSeq, jobId, state }` の上位互換。`S-022` は 202 を受けて `S-021` へ遷移する）。 */
export type ProposalResendView = ProposalSubmitView;

type ProposalResendRow = {
  readonly id: string;
  readonly state: string;
  readonly lastFailureReason: string | null;
};

function requireKnownState(state: string): ProposalState {
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  if (!proposalMachine.isState(state)) throw new InternalError(`proposals.state が未知の値です（${state}）。`);
  return state;
}

/**
 * 🔴 「この経路がこの遷移を起こしてよいか」の 3 段（#41 / #48 と同じ順序。docs/05 §6.5「#48 の実装の決着」）:
 *   ① 遷移表に無い組 → `InvalidStateTransitionError`（呼び出し側が `rethrowWithInvalidTransitionAudit` で記録 + 422）
 *   ② 遷移表にはあるが所有者が `RESEND` でない組 → 422 `PROPOSAL_TRANSITION_RESERVED`（記録しない。遷移自体は存在する）
 *   ③ 立場（`canResendProposal`）→ 403
 */
function assertResendable(ctx: AuthenticatedTenantCtx, row: ProposalResendRow): { readonly from: ProposalState; readonly to: ProposalState } {
  const from = requireKnownState(row.state);
  const to = proposalMachine.transition(from, PROPOSAL_RESEND_TRANSITION.to);
  const owner = proposalTransitionOwner(from, to);
  if (owner === null) throw new InternalError(`所有者の無い遷移です（${from} -> ${to}）。`);
  if (owner !== PROPOSAL_RESEND_TRANSITION.owner) throw new ProposalTransitionReservedError(from, to, owner);
  if (!canResendProposal(ctx)) throw new ProposalResendForbiddenError();
  return { from, to };
}

/**
 * 人手再送（#44）。
 *
 * @returns 202 の本文（`ENQUEUED` = 送信ジョブを積んだ / `HELD` = 送信元ドメイン未検証の保留。どちらも `state: 'APPROVED'`）。
 */
export async function requestProposalResend(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  body: ResendProposalBody,
  deps: ProposalResendDeps,
): Promise<ProposalResendView> {
  // ⓪ 🔴 確認を経ていない要求は、行を読む前に落とす（`F-023 AC-2`）。
  if (body.acknowledged !== true) throw new ResendNotAcknowledgedError();

  const now = deps.now();
  const human = asHumanCtx(ctx);
  try {
    // ① 採番（読むだけ。`SUBMIT_FAILED` の行は少なくとも 1 つの試行を経ているので通常 2 以上）。
    const attemptSeq = await nextSendAttemptSeq(human, { entityType: PROPOSAL_SEND_ENTITY_TYPE, entityId: proposalId });

    // ② 1 トランザクション: 読む → 3 段 → CAS → 履歴 → 監査。
    const transitioned = await withTenant(ctx, async (db) => {
      const row = await db.proposal.findUnique({
        where: { id: proposalId },
        select: { id: true, state: true, lastFailureReason: true },
      });
      if (row === null) throw new NotFoundError();
      const { from, to } = assertResendable(ctx, row);

      const updated = await db.proposal.updateMany({
        where: { id: row.id, state: from },
        data: { state: to, updatedAt: now },
      });
      if (updated.count !== 1) {
        const current = await db.proposal.findUnique({ where: { id: row.id }, select: { state: true } });
        throw new DomainInvalidStateTransitionError(proposalMachine.entity, current?.state ?? from, to);
      }

      await db.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: row.id,
          kind: 'STATE',
          fromState: from,
          toState: to,
          // 🔴 人間。`resolveProposalSendResumeOrigin` が `requestedBy` を復元する出所（T-09-06 の申し送り 2）。
          actorUserId: ctx.userId,
          note: `${PROPOSAL_RESEND_NOTE_PREFIX}${body.reason}`,
          occurredAt: now,
        },
        select: { id: true },
      });
      await writeAuditLog(db, {
        action: PROPOSAL_AUDIT_ACTION_RESEND,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: PROPOSAL_AUDIT_TARGET_TYPE,
        targetId: row.id,
        // 🔴 本文・宛先・単価・氏名を載せない（docs/05 §16.2）。自由入力の `reason` は PII を含みうるため
        //    文字数だけを載せる（`F-023` 処理④は全文が残る `ProposalEvent.note` で満たす）。
        summary: {
          operation: PROPOSAL_RESEND_OPERATION,
          fromState: from,
          toState: to,
          attemptSeq,
          previousFailureKind: row.lastFailureReason,
          reasonLength: body.reason.length,
        },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });
      return { proposalId: row.id };
    });

    // ③ #43 と同じ尾部（ドメイン判定 → 保留 / 監査 / enqueue）。
    return await enqueueProposalSend(ctx, { proposalId: transitioned.proposalId, attemptSeq, now }, deps);
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(
      ctx,
      { targetType: PROPOSAL_AUDIT_TARGET_TYPE, targetId: proposalId, ipAddress: deps.meta.ipAddress },
      error,
    );
  }
}
