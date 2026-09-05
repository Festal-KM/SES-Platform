// apps/web/app/api/(main)/skill-aliases/route.ts
// docs/05 §6.4 #23 `GET /api/skill-aliases`（`F-010` / `S-009` セクション 1・2）。T-05-03。
//
// 🔴 認可は `guards: []`（全ロール。docs/05 §6.4 #23）。**パートナーも読む**
//    （`docs/02` §4.2 の `F-010` = `◐`）。母集団は `skill_aliases` の RLS（C1）が決め、
//    自テナントの別名とグローバル別名だけが返る。**他テナントの別名は 1 行も返らない。**
// 🔴 起票（`F-008` の `newSkillLabels`）はここではなく `#16` が行い、採否は `#24` が行う。
//    一覧に書き込みの経路を同居させない（読みと書きで認可が違う）。
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { listSkillAliases } from '../../../../lib/skills/service';
import { skillAliasListQuerySchema } from '../../../../lib/skills/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/skill-aliases', guards: [], query: skillAliasListQuerySchema },
  async ({ ctx, query }) => Response.json(await listSkillAliases(ctx, query)),
);
