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

/** `A-004` 利用量・クォータ管理（T-11-02）。管理ホームからの導線と再取得に使う。 */
export const ADMIN_USAGE_HREF = '/admin/usage';

/**
 * `A-004` 利用量・クォータ（`RATE_LIMIT` の保留と `AI_COST_LIMIT_HELD` の滞留から繋ぐ。docs/04 §A-005 項目 12 / 14）。
 * ✅ T-11-02: `A-004`（`/admin/usage`）が入ったので、対象テナントの行を先頭に出す `?targetTenantId=` で繋ぐ
 *    （T-11-04 が `A-003` に倒していた 1 行の差し替え。呼び出し側は変わらない）。
 */
export function adminTenantQuotaHref(tenantId: string): string {
  return `${ADMIN_USAGE_HREF}?targetTenantId=${encodeURIComponent(tenantId)}`;
}

/**
 * ✅ T-10-10: `A-010` 契約管理（Phase 1 はセクション 4「削除完了の確認」だけ。docs/04 §A-010）。
 * 🔴 導線の出所は `A-003`（`CLOSING` / `PURGED` のとき）だけ。`A-005` 項目 7（削除ジョブの失敗）からは繋がない ——
 *    `A-005` は「失敗している異常」、`A-010` は「完了したか」を示す別の役割であり、同じ確認を 2 経路にしない（`F-062 AC-7`）。
 */
export function adminTenantContractHref(tenantId: string): string {
  return `/admin/tenants/${tenantId}/contract`;
}
