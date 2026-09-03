// apps/web/app/api/(main)/me/route.ts
// `GET /api/me`（docs/05 §6.3 #8 / `F-006`）。T-03-06（SP-03）。
//
// 🔴 GET のみ・全ロール共通（読み取り専用のため `requireExecutable` / `requireNotViewer` を
//    掛けない。`CLOSING` でも閲覧はできる。`F-004 AC-8` / `tests/static/execute-guard.test.ts`）。
// 🔴 「自分の情報を見る」は `BR-27` の記録対象（11 種）に無いため `audit` オプションを使わない
//    （`GET /api/audit-logs` と同じ判断。docs/05 §16.1）。
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { currentAppEnv } from '../../../../lib/db/bootstrap';
import { getMeView } from '../../../../lib/home/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/me', guards: [] },
  async ({ ctx }) => Response.json(await getMeView(ctx, { appEnv: currentAppEnv() })),
);
