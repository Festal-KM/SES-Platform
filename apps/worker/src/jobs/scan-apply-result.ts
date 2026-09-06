// apps/worker/src/jobs/scan-apply-result.ts
// `scan.apply-result`（docs/05 §8.5 / §9.6）。T-05-05。
//
// ============================================================================
// 🔴 このジョブは外部 API を 1 つも呼ばない
// ============================================================================
// 受信済みの `WebhookDelivery` を読み、`FileScanResult` に記録し、`SkillSheet.scanStatus` を
// 適用するだけである。だから `attempts: 3` でよい（`packages/connectors/src/queues.ts`）。
//
// ============================================================================
// 🔴 冪等性は 3 段（docs/05 §9.6 / `packages/db/src/file-scan.ts` 冒頭）
// ============================================================================
//   ① `WebhookDelivery.processedAt` の **CAS** —— 重複配信で 2 回処理しない
//   ② `FileScanResult` の **`UNIQUE(object_key, object_version_id)`**
//   ③ 🔴 `skill_sheets.scan_status` の **単調な CAS** —— `CLEAN` へ戻る遷移が存在しない
//
// 🔴 ①をすり抜けても②③が効く、という**重ね掛け**である。①だけに頼らないのは、
//    受信 → enqueue → 実行の間にプロセスが落ちると同じ `deliveryId` が 2 回走るためである。
//
// 🔴 処理の失敗は `processFailedAt` に記録し `A-005` で拾う（docs/05 §8.5）。
//    受信は既に 200 を返しているので、ここでの失敗は再送を引き起こさない。
import { GuardDutyEventParseError, parseSerializedScanResult } from '@ses/connectors';
import {
  applyFileScanResult,
  markWebhookDeliveryFailed,
  markWebhookDeliveryProcessed,
  readWebhookDelivery,
  systemTenantCtx,
} from '@ses/db';
import { tenantIdFromObjectKey } from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const SCAN_APPLY_RESULT_JOB = 'scan.apply-result';

export type ScanApplyResultOutcome =
  | {
      readonly kind: 'PROCESSED';
      /** `skill_sheets` に適用したか（`KEPT` = 既により重い判定が入っていた。正常系）。 */
      readonly target: 'APPLIED' | 'KEPT';
      /** `FileScanResult` に新規 INSERT できたか。 */
      readonly recorded: boolean;
    }
  /** 既に他の実行が完了させている（重複配信の正常系）。 */
  | { readonly kind: 'ALREADY_PROCESSED' }
  /** 本ジョブの射程外のプロバイダ（受信側の配線ミス）。 */
  | { readonly kind: 'UNSUPPORTED_PROVIDER'; readonly provider: string }
  | { readonly kind: 'FAILED'; readonly failureReason: string };

export function parseScanApplyResultPayload(raw: unknown): { readonly deliveryId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(SCAN_APPLY_RESULT_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { deliveryId: requireUuid(SCAN_APPLY_RESULT_JOB, 'deliveryId', record.deliveryId) };
}

export type ScanApplyResultDeps = {
  readonly now: () => Date;
};

export type ScanApplyResultHandler = (
  payload: unknown,
  jobId: string,
) => Promise<ScanApplyResultOutcome>;

export function createScanApplyResultHandler(deps: ScanApplyResultDeps): ScanApplyResultHandler {
  return async (payload, jobId) => {
    const { deliveryId } = parseScanApplyResultPayload(payload);
    const delivery = await readWebhookDelivery(deliveryId);
    if (delivery === null) {
      throw new InvalidJobPayloadError(SCAN_APPLY_RESULT_JOB, 'deliveryId に対応する行がありません');
    }
    if (delivery.processed) return { kind: 'ALREADY_PROCESSED' };

    if (delivery.provider !== 'guardduty') {
      // 🔴 `processedAt` を立てない（「処理したことにして捨てた」を作らない）。
      return { kind: 'UNSUPPORTED_PROVIDER', provider: delivery.provider };
    }

    const now = deps.now();
    try {
      // 🔴 `WebhookDelivery.payload` には**正規化済み**の形しか入っていない（受信時に
      //    `parseGuardDutyScanEvent` → `serializeScanResult` を通してある。docs/05 §3.9）。
      const result = parseSerializedScanResult(delivery.payload);

      // 🔴 テナントはオブジェクトキーから導く。受信側でも同じ関数で検査済みだが、
      //    **ここでも導き直す**（判断の出所を 1 つの関数に保ち、payload に別途詰めた
      //    `tenantId` を信じる形にしない）。
      const tenantId = tenantIdFromObjectKey(result.objectKey);
      if (tenantId === null) {
        await markWebhookDeliveryFailed(deliveryId, {
          failedAt: now,
          failureReason: 'UNSCOPED_OBJECT_KEY',
        });
        return { kind: 'FAILED', failureReason: 'UNSCOPED_OBJECT_KEY' };
      }

      const ctx = systemTenantCtx(tenantId, { queue: SCAN_APPLY_RESULT_JOB, jobId });
      const applied = await applyFileScanResult(ctx, {
        objectKey: result.objectKey,
        objectVersionId: result.objectVersionId,
        status: result.status,
        rawStatus: result.rawStatus,
        // 🔴 `scan_updated_at` に入るのは**プロバイダが示す発生時刻**（受信時刻ではない）。
        occurredAt: result.occurredAt,
        receivedAt: now,
      });

      if (applied.target === 'NOT_FOUND') {
        // 🔴 「対象が見つからない」を成功にしない。**未処理のまま残す**（`processedAt` を
        //    立てない）ので `A-005` に見え、SP-13（チャット添付）/ Phase 3（契約書）が
        //    対象を増やしたときに同じ配信を処理し直せる。
        //    🔴 再試行しても直らないので throw しない（`attempts: 3` を空撃ちしない）。
        await markWebhookDeliveryFailed(deliveryId, {
          failedAt: now,
          failureReason: 'SCAN_TARGET_NOT_FOUND',
        });
        return { kind: 'FAILED', failureReason: 'SCAN_TARGET_NOT_FOUND' };
      }

      // 🔴 CAS。`false` は他の実行が先に完了させたということであり、失敗ではない。
      const claimed = await markWebhookDeliveryProcessed(deliveryId, now);
      return claimed
        ? { kind: 'PROCESSED', target: applied.target, recorded: applied.recorded }
        : { kind: 'ALREADY_PROCESSED' };
    } catch (error) {
      const failureReason =
        error instanceof GuardDutyEventParseError ? 'PARSE_ERROR' : 'PROCESS_ERROR';
      await markWebhookDeliveryFailed(deliveryId, { failedAt: now, failureReason });
      // 🔴 解釈できない payload を再試行しても直らない（`attempts` を空撃ちしない）。
      if (error instanceof GuardDutyEventParseError) return { kind: 'FAILED', failureReason };
      throw error;
    }
  };
}
