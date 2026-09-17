// apps/web/lib/admin-usage/schemas.ts
// `GET /api/admin/usage` / `PUT /api/admin/tenants/{id}/quota`（API-A6 / `A-004`。docs/05 §6.9 / docs/02 `F-057`）の境界検証。T-11-02。
//
// 🔴 `apps/web/app/**` はルート定義とビューでありユニットテストを置かない（`vitest.config.ts`）。Route Handler と画面が呼ぶ
//    検証ロジックはここに置き、`schemas.test.ts` で固定する。
// 🔴 テナントは **URL のパス**（`/api/admin/tenants/{id}/quota`）で選ぶ。body に `tenantId` を持たせない（`assertNoIsolationKeys`）。
//    `targetTenantId`（query）は `A-005` からの導線で「この行を先頭に出す」ための**操作対象の選択**であり、実行者の分離キーではない
//    （`apps/web/lib/admin-audit-logs/schemas.ts` の T-04-07 の整理と同じ）。
// 🔴 `limit` は **十進の整数文字列**で受ける（ストレージのバイト数は `Number` の安全整数を超えうる。`bigint` に上げる）。
//    数値（JSON number）も受けるが、安全整数を超える値は 400。
import { z } from 'zod';
import { QUOTA_OVERRIDE_METRICS, type QuotaOverrideMetric } from '@ses/domain';
import { assertNoIsolationKeys } from '../api/isolation-keys';

/** `A-004` の抽出（docs/04 §A-004 セクション 1 / `F-057 AC-1`）。`all` = 抽出なし。 */
export const ADMIN_USAGE_FILTERS = ['all', 'low', 'high'] as const;

export type AdminUsageFilter = (typeof ADMIN_USAGE_FILTERS)[number];

const uuidSchema = z.uuid();

const adminUsageQuerySchema = z.object({
  filter: z.enum(ADMIN_USAGE_FILTERS).default('all'),
  targetTenantId: uuidSchema.optional(),
});

export type AdminUsageQuery = {
  readonly filter: AdminUsageFilter;
  readonly targetTenantId?: string;
};

export type AdminUsageQueryResult =
  | { readonly ok: true; readonly value: AdminUsageQuery }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseAdminUsageQuery(raw: unknown): AdminUsageQueryResult {
  const parsed = adminUsageQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) };
  }
  return {
    ok: true,
    value: {
      filter: parsed.data.filter,
      ...(parsed.data.targetTenantId === undefined ? {} : { targetTenantId: parsed.data.targetTenantId }),
    },
  };
}

/** 画面（`A-004`）が `?filter=` を読むときの門番。不正な値は `all` に倒す（画面は 400 を返せない）。 */
export function parseAdminUsageFilter(value: string | undefined): AdminUsageFilter {
  const parsed = z.enum(ADMIN_USAGE_FILTERS).safeParse(value);
  return parsed.success ? parsed.data : 'all';
}

/** 画面が `?targetTenantId=` を読むときの門番。UUID 形状でなければ無視する。 */
export function parseTargetTenantId(value: string | undefined): string | undefined {
  return value !== undefined && uuidSchema.safeParse(value).success ? value : undefined;
}

// ---------------------------------------------------------------------------
// PUT /api/admin/tenants/{id}/quota
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`（暦としての妥当性は `@ses/domain` の `decideQuotaChange` → `compareDayKeys` が見る）。 */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_STRING_PATTERN = /^\d{1,19}$/;

/** `reason` の上限（`tenant_quota_overrides_reason_check` と同じ 500）。 */
export const QUOTA_CHANGE_REASON_MAX_LENGTH = 500;

const limitSchema = z.union([
  z.string().regex(INTEGER_STRING_PATTERN),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);

const quotaChangeBodySchema = z.object({
  metric: z.enum(QUOTA_OVERRIDE_METRICS),
  limit: limitSchema,
  effectiveFrom: z.string().regex(DAY_KEY_PATTERN),
  notifyTenantAdmins: z.boolean(),
  reason: z.string().trim().min(1).max(QUOTA_CHANGE_REASON_MAX_LENGTH),
});

// 🔴 body に `tenantId` / `partnerCompanyId` を持たせられないことを構築時に固定する（対象はパスで選ぶ）。
assertNoIsolationKeys(Object.keys(quotaChangeBodySchema.shape), 'quotaChangeBodySchema');
assertNoIsolationKeys(
  Object.keys(adminUsageQuerySchema.shape).filter((key) => key !== 'targetTenantId'),
  'adminUsageQuerySchema',
);

export type QuotaChangeBody = {
  readonly metric: QuotaOverrideMetric;
  /** 🔴 `bigint`（ストレージのバイト数を `Number` に落とさない）。 */
  readonly limit: bigint;
  readonly effectiveFrom: string;
  readonly notifyTenantAdmins: boolean;
  readonly reason: string;
};

export type QuotaChangeBodyResult =
  | { readonly ok: true; readonly value: QuotaChangeBody }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseQuotaChangeBody(raw: unknown): QuotaChangeBodyResult {
  const parsed = quotaChangeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) };
  }
  return {
    ok: true,
    value: {
      metric: parsed.data.metric,
      limit: BigInt(parsed.data.limit),
      effectiveFrom: parsed.data.effectiveFrom,
      notifyTenantAdmins: parsed.data.notifyTenantAdmins,
      reason: parsed.data.reason,
    },
  };
}
