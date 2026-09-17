// packages/db/src/proposal-send.ts
// 🔴 `send.proposal`（docs/05 §10.2）が `proposals` を**読む・保留する・確定する**ための経路。T-09-06。
//
// ============================================================================
// 🔴 この 1 ファイルが持つもの（§10.2 の ①②⑥ と §10.4 / §9.4 の DB 側）
// ============================================================================
//   - `readProposalForSend` … ①②の判定材料（状態 / 提案先 / 本文 / 添付の参照 / 凍結の有無 / テナント状態）
//   - `holdProposalSend` / `clearProposalSendHold` … 🔴 保留は**状態ではなく属性**（`sendHoldReasonKey` / `sendHoldSince`。
//     `CLAUDE.md` §4.2 に状態を足さない）。`WHERE state = 'APPROVED'` の CAS で書く（`SUBMITTING` 以降の行に保留を書かない）
//   - `listHeldProposalSends` … `send.hold-release` の走査（🔴 `GATE_STALE` を含まない = 自動復帰の対象外。§10.5）
//   - `resolveProposalSendResumeOrigin` … 復帰する試行の由来（`INITIAL` / `RESEND`）を**人間が採番した値のまま**復元する
//   - `settleProposalSubmission` … ⑥ **`SendAttempt` の確定と `SUBMITTING → SUBMITTED / SUBMIT_FAILED` を 1 tx で**
//   - `settleStalledProposalSubmissions` … 🔴 T-09-07。⑥ に到達できずに `SUBMITTING` のまま閾値を超えた行を
//     `SendAttempt.UNKNOWN` + `SUBMIT_FAILED(UNKNOWN:SETTLE_TIMEOUT)`（予約があった = 届いた可能性）または
//     `SUBMIT_FAILED(SETTLE_TIMEOUT:UNSENT)`（予約が無い = 外部を呼んでいない）に**確定させるだけ**（外部を呼ばない。
//     `APPROVED` に戻さない。docs/05 §10.6「T-09-07 の実装の決着」）。`send.settle-unknown` だけが呼ぶ
//
// 🔴 ③ の CAS（`castProposalToSubmitting`）と ④ の予約（`reserveSendAttempt`）は既存の関数を呼ぶ。ここに書き直さない。
// 🔴 分離キーは ctx からそのまま取る（`CLAUDE.md` §3.1）。母集団は RLS（`proposals` C5）が決める。ジョブ文脈は常にホスト相当。
import { Prisma } from '@prisma/client';
import {
  AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS,
  isSendHoldReasonKey,
  proposalMachine,
  tenantMachine,
  type ProposalState,
  type SendAttemptToken,
  type SendHoldReasonKey,
  type TenantLifecycleState,
} from '@ses/domain';
import { writeAuditLog } from './audit.js';
import type { AuthenticatedTenantCtx, SystemTenantCtx } from './context.js';
import {
  nextSendAttemptSeqInTx,
  SendAttemptOriginError,
  settleSendAttemptInTx,
  settleStalledSendAttemptsInTx,
  type SendAttemptOrigin,
  type SendAttemptSettlement,
  type SendAttemptSettlementOutcome,
} from './send.js';
import { runInTenantTransaction } from './with-tenant.js';

/** docs/05 §16.1 の `proposal.submit`。#43（`USER` = 要求）と送信ジョブの ⑥（`SYSTEM` = 確定）が**同じ action** で 2 行を残す。 */
export const PROPOSAL_AUDIT_ACTION_SUBMIT = 'proposal.submit';

/** `AuditLog.summary.operation`（`proposal.submit` の行の区別。`S-041` の `PROPOSAL_SUBMIT` はどちらも拾う）。 */
export const PROPOSAL_SUBMIT_OPERATIONS = {
  /** #43 / #44 が enqueue した（`USER`）。 */
  REQUEST: 'SUBMIT_REQUEST',
  /** 送信ジョブの ⑥（`SYSTEM`）。 */
  SETTLE: 'SUBMIT_SETTLE',
} as const;

/** 送信対象の `SendAttempt.entity_type`。 */
export const PROPOSAL_SEND_ENTITY_TYPE = 'PROPOSAL' as const;

/**
 * 🔴 送信ジョブの ⑥ が `SUBMITTING → SUBMIT_FAILED` の `ProposalEvent.note` に残す印（`SEND_FAILURE:<failureKind>`）。
 *    `S-023` の履歴（T-09-09）はこの接頭辞で「送信失敗（種別）」を描き、#44 の `RESEND:<理由>` と対にする。
 *    接頭辞の出所はこの定数だけである（読み手が文字列を書き写さない）。
 */
export const PROPOSAL_SEND_FAILURE_NOTE_PREFIX = 'SEND_FAILURE:' as const;

// 🔴 遷移（`CLAUDE.md` §4.2 の遷移表 1 つが決める。存在しない組はここでコンパイル / 実行時に落ちる）。
const SETTLE_FROM = 'SUBMITTING' as const;
const SETTLE_SUCCESS_TO = proposalMachine.transition(SETTLE_FROM, 'SUBMITTED');
const SETTLE_FAILURE_TO = proposalMachine.transition(SETTLE_FROM, 'SUBMIT_FAILED');

type IdRow = { readonly id: string };

// ============================================================================
// ①② の判定材料
// ============================================================================

export type ProposalSendAttachmentRef = {
  /** `EngineerSnapshot.skillSheetId`（凍結時点で `CLEAN` だった版。#37 でも `CLEAN` 以外は差し替えられない）。 */
  readonly skillSheetId: string;
};

/** `send.proposal` の事前判定・遅延判定が読む 1 件（列を選んで写す。`row` を spread しない）。 */
export type ProposalForSend = {
  readonly id: string;
  readonly state: ProposalState;
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
  readonly subject: string | null;
  readonly body: string | null;
  readonly sendHoldReasonKey: SendHoldReasonKey | null;
  readonly sendHoldSince: Date | null;
  /** 凍結（`EngineerSnapshot`）が存在するか（②-c「参照先が消えていないか」）。 */
  readonly snapshotPresent: boolean;
  readonly attachment: ProposalSendAttachmentRef | null;
  /** 🔴 `tenants` から読んだ現在の状態（①-a）。`ctx.lifecycleState`（常に `'ACTIVE'` 固定）を使わない。 */
  readonly tenantLifecycleState: TenantLifecycleState;
};

function requireProposalState(value: string): ProposalState {
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  if (!proposalMachine.isState(value)) throw new RangeError('proposals.state が未知の値です（docs/05 §3.6）。');
  return value;
}

function holdReasonOf(value: string | null): SendHoldReasonKey | null {
  if (value === null) return null;
  if (!isSendHoldReasonKey(value)) throw new RangeError('proposals.send_hold_reason_key が未知の値です（docs/05 §10.4）。');
  return value;
}

/**
 * ①②の判定材料を 1 トランザクションで読む。見えなければ `null`（RLS の C5 で 0 件 = 境界外 / 不存在。区別しない）。
 *
 * 🔴 テナント状態は **`tenants` から読む**（`gate-run.ts` の自動承認と同じ `select`）。`SystemTenantCtx.lifecycleState` は
 *    常に `'ACTIVE'` 固定であり、ctx の値で判定すると停止中テナントでも送信できてしまう（T-09-04 のレビュー申し送り）。
 *    行が読めない（起こり得ない）ときは fail-closed に `SUSPENDED` とみなす。
 */
export async function readProposalForSend(ctx: SystemTenantCtx, proposalId: string): Promise<ProposalForSend | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const row = await tx.proposal.findUnique({
        where: { id: proposalId },
        select: {
          id: true,
          state: true,
          recipientCompanyName: true,
          recipientEmail: true,
          subject: true,
          body: true,
          sendHoldReasonKey: true,
          sendHoldSince: true,
          engineerSnapshot: { select: { skillSheetId: true } },
        },
      });
      if (row === null) return null;
      const tenant = await tx.tenant.findFirst({ select: { lifecycleState: true } });
      const rawLifecycleState: unknown = tenant?.lifecycleState;
      const tenantLifecycleState: TenantLifecycleState = tenantMachine.isState(rawLifecycleState)
        ? rawLifecycleState
        : 'SUSPENDED';
      return {
        id: row.id,
        state: requireProposalState(row.state),
        recipientCompanyName: row.recipientCompanyName,
        recipientEmail: row.recipientEmail,
        subject: row.subject,
        body: row.body,
        sendHoldReasonKey: holdReasonOf(row.sendHoldReasonKey),
        sendHoldSince: row.sendHoldSince,
        snapshotPresent: row.engineerSnapshot !== null,
        attachment:
          row.engineerSnapshot === null || row.engineerSnapshot.skillSheetId === null
            ? null
            : { skillSheetId: row.engineerSnapshot.skillSheetId },
        tenantLifecycleState,
      };
    },
  );
}

// ============================================================================
// 保留（docs/05 §10.4。状態ではなく属性）
// ============================================================================

export type HoldProposalSendInput = {
  readonly proposalId: string;
  readonly reasonKey: SendHoldReasonKey;
  /** 🔴 現在時刻は呼び出し側から渡す。 */
  readonly now: Date;
};

/**
 * 保留の帰結。
 * - `HELD` … `APPROVED` の行に理由を立てた（同じ理由が既に立っていれば `sendHoldSince` は**据え置き**。古い順の配分を乱さない）
 * - `NOT_APPROVED` … `APPROVED` ではない（多重実行 / 送信済み）。保留を書かない
 * - `NOT_FOUND` … 行が見えない
 */
export type HoldProposalSendOutcome =
  | { readonly kind: 'HELD'; readonly since: Date }
  | { readonly kind: 'NOT_APPROVED'; readonly state: string }
  | { readonly kind: 'NOT_FOUND' };

/**
 * 🔴 `APPROVED` の提案に保留を立てる（`WHERE state = 'APPROVED'` の CAS）。`SUBMITTING` 以降の行には**書かない**
 *    （保留は「まだ 1 通も送っていない」状態の属性であり、送信中・送信後の行に立つと A-005 の「送信保留」が汚れる）。
 *
 * 呼び出し元は 2 つ: 送信ジョブの ①②（`SystemTenantCtx`）と、#43 のドメイン未検証（`F-022 AC-7`。人間の文脈）。
 * どちらも `APPROVED` の行に対してだけ書く。
 */
export async function holdProposalSend(
  ctx: AuthenticatedTenantCtx,
  input: HoldProposalSendInput,
): Promise<HoldProposalSendOutcome> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<HoldProposalSendOutcome> => {
      const updated = await tx.$queryRaw<Array<{ readonly id: string; readonly send_hold_since: Date }>>(Prisma.sql`
        UPDATE proposals
           SET send_hold_reason_key = ${input.reasonKey},
               send_hold_since = CASE
                 WHEN send_hold_reason_key = ${input.reasonKey} AND send_hold_since IS NOT NULL THEN send_hold_since
                 ELSE ${input.now}::timestamptz
               END,
               updated_at = ${input.now}::timestamptz
         WHERE id = ${input.proposalId}::uuid
           AND state = 'APPROVED'
        RETURNING id::text AS id, send_hold_since`);
      const row = updated[0];
      if (row !== undefined) return { kind: 'HELD', since: row.send_hold_since };
      const current = await tx.proposal.findUnique({ where: { id: input.proposalId }, select: { state: true } });
      if (current === null) return { kind: 'NOT_FOUND' };
      return { kind: 'NOT_APPROVED', state: current.state };
    },
  );
}

/**
 * 保留を解く（`send.hold-release` の CAS。docs/05 §9.4）。
 *
 * 🔴 `WHERE state = 'APPROVED' AND send_hold_reason_key = $reason` —— 理由が変わっていたら 0 件（他の実行が処理済み /
 *    別の理由で再保留された）。0 件は正常系であり、呼び出し側は**再 enqueue しない**。
 */
export async function clearProposalSendHold(
  ctx: SystemTenantCtx,
  input: { readonly proposalId: string; readonly reasonKey: SendHoldReasonKey; readonly now: Date },
): Promise<boolean> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE proposals
           SET send_hold_reason_key = NULL,
               send_hold_since = NULL,
               updated_at = ${input.now}::timestamptz
         WHERE id = ${input.proposalId}::uuid
           AND state = 'APPROVED'
           AND send_hold_reason_key = ${input.reasonKey}
        RETURNING id::text AS id`);
      return updated[0] !== undefined;
    },
  );
}

/** `send.hold-release` が走査する保留中の提案 1 件。 */
export type HeldProposalSendRow = {
  readonly proposalId: string;
  readonly reasonKey: SendHoldReasonKey;
  /** 🔴 配分の順序（古い順）。`EmailDispatch.heldAt` と突き合わせる。 */
  readonly since: Date;
};

/**
 * 🔴 自動復帰の対象（`APPROVED` かつ `sendHoldReasonKey` が `AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS` のいずれか）を
 *    `sendHoldSince` の古い順に返す。**`GATE_STALE` は返さない**（§10.5。人間が `S-021` / `S-022` から選ぶまで待つ）。
 *    母集団は RLS（テナント文脈）。`limit` は 1 回のジョブが DB を舐め続けないためのページサイズ。
 */
export async function listHeldProposalSends(
  ctx: SystemTenantCtx,
  input: { readonly limit: number },
): Promise<readonly HeldProposalSendRow[]> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new RangeError(`limit は 1 以上の整数である必要があります（${String(input.limit)}）。`);
  }
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.proposal.findMany({
        where: { state: 'APPROVED', sendHoldReasonKey: { in: [...AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS] } },
        select: { id: true, sendHoldReasonKey: true, sendHoldSince: true },
        orderBy: [{ sendHoldSince: 'asc' }, { id: 'asc' }],
        take: input.limit,
      });
      return rows.flatMap((row) => {
        const reasonKey = holdReasonOf(row.sendHoldReasonKey);
        // CHECK（`proposals_send_hold_pair_check`）が保証しているので到達しない。
        if (reasonKey === null || row.sendHoldSince === null) return [];
        return [{ proposalId: row.id, reasonKey, since: row.sendHoldSince }];
      });
    },
  );
}

// ============================================================================
// 復帰する試行の由来（docs/05 §10.4「同じ attemptSeq で再 enqueue」）
// ============================================================================

/**
 * 🔴 保留から復帰させる `send.proposal` の payload に載せる **由来と `attemptSeq`** を復元する。
 *
 * 保留は ①②（`reserveSendAttempt` の**前**）で起きるため `send_attempts` に行は無く、人間が #43 / #44 で採番した値は
 * いまも `MAX(attempt_seq) + 1`（`nextSendAttemptSeqInTx`。採番と**同じ 1 式**）である。これは採番ではなく復元 ——
 * ジョブ文脈で「次の番号を振る」のではなく、既に振られた番号を導き直している（値が変わるのは人間が再送したときだけ）。
 *
 * - `1` → `{ kind: 'INITIAL' }`
 * - `>= 2` → `{ kind: 'RESEND', attemptSeq, requestedBy }`。`requestedBy` は **最新の `SUBMIT_FAILED → APPROVED`**
 *   （#44 の人間。`ProposalEvent.actorUserId`）。無ければ `SendAttemptOriginError`（人間の再送を経ずに 2 回目の試行が
 *   存在する = 実装バグ。黙って `INITIAL` に丸めない）
 */
export async function resolveProposalSendResumeOrigin(
  ctx: SystemTenantCtx,
  proposalId: string,
): Promise<{ readonly attemptSeq: number; readonly origin: SendAttemptOrigin }> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const attemptSeq = await nextSendAttemptSeqInTx(tx, { entityType: PROPOSAL_SEND_ENTITY_TYPE, entityId: proposalId });
      if (attemptSeq === 1) return { attemptSeq, origin: { kind: 'INITIAL' } };
      const resend = await tx.proposalEvent.findFirst({
        where: { proposalId, kind: 'STATE', fromState: 'SUBMIT_FAILED', toState: 'APPROVED', actorUserId: { not: null } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { actorUserId: true },
      });
      if (resend?.actorUserId === null || resend?.actorUserId === undefined) {
        throw new SendAttemptOriginError(
          `attemptSeq ${String(attemptSeq)} の復帰に人間の再送記録（SUBMIT_FAILED → APPROVED）が見つかりません`,
        );
      }
      return { attemptSeq, origin: { kind: 'RESEND', attemptSeq, requestedBy: resend.actorUserId } };
    },
  );
}

// ============================================================================
// ④ の稀な競合（`ALREADY_RESERVED`）: 予約を持たないまま `SUBMITTING` に入った行の確定
// ============================================================================

/** `④ ALREADY_RESERVED` の確定に使う `failureKind`（`last_failure_reason` / `summary.failureKind`）。 */
export const PROPOSAL_SEND_RESERVATION_CONFLICT = 'RESERVATION_CONFLICT';

/**
 * 🔴 ③ で `SUBMITTING` に入れたが ④ の予約が `ALREADY_RESERVED` だった行を **`SUBMIT_FAILED` に確定**する
 *    （docs/05 §10.2 ④ / §10.4 の T-09-06 の決着）。外部 API は呼んでいない。
 *
 * この実行は `SendAttemptToken` を持たない（既存の試行は別の実行のもの）ため `send_attempts` には触れない。
 * 🔴 `APPROVED` に**戻さない**（`SUBMITTING` は片道。`CLAUDE.md` §4.2）。既存の試行が `SUCCEEDED` なら「送ったのに
 *    送っていないと見せる」（二重送信の反対側の事故）を作らないためにも、人間が `S-022` で試行の記録を見て
 *    再送の要否を決める（#44。§10.6）。
 */
export async function failProposalSubmissionWithoutAttempt(
  ctx: SystemTenantCtx,
  input: { readonly proposalId: string; readonly attemptSeq: number; readonly now: Date },
): Promise<boolean> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE proposals
           SET state = ${SETTLE_FAILURE_TO},
               last_failure_reason = ${PROPOSAL_SEND_RESERVATION_CONFLICT},
               send_hold_reason_key = NULL,
               send_hold_since = NULL,
               updated_at = ${input.now}::timestamptz
         WHERE id = ${input.proposalId}::uuid
           AND state = ${SETTLE_FROM}
        RETURNING id::text AS id`);
      if (updated[0] === undefined) return false;
      await tx.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: input.proposalId,
          kind: 'STATE',
          fromState: SETTLE_FROM,
          toState: SETTLE_FAILURE_TO,
          actorUserId: null,
          note: `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}${PROPOSAL_SEND_RESERVATION_CONFLICT}`,
          occurredAt: input.now,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        action: PROPOSAL_AUDIT_ACTION_SUBMIT,
        actorKind: 'SYSTEM',
        actorId: null,
        targetType: 'Proposal',
        targetId: input.proposalId,
        summary: {
          operation: PROPOSAL_SUBMIT_OPERATIONS.SETTLE,
          attemptSeq: input.attemptSeq,
          result: 'FAILED',
          toState: SETTLE_FAILURE_TO,
          failureKind: PROPOSAL_SEND_RESERVATION_CONFLICT,
          externalCallMade: false,
          jobQueue: ctx.job.queue,
          jobId: ctx.job.jobId,
        },
        ipAddress: null,
        deviceKind: ctx.deviceKind,
      });
      return true;
    },
  );
}

// ============================================================================
// ⑥ 確定（docs/05 §10.2 ⑥ / §10.6。1 トランザクション）
// ============================================================================

export type SettleProposalSubmissionInput = {
  readonly proposalId: string;
  readonly token: SendAttemptToken;
  readonly settlement: SendAttemptSettlement;
  /** 人間が指示した試行なら `User.id`（`summary.requestedBy`。§16.1）。初回は `null`。 */
  readonly requestedBy: string | null;
  readonly now: Date;
};

/**
 * 確定の帰結。
 * - `SETTLED` … `SendAttempt` を確定し、`SUBMITTING → SUBMITTED / SUBMIT_FAILED` を 1 件更新した
 * - `ATTEMPT_ALREADY_SETTLED` … 試行が既に確定していた（同じ試行の別の実行が確定済み）。**提案には触れない**
 * - `ATTEMPT_NOT_FOUND` … 試行が見えない（実装バグ。トークンは予約と同じ ctx で作られている）
 * - 🔴 `PROPOSAL_NOT_SUBMITTING` … 試行は確定したが提案が `SUBMITTING` ではなかった（0 件更新）。**試行の確定は
 *   取り消さない**（外部呼び出しの事実のほうが重い）。§10.6「`SUBMITTING` のまま」の逆で、状態が先に動いていた
 *   ことを示す。呼び出し側は失敗として報告する（A-005 で人間が確認する）
 */
export type SettleProposalSubmissionOutcome =
  | { readonly kind: 'SETTLED'; readonly state: ProposalState }
  | { readonly kind: 'ATTEMPT_ALREADY_SETTLED'; readonly attempt: SendAttemptSettlementOutcome }
  | { readonly kind: 'ATTEMPT_NOT_FOUND' }
  | { readonly kind: 'PROPOSAL_NOT_SUBMITTING'; readonly state: string | null };

/**
 * 🔴 ⑥ 確定。**外部呼び出しは終わっている**（成功 / 明示的失敗 / 応答不明）。ここでは外部を呼ばない。
 *
 *   1. `SendAttempt` を `RESERVED → SUCCEEDED | FAILED | UNKNOWN` に確定（`settleSendAttemptInTx`。確定は 1 回）
 *   2. `proposals` を `SUBMITTING → SUBMITTED`（成功。`submitted_at = now`）/ `→ SUBMIT_FAILED`（失敗・応答不明。
 *      `last_failure_reason = failureKind`）に CAS。🔴 保留列を NULL に揃える（送信済み / 失敗の行に保留は残らない）
 *   3. `ProposalEvent(STATE, SUBMITTING → to, actorUserId = null〔system〕)` + `AuditLog(proposal.submit, SYSTEM)`
 *
 * 🔴 応答不明（`UNKNOWN`）も `SUBMIT_FAILED` に確定させる（§10.6 の隔離。自動再送しない。復帰は #44 の人間のみ）。
 * 🔴 `summary` に本文・宛先・氏名を載せない（§16.2）。載せるのは操作・試行番号・結果の種別・外部 ID・指示者だけ。
 */
export async function settleProposalSubmission(
  ctx: SystemTenantCtx,
  input: SettleProposalSubmissionInput,
): Promise<SettleProposalSubmissionOutcome> {
  const succeeded = input.settlement.status === 'SUCCEEDED';
  const to = succeeded ? SETTLE_SUCCESS_TO : SETTLE_FAILURE_TO;
  const failureKind = input.settlement.status === 'SUCCEEDED' ? null : input.settlement.failureKind;

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<SettleProposalSubmissionOutcome> => {
      // 1. 試行の確定（`RESERVED` からの CAS）。
      const attempt = await settleSendAttemptInTx(tx, input.token, { ...input.settlement, now: input.now });
      if (attempt.outcome === 'NOT_FOUND') return { kind: 'ATTEMPT_NOT_FOUND' };
      if (attempt.outcome === 'ALREADY_SETTLED') return { kind: 'ATTEMPT_ALREADY_SETTLED', attempt };

      // 2. 提案の確定（片道。`SUBMITTING` からのみ）。
      const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE proposals
           SET state = ${to},
               submitted_at = CASE WHEN ${succeeded} THEN ${input.now}::timestamptz ELSE submitted_at END,
               last_failure_reason = ${failureKind},
               send_hold_reason_key = NULL,
               send_hold_since = NULL,
               updated_at = ${input.now}::timestamptz
         WHERE id = ${input.proposalId}::uuid
           AND state = ${SETTLE_FROM}
        RETURNING id::text AS id`);
      if (updated[0] === undefined) {
        const current = await tx.proposal.findUnique({ where: { id: input.proposalId }, select: { state: true } });
        return { kind: 'PROPOSAL_NOT_SUBMITTING', state: current?.state ?? null };
      }

      // 3. 履歴と監査（同じトランザクション）。
      await tx.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: input.proposalId,
          kind: 'STATE',
          fromState: SETTLE_FROM,
          toState: to,
          // 🔴 `null` = system（送信ジョブ）。
          actorUserId: null,
          note: succeeded ? null : `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}${String(failureKind)}`,
          occurredAt: input.now,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        action: PROPOSAL_AUDIT_ACTION_SUBMIT,
        actorKind: 'SYSTEM',
        actorId: null,
        targetType: 'Proposal',
        targetId: input.proposalId,
        summary: {
          operation: PROPOSAL_SUBMIT_OPERATIONS.SETTLE,
          attemptSeq: input.token.attemptSeq,
          idempotencyKey: input.token.idempotencyKey,
          result: input.settlement.status,
          toState: to,
          ...(input.settlement.status === 'SUCCEEDED' ? { externalId: input.settlement.externalId } : { failureKind }),
          requestedBy: input.requestedBy,
          jobQueue: ctx.job.queue,
          jobId: ctx.job.jobId,
        },
        ipAddress: null,
        deviceKind: ctx.deviceKind,
      });

      return { kind: 'SETTLED', state: to };
    },
  );
}

// ============================================================================
// 🔴 T-09-07: `SUBMITTING` 滞留の確定（docs/05 §10.6「T-09-07 の実装の決着」。`send.settle-unknown`）
// ============================================================================

/**
 * 滞留の確定に使う `failureKind`（`SendAttempt.failure_kind` / `proposals.last_failure_reason` / `summary.failureKind`）。
 * 🔴 「外部を呼んだかどうか」で 2 値に分ける（`S-022` が「届いた可能性」を出すべきかがここで決まる）:
 *
 * - `UNKNOWN:SETTLE_TIMEOUT` … ④ の予約（`RESERVED`）があった = ⑤ に到達した可能性がある。`UNKNOWN:` 接頭辞は送信ジョブの
 *   ⑥ が応答不明に付ける形（`UNKNOWN:<providerCode>`）と同じであり、`S-022` の畳み込み（`classifySendFailureKind`）が
 *   **応答不明（届いた可能性があります）**として描く。予約の行にも同じ値を書く。
 * - `SETTLE_TIMEOUT:UNSENT` … ④ の予約が無い = ③ の後・④ の前に落ちた。**⑤ には到達していない**（トークンは ④ の INSERT が
 *   1 行返ったときだけ生まれる）ので「届いた可能性」を出さない（`S-022` は「送信に失敗した」= `OTHER`。`deliveryUnknown` は
 *   既存の試行だけで決まる）。確実に送っていないものを「届いた可能性」と見せると、人間の確認作業を無駄に増やす。
 *
 * 後半の `SETTLE_TIMEOUT` が「⑤ の応答ではなく滞留の閾値で確定した」ことを示す（運営への問い合わせに使う語。PII を含まない）。
 */
export const PROPOSAL_SEND_SETTLE_TIMEOUT = 'UNKNOWN:SETTLE_TIMEOUT';
export const PROPOSAL_SEND_SETTLE_TIMEOUT_UNSENT = 'SETTLE_TIMEOUT:UNSENT';

/** 1 回の実行で読む上限の既定（残りは 10 分後の実行が拾う）。 */
export const PROPOSAL_SEND_SETTLE_STALL_DEFAULT_LIMIT = 200;

export type SettleStalledProposalSubmissionsInput = {
  /** 🔴 `SUBMITTING_STALL_ALERT_MINUTES`（`A-005` 項目 2 と同じ閾値。`packages/config`）。 */
  readonly stallThresholdMinutes: number;
  /** 🔴 判定の基準時刻（呼び出し側が渡す）。 */
  readonly now: Date;
  readonly limit?: number;
};

export type SettledStalledProposalSubmission = {
  readonly proposalId: string;
  /**
   * `UNKNOWN` に確定した予約の `attempt_seq`。**空なら ④ の予約が無い滞留**（③ の後・④ の前に落ちた = 外部は呼ばれて
   * いない）であり、`last_failure_reason` は `SETTLE_TIMEOUT:UNSENT`、`S-022` の試行の記録にはその試行が現れない
   * （`deliveryUnknown` は既存の試行だけで決まる）。
   */
  readonly settledAttemptSeqs: readonly number[];
  /** 書いた `failureKind`（`UNKNOWN:SETTLE_TIMEOUT` / `SETTLE_TIMEOUT:UNSENT`）。 */
  readonly failureKind: string;
};

/**
 * 母集団を読んでから確定するまでの間に、送信ジョブの ⑥ が先に確定した（正常な競合）。
 * トランザクションを巻き戻すために投げ、呼び出し側で握る（外に出さない）。
 */
class StalledSubmissionRacedError extends Error {
  constructor(readonly proposalId: string) {
    super(`proposal ${proposalId} は滞留の確定前に送信ジョブが確定した（競合。何もしない）。`);
    this.name = 'StalledSubmissionRacedError';
  }
}

export type SettleStalledProposalSubmissionsOutcome = {
  /** 母集団として読んだ行数（`limit` で切った後）。 */
  readonly scanned: number;
  /** 🔴 実際に `SUBMIT_FAILED` へ確定した行（CAS が 0 件だったものは含まない）。 */
  readonly settled: readonly SettledStalledProposalSubmission[];
};

/**
 * 🔴 `SUBMITTING` のまま閾値を超えた提案を `SUBMIT_FAILED` に確定する（ジョブ文脈。1 テナント分）。
 *
 * これは送信ジョブの ⑥ が**プロセスの消失・DB 例外で到達できなかった**場合の代替であり（docs/05 §10.6 の「`SUBMITTING`
 * のままプロセスが消えた」）、**外部 API は呼ばない・`APPROVED` に戻さない・新しい試行を作らない**。したがって自動リトライ
 * ではない（`CLAUDE.md` §3.4 / §4.2「`SUBMITTING` は片道」= `F-022 AC-2`「必ず確定する」を満たす側の機構）。
 *
 * 1 行ごとに 1 トランザクション:
 *   1. `RESERVED` の予約を `UNKNOWN(UNKNOWN:SETTLE_TIMEOUT)` に確定（`settleStalledSendAttemptsInTx`。0 件 = ④ の前に落ちた）
 *   2. `proposals` を `SUBMITTING → SUBMIT_FAILED` に CAS（`updated_at <= cutoff` を再確認。保留列は NULL に揃える）。
 *      `last_failure_reason` は予約があれば `UNKNOWN:SETTLE_TIMEOUT`（届いた可能性）、無ければ `SETTLE_TIMEOUT:UNSENT`（呼んでいない）
 *   3. `ProposalEvent(STATE, SUBMITTING → SUBMIT_FAILED, system, note = SEND_FAILURE:<failureKind>)` +
 *      `AuditLog(proposal.submit, SYSTEM, operation = SUBMIT_SETTLE, result = UNKNOWN | FAILED, externalCallMade = null〔不明〕| false)`
 *
 * 🔴 起点は `proposals.updated_at`（③ の CAS で `SUBMITTING` に入った時刻。`A-005` 項目 2 の `readSubmittingStalls` と同じ列・
 *    同じ閾値）。`SUBMITTING` の行を更新する経路は ③ と ⑥ 以外に無い（保留は `WHERE state = 'APPROVED'`）。
 * 🔴 2. が 0 件（読んでから今までに ⑥ が確定した）なら 1. も巻き戻る（同じ tx）。試行だけ `UNKNOWN` になった行は残らない。
 */
export async function settleStalledProposalSubmissions(
  ctx: SystemTenantCtx,
  input: SettleStalledProposalSubmissionsInput,
): Promise<SettleStalledProposalSubmissionsOutcome> {
  if (!Number.isInteger(input.stallThresholdMinutes) || input.stallThresholdMinutes <= 0) {
    throw new RangeError(`stallThresholdMinutes は正の整数である必要があります（${String(input.stallThresholdMinutes)}）。`);
  }
  const limit = input.limit ?? PROPOSAL_SEND_SETTLE_STALL_DEFAULT_LIMIT;
  const cutoff = new Date(input.now.getTime() - input.stallThresholdMinutes * 60_000);
  const scope = { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId };

  // 母集団（未処理条件）。`tenant_id` は書かない（RLS + Prisma 拡張が決める）。
  const stalled = await runInTenantTransaction(scope, (tx) =>
    tx.proposal.findMany({
      where: { state: SETTLE_FROM, updatedAt: { lte: cutoff } },
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    }),
  );

  const settled: SettledStalledProposalSubmission[] = [];
  for (const row of stalled) {
    const result = await runInTenantTransaction(scope, async (tx): Promise<SettledStalledProposalSubmission | null> => {
      // 1. 予約を `UNKNOWN` に（0 件 = ④ に到達していない滞留。外部は呼ばれていない）。
      const settledAttemptSeqs = await settleStalledSendAttemptsInTx(
        tx,
        { entityType: PROPOSAL_SEND_ENTITY_TYPE, entityId: row.id },
        { failureKind: PROPOSAL_SEND_SETTLE_TIMEOUT, failureDetail: 'settled by send.settle-unknown (stall threshold exceeded)', now: input.now },
      );

      // 🔴 予約があれば「呼んだかどうか分からない」、無ければ「呼んでいない」。`S-022` の語（届いた可能性 / 送信に失敗した）が分かれる。
      const reached = settledAttemptSeqs.length > 0;
      const failureKind = reached ? PROPOSAL_SEND_SETTLE_TIMEOUT : PROPOSAL_SEND_SETTLE_TIMEOUT_UNSENT;

      // 2. 提案の確定（片道。`SUBMITTING` からのみ。読んでから ⑥ が確定していれば 0 件 = 何もしない）。
      const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE proposals
           SET state = ${SETTLE_FAILURE_TO},
               last_failure_reason = ${failureKind},
               send_hold_reason_key = NULL,
               send_hold_since = NULL,
               updated_at = ${input.now}::timestamptz
         WHERE id = ${row.id}::uuid
           AND state = ${SETTLE_FROM}
           AND updated_at <= ${cutoff}::timestamptz
        RETURNING id::text AS id`);
      if (updated[0] === undefined) {
        // 🔴 0 件なら 1. も巻き戻す（tx を失敗させる）。「試行だけ UNKNOWN」の行を残さない。
        if (settledAttemptSeqs.length > 0) throw new StalledSubmissionRacedError(row.id);
        return null;
      }

      // 3. 履歴と監査（同じトランザクション）。
      await tx.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: row.id,
          kind: 'STATE',
          fromState: SETTLE_FROM,
          toState: SETTLE_FAILURE_TO,
          actorUserId: null,
          note: `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}${failureKind}`,
          occurredAt: input.now,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        action: PROPOSAL_AUDIT_ACTION_SUBMIT,
        actorKind: 'SYSTEM',
        actorId: null,
        targetType: 'Proposal',
        targetId: row.id,
        summary: {
          operation: PROPOSAL_SUBMIT_OPERATIONS.SETTLE,
          attemptSeq: settledAttemptSeqs.at(-1) ?? null,
          // 🔴 予約があれば応答不明（`UNKNOWN`）、無ければ明示的失敗（`FAILED`。外部は呼んでいない）。`SUCCEEDED` は書けない。
          result: reached ? 'UNKNOWN' : 'FAILED',
          toState: SETTLE_FAILURE_TO,
          failureKind,
          // 🔴 予約があれば「呼んだかどうか分からない」（null）、無ければ「呼んでいない」（false）。true は書けない。
          externalCallMade: reached ? null : false,
          stallThresholdMinutes: input.stallThresholdMinutes,
          jobQueue: ctx.job.queue,
          jobId: ctx.job.jobId,
        },
        ipAddress: null,
        deviceKind: ctx.deviceKind,
      });
      return { proposalId: row.id, settledAttemptSeqs, failureKind };
    }).catch((error: unknown) => {
      if (error instanceof StalledSubmissionRacedError) return null;
      throw error;
    });
    if (result !== null) settled.push(result);
  }

  return { scanned: stalled.length, settled };
}
