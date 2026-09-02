// packages/db/src/extension.ts
// 第 2 防御: Prisma Client Extension（CLAUDE.md §3.1 / docs/03 §4.3.1 / docs/05 §4.1）。
// 🔴 RLS が静かに無効化されても、ここで注入された where が残ることで 0 件に止まる。
import { Prisma } from '@prisma/client';
import { injectTenantScope } from './scope-injection.js';

export type TenantScope = {
  readonly tenantId: string;
};

/**
 * 全モデルの全操作にテナントキーを注入する拡張を作る。
 *
 * ⚠️ 既知の射程外（docs/03 §4.3.1 の「リスク」欄）:
 *   - `$queryRaw` / `$executeRaw` は `$allModels` のフックを通らない
 *     → withTenant が渡す型から除去し、ESLint でアプリコードからの呼び出しを禁止する（T-01-06）
 *   - ネストした書き込み（`data: { children: { create: ... } }`）は親の操作としてしか見えない
 *   いずれも第 1 防御（RLS）が最後の砦として効く。だからこその二重防御である。
 */
export function tenantScopeExtension(scope: TenantScope) {
  return Prisma.defineExtension({
    name: 'ses-tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const scopedArgs = injectTenantScope({
            model,
            operation,
            args,
            tenantId: scope.tenantId,
          });
          // injectTenantScope は引数の形（where / data / create）だけを変えるため、
          // Prisma が推論する操作ごとの引数型と構造的に一致する。
          return query(scopedArgs as typeof args);
        },
      },
    },
  });
}
