// packages/db/src/platform/queries/audit-logs.ts
// `A-006`（監査ログ横断検索）の専用クエリ関数 = API-A7 `GET /api/admin/audit-logs`
// （docs/05 §5.2「汎用エスケープハッチを作らない担保」/ §5.5 / §5.7 / §6.9 / `F-058` / `BR-40` / `BR-42`。T-11-03）。
//
// 🔴 記録をテナント横断で読む唯一の業務（`BR-42`）。読むのは `audit_logs` と、行の `tenant_id` を
//    テナント名に解決するための `tenants(id, name)` だけである。**`targetId` から本文・氏名・経歴を
//    引く経路をここに足さない**（`F-058 AC-2`。`tests/static/admin-no-content-reach.test.ts`）。
// 🔴 期間は必須（`from` / `to`。docs/03 申し送り 9 / §8.3-3）。上限日数の検証は API 境界
//    （`apps/web/lib/admin-audit-logs/schemas.ts`）が `AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS` で行い、
//    ここは受け取った期間をそのまま `where` に置く（**期間なしの呼び出しは型として書けない**）。
// 🔴 応答は必ず `toPlatformAuditLog`（docs/05 §5.5 第 2 層）を通す。`summary` の生 JSON を返さない。
// 🔴 検索の実行そのものが `AuditLog(admin.audit_log.search)` に残る（`F-058 AC-4`。`withPlatformRead` が
//    `fn` の前に書く）。`summary` には**条件（期間・フィルタ）だけ**を載せ、結果の内容は載せない。
import type { AuditActorKind, AuditDeviceKind } from '../../schema-value-sets.js';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import {
  toPlatformAuditLog,
  type PlatformAuditLogView,
} from '../../serializers/platform/audit-logs.js';
import type { PlatformRequestMeta } from './admin-home.js';

export type PlatformAuditLogSearchQuery = {
  /** 🔴 必須。省略できない（期間なしの全件検索を型として書けなくする）。 */
  readonly from: Date;
  readonly to: Date;
  readonly tenantId?: string;
  /** `action` 列の完全一致。 */
  readonly action?: string;
  readonly actorType?: AuditActorKind;
  readonly deviceKind?: AuditDeviceKind;
  readonly cursor?: string;
  readonly limit: number;
};

export type PlatformAuditLogSearchPage = {
  readonly items: readonly PlatformAuditLogView[];
  /** 次ページが無ければ `null`。🔴 総件数は返さない（一覧 API の一般規約と同じ）。 */
  readonly nextCursor: string | null;
};

/**
 * API-A7（`GET /api/admin/audit-logs`）。docs/05 §6.9。
 *
 * 🔴 `tenantId` を指定した場合は `targetTenantId` に渡し、RLS（`audit_logs_platform_read`）が
 *    そのテナントの行だけに閉じる。`where` の `tenantId` はそれと同値の明示であり、RLS が無くても
 *    同じ結果になることを意図した二重である（アプリの `where` だけに依存しない。docs/05 §5.2）。
 *    指定が無い場合は横断（`targetTenantId: null`）で、運営者自身の横断操作（`tenant_id IS NULL`）も含む。
 * 🔴 検索の記録は `tenant_id = 指定テナント`（指定時）/ `NULL`（横断）で残る。指定時はそのテナントの
 *    `OWNER` / `ADMIN` が `S-041` で「運営者が自社の記録を検索した」ことを見られる（`BR-41` の透明性）。
 */
export async function searchPlatformAuditLogs(
  ctx: AuthenticatedPlatformCtx,
  query: PlatformAuditLogSearchQuery,
  meta: PlatformRequestMeta = {},
): Promise<PlatformAuditLogSearchPage> {
  return withPlatformRead(
    {
      ctx,
      action: 'admin.audit_log.search',
      targetTenantId: query.tenantId ?? null,
      ipAddress: meta.ipAddress ?? null,
      // 🔴 条件だけ（`F-058 AC-4`「誰が・いつ・どの条件で」）。結果の件数・内容は載せない
      //    （件数を載せると「監査の記録が `fn` の結果に依存する」ことになり docs/05 §5.3 の不変条件に反する）。
      summary: {
        periodFrom: query.from.toISOString(),
        periodTo: query.to.toISOString(),
        filterTenantId: query.tenantId ?? null,
        filterAction: query.action ?? null,
        filterActorType: query.actorType ?? null,
        filterDeviceKind: query.deviceKind ?? null,
        limit: query.limit,
        page: query.cursor === undefined ? 'FIRST' : 'CONTINUATION',
      },
    },
    async (db) => {
      const take = query.limit + 1;
      const rows = await db.auditLog.findMany({
        where: {
          createdAt: { gte: query.from, lte: query.to },
          ...(query.tenantId === undefined ? {} : { tenantId: query.tenantId }),
          ...(query.action === undefined ? {} : { action: query.action }),
          ...(query.actorType === undefined ? {} : { actorKind: query.actorType }),
          ...(query.deviceKind === undefined ? {} : { deviceKind: query.deviceKind }),
        },
        // 🔴 uuid(7) は時系列で単調増加するため、id を第 2 キーにすれば同時刻の行でも順序が安定する。
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
        select: {
          id: true,
          tenantId: true,
          actorKind: true,
          actorId: true,
          action: true,
          targetType: true,
          targetId: true,
          summary: true,
          impersonationSessionId: true,
          ipAddress: true,
          deviceKind: true,
          createdAt: true,
        },
      });

      const hasNext = rows.length > query.limit;
      const page = hasNext ? rows.slice(0, query.limit) : rows;

      // テナント名の解決（`tenants.name` は `A-002` と同じく運営者に見せてよい）。
      const tenantIds = [
        ...new Set(page.map((row) => row.tenantId).filter((id): id is string => id !== null)),
      ];
      const tenantNames =
        tenantIds.length === 0
          ? new Map<string, string>()
          : new Map(
              (
                await db.tenant.findMany({
                  where: { id: { in: tenantIds } },
                  select: { id: true, name: true },
                })
              ).map((tenant) => [tenant.id, tenant.name] as const),
            );

      const items = page.map((row) =>
        toPlatformAuditLog({
          id: row.id,
          tenantId: row.tenantId,
          tenantName: row.tenantId === null ? null : (tenantNames.get(row.tenantId) ?? null),
          actorKind: row.actorKind,
          actorId: row.actorId,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          summary: row.summary,
          impersonationSessionId: row.impersonationSessionId,
          ipAddress: row.ipAddress,
          deviceKind: row.deviceKind,
          createdAt: row.createdAt,
        }),
      );

      const last = page[page.length - 1];
      return { items, nextCursor: hasNext && last !== undefined ? last.id : null };
    },
  );
}
