// packages/db/src/serializers/platform/tenants.ts
// `A-002`（テナント一覧）/ `A-003`（テナント詳細）の運営者向けシリアライザ
// （docs/05 §5.5 第 2 層 / §5.7 / `F-056` / `BR-40`。T-03-09）。
//
// 🔴 管理平面の Route Handler は DB の行をそのまま返さない。ここが「応答に出してよい
//    フィールド」の唯一の一覧である。第 1 層（`app_platform` への列レベル `GRANT`。
//    docs/05 §5.5）は「取得できる列」を絞るが、取得できる列の中にも内部識別子
//    （`lifecycleChangedBy` 等）が混じりうるため、「見せてよい列」をここで明示的に
//    列挙し直す（二重の絞り込み）。
//
// 🔴 `PlatformTenant*Row` はクエリ関数（`packages/db/src/platform/queries/tenants.ts`）が
//    組み立てる中間表現であり、Prisma の行をそのまま渡さない（列が増えても呼び出し側が
//    明示的に足さない限りここには現れない）。
import type { TenantLifecycleState } from '../../context.js';

export type PlatformTenantCounts = {
  readonly seatCount: number;
  readonly partnerCompanyCount: number;
  readonly engineerCount: number;
  readonly projectCount: number;
};

export type PlatformTenantListRow = {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly lifecycleState: string;
  readonly lifecycleChangedAt: Date;
  readonly createdAt: Date;
  readonly lastActivityAt: Date | null;
} & PlatformTenantCounts;

/** `GET /api/admin/tenants`（API-A2）の一覧項目。 */
export type PlatformTenantListItemView = {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly lifecycleState: TenantLifecycleState;
  readonly lifecycleChangedAt: string;
  readonly createdAt: string;
  /** 🔴 最終アクティビティ（`users.last_login_at` の最大値）。記録が無ければ `null`。 */
  readonly lastActivityAt: string | null;
  readonly seatCount: number;
  readonly partnerCompanyCount: number;
  readonly engineerCount: number;
  readonly projectCount: number;
};

/** 🔴 応答に出してよいフィールドの明示列挙。Prisma の行を Object.assign で素通しさせない。 */
export function toPlatformTenantListItem(row: PlatformTenantListRow): PlatformTenantListItemView {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    lifecycleState: row.lifecycleState as TenantLifecycleState,
    lifecycleChangedAt: row.lifecycleChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt === null ? null : row.lastActivityAt.toISOString(),
    seatCount: row.seatCount,
    partnerCompanyCount: row.partnerCompanyCount,
    engineerCount: row.engineerCount,
    projectCount: row.projectCount,
  };
}

export type PlatformTenantDetailRow = PlatformTenantListRow & {
  readonly sandboxExpiresAt: Date | null;
  readonly closingEnteredAt: Date | null;
  readonly proposalCount: number;
  /** 🔴 直近 30 日の監査ログ件数（`docs/04` §A-003 セクション 3「直近 30 日の操作件数」）。 */
  readonly recentActivityCount30d: number;
};

/**
 * `GET /api/admin/tenants/{id}`（API-A3）の詳細。
 *
 * 🔴 `PURGED` は判別共用体で**型として**他の枝と分離する（`docs/04` program-design 申し送り 15 /
 *    `F-062 AC-7`）。件数フィールドを持てないため、呼び出し側が誤って件数を混ぜて返す実装を
 *    コンパイルの時点で拒む（`home/types.ts` の `HomeBlock` と同じ「型で塞ぐ」規律）。
 */
export type PlatformTenantDetailView =
  | {
      readonly id: string;
      readonly name: string;
      readonly lifecycleState: 'PURGED';
      readonly lifecycleChangedAt: string;
    }
  | {
      readonly id: string;
      readonly name: string;
      readonly environment: string;
      readonly lifecycleState: Exclude<TenantLifecycleState, 'PURGED'>;
      readonly lifecycleChangedAt: string;
      readonly createdAt: string;
      readonly sandboxExpiresAt: string | null;
      readonly closingEnteredAt: string | null;
      readonly lastActivityAt: string | null;
      readonly recentActivityCount30d: number;
      readonly seatCount: number;
      readonly partnerCompanyCount: number;
      readonly engineerCount: number;
      readonly projectCount: number;
      readonly proposalCount: number;
    };

export function toPlatformTenantDetail(row: PlatformTenantDetailRow): PlatformTenantDetailView {
  if (row.lifecycleState === 'PURGED') {
    // 🔴 削除件数を含めない（削除完了の確認は API-A12 の 1 本のみ。docs/05 §6.9 API-A3）。
    return {
      id: row.id,
      name: row.name,
      lifecycleState: 'PURGED',
      lifecycleChangedAt: row.lifecycleChangedAt.toISOString(),
    };
  }
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    lifecycleState: row.lifecycleState as Exclude<TenantLifecycleState, 'PURGED'>,
    lifecycleChangedAt: row.lifecycleChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    sandboxExpiresAt: row.sandboxExpiresAt === null ? null : row.sandboxExpiresAt.toISOString(),
    closingEnteredAt: row.closingEnteredAt === null ? null : row.closingEnteredAt.toISOString(),
    lastActivityAt: row.lastActivityAt === null ? null : row.lastActivityAt.toISOString(),
    recentActivityCount30d: row.recentActivityCount30d,
    seatCount: row.seatCount,
    partnerCompanyCount: row.partnerCompanyCount,
    engineerCount: row.engineerCount,
    projectCount: row.projectCount,
    proposalCount: row.proposalCount,
  };
}
