// apps/web/app/api/(main)/proposals/[id]/snapshot-diff/route.ts
// docs/05 §6.5 #46b `GET /api/proposals/{id}/snapshot-diff`（`F-019 AC-2` / `S-006` セクション 4・5 / `docs/04` §5-6。
// 「#46b の境界と記録の確定」）。T-12-16。
//
// 🔴 **`proposals`（C5）と `engineers`（C3 OWNER_SCOPED）の両方が見えるときだけ 200。現在値の行が読めなければ 404**
//    （docs/05 §4.8）。ホストが取引先所有エンジニアの提案（経路 2）で叩くと 404 —— 凍結側は #46 で読める。
//    **凍結側だけを返す形にしない**（返すと「現在値が無い = 他社所有」を応答の形で示唆する）。判定は `readProposalSnapshotDiff`
//    の中で RLS の結果（`null`）に依拠し、この層に所有の `if` を置かない。
// 🔴 **`engineer.view`（`summary.via='SNAPSHOT_DIFF'`, `proposalId`）を業務トランザクション内で記録し、記録できなければ返さない**
//    （`recordEngineerView` の 1 実装。§16.1 / K-7 / `BR-27`）。`withApiRoute` の `audit` オプションを使わない —— ①`S-006`
//    （サーバコンポーネント）は Route Handler を通らず、同じ関数を通ることで画面経路だけ記録が漏れない ②`audit` は 404 でも
//    「閲覧した」記録が残る（#17 と同じ判断）。
// 🔴 `guards: []`（読み取り。#17 / #46 と同じ）。`VIEWER` / `PARTNER_VIEWER` / `CLOSING` でも読める。`requireExecutable` は掛けない。
//    全ロールが到達するが、**見える行は RLS が決める**（`guards: []` は「掛け忘れ」ではない）。
// 🔴 応答は `{ frozenAt, fields: { key, frozen, current }[], careers: { frozen, current } }`。**`frozen` と `current` は別のキー**で、
//    `changed` / `engineerId` / `offeredUnitPrice` / 提案先 / 本文は無い（`snapshot-diff-fields.ts`）。
// 🔴 主平面の API である。管理平面（§6.9）に対応する行は無く、足さない（`EngineerSnapshot.careers` は `app_platform` に無い）。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { proposalParamsSchema } from '../../../../../../lib/proposals/schemas';
import { readProposalSnapshotDiff } from '../../../../../../lib/proposals/snapshot-diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/proposals/{id}/snapshot-diff', guards: [], params: proposalParamsSchema },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    return Response.json(await readProposalSnapshotDiff(ctx, params.id, { ipAddress: meta.ipAddress }));
  },
);
