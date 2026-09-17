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

/** `S-020`（編集）。`S-023`（提案詳細。T-09-09）が `/proposals/{id}` にあるので、編集は `/edit` を付ける。 */
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

/**
 * 🔴 T-09-06: 送信の保留の設定導線（docs/05 §10.4「利用者への提示」）。
 * - `S-036`（送信元ドメイン）… `DOMAIN_UNVERIFIED`
 * - `S-038`（利用量と上限）… `RATE_LIMIT`（テナントの利用量）。🔴 **`PROVIDER_QUOTA` にはこの導線を出さない**
 *   （環境全体の制約であり、残量が潤沢な `S-038` に誘導しても打つ手が無い。`F-059 AC-7`）。
 * ⚠️ `S-038` の画面は T-10-04 が置く。URL はここ 1 箇所で決める。
 */
export const SENDING_DOMAIN_SETTINGS_HREF = '/settings/sending-domains';
export const USAGE_SETTINGS_HREF = '/settings/usage';

/** `S-021`（承認）。T-09-03。`S-020`（`APPROVAL_PENDING` の読み取り専用表示）/ `S-023`（T-09-09）/ `S-003` の要対応キュー（✅ T-12-15。`lib/home/action-queue.ts`）から遷移する。 */
export function proposalApproveHref(proposalId: string): string {
  return `/proposals/${proposalId}/approve`;
}

/**
 * 🔴 T-09-08: `S-022`（送信失敗一覧と再送）。`S-021` の `SUBMIT_FAILED` から遷移し、#44 の 202 後は `S-021` へ戻る。
 *    静的セグメントなので `/proposals/[id]` より優先される（Next.js の規約）。
 */
export const PROPOSAL_SEND_FAILURES_PATH = '/proposals/send-failures';

/**
 * 🔴 T-09-09: `S-019`（提案一覧。`/proposals`）と `S-023`（提案詳細と履歴。`/proposals/{id}`）。
 *    `S-023` は `S-020`（`/edit`）/ `S-021`（`/approve`）/ `S-022`（`/send-failures`）と同じ `[id]` セグメントの直下に置く。
 */
export const PROPOSALS_PATH = '/proposals';

export function proposalDetailHref(proposalId: string): string {
  return `${PROPOSALS_PATH}/${proposalId}`;
}

/**
 * 🔴 `S-024`（面談日程の調整と結果記録。T-09-10）。**リンクだけ先に用意する**（画面は T-09-10 が置く）。
 *    `S-023` の「商談中」の導線がこの URL を指す。
 */
export function proposalInterviewHref(proposalId: string): string {
  return `${PROPOSALS_PATH}/${proposalId}/interview`;
}

/**
 * `S-019` の URL（状態フィルタ / 案件 / エンジニア / フリーワード / カーソル）。🔴 分離キーは URL に載らない（`proposalListQuerySchema`）。
 * `state` は `?state=A&state=B` の繰り返し（`optionalListFilter` が配列に均す）。
 */
export function proposalsHref(
  query: {
    readonly state?: readonly string[] | undefined;
    readonly projectId?: string | undefined;
    readonly engineerId?: string | undefined;
    readonly q?: string | undefined;
  },
  cursor: string | null,
): string {
  const params = new URLSearchParams();
  for (const state of query.state ?? []) params.append('state', state);
  if (query.projectId !== undefined) params.set('projectId', query.projectId);
  if (query.engineerId !== undefined) params.set('engineerId', query.engineerId);
  if (query.q !== undefined && query.q !== '') params.set('q', query.q);
  if (cursor !== null) params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? PROPOSALS_PATH : `${PROPOSALS_PATH}?${search}`;
}
