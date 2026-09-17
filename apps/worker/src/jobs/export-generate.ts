// apps/worker/src/jobs/export-generate.ts
// 🔴 `export.generate`（イベント。`attempts: 2`。docs/05 §9.6 / `docs/02` `F-064 AC-5` / `AC-6` / docs/04 §S-042）。T-10-09。
//
// ============================================================================
// 🔴 何をするか
// ============================================================================
//   ① `DataExportRequest` を `QUEUED → RUNNING` に CAS（2 度目の試行 / 二重 enqueue は `NOT_QUEUED` で何もしない）。
//   ② 🔴 **二重境界の内側**で読む … `readClosingReturnDataset`（`packages/db`。`withTenant` と同じ RLS + Prisma 拡張。ジョブの
//      ホスト文脈 = 依頼者（ホストの `OWNER` / `ADMIN`）と同じ範囲）。取引先が持ち込んだ台帳のうち `Proposal` として開示されて
//      いないものは 1 行も読めない（`engineers` は C3）。開示済みは `engineer_snapshots` の凍結コピーとしてだけ現れる。
//   ③ CSV 一式の ZIP を組む … `buildClosingReturnArchive`（`@ses/domain`。決定的。列の契約はスナップショットで固定）。
//   ④ S3 に置く … `ObjectStore.put`（`t/{tenantId}/exports/{exportRequestId}/{uuid}.zip`。docs/05 §14.1）。
//   ⑤ `RUNNING → READY`（`objectKey` / `readyAt` / `expiresAt = readyAt + DATA_EXPORT_AVAILABLE_DAYS`）。失敗は `FAILED` にしてから
//      例外を投げ直す（`attempts: 2` の 2 度目は①で `NOT_QUEUED` になり、生成を繰り返さない = 失敗は失敗のまま `S-042` に出る）。
//
// 🔴 外部へ**送信**しない（S3 への put だけ。宛先が無い）。署名 URL はここでは発行しない（#78 = `issueDownloadUrl` の 1 経路）。
import { randomUUID } from 'node:crypto';
import type { InternalJobName, ObjectStore } from '@ses/connectors';
import {
  claimDataExportRun,
  readClosingReturnDataset,
  settleDataExport,
  systemTenantCtx,
  type DataExportStatus,
  type SystemTenantCtx,
} from '@ses/db';
import { buildClosingReturnArchive, buildDataExportObjectKey, type ClosingReturnFileName } from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const EXPORT_GENERATE_JOB = 'export.generate' satisfies InternalJobName;

/** 返却 ZIP の content-type（ダウンロード名は `issueDownloadUrl` が付ける）。 */
export const EXPORT_ARCHIVE_CONTENT_TYPE = 'application/zip';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExportGeneratePayload = { readonly tenantId: string; readonly exportRequestId: string };

export function parseExportGeneratePayload(raw: unknown): ExportGeneratePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(EXPORT_GENERATE_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return {
    tenantId: requireUuid(EXPORT_GENERATE_JOB, 'tenantId', record.tenantId),
    exportRequestId: requireUuid(EXPORT_GENERATE_JOB, 'exportRequestId', record.exportRequestId),
  };
}

export type ExportGenerateDeps = {
  readonly now: () => Date;
  /** 🔴 `put` だけ（署名も削除も要らない。型で表明する）。 */
  readonly objectStore: Pick<ObjectStore, 'put'>;
  /** `DATA_EXPORT_AVAILABLE_DAYS`（`packages/config`。既定 7）。 */
  readonly exportAvailableDays: number;
};

export type ExportGenerateOutcome =
  | { readonly kind: 'SKIPPED'; readonly reason: 'NOT_FOUND' | 'NOT_QUEUED'; readonly status?: DataExportStatus }
  | {
      readonly kind: 'READY';
      readonly exportRequestId: string;
      readonly fileCount: number;
      readonly rowCounts: Readonly<Record<ClosingReturnFileName, number>>;
      readonly byteSize: number;
    };

export async function generateExport(
  deps: ExportGenerateDeps,
  ctx: SystemTenantCtx,
  exportRequestId: string,
): Promise<ExportGenerateOutcome> {
  const claim = await claimDataExportRun(ctx, exportRequestId);
  if (claim.kind === 'NOT_FOUND') return { kind: 'SKIPPED', reason: 'NOT_FOUND' };
  if (claim.kind === 'NOT_QUEUED') return { kind: 'SKIPPED', reason: 'NOT_QUEUED', status: claim.status };

  try {
    const dataset = await readClosingReturnDataset(ctx);
    const built = buildClosingReturnArchive(dataset);
    const objectKey = buildDataExportObjectKey({ tenantId: ctx.tenantId, exportRequestId, objectId: randomUUID() });
    await deps.objectStore.put(objectKey, built.archive, EXPORT_ARCHIVE_CONTENT_TYPE);
    const readyAt = deps.now();
    await settleDataExport(ctx, exportRequestId, {
      status: 'READY',
      objectKey,
      readyAt,
      expiresAt: new Date(readyAt.getTime() + deps.exportAvailableDays * DAY_MS),
    });
    return { kind: 'READY', exportRequestId, fileCount: built.fileCount, rowCounts: built.rowCounts, byteSize: built.archive.byteLength };
  } catch (error) {
    await settleDataExport(ctx, exportRequestId, { status: 'FAILED' });
    throw error;
  }
}

export type ExportGenerateHandler = (payload: unknown, jobId: string) => Promise<ExportGenerateOutcome>;

export function createExportGenerateHandler(deps: ExportGenerateDeps): ExportGenerateHandler {
  return async (payload, jobId) => {
    const job = parseExportGeneratePayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: EXPORT_GENERATE_JOB, jobId });
    return generateExport(deps, ctx, job.exportRequestId);
  };
}
