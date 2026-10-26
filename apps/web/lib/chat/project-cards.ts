// apps/web/lib/chat/project-cards.ts
// ✅ 2026-10-23（チャットレーン・紺野）: 案件をチャットに貼る（案件カード）の読み書きの判定。
// `docs/05` §3.7.1（`messages.attached_project_id`）/ §6.5 #51 / #51n / `F-038` / `CLAUDE.md` §3.1 経路 1・3。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **カードは読む人の RLS で描く。** 貼った人の権限で読んだ値を発言に凍結しない。
//      `projects` / `project_requirements` の C4（取引先には自社に公開中の案件だけ）がそのまま効くので、
//      読めない人には `{ visible: false }` だけが届く（案件名も ID も出さない。`views.ts` の `chatAttachedProjectView`）。
//   ② 🔴 **貼れる案件は 2 つの条件を両方満たすものだけ**（投稿と同じトランザクションで確かめる）:
//      - 送る人がその案件を RLS で読める（他テナント・未公開の案件は 0 件）
//      - 部屋に取引先がいる（`chat_threads.partner_company_id` が NULL でない）なら、**その取引先に公開中**
//        （`project_visibilities` に解除されていない行がある）。社内だけの部屋は自社の案件なら何でも貼れる。
//      🔴 満たさなければ理由を書き分けず、**同じ 400（`body.projectId`）**にする（他社の案件の存在を探れないように）。
//   ③ 🔴 **単価・エンド企業名・公開先を読まない**（`select` に置かない。カードの型にも無い）。
//   ④ 🔴 **越境の経路を増やしていない。** 取引先がカードで見られるのは、経路 1（案件の公開）で既に読める案件だけである。
//      ここで使う取引先の ID は、RLS で読めた部屋の行（`findChatThreadRow`）から取る（リクエストから受け取らない）。
import type { withTenant } from '@ses/db';
import { ValidationError } from '../api/errors';
import { toDateOnlyString } from '../format/db-values';
import type { ChatProjectRequirementView, ChatVisibleProjectCard } from './views';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 🔴 「貼れない」の応答（理由を書き分けない。`schemas.ts` の body のキーと同じ形のパス）。 */
export const CHAT_PROJECT_NOT_PASTABLE_DETAIL = 'body.projectId';

/** 🔴 カードが読む列（単価・エンド企業名・公開用の記載を読まない）。 */
const CARD_PROJECT_SELECT = {
  id: true,
  name: true,
  status: true,
  startDate: true,
  prefecture: true,
  remoteMode: true,
} as const;

/**
 * 貼った案件をカードにする（🔴 **読む人の RLS で**読む。読めなかった ID は結果に入らない）。
 * 🔴 `where` は「どの案件か」だけ。公開先の条件を書き足さない（C4 が決める。書き足すと RLS が緩んでも気づけない）。
 */
export async function readAttachedProjectCards(
  db: Pick<TenantDb, 'project' | 'projectRequirement'>,
  projectIds: readonly (string | null)[],
): Promise<ReadonlyMap<string, ChatVisibleProjectCard>> {
  const unique = [...new Set(projectIds.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const projects = await db.project.findMany({ where: { id: { in: unique } }, select: CARD_PROJECT_SELECT });
  if (projects.length === 0) return new Map();
  const requirements = await db.projectRequirement.findMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
    select: { projectId: true, kind: true, freeText: true, requiredYears: true, skill: { select: { name: true } } },
    // 案件詳細（`readProjectRequirements`）と同じ並び（`skillId` → `id`）。
    orderBy: [{ projectId: 'asc' }, { skillId: 'asc' }, { id: 'asc' }],
  });
  const must = new Map<string, ChatProjectRequirementView[]>();
  const nice = new Map<string, ChatProjectRequirementView[]>();
  for (const row of requirements) {
    const entry: ChatProjectRequirementView = {
      skillName: row.skill === null ? null : row.skill.name,
      freeText: row.freeText,
      requiredYears: row.requiredYears === null ? null : Number(row.requiredYears.toString()),
    };
    const bucket = row.kind === 'MUST' ? must : nice;
    bucket.set(row.projectId, [...(bucket.get(row.projectId) ?? []), entry]);
  }
  return new Map(
    projects.map((project) => [
      project.id,
      {
        visible: true as const,
        id: project.id,
        name: project.name,
        status: project.status,
        startDate: toDateOnlyString(project.startDate),
        prefecture: project.prefecture,
        remoteMode: project.remoteMode,
        mustRequirements: must.get(project.id) ?? [],
        niceRequirements: nice.get(project.id) ?? [],
      },
    ]),
  );
}

/**
 * 🔴 この部屋にこの案件を貼れるか（上の ②）。貼れなければ 400（理由を書き分けない）。
 * @param roomPartnerCompanyId RLS で読めた部屋の行の `partner_company_id`（社内だけの部屋は `null`）
 */
export async function requirePastableProject(
  db: Pick<TenantDb, 'project' | 'projectVisibility'>,
  roomPartnerCompanyId: string | null,
  projectId: string,
): Promise<void> {
  const readable = await db.project.findFirst({ where: { id: projectId }, select: { id: true } });
  if (readable === null) throw new ValidationError([CHAT_PROJECT_NOT_PASTABLE_DETAIL]);
  if (roomPartnerCompanyId === null) return;
  // 🔴 部屋の取引先に公開中か（解除済みの行は数えない。C4 の `revoked_at IS NULL` と同じ述語）。
  const published = await db.projectVisibility.findFirst({
    where: { projectId, partnerCompanyId: roomPartnerCompanyId, revokedAt: null },
    select: { id: true },
  });
  if (published === null) throw new ValidationError([CHAT_PROJECT_NOT_PASTABLE_DETAIL]);
}
