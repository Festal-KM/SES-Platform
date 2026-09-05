// apps/web/app/api/(main)/engineers/route.ts
// docs/05 §6.4 #16 `POST /api/engineers`（`F-008` / `S-007`）。T-05-01。
//
// 🔴 認可は docs/05 §6.4 #16 のとおり `OWNER` / `ADMIN` / `SALES` / `PARTNER_ADMIN` /
//    `PARTNER_SALES`。`VIEWER` は `requireRole` と `requireNotViewer` の**両方**で落ちる
//    （`BR-31` / `F-004 AC-6`。片方だけにしないのは、ロール一覧を書き換えたときに
//    `VIEWER` が紛れ込んでも `requireNotViewer` が残るため）。
// 🔴 停止中の取引先の配下アカウントは `requireExecutable` が拒否する（`F-007 AC-2`）。
// 🔴 **`ownerPartnerCompanyId` は body に無い**（`F-008 AC-2`）。スキーマに存在しないため
//    `withApiRoute` の構築時検査（`assertNoIsolationKeys`）も、Zod の strip も、
//    RLS の C3 も、すべて同じ結論（＝ 登録者の所属だけが所有者を決める）に収束する。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { createEngineer, ENGINEER_AUDIT_ACTIONS } from '../../../../lib/engineers/service';
import { createEngineerBodySchema } from '../../../../lib/engineers/schemas';

// 🔴 Node ランタイム固定（Prisma は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/engineers',
    guards: [
      requireRole(['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES']),
      requireExecutable(),
      requireNotViewer(),
    ],
    body: createEngineerBodySchema,
    // 🔴 `F-008` 処理④「作成・更新・削除を監査ログに記録する」。`withApiRoute` が
    //    ハンドラ本体の**前**に書き、記録に失敗したらハンドラを呼ばない（docs/05 §6.1 / §16.1）。
    // 🔴 `targetId` は採番前なので `null`（`partner_company.create` と同じ扱い）。
    // 🔴 **`displayName` を `summary` に載せない。** エンジニアの氏名は PII であり、
    //    運営者にも見せない値である（`CLAUDE.md` §10.5 / `AuditSummary` の規約）。
    //    残すのは「何件のスキルを付けたか」「新語候補を何件起票したか」だけにする。
    audit: {
      action: ENGINEER_AUDIT_ACTIONS.create,
      resolve: ({ body }) => ({
        targetType: 'Engineer',
        targetId: null,
        summary: {
          skillCount: body.skills.length,
          newSkillLabelCount: body.newSkillLabels.length,
        },
      }),
    },
  },
  async ({ ctx, body }) => Response.json(await createEngineer(ctx, body), { status: 201 }),
);
