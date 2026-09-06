// apps/web/app/api/(main)/home/route.ts
// `GET /api/home`（docs/05 §6.3 #9 / `F-006` / `S-003` / `S-004`）。T-03-06（SP-03）。
//
// 🔴 ロールで応答の型が違う（`HostHomeView` / `PartnerHomeView`。docs/05 §4.8）。判定は
//    `getHomeView` の中で `ctx.partnerCompanyId` のみを見る（リクエスト入力は見ない）。
// 🔴 GET のみ・全ロール共通（`execute-guard.test.ts` の対象外。`GET /api/me` と同じ理由）。
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readHomeBlocks } from '../../../../lib/home/blocks';
import { getHomeView } from '../../../../lib/home/service';
import { homeQuerySchema } from '../../../../lib/home/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/home', guards: [], query: homeQuerySchema },
  // 🔴 `scope`（自分の担当のみ / 組織全体）は Phase 1 が要対応キューを実装してから使う
  //    （docs/04 §S-003）。T-05-08 の隔離ブロックは**担当で絞らない** ——
  //    隔離は「誰の担当か」より先に片付けるべき事象であり、絞ると気づけない人が生まれる。
  async ({ ctx }) => Response.json(getHomeView(ctx, await readHomeBlocks(ctx))),
);
