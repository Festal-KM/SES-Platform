// apps/web/lib/proposal-requests/schemas.ts
// 提案依頼（`ProposalRequest`）の境界検証（docs/05 §6.5 #31 / #32 / #35。`F-018` / `S-016` / `S-017`）。T-08-06。
//
// 🔴 **#31 の body は `{ projectId, candidateRef, message, expiresAt }` の 4 項目だけ**である。
//    確定単価・見積・値引き・希望単価に相当するフィールドを**持たない**（`F-017 AC-4` / `BR-58`
//    「匿名候補の段階で単価の交渉をさせない」）。スキーマに無ければ画面にも作れない。
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）を持たない（`withApiRoute` の `assertBoundarySchema` が
//    構築時にも落とす）。`projectId` は**操作対象の指定**であって実行者のスコープではない（`#27` の
//    path `{id}` と同じ扱い。見えない案件は 404）。
// 🔴 `candidateRef` の形（base64url 22 文字）は `CANDIDATE_REF_PATTERN` の 1 か所から引く。UUID は一致しない
//    ので、「`engineerId` をそのまま渡す」呼び出しは 400 で落ちる。
import { z } from 'zod';
import { PROPOSAL_REQUEST_STATES } from '@ses/domain';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { idCursorPageQuerySchema } from '../api/pagination';
import { optionalFilter } from '../api/query-filters';
import { CANDIDATE_REF_PATTERN } from '../anonymize/reference';

// 🔴 入力上限の定数は `limits.ts`（import を持たない純粋モジュール）が持つ。`'use client'` の画面
//    （`candidate-screen.tsx` の `maxLength`）がそちらだけを読み、本ファイルと**同じ値**を使うため
//    （本ファイルは `node:crypto` を持つ `anonymize/reference.ts` に辿れるのでクライアントから読めない）。
import { PROPOSAL_REQUEST_DECLINE_REASON_MAX_LENGTH, PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH } from './limits';

export {
  PROPOSAL_REQUEST_DECLINE_REASON_MAX_LENGTH,
  PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS,
  PROPOSAL_REQUEST_EXPIRY_MAX_DAYS,
  PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH,
} from './limits';

/** `POST /api/proposal-requests`（#31）の body。 */
export const proposalRequestCreateBodySchema = z.object({
  projectId: z.uuid(),
  candidateRef: z.string().regex(CANDIDATE_REF_PATTERN),
  message: z.string().trim().min(1).max(PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH),
  // 🔴 「現在より後・30 日以内」は現在時刻を要するため、スキーマではなく `issueProposalRequest`
  //    （service）が `now` を受け取って検証する（`packages/domain` に `Date` を持ち込まない規律と同じ形）。
  expiresAt: z.iso.datetime({ offset: true }),
});

export type ProposalRequestCreateBody = z.infer<typeof proposalRequestCreateBodySchema>;

export type ProposalRequestCreateBodyIsolationGuard = AssertNoIsolationKeys<ProposalRequestCreateBody>;

assertNoIsolationKeys(
  Object.keys(proposalRequestCreateBodySchema.shape),
  'proposalRequestCreateBodySchema',
);

/**
 * `GET /api/proposal-requests`（#32）の query。`state` は 5 状態のいずれか（`S-017` の状態フィルタ）。
 * 🔴 `DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` を 1 つの値（「失効」）に畳まない（`F-018 AC-5`）。
 */
export const proposalRequestListQuerySchema = idCursorPageQuerySchema.extend({
  state: optionalFilter(z.enum(PROPOSAL_REQUEST_STATES)),
});

export type ProposalRequestListQuery = z.infer<typeof proposalRequestListQuerySchema>;

export type ProposalRequestListQueryIsolationGuard = AssertNoIsolationKeys<ProposalRequestListQuery>;

assertNoIsolationKeys(
  Object.keys(proposalRequestListQuerySchema.shape),
  'proposalRequestListQuerySchema',
);

/**
 * `POST /api/proposal-requests/{id}/decline`（#34）の body。T-08-07。
 * 🔴 `reason` は**任意**（空文字も受け、`NULL` として保存する）。理由の入力を必須にすると
 *    「断る自由」（`BR-57`）に摩擦が生まれる。🔴 理由はパートナー社内限定の記録であり、ホスト向けの
 *    型には存在しない（`views.ts`）。
 */
export const proposalRequestDeclineBodySchema = z.object({
  reason: z.string().trim().max(PROPOSAL_REQUEST_DECLINE_REASON_MAX_LENGTH).optional(),
});

export type ProposalRequestDeclineBody = z.infer<typeof proposalRequestDeclineBodySchema>;

export type ProposalRequestDeclineBodyIsolationGuard = AssertNoIsolationKeys<ProposalRequestDeclineBody>;

assertNoIsolationKeys(
  Object.keys(proposalRequestDeclineBodySchema.shape),
  'proposalRequestDeclineBodySchema',
);

/** `POST /api/proposal-requests/{id}/withdraw`（#35）/ `accept`（#33）/ `decline`（#34）の path params。 */
export const proposalRequestParamsSchema = z.object({ id: z.uuid() });

export type ProposalRequestParams = z.infer<typeof proposalRequestParamsSchema>;

export type ProposalRequestParamsIsolationGuard = AssertNoIsolationKeys<ProposalRequestParams>;

assertNoIsolationKeys(Object.keys(proposalRequestParamsSchema.shape), 'proposalRequestParamsSchema');
