// apps/web/lib/chat/read-receipt.ts
// ✅ 2026-10-19（#128）: `S-031` の DM の既読表示（純粋関数）。
// 🔴 DM にだけ使う（相手の既読位置は `readChatScreen` が DM にだけ返す）。グループ・会社グループ・スレッドには出さない。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない（クライアントの島から呼ぶ）。
import type { ChatMessageView } from './views';

/**
 * 「既読」を出す発言（= 相手の既読位置以前で、最後の**自分の**発言）。無ければ `null`。
 * - 相手の既読位置が手元の一覧に無い（まだ読んでいない / もっと古い）なら出さない
 * - 削除した発言には出さない（本文の無い行の下に印だけ残さない）
 */
export function readReceiptMessageId(
  items: readonly ChatMessageView[],
  peerReadMessageId: string | null,
): string | null {
  if (peerReadMessageId === null) return null;
  const index = items.findIndex((item) => item.id === peerReadMessageId);
  if (index < 0) return null;
  for (let i = index; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && item.mine && item.deleted !== true) return item.id;
  }
  return null;
}
