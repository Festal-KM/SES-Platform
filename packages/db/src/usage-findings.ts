// packages/db/src/usage-findings.ts
// 🔴 `usage_measurement_findings`（計測の欠測・検算の乖離。docs/05 §9.8 / §16.5「計測欠測」/ `F-026 AC-4`）を
//    書く**唯一の経路**。T-10-02。
//
// ============================================================================
// 🔴 行は (tenant, kind, metric, period) につき 1 つ。消さずに `resolved_at` で閉じる
// ============================================================================
// `usage.gap-check` / `usage.storage-reconcile` は毎日走る。同じ欠測を毎日検知しても行は増えず
// （UNIQUE + `ON CONFLICT DO UPDATE`）、`last_seen_at` が進むだけである。**その実行で見つからなかった
// 未解消の行**は `resolved_at` を立てて閉じる（「いつ検知され、いつ解消したか」を残す。
// migration 20260919000000 の判断事項 2）。
//
// 🔴 解消の判定は「同じ実行（`now`）で `last_seen_at` が更新されなかった行」である。
//    検知した行は必ず `last_seen_at = now` になるため、`last_seen_at < now` かつスコープ内の
//    未解消行が「今回は見つからなかった」行と一致する。スコープ（どの kind / period を
//    検査したか）は呼び出し側が渡す —— 検査していない期間の行を「解消」と誤認しないためである。
//
// 🔴 `usage_counters` には触れない（自動補正しない。docs/03 §4.5）。
import { Prisma } from '@prisma/client';
import type { UsagePeriodKind } from '@ses/domain';
import type { UsageCounterMetric, UsageMeasurementFindingKind } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import type { TenantTransactionClient } from './with-tenant.js';

export type UsageMeasurementFindingInput = {
  readonly kind: UsageMeasurementFindingKind;
  readonly metric: UsageCounterMetric;
  readonly periodKind: UsagePeriodKind;
  readonly periodKey: string;
  /** 正の値（十進文字列）。正を持たない検知は `null`。 */
  readonly expected: string | null;
  /** カウンタの値（十進文字列）。行が無ければ `null`。 */
  readonly observed: string | null;
};

/** 今回の実行が**検査した範囲**。この範囲の未解消行のうち再検知されなかったものを解消する。 */
export type UsageMeasurementFindingScope = {
  readonly kinds: readonly UsageMeasurementFindingKind[];
  readonly periodKind: UsagePeriodKind;
  /** 検査した期間キー。空なら解消の対象も無い（検査していない）。 */
  readonly periodKeys: readonly string[];
};

export type UsageMeasurementFindingSync = {
  /** 今回の実行で検知した件数（新規 + 継続）。 */
  readonly detected: number;
  /** 今回の実行で新たに開いた（または再開した）件数。 */
  readonly opened: number;
  /** 今回の実行で見つからず、閉じた件数。 */
  readonly resolved: number;
};

const DECIMAL_PATTERN = /^-?\d{1,20}(\.\d{1,6})?$/;

function assertDecimalOrNull(name: string, value: string | null): void {
  if (value !== null && !DECIMAL_PATTERN.test(value)) {
    throw new RangeError(`${name} の書式が不正です（${value}）。整数部 20 桁・小数部 6 桁までの十進数で渡してください。`);
  }
}

/**
 * 🔴 検知結果を同期する（**トランザクション内**で呼ぶ。呼び出し側が ctx とスコープを確定させる）。
 *
 * 1. 検知した各行を upsert（再検知なら `last_seen_at` を進め、解消済みなら再開）
 * 2. スコープ内で今回見つからなかった未解消行を `resolved_at = now` で閉じる
 *
 * 🔴 生 SQL は Prisma 拡張のフックを通らないため、テナントキーの述語を**明示的に書く**
 *    （`incrementUsageCounter` と同じ規律）。RLS（C2）が第 1 防御として同じ条件を課す。
 */
export async function syncUsageMeasurementFindings(
  tx: TenantTransactionClient,
  input: {
    readonly tenantId: string;
    readonly now: Date;
    readonly scope: UsageMeasurementFindingScope;
    readonly findings: readonly UsageMeasurementFindingInput[];
  },
): Promise<UsageMeasurementFindingSync> {
  let opened = 0;
  for (const finding of input.findings) {
    assertDecimalOrNull('expected', finding.expected);
    assertDecimalOrNull('observed', finding.observed);
    const id = uuidV7(input.now);
    const rows = await tx.$queryRaw<Array<{ readonly reopened: boolean }>>(Prisma.sql`
      INSERT INTO usage_measurement_findings
        (id, tenant_id, kind, metric, period_kind, period_key, expected, observed,
         detected_at, last_seen_at, resolved_at)
      VALUES
        (${id}::uuid, ${input.tenantId}::uuid, ${finding.kind}, ${finding.metric},
         ${finding.periodKind}, ${finding.periodKey},
         ${finding.expected}::numeric, ${finding.observed}::numeric,
         ${input.now}::timestamptz, ${input.now}::timestamptz, NULL)
      ON CONFLICT (tenant_id, kind, metric, period_kind, period_key) DO UPDATE
        SET expected = EXCLUDED.expected,
            observed = EXCLUDED.observed,
            last_seen_at = GREATEST(usage_measurement_findings.last_seen_at, EXCLUDED.last_seen_at),
            -- 🔴 解消済みだったものが再び見つかった: 再開する（検知時刻を今回にする）。
            detected_at = CASE WHEN usage_measurement_findings.resolved_at IS NULL
                               THEN usage_measurement_findings.detected_at
                               ELSE EXCLUDED.detected_at END,
            resolved_at = NULL
      RETURNING (detected_at = ${input.now}::timestamptz) AS reopened`);
    const row = rows[0];
    if (row === undefined) {
      // 🔴 RLS で 0 行になった（ジョブ文脈でなければここへ来る）。**黙って続けない**。
      throw new Error(
        `usage_measurement_findings を書き込めませんでした（kind=${finding.kind}, metric=${finding.metric}, periodKey=${finding.periodKey}）。`,
      );
    }
    if (row.reopened) opened += 1;
  }

  let resolved = 0;
  if (input.scope.periodKeys.length > 0 && input.scope.kinds.length > 0) {
    resolved = await tx.$executeRaw(Prisma.sql`
      UPDATE usage_measurement_findings
         SET resolved_at = ${input.now}::timestamptz
       WHERE tenant_id = ${input.tenantId}::uuid
         AND resolved_at IS NULL
         AND kind IN (${Prisma.join([...input.scope.kinds])})
         AND period_kind = ${input.scope.periodKind}
         AND period_key IN (${Prisma.join([...input.scope.periodKeys])})
         AND last_seen_at < ${input.now}::timestamptz`);
  }

  return { detected: input.findings.length, opened, resolved };
}
