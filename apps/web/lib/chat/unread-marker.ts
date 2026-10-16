// apps/web/lib/chat/unread-marker.ts
// ✅ 2026-10-16（チャットレーン）: `S-031` の「ここから未読」の線（純粋関数）。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない（クライアントの島から呼ぶ）。
import type { ChatTimelineEntry } from './day-separators';
import type { ChatMessageView } from './views';

/**
 * 「ここから未読」の線を引く発言（= 既読位置より後ろの、**自分以外**の最初の発言）。無ければ `null`。
 * - 既読位置が手元の一覧に無い（もっと古い）なら、手元の最初の自分以外の発言から
 * - まだ 1 件も読んでいない（`null`）も同じ
 */
export function unreadMarkerId(
  items: readonly ChatMessageView[],
  lastReadMessageId: string | null,
): string | null {
  const index = lastReadMessageId === null ? -1 : items.findIndex((item) => item.id === lastReadMessageId);
  const rest = items.slice(index + 1);
  return rest.find((item) => !item.mine)?.id ?? null;
}

/** 会話の並びに「ここから未読」の行を差し込む（対象の発言の直前）。 */
export type ChatTimelineWithUnread = ChatTimelineEntry | { readonly kind: 'unread' };

export function withUnreadMarker(
  entries: readonly ChatTimelineEntry[],
  markerId: string | null,
): readonly ChatTimelineWithUnread[] {
  if (markerId === null) return entries;
  return entries.flatMap((entry): ChatTimelineWithUnread[] =>
    entry.kind === 'message' && entry.message.id === markerId ? [{ kind: 'unread' }, entry] : [entry],
  );
}
