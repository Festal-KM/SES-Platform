// apps/worker/src/jobs/usage-gap-check.ts
// 🔴 `usage.gap-check`（毎日 01:20 JST。docs/05 §9.8 / §16.5「計測欠測」/ `F-026 AC-4`「欠測 0 件が目標」）。T-10-02。
//
// 日次の計測（`SEAT_COUNT` / `AI_COST_USD`）の連続性を検査し、欠測・不一致を
// `usage_measurement_findings` に出す（`A-005` の材料。可視化は SP-11）。判定は `@ses/domain` の
// `detectUsageGaps`、材料と同期は `packages/db` の `checkUsageGaps` であり、**ワーカーは起動と配線だけ**を持つ。
//
// 🔴 `usage.daily-rollup`（01:10）の**後**に走る。突き合わせで直せた乖離はここに現れず、
//    「rollup が走らなかった / 直せなかった」ものだけが残る。
// 🔴 `usage_counters` を書かない（読み取りのみ。docs/05 §9.8 の表「読み取りのみ」）。検知結果の
//    upsert（UNIQUE）は冪等であり、`attempts: 3` を許せる。
import { checkUsageGaps, systemTenantCtx, type UsageGapCheckOutcome } from '@ses/db';
import type { InternalJobName } from '@ses/connectors';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const USAGE_GAP_CHECK_JOB = 'usage.gap-check' satisfies InternalJobName;

/** 🔴 毎日 01:20 JST（docs/05 §9.8）。 */
export const USAGE_GAP_CHECK_SCHEDULE = { cron: '20 1 * * *', timeZone: 'Asia/Tokyo' } as const;

export type UsageGapCheckPayload = { readonly tenantId: string };

export function parseUsageGapCheckPayload(raw: unknown): UsageGapCheckPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(USAGE_GAP_CHECK_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(USAGE_GAP_CHECK_JOB, 'tenantId', record.tenantId) };
}

export type UsageGapCheckDeps = {
  readonly now: () => Date;
  /** 遡る日数（`packages/config` の `USAGE_GAP_CHECK_LOOKBACK_DAYS`。合成側が渡す）。 */
  readonly gapCheckLookbackDays: number;
};

export type UsageGapCheckJobOutcome = UsageGapCheckOutcome;

export type UsageGapCheckHandler = (payload: unknown, jobId: string) => Promise<UsageGapCheckJobOutcome>;

export function createUsageGapCheckHandler(deps: UsageGapCheckDeps): UsageGapCheckHandler {
  return async (payload, jobId) => {
    const job = parseUsageGapCheckPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: USAGE_GAP_CHECK_JOB, jobId });
    return checkUsageGaps(ctx, { now: deps.now(), lookbackDays: deps.gapCheckLookbackDays });
  };
}
