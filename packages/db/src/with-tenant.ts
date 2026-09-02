// packages/db/src/with-tenant.ts
// 🔴 主平面が業務データに触れる唯一の経路（CLAUDE.md §3.1 / docs/05 §4.3）。
//    第 1 防御（RLS への SET LOCAL）と第 2 防御（Prisma 拡張の where 注入）を
//    同じ 1 箇所で必ず両方適用する。片方だけ適用される経路を作らない（docs/03 §4.3.2）。
import type { PrismaClient } from '@prisma/client';
import { getBaseClient } from './client.js';
import type { AuthenticatedTenantCtx } from './context.js';
import { tenantScopeExtension } from './extension.js';
import { tenantScopeSettingsSql } from './scope-settings.js';

function extendWithTenantScope(client: PrismaClient, ctx: AuthenticatedTenantCtx) {
  return client.$extends(tenantScopeExtension({ tenantId: ctx.tenantId }));
}

type ExtendedClient = ReturnType<typeof extendWithTenantScope>;

/** `$transaction` のコールバックが受け取るクライアント（`$transaction` 等は Prisma 側で除去済み）。 */
type TenantTransactionClient = Parameters<Parameters<ExtendedClient['$transaction']>[0]>[0];

/**
 * `fn` に渡すクライアント。
 * 🔴 生 SQL の入口を型から除去する（docs/05 §4.3 実装の規約 3）。拡張のフックを通らないため。
 *    経路 5 の基底表 5 デリゲートの除去は、その表が存在する SP-02 / T-01-06 で追加する。
 * 🔴 export しない（`fn` の引数型としてのみ現れる。docs/05 §4.3 違反時の挙動）。
 */
type TenantDb = Omit<
  TenantTransactionClient,
  '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe'
>;

/**
 * テナント文脈で業務データにアクセスする。
 *
 * 🔴 `ctx` は `resolveTenantCtx` でしか作れない = 分離キーがリクエスト入力から来る経路が無い。
 * 🔴 必ず `$transaction` を開き、その先頭で `SET LOCAL`（= `set_config(..., true)`）を発行する。
 */
export async function withTenant<T>(
  ctx: AuthenticatedTenantCtx,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  const scoped = extendWithTenantScope(getBaseClient(), ctx);
  return scoped.$transaction(async (tx) => {
    await tx.$queryRaw(
      tenantScopeSettingsSql({
        tenantId: ctx.tenantId,
        partnerCompanyId: ctx.partnerCompanyId,
        actorUserId: ctx.userId,
      }),
    );
    return fn(tx);
  });
}
