// apps/web/app/api/(main)/auth/signin/route.ts
// docs/05 §6.3 #1 `POST /api/auth/signin`（`F-003` / `S-001`）。
//
// 🔴 Route Handler である（Server Actions を使わない。docs/05 §6.1 / P-A-04）。
//    「API を直接呼んでも拒否される」ことをテストで証明するには経路が 1 本でなければならない。
//
// 🔴 body に `tenantId` / `partnerCompanyId` を受け付けない（F-003 AC-1 / F-004 AC-2）。
//    `signInBodySchema` はそのキーを持たず、未知のキーは Zod の既定（strip）で捨てられる。
//    したがって body を改変しても参照範囲も応答も変わらない。
//
// 🔴 認証失敗の理由を区別しない（docs/04 §S-001）。応答は常に 401 / `error.unauthenticated`。
import { AuthenticationError, ValidationError, errorResponse } from '../../../../../lib/api/errors';
import { resolveSignInNext } from '../../../../../lib/auth/credentials';
import { signInBodySchema } from '../../../../../lib/auth/schemas';
import { signInWithCredentials } from '../../../../../lib/auth/session';

// 🔴 Node ランタイム固定。Argon2id（ネイティブアドオン）と Prisma は Edge で動かない。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * docs/05 §6.3 #1 の応答。
 * 🔴 `next` は**画面の遷移先の手がかり**であり、認可ではない（T-03-02）。
 *    実際の遮断は毎リクエストの `resolveTenantCtx`（docs/05 §6.2）が行うため、
 *    この値が古くても境界は緩まない。
 */
export type SignInResponse = { readonly next: '2fa' | 'home' };

export async function POST(request: Request): Promise<Response> {
  try {
    const raw: unknown = await request.json().catch(() => null);
    const parsed = signInBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    const outcome = await signInWithCredentials(parsed.data);
    if (outcome === 'REJECTED') return errorResponse(new AuthenticationError());

    // 🔴 認証に成功した本人にだけ返す（未知のメールアドレスに対しては到達しない）。
    const body: SignInResponse = { next: await resolveSignInNext(parsed.data.email) };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
