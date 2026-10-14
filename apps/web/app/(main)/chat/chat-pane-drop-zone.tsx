'use client';

// apps/web/app/(main)/chat/chat-pane-drop-zone.tsx
// ✅ 2026-10-14（チャットレーン）: `S-031` の**ドラッグで会話を右に並べる受け口**（Slack の分割表示に寄せる）。
//
// ============================================================================
// 🔴 この島が守るもの
// ============================================================================
//   ① 🔴 **受け取るのは URL だけで、中身は運ばない。** 一覧の行は普通のリンクであり、ドラッグで
//      ブラウザが運ぶのは `/chat?thread=<id>` だけである。ここは ID を取り出して並びの URL を組み、
//      **画面を読み直す**（`router.push`）。会話の中身はサーバが RLS を通して読む —— 見えない ID が
//      落とされても「表示できません」になるだけで、境界の経路は増えない。
//   ② 🔴 **同じ画面のリンクだけを受ける**（`lib/chat/panes.ts` の `threadIdFromDroppedUrl`）。
//      他のオリジン・他の画面・形の違う ID は黙って捨てる。
//   ③ **ドラッグしている間だけ現れる**（ふだんは幅を取らない）。ドラッグの代わりの導線は
//      一覧の各行の「右に並べる」（`chat-thread-list.tsx`）。
//   ④ 🔴 `@ses/db` / `@ses/i18n` を値 import しない（`tests/static/client-db-boundary.test.ts`）。
//      文言は props から受け取る。
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@ses/ui';
import { threadIdFromDroppedUrl, withPaneAdded, type ChatPaneState } from '../../../lib/chat/panes';
import { chatHref } from '../../../lib/chat/screen-query';
import type { ChatThreadSort } from '../../../lib/chat/thread-tree';
import type { ChatPaneDropMessages } from './chat-props';

export type ChatPaneDropZoneProps = {
  readonly state: ChatPaneState;
  /** ✅ 2026-10-14: 一覧の検索語と並べ方（開いた後も一覧の条件を保つ）。 */
  readonly listQuery?: { readonly q: string | null; readonly sort: ChatThreadSort };
  readonly messages: ChatPaneDropMessages;
};

/** ドラッグで運ばれる URL の型（`text/uri-list` が無いブラウザは `text/plain` に載せる）。 */
const URL_TYPES = ['text/uri-list', 'text/plain'] as const;

export function ChatPaneDropZone({ state, listQuery, messages }: ChatPaneDropZoneProps) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);

  // 🔴 画面の中でドラッグが始まった・終わったことだけを見る（受け口を出し入れするため）。
  useEffect(() => {
    const start = (): void => setDragging(true);
    const end = (): void => {
      setDragging(false);
      setOver(false);
    };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end);
    document.addEventListener('drop', end);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end);
      document.removeEventListener('drop', end);
    };
  }, []);

  if (!dragging) return null;

  return (
    <div
      className={cn(
        'flex min-w-40 shrink-0 items-center justify-center border-l border-border p-4 text-center text-xs text-fg-muted',
        over ? 'bg-brand-bg' : 'bg-bg-subtle',
      )}
      data-testid="chat-pane-drop-zone"
      onDragOver={(event) => {
        if (!URL_TYPES.some((type) => event.dataTransfer.types.includes(type))) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'link';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        const raw = URL_TYPES.map((type) => event.dataTransfer.getData(type)).find((value) => value !== '') ?? '';
        const threadId = threadIdFromDroppedUrl(raw, window.location.origin);
        setDragging(false);
        setOver(false);
        if (threadId === null) return;
        const next = withPaneAdded(state, threadId);
        if (next === state) return;
        router.push(chatHref({ ...next, ...listQuery }));
      }}
    >
      {messages.drop}
    </div>
  );
}
