// apps/web/lib/admin-usage/view.ts
// API-A6 `GET /api/admin/usage` の応答の形（docs/05 §6.9 API-A6 / docs/04 §A-004 / `F-057` / `F-063 AC-5`）。T-11-02。
//
// 🔴 `@ses/db/platform` を import しない（ESLint の ADMIN_PLANE_ZONE は `apps/web/app/admin/**` / `apps/web/app/api/admin/**`
//    だけに許す。`admin-monitoring/view.ts` と同じ整理）。ここにあるのは**純粋な型と純粋関数**だけであり、
//    `'use client'` の画面はこのファイルの型を参照する（`tests/static/client-db-boundary.test.ts`）。
//    `@ses/db/platform` の DTO（`PlatformUsageSnapshot`）との突合は、ルート側（`apps/web/app/api/admin/usage/route.ts`）が
//    `toAdminUsageView` に渡す時点で構造的に型検査される（キーを増やしても減らしてもコンパイルで落ちる）。
// 🔴 **金額（USD）を含む**のは運営者向けだからである（`CLAUDE.md` §2 課金 / `F-027 AC-6`）。この型を主平面
//    （`apps/web/app/api/(main)/**` / `apps/web/lib/usage/view.ts`）へ写さない。
import type { AiRole, AiUnitMetric, ConsumptionBand, UsageLimitLevel } from '@ses/domain';
import type { AdminUsageFilter } from './schemas';

export type AdminQuotaSourceView = {
  readonly source: 'DEFAULT' | 'OVERRIDE';
  readonly effectiveFrom: string | null;
  readonly pending: { readonly limit: string; readonly effectiveFrom: string; readonly lowering: boolean } | null;
};

export type AdminCountQuotaView = {
  readonly used: number;
  readonly limit: number;
  readonly consumptionPercent: number;
  readonly level: UsageLimitLevel | null;
  readonly quota: AdminQuotaSourceView;
};

export type AdminUsageTenantRow = {
  readonly tenantId: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly environment: string;
  readonly seatsUsed: number;
  readonly aiUnits: Readonly<Record<AiUnitMetric, AdminCountQuotaView & { readonly standardCostUsd: string }>>;
  readonly email: AdminCountQuotaView;
  readonly storage: {
    readonly usedBytes: string;
    readonly limitBytes: string;
    readonly consumptionPercent: number;
    readonly level: UsageLimitLevel | null;
    readonly quota: AdminQuotaSourceView;
  };
  readonly aiDaily: {
    readonly costUsd: string;
    readonly limitUsd: string;
    readonly consumptionPercent: number;
    readonly level: UsageLimitLevel | null;
  };
  readonly aiMonthly: {
    readonly costUsd: string;
    readonly capUsd: string;
    readonly consumptionPercent: number;
    readonly byRole: Readonly<Record<AiRole, string>>;
    readonly standardCostUsd: string;
    readonly unitCostRatio: number | null;
    readonly baselineRatio: number;
  };
  readonly peakPercent: number;
  readonly band: ConsumptionBand;
};

/** 環境全体の当月 AI 支出 / tier 上限（`readProviderMonthlySpend` の DTO を JSON にしたもの。`byRole` 6 ロール固定）。 */
export type AdminUsageEnvironmentView = {
  readonly periodKey: string;
  readonly spentUsd: string;
  readonly capUsd: string;
  readonly consumptionRate: number;
  readonly level: UsageLimitLevel;
  readonly byRole: Readonly<Record<AiRole, string>>;
  readonly tenantCount: number;
  readonly observedAt: string;
};

export type AdminUsageView = {
  readonly observedAt: string;
  readonly dayKey: string;
  readonly monthKey: string;
  readonly warnPercent: number;
  readonly lowPercent: number;
  /** 🔴 環境全体（テナント行とは別集計・別行）。 */
  readonly environment: AdminUsageEnvironmentView;
  readonly filter: AdminUsageFilter;
  /** 抽出前の全テナント数（抽出結果が 0 件でも「テナントが無い」と誤読させない）。 */
  readonly totalTenants: number;
  readonly items: readonly AdminUsageTenantRow[];
};

/** ルートが受け取る `@ses/db/platform` の DTO と構造的に一致する入力（`Date` を持つ）。 */
export type AdminUsageSnapshotInput = {
  readonly observedAt: Date;
  readonly dayKey: string;
  readonly monthKey: string;
  readonly warnPercent: number;
  readonly lowPercent: number;
  readonly environment: Omit<AdminUsageEnvironmentView, 'observedAt'> & { readonly observedAt: Date };
  readonly tenants: readonly AdminUsageTenantRow[];
};

/** 抽出（`F-057 AC-1`）。`all` は素通し。帯の判定は `@ses/db/platform` 側（`classifyConsumptionBand`）で済んでいる。 */
export function applyUsageFilter<T extends { readonly band: ConsumptionBand }>(
  items: readonly T[],
  filter: AdminUsageFilter,
): readonly T[] {
  if (filter === 'all') return items;
  const band: ConsumptionBand = filter === 'low' ? 'LOW' : 'HIGH';
  return items.filter((item) => item.band === band);
}

export function toAdminUsageView(snapshot: AdminUsageSnapshotInput, filter: AdminUsageFilter): AdminUsageView {
  return {
    observedAt: snapshot.observedAt.toISOString(),
    dayKey: snapshot.dayKey,
    monthKey: snapshot.monthKey,
    warnPercent: snapshot.warnPercent,
    lowPercent: snapshot.lowPercent,
    environment: { ...snapshot.environment, observedAt: snapshot.environment.observedAt.toISOString() },
    filter,
    totalTenants: snapshot.tenants.length,
    items: applyUsageFilter(snapshot.tenants, filter),
  };
}
