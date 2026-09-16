// packages/db/src/platform/queries/tenants.ts
// `A-002`（テナント一覧）/ `A-003`（テナント詳細）の専用クエリ関数
// （docs/05 §5.2「汎用エスケープハッチを作らない担保」/ §5.7 / `F-056`。T-03-09）。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。ここで select する列は
//    「件数の母集団になる ID」と「状態・日時」だけであり、氏名・本文などの内容には
//    一切触れない（そもそも `app_platform` に GRANT されていない。docs/05 §5.5 第 1 層）。
// 🔴 T-11-01: 異常度（健全性）による並び替え（`F-056 AC-2`。docs/05 §6.9 API-A2「T-11-01 の実装の決着」）。
//    - スコアは `@ses/domain` の `scoreTenantHealth`（純粋関数）。ここは材料を揃えて渡すだけ。
//    - 材料は **1 回の `withPlatformRead`** の中で、`tenants` / `memberships` / `users` / `partner_companies` の
//      4 表（いずれも 1 テナントあたり数十行の小さい表）を **`groupBy` / `_max` / `_count` だけ**で全テナント分
//      集計する。エンジニア数・案件数（表示専用。大きい表）は**ページに載る分だけ**数える
//      （docs/03 §4.15「全テナントを毎回スキャンして順位を出す構造にしない」の意図 = 業務データの大表を
//      走査しない、を守る。テナント数は 3 桁を想定し、並びはメモリで確定させる）。
//    - 最終アクティビティ = `users.last_login_at` の最大値（SP-03 からの定義。セッションは 12 時間で切れるため
//      日単位の停滞判定にはこれで足りる。`audit_logs` の MAX は月次パーティション全体の走査になり、かつ
//      運営者・システムの行を除く条件が要るため採らない）。
//    - 使われている席 = 有効な `memberships` のうち、利用者の `last_login_at` が停滞閾値以内のもの。
// 🔴 応答は必ず `packages/db/src/serializers/platform/tenants.ts` の `toPlatformTenant*` を
//    通す（docs/05 §5.5 第 2 層。DB の行をそのまま返さない）。
import {
  assertTenantHealthThresholds,
  DEFAULT_TENANT_LIST_SORT,
  scoreTenantHealth,
  tenantListComparator,
  type TenantHealth,
  type TenantHealthThresholds,
  type TenantLifecycleState,
  type TenantListSortable,
  type TenantListSortKey,
} from '@ses/domain';
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
  /** 直近アクティビティ件数（30 日）・異常度の基準時刻。テストから固定するために引数にする。 */
  readonly now?: Date;
};

export type PlatformTenantListQuery = {
  readonly cursor?: string;
  readonly limit: number;
  /** 既定は `health`（異常度の高い順。`F-056 AC-2`）。 */
  readonly sort?: TenantListSortKey;
};

/**
 * 🔴 閾値は必須である（既定値へのフォールバックを持たない）。出所は `packages/config`
 *    （`apps/web/lib/db/bootstrap.ts` の `tenantHealthRuntime()`）。テストは `DEFAULT_TENANT_HEALTH_THRESHOLDS` を渡す。
 */
export type PlatformTenantListMeta = PlatformRequestMeta & {
  readonly healthThresholds: TenantHealthThresholds;
};

export type PlatformTenantListPage = {
  readonly items: readonly PlatformTenantListItemView[];
  readonly nextCursor: string | null;
  /** 🔴 異常度を算出した時刻（docs/04 §A-002「集計日時」。都度集計であり、日次バッチではない）。 */
  readonly observedAt: string;
};

const RECENT_ACTIVITY_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * 🔴 T-11-01: 異常度の材料（全テナント分）。触れるのは `memberships` / `users` / `partner_companies` の 3 表だけで、
 *    いずれも `groupBy` + `_count` / `_max`。内容の列を select しない。
 *
 * - `seat` … 有効な席（`revoked_at IS NULL`）
 * - `activeMember` … そのうち利用者の `last_login_at >= now − inactiveDays` のもの（使われている席）
 * - `partner` … パートナー数
 * - `lastActivity` … 利用者の `last_login_at` の最大値
 */
async function loadHealthMaterials(
  db: PlatformReadDb,
  now: Date,
  thresholds: TenantHealthThresholds,
): Promise<{
  readonly seat: ReadonlyMap<string, number>;
  readonly activeMember: ReadonlyMap<string, number>;
  readonly partner: ReadonlyMap<string, number>;
  readonly lastActivity: ReadonlyMap<string, Date | null>;
}> {
  const activeSince = new Date(now.getTime() - thresholds.inactiveDays * DAY_MS);
  const [seatGroups, activeGroups, partnerGroups, activityGroups] = await Promise.all([
    db.membership.groupBy({ by: ['tenantId'], where: { revokedAt: null }, _count: true }),
    db.membership.groupBy({
      by: ['tenantId'],
      where: { revokedAt: null, user: { lastLoginAt: { gte: activeSince } } },
      _count: true,
    }),
    db.partnerCompany.groupBy({ by: ['tenantId'], _count: true }),
    db.user.groupBy({ by: ['tenantId'], _max: { lastLoginAt: true } }),
  ]);
  return {
    seat: new Map(seatGroups.map((row) => [row.tenantId, row._count])),
    activeMember: new Map(activeGroups.map((row) => [row.tenantId, row._count])),
    partner: new Map(partnerGroups.map((row) => [row.tenantId, row._count])),
    lastActivity: new Map(activityGroups.map((row) => [row.tenantId, row._max.lastLoginAt])),
  };
}

type ScoredTenant = TenantListSortable & {
  readonly environment: string;
  readonly lifecycleChangedAt: Date;
  readonly lastActivityAt: Date | null;
  readonly seatCount: number;
  readonly activeMemberCount: number;
  readonly partnerCompanyCount: number;
};

/**
 * API-A2（`GET /api/admin/tenants`）。docs/05 §6.9。
 *
 * 🔴 カーソルページング（docs/05 §6.1）。`total` は持たない（一覧 API の一般規約と同じ。
 *    残件数を返すと、将来の絞り込み条件と組み合わせたときに存在の示唆へつながりうるため、
 *    ここでも同じ規律を踏襲する）。
 * 🔴 並びは算出値（スコア）を含むため SQL の `ORDER BY` ではなくメモリで確定させる。カーソルは
 *    「最後に見たテナントの ID」であり、その ID が並びに無ければ（削除・改竄）**空のページ**を返す
 *    （docs/05 §4.8「見えない = 存在しない」。先頭へ戻して同じページを繰り返させない）。
 */
export async function listPlatformTenants(
  ctx: AuthenticatedPlatformCtx,
  query: PlatformTenantListQuery,
  meta: PlatformTenantListMeta,
): Promise<PlatformTenantListPage> {
  // 🔴 閾値の検証は DB に触れる前に行う（不正な設定値で監査行だけ残して 500、にしない）。
  assertTenantHealthThresholds(meta.healthThresholds);
  const now = meta.now ?? new Date();
  const sort = query.sort ?? DEFAULT_TENANT_LIST_SORT;
  return withPlatformRead(
    { ctx, action: 'admin.tenant.list', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const [tenants, materials] = await Promise.all([
        db.tenant.findMany({
          select: {
            id: true,
            name: true,
            environment: true,
            lifecycleState: true,
            lifecycleChangedAt: true,
            createdAt: true,
            sandboxExpiresAt: true,
          },
        }),
        loadHealthMaterials(db, now, meta.healthThresholds),
      ]);

      const scored: ScoredTenant[] = tenants.map((row) => {
        const seatCount = materials.seat.get(row.id) ?? 0;
        // 🔴 同一トランザクション内でも 2 つの groupBy の間に席が増えうる（READ COMMITTED）。
        //    使われている席が席数を超える瞬間値は「全席が使われている」に丸める（500 にしない）。
        const activeMemberCount = Math.min(materials.activeMember.get(row.id) ?? 0, seatCount);
        const partnerCompanyCount = materials.partner.get(row.id) ?? 0;
        const lastActivityAt = materials.lastActivity.get(row.id) ?? null;
        const lifecycleState = row.lifecycleState as TenantLifecycleState;
        const health: TenantHealth = scoreTenantHealth(
          {
            lifecycleState,
            createdAt: row.createdAt,
            lastActivityAt,
            seatCount,
            activeMemberCount,
            partnerCompanyCount,
            sandboxExpiresAt: row.sandboxExpiresAt,
            now,
          },
          meta.healthThresholds,
        );
        return {
          id: row.id,
          name: row.name,
          environment: row.environment,
          lifecycleState,
          lifecycleChangedAt: row.lifecycleChangedAt,
          createdAt: row.createdAt,
          lastActivityAt,
          seatCount,
          activeMemberCount,
          partnerCompanyCount,
          health,
        };
      });
      scored.sort(tenantListComparator(sort));

      let start = 0;
      if (query.cursor !== undefined) {
        const index = scored.findIndex((row) => row.id === query.cursor);
        if (index === -1) return { items: [], nextCursor: null, observedAt: now.toISOString() };
        start = index + 1;
      }
      const page = scored.slice(start, start + query.limit);
      const hasNext = start + query.limit < scored.length;

      // 🔴 エンジニア数・案件数は表示専用。ページに載る分だけ数える（大表を全件走査しない）。
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
          lastActivityAt: row.lastActivityAt,
          seatCount: row.seatCount,
          activeMemberCount: row.activeMemberCount,
          partnerCompanyCount: row.partnerCompanyCount,
          engineerCount: counts.engineer.get(row.id) ?? 0,
          projectCount: counts.project.get(row.id) ?? 0,
          health: row.health,
        }),
      );

      const last = page[page.length - 1];
      return {
        items,
        nextCursor: hasNext && last !== undefined ? last.id : null,
        observedAt: now.toISOString(),
      };
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

      const since = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_DAYS * DAY_MS);
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
