// apps/web/app/api/(main)/skills/route.ts
// docs/05 §6.4 #23 `GET /api/skills`（`F-010` / `S-009` セクション 3 / `S-007` のスキル選択）。T-05-03。
//
// 🔴 **読み取り専用である。** `skills` はグローバル辞書（`CLAUDE.md` §3.1 の射程外 4 表）であり、
//    テナントから編集できない（`F-010 AC-2` / `BR-02`）。**この経路に POST / PATCH / DELETE を
//    足さない** —— 足しても `app_tenant` に `GRANT` が無いので DB が拒否するが、
//    「拒否される API」を置くこと自体が「増やせる」という誤った説明になる。
// 🔴 認可は `guards: []`（全ロール。docs/05 §6.4 #23）。読み取りなので `requireExecutable` /
//    `requireNotViewer` を掛けない（`CLOSING` でも閲覧できる = `F-004 AC-8`、
//    `VIEWER` は閲覧のみ可 = `F-012 AC-3`）。パートナーも同じ辞書を読む（`docs/02` §4.2 の
//    `F-010` = `◐`「語彙マスタの参照」）—— 辞書は分類のためのマスタであり、
//    他パートナーが持ち込んだ情報を 1 つも含まない。
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { listSkills } from '../../../../lib/skills/service';
import { skillListQuerySchema } from '../../../../lib/skills/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/skills', guards: [], query: skillListQuerySchema },
  async ({ ctx, query }) => Response.json(await listSkills(ctx, query)),
);
