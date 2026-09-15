// apps/worker/src/jobs/usage-storage-reconcile.ts
// 🔴 `usage.storage-reconcile`（毎日 01:30 JST。docs/05 §9.8 / docs/03 §4.5 / §4.15）。T-10-02。
//
// オブジェクトストアの実測（`ObjectStore.measureTenantUsage`。`t/{tenantId}/` 配下の合計）と
// `UsageCounter(MONTH,'STORAGE_BYTES')` を突き合わせ、乖離を `usage_measurement_findings` に出す
// （`A-005` の材料。可視化は SP-11）。
//
// 🔴 **自動補正しない。** カウンタが正であり、実測は検算である（`packages/db` の `reconcileTenantStorage` は
//    `usage_counters` を書かない）。docs/03 §4.5「突き合わせ結果を正とするのは月末の締めのときのみ」は
//    Phase 3 の運用判断であり、本ジョブは検知までである。
// 🔴 外部 I/O は**読み取り**だけ（`ListObjectsV2`）。`development` は MinIO（ローカル）、`demo` はモック、
//    実 AWS に到達するのは `sandbox` 以上だけであり、**ここに環境分岐は無い**（実装種別は起動時の
//    `createObjectStore` が決める。`CLAUDE.md` §11.1）。
import { reconcileTenantStorage, systemTenantCtx, type StorageReconcileOutcome } from '@ses/db';
import type { InternalJobName, ObjectStore } from '@ses/connectors';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const USAGE_STORAGE_RECONCILE_JOB = 'usage.storage-reconcile' satisfies InternalJobName;

/** 🔴 毎日 01:30 JST（docs/05 §9.8）。 */
export const USAGE_STORAGE_RECONCILE_SCHEDULE = { cron: '30 1 * * *', timeZone: 'Asia/Tokyo' } as const;

export type UsageStorageReconcilePayload = { readonly tenantId: string };

export function parseUsageStorageReconcilePayload(raw: unknown): UsageStorageReconcilePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(USAGE_STORAGE_RECONCILE_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(USAGE_STORAGE_RECONCILE_JOB, 'tenantId', record.tenantId) };
}

export type UsageStorageReconcileDeps = {
  readonly now: () => Date;
  /**
   * 🔴 検算に使うオブジェクトストア（`measureTenantUsage` だけを使う）。実装種別は起動時に決まっており、
   *    ジョブは `APP_ENV` を見ない。
   */
  readonly objectStore: Pick<ObjectStore, 'measureTenantUsage'>;
};

export type UsageStorageReconcileOutcome = StorageReconcileOutcome & { readonly objectCount: number };

export type UsageStorageReconcileHandler = (payload: unknown, jobId: string) => Promise<UsageStorageReconcileOutcome>;

export function createUsageStorageReconcileHandler(deps: UsageStorageReconcileDeps): UsageStorageReconcileHandler {
  return async (payload, jobId) => {
    const job = parseUsageStorageReconcilePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: USAGE_STORAGE_RECONCILE_JOB, jobId });
    // 🔴 `tenantId` は payload の検証済みの値（ファンアウトが確定させたもの）だけを渡す。
    const measured = await deps.objectStore.measureTenantUsage(job.tenantId);
    const outcome = await reconcileTenantStorage(ctx, { measuredBytes: measured.byteSize, now: deps.now() });
    return { ...outcome, objectCount: measured.objectCount };
  };
}
