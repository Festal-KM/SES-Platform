// apps/web/lib/data-exports/service.ts
// `CLOSING` 中の返却（docs/05 §6.7 #77 / #78 / docs/04 §S-042 / `docs/02` `F-064 AC-5`〜`AC-8`）の API 層。T-10-09。
//
// 🔴 二重境界（`F-064 AC-6`）はここに無い。返却データを読むのは `export.generate`（`packages/db` の `readClosingReturnDataset`
//    = `withTenant` と同じ RLS）であり、ここは「依頼を作って積む」「`READY` の実体に署名する」だけである。
// 🔴 署名は `issueDownloadUrl`（`lib/storage/download.ts`。docs/05 §14.2 が定める唯一の発行経路）を通す —— 監査
//    （`data_export.download`）が commit された後にしか署名しない、という順序を返却だけ別に書かない。
// 🔴 運営者（`PlatformUser`）はここに到達できない（主平面の `requireTenantCtx` は管理平面の Cookie を解釈しない。
//    `lib/middleware/planes.ts` / `tests/isolation/platform-auth.test.ts`）。`F-064 AC-7`。
import { DATA_EXPORT_DOWNLOAD_URL_TTL_SECONDS } from '@ses/config';
import type { ObjectStore } from '@ses/connectors';
import {
  createDataExportRequest,
  DATA_EXPORT_AUDIT_ACTIONS,
  dataExportDownloadSummary,
  resolveDataExportDownload,
  withTenant,
  type AuthenticatedTenantCtx,
  type DataExportRequestView,
  type TenantRole,
} from '@ses/db';
import { DataExportExpiredError, DataExportNotReadyError, InternalError, NotFoundError } from '../api/errors';
import { requireExportGenerateJobQueue } from '../jobs/export-generate-queue';
import { issueDownloadUrl, type DownloadTicket } from '../storage/download';

/** 🔴 #77 / #78 と `S-042` の到達ロール（docs/04 §S-042「権限差分: `OWNER` / `ADMIN` のみ」）。画面と API で同じ定数。 */
export const DATA_EXPORT_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly TenantRole[];

/** 返却 ZIP のダウンロード名（ASCII。原本のファイル名も氏名も含まない。docs/05 §14.1）。 */
export const CLOSING_RETURN_DOWNLOAD_FILE_NAME = 'closing-return.zip';

/** #77 の応答（docs/05 §6.7 #77 `{ id, status }`）。 */
export type DataExportCreatedView = {
  readonly id: string;
  readonly status: DataExportRequestView['status'];
};

export type RequestClosingReturnDeps = {
  readonly now: () => Date;
  readonly ipAddress: string | null;
};

/**
 * #77。`DataExportRequest(QUEUED)` + 監査（同一トランザクション。`packages/db`）→ `export.generate` を enqueue。
 * 🔴 `CLOSING` 以外は `packages/db` が `DataExportNotAllowedError` を投げ、API 境界が 422 に写像する。
 */
export async function requestClosingReturn(
  ctx: AuthenticatedTenantCtx,
  deps: RequestClosingReturnDeps,
): Promise<DataExportCreatedView> {
  const created = await createDataExportRequest(ctx, { now: deps.now(), ipAddress: deps.ipAddress });
  const outcome = await requireExportGenerateJobQueue().enqueue({ tenantId: ctx.tenantId, exportRequestId: created.id });
  if (outcome !== 'ENQUEUED') {
    // 🔴 `jobId` は新しい依頼 ID から組むので `failed` の同名記録は実際には存在し得ないが、「積んだつもり」を返さない。
    throw new InternalError();
  }
  return { id: created.id, status: created.status };
}

export type IssueClosingReturnDownloadDeps = {
  readonly objectStore: ObjectStore;
  readonly now: () => Date;
  readonly ipAddress: string | null;
};

/**
 * #78。`READY` かつ有効期限内のときだけ署名付き URL を発行する。
 *
 * 手順: ① 状態の確定（`resolveDataExportDownload`。`expiresAt` 超過はここで `EXPIRED` に CAS してから 410）
 *       ② `issueDownloadUrl`（対象の再読 → 監査 → commit → 署名。有効期限は `DATA_EXPORT_DOWNLOAD_URL_TTL_SECONDS`）
 * 🔴 ①を `issueDownloadUrl` の `loadSubject` の中で行わない —— そこで例外を投げると `EXPIRED` の CAS が巻き戻る。
 */
export async function issueClosingReturnDownloadUrl(
  ctx: AuthenticatedTenantCtx,
  exportRequestId: string,
  deps: IssueClosingReturnDownloadDeps,
): Promise<DownloadTicket> {
  const now = deps.now();
  const target = await withTenant(ctx, (db) =>
    resolveDataExportDownload(db, { tenantId: ctx.tenantId, exportRequestId, now }),
  );
  // 🔴 境界外・不存在は 404（存在を教えない。docs/05 §4.8）。
  if (target.kind === 'NOT_FOUND') throw new NotFoundError();
  if (target.kind === 'EXPIRED') throw new DataExportExpiredError();
  if (target.kind === 'NOT_READY') throw new DataExportNotReadyError(target.status);

  return issueDownloadUrl(
    ctx,
    async (db) => {
      const again = await resolveDataExportDownload(db, { tenantId: ctx.tenantId, exportRequestId, now });
      if (again.kind !== 'READY') return null;
      return {
        objectKey: again.objectKey,
        // 🔴 機械生成の実体（`DownloadSubject.scanStatus` の注記）。利用者のアップロードではない。
        scanStatus: 'CLEAN',
        // 🔴 自テナントの返却であり、境界の外へは渡らない（ゲートの対象ではない）。
        share: { kind: 'OWNER_SCOPE' },
        ttlSeconds: DATA_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
        downloadFileName: CLOSING_RETURN_DOWNLOAD_FILE_NAME,
        audit: {
          action: DATA_EXPORT_AUDIT_ACTIONS.download,
          targetType: 'DataExportRequest',
          targetId: exportRequestId,
          summary: dataExportDownloadSummary(exportRequestId),
        },
      };
    },
    { objectStore: deps.objectStore, ipAddress: deps.ipAddress },
  );
}
