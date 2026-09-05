// apps/web/lib/settings/schemas.ts
// docs/05 §6.3 #64 `PATCH /api/settings/organization` の request スキーマ。T-03-10。
//
// 🔴 🔴 **`lifecycleState` をキーとして持たない**（docs/05 §6.3 #64「読み取り専用」/
//    `CLAUDE.md` §4.2「テナント側のロールはこの状態を変更できない」）。
//    キーが無いので、送られてきても `z.object()` の既定（strip）で黙って捨てられる
//    （`strict()` にして 400 を返すと「その項目は存在する」ことを教えてしまう）。
// 🔴 `environment` / `timezone` も持たない: 開設時にしか書けない（docs/05 §5.2）/
//    #64 の body に無い。**先回りして書けるようにしない。**
// 🔴 分離キー（`tenantId`）も当然持たない（`assertNoIsolationKeys` が構造として固定する）。
import { z } from 'zod';
import { SENDING_DOMAIN_MAX_LENGTH, TENANT_NAME_MAX_LENGTH } from '@ses/config';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * 個人情報の保持期間（年）。
 * 🔴 上限・下限は `CLAUDE.md` §9-8 が「取引先との契約条件に依存する」として未決のため、
 *    ここでは**明らかな誤入力**（0 年 / 100 年）だけを弾く。確定したら 1 箇所を直す。
 */
const PII_RETENTION_YEARS_MIN = 1;
const PII_RETENTION_YEARS_MAX = 20;

export const updateOrganizationBodySchema = z.object({
  name: z.string().trim().min(1).max(TENANT_NAME_MAX_LENGTH).optional(),
  autoApproveEnabled: z.boolean().optional(),
  piiRetentionYears: z
    .number()
    .int()
    .min(PII_RETENTION_YEARS_MIN)
    .max(PII_RETENTION_YEARS_MAX)
    .optional(),
});

export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;

export type UpdateOrganizationBodyIsolationGuard = AssertNoIsolationKeys<UpdateOrganizationBody>;

assertNoIsolationKeys(
  Object.keys(updateOrganizationBodySchema.shape),
  'updateOrganizationBodySchema',
);

/** 🔴 このスキーマが書き込みを許す項目の一覧（テストが固定する対照）。 */
export const ORGANIZATION_PATCHABLE_KEYS = [
  'name',
  'autoApproveEnabled',
  'piiRetentionYears',
] as const;

// --- #71 / #72 送信ドメイン（docs/05 §6.3 / §8.3。T-04-04）--------------------

/**
 * 🔴 送信元ドメインの形（`example.co.jp`）。
 *
 * ここで弾くのは**明らかな誤入力**である（スキーム付き URL・メールアドレス・空白・末尾ドット）。
 * 実在性と所有の証明は DNS レコードの検証（`domain.verify`）が行うのであって、
 * 正規表現の仕事ではない —— 厳しくしすぎると正当な国際化ドメインや長いサブドメインを弾く。
 * 🔴 小文字に正規化する（DNS は大文字小文字を区別しないが、`UNIQUE(tenant_id, domain)` は区別する。
 *    正規化しないと同じドメインを 2 行作れてしまい、「1 テナント 1 検証済みドメイン」が崩れる）。
 */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const createSendingDomainBodySchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(SENDING_DOMAIN_MAX_LENGTH)
    .refine((value) => DOMAIN_PATTERN.test(value), {
      message: 'ドメイン名の形式が正しくありません',
    }),
});

export type CreateSendingDomainBody = z.infer<typeof createSendingDomainBodySchema>;

export type CreateSendingDomainBodyIsolationGuard = AssertNoIsolationKeys<CreateSendingDomainBody>;

assertNoIsolationKeys(Object.keys(createSendingDomainBodySchema.shape), 'createSendingDomainBodySchema');

/**
 * #72 の path パラメータ。
 * 🔴 `id` は**分離キーではない**（対象の行の ID）。母集団は RLS が自テナントに閉じており、
 *    他テナントの ID を渡しても 0 件 → 404 になる（docs/05 §4.8）。
 */
export const sendingDomainParamsSchema = z.object({ id: z.string().uuid() });

export type SendingDomainParams = z.infer<typeof sendingDomainParamsSchema>;

assertNoIsolationKeys(Object.keys(sendingDomainParamsSchema.shape), 'sendingDomainParamsSchema');
