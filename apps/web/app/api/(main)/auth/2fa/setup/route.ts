// apps/web/app/api/(main)/auth/2fa/setup/route.ts
// docs/05 §6.3 #3 `POST /api/auth/2fa/setup`（`F-003` / `S-001`）。認可: **一次認証済み**。
//
// 🔴 一次認証済み（パスワードは通ったがまだ第 2 要素は未提示）で実行できなければならない。
//    `OWNER` / `ADMIN` は 2FA 未設定だと `resolveTenantCtx` が 403 を返す（docs/05 §6.2）ため、
//    ここで `requireTenantCtx` を要求すると**設定操作そのものが永久にできなくなる**。
//    代わりに「有効な `Membership` があること」だけを確かめ、DB 側は RLS の C7 SELF
//    （本人の 1 行のみ）で閉じる。
//
// 🔴 body を取らない（docs/05 §6.3 #3 の request は `{}`）。分離キーはセッションのみが出所。
// 🔴 応答に含まれるシークレット（`otpauthUrl`）とリカバリコード平文は、**この 1 回だけ**返る。
//    ログ・監査ログには出さない（`packages/db` には暗号文とハッシュしか渡っていない）。
import { AuthenticationError, errorResponse } from '../../../../../../lib/api/errors';
import { currentClaims, readRequestMeta } from '../../../../../../lib/auth/session';
import { loadAuthFacts } from '../../../../../../lib/auth/tenant-context';
import { startEnrollment } from '../../../../../../lib/auth/two-factor';
import { ensureDbConfigured } from '../../../../../../lib/db/bootstrap';

// 🔴 Node ランタイム固定。Argon2id（ネイティブアドオン）と Prisma は Edge で動かない。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * docs/05 §6.3 #3 の応答。
 * 🔴 `ALREADY_ENROLLED` は「確認済みの資格情報があるので上書きしない」ことを表す
 *    （エンドポイントを増やさずに、呼び出し側をコード入力へ進ませるための分岐）。
 */
export type TwoFactorSetupResponse =
  | {
      readonly status: 'ENROLLMENT_STARTED';
      readonly otpauthUrl: string;
      readonly recoveryCodes: readonly string[];
    }
  | { readonly status: 'ALREADY_ENROLLED' };

export async function POST(): Promise<Response> {
  try {
    ensureDbConfigured();
    const claims = await currentClaims();
    if (claims === null) return errorResponse(new AuthenticationError());

    // 🔴 所属が失効していれば設定もできない（ctx は作らないが、有効性は毎回 DB で確かめる）。
    const facts = await loadAuthFacts(claims);
    if (facts === null) return errorResponse(new AuthenticationError());

    const result = await startEnrollment(claims, await readRequestMeta());
    const body: TwoFactorSetupResponse =
      result.status === 'ALREADY_ENROLLED'
        ? { status: 'ALREADY_ENROLLED' }
        : {
            status: 'ENROLLMENT_STARTED',
            otpauthUrl: result.otpauthUrl,
            recoveryCodes: result.recoveryCodes,
          };
    // 🔴 シークレットを含む応答をキャッシュさせない。
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
