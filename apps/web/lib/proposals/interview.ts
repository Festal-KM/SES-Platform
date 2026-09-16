// apps/web/lib/proposals/interview.ts
// `S-024` 商談結果の記録の読み取り（docs/04 §S-024 / docs/05 §6.5「`S-024` の実装の決着（T-09-10）」/ §4.8）。T-09-10。
//
// 🔴 `S-024` が描く判断材料は **#46 と同じ 1 実装（`readProposalDetail`）** から取る（凍結側だけ / 履歴は C5 / 取引先向けの型に
//    承認者・送信試行・保留が無い）。本モジュールは、それに**立場の判定材料（`createdBy`）**を足すだけである。
//    `canTransitionProposal`（#48 の第 3 段）は「ctx と読んだ行」で判定する関数であり、画面が出す操作の出し分けも同じ関数を
//    同じ材料で呼ぶ —— ボタンの有無と API の 403 が食い違わない。
// 🔴 母集団は `proposals` の RLS（C5）。境界外・不存在はどちらも 404（`NotFoundError`。区別しない）。`where` に分離キーを書かない。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`detail.ts` / `approval.ts` と同方針）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { NotFoundError } from '../api/errors';
import { readProposalDetail, type ProposalDetailScreenView } from './detail';
import type { ProposalTransitionSubject } from './policy';

export type ProposalInterviewScreenView = {
  readonly screen: ProposalDetailScreenView;
  /** 🔴 立場の判定材料（`canTransitionProposal` の `subject`）。応答には載せない（画面の props にも渡さない）。 */
  readonly subject: ProposalTransitionSubject;
};

export async function readProposalInterview(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  meta: { readonly now: Date },
): Promise<ProposalInterviewScreenView> {
  // ① 立場の材料（C5。見えなければ 404）。`readProposalDetail` も同じ母集団で読むので、どちらが先に 404 でも結論は同じ。
  const row = await withTenant(ctx, (db) => db.proposal.findUnique({ where: { id: proposalId }, select: { createdBy: true } }));
  if (row === null) throw new NotFoundError();
  // ② 判断材料（#46 の 1 実装）。
  const screen = await readProposalDetail(ctx, proposalId, meta);
  return { screen, subject: { createdBy: row.createdBy } };
}
