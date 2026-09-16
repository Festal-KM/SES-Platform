// apps/web/lib/admin-monitoring/hrefs.ts
// `A-005` 運用監視の行からの導線の**唯一の出所**（docs/04 §A-005「操作と結果」/ §6.9）。T-11-04。
//
// 🔴 外部 import を持たない純粋モジュール（`'use client'` の画面からも値 import できる。`tests/static/client-db-boundary.test.ts`）。
// 🔴 導線は `A-003`（テナント詳細）と `A-004`（利用量・クォータ）だけ。`targetId`（提案 ID 等）から内容を引く URL は
//    管理平面に存在しない（`tests/static/admin-no-content-reach.test.ts` ③）ので、ここにも作らない。

/** `A-005` 自身。管理ホームからの導線と再取得に使う。 */
export const ADMIN_MONITORING_HREF = '/admin/monitoring';

/** `A-003` テナント詳細（T-03-09）。 */
export function adminTenantDetailHref(tenantId: string): string {
  return `/admin/tenants/${tenantId}`;
}

/**
 * `A-004` 利用量・クォータ（`RATE_LIMIT` の保留と `AI_COST_LIMIT_HELD` の滞留から繋ぐ。docs/04 §A-005 項目 12 / 14）。
 * ⚠️ `A-004`（`/admin/usage`）は T-11-02 が置く。**実装されるまでは `A-003` に倒す**（404 にしない。docs/sprints/SP-11 T-11-04）。
 *    T-11-02 が入ったらこの 1 行を `/admin/usage?targetTenantId=…` に差し替える（呼び出し側は変わらない）。
 */
export function adminTenantQuotaHref(tenantId: string): string {
  return adminTenantDetailHref(tenantId);
}
