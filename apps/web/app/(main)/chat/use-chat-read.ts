'use client';

import { useEffect, useRef, useState } from 'react';
import { readReceiptMessageId } from '../../../lib/chat/read-receipt';
import { chatReadApiPath, chatUnreadApiPath } from '../../../lib/chat/screen-query';
import { unreadMarkerId } from '../../../lib/chat/unread-marker';
import type { ChatMessageView } from '../../../lib/chat/views';

type ChatReadOptions = {
  readonly initialMessages: readonly ChatMessageView[];
  readonly lastReadMessageId: string | null;
  readonly items: readonly ChatMessageView[];
  readonly peerReadMessageId: string | null;
  readonly awayFromLatest: boolean;
  readonly threadId: string;
  /** ✅ 2026-10-26（#166 の 3）: 実際に画面に見えていて、読めなくなっていないときだけ既読にする。 */
  readonly active: boolean;
};

export function useChatRead({
  initialMessages, lastReadMessageId, items, peerReadMessageId, awayFromLatest, threadId, active,
}: ChatReadOptions) {
  // ✅ 2026-10-16: 既読・未読（`lib/chat/read-state.ts` / `unread-marker.ts`）。
  //    線は開いた時点で決め、読んでも動かさない。「ここから未読にする」を押したらその発言へ動かす。
  const [markerId, setMarkerId] = useState<string | null>(() => unreadMarkerId(initialMessages, lastReadMessageId));
  const lastMarkedRef = useRef<string | null>(lastReadMessageId);
  // ✅ 2026-10-19（#128）: DM の「既読」は、相手が最後に読んだ位置にある自分の発言 1 件の下だけ。
  const readReceiptId = readReceiptMessageId(items, peerReadMessageId);
  // 「未読にする」を押した会話では、自動で既読に戻さない（押した意味が消えるため）。
  const suppressAutoReadRef = useRef(false);

  // 一番下（最新）が見えていて、画面が見えているときは、最新の発言まで既読にする。
  // 🔴 既読は戻す方向に動かない（API 側でも守る）。送れなくても次の機会に任せる（画面は壊さない）。
  useEffect(() => {
    const latest = items.at(-1);
    // 🔴 スマホで隠れている列・横スクロールの外の列は、読んでいないので既読にしない（#166 の 3）。
    if (!active || latest === undefined || awayFromLatest || suppressAutoReadRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (lastMarkedRef.current === latest.id) return;
    lastMarkedRef.current = latest.id;
    void fetch(chatReadApiPath(threadId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upToMessageId: latest.id }),
    }).catch(() => {
      lastMarkedRef.current = null;
    });
  }, [items, awayFromLatest, threadId, active]);

  async function markUnread(item: ChatMessageView): Promise<void> {
    suppressAutoReadRef.current = true;
    setMarkerId(item.id);
    try {
      await fetch(chatUnreadApiPath(threadId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromMessageId: item.id }),
      });
    } catch {
      // 送れなければ次の再読込で元の状態に戻る（画面の線は押した位置のまま）。
    }
  }

  return { markerId, readReceiptId, markUnread };
}
