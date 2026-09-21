// apps/web/lib/audit-logs/export.ts
// `S-041` の CSV エクスポート（#10b `GET /api/audit-logs/export`。docs/05 §6.3 #10b / §6.4「CSV エクスポート」行）の読み出し。T-12-18 ⑪。
//
// 🔴 **#10 と同じ `listAuditLogs` を `cursor` で内部的に追って読む**（別の読み出し・別の `where` を書かない = 境界〔C2 HOST_ONLY〕・
//    期間・カテゴリの判定が 1 実装）。ここが読むのは #10 の応答の固定形（`AuditLogListItem`）だけである。
// 🔴 上限（`maxRows`。値の出所は `packages/config` の `AUDIT_LOG_EXPORT_MAX_ROWS`。ここにベタ書きしない）を超える母集団は
//    `TOO_LARGE` を返し、呼び出し側が 400 `AUDIT_LOG_EXPORT_TOO_LARGE`（期間短縮を促す）に写像する。Phase 1 は同期生成 + 上限であり、
//    ジョブ化は上限に当たる実例が出てから（docs/05 §6.4「CSV エクスポート」行 ①）。
// 🔴 上限判定は「`maxRows` + 1 行目が在るか」で行う（上限ちょうどは許す）。読み過ぎても最大 1 ページである。
import { PAGE_SIZE_MAX } from '@ses/config';
import type { AuthenticatedTenantCtx } from '@ses/db';
import type { AuditLogExportQuery } from './schemas';
import { listAuditLogs } from './service';
import type { AuditLogListItem } from './view';

export type AuditLogExportCollection =
  | { readonly kind: 'OK'; readonly items: readonly AuditLogListItem[] }
  | { readonly kind: 'TOO_LARGE'; readonly maxRows: number };

export type CollectAuditLogsOptions = {
  /** 1 回のエクスポートで書き出せる行数の上限（`AUDIT_LOG_EXPORT_MAX_ROWS`）。1 以上の整数。 */
  readonly maxRows: number;
  /** 1 ページの行数（既定 `PAGE_SIZE_MAX`。テストから小さくして「複数ページを追う」ことを見るための引数）。 */
  readonly pageSize?: number;
};

/**
 * #10 のページを先頭から末尾まで追い、`maxRows` を超えた時点で打ち切って `TOO_LARGE` を返す。
 * 🔴 応答の並びは #10 と同じ（`createdAt` 降順 → `id` 降順）。ページの継ぎ目で行が重複・欠落しないのは #10 のカーソルの性質
 *    （`cursor` の行の次から）に依る。
 */
export async function collectAuditLogsForExport(
  ctx: AuthenticatedTenantCtx,
  query: AuditLogExportQuery,
  options: CollectAuditLogsOptions,
): Promise<AuditLogExportCollection> {
  if (!Number.isInteger(options.maxRows) || options.maxRows < 1) {
    throw new RangeError(`collectAuditLogsForExport: maxRows は 1 以上の整数である必要があります（受け取った値: ${options.maxRows}）。`);
  }
  const pageSize = Math.min(options.pageSize ?? PAGE_SIZE_MAX, PAGE_SIZE_MAX);
  const items: AuditLogListItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listAuditLogs(ctx, {
      ...query,
      limit: pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    });
    items.push(...page.items);
    if (items.length > options.maxRows) return { kind: 'TOO_LARGE', maxRows: options.maxRows };
    if (page.nextCursor === null) return { kind: 'OK', items };
    cursor = page.nextCursor;
  }
}
