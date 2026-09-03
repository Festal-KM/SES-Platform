// apps/web/app/api/(main)/invitations/[token]/route.ts
// docs/05 §6.3 #6 `GET /api/invitations/{token}`（`F-002` / `S-002`）。**未認証**。
//
// 🔴 `withInvitationToken`（docs/05 §4.4.2）でトークン一致の 1 行だけを可視にする。
//    分離キーはリクエスト入力ではなく、その行の `tenant_id` から来る（CLAUDE.md §3.1）。
// 🔴 該当が無ければ 404（理由を区別しない。docs/05 §4.8「見えない = 存在しない」）。
// 🔴 期限切れ / 受諾済み / 取消済みは 200 + `status` で返す。docs/04 §S-002 が
//    「期限切れ」「使用済み」の**専用文言とサインイン導線**を要求しており、
//    404 に畳むと画面が出し分けられないため（返すのは組織名だけ。担当者名もロールも出さない）。
import { errorResponse, NotFoundError } from '../../../../../lib/api/errors';
import { ensureDbConfigured } from '../../../../../lib/db/bootstrap';
import { readInvitationByToken, type InvitationView } from '../../../../../lib/invitations/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type InvitationTokenResponse = InvitationView;

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    ensureDbConfigured();
    const { token } = await context.params;
    const view = await readInvitationByToken(token);
    if (view === null) return errorResponse(new NotFoundError());
    // 🔴 トークンを含む URL の応答をキャッシュさせない（共有キャッシュに残さない）。
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
