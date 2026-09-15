// packages/db/src/usage-storage-reconcile.ts
// 🔴 `usage.storage-reconcile`（毎日 01:30 JST。docs/05 §9.8 / docs/03 §4.5 / §4.15）の本体。T-10-02。
//
// カウンタ（`UsageCounter(MONTH,'STORAGE_BYTES')`。`storage-usage.ts`）が正であり、オブジェクトストアの
// 実測は**検算**である。乖離は `usage_measurement_findings(kind='STORAGE_DIVERGENCE')` に出すだけで、
// 🔴 **カウンタを 1 バイトも書き換えない**（自動補正しない。docs/03 §4.5）。
//
// 🔴 実測値は引数で受ける（オブジェクトストアを呼ぶのは `apps/worker`。`packages/db` は
//    `@ses/connectors` に依存できない。`CLAUDE.md` §2.1）。
import { reconcileStorageUsage, usagePeriodKey, type StorageReconcileDecision } from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { readStorageBytesUsed } from './storage-usage.js';
import { syncUsageMeasurementFindings, type UsageMeasurementFindingSync } from './usage-findings.js';
import { runInTenantTransaction } from './with-tenant.js';

export type StorageReconcileOutcome = UsageMeasurementFindingSync & {
  /** 検算した月（`UsageCounter(MONTH,'STORAGE_BYTES')` の当月キー）。 */
  readonly periodKey: string;
  readonly counterBytes: bigint;
  readonly measuredBytes: bigint;
  readonly decision: StorageReconcileDecision;
};

/**
 * 🔴 カウンタと実測を突き合わせ、乖離を検知結果として同期する。
 *
 * 行は (tenant, STORAGE_DIVERGENCE, STORAGE_BYTES, MONTH, 当月) につき 1 つ。翌日の検算で一致すれば
 * `resolved_at` が立つ（一時的な乖離〔進行中のアップロード〕は自然に閉じる）。
 */
export async function reconcileTenantStorage(
  ctx: HostTenantCtx,
  input: { readonly measuredBytes: bigint; readonly now: Date },
): Promise<StorageReconcileOutcome> {
  if (input.measuredBytes < 0n) {
    throw new RangeError(`measuredBytes は 0 以上である必要があります（${input.measuredBytes}）。`);
  }
  const periodKey = usagePeriodKey('MONTH', input.now);
  const counterBytes = await readStorageBytesUsed(ctx, input.now);
  const decision = reconcileStorageUsage({ counterBytes, measuredBytes: input.measuredBytes });

  const sync = await runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    (tx) =>
      syncUsageMeasurementFindings(tx, {
        tenantId: ctx.tenantId,
        now: input.now,
        scope: { kinds: ['STORAGE_DIVERGENCE'], periodKind: 'MONTH', periodKeys: [periodKey] },
        findings:
          decision.kind === 'MATCH'
            ? []
            : [
                {
                  kind: 'STORAGE_DIVERGENCE',
                  metric: 'STORAGE_BYTES',
                  periodKind: 'MONTH',
                  periodKey,
                  expected: input.measuredBytes.toString(),
                  observed: counterBytes.toString(),
                },
              ],
      }),
  );
  return { periodKey, counterBytes, measuredBytes: input.measuredBytes, decision, ...sync };
}
