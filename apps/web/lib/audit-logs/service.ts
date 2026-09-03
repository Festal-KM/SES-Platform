// apps/web/lib/audit-logs/service.ts
// `GET /api/audit-logs`（docs/05 §6.3 #10 / `F-005` / `S-041`）。
//
// 🔴 `audit_logs` の SELECT は C2 HOST_ONLY（docs/05 §4.4）。パートナー文脈では 0 件になり、
//    アプリ側で絞り込みを重ねて書かない（`withTenant` が RLS と Prisma 拡張の二重防御を適用する）。
// 🔴 応答に PII を含めない。`summary` は元から PII を持たない規律（docs/05 §16.2）。
//    `actorDisplayName` は `actorKind === 'USER'` のときだけ `users` を引いて解決する
//    （C8 DIRECTORY によりホストは全利用者の表示名を読める。docs/05 §4.4）。
import { withTenant, type AuditActorKind, type AuditDeviceKind, type AuthenticatedTenantCtx } from '@ses/db';
import { buildCursorPage, takeForCursorPage, type CursorPage } from '../api/pagination';
import { auditLogCategoryWhere } from './categories';
import type { AuditLogQuery } from './schemas';

export type AuditLogListItem = {
  readonly id: string;
  readonly createdAt: string;
  readonly actorKind: AuditActorKind;
  readonly actorId: string | null;
  /** 🔴 `actorKind === 'USER'` のときのみ解決する。削除済み・未確認の利用者は `null`。 */
  readonly actorDisplayName: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly ipAddress: string | null;
  readonly deviceKind: AuditDeviceKind | null;
};

export async function listAuditLogs(
  ctx: AuthenticatedTenantCtx,
  query: AuditLogQuery,
): Promise<CursorPage<AuditLogListItem>> {
  return withTenant(ctx, async (db) => {
    const rows = await db.auditLog.findMany({
      where: {
        createdAt: { gte: new Date(query.from), lte: new Date(query.to) },
        ...(query.action === undefined ? {} : auditLogCategoryWhere(query.action)),
        ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
      },
      // 🔴 uuid(7) は時系列で単調増加するため、id を第 2 キーにすれば同時刻の行でも順序が安定する。
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: takeForCursorPage(query.limit),
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      select: {
        id: true,
        createdAt: true,
        actorKind: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        ipAddress: true,
        deviceKind: true,
      },
    });

    const page = buildCursorPage(rows, query.limit, (row) => row.id);

    const userActorIds = [
      ...new Set(
        page.items
          .filter((row) => row.actorKind === 'USER' && row.actorId !== null)
          .map((row) => row.actorId as string),
      ),
    ];
    const actorNames =
      userActorIds.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              await db.user.findMany({
                where: { id: { in: userActorIds } },
                select: { id: true, displayName: true },
              })
            ).map((user) => [user.id, user.displayName] as const),
          );

    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actorKind: row.actorKind as AuditActorKind,
        actorId: row.actorId,
        actorDisplayName:
          row.actorKind === 'USER' && row.actorId !== null
            ? (actorNames.get(row.actorId) ?? null)
            : null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        ipAddress: row.ipAddress,
        deviceKind: row.deviceKind as AuditDeviceKind | null,
      })),
    };
  });
}
