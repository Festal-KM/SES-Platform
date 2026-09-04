// apps/web/lib/admin-tenants/schemas.ts
// `GET /api/admin/tenants`（API-A2 / `A-002`）の境界検証と、`A-002` / `A-003` の画面が
// 共有するテナント ID 形状チェック。
//
// 🔴 `cursor` はテナント ID（uuid(7)）そのもの。`cursorPageQuerySchema`（複数エンティティで
//    共有する汎用スキーマ。`apps/web/lib/api/pagination.ts`）にテナント ID 前提の検証を
//    直接足さず、ここで個別に検証する（e2e-tester 指摘: 不正な形の `cursor` が Prisma の
//    `cursor: { id }` へそのまま渡ると `uuid` 型キャストの Postgres エラーで未捕捉のまま
//    500 になっていた）。
// 🔴 `apps/web/app/**` はルート定義とビューでありユニットテストを置かない
//    （`vitest.config.ts` の include コメント）。Route Handler と画面（`page.tsx`）の両方が
//    呼ぶ検証ロジックはここ（`apps/web/lib/**`）に置き、ユニットテストで固定する。
import { z } from 'zod';
import { cursorPageQuerySchema, type CursorPageQuery } from '../api/pagination';

const uuidSchema = z.uuid();

/** テナント ID として妥当な形状（UUID）かどうか。実在は確認しない。 */
export function isTenantIdLike(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export type AdminTenantListQueryResult =
  | { readonly ok: true; readonly value: CursorPageQuery }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * `GET /api/admin/tenants` の query を検証する（`apps/web/app/api/admin/tenants/route.ts` が
 * 呼ぶ唯一の経路）。
 *
 * 🔴 `cursorPageQuerySchema` の一般形状検証（非空・長さ上限）の**後**に、`cursor` がテナント ID の
 *    形（UUID）かどうかを追加で確認する。ここを通らない `cursor` は 400 になり、
 *    `listPlatformTenants`（＝ Prisma のカーソル句）へは一度も渡らない。
 */
export function parseAdminTenantListQuery(raw: unknown): AdminTenantListQueryResult {
  const parsed = cursorPageQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) };
  }
  if (parsed.data.cursor !== undefined && !isTenantIdLike(parsed.data.cursor)) {
    return { ok: false, issues: ['cursor'] };
  }
  return { ok: true, value: parsed.data };
}
