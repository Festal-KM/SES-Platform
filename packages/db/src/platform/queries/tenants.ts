// packages/db/src/platform/queries/tenants.ts
// `A-002`（テナント一覧）/ `A-003`（テナント詳細）の専用クエリ関数
// （docs/05 §5.2「汎用エスケープハッチを作らない担保」/ §5.7 / `F-056`。T-03-09）。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。ここで select する列は
//    「件数の母集団になる ID」と「状態・日時」だけであり、氏名・本文などの内容には
//    一切触れない（そもそも `app_platform` に GRANT されていない。docs/05 §5.5 第 1 層）。
// 🔴 異常度（健全性）による並び替えは Phase 1（SP-11。`docs/dev-plan.md` `PM-A-04`）。
//    ここでは決定的な `createdAt` 降順のみを持つ。
// 🔴 応答は必ず `packages/db/src/serializers/platform/tenants.ts` の `toPlatformTenant*` を
//    通す（docs/05 §5.5 第 2 層。DB の行をそのまま返さない）。
import { withPlatformRead, type PlatformReadDb } from '../../platform.js';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import {
  toPlatformTenantDetail,
  toPlatformTenantListItem,
  type PlatformTenantDetailView,
  type PlatformTenantListItemView,
} from '../../serializers/platform/tenants.js';

export type PlatformRequestMeta = {
  readonly ipAddress?: string | null;
  /** 直近アクティビティ件数（30 日）の基準時刻。テストから固定するために引数にする。 */
  readonly now?: Date;
};

export type PlatformTenantListQuery = {
  readonly cursor?: string;
  readonly limit: number;
};

export type PlatformTenantListPage = {
  readonly items: readonly PlatformTenantListItemView[];
  readonly nextCursor: string | null;
};

const RECENT_ACTIVITY_WINDOW_DAYS = 30;

type TenantCounts = {
  readonly seat: ReadonlyMap<string, number>;
  readonly partner: ReadonlyMap<string, number>;
  readonly engineer: ReadonlyMap<string, number>;
  readonly project: ReadonlyMap<string, number>;
  readonly lastActivity: ReadonlyMap<string, Date | null>;
};

const EMPTY_COUNTS: TenantCounts = {
  seat: new Map(),
  partner: new Map(),
  engineer: new Map(),
  project: new Map(),
  lastActivity: new Map(),
};

/**
 * テナントごとの母集団（件数のみ）。氏名・本文など内容には一切触れない
 * （`membership` / `partnerCompany` / `engineer` / `project` は ID と件数の母集団としてのみ使う）。
 */
async function loadTenantCounts(
  db: PlatformReadDb,
  tenantIds: readonly string[],
): Promise<TenantCounts> {
  if (tenantIds.length === 0) return EMPTY_COUNTS;
  const ids = [...tenantIds];
  const [seatGroups, partnerGroups, engineerGroups, projectGroups, activityGroups] =
    await Promise.all([
      // 🔴 有効な所属のみ（`revokedAt IS NULL`）を席数として数える。
      db.membership.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, revokedAt: null },
        _count: true,
      }),
      db.partnerCompany.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: true }),
      db.engineer.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: true }),
      db.project.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: true }),
      db.user.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids } },
        _max: { lastLoginAt: true },
      }),
    ]);
  return {
    seat: new Map(seatGroups.map((row) => [row.tenantId, row._count])),
    partner: new Map(partnerGroups.map((row) => [row.tenantId, row._count])),
    engineer: new Map(engineerGroups.map((row) => [row.tenantId, row._count])),
    project: new Map(projectGroups.map((row) => [row.tenantId, row._count])),
    lastActivity: new Map(activityGroups.map((row) => [row.tenantId, row._max.lastLoginAt])),
  };
}

/**
 * API-A2（`GET /api/admin/tenants`）。docs/05 §6.9。
 *
 * 🔴 カーソルページング（docs/05 §6.1）。`total` は持たない（一覧 API の一般規約と同じ。
 *    残件数を返すと、将来の絞り込み条件と組み合わせたときに存在の示唆へつながりうるため、
 *    ここでも同じ規律を踏襲する）。
 */
export async function listPlatformTenants(
  ctx: AuthenticatedPlatformCtx,
  query: PlatformTenantListQuery,
  meta: PlatformRequestMeta = {},
): Promise<PlatformTenantListPage> {
  return withPlatformRead(
    { ctx, action: 'admin.tenant.list', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const take = query.limit + 1;
      const rows = await db.tenant.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
        select: {
          id: true,
          name: true,
          environment: true,
          lifecycleState: true,
          lifecycleChangedAt: true,
          createdAt: true,
        },
      });

      const hasNext = rows.length > query.limit;
      const page = hasNext ? rows.slice(0, query.limit) : rows;
      const counts = await loadTenantCounts(
        db,
        page.map((row) => row.id),
      );

      const items = page.map((row) =>
        toPlatformTenantListItem({
          id: row.id,
          name: row.name,
          environment: row.environment,
          lifecycleState: row.lifecycleState,
          lifecycleChangedAt: row.lifecycleChangedAt,
          createdAt: row.createdAt,
          lastActivityAt: counts.lastActivity.get(row.id) ?? null,
          seatCount: counts.seat.get(row.id) ?? 0,
          partnerCompanyCount: counts.partner.get(row.id) ?? 0,
          engineerCount: counts.engineer.get(row.id) ?? 0,
          projectCount: counts.project.get(row.id) ?? 0,
        }),
      );

      const last = page[page.length - 1];
      return { items, nextCursor: hasNext && last !== undefined ? last.id : null };
    },
  );
}

/**
 * API-A3（`GET /api/admin/tenants/{id}`）。docs/05 §6.9。
 *
 * 🔴 存在しなければ `null` を返す（404 への写像は呼び出し側。docs/05 §4.8）。
 * 🔴 `PURGED` のときは件数クエリを 1 つも発行しない（削除件数を含めない。
 *    docs/04 program-design 申し送り 15 / `F-062 AC-7`）。
 */
export async function getPlatformTenantDetail(
  ctx: AuthenticatedPlatformCtx,
  tenantId: string,
  meta: PlatformRequestMeta = {},
): Promise<PlatformTenantDetailView | null> {
  const now = meta.now ?? new Date();
  return withPlatformRead(
    {
      ctx,
      action: 'admin.tenant.view',
      targetTenantId: tenantId,
      targetType: 'Tenant',
      targetId: tenantId,
      ipAddress: meta.ipAddress ?? null,
    },
    async (db) => {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          environment: true,
          lifecycleState: true,
          lifecycleChangedAt: true,
          createdAt: true,
          sandboxExpiresAt: true,
          closingEnteredAt: true,
        },
      });
      if (tenant === null) return null;

      if (tenant.lifecycleState === 'PURGED') {
        return toPlatformTenantDetail({
          id: tenant.id,
          name: tenant.name,
          environment: tenant.environment,
          lifecycleState: tenant.lifecycleState,
          lifecycleChangedAt: tenant.lifecycleChangedAt,
          createdAt: tenant.createdAt,
          sandboxExpiresAt: null,
          closingEnteredAt: null,
          lastActivityAt: null,
          seatCount: 0,
          partnerCompanyCount: 0,
          engineerCount: 0,
          projectCount: 0,
          proposalCount: 0,
          recentActivityCount30d: 0,
        });
      }

      const since = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const [counts, proposalCount, recentActivityCount30d] = await Promise.all([
        loadTenantCounts(db, [tenant.id]),
        db.proposal.count({ where: { tenantId: tenant.id } }),
        db.auditLog.count({ where: { tenantId: tenant.id, createdAt: { gte: since } } }),
      ]);

      return toPlatformTenantDetail({
        id: tenant.id,
        name: tenant.name,
        environment: tenant.environment,
        lifecycleState: tenant.lifecycleState,
        lifecycleChangedAt: tenant.lifecycleChangedAt,
        createdAt: tenant.createdAt,
        sandboxExpiresAt: tenant.sandboxExpiresAt,
        closingEnteredAt: tenant.closingEnteredAt,
        lastActivityAt: counts.lastActivity.get(tenant.id) ?? null,
        recentActivityCount30d,
        seatCount: counts.seat.get(tenant.id) ?? 0,
        partnerCompanyCount: counts.partner.get(tenant.id) ?? 0,
        engineerCount: counts.engineer.get(tenant.id) ?? 0,
        projectCount: counts.project.get(tenant.id) ?? 0,
        proposalCount,
      });
    },
  );
}
