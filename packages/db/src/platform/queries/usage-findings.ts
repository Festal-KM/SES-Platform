// packages/db/src/platform/queries/usage-findings.ts
// 🔴 `A-005` 運用監視の「計測欠測」「ストレージの乖離」行の材料（docs/05 §16.5 / `F-026 AC-4` / `F-059`）。T-10-02。
//
// 画面（`A-005`）の実装は SP-11（T-11-04）であり、本ファイルは**読み取り関数だけ**を置く。
// 🔴 返すのは件数・種別・期間・数値・時刻だけである（`BR-40`。本文・宛先・PII は列としても存在しない。
//    migration 20260919000000）。`admin.monitoring.view` として `AuditLog` に残る（`withPlatformRead`）。
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import type { UsageCounterMetric, UsageMeasurementFindingKind } from '../../schema-value-sets.js';
import type { PlatformRequestMeta } from './admin-home.js';

export type OpenUsageMeasurementFinding = {
  readonly tenantId: string;
  readonly kind: UsageMeasurementFindingKind;
  readonly metric: UsageCounterMetric;
  readonly periodKind: 'DAY' | 'MONTH';
  readonly periodKey: string;
  /** 十進文字列（`Decimal(20,6)`）。正を持たない検知は `null`。 */
  readonly expected: string | null;
  readonly observed: string | null;
  readonly detectedAt: Date;
  readonly lastSeenAt: Date;
};

export type OpenUsageMeasurementFindings = {
  /** 未解消の検知（テナント横断。`lastSeenAt` の新しい順）。 */
  readonly items: readonly OpenUsageMeasurementFinding[];
  /** 種別ごとの未解消件数（`A-005` の行の件数）。 */
  readonly countsByKind: Readonly<Record<UsageMeasurementFindingKind, number>>;
};

/** 1 回の読み取りで返す上限（docs/03 §4.15「運用監視の指標: 直近 7 日」に準じた小さな窓）。 */
const OPEN_FINDINGS_LIMIT = 200;

/**
 * 🔴 未解消の計測欠測・乖離を横断で読む（`targetTenantId: null`）。
 *
 * 個々の行はテナント ID を含む（運営者が対処する相手を特定するため）が、
 * テナント名・利用者・内容には到達しない（`CLAUDE.md` §10.5）。
 */
export async function listOpenUsageMeasurementFindings(
  ctx: AuthenticatedPlatformCtx,
  meta: PlatformRequestMeta = {},
): Promise<OpenUsageMeasurementFindings> {
  return withPlatformRead(
    { ctx, action: 'admin.monitoring.view', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const rows = await db.usageMeasurementFinding.findMany({
        where: { resolvedAt: null },
        orderBy: [{ lastSeenAt: 'desc' }, { periodKey: 'desc' }],
        take: OPEN_FINDINGS_LIMIT,
        select: {
          tenantId: true,
          kind: true,
          metric: true,
          periodKind: true,
          periodKey: true,
          expected: true,
          observed: true,
          detectedAt: true,
          lastSeenAt: true,
        },
      });
      const grouped = await db.usageMeasurementFinding.groupBy({
        by: ['kind'],
        where: { resolvedAt: null },
        _count: { _all: true },
      });
      const countsByKind: Record<UsageMeasurementFindingKind, number> = {
        GAP_MISSING: 0,
        GAP_MISMATCH: 0,
        STORAGE_DIVERGENCE: 0,
      };
      for (const group of grouped) {
        countsByKind[group.kind as UsageMeasurementFindingKind] = group._count._all;
      }
      return {
        items: rows.map((row) => ({
          tenantId: row.tenantId,
          kind: row.kind as UsageMeasurementFindingKind,
          metric: row.metric as UsageCounterMetric,
          periodKind: row.periodKind as 'DAY' | 'MONTH',
          periodKey: row.periodKey,
          expected: row.expected === null ? null : row.expected.toString(),
          observed: row.observed === null ? null : row.observed.toString(),
          detectedAt: row.detectedAt,
          lastSeenAt: row.lastSeenAt,
        })),
        countsByKind,
      };
    },
  );
}
