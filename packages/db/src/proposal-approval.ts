// packages/db/src/proposal-approval.ts
// 🔴 提案の承認（`APPROVAL_PENDING → APPROVED`）の**唯一の実装**（docs/05 §6.5 #41 / §10.3 / §11.5 手順 3 / §11.6 /
//    `F-021 AC-1` `AC-3` `AC-5` / `CLAUDE.md` §3.3）。T-09-03。
// 🔴 T-09-04: 「ゲートが現在の内容に対して有効か」の判定を **1 つの SQL 述語**（`passedReviewGateExistsSql`）に切り出し、
//    ①承認 CAS ②送信前判定（`readProposalGateFreshness`。docs/05 §10.2 ①-c / ②-b）③送信 CAS（`castProposalToSubmitting`。
//    §10.2 ③ / §11.5 手順 4）の 3 箇所が同じ述語を使う。**承認と送信で判定が食い違う余地を作らない。**
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
//
// ============================================================================
// 🔴 承認後の内容変更（docs/05 §11.5 手順 2 / 手順 4。T-09-04。⚠️ 暫定。Issue #54 で確認中）
// ============================================================================
//   `APPROVAL_PENDING` / `APPROVED` の内容は API からは変更できない（#37 は `DRAFT` のみ）。したがって本ファイルの
//   ハッシュ一致条件は **API を通らない経路（運用 SQL・凍結の再生成・将来のコードの不備）に対する多層防御**である。
//   `proposals.content_hash` / `review_gates.content_hash` / 現在の内容の再計算値が**三つ巴で一致**するときだけ
//   承認・送信の CAS が 1 件更新になり、どれか 1 つでもずれれば `GATE_STALE`（fail-closed）に倒れる。
import { Prisma } from '@prisma/client';
import { AUTO_APPROVE_REASON, proposalMachine } from '@ses/domain';
import { writeAuditLog } from './audit.js';
import type { AuthenticatedTenantCtx, SystemTenantCtx } from './context.js';
import { computeProposalContentHash } from './gate-content-hash.js';
import { PROPOSAL_AUDIT_TARGET_TYPE } from './proposal-draft.js';
import { runInTenantTransaction, type TenantTransactionClient } from './with-tenant.js';

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

/**
 * 🔴 送信の遷移（`APPROVED → SUBMITTING`。所有者 `SEND_JOB`。docs/05 §6.5「#48 の実装の決着」の表）。
 *    `castProposalToSubmitting` だけが動かす。T-09-06 の送信ジョブのテストが `proposalTransitionOwner()` の実値と
 *    突き合わせて固定する（`approval.test.ts` が `APPROVE` を固定するのと同じ形）。
 */
const SUBMITTING_FROM = 'APPROVED' as const;
const SUBMITTING_TO = proposalMachine.transition(SUBMITTING_FROM, 'SUBMITTING');

type IdRow = { readonly id: string };

// ============================================================================
// 🔴 「ゲートが現在の内容に対して有効か」の唯一の述語（docs/05 §11.5 手順 3 / 手順 4。T-09-04）
// ============================================================================

/**
 * `review_gates g` が「その内容を外部へ出してよい」と言っている行であることの条件（`findPassedReviewGate` と同じ 3 つ +
 * ハッシュ一致）。🔴 `p` は `proposals` の別名であり、呼び出し側の文で束縛する。
 *
 * 🔴 `g.execution = 'DONE'` を落とさない —— AI 上限で保留中の HELD 行（判定 NULL）は「PASS ではない」ではなく「未判定」
 *    として素通りしうる。保留は共有の許可ではない（§7.6 / `F-027 AC-5`）。
 */
function passedReviewGateJoinSql(contentHash: string): Prisma.Sql {
  return Prisma.sql`g.target_type = 'PROPOSAL'
                    AND g.target_id = p.id
                    AND g.content_hash = ${contentHash}
                    AND g.execution = 'DONE'
                    AND g.pii_verdict = 'PASS'
                    AND g.commerce_verdict = 'PASS'
                    AND g.consistency_verdict = 'PASS'`;
}

/**
 * 🔴 承認 CAS（手順 3）と送信 CAS（手順 4 / §10.2 ③）が **同じこの 1 文**を `WHERE` に含める。
 *    ここを 2 実装にすると「承認は通るが送信で止まる」「承認で止めたものが送信で通る」のどちらかが起きる。
 *
 * @param contentHash 呼び出し側が**その場で再計算した**現在の内容のハッシュ（`computeProposalContentHash`）。
 *   🔴 `proposals.content_hash` 列の値を渡さない（列は「最後にレビュー依頼した内容」。§11.10 ②）。
 */
export function passedReviewGateExistsSql(contentHash: string): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM review_gates g WHERE ${passedReviewGateJoinSql(contentHash)})`;
}

type FreshnessRow = {
  readonly state: string;
  readonly stored_hash: string | null;
  readonly review_gate_id: string | null;
};

/**
 * 「ゲートが現在の内容に対して有効か」の判定材料（docs/05 §10.2 ①-c / ②-b / §11.5 手順 4）。
 *
 * - `storedHash` … `proposals.content_hash`（最後にレビュー依頼した内容。#39 が書く）
 * - `currentHash` … 現在の内容から再計算した値（`computeProposalContentHash`）
 * - `reviewGateId` … `currentHash` に対する DONE・3 層 PASS の行（無ければ `null`）
 * - 🔴 `gateFresh` … `storedHash === currentHash` かつ `reviewGateId !== null`（**三つ巴の一致**）。承認 CAS / 送信 CAS が
 *   1 件更新になる条件そのものであり、これが `false` なら CAS は必ず 0 件になる
 */
export type ProposalGateFreshness = {
  readonly state: string;
  readonly storedHash: string | null;
  readonly currentHash: string;
  readonly reviewGateId: string | null;
  readonly gateFresh: boolean;
};

/**
 * 🔴 判定材料を**同じ述語**で読む（承認 CAS / 送信 CAS と 1 実装）。`p` を束縛した 1 文で `state` / `content_hash` /
 *    合致する `review_gates.id` を同時に取る。見えなければ `null`。
 */
async function readFreshnessInTx(
  tx: TenantTransactionClient,
  proposalId: string,
  currentHash: string,
): Promise<ProposalGateFreshness | null> {
  const rows = await tx.$queryRaw<FreshnessRow[]>(Prisma.sql`
    SELECT p.state,
           p.content_hash AS stored_hash,
           (SELECT g.id
              FROM review_gates g
             WHERE ${passedReviewGateJoinSql(currentHash)}
             ORDER BY g.executed_at DESC
             LIMIT 1) AS review_gate_id
      FROM proposals p
     WHERE p.id = ${proposalId}::uuid
  `);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    state: row.state,
    storedHash: row.stored_hash,
    currentHash,
    reviewGateId: row.review_gate_id,
    gateFresh: row.stored_hash === currentHash && row.review_gate_id !== null,
  };
}

/**
 * 🔴 送信前判定（docs/05 §10.2 ①-c「ゲートの有効性」/ ②-b「承認後に内容が変わっていないか」）の読み取り。T-09-06 が消費する。
 *
 * 🔴 分離キーは ctx からそのまま取る。ジョブ文脈（`SystemTenantCtx`）でも利用者文脈でも RLS の C5 が母集団を決める。
 * 🔴 **読むだけ**であり、状態を動かさない。動かすのは `castProposalToSubmitting`（同じ述語で CAS する）。
 *    「読んで真だったから CAS を省く」実装を書かない —— 判定と更新の間に内容が変わりうる。
 */
export async function readProposalGateFreshness(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
): Promise<ProposalGateFreshness | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const currentHash = await computeProposalContentHash(tx, proposalId);
      if (currentHash === null) return null;
      return readFreshnessInTx(tx, proposalId, currentHash);
    },
  );
}

// ============================================================================
// #41 / 自動承認: `APPROVAL_PENDING → APPROVED`
// ============================================================================

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

      // 4. 🔴 その内容に対する「外部へ出してよい」ゲート結果（送信前判定・送信 CAS と**同じ述語**）。
      //    `execution='DONE'` により HELD 行（判定 NULL）は満たさない（§7.6 / §11.5）。
      const freshness = await readFreshnessInTx(tx, row.id, contentHash);
      if (freshness === null) return { kind: 'NOT_FOUND' };
      if (freshness.reviewGateId === null) return { kind: 'GATE_STALE' };
      const reviewGateId = freshness.reviewGateId;

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
           AND ${passedReviewGateExistsSql(contentHash)}
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
          note: `${PROPOSAL_APPROVAL_NOTE_PREFIX}${reviewGateId}`,
          occurredAt: input.now,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        action: PROPOSAL_AUDIT_ACTION_APPROVE,
        actorKind: approvedBySystem ? 'SYSTEM' : 'USER',
        actorId: approvedBy,
        targetType: PROPOSAL_AUDIT_TARGET_TYPE,
        targetId: row.id,
        summary: {
          operation: PROPOSAL_APPROVE_OPERATION,
          reviewGateId,
          contentHash,
          approvedBySystem,
          // 🔴 自動承認の根拠（`F-021 AC-5`）。人間の承認には付けない。
          ...(approvedBySystem ? { reason: AUTO_APPROVE_REASON } : {}),
        },
        ipAddress: input.ipAddress,
        deviceKind: ctx.deviceKind,
      });

      return { kind: 'APPROVED', reviewGateId, contentHash };
    },
  );
}

// ============================================================================
// 送信ジョブ: `APPROVED → SUBMITTING` の CAS（docs/05 §10.2 ③ / §11.5 手順 4 / §10.3）。T-09-04
// ============================================================================

export type CastProposalToSubmittingInput = {
  readonly proposalId: string;
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: Date;
};

/**
 * 送信 CAS の帰結。
 *
 * - `SUBMITTING` … 1 件更新（`APPROVED → SUBMITTING`）し、`ProposalEvent` を書いた。**外部 API を呼んでよいのはこの場合だけ**
 * - `NOT_FOUND` … 行が見えない
 * - `NOT_APPROVED` … `APPROVED` ではない（多重実行 = 別の実行が先に `SUBMITTING` に入れた / まだ承認されていない /
 *   もう送信済み）。**外部 API を呼ばない**（§10.2 ③「更新件数 0 なら即終了」）
 * - 🔴 `GATE_STALE` … `APPROVED` だが `proposals.content_hash` ≠ 現在の内容、または現在の内容に対する 3 層 PASS の
 *   ゲート結果が無い（承認後に内容が変わった = 承認が無効。§11.5 手順 4）。**外部 API を呼ばない。** 呼び出し側（送信ジョブ）は
 *   `sendHoldReasonKey='GATE_STALE'` の保留に倒す（§10.4 / §10.5。`SUBMIT_FAILED` にしない）
 */
export type ProposalSubmittingCastOutcome =
  | { readonly kind: 'SUBMITTING'; readonly contentHash: string }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'NOT_APPROVED'; readonly state: string }
  | { readonly kind: 'GATE_STALE' };

/**
 * 🔴 `APPROVED → SUBMITTING` の CAS（docs/05 §10.2 ③ の実体。T-09-06 の `send.proposal` が事前判定 ①② の**後**に呼ぶ）。
 *
 * 🔴 **`SystemTenantCtx` 限定。** `SUBMITTING` に入れるのは送信ジョブだけ（所有者 `SEND_JOB`）であり、`apps/web` は
 *    `SystemTenantCtx` を組み立てられない（`systemTenantCtx` は `apps/worker/**` にしか現れない。
 *    `tests/static/auth-db-callers.test.ts` が本関数も `apps/web/**` から参照されないことを走査する）。
 * 🔴 `WHERE` に**承認 CAS と同じ述語**（`passedReviewGateExistsSql`）と `content_hash = $current` を含める。承認時に一致していた
 *    三つ巴が送信時にも一致することを DB レベルで要求する —— 「承認は通ったのに内容が変わっている」提案は `SUBMITTING` に
 *    入れない（§11.5 手順 4 / E2E #10）。
 * 🔴 `SendAttempt` の INSERT（§10.2 ④。T-09-05）と `AuditLog(proposal.submit)`（§10.2 ⑥。T-09-06）はここに含めない。
 *    ここで書くのは状態遷移の履歴（`ProposalEvent`）だけである。
 * 🔴 **片道である。** ここで `SUBMITTING` に入れた行を `APPROVED` に戻す関数は無い（`SUBMITTED` / `SUBMIT_FAILED` への確定は
 *    T-09-06 / T-09-07。`CLAUDE.md` §4.2「`SUBMITTING` は片道」）。
 */
export async function castProposalToSubmitting(
  ctx: SystemTenantCtx,
  input: CastProposalToSubmittingInput,
): Promise<ProposalSubmittingCastOutcome> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<ProposalSubmittingCastOutcome> => {
      // 🔴 現在の内容のハッシュ（列を読み返さない）。見えなければ `NOT_FOUND`。
      const contentHash = await computeProposalContentHash(tx, input.proposalId);
      if (contentHash === null) return { kind: 'NOT_FOUND' };

      // 🔴 T-09-06: 保留列（`sendHoldReasonKey` / `sendHoldSince`。§10.4）は同じ 1 文で NULL に揃える。保留は
      //    「まだ 1 通も送っていない `APPROVED`」の属性であり、`SUBMITTING` に入った行に残すと A-005 の「送信保留」に
      //    送信中の行が混ざる（人間が `GATE_STALE` の保留から再送を選んだ場合に起きる）。
      const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        UPDATE proposals p
           SET state = ${SUBMITTING_TO},
               send_hold_reason_key = NULL,
               send_hold_since = NULL,
               updated_at = ${input.now}::timestamptz
         WHERE p.id = ${input.proposalId}::uuid
           AND p.state = ${SUBMITTING_FROM}
           AND p.content_hash = ${contentHash}
           AND ${passedReviewGateExistsSql(contentHash)}
        RETURNING p.id
      `);
      if (updated[0] === undefined) {
        // 0 件: 状態が `APPROVED` でない（多重実行 / 未承認 / 送信済み）か、内容が変わった。区別して返す。
        const current = await tx.proposal.findUnique({ where: { id: input.proposalId }, select: { state: true } });
        if (current === null) return { kind: 'NOT_FOUND' };
        if (current.state !== SUBMITTING_FROM) return { kind: 'NOT_APPROVED', state: current.state };
        return { kind: 'GATE_STALE' };
      }

      await tx.proposalEvent.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: input.proposalId,
          kind: 'STATE',
          fromState: SUBMITTING_FROM,
          toState: SUBMITTING_TO,
          // 🔴 `null` = system（送信ジョブ）。
          actorUserId: null,
          occurredAt: input.now,
        },
        select: { id: true },
      });

      return { kind: 'SUBMITTING', contentHash };
    },
  );
}
