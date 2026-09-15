// apps/worker/src/jobs/usage-daily-rollup.ts
// 🔴 `usage.daily-rollup`（毎日 01:10 JST。docs/05 §9.8 / `F-026 AC-3`）。T-10-02。
//
// ============================================================================
// 🔴 このジョブがやることは 2 つだけである
// ============================================================================
//   ① **昨日**の `AI_COST_USD`（DAY）を `AiUsage` の合計に揃える（`rollupAiCostDay`）
//   ② 昨日が属する月と今月の `EMAIL_COUNT`（MONTH）を DAY 行から畳む（`rollupEmailMonth`）
// 本体は `packages/db`（`usage-rollup.ts`）であり、**ワーカーは起動と配線だけ**を持つ
// （`CLAUDE.md` §2.1「worker: 業務ロジックを持たない」）。
//
// 🔴 「昨日」を対象にする理由: 当日は呼び出しが進行中であり、予約（`reserved_value`）と `AiUsage` の
//    間で一時的に食い違うのが正常である。1 日が終わった行だけを突き合わせる。
// 🔴 `AI_UNIT_*`（件数）には**触れない**（docs/05 §9.8）。数え直すと再試行・`skill-normalizer`・
//    `gate-inspector` が混入する。`rollupAiCostDay` / `rollupEmailMonth` のどちらも `AI_UNIT_*` を読まない・書かない。
// 🔴 冪等: 確定値の上書き（SET）。再実行しても二重にならない（`attempts: 3` を許せる根拠）。
import {
  rollupAiCostDay,
  rollupEmailMonth,
  systemTenantCtx,
  type AiCostDayRollup,
  type EmailMonthRollup,
} from '@ses/db';
import { monthKeyOfDay, shiftDayKey, usagePeriodKey } from '@ses/domain';
import type { InternalJobName } from '@ses/connectors';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const USAGE_DAILY_ROLLUP_JOB = 'usage.daily-rollup' satisfies InternalJobName;

/** 🔴 毎日 01:10 JST（docs/05 §9.8）。`usage.seat-snapshot`（01:00）の後、`usage.gap-check`（01:20）の前。 */
export const USAGE_DAILY_ROLLUP_SCHEDULE = { cron: '10 1 * * *', timeZone: 'Asia/Tokyo' } as const;

export type UsageDailyRollupPayload = { readonly tenantId: string };

export function parseUsageDailyRollupPayload(raw: unknown): UsageDailyRollupPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(USAGE_DAILY_ROLLUP_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(USAGE_DAILY_ROLLUP_JOB, 'tenantId', record.tenantId) };
}

export type UsageDailyRollupDeps = {
  /** 🔴 現在時刻の取得も注入する（「昨日」の決定をテストで固定できるようにするため）。 */
  readonly now: () => Date;
};

export type UsageDailyRollupOutcome = {
  readonly aiCost: AiCostDayRollup;
  /** 昨日が属する月と（月をまたいだ翌日なら）今月。多くの日は 1 件。 */
  readonly email: readonly EmailMonthRollup[];
};

export type UsageDailyRollupHandler = (payload: unknown, jobId: string) => Promise<UsageDailyRollupOutcome>;

export function createUsageDailyRollupHandler(deps: UsageDailyRollupDeps): UsageDailyRollupHandler {
  return async (payload, jobId) => {
    const job = parseUsageDailyRollupPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: USAGE_DAILY_ROLLUP_JOB, jobId });
    const now = deps.now();
    const yesterday = shiftDayKey(usagePeriodKey('DAY', now), -1);

    const aiCost = await rollupAiCostDay(ctx, { periodKey: yesterday, now });

    // 🔴 月初（昨日 = 先月末）は先月の MONTH 行を確定させる必要がある。今月の行は当月分（あれば）。
    const months = [monthKeyOfDay(yesterday)];
    const currentMonth = usagePeriodKey('MONTH', now);
    if (currentMonth !== months[0]) months.push(currentMonth);
    const email: EmailMonthRollup[] = [];
    for (const periodKey of months) email.push(await rollupEmailMonth(ctx, { periodKey, now }));

    return { aiCost, email };
  };
}
