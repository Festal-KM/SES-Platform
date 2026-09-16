// apps/worker/src/jobs/usage-limit-check.ts
// 🔴 `usage.limit-check`（毎 10 分。docs/02 `F-027` 処理①〜⑤ / 章 7.5 / docs/05 §5.8 / §7.6 / §16.1）。T-10-03。
//
// ============================================================================
// 🔴 このジョブが行うこと（順序に理由がある）
// ============================================================================
//   ① AI の 1 日コスト上限に対して**停止しているか**を、予約と同じ判定式で見る
//      （`probeAiDailyCostLevel` = `probeAiCostHeadroom`。見積りは `gate.hold-release` と同じ
//      `gate-inspector` 1 回ぶんの下限・同じモデル解決。**別の式にすると「復帰したのに停止中と表示」が起きる**）
//   ② 件数 4 単位 / メール（日次）/ ストレージの現在値を読む（`readTenantUsageSnapshot`）
//   ③ 3 種の区別で評価する（`assessUsageLimits`。`packages/domain` の純粋関数。**1 実装**）
//   ④ `usage_limit_states` に反映し、**水準が変わったときだけ** `AuditLog`（到達 / 接近 / 解除）を書く
//   ⑤ ④が返した契機（その日その水準で未通知のもの）だけ、テナント管理者へメールを積む
//      （`notifyUsageLimit`。既存の `email.dispatch` 経路。`dedupeKey` に暦日）
//
// 🔴 LLM を 1 回も呼ばない（deps に AI クライアントの口が無い）。外部への書き込みも無い（`attempts: 3`）。
// 🔴 金額（USD）は ① の戻り値（`stopped` と micro-USD の `bigint`）以外に現れず、表示・通知・監査の
//    どこにも載らない（`F-027 AC-6`）。
// 🔴 `gate.hold-release` とは別のジョブである: あちらは**保留の復帰**（`gate.run` を積む）、こちらは
//    **水準の記録と通知**。1 つにすると「通知の失敗で復帰が止まる」経路ができる。
import { gateInspectorReservationFloor, gateInspectorSpec, type RoleModelResolver } from '@ses/ai';
import type { InternalJobName, OperationalMailDispatch } from '@ses/connectors';
import {
  probeAiDailyCostLevel,
  readTenantAdminRecipients,
  readTenantUsageSnapshot,
  syncUsageLimitStates,
  systemTenantCtx,
} from '@ses/db';
import { assessUsageLimits, type AiUnitMetric } from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';
import { notifyUsageLimit } from './usage-limit-notice.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const USAGE_LIMIT_CHECK_JOB = 'usage.limit-check' satisfies InternalJobName;

/** 毎 10 分（`gate.hold-release` / `send.hold-release` と同じ粒度。docs/05 §9.3 / §9.4）。 */
export const USAGE_LIMIT_CHECK_SCHEDULE = { cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' } as const;

export type UsageLimitCheckPayload = { readonly tenantId: string };

export function parseUsageLimitCheckPayload(raw: unknown): UsageLimitCheckPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(USAGE_LIMIT_CHECK_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(USAGE_LIMIT_CHECK_JOB, 'tenantId', record.tenantId) };
}

/**
 * 🔴 上限値の出所（`packages/config`。プラン別の上書きが入るまでの既定値。docs/05 §7.12 ⑧）。
 *    ジョブはここで決め打ちしない。`GET /api/usage`（#69）が同じ値を `usageLimitsRuntime()` から読む。
 */
export type TenantUsageLimits = {
  /** `QUOTA_WARNING_THRESHOLD_PERCENT`（既定 80）。 */
  readonly warnPercent: number;
  /** `AI_UNIT_QUOTA_*_DEFAULT`（4 単位。`gate-inspector` は無い）。 */
  readonly aiUnitQuotas: Readonly<Record<AiUnitMetric, number>>;
  /** `EMAIL_DAILY_LIMIT_PER_TENANT`。 */
  readonly emailDailyLimit: number;
  /** `STORAGE_LIMIT_BYTES_PER_TENANT`。 */
  readonly storageLimitBytes: bigint;
};

export type UsageLimitCheckDeps = {
  readonly now: () => Date;
  /** 🔴 `gate.run` / `gate.hold-release` と**同じ**モデル解決（見積りはモデルの単価で決まる）。 */
  readonly models: RoleModelResolver;
  /** 🔴 `gate.run` に渡す値と同じ（`AI_DAILY_COST_LIMIT_USD_DEFAULT`。十進文字列）。 */
  readonly aiDailyCostLimitUsd: string;
  readonly usageLimits: TenantUsageLimits;
  /** 🔴 `email.dispatch` を積む（既存の単一経路。新しい送信経路を作らない）。 */
  readonly enqueueEmailDispatch: (job: OperationalMailDispatch) => Promise<void>;
};

export type UsageLimitCheckOutcome = {
  /** 水準が変わった計測の数。 */
  readonly changed: number;
  /** 書いた監査ログの件数（到達 / 接近 / 解除）。 */
  readonly audited: number;
  /** 通知の契機の数（計測 × 水準）。 */
  readonly notices: number;
  /** この実行で `email.dispatch` を積んだ通数。 */
  readonly queued: number;
  /** 🔴 AI が停止中か（`A-005` の材料。金額は載せない）。 */
  readonly aiStopped: boolean;
};

export type UsageLimitCheckHandler = (payload: unknown, jobId: string) => Promise<UsageLimitCheckOutcome>;

export function createUsageLimitCheckHandler(deps: UsageLimitCheckDeps): UsageLimitCheckHandler {
  return async (payload, jobId) => {
    const job = parseUsageLimitCheckPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: USAGE_LIMIT_CHECK_JOB, jobId });
    const now = deps.now();

    // ① 停止判定（予約と同じ式・同じ見積り・同じモデル解決。docs/05 §9.3 と揃える）。
    const floor = gateInspectorReservationFloor();
    const modelId = await deps.models.resolve({
      tenantId: job.tenantId,
      role: gateInspectorSpec.role,
      tier: gateInspectorSpec.defaultModel,
    });
    const aiDaily = await probeAiDailyCostLevel(ctx, {
      modelId,
      estimatedInputTokens: floor.estimatedInputTokens,
      maxOutputTokens: floor.maxOutputTokens,
      limitUsd: deps.aiDailyCostLimitUsd,
      now,
    });

    // ② 現在値。
    const snapshot = await readTenantUsageSnapshot(ctx, now);

    // ③ 3 種の区別（純粋関数）。
    const assessment = assessUsageLimits({
      warnPercent: deps.usageLimits.warnPercent,
      aiDailyCost: {
        stopped: aiDaily.stopped,
        consumedMicros: aiDaily.consumedMicros,
        limitMicros: aiDaily.limitMicros,
      },
      aiUnits: {
        AI_UNIT_SHEET_PARSE: { used: snapshot.aiUnits.AI_UNIT_SHEET_PARSE, quota: deps.usageLimits.aiUnitQuotas.AI_UNIT_SHEET_PARSE },
        AI_UNIT_MATCH_RATIONALE: { used: snapshot.aiUnits.AI_UNIT_MATCH_RATIONALE, quota: deps.usageLimits.aiUnitQuotas.AI_UNIT_MATCH_RATIONALE },
        AI_UNIT_PROPOSAL_DRAFT: { used: snapshot.aiUnits.AI_UNIT_PROPOSAL_DRAFT, quota: deps.usageLimits.aiUnitQuotas.AI_UNIT_PROPOSAL_DRAFT },
        AI_UNIT_RENEWAL_SUMMARY: { used: snapshot.aiUnits.AI_UNIT_RENEWAL_SUMMARY, quota: deps.usageLimits.aiUnitQuotas.AI_UNIT_RENEWAL_SUMMARY },
      },
      email: { usedToday: snapshot.emailToday, dailyLimit: deps.usageLimits.emailDailyLimit },
      storage: { usedBytes: snapshot.storageBytes, limitBytes: deps.usageLimits.storageLimitBytes },
    });

    // ④ 表と監査ログ（水準が変わったときだけ）。
    const sync = await syncUsageLimitStates(ctx, {
      now,
      assessment,
      periodKeys: { dayKey: snapshot.dayKey, monthKey: snapshot.monthKey },
    });

    // ⑤ 通知（契機が無ければ宛先を引かない）。
    let queued = 0;
    if (sync.toNotify.length > 0) {
      const recipients = await readTenantAdminRecipients(ctx);
      for (const notice of sync.toNotify) {
        queued += await notifyUsageLimit(
          { enqueueEmailDispatch: deps.enqueueEmailDispatch },
          ctx,
          { metric: notice.metric, level: notice.level, dayKey: notice.dayKey, recipients, observedAt: now },
        );
      }
    }

    return {
      changed: sync.changed,
      audited: sync.audited,
      notices: sync.toNotify.length,
      queued,
      aiStopped: aiDaily.stopped,
    };
  };
}
