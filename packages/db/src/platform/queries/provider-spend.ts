// packages/db/src/platform/queries/provider-spend.ts
// 🔴 `A-005` 運用監視の項目 17「組織全体の月間 Anthropic 支出 / tier 上限」の材料
//    （docs/03 §8.2 / §4.5 / docs/02 `F-057` / `F-059` / docs/05 §7.6 / §16.4 / §16.5）。T-11-08。
//
// ============================================================================
// 🔴 テナント別の上限（`F-027`）では防げない事故を、環境全体で見る
// ============================================================================
// Anthropic の tier（Start $500 / Build $1,000 / Scale $200,000 / 月）は**組織全体**の月間支出上限であり、
// 到達すると**全テナントの AI 機能が同時に止まる**（`enforced_spend_limit_reached`。docs/03 §3.3.4 / §8.2）。
// テナント別の 1 日コスト上限（`ai-cost-guard.ts`）や月次件数クォータ（`usage-limits.ts`）は各テナントの
// 逆ざやを防ぐものであり、全テナントの合計が tier の上限に近づいていることは検知できない。
// 本ファイルは `AiUsage` の**全テナント合計**を当月（JST 暦月）で集計し、`ANTHROPIC_MONTHLY_SPEND_CAP_USD`
// に対する水準（`BELOW` / `NEARING` / `REACHED`）を返す。対処するのは運営者（tier 昇格の申請）である。
//
// 🔴 集計は都度行う（日次のスナップショット表を作らない。docs/05 §16.5 項目 17 の決着）。
//    `AiUsage` の当月行は数千〜数万行であり、`(tenant_id, role)` の GROUP BY 1 本で足りる。
//    件数（`AI_UNIT_*`）は数え直さない —— 見るのは金額だけである（docs/05 §7.6「件数の加算」の 🔴）。
//
// 🔴 `packages/db` は `process.env` を読まない。上限（`ANTHROPIC_MONTHLY_SPEND_CAP_USD`）と閾値
//    （`QUOTA_WARNING_THRESHOLD_PERCENT`）は起動時に解決した値を引数で受ける。現在時刻も引数で受ける
//    （期間キーを決定的に検証できるようにする。`listUnverifiedSendingDomains` と同じ規律）。
//
// 🔴 運営者向けなので金額（USD）を返してよい（`CLAUDE.md` §2 の「件数のみ」はテナント利用者向け。§10.4-3）。
//    `@ses/db/platform` からしか到達できず、主平面（`apps/web/app/api/(main)/**`）には露出しない。
//    読むのは `app_platform` に GRANT された列（`tenant_id` / `role` / `estimated_cost_usd` / `started_at`）だけで、
//    `target_type` / `target_id` などの対象には触れない。`admin.monitoring.view` として `AuditLog` に残る。
import {
  AI_ROLES,
  decideLimitLevel,
  formatUsdMicros,
  isAiRole,
  parseUsdMicros,
  usagePeriodKey,
  type AiRole,
  type UsageLimitLevel,
} from '@ses/domain';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import { usagePeriodRange } from '../../usage-period.js';

export type ProviderMonthlySpend = {
  /** 当月の期間キー（`YYYY-MM`。`Asia/Tokyo` の暦。`usagePeriodKey('MONTH', now)`）。 */
  readonly periodKey: string;
  /** 全テナントの当月合計（十進文字列。小数 6 桁。`AiUsage.estimated_cost_usd` の SUM）。 */
  readonly spentUsd: string;
  /** tier の月間支出上限（`ANTHROPIC_MONTHLY_SPEND_CAP_USD`。十進文字列。小数 6 桁）。 */
  readonly capUsd: string;
  /** `spentUsd / capUsd`（0〜。1 を超えうる = 上限を超えて計上されている）。表示専用。 */
  readonly consumptionRate: number;
  /**
   * 水準。`NEARING` = `warnPercent`（既定 80%）以上 / `REACHED` = 100% 以上。
   * 🔴 判定は `decideLimitLevel`（`packages/domain`。テナント別上限と**同じ 1 実装**）。
   */
  readonly level: UsageLimitLevel;
  /** ロール別内訳（6 ロール固定。当月に行が無いロールは `'0.000000'`）。`F-057` の材料。 */
  readonly byRole: Readonly<Record<AiRole, string>>;
  /** 当月に `AiUsage` の行を持つテナントの数（誰かを特定しない。件数だけ）。 */
  readonly tenantCount: number;
  /** 集計時刻（= 引数の `now`）。 */
  readonly observedAt: Date;
};

export type ProviderMonthlySpendMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（関数内で `new Date()` を呼ばない）。 */
  readonly now: Date;
  /** `ANTHROPIC_MONTHLY_SPEND_CAP_USD`（`packages/config`。正の数）。 */
  readonly capUsd: number;
  /** `QUOTA_WARNING_THRESHOLD_PERCENT`（`packages/config`。1〜99 の整数。既定 80）。 */
  readonly warnPercent: number;
};

/** `db.aiUsage.groupBy({ by: ['tenantId', 'role'], _sum: { estimatedCostUsd } })` の 1 行分（Decimal は十進文字列に落としたもの）。 */
export type ProviderSpendGroup = {
  readonly tenantId: string;
  readonly role: string;
  /** 十進文字列（`Decimal(12,6)` の SUM）。 */
  readonly costUsd: string;
};

export type ProviderSpendSummaryInput = {
  readonly periodKey: string;
  readonly groups: readonly ProviderSpendGroup[];
  readonly capUsd: number;
  readonly warnPercent: number;
  readonly observedAt: Date;
};

const USD_DECIMAL_PLACES = 6;

/**
 * `packages/config` の `number` を `parseUsdMicros` が受け取れる十進文字列にする。
 * 🔴 `NaN` / 無限大 / 0 以下は落とす（上限が壊れていると水準の判定が無意味になる。`decideLimitLevel` も
 *    `limit <= 0` を拒むが、`toFixed` の手前で止めないと `'NaN'` が `parseUsdMicros` の RangeError になり原因が読めない）。
 */
function capUsdToDecimalString(capUsd: number): string {
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    throw new RangeError(`capUsd は正の有限数である必要があります（受け取った値: ${capUsd}）。`);
  }
  return capUsd.toFixed(USD_DECIMAL_PLACES);
}

/**
 * 🔴 集計行 → DTO（純粋関数。I/O なし）。合計・ロール別・水準・消費率を**同じ micro-USD の整数**から出す
 *    （判定と表示を別々に計算しない。`providerQuotaUsage` と同じ理由）。
 */
export function summarizeProviderSpend(input: ProviderSpendSummaryInput): ProviderMonthlySpend {
  const capMicros = parseUsdMicros(capUsdToDecimalString(input.capUsd));
  const byRoleMicros = new Map<AiRole, bigint>(AI_ROLES.map((role) => [role, 0n]));
  const tenantIds = new Set<string>();
  let spentMicros = 0n;
  for (const group of input.groups) {
    if (!isAiRole(group.role)) {
      // 🔴 `ai_usage_role_check` が DB で保証している。来たら CHECK と `AI_ROLES` がずれているので黙って捨てない。
      throw new Error(`ai_usage.role に未知の値があります（${group.role}）。AI_ROLES と CHECK 制約の突合を確認してください。`);
    }
    const micros = parseUsdMicros(group.costUsd);
    byRoleMicros.set(group.role, (byRoleMicros.get(group.role) ?? 0n) + micros);
    spentMicros += micros;
    tenantIds.add(group.tenantId);
  }
  const byRole = Object.fromEntries(
    AI_ROLES.map((role) => [role, formatUsdMicros(byRoleMicros.get(role) ?? 0n)]),
  ) as Record<AiRole, string>;
  return {
    periodKey: input.periodKey,
    spentUsd: formatUsdMicros(spentMicros),
    capUsd: formatUsdMicros(capMicros),
    consumptionRate: Number(spentMicros) / Number(capMicros),
    level: decideLimitLevel({ used: spentMicros, limit: capMicros, warnPercent: input.warnPercent }),
    byRole,
    tenantCount: tenantIds.size,
    observedAt: input.observedAt,
  };
}

/**
 * 🔴 当月（JST 暦月）の `AiUsage` を全テナント横断で合計し、tier 上限に対する水準を返す（`targetTenantId: null`）。
 *
 * 返すのは金額・水準・件数・期間・時刻だけである。テナント ID は返さない（環境全体。`A-003` / `A-004` への
 * 導線を描かない根拠。`tenantCount` は件数のみ）。`CLAUDE.md` §10.5 の非開示（内容）には触れない。
 */
export async function readProviderMonthlySpend(
  ctx: AuthenticatedPlatformCtx,
  meta: ProviderMonthlySpendMeta,
): Promise<ProviderMonthlySpend> {
  // 🔴 `withPlatformRead` の前に検査する（不正な上限で監査行だけ残る状態にしない）。
  //    `warnPercent` の範囲（1〜99 の整数）は `decideLimitLevel` が検査する（`packages/config` が起動時に保証済み）。
  capUsdToDecimalString(meta.capUsd);
  const periodKey = usagePeriodKey('MONTH', meta.now);
  const range = usagePeriodRange('MONTH', periodKey);
  return withPlatformRead(
    { ctx, action: 'admin.monitoring.view', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const rows = await db.aiUsage.groupBy({
        by: ['tenantId', 'role'],
        where: { startedAt: { gte: range.startAt, lt: range.endAt } },
        _sum: { estimatedCostUsd: true },
      });
      const groups: ProviderSpendGroup[] = rows.map((row) => ({
        tenantId: row.tenantId,
        role: row.role,
        // 🔴 `toFixed(6)` で固定小数の十進文字列にする（`toString()` は桁により指数表記になりうる）。
        costUsd:
          row._sum.estimatedCostUsd === null
            ? formatUsdMicros(0n)
            : row._sum.estimatedCostUsd.toFixed(USD_DECIMAL_PLACES),
      }));
      return summarizeProviderSpend({
        periodKey,
        groups,
        capUsd: meta.capUsd,
        warnPercent: meta.warnPercent,
        observedAt: meta.now,
      });
    },
  );
}
