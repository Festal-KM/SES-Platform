// apps/web/lib/projects/policy.ts
// 案件の登録・編集を行えるロール（docs/05 §6.4 #26 の認可 / `docs/04` §S-012 権限差分 /
// `docs/02` `F-013` 関連ロール）。T-06-01。
//
// 🔴 なぜ定数を切り出すか（`lib/skills/policy.ts` と同じ理由）: 同じロール一覧を
//    ①Route Handler の `requireRole`（`#26`）②画面の到達判定（`S-012`）の 2 か所が見る。
//    書き写すと片方だけが緩み、「画面には出ないが API は通る」/「API は拒否するのに画面は開く」
//    のどちらかが静かに成立する。
import type { TenantRole } from '@ses/db';

/**
 * 🔴 案件の登録・編集ができるロール（docs/05 §6.4 #26 / `docs/04` §S-012「`OWNER` / `ADMIN` /
 *    `SALES` のみ。取引先・`VIEWER` は到達できない」）。
 *
 * 🔴 **パートナーロールを含まない。** 案件はホストの持ち物であり、パートナーは
 *    `ProjectVisibility` を根拠に**読む**だけである（`CLAUDE.md` §3.1 越境経路 1）。
 *    担保は 3 枚: ①本定数を見る `requireRole`（403）②`projects` / `project_requirements` の
 *    RLS は書込が C2（`WITH CHECK (tenant_id = app_tenant_id() AND app_is_host())`）であり、
 *    パートナー文脈では INSERT / UPDATE が通らない ③画面はそもそも描かない。
 * 🔴 `VIEWER` を含まない（`BR-31` / `F-004 AC-6`）。API では `requireRole` と
 *    `requireNotViewer` の**両方**で落ちる（片方だけにしない。`POST /api/engineers` と同じ規律）。
 *
 * 🔴 並び順は `TENANT_ROLES`（`@ses/db`）と同じにする（`SKILL_ALIAS_DECIDER_ROLES` と同じ理由。
 *    テストが `filter` の結果と直接比較する）。
 */
export const PROJECT_EDITOR_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
] as const satisfies readonly TenantRole[];

export function isProjectEditorRole(role: TenantRole): boolean {
  return (PROJECT_EDITOR_ROLES as readonly TenantRole[]).includes(role);
}
