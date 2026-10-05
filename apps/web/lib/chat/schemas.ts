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
import { isChatThreadCursor } from './thread-cursor';

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
export const chatMessageListQuerySchema = idCursorPageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(CHAT_MESSAGE_PAGE_SIZE),
});

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

/** 🔴 分離キーが混入したらコンパイルエラーになる。 */
export type ChatThreadListQueryIsolationGuard = AssertNoIsolationKeys<ChatThreadListQuery>;
export type ChatMessageListQueryIsolationGuard = AssertNoIsolationKeys<ChatMessageListQuery>;
export type ChatThreadParamsIsolationGuard = AssertNoIsolationKeys<ChatThreadParams>;
export type ChatMessageBodyIsolationGuard = AssertNoIsolationKeys<ChatMessageBody>;

assertNoIsolationKeys(Object.keys(chatThreadListQuerySchema.shape), 'chatThreadListQuerySchema');
assertNoIsolationKeys(Object.keys(chatMessageListQuerySchema.shape), 'chatMessageListQuerySchema');
assertNoIsolationKeys(Object.keys(chatThreadParamsSchema.shape), 'chatThreadParamsSchema');
assertNoIsolationKeys(Object.keys(chatMessageBodySchema.shape), 'chatMessageBodySchema');
