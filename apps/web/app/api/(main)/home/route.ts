// apps/web/app/api/(main)/home/route.ts
// `GET /api/home`（docs/05 §6.3 #9 / `F-006` / `S-003` / `S-004`）。T-03-06（SP-03）。
//
// 🔴 ロールで応答の型が違う（`HostHomeView` / `PartnerHomeView`。docs/05 §4.8）。判定は
//    `getHomeView` の中で `ctx.partnerCompanyId` のみを見る（リクエスト入力は見ない）。
// 🔴 GET のみ・全ロール共通（`execute-guard.test.ts` の対象外。`GET /api/me` と同じ理由）。
// ✅ T-12-15: `?scope=mine|all`（既定 `mine`）と `?changedSince=`（60 秒ポーリングの差分）を要対応キューが使う。
//    隔離ブロック（T-05-08）は**担当で絞らない** —— 隔離は「誰の担当か」より先に片付けるべき事象であり、絞ると気づけない人が生まれる。
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readHomeBlocks } from '../../../../lib/home/blocks';
import { getHomeView } from '../../../../lib/home/service';
import { DEFAULT_HOME_SCOPE, homeQuerySchema } from '../../../../lib/home/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/home', guards: [], query: homeQuerySchema },
  async ({ ctx, query }) => {
    // 🔴 `changedSince` の基準は読み取りの**前**に取る（`getHomeView` の注記）。
    const readAt = new Date();
    const blocks = await readHomeBlocks(ctx, {
      scope: query.scope ?? DEFAULT_HOME_SCOPE,
      changedSince: query.changedSince === undefined ? null : new Date(query.changedSince),
    });
    return Response.json(getHomeView(ctx, blocks, readAt));
  },
);
