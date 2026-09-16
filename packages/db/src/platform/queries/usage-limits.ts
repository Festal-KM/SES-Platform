// packages/db/src/platform/queries/usage-limits.ts
// 🔴 `F-057`（運営者の利用量・クォータ監視 = `A-004`）への「上限接近・到達の通知」の材料
//    （docs/02 `F-027` 処理④「テナント管理者と `F-057` に通知」/ docs/05 §5.8 / §16.4）。T-10-03。
//
// 画面（`A-004` / `A-005`）の実装は SP-11 / SP-20 であり、本ファイルは**読み取り関数だけ**を置く。
// 🔴 返すのはテナント ID・計測・水準・期間・時刻だけである（`usage_limit_states` に金額の列は無い。
//    運営者向けの金額は `A-004` が `usage_counters` から別途読む。docs/03 §7.6.3-2）。
//    `admin.monitoring.view` として `AuditLog` に残る（`withPlatformRead`）。
import type { UsageLimitLevel, UsageLimitMetric } from '@ses/domain';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import type { PlatformRequestMeta } from './admin-home.js';

export type UsageLimitAlert = {
  readonly tenantId: string;
  readonly metric: UsageLimitMetric;
  readonly level: Exclude<UsageLimitLevel, 'BELOW'>;
  readonly levelSince: Date;
  readonly periodKind: 'DAY' | 'MONTH';
  readonly periodKey: string;
  readonly evaluatedAt: Date;
};

export type UsageLimitAlerts = {
  /** 接近・到達中の行（テナント横断。到達 → 接近、古い順）。 */
  readonly items: readonly UsageLimitAlert[];
  readonly countsByLevel: Readonly<Record<Exclude<UsageLimitLevel, 'BELOW'>, number>>;
};

const ALERTS_LIMIT = 500;

/**
 * 🔴 接近（80%）・到達中のテナント × 計測を横断で読む（`targetTenantId: null`）。
 *
 * 個々の行はテナント ID を含む（運営者が対処する相手を特定するため）が、
 * テナント名・利用者・内容には到達しない（`CLAUDE.md` §10.5）。
 */
export async function listUsageLimitAlerts(
  ctx: AuthenticatedPlatformCtx,
  meta: PlatformRequestMeta = {},
): Promise<UsageLimitAlerts> {
  return withPlatformRead(
    { ctx, action: 'admin.monitoring.view', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const rows = await db.usageLimitState.findMany({
        where: { level: { in: ['NEARING', 'REACHED'] } },
        orderBy: [{ level: 'desc' }, { levelSince: 'asc' }],
        take: ALERTS_LIMIT,
        select: {
          tenantId: true,
          metric: true,
          level: true,
          levelSince: true,
          periodKind: true,
          periodKey: true,
          evaluatedAt: true,
        },
      });
      const countsByLevel: Record<Exclude<UsageLimitLevel, 'BELOW'>, number> = { NEARING: 0, REACHED: 0 };
      const items: UsageLimitAlert[] = [];
      for (const row of rows) {
        const level = row.level as Exclude<UsageLimitLevel, 'BELOW'>;
        countsByLevel[level] += 1;
        items.push({
          tenantId: row.tenantId,
          metric: row.metric as UsageLimitMetric,
          level,
          levelSince: row.levelSince,
          periodKind: row.periodKind as 'DAY' | 'MONTH',
          periodKey: row.periodKey,
          evaluatedAt: row.evaluatedAt,
        });
      }
      return { items, countsByLevel };
    },
  );
}
