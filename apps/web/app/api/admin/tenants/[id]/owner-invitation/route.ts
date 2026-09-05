// apps/web/app/api/admin/tenants/[id]/owner-invitation/route.ts
// docs/05 §6.9 API-A5 `POST /api/admin/tenants/{id}/owner-invitation`（`F-001` / `A-014`）。T-03-10。
//
// 🔴 認可: **`PLATFORM_OWNER` のみ**。`PLATFORM_SUPPORT` はルート自体が 403。
// 🔴 **API-A4 と分離している**（docs/05 §10.7 / `docs/04` 申し送り 14）。招待の失敗で
//    テナントを作り直させない。再送はこのルートの再実行だけで済む。
//
// 🔴 平文トークンの扱い（`CLAUDE.md` §3.4 / docs/05 §9.4）:
//    - DB に入るのは SHA-256 ハッシュだけ（`packages/db` には平文を渡さない）
//    - 平文は `account.mail` の payload（Redis）にしか載らない
//    - 🔴 **応答にも監査ログにも載せない。** `sandbox` の `inviteUrl`（`F-007 AC-4` / #14）は
//      「テナントの `OWNER` / `ADMIN` が取引先を招く」経路の話であり、本ルートとは違う。
//      運営者に `OWNER` 招待の平文トークンを返すと、**運営者がテナント利用者として
//      ログインできる経路**（権限昇格）になる（`CLAUDE.md` §10.5）。ここでは返さない。
//      `development` / `demo` でリンクの手渡しが要る場合の設計は SP-04（送信の単一経路）で扱う。
import { INVITATION_TTL_MS } from '@ses/config';
import { issueTenantOwnerInvitation } from '@ses/db/platform';
import { z } from 'zod';
import { parseOwnerInvitationBody } from '../../../../../../lib/admin-tenants/schemas';
import { errorResponse, requireFound, ValidationError } from '../../../../../../lib/api/errors';
import {
  readPlatformRequestMeta,
  requirePlatformOwnerCtx,
} from '../../../../../../lib/auth/platform-session';
import { generateToken, hashToken } from '../../../../../../lib/auth/tokens';
import {
  requireAccountMailQueue,
  type AccountMailDeliveryState,
} from '../../../../../../lib/jobs/account-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * 応答。🔴 `inviteUrl` / `token` のフィールドを**型として持たない**（上のコメント参照）。
 * `deliveryState` は「実送信の経路に載ったか（`QUEUED`）/ モックで終わるか（`MOCKED`）」であり、
 * **送信の成否ではない**（成否は `A-014` の「直近の開設」の招待の状態で追う）。
 */
export type OwnerInvitationResponse = {
  readonly id: string;
  readonly deliveryState: AccountMailDeliveryState;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requirePlatformOwnerCtx();

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return errorResponse(
        new ValidationError(parsedParams.error.issues.map((issue) => issue.path.join('.'))),
      );
    }
    const parsedBody = parseOwnerInvitationBody(await request.json().catch(() => null));
    if (!parsedBody.ok) return errorResponse(new ValidationError(parsedBody.issues));

    // 🔴 副作用（招待行の作成）の前にキューの存在を確かめる（`issueInvitation` と同じ規律）。
    //    後から分かると「作られたのに永久に届かない招待」が残る（`CLAUDE.md` §11.1）。
    const queue = requireAccountMailQueue();

    const now = new Date();
    const token = generateToken();
    const meta = await readPlatformRequestMeta();
    const result = await issueTenantOwnerInvitation(
      ctx,
      parsedParams.data.id,
      {
        email: parsedBody.value.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      },
      { ipAddress: meta.ipAddress, now },
    );
    // 🔴 存在しないテナント ID は 404（`null` → `NotFoundError`。docs/05 §4.8）。
    const invitation = requireFound(result);

    // 🔴 commit の後に enqueue する（未コミットの招待をワーカーが先に読む状態を作らない）。
    // 🔴 宛先分類は `issueTenantOwnerInvitation` が**書き込んだ招待行の所属**から導いた値である
    //    （docs/05 §8.2）。ここで `'HOST_MEMBER'` と書かない（自己申告させない）。
    const deliveryState = await queue.enqueue({
      tenantId: parsedParams.data.id,
      kind: 'INVITATION',
      targetId: invitation.invitationId,
      recipientClass: invitation.recipientClass,
      token,
    });

    const body: OwnerInvitationResponse = { id: invitation.invitationId, deliveryState };
    return Response.json(body, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
