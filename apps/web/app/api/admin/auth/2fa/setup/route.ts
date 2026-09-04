// apps/web/app/api/admin/auth/2fa/setup/route.ts
// API-A1 の 2FA 設定（`A-001` セクション 3 の設定ウィザード）。認可: **一次認証済み**。
//
// 🔴 API-A1 は docs/05 §6.9 で「`POST /api/admin/auth/signin` / `2fa/verify`」と書かれているが、
//    `F-055 AC-3`（2FA を設定するまで管理平面のいずれの画面にも到達できない）を満たすには
//    **設定の入口が必要**である（無いと、新設された運営者は永久に管理平面へ入れない）。
//    主平面の `#2 verify` / `#3 setup`（docs/05 §6.3）と同じ 2 本立てにした。
//
// 🔴 一次認証済み（パスワードは通ったがまだ第 2 要素は未提示）で実行できなければならない。
//    ここで `requirePlatformCtx` を要求すると設定操作そのものが永久にできなくなる。
//    代わりに「有効な `PlatformUser` であること」だけを確かめ、DB 側は RLS
//    （本人の `PLATFORM_USER` 行のみ）で閉じる。
//
// 🔴 応答に含まれるシークレット（`otpauthUrl`）とリカバリコード平文は、**この 1 回だけ**返る。
import { AuthenticationError, errorResponse } from '../../../../../../lib/api/errors';
import { loadPlatformFacts } from '../../../../../../lib/auth/platform-context';
import {
  currentPlatformClaims,
  readPlatformRequestMeta,
} from '../../../../../../lib/auth/platform-session';
import { startPlatformEnrollment } from '../../../../../../lib/auth/platform-two-factor';
import { ensureDbConfigured } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type PlatformTwoFactorSetupResponse =
  | {
      readonly status: 'ENROLLMENT_STARTED';
      readonly otpauthUrl: string;
      readonly recoveryCodes: readonly string[];
    }
  | { readonly status: 'ALREADY_ENROLLED' };

export async function POST(): Promise<Response> {
  try {
    ensureDbConfigured();
    const claims = await currentPlatformClaims();
    if (claims === null) return errorResponse(new AuthenticationError());

    // 🔴 無効化済みなら設定もできない（ctx は作らないが、有効性は毎回 DB で確かめる）。
    const facts = await loadPlatformFacts(claims);
    if (facts === null) return errorResponse(new AuthenticationError());

    const result = await startPlatformEnrollment(
      { platformUserId: claims.platformUserId },
      await readPlatformRequestMeta(),
    );
    const body: PlatformTwoFactorSetupResponse =
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
