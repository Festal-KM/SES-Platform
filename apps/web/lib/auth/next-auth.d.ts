// apps/web/lib/auth/next-auth.d.ts
// 🔴 Auth.js の型拡張は**この 1 ファイルだけ**に置く（docs/03 §4.9 のリスク回避:
//    「認証のラッパを apps/web/lib/auth の 1 箇所に閉じ、ページ・API から Auth.js の型を
//    直接参照しない」）。Auth.js v5 は beta であり API が変わりうるため、影響範囲を閉じる。
import type { TenantSessionClaims } from './claims';
import type { PlatformSessionClaims } from './platform-claims';

declare module 'next-auth' {
  /**
   * `authorize()` の戻り値。🔴 分離キーはここでしか運ばない。
   *
   * 🔴 T-03-07: Auth.js の `User` は**プロセスに 1 つしか無い**（module augmentation）。
   *    主平面（`tenantId` / `partnerCompanyId`）と管理平面（`platformUserId`）は
   *    **排他**であり、片方のインスタンスがもう片方のキーを返すことはない。
   *    そのため型としては全て optional にせざるを得ないが、**実行時は fail-closed で閉じている**:
   *      - 主平面: `parseTenantSessionClaims` が `tenantId` / `userId` の UUID を要求する
   *      - 管理平面: `parsePlatformSessionClaims` が `platformUserId` の UUID を要求する
   *    どちらも欠けていれば `null`（未認証扱い）になる。
   */
  interface User {
    tenantId?: string;
    partnerCompanyId?: string | null;
    /**
     * 🔴 T-03-07: 管理平面のインスタンスだけが設定する（`BR-36`）。
     *    主平面の `authorize()` はこの値を返さない。
     */
    platformUserId?: string;
  }

  interface Session {
    /** 🔴 ロール・ライフサイクル状態は載せない（`loadTenantMembership` が DB から確定する）。 */
    claims: TenantSessionClaims | null;
    /**
     * 🔴 T-03-07: 管理平面のインスタンスだけが設定する。主平面のインスタンスでは
     *    `undefined` のままであり、`requirePlatformCtx` は `undefined` を未認証として扱う。
     */
    platformClaims?: PlatformSessionClaims | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId?: string;
    partnerCompanyId?: string | null;
    userId?: string;
    /** 🔴 このセッションで第 2 要素を検証したか（T-03-02）。権限は載せない。 */
    twoFactorVerified?: boolean;
    /**
     * 🔴 T-03-07: 管理平面の主体。**フィールド名を主平面と分ける**（署名鍵が別なので
     *    そもそも相互に検証できないが、名前でも取り違えられないようにする）。
     */
    platformUserId?: string;
    platformTwoFactorVerified?: boolean;
  }
}
