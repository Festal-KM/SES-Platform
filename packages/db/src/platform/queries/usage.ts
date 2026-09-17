// packages/db/src/platform/queries/usage.ts
// 🔴 `A-004` 利用量・クォータ管理（docs/04 §A-004 / docs/05 §6.9 API-A6 `GET /api/admin/usage` / docs/02 `F-057 AC-1` / `AC-5` /
//    `F-063 AC-5` / `F-027 AC-6` / docs/03 §7.6.3-2 / `CLAUDE.md` §2 課金「運営者には金額と件数の両方」）。T-11-02。
//
// ============================================================================
// 🔴 金額（USD）が現れるのは管理平面だけである
// ============================================================================
// テナント利用者の `GET /api/usage`（`apps/web/lib/usage/view.ts`）は件数・通数・バイト数だけを返し、型テストが金額のキーを
// 弾く（`F-027 AC-6`）。本ファイルの DTO は `@ses/db/platform` からしか到達できず、主平面（`apps/web/app/api/(main)/**`）は
// この サブパスを import できない（ESLint の ADMIN_PLANE_ZONE）。**この DTO を主平面へ写さない。**
//
// ============================================================================
// 🔴 1 回の `withPlatformRead`（`admin.usage.view`）で全材料を読む
// ============================================================================
// テナント数は 3 桁を想定し、材料はいずれも小さい表（`usage_counters` の当日 / 当月行、`usage_limit_states`、
// `tenant_quota_overrides`、`ai_usage` の `GROUP BY tenant_id, role` 1 本）である。画面 1 回の読み込みで監査行は 1 本
// （T-11-08 の申し送り ③「1 画面 1 行に畳みたければ `withPlatformRead` を 1 回にして中で複数の材料を読む」）。
// 環境全体の当月 AI 支出（項目 17 の材料）は**同じ `ai_usage` の集計行**から `summarizeProviderSpend`（純粋部分）で出し、
// テナント行とは**別の集計・別の行**として返す（環境枠の到達をテナントの上限到達と混同させない）。
//
// ============================================================================
// 🔴 2 つの「倍率」（docs/03 §7.5-3 / §7.6.3-2 / `F-063 AC-5`）
// ============================================================================
//   - `baselineRatio` … テナントの当月 AI 原価 ÷ 基準ユニットの月間 AI 原価（$12.82）。「どれだけ大きい客か」
//   - `unitCostRatio` … 単位を持つロールの実原価 ÷ Σ(件数 × 1 件あたり標準原価)。「1 件あたりの実原価が表からどれだけ離れたか」。
//     1 件あたり標準原価の改定が要るかをここで検知する（件数と金額を同一画面で突き合わせる）
//
// 🔴 応答に載せるのはテナント名・件数・金額・比率・水準・日付・ID だけである。利用者名・メール・エンジニア・案件・提案・
//    本文には触れない（`BR-40`）。`ai_usage` の対象（`target_*`）・モデル・プロンプト版にも触れない（T-11-08 の申し送り ⑥）。
import {
  AI_ROLES,
  AI_UNIT_METRICS,
  AI_UNIT_STANDARD_COST_USD_V1,
  classifyConsumptionBand,
  computeUnitCostRatio,
  consumptionPercent,
  formatUsdMicros,
  isAiRole,
  isQuotaOverrideMetric,
  parseUsdMicros,
  PRICING_RULESET_V1,
  QUOTA_LOW_CONSUMPTION_PERCENT,
  QUOTA_OVERRIDE_METRICS,
  resolveQuotaLimit,
  selectPendingQuotaOverride,
  USAGE_LIMIT_LEVELS,
  usagePeriodKey,
  type AiRole,
  type AiUnitMetric,
  type ConsumptionBand,
  type QuotaOverrideMetric,
  type QuotaOverrideRow,
  type UsageLimitLevel,
  type UsageLimitMetric,
} from '@ses/domain';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import type { TenantQuotaDefaults } from '../../quota-overrides.js';
import { usagePeriodRange } from '../../usage-period.js';
import {
  summarizeProviderSpend,
  type ProviderMonthlySpend,
  type ProviderSpendGroup,
} from './provider-spend.js';

const USD_DECIMAL_PLACES = 6;

export type PlatformUsageMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（期間キーを決定的に検証できるようにする）。 */
  readonly now: Date;
  /** `QUOTA_WARNING_THRESHOLD_PERCENT`（既定 80）。到達・接近と「上限に張り付く」の閾値。 */
  readonly warnPercent: number;
  /** 上書きが無いときの上限（`packages/config`）。ワーカーの `usage.limit-check` と同じキーから渡す。 */
  readonly defaults: TenantQuotaDefaults;
  /** `AI_DAILY_COST_LIMIT_USD_DEFAULT`（USD。正の数）。テナントの 1 日の AI コスト上限（遮断器）。 */
  readonly aiDailyCostLimitUsd: number;
  /** `AI_MONTHLY_COST_CAP_USD_DEFAULT`（USD。正の数）。運営者の内部指標（docs/03 §7.5-4。プランの金額上限が入るまでの既定値）。 */
  readonly aiMonthlyCostCapUsd: number;
  /** `ANTHROPIC_MONTHLY_SPEND_CAP_USD`（環境全体の tier 上限）。 */
  readonly providerCapUsd: number;
};

/** 上書きの出所と予定（`A-004` の「クォータ」列）。 */
export type PlatformQuotaSourceView = {
  readonly source: 'DEFAULT' | 'OVERRIDE';
  /** 効いている上書きの適用日（`YYYY-MM-DD`）。既定値なら `null`。 */
  readonly effectiveFrom: string | null;
  /** 予定されている上書き（適用日 > 今日）。無ければ `null`。 */
  readonly pending: { readonly limit: string; readonly effectiveFrom: string; readonly lowering: boolean } | null;
};

/** 件数・通数の上限 1 つ（AI 4 単位 / メール日次）。 */
export type PlatformCountQuotaView = {
  readonly used: number;
  readonly limit: number;
  /** 消化率（%。整数。切り捨て。100 を超えうる）。 */
  readonly consumptionPercent: number;
  /** `usage_limit_states` の水準（ワーカーの評価。未評価なら `null`。最大 10 分遅れる）。 */
  readonly level: UsageLimitLevel | null;
  readonly quota: PlatformQuotaSourceView;
};

export type PlatformTenantUsage = {
  readonly tenantId: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly environment: string;
  /** 席数（`usage.seat-snapshot` の最新値。上限は Phase 3 の `Subscription` まで無い）。 */
  readonly seatsUsed: number;
  /** 🔴 件数（4 単位）。1 件あたり標準原価（USD）を添える = 金額との対応を同一画面で確認する材料。 */
  readonly aiUnits: Readonly<Record<AiUnitMetric, PlatformCountQuotaView & { readonly standardCostUsd: string }>>;
  readonly email: PlatformCountQuotaView;
  readonly storage: {
    readonly usedBytes: string;
    readonly limitBytes: string;
    readonly consumptionPercent: number;
    readonly level: UsageLimitLevel | null;
    readonly quota: PlatformQuotaSourceView;
  };
  /** 🔴 AI の 1 日コスト（USD）と 1 日の上限に対する消費率（docs/04 §A-004）。`used + reserved`。 */
  readonly aiDaily: {
    readonly costUsd: string;
    readonly limitUsd: string;
    readonly consumptionPercent: number;
    readonly level: UsageLimitLevel | null;
  };
  /** 🔴 当月の AI 原価（USD。`ai_usage` の合計）と金額上限に対する消費率、ロール別内訳、2 つの倍率。 */
  readonly aiMonthly: {
    readonly costUsd: string;
    readonly capUsd: string;
    readonly consumptionPercent: number;
    readonly byRole: Readonly<Record<AiRole, string>>;
    /** Σ(件数 × 1 件あたり標準原価)。 */
    readonly standardCostUsd: string;
    /** 実原価 ÷ 標準原価。件数 0 なら `null`。 */
    readonly unitCostRatio: number | null;
    /** 当月 AI 原価 ÷ 基準ユニット $12.82（docs/05 §5.9）。 */
    readonly baselineRatio: number;
  };
  /** 全計測の消化率の最大（%）。 */
  readonly peakPercent: number;
  /** `F-057 AC-1` の抽出: `LOW`（すべて 20% 未満）/ `HIGH`（いずれか警告閾値以上）/ `MID`。 */
  readonly band: ConsumptionBand;
};

export type PlatformUsageSnapshot = {
  readonly observedAt: Date;
  readonly dayKey: string;
  readonly monthKey: string;
  readonly warnPercent: number;
  readonly lowPercent: number;
  /** 🔴 環境全体の当月 AI 支出 / tier 上限（テナント行とは別集計・別行。`byRole` 6 ロール固定）。 */
  readonly environment: ProviderMonthlySpend;
  readonly tenants: readonly PlatformTenantUsage[];
};

// ---------------------------------------------------------------------------
// 純粋部分（I/O なし。ユニットテストで固定する）
// ---------------------------------------------------------------------------

export type UsageCounterFact = {
  readonly tenantId: string;
  readonly periodKind: 'DAY' | 'MONTH';
  readonly periodKey: string;
  readonly metric: string;
  /** `Decimal(20,6)` を十進文字列に落としたもの。 */
  readonly value: string;
  readonly reservedValue: string;
};

export type UsageLimitStateFact = {
  readonly tenantId: string;
  readonly metric: string;
  readonly level: string;
};

export type QuotaOverrideFact = QuotaOverrideRow & { readonly tenantId: string; readonly previousLimit: bigint };

export type PlatformUsageTenantFact = {
  readonly id: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly environment: string;
};

export type PlatformUsageSummaryInput = {
  readonly now: Date;
  readonly dayKey: string;
  readonly monthKey: string;
  readonly warnPercent: number;
  readonly defaults: TenantQuotaDefaults;
  readonly aiDailyCostLimitUsd: number;
  readonly aiMonthlyCostCapUsd: number;
  readonly providerCapUsd: number;
  readonly tenants: readonly PlatformUsageTenantFact[];
  readonly counters: readonly UsageCounterFact[];
  readonly states: readonly UsageLimitStateFact[];
  readonly overrides: readonly QuotaOverrideFact[];
  readonly aiCostGroups: readonly ProviderSpendGroup[];
};

function isUsageLimitLevel(value: string): value is UsageLimitLevel {
  return (USAGE_LIMIT_LEVELS as readonly string[]).includes(value);
}

function usdToDecimalString(name: string, value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} は正の有限数である必要があります（受け取った値: ${value}）。`);
  }
  return value.toFixed(USD_DECIMAL_PLACES);
}

/** `Decimal(20,6)` の十進文字列 → 整数（件数・通数・バイト数は小数部が 0 のはず。0 でなければ切り捨てる）。 */
function toWhole(value: string): bigint {
  const [whole = '0'] = value.split('.');
  if (!/^-?\d+$/.test(whole)) throw new RangeError(`UsageCounter の値が不正です（${value}）。`);
  const parsed = BigInt(whole);
  if (parsed < 0n) throw new RangeError(`UsageCounter の値が負です（${value}）。`);
  return parsed;
}

/**
 * 上書き行 + 既定値 → 効いている上限と出所・予定。🔴 6 計測すべてがここを通る（T-12-12 でメール / ストレージも上書きの対象に戻した。
 * 執行点が `resolveTenantQuotas` を読むので、ここで解く値と実際の執行が一致する）。
 */
function quotaSourceView(
  rows: readonly QuotaOverrideRow[],
  metric: QuotaOverrideMetric,
  dayKey: string,
  defaultLimit: bigint,
  previousLimits: ReadonlyMap<string, bigint>,
): { readonly limit: bigint; readonly view: PlatformQuotaSourceView } {
  const resolved = resolveQuotaLimit({ rows, metric, onDate: dayKey, defaultLimit });
  const pending = selectPendingQuotaOverride(rows, metric, dayKey);
  return {
    limit: resolved.limit,
    view: {
      source: resolved.source,
      effectiveFrom: resolved.override?.effectiveFrom ?? null,
      pending:
        pending === null
          ? null
          : {
              limit: pending.limit.toString(),
              effectiveFrom: pending.effectiveFrom,
              lowering: pending.limit < (previousLimits.get(pending.id) ?? pending.limit),
            },
    },
  };
}

/**
 * 🔴 材料 → DTO（純粋関数）。1 テナントぶんの行を組み立てる。金額は micro-USD の整数で扱い、表示用の小数は最後に 1 回だけ作る。
 */
export function summarizePlatformUsage(input: PlatformUsageSummaryInput): PlatformUsageSnapshot {
  const lowPercent = QUOTA_LOW_CONSUMPTION_PERCENT;
  const aiDailyLimitMicros = parseUsdMicros(usdToDecimalString('aiDailyCostLimitUsd', input.aiDailyCostLimitUsd));
  const aiMonthlyCapMicros = parseUsdMicros(usdToDecimalString('aiMonthlyCostCapUsd', input.aiMonthlyCostCapUsd));
  const baselineMicros = parseUsdMicros(PRICING_RULESET_V1.aiBaselineCostUsd);

  const environment = summarizeProviderSpend({
    periodKey: input.monthKey,
    groups: input.aiCostGroups,
    capUsd: input.providerCapUsd,
    warnPercent: input.warnPercent,
    observedAt: input.now,
  });

  // 材料をテナントごとに束ねる（1 回の走査。テナント数 × 数十行）。
  const countersByTenant = new Map<string, UsageCounterFact[]>();
  for (const counter of input.counters) {
    const list = countersByTenant.get(counter.tenantId) ?? [];
    list.push(counter);
    countersByTenant.set(counter.tenantId, list);
  }
  const statesByTenant = new Map<string, Map<string, UsageLimitLevel>>();
  for (const state of input.states) {
    if (!isUsageLimitLevel(state.level)) {
      throw new Error(`usage_limit_states に未知の level があります（${state.level}）。`);
    }
    const map = statesByTenant.get(state.tenantId) ?? new Map<string, UsageLimitLevel>();
    map.set(state.metric, state.level);
    statesByTenant.set(state.tenantId, map);
  }
  const overridesByTenant = new Map<string, QuotaOverrideRow[]>();
  const previousLimits = new Map<string, bigint>();
  for (const override of input.overrides) {
    const list = overridesByTenant.get(override.tenantId) ?? [];
    list.push(override);
    overridesByTenant.set(override.tenantId, list);
    previousLimits.set(override.id, override.previousLimit);
  }
  const costByTenant = new Map<string, Partial<Record<AiRole, string>>>();
  for (const group of input.aiCostGroups) {
    if (!isAiRole(group.role)) {
      throw new Error(`ai_usage.role に未知の値があります（${group.role}）。`);
    }
    const map = costByTenant.get(group.tenantId) ?? {};
    map[group.role] = group.costUsd;
    costByTenant.set(group.tenantId, map);
  }

  const tenants: PlatformTenantUsage[] = input.tenants.map((tenant) => {
    const counters = countersByTenant.get(tenant.id) ?? [];
    const levels = statesByTenant.get(tenant.id) ?? new Map<string, UsageLimitLevel>();
    const overrides = overridesByTenant.get(tenant.id) ?? [];
    const costByRole = costByTenant.get(tenant.id) ?? {};
    const levelOf = (metric: UsageLimitMetric): UsageLimitLevel | null => levels.get(metric) ?? null;
    const counterValue = (periodKind: 'DAY' | 'MONTH', metric: string): UsageCounterFact | undefined =>
      counters.find((counter) => counter.periodKind === periodKind && counter.metric === metric);

    const percents: number[] = [];
    const unitCounts: Partial<Record<AiUnitMetric, number>> = {};
    const aiUnits = {} as Record<AiUnitMetric, PlatformCountQuotaView & { readonly standardCostUsd: string }>;
    for (const metric of AI_UNIT_METRICS) {
      const used = toWhole(counterValue('MONTH', metric)?.value ?? '0');
      const quota = quotaSourceView(overrides, metric, input.dayKey, BigInt(input.defaults.aiUnitQuotas[metric]), previousLimits);
      const percent = consumptionPercent(used, quota.limit);
      percents.push(percent);
      unitCounts[metric] = Number(used);
      aiUnits[metric] = {
        used: Number(used),
        limit: Number(quota.limit),
        consumptionPercent: percent,
        level: levelOf(metric),
        quota: quota.view,
        standardCostUsd: AI_UNIT_STANDARD_COST_USD_V1[metric],
      };
    }

    const emailUsed = toWhole(counterValue('DAY', 'EMAIL_COUNT')?.value ?? '0');
    const emailQuota = quotaSourceView(overrides, 'EMAIL_COUNT', input.dayKey, BigInt(input.defaults.emailDailyLimit), previousLimits);
    const emailPercent = consumptionPercent(emailUsed, emailQuota.limit);
    percents.push(emailPercent);

    const storageUsed = toWhole(counterValue('MONTH', 'STORAGE_BYTES')?.value ?? '0');
    const storageQuota = quotaSourceView(overrides, 'STORAGE_BYTES', input.dayKey, input.defaults.storageLimitBytes, previousLimits);
    const storagePercent = consumptionPercent(storageUsed, storageQuota.limit);
    percents.push(storagePercent);

    const aiDailyCounter = counterValue('DAY', 'AI_COST_USD');
    const aiDailyMicros =
      aiDailyCounter === undefined
        ? 0n
        : parseUsdMicros(aiDailyCounter.value) + parseUsdMicros(aiDailyCounter.reservedValue);
    const aiDailyPercent = consumptionPercent(aiDailyMicros, aiDailyLimitMicros);
    percents.push(aiDailyPercent);

    const byRoleMicros = new Map<AiRole, bigint>();
    let aiMonthlyMicros = 0n;
    for (const [role, cost] of Object.entries(costByRole) as [AiRole, string][]) {
      const micros = parseUsdMicros(cost);
      byRoleMicros.set(role, micros);
      aiMonthlyMicros += micros;
    }
    const aiMonthlyPercent = consumptionPercent(aiMonthlyMicros, aiMonthlyCapMicros);
    percents.push(aiMonthlyPercent);
    const unitCost = computeUnitCostRatio({ unitCounts, costByRoleUsd: costByRole });

    const seatCounter = counterValue('DAY', 'SEAT_COUNT');

    return {
      tenantId: tenant.id,
      name: tenant.name,
      lifecycleState: tenant.lifecycleState,
      environment: tenant.environment,
      seatsUsed: Number(toWhole(seatCounter?.value ?? '0')),
      aiUnits,
      email: {
        used: Number(emailUsed),
        limit: Number(emailQuota.limit),
        consumptionPercent: emailPercent,
        level: levelOf('EMAIL_COUNT'),
        quota: emailQuota.view,
      },
      storage: {
        usedBytes: storageUsed.toString(),
        limitBytes: storageQuota.limit.toString(),
        consumptionPercent: storagePercent,
        level: levelOf('STORAGE_BYTES'),
        quota: storageQuota.view,
      },
      aiDaily: {
        costUsd: formatUsdMicros(aiDailyMicros),
        limitUsd: formatUsdMicros(aiDailyLimitMicros),
        consumptionPercent: aiDailyPercent,
        level: levelOf('AI_COST_USD'),
      },
      aiMonthly: {
        costUsd: formatUsdMicros(aiMonthlyMicros),
        capUsd: formatUsdMicros(aiMonthlyCapMicros),
        consumptionPercent: aiMonthlyPercent,
        byRole: Object.fromEntries(
          AI_ROLES.map((role) => [role, formatUsdMicros(byRoleMicros.get(role) ?? 0n)]),
        ) as Record<AiRole, string>,
        standardCostUsd: formatUsdMicros(unitCost.standardMicros),
        unitCostRatio: unitCost.ratio,
        baselineRatio: Number(aiMonthlyMicros) / Number(baselineMicros),
      },
      peakPercent: percents.reduce((max, value) => (value > max ? value : max), 0),
      band: classifyConsumptionBand({ percents, lowPercent, highPercent: input.warnPercent }),
    };
  });

  // 🔴 並びは張り付いている順（消化率の最大が高い → 名前 → ID）。決定的で説明できる順序。
  tenants.sort((a, b) => b.peakPercent - a.peakPercent || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.tenantId < b.tenantId ? -1 : 1));

  return {
    observedAt: input.now,
    dayKey: input.dayKey,
    monthKey: input.monthKey,
    warnPercent: input.warnPercent,
    lowPercent,
    environment,
    tenants,
  };
}

// ---------------------------------------------------------------------------
// 読み取り（1 回の withPlatformRead）
// ---------------------------------------------------------------------------

/** 当日 / 当月のカウンタのうち読む計測。`SEAT_COUNT` / `STORAGE_BYTES` は「最新の行」を別に引く。 */
const MONTH_METRICS: readonly string[] = [...AI_UNIT_METRICS];
const DAY_METRICS: readonly string[] = ['EMAIL_COUNT', 'AI_COST_USD'];

type CounterSelect = {
  readonly tenantId: string;
  readonly periodKind: string;
  readonly periodKey: string;
  readonly metric: string;
  readonly value: { toFixed(digits: number): string };
  readonly reservedValue: { toFixed(digits: number): string };
};

/**
 * 🔴 テナントごとに「期間キー ≤ 上限」の最新の行を 1 つ引く（`readTenantUsageSnapshot` / `readStorageBytesUsed` と同じ規則）。
 *    `groupBy` で各テナントの最大キーを求めてからその行だけを読む（席数の日次行は年で 365 × テナント数になるため、
 *    全行を持ち帰ってメモリで distinct しない）。
 */
async function readLatestCounters(
  db: Parameters<Parameters<typeof withPlatformRead>[1]>[0],
  periodKind: 'DAY' | 'MONTH',
  metric: 'SEAT_COUNT' | 'STORAGE_BYTES',
  maxPeriodKey: string,
): Promise<readonly CounterSelect[]> {
  const latest = await db.usageCounter.groupBy({
    by: ['tenantId'],
    where: { periodKind, metric, periodKey: { lte: maxPeriodKey } },
    _max: { periodKey: true },
  });
  const keys = latest.flatMap((row) =>
    row._max.periodKey === null ? [] : [{ tenantId: row.tenantId, periodKind, metric, periodKey: row._max.periodKey }],
  );
  if (keys.length === 0) return [];
  return db.usageCounter.findMany({
    where: { OR: keys },
    select: { tenantId: true, periodKind: true, periodKey: true, metric: true, value: true, reservedValue: true },
  });
}

/**
 * 🔴 API-A6 の読み取り。`withPlatformRead`（`admin.usage.view`。横断 = `targetTenantId: null`）1 回で全材料を読む。
 *    `PURGED` のテナントは載せない（個人情報を削除済みで利用量の対象ではない）。
 */
export async function readPlatformUsage(ctx: AuthenticatedPlatformCtx, meta: PlatformUsageMeta): Promise<PlatformUsageSnapshot> {
  // 🔴 `withPlatformRead` の前に検査する（不正な上限で監査行だけ残る状態にしない）。
  usdToDecimalString('aiDailyCostLimitUsd', meta.aiDailyCostLimitUsd);
  usdToDecimalString('aiMonthlyCostCapUsd', meta.aiMonthlyCostCapUsd);
  usdToDecimalString('providerCapUsd', meta.providerCapUsd);
  const dayKey = usagePeriodKey('DAY', meta.now);
  const monthKey = usagePeriodKey('MONTH', meta.now);
  const monthRange = usagePeriodRange('MONTH', monthKey);

  return withPlatformRead(
    { ctx, action: 'admin.usage.view', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const tenants = await db.tenant.findMany({
        where: { lifecycleState: { not: 'PURGED' } },
        select: { id: true, name: true, lifecycleState: true, environment: true },
        orderBy: { id: 'asc' },
      });
      const periodCounters = await db.usageCounter.findMany({
        where: {
          OR: [
            { periodKind: 'MONTH', periodKey: monthKey, metric: { in: [...MONTH_METRICS] } },
            { periodKind: 'DAY', periodKey: dayKey, metric: { in: [...DAY_METRICS] } },
          ],
        },
        select: { tenantId: true, periodKind: true, periodKey: true, metric: true, value: true, reservedValue: true },
      });
      // 🔴 席数（日次スナップショット）とストレージ（累積ゲージ）は「その日 / その月に行が無い」ことがあり、
      //    直近の行を採る（`readTenantUsageSnapshot` / `readStorageBytesUsed` と同じ規則）。
      const latestSeats = await readLatestCounters(db, 'DAY', 'SEAT_COUNT', dayKey);
      const latestStorage = await readLatestCounters(db, 'MONTH', 'STORAGE_BYTES', monthKey);
      const states = await db.usageLimitState.findMany({ select: { tenantId: true, metric: true, level: true } });
      const overrides = await db.tenantQuotaOverride.findMany({
        select: {
          id: true,
          tenantId: true,
          metric: true,
          limit: true,
          previousLimit: true,
          effectiveFrom: true,
          createdAt: true,
        },
      });
      const aiRows = await db.aiUsage.groupBy({
        by: ['tenantId', 'role'],
        where: { startedAt: { gte: monthRange.startAt, lt: monthRange.endAt } },
        _sum: { estimatedCostUsd: true },
      });

      const toFact = (row: CounterSelect): UsageCounterFact => ({
        tenantId: row.tenantId,
        periodKind: row.periodKind === 'DAY' ? 'DAY' : 'MONTH',
        periodKey: row.periodKey,
        metric: row.metric,
        value: row.value.toFixed(USD_DECIMAL_PLACES),
        reservedValue: row.reservedValue.toFixed(USD_DECIMAL_PLACES),
      });

      return summarizePlatformUsage({
        now: meta.now,
        dayKey,
        monthKey,
        warnPercent: meta.warnPercent,
        defaults: meta.defaults,
        aiDailyCostLimitUsd: meta.aiDailyCostLimitUsd,
        aiMonthlyCostCapUsd: meta.aiMonthlyCostCapUsd,
        providerCapUsd: meta.providerCapUsd,
        tenants,
        counters: [...periodCounters, ...latestSeats, ...latestStorage].map(toFact),
        states,
        overrides: overrides.map((row) => {
          if (!isQuotaOverrideMetric(row.metric)) {
            throw new Error(`tenant_quota_overrides に未知の metric があります（${row.metric}）。`);
          }
          return {
            id: row.id,
            tenantId: row.tenantId,
            metric: row.metric,
            limit: row.limit,
            previousLimit: row.previousLimit,
            // 🔴 `@db.Date` は UTC 0 時の `Date` として返る。`toISOString()` の日付部がその暦日である。
            effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
            createdAt: row.createdAt,
          };
        }),
        aiCostGroups: aiRows.map((row) => ({
          tenantId: row.tenantId,
          role: row.role,
          costUsd: row._sum.estimatedCostUsd === null ? formatUsdMicros(0n) : row._sum.estimatedCostUsd.toFixed(USD_DECIMAL_PLACES),
        })),
      });
    },
  );
}

/** `QUOTA_OVERRIDE_METRICS` を API 層（Zod）が値集合として使えるように再 export する。 */
export { QUOTA_OVERRIDE_METRICS };
