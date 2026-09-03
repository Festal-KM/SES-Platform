// apps/web/app/api/(main)/auth/password-reset/confirm/route.ts
// docs/05 §6.3 #5b `POST /api/auth/password-reset/confirm`（`F-003`）。**未認証（トークン）**。
//
// 🔴 トークン列の CAS で **1 回限り**。期限超過は 400（docs/05 §6.3 #5b）。
//    不一致・使用済み・期限切れを**区別しない**（区別するとトークンの実在が漏れる）。
// 🔴 成功しても「誰の」パスワードを変えたかを応答に載せない（204）。
import {
  errorResponse,
  PasswordResetTokenInvalidError,
  ValidationError,
} from '../../../../../../lib/api/errors';
import { confirmPasswordReset } from '../../../../../../lib/auth/password-reset';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { passwordResetConfirmBodySchema } from '../../../../../../lib/auth/schemas';
import { ensureDbConfigured } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    ensureDbConfigured();
    const raw: unknown = await request.json().catch(() => null);
    const parsed = passwordResetConfirmBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    const result = await confirmPasswordReset(
      parsed.data.token,
      parsed.data.password,
      await readRequestMeta(),
    );
    if (result === null) return errorResponse(new PasswordResetTokenInvalidError());

    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
