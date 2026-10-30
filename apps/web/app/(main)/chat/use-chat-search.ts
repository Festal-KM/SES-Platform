'use client';

// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑰）: この会話の中の検索（会話の見出しの検索の印で開く欄）。
//
// 🔴 ここが守るもの
//   ① 聞きに行くのは**開いているこの部屋の API だけ**（`GET /api/threads/{id}/messages/search`。#51s）。ほかの部屋を検索しない。
//   ② 打ち終わるのを少し待ってから聞く（1 文字ごとに問い合わせない）。2 文字未満では聞かない。古い応答は捨てる。
//   ③ 404（部屋から外れた・見えなくなった）は会話と同じく「読めなくなった」に倒す（`onUnavailable`）。
//   ④ 件数を出さない（応答にも無い）。
import { useEffect, useRef, useState } from 'react';
import { chatMessageSearchApiPath } from '../../../lib/chat/screen-query';
import { MESSAGE_SEARCH_MIN_LENGTH } from '../../../lib/chat/thread-tree';
import type { ChatMessageSearchHitView } from '../../../lib/chat/views';

/** 打ち終わるのを待つ時間。 */
export const CHAT_SEARCH_DEBOUNCE_MS = 300;

export type ChatSearchResult =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'done'; readonly items: readonly ChatMessageSearchHitView[] };

export function useChatSearch({ threadId, onUnavailable }: { readonly threadId: string; readonly onUnavailable: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ChatSearchResult>({ kind: 'idle' });
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const needle = query.trim();
    if (!open || needle.length < MESSAGE_SEARCH_MIN_LENGTH) {
      setResult({ kind: 'idle' });
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setResult({ kind: 'loading' });
      void (async () => {
        try {
          const response = await fetch(chatMessageSearchApiPath(threadId, needle), { cache: 'no-store' });
          if (!current) return;
          if (response.status === 404) {
            onUnavailableRef.current();
            return;
          }
          if (!response.ok) {
            setResult({ kind: 'failed' });
            return;
          }
          const payload = (await response.json()) as { readonly items: readonly ChatMessageSearchHitView[] };
          if (current) setResult({ kind: 'done', items: payload.items });
        } catch {
          if (current) setResult({ kind: 'failed' });
        }
      })();
    }, CHAT_SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [open, query, threadId]);

  function toggleSearch(): void {
    setOpen((value) => !value);
  }

  function closeSearch(): void {
    setOpen(false);
    setQuery('');
  }

  return { searchOpen: open, searchQuery: query, setSearchQuery: setQuery, searchResult: result, toggleSearch, closeSearch };
}
