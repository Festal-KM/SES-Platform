// apps/web/lib/proposals/transition.ts
// 提案の状態遷移（docs/05 §6.5 #48「#48 の実装の決着」/ `F-024 AC-1` / `F-025` / `BR-33` / `CLAUDE.md` §4.2 / §15.3）。T-09-02。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **遷移の可否は `packages/domain` の遷移表 1 つが決める**（`proposalMachine.transition()`）。状態をここに
//      列挙しない。`CLAUDE.md` §4.2 に無い組は `InvalidStateTransitionError`（422）で、**状態は変化せず**
//      `state.invalid_transition` が**別トランザクション**に記録される（サイレントに無視しない。`BR-33`）。
//   ② 🔴 **#48 が動かすのは所有者 `MANUAL` の 10 本だけ**（`PROPOSAL_TRANSITION_OWNERS`）。レビュー依頼（#39）・
//      ゲートジョブ・承認（#41）・却下（#42）・送信ジョブ・再送（#44）が専有する遷移は、遷移表にあっても
//      **422 `PROPOSAL_TRANSITION_RESERVED`** で止める（それぞれの事前判定・CAS・冪等キーを汎用 API で迂回させない。
//      `CLAUDE.md` §3.3 / §3.4 / §10.3 / §10.6）。body の `to` の列挙（`transitionProposalBodySchema`）が第 1 層、
//      ここが第 2 層である。
//   ③ 🔴 **立場の判定は行を読んでから**（`canTransitionProposal`。ホストの `OWNER`・`ADMIN`・`SALES` は全部、取引先は
//      自社提案の面談実施・辞退、`GATE_FAILED → DRAFT` は作成者。`VIEWER` は不可）。外れたら 403。
//   ④ 🔴 **更新は CAS**（`WHERE id = $1 AND state = $from`）。0 件なら現在の状態を読み直して①の 422
//      （docs/05 §15.3「状態を変えない」。多重実行を DB レベルで排除する）。
//   ⑤ 同じトランザクションで `ProposalEvent(STATE, from → to, note)` と `AuditLog(proposal.update, TRANSITION)` を書く。
//      🔴 監査の `summary` に `note` / 本文 / 単価 / 提案先を載せない（§16.2。`note` は自由入力）。
//   ⑥ 🔴 **状態を足さない**（`P-A-02`）。`WON` は Phase 1 では終端（`Assignment` の生成は Phase 2 `F-042`）。
//
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5（ホストは全件、取引先は自社の行）。`where` に
//    `tenantId` / `ownerPartnerCompanyId` を書かない。見えなければ 404（docs/05 §4.8）。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できるようにする。
//    `lib/proposals/gate.ts` / `service.ts` と同方針）。
import { PROPOSAL_AUDIT_TARGET_TYPE, withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import {
  InvalidStateTransitionError as DomainInvalidStateTransitionError,
  proposalMachine,
  proposalTransitionOwner,
  type ProposalState,
} from '@ses/domain';
import {
  InternalError,
  NotFoundError,
  ProposalTransitionForbiddenError,
  ProposalTransitionReservedError,
} from '../api/errors';
import { rethrowWithInvalidTransitionAudit } from '../state/invalid-transition';
import { canTransitionProposal } from './policy';
import type { TransitionProposalBody } from './schemas';
import { PROPOSAL_AUDIT_ACTION_UPDATE, type ProposalActionMeta } from './service';

/** `AuditLog.summary.operation`（#37 の `DRAFT_UPDATE` / #39 の `GATE_REQUEST` と同じ置き場所）。 */
export const PROPOSAL_TRANSITION_AUDIT_OPERATION = 'TRANSITION';

export type ProposalTransitionDeps = {
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: () => Date;
  readonly meta: ProposalActionMeta;
};

/** `#48` の応答（docs/05 §6.5 #48 の `{ state }`）。 */
export type ProposalTransitionedView = {
  readonly state: ProposalState;
};

/**
 * `POST /api/proposals/{id}/transition`（#48）。
 *
 * 手順（1 トランザクション。`withTenant`）:
 *   ① 行を読む（C5。見えなければ 404）
 *   ② 遷移表の判定（`proposalMachine.transition()`。無い組は `InvalidStateTransitionError` → 記録 + 422）
 *   ③ 所有者の判定（`MANUAL` 以外は 422 `PROPOSAL_TRANSITION_RESERVED`。記録しない —— 遷移自体は遷移表にある）
 *   ④ 立場の判定（`canTransitionProposal`。外れたら 403）
 *   ⑤ CAS（0 件なら現在の状態を読み直して②と同じ 422）
 *   ⑥ `ProposalEvent(STATE)` + `AuditLog(proposal.update, TRANSITION)`
 * 🔴 ②を④より前に置くのは、遷移表の判定と記録を**誰が呼んでも同じ**にするため。
 */
export async function transitionProposal(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  body: TransitionProposalBody,
  deps: ProposalTransitionDeps,
): Promise<ProposalTransitionedView> {
  const now = deps.now();
  const to: ProposalState = body.to;

  try {
    return await withTenant(ctx, async (db) => {
      // ① 🔴 母集団は `proposals` の RLS（C5）。見えない ID は `null` ＝ 404。
      const row = await db.proposal.findUnique({
        where: { id: proposalId },
        select: { id: true, state: true, createdBy: true },
      });
      if (row === null) throw new NotFoundError();
      if (!proposalMachine.isState(row.state)) {
        // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
        throw new InternalError(`proposals.state が未知の値です（${row.state}）。`);
      }
      const from = row.state;

      // ② 🔴 遷移表の判定はここ 1 か所（`CLAUDE.md` §4.2 に無い組はここで `InvalidStateTransitionError`）。
      const next = proposalMachine.transition(from, to);

      // ③ 🔴 所有者の判定。遷移表にある組なので `null` にはならない（不変条件）。
      const owner = proposalTransitionOwner(from, next);
      if (owner === null) throw new InternalError(`所有者の無い遷移です（${from} -> ${next}）。`);
      if (owner !== 'MANUAL') throw new ProposalTransitionReservedError(from, next, owner);

      // ④ 🔴 行を読んでから立場を判定する（ロールだけでは「取引先が結果を確定する」を止められない）。
      if (!canTransitionProposal(ctx, { createdBy: row.createdBy }, { from, to: next })) {
        throw new ProposalTransitionForbiddenError(from, next);
      }

      // ⑤ 🔴 CAS（`WHERE state = $from`）。読んでから書くまでの間に他の遷移が確定していれば 0 件。
      const updated = await db.proposal.updateMany({
        where: { id: row.id, state: from },
        data: { state: next, updatedAt: now },
      });
      if (updated.count !== 1) {
        const current = await db.proposal.findUnique({ where: { id: row.id }, select: { state: true } });
        throw new DomainInvalidStateTransitionError(proposalMachine.entity, current?.state ?? from, next);
      }

      // ⑥ 履歴と監査。
      await db.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: row.id,
          kind: 'STATE',
          fromState: from,
          toState: next,
          actorUserId: ctx.userId,
          ...(body.note === undefined ? {} : { note: body.note }),
          occurredAt: now,
        },
        select: { id: true },
      });
      await writeAuditLog(db, {
        action: PROPOSAL_AUDIT_ACTION_UPDATE,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: PROPOSAL_AUDIT_TARGET_TYPE,
        targetId: row.id,
        // 🔴 `note`（自由入力）・本文・単価・提案先を載せない（docs/05 §16.2）。載せるのは操作と状態だけである。
        summary: { operation: PROPOSAL_TRANSITION_AUDIT_OPERATION, fromState: from, toState: next },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });

      return { state: next };
    });
  } catch (error: unknown) {
    return rethrowWithInvalidTransitionAudit(
      ctx,
      { targetType: PROPOSAL_AUDIT_TARGET_TYPE, targetId: proposalId, ipAddress: deps.meta.ipAddress },
      error,
    );
  }
}
