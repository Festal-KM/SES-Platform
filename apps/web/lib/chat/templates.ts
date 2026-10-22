// apps/web/lib/chat/templates.ts
// ✅ 2026-10-22（チャットレーン・紺野「自分だけ」）: 自分の定型文（`chat_message_templates`。docs/05 §3.7.1 / §6.5 #51m）。
//
// 🔴 ここが守るもの
//   ① 🔴 **読み書きできるのは本人の行だけ**（RLS の C7 SELF）。`where` に境界を書き足さない —— ほかの人の定型文は
//      存在も件数も返らない。会社共通の定型文は作らない（紺野の決定）。
//   ② 🔴 利用者 ID は認証コンテキストから取る（リクエスト入力から受けない。CLAUDE.md §3.1）。
//   ③ 1 人 50 件まで（アプリで数えて止める。超えたら 409）。
//   ④ 🔴 作成・更新・削除のたびに監査ログを 1 行、**同じトランザクションの中で**書く（`chat_template.create` / `.update` / `.delete`）。
//      🔴 **見出し・本文は載せず文字数だけ**（`user-status.ts` / `service.ts` の `message.update` と同じ）。
import { withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { ConflictError, requireFound } from '../api/errors';
import { CHAT_TEMPLATE_MAX_PER_USER, type ChatTemplateBody } from './schemas';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 定型文 1 件（入力欄の選択肢と管理画面の 1 行）。 */
export type ChatTemplateView = {
  readonly id: string;
  readonly label: string;
  readonly body: string;
};

export const CHAT_TEMPLATE_AUDIT_ACTION_CREATE = 'chat_template.create';
export const CHAT_TEMPLATE_AUDIT_ACTION_UPDATE = 'chat_template.update';
export const CHAT_TEMPLATE_AUDIT_ACTION_DELETE = 'chat_template.delete';
/** 🔴 `audit_logs.target_type` はエンティティ名の表記（PascalCase）。 */
export const CHAT_TEMPLATE_AUDIT_TARGET_TYPE = 'ChatMessageTemplate';

export type ChatTemplateDeps = { readonly meta: { readonly ipAddress: string | null } };

const TEMPLATE_SELECT = { id: true, label: true, body: true } as const;

/** 自分の定型文（作った順）。🔴 本人の行だけが返る（RLS）。解約で空になった行は出さない。 */
export async function readChatTemplates(db: Pick<TenantDb, 'chatMessageTemplate'>): Promise<readonly ChatTemplateView[]> {
  const rows = await db.chatMessageTemplate.findMany({
    select: TEMPLATE_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: CHAT_TEMPLATE_MAX_PER_USER,
  });
  return rows.filter((row) => row.label !== '' && row.body !== '');
}

/** 画面の入口（自分の定型文）。 */
export async function readMyChatTemplates(ctx: AuthenticatedTenantCtx): Promise<readonly ChatTemplateView[]> {
  return withTenant(ctx, (db) => readChatTemplates(db));
}

async function audit(
  db: TenantDb,
  ctx: AuthenticatedTenantCtx,
  action: string,
  templateId: string,
  input: ChatTemplateBody | null,
  deps: ChatTemplateDeps,
): Promise<void> {
  await writeAuditLog(db, {
    action,
    actorKind: 'USER',
    actorId: ctx.userId,
    targetType: CHAT_TEMPLATE_AUDIT_TARGET_TYPE,
    targetId: templateId,
    summary: input === null ? {} : { labelLength: input.label.length, bodyLength: input.body.length },
    ipAddress: deps.meta.ipAddress,
    deviceKind: ctx.deviceKind,
  });
}

/** 定型文を作る（`POST /api/chat/templates`）。50 件を超えるなら 409。 */
export async function createMyChatTemplate(
  ctx: AuthenticatedTenantCtx,
  input: ChatTemplateBody,
  deps: ChatTemplateDeps,
): Promise<ChatTemplateView> {
  return withTenant(ctx, async (db) => {
    // 🔴 数えるのも本人の行だけ（RLS）。同時に 2 件作られると 51 件になりうるが、件数の上限は使い勝手のためのもので境界ではない。
    if ((await db.chatMessageTemplate.count()) >= CHAT_TEMPLATE_MAX_PER_USER) throw new ConflictError();
    const created = await db.chatMessageTemplate.create({
      data: { tenantId: ctx.tenantId, userId: ctx.userId, label: input.label, body: input.body },
      select: TEMPLATE_SELECT,
    });
    await audit(db, ctx, CHAT_TEMPLATE_AUDIT_ACTION_CREATE, created.id, input, deps);
    return created;
  });
}

/** 定型文を直す（`PATCH /api/chat/templates/{templateId}`）。🔴 自分の定型文でなければ 404（他人の行は見えない）。 */
export async function updateMyChatTemplate(
  ctx: AuthenticatedTenantCtx,
  templateId: string,
  input: ChatTemplateBody,
  deps: ChatTemplateDeps,
): Promise<ChatTemplateView> {
  return withTenant(ctx, async (db) => {
    requireFound(await db.chatMessageTemplate.findFirst({ where: { id: templateId }, select: { id: true } }));
    const updated = await db.chatMessageTemplate.update({
      where: { id: templateId },
      data: { label: input.label, body: input.body },
      select: TEMPLATE_SELECT,
    });
    await audit(db, ctx, CHAT_TEMPLATE_AUDIT_ACTION_UPDATE, templateId, input, deps);
    return updated;
  });
}

/** 定型文を消す（`DELETE /api/chat/templates/{templateId}`）。🔴 自分の定型文でなければ 404。 */
export async function deleteMyChatTemplate(
  ctx: AuthenticatedTenantCtx,
  templateId: string,
  deps: ChatTemplateDeps,
): Promise<{ readonly id: string }> {
  return withTenant(ctx, async (db) => {
    requireFound(await db.chatMessageTemplate.findFirst({ where: { id: templateId }, select: { id: true } }));
    await db.chatMessageTemplate.delete({ where: { id: templateId } });
    await audit(db, ctx, CHAT_TEMPLATE_AUDIT_ACTION_DELETE, templateId, null, deps);
    return { id: templateId };
  });
}
