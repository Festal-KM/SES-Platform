// apps/web/lib/admin-audit-logs/schemas.ts
// `GET /api/admin/audit-logs`（API-A7 / `A-006` / `F-058`）の境界検証。T-11-03。
//
// 🔴 期間は必須（docs/03 申し送り 9 / §8.3-3 / docs/05 §6.9 API-A7）。`from` / `to` を `.optional()` に
//    しない —— Zod の必須違反がそのまま 400 になる（別途コードを書かない）。
// 🔴 期間の**幅**にも上限を置く（`AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS`。`packages/config`）。必須にしただけでは
//    「1 年分」を指定できてしまう。超過は `AuditLogPeriodTooLongError`（400 + 期間短縮の理由キー）。
//    `from > to` と上限超過は `.refine()` ではなく `validateAuditLogPeriod`（`./period.ts`）で判定する
//    （`apps/web/lib/audit-logs/schemas.ts` と同じ理由: `.shape` を読む分離キー検査と両立させる）。
// 🔴 `targetTenantId`（任意）は**操作対象の選択**であり、実行者の分離キーではない
//    （`apps/web/lib/api/isolation-keys.ts` の T-04-07 の決着 (c)「キー名で恒久的に区別する」）。
//    運営者の ctx はテナントを持たず、対象は API-A3 の `{id}` と同じくリクエストで選ぶ。
//    値は `searchPlatformAuditLogs` が `withPlatformRead` の `targetTenantId` に渡し、RLS が
//    そのテナントに閉じる（アプリの `where` だけに依存しない。docs/05 §5.2）。
// 🔴 `apps/web/app/**` はルート定義とビューでありユニットテストを置かない。Route Handler と画面の
//    両方が呼ぶ検証ロジックはここ（`apps/web/lib/**`）に置き、ユニットテストで固定する。
import { z } from 'zod';
import { ADMIN_MONITORING_PAGE_SIZE, PAGE_SIZE_MAX } from '@ses/config';
import { AUDIT_ACTOR_KINDS, AUDIT_DEVICE_KINDS } from '@ses/db';
import { assertNoIsolationKeys } from '../api/isolation-keys';

// 🔴 期間の相互検証は `./period.ts`（`@ses/db` に依存しない）に置き、画面とルートが同じ 1 実装を呼ぶ。
export { validateAuditLogPeriod, type AuditLogPeriodVerdict } from './period';

/** `action` 列の形（docs/05 §16.1 の `entity.operation`）。自由文を `where` に持ち込まない。 */
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export const adminAuditLogQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  targetTenantId: z.uuid().optional(),
  action: z.string().trim().min(3).max(100).regex(ACTION_PATTERN).optional(),
  actorType: z.enum(AUDIT_ACTOR_KINDS).optional(),
  deviceKind: z.enum(AUDIT_DEVICE_KINDS).optional(),
  /** 🔴 カーソルは行 ID（uuid(7)）そのもの。形が違えば 400（Prisma の `uuid` キャストで 500 にしない）。 */
  cursor: z.uuid().optional(),
  // 🔴 管理平面の監視系は 100 行（docs/04 §5-6）。上限は一覧 API の一般規約（200）と同じ。
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(ADMIN_MONITORING_PAGE_SIZE),
});

export type AdminAuditLogQuery = z.infer<typeof adminAuditLogQuerySchema>;

// 🔴 管理平面のルートは `withApiRoute`（主平面の共通ガード）を通らないため、分離キーの検査を
//    **明示的に**呼ぶ（`apps/web/lib/admin-tenants/schemas.ts` と同じ）。`targetTenantId` は通る
//    （`tenantId` ではない）。
assertNoIsolationKeys(Object.keys(adminAuditLogQuerySchema.shape), 'adminAuditLogQuerySchema');

export type AdminAuditLogQueryResult =
  | { readonly ok: true; readonly value: AdminAuditLogQuery }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseAdminAuditLogQuery(raw: unknown): AdminAuditLogQueryResult {
  const parsed = adminAuditLogQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) };
  }
  return { ok: true, value: parsed.data };
}
