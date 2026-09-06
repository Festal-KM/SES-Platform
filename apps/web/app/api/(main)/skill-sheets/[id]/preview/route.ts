// apps/web/app/api/(main)/skill-sheets/[id]/preview/route.ts
// `GET /api/skill-sheets/{id}/preview`（docs/05 §6.4 #21）。`F-012`。T-05-07。
//
// 🔴 **本文（原本の中身）を返さない**（`{ meta }` のみ）。原本に到達できるのは #20 が出す
//    短命の署名付き URL だけであり、そこは `CLEAN` + 監査 + `VIEWER` 拒否の 3 条件を通る。
//    ここが本文を返すと、その 3 条件を迂回する 2 本目の経路になる。
// 🔴 **閲覧を `skill_sheet.view` として記録し、書けなければ内容を返さない**（`F-012 AC-1` /
//    `AC-2` / `BR-28`）。記録は `readSkillSheetPreview` の業務トランザクション内であり、
//    `withApiRoute` の `audit` オプションは使わない（404 でも記録が残るため。§16.1）。
//
// 🔴 認可は **`guards: []`（全ロール）**。`VIEWER` も閲覧できる（`F-012 AC-3` / `BR-31`）。
//    母集団は `skill_sheets` の RLS（C3 OWNER_SCOPED）が決め、境界外の版は 404 になる ——
//    ホストはパートナー所有の版に `Proposal` 作成前は到達できない（`F-012 AC-4` / `BR-59`）。
// 🔴 `requireExecutable` も掛けない（読み取り。`CLOSING` でも閲覧できる。`F-004 AC-8`）。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { readSkillSheetPreview } from '../../../../../../lib/skill-sheets/service';
import { skillSheetParamsSchema } from '../../../../../../lib/skill-sheets/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/skill-sheets/{id}/preview',
    guards: [],
    params: skillSheetParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    // 🔴 docs/05 §6.4 #21 の応答は `{ meta }` である（版そのものを裸で返さない）——
    //    「中身が来る」と読める形にしないため、メタデータであることを鍵名で明示する。
    const preview = await readSkillSheetPreview(ctx, params.id, { ipAddress: meta.ipAddress });
    return Response.json({ meta: preview });
  },
);
