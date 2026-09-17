// apps/web/lib/audit-logs/service.ts
// `GET /api/audit-logs`（docs/05 §6.3 #10 / `F-005` / `S-041`）。
//
// 🔴 `audit_logs` の SELECT は C2 HOST_ONLY（docs/05 §4.4）。パートナー文脈では 0 件になり、
//    アプリ側で絞り込みを重ねて書かない（`withTenant` が RLS と Prisma 拡張の二重防御を適用する）。
// 🔴 応答に PII を含めない。`summary` は元から PII を持たない規律（docs/05 §16.2）だが、それに頼らず
//    **`packages/domain` の `pickAuditDetail`（許可リスト）を通した固定形の `detail` だけ**を返す
//    （docs/05 §6.4「#10 の改訂」。T-11-09。生 JSON を型にも応答にも通さない）。
//    `actorDisplayName` は `actorKind === 'USER'` のときだけ `users` を引いて解決する
//    （C8 DIRECTORY によりホストは全利用者の表示名を読める。docs/05 §4.4）。
//
// 🔴 第二境界（`U-17`）: 主体の所属は**サーバで**解決する。`USER` 行の `actorId` を集めて 1 ページ 1 回の
//    `memberships.findMany`（C5 = ホスト文脈は全行。`@@unique([tenantId, userId])` で 1 人 1 行、
//    `partner_company_id` は付け替え不可なので過去の行にも同じ答えが出る。`revoked_at` の有無を問わない）。
//    `partnerCompanyId !== null` → `PARTNER` / `null` → `HOST` / 行が無い・`SYSTEM`・`PLATFORM_USER` → `UNRESOLVED`。
//    画面は判定しない（`detailSuppressedReason` を描くだけ）。
//
// 🔴 ID → 表示名の解決はページ単位で一括（`PARTNER_COMPANY` / `PROJECT` / `USER`。いずれもホストの自社データで
//    越境ではない）。1 ページの DB 往復は `audit_logs` + `users` + `memberships` + `partner_companies` + `projects`
//    の**最大 5 本**で行数に比例しない（結合テスト (h) が固定）。解決できない ID は `null` の要素として位置を保つ。
//    🔴 パートナー所有のエンジニア ID を名前に解決する種類は無い（`AuditDetailRefEntity` に `'ENGINEER'` が無い）。
import { withTenant, type AuditActorKind, type AuditDeviceKind, type AuthenticatedTenantCtx } from '@ses/db';
import {
  pickAuditDetail,
  type AuditActorScope,
  type AuditDetailEntry,
  type AuditDetailRefEntity,
  type PickedAuditDetail,
} from '@ses/domain';
import { buildCursorPage, takeForCursorPage, type CursorPage } from '../api/pagination';
import { auditLogCategoryWhere } from './categories';
import type { AuditLogQuery } from './schemas';
import type { AuditDetailEntryView, AuditDetailView, AuditLogListItem } from './view';

export type { AuditDetailEntryView, AuditDetailValueView, AuditDetailView, AuditLogListItem } from './view';

type NameMap = ReadonlyMap<string, string>;
type NameMaps = Readonly<Record<AuditDetailRefEntity, NameMap>>;

/** `findMany` の結果を `id → name` に畳む（無ければ空の Map。1 往復を省く）。 */
async function resolveNames(
  ids: ReadonlySet<string>,
  find: (idList: readonly string[]) => Promise<readonly { readonly id: string; readonly name: string }[]>,
): Promise<NameMap> {
  if (ids.size === 0) return new Map();
  return new Map((await find([...ids])).map((row) => [row.id, row.name] as const));
}

/** 許可リストを通った `REF` / `REF_LIST` の ID をエンティティ別に集める。 */
function collectRefIds(picked: readonly PickedAuditDetail[]): Record<AuditDetailRefEntity, Set<string>> {
  const ids: Record<AuditDetailRefEntity, Set<string>> = {
    PARTNER_COMPANY: new Set(),
    PROJECT: new Set(),
    USER: new Set(),
  };
  for (const detail of picked) {
    if (detail.kind !== 'DETAIL') continue;
    for (const entry of detail.entries) {
      if (entry.value.kind === 'REF') ids[entry.value.entity].add(entry.value.id);
      if (entry.value.kind === 'REF_LIST') for (const id of entry.value.ids) ids[entry.value.entity].add(id);
    }
  }
  return ids;
}

/** `REF` → `NAME` / `REF_LIST` → `NAME_LIST`。それ以外はそのまま。 */
function toEntryView(entry: AuditDetailEntry, names: NameMaps): AuditDetailEntryView {
  const { value } = entry;
  switch (value.kind) {
    case 'REF':
      return { key: entry.key, pair: entry.pair, value: { kind: 'NAME', value: names[value.entity].get(value.id) ?? null } };
    case 'REF_LIST':
      return {
        key: entry.key,
        pair: entry.pair,
        value: { kind: 'NAME_LIST', value: value.ids.map((id) => names[value.entity].get(id) ?? null) },
      };
    default:
      return { key: entry.key, pair: entry.pair, value };
  }
}

const EMPTY_DETAIL: AuditDetailView = { entries: [] };

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
        summary: true,
      },
    });

    const page = buildCursorPage(rows, query.limit, (row) => row.id);

    const userActorIds = new Set(
      page.items
        .filter((row) => row.actorKind === 'USER' && row.actorId !== null)
        .map((row) => row.actorId as string),
    );

    // 主体の所属（1 ページ 1 回）。
    const actorPartnerCompany =
      userActorIds.size === 0
        ? new Map<string, string | null>()
        : new Map(
            (
              await db.membership.findMany({
                where: { userId: { in: [...userActorIds] } },
                select: { userId: true, partnerCompanyId: true },
              })
            ).map((membership) => [membership.userId, membership.partnerCompanyId] as const),
          );

    const actorScopeOf = (row: { readonly actorKind: string; readonly actorId: string | null }): AuditActorScope => {
      if (row.actorKind !== 'USER' || row.actorId === null) return 'UNRESOLVED';
      const partnerCompanyId = actorPartnerCompany.get(row.actorId);
      if (partnerCompanyId === undefined) return 'UNRESOLVED';
      return partnerCompanyId === null ? 'HOST' : 'PARTNER';
    };

    // 🔴 `summary` を受け取るのはこの 1 箇所だけ（§17.2 #32）。
    const picked = page.items.map((row) => pickAuditDetail(row.action, row.summary, { actorScope: actorScopeOf(row) }));

    const refIds = collectRefIds(picked);
    for (const id of userActorIds) refIds.USER.add(id);

    const names: NameMaps = {
      USER: await resolveNames(refIds.USER, async (idList) =>
        (
          await db.user.findMany({ where: { id: { in: [...idList] } }, select: { id: true, displayName: true } })
        ).map((user) => ({ id: user.id, name: user.displayName })),
      ),
      PARTNER_COMPANY: await resolveNames(refIds.PARTNER_COMPANY, (idList) =>
        db.partnerCompany.findMany({ where: { id: { in: [...idList] } }, select: { id: true, name: true } }),
      ),
      PROJECT: await resolveNames(refIds.PROJECT, (idList) =>
        db.project.findMany({ where: { id: { in: [...idList] } }, select: { id: true, name: true } }),
      ),
    };

    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row, index) => {
        const detail = picked[index] ?? { kind: 'DETAIL', entries: [] };
        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          actorKind: row.actorKind as AuditActorKind,
          actorId: row.actorId,
          actorDisplayName:
            row.actorKind === 'USER' && row.actorId !== null ? (names.USER.get(row.actorId) ?? null) : null,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          ipAddress: row.ipAddress,
          deviceKind: row.deviceKind as AuditDeviceKind | null,
          detail:
            detail.kind === 'DETAIL' ? { entries: detail.entries.map((entry) => toEntryView(entry, names)) } : EMPTY_DETAIL,
          detailSuppressedReason: detail.kind === 'SUPPRESSED' ? detail.reason : null,
        };
      }),
    };
  });
}
