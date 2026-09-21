// packages/db/src/audit-log-export.ts
// 🔴 `S-041` の CSV エクスポート（#10b `GET /api/audit-logs/export`）の監査記録 `audit_log.export`
//    （docs/05 §6.3 #10b / §6.4「CSV エクスポート」行 ⑤ / §16.1。`docs/04` §S-041「エクスポート → CSV（監査ログに記録される）」）。T-12-18 ⑪。
//
// 🔴 なぜ `packages/db` に置くか: `summary` の組み立てを **CSV を生成する側（`apps/web/lib/audit-logs/**` / #10b の route）に置かない**
//    ため。あちらは `detail` / `summary` の識別子を持たない（`tests/static/audit-detail-single-path.test.ts` の CSV 検査 =
//    許可リストの 2 実装が構造的に書けない）。書く行の形はここで閉じる（`dataExportDownloadSummary` / `finishTenantPurgeRun` と同じ作法）。
// 🔴 載せるのは `rowCount`（実際に書き出した行数）と `truncated`（`AUDIT_LOG_EXPORT_MAX_ROWS` で打ち切ったか）の 2 キーだけ。
//    **検索条件（`from` / `to` / `action` / `actorId`）と CSV の内容は載せない**（条件の組み合わせ自体が「誰が誰を検索したか」の
//    手がかりになりうる。API-A7 の `admin.audit_log.search` とは異なり条件は記録しない）。
// 🔴 `targetType='Tenant'` / `targetId` = エクスポートしたテナント自身（`usage.limit_*` と同じ慣例。§16.1）。
//    400 `AUDIT_LOG_EXPORT_TOO_LARGE` で弾いた要求は「エクスポートが行われていない」ため、呼び出し側はこの関数を呼ばない。
import { writeAuditLog } from './audit.js';
import type { AuthenticatedTenantCtx } from './context.js';
import { withTenant } from './with-tenant.js';

/** docs/05 §16.1 の `audit_log.export`（`actorKind='USER'`。1 エクスポート 1 行）。 */
export const AUDIT_LOG_EXPORT_AUDIT_ACTION = 'audit_log.export';

export type AuditLogExportOutcome = {
  /** 実際に書き出した行数（ヘッダを除く）。 */
  readonly rowCount: number;
  /** `AUDIT_LOG_EXPORT_MAX_ROWS` で打ち切ったか。Phase 1 は上限超過を 400 で弾くため常に `false` になる（キーは §6.4 の許可リスト行に対応）。 */
  readonly truncated: boolean;
};

export type AuditLogExportMeta = {
  readonly ipAddress: string | null;
};

/**
 * `audit_log.export` を 1 行書く（`withTenant` = RLS + Prisma 拡張の二重防御の中。分離キーは `ctx` から）。
 * 🔴 書けなければ例外（`AuditLogWriteError`）= 呼び出し側は CSV を返さない（`F-005` / `F-012 AC-2` と同じ規律）。
 */
export async function recordAuditLogExport(
  ctx: AuthenticatedTenantCtx,
  outcome: AuditLogExportOutcome,
  meta: AuditLogExportMeta,
): Promise<void> {
  if (!Number.isInteger(outcome.rowCount) || outcome.rowCount < 0) {
    throw new RangeError(`audit-log-export: rowCount は 0 以上の整数である必要があります（受け取った値: ${outcome.rowCount}）。`);
  }
  await withTenant(ctx, (db) =>
    writeAuditLog(db, {
      action: AUDIT_LOG_EXPORT_AUDIT_ACTION,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'Tenant',
      targetId: ctx.tenantId,
      summary: { rowCount: outcome.rowCount, truncated: outcome.truncated },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    }),
  );
}
