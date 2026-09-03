// apps/web/lib/auth/claims.ts
// セッション（JWT）が運ぶ主張の型。
//
// 🔴 セッションが運ぶのは **識別子だけ**である（テナント / パートナー所属 / 利用者）。
//    ロールとテナントのライフサイクル状態を**焼き込まない**:
//      ① 権限変更・`Membership` の失効・ライフサイクル遷移が、セッションの有効期間ぶん遅れる
//      ② JWT の中身がそのまま権限になる設計は、署名が破られた場合の被害が権限昇格まで及ぶ
//    これらは `loadTenantMembership`（packages/db）がリクエストごとに DB から確定させる。
//
// 🔴 `tenantId` / `partnerCompanyId` の出所は `withAuthLookup` が返した `users` 行であり、
//    リクエスト入力ではない（CLAUDE.md §3.1 / BR-03 / F-003 AC-1）。
import type { TenantIdentity } from '@ses/db';

/**
 * 主平面のセッションが運ぶ主張。`TenantIdentity`（packages/db）の 3 キー +
 * 🔴 **第 2 要素をこのセッションで提示したかどうか**（T-03-02）。
 *
 * 🔴 なぜこれだけは JWT に載せるのか: 「設定済みか」は DB の事実なので毎回引き直せるが、
 *    「**このセッションで**コードを入力したか」はセッションにしか存在しない事実であり、
 *    DB から復元できない。これを持たないと、一度設定した後はパスワードだけで入れてしまう。
 * 🔴 これは権限（ロール）ではない。ロール・ライフサイクル状態は従来どおり DB から確定する。
 * 🔴 未設定（`undefined`）は **false 扱い**（fail-closed）。古い / 改変された JWT が
 *    「検証済み」に化けることはない（`parseTenantSessionClaims` が `=== true` でのみ真にする）。
 */
export type TenantSessionClaims = TenantIdentity & {
  readonly twoFactorVerified?: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * 🔴 セッション更新（Auth.js の `trigger === 'update'`）で**受け付けてよい唯一の宣言**:
 *    「このセッションで 2 要素認証を検証した」。
 *
 * 🔴 分離キー（`tenantId` / `partnerCompanyId` / `userId`）は更新経路では一切見ない。
 *    見てしまうと、セッション更新が**境界の乗り換え**になる（CLAUDE.md §3.1 / BR-03）。
 *    そのため判定はこの 1 ビットだけを返し、呼び出し側（`main.ts` の jwt コールバック）は
 *    真のときに `twoFactorVerified` を立てる以外のことをしない。
 */
export function isTwoFactorVerifiedUpdate(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const claims = (payload as { claims?: unknown }).claims;
  if (typeof claims !== 'object' || claims === null) return false;
  return (claims as { twoFactorVerified?: unknown }).twoFactorVerified === true;
}

/**
 * JWT のペイロード（`unknown`）から主張を取り出す。
 * 🔴 fail-closed: 形が違えば `null`（部分的に読めた値で続行しない）。
 */
export function parseTenantSessionClaims(payload: unknown): TenantSessionClaims | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const tenantId = record['tenantId'];
  const userId = record['userId'];
  const partnerCompanyId = record['partnerCompanyId'] ?? null;
  if (!isUuid(tenantId) || !isUuid(userId)) return null;
  if (partnerCompanyId !== null && !isUuid(partnerCompanyId)) return null;
  return {
    tenantId,
    userId,
    partnerCompanyId,
    // 🔴 `=== true` 以外はすべて未検証（fail-closed）。
    twoFactorVerified: record['twoFactorVerified'] === true,
  };
}
