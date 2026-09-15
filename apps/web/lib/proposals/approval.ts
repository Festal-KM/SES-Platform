// apps/web/lib/proposals/approval.ts
// 提案の承認・却下（docs/05 §6.5 #41 / #42 / §10.3 / §11.5 / `F-021` / `S-021`）と `S-021` の読み取り。T-09-03。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **承認の実体は `approveProposal`（`@ses/db`）の 1 実装**である（`gate.run` の自動承認と同じ関数）。
//      ハッシュ一致 + 3 層 PASS の EXISTS を条件に含む CAS は `packages/db` の内側にしかなく、ここには
//      「`state='APPROVED'` を書く」コードが 1 行も無い。**ゲート結果を引数に取らない**（#41 は body を持たない）。
//   ② 🔴 **動かす組の所有者を固定する**（T-09-02 の申し送り）: `APPROVAL_PENDING → APPROVED` = `APPROVE`（#41 の専有）、
//      `APPROVAL_PENDING → DRAFT` = `REJECT`（#42 の専有）。遷移表にはあるが所有者が違う組（`SUBMIT_FAILED → APPROVED`
//      = `RESEND` / `GATE_FAILED → DRAFT` = `MANUAL`）は **422 `PROPOSAL_TRANSITION_RESERVED`** で止める ——
//      #41 から `SUBMIT_FAILED` を「承認」して `acknowledged: true` を迂回する経路を作らない（§10.6）。
//   ③ 🔴 **承認・却下できるのはホストの `OWNER` / `ADMIN` / `SALES` だけ**（`canApproveProposal`。ルートの
//      `requireRole` と二重）。取引先は自社の提案を自分で承認できない（`CLAUDE.md` §3.3「既定は人間承認必須」の
//      「人間」はホストの承認者）。`VIEWER` は 403。
//   ④ 🔴 遷移表に無い状態からの承認・却下（`DRAFT` / `GATE_FAILED` / `APPROVED` … → `APPROVED`）は
//      **422 `INVALID_STATE_TRANSITION`** + `state.invalid_transition` の記録（`F-024 AC-1`。#48 / #39 と同じ 1 実装）。
//   ⑤ 🔴 内容が変わった / 検査していない / FAIL / HELD なら **409 `GATE_STALE`**（§11.5 手順 3）。「無視して承認」は無い。
//   ⑥ 却下は理由必須。`ProposalEvent(STATE, APPROVAL_PENDING → DRAFT, note=理由)` + `AuditLog(proposal.reject)`。
//      🔴 監査の `summary` に理由・本文・単価・提案先を載せない（§16.2）。
//
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5（ホストは全件、取引先は自社の行）。見えなければ 404。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できるようにする）。
import {
  approveProposal,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type ProposalApprovalOutcome,
} from '@ses/db';
import {
  InvalidStateTransitionError as DomainInvalidStateTransitionError,
  proposalMachine,
  proposalTransitionOwner,
  type GateResultView,
  type ProposalState,
  type ProposalTransitionOwner,
} from '@ses/domain';
import {
  GateStaleError,
  InternalError,
  NotFoundError,
  ProposalApprovalForbiddenError,
  ProposalTransitionReservedError,
} from '../api/errors';
import { rethrowWithInvalidTransitionAudit } from '../state/invalid-transition';
import { readProposalGateResult } from './gate';
import { canApproveProposal } from './policy';
import type { RejectProposalBody } from './schemas';
import { readProposalViewInTx, type ProposalActionMeta } from './service';
import type { ProposalView } from './views';

/** docs/05 §16.1 の `proposal.reject`（#42）。 */
export const PROPOSAL_AUDIT_ACTION_REJECT = 'proposal.reject';

/** `AuditLog.summary.operation`（#42）。 */
export const PROPOSAL_REJECT_OPERATION = 'REJECT';

/** `AuditLog.targetType`（`state.invalid_transition` の `entity` と同じ語。#48 と同じ）。 */
const PROPOSAL_TARGET_TYPE = 'Proposal';

/**
 * 🔴 本経路が動かす遷移と、その所有者（`PROPOSAL_TRANSITION_OWNERS`。T-09-02）。
 *    `approval.test.ts` が `proposalTransitionOwner()` の実値と突き合わせて固定する ——
 *    遷移表側で所有者を付け替えたら、ここが**実行時にも**ずれて 422 になり、静かに通り抜けない。
 */
export const PROPOSAL_APPROVE_TRANSITION = {
  from: 'APPROVAL_PENDING',
  to: 'APPROVED',
  owner: 'APPROVE',
} as const satisfies { from: ProposalState; to: ProposalState; owner: ProposalTransitionOwner };

export const PROPOSAL_REJECT_TRANSITION = {
  from: 'APPROVAL_PENDING',
  to: 'DRAFT',
  owner: 'REJECT',
} as const satisfies { from: ProposalState; to: ProposalState; owner: ProposalTransitionOwner };

export type ProposalApprovalDeps = {
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: () => Date;
  readonly meta: ProposalActionMeta;
};

/** `#41` / `#42` の応答（docs/05 §6.5 の `{ state }`）。 */
export type ProposalApprovalStateView = {
  readonly state: ProposalState;
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
 * 🔴 「この経路がこの遷移を起こしてよいか」の 3 段（#48 と同じ順序。docs/05 §6.5「#48 の実装の決着」）:
 *   ① 遷移表に無い組 → `InvalidStateTransitionError`（呼び出し側が `rethrowWithInvalidTransitionAudit` で記録 + 422）
 *   ② 遷移表にはあるが所有者が違う組 → 422 `PROPOSAL_TRANSITION_RESERVED`（記録しない。遷移自体は存在する）
 *   ③ 立場（`canApproveProposal`）→ 403
 * 🔴 ①を③より前に置くのは、遷移表の判定と記録を**誰が呼んでも同じ**にするため（#48 と同じ）。
 */
function assertOwnedTransition(
  ctx: AuthenticatedTenantCtx,
  row: ProposalStateRow,
  expected: { readonly to: ProposalState; readonly owner: ProposalTransitionOwner },
): { readonly from: ProposalState; readonly to: ProposalState } {
  const from = requireKnownState(row.state);
  const to = proposalMachine.transition(from, expected.to);
  const owner = proposalTransitionOwner(from, to);
  if (owner === null) throw new InternalError(`所有者の無い遷移です（${from} -> ${to}）。`);
  if (owner !== expected.owner) throw new ProposalTransitionReservedError(from, to, owner);
  if (!canApproveProposal(ctx)) throw new ProposalApprovalForbiddenError();
  return { from, to };
}

// ============================================================================
// #41 `POST /api/proposals/{id}/approve`
// ============================================================================

/**
 * 人間の承認（#41）。
 *
 * 手順:
 *   ① 行を読む（C5。見えなければ 404）→ `assertOwnedTransition`（422 / 422 / 403）
 *   ② `approveProposal`（`@ses/db`。ハッシュ一致 + 3 層 PASS の CAS + `ProposalEvent` + `AuditLog(proposal.approve)`）
 *   ③ 帰結の写像: `APPROVED` → `{ state }` / `NOT_PENDING` → 422（記録あり）/ `GATE_STALE` → 409 / `NOT_FOUND` → 404
 * 🔴 **body を受け取らない**（ルートに `body` スキーマが無い。ゲート結果を持ち込む入力面が存在しない）。
 */
export async function approveProposalByUser(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  deps: ProposalApprovalDeps,
): Promise<ProposalApprovalStateView> {
  const now = deps.now();
  try {
    const row = await withTenant(ctx, (db) =>
      db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, state: true } }),
    );
    if (row === null) throw new NotFoundError();
    const { to } = assertOwnedTransition(ctx, row, PROPOSAL_APPROVE_TRANSITION);

    const outcome = await approveProposal(ctx, {
      proposalId: row.id,
      actor: { kind: 'USER', userId: ctx.userId },
      now,
      ipAddress: deps.meta.ipAddress,
    });
    return { state: mapApprovalOutcome(outcome, to) };
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(
      ctx,
      { targetType: PROPOSAL_TARGET_TYPE, targetId: proposalId, ipAddress: deps.meta.ipAddress },
      error,
    );
  }
}

function mapApprovalOutcome(outcome: ProposalApprovalOutcome, to: ProposalState): ProposalState {
  switch (outcome.kind) {
    case 'APPROVED':
      return to;
    case 'NOT_FOUND':
      throw new NotFoundError();
    case 'NOT_PENDING':
      // 読んでから CAS までの間に状態が動いた。現在の状態で 422（§15.3。記録は呼び出し側の catch）。
      throw new DomainInvalidStateTransitionError(proposalMachine.entity, outcome.state, to);
    case 'GATE_STALE':
      throw new GateStaleError();
  }
}

// ============================================================================
// #42 `POST /api/proposals/{id}/reject`
// ============================================================================

/**
 * 却下（差し戻し。#42）。`APPROVAL_PENDING → DRAFT`。
 *
 * 手順（1 トランザクション。`withTenant`）:
 *   ① 行を読む（C5。見えなければ 404）→ `assertOwnedTransition`（422 / 422 / 403）
 *   ② CAS（`WHERE state = 'APPROVAL_PENDING'`。0 件なら現在の状態を読み直して 422）
 *   ③ `ProposalEvent(STATE, APPROVAL_PENDING → DRAFT, note = 理由)` + `AuditLog(proposal.reject)`
 * 🔴 理由は `ProposalEvent.note`（作成者への説明）にだけ書き、監査の `summary` には載せない（自由入力。§16.2）。
 * 🔴 承認記録（`approved_*`）は `APPROVAL_PENDING` の行では常に空であり触らない。`content_hash` も触らない
 *    （次のレビュー依頼 #39 が書き直す）。
 */
export async function rejectProposal(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  body: RejectProposalBody,
  deps: ProposalApprovalDeps,
): Promise<ProposalApprovalStateView> {
  const now = deps.now();
  try {
    return await withTenant(ctx, async (db) => {
      const row = await db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, state: true } });
      if (row === null) throw new NotFoundError();
      const { from, to } = assertOwnedTransition(ctx, row, PROPOSAL_REJECT_TRANSITION);

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
          actorUserId: ctx.userId,
          note: body.reason,
          occurredAt: now,
        },
        select: { id: true },
      });
      await writeAuditLog(db, {
        action: PROPOSAL_AUDIT_ACTION_REJECT,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: PROPOSAL_TARGET_TYPE,
        targetId: row.id,
        // 🔴 理由（自由入力）・本文・単価・提案先を載せない（docs/05 §16.2）。
        summary: { operation: PROPOSAL_REJECT_OPERATION, fromState: from, toState: to },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });
      return { state: to };
    });
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(
      ctx,
      { targetType: PROPOSAL_TARGET_TYPE, targetId: proposalId, ipAddress: deps.meta.ipAddress },
      error,
    );
  }
}

// ============================================================================
// `S-021` の読み取り
// ============================================================================

/**
 * 承認者欄（`docs/04` §S-021「自動承認された提案の見え方」/ `F-021 AC-5`）。
 * - `NONE` … まだ承認されていない（`APPROVAL_PENDING` / `DRAFT` / `GATE_FAILED` …）
 * - `USER` … 人間が承認した。`approverName` はホストの利用者名（C8 DIRECTORY。取引先からも読める）。読めなければ `null`
 * - `SYSTEM` … 全層 PASS のため自動承認された（`approved_by_system = true`）
 */
export type ProposalApprovalRecordView =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'USER'; readonly approverName: string | null; readonly approvedAt: string }
  | { readonly kind: 'SYSTEM'; readonly approvedAt: string };

export type ProposalApprovalView = {
  /** 🔴 判断材料の凍結側（`S-020` と同じ `HostProposalView` / `PartnerProposalView`）。台帳の現在値を混ぜない。 */
  readonly view: ProposalView;
  /** ゲート結果（#40 と同じ 1 つの形。3 値の `execution`）。 */
  readonly gate: GateResultView;
  readonly approval: ProposalApprovalRecordView;
  /** 作成者の表示名（判断ヘッダ「作成者」）。読めなければ `null`。 */
  readonly createdByName: string | null;
  /** 🔴 立場として承認・却下ができるか（`canApproveProposal`）。状態・テナントの実行可否は別に見る。 */
  readonly canApprove: boolean;
};

/**
 * `S-021` が読む経路。🔴 判断材料は `HostProposalView` + `ReviewGate` の結果から組む（凍結情報。台帳の現在値を混ぜない）。
 *
 * 🔴 **境界外・不存在はどちらも 404**（docs/05 §4.8）。母集団は `proposals` の RLS（C5）—— 取引先は自社が作成した
 *    提案にしか到達しない（`docs/04` §S-021「他社が作成した提案にはこの画面から到達できない」）。
 */
export async function readProposalApproval(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  meta: { readonly now: Date },
): Promise<ProposalApprovalView> {
  const read = await withTenant(ctx, async (db) => {
    const found = await readProposalViewInTx(ctx, db, proposalId);
    if (found === null) return null;
    const creator = await db.user.findFirst({ where: { id: found.createdBy }, select: { displayName: true } });
    const approver =
      found.approval.approvedBy === null
        ? null
        : await db.user.findFirst({ where: { id: found.approval.approvedBy }, select: { displayName: true } });
    return { ...found, createdByName: creator?.displayName ?? null, approverName: approver?.displayName ?? null };
  });
  if (read === null) throw new NotFoundError();

  const gate = await readProposalGateResult(ctx, proposalId, meta);

  const approvedAt = read.approval.approvedAt;
  const approval: ProposalApprovalRecordView =
    approvedAt === null
      ? { kind: 'NONE' }
      : read.approval.approvedBySystem
        ? { kind: 'SYSTEM', approvedAt: approvedAt.toISOString() }
        : { kind: 'USER', approverName: read.approverName, approvedAt: approvedAt.toISOString() };

  return {
    view: read.view,
    gate,
    approval,
    createdByName: read.createdByName,
    canApprove: canApproveProposal(ctx),
  };
}
