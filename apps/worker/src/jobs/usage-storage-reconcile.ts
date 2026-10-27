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
import { listChatAttachmentKeysInUse, reconcileTenantStorage, systemTenantCtx, type StorageReconcileOutcome, type SystemTenantCtx } from '@ses/db';
import { CHAT_ATTACHMENT_ABANDONED_AFTER_MS, OBJECT_KIND_SEGMENTS } from '@ses/domain';
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
  readonly objectStore: Pick<ObjectStore, 'measureTenantUsage' | 'listTenantObjects' | 'delete'>;
};

export type UsageStorageReconcileOutcome = StorageReconcileOutcome & {
  readonly objectCount: number;
  /** ✅ 2026-10-27: この実行で片付けた放置されたチャットの添付の数。 */
  readonly abandonedChatUploadsDeleted: number;
};

/**
 * ✅ 2026-10-27（レビュー）: 放置されたチャットの添付（#51p で PUT したが #51 で送らなかった実体）を片付ける。
 *
 * 🔴 消すのは `t/{tenantId}/chat/` 配下で、**札の有効期間 + 余裕より古く**（`CHAT_ATTACHMENT_ABANDONED_AFTER_MS`）、
 *    **どの発言も指していない**ものだけ。札が生きている間は送られうるので消さない。最終更新が分からないものは消さない。
 * 🔴 消す前に数えない実体はカウンタに入っていない（送っていないので加算されていない）。消すことで検算の乖離が残らない。
 *    送ってから本人が削除し、実体の削除だけが失敗したもの（発言はキーを持たない）もここで拾われる。
 */
export async function cleanupAbandonedChatUploads(
  ctx: SystemTenantCtx,
  deps: { readonly now: () => Date; readonly objectStore: Pick<ObjectStore, 'listTenantObjects' | 'delete'> },
): Promise<number> {
  const cutoff = deps.now().getTime() - CHAT_ATTACHMENT_ABANDONED_AFTER_MS;
  const objects = await deps.objectStore.listTenantObjects(ctx.tenantId, OBJECT_KIND_SEGMENTS.chat);
  const old = objects.filter((object) => object.lastModified !== null && object.lastModified.getTime() < cutoff);
  if (old.length === 0) return 0;
  const inUse = await listChatAttachmentKeysInUse(ctx, old.map((object) => object.key));
  let deleted = 0;
  for (const object of old) {
    if (inUse.has(object.key)) continue;
    await deps.objectStore.delete(object.key);
    deleted += 1;
  }
  return deleted;
}

export type UsageStorageReconcileHandler = (payload: unknown, jobId: string) => Promise<UsageStorageReconcileOutcome>;

export function createUsageStorageReconcileHandler(deps: UsageStorageReconcileDeps): UsageStorageReconcileHandler {
  return async (payload, jobId) => {
    const job = parseUsageStorageReconcilePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: USAGE_STORAGE_RECONCILE_JOB, jobId });
    // ✅ 2026-10-27: 実測の前に放置されたチャットの添付を片付ける（数えていない実体で乖離を出さない）。
    const abandonedChatUploadsDeleted = await cleanupAbandonedChatUploads(ctx, deps);
    // 🔴 `tenantId` は payload の検証済みの値（ファンアウトが確定させたもの）だけを渡す。
    const measured = await deps.objectStore.measureTenantUsage(job.tenantId);
    const outcome = await reconcileTenantStorage(ctx, { measuredBytes: measured.byteSize, now: deps.now() });
    return { ...outcome, objectCount: measured.objectCount, abandonedChatUploadsDeleted };
  };
}
