// apps/web/lib/auth/platform-context.ts
// 🔴 `AuthenticatedPlatformCtx` を作る**アプリ側の唯一の入口**（T-03-07 / `F-055`）。
//    主平面の `tenant-context.ts` と対になる。
//
//    `resolvePlatformCtx`（packages/db）の呼び出し元をここ 1 箇所に閉じることで、
//    「ハンドラが自前でセッションを読み、ロールを詰めた ctx を組み立てる」実装を作れなくする
//    （`tests/static/auth-db-callers.test.ts` が走査する）。
//
// 🔴 ロールは DB から確定する。JWT に書かれたロールを信じない（`CLAUDE.md` §10.5）。
import type { AuthenticatedPlatformCtx, DeviceKind, PlatformUserFacts } from '@ses/db';
import { loadPlatformUserFacts, resolvePlatformCtx, twoFactorSessionState } from '@ses/db';
import type { PlatformSessionClaims } from './platform-claims';

/** ctx に載せてよいリクエスト由来の情報。🔴 主体の識別子を含めない。 */
export type PlatformRequestMeta = {
  readonly deviceKind: DeviceKind;
};

/**
 * セッションの主張から運営者の認証コンテキストを作る。
 *
 * `null` を返すのは次のいずれか（呼び出し側は 401 に写像する）:
 *   - `platform_users` の行が無い（削除済み / 別の主体）
 *   - 無効化済み（`disabledAt`）
 *
 * 🔴 2FA が未充足のときは `null` ではなく `TwoFactorRequiredError` が投げられる
 *    （`resolvePlatformCtx` の中。`F-055 AC-3`）。「未認証」と「第 2 要素が未充足」は別物である。
 */
export async function buildPlatformCtx(
  claims: PlatformSessionClaims,
  meta: PlatformRequestMeta,
): Promise<AuthenticatedPlatformCtx | null> {
  const facts = await loadPlatformUserFacts({ platformUserId: claims.platformUserId });
  if (facts === null) return null;
  return resolvePlatformCtx(
    {
      platformUserId: claims.platformUserId,
      platformRole: facts.role,
      // 🔴 DB の事実（設定済みか）とセッションの事実（このセッションで提示したか）を
      //    `twoFactorSessionState`（packages/db）で 1 つに畳む。主平面と同じ関数を使う。
      twoFactor: twoFactorSessionState({
        enrolled: facts.twoFactorEnrolled,
        verifiedInSession: claims.twoFactorVerified === true,
      }),
    },
    { deviceKind: meta.deviceKind },
  );
}

/**
 * 🔴 ロール・2FA の設定状態を DB から確定するだけの経路（ctx は作らない）。
 *
 * `POST /api/admin/auth/2fa/*` は「2FA 未設定の運営者」が使う操作であり、`buildPlatformCtx` は
 * 定義上そこで 403 を投げる。したがって**設定操作は ctx を作らずにアカウントの有効性だけを
 * 確かめる**必要がある。`loadPlatformUserFacts` の呼び出し元を本ファイル 1 つに保つため、
 * その入口をここに置く。
 *
 * 🔴 これは認可の緩和ではない: 戻り値は事実だけで、`AuthenticatedPlatformCtx` は生成されない。
 *    管理平面のクエリ経路（T-03-08）は依然として開かない。
 */
export async function loadPlatformFacts(
  claims: PlatformSessionClaims,
): Promise<PlatformUserFacts | null> {
  return loadPlatformUserFacts({ platformUserId: claims.platformUserId });
}
