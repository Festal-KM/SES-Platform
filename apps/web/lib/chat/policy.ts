// apps/web/lib/chat/policy.ts
// `S-031` チャットの権限（`docs/04` §S-031「権限差分」/ `CLAUDE.md` §10.1 / `F-038`）。
//
// 🔴 **ロールで決まるのは「投稿できるか」だけである。** 「どのスレッドが見えるか」はロールではなく
//    `thread_participants` の行の有無（RLS の C6）が決める（`CLAUDE.md` §3.1 経路 3）。
//    したがって読み取り系のルートに `requireRole` を掛けない（`guards: []`）—— 掛けると
//    「ロールで止めているのか境界で止めているのか」が応答から読めなくなり、境界の後退に気づけない。
import type { TenantRole } from '@ses/db';

/**
 * 🔴 投稿できるロール（`docs/04` §S-031「`VIEWER` は投稿・添付ができない」/ `CLAUDE.md` §10.1）。
 *
 * ⚠️ `PARTNER_VIEWER`（`T-16-12` で追加予定。`CLAUDE.md` §10.1「チャットの投稿は一切不可」）は
 *    まだ `TENANT_ROLES` に存在しない。**列挙は許可側であり**、ロールが増えても自動では通らない
 *    （`requireRole` が落とす）。これが `role !== 'VIEWER'` と書かない理由である
 *    （`apps/web/lib/home/capabilities.ts` の申し送りと同じ穴を作らない）。
 */
export const CHAT_POST_ROLES: readonly TenantRole[] = [
  'OWNER',
  'ADMIN',
  'SALES',
  'PARTNER_ADMIN',
  'PARTNER_SALES',
];

/** 画面側の導線の出し分け（🔴 拒否の本体は API の `requireRole` / `requireNotViewer` である）。 */
export function canPostChatMessage(role: TenantRole): boolean {
  return CHAT_POST_ROLES.includes(role);
}

/**
 * ✅ 2026-10-27（`F-038` 改訂 12 ⑫ / `docs/05` §3.7.1）: この部屋にファイルを添えられるか。
 *
 * ~~取引先がいる部屋には添えられない~~ → ✅ 2026-10-27: **どの部屋でも添えられる**（`CLAUDE.md` §3.3 でチャット添付を
 * ゲートの対象から外した。紺野の決定・宮田の承認。#182）。DB のトリガ `messages_internal_only_attachment` も外した
 * （migration 20261027040000）。誰が送れるか（ロール・閲覧専用）は API のガード、どの部屋に送れるかは RLS（経路 3）が決める。
 * 🔴 判定の場所はこの 1 か所に残す（#51p・#51・画面の印の出し分けがここを通る。条件をほかに写さない）。
 */
export function chatRoomAcceptsAttachments(thread: { readonly partnerCompanyId: string | null }): boolean {
  void thread;
  return true;
}
