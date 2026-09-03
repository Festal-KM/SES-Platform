// apps/web/app/api/(main)/auth/password-reset/route.ts
// docs/05 §6.3 #5 `POST /api/auth/password-reset`（`F-003`）。**未認証**。
//
// 🔴 応答は**常に 204**（存在有無を返さない）。該当するアカウントが無くても、
//    無効化されていても、同じ応答になる（docs/05 §6.3 #5 / §4.8）。
// 🔴 検証エラー（メール形式が不正）だけは 400 になる。これはアカウントの存在とは無関係であり、
//    入力そのものの問題である（存在の手がかりにならない）。
import { errorResponse, ValidationError } from '../../../../../lib/api/errors';
import { requestPasswordReset } from '../../../../../lib/auth/password-reset';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { passwordResetRequestBodySchema } from '../../../../../lib/auth/schemas';
import { ensureDbConfigured } from '../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    ensureDbConfigured();
    const raw: unknown = await request.json().catch(() => null);
    const parsed = passwordResetRequestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    // 🔴 戻り値を持たない関数である（「送ったか」を応答に反映できない構造）。
    await requestPasswordReset(parsed.data.email, await readRequestMeta());
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
