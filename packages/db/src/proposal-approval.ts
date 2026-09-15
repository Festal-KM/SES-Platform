// packages/db/src/proposal-approval.ts
// 🔴 提案の承認（`APPROVAL_PENDING → APPROVED`）の**唯一の実装**（docs/05 §6.5 #41 / §10.3 / §11.5 手順 3 / §11.6 /
//    `F-021 AC-1` `AC-3` `AC-5` / `CLAUDE.md` §3.3）。T-09-03。
//
// ============================================================================
// 🔴 なぜ `packages/db` に置くか
// ============================================================================
//   ① **2 実装にしない。** 呼び出し元は #41（`POST /api/proposals/{id}/approve`。人間の承認）と `gate.run` の
//      自動承認（`autoApproveEnabled` かつ全層 PASS。docs/05 §11.6）の 2 つであり、`apps/web` と `apps/worker` は
//      相互に import できないため（`CLAUDE.md` §2.1）、共有点は `packages/db` しか無い（`createProposalDraft` と同じ判断）。
//   ② **承認 CAS は生 SQL である**（§11.5 手順 3 の文そのもの）。`UPDATE … WHERE state='APPROVAL_PENDING' AND
//      content_hash = $hash AND EXISTS (review_gates … content_hash = $hash AND execution='DONE' AND 3 層 PASS)` を
//      1 文で発行する。`TenantDb` は生 SQL の入口を型から除いている（§4.3 実装の規約 3）ので、この 1 文は
//      `packages/db` の内側にしか書けない ＝ **ゲート結果の照合を迂回した承認を `packages/db` の外からは書けない**。
//   ③ 🔴 **ゲート結果を引数に取らない。** 受け取るのは提案の ID と承認者だけである。「どのゲート結果で承認するか」は
//      **この関数が現在の内容から再計算したハッシュで `review_gates` を引いて決める**（`docs/04` 申し送り 4 /
//      `F-020 AC-2`）。呼び出し側が PASS を持ち込める入力面が存在しない。
//
// ============================================================================
// 🔴 手順（1 トランザクション。`runInTenantTransaction`）
// ============================================================================
//   1. 行を読む（母集団は `proposals` の RLS C5。見えなければ `NOT_FOUND`）
//   2. `APPROVAL_PENDING` でなければ `NOT_PENDING`（遷移先は `proposalMachine.transition()` が決める。状態を列挙しない）
//   3. 🔴 **現在の内容**のハッシュを同じトランザクションで再計算する（`computeProposalContentHash`。列を読み返さない）
//   4. そのハッシュで `execution='DONE'` かつ 3 層 PASS の `review_gates` を引く。無ければ `GATE_STALE`
//      （内容が変わった / まだ検査していない / FAIL / HELD のいずれも**同じ結論**: 承認できない）
//   5. 🔴 CAS（上記②の 1 文）。0 件なら状態を読み直し、`APPROVAL_PENDING` でなければ `NOT_PENDING`、
//      そうでなければ `GATE_STALE`（`proposals.content_hash` = 最後にレビュー依頼した内容 ≠ 現在の内容）
//   6. `ProposalEvent(STATE, APPROVAL_PENDING → APPROVED, note='REVIEW_GATE:<id>')` + `AuditLog(proposal.approve)`
//      🔴 `summary` に本文・単価・提案先・氏名を載せない（§16.2）。載せるのは操作・ゲート結果の参照・ハッシュ・根拠だけ。
//
// 🔴 承認者の記録（`F-021 AC-5`）: 人間なら `approved_by = userId` / `approved_by_system = false`、自動なら
//    `approved_by = NULL` / `approved_by_system = true` + `AuditLog(actorKind='SYSTEM', summary.reason='ALL_LAYERS_PASS')`。
//    「なぜ自動承認されたか」は監査ログの `reason` と `reviewGateId` から辿れる。
import { Prisma } from '@prisma/client';
import { AUTO_APPROVE_REASON, proposalMachine } from '@ses/domain';
import { writeAuditLog } from './audit.js';
import type { AuthenticatedTenantCtx } from './context.js';
import { computeProposalContentHash } from './gate-content-hash.js';
import { runInTenantTransaction } from './with-tenant.js';

/** docs/05 §16.1 の `proposal.approve`（#41。自動承認は `SYSTEM` + `summary.reason='ALL_LAYERS_PASS'`）。 */
export const PROPOSAL_AUDIT_ACTION_APPROVE = 'proposal.approve';

/** `AuditLog.summary.operation`。 */
export const PROPOSAL_APPROVE_OPERATION = 'APPROVE';

/**
 * 🔴 承認の `ProposalEvent.note` の印（`REVIEW_GATE:<review_gate_id>`）。承認の根拠になったゲート結果の参照を
 *    履歴に残す（`F-021` 出力「承認記録（承認者・日時・理由）」）。`DRAFT_UPDATED:` と同じく機械的な印であり、
 *    自由入力ではない。⚠️ T-09-09（`S-023` の履歴）はこの接頭辞を「承認（ゲート結果 …）」として描く。
 */
export const PROPOSAL_APPROVAL_NOTE_PREFIX = 'REVIEW_GATE:';

/** 承認の実行者。🔴 `SYSTEM` は `gate.run` の自動承認だけが使う（docs/05 §11.6）。 */
export type ProposalApprovalActor =
  | { readonly kind: 'USER'; readonly userId: string }
  | { readonly kind: 'SYSTEM' };

export type ApproveProposalInput = {
  readonly proposalId: string;
  readonly actor: ProposalApprovalActor;
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: Date;
  readonly ipAddress: string | null;
};

/**
 * 承認の帰結。
 *
 * - `APPROVED` … CAS が 1 件更新し、履歴と監査を書いた
 * - `NOT_FOUND` … 行が見えない（RLS の C5 で 0 件 = 境界外 / 不存在。区別しない。§4.8）
 * - `NOT_PENDING` … `APPROVAL_PENDING` ではない（API 境界は 422 `InvalidStateTransitionError` に写像する）
 * - 🔴 `GATE_STALE` … 現在の内容に対する 3 層 PASS のゲート結果が無い、または `proposals.content_hash` が現在の内容と
 *   一致しない（API 境界は 409。「内容が変更されたため再検証が必要です」。§11.5 手順 3）
 */
export type ProposalApprovalOutcome =
  | { readonly kind: 'APPROVED'; readonly reviewGateId: string; readonly contentHash: string }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'NOT_PENDING'; readonly state: string }
  | { readonly kind: 'GATE_STALE' };

/** 承認の遷移（🔴 `CLAUDE.md` §4.2 の遷移表 1 つが決める。存在しない組はここでコンパイル / 実行時に落ちる）。 */
const APPROVAL_FROM = 'APPROVAL_PENDING' as const;
const APPROVAL_TO = proposalMachine.transition(APPROVAL_FROM, 'APPROVED');

type IdRow = { readonly id: string };

/**
 * 🔴 提案を承認する（ファイル冒頭の手順）。
 *
 * 🔴 分離キーは ctx から**そのまま**取る（`readReviewGateResult` と同じ理由）。ホスト文脈（人間の承認者 / ジョブ）が
 *    呼ぶが、パートナー文脈で呼ばれても RLS の C5 が自社の行に閉じる（承認できる立場かは呼び出し側が先に判定する）。
 */
export async function approveProposal(
  ctx: AuthenticatedTenantCtx,
  input: ApproveProposalInput,
): Promise<ProposalApprovalOutcome> {
  const approvedBy = input.actor.kind === 'USER' ? input.actor.userId : null;
  const approvedBySystem = input.actor.kind === 'SYSTEM';

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<ProposalApprovalOutcome> => {
      // 1. 行（C5）。
      const row = await tx.proposal.findUnique({ where: { id: input.proposalId }, select: { id: true, state: true } });
      if (row === null) return { kind: 'NOT_FOUND' };
      // 2. 状態。
      if (row.state !== APPROVAL_FROM) return { kind: 'NOT_PENDING', state: row.state };

      // 3. 🔴 現在の内容のハッシュ（列を読み返さない。§11.10 ②）。
      const contentHash = await computeProposalContentHash(tx, row.id);
      if (contentHash === null) return { kind: 'NOT_FOUND' };

      // 4. 🔴 その内容に対する「外部へ出してよい」ゲート結果（`findPassedReviewGate` と同じ 3 条件 + ハッシュ一致）。
      //    `execution='DONE'` により HELD 行（判定 NULL）は満たさない（§7.6 / §11.5）。
      const gate = await tx.reviewGate.findFirst({
        where: {
          targetType: 'PROPOSAL',
          targetId: row.id,
          contentHash,
          execution: 'DONE',
          piiVerdict: 'PASS',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
        },
        orderBy: { executedAt: 'desc' },
        select: { id: true },
      });
      if (gate === null) return { kind: 'GATE_STALE' };

      // 5. 🔴 CAS（§11.5 手順 3 の 1 文）。`proposals.content_hash`（最後にレビュー依頼した内容）と
      //    `review_gates.content_hash`（検査した内容）と現在の内容が**三つ巴で一致**するときだけ 1 件更新になる。
      //    テナントキーの述語は RLS が課す（`review-gate.ts` と同じ規律）。
      const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE proposals p
           SET state = ${APPROVAL_TO},
               approved_at = ${input.now}::timestamptz,
               approved_by = ${approvedBy}::uuid,
               approved_by_system = ${approvedBySystem},
               updated_at = ${input.now}::timestamptz
         WHERE p.id = ${row.id}::uuid
           AND p.state = ${APPROVAL_FROM}
           AND p.content_hash = ${contentHash}
           AND EXISTS (
                 SELECT 1
                   FROM review_gates g
                  WHERE g.id = ${gate.id}::uuid
                    AND g.target_type = 'PROPOSAL'
                    AND g.target_id = p.id
                    AND g.content_hash = ${contentHash}
                    AND g.execution = 'DONE'
                    AND g.pii_verdict = 'PASS'
                    AND g.commerce_verdict = 'PASS'
                    AND g.consistency_verdict = 'PASS'
               )
        RETURNING p.id
      `);
      if (updated[0] === undefined) {
        // 0 件: 読んでから今までに状態が動いたか、`content_hash` 列が現在の内容と違う（= 内容が変わった）。
        const current = await tx.proposal.findUnique({ where: { id: row.id }, select: { state: true } });
        if (current !== null && current.state !== APPROVAL_FROM) return { kind: 'NOT_PENDING', state: current.state };
        return { kind: 'GATE_STALE' };
      }

      // 6. 履歴と監査（同じトランザクション）。
      await tx.proposalEvent.create({
        data: {
          // 🔴 分離キーは ctx（認証コンテキスト）から取る。
          tenantId: ctx.tenantId,
          proposalId: row.id,
          kind: 'STATE',
          fromState: APPROVAL_FROM,
          toState: APPROVAL_TO,
          // 🔴 `null` = system（docs/05 §3.6）。
          actorUserId: approvedBy,
          note: `${PROPOSAL_APPROVAL_NOTE_PREFIX}${gate.id}`,
          occurredAt: input.now,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        action: PROPOSAL_AUDIT_ACTION_APPROVE,
        actorKind: approvedBySystem ? 'SYSTEM' : 'USER',
        actorId: approvedBy,
        targetType: 'Proposal',
        targetId: row.id,
        summary: {
          operation: PROPOSAL_APPROVE_OPERATION,
          reviewGateId: gate.id,
          contentHash,
          approvedBySystem,
          // 🔴 自動承認の根拠（`F-021 AC-5`）。人間の承認には付けない。
          ...(approvedBySystem ? { reason: AUTO_APPROVE_REASON } : {}),
        },
        ipAddress: input.ipAddress,
        deviceKind: ctx.deviceKind,
      });

      return { kind: 'APPROVED', reviewGateId: gate.id, contentHash };
    },
  );
}
