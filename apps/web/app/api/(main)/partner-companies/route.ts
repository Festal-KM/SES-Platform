// apps/web/app/api/(main)/partner-companies/route.ts
// docs/05 §6.4 #11 `GET /api/partner-companies` / #12 `POST`（`F-007` / `S-014`）。T-04-07。
//
// 🔴 **#11 の母集団は RLS（C5。`<O>` = `id`）が 1 行に絞る。アプリ側に絞り込みを書かない**
//    （`F-004 AC-1` / `F-007 AC-1`）。パートナーが API を直接叩いても、自社 1 件以外は
//    `items` にも `total` にも現れない。認可を `requireRole` でホストに限定していないのは
//    docs/05 §6.4 #11 の「ホスト全ロール。🔴 パートナーは**自社 1 件のみ**」に従うためであり、
//    **ロールで弾く代わりに母集団で閉じている**（`PARTNER_ADMIN` は自社詳細に到達してよい。
//    `docs/04` §S-014 権限差分）。
// 🔴 #12（登録）は `OWNER` / `ADMIN` のみ。RLS の C2（INSERT は `app_is_host()`）と二重防御。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import {
  createPartnerCompany,
  listPartnerCompanies,
  PARTNER_COMPANY_AUDIT_ACTIONS,
} from '../../../../lib/partner-companies/service';
import {
  createPartnerCompanyBodySchema,
  partnerCompanyListQuerySchema,
} from '../../../../lib/partner-companies/schemas';

// 🔴 Node ランタイム固定（Prisma は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/partner-companies',
    // 🔴 読み取り専用のため `requireExecutable` を掛けない（`CLOSING` でも閲覧はできる。
    //    `F-004 AC-8`）。`VIEWER` も閲覧はできる（`docs/04` §S-014 権限差分）。
    guards: [],
    query: partnerCompanyListQuerySchema,
  },
  async ({ ctx, query }) => Response.json(await listPartnerCompanies(ctx, query)),
);

export const POST = withApiRoute(
  {
    label: 'POST /api/partner-companies',
    guards: [requireRole(['OWNER', 'ADMIN']), requireExecutable(), requireNotViewer()],
    body: createPartnerCompanyBodySchema,
    // 🔴 `F-007 AC-3`「取引先企業の登録…が監査ログに残る」。`withApiRoute` がハンドラ本体の
    //    **前**に書き、記録に失敗したらハンドラを呼ばない（docs/05 §6.1 / §16.1 の `*.create`）。
    // 🔴 `targetId` は登録前なので採番できない。**企業名を `summary` に残す**（取引先企業名は
    //    テナント内の業務情報であり PII ではない。これが無いと「何を登録したか」が追えない）。
    audit: {
      action: PARTNER_COMPANY_AUDIT_ACTIONS.create,
      resolve: ({ body }) => ({
        targetType: 'PartnerCompany',
        targetId: null,
        summary: { name: body.name },
      }),
    },
  },
  async ({ ctx, body }) => {
    const created = await createPartnerCompany(ctx, { ...body, invitedAt: new Date() });
    return Response.json(created, { status: 201 });
  },
);
