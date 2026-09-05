// apps/web/lib/partner-companies/schemas.ts
// docs/05 §6.4 #11 / #12 / #13（`F-007` / `S-014`）の境界検証。T-04-07。
//
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）を**キーとして持たない**（`F-003 AC-1` /
//    `F-004 AC-2`）。#13 の対象は path の `{id}` で受けるが、これは「操作対象の指定」であって
//    実行者のスコープではない（母集団は RLS の C5 が決め、見えない ID は 404 になる）。
// 🔴 `.refine()` を使わない（`withApiRoute` の `assertBoundarySchema` がトップレベルの
//    `.shape` を読むため。`audit-logs/schemas.ts` と同じ理由）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/** 取引先企業の状態（`S-014` の「状態」列。`suspendedAt` の有無を 1 語に畳んだ表示上の値）。 */
export const PARTNER_COMPANY_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export type PartnerCompanyStatus = (typeof PARTNER_COMPANY_STATUSES)[number];

/** 企業名・担当者名・停止理由の最大長（DB は TEXT。過大な入力を境界で止める）。 */
const NAME_MAX_LENGTH = 200;
const CONTACT_NAME_MAX_LENGTH = 100;
const CONTACT_EMAIL_MAX_LENGTH = 254;
const SUSPEND_REASON_MAX_LENGTH = 500;
/** 一覧の絞り込み文字列（`?q=`）。 */
const QUERY_MAX_LENGTH = 100;

/**
 * `GET /api/partner-companies`（#11）の query。
 * 🔴 **`cursor` / `limit` を持たない**（docs/05 §6.4 #11 の response が `{ items, total }` で
 *    あり `nextCursor` を持たないため）。取引先企業は 1 テナントあたり数十社の規模であり、
 *    `S-014` は 1 画面の表として全件を扱う。**ページングを勝手に足さない**
 *    （足すと `total` と `items` の意味が仕様とずれる）。
 */
export const partnerCompanyListQuerySchema = z.object({
  q: z.string().trim().max(QUERY_MAX_LENGTH).optional(),
  status: z.enum(PARTNER_COMPANY_STATUSES).optional(),
});

export type PartnerCompanyListQuery = z.infer<typeof partnerCompanyListQuerySchema>;

export type PartnerCompanyListQueryIsolationGuard =
  AssertNoIsolationKeys<PartnerCompanyListQuery>;

assertNoIsolationKeys(
  Object.keys(partnerCompanyListQuerySchema.shape),
  'partnerCompanyListQuerySchema',
);

/**
 * `POST /api/partner-companies`（#12）の body。
 * 🔴 `suspendedAt` を受け取らない —— 停止・再開は #13 の専用経路だけが行う
 *    （登録と同時に停止済みの取引先を作れる意味が無く、監査の action も別になる）。
 */
export const createPartnerCompanyBodySchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  contactName: z.string().trim().min(1).max(CONTACT_NAME_MAX_LENGTH).optional(),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(CONTACT_EMAIL_MAX_LENGTH)
    .email()
    .optional(),
});

export type CreatePartnerCompanyBody = z.infer<typeof createPartnerCompanyBodySchema>;

export type CreatePartnerCompanyBodyIsolationGuard =
  AssertNoIsolationKeys<CreatePartnerCompanyBody>;

assertNoIsolationKeys(
  Object.keys(createPartnerCompanyBodySchema.shape),
  'createPartnerCompanyBodySchema',
);

/**
 * `POST /api/partner-companies/{id}/suspend` / `/resume`（#13）の path params。
 * 🔴 `id` は**操作対象の指定**である。母集団は RLS（C5）が決め、境界外の ID は 404 になる
 *    （docs/05 §4.8）。実行者のスコープはここからは 1 バイトも来ない。
 */
export const partnerCompanyParamsSchema = z.object({ id: z.uuid() });

export type PartnerCompanyParams = z.infer<typeof partnerCompanyParamsSchema>;

export type PartnerCompanyParamsIsolationGuard = AssertNoIsolationKeys<PartnerCompanyParams>;

assertNoIsolationKeys(
  Object.keys(partnerCompanyParamsSchema.shape),
  'partnerCompanyParamsSchema',
);

/**
 * `POST /api/partner-companies/{id}/suspend` / `/resume`（#13）の body。
 * 🔴 `reason` は任意（docs/05 §6.4 #13 の request `{ reason? }`）。監査ログの `summary` に残す。
 *    🔴 **必須にしない** —— 理由の入力を強制すると「止めたいのに止められない」導線ができる。
 *    記録の価値と停止の確実性なら後者を採る（`F-007 AC-2` は停止できることを要求している）。
 *    本文自体は JSON オブジェクトであること（`{}` でよい）。`withApiRoute` は本文が無い / JSON で
 *    ない要求を 400 にする（スキーマを宣言した以上、解釈できない入力を素通しさせない）。
 */
export const partnerCompanySuspensionBodySchema = z.object({
  reason: z.string().trim().max(SUSPEND_REASON_MAX_LENGTH).optional(),
});

export type PartnerCompanySuspensionBody = z.infer<typeof partnerCompanySuspensionBodySchema>;

export type PartnerCompanySuspensionBodyIsolationGuard =
  AssertNoIsolationKeys<PartnerCompanySuspensionBody>;

assertNoIsolationKeys(
  Object.keys(partnerCompanySuspensionBodySchema.shape),
  'partnerCompanySuspensionBodySchema',
);
