// apps/web/lib/chat/schemas.ts
// `S-031` チャットの API 境界（`docs/05` §6.5 #50 / #51 / §6.1）。
//
// 🔴 **分離キーを 1 つも持たない**（`CLAUDE.md` §3.1 / `BR-03` / `F-003 AC-1`）。
//    `tenant_id` / `partner_company_id` は `ctx` からしか来ない。`AssertNoIsolationKeys` が型で固定し、
//    `withApiRoute` が構築時にもキー名を検査する。
// 🔴 **スレッドの検索・絞り込みを受けない**（`docs/04` のタブ「すべて / 未読 / グループ / お気に入り」は
//    実体が無く、検索は `docs/05` #50 の request に無い）。**入力面を増やさない。**
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE, PAGE_CURSOR_MAX_LENGTH, PAGE_SIZE_MAX } from '@ses/config';
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { cursorPageQuerySchema, idCursorPageQuerySchema } from '../api/pagination';
import { optionalFilter } from '../api/query-filters';
import { isChatThreadCursor } from './thread-cursor';
import { CHAT_ATTACHMENT_CONTENT_TYPES, CHAT_ATTACHMENT_MAX_BYTES, type ChatAttachmentContentType } from '@ses/domain';
import { CHAT_REACTIONS } from './views';

/**
 * `GET /api/threads`（#50）。
 *
 * 🔴 **`cursor` は行の ID ではなく、並び順の 2 つのキーを持つ複合カーソルである**
 *    （`<最終更新 | '-'>~<UUID>`。理由は `thread-cursor.ts` の 🔴 —— `last_message_at` が
 *    `NULL` を取りうるため、`cursor: { id }` では 2 ページ目以降から行が静かに落ちる）。
 * 🔴 **形が違えば 400**（`refine`）。500 にしない（形で落ちると実在の有無を応答から探れる）。
 */
export const chatThreadListQuerySchema = cursorPageQuerySchema.extend({
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(PAGE_CURSOR_MAX_LENGTH)
    .refine(isChatThreadCursor)
    .optional(),
});

export type ChatThreadListQuery = z.infer<typeof chatThreadListQuerySchema>;

/**
 * `GET /api/threads/{id}/messages`（#50）。
 * 🔴 既定は **50 件**（`docs/04` §10.4 `S-031`「直近 50 件を初期表示し、上方向にページング」）。
 *    `idCursorPageQuerySchema` の既定（`PAGE_SIZE_DEFAULT` = 50）と同値だが、**この画面の根拠は
 *    §10.4 であり、ページサイズの共通既定が変わっても会話の既定は 50 のままにする**。
 */
export const chatMessageListQuerySchema = idCursorPageQuerySchema
  .extend({
    limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(CHAT_MESSAGE_PAGE_SIZE),
    // ✅ 2026-10-26（#166 の 4）: この発言より**後ろ**を古い順に読む（復帰後に 50 件を超えた新着を欠落なく追う）。
    after: z.uuid().optional(),
    // ✅ 2026-10-26（#166 の 8）: この発言の**前後**を読む（古いアナウンスへ 1 操作で移る）。
    around: z.uuid().optional(),
  })
  // 🔴 読み方は 1 つだけ（`cursor` = 古い方へ / `after` = 新しい方へ / `around` = 前後）。組み合わせは 400。
  .refine(
    (query) => [query.cursor, query.after, query.around].filter((value) => value !== undefined).length <= 1,
    { message: 'cursor / after / around は 1 つだけ指定できます' },
  );

export type ChatMessageListQuery = z.infer<typeof chatMessageListQuerySchema>;

/** スレッドを指す path param（`/api/threads/[id]/messages`）。 */
export const chatThreadParamsSchema = z.object({ id: z.uuid() });

export type ChatThreadParams = z.infer<typeof chatThreadParamsSchema>;

/**
 * `POST /api/threads/{id}/messages`（#51）。
 *
 * 🔴 **`attachmentKey` を受けない**（`docs/05` #51 は `{ body, attachmentKey? }` だが、添付は
 *    ウイルススキャンの `CLEAN` 判定と `CHAT_ATTACHMENT` のゲートを伴う〔`CLAUDE.md` §3.3 / §3.4〕。
 *    配線が無い状態で口だけを開けると、**スキャン前のオブジェクトキーを相手に渡せる経路**になる）。
 * 🔴 **本文は空白だけでは通らない**（`trim().min(1)`）。空の吹き出しを相手に届けない。
 */
export const chatMessageBodySchema = z.object({
  body: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
});

export type ChatMessageBody = z.infer<typeof chatMessageBodySchema>;

/** ✅ 2026-10-27: 添付の札の長さの上限（`attachment-token.ts` の検証でも使う。🔴 ここはクライアントも読むので `node:crypto` を持ち込まない）。 */
export const CHAT_ATTACHMENT_TOKEN_MAX_LENGTH = 2048;

/**
 * ✅ 2026-10-23（紺野）: `POST /api/threads/{id}/messages`（#51）の body。本文に加えて、**貼る案件の ID を 1 つ**受ける。
 *
 * 🔴 **案件を貼るときは本文を省略できる**（カードだけの発言）。どちらも無い・本文が空白だけでカードも無いなら 400。
 * 🔴 `projectId` は「どの案件か」の指定だけ。**貼れるかどうかはサーバが決める**（送る人が RLS で読めるか・部屋の取引先に
 *    公開中か。`project-cards.ts` の `requirePastableProject`）。分離キー（取引先・テナント）は受け取らない。
 * 🔴 編集（`PATCH`）は従来の `chatMessageBodySchema`（本文だけ）のまま —— 貼った案件を後から差し替える口は作らない。
 */
export const chatMessagePostBodySchema = z
  .object({
    body: z.string().trim().max(CHAT_MESSAGE_MAX_LENGTH).default(''),
    projectId: z.uuid().optional(),
    // ✅ 2026-10-27（`F-038` 改訂 12 ⑫）: #51p が出した**署名付きの札**だけを受ける（キー・種類・大きさは札の中。
    //    🔴 `attachmentKey` は相変わらず受けない —— キーを利用者に指させない）。札の確認はサーバ（`attachments.ts`）。
    attachmentUploadToken: z.string().min(1).max(CHAT_ATTACHMENT_TOKEN_MAX_LENGTH).optional(),
  })
  .refine(
    (value) => value.body.length > 0 || value.projectId !== undefined || value.attachmentUploadToken !== undefined,
    { path: ['body'] },
  );

export type ChatMessagePostBody = z.infer<typeof chatMessagePostBodySchema>;
export type ChatMessagePostBodyIsolationGuard = AssertNoIsolationKeys<ChatMessagePostBody>;
assertNoIsolationKeys(['body', 'projectId', 'attachmentUploadToken'], 'chatMessagePostBodySchema');

/**
 * ✅ 2026-10-27: `POST /api/threads/{id}/attachments/upload-url`（#51p）。種類と大きさだけを受ける。
 * 🔴 ファイル名を受け取らない（保存しない）。キー・部屋の取引先・テナントは受け取らない（サーバが決める）。
 */
export const chatAttachmentUploadBodySchema = z
  .object({
    contentType: z.enum(CHAT_ATTACHMENT_CONTENT_TYPES as unknown as [ChatAttachmentContentType, ...ChatAttachmentContentType[]]),
    byteSize: z.number().int().min(1).max(CHAT_ATTACHMENT_MAX_BYTES),
  })
  .strict();
export type ChatAttachmentUploadBody = z.infer<typeof chatAttachmentUploadBodySchema>;
export type ChatAttachmentUploadBodyIsolationGuard = AssertNoIsolationKeys<ChatAttachmentUploadBody>;
assertNoIsolationKeys(Object.keys(chatAttachmentUploadBodySchema.shape), 'chatAttachmentUploadBodySchema');

/** ✅ 2026-10-27: `POST /api/threads/{id}/messages/{messageId}/attachment/download-url`（#51q）。開く（inline）か保存（attachment）か。 */
export const chatAttachmentDownloadBodySchema = z.object({ disposition: z.enum(['inline', 'attachment']) }).strict();
export type ChatAttachmentDownloadBody = z.infer<typeof chatAttachmentDownloadBodySchema>;
export type ChatAttachmentDownloadBodyIsolationGuard = AssertNoIsolationKeys<ChatAttachmentDownloadBody>;
assertNoIsolationKeys(Object.keys(chatAttachmentDownloadBodySchema.shape), 'chatAttachmentDownloadBodySchema');

/** ✅ 2026-10-27: `GET /api/threads/{id}/attachments`（#51r）。カーソル（発言の ID）だけ。 */
export const chatAttachmentListQuerySchema = idCursorPageQuerySchema;
export type ChatAttachmentListQuery = z.infer<typeof chatAttachmentListQuerySchema>;
export type ChatAttachmentListQueryIsolationGuard = AssertNoIsolationKeys<ChatAttachmentListQuery>;

/** 案件名の絞り込み語の上限（案件一覧のフリーワードと同じ 200 文字）。 */
const CHAT_PROJECT_CANDIDATE_Q_MAX_LENGTH = 200;

/** ✅ 2026-10-23: `GET /api/threads/{id}/projects`（#51n。貼る案件の候補）。案件名で絞り込む語だけを受ける。 */
export const chatProjectCandidateQuerySchema = z.object({
  q: optionalFilter(z.string().trim().min(1).max(CHAT_PROJECT_CANDIDATE_Q_MAX_LENGTH)),
});
export type ChatProjectCandidateQuery = z.infer<typeof chatProjectCandidateQuerySchema>;
export type ChatProjectCandidateQueryIsolationGuard = AssertNoIsolationKeys<ChatProjectCandidateQuery>;
assertNoIsolationKeys(Object.keys(chatProjectCandidateQuerySchema.shape), 'chatProjectCandidateQuerySchema');

/** 🔴 分離キーが混入したらコンパイルエラーになる。 */
export type ChatThreadListQueryIsolationGuard = AssertNoIsolationKeys<ChatThreadListQuery>;
export type ChatMessageListQueryIsolationGuard = AssertNoIsolationKeys<ChatMessageListQuery>;
export type ChatThreadParamsIsolationGuard = AssertNoIsolationKeys<ChatThreadParams>;
export type ChatMessageBodyIsolationGuard = AssertNoIsolationKeys<ChatMessageBody>;

assertNoIsolationKeys(Object.keys(chatThreadListQuerySchema.shape), 'chatThreadListQuerySchema');
assertNoIsolationKeys(Object.keys(chatMessageListQuerySchema.shape), 'chatMessageListQuerySchema');
assertNoIsolationKeys(Object.keys(chatThreadParamsSchema.shape), 'chatThreadParamsSchema');
assertNoIsolationKeys(Object.keys(chatMessageBodySchema.shape), 'chatMessageBodySchema');

/** ✅ 2026-10-16: `PUT /api/threads/{id}/read`（ここまで読んだ）。 */
export const chatReadBodySchema = z.object({ upToMessageId: z.uuid() });
export type ChatReadBody = z.infer<typeof chatReadBodySchema>;

/** ✅ 2026-10-16: `PUT /api/threads/{id}/unread`（この発言から未読にする）。 */
export const chatUnreadBodySchema = z.object({ fromMessageId: z.uuid() });
export type ChatUnreadBody = z.infer<typeof chatUnreadBodySchema>;

export type ChatReadBodyIsolationGuard = AssertNoIsolationKeys<ChatReadBody>;
export type ChatUnreadBodyIsolationGuard = AssertNoIsolationKeys<ChatUnreadBody>;
assertNoIsolationKeys(Object.keys(chatReadBodySchema.shape), 'chatReadBodySchema');
assertNoIsolationKeys(Object.keys(chatUnreadBodySchema.shape), 'chatUnreadBodySchema');

/** ✅ 2026-10-16: `POST /api/threads/{id}/messages/{messageId}/reactions`（付ける / 外す）。 */
export const chatReactionParamsSchema = z.object({ id: z.uuid(), messageId: z.uuid() });
export type ChatReactionParams = z.infer<typeof chatReactionParamsSchema>;
export const chatReactionBodySchema = z.object({ reaction: z.enum(CHAT_REACTIONS) });
export type ChatReactionBody = z.infer<typeof chatReactionBodySchema>;
export type ChatReactionParamsIsolationGuard = AssertNoIsolationKeys<ChatReactionParams>;
export type ChatReactionBodyIsolationGuard = AssertNoIsolationKeys<ChatReactionBody>;
assertNoIsolationKeys(Object.keys(chatReactionParamsSchema.shape), 'chatReactionParamsSchema');
assertNoIsolationKeys(Object.keys(chatReactionBodySchema.shape), 'chatReactionBodySchema');

/** ✅ 2026-10-16: `PATCH` / `DELETE /api/threads/{id}/messages/{messageId}`（自分の発言の編集・削除）。 */
export const chatMessageParamsSchema = z.object({ id: z.uuid(), messageId: z.uuid() });
export type ChatMessageParams = z.infer<typeof chatMessageParamsSchema>;
export type ChatMessageParamsIsolationGuard = AssertNoIsolationKeys<ChatMessageParams>;
assertNoIsolationKeys(Object.keys(chatMessageParamsSchema.shape), 'chatMessageParamsSchema');

/** ✅ 2026-10-16: `PUT /api/threads/{id}/prefs`（ピン留め・ミュート。少なくとも 1 つ）。 */
export const chatThreadPrefsBodySchema = z
  .object({ pinned: z.boolean().optional(), muted: z.boolean().optional() })
  .refine((body) => body.pinned !== undefined || body.muted !== undefined);
export type ChatThreadPrefsBody = z.infer<typeof chatThreadPrefsBodySchema>;
export type ChatThreadPrefsBodyIsolationGuard = AssertNoIsolationKeys<ChatThreadPrefsBody>;
assertNoIsolationKeys(['pinned', 'muted'], 'chatThreadPrefsBodySchema');

// ✅ 2026-10-16（#128）: 人単位の部屋（`docs/05` §6.5 #51f / #51g）。
// 🔴 部屋の取引先・テナントは受け取らない（メンバーの所属と認証コンテキストから決める。`rooms.ts` ②）。
/** `POST /api/threads/dm` — その人との DM を開く（無ければ作る）。 */
export const chatDirectMessageBodySchema = z.object({ userId: z.uuid() }).strict();
assertNoIsolationKeys(Object.keys(chatDirectMessageBodySchema.shape), 'chatDirectMessageBodySchema');

/** `POST /api/threads/groups` — グループを作る（作成者は自動で入る）。 */
export const chatGroupBodySchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    userIds: z.array(z.uuid()).min(1).max(49),
  })
  .strict();
assertNoIsolationKeys(Object.keys(chatGroupBodySchema.shape), 'chatGroupBodySchema');

// ✅ 2026-10-19（#128 §7.1 ①）: ひとこと状態（`docs/05` §6.5 #51j）。🔴 誰の状態かは受け取らない（認証コンテキストの本人だけ）。
/** 🔴 migration 20261019020000 の CHECK（`char_length(text) <= 60`）と同じ値。 */
export const CHAT_USER_STATUS_MAX_LENGTH = 60;

/** `PUT /api/chat/status` — 自分の状態を設定する（空文字で消す）。1 行・60 文字まで。 */
export const chatUserStatusBodySchema = z
  .object({
    text: z
      .string()
      .trim()
      .max(CHAT_USER_STATUS_MAX_LENGTH)
      .refine((value) => !/[\r\n]/.test(value)),
  })
  .strict();
export type ChatUserStatusBody = z.infer<typeof chatUserStatusBodySchema>;
export type ChatUserStatusBodyIsolationGuard = AssertNoIsolationKeys<ChatUserStatusBody>;
assertNoIsolationKeys(Object.keys(chatUserStatusBodySchema.shape), 'chatUserStatusBodySchema');

// ✅ 2026-10-22（チャットレーン・紺野）: 保存済み（`docs/05` §6.5 #51l）。
// `PUT` / `DELETE /api/threads/{id}/messages/{messageId}/save` は body を持たない（params は `chatMessageParamsSchema`）。
// 🔴 誰の栞かは受け取らない（認証コンテキストの本人だけ。RLS も本人の行しか書かせない）。

// ✅ 2026-10-22（チャットレーン・紺野「自分だけ」）: 自分の定型文（`docs/05` §6.5 #51m）。
// 🔴 誰の定型文かは受け取らない（認証コンテキストの本人だけ）。
/** 🔴 migration 20261022020000 の CHECK（`char_length(label) <= 30`）と同じ値。 */
export const CHAT_TEMPLATE_LABEL_MAX_LENGTH = 30;
/** 🔴 migration 20261022020000 の CHECK（`char_length(body) <= 1000`）と同じ値。 */
export const CHAT_TEMPLATE_BODY_MAX_LENGTH = 1000;
/** 1 人が持てる定型文の数（アプリで数えて止める）。 */
export const CHAT_TEMPLATE_MAX_PER_USER = 50;

/** `POST /api/chat/templates` / `PATCH /api/chat/templates/{templateId}` — 見出しは 1 行。本文は改行してよい。 */
export const chatTemplateBodySchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(CHAT_TEMPLATE_LABEL_MAX_LENGTH)
      .refine((value) => !/[\r\n]/.test(value)),
    body: z.string().trim().min(1).max(CHAT_TEMPLATE_BODY_MAX_LENGTH),
  })
  .strict();
export type ChatTemplateBody = z.infer<typeof chatTemplateBodySchema>;
export type ChatTemplateBodyIsolationGuard = AssertNoIsolationKeys<ChatTemplateBody>;
assertNoIsolationKeys(Object.keys(chatTemplateBodySchema.shape), 'chatTemplateBodySchema');

/** 定型文を指す path param（`/api/chat/templates/[templateId]`）。 */
export const chatTemplateParamsSchema = z.object({ templateId: z.uuid() });
export type ChatTemplateParams = z.infer<typeof chatTemplateParamsSchema>;
export type ChatTemplateParamsIsolationGuard = AssertNoIsolationKeys<ChatTemplateParams>;
assertNoIsolationKeys(Object.keys(chatTemplateParamsSchema.shape), 'chatTemplateParamsSchema');

// ✅ 2026-10-26（チャットレーン・紺野の決定 2026-10-22）: アナウンス（`docs/05` §6.5 #51o）。
// 🔴 指せるのは発言の ID だけ（部屋は path の `id`、テナント・取引先は認証コンテキストから）。発言がその部屋のものかは
//    アプリ（`lib/chat/announcement.ts` ②）と RLS（migration 20261026010000 の WITH CHECK）の二重で見る。
/** `PUT /api/threads/{id}/announcement`（この発言をアナウンスにする。あれば置き換える）/ `DELETE`（この発言のアナウンスを外す）。 */
export const chatAnnouncementBodySchema = z.object({ messageId: z.uuid() }).strict();
export type ChatAnnouncementBody = z.infer<typeof chatAnnouncementBodySchema>;
export type ChatAnnouncementBodyIsolationGuard = AssertNoIsolationKeys<ChatAnnouncementBody>;
assertNoIsolationKeys(Object.keys(chatAnnouncementBodySchema.shape), 'chatAnnouncementBodySchema');
