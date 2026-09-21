// apps/web/app/api/(main)/proposals/[id]/gate-results/route.ts
// docs/05 §6.5 #40b `GET /api/proposals/{id}/gate-results`（`F-020 AC-7` / `S-023` セクション 4「実行ごとの履歴」/
// 「#40b と `S-023` セクション 4 の設計」）。T-12-14 ②。
//
// 🔴 **境界は #40 と同一**（取引先は自社提案分のみ。他社・他テナント・不存在は同じ 404〔本文まで同一〕）。
//    認可・射影は #40 と同じ関数を共有する（`loadTarget` / `toGateResultView` / `heldViewFor`。`lib/proposals/gate.ts`）。
// 🔴 ガードも #40 の `GET` と同じ `requireRole([...PROPOSAL_GATE_REQUEST_ROLES, 'VIEWER'])`（読み取り = `requireExecutable` /
//    `requireNotViewer` を掛けない。`CLOSING` でも閲覧はできる。`F-004 AC-8`）。母集団は `proposals` / `review_gates` の RLS（C5）。
// 🔴 監査は書かない（#40 / #46 と同じ線引き）。
// 🔴 body も query もスキーマを持たない（`?force=true` を付けても 1 バイトも届かない。#40 と同じ）。
//    **GET だけ**を export する（履歴を書き換える経路は存在しない。`F-020 AC-7`）。
import { requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readProposalGateResults } from '../../../../../../lib/proposals/gate';
import { PROPOSAL_GATE_REQUEST_ROLES } from '../../../../../../lib/proposals/policy';
import { proposalParamsSchema } from '../../../../../../lib/proposals/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 応答は `{ items: GateResultHistoryItem[] }`（docs/05 §6.5 #40b）。降順（新しい実行が先）。
 *    各行は `GateResultView` と同じ射影 + `reviewGateId` / `executedAt` / `heldSince` / `matchesCurrentContent`。
 *    0 件 = まだ一度も依頼していない（404 にしない）。
 */
export const GET = withApiRoute(
  {
    label: 'GET /api/proposals/{id}/gate-results',
    guards: [requireRole([...PROPOSAL_GATE_REQUEST_ROLES, 'VIEWER'])],
    params: proposalParamsSchema,
  },
  async ({ ctx, params }) =>
    Response.json(await readProposalGateResults(ctx, params.id, { now: new Date() })),
);
