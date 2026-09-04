// apps/web/app/api/(main)/settings/organization/route.ts
// docs/05 §6.3 #64 `GET/PATCH /api/settings/organization`（`F-001` / `F-021` / `S-035`）。T-03-10。
//
// 🔴 認可は `OWNER` / `ADMIN` のみ（#64）。`PARTNER_ADMIN` は `S-035` に到達しない
//    （`F-002 AC-4`）。RLS も `app_is_host()` を要求する（migration 20260905000000）。
// 🔴 `lifecycleState` は**読み取り専用**（#64）。PATCH の body スキーマにキーが無く、
//    DB の列レベル `GRANT` にも含まれない（3 枚の担保は `lib/settings/organization.ts` 参照）。
// 🔴 `requireExecutable` を PATCH に掛ける: 組織設定の変更は「新規作成・編集」であり、
//    `CLOSING`（返却のみ）/ `PURGED` では実行できない（`F-004 AC-8`）。**承認ポリシー
//    （`autoApproveEnabled`）を解約手続き中に切り替えられる状態を残さない。**
//    GET には掛けない（`CLOSING` でも閲覧はできる）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import {
  readOrganizationSettings,
  updateOrganizationSettings,
} from '../../../../../lib/settings/organization';
import { updateOrganizationBodySchema } from '../../../../../lib/settings/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/settings/organization',
    guards: [requireRole(['OWNER', 'ADMIN'])],
  },
  async ({ ctx }) => Response.json(await readOrganizationSettings(ctx)),
);

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/settings/organization',
    guards: [requireRole(['OWNER', 'ADMIN']), requireExecutable(), requireNotViewer()],
    body: updateOrganizationBodySchema,
    // 🔴 `withApiRoute` が**ハンドラ本体の前に** `AuditLog` を書く（docs/05 §16.1 の `*.update`）。
    //    記録に失敗したら設定は変更されない（`F-005` / `F-012 AC-2`）。
    audit: {
      action: 'tenant.update',
      resolve: ({ ctx, body }) => ({
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        // 🔴 `summary` に PII を入れない（docs/05 §16.2）。**変更した項目名と、承認ポリシーの
        //    変更後の値**だけを載せる（`CLAUDE.md` §12.4「承認モードの変更は監査ログに記録する」）。
        //    組織名の値そのものは載せない（変更の事実だけで足りる）。
        summary: {
          changedKeys: Object.keys(body).sort().join(','),
          ...(body.autoApproveEnabled === undefined
            ? {}
            : { autoApproveEnabled: body.autoApproveEnabled }),
        },
      }),
    },
  },
  async ({ ctx, body }) => Response.json(await updateOrganizationSettings(ctx, body)),
);
