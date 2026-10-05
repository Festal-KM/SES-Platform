// apps/web/lib/chat/service.ts
// `POST /api/threads/{id}/messages`（`docs/05` §6.5 #51 / `F-038` / `docs/04` §S-031「操作と結果」）。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **投稿先の母集団は読みと同じ 1 実装**（`findChatThreadRow`）。見えないスレッドへの投稿は
//      **404**（`requireFound`）であり、403 と書き分けない（`docs/05` §4.8。書き分けると
//      「参加していないスレッドが実在すること」を応答から探れる）。RLS（C6）の `WITH CHECK` が
//      最後の砦として同じ判定をもう一度行う（二重防御）。
//   ② 🔴 **`owner_partner_company_id` を利用者入力から決めない。** 値はスレッド行（RLS で見えた行）
//      から取り、DB 側では継承トリガ `messages_inherit_owner`
//      （`20260903070000_owner_counterparty_inheritance`）が `chat_threads.partner_company_id` で
//      上書きする。したがってアプリが誤った値を渡しても**行は常に正しい会社に属する**。
//   ③ 🔴 **`senderPartnerCompanyId` は `ctx` から取る**（`CLAUDE.md` §3.1。リクエスト入力に
//      そのキーが存在しないことは `schemas.ts` の `AssertNoIsolationKeys` が型で固定する）。
//   ④ 🔴 **添付を受け取らない。** `CLAUDE.md` §3.4「ウイルススキャンが `CLEAN` になるまで共有 URL を
//      発行しない」/ §3.3「チャット添付は `ReviewGate` を通す」の配線が無い状態で口を開けない。
//      🔴 **本文だけの投稿にゲートは無い** —— §3.3 の列挙は「チャット**添付**」であり、
//      `Message.reviewGateId` も schema で「添付があるときのみ」と宣言されている。
//   ⑤ 🔴 **監査ログは業務トランザクションの中で書く**（`writeAuditLog`）。`withApiRoute` の `audit`
//      オプションはハンドラの**前**に別トランザクションで書くため、404 で**起きなかった投稿**まで
//      記録に残る（`skill_sheet.create` / `skill_alias.update` と同じ判断）。
//      🔴 `summary` に**本文を載せない**（`docs/05` §16.2「チャット本文を入れない」）。載せるのは
//      スレッドの ID と本文の長さだけである。
//   ⑥ 🔴 **二重送信を作らない。** 本操作は外部送信ではなく自テナント DB への 1 行の INSERT であり、
//      §3.4 の `idempotency_key` + CAS の射程（外部 API を呼ぶジョブ）には当たらない。
//      連打の抑止は画面側の `createSubmitGuard` が行う。
import { withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { CHAT_MESSAGE_SELECT, findChatThreadRow, projectChatMessages } from './read';
import type { ChatMessageBody } from './schemas';
import type { ChatMessageRow, ChatMessageView } from './views';

/** 🔴 `docs/05` §16.1 の `*.create`（`S-041` の操作種別フィルタは接尾辞一致）。独自 action を作らない。 */
export const CHAT_MESSAGE_AUDIT_ACTION_CREATE = 'message.create';

/** 🔴 `audit_logs.target_type` は状態機械・エンティティ名の表記（PascalCase。`docs/05` §16.1 の 🔴）。 */
export const CHAT_MESSAGE_AUDIT_TARGET_TYPE = 'Message';

export type SendChatMessageDeps = {
  readonly now: () => Date;
  readonly meta: { readonly ipAddress: string | null };
};

/** 投稿 1 件の結果（🔴 作成した 1 件だけを返す。会話全体を返さない）。 */
export type SendChatMessageResult = {
  readonly message: ChatMessageView;
};

export async function sendChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  input: ChatMessageBody,
  deps: SendChatMessageDeps,
): Promise<SendChatMessageResult> {
  const sentAt = deps.now();
  return withTenant(ctx, async (db) => {
    // ① 投稿先が見えるか（見えなければ 404。読みと同じ 1 実装）。
    const thread = requireFound(await findChatThreadRow(db, threadId));

    const created = (await db.message.create({
      data: {
        // 🔴 分離キーは**認証コンテキスト**から（`CLAUDE.md` §3.1。`createProposalDraft` と同じ規律）。
        //    Prisma 拡張（第 2 防御）も同じ値を注入し、RLS の `WITH CHECK`（第 1 防御）が
        //    別の値での INSERT を DB 側でも拒否する。
        tenantId: ctx.tenantId,
        threadId: thread.id,
        // ② 継承トリガが最終的に確定させる（アプリの値は一次的な整合にすぎない）。
        ownerPartnerCompanyId: thread.partnerCompanyId,
        // ③ 送信者は認証コンテキストから。
        senderUserId: ctx.userId,
        senderPartnerCompanyId: ctx.partnerCompanyId,
        body: input.body,
        sentAt,
      },
      select: CHAT_MESSAGE_SELECT,
    })) as ChatMessageRow;

    // 🔴 スレッドの「最終更新」は一覧の並びの根拠である（`read.ts` の `orderBy`）。
    //    投稿と**同じトランザクション**で進めないと、並びが実際の最終発言とずれる。
    await db.chatThread.update({ where: { id: thread.id }, data: { lastMessageAt: sentAt } });

    // ⑤ 監査（🔴 本文を載せない）。書けなければ例外 → トランザクションごと巻き戻る。
    await writeAuditLog(db, {
      action: CHAT_MESSAGE_AUDIT_ACTION_CREATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_MESSAGE_AUDIT_TARGET_TYPE,
      targetId: created.id,
      summary: { threadId: thread.id, bodyLength: input.body.length },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    const [message] = await projectChatMessages(ctx, db, [created]);
    // 🔴 1 行入れて 1 行写せないことは起こりえない（起きたら不変条件が壊れている）。黙って空を返さない。
    return { message: requireFound(message ?? null) };
  });
}
