// packages/db/src/extension.ts
// 第 2 防御: Prisma Client Extension（CLAUDE.md §3.1 / docs/03 §4.3.1 / docs/05 §4.1）。
// 🔴 RLS が静かに無効化されても、ここで注入された where が残ることで 0 件に止まる。
import { Prisma } from '@prisma/client';
import {
  assertPartnerBaseTableNotAccessed,
  injectPartnerViewScope,
  injectTenantScope,
} from './scope-injection.js';

export type TenantScope = {
  readonly tenantId: string;
  /**
   * 🔴 null = ホスト所属（docs/05 §4.3）。経路 5 の基底表 5 デリゲートへの到達を
   *    実行時に止めるために要る（docs/05 §4.3-6 ②）。テナントキーの注入には使わない。
   */
  readonly partnerCompanyId: string | null;
};

/**
 * 全モデルの全操作にテナントキーを注入する拡張を作る。
 *
 * 🔴 加えて、パートナー文脈から経路 5 の基底表（`assignment` / `contract` / `contractDocument` /
 *    `order` / `extensionReview`）を操作したら `PartnerBaseTableAccessError` で止める
 *    （docs/05 §4.3-6 ②）。型（`TenantDb` の `Omit`）は `withHostTenant` を経ない
 *    「素の拡張越し」の呼び出しを止められず、RLS の C9 は**行を通してしまう**ため、
 *    ここで例外にして書き忘れを必ず露見させる（docs/05 §4.7 #9）。
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
          assertPartnerBaseTableNotAccessed({
            model,
            operation,
            partnerCompanyId: scope.partnerCompanyId,
          });
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

export type PartnerViewScope = {
  /** 🔴 当事者。`withPartnerScope` が ctx かホストのプレビュー引数のどちらか一方から決める。 */
  readonly counterpartyPartnerCompanyId: string;
};

/**
 * 経路 5 の射影ビュー（docs/05 §4.9）に当事者の述語を注入する拡張を作る。
 * `tenantScopeExtension` の**上に**重ねて適用する（両方の述語が `where.AND` に積まれる）。
 *
 * 🔴 パートナー文脈では C9（第 1 防御）と同じ述語の二重掛けになり、
 *    ホストのプレビューでは C9 が偽（= C2 で全行が見える）ためこの注入だけが対象を絞る。
 */
export function partnerViewScopeExtension(scope: PartnerViewScope) {
  return Prisma.defineExtension({
    name: 'ses-partner-view-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const scopedArgs = injectPartnerViewScope({
            model,
            operation,
            args,
            counterpartyPartnerCompanyId: scope.counterpartyPartnerCompanyId,
          });
          return query(scopedArgs as typeof args);
        },
      },
    },
  });
}
