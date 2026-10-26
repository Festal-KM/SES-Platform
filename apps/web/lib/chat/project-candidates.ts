// apps/web/lib/chat/project-candidates.ts
// ✅ 2026-10-23（チャットレーン・紺野）: `GET /api/threads/{id}/projects`（`docs/05` §6.5 #51n）。
// 入力欄の「/」→「案件を貼る」の小窓に出す、この部屋に貼れる案件の候補。判定の考え方は `project-cards.ts` の冒頭。
import { freeWordAllOf, withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { findChatThreadRow } from './read';

/** 貼る案件の候補に出す件数（入力欄の小窓。多すぎる候補は案件名で絞り込んでもらう）。 */
export const CHAT_PROJECT_CANDIDATE_LIMIT = 20;

/** 貼る案件の候補 1 件（🔴 名前と状態だけ。単価・エンド企業名・公開先を持たない）。 */
export type ChatProjectCandidate = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
};

export const CHAT_PROJECT_CANDIDATE_KEYS = ['id', 'name', 'status'] as const;

/**
 * `GET /api/threads/{id}/projects`（#51n）: この部屋に貼れる案件の候補。
 *
 * 🔴 部屋が見えなければ 404（不存在・他社・他テナントを区別しない）。
 * 🔴 母集団は送る人の RLS（C4）。部屋に取引先がいれば、さらに**その取引先に公開中**の案件だけに絞る
 *    （最終の判定は投稿時の `requirePastableProject`。ここは候補を出すだけ）。
 * 🔴 件数（`total`）を返さない。
 */
export async function readPastableProjectCandidates(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  q: string | undefined,
): Promise<readonly ChatProjectCandidate[]> {
  return withTenant(ctx, async (db) => {
    // 🔴 部屋の母集団は読み・投稿と同じ 1 実装（`findChatThreadRow`）。
    const thread = requireFound(await findChatThreadRow(db, threadId));
    const keyword = q === undefined ? null : freeWordAllOf(q, ['name']);
    const rows = await db.project.findMany({
      where: {
        ...(keyword ?? {}),
        ...(thread.partnerCompanyId === null
          ? {}
          : { visibilities: { some: { partnerCompanyId: thread.partnerCompanyId, revokedAt: null } } }),
      },
      select: { id: true, name: true, status: true },
      // 募集中を先に、新しく更新されたものから（一覧の既定と同じ向き）。
      orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: CHAT_PROJECT_CANDIDATE_LIMIT,
    });
    return rows.map((row) => ({ id: row.id, name: row.name, status: row.status }));
  });
}
