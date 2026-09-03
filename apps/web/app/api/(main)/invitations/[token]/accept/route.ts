// apps/web/app/api/(main)/invitations/[token]/accept/route.ts
// docs/05 §6.3 #7 `POST /api/invitations/{token}/accept`（`F-002` / `S-002`）。**未認証（トークン）**。
//
// 🔴 `withInvitationAccept`（docs/05 §4.4.2）の `acceptedAt` の CAS で **1 回限り**。
//    2 回目は 409（`InvitationNotAcceptableError`）で、利用者も所属も増えない。
// 🔴 ロール・所属・メールアドレスを body で受け取らない。すべて招待行から決まる（CLAUDE.md §3.1）。
// 🔴 受諾の記録は受諾と同一トランザクションで書かれる（`F-002 AC-3` / `F-005`）。
import { errorResponse, ValidationError } from '../../../../../../lib/api/errors';
import { readRequestMeta, signInWithCredentials } from '../../../../../../lib/auth/session';
import { ensureDbConfigured } from '../../../../../../lib/db/bootstrap';
import { acceptInvitationBodySchema } from '../../../../../../lib/invitations/schemas';
import { acceptInvitation } from '../../../../../../lib/invitations/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** docs/05 §6.3 #7 の応答。 */
export type AcceptInvitationResponse = { readonly userId: string };

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    ensureDbConfigured();
    const { token } = await context.params;
    const raw: unknown = await request.json().catch(() => null);
    const parsed = acceptInvitationBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    const accepted = await acceptInvitation(token, parsed.data, await readRequestMeta());

    // 🔴 ここから先は「受諾が確定した後の付随処理」である（docs/04 §S-002 の
    //    「受諾 → … → `S-003` / `S-004`」の導線を成立させるためのサインイン）。
    //    失敗しても受諾は取り消せない（DB は commit 済み）ので、500 にして
    //    「受諾できなかった」と誤解させない。サインインできなければ画面は `S-001` に落ちる。
    //    🔴 2 要素認証の設定（`S-002` セクション 3）は `S-001` のウィザードが唯一の実装であり、
    //    `OWNER` / `ADMIN` は `/` へ遷移した時点でそこへ送られる（`app/(main)/page.tsx`）。
    await signInWithCredentials({
      email: accepted.email,
      password: parsed.data.password,
    }).catch(() => 'REJECTED' as const);

    const body: AcceptInvitationResponse = { userId: accepted.userId };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
