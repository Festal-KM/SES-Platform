// apps/web/lib/auth/next-auth.d.ts
// 🔴 Auth.js の型拡張は**この 1 ファイルだけ**に置く（docs/03 §4.9 のリスク回避:
//    「認証のラッパを apps/web/lib/auth の 1 箇所に閉じ、ページ・API から Auth.js の型を
//    直接参照しない」）。Auth.js v5 は beta であり API が変わりうるため、影響範囲を閉じる。
import type { TenantSessionClaims } from './claims';

declare module 'next-auth' {
  /** `authorize()` の戻り値。🔴 分離キーはここでしか運ばない。 */
  interface User {
    tenantId: string;
    partnerCompanyId: string | null;
  }

  interface Session {
    /** 🔴 ロール・ライフサイクル状態は載せない（`loadTenantMembership` が DB から確定する）。 */
    claims: TenantSessionClaims | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId?: string;
    partnerCompanyId?: string | null;
    userId?: string;
    /** 🔴 このセッションで第 2 要素を検証したか（T-03-02）。権限は載せない。 */
    twoFactorVerified?: boolean;
  }
}
