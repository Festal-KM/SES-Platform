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
import { TENANT_NAME_MAX_LENGTH } from '@ses/config';
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
