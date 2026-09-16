// apps/web/lib/proposals/send-failures.ts
// `S-022`（送信失敗一覧）の読み取り（docs/04 §S-022 / `F-023 AC-3` / docs/05 §6.5 #44「`S-022` の実装の決着」/ §10.4）。T-09-08。
// ✅ T-09-09: 実装は #45 の `listProposals`（`lib/proposals/list.ts`）に統合した。本ファイルは `S-022` が要る形への写像だけを持つ
//    （T-09-08 の申し送り「#45 が入ったら統合する」）。
//
// ============================================================================
// 🔴 この一覧は `SUBMIT_FAILED` **専用**である
// ============================================================================
//   `listProposals(ctx, { state: ['SUBMIT_FAILED'] })` の 1 条件しか持たない。`GATE_FAILED`（送る前に自ら止めた）/ `LOST`（届いたが
//   見送られた）/ `DECLINED`（提案依頼の辞退）は**別の状態**であり、ここに混ぜない（`F-024 AC-2` の 4 区分 / `BR-23` / `CLAUDE.md` §4.2
//   「失敗と保留を混同しない」）。🔴 **保留中（`sendHoldReasonKey` あり）の `APPROVED` も出さない** —— 保留は失敗ではなく
//   （docs/05 §10.4「失敗率の指標に混入させない」）、保留は `S-019` の一覧が**別の表示**で出す。`state` の条件だけで自然に除外される
//   （保留は `APPROVED` の属性であり、`SUBMIT_FAILED` の行に保留は残らない —— `settleProposalSubmission` が確定時に保留列を NULL に揃える）。
//
// 🔴 母集団はアプリが決めない —— `proposals` は RLS の C5（ホストは全件、取引先は自社が作成した行）。取引先が読んでも自社の失敗しか
//    見えないが、`S-022` 自体は取引先に開かない（`canViewSendFailures`。送信はホストが行う）。
// 🔴 試行（`send_attempts`）は C2 HOST_ONLY。`listProposals` がホスト向けの行にだけ載せる。取引先の文脈では型に存在しない = ここでは
//    `[]`（黙って 1 と数えない）。`lastFailureReason` も同じ。
// 🔴 並びは**失敗が古い順**（`updated_at` 昇順 = 放置が長いものを先に。`ProposalListOrder` の `UPDATED_ASC`）。
import type { AuthenticatedTenantCtx } from '@ses/db';
import { PAGE_SIZE_MAX } from '@ses/config';
import { listProposals } from './list';
import type { ProposalSendAttemptView } from './views';

/** 🔴 1 画面で読む上限。`SUBMIT_FAILED` は放置させない前提（`docs/04` §S-022 目的）であり、通常は 0〜数件である。 */
export const SEND_FAILURE_LIST_LIMIT: number = PAGE_SIZE_MAX;

/** 1 つの試行の要約（`S-022` が要る列 = #45 の `ProposalSendAttemptView` と同じ形）。 */
export type SendFailureAttemptView = ProposalSendAttemptView;

/** `S-022` の 1 行（`SUBMIT_FAILED` の提案 1 件）。 */
export type ProposalSendFailureView = {
  readonly id: string;
  readonly recipientCompanyName: string;
  /** 案件名。取引先で公開が解除された案件は `null`（ホストでは常に読める）。 */
  readonly projectName: string | null;
  /** 🔴 凍結側の表示名（`EngineerSnapshot`）。台帳の現在値ではない。凍結が無ければ `null`。 */
  readonly engineerDisplayName: string | null;
  readonly offeredUnitPrice: number | null;
  /** `proposals.last_failure_reason`（確定時の `failureKind`。`RESERVATION_CONFLICT` を含む）。取引先の文脈では `null`。 */
  readonly lastFailureReason: string | null;
  /** 🔴 `SUBMIT_FAILED` に確定した時刻（`updated_at`。確定は `settleProposalSubmission` の 1 文）。ISO 8601（UTC）。 */
  readonly failedAt: string;
  /** 試行（`attempt_seq` 昇順）。取引先の文脈では空。 */
  readonly attempts: readonly SendFailureAttemptView[];
};

export type ProposalSendFailureListView = {
  readonly items: readonly ProposalSendFailureView[];
  /** 🔴 上限で切られている可能性がある（件数は出さない。docs/05 §4.8）。 */
  readonly truncated: boolean;
};

/**
 * `SUBMIT_FAILED` の提案を古い順（`updated_at` 昇順 = 失敗が古い順）に返す。
 * 🔴 `listProposals` の 1 実装を通る（状態の条件以外を足さない。母集団は RLS）。
 */
export async function listProposalSendFailures(ctx: AuthenticatedTenantCtx): Promise<ProposalSendFailureListView> {
  const list = await listProposals(
    ctx,
    { state: ['SUBMIT_FAILED'], limit: SEND_FAILURE_LIST_LIMIT, cursor: undefined, projectId: undefined, engineerId: undefined, q: undefined },
    { order: 'UPDATED_ASC' },
  );
  const items: ProposalSendFailureView[] =
    list.audience === 'HOST'
      ? list.items.map((item) => ({
          id: item.id,
          // 🔴 `SUBMIT_FAILED` に到達した行は提案先を持つ（#39 が空の `DRAFT` を止める）。空なら空文字（`S-022` の行は無言にしない）。
          recipientCompanyName: item.recipient?.companyName ?? '',
          projectName: item.project?.name ?? null,
          engineerDisplayName: item.engineerDisplayName,
          offeredUnitPrice: item.offeredUnitPrice,
          lastFailureReason: item.lastFailureReason,
          failedAt: item.updatedAt,
          attempts: item.sendAttempts,
        }))
      : list.items.map((item) => ({
          id: item.id,
          recipientCompanyName: item.recipient?.companyName ?? '',
          projectName: item.project?.name ?? null,
          engineerDisplayName: item.engineerDisplayName,
          offeredUnitPrice: item.offeredUnitPrice,
          // 🔴 取引先向けの行の型に失敗理由・送信試行は存在しない（`PartnerProposalListItem`）。
          lastFailureReason: null,
          failedAt: item.updatedAt,
          attempts: [],
        }));
  return { items, truncated: list.nextCursor !== null };
}
