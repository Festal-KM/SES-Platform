// apps/web/lib/proposals/send-failures.ts
// `S-022`（送信失敗一覧）の読み取り（docs/04 §S-022 / `F-023 AC-3` / docs/05 §6.5 #44「`S-022` の実装の決着」/ §10.4）。T-09-08。
//
// ============================================================================
// 🔴 この一覧は `SUBMIT_FAILED` **専用**である
// ============================================================================
//   `where: { state: 'SUBMIT_FAILED' }` の 1 条件しか持たない。`GATE_FAILED`（送る前に自ら止めた）/ `LOST`（届いたが見送られた）/
//   `DECLINED`（提案依頼の辞退）は**別の状態**であり、ここに混ぜない（`F-024 AC-2` の 4 区分 / `BR-23` / `CLAUDE.md` §4.2
//   「失敗と保留を混同しない」）。🔴 **保留中（`sendHoldReasonKey` あり）の `APPROVED` も出さない** —— 保留は失敗ではなく
//   （docs/05 §10.4「失敗率の指標に混入させない」）、保留の一覧は `S-019`（T-09-09）の側にある。`state` の条件だけで
//   自然に除外される（保留は `APPROVED` の属性であり、`SUBMIT_FAILED` の行に保留は残らない —— `settleProposalSubmission`
//   が確定時に保留列を NULL に揃える）。
//
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5（ホストは全件、取引先は自社が作成した行）。取引先が読んでも
//    自社の失敗しか見えないが、`S-022` 自体は取引先に開かない（`canViewSendFailures`。送信はホストが行う）。
// 🔴 試行（`send_attempts`）は C2 HOST_ONLY。同じトランザクションで `entity_id IN (...)` で引く（提案ごとに `listSendAttempts`
//    を呼ぶ N+1 にしない）。取引先の文脈では 0 行になる = `attemptCount: 0`（黙って 1 と数えない）。
// 🔴 **列を選んで写す**（`row` を spread しない）。本文・添付・台帳の現在値はここに載らない。エンジニア名は凍結側
//    （`EngineerSnapshot.displayName`。越境経路 2 でホストが読める唯一の実体）。
// ⚠️ T-09-09 への申し送り: #45（`GET /api/proposals?state=SUBMIT_FAILED`）が入ったら、本関数は #45 の一覧関数に統合する
//    （`S-022` が要る最小の形として先に置いた）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { decimalToNumber } from '../format/db-values';

/** 🔴 1 画面で読む上限。`SUBMIT_FAILED` は放置させない前提（`docs/04` §S-022 目的）であり、通常は 0〜数件である。 */
export const SEND_FAILURE_LIST_LIMIT = 200;

/** 1 つの試行の要約（`SendAttemptView` から `S-022` が要る列だけ）。 */
export type SendFailureAttemptView = {
  readonly attemptSeq: number;
  /** `RESERVED` / `SUCCEEDED` / `FAILED` / `UNKNOWN`（`SEND_ATTEMPT_STATUSES`）。 */
  readonly status: string;
  readonly failureKind: string | null;
  /** ISO 8601（UTC）。 */
  readonly startedAt: string;
  /** ISO 8601（UTC）。未確定なら `null`。 */
  readonly settledAt: string | null;
  /** 送信基盤側の ID（`SUCCEEDED` のときだけ持つ。PII を含まない）。 */
  readonly externalId: string | null;
};

/** `S-022` の 1 行（`SUBMIT_FAILED` の提案 1 件）。 */
export type ProposalSendFailureView = {
  readonly id: string;
  readonly recipientCompanyName: string;
  /** 案件名。取引先で公開が解除された案件は `null`（ホストでは常に読める）。 */
  readonly projectName: string | null;
  /** 🔴 凍結側の表示名（`EngineerSnapshot`）。台帳の現在値ではない。凍結が無ければ `null`。 */
  readonly engineerDisplayName: string | null;
  readonly offeredUnitPrice: number | null;
  /** `proposals.last_failure_reason`（確定時の `failureKind`。`RESERVATION_CONFLICT` を含む）。 */
  readonly lastFailureReason: string | null;
  /** 🔴 `SUBMIT_FAILED` に確定した時刻（`updated_at`。確定は `settleProposalSubmission` の 1 文）。ISO 8601（UTC）。 */
  readonly failedAt: string;
  /** 試行（`attempt_seq` 昇順）。取引先の文脈では空。 */
  readonly attempts: readonly SendFailureAttemptView[];
};

export type ProposalSendFailureListView = {
  readonly items: readonly ProposalSendFailureView[];
  /** 🔴 `items.length === SEND_FAILURE_LIST_LIMIT` のとき、上限で切られている可能性がある（件数は出さない。docs/05 §4.8）。 */
  readonly truncated: boolean;
};

/**
 * `SUBMIT_FAILED` の提案を古い順（`updated_at` 昇順 = 失敗が古い順）に返す。
 * 🔴 `where` に状態以外の条件を足さない（母集団は RLS）。
 */
export async function listProposalSendFailures(ctx: AuthenticatedTenantCtx): Promise<ProposalSendFailureListView> {
  return withTenant(ctx, async (db) => {
    const proposals = await db.proposal.findMany({
      where: { state: 'SUBMIT_FAILED' },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: SEND_FAILURE_LIST_LIMIT,
      select: {
        id: true,
        projectId: true,
        recipientCompanyName: true,
        offeredUnitPrice: true,
        lastFailureReason: true,
        updatedAt: true,
        engineerSnapshot: { select: { displayName: true } },
      },
    });
    const ids = proposals.map((row) => row.id);
    // 🔴 案件は必須リレーションだが、取引先の文脈では C4 で見えないことがある（`readProjectRef` と同じ理由で別に引く）。
    const projectIds = [...new Set(proposals.map((row) => row.projectId))];
    const projects =
      projectIds.length === 0
        ? []
        : await db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } });
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const attempts =
      ids.length === 0
        ? []
        : await db.sendAttempt.findMany({
            where: { entityType: 'PROPOSAL', entityId: { in: ids } },
            orderBy: [{ entityId: 'asc' }, { attemptSeq: 'asc' }],
            select: { entityId: true, attemptSeq: true, status: true, failureKind: true, startedAt: true, settledAt: true, externalId: true },
          });
    const attemptsByProposal = new Map<string, SendFailureAttemptView[]>();
    for (const attempt of attempts) {
      const list = attemptsByProposal.get(attempt.entityId) ?? [];
      list.push({
        attemptSeq: attempt.attemptSeq,
        status: attempt.status,
        failureKind: attempt.failureKind,
        startedAt: attempt.startedAt.toISOString(),
        settledAt: attempt.settledAt?.toISOString() ?? null,
        externalId: attempt.externalId,
      });
      attemptsByProposal.set(attempt.entityId, list);
    }
    const items: ProposalSendFailureView[] = proposals.map((row) => ({
      id: row.id,
      recipientCompanyName: row.recipientCompanyName,
      projectName: projectNames.get(row.projectId) ?? null,
      engineerDisplayName: row.engineerSnapshot?.displayName ?? null,
      offeredUnitPrice: decimalToNumber(row.offeredUnitPrice),
      lastFailureReason: row.lastFailureReason,
      failedAt: row.updatedAt.toISOString(),
      attempts: attemptsByProposal.get(row.id) ?? [],
    }));
    return { items, truncated: items.length === SEND_FAILURE_LIST_LIMIT };
  });
}
