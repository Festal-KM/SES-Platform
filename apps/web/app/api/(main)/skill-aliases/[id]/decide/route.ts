// apps/web/app/api/(main)/skill-aliases/[id]/decide/route.ts
// docs/05 §6.4 #24 `POST /api/skill-aliases/{id}/decide`（`F-010 AC-1`〜`AC-3` / `S-009`）。T-05-03。
//
// 🔴 認可は `ADMIN` / `SALES`（docs/05 §6.4 #24）。ロールの一覧は
//    `lib/skills/policy.ts` の `SKILL_ALIAS_DECIDER_ROLES` が唯一の出所であり、
//    ガード（粗い門）とサービス層の判定（対象を含む可否）が**同じ定数**を見る
//    （2 箇所に書き写すと片方だけ緩む）。
// 🔴 **パートナーは起票のみ**（`F-010 AC-1`）。`PARTNER_ADMIN` / `PARTNER_SALES` は
//    `requireRole` で 403 になる。画面（`S-009`）に採否の導線が無いのは補助であり、
//    拒否の本体はここである（`F-004 AC-9`「API を直接呼んでも拒否される」）。
// 🔴 `VIEWER` は `requireRole` と `requireNotViewer` の**両方**で落ちる（`BR-31` /
//    `F-004 AC-6`。片方だけにしないのは、ロール一覧を書き換えたときに `VIEWER` が
//    紛れ込んでも `requireNotViewer` が残るため）。
// 🔴 停止中の取引先の配下アカウント・`SUSPENDED` / `CLOSING` のテナントは
//    `requireExecutable` が拒否する（`F-004 AC-7` / `F-007 AC-2`）。
//
// 🔴 **監査（`skill_alias.update`）は `audit` オプションではなく `decideSkillAlias` の
//    業務トランザクション内で書く**（`F-010 AC-3`。`changeMemberRole` と同じ形）。
//    ①`audit` オプションはハンドラの前に別トランザクションで書くため、404 / 409 / 403 で
//      終わった要求にも「採用した」記録が残る ②`summary` に載せる由来（`origin`）は
//      行を読むまで分からない。詳細は `lib/skills/service.ts` のコメント。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { decideSkillAlias } from '../../../../../../lib/skills/service';
import { SKILL_ALIAS_DECIDER_ROLES } from '../../../../../../lib/skills/policy';
import {
  skillAliasDecisionBodySchema,
  skillAliasParamsSchema,
} from '../../../../../../lib/skills/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/skill-aliases/{id}/decide',
    guards: [
      requireRole([...SKILL_ALIAS_DECIDER_ROLES]),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: skillAliasParamsSchema,
    body: skillAliasDecisionBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    await decideSkillAlias(
      ctx,
      { id: params.id, decision: body.decision, skillId: body.skillId },
      { ipAddress: meta.ipAddress },
    );
    // 🔴 docs/05 §6.4 #24 の response は `204`（本文を返さない）。
    return new Response(null, { status: 204 });
  },
);
