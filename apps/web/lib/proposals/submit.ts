// apps/web/lib/proposals/submit.ts
// 提案の送信の要求（docs/05 §6.5 #43 / §10.2 / §10.4 / §10.6 / `F-022` / `S-021`）。T-09-06。
//
// ============================================================================
// 🔴 #43 は「送信ジョブを積む」だけであり、状態を動かさない
// ============================================================================
//   `APPROVED → SUBMITTING` の所有者は `SEND_JOB`（送信ジョブ）である（docs/05 §6.5「#48 の実装の決着」の表）。
//   #43 が行うのは ①行を読み `APPROVED` であることを確かめる ②送信元ドメインの判定（未検証は**保留**。`F-022 AC-7`）
//   ③`attemptSeq` の採番（`nextSendAttemptSeq`。🔴 人間の文脈でしか呼べない = ジョブは採番しない）④`send.proposal` の enqueue
//   ⑤`AuditLog(proposal.submit, USER)` —— までである。`SUBMITTING` に入れる CAS も `SendAttempt` の INSERT も外部呼び出しも
//   ここには無い（`castProposalToSubmitting` / `reserveSendAttempt` は `apps/web/**` から参照しない。
//   `tests/static/auth-db-callers.test.ts`）。
//
// ============================================================================
// 🔴 保留と 202（docs/05 §10.4 / `F-022 AC-7`）
// ============================================================================
//   送信元ドメインが未検証なら、`SUBMITTING` に入らず `sendHoldReasonKey='DOMAIN_UNVERIFIED'` を立てて **202** を返す
//   （状態は `APPROVED` のまま。`SUBMIT_FAILED` ではなく「設定未了」）。応答に DNS レコードを添える（`F-001 AC-4`）。
//   判定は `evaluateSendingDomain`（`requireVerifiedSendingDomain` / #14 と**同じ 1 実装**）。ガードの stage
//   （`verifiedSendingDomain` = 422）を使わないのは、**保留の記録を残して `send.hold-release` が検証完了後に自動復帰させる**
//   ため（E2E #9）。422 で止めると保留行が無く、誰も復帰させない。
//
// ============================================================================
// 🔴 既に試行がある `APPROVED` に #43 が来る場合（T-09-05 の申し送り 6）
// ============================================================================
//   `SUBMIT_FAILED → APPROVED`（#44）の後に seq N+1 のジョブが保留（`GATE_STALE` / ②-a の遅延超過）になったときの
//   復帰経路そのものである（docs/05 §10.5「人間が `S-021` / `S-022` から再度『送信』を選ぶ」）。`nextSendAttemptSeq` が
//   2 以上を返したら `RESEND`（`requestedBy = ctx.userId`）を payload に載せる。**409 にしない。** 同じ `attemptSeq` の重複
//   enqueue は BullMQ の `jobId` と、ジョブ側の ②-d（`readSendAttempt`）③④ が 1 回に収束させる。
//
// ============================================================================
// 🔴 #44（再送。T-09-08）との共有
// ============================================================================
//   `SUBMIT_FAILED → APPROVED` の CAS は `lib/proposals/resend.ts` だけが持つ（所有者 `RESEND`。docs/05 §10.6）。
//   CAS の後の「ドメイン判定 → 保留 / 監査 / enqueue」は #43 と同じ手順であり、`enqueueProposalSend` を共有する
//   （`F-023` 処理③「`F-022` の手順を再度実行する」）。**`send.proposal` の payload を組む場所は本ファイルの 1 つ**である。
//
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5。見えなければ 404。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できるようにする）。
import { sendProposalJobId, type SendProposalJob, type SendProposalJobQueue } from '@ses/connectors';
import {
  holdProposalSend,
  nextSendAttemptSeq,
  PROPOSAL_AUDIT_ACTION_SUBMIT,
  PROPOSAL_AUDIT_TARGET_TYPE,
  PROPOSAL_SEND_ENTITY_TYPE,
  PROPOSAL_SUBMIT_OPERATIONS,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type HumanTenantCtx,
} from '@ses/db';
import {
  InvalidStateTransitionError as DomainInvalidStateTransitionError,
  proposalMachine,
  proposalTransitionOwner,
  type ProposalState,
  type ProposalTransitionOwner,
  type SendHoldReasonKey,
} from '@ses/domain';
import {
  InternalError,
  NotFoundError,
  ProposalSubmitForbiddenError,
  SendJobBlockedError,
  type SendingDomainNotVerifiedDetail,
} from '../api/errors';
import type { SendingDomainResolver } from '../settings/sending-domains';
import { rethrowWithInvalidTransitionAudit } from '../state/invalid-transition';
import { canSubmitProposal } from './policy';
import type { ProposalActionMeta } from './service';

/**
 * 🔴 #43 が前提にする遷移と、その所有者（`SEND_JOB` = 送信ジョブ。#43 自身は動かさない）。
 *    `submit.test.ts` が `proposalTransitionOwner()` の実値と突き合わせて固定する —— 遷移表側で所有者を付け替えたら
 *    ここが**実行時にも**ずれて 422 になり、静かに通り抜けない。
 */
export const PROPOSAL_SUBMIT_TRANSITION = {
  from: 'APPROVED',
  to: 'SUBMITTING',
  owner: 'SEND_JOB',
} as const satisfies { from: ProposalState; to: ProposalState; owner: ProposalTransitionOwner };

export type ProposalSubmitDeps = {
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: () => Date;
  readonly meta: ProposalActionMeta;
  /** `send.proposal` の enqueue 口（起動時 DI。`requireSendProposalJobQueue`）。 */
  readonly queue: SendProposalJobQueue;
  /** 🔴 送信元ドメインの判定（`evaluateSendingDomain`。ガードと #14 と同じ 1 実装）。既定値を「常に通す」にしない。 */
  readonly resolveSendingDomain: SendingDomainResolver;
};

/**
 * #43 の応答（docs/05 §6.5 #43 `{ attemptSeq, jobId }` + T-09-06 の決着）。
 *
 * - `ENQUEUED` … `send.proposal` を積んだ。🔴 `state` は**行の現在の状態**（`APPROVED`）である。`SUBMITTING` に入れるのは
 *   送信ジョブだけであり、202 は「受け付けた」であって「送信中」でも「送信済み」でもない。確定は画面が読み直して取る
 * - `HELD` … 送信元ドメインが未検証。`SUBMITTING` に入らず `APPROVED` のまま保留（`sendHoldReasonKey`）。DNS レコードを添える
 */
export type ProposalSubmitView =
  | {
      readonly outcome: 'ENQUEUED';
      readonly attemptSeq: number;
      readonly jobId: string;
      readonly state: 'APPROVED';
      readonly sendHoldReasonKey: null;
    }
  | {
      readonly outcome: 'HELD';
      readonly attemptSeq: number;
      readonly jobId: null;
      readonly state: 'APPROVED';
      readonly sendHoldReasonKey: SendHoldReasonKey;
      readonly sendingDomain: SendingDomainNotVerifiedDetail;
    };

type ProposalStateRow = {
  readonly id: string;
  readonly state: string;
};

function requireKnownState(state: string): ProposalState {
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  if (!proposalMachine.isState(state)) throw new InternalError(`proposals.state が未知の値です（${state}）。`);
  return state;
}

/**
 * 🔴 「この経路が送信を要求してよいか」の 3 段（#41 / #48 と同じ順序。docs/05 §6.5「#48 の実装の決着」）:
 *   ① 遷移表に無い組（`APPROVED` 以外 → `SUBMITTING`）→ `InvalidStateTransitionError`（呼び出し側が記録 + 422）
 *   ② 遷移表にはあるが所有者が `SEND_JOB` でない組 → 422 `PROPOSAL_TRANSITION_RESERVED`（`APPROVED → SUBMITTING` は
 *      `SEND_JOB` なので到達しないが、遷移表側で付け替えられたときの検出として残す）
 *   ③ 立場（`canSubmitProposal`）→ 403
 */
function assertSubmittable(ctx: AuthenticatedTenantCtx, row: ProposalStateRow): void {
  const from = requireKnownState(row.state);
  const to = proposalMachine.transition(from, PROPOSAL_SUBMIT_TRANSITION.to);
  const owner = proposalTransitionOwner(from, to);
  if (owner !== PROPOSAL_SUBMIT_TRANSITION.owner) {
    throw new InternalError(`送信の遷移の所有者が想定と違います（${from} -> ${to}: ${String(owner)}）。`);
  }
  if (!canSubmitProposal(ctx)) throw new ProposalSubmitForbiddenError();
}

/**
 * 🔴 `HumanTenantCtx`（`job` を持たない）への狭め込み（T-09-05 申し送り 10）。`resolveTenantCtx` が返す
 *    `AuthenticatedTenantCtx` は `job` を持たないので、ここは型の表明だけである（ジョブ文脈は `apps/web` に存在しない）。
 *    #44（`lib/proposals/resend.ts`）も同じ 1 実装で狭める。
 */
export function asHumanCtx(ctx: AuthenticatedTenantCtx): HumanTenantCtx {
  if ('job' in ctx && ctx.job !== undefined) {
    throw new InternalError('送信の要求はジョブ文脈からは行えません（attempt_seq の採番は人間の操作だけ）。');
  }
  return ctx as HumanTenantCtx;
}

/**
 * 送信の要求（#43）。
 *
 * 手順:
 *   ① 行を読む（C5。見えなければ 404）→ `assertSubmittable`（422 / 403）
 *   ② 送信元ドメイン（`resolveSendingDomain`）。`UNVERIFIED` → `holdProposalSend('DOMAIN_UNVERIFIED')` + 監査 → 202（`HELD`）
 *   ③ `nextSendAttemptSeq`（採番。読むだけ）→ payload（`1` = `INITIAL` / `>= 2` = `RESEND` + `requestedBy`）
 *   ④ `AuditLog(proposal.submit, USER, operation = SUBMIT_REQUEST)`（🔴 enqueue の前。積めなかったときも「要求した」事実は残る）
 *   ⑤ enqueue（`BLOCKED_BY_FAILED_JOB` は 409 `SEND_JOB_BLOCKED`。202 を返しながら誰も送らない応答を作らない）
 * 🔴 **body を受け取らない**（ルートに `body` スキーマが無い。送信先・本文・添付は行の値だけが決める）。
 */
export async function requestProposalSubmission(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  deps: ProposalSubmitDeps,
): Promise<ProposalSubmitView> {
  const now = deps.now();
  try {
    const row = await withTenant(ctx, (db) =>
      db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, state: true } }),
    );
    if (row === null) throw new NotFoundError();
    assertSubmittable(ctx, row);
    const human = asHumanCtx(ctx);

    // ③ 採番（読むだけ。保留の応答にも載せる —— `send.hold-release` が復帰させる試行番号と同じ値）。
    const attemptSeq = await nextSendAttemptSeq(human, { entityType: PROPOSAL_SEND_ENTITY_TYPE, entityId: row.id });

    return await enqueueProposalSend(ctx, { proposalId: row.id, attemptSeq, now }, deps);
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(
      ctx,
      { targetType: PROPOSAL_AUDIT_TARGET_TYPE, targetId: proposalId, ipAddress: deps.meta.ipAddress },
      error,
    );
  }
}

export type EnqueueProposalSendInput = {
  /** 🔴 `APPROVED` であることを呼び出し側が確かめた行（#43 = 読んで 3 段 / #44 = `SUBMIT_FAILED → APPROVED` の CAS 直後）。 */
  readonly proposalId: string;
  /** 🔴 呼び出し側が `nextSendAttemptSeq`（人間の文脈）で採番した値。ここでは採番しない。 */
  readonly attemptSeq: number;
  readonly now: Date;
};

/**
 * 🔴 #43 / #44 が共有する尾部（T-09-08 で切り出した。`send.proposal` の payload を組む場所を 1 つに保つ）:
 *   ② 送信元ドメイン（`resolveSendingDomain`）。`UNVERIFIED` → `holdProposalSend('DOMAIN_UNVERIFIED')` + 監査 → `HELD`
 *   ④ `AuditLog(proposal.submit, USER, operation = SUBMIT_REQUEST)`（🔴 enqueue の前。積めなかったときも「要求した」事実は残る）
 *   ⑤ enqueue（`BLOCKED_BY_FAILED_JOB` は 409 `SEND_JOB_BLOCKED`。202 を返しながら誰も送らない応答を作らない）
 *
 * 🔴 状態は動かさない（`APPROVED` の行に保留の属性を立てるだけ）。`holdProposalSend` が `NOT_APPROVED` を返したら
 *    （読んでから CAS までに動いた）`InvalidStateTransitionError` —— 呼び出し側の `rethrowWithInvalidTransitionAudit` が記録する。
 * 🔴 `requestedBy` は `attemptSeq >= 2`（人間の再送）でだけ載せる（`1` = `INITIAL`。ジョブは値を写すだけ）。#44 は常に
 *    `>= 2` になる（`SUBMIT_FAILED` は少なくとも 1 つの試行を経ている）が、ここで前提にはしない。
 */
export async function enqueueProposalSend(
  ctx: AuthenticatedTenantCtx,
  input: EnqueueProposalSendInput,
  deps: Pick<ProposalSubmitDeps, 'meta' | 'queue' | 'resolveSendingDomain'>,
): Promise<ProposalSubmitView> {
  const { proposalId, attemptSeq, now } = input;

  // ② 送信元ドメイン（🔴 共通ドメインへ倒さない。未検証は保留であって失敗ではない）。
  const domain = await deps.resolveSendingDomain(ctx);
  if (domain.kind === 'UNVERIFIED') {
    const held = await holdProposalSend(ctx, { proposalId, reasonKey: 'DOMAIN_UNVERIFIED', now });
    if (held.kind === 'NOT_FOUND') throw new NotFoundError();
    if (held.kind === 'NOT_APPROVED') {
      throw new DomainInvalidStateTransitionError(proposalMachine.entity, held.state, PROPOSAL_SUBMIT_TRANSITION.to);
    }
    await writeSubmitRequestAudit(ctx, proposalId, deps.meta, {
      operation: PROPOSAL_SUBMIT_OPERATIONS.REQUEST,
      attemptSeq,
      outcome: 'HELD',
      holdReasonKey: 'DOMAIN_UNVERIFIED',
    });
    return {
      outcome: 'HELD',
      attemptSeq,
      jobId: null,
      state: 'APPROVED',
      sendHoldReasonKey: 'DOMAIN_UNVERIFIED',
      sendingDomain: domain.detail,
    };
  }

  const job: SendProposalJob = {
    tenantId: ctx.tenantId,
    proposalId,
    attemptSeq,
    // 🔴 `1` = `INITIAL`（`requested_by` NULL）。`>= 2` = 人間の再送（#44、または #44 を経た後の #43 の再要求）。ジョブは値を写すだけ。
    requestedBy: attemptSeq >= 2 ? ctx.userId : null,
    enqueuedAt: now.toISOString(),
  };
  await writeSubmitRequestAudit(ctx, proposalId, deps.meta, {
    operation: PROPOSAL_SUBMIT_OPERATIONS.REQUEST,
    attemptSeq,
    outcome: 'ENQUEUED',
    jobId: sendProposalJobId(job),
  });
  if ((await deps.queue.enqueue(job)) === 'BLOCKED_BY_FAILED_JOB') throw new SendJobBlockedError();

  return { outcome: 'ENQUEUED', attemptSeq, jobId: sendProposalJobId(job), state: 'APPROVED', sendHoldReasonKey: null };
}

/** 🔴 `summary` に本文・宛先・単価を載せない（docs/05 §16.2）。載せるのは操作・試行番号・結果だけ。 */
async function writeSubmitRequestAudit(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  meta: ProposalActionMeta,
  summary: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  await withTenant(ctx, (db) =>
    writeAuditLog(db, {
      action: PROPOSAL_AUDIT_ACTION_SUBMIT,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: proposalId,
      summary,
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    }),
  );
}
