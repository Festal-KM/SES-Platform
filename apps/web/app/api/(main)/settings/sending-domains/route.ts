// apps/web/app/api/(main)/settings/sending-domains/route.ts
// docs/05 §6.3 #71 `GET/POST /api/settings/sending-domains`（`F-001 AC-4` / `S-036`）。T-04-04。
//
// 🔴 認可は #71 のとおり **`OWNER`（登録）/ `ADMIN`（確認）**。RLS も `app_is_host()` を要求する
//    （`tenant_sending_domains` は C2 HOST_ONLY。migration 20260903050000）ため、
//    パートナー文脈では 0 件になる（二重防御）。
// 🔴 `state` は **4 値の状態であってエラーではない**（`docs/04` `program-design` 申し送り 8）。
//    未検証を 4xx で返さない —— 返すと画面が「壊れている」として扱ってしまう。
// 🔴 POST に `requireExecutable` を掛ける: ドメインの登録は「新規作成」であり、
//    `CLOSING`（返却のみ）/ `PURGED` では実行できない（`F-004 AC-8`）。GET には掛けない。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { sendingDomainRuntime } from '../../../../../lib/db/bootstrap';
import { createSendingDomainBodySchema } from '../../../../../lib/settings/schemas';
import {
  readSendingDomainSettings,
  registerSendingDomainSettings,
} from '../../../../../lib/settings/sending-domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/settings/sending-domains',
    guards: [requireRole(['OWNER', 'ADMIN'])],
  },
  async ({ ctx }) => Response.json(await readSendingDomainSettings(ctx, sendingDomainRuntime())),
);

export const POST = withApiRoute(
  {
    label: 'POST /api/settings/sending-domains',
    // 🔴 登録は `OWNER` のみ（#71）。送信元の名義はテナントの対外的な看板であり、
    //    契約者（`OWNER`）の判断で決める。
    guards: [requireRole(['OWNER']), requireExecutable(), requireNotViewer()],
    body: createSendingDomainBodySchema,
    // 🔴 `withApiRoute` がハンドラ本体の**前**に `AuditLog` を書く（docs/05 §16.1 の `*.update`）。
    //    送信元ドメインの登録は対外的な名義の変更であり、記録の対象である（`BR-27` の作成・更新）。
    audit: {
      action: 'tenant.sending_domain.create',
      resolve: ({ ctx, body }) => ({
        targetType: 'TenantSendingDomain',
        targetId: ctx.tenantId,
        // 🔴 ドメイン名は PII ではなく、対外的に公開される名義そのものなので載せてよい。
        summary: { domain: body.domain },
      }),
    },
  },
  async ({ ctx, body }) =>
    Response.json(
      await registerSendingDomainSettings(
        ctx,
        { domain: body.domain, observedAt: new Date() },
        sendingDomainRuntime(),
      ),
      { status: 201 },
    ),
);
