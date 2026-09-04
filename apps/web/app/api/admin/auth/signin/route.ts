// apps/web/app/api/admin/auth/signin/route.ts
// docs/05 §6.9 API-A1 `POST /api/admin/auth/signin`（`F-055` / `A-001`）。認可: 未認証。
//
// 🔴 Route Handler である（Server Actions を使わない。docs/05 §6.1 / P-A-04）。
// 🔴 認証失敗の理由を区別しない（docs/04 `A-001`）。応答は常に 401 / `error.unauthenticated`。
//    **「テナント利用者の認証情報では到達できない」旨を応答に書かない**（存在の示唆を避ける）。
// 🔴 主平面の `POST /api/auth/signin` とは別インスタンス・別 Cookie・別署名鍵である
//    （`lib/auth/platform.ts`）。ここでテナントのセッションを読む経路は存在しない。
import { AuthenticationError, ValidationError, errorResponse } from '../../../../../lib/api/errors';
import { signInBodySchema } from '../../../../../lib/auth/schemas';
import { signInPlatformWithCredentials } from '../../../../../lib/auth/platform-session';

// 🔴 Node ランタイム固定。Argon2id（ネイティブアドオン）と Prisma は Edge で動かない。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * API-A1 の応答。
 * 🔴 運営者は**全員 2FA 必須**（`F-055 AC-3`）なので、`next` は常に `'2fa'` である。
 *    値を出し分けないため、応答から「その運営者が 2FA を設定済みか」は分からない。
 */
export type PlatformSignInResponse = { readonly next: '2fa' };

export async function POST(request: Request): Promise<Response> {
  try {
    const raw: unknown = await request.json().catch(() => null);
    const parsed = signInBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    const outcome = await signInPlatformWithCredentials(parsed.data);
    if (outcome === 'REJECTED') return errorResponse(new AuthenticationError());

    const body: PlatformSignInResponse = { next: '2fa' };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
