// packages/db/src/platform/queries/admin-home.ts
// 🔴 管理平面の画面ごとの専用クエリ関数（docs/05 §5.2「汎用エスケープハッチを作らない担保」）。
//    「テナントを指定して任意のテーブルを読む」汎用 API は**作らない**。各画面（`A-002`〜`A-014`）が
//    必要とする集計・件数を返す関数を 1 画面 1 ファイルで置き、画面と 1 対 1 に対応させる。
//
// 本ファイルは `/admin` ホームの分。🔴 **画面の閲覧そのものが `AuditLog` に残る**
// （docs/05 §5.3 の注記②「`F-055 AC-4` の画面閲覧は `/admin` ホームの GET を含めて
//  `withPlatformRead` 経由で記録」/ `BR-41`）。ページが直接 Prisma を触らずこの関数を呼ぶため、
// 「画面を開いたが記録が無い」状態が構造的に作れない。
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';

/**
 * `/admin` ホームに出す値。
 * 🔴 運営者に見せてよいのは**件数・状態・エラー**だけである（`CLAUDE.md` §10.5）。
 *    テナント名・エンジニア名・案件名などの「内容」を型に持たない。
 */
export type AdminHomeSummary = {
  readonly tenantCount: number;
};

export type PlatformRequestMeta = {
  readonly ipAddress?: string | null;
};

/**
 * `/admin` ホームの表示に要る件数を読む。
 *
 * 🔴 `targetTenantId: null`（横断）である。`A-002`（テナント一覧。T-03-09）と違い、
 *    ここで返すのは全テナントの件数 1 つだけで、テナントを特定する情報を返さない。
 */
export async function readAdminHomeSummary(
  ctx: AuthenticatedPlatformCtx,
  meta: PlatformRequestMeta = {},
): Promise<AdminHomeSummary> {
  return withPlatformRead(
    {
      ctx,
      action: 'admin.home.view',
      targetTenantId: null,
      ipAddress: meta.ipAddress ?? null,
    },
    async (db) => ({ tenantCount: await db.tenant.count() }),
  );
}
