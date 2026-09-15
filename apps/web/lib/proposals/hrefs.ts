// apps/web/lib/proposals/hrefs.ts
// `S-020`（提案の作成・編集）への URL の**唯一の出所**（T-09-01）。`S-016` / `S-018` / `S-020` 自身が使う。
//
// 🔴 外部 import を持たない純粋モジュール（`'use client'` の画面からも値 import できる。
//    `tests/static/client-db-boundary.test.ts`）。

/** `S-020`（新規）。🔴 案件とエンジニアの**指定**であり、実行者のスコープではない（母集団は RLS が決める）。 */
export function proposalCreateHref(projectId: string, engineerId: string): string {
  const params = new URLSearchParams({ projectId, engineerId });
  return `/proposals/new?${params.toString()}`;
}

/** `S-020`（編集）。`S-023`（提案詳細。T-09-09）は `/proposals/{id}` に置く予定なので、編集は `/edit` を付ける。 */
export function proposalEditHref(proposalId: string): string {
  return `/proposals/${proposalId}/edit`;
}

/**
 * 作成後の遷移先の雛形（`{id}` を採番された ID で置き換える）。
 * 🔴 サーバコンポーネントからクライアントへ渡す props は直列化できなければならず、関数は渡せない
 *    （`lib/projects/created-href.ts` と同じ理由）。値の出所はこの 1 か所である。
 */
export const PROPOSAL_EDIT_HREF_PATTERN = proposalEditHref('{id}');

export function buildProposalEditHref(pattern: string, id: string): string {
  return pattern.replace('{id}', id);
}
