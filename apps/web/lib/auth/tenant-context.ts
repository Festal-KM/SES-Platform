// apps/web/lib/auth/tenant-context.ts
// 🔴 `AuthenticatedTenantCtx` を作る**アプリ側の唯一の入口**（docs/05 §4.3 / F-003 AC-1）。
//
//    `resolveTenantCtx`（packages/db）の呼び出し元をここ 1 箇所に閉じることで、
//    「ハンドラが自前でセッションを読み、ロールを詰めた ctx を組み立てる」実装を作れなくする。
//    呼び出し元の限定は `tests/static/auth-db-callers.test.ts` が AST で検査する
//    （docs/05 §17.2 の方針。#20 が `apps/worker` に `resolveTenantCtx` が無いことを見るのと対）。
//
// 🔴 分離キーはセッション（＝認証）から、ロールとライフサイクル状態は DB から確定する。
//    リクエストの body / query / path は 1 バイトも参照しない（CLAUDE.md §3.1 / BR-03）。
import type { AuthenticatedTenantCtx, DeviceKind, TenantMembershipFacts } from '@ses/db';
import { loadTenantMembership, resolveTenantCtx, twoFactorSessionState } from '@ses/db';
import type { TenantSessionClaims } from './claims';

/** ctx に載せてよいリクエスト由来の情報。🔴 分離キーを含めない。 */
export type RequestContextMeta = {
  readonly deviceKind: DeviceKind;
};

/**
 * セッションの主張から認証コンテキストを作る。
 *
 * `null` を返すのは次のいずれか（呼び出し側は 401 に写像する）:
 *   - 有効な `Membership` が無い（失効 / 未受諾 / 別テナント）
 *   - `Membership` の所属がセッションの所属と食い違う（fail-closed）
 *   - `Tenant` が読めない
 *
 * 🔴 「見えない ＝ 存在しない」（docs/05 §4.8）に従い、理由を呼び出し側へ返さない。
 */
export async function buildTenantCtx(
  claims: TenantSessionClaims,
  meta: RequestContextMeta,
): Promise<AuthenticatedTenantCtx | null> {
  const facts = await loadTenantMembership(claims);
  if (facts === null) return null;
  return resolveTenantCtx(
    {
      tenantId: claims.tenantId,
      partnerCompanyId: claims.partnerCompanyId,
      userId: claims.userId,
      role: facts.role,
      lifecycleState: facts.lifecycleState,
      // 🔴 T-04-07（`F-007 AC-2`）: 取引先企業の停止は**セッションではなく DB の事実**である。
      //    `lifecycleState` と同じく毎リクエスト確定するので、停止は次のリクエストから効く。
      partnerSuspendedAt: facts.partnerSuspendedAt,
      // 🔴 DB の事実（設定済みか）とセッションの事実（このセッションで提示したか）を
      //    `twoFactorSessionState`（packages/db）で 1 つに畳む。ここで真偽値を自前に
      //    組み合わせない（畳み方が 2 箇所に分かれると、片方だけ緩む）。
      twoFactor: twoFactorSessionState({
        enrolled: facts.twoFactorEnrolled,
        verifiedInSession: claims.twoFactorVerified === true,
      }),
    },
    { deviceKind: meta.deviceKind },
  );
}

/**
 * 🔴 ロール・テナント状態・2FA の設定状態を DB から確定するだけの経路（ctx は作らない）。
 *
 * `POST /api/auth/2fa/*`（docs/05 §6.3 #2 / #3）は「2FA 未設定の `OWNER`」が使う操作であり、
 * `buildTenantCtx` は定義上そこで 403 を投げる。したがって**設定操作は ctx を作らずに
 * 所属の有効性だけを確かめる**必要がある。`loadTenantMembership` の呼び出し元を
 * 本ファイル 1 つに保つため（`tests/static/auth-db-callers.test.ts`）、その入口をここに置く。
 *
 * 🔴 これは認可の緩和ではない: 戻り値は事実だけで、`AuthenticatedTenantCtx` は生成されない。
 *    業務データに触れる経路（`withTenant`）は依然として開かない。
 */
export async function loadAuthFacts(
  claims: TenantSessionClaims,
): Promise<TenantMembershipFacts | null> {
  return loadTenantMembership(claims);
}
